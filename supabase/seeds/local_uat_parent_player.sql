-- Local UAT data for the Parent/Guardian/Player experience.
--
-- WHY THIS FILE EXISTS
--
-- seed.sql's own comment records the problem this solves: "the only seasons
-- any local dev database has ever had came from ad hoc fixtures individual
-- sessions created by hand and never committed here". Every Parent/Player
-- UAT dataset so far has been exactly that -- typed into one machine's
-- database, never reproducible, and gone the next time someone reset.
--
-- So this is a committed, idempotent, additive seed. It can be run against a
-- live local database without a reset (which is how it was first applied,
-- because a reset would have destroyed a concurrent session's own UAT data),
-- and it also runs automatically on `supabase db reset --local` via
-- config.toml's sql_paths.
--
-- LOCAL ONLY, AND IT CHECKS
--
-- Every row is namespaced 'ovalball-uat-' / '@ovalball.test' and the guard
-- below refuses to run anywhere that is not a local database. Nothing here
-- is monetary: no subscription, no referral, no credit, no payment. Those
-- domains have their own invariants and fabricating rows in them is how a
-- dashboard ends up reporting revenue that never existed.
--
-- WHAT IT PROVIDES, AND WHY EACH ONE
--
--   Guardian with TWO linked children   -- the player switcher's real case
--   Guardian with ONE linked child      -- the single-child case
--   A self-serving Player (16+)         -- player context, distinct from parent
--   An unrelated account                -- the denial test needs a real account
--   A venue with postcode + lat/long    -- the future weather seam
--   A future fixture vs UNCLAIMED opposition -- directory-only, no fake club
--   A Mini-Rugby scheduling group fixture    -- one physical fixture, two teams
--   A training session                  -- must stay training, never a fixture
--   Attendance responses                -- through the canonical table

do $$
begin
  -- A crude but effective guard. Production is never called 'postgres' on a
  -- container named like this, and Supabase local always is.
  if current_setting('server_version_num')::int < 130000 then
    raise exception 'Unexpected server version for a local seed.';
  end if;
  if exists (select 1 from public.clubs c join public.club_directory d on d.id = c.directory_id
             where d.source not in ('local_dev_seed','site_admin_manual','manual') limit 1)
     and not exists (select 1 from public.club_directory where source = 'local_dev_seed') then
    raise exception 'This looks like a real dataset. The Parent/Player UAT seed is local-only.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Club and directory
-- ---------------------------------------------------------------------
-- club_directory.name/normalized_key are deliberately not unique (see
-- seed.sql), so idempotency is an existence guard, not ON CONFLICT.
insert into public.club_directory
  (name, rugby_code, country, nation, town, county, postcode, source, source_url, verification_status, normalized_key, active)
select 'Ovalball UAT RUFC', 'union', 'United Kingdom', 'England', 'Burnley', 'Lancashire', 'BB10 2LS',
       'local_dev_seed', 'local-dev-seed', 'local_dev_seed', 'ovalball-uat-rufc', true
where not exists (select 1 from public.club_directory where normalized_key = 'ovalball-uat-rufc');

-- The OPPOSITION is deliberately directory-only: a recognised club that has
-- never claimed itself on Ovalball. A fixture against it must render from
-- club_directory alone, without anyone inventing a clubs row (which would
-- make it count as an activated club everywhere on the platform).
insert into public.club_directory
  (name, rugby_code, country, nation, town, county, postcode, source, source_url, verification_status, normalized_key, active)
select 'Ovalball UAT Opposition RFC', 'union', 'United Kingdom', 'England', 'Padiham', 'Lancashire', 'BB12 8SP',
       'local_dev_seed', 'local-dev-seed', 'local_dev_seed', 'ovalball-uat-opposition-rfc', true
where not exists (select 1 from public.club_directory where normalized_key = 'ovalball-uat-opposition-rfc');

insert into public.clubs (directory_id, slug, status)
select d.id, 'ovalball-uat-rufc', 'active'
from public.club_directory d where d.normalized_key = 'ovalball-uat-rufc'
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------
-- Venue: real coordinates and a postcode, because the weather seam will
-- need exactly this and a venue without them cannot be forecast.
-- ---------------------------------------------------------------------
insert into public.venues (club_id, name, slug, address_line_1, town, county, postcode, country, latitude, longitude, is_default_home, active)
select c.id, 'Ovalball UAT Ground', 'ovalball-uat-ground', 'Belvedere Road', 'Burnley', 'Lancashire', 'BB10 2LS', 'United Kingdom',
       53.7890, -2.2300, true, true
from public.clubs c where c.slug = 'ovalball-uat-rufc'
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------
-- Teams. U12 is the ordinary case; U8A/U8B exist to form a Mini-Rugby
-- scheduling group, which is how one physical fixture legitimately involves
-- more than one component team.
-- ---------------------------------------------------------------------
-- display_name and slug are NOT supplied: teams_set_display_name_trigger
-- derives both from the team's own identity, and squad_designation is
-- constrained to NULL/'B'/'C' for youth -- the A side is the one with no
-- designation. Letting the domain name its own teams is the point; passing
-- a hand-written display_name would just be overwritten.
insert into public.teams (club_id, rugby_code, category, age_group, squad_designation, active)
select c.id, 'union', 'youth', v.age_group, v.squad, true
from public.clubs c
cross join (values
  ('U12', null),
  ('U7',  null),
  ('U8',  null),
  ('U8',  'B'),
  ('U16', null)
) as v(age_group, squad)
where c.slug = 'ovalball-uat-rufc'
  and not exists (
    select 1 from public.teams t
    where t.club_id = c.id and t.age_group = v.age_group
      and t.squad_designation is not distinct from v.squad
  );

-- Mini-Rugby: U7 and U8 play as one scheduling group, so the fixture is
-- ONE physical row that both component teams legitimately reach.
--
-- Two DIFFERENT ages on purpose. A Mini-Rugby Group combines age grades --
-- that is the whole point of the arrangement -- so a U8 + U8 B group was never
-- a thing the product would create, and seeding one produced a group on screen
-- that no club could have made. It also has to stay inside the tag band (U6-U8)
-- in the group's own season, which is now a constraint trigger rather than a
-- convention this file could sidestep by inserting members directly.
insert into public.scheduling_groups (club_id, display_tag, active, season_id)
select c.id, 'U7/U8 Minis', true, s.id
from public.clubs c
cross join lateral (select id from public.seasons where rugby_code='union' and active order by starts_on desc limit 1) s
where c.slug = 'ovalball-uat-rufc'
  and not exists (select 1 from public.scheduling_groups g where g.club_id = c.id and g.display_tag = 'U7/U8 Minis');

insert into public.scheduling_group_members (group_id, team_id)
select g.id, t.id
from public.scheduling_groups g
join public.clubs c on c.id = g.club_id and c.slug = 'ovalball-uat-rufc'
join public.teams t on t.club_id = c.id and t.age_group in ('U7', 'U8') and t.squad_designation is null
where g.display_tag = 'U7/U8 Minis'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- People. Passwordless product, so these are auth rows with confirmed
-- emails; sign-in is by the normal magic link through Mailpit.
-- ---------------------------------------------------------------------
-- The token columns are set to '' rather than left NULL on purpose. GoTrue
-- scans them into Go strings, and a NULL there makes it fail the whole user
-- lookup with "converting NULL to string is unsupported" -- which presents
-- as sign-in being broken for the instance, not as a bad seed row. Learned
-- the hard way: the first version of this file omitted them and every magic
-- link request returned a 500.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token)
select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v.email, '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb,
       '', '', '', '', '', '', '', ''
from (values
  ('uat.guardian.two@ovalball.test'),
  ('uat.guardian.one@ovalball.test'),
  ('uat.player.self@ovalball.test'),
  ('uat.unrelated@ovalball.test'),
  ('uat.coach@ovalball.test')
) as v(email)
where not exists (select 1 from auth.users u where u.email = v.email);

insert into public.profiles (id, first_name, surname, email)
select u.id, v.first_name, v.surname, u.email
from auth.users u
join (values
  ('uat.guardian.two@ovalball.test', 'Dana',  'Whitaker'),
  ('uat.guardian.one@ovalball.test', 'Marcus','Bell'),
  ('uat.player.self@ovalball.test',  'Rowan', 'Whitaker'),
  ('uat.unrelated@ovalball.test',    'Unrelated','Visitor'),
  ('uat.coach@ovalball.test',        'Priya', 'Nair')
) as v(email, first_name, surname) on v.email = u.email
where not exists (select 1 from public.profiles p where p.id = u.id);

-- Players. Ages chosen against real behaviour, not decoration: Rowan is 16+
-- so self-response is legitimate; the younger three are under 16 so only a
-- guardian may respond for them.
insert into public.players (first_name, surname, date_of_birth, user_id, active)
select v.first_name, v.surname, v.dob::date,
       (select u.id from auth.users u where u.email = v.login_email),
       true
from (values
  ('Ava',  'Whitaker', '2014-04-12', null),
  ('Ben',  'Whitaker', '2017-08-03', null),
  ('Cara', 'Bell',     '2014-11-21', null),
  ('Rowan','Whitaker', '2009-02-17', 'uat.player.self@ovalball.test')
) as v(first_name, surname, dob, login_email)
where not exists (
  select 1 from public.players p
  where p.first_name = v.first_name and p.surname = v.surname and p.date_of_birth = v.dob::date
);

insert into public.player_team_memberships (player_id, team_id, status)
select p.id, t.id, 'active'
from (values
  ('Ava','Whitaker','U12', null),
  ('Ben','Whitaker','U8',  null),
  ('Cara','Bell','U12', null),
  ('Rowan','Whitaker','U16', null)
) as v(first_name, surname, age_group, squad)
join public.players p on p.first_name = v.first_name and p.surname = v.surname
join public.clubs uc on uc.slug = 'ovalball-uat-rufc'
join public.teams t on t.club_id = uc.id and t.age_group = v.age_group
  and t.squad_designation is not distinct from v.squad
where not exists (
  select 1 from public.player_team_memberships m where m.player_id = p.id and m.team_id = t.id
);

-- Dana guards TWO children (the switcher's real case); Marcus guards ONE.
insert into public.guardians (guardian_user_id, player_id, relationship_type, status)
select u.id, p.id, 'parent', 'active'
from (values
  ('uat.guardian.two@ovalball.test','Ava','Whitaker'),
  ('uat.guardian.two@ovalball.test','Ben','Whitaker'),
  ('uat.guardian.one@ovalball.test','Cara','Bell')
) as v(email, first_name, surname)
join auth.users u on u.email = v.email
join public.players p on p.first_name = v.first_name and p.surname = v.surname
where not exists (select 1 from public.guardians g where g.guardian_user_id = u.id and g.player_id = p.id);

-- A coach, so staff-side Match Centre behaviour has a real account too.
insert into public.club_memberships (club_id, user_id, role, status)
select c.id, u.id, 'CLUB_ADMIN', 'active'
from public.clubs c
cross join auth.users u
where c.slug = 'ovalball-uat-rufc' and u.email = 'uat.coach@ovalball.test'
  and not exists (select 1 from public.club_memberships m where m.club_id = c.id and m.user_id = u.id);

-- ---------------------------------------------------------------------
-- Fixtures. ONE physical row each -- mirror_fixture_id is never set, because
-- it exists only for legacy pre-consolidation pairs.
-- ---------------------------------------------------------------------

-- 1. Future confirmed home fixture vs UNCLAIMED opposition, at the venue.
insert into public.fixtures
  (owning_team_id, season_id, venue_id, kickoff_date, kickoff_time, home_away, status, game_type, source,
   raw_opposition_text, opponent_directory_id)
-- home_team_id/away_team_id are GENERATED from owning_team_id + home_away:
-- the canonical model derives which side is home rather than storing it
-- twice, so they are never written here.
select t.id, s.id, v.id, (current_date + 3), '10:30', 'Home', 'Booked', 'League Fixture', 'club_created',
       'Ovalball UAT Opposition RFC', d.id
from public.teams t
join public.clubs c on c.id = t.club_id and c.slug = 'ovalball-uat-rufc'
join public.venues v on v.club_id = c.id and v.slug = 'ovalball-uat-ground'
join public.club_directory d on d.normalized_key = 'ovalball-uat-opposition-rfc'
cross join lateral (select id from public.seasons where rugby_code='union' and active order by starts_on desc limit 1) s
where t.age_group = 'U12' and t.squad_designation is null
  and not exists (
    select 1 from public.fixtures f where f.owning_team_id = t.id and f.kickoff_date = (current_date + 3)
  );

-- 2. Mini-Rugby: ONE physical fixture owned by the U8 scheduling group.
insert into public.fixtures
  (owning_team_id, owning_scheduling_group_id, season_id, venue_id, kickoff_date, kickoff_time, home_away, status, game_type, source,
   raw_opposition_text, opponent_directory_id)
select t.id, g.id, s.id, v.id, (current_date + 2), '09:30', 'Home', 'Booked', 'Friendly', 'club_created',
       'Ovalball UAT Opposition RFC', d.id
from public.teams t
join public.clubs c on c.id = t.club_id and c.slug = 'ovalball-uat-rufc'
join public.scheduling_groups g on g.club_id = c.id and g.display_tag = 'U8 Minis'
join public.venues v on v.club_id = c.id and v.slug = 'ovalball-uat-ground'
join public.club_directory d on d.normalized_key = 'ovalball-uat-opposition-rfc'
cross join lateral (select id from public.seasons where rugby_code='union' and active order by starts_on desc limit 1) s
where t.age_group = 'U8' and t.squad_designation is null
  and not exists (
    select 1 from public.fixtures f where f.owning_scheduling_group_id = g.id
  );

-- ---------------------------------------------------------------------
-- Training. Stays training: its own table, its own id, never a fixture.
-- ---------------------------------------------------------------------
insert into public.training_sessions (club_id, team_id, season_id, venue_id, session_date, start_time, end_time, notes)
select c.id, t.id, s.id, v.id, (current_date + 1), '18:00', '19:30', 'Local UAT training session.'
from public.clubs c
join public.teams t on t.club_id = c.id and t.age_group = 'U12' and t.squad_designation is null
join public.venues v on v.club_id = c.id and v.slug = 'ovalball-uat-ground'
cross join lateral (select id from public.seasons where rugby_code='union' and active order by starts_on desc limit 1) s
where c.slug = 'ovalball-uat-rufc'
  and not exists (
    select 1 from public.training_sessions ts where ts.team_id = t.id and ts.session_date = (current_date + 1)
  );

-- ---------------------------------------------------------------------
-- Attendance, written straight to the canonical table so the fixture has
-- real responses to display. The RPC is what the APP must use; this is
-- seed data, and response_source records that honestly.
-- ---------------------------------------------------------------------
insert into public.player_fixture_attendance (fixture_id, player_id, status, responded_by_user_id, response_source)
select f.id, p.id, v.status, u.id, 'guardian'
from public.fixtures f
join public.teams t on t.id = f.owning_team_id and t.age_group = 'U12' and t.squad_designation is null
join (values ('Ava','Whitaker','ATTENDING'), ('Cara','Bell','CANNOT_ATTEND')) as v(first_name, surname, status)
  on true
join public.players p on p.first_name = v.first_name and p.surname = v.surname
join public.guardians g on g.player_id = p.id
join auth.users u on u.id = g.guardian_user_id
where not exists (
  select 1 from public.player_fixture_attendance a where a.fixture_id = f.id and a.player_id = p.id
);

-- ---------------------------------------------------------------------------
-- Match Centre Phase 3A additions
-- ---------------------------------------------------------------------------
-- Idempotent and additive, like everything above. These exist so the Match
-- Centre's premium surfaces can be exercised locally without hand-editing a
-- database: a kit to render, an arrival time to display, and a fixture far
-- enough away to sit outside the forecast horizon.

-- A canonical RugbyKit for the UAT club. Without one every Match Centre hero
-- renders the (correct, but uninformative) placeholder, so the kit path was
-- unverifiable locally.
insert into public.club_kits (club_id, variant, pattern, primary_colour, secondary_colour, accent_colour)
select c.id, 'primary', 'HOOPS', '#14532d', '#ffffff', '#f59e0b'
from public.clubs c
join public.club_directory d on d.id = c.directory_id
where d.normalized_key = 'ovalball-uat-rufc'
  and not exists (select 1 from public.club_kits k where k.club_id = c.id and k.variant = 'primary');

-- Arrival times on the seeded fixtures: 45 minutes before kick-off, which is
-- both realistic and safely inside the meet <= kickoff rule.
update public.fixtures f
set meet_time = f.kickoff_time - interval '45 minutes'
from public.teams t, public.clubs c, public.club_directory d
where f.owning_team_id = t.id and t.club_id = c.id and c.directory_id = d.id
  and d.normalized_key = 'ovalball-uat-rufc'
  and f.kickoff_time is not null
  and f.meet_time is null;

-- A fixture beyond the 7-day forecast horizon, so TOO_EARLY_FOR_FORECAST --
-- the state most fixtures spend most of their life in -- is reachable without
-- waiting for the calendar to move.
insert into public.fixtures (owning_team_id, opponent_directory_id, raw_opposition_text, kickoff_date, kickoff_time, home_away, status, season_id, venue_id, created_by)
select t.id,
       (select id from public.club_directory where normalized_key <> 'ovalball-uat-rufc' limit 1),
       'Far Future Opposition RFC',
       current_date + 120, '14:00', 'Home', 'Booked',
       (select f2.season_id from public.fixtures f2 where f2.owning_team_id = t.id limit 1),
       (select v.id from public.venues v where v.club_id = c.id limit 1),
       (select u.id from auth.users u where u.email = 'uat.coach@ovalball.test')
from public.teams t
join public.clubs c on c.id = t.club_id
join public.club_directory d on d.id = c.directory_id
where d.normalized_key = 'ovalball-uat-rufc' and t.age_group = 'U12' and t.squad_designation is null
  and not exists (
    select 1 from public.fixtures f3
    where f3.owning_team_id = t.id and f3.raw_opposition_text = 'Far Future Opposition RFC'
  );

-- ---------------------------------------------------------------------------
-- Match Centre Phase 3B additions
-- ---------------------------------------------------------------------------
-- Staff communications are only meaningful against a population with a MIX of
-- attendance states, so the local U12 fixture needs at least one player who
-- has not answered -- otherwise "Send attendance reminder" is permanently
-- greyed out and unexercisable.
--
-- Priya also carries TWO active guardians, which is the case that proves
-- recipient de-duplication and the "both accepted guardians receive
-- operational communications" rule in a real browser rather than only in SQL.

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token)
select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       e.email, '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', ''
from (values ('uat.guardian.three@ovalball.test'), ('uat.guardian.four@ovalball.test')) as e(email)
where not exists (select 1 from auth.users u where u.email = e.email);

insert into public.profiles (id, first_name, surname, email)
select u.id, v.first_name, v.surname, u.email
from (values
  ('uat.guardian.three@ovalball.test', 'Nadia', 'Rao'),
  ('uat.guardian.four@ovalball.test',  'Sanjay', 'Rao')
) as v(email, first_name, surname)
join auth.users u on u.email = v.email
where not exists (select 1 from public.profiles p where p.id = u.id);

-- The child with no response.
insert into public.players (first_name, surname, date_of_birth)
select 'Priya', 'Rao', '2014-09-09'
where not exists (select 1 from public.players p where p.first_name = 'Priya' and p.surname = 'Rao');

insert into public.player_team_memberships (player_id, team_id, status)
select p.id, t.id, 'active'
from public.players p
cross join public.teams t
join public.clubs c on c.id = t.club_id
join public.club_directory d on d.id = c.directory_id
where p.first_name = 'Priya' and p.surname = 'Rao'
  and d.normalized_key = 'ovalball-uat-rufc' and t.age_group = 'U12' and t.squad_designation is null
  and not exists (select 1 from public.player_team_memberships m where m.player_id = p.id and m.team_id = t.id);

-- BOTH guardians, both active.
insert into public.guardians (guardian_user_id, player_id, relationship_type, status)
select u.id, p.id, 'guardian', 'active'
from public.players p
cross join auth.users u
where p.first_name = 'Priya' and p.surname = 'Rao'
  and u.email in ('uat.guardian.three@ovalball.test', 'uat.guardian.four@ovalball.test')
  and not exists (select 1 from public.guardians g where g.player_id = p.id and g.guardian_user_id = u.id);
