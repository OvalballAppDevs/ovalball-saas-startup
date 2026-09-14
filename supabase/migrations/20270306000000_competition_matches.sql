-- COMPETITION MATCHES: THE COMPETITION'S CANONICAL SCHEDULE AND RESULTS.
--
-- A Competition Match is the competition's own record of a match. It always
-- exists, whoever is playing: two Ovalball teams, an Ovalball team and a club
-- that is not on Ovalball, or two clubs that are not on Ovalball at all. League
-- tables, qualification, knockout progression, the organiser's workspace and
-- the public competition pages are built from Competition Matches -- never from
-- public.fixtures.
--
-- A Fixture stays what it is: a club/team's operational record, owned by an
-- Ovalball team. It is a PROJECTION of a Competition Match, created only where
-- an Ovalball team needs one:
--
--   Ovalball v Ovalball   -> one fixture (the one-row inter-club model), owned
--                            by the home team, once both clubs have confirmed
--   Ovalball v external   -> one fixture owned by the Ovalball team, with the
--                            canonical external-opposition fields
--   external v external   -> no fixture; the match is competition-managed only
--
-- AUTHORITY. Organiser authority (internal.can_organise_competition) governs
-- Competition Matches. It grants nothing over any club's fixtures: linked
-- fixtures are created and kept in step by one controlled service
-- (internal.project_competition_match / internal.sync_competition_match_fixtures)
-- and only for fixtures linked to that competition's own matches. A club's own
-- fixture authority governs everything operational about the linked fixture
-- (meet time, attendance, pitch allocation at their ground, messages).
--
-- FIELD OWNERSHIP ON A LINKED FIXTURE.
--   Competition-controlled: date, kick-off, which teams, which side is home,
--   competition edition, fixture type, cancellation. Changed only through the
--   competition; a direct change is refused with a message naming the
--   competition (fixtures_competition_controlled_fields).
--   Club-operational: meet time, notes, venue and pitch at the club's own
--   ground when the organiser left them unset, results entry through Match
--   Centre.
--
-- ONE SCORE AUTHORITY. The Competition Match carries the result. A linked
-- fixture's result, once final, is copied onto the match if the organiser has
-- not already recorded one; an organiser's result is written back to linked
-- fixtures as an external recorded result. Standings read the match only.
--
-- NOTHING IS CANCELLED FOR YOU. Issuing a competition never cancels, replaces
-- or moves an existing fixture. A clash is reported (the application's conflict
-- engine, and the capacity trigger at projection time, recorded in sync_error)
-- and the organiser or club decides.

-- ============================================================
-- Participants
-- ============================================================

create table public.competition_participants (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.competition_editions(id) on delete cascade,
  slot integer not null check (slot >= 1),
  club_directory_id uuid not null references public.club_directory(id),
  club_id uuid references public.clubs(id),
  team_id uuid references public.teams(id),
  canonical_team_type_id uuid references public.canonical_team_types(id),
  squad_label text,
  seed integer check (seed is null or seed >= 1),
  status text not null default 'entered' check (status in ('entered', 'withdrawn')),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competition_participants_team_needs_club check (team_id is null or club_id is not null),
  unique (edition_id, slot)
);

create unique index competition_participants_one_team_per_edition
  on public.competition_participants (edition_id, team_id) where team_id is not null and status = 'entered';
create unique index competition_participants_one_external_entry
  on public.competition_participants (edition_id, club_directory_id, coalesce(canonical_team_type_id::text, ''), coalesce(lower(squad_label), ''))
  where team_id is null and status = 'entered';

comment on table public.competition_participants is
  'An entrant in one competition edition. Always a Club Directory club; a real Ovalball team when the club is on Ovalball and entered one. Duplicate entries are refused by index.';

create or replace function internal.validate_competition_participant()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_code text;
  v_team_club uuid;
  v_team_code text;
  v_club_directory uuid;
  v_directory_code text;
begin
  select rugby_code into v_code from public.competition_editions where id = new.edition_id;
  select rugby_code into v_directory_code from public.club_directory where id = new.club_directory_id;
  if v_directory_code is distinct from v_code then
    raise exception 'That club plays % and this competition is %.', coalesce(initcap(v_directory_code), 'another code'), initcap(v_code) using errcode = '23514';
  end if;
  if new.club_id is not null then
    select directory_id into v_club_directory from public.clubs where id = new.club_id;
    if v_club_directory is distinct from new.club_directory_id then
      raise exception 'That Ovalball club is not the Club Directory club entered.' using errcode = '23514';
    end if;
  end if;
  if new.team_id is not null then
    select club_id, rugby_code into v_team_club, v_team_code from public.teams where id = new.team_id;
    if v_team_club is distinct from new.club_id then
      raise exception 'That team does not belong to the club entered.' using errcode = '23514';
    end if;
    if v_team_code is distinct from v_code then
      raise exception 'That team plays a different rugby code from this competition.' using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger competition_participants_validate
  before insert or update on public.competition_participants
  for each row execute function internal.validate_competition_participant();

-- ============================================================
-- Stages, groups, rounds
-- ============================================================

create table public.competition_stages (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.competition_editions(id) on delete cascade,
  kind text not null check (kind in ('league', 'knockout')),
  name text not null,
  sort_order integer not null default 1,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.competition_stages.settings is
  'Organiser choices, kept visible and editable: league {matches: single|double|custom, perTeam, points: {win, draw, loss}}, knockout {seeding, legs, thirdPlace, homeAllocation, finalVenueId, qualification}.';

create table public.competition_groups (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.competition_stages(id) on delete cascade,
  name text not null,
  sort_order integer not null default 1,
  unique (stage_id, name)
);

create table public.competition_group_members (
  group_id uuid not null references public.competition_groups(id) on delete cascade,
  stage_id uuid not null references public.competition_stages(id) on delete cascade,
  participant_id uuid not null references public.competition_participants(id) on delete cascade,
  position integer not null default 1,
  primary key (group_id, participant_id),
  unique (stage_id, participant_id)
);

create table public.competition_rounds (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.competition_stages(id) on delete cascade,
  round_number integer not null check (round_number >= 1),
  name text,
  round_date date,
  unique (stage_id, round_number)
);

-- ============================================================
-- The Competition Match
-- ============================================================

create table public.competition_matches (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.competition_editions(id) on delete cascade,
  stage_id uuid not null references public.competition_stages(id) on delete cascade,
  group_id uuid references public.competition_groups(id) on delete set null,
  round_number integer check (round_number is null or round_number >= 1),
  bracket_slot integer check (bracket_slot is null or bracket_slot >= 1),
  home_participant_id uuid references public.competition_participants(id) on delete restrict,
  away_participant_id uuid references public.competition_participants(id) on delete restrict,
  home_source jsonb,
  away_source jsonb,
  match_date date,
  kickoff_time time,
  venue_id uuid references public.venues(id),
  venue_text text,
  pitch_id uuid references public.club_pitches(id),
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'issued', 'confirmed', 'change_requested', 'completed', 'cancelled', 'postponed')),
  verification_state text not null default 'not_required'
    check (verification_state in ('not_required', 'awaiting', 'confirmed', 'change_requested', 'declined')),
  home_score integer check (home_score is null or home_score >= 0),
  away_score integer check (away_score is null or away_score >= 0),
  winner_participant_id uuid references public.competition_participants(id),
  result_source text check (result_source is null or result_source in ('organiser', 'fixture')),
  is_public boolean not null default true,
  notes text,
  sync_error text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competition_matches_no_self_match check (home_participant_id is null or away_participant_id is null or home_participant_id <> away_participant_id),
  constraint competition_matches_scores_together check ((home_score is null) = (away_score is null))
);

create index competition_matches_edition_idx on public.competition_matches (edition_id, stage_id, round_number);
create index competition_matches_participants_idx on public.competition_matches (home_participant_id, away_participant_id);

comment on table public.competition_matches is
  'The canonical competition schedule/result record. Exists for every competition match including external v external. Fixtures are projections of it (competition_match_fixtures).';
comment on column public.competition_matches.home_source is
  'Where a not-yet-known participant comes from: {"winner_of": match_id}, {"loser_of": match_id}, {"group_id": id, "position": n}.';
comment on column public.competition_matches.sync_error is
  'Why the last projection or sync of this match to a club fixture did not happen (e.g. the team already has a fixture that day). Nothing is cancelled to make room.';

create table public.competition_match_verifications (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.competition_matches(id) on delete cascade,
  participant_id uuid not null references public.competition_participants(id) on delete cascade,
  club_id uuid not null references public.clubs(id),
  team_id uuid references public.teams(id),
  status text not null default 'awaiting' check (status in ('awaiting', 'confirmed', 'change_requested', 'declined')),
  proposed_date date,
  proposed_kickoff_time time,
  proposed_venue_id uuid references public.venues(id),
  proposed_pitch_id uuid references public.club_pitches(id),
  message text,
  responded_by uuid references auth.users(id),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, participant_id)
);

comment on table public.competition_match_verifications is
  'An Ovalball club''s answer to a competition match it has been issued: Confirm, Request Change (with a proposed date, kick-off, venue, pitch and message) or Decline. Issuing never bypasses it.';

create table public.competition_match_fixtures (
  match_id uuid not null references public.competition_matches(id) on delete restrict,
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (match_id, fixture_id),
  unique (fixture_id)
);

comment on table public.competition_match_fixtures is
  'Explicit competition-origin linkage. A match with a linked fixture cannot be deleted (restrict); it is cancelled, which cancels its fixture through the sync service.';

-- ============================================================
-- Read access. Writes go through the RPCs below only.
-- ============================================================

create or replace function internal.competition_edition_is_public(p_edition_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.competition_editions e join public.competitions c on c.id = e.competition_id
    where e.id = p_edition_id and e.active and c.active
  );
$$;

create or replace function internal.can_organise_edition(p_edition_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.competition_editions e
    where e.id = p_edition_id and internal.can_organise_competition(e.competition_id)
  );
$$;

alter table public.competition_participants enable row level security;
alter table public.competition_stages enable row level security;
alter table public.competition_groups enable row level security;
alter table public.competition_group_members enable row level security;
alter table public.competition_rounds enable row level security;
alter table public.competition_matches enable row level security;
alter table public.competition_match_verifications enable row level security;
alter table public.competition_match_fixtures enable row level security;

create policy competition_participants_read on public.competition_participants for select to anon, authenticated
  using (internal.competition_edition_is_public(edition_id) or internal.can_organise_edition(edition_id));
create policy competition_stages_read on public.competition_stages for select to anon, authenticated
  using (internal.competition_edition_is_public(edition_id) or internal.can_organise_edition(edition_id));
create policy competition_groups_read on public.competition_groups for select to anon, authenticated
  using (exists (select 1 from public.competition_stages s where s.id = stage_id
    and (internal.competition_edition_is_public(s.edition_id) or internal.can_organise_edition(s.edition_id))));
create policy competition_group_members_read on public.competition_group_members for select to anon, authenticated
  using (exists (select 1 from public.competition_stages s where s.id = stage_id
    and (internal.competition_edition_is_public(s.edition_id) or internal.can_organise_edition(s.edition_id))));
create policy competition_rounds_read on public.competition_rounds for select to anon, authenticated
  using (exists (select 1 from public.competition_stages s where s.id = stage_id
    and (internal.competition_edition_is_public(s.edition_id) or internal.can_organise_edition(s.edition_id))));
-- Draft matches are the organiser's working copy; the public sees a match once it is scheduled.
create policy competition_matches_read on public.competition_matches for select to anon, authenticated
  using (
    internal.can_organise_edition(edition_id)
    or (is_public and status <> 'draft' and internal.competition_edition_is_public(edition_id))
  );
create policy competition_match_verifications_read on public.competition_match_verifications for select to authenticated
  using (
    internal.can_bulk_plan_fixtures(club_id)
    or (team_id is not null and internal.can_create_team_fixture(club_id, team_id))
    or exists (select 1 from public.competition_matches m where m.id = match_id and internal.can_organise_edition(m.edition_id))
  );
-- (Reading an answer is broader than giving one: see internal.can_answer_competition_match.)
create policy competition_match_fixtures_read on public.competition_match_fixtures for select to authenticated
  using (
    exists (select 1 from public.competition_matches m where m.id = match_id and internal.can_organise_edition(m.edition_id))
    or exists (select 1 from public.fixtures f where f.id = fixture_id)
  );

grant select on public.competition_participants, public.competition_stages, public.competition_groups,
  public.competition_group_members, public.competition_rounds, public.competition_matches to anon, authenticated;
grant select on public.competition_match_verifications, public.competition_match_fixtures to authenticated;
revoke insert, update, delete on public.competition_participants, public.competition_stages, public.competition_groups,
  public.competition_group_members, public.competition_rounds, public.competition_matches,
  public.competition_match_verifications, public.competition_match_fixtures from anon, authenticated;

-- ============================================================
-- Notifications
-- ============================================================

insert into public.notification_types (type_key, topic_key) values
  ('competition_match_verification_requested', 'fixture_requests'),
  ('competition_match_response', 'fixture_requests'),
  ('competition_match_changed', 'fixture_updates'),
  ('competition_match_cancelled', 'fixture_updates')
on conflict (type_key) do nothing;

-- The club fixture administrators of a club, and the staff of one team there.
create or replace function internal.competition_club_recipients(p_club_id uuid, p_team_id uuid)
returns table (user_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $$
  select cm.user_id from public.club_memberships cm
  where cm.club_id = p_club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
  union
  select cm.user_id from public.team_permissions tp
  join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
  where p_team_id is not null and tp.team_id = p_team_id and tp.permission in ('team_admin', 'coach', 'manager');
$$;

create or replace function internal.competition_match_label(p_match_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select format('%s: %s v %s',
    c.name,
    coalesce((select d.name from public.competition_participants p join public.club_directory d on d.id = p.club_directory_id where p.id = m.home_participant_id), 'TBC'),
    coalesce((select d.name from public.competition_participants p join public.club_directory d on d.id = p.club_directory_id where p.id = m.away_participant_id), 'TBC'))
  from public.competition_matches m
  join public.competition_editions e on e.id = m.edition_id
  join public.competitions c on c.id = e.competition_id
  where m.id = p_match_id;
$$;

-- ============================================================
-- The controlled projection and sync service
-- ============================================================

-- The linked fixture's competition-controlled fields may change only inside
-- this service. Anything else is refused, naming the competition.
create or replace function internal.guard_competition_controlled_fixture_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_name text;
begin
  if coalesce(current_setting('ovalball.competition_sync', true), '') = 'on' then
    return new;
  end if;
  select c.name into v_name
  from public.competition_match_fixtures l
  join public.competition_matches m on m.id = l.match_id
  join public.competition_editions e on e.id = m.edition_id
  join public.competitions c on c.id = e.competition_id
  where l.fixture_id = new.id;
  if v_name is null then
    return new;
  end if;
  if new.kickoff_date is distinct from old.kickoff_date
     or new.kickoff_time is distinct from old.kickoff_time
     or new.owning_team_id is distinct from old.owning_team_id
     or new.opponent_team_id is distinct from old.opponent_team_id
     or new.opponent_directory_id is distinct from old.opponent_directory_id
     or new.home_away is distinct from old.home_away
     or new.competition_edition_id is distinct from old.competition_edition_id
     or (new.status = 'Cancelled' and old.status is distinct from 'Cancelled') then
    raise exception 'This fixture is scheduled by the competition "%". Its date, kick-off, teams and cancellation are changed through the competition -- ask the organiser, or request a change from the competition match.', v_name
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger fixtures_competition_controlled_fields
  before update on public.fixtures
  for each row execute function internal.guard_competition_controlled_fixture_fields();

create or replace function internal.project_competition_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  m public.competition_matches;
  hp public.competition_participants;
  ap public.competition_participants;
  v_stage_kind text;
  v_owner public.competition_participants;
  v_other public.competition_participants;
  v_owner_is_home boolean;
  v_owner_club uuid;
  v_fixture uuid;
  v_other_name text;
begin
  select * into m from public.competition_matches where id = p_match_id;
  if not found or m.home_participant_id is null or m.away_participant_id is null then
    return;
  end if;
  if exists (select 1 from public.competition_match_fixtures where match_id = m.id) then
    perform internal.sync_competition_match_fixtures(m.id);
    return;
  end if;
  if m.status in ('draft', 'cancelled', 'postponed', 'change_requested') or m.verification_state in ('awaiting', 'change_requested', 'declined') then
    return;
  end if;
  if m.match_date is null then
    update public.competition_matches set sync_error = 'A club fixture is created once this match has a date.' where id = m.id;
    return;
  end if;

  select * into hp from public.competition_participants where id = m.home_participant_id;
  select * into ap from public.competition_participants where id = m.away_participant_id;
  select kind into v_stage_kind from public.competition_stages where id = m.stage_id;

  if hp.team_id is null and ap.team_id is null then
    -- External v external: competition-managed only. Nothing to project.
    update public.competition_matches set sync_error = null where id = m.id;
    return;
  end if;

  if hp.team_id is not null then
    v_owner := hp; v_other := ap; v_owner_is_home := true;
  else
    v_owner := ap; v_other := hp; v_owner_is_home := false;
  end if;
  v_owner_club := v_owner.club_id;
  select name into v_other_name from public.club_directory where id = v_other.club_directory_id;

  perform set_config('ovalball.competition_sync', 'on', true);
  begin
    insert into public.fixtures (
      owning_team_id, home_away, opponent_team_id, opponent_directory_id, raw_opposition_text,
      kickoff_date, kickoff_time, game_type, status, source, competition_edition_id,
      venue_id, pitch_id, venue_address, created_by
    )
    values (
      v_owner.team_id,
      case when v_owner_is_home then 'Home' else 'Away' end,
      v_other.team_id,
      case when v_other.team_id is null then v_other.club_directory_id end,
      coalesce(v_other_name, 'Opposition'),
      m.match_date, m.kickoff_time,
      case v_stage_kind when 'knockout' then 'Cup Fixture' else 'League Fixture' end,
      case when m.kickoff_time is not null then 'Booked' else 'Planned' end,
      'competition_import',
      m.edition_id,
      case when v_owner_is_home and exists (select 1 from public.venues v where v.id = m.venue_id and v.club_id = v_owner_club) then m.venue_id end,
      case when v_owner_is_home and exists (select 1 from public.club_pitches p where p.id = m.pitch_id and p.club_id = v_owner_club) then m.pitch_id end,
      case when not v_owner_is_home then m.venue_text end,
      auth.uid()
    )
    returning id into v_fixture;
  exception when others then
    perform set_config('ovalball.competition_sync', 'off', true);
    update public.competition_matches set sync_error = sqlerrm where id = m.id;
    return;
  end;
  perform set_config('ovalball.competition_sync', 'off', true);

  insert into public.competition_match_fixtures (match_id, fixture_id) values (m.id, v_fixture);
  update public.competition_matches set sync_error = null where id = m.id;
end;
$$;

create or replace function internal.sync_competition_match_fixtures(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  m public.competition_matches;
  l record;
  v_fixture public.fixtures;
  v_owner_is_home boolean;
  v_owner_club uuid;
  hp public.competition_participants;
  ap public.competition_participants;
begin
  select * into m from public.competition_matches where id = p_match_id;
  if not found then
    return;
  end if;
  select * into hp from public.competition_participants where id = m.home_participant_id;
  select * into ap from public.competition_participants where id = m.away_participant_id;

  for l in select fixture_id from public.competition_match_fixtures where match_id = m.id loop
    select * into v_fixture from public.fixtures where id = l.fixture_id;
    continue when not found;

    -- The owning team must still be one of this match's teams. If the organiser
    -- replaced it, the old fixture is cancelled and a new one projected.
    if v_fixture.owning_team_id is distinct from hp.team_id and v_fixture.owning_team_id is distinct from ap.team_id then
      perform set_config('ovalball.competition_sync', 'on', true);
      update public.fixtures
      set status = 'Cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
          cancellation_reason = 'The competition replaced this team in the match.'
      where id = v_fixture.id and status <> 'Cancelled';
      perform set_config('ovalball.competition_sync', 'off', true);
      delete from public.competition_match_fixtures where match_id = m.id and fixture_id = v_fixture.id;
      continue;
    end if;

    v_owner_is_home := v_fixture.owning_team_id = hp.team_id;
    select club_id into v_owner_club from public.teams where id = v_fixture.owning_team_id;

    perform set_config('ovalball.competition_sync', 'on', true);
    begin
      if m.status in ('cancelled', 'postponed') then
        update public.fixtures
        set status = 'Cancelled', cancelled_at = coalesce(cancelled_at, now()), cancelled_by = coalesce(cancelled_by, auth.uid()),
            cancellation_reason = coalesce(cancellation_reason, case m.status when 'postponed' then 'Postponed by the competition.' else 'Cancelled by the competition.' end)
        where id = v_fixture.id and status <> 'Cancelled';
      elsif m.match_date is not null then
        update public.fixtures
        set kickoff_date = m.match_date,
            kickoff_time = m.kickoff_time,
            home_away = case when v_owner_is_home then 'Home' else 'Away' end,
            opponent_team_id = case when v_owner_is_home then ap.team_id else hp.team_id end,
            opponent_directory_id = case when (case when v_owner_is_home then ap.team_id else hp.team_id end) is null
              then (case when v_owner_is_home then ap.club_directory_id else hp.club_directory_id end) end,
            competition_edition_id = m.edition_id,
            venue_id = case when v_owner_is_home and m.venue_id is not null
              and exists (select 1 from public.venues v where v.id = m.venue_id and v.club_id = v_owner_club) then m.venue_id else v_fixture.venue_id end,
            pitch_id = case when v_owner_is_home and m.pitch_id is not null
              and exists (select 1 from public.club_pitches p where p.id = m.pitch_id and p.club_id = v_owner_club) then m.pitch_id else v_fixture.pitch_id end,
            home_score = case when m.home_score is not null then (case when v_owner_is_home then m.home_score else m.away_score end) else v_fixture.home_score end,
            away_score = case when m.home_score is not null then (case when v_owner_is_home then m.away_score else m.home_score end) else v_fixture.away_score end,
            result_status = case when m.home_score is not null and m.result_source = 'organiser' then 'external_recorded' else v_fixture.result_status end,
            updated_by = auth.uid()
        where id = v_fixture.id;
      end if;
      update public.competition_matches set sync_error = null where id = m.id;
    exception when others then
      update public.competition_matches set sync_error = sqlerrm where id = m.id;
    end;
    perform set_config('ovalball.competition_sync', 'off', true);
  end loop;
end;
$$;

-- A final fixture result reaches the Competition Match, unless the organiser
-- has already recorded one there.
create or replace function internal.competition_result_from_fixture()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  l record;
  hp_team uuid;
begin
  if new.result_status is distinct from 'final' or old.result_status = 'final' or new.home_score is null then
    return new;
  end if;
  for l in
    select m.id, m.result_source, hp.team_id as home_team
    from public.competition_match_fixtures cmf
    join public.competition_matches m on m.id = cmf.match_id
    left join public.competition_participants hp on hp.id = m.home_participant_id
    where cmf.fixture_id = new.id
  loop
    if l.result_source = 'organiser' then
      continue;
    end if;
    update public.competition_matches
    set home_score = case when new.owning_team_id = l.home_team then new.home_score else new.away_score end,
        away_score = case when new.owning_team_id = l.home_team then new.away_score else new.home_score end,
        result_source = 'fixture',
        status = 'completed',
        winner_participant_id = case
          when new.home_score = new.away_score then winner_participant_id
          when (new.home_score > new.away_score) = (new.owning_team_id = l.home_team) then home_participant_id
          else away_participant_id end,
        updated_at = now()
    where id = l.id;
    perform internal.advance_competition_knockout(l.id);
  end loop;
  return new;
end;
$$;

create trigger fixtures_result_to_competition
  after update of result_status on public.fixtures
  for each row execute function internal.competition_result_from_fixture();

-- Knockout progression: a decided match fills the places that wait for it.
create or replace function internal.advance_competition_knockout(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  m public.competition_matches;
  v_loser uuid;
begin
  select * into m from public.competition_matches where id = p_match_id;
  if not found or m.winner_participant_id is null then
    return;
  end if;
  v_loser := case when m.winner_participant_id = m.home_participant_id then m.away_participant_id else m.home_participant_id end;

  update public.competition_matches set home_participant_id = m.winner_participant_id, updated_at = now()
  where edition_id = m.edition_id and home_source->>'winner_of' = m.id::text and home_participant_id is distinct from m.winner_participant_id;
  update public.competition_matches set away_participant_id = m.winner_participant_id, updated_at = now()
  where edition_id = m.edition_id and away_source->>'winner_of' = m.id::text and away_participant_id is distinct from m.winner_participant_id;
  update public.competition_matches set home_participant_id = v_loser, updated_at = now()
  where edition_id = m.edition_id and home_source->>'loser_of' = m.id::text and home_participant_id is distinct from v_loser;
  update public.competition_matches set away_participant_id = v_loser, updated_at = now()
  where edition_id = m.edition_id and away_source->>'loser_of' = m.id::text and away_participant_id is distinct from v_loser;
end;
$$;
