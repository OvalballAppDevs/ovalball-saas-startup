-- =====================================================================================================
-- A ROUND IS SCHEDULED BEFORE ANYBODY HAS QUALIFIED.
--
-- The approved mock-up shows the draw with every round placed: the quarter-finals at 10:00 on Pitch 1,
-- SF1 at 15:00 on Pitch 1, the final at 10:00 on the Sunday, the third-place play-off at 10:00 on
-- Pitch 2 -- all of it visible while the semi-final boxes are still empty.
--
-- That is how a festival actually works. The organiser books the pitches and publishes the running
-- order; who fills each slot is settled on the day. So the SCHEDULE belongs to the place in the
-- bracket, not to the game, because the place exists first.
--
--   A PAIRING is a planned game: a round, a position, a day, a time and a pitch.
--   A GAME is a played game: two real sides, and a result.
--
-- The pairing is created and scheduled when the competition is generated. Its game appears underneath
-- it the moment both sides are known, and inherits the time and pitch the organiser published. Nothing
-- about `tournament_games.side_a_id` being NOT NULL has to bend, and no club called "Winner QF1" has to
-- be invented to hold a slot open.
-- =====================================================================================================

create table if not exists public.tournament_bracket_pairings (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.tournament_plans(id) on delete cascade,
  round_number integer not null,
  game_position integer not null,
  /** The third-place play-off is the one pairing the slot arithmetic cannot express. */
  is_third_place boolean not null default false,
  game_date date,
  start_time time,
  pitch_id uuid references public.club_pitches(id) on delete set null,
  /** The played game, once both sides are known. Null while the places above are still being decided. */
  game_id uuid references public.tournament_games(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tournament_bracket_pairings_round_positive check (round_number >= 1),
  constraint tournament_bracket_pairings_position_positive check (game_position >= 1),
  constraint tournament_bracket_pairings_one_per_place
    unique (plan_id, round_number, game_position, is_third_place)
);

comment on table public.tournament_bracket_pairings is
  'A PLANNED game in a knockout: a place in the bracket with a day, a time and a pitch, which exists '
  'before its two sides are known. Its tournament_game appears underneath it once both are, and '
  'inherits the published time -- so a round can be scheduled and shown without inventing a side.';

create index if not exists tournament_bracket_pairings_plan_idx
  on public.tournament_bracket_pairings (plan_id, round_number, game_position);

alter table public.tournament_bracket_pairings enable row level security;

create policy tournament_bracket_pairings_select on public.tournament_bracket_pairings
  for select to authenticated
  using (exists (
    select 1 from public.tournament_plans p
    where p.id = plan_id and internal.tournament_visible_row(p.tournament_id)
  ));

create policy tournament_bracket_pairings_session_ok_required on public.tournament_bracket_pairings
  as restrictive for all to authenticated
  using (internal.session_ok()) with check (internal.session_ok());

grant select on public.tournament_bracket_pairings to authenticated;

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tournament_bracket_pairings' and cmd in ('INSERT','UPDATE','DELETE')
  ) then
    raise exception 'the bracket schedule carries a client write policy; it is the organiser''s, through RPCs only.';
  end if;
end $$;

-- ---- the format belongs to the competition, not the festival -----------------------------------------
--
-- "Choose how this age group will be played" is the mock-up's own wording, and it is right: a festival
-- can perfectly well run its U12s as a round robin and its U16s as a cup. The TOURNAMENT's format is
-- what the competition starts from -- the organiser confirms it rather than choosing from nothing --
-- and a competition may differ from it.

alter table public.tournament_plans
  add column if not exists format text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tournament_plans_format_check') then
    alter table public.tournament_plans add constraint tournament_plans_format_check
      check (format is null or format in ('round_robin', 'tri_fixture', 'swiss', 'knockout', 'hybrid'));
  end if;
end $$;

comment on column public.tournament_plans.format is
  'How THIS competition is played. Null means it follows the tournament''s own format, which is what an '
  'organiser is confirming on the first planning step rather than choosing from nothing.';

/** The format a competition is actually played in: its own, or the tournament's. */
create or replace function internal.tournament_plan_format(p_plan_id uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(p.format, t.format)
  from public.tournament_plans p
  join public.tournaments t on t.id = p.tournament_id
  where p.id = p_plan_id;
$function$;

-- ---- and a level game can be settled by golden point -------------------------------------------------
--
-- THE MOCK-UP ADDS ONE OVALBALL CAN HONESTLY SUPPORT. Golden point is first score wins, so the game
-- ends the moment somebody scores and the recorded score is DECISIVE by construction -- there is
-- nothing to infer and nothing to pretend. It joins the list; a kicking competition still does not,
-- because no kick is recorded anywhere.
--
-- EXTRA TIME BECOMES ITS OWN QUESTION, as the mock-up draws it: "Extra time (if drawn)" is a length,
-- and "Tie resolution" is what settles the game if it is STILL level. They were one setting and should
-- not have been.

alter table public.tournament_plans drop constraint if exists tournament_plans_tie_resolution_check;
alter table public.tournament_plans add constraint tournament_plans_tie_resolution_check
  check (tie_resolution in ('none', 'golden_point', 'organiser_decision'));

update public.tournament_plans set tie_resolution = 'golden_point' where tie_resolution = 'extra_time';

comment on column public.tournament_plans.tie_resolution is
  'What settles a knockout game that is still level: nothing (the bracket waits), GOLDEN POINT (first '
  'score wins, so the recorded score is decisive by construction), or the organiser recording who went '
  'through and why. Extra time is a separate length, not a resolution.';

comment on column public.tournament_plans.extra_time_minutes is
  'How long a further period is, where the competition plays one after a draw. Independent of '
  'tie_resolution: extra time may be played and the game still end level.';
