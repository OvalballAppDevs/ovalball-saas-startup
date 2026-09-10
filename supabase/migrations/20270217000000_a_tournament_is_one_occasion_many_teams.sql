-- =====================================================================
-- A TOURNAMENT IS ONE OCCASION THAT MANY OF OUR TEAMS ATTEND
--
-- WHAT WAS ALREADY HERE, AND WHY IT IS KEPT.
--
-- public.tournaments + public.tournament_participants already model an
-- inter-club negotiation: one host club claims the occasion, invites other
-- canonical clubs by (club_directory_id, canonical_team_type_id), and those
-- clubs accept or decline. That layer is good and is NOT replaced -- it is
-- the one place an opposition identity lives, it already refuses to mint a
-- fake clubs row for an unactivated club ('external_recorded'), and it
-- already validates that a pitch or venue belongs to the host.
--
-- WHAT IT COULD NOT SAY.
--
-- It is host-centric and singular: ONE host_team_id, ONE event_date, ONE
-- pitch_id, and a flat participant list hanging off the parent. So it cannot
-- express the actual rugby occasion a club turns up to:
--
--   Preston Festival
--     our U12  v  Clitheroe, Blackburn, Wigan
--     our U13  v  Blackburn, St Helens, Didsbury, Skipton
--
-- Three things are missing. (1) MANY OF OUR TEAMS: host_team_id is one team,
-- and a trigger deliberately forbids the host from appearing in the
-- participant list, so "we brought U12 and U13" is unrepresentable.
-- (2) WHOSE OPPONENT IS WHOSE: a flat list on the parent implies every one of
-- our teams plays every listed club, which is false -- U12 never plays
-- Skipton. Grouping by age grade is inference, not identity, and it collapses
-- the moment two of our teams share a grade. (3) A SCHEDULE: there is no game
-- record at all, and no way to say the day used Pitch 1, 2 and 3.
--
-- THE SHAPE ADDED HERE.
--
--   tournaments                 the parent occasion, one stable id
--     tournament_participants   (existing) every attending opposition identity
--     tournament_team_entries   one row per OVALBALL team attending
--       tournament_entry_opponents   which participants THAT team plays
--       tournament_games             that team's scheduled games
--     tournament_pitches        the real periods this occasion holds a pitch
--
-- tournament_entry_opponents is deliberately a LINK, not a second opponent
-- model: the club/team identity stays in tournament_participants, and the
-- only new fact is which of our teams faces it. Nothing about an opponent is
-- stored twice, so nothing can disagree.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. THE PARENT GAINS A NAME AND AN END DATE
-- ---------------------------------------------------------------------
-- A tournament was previously identified to people by host club + date,
-- which is exactly the "identify it by display text" failure the product
-- forbids elsewhere. "Preston Festival" is a real fact about the occasion
-- and belongs on the parent.
alter table public.tournaments add column if not exists name text;
alter table public.tournaments add column if not exists ends_on date;

update public.tournaments t
   set name = coalesce(t.name, cd.name || ' Tournament')
  from public.club_directory cd
 where cd.id = t.host_directory_id and t.name is null;

update public.tournaments set ends_on = event_date where ends_on is null;

alter table public.tournaments alter column name set not null;
alter table public.tournaments alter column ends_on set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tournaments_name_length') then
    alter table public.tournaments
      add constraint tournaments_name_length check (length(btrim(name)) between 1 and 160);
  end if;
  -- event_date is the START of the occasion. A multi-day festival is ONE
  -- tournament row spanning dates, never one row per day.
  if not exists (select 1 from pg_constraint where conname = 'tournaments_span_ordered') then
    alter table public.tournaments
      add constraint tournaments_span_ordered check (ends_on >= event_date);
  end if;
end $$;

comment on column public.tournaments.event_date is
  'The first day of the occasion. Multi-day tournaments span event_date..ends_on as ONE row.';
comment on column public.tournaments.pitch_id is
  'Legacy single-pitch hint from the original host-and-invite model. The canonical pitch occupancy for a tournament is public.tournament_pitches, which supports several pitches over real periods.';

-- ---------------------------------------------------------------------
-- 2. OUR TEAMS AT THIS TOURNAMENT
-- ---------------------------------------------------------------------
create table if not exists public.tournament_team_entries (
  id              uuid primary key default gen_random_uuid(),
  tournament_id   uuid not null references public.tournaments(id) on delete cascade,
  team_id         uuid not null references public.teams(id) on delete cascade,
  -- Denormalised from teams.club_id so every authority and visibility check
  -- can be answered without a join, and so a team moving club can never
  -- silently re-point an existing entry's authority.
  club_id         uuid not null references public.clubs(id) on delete cascade,
  notes           text,
  created_by      uuid references auth.users(id),
  updated_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tournament_id, team_id)
);
create index if not exists tournament_team_entries_tournament_idx on public.tournament_team_entries(tournament_id);
create index if not exists tournament_team_entries_team_idx on public.tournament_team_entries(team_id);
create index if not exists tournament_team_entries_club_idx on public.tournament_team_entries(club_id);

-- ---------------------------------------------------------------------
-- 3. WHICH PARTICIPANTS THAT TEAM ACTUALLY PLAYS
-- ---------------------------------------------------------------------
create table if not exists public.tournament_entry_opponents (
  id             uuid primary key default gen_random_uuid(),
  entry_id       uuid not null references public.tournament_team_entries(id) on delete cascade,
  participant_id uuid not null references public.tournament_participants(id) on delete cascade,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  unique (entry_id, participant_id)
);
create index if not exists tournament_entry_opponents_entry_idx on public.tournament_entry_opponents(entry_id);
create index if not exists tournament_entry_opponents_participant_idx on public.tournament_entry_opponents(participant_id);

-- ---------------------------------------------------------------------
-- 4. THE PITCHES THIS OCCASION HOLDS
-- ---------------------------------------------------------------------
-- A reservation states the REAL period for which the pitch is unavailable.
-- That is the whole point: a festival holding Pitch 1 from 09:30 to 14:00 is
-- not a 60-minute fixture, and must never be padded with fixture warm-up and
-- pack-up buffers on top of a period that already includes them.
create table if not exists public.tournament_pitches (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  pitch_id      uuid not null references public.club_pitches(id) on delete cascade,
  reserved_on   date not null,
  start_time    time not null,
  end_time      time not null,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  unique (tournament_id, pitch_id, reserved_on, start_time),
  constraint tournament_pitches_period_ordered check (end_time > start_time)
);
create index if not exists tournament_pitches_tournament_idx on public.tournament_pitches(tournament_id);
create index if not exists tournament_pitches_pitch_date_idx on public.tournament_pitches(pitch_id, reserved_on);

-- ---------------------------------------------------------------------
-- 5. THE GAMES
-- ---------------------------------------------------------------------
-- DELIBERATELY NOT public.fixtures. A fixtures row is a bilateral negotiated
-- fixture: it mints a conversation, enters mirror-fixture pairing, opens a
-- two-club result confirmation with a deadline and a dispute/amendment
-- workflow, and carries attendance invitations. A twenty-minute festival game
-- against the third of four opponents is none of those things, and creating
-- one fixtures row per tournament game would flood Fixtures and Match Centre,
-- duplicate the attendance surface, and put a result deadline on every game.
--
-- The physical game is therefore recorded once, here, and the pitch time it
-- consumes is already covered by its parent's tournament_pitches reservation,
-- so a game never conflicts with the reservation that contains it.
create table if not exists public.tournament_games (
  id               uuid primary key default gen_random_uuid(),
  -- Denormalised parent so every guard, projection and conflict query can
  -- reach the stable tournament identity in one hop.
  tournament_id    uuid not null references public.tournaments(id) on delete cascade,
  entry_id         uuid not null references public.tournament_team_entries(id) on delete cascade,
  opponent_id      uuid not null references public.tournament_entry_opponents(id) on delete cascade,
  game_date        date not null,
  start_time       time,
  duration_minutes integer,
  pitch_id         uuid references public.club_pitches(id),
  status           text not null default 'SCHEDULED',
  sort_order       integer not null default 0,
  our_score        integer,
  opponent_score   integer,
  created_by       uuid references auth.users(id),
  updated_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint tournament_games_status_check check (status in ('SCHEDULED', 'CANCELLED', 'PLAYED')),
  constraint tournament_games_duration_range check (duration_minutes is null or (duration_minutes between 1 and 240)),
  -- A score is a pair or it is nothing: half a result is not a result.
  constraint tournament_games_score_pair check ((our_score is null) = (opponent_score is null)),
  constraint tournament_games_score_non_negative check (our_score is null or (our_score >= 0 and opponent_score >= 0))
);
create index if not exists tournament_games_tournament_idx on public.tournament_games(tournament_id);
create index if not exists tournament_games_entry_idx on public.tournament_games(entry_id, game_date, start_time);
create index if not exists tournament_games_pitch_idx on public.tournament_games(pitch_id, game_date) where pitch_id is not null;

-- ---------------------------------------------------------------------
-- 6. INTEGRITY: EVERYTHING BELONGS TO THE SAME OCCASION
-- ---------------------------------------------------------------------
-- Foreign keys alone would let a game point at one tournament's entry and
-- another tournament's opponent. These triggers make the parent identity the
-- thing that actually holds the structure together.

create or replace function internal.validate_tournament_team_entry()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_team_club uuid;
  v_team_code text;
  v_tournament_code text;
begin
  select t.club_id, t.rugby_code into v_team_club, v_team_code from public.teams t where t.id = new.team_id;
  if v_team_club is null then
    raise exception 'That team does not exist.' using errcode = '23503';
  end if;
  if new.club_id <> v_team_club then
    raise exception 'A tournament entry must record the club that actually owns the team.' using errcode = '23514';
  end if;
  -- RUGBY CODE ISOLATION. A Union club is never shown League data and never
  -- the reverse -- an entry that crossed codes would put a League side into a
  -- Union occasion, which is not a scheduling mistake but a different sport.
  select tr.rugby_code into v_tournament_code from public.tournaments tr where tr.id = new.tournament_id;
  if v_team_code is distinct from v_tournament_code then
    raise exception 'A % team cannot be entered into a % tournament.', v_team_code, v_tournament_code using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists tournament_team_entries_validate on public.tournament_team_entries;
create trigger tournament_team_entries_validate
  before insert or update of team_id, club_id, tournament_id on public.tournament_team_entries
  for each row execute function internal.validate_tournament_team_entry();

create or replace function internal.validate_tournament_entry_opponent()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_entry_tournament uuid;
  v_participant_tournament uuid;
begin
  select e.tournament_id into v_entry_tournament from public.tournament_team_entries e where e.id = new.entry_id;
  select p.tournament_id into v_participant_tournament from public.tournament_participants p where p.id = new.participant_id;
  if v_entry_tournament is null or v_participant_tournament is null or v_entry_tournament <> v_participant_tournament then
    raise exception 'An opponent must belong to the same tournament as the team playing it.' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists tournament_entry_opponents_validate on public.tournament_entry_opponents;
create trigger tournament_entry_opponents_validate
  before insert or update on public.tournament_entry_opponents
  for each row execute function internal.validate_tournament_entry_opponent();

create or replace function internal.validate_tournament_game()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_entry_tournament uuid;
  v_opponent_entry uuid;
  v_starts date;
  v_ends date;
  v_host_club uuid;
  v_pitch_club uuid;
begin
  select e.tournament_id into v_entry_tournament from public.tournament_team_entries e where e.id = new.entry_id;
  select o.entry_id into v_opponent_entry from public.tournament_entry_opponents o where o.id = new.opponent_id;
  if v_entry_tournament is null or v_entry_tournament <> new.tournament_id then
    raise exception 'A game must belong to the same tournament as the team playing it.' using errcode = '23514';
  end if;
  -- The opponent must be one THIS team was recorded as playing. This is what
  -- stops a global opponent list from implying every team plays everyone.
  if v_opponent_entry is null or v_opponent_entry <> new.entry_id then
    raise exception 'A game must be against one of that team''s own recorded opponents.' using errcode = '23514';
  end if;

  select tr.event_date, tr.ends_on, tr.host_club_id into v_starts, v_ends, v_host_club
  from public.tournaments tr where tr.id = new.tournament_id;
  if new.game_date < v_starts or new.game_date > v_ends then
    raise exception 'A game must fall on a day the tournament is running.' using errcode = '23514';
  end if;

  -- A canonical pitch identity, or nothing. Free text is never the answer
  -- where a real pitch exists, and a pitch from an unrelated club is never
  -- this tournament's to schedule on.
  if new.pitch_id is not null then
    select cp.club_id into v_pitch_club from public.club_pitches cp where cp.id = new.pitch_id;
    if not exists (
      select 1 from public.tournament_pitches tp
      where tp.tournament_id = new.tournament_id and tp.pitch_id = new.pitch_id
    ) and (v_host_club is null or v_pitch_club is distinct from v_host_club) then
      raise exception 'That pitch is neither reserved by this tournament nor owned by the host club.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tournament_games_validate on public.tournament_games;
create trigger tournament_games_validate
  before insert or update on public.tournament_games
  for each row execute function internal.validate_tournament_game();

create or replace function internal.validate_tournament_pitch_reservation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_host_club uuid;
  v_pitch_club uuid;
  v_starts date;
  v_ends date;
begin
  select tr.host_club_id, tr.event_date, tr.ends_on into v_host_club, v_starts, v_ends
  from public.tournaments tr where tr.id = new.tournament_id;
  select cp.club_id into v_pitch_club from public.club_pitches cp where cp.id = new.pitch_id;
  -- Only the club whose pitches these are can reserve them. A tournament held
  -- at somebody else's ground reserves nothing here, because it occupies none
  -- of this club's pitches -- and saying otherwise would block a pitch that is
  -- in fact free.
  if v_host_club is null or v_pitch_club is distinct from v_host_club then
    raise exception 'A tournament can only reserve pitches belonging to its host club.' using errcode = '23514';
  end if;
  if new.reserved_on < v_starts or new.reserved_on > v_ends then
    raise exception 'A pitch reservation must fall on a day the tournament is running.' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists tournament_pitches_validate on public.tournament_pitches;
create trigger tournament_pitches_validate
  before insert or update on public.tournament_pitches
  for each row execute function internal.validate_tournament_pitch_reservation();

-- ---------------------------------------------------------------------
-- 7. WHO CAN SEE A TOURNAMENT
-- ---------------------------------------------------------------------
-- The original predicate answered only "can this person MANAGE it", so a
-- player or a parent could not see their own child's festival at all. A
-- tournament is a club-and-team artefact exactly as a club event is, and this
-- follows the same shape club_event_visible_row already established.
create or replace function internal.tournament_visible_row(p_tournament_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select
    internal.is_site_admin()

    -- The host, including a still-unclaimed proposal: the club being proposed
    -- to must see it in order to claim it.
    or exists (
      select 1 from public.tournaments t
      join public.clubs c on c.directory_id = t.host_directory_id
      where t.id = p_tournament_id and internal.can_manage_club_fixtures(c.id)
    )

    -- An invited club's own management.
    or exists (
      select 1 from public.tournament_participants tp
      where tp.tournament_id = p_tournament_id
        and ((tp.team_id is not null and internal.can_manage_team(tp.team_id))
             or (tp.club_id is not null and internal.can_manage_club_fixtures(tp.club_id)))
    )

    -- ANYBODY WITH AN ACTIVE ROLE AT A CLUB THAT ENTERED A TEAM. Where the
    -- club is going on Saturday is ordinary club operational information.
    or exists (
      select 1
      from public.tournament_team_entries e
      join public.club_memberships cm on cm.club_id = e.club_id
      where e.tournament_id = p_tournament_id
        and cm.user_id = auth.uid()
        and cm.status = 'active'
    )

    -- THE PEOPLE IT IS ACTUALLY FOR: a player in an entered team, or the
    -- adult responsible for one. Guardians routinely hold no club_memberships
    -- row, so without this a parent loses their own child's tournament.
    or exists (
      select 1
      from public.tournament_team_entries e
      join public.player_team_memberships ptm on ptm.team_id = e.team_id
      where e.tournament_id = p_tournament_id
        and ptm.status = 'active'
        and (internal.is_own_linked_player(ptm.player_id)
             or internal.is_active_player_guardian(ptm.player_id))
    );
$$;

-- The existing predicate now delegates, so every table already policed by it
-- widens consistently and there is only one answer to "who can see this".
create or replace function internal.can_view_tournament(p_tournament_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select internal.tournament_visible_row(p_tournament_id);
$$;

-- ---------------------------------------------------------------------
-- 8. WHO CAN CHANGE WHAT
-- ---------------------------------------------------------------------
-- TWO AUTHORITIES, DELIBERATELY. Changing the occasion itself -- its date,
-- its venue, the pitches it holds -- reaches every team attending, so it
-- needs authority over every team attending. Changing one team's own
-- opponents and schedule reaches only that team.
--
-- This is the Event Centre rule, and it is here for the reason Event Centre
-- taught: an ANY-team test let a U11 admin edit a three-team event.
create or replace function internal.can_manage_tournament(p_tournament_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tournaments t
    where t.id = p_tournament_id
      and (
        internal.is_site_admin()

        -- Club-scope authority at the host club.
        or (t.host_club_id is not null and internal.has_capability('calendar.manage', 'club', t.host_club_id, null))

        -- Club-scope authority at any club that entered a team, for the
        -- ordinary case of a club managing its own trip to somebody else's
        -- festival.
        or exists (
          select 1 from public.tournament_team_entries e
          where e.tournament_id = t.id
            and internal.has_capability('calendar.manage', 'club', e.club_id, null)
        )

        -- Team-scope authority over EVERY entered team, and there must be at
        -- least one. A U12 manager does not get the parent occasion just
        -- because U12 is going.
        or (
          exists (select 1 from public.tournament_team_entries e where e.tournament_id = t.id)
          and not exists (
            select 1 from public.tournament_team_entries e
            where e.tournament_id = t.id
              and not internal.has_capability('calendar.manage', 'team', e.club_id, e.team_id)
          )
        )
      )
  );
$$;

create or replace function internal.can_manage_tournament_entry(p_entry_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tournament_team_entries e
    where e.id = p_entry_id
      and (
        internal.is_site_admin()
        or internal.has_capability('calendar.manage', 'club', e.club_id, null)
        -- THIS team only. The whole point of the split: a U12 admin schedules
        -- U12's day and cannot touch U13's.
        or internal.has_capability('calendar.manage', 'team', e.club_id, e.team_id)
        -- The host club's fixture authority also manages entries at its own
        -- occasion, matching the existing host-and-invite model.
        or exists (
          select 1 from public.tournaments t
          where t.id = e.tournament_id
            and t.host_club_id is not null
            and internal.can_manage_club_fixtures(t.host_club_id)
        )
      )
  );
$$;

-- ---------------------------------------------------------------------
-- 9. RLS
-- ---------------------------------------------------------------------
alter table public.tournament_team_entries enable row level security;
alter table public.tournament_entry_opponents enable row level security;
alter table public.tournament_pitches enable row level security;
alter table public.tournament_games enable row level security;

drop policy if exists tournament_team_entries_select on public.tournament_team_entries;
create policy tournament_team_entries_select on public.tournament_team_entries
  for select to authenticated using (internal.tournament_visible_row(tournament_id));

drop policy if exists tournament_entry_opponents_select on public.tournament_entry_opponents;
create policy tournament_entry_opponents_select on public.tournament_entry_opponents
  for select to authenticated using (exists (
    select 1 from public.tournament_team_entries e
    where e.id = tournament_entry_opponents.entry_id and internal.tournament_visible_row(e.tournament_id)
  ));

drop policy if exists tournament_pitches_select on public.tournament_pitches;
create policy tournament_pitches_select on public.tournament_pitches
  for select to authenticated using (internal.tournament_visible_row(tournament_id));

drop policy if exists tournament_games_select on public.tournament_games;
create policy tournament_games_select on public.tournament_games
  for select to authenticated using (internal.tournament_visible_row(tournament_id));

-- NO INSERT/UPDATE/DELETE POLICIES. Every mutation goes through the
-- SECURITY DEFINER RPCs in the next migration, which is where the
-- parent-versus-entry authority split is actually decided. A table with no
-- write policy is closed to a crafted PostgREST call by construction.

grant select on public.tournament_team_entries to authenticated;
grant select on public.tournament_entry_opponents to authenticated;
grant select on public.tournament_pitches to authenticated;
grant select on public.tournament_games to authenticated;
