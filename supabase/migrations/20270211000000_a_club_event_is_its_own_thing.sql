-- =====================================================================
-- A CLUB EVENT IS ITS OWN THING
--
-- Calendar is a projection over canonical schedulable activity, and the
-- long-term categories are FIXTURE, TRAINING, EVENT, TOURNAMENT and BLOCKOUT.
-- Four of the five already had a canonical home before this migration:
--
--   FIXTURE     public.fixtures
--   TRAINING    public.training_sessions
--   TOURNAMENT  public.tournaments + public.tournament_participants
--   BLOCKOUT    (not yet built, deliberately)
--
-- EVENT did not. A centenary weekend, an awards night, a club open day or a
-- presentation evening had nowhere canonical to live, and the only way to put
-- one on a calendar was to lie about it -- to book a "fixture" with no
-- opposition, or a "training session" nobody trains at. That corrupts two
-- domains at once: fixture reporting counts a party as a match, and the
-- training register asks a nine-year-old whether they are available for the
-- awards evening.
--
-- WHY A NEW TABLE, HAVING AUDITED FOR ONE TO REUSE.
--
-- The audit looked for an existing home first, as it should. public.fixtures
-- is built around two SIDES and a result; a club open day has neither.
-- public.training_sessions is built around one team, one pitch and a coaching
-- agenda; a club-wide fundraiser at an external venue has none of those.
-- public.tournaments is genuinely close -- multi-team, multi-pitch, one host --
-- but it is a COMPETITION aggregate carrying rugby_code, competition_edition_id
-- and an invited-opposition participant model, and a Christmas party is not a
-- competition with uninvited entrants. Bending any of the three would have
-- made every existing query in that domain start asking "...but is it really
-- one of mine?".
--
-- So EVENT gets its own stable id and its own table, exactly as the other
-- categories have. What it does NOT get is its own copy of anything already
-- canonical: venues, pitches, teams, seasons, the attendance register, the
-- safeguarding rule, the capability engine and the weather adapter are all
-- reused unchanged.
--
-- WHAT IS DELIBERATELY NOT HERE. No Tournament work and no Blockout table --
-- both are named in the brief as future slices. The shapes below are chosen so
-- neither is blocked: see the notes at the foot of this file.
-- =====================================================================

-- ---------------------------------------------------------------------
-- THE EVENT.
--
-- One row is one event, whatever its length. A seven-day centenary weekend is
-- ONE row with a start and an end, never seven rows -- the calendar derives
-- the span, so moving the event is one edit and cancelling it is one act.
-- ---------------------------------------------------------------------
create table if not exists public.club_events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,

  -- Which season it belongs to comes from the canonical register, never from
  -- the date. A season-sensitive read filters on this, not on a month.
  season_id uuid references public.seasons(id),

  name text not null,
  description text,

  -- WHEN. Dates are required; times are optional, and their absence is the
  -- all-day semantic rather than a fake midnight. This matches how
  -- training_sessions already models an unscheduled time (start_time null).
  starts_on date not null,
  start_time time,
  ends_on date not null,
  end_time time,

  -- SCOPE. `is_club_wide` means every team at the club, expressed once,
  -- rather than materialising a join row per team -- a club with thirty sides
  -- would otherwise write thirty rows to say "everyone", and adding a team
  -- next week would silently leave it out of an event that was meant to
  -- include the whole club.
  is_club_wide boolean not null default false,

  -- WHERE. Exactly one of these two models, enforced below: a canonical club
  -- venue, or a structured external location. Never both, never neither.
  venue_id uuid references public.venues(id),

  external_location_name text,
  external_address_line_1 text,
  external_address_line_2 text,
  external_town text,
  external_county text,
  external_postcode text,
  external_country text,
  -- Coordinates are stored so the weather adapter has somewhere to point.
  -- A free-text line alone could never be forecast against.
  external_latitude numeric,
  external_longitude numeric,
  external_address_provider_ref text,

  status text not null default 'SCHEDULED',
  cancelled_at timestamptz,
  cancellation_reason text,
  cancelled_by uuid references auth.users(id),

  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint club_events_status_check check (status in ('SCHEDULED', 'CANCELLED')),

  -- END IS NEVER BEFORE START. Checked on the date first, then on the time
  -- within a single day; a multi-day event's end_time is an end-of-last-day
  -- time and is not comparable to the start time.
  constraint club_events_range_check check (ends_on >= starts_on),
  constraint club_events_same_day_time_check check (
    ends_on > starts_on
    or start_time is null
    or end_time is null
    or end_time >= start_time
  ),

  -- VENUE XOR EXTERNAL LOCATION. Two active locations would mean two answers
  -- to "where is this", and the weather panel and the directions button would
  -- be free to pick different ones.
  constraint club_events_location_check check (
    (venue_id is not null and external_location_name is null)
    or (venue_id is null and external_location_name is not null)
  ),

  constraint club_events_name_check check (length(btrim(name)) between 1 and 160)
);

comment on table public.club_events is
  'A non-fixture, non-training scheduled club activity: socials, fundraisers, open days, presentation evenings, tours. One row per event regardless of how many days it spans.';

create index if not exists club_events_club_id_idx on public.club_events (club_id);
create index if not exists club_events_season_id_idx on public.club_events (season_id);
-- The calendar's only scan shape: this club, overlapping this window.
create index if not exists club_events_club_span_idx on public.club_events (club_id, starts_on, ends_on);

-- ---------------------------------------------------------------------
-- WHICH TEAMS IT INVOLVES.
--
-- Stable team ids, never a name list. A club-wide event carries NO rows here
-- and is resolved by `is_club_wide` instead.
-- ---------------------------------------------------------------------
create table if not exists public.club_event_teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.club_events(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (event_id, team_id)
);

create index if not exists club_event_teams_team_id_idx on public.club_event_teams (team_id);

-- ---------------------------------------------------------------------
-- WHICH PITCHES IT RESERVES.
--
-- Optional: a presentation evening reserves none, a centenary weekend may
-- reserve several. Stable pitch ids so Pitch Allocation reads the SAME
-- relationship rather than a second, hand-maintained copy of it.
-- ---------------------------------------------------------------------
create table if not exists public.club_event_pitches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.club_events(id) on delete cascade,
  pitch_id uuid not null references public.club_pitches(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (event_id, pitch_id)
);

create index if not exists club_event_pitches_pitch_id_idx on public.club_event_pitches (pitch_id);

-- ---------------------------------------------------------------------
-- ATTENDANCE: EXTEND THE REGISTER, DO NOT START A SECOND ONE.
--
-- public.player_fixture_attendance is ALREADY polymorphic. Training was added
-- to it by exactly this move -- a nullable training_session_id, a
-- num_nonnulls() check keeping a row about one activity, a partial unique
-- index, and its own SELECT policy. Event is the third activity and follows
-- the same path.
--
-- The alternative -- a separate club_event_attendance table -- would have
-- duplicated the status vocabulary, the response_source vocabulary, the
-- safeguarding resolver and the register component, and left "has this child
-- answered" with two places to look. The existing contract extends cleanly,
-- so it is extended.
-- ---------------------------------------------------------------------
alter table public.player_fixture_attendance
  add column if not exists event_id uuid references public.club_events(id) on delete cascade;

alter table public.player_fixture_attendance
  drop constraint if exists player_fixture_attendance_activity_check;

alter table public.player_fixture_attendance
  add constraint player_fixture_attendance_activity_check
  check (num_nonnulls(fixture_id, training_session_id, event_id) = 1);

-- ONE PLAYER, ONE EVENT, ONE CURRENT RESPONSE.
create unique index if not exists player_fixture_attendance_event_unique
  on public.player_fixture_attendance (event_id, player_id)
  where event_id is not null;

create index if not exists player_fixture_attendance_event_id_idx
  on public.player_fixture_attendance (event_id)
  where event_id is not null;

-- =====================================================================
-- VISIBILITY
--
-- THE RULE LIVES IN ONE PLACE, as it does for training: one function, and the
-- RLS policy and every RPC are doors onto it, so they cannot drift into two
-- different answers to "may this person see this event".
-- =====================================================================
create or replace function internal.club_event_visible_row(
  p_event_id uuid,
  p_club_id uuid,
  p_is_club_wide boolean
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    internal.is_site_admin()

    -- ANYBODY WITH AN ACTIVE ROLE AT THE CLUB RUNNING IT. A club event is a
    -- club-wide artefact in the same way a training session is: the Calendar,
    -- the pitch allocation board and Event management all read it club-wide,
    -- and every one of those viewers holds a membership row.
    or exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id
        and cm.user_id = auth.uid()
        and cm.status = 'active'
    )

    -- THE PEOPLE IT IS ACTUALLY FOR: a player on an involved team, or the
    -- adult responsible for one. Guardians and linked players routinely hold
    -- no club_memberships row -- that is the normal shape of a parent account
    -- -- so without this they would lose their own child's club events.
    --
    -- A club-wide event reaches every active team at the club; a scoped event
    -- reaches only the teams named in club_event_teams.
    or exists (
      select 1
      from public.player_team_memberships ptm
      join public.teams t on t.id = ptm.team_id
      where ptm.status = 'active'
        and t.club_id = p_club_id
        and (
          p_is_club_wide
          or exists (
            select 1 from public.club_event_teams cet
            where cet.event_id = p_event_id and cet.team_id = ptm.team_id
          )
        )
        and (
          internal.is_own_linked_player(ptm.player_id)
          or internal.is_active_player_guardian(ptm.player_id)
        )
    );
$$;

comment on function internal.club_event_visible_row(uuid, uuid, boolean) is
  'The one rule for who may read a club event. RLS and every RPC read this, so they cannot disagree.';

-- ---------------------------------------------------------------------
-- MANAGEMENT AUTHORITY.
--
-- Reuses the existing capability engine and the capability that already
-- exists for exactly this job -- `calendar.manage` -- rather than inventing a
-- second permission system. Club scope manages any event at the club; team
-- scope manages an event scoped to a team they hold it on, which is what lets
-- a Team Admin run their own team's social without being given the whole club.
--
-- A club-wide event is deliberately CLUB-scoped only: an event that reaches
-- every team is not one team's to edit.
-- ---------------------------------------------------------------------
create or replace function internal.can_manage_club_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.club_events e
    where e.id = p_event_id
      and (
        internal.is_site_admin()
        or internal.has_capability('calendar.manage', 'club', e.club_id, null)
        or (
          not e.is_club_wide
          and exists (
            select 1 from public.club_event_teams cet
            where cet.event_id = e.id
              and internal.has_capability('calendar.manage', 'team', e.club_id, cet.team_id)
          )
        )
      )
  );
$$;

-- Team-scope defaults for calendar.manage, mirroring team.training.manage
-- exactly: the people who already run a team's training are the people who
-- run its socials. Club scope is unchanged.
insert into public.role_capability_defaults (scope_type, role_key, capability_key)
values
  ('team', 'CLUB_ADMIN', 'calendar.manage'),
  ('team', 'TEAM_MANAGER', 'calendar.manage')
on conflict do nothing;

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.club_events enable row level security;
alter table public.club_event_teams enable row level security;
alter table public.club_event_pitches enable row level security;

-- TO authenticated, never PUBLIC: an anonymous reader has no legitimate view
-- of a club's internal social calendar, and `anon` reaching this table at all
-- was the shape of the fixtures defect closed earlier in this project.
drop policy if exists club_events_select on public.club_events;
create policy club_events_select on public.club_events
  for select to authenticated
  using (internal.club_event_visible_row(id, club_id, is_club_wide));

drop policy if exists club_event_teams_select on public.club_event_teams;
create policy club_event_teams_select on public.club_event_teams
  for select to authenticated
  using (
    exists (
      select 1 from public.club_events e
      where e.id = event_id
        and internal.club_event_visible_row(e.id, e.club_id, e.is_club_wide)
    )
  );

drop policy if exists club_event_pitches_select on public.club_event_pitches;
create policy club_event_pitches_select on public.club_event_pitches
  for select to authenticated
  using (
    exists (
      select 1 from public.club_events e
      where e.id = event_id
        and internal.club_event_visible_row(e.id, e.club_id, e.is_club_wide)
    )
  );

-- WRITES GO THROUGH THE RPCs BELOW, never through the table. There is no
-- INSERT/UPDATE/DELETE policy on any of these three tables on purpose: the
-- writers are SECURITY DEFINER and gate on the capability engine, so there is
-- exactly one path in and it is the one that checks.

-- Attendance reads for events, alongside the fixture and training policies
-- that already exist on this table.
drop policy if exists player_fixture_attendance_select_event_scoped on public.player_fixture_attendance;
create policy player_fixture_attendance_select_event_scoped on public.player_fixture_attendance
  for select to authenticated
  using (
    event_id is not null
    and exists (
      select 1 from public.club_events e
      where e.id = event_id
        and internal.club_event_visible_row(e.id, e.club_id, e.is_club_wide)
    )
    and (
      -- Your own, or your child's.
      internal.is_own_linked_player(player_id)
      or internal.is_active_player_guardian(player_id)
      -- Or a legitimate register view, which is capability-gated per team and
      -- therefore cannot show one team's list to another team's staff.
      or exists (
        select 1
        from public.player_team_memberships ptm
        join public.teams t on t.id = ptm.team_id
        join public.club_events e2 on e2.id = event_id
        where ptm.player_id = player_fixture_attendance.player_id
          and ptm.status = 'active'
          and t.club_id = e2.club_id
          and internal.has_capability('team.attendance.view', 'team', t.club_id, t.id)
      )
    )
  );

-- =====================================================================
-- FORWARD COMPATIBILITY -- recorded here so the next slice does not have to
-- rediscover it.
--
-- TOURNAMENT is NOT this table with a flag. public.tournaments already exists
-- as its own aggregate with public.tournament_participants carrying invited
-- opposition per host team, and that is the right shape: a tournament has
-- entrants, results and a competition edition, none of which a club event has.
-- Nothing here forecloses extending it -- club_event_pitches and this table's
-- span/venue modelling are deliberately not referenced by tournaments.
--
-- BLOCKOUT is NOT an event either. A blockout asserts that time is NOT
-- available; an event asserts that something IS happening. Modelling a
-- Christmas shutdown as an event would put "Christmas Holiday" in the
-- attendance register and ask children whether they are attending it. It
-- wants its own small table (club/team scope, span, reason, notes) and its own
-- calendar category, consuming the same span-projection this migration
-- establishes.
-- =====================================================================
