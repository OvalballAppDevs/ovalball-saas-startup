-- =====================================================================================================
-- AN ORGANISER SAYS WHICH DAY A ROUND IS PLAYED.
--
-- Left to itself the scheduler fills the first day it can, because that is the right answer for a round
-- robin where every game is independent. A knockout is not: a cup across a weekend is usually quarter-
-- finals on the Friday, semi-finals on the Saturday and the final on the Sunday, and that is a decision
-- about the competition rather than a consequence of pitch capacity.
--
-- So a round may be ASSIGNED to one of the competition's own days. Where it is, the scheduler places
-- that round only in slots on that day. Where it is not, the round follows the one before it, which is
-- what a single-day festival wants and needs no configuring.
--
-- THE SCHEDULER STILL OWNS THE TIME AND THE PITCH. This says which day; it never says 11:45 on Pitch 2.
-- =====================================================================================================

create table if not exists public.tournament_plan_round_days (
  plan_id uuid not null references public.tournament_plans(id) on delete cascade,
  round_number integer not null,
  day_date date not null,
  created_at timestamptz not null default now(),
  primary key (plan_id, round_number),
  constraint tournament_plan_round_days_round_positive check (round_number >= 1)
);

comment on table public.tournament_plan_round_days is
  'Which of a competition''s own days a knockout round is played on. Optional: a round with no entry '
  'follows the one before it. Never says the time or the pitch -- the scheduler owns those.';

alter table public.tournament_plan_round_days enable row level security;

create policy tournament_plan_round_days_select on public.tournament_plan_round_days
  for select to authenticated
  using (exists (select 1 from public.tournament_plans p
                 where p.id = plan_id and internal.tournament_visible_row(p.tournament_id)));

create policy tournament_plan_round_days_session_ok_required on public.tournament_plan_round_days
  as restrictive for all to authenticated
  using (internal.session_ok()) with check (internal.session_ok());

grant select on public.tournament_plan_round_days to authenticated;

create or replace function public.set_tournament_round_days(p_plan_id uuid, p_rounds jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_tournament uuid; r record;
begin
  perform internal.require_live_session();
  select tournament_id into v_tournament from public.tournament_plans where id = p_plan_id;
  if v_tournament is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_tournament) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;

  delete from public.tournament_plan_round_days where plan_id = p_plan_id;

  for r in select (x->>'round')::int as round_number, (x->>'day')::date as day_date
           from jsonb_array_elements(coalesce(p_rounds, '[]'::jsonb)) x
  loop
    if r.day_date is null then continue; end if;
    -- A ROUND PLAYS ON A DAY THE COMPETITION PLAYS. Anything else is a fixture nobody is there for.
    if not exists (select 1 from public.tournament_plan_days d
                   where d.plan_id = p_plan_id and d.day_date = r.day_date) then
      raise exception 'A round can only be played on a day this competition runs.' using errcode = '22023';
    end if;
    insert into public.tournament_plan_round_days (plan_id, round_number, day_date)
    values (p_plan_id, r.round_number, r.day_date);
  end loop;
end;
$function$;

-- ---- the scheduler honours it ------------------------------------------------------------------------

create or replace function internal.schedule_bracket_pairings(p_plan_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare r record; s record; v_cursor integer := 0; v_n integer := 0; v_day date;
begin
  for r in
    select * from public.tournament_bracket_pairings
    where plan_id = p_plan_id
    order by round_number, is_third_place, game_position
  loop
    select day_date into v_day from public.tournament_plan_round_days
    where plan_id = p_plan_id and round_number = r.round_number;

    select * into s from internal.bracket_slots_available(p_plan_id) a
    where a.ordinal > v_cursor
      -- A ROUND WITH A DAY OF ITS OWN takes only slots on that day; one without follows on from the
      -- round before it, which is what a single-day festival wants without being asked.
      and (v_day is null or a.slot_day = v_day)
    order by a.ordinal limit 1;

    if s.ordinal is null then
      update public.tournament_bracket_pairings
      set game_date = null, start_time = null, pitch_id = null, updated_at = now()
      where id = r.id;
    else
      update public.tournament_bracket_pairings
      set game_date = s.slot_day, start_time = s.slot_start, pitch_id = s.pitch_id, updated_at = now()
      where id = r.id;
      v_cursor := s.ordinal;
      v_n := v_n + 1;
    end if;
  end loop;

  update public.tournament_games g
  set game_date = coalesce(bp.game_date, g.game_date),
      start_time = bp.start_time, pitch_id = bp.pitch_id, updated_at = now()
  from public.tournament_bracket_pairings bp
  where bp.game_id = g.id and bp.plan_id = p_plan_id;

  return v_n;
end;
$function$;

revoke all on function public.set_tournament_round_days(uuid, jsonb) from public, anon;
grant execute on function public.set_tournament_round_days(uuid, jsonb) to authenticated, service_role;
