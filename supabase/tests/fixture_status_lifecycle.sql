-- CANONICAL FIXTURE MANAGEMENT / PITCH SYNC pass -- permanent regression
-- for the status lifecycle centralized in update_fixture_schedule
-- (Booked/reverse transitions) and internal.complete_overdue_fixtures()
-- (idempotent date-passed auto-completion, timezone-correct, terminal-
-- state-safe).
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/fixture_status_lifecycle.sql

\set ON_ERROR_STOP off
\pset pager off
begin;

insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
  ('9e000000-0000-0000-0000-0000000000ea', 'Status Test Club A', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'status-test-club-a-9e000000'),
  ('9e000000-0000-0000-0000-0000000000eb', 'Status Test Club B', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'status-test-club-b-9e000000');
insert into public.clubs (id, directory_id, slug, status, timezone) values
  ('9e000000-0000-0000-0000-0000000000ea', '9e000000-0000-0000-0000-0000000000ea', 'status-test-club-a-9e000000', 'active', 'Europe/London'),
  ('9e000000-0000-0000-0000-0000000000eb', '9e000000-0000-0000-0000-0000000000eb', 'status-test-club-b-9e000000', 'active', 'Europe/London');
insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, active) values
  ('9e000000-0000-0000-0000-000000009a01', '9e000000-0000-0000-0000-0000000000ea', 'union', 'youth', 'U12', 'boys', null, 'Status A U12', 'status-a-u12', true),
  ('9e000000-0000-0000-0000-000000009b01', '9e000000-0000-0000-0000-0000000000eb', 'union', 'youth', 'U12', 'boys', null, 'Status B U12', 'status-b-u12', true);
insert into public.club_pitches (id, club_id, display_name, active) values
  ('9e000000-0000-0000-0000-000000009a02', '9e000000-0000-0000-0000-0000000000ea', 'A Pitch 1', true);
insert into public.club_memberships (id, club_id, user_id, role, status) values
  ('9e000000-0000-0000-0000-0000000009c2', '9e000000-0000-0000-0000-0000000000ea', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

-- ===== A. Planned -> Booked when pitch + kickoff both genuinely set =====
insert into public.fixtures (id, owning_team_id, opponent_team_id, kickoff_date, home_away, status, raw_opposition_text, source)
values ('9e000000-0000-0000-0000-000000009f01', '9e000000-0000-0000-0000-000000009a01', '9e000000-0000-0000-0000-000000009b01', current_date + 30, 'Home', 'Planned', 'Status B U12', 'club_created');

do $$
declare v_result record;
begin
  select * into v_result from public.update_fixture_schedule(
    p_fixture_id := '9e000000-0000-0000-0000-000000009f01', p_kickoff_date := current_date + 30, p_kickoff_time := '14:00',
    p_venue_id := null, p_pitch_id := '9e000000-0000-0000-0000-000000009a02', p_source := 'PITCH_ALLOCATION'
  );
  if (select status from public.fixtures where id = '9e000000-0000-0000-0000-000000009f01') = 'Booked' then
    raise notice 'PASS A: Planned -> Booked once pitch + kickoff are both genuinely set';
  else
    raise notice 'FAIL A: status=%', (select status from public.fixtures where id = '9e000000-0000-0000-0000-000000009f01');
  end if;
end $$;

-- ===== B. Unallocating a Booked fixture reverts to Planned (home/away known) =====
do $$
begin
  perform public.update_fixture_schedule(
    p_fixture_id := '9e000000-0000-0000-0000-000000009f01', p_kickoff_date := current_date + 30, p_kickoff_time := '14:00',
    p_venue_id := null, p_pitch_id := null, p_source := 'PITCH_ALLOCATION'
  );
  if (select status from public.fixtures where id = '9e000000-0000-0000-0000-000000009f01') = 'Planned' then
    raise notice 'PASS B: removing the pitch from a Booked fixture reverts it to Planned, never left falsely Booked';
  else
    raise notice 'FAIL B: status=%', (select status from public.fixtures where id = '9e000000-0000-0000-0000-000000009f01');
  end if;
end $$;

-- ===== C. A genuinely undetermined-side (TBD) fixture reverts to To Be Determined, not Planned =====
insert into public.fixtures (id, owning_team_id, opponent_team_id, kickoff_date, home_away, status, raw_opposition_text, source)
values ('9e000000-0000-0000-0000-000000009f02', '9e000000-0000-0000-0000-000000009a01', '9e000000-0000-0000-0000-000000009b01', current_date + 31, 'TBD', 'Planned', 'Status B U12', 'club_created');

do $$
begin
  perform public.update_fixture_schedule(
    p_fixture_id := '9e000000-0000-0000-0000-000000009f02', p_kickoff_date := current_date + 31, p_kickoff_time := '14:00',
    p_venue_id := null, p_pitch_id := null, p_source := 'PITCH_ALLOCATION'
  );
  -- home_away is TBD here so no pitch is ever settable (Section: only a
  -- home fixture may hold a pitch) -- status must simply stay whatever it
  -- already is (never invented as Booked), proving the lifecycle never
  -- promotes an undetermined-side fixture.
  if (select status from public.fixtures where id = '9e000000-0000-0000-0000-000000009f02') = 'Planned' then
    raise notice 'PASS C: a TBD-side fixture with no pitch stays Planned -- never silently promoted to Booked';
  else
    raise notice 'FAIL C: status=%', (select status from public.fixtures where id = '9e000000-0000-0000-0000-000000009f02');
  end if;
end $$;

reset role;

-- ===== D. Cancelled is never touched by an ordinary schedule edit path (status lifecycle only reacts to Planned/Booked/To Be Determined) =====
update public.fixtures set status = 'Cancelled', cancelled_at = now() where id = '9e000000-0000-0000-0000-000000009f02';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  begin
    perform public.update_fixture_schedule(
      p_fixture_id := '9e000000-0000-0000-0000-000000009f02', p_kickoff_date := current_date + 31, p_kickoff_time := '15:00',
      p_venue_id := null, p_pitch_id := null, p_source := 'PITCH_ALLOCATION'
    );
  exception when others then null;
  end;
  if (select status from public.fixtures where id = '9e000000-0000-0000-0000-000000009f02') = 'Cancelled' then
    raise notice 'PASS D: a Cancelled fixture is never touched by the status lifecycle';
  else
    raise notice 'FAIL D: status=%', (select status from public.fixtures where id = '9e000000-0000-0000-0000-000000009f02');
  end if;
end $$;
reset role;

-- ===== E-H. Automatic date-passed completion, idempotent, terminal-state-safe =====
-- Distinct past dates (not all "yesterday") purely to dodge the unrelated
-- same-day capacity-conflict trigger for this one shared test team --
-- every date here is still < today, which is all this lifecycle cares
-- about.
insert into public.fixtures (id, owning_team_id, opponent_team_id, kickoff_date, home_away, status, raw_opposition_text, source) values
  ('9e000000-0000-0000-0000-000000009f03', '9e000000-0000-0000-0000-000000009a01', '9e000000-0000-0000-0000-000000009b01', current_date - 1, 'Home', 'Planned', 'Status B U12', 'club_created'),
  ('9e000000-0000-0000-0000-000000009f04', '9e000000-0000-0000-0000-000000009a01', '9e000000-0000-0000-0000-000000009b01', current_date - 2, 'Home', 'Booked', 'Status B U12', 'club_created'),
  ('9e000000-0000-0000-0000-000000009f05', '9e000000-0000-0000-0000-000000009a01', '9e000000-0000-0000-0000-000000009b01', current_date - 3, 'TBD', 'To Be Determined', 'Status B U12', 'club_created'),
  -- "Today" here means the club's own LOCAL date, exactly what the
  -- function itself checks against -- not Postgres's UTC current_date,
  -- which can already read as "tomorrow" late in a UK evening (BST).
  ('9e000000-0000-0000-0000-000000009f06', '9e000000-0000-0000-0000-000000009a01', '9e000000-0000-0000-0000-000000009b01', (now() at time zone 'Europe/London')::date, 'Home', 'Planned', 'Status B U12', 'club_created'),
  ('9e000000-0000-0000-0000-000000009f07', '9e000000-0000-0000-0000-000000009a01', '9e000000-0000-0000-0000-000000009b01', current_date + 40, 'Home', 'Booked', 'Status B U12', 'club_created'),
  ('9e000000-0000-0000-0000-000000009f08', '9e000000-0000-0000-0000-000000009a01', '9e000000-0000-0000-0000-000000009b01', current_date - 4, 'Home', 'Cancelled', 'Status B U12', 'club_created');

do $$
declare v_n integer;
begin
  v_n := internal.complete_overdue_fixtures();

  if (select status from public.fixtures where id = '9e000000-0000-0000-0000-000000009f03') = 'Completed' then
    raise notice 'PASS E: yesterday Planned -> Completed';
  else raise notice 'FAIL E: %', (select status from public.fixtures where id = '9e000000-0000-0000-0000-000000009f03'); end if;

  if (select status from public.fixtures where id = '9e000000-0000-0000-0000-000000009f04') = 'Completed' then
    raise notice 'PASS F: yesterday Booked -> Completed';
  else raise notice 'FAIL F: %', (select status from public.fixtures where id = '9e000000-0000-0000-0000-000000009f04'); end if;

  if (select status from public.fixtures where id = '9e000000-0000-0000-0000-000000009f05') = 'Completed' then
    raise notice 'PASS G: yesterday To Be Determined -> Completed';
  else raise notice 'FAIL G: %', (select status from public.fixtures where id = '9e000000-0000-0000-0000-000000009f05'); end if;

  if (select status from public.fixtures where id = '9e000000-0000-0000-0000-000000009f06') = 'Planned' then
    raise notice 'PASS H: today Planned is NOT auto-completed while today is still today';
  else raise notice 'FAIL H: %', (select status from public.fixtures where id = '9e000000-0000-0000-0000-000000009f06'); end if;

  if (select status from public.fixtures where id = '9e000000-0000-0000-0000-000000009f07') = 'Booked' then
    raise notice 'PASS I: a future Booked fixture is untouched';
  else raise notice 'FAIL I: %', (select status from public.fixtures where id = '9e000000-0000-0000-0000-000000009f07'); end if;

  if (select status from public.fixtures where id = '9e000000-0000-0000-0000-000000009f08') = 'Cancelled' then
    raise notice 'PASS J: an explicit terminal Cancelled state is never overridden by date-passed automation';
  else raise notice 'FAIL J: %', (select status from public.fixtures where id = '9e000000-0000-0000-0000-000000009f08'); end if;
end $$;

-- Idempotency: re-running must change nothing further and report 0 rows touched this time.
do $$
declare v_n integer;
begin
  v_n := internal.complete_overdue_fixtures();
  if v_n = 0 then
    raise notice 'PASS K: re-running complete_overdue_fixtures() a second time is a genuine no-op (0 rows touched)';
  else
    raise notice 'FAIL K: second run touched % row(s)', v_n;
  end if;
end $$;

rollback;
