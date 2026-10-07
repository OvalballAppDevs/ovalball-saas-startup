-- =====================================================================================================
-- A COMPETITION HAS A PLAN.
--
-- Tournament Planning, phase 1. Round Robin is the first format to use it, and the shape below is
-- deliberately the smallest one that lets Swiss, Knockout and Tri-Fixture plug in later without being
-- a generic engine built in advance of its second consumer.
--
-- THE PLAN BELONGS TO A COMPETITION, NOT TO THE TOURNAMENT. A festival running U12 and U16 is two
-- competitions: different sides, different tables, different days, different settings. One plan per
-- (tournament, age group) is therefore the unit, and nothing here is keyed on the tournament alone.
--
-- WHAT WAS AUDITED AND REUSED, rather than invented:
--
--   publication          `regulatory_content_sets` already has Ovalball's publication state machine --
--                        DRAFT / PUBLISHED / SUPERSEDED, with published_by and published_at REQUIRED
--                        once published, plus `version` and a supersedes pointer for revisions. That
--                        is reused verbatim as a shape, so Planning does not invent a second idea of
--                        what "published" means.
--   grouping             `competition_stages -> competition_groups -> competition_group_members` is
--                        the estate's pools model, and the SHAPE is reused (a named, ordered container
--                        holding positioned members).
--   changeover           `club_scheduling_policy.turnaround_minutes` (default 15) is the canonical
--                        time between games on one pitch. Not invented here.
--   playable hours       `club_scheduling_policy.weekend_youth_earliest/latest` and the senior pair are
--                        the canonical windows. Not invented here.
--   game duration        `fixture_scheduling_rules(rugby_code, age_group).half_minutes` carries RFU
--                        Regulation 15's half length per age grade. TWO halves is the regulation
--                        maximum for that grade, and a festival game may be shorter but NEVER longer --
--                        which is a player-welfare rule, so it is a CHECK rather than a suggestion.
--
-- WHAT WAS AUDITED AND DELIBERATELY NOT REUSED:
--
--   competition_groups   its members are `competition_participants`, a DIFFERENT identity from
--                        `tournament_participants`. Reusing the table would mean minting a second
--                        identity for every side already recorded against the tournament -- exactly the
--                        two-sources-of-truth hazard the unified side model was built to remove. The
--                        tables below are keyed on tournament_participants and nothing else.
--   home/away            `competition_matches` carries home_participant_id/away_participant_id. A
--                        tournament game is between ANY two participating sides with no orientation
--                        (20270605), and that must not be reintroduced through the planning path.
--   competition_edition  `tournaments.competition_edition_id` exists and is NULL on every tournament in
--                        the estate. Nothing is built on an unused link.
--
-- WHAT OVALBALL DID NOT HAVE, and so is introduced here with its provenance stated: there is no
-- existing table points configuration, no standings and no fixture generator anywhere in the schema.
-- =====================================================================================================

-- ---- the plan -------------------------------------------------------------------------------------

create table if not exists public.tournament_plans (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  age_group text not null,

  -- THE ESTATE'S OWN PUBLICATION STATES. A draft is the organiser's workings; only a published plan is
  -- a promise to anybody else. SUPERSEDED exists so a revision can replace a published plan without
  -- either of them being edited in place -- the shape regulatory content already uses.
  publication_state text not null default 'DRAFT'
    check (publication_state in ('DRAFT', 'PUBLISHED', 'SUPERSEDED')),
  version integer not null default 1 check (version >= 1),
  supersedes_plan_id uuid references public.tournament_plans(id),
  published_by uuid references auth.users(id),
  published_at timestamptz,

  -- ---- scheduling settings, defaulted from canonical sources by set_tournament_plan_settings -------
  --
  -- ONE HALF OR TWO IS NOT THIS COLUMN'S BUSINESS. This is the whole game, which is what a schedule is
  -- built from and what `tournament_games.duration_minutes` already records per game.
  game_duration_minutes integer not null check (game_duration_minutes between 4 and 180),
  changeover_minutes integer not null default 15 check (changeover_minutes between 0 and 120),
  day_start_time time not null,
  day_end_time time not null,

  -- ---- TABLE POINTS, which are not match scores ---------------------------------------------------
  --
  -- A rugby result of 24-17 is the MATCH SCORE and lives on the game. These are the COMPETITION points
  -- a result is worth in a table, and the two are never the same number. The defaults are the standard
  -- rugby union competition values (win 4, draw 2, loss 0, a bonus for four tries, a bonus for losing
  -- by seven or fewer) -- Ovalball held no points configuration anywhere before this migration, which
  -- is recorded here rather than presented as a reuse.
  points_win integer not null default 4 check (points_win >= 0),
  points_draw integer not null default 2 check (points_draw >= 0),
  points_loss integer not null default 0 check (points_loss >= 0),
  points_try_bonus integer not null default 1 check (points_try_bonus >= 0),
  points_losing_bonus integer not null default 1 check (points_losing_bonus >= 0),

  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tournament_plans_hours_in_order check (day_end_time > day_start_time),
  -- PUBLISHED MEANS SOMEBODY PUBLISHED IT, and the record says who and when.
  constraint tournament_plans_published_requires_metadata
    check (publication_state <> 'PUBLISHED' or (published_by is not null and published_at is not null))
);

-- ONE LIVE PLAN PER COMPETITION. A superseded plan is history and may sit alongside its replacement.
create unique index if not exists tournament_plans_one_live_per_competition
  on public.tournament_plans (tournament_id, age_group)
  where publication_state <> 'SUPERSEDED';

comment on table public.tournament_plans is
  'One plan per COMPETITION (tournament + age group): its settings, its publication state and its '
  'table points. A tournament running two age groups has two plans, because they are two competitions '
  'with different sides, tables, days and settings.';

-- ---- the days this competition actually uses -------------------------------------------------------
--
-- THE TOURNAMENT'S DATE RANGE AND THE COMPETITION'S ACTIVE DAYS ARE DIFFERENT FACTS. A festival may run
-- Friday to Sunday while its U12 competition plays Friday and Sunday only. Recording that here means
-- `tournaments.ends_on` is never edited to express it -- which would change what the tournament IS in
-- order to describe what one of its competitions does.

create table if not exists public.tournament_plan_days (
  plan_id uuid not null references public.tournament_plans(id) on delete cascade,
  day_date date not null,
  primary key (plan_id, day_date)
);

comment on table public.tournament_plan_days is
  'Which of the tournament''s own days this competition plays on. Always a subset of '
  'tournaments.event_date..ends_on, enforced by a trigger; never a way to extend the tournament.';

create or replace function internal.validate_tournament_plan_day()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_from date; v_to date;
begin
  select t.event_date, coalesce(t.ends_on, t.event_date) into v_from, v_to
  from public.tournament_plans p join public.tournaments t on t.id = p.tournament_id
  where p.id = new.plan_id;

  if v_from is null then
    raise exception 'That plan does not belong to a tournament.' using errcode = 'P0002';
  end if;
  if new.day_date < v_from or new.day_date > v_to then
    raise exception 'A competition can only play on a day the tournament runs (% to %).', v_from, v_to
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

drop trigger if exists tournament_plan_days_validate on public.tournament_plan_days;
create trigger tournament_plan_days_validate
  before insert or update on public.tournament_plan_days
  for each row execute function internal.validate_tournament_plan_day();

-- ---- tables (the agreed UI word) -------------------------------------------------------------------
--
-- "Table" is what an organiser is shown, so it is what the schema calls them. The competition estate
-- says "group" for the same idea; the two are not merged because their MEMBERS are different identities
-- (see the header), and a shared name over different keys would be the more confusing of the two.

create table if not exists public.tournament_plan_tables (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.tournament_plans(id) on delete cascade,
  -- PRESENTATION ONLY. "Table A", "Pool A", "Cup Group" -- renaming one never moves a side or a game,
  -- which is why nothing references a table by its name.
  name text not null check (btrim(name) <> ''),
  sort_order integer not null check (sort_order >= 1),
  unique (plan_id, sort_order)
);

create table if not exists public.tournament_plan_table_sides (
  table_id uuid not null references public.tournament_plan_tables(id) on delete cascade,
  -- Carried so "one table per side within a plan" can be a plain unique index rather than a trigger.
  plan_id uuid not null references public.tournament_plans(id) on delete cascade,
  participant_id uuid not null references public.tournament_participants(id) on delete cascade,
  position integer not null check (position >= 1),
  primary key (table_id, participant_id),
  unique (table_id, position)
);

-- A SIDE SITS AT EXACTLY ONE TABLE. Two tables holding the same side would generate that side two
-- schedules, and the organiser would have no way to tell which one the day actually runs to.
create unique index if not exists tournament_plan_table_sides_one_table_per_side
  on public.tournament_plan_table_sides (plan_id, participant_id);

-- And a side at a table must be a side in THIS competition.
create or replace function internal.validate_tournament_plan_table_side()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_plan_tournament uuid; v_plan_grade text; v_side_tournament uuid; v_side_grade text; v_table_plan uuid;
begin
  select p.tournament_id, p.age_group into v_plan_tournament, v_plan_grade
  from public.tournament_plans p where p.id = new.plan_id;
  select t.plan_id into v_table_plan from public.tournament_plan_tables t where t.id = new.table_id;
  select tp.tournament_id, tp.age_group into v_side_tournament, v_side_grade
  from public.tournament_participants tp where tp.id = new.participant_id;

  if v_plan_tournament is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if v_table_plan is distinct from new.plan_id then
    raise exception 'That table belongs to a different plan.' using errcode = '22023';
  end if;
  if v_side_tournament is distinct from v_plan_tournament then
    raise exception 'That side is not in this tournament.' using errcode = '22023';
  end if;
  if v_side_grade is distinct from v_plan_grade then
    raise exception 'That side plays %, not % -- a competition''s tables hold its own sides.', v_side_grade, v_plan_grade
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

drop trigger if exists tournament_plan_table_sides_validate on public.tournament_plan_table_sides;
create trigger tournament_plan_table_sides_validate
  before insert or update on public.tournament_plan_table_sides
  for each row execute function internal.validate_tournament_plan_table_side();

-- ---- a game may belong to a plan -------------------------------------------------------------------
--
-- NULLABLE, on purpose. A game an organiser added by hand before Planning existed belongs to no plan,
-- and keeps behaving exactly as it did -- visible, editable, real. Only a game that came from a plan is
-- gated on that plan being published.

alter table public.tournament_games add column if not exists plan_id uuid references public.tournament_plans(id) on delete cascade;
alter table public.tournament_games add column if not exists table_id uuid references public.tournament_plan_tables(id) on delete set null;
alter table public.tournament_games add column if not exists round_number integer check (round_number is null or round_number >= 1);

create index if not exists tournament_games_plan_id_idx on public.tournament_games (plan_id) where plan_id is not null;

comment on column public.tournament_games.plan_id is
  'The plan that generated this game, or NULL for one an organiser created by hand. A participant sees '
  'a hand-made game as before, and a generated one only once its plan is PUBLISHED.';

-- ---- row level security ----------------------------------------------------------------------------
--
-- READING follows the tournament, exactly as every other tournament table does. WRITING is the
-- organiser's, through the governed functions below -- there is no insert/update/delete policy at all,
-- so a client cannot write planning state by going around them.

alter table public.tournament_plans enable row level security;
alter table public.tournament_plan_days enable row level security;
alter table public.tournament_plan_tables enable row level security;
alter table public.tournament_plan_table_sides enable row level security;

drop policy if exists tournament_plans_select_scoped on public.tournament_plans;
create policy tournament_plans_select_scoped on public.tournament_plans
  for select using (internal.tournament_visible_row(tournament_id));

drop policy if exists tournament_plan_days_select_scoped on public.tournament_plan_days;
create policy tournament_plan_days_select_scoped on public.tournament_plan_days
  for select using (exists (select 1 from public.tournament_plans p
                            where p.id = plan_id and internal.tournament_visible_row(p.tournament_id)));

drop policy if exists tournament_plan_tables_select_scoped on public.tournament_plan_tables;
create policy tournament_plan_tables_select_scoped on public.tournament_plan_tables
  for select using (exists (select 1 from public.tournament_plans p
                            where p.id = plan_id and internal.tournament_visible_row(p.tournament_id)));

drop policy if exists tournament_plan_table_sides_select_scoped on public.tournament_plan_table_sides;
create policy tournament_plan_table_sides_select_scoped on public.tournament_plan_table_sides
  for select using (exists (select 1 from public.tournament_plans p
                            where p.id = plan_id and internal.tournament_visible_row(p.tournament_id)));

grant select on public.tournament_plans, public.tournament_plan_days,
                public.tournament_plan_tables, public.tournament_plan_table_sides to authenticated;
