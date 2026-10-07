-- A SWISS PAIRS EACH ROUND FROM THE TABLE (Tournament Planning parity programme, phase 8).
--
-- The owner's rules (2026-10-02, memory ovalball-tournament-format-sporting-rules):
--   * Round 1 is drawn at random, and the organiser may swap teams before it starts.
--   * Every later round sorts the table by points, then the competition's own tie-breakers, and pairs
--     1v2, 3v4 ... skipping rematches -- no two teams ever meet twice.
--   * With an odd number of teams, the lowest-ranked team that has not had a bye sits out; nobody has
--     more than one; a bye counts as a win in the table and adds no points for or against. It is not a
--     game and takes no pitch.
--   * Progressive: Generate builds Round 1 and reserves the kick-off times of EVERY round; the next
--     round is paired automatically the moment the previous round is settled, and each side is told who
--     it plays next.
--
-- NOTHING NEW IS INVENTED FOR IT. A Swiss is one table -- the round robin's tables, scoring,
-- tie-breakers and standings -- whose games are made a round at a time instead of all at once. Its
-- reserved kick-off times are the knockout's places-to-be (tournament_bracket_pairings: a time and a
-- pitch booked before anybody knows who plays in it), scheduled by the same scheduler, with a round
-- never starting before the previous one ends. The one new record is a bye.

-- ---- schema --------------------------------------------------------------------------------------

alter table public.tournament_plans add column if not exists swiss_rounds integer;
alter table public.tournament_plans drop constraint if exists tournament_plans_swiss_rounds_range;
alter table public.tournament_plans add constraint tournament_plans_swiss_rounds_range
  check (swiss_rounds is null or swiss_rounds between 2 and 12);
comment on column public.tournament_plans.swiss_rounds is
  'Swiss only: how many rounds the competition plays. Null falls back to the tournament''s own swiss_rounds.';

create table if not exists public.tournament_swiss_byes (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.tournament_plans(id) on delete cascade,
  round_number integer not null check (round_number >= 1),
  participant_id uuid not null references public.tournament_participants(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint tournament_swiss_byes_one_per_round unique (plan_id, round_number),
  constraint tournament_swiss_byes_one_per_side unique (plan_id, participant_id)
);
comment on table public.tournament_swiss_byes is
  'A Swiss round''s bye: the side that sits out, once at most, and is awarded a win in the table.';
alter table public.tournament_swiss_byes enable row level security;
revoke all on public.tournament_swiss_byes from anon, authenticated;
grant select on public.tournament_swiss_byes to authenticated;
drop policy if exists tournament_swiss_byes_session_ok_required on public.tournament_swiss_byes;
create policy tournament_swiss_byes_session_ok_required on public.tournament_swiss_byes
  as restrictive for all to authenticated using (internal.session_ok()) with check (internal.session_ok());
drop policy if exists tournament_swiss_byes_select on public.tournament_swiss_byes;
create policy tournament_swiss_byes_select on public.tournament_swiss_byes for select to authenticated
  using (internal.tournament_plan_readable(plan_id));

-- The marker the readiness calculation looks for: a Swiss now has its own generator.
create or replace function internal.tournament_swiss_supported()
returns boolean language sql immutable set search_path to '' as $function$ select true; $function$;

create or replace function internal.tournament_plan_swiss_rounds(p_plan_id uuid)
returns integer language sql stable security definer set search_path to '' as $function$
  select coalesce(p.swiss_rounds, t.swiss_rounds)
  from public.tournament_plans p join public.tournaments t on t.id = p.tournament_id
  where p.id = p_plan_id;
$function$;

-- ---- a Swiss keeps a table -------------------------------------------------------------------------

create or replace function internal.tournament_plan_has_standings(p_plan_id uuid)
returns boolean
language sql
stable
set search_path to ''
as $function$
  select case
    when coalesce(p.format, t.format) in ('knockout') then false
    when coalesce(p.format, t.format) in ('hybrid', 'swiss') then true
    when p.standings_enabled is not null then p.standings_enabled
    when coalesce(p.format, t.format) = 'tri_fixture' then false
    when coalesce(p.format, t.format) = 'round_robin' then true
    else false
  end
  from public.tournament_plans p
  join public.tournaments t on t.id = p.tournament_id
  where p.id = p_plan_id;
$function$;

-- A BYE IS A WIN IN THE TABLE, and nothing else: it is counted as played and won and earns a win's
-- points, and it adds no points for or against -- no score exists to add. Every other format has no
-- byes, so its table is unchanged.
create or replace function internal.tournament_table_standings(p_table_id uuid)
returns table(participant_id uuid, played integer, won integer, drawn integer, lost integer, points_for integer, points_against integer, points_difference integer, competition_points integer)
language sql
stable security definer
set search_path to ''
as $function$
  with plan as (
    select p.id, p.points_win, p.points_draw, p.points_loss, p.points_losing_bonus, p.losing_bonus_margin
    from public.tournament_plan_tables t
    join public.tournament_plans p on p.id = t.plan_id
    where t.id = p_table_id
  ),
  members as (
    select s.participant_id from public.tournament_plan_table_sides s where s.table_id = p_table_id
  ),
  sides as (
    select g.side_a_id as participant_id, g.side_a_score as scored, g.side_b_score as conceded
    from public.tournament_games g
    where g.table_id = p_table_id and internal.tournament_result_counts(g.result_status)
      and g.status <> 'CANCELLED' and g.side_a_score is not null and g.side_b_score is not null
    union all
    select g.side_b_id, g.side_b_score, g.side_a_score
    from public.tournament_games g
    where g.table_id = p_table_id and internal.tournament_result_counts(g.result_status)
      and g.status <> 'CANCELLED' and g.side_a_score is not null and g.side_b_score is not null
  ),
  byes as (
    select b.participant_id, count(*)::int as n
    from public.tournament_swiss_byes b
    where b.plan_id = (select id from plan)
    group by b.participant_id
  )
  select
    m.participant_id,
    (count(s.participant_id) + coalesce(max(by.n), 0))::int,
    (count(*) filter (where s.scored > s.conceded) + coalesce(max(by.n), 0))::int,
    count(*) filter (where s.scored = s.conceded)::int,
    count(*) filter (where s.scored < s.conceded)::int,
    coalesce(sum(s.scored), 0)::int,
    coalesce(sum(s.conceded), 0)::int,
    coalesce(sum(s.scored) - sum(s.conceded), 0)::int,
    (
      (count(*) filter (where s.scored > s.conceded) + coalesce(max(by.n), 0)) * (select points_win from plan)
      + count(*) filter (where s.scored = s.conceded) * (select points_draw from plan)
      + count(*) filter (where s.scored < s.conceded) * (select points_loss from plan)
      + count(*) filter (
          where s.scored < s.conceded
            and (s.conceded - s.scored) <= (select losing_bonus_margin from plan)
        ) * (select points_losing_bonus from plan)
    )::int
  from members m
  left join sides s on s.participant_id = m.participant_id
  left join byes by on by.participant_id = m.participant_id
  group by m.participant_id;
$function$;

-- A reserved Swiss place is named by its round, as a knockout place is named by its own.
create or replace function internal.tournament_game_round_label(p_plan_id uuid, p_round integer, p_is_third boolean)
returns text
language sql
stable
set search_path to ''
as $function$
  select case
    when internal.tournament_plan_format(p_plan_id) = 'swiss' then 'Round ' || coalesce(p_round, 1)
    when coalesce(p_is_third, false) then 'Third-Place Play-Off'
    else internal.bracket_game_name(
      p_round,
      internal.bracket_rounds((select count(*)::int
                               from public.tournament_bracket_slots s
                               where s.plan_id = p_plan_id and s.round_number = 1 and not s.is_third_place)))
  end
  -- NOTHING TO SAY ABOUT A ROUND ROBIN. No bracket, no round name, and the caller keeps its own wording.
  where internal.tournament_plan_format(p_plan_id) = 'swiss'
     or exists (select 1 from public.tournament_bracket_slots s where s.plan_id = p_plan_id);
$function$;

-- ---- pairing ---------------------------------------------------------------------------------------

create or replace function internal.swiss_key(p_a uuid, p_b uuid)
returns text language sql immutable set search_path to '' as $function$
  select least(p_a, p_b)::text || '|' || greatest(p_a, p_b)::text;
$function$;

-- Every pairing this plan has already played (or has drawn and not yet played).
create or replace function internal.swiss_played(p_plan_id uuid)
returns text[] language sql stable security definer set search_path to '' as $function$
  select coalesce(array_agg(internal.swiss_key(g.side_a_id, g.side_b_id)), '{}')
  from public.tournament_games g where g.plan_id = p_plan_id;
$function$;

-- TOP DOWN, NEVER A REMATCH. The highest-ranked unpaired side meets the highest-ranked side below it
-- that it has not played; if that leaves the rest unpairable, the next one down, and so on. Returns the
-- pairs flattened (a1, b1, a2, b2 ...), or NULL when no pairing without a rematch exists.
create or replace function internal.swiss_pair(p_sides uuid[], p_played text[])
returns uuid[]
language plpgsql
immutable
set search_path to ''
as $function$
declare v_a uuid; v_b uuid; i integer; v_rest uuid[]; v_sub uuid[]; n integer := coalesce(cardinality(p_sides), 0);
begin
  if n = 0 then return '{}'::uuid[]; end if;
  if n % 2 = 1 then return null; end if;
  v_a := p_sides[1];
  for i in 2 .. n loop
    v_b := p_sides[i];
    if internal.swiss_key(v_a, v_b) = any (p_played) then continue; end if;
    v_rest := p_sides[2:i - 1] || p_sides[i + 1:n];
    v_sub := internal.swiss_pair(v_rest, p_played);
    if v_sub is not null then return array[v_a, v_b] || v_sub; end if;
  end loop;
  return null;
end;
$function$;

-- The most rounds a field can play without two sides meeting twice.
create or replace function internal.swiss_round_limit(p_sides integer)
returns integer language sql immutable set search_path to '' as $function$
  select case when p_sides < 2 then 0 when p_sides % 2 = 0 then p_sides - 1 else p_sides end;
$function$;

-- RESERVE EVERY ROUND'S KICK-OFF TIMES NOW: one place per game a round will hold, in the knockout's own
-- place-to-be table, so the shared scheduler books them with a round never before the previous ends.
create or replace function internal.reserve_swiss_rounds(p_plan_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare v_rounds integer; v_games integer; r integer; i integer;
begin
  v_rounds := internal.tournament_plan_swiss_rounds(p_plan_id);
  select count(*) / 2 into v_games from public.tournament_plan_table_sides where plan_id = p_plan_id;
  delete from public.tournament_bracket_pairings where plan_id = p_plan_id;
  for r in 1 .. coalesce(v_rounds, 0) loop
    for i in 1 .. v_games loop
      insert into public.tournament_bracket_pairings (plan_id, round_number, game_position) values (p_plan_id, r, i);
    end loop;
  end loop;
  return coalesce(v_rounds, 0) * v_games;
end;
$function$;

-- MAKE ONE ROUND'S GAMES at the places reserved for it, and tell each side who it plays next.
create or replace function internal.create_swiss_round(p_plan_id uuid, p_round integer, p_pairs uuid[], p_bye uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_t uuid; v_grade text; v_dur integer; v_table uuid; i integer; bp record; v_id uuid; v_published boolean;
  v_a jsonb; v_b jsonb; v_when text; v_n integer := 0;
begin
  select p.tournament_id, p.age_group, p.game_duration_minutes into v_t, v_grade, v_dur
  from public.tournament_plans p where p.id = p_plan_id;
  select id into v_table from public.tournament_plan_tables where plan_id = p_plan_id order by sort_order limit 1;
  v_published := internal.tournament_plan_is_published(p_plan_id);

  if p_bye is not null then
    insert into public.tournament_swiss_byes (plan_id, round_number, participant_id) values (p_plan_id, p_round, p_bye);
    if v_published then
      perform internal.notify_tournament_side(p_bye, 'tournament_opponent_known',
        format('A bye in Round %s', p_round),
        format('You sit out Round %s and are awarded a win in the table.', p_round),
        jsonb_build_object('tournament_id', v_t, 'tournament_plan_id', p_plan_id));
    end if;
  end if;

  for i in 1 .. coalesce(cardinality(p_pairs), 0) / 2 loop
    select * into bp from public.tournament_bracket_pairings
    where plan_id = p_plan_id and round_number = p_round and game_position = i and not is_third_place;

    insert into public.tournament_games
      (tournament_id, plan_id, table_id, age_group, side_a_id, side_b_id, game_date, start_time, pitch_id,
       duration_minutes, status, round_number, sort_order, created_by, updated_by)
    values
      (v_t, p_plan_id, v_table, v_grade, p_pairs[2 * i - 1], p_pairs[2 * i],
       coalesce(bp.game_date, (select min(d.day_date) from public.tournament_plan_days d where d.plan_id = p_plan_id)),
       bp.start_time, bp.pitch_id, v_dur, 'SCHEDULED', p_round, p_round * 1000 + i, auth.uid(), auth.uid())
    returning id into v_id;
    v_n := v_n + 1;

    if bp.id is not null then
      update public.tournament_bracket_pairings set game_id = v_id, updated_at = now() where id = bp.id;
    end if;

    -- ROUND 1 IS ANNOUNCED BY PUBLICATION ITSELF; every later round is news when it is paired.
    if v_published and p_round > 1 then
      v_a := internal.tournament_side_summary(p_pairs[2 * i - 1], null);
      v_b := internal.tournament_side_summary(p_pairs[2 * i], null);
      v_when := case when bp.start_time is not null then format(' at %s', to_char(bp.start_time, 'HH24:MI')) else '' end;
      perform internal.notify_tournament_side(p_pairs[2 * i - 1], 'tournament_opponent_known',
        format('Your Round %s opponent is known', p_round), format('You play %s%s.', v_b ->> 'clubName', v_when),
        jsonb_build_object('tournament_id', v_t, 'tournament_plan_id', p_plan_id, 'tournament_game_id', v_id));
      perform internal.notify_tournament_side(p_pairs[2 * i], 'tournament_opponent_known',
        format('Your Round %s opponent is known', p_round), format('You play %s%s.', v_a ->> 'clubName', v_when),
        jsonb_build_object('tournament_id', v_t, 'tournament_plan_id', p_plan_id, 'tournament_game_id', v_id));
    end if;
  end loop;
  return v_n;
end;
$function$;

-- PAIR ONE ROUND. Round 1 from a random order; every later round from the table as it stands.
create or replace function internal.pair_swiss_round(p_plan_id uuid, p_round integer)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare v_table uuid; v_order uuid[]; v_played text[]; v_pairs uuid[]; v_bye uuid; i integer; v_rest uuid[];
begin
  select id into v_table from public.tournament_plan_tables where plan_id = p_plan_id order by sort_order limit 1;
  if p_round = 1 then
    select array_agg(s.participant_id order by random()) into v_order
    from public.tournament_plan_table_sides s where s.plan_id = p_plan_id;
  else
    select array_agg(o.participant_id order by o.table_position) into v_order
    from internal.tournament_table_ordered(v_table) o;
  end if;
  v_played := internal.swiss_played(p_plan_id);

  if coalesce(cardinality(v_order), 0) % 2 = 0 then
    v_pairs := internal.swiss_pair(v_order, v_played);
  else
    -- THE BYE: the lowest-ranked side without one (in Round 1, the random order's last).
    for i in reverse cardinality(v_order) .. 1 loop
      continue when exists (select 1 from public.tournament_swiss_byes b where b.plan_id = p_plan_id and b.participant_id = v_order[i]);
      v_rest := v_order[1:i - 1] || v_order[i + 1:cardinality(v_order)];
      v_pairs := internal.swiss_pair(v_rest, v_played);
      if v_pairs is not null then v_bye := v_order[i]; exit; end if;
    end loop;
  end if;

  if v_pairs is null then
    raise exception 'Round % cannot be paired without two teams meeting for a second time. Play fewer rounds.', p_round
      using errcode = '22023', hint = 'TOURNAMENT_SWISS_NO_PAIRING';
  end if;
  return internal.create_swiss_round(p_plan_id, p_round, v_pairs, v_bye);
end;
$function$;

-- THE NEXT ROUND, WHEN THIS ONE IS SETTLED -- and a corrected result in an earlier round undoes the
-- unplayed rounds after it, which are re-paired from the corrected table. A round already being played
-- is never silently re-paired: the correction is refused instead.
create or replace function internal.advance_swiss(p_plan_id uuid, p_round integer)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare v_rounds integer; v_latest integer; v_settled boolean;
begin
  v_rounds := internal.tournament_plan_swiss_rounds(p_plan_id);
  select coalesce(max(round_number), 0) into v_latest from public.tournament_games where plan_id = p_plan_id;

  if p_round < v_latest then
    if exists (select 1 from public.tournament_games g
               where g.plan_id = p_plan_id and g.round_number > p_round and internal.tournament_game_has_activity(g.id)) then
      raise exception 'Round % has already been played, and it was paired from these results. Clear its results first if this one genuinely needs to change.', p_round + 1
        using errcode = '22023', hint = 'TOURNAMENT_SWISS_NEXT_ROUND_PLAYED';
    end if;
    delete from public.tournament_games where plan_id = p_plan_id and round_number > p_round;
    delete from public.tournament_swiss_byes where plan_id = p_plan_id and round_number > p_round;
    v_latest := p_round;
  end if;

  if v_latest = 0 or v_latest >= coalesce(v_rounds, 0) then return; end if;
  select bool_and(g.result_status in ('final', 'external_recorded')) into v_settled
  from public.tournament_games g where g.plan_id = p_plan_id and g.round_number = v_latest;
  if coalesce(v_settled, false) then
    perform internal.pair_swiss_round(p_plan_id, v_latest + 1);
  end if;
end;
$function$;

create or replace function internal.tournament_game_progression()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_winner uuid; v_format text;
begin
  if new.bracket_position is null then
    if new.table_id is not null and new.plan_id is not null
       and (tg_op = 'UPDATE' and (new.result_status is distinct from old.result_status
                                  or new.side_a_score is distinct from old.side_a_score
                                  or new.side_b_score is distinct from old.side_b_score)) then
      v_format := internal.tournament_plan_format(new.plan_id);
      -- A HYBRID'S GROUP GAME DECIDES QUALIFICATION, once its whole table is settled.
      if v_format = 'hybrid' then
        perform internal.resolve_hybrid_qualification(new.plan_id, new.table_id);
      -- A SWISS GAME DECIDES THE NEXT ROUND, once its whole round is settled.
      elsif v_format = 'swiss' then
        perform internal.advance_swiss(new.plan_id, new.round_number);
      end if;
    end if;
    return new;
  end if;

  v_winner := internal.tournament_score_winner(new.id);
  if v_winner is null and new.winner_decided_by is not null then
    v_winner := new.winner_participant_id;
  end if;
  if v_winner is distinct from new.winner_participant_id then
    update public.tournament_games set winner_participant_id = v_winner where id = new.id;
    new.winner_participant_id := v_winner;
  end if;

  perform internal.advance_tournament_bracket(new.id);
  return new;
end;
$function$;

-- ---- the organiser's controls -------------------------------------------------------------------

create or replace function public.set_tournament_swiss_settings(p_plan_id uuid, p_rounds integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_plan public.tournament_plans;
begin
  perform internal.require_live_session();
  select * into v_plan from public.tournament_plans where id = p_plan_id;
  if v_plan.id is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_plan.tournament_id) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;
  if internal.tournament_plan_format(p_plan_id) <> 'swiss' then
    raise exception 'Only a Swiss competition is played in Swiss rounds.' using errcode = '22023';
  end if;
  if p_rounds is null or p_rounds not between 2 and 12 then
    raise exception 'A Swiss competition plays between 2 and 12 rounds.' using errcode = '22023';
  end if;
  if internal.tournament_plan_swiss_rounds(p_plan_id) is distinct from p_rounds then
    perform internal.refuse_if_competition_has_results(v_plan.tournament_id, v_plan.age_group, 'change how many rounds are played');
    update public.tournament_plans set swiss_rounds = p_rounds, updated_by = auth.uid(), updated_at = now() where id = p_plan_id;
  end if;
  return internal.tournament_plan_readiness(p_plan_id);
end;
$function$;
revoke all on function public.set_tournament_swiss_settings(uuid, integer) from public, anon;
grant execute on function public.set_tournament_swiss_settings(uuid, integer) to authenticated;

-- THE ORGANISER'S SWAP: two sides change places in the round about to be played -- the random Round 1
-- draw above all. Refused once any game of that round has a result or a submission, and refused if it
-- would make two teams meet for a second time. A published swap tells the four sides it moves.
create or replace function public.swap_tournament_swiss_sides(p_plan_id uuid, p_first uuid, p_second uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan public.tournament_plans; v_round integer; g1 record; g2 record; v_bye uuid;
  v_new_a uuid; v_new_b uuid; v_played text[]; r record; v_t text;
begin
  perform internal.require_live_session();
  select * into v_plan from public.tournament_plans where id = p_plan_id;
  if v_plan.id is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_plan.tournament_id) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;
  if internal.tournament_plan_format(p_plan_id) <> 'swiss' then
    raise exception 'Only a Swiss round''s pairings can be swapped.' using errcode = '22023';
  end if;
  if p_first = p_second then raise exception 'Choose two different teams.' using errcode = '22023'; end if;

  select max(round_number) into v_round from public.tournament_games where plan_id = p_plan_id;
  if v_round is null then raise exception 'Generate the fixtures first.' using errcode = '22023'; end if;
  if exists (select 1 from public.tournament_games g where g.plan_id = p_plan_id and g.round_number = v_round
             and internal.tournament_game_has_activity(g.id)) then
    raise exception 'Round % has started, so its pairings can no longer be swapped.', v_round
      using errcode = '22023', hint = 'TOURNAMENT_SWISS_ROUND_STARTED';
  end if;

  select * into g1 from public.tournament_games where plan_id = p_plan_id and round_number = v_round and p_first in (side_a_id, side_b_id);
  select * into g2 from public.tournament_games where plan_id = p_plan_id and round_number = v_round and p_second in (side_a_id, side_b_id);
  select participant_id into v_bye from public.tournament_swiss_byes where plan_id = p_plan_id and round_number = v_round;
  if (g1.id is null and v_bye is distinct from p_first) or (g2.id is null and v_bye is distinct from p_second) then
    raise exception 'Both teams must be in Round %.', v_round using errcode = '22023';
  end if;
  if g1.id is not null and g1.id = g2.id then
    raise exception 'Those two teams already play each other.' using errcode = '22023';
  end if;

  -- A SIDE HAS ONE BYE AT MOST: swapping a side into the bye it has already had is refused.
  if v_bye in (p_first, p_second) and exists (
       select 1 from public.tournament_swiss_byes b
       where b.plan_id = p_plan_id and b.round_number < v_round
         and b.participant_id = case when v_bye = p_first then p_second else p_first end) then
    raise exception 'That team has already had its bye.' using errcode = '22023', hint = 'TOURNAMENT_SWISS_SECOND_BYE';
  end if;

  -- Each side takes the other's place: its opponent, or its bye.
  update public.tournament_games set
    side_a_id = case when side_a_id = p_first then p_second when side_a_id = p_second then p_first else side_a_id end,
    side_b_id = case when side_b_id = p_first then p_second when side_b_id = p_second then p_first else side_b_id end,
    updated_by = auth.uid(), updated_at = now()
  where id in (g1.id, g2.id);
  update public.tournament_swiss_byes set participant_id = case when participant_id = p_first then p_second else p_first end
  where plan_id = p_plan_id and round_number = v_round and participant_id in (p_first, p_second);

  -- NO REMATCH, by the same rule the pairing follows.
  select coalesce(array_agg(internal.swiss_key(side_a_id, side_b_id)), '{}') into v_played
  from public.tournament_games where plan_id = p_plan_id and round_number < v_round;
  if exists (select 1 from public.tournament_games g where g.id in (g1.id, g2.id)
             and internal.swiss_key(g.side_a_id, g.side_b_id) = any (v_played)) then
    raise exception 'That swap would make two teams meet for a second time.' using errcode = '22023', hint = 'TOURNAMENT_SWISS_REMATCH';
  end if;
  if v_plan.publication_state = 'PUBLISHED' then
    select name into v_t from public.tournaments where id = v_plan.tournament_id;
    for r in
      select g.id, g.side_a_id as me, g.side_b_id as them from public.tournament_games g where g.id in (g1.id, g2.id)
      union all
      select g.id, g.side_b_id, g.side_a_id from public.tournament_games g where g.id in (g1.id, g2.id)
    loop
      perform internal.notify_tournament_side(r.me, 'tournament_schedule_changed', format('Your Round %s opponent has changed', v_round),
        format('You now play %s at %s.', internal.tournament_side_summary(r.them, null) ->> 'clubName', v_t),
        jsonb_build_object('tournament_id', v_plan.tournament_id, 'tournament_plan_id', p_plan_id, 'tournament_game_id', r.id));
    end loop;
  end if;
end;
$function$;
revoke all on function public.swap_tournament_swiss_sides(uuid, uuid, uuid) from public, anon;
grant execute on function public.swap_tournament_swiss_sides(uuid, uuid, uuid) to authenticated;

revoke all on function internal.swiss_pair(uuid[], text[]) from public, anon, authenticated;
revoke all on function internal.swiss_played(uuid) from public, anon, authenticated;
revoke all on function internal.reserve_swiss_rounds(uuid) from public, anon, authenticated;
revoke all on function internal.create_swiss_round(uuid, integer, uuid[], uuid) from public, anon, authenticated;
revoke all on function internal.pair_swiss_round(uuid, integer) from public, anon, authenticated;
revoke all on function internal.advance_swiss(uuid, integer) from public, anon, authenticated;
-- ---- the shared pieces, taught what a Swiss is ---------------------------------------------------

create or replace function internal.tournament_plan_consistency(p_plan_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_format text; v_competing uuid[]; v_placed uuid[]; v_new int; v_gone int; v_games int;
  v_pairs_differ boolean := false; v_empty_places int := 0;
begin
  v_format := internal.tournament_plan_format(p_plan_id);
  v_competing := internal.tournament_plan_sides(p_plan_id);
  select count(*) into v_games from public.tournament_games where plan_id = p_plan_id;

  if v_format = 'knockout' then
    select coalesce(array_agg(s.participant_id), '{}') into v_placed
    from public.tournament_bracket_slots s
    where s.plan_id = p_plan_id and s.round_number = 1 and not s.is_third_place and s.participant_id is not null;
    select count(*) into v_empty_places
    from public.tournament_bracket_slots s
    where s.plan_id = p_plan_id and s.round_number = 1 and not s.is_third_place
      and s.participant_id is null and not s.is_bye;
  else
    select coalesce(array_agg(s.participant_id), '{}') into v_placed
    from public.tournament_plan_table_sides s where s.plan_id = p_plan_id;
  end if;

  select count(*) into v_new from unnest(v_competing) c where not (c = any (v_placed));
  select count(*) into v_gone from unnest(v_placed) p where not (p = any (v_competing));
  v_gone := v_gone + v_empty_places;

  -- A SIDE SEATED SINCE GENERATION HAS NO GAMES. Seating reconciles the moment a team joins, so a
  -- table's membership alone cannot say a team is new: the games can. Counted as joined, so the plan
  -- says "1 team has joined since the fixtures were generated" rather than that the tables changed.
  if v_format <> 'knockout' and exists (select 1 from public.tournament_games g where g.plan_id = p_plan_id) then
    v_new := v_new + (
      select count(*) from public.tournament_plan_table_sides s
      where s.plan_id = p_plan_id
        and not exists (select 1 from public.tournament_games g where g.plan_id = p_plan_id and s.participant_id in (g.side_a_id, g.side_b_id))
        and not exists (select 1 from public.tournament_swiss_byes y where y.plan_id = p_plan_id and y.participant_id = s.participant_id));
  end if;

  -- WHETHER THE GENERATED GAMES ARE STILL THE GAMES THIS ARRANGEMENT MAKES.
  if v_games > 0 then
    if v_format = 'knockout' then
      select exists (
        select 1 from public.tournament_games g
        where g.plan_id = p_plan_id and g.round_number = 1
          and not exists (
            select 1 from public.tournament_bracket_slots a
            join public.tournament_bracket_slots b
              on b.plan_id = a.plan_id and b.round_number = 1 and not b.is_third_place
             and b.position = a.position + 1
            where a.plan_id = p_plan_id and a.round_number = 1 and not a.is_third_place and a.position % 2 = 1
              and least(a.participant_id, b.participant_id) = least(g.side_a_id, g.side_b_id)
              and greatest(a.participant_id, b.participant_id) = greatest(g.side_a_id, g.side_b_id)))
      into v_pairs_differ;
    elsif v_format = 'swiss' then
      -- A SWISS IS PAIRED A ROUND AT A TIME, so there is no full set of games to compare. Its fixtures
      -- are out of date when Round 1 (games and bye) no longer holds exactly the table's sides, or the
      -- reserved rounds no longer match the number of rounds chosen.
      select exists (
          (select s.participant_id from public.tournament_plan_table_sides s where s.plan_id = p_plan_id
           except
           select x.p from (
             select g.side_a_id as p from public.tournament_games g where g.plan_id = p_plan_id and g.round_number = 1
             union select g.side_b_id from public.tournament_games g where g.plan_id = p_plan_id and g.round_number = 1
             union select b.participant_id from public.tournament_swiss_byes b where b.plan_id = p_plan_id and b.round_number = 1) x)
          union all
          (select x.p from (
             select g.side_a_id as p from public.tournament_games g where g.plan_id = p_plan_id and g.round_number = 1
             union select g.side_b_id from public.tournament_games g where g.plan_id = p_plan_id and g.round_number = 1
             union select b.participant_id from public.tournament_swiss_byes b where b.plan_id = p_plan_id and b.round_number = 1) x
           except
           select s.participant_id from public.tournament_plan_table_sides s where s.plan_id = p_plan_id))
        or (select coalesce(max(round_number), 0) from public.tournament_bracket_pairings where plan_id = p_plan_id)
           is distinct from internal.tournament_plan_swiss_rounds(p_plan_id)
      into v_pairs_differ;
    else
      select exists (
        (select p.table_id, least(p.side_a_id, p.side_b_id), greatest(p.side_a_id, p.side_b_id)
         from internal.tournament_round_robin_pairs(p_plan_id) p
         except
         select g.table_id, least(g.side_a_id, g.side_b_id), greatest(g.side_a_id, g.side_b_id)
         from public.tournament_games g where g.plan_id = p_plan_id and g.bracket_position is null)
        union all
        (select g.table_id, least(g.side_a_id, g.side_b_id), greatest(g.side_a_id, g.side_b_id)
         from public.tournament_games g where g.plan_id = p_plan_id and g.bracket_position is null
         except
         select p.table_id, least(p.side_a_id, p.side_b_id), greatest(p.side_a_id, p.side_b_id)
         from internal.tournament_round_robin_pairs(p_plan_id) p))
      into v_pairs_differ;
    end if;

    -- A HYBRID'S KNOCKOUT STAGE IS PART OF ITS FIXTURES: one place for every finishing position that
    -- qualifies from every table. A changed qualifier count, or a table added or taken away, means the
    -- knockout stage no longer matches and the fixtures are regenerated.
    if v_format = 'hybrid' and not v_pairs_differ then
      select exists (
        (select t.id, q.n from public.tournament_plan_tables t
           cross join generate_series(1, coalesce((select qualifiers_per_table from public.tournament_plans where id = p_plan_id), 0)) q(n)
          where t.plan_id = p_plan_id
         except
         select b.source_table_id, b.source_game_position from public.tournament_bracket_slots b
          where b.plan_id = p_plan_id and b.source_kind = 'qualifier')
        union all
        (select b.source_table_id, b.source_game_position from public.tournament_bracket_slots b
          where b.plan_id = p_plan_id and b.source_kind = 'qualifier'
         except
         select t.id, q.n from public.tournament_plan_tables t
           cross join generate_series(1, coalesce((select qualifiers_per_table from public.tournament_plans where id = p_plan_id), 0)) q(n)
          where t.plan_id = p_plan_id))
      into v_pairs_differ;
    end if;
  end if;

  return jsonb_build_object(
    'competing', cardinality(v_competing),
    'placed', cardinality(v_placed),
    'newSides', v_new,
    'departedSides', v_gone,
    'games', v_games,
    'fixturesOutOfDate', v_games > 0 and (v_pairs_differ or v_new > 0 or v_gone > 0)
  );
end;
$function$;

create or replace function internal.schedule_bracket_pairings(p_plan_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r record; s record; v_n integer := 0; v_day date;
  v_dur integer; v_change integer;
  v_round integer := 0; v_round_floor timestamp; v_next_floor timestamp; v_end timestamp;
begin
  select coalesce(game_duration_minutes, 20), coalesce(changeover_minutes, 0) into v_dur, v_change
  from public.tournament_plans where id = p_plan_id;

  -- Pairings whose game already has a result keep their place; they are the fixed points of the day.
  update public.tournament_bracket_pairings bp
  set game_date = null, start_time = null, pitch_id = null, updated_at = now()
  where bp.plan_id = p_plan_id
    and not exists (select 1 from public.tournament_games g
                     where g.id = bp.game_id
                       and (g.result_status <> 'none'
                            or exists (select 1 from public.tournament_game_result_submissions x where x.game_id = g.id)));

  -- A HYBRID'S KNOCKOUT STAGE STARTS WHEN ITS GROUP STAGE HAS FINISHED: the latest group game's end,
  -- plus the changeover, is the first round's floor. A knockout has no group games, so no floor; nor
  -- does a Swiss, whose games ARE these places' games, a round at a time.
  select max(g.game_date + g.start_time + make_interval(mins => coalesce(g.duration_minutes, v_dur) + v_change))
  into v_next_floor
  from public.tournament_games g
  where g.plan_id = p_plan_id and g.bracket_position is null and g.start_time is not null
    and internal.tournament_plan_format(p_plan_id) = 'hybrid';

  for r in
    select * from public.tournament_bracket_pairings
    where plan_id = p_plan_id
    order by round_number, is_third_place, game_position
  loop
    -- A NEW ROUND STARTS ONLY WHEN THE ROUND BEFORE IT HAS FINISHED (20270655: rounds do not overlap).
    -- The floor is the latest end of the previous round plus the changeover.
    if r.round_number <> v_round then
      v_round := r.round_number;
      v_round_floor := v_next_floor;
    end if;

    if r.start_time is not null then
      -- a fixed (played) pairing: it still pushes the next round's floor
      v_end := r.game_date + r.start_time + make_interval(mins => v_dur + v_change);
      v_next_floor := greatest(coalesce(v_next_floor, v_end), v_end);
      continue;
    end if;

    select day_date into v_day from public.tournament_plan_round_days
    where plan_id = p_plan_id and round_number = r.round_number;

    select a.* into s
    from internal.tournament_plan_slots(p_plan_id) a
    where (v_day is null or a.slot_day = v_day)
      and (v_round_floor is null or (a.slot_day + a.slot_start) >= v_round_floor)
    order by a.slot_day, a.slot_start,
             (select count(*) from public.tournament_bracket_pairings o
               where o.plan_id = p_plan_id and o.game_date = a.slot_day and o.start_time = a.slot_start
                 and o.pitch_id = a.pitch_id),
             a.ordinal
    limit 1;

    if s.slot_day is null then
      update public.tournament_bracket_pairings
      set game_date = null, start_time = null, pitch_id = null, updated_at = now()
      where id = r.id;
    else
      update public.tournament_bracket_pairings
      set game_date = s.slot_day, start_time = s.slot_start, pitch_id = s.pitch_id, updated_at = now()
      where id = r.id;
      v_end := s.slot_day + s.slot_start + make_interval(mins => v_dur + v_change);
      v_next_floor := greatest(coalesce(v_next_floor, v_end), v_end);
      v_n := v_n + 1;
    end if;
  end loop;

  update public.tournament_games g
  set game_date = coalesce(bp.game_date, g.game_date),
      start_time = bp.start_time, pitch_id = bp.pitch_id,
      duration_minutes = v_dur, updated_at = now()
  from public.tournament_bracket_pairings bp
  where bp.game_id = g.id and bp.plan_id = p_plan_id
    and g.result_status = 'none'
    and not exists (select 1 from public.tournament_game_result_submissions x where x.game_id = g.id);

  return v_n;
end;
$function$;

create or replace function public.generate_tournament_plan_fixtures(p_plan_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan public.tournament_plans;
  v_first_day date;
  v_n int;
  v_format text;
begin
  perform internal.require_live_session();
  select * into v_plan from public.tournament_plans where id = p_plan_id;
  if v_plan.id is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_plan.tournament_id) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;
  if v_plan.publication_state = 'SUPERSEDED' then
    raise exception 'That plan has been replaced.' using errcode = '22023';
  end if;
  v_format := internal.tournament_plan_format(p_plan_id);
  if v_format = 'knockout' then
    raise exception 'A knockout is generated from its draw.' using errcode = '22023';
  end if;

  -- RESULT HISTORY IS NOT A DRAFT, and clearing it is not a planning operation.
  declare v_history record;
  begin
    select * into v_history from internal.tournament_plan_result_history(p_plan_id);
    if v_history.games_with_results > 0 then
      raise exception
        '% game(s) in this plan already have a result (% confirmed, % submission(s) recorded). Regenerating would delete them and everything both sides said about them. Change the days, tables or settings instead, or clear the results deliberately first.',
        v_history.games_with_results, v_history.confirmed, v_history.submissions
        using errcode = '22023', hint = 'TOURNAMENT_PLAN_HAS_RESULTS';
    end if;
  end;

  -- THE SAME ANSWER PLANNING SHOWS. Seating is brought up to date first, so an outdated client cannot
  -- generate against a stale arrangement; then anything that would make the games wrong refuses.
  perform internal.reconcile_tournament_competition_seating(v_plan.tournament_id, v_plan.age_group);
  perform internal.refuse_unless_plan_ready(p_plan_id, 'generate');

  select min(day_date) into v_first_day from public.tournament_plan_days where plan_id = p_plan_id;

  delete from public.tournament_games where plan_id = p_plan_id;
  delete from public.tournament_bracket_pairings where plan_id = p_plan_id;
  delete from public.tournament_swiss_byes where plan_id = p_plan_id;

  -- A SWISS: every round's kick-off times reserved now, Round 1 drawn at random into them, every later
  -- round paired from the table when the one before it is settled.
  if v_format = 'swiss' then
    perform internal.reserve_swiss_rounds(p_plan_id);
    perform internal.schedule_bracket_pairings(p_plan_id);
    v_n := internal.pair_swiss_round(p_plan_id, 1);
    update public.tournament_plans set updated_by = auth.uid(), updated_at = now() where id = p_plan_id;
    perform internal.announce_published_schedule_change(p_plan_id, 'been regenerated');
    return v_n;
  end if;

  insert into public.tournament_games (
    tournament_id, plan_id, table_id, age_group, side_a_id, side_b_id,
    game_date, duration_minutes, status, sort_order, round_number, created_by, updated_by)
  select v_plan.tournament_id, p_plan_id, p.table_id, v_plan.age_group, p.side_a_id, p.side_b_id,
         v_first_day, v_plan.game_duration_minutes, 'SCHEDULED',
         row_number() over (order by p.table_sort, p.round_number, p.pair_in_round),
         p.round_number, auth.uid(), auth.uid()
  from internal.tournament_round_robin_pairs(p_plan_id) p;

  get diagnostics v_n = row_count;

  perform internal.schedule_tournament_plan_games(p_plan_id);

  -- A HYBRID'S KNOCKOUT STAGE: the knockout's own draw, places, pairings and scheduler, with places that
  -- read "1st Table A" until that table is decided.
  if v_format = 'hybrid' then
    perform internal.build_hybrid_bracket(p_plan_id);
    perform internal.create_bracket_pairings(p_plan_id);
    perform internal.schedule_bracket_pairings(p_plan_id);
    perform internal.ensure_third_place_game(p_plan_id);
  end if;

  update public.tournament_plans set updated_by = auth.uid(), updated_at = now() where id = p_plan_id;
  perform internal.announce_published_schedule_change(p_plan_id, 'been regenerated');
  return v_n;
end;
$function$;

create or replace function public.schedule_tournament_plan(p_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_tournament uuid;
begin
  perform internal.require_live_session();
  select tournament_id into v_tournament from public.tournament_plans where id = p_plan_id;
  if v_tournament is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_tournament) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tournament_games where plan_id = p_plan_id)
     and not exists (select 1 from public.tournament_bracket_pairings where plan_id = p_plan_id) then
    raise exception 'Generate the fixtures first.' using errcode = '22023';
  end if;
  if not exists (select 1 from internal.tournament_plan_slots(p_plan_id)) then
    raise exception 'No pitches are reserved inside the playing hours on the playing days, so there is nowhere to put the games. Reserve pitches first.'
      using errcode = '22023', hint = 'TOURNAMENT_PLAN_NO_PITCHES';
  end if;

  if internal.tournament_plan_format(p_plan_id) in ('knockout', 'swiss') then
    perform internal.schedule_bracket_pairings(p_plan_id);
  elsif internal.tournament_plan_format(p_plan_id) = 'hybrid' then
    perform internal.schedule_tournament_plan_games(p_plan_id);
    perform internal.schedule_bracket_pairings(p_plan_id);
  else
    perform internal.schedule_tournament_plan_games(p_plan_id);
  end if;

  update public.tournament_plans set updated_by = auth.uid(), updated_at = now() where id = p_plan_id;
  perform internal.announce_published_schedule_change(p_plan_id, 'been rescheduled');
  return internal.tournament_plan_readiness(p_plan_id);
end;
$function$;

create or replace function internal.tournament_plan_readiness(p_plan_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_plan public.tournament_plans; v_t public.tournaments; v_format text; v_c jsonb;
  v_blockers jsonb := '[]'; v_warnings jsonb := '[]';
  v_days int; v_pitches int; v_times int; v_rounds int; v_small text; v_limit int; v_competing int;
  v_games int; v_untimed int; v_unpitched int; v_misfit int; v_places_untimed int; v_results boolean;
  v_pending int; v_stage text; v_settled int; v_total_places int; v_draw int;
  v_fixtures_out boolean; v_q int; v_short text; v_sr int;
begin
  select * into v_plan from public.tournament_plans where id = p_plan_id;
  if v_plan.id is null then return null; end if;
  select * into v_t from public.tournaments where id = v_plan.tournament_id;
  v_format := internal.tournament_plan_format(p_plan_id);
  v_c := internal.tournament_plan_consistency(p_plan_id);
  v_competing := (v_c ->> 'competing')::int;
  v_games := (v_c ->> 'games')::int;
  v_fixtures_out := (v_c ->> 'fixturesOutOfDate')::boolean;
  v_results := internal.tournament_competition_has_results(v_plan.tournament_id, v_plan.age_group);

  select count(*) into v_days from public.tournament_plan_days where plan_id = p_plan_id;
  select count(*) into v_pitches from public.tournament_pitches tp
  where tp.tournament_id = v_plan.tournament_id
    and tp.reserved_on in (select day_date from public.tournament_plan_days where plan_id = p_plan_id);
  select count(distinct (s.slot_day, s.slot_start)) into v_times from internal.tournament_plan_slots(p_plan_id) s;
  select count(*) into v_pending from public.tournament_participants tp
  where tp.tournament_id = v_plan.tournament_id and tp.age_group = v_plan.age_group and tp.status = 'pending';

  -- STAGE, derived from canonical state rather than kept as a second flag.
  select count(*) filter (where g.result_status in ('final', 'external_recorded')), count(*)
  into v_settled, v_total_places
  from public.tournament_games g where g.plan_id = p_plan_id;
  if v_format = 'knockout' then
    select count(*) into v_total_places from public.tournament_bracket_pairings where plan_id = p_plan_id;
  elsif v_format = 'swiss' then
    -- every round's reserved places, paired or not
    select count(*) into v_total_places from public.tournament_bracket_pairings where plan_id = p_plan_id;
  elsif v_format = 'hybrid' then
    -- the group games, then every knockout place, whether or not its sides are known yet
    select (select count(*) from public.tournament_games where plan_id = p_plan_id and bracket_position is null)
         + (select count(*) from public.tournament_bracket_pairings where plan_id = p_plan_id)
    into v_total_places;
  end if;
  v_stage := case
    when v_games = 0 then 'CONFIGURING'
    when v_plan.publication_state <> 'PUBLISHED' then 'DRAFT_GENERATED'
    when v_settled > 0 and v_settled >= v_total_places then 'COMPLETED'
    when v_results then 'IN_PROGRESS'
    else 'PUBLISHED' end;

  -- ---- what generation needs ---------------------------------------------------------------------
  if v_format in ('swiss', 'hybrid') and not exists (
       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'internal' and p.proname = 'tournament_' || v_format || '_supported') then
    v_blockers := v_blockers || jsonb_build_object('code', 'FORMAT_NOT_AVAILABLE', 'stage', 'generate', 'action', 'none',
      'message', format('%s planning is not available yet, so fixtures cannot be generated for this competition.',
                        case v_format when 'swiss' then 'Swiss' else 'Hybrid' end));
  end if;
  -- A VENUE IS NOT WHAT PUBLICATION NEEDS -- kick-off times are, and those come from pitches reserved
  -- at the host's own grounds. Ovalball allows a tournament without a venue, so it is said, not enforced.
  if v_t.venue_id is null then
    v_warnings := v_warnings || jsonb_build_object('code', 'NO_VENUE', 'action', 'venue',
      'message', 'The tournament has no venue recorded. Choose where it is played so teams know where to go.');
  end if;
  if v_days = 0 then
    v_blockers := v_blockers || jsonb_build_object('code', 'NO_DAYS', 'stage', 'generate', 'action', 'days',
      'message', 'Choose at least one day before generating fixtures.');
  end if;
  if v_competing < 2 then
    v_blockers := v_blockers || jsonb_build_object('code', 'TOO_FEW_TEAMS', 'stage', 'generate', 'action', 'teams',
      'message', format('A competition needs at least two teams. This one has %s.', v_competing));
  end if;
  v_limit := internal.tournament_format_side_limit(v_format);
  if v_limit is not null and v_competing <> v_limit then
    v_blockers := v_blockers || jsonb_build_object('code', 'FIELD_SIZE', 'stage', 'generate', 'action', 'teams',
      'message', format('A Tri-Fixture is exactly %s teams, each playing the other two. This competition has %s.', v_limit, v_competing));
  end if;
  if v_pending > 0 then
    v_warnings := v_warnings || jsonb_build_object('code', 'AWAITING_REPLY', 'action', 'teams',
      'message', format('%s invited %s not replied yet. %s join the plan if %s accept.',
                        v_pending, case when v_pending = 1 then 'team has' else 'teams have' end,
                        case when v_pending = 1 then 'It will' else 'They will' end,
                        case when v_pending = 1 then 'it' else 'they' end));
  end if;

  if v_format = 'knockout' then
    select count(*) into v_draw from public.tournament_bracket_slots
    where plan_id = p_plan_id and round_number = 1 and not is_third_place;
    if v_draw = 0 then
      v_blockers := v_blockers || jsonb_build_object('code', 'NO_DRAW', 'stage', 'generate', 'action', 'draw',
        'message', 'Make the draw before generating the games.');
    elsif (v_c ->> 'newSides')::int > 0 or (v_c ->> 'departedSides')::int > 0 then
      v_blockers := v_blockers || jsonb_build_object('code', 'DRAW_MEMBERSHIP', 'stage', 'generate', 'action', 'draw_update',
        'message', concat_ws(' ',
          case when (v_c ->> 'newSides')::int = 1 then '1 new team is not in the draw yet.'
               when (v_c ->> 'newSides')::int > 1 then (v_c ->> 'newSides') || ' new teams are not in the draw yet.' end,
          case when (v_c ->> 'departedSides')::int = 1 then '1 place in the draw belongs to a team that has left.'
               when (v_c ->> 'departedSides')::int > 1 then (v_c ->> 'departedSides') || ' places in the draw belong to teams that have left.' end,
          'Update the draw to include exactly the teams in this competition.'));
    end if;
  else
    select string_agg(t.name, ', ' order by t.sort_order) into v_small
    from public.tournament_plan_tables t
    where t.plan_id = p_plan_id
      and (select count(*) from public.tournament_plan_table_sides s where s.table_id = t.id) < 2;
    if v_small is not null and v_competing >= 2 then
      v_blockers := v_blockers || jsonb_build_object('code', 'SMALL_TABLE', 'stage', 'generate', 'action', 'tables',
        'message', format('%s needs at least 2 teams to make a game.', v_small));
    end if;

    -- A HYBRID NEEDS TO KNOW WHO GOES THROUGH, and every table has to be bigger than that.
    if v_format = 'hybrid' and v_competing >= 2 then
      select count(*) * coalesce(v_plan.qualifiers_per_table, 0) into v_q
      from public.tournament_plan_tables t where t.plan_id = p_plan_id;
      if v_plan.qualifiers_per_table is null then
        v_blockers := v_blockers || jsonb_build_object('code', 'HYBRID_QUALIFIERS', 'stage', 'generate', 'action', 'qualifiers',
          'message', 'Choose how many teams from each table go through to the knockout stage.');
      else
        select string_agg(t.name, ', ' order by t.sort_order), count(*) into v_short, v_draw
        from public.tournament_plan_tables t
        where t.plan_id = p_plan_id
          and (select count(*) from public.tournament_plan_table_sides s where s.table_id = t.id) <= v_plan.qualifiers_per_table;
        if v_short is not null then
          v_blockers := v_blockers || jsonb_build_object('code', 'HYBRID_QUALIFIERS', 'stage', 'generate', 'action', 'qualifiers',
            'message', format('%s from each table %s through, so every table needs at least %s teams. %s %s not.',
              v_plan.qualifiers_per_table, case when v_plan.qualifiers_per_table = 1 then 'goes' else 'go' end,
              v_plan.qualifiers_per_table + 1, v_short, case when v_draw = 1 then 'does' else 'do' end));
        elsif v_q < 2 then
          v_blockers := v_blockers || jsonb_build_object('code', 'HYBRID_QUALIFIERS', 'stage', 'generate', 'action', 'qualifiers',
            'message', 'A knockout stage needs at least two teams. With one table, choose at least two to go through.');
        end if;
      end if;
    end if;
    -- How many kick-off times the arrangement needs: a table of n plays n-1 rounds (n when odd).
    select coalesce(max(case when n % 2 = 0 then n - 1 else n end), 0) into v_rounds
    from (select count(*)::int as n from public.tournament_plan_table_sides s where s.plan_id = p_plan_id group by s.table_id) x
    where n >= 2;
    -- A SWISS IS ONE TABLE, PLAYED IN A CHOSEN NUMBER OF ROUNDS, and no pair may meet twice.
    if v_format = 'swiss' and v_competing >= 2 then
      v_sr := internal.tournament_plan_swiss_rounds(p_plan_id);
      if (select count(*) from public.tournament_plan_tables t where t.plan_id = p_plan_id) > 1 then
        v_blockers := v_blockers || jsonb_build_object('code', 'SWISS_ONE_TABLE', 'stage', 'generate', 'action', 'tables',
          'message', 'A Swiss competition ranks every team in one table. Put all the teams in one table.');
      end if;
      if v_sr is null then
        v_blockers := v_blockers || jsonb_build_object('code', 'SWISS_ROUNDS', 'stage', 'generate', 'action', 'rounds',
          'message', 'Choose how many rounds this Swiss competition plays.');
      elsif v_sr > internal.swiss_round_limit(v_competing) then
        v_blockers := v_blockers || jsonb_build_object('code', 'SWISS_ROUNDS', 'stage', 'generate', 'action', 'rounds',
          'message', format('%s teams can play at most %s Swiss rounds without two teams meeting twice. Choose fewer rounds, or add teams.',
                            v_competing, internal.swiss_round_limit(v_competing)));
      end if;
      -- each round needs its own kick-off time
      v_rounds := coalesce(v_sr, 0);
    end if;
    -- and a hybrid's knockout stage needs a kick-off time for each of its rounds after that
    if v_format = 'hybrid' and coalesce(v_q, 0) >= 2 then
      v_rounds := v_rounds + internal.bracket_rounds(internal.bracket_size(v_q));
    end if;
    if v_pitches > 0 and v_rounds > v_times then
      v_blockers := v_blockers || jsonb_build_object('code', 'CAPACITY', 'stage', 'generate', 'action', 'schedule_settings',
        'message', format('%s rounds need %s kick-off times, but the selected days and reserved pitches provide %s. Widen the playing hours, shorten the games, or add another day.',
                          v_rounds, v_rounds, v_times));
    end if;
  end if;

  if v_pitches = 0 and v_days > 0 then
    v_warnings := v_warnings || jsonb_build_object('code', 'NO_PITCHES', 'action', 'pitches',
      'message', 'No pitches are reserved on the playing days, so games can be paired but not given kick-off times. Reserve pitches to schedule them.');
  end if;
  -- A DAY THE ORGANISER CHOSE, AND RESERVED A PITCH FOR, ON WHICH NO GAME FITS -- the scheduler's own
  -- refusal, said before Generate rather than by it.
  select string_agg(to_char(d.day_date, 'FMDay FMDD Mon'), ', ' order by d.day_date) into v_small
  from public.tournament_plan_days d
  where d.plan_id = p_plan_id
    and exists (select 1 from public.tournament_pitches tp where tp.tournament_id = v_plan.tournament_id and tp.reserved_on = d.day_date)
    and not exists (select 1 from internal.tournament_plan_slots(p_plan_id) x where x.slot_day = d.day_date);
  if v_small is not null then
    v_blockers := v_blockers || jsonb_build_object('code', 'NO_PLAYING_WINDOW', 'stage', 'generate', 'action', 'schedule_settings',
      'message', format('Pitches are reserved on %s but no game can be played then: the playing hours are %s-%s and the reservations fall outside them. Widen the playing hours, or change the reservation.',
                        v_small, to_char(v_plan.day_start_time, 'HH24:MI'), to_char(v_plan.day_end_time, 'HH24:MI')));
  end if;

  -- ---- what publication needs --------------------------------------------------------------------
  if v_games = 0 then
    v_blockers := v_blockers || jsonb_build_object('code', 'NO_GAMES', 'stage', 'publish', 'action', 'generate',
      'message', 'Generate the fixtures first.');
  else
    if v_fixtures_out then
      v_blockers := v_blockers || jsonb_build_object('code', 'FIXTURES_OUT_OF_DATE', 'stage', 'publish',
        'action', case when v_results then 'none' when v_format = 'knockout' and ((v_c ->> 'newSides')::int > 0 or (v_c ->> 'departedSides')::int > 0) then 'draw_update' else 'regenerate' end,
        'message', concat_ws(' ',
          case when (v_c ->> 'newSides')::int = 1 then '1 team has joined since the fixtures were generated.'
               when (v_c ->> 'newSides')::int > 1 then (v_c ->> 'newSides') || ' teams have joined since the fixtures were generated.' end,
          case when (v_c ->> 'departedSides')::int >= 1 then 'A team has left since the fixtures were generated.' end,
          case when (v_c ->> 'newSides')::int = 0 and (v_c ->> 'departedSides')::int = 0
               then 'The tables or the draw have changed since the fixtures were generated.' end,
          'Regenerate the fixtures so every team plays the right games.'));
    end if;

    select count(*) filter (where g.start_time is null),
           count(*) filter (where g.start_time is not null and g.pitch_id is null),
           count(*) filter (where g.start_time is not null and g.result_status = 'none'
                              and (not exists (select 1 from public.tournament_plan_days d where d.plan_id = p_plan_id and d.day_date = g.game_date)
                                   or g.start_time < v_plan.day_start_time
                                   or g.start_time + make_interval(mins => coalesce(g.duration_minutes, v_plan.game_duration_minutes)) > v_plan.day_end_time))
    into v_untimed, v_unpitched, v_misfit
    from public.tournament_games g where g.plan_id = p_plan_id;

    if v_format in ('knockout', 'hybrid', 'swiss') then
      select count(*) into v_places_untimed from public.tournament_bracket_pairings bp
      where bp.plan_id = p_plan_id and bp.start_time is null and bp.game_id is null;
    else
      v_places_untimed := 0;
    end if;

    if v_untimed + v_places_untimed > 0 then
      v_blockers := v_blockers || jsonb_build_object('code', 'UNSCHEDULED', 'stage', 'publish',
        'action', case when v_pitches = 0 then 'pitches' else 'schedule' end,
        'count', v_untimed + v_places_untimed,
        'message', format('%s of %s %s no kick-off time yet. %s',
          v_untimed + v_places_untimed, v_games + v_places_untimed,
          case when v_untimed + v_places_untimed = 1 then 'game has' else 'games have' end,
          case when v_pitches = 0 then 'Reserve pitches for the playing days, then schedule the games.'
               else 'Schedule the games into the reserved pitches, or set their times by hand.' end));
    end if;
    if v_misfit > 0 then
      v_blockers := v_blockers || jsonb_build_object('code', 'SCHEDULE_OUT_OF_DATE', 'stage', 'publish', 'action', 'schedule',
        'count', v_misfit,
        'message', format('%s %s outside the playing days or hours set for this competition. Schedule the games again.',
                          v_misfit, case when v_misfit = 1 then 'game falls' else 'games fall' end));
    end if;
    if v_unpitched > 0 then
      v_warnings := v_warnings || jsonb_build_object('code', 'NO_PITCH', 'action', 'schedule', 'count', v_unpitched,
        'message', format('%s %s a kick-off time but no pitch.', v_unpitched, case when v_unpitched = 1 then 'game has' else 'games have' end));
    end if;
  end if;

  return jsonb_build_object(
    'stage', v_stage,
    'format', v_format,
    'publicationState', v_plan.publication_state,
    'hasResults', v_results,
    'consistency', v_c,
    'gameCount', v_games,
    'readyToGenerate', not v_results and not exists (
      select 1 from jsonb_array_elements(v_blockers) b where b ->> 'stage' = 'generate'),
    'readyToPublish', v_plan.publication_state = 'DRAFT' and jsonb_array_length(v_blockers) = 0,
    'canRegenerate', v_games > 0 and not v_results,
    'canSchedule', v_games > 0 and v_pitches > 0,
    'blockers', v_blockers,
    'warnings', v_warnings
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_tournament_plan(p_tournament_id uuid, p_age_group text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_t public.tournaments;
  v_plan public.tournament_plans;
  v_defaults record;
begin
  perform internal.require_live_session();
  select * into v_t from public.tournaments where id = p_tournament_id;
  if v_t.id is null then return null; end if;
  if not internal.can_manage_tournament(p_tournament_id) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;

  select * into v_plan from public.tournament_plans
  where tournament_id = p_tournament_id and age_group = p_age_group and publication_state <> 'SUPERSEDED';

  select * into v_defaults from internal.tournament_plan_defaults(p_tournament_id, p_age_group);

  return jsonb_build_object(
    'tournamentId', v_t.id,
    'tournamentName', v_t.name,
    'ageGroup', p_age_group,
    'format', coalesce(v_plan.format, v_t.format),
    -- THE PLAN'S OWN ROUND COUNT where the organiser has changed it in Planning (20270725).
    'swissRounds', coalesce(v_plan.swiss_rounds, v_t.swiss_rounds),
    'venueName', (select v.name from public.venues v where v.id = v_t.venue_id),
    -- THE TOURNAMENT'S OWN RANGE, which planning selects from and never changes.
    'tournamentStartsOn', v_t.event_date,
    'tournamentEndsOn', coalesce(v_t.ends_on, v_t.event_date),
    -- Every competition this tournament runs, so the Planning header can offer the age-group context.
    'ageGroups', coalesce((select jsonb_agg(g.age_group order by g.age_group)
                           from public.tournament_age_groups g where g.tournament_id = p_tournament_id), '[]'::jsonb),

    -- THE SIDES THIS COMPETITION HAS. Planning operates on these ids and never on a club's name; a
    -- club Ovalball does not have is a side here exactly like any other.
    -- WHICH SCORING RULES CAN ACTUALLY BE APPLIED, and why not where they cannot. Planning draws
    -- its controls from this rather than deciding on the device.
    'scoringRules', case when v_plan.id is not null then internal.tournament_scoring_rules(v_plan.id) end,
    'losingBonusMargin', v_plan.losing_bonus_margin,
    'tieBreakers', to_jsonb(v_plan.tie_breakers),
    'sides', coalesce((
      -- ONE DEFINITION OF A PARTICIPATING SIDE, shared with the participant Centre and with
      -- Results. `onOvalball` asks whether anybody could actually answer for this side, which is
      -- the question every surface downstream needs and the one the old inline test got wrong.
      select jsonb_agg(internal.tournament_side_summary(tp.id, v_t.host_club_id)
        || jsonb_build_object('status', tp.status, 'competes', internal.tournament_side_competes(tp.status))
      order by (tp.club_id is not null and tp.club_id = v_t.host_club_id) desc, cd.name, tp.id)
      from public.tournament_participants tp
      join public.club_directory cd on cd.id = tp.club_directory_id
      left join public.teams tm on tm.id = tp.team_id
      where tp.tournament_id = p_tournament_id and tp.age_group = p_age_group
    ), '[]'::jsonb),

    -- WHAT THE DEFAULTS WOULD BE, and where they come from, so Settings can say so rather than
    -- presenting a number nobody chose.
    'defaults', jsonb_build_object(
      'gameDurationMinutes', v_defaults.game_duration_minutes,
      'changeoverMinutes', v_defaults.changeover_minutes,
      'dayStartTime', v_defaults.day_start_time,
      'dayEndTime', v_defaults.day_end_time,
      'durationSource', v_defaults.duration_source),

    'pitchesReserved', (select count(*) from public.tournament_pitches where tournament_id = p_tournament_id),

    'plan', case when v_plan.id is null then null else jsonb_build_object(
      'id', v_plan.id,
      'publicationState', v_plan.publication_state,
      'version', v_plan.version,
      'publishedAt', v_plan.published_at,
      'gameDurationMinutes', v_plan.game_duration_minutes,
      'changeoverMinutes', v_plan.changeover_minutes,
      'dayStartTime', v_plan.day_start_time,
      'dayEndTime', v_plan.day_end_time,
      'pointsWin', v_plan.points_win,
      'pointsDraw', v_plan.points_draw,
      'pointsLoss', v_plan.points_loss,
      'pointsTryBonus', v_plan.points_try_bonus,
      'pointsLosingBonus', v_plan.points_losing_bonus,
      'days', coalesce((select jsonb_agg(d.day_date order by d.day_date)
                        from public.tournament_plan_days d where d.plan_id = v_plan.id), '[]'::jsonb),
      'tables', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id, 'name', t.name, 'sortOrder', t.sort_order,
          'sides', coalesce((select jsonb_agg(s.participant_id order by s.position)
                             from public.tournament_plan_table_sides s where s.table_id = t.id), '[]'::jsonb)
        ) order by t.sort_order)
        from public.tournament_plan_tables t where t.plan_id = v_plan.id), '[]'::jsonb),
      'gameCount', (select count(*) from public.tournament_games where plan_id = v_plan.id),

      -- THE KNOCKOUT SETTINGS THE PLAN ALREADY HOLDS. Planning's Settings step is a set of controls
      -- over these columns, so it has to be able to read them: a step that opens at its defaults every
      -- time does not merely display the wrong thing, it writes the wrong thing back the moment the
      -- organiser presses Generate, quietly discarding the extra time, the tie resolution, the
      -- play-off and the round days somebody chose earlier.
      'drawMethod', v_plan.draw_method,
      'tieResolution', v_plan.tie_resolution,
      'extraTimeMinutes', v_plan.extra_time_minutes,
      'thirdPlacePlayoff', v_plan.third_place_playoff,
      -- A HYBRID'S SEAM: how many from each table go through to the knockout stage.
      'qualifiersPerTable', v_plan.qualifiers_per_table,
      'roundDays', coalesce((select jsonb_agg(jsonb_build_object('round', r.round_number, 'day', r.day_date)
                                              order by r.round_number)
                             from public.tournament_plan_round_days r where r.plan_id = v_plan.id), '[]'::jsonb),

      -- WHETHER THIS COMPETITION KEEPS A TABLE, resolved by the one authority rather than inferred from
      -- the format by each surface in turn. A Tri-Fixture is three sides sharing a morning until the
      -- organiser says it is a competition; a Round Robin has always kept one.
      'standingsEnabled', internal.tournament_plan_has_standings(v_plan.id),
      -- What the organiser has actually chosen, as opposed to what the format does by default. NULL is
      -- "not asked yet", which is a different thing from "no" and is why the control can show it.
      'standingsChoice', v_plan.standings_enabled,
      -- How many sides this format allows, where it constrains its field at all. The Teams step says so
      -- before the organiser builds something that will be refused.
      'fieldSize', internal.tournament_format_side_limit(coalesce(v_plan.format, v_t.format)),
      -- WHAT THE PLAN NEEDS NEXT, and why: the same answer Generate and Publish enforce.
      'readiness', internal.tournament_plan_readiness(v_plan.id)
    ) end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_tournament_plan_draft(p_tournament_id uuid, p_age_group text, p_preview boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_t public.tournaments;
  v_plan public.tournament_plans;
  v_tables jsonb;
begin
  perform internal.require_live_session();

  select * into v_t from public.tournaments where id = p_tournament_id;
  if v_t.id is null then return null; end if;
  if not internal.can_manage_tournament(p_tournament_id) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;

  select * into v_plan from public.tournament_plans
  where tournament_id = p_tournament_id and age_group = p_age_group and publication_state <> 'SUPERSEDED';

  if v_plan.id is null then
    return jsonb_build_object(
      'tournamentId', v_t.id, 'tournamentName', v_t.name, 'ageGroup', p_age_group,
      'format', coalesce(v_plan.format, v_t.format),
      'preview', p_preview, 'plan', null, 'tables', '[]'::jsonb);
  end if;

  -- ONE TABLE AT A TIME: who is in it, then its rounds, then the games in each round. The ordering is
  -- the competition's own -- table order, round number, then the pair's place in the round -- so two
  -- organisers reading the same draft read it in the same order.
  select coalesce(jsonb_agg(x.table_json order by x.sort_order, x.table_name), '[]'::jsonb)
  into v_tables
  from (
    select
      t.sort_order,
      t.name as table_name,
      jsonb_build_object(
        'id', t.id,
        'name', t.name,
        -- THE TABLE'S MEMBERSHIP, so a round's pairings can be read against who is in the table.
        'sides', coalesce((
          select jsonb_agg(jsonb_build_object(
            'participantId', tp.id,
            'clubName', cd.name,
            'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = tp.club_id), cd.logo_storage_path),
            'label', coalesce(tm.display_name,
                              case when tp.squad_label is not null then tp.age_group || ' ' || tp.squad_label else tp.age_group end),
            'isHost', (tp.club_id is not null and tp.club_id = v_t.host_club_id)
          ) order by s.position)
          from public.tournament_plan_table_sides s
          join public.tournament_participants tp on tp.id = s.participant_id
          join public.club_directory cd on cd.id = tp.club_directory_id
          left join public.teams tm on tm.id = tp.team_id
          where s.table_id = t.id), '[]'::jsonb),
        'rounds', coalesce((
          select jsonb_agg(r.round_json order by r.round_number)
          from (
            select
              g.round_number,
              jsonb_build_object(
                'round', g.round_number,
                'games', jsonb_agg(g.game_json order by g.sort_order)
              ) as round_json
            from (
              -- THE REAL ROWS, or the pairs a generation would make. Same columns either way.
              select
                coalesce(gm.round_number, 1) as round_number,
                gm.sort_order,
                jsonb_build_object(
                  'id', gm.id,
                  'round', gm.round_number,
                  'date', gm.game_date,
                  -- NULL IS THE ANSWER WHEN NOTHING HAS BEEN DECIDED, and the screen says so in words.
                  'startTime', gm.start_time,
                  'durationMinutes', gm.duration_minutes,
                  'pitchName', (select cp.display_name from public.club_pitches cp where cp.id = gm.pitch_id),
                  'sideA', jsonb_build_object(
                    'participantId', a.id, 'clubName', cda.name,
                    'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = a.club_id), cda.logo_storage_path),
                    'label', coalesce(ta.display_name,
                                      case when a.squad_label is not null then a.age_group || ' ' || a.squad_label else a.age_group end)),
                  'sideB', jsonb_build_object(
                    'participantId', b.id, 'clubName', cdb.name,
                    'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = b.club_id), cdb.logo_storage_path),
                    'label', coalesce(tb.display_name,
                                      case when b.squad_label is not null then b.age_group || ' ' || b.squad_label else b.age_group end))
                ) as game_json,
                gm.table_id
              from (
                select g2.id, g2.round_number, g2.sort_order, g2.game_date, g2.start_time,
                       g2.duration_minutes, g2.pitch_id, g2.side_a_id, g2.side_b_id, g2.table_id
                from public.tournament_games g2
                where not p_preview and g2.plan_id = v_plan.id
                union all
                select null::uuid, p.round_number,
                       (p.table_sort * 10000 + p.round_number * 100 + p.pair_in_round)::int,
                       null::date, null::time, null::int, null::uuid,
                       p.side_a_id, p.side_b_id, p.table_id
                from internal.tournament_round_robin_pairs(v_plan.id) p
                where p_preview
              ) gm
              join public.tournament_participants a on a.id = gm.side_a_id
              join public.tournament_participants b on b.id = gm.side_b_id
              join public.club_directory cda on cda.id = a.club_directory_id
              join public.club_directory cdb on cdb.id = b.club_directory_id
              left join public.teams ta on ta.id = a.team_id
              left join public.teams tb on tb.id = b.team_id
            ) g
            where g.table_id = t.id
            group by g.round_number
          ) r), '[]'::jsonb)
      ) as table_json
    from public.tournament_plan_tables t
    where t.plan_id = v_plan.id
  ) x;

  return jsonb_build_object(
    'tournamentId', v_t.id,
    'tournamentName', v_t.name,
    'ageGroup', p_age_group,
    'venueName', (select v.name from public.venues v where v.id = v_t.venue_id),
    -- WHICH SHAPE OF COMPETITION THIS DRAFT IS. The draft screen is one screen, and a knockout's games
    -- carry no table, so without this it reads a knockout as an empty round robin and tells the
    -- organiser to go and set up tables that a knockout does not have.
    'format', coalesce(v_plan.format, v_t.format),
    'preview', p_preview,
    'plan', jsonb_build_object(
      'id', v_plan.id,
      'publicationState', v_plan.publication_state,
      'version', v_plan.version,
      'publishedAt', v_plan.published_at,
      'gameDurationMinutes', v_plan.game_duration_minutes,
      'days', coalesce((select jsonb_agg(d.day_date order by d.day_date)
                        from public.tournament_plan_days d where d.plan_id = v_plan.id), '[]'::jsonb),
      -- WHAT ACTUALLY EXISTS, counted at the source rather than summed on the phone.
      'gameCount', (select count(*) from public.tournament_games where plan_id = v_plan.id),
      'scheduledCount', (select count(*) from public.tournament_games
                         where plan_id = v_plan.id and start_time is not null),
      'pitchedCount', (select count(*) from public.tournament_games
                       where plan_id = v_plan.id and pitch_id is not null),
      'readiness', internal.tournament_plan_readiness(v_plan.id)
    ),
    'tables', coalesce(v_tables, '[]'::jsonb),
    -- PLACES BOOKED BUT NOT YET PAIRED: a Swiss round's kick-off times, reserved at Generate (20270725).
    'upcomingRounds', coalesce((
      select jsonb_agg(jsonb_build_object('round', x.round_number, 'date', x.game_date, 'startTime', x.start_time,
                                          'pitchName', x.pitch_name, 'places', x.places) order by x.round_number)
      from (
        select bp.round_number, min(bp.game_date) as game_date, min(bp.start_time) as start_time,
               min((select cp.display_name from public.club_pitches cp where cp.id = bp.pitch_id)) as pitch_name,
               count(*) as places
        from public.tournament_bracket_pairings bp
        where bp.plan_id = v_plan.id and bp.game_id is null and not p_preview
          and internal.tournament_plan_format(v_plan.id) = 'swiss'
          and not exists (select 1 from public.tournament_games g where g.plan_id = v_plan.id and g.round_number = bp.round_number)
        group by bp.round_number) x), '[]'::jsonb),
    -- WHO SITS OUT A SWISS ROUND, and is awarded a win for it.
    'byes', coalesce((
      select jsonb_agg(jsonb_build_object('round', b.round_number, 'participantId', b.participant_id, 'clubName', cd.name)
                       order by b.round_number)
      from public.tournament_swiss_byes b
      join public.tournament_participants tp on tp.id = b.participant_id
      join public.club_directory cd on cd.id = tp.club_directory_id
      where b.plan_id = v_plan.id and not p_preview), '[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_tournament_participant_centre(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_t public.tournaments;
  v_can_manage boolean;
  v_contexts jsonb;
  v_mine uuid[];
  v_grades text[];
begin
  if not internal.session_ok() then
    raise exception 'Your session is not able to read this. Sign in again.' using errcode = '42501';
  end if;

  select * into v_t from public.tournaments where id = p_tournament_id;
  if v_t.id is null then
    return null;
  end if;

  -- The same rule every other tournament read uses. A viewer who cannot see the tournament gets
  -- nothing -- deliberately the same answer as one that does not exist, because the difference is not
  -- ours to reveal.
  if not internal.tournament_visible_row(p_tournament_id) then
    return null;
  end if;

  v_can_manage := internal.can('tournament.tournament.manage', 'club', v_t.host_club_id, null, null);

  -- ---- THE SIDES THIS VIEWER IS PART OF ------------------------------------------------------------
  --
  -- "Part of" is the connection, not the tournament. It is what decides which age-group contexts
  -- appear, and which sides may show their full attendance breakdown.
  select coalesce(array_agg(distinct tp.id), '{}') into v_mine
  from public.tournament_participants tp
  where tp.tournament_id = p_tournament_id
    and (
      -- the viewer's own club
      (tp.club_id is not null and internal.can('tournament.tournament.view', 'club', tp.club_id, null, null))
      -- the entered team's own staff
      or (tp.team_id is not null and tp.club_id is not null
          and internal.can('tournament.tournament.view', 'team', tp.club_id, tp.team_id, null))
      -- the family of a player in the entered team
      or (tp.team_id is not null and exists (
            select 1 from public.player_team_memberships ptm
            where ptm.team_id = tp.team_id and ptm.status = 'active'
              and (internal.is_own_linked_player(ptm.player_id) or internal.is_active_player_guardian(ptm.player_id))
          ))
    );

  -- The grades those sides play in, in the tournament's own order. A host with management authority
  -- gets every grade the tournament runs, because the whole field is legitimately theirs.
  if v_can_manage then
    select coalesce(array_agg(g.age_group order by g.age_group), '{}') into v_grades
    from public.tournament_age_groups g where g.tournament_id = p_tournament_id;
  else
    select coalesce(array_agg(distinct tp.age_group), '{}') into v_grades
    from public.tournament_participants tp
    where tp.tournament_id = p_tournament_id and tp.id = any(v_mine);
  end if;

  -- ---- ONE CONTEXT PER AGE GROUP -------------------------------------------------------------------
  select coalesce(jsonb_agg(ctx order by ctx->>'ageGroup'), '[]'::jsonb) into v_contexts
  from (
    select jsonb_build_object(
      'ageGroup', grade,
      -- CAN THIS VIEWER RECORD A RESULT for one of this competition''s sides. The same
      -- capability the submit path enforces, so a Results tab can never appear for somebody the
      -- write would refuse -- and a parent is never shown an action list that is empty by design.
      'canRecordResults', exists (
        select 1 from public.tournament_participants rp
        where rp.tournament_id = p_tournament_id and rp.age_group = grade
          and rp.club_id is not null
          and (internal.can('fixture.result.record', 'club', rp.club_id, null, null)
               or (rp.team_id is not null
                   and internal.can('fixture.result.record', 'team', rp.club_id, rp.team_id, null)))
      ),

      -- EVERY SIDE IN THIS COMPETITION, and only this competition. A U12 context never lists the U16
      -- field: telling a U12 parent which clubs are in the U16 competition is describing a different
      -- day's rugby.
      'sides', coalesce((
        -- THE SHARED SIDE, plus only what is genuinely this surface''s own: which team a club is
        -- bringing, and whether the side is one of the viewer''s. An organiser reading the whole
        -- field has no use for either.
        select jsonb_agg(
          internal.tournament_side_summary(tp.id, v_t.host_club_id)
          || jsonb_build_object('teamId', tp.team_id, 'isMine', (tp.id = any(v_mine)))
        order by (tp.club_id is not null and tp.club_id = v_t.host_club_id) desc, cd.name, tp.id)
        from public.tournament_participants tp
        join public.club_directory cd on cd.id = tp.club_directory_id
        left join public.teams tm on tm.id = tp.team_id
        where tp.tournament_id = p_tournament_id and tp.age_group = grade
      ), '[]'::jsonb),

      -- ---- ATTENDANCE, FILTERED BEFORE IT IS SENT ------------------------------------------------
      --
      -- `attending` for everybody, because that is the number the day is organised around. Everything
      -- else only for a side this viewer is part of. A side with no Ovalball team behind it has no
      -- roster to count and reports nothing rather than zero -- "0 attending" would read as a club
      -- that answered, when the truth is that there is nobody here to ask.
      'attendance', coalesce((
        select jsonb_agg(jsonb_build_object(
          'participantId', tp.id,
          'clubName', cd.name,
          'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = tp.club_id), cd.logo_storage_path),
          'label', coalesce(tm.display_name, case when tp.squad_label is not null then tp.age_group || ' ' || tp.squad_label else tp.age_group end),
          'isMine', (tp.id = any(v_mine)),
          'attending', case when tp.team_id is null then null else (
            select count(*) from public.player_fixture_attendance a
            join public.player_team_memberships m on m.player_id = a.player_id and m.team_id = tp.team_id and m.status = 'active'
            where a.tournament_id = p_tournament_id and a.status = 'ATTENDING') end,
          'unsure', case when tp.id = any(v_mine) and tp.team_id is not null then (
            select count(*) from public.player_fixture_attendance a
            join public.player_team_memberships m on m.player_id = a.player_id and m.team_id = tp.team_id and m.status = 'active'
            where a.tournament_id = p_tournament_id and a.status = 'UNSURE') end,
          'cannotAttend', case when tp.id = any(v_mine) and tp.team_id is not null then (
            select count(*) from public.player_fixture_attendance a
            join public.player_team_memberships m on m.player_id = a.player_id and m.team_id = tp.team_id and m.status = 'active'
            where a.tournament_id = p_tournament_id and a.status = 'CANNOT_ATTEND') end,
          'awaiting', case when tp.id = any(v_mine) and tp.team_id is not null then (
            select count(*) from public.player_team_memberships m
            where m.team_id = tp.team_id and m.status = 'active'
              and not exists (select 1 from public.player_fixture_attendance a
                              where a.tournament_id = p_tournament_id and a.player_id = m.player_id)) end
        ) order by (tp.id = any(v_mine)) desc, cd.name, tp.id)
        from public.tournament_participants tp
        join public.club_directory cd on cd.id = tp.club_directory_id
        left join public.teams tm on tm.id = tp.team_id
        where tp.tournament_id = p_tournament_id and tp.age_group = grade
      ), '[]'::jsonb),

      -- ---- THE PUBLISHED PROGRAMME ---------------------------------------------------------------
      --
      -- Read straight from what planning writes. An empty array means nothing has been published, and
      -- the screen says so in words rather than drawing an empty table or inventing a game.
      -- WHETHER THIS COMPETITION KEEPS A TABLE. The Tournament Centre's tabs ask this rather than the
      -- format, so a Tri-Fixture that is three sides sharing a morning does not get a Tables tab that
      -- can only ever be empty -- the same rule that keeps a knockout from getting one.
      'keepsStandings', coalesce((
        select bool_or(internal.tournament_plan_has_standings(pl.id))
        from public.tournament_plans pl
        where pl.tournament_id = p_tournament_id and pl.age_group = grade
          and pl.publication_state = 'PUBLISHED'), false),
      'competitionDays', coalesce((
        select jsonb_agg(d.day_date order by d.day_date)
        from public.tournament_plan_days d
        join public.tournament_plans pl on pl.id = d.plan_id
        where pl.tournament_id = p_tournament_id and pl.age_group = grade
          and pl.publication_state = 'PUBLISHED'), '[]'::jsonb),
      'games', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', g.id,
          'gameDate', g.game_date,
          'startTime', g.start_time,
          'durationMinutes', g.duration_minutes,
          'pitchName', cp.display_name,
          'status', g.status,
          -- WHERE THIS GAME SITS IN THE COMPETITION. Null for a game somebody added by hand,
          -- which belongs to no table and no round and must not be given one.
          'tableName', pt.name,
          'round', g.round_number,
          -- WHAT A KNOCKOUT CALLS THIS GAME -- "Quarter Final", "Final", "Third-Place Play-Off" --
          -- from the bracket's own naming authority. Null on a round robin, which reads as a table
          -- and a round. A parent at a cup is told what everybody at the ground will call the game.
          'roundName', case when g.table_id is null then internal.tournament_game_round_label(g.plan_id, g.round_number, g.is_third_place) end,
          'stageLabel', internal.tournament_game_stage_label(g.plan_id, g.round_number, g.is_third_place, g.table_id),
          'countsToTable', coalesce(internal.tournament_plan_has_standings(g.plan_id), false) and g.bracket_position is null,
          'sideA', jsonb_build_object('participantId', a.id, 'clubName', acd.name, 'label', coalesce(atm.display_name, a.age_group),
                                      'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = a.club_id), acd.logo_storage_path),
                                      'score', g.side_a_score, 'isMine', (a.id = any(v_mine))),
          'sideB', jsonb_build_object('participantId', b.id, 'clubName', bcd.name, 'label', coalesce(btm.display_name, b.age_group),
                                      'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = b.club_id), bcd.logo_storage_path),
                                      'score', g.side_b_score, 'isMine', (b.id = any(v_mine)))
        ) order by g.game_date, pt.sort_order nulls first, g.round_number nulls first, g.start_time nulls last, g.sort_order)
        from public.tournament_games g
        join public.tournament_participants a on a.id = g.side_a_id
        join public.tournament_participants b on b.id = g.side_b_id
        join public.club_directory acd on acd.id = a.club_directory_id
        join public.club_directory bcd on bcd.id = b.club_directory_id
        left join public.teams atm on atm.id = a.team_id
        left join public.teams btm on btm.id = b.team_id
        left join public.club_pitches cp on cp.id = g.pitch_id
        left join public.tournament_plan_tables pt on pt.id = g.table_id
        where g.tournament_id = p_tournament_id and g.age_group = grade
          -- A GENERATED GAME IS THE ORGANISER'S WORKINGS UNTIL THEY PUBLISH IT. A game with no
          -- plan behind it is one somebody added by hand, which was always visible and stays so.
          and (g.plan_id is null or exists (select 1 from public.tournament_plans pl
                                            where pl.id = g.plan_id and pl.publication_state = 'PUBLISHED'))
      ), '[]'::jsonb),

      -- ---- THE KNOCKOUT'S SCHEDULED PLACES, WHICH ARE NOT YET GAMES ------------------------------
      --
      -- An organiser schedules a semi-final for three o'clock before anybody has qualified for it. A
      -- parent planning their Sunday needs to know that; "Winner QF1 v Winner QF2, 15:00, Pitch 1" is
      -- a true and useful sentence, and the one the draw already prints.
      --
      -- It is a READ PROJECTION OF THE PLAN, not a game. No `tournament_games` row is created to give
      -- the Agenda something to render -- a game has two real sides by definition, and inventing one
      -- would put a fixture against nobody into Results, the Draw and every count of what was played.
      -- The moment both sides resolve, `internal.create_bracket_game` materialises the canonical game
      -- and it disappears from here, because it is then carried by `games` like everything else.
      --
      -- Published plans only, by the same rule the games follow: a draft is the organiser's workings.
      'pairings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'pairingId', bp.id,
          'gameDate', bp.game_date,
          'startTime', bp.start_time,
          'pitchName', (select cp2.display_name from public.club_pitches cp2 where cp2.id = bp.pitch_id),
          'roundName', internal.tournament_game_round_label(bp.plan_id, bp.round_number, bp.is_third_place),
          'stageLabel', internal.tournament_game_stage_label(bp.plan_id, bp.round_number, bp.is_third_place, null::uuid),
          'countsToTable', false,
          'sideALabel', internal.bracket_slot_label(sa.id),
          'sideBLabel', internal.bracket_slot_label(sb.id)
        ) order by bp.game_date, bp.start_time nulls last, bp.round_number, bp.game_position)
        from public.tournament_bracket_pairings bp
        join public.tournament_plans pl on pl.id = bp.plan_id
        left join public.tournament_bracket_slots sa
          on sa.plan_id = bp.plan_id and sa.round_number = bp.round_number
             and sa.is_third_place = bp.is_third_place
             and sa.position = case when bp.is_third_place then 1 else bp.game_position * 2 - 1 end
        left join public.tournament_bracket_slots sb
          on sb.plan_id = bp.plan_id and sb.round_number = bp.round_number
             and sb.is_third_place = bp.is_third_place
             and sb.position = case when bp.is_third_place then 2 else bp.game_position * 2 end
        where pl.tournament_id = p_tournament_id and pl.age_group = grade
          and pl.publication_state = 'PUBLISHED'
          and bp.game_id is null
          and bp.game_date is not null
          -- AN UNPAIRED SWISS ROUND IS ONE ROW -- its kick-off and pitch, said once -- not a row for every
          -- empty place in it; once paired, its games carry it.
          and not (internal.tournament_plan_format(bp.plan_id) = 'swiss'
                   and exists (select 1 from public.tournament_bracket_pairings o
                               where o.plan_id = bp.plan_id and o.round_number = bp.round_number and o.game_position < bp.game_position))
      ), '[]'::jsonb),
      -- A SWISS BYE: the side that sits a round out, with the win it is awarded (20270725).
      'byes', coalesce((
        select jsonb_agg(jsonb_build_object('round', b.round_number, 'participantId', b.participant_id, 'clubName', cd.name)
                         order by b.round_number)
        from public.tournament_swiss_byes b
        join public.tournament_plans pl on pl.id = b.plan_id
        join public.tournament_participants tp on tp.id = b.participant_id
        join public.club_directory cd on cd.id = tp.club_directory_id
        where pl.tournament_id = p_tournament_id and pl.age_group = grade and pl.publication_state = 'PUBLISHED'
      ), '[]'::jsonb)
    ) as ctx
    from unnest(v_grades) as grade
  ) contexts;

  return jsonb_build_object(
    'id', v_t.id,
    'name', v_t.name,
    'startsOn', v_t.event_date,
    'endsOn', v_t.ends_on,
    'kickoffTime', v_t.kickoff_time,
    'endsAt', v_t.ends_at,
    'format', v_t.format,
    'swissRounds', v_t.swiss_rounds,
    'visibility', v_t.visibility,
    -- HOW RESULTS ARE RUN, which is NOT the tournament''s own visibility: a club may list a
    -- festival publicly and still keep its scores inside it.
    'resultsSubmissionEnabled', v_t.results_submission_enabled,
    'resultsVisibility', v_t.results_visibility,
    'status', v_t.status,
    'cancelled', (v_t.cancelled_at is not null),
    'coverImagePath', v_t.cover_image_path,
    'coverStockKey', v_t.cover_stock_key,
    'notes', v_t.notes,
    'venueName', (select v.name from public.venues v where v.id = v_t.venue_id),
    'venueAddress', (select nullif(concat_ws(', ', v.address_line_1, v.town, v.postcode), '') from public.venues v where v.id = v_t.venue_id),
    'hostClubName', (select cd.name from public.club_directory cd where cd.id = v_t.host_directory_id),
    'hostCrestPath', coalesce(
      (select c.logo_storage_path from public.clubs c where c.id = v_t.host_club_id),
      (select cd.logo_storage_path from public.club_directory cd where cd.id = v_t.host_directory_id)),
    'hostTown', (select nullif(concat_ws(', ', cd.town, cd.county), '') from public.club_directory cd where cd.id = v_t.host_directory_id),
    -- The client routes a manager to the management surface that already exists rather than drawing a
    -- second organiser dashboard behind this one.
    'canManage', v_can_manage,
    'contexts', v_contexts,

    -- ---- WHO THIS VIEWER MAY ANSWER FOR ---------------------------------------------------------
    --
    -- Resolved by the ONE canonical authority, and never by a role. `resolve_attendance_response_source`
    -- raises for a 16-17 year old without recorded consent and for anybody under 16, so it is called
    -- defensively here: this list decides whether a CONTROL is drawn, and the write refuses
    -- independently whether or not one was.
    'myPlayers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'playerId', pl.id,
        'firstName', pl.first_name,
        -- Whether this is the viewer THEMSELVES rather than a child they answer for. The question and
        -- the confirmation both change person on it -- "Can you make the tournament?" against "Can
        -- Harry make the tournament?" -- so it is a fact the server states rather than one the client
        -- infers from whether a name happens to match.
        'isSelf', internal.is_own_linked_player(pl.id),
        'teamId', ptm.team_id,
        'ageGroup', tp.age_group,
        'status', (select a.status from public.player_fixture_attendance a
                   where a.tournament_id = p_tournament_id and a.player_id = pl.id),
        'canRespond', (select internal.resolve_attendance_response_source(pl.id) is not null)
      ) order by pl.first_name)
      from public.tournament_participants tp
      join public.player_team_memberships ptm on ptm.team_id = tp.team_id and ptm.status = 'active'
      join public.players pl on pl.id = ptm.player_id
      where tp.tournament_id = p_tournament_id
        and tp.team_id is not null
        and (internal.is_own_linked_player(pl.id) or internal.is_active_player_guardian(pl.id))
    ), '[]'::jsonb)
  );
exception
  -- `resolve_attendance_response_source` raises rather than returning null for a refusal, and a
  -- refusal is an ordinary answer here: it means "no control for this player", not "the page failed".
  when sqlstate '42501' then
    raise;
end;
$function$;

revoke all on function internal.tournament_plan_swiss_rounds(uuid) from public, anon, authenticated;

