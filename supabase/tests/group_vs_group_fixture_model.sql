-- GROUP-VS-GROUP CANONICAL FIXTURE DATA MODEL -- live canonical test
-- matrix (Section 17), direct tamper tests (Section 16), same-day
-- conflict proof (Section 8), authorization proof (Section 9), and
-- future-season identity proof (Section 10), for
-- 20260926000000_group_vs_group_fixture_model.sql.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/group_vs_group_fixture_model.sql

\set ON_ERROR_STOP off
\pset pager off
begin;

-- === Setup: two isolated clubs, each with a current-season Mini-Rugby
-- Group (U6+U7) and one ordinary U12 team, plus a closed group and a
-- genuine NEXT-season successor group for Club A.
insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
  ('9d000000-0000-0000-0000-0000000000da', 'GvG Test Club A', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'gvg-test-club-a-9d000000'),
  ('9d000000-0000-0000-0000-0000000000db', 'GvG Test Club B', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'gvg-test-club-b-9d000000');
insert into public.clubs (id, directory_id, slug, status) values
  ('9d000000-0000-0000-0000-0000000000ca', '9d000000-0000-0000-0000-0000000000da', 'gvg-test-club-a-9d000000', 'active'),
  ('9d000000-0000-0000-0000-0000000000cb', '9d000000-0000-0000-0000-0000000000db', 'gvg-test-club-b-9d000000', 'active');

insert into public.seasons (id, name, starts_on, ends_on, pre_season_starts_on, rugby_code, season_year_start, is_regression_fixture) values
  ('9d000000-0000-0000-0000-00000000ea01', 'GvG Current Test Season', current_date - 100, current_date + 100, current_date - 110, 'union', 2193, true),
  ('9d000000-0000-0000-0000-00000000ea02', 'GvG Next Test Season', current_date + 200, current_date + 300, current_date + 190, 'union', 2194, true);

insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, active) values
  ('9d000000-0000-0000-0000-0000000a6001', '9d000000-0000-0000-0000-0000000000ca', 'union', 'youth', 'U6', null, null, 'GvG A U6', 'gvg-a-u6', true),
  ('9d000000-0000-0000-0000-0000000a7001', '9d000000-0000-0000-0000-0000000000ca', 'union', 'youth', 'U7', null, null, 'GvG A U7', 'gvg-a-u7', true),
  ('9d000000-0000-0000-0000-000000a12001', '9d000000-0000-0000-0000-0000000000ca', 'union', 'youth', 'U12', 'boys', null, 'GvG A U12', 'gvg-a-u12', true),
  ('9d000000-0000-0000-0000-0000000b6001', '9d000000-0000-0000-0000-0000000000cb', 'union', 'youth', 'U6', null, null, 'GvG B U6', 'gvg-b-u6', true),
  ('9d000000-0000-0000-0000-0000000b7001', '9d000000-0000-0000-0000-0000000000cb', 'union', 'youth', 'U7', null, null, 'GvG B U7', 'gvg-b-u7', true),
  ('9d000000-0000-0000-0000-000000b12001', '9d000000-0000-0000-0000-0000000000cb', 'union', 'youth', 'U12', 'boys', null, 'GvG B U12', 'gvg-b-u12', true),
  ('9d000000-0000-0000-0000-0000000a6002', '9d000000-0000-0000-0000-0000000000ca', 'union', 'youth', 'U6', null, 'B', 'GvG A U6 B (folded)', 'gvg-a-u6b', false),
  ('9d000000-0000-0000-0000-0000000a7002', '9d000000-0000-0000-0000-0000000000ca', 'union', 'youth', 'U7', null, 'C', 'GvG A U7 solo (not in any group)', 'gvg-a-u7solo', true),
  ('9d000000-0000-0000-0000-0000000b7002', '9d000000-0000-0000-0000-0000000000cb', 'union', 'youth', 'U7', null, 'C', 'GvG B U7 solo (not in any group)', 'gvg-b-u7solo', true);

insert into public.scheduling_groups (id, club_id, display_tag, active, season_id) values
  ('9d000000-0000-0000-0000-00000000aa01', '9d000000-0000-0000-0000-0000000000ca', 'U6/U7', true, '9d000000-0000-0000-0000-00000000ea01'),
  ('9d000000-0000-0000-0000-00000000ab01', '9d000000-0000-0000-0000-0000000000cb', 'U6/U7', true, '9d000000-0000-0000-0000-00000000ea01'),
  ('9d000000-0000-0000-0000-00000000aa02', '9d000000-0000-0000-0000-0000000000ca', 'U6/U7 Closed', false, '9d000000-0000-0000-0000-00000000ea01'),
  ('9d000000-0000-0000-0000-00000000aa03', '9d000000-0000-0000-0000-0000000000ca', 'U6/U7 Next Season', true, '9d000000-0000-0000-0000-00000000ea02'),
  ('9d000000-0000-0000-0000-00000000aa04', '9d000000-0000-0000-0000-0000000000ca', 'U6/U7 with folded member', true, '9d000000-0000-0000-0000-00000000ea01');

insert into public.scheduling_group_members (group_id, team_id) values
  ('9d000000-0000-0000-0000-00000000aa01', '9d000000-0000-0000-0000-0000000a6001'),
  ('9d000000-0000-0000-0000-00000000aa01', '9d000000-0000-0000-0000-0000000a7001'),
  ('9d000000-0000-0000-0000-00000000ab01', '9d000000-0000-0000-0000-0000000b6001'),
  ('9d000000-0000-0000-0000-00000000ab01', '9d000000-0000-0000-0000-0000000b7001'),
  ('9d000000-0000-0000-0000-00000000aa02', '9d000000-0000-0000-0000-0000000a6001'),
  ('9d000000-0000-0000-0000-00000000aa02', '9d000000-0000-0000-0000-0000000a7001'),
  ('9d000000-0000-0000-0000-00000000aa03', '9d000000-0000-0000-0000-0000000a6001'),
  ('9d000000-0000-0000-0000-00000000aa03', '9d000000-0000-0000-0000-0000000a7001'),
  ('9d000000-0000-0000-0000-00000000aa04', '9d000000-0000-0000-0000-0000000a6001'),
  ('9d000000-0000-0000-0000-00000000aa04', '9d000000-0000-0000-0000-0000000a6002');

-- A second Club A group sharing a real component (U6) with the main
-- group -- for test Q below. scheduling_groups has no client-facing
-- INSERT policy at all (write-only via the group-management RPCs), so
-- this setup insert runs as the table owner, same as every other
-- setup statement above.
insert into public.scheduling_groups (id, club_id, display_tag, active, season_id) values
  ('9d000000-0000-0000-0000-00000000aa05', '9d000000-0000-0000-0000-0000000000ca', 'U6 alt', true, '9d000000-0000-0000-0000-00000000ea01');
insert into public.scheduling_group_members (group_id, team_id) values
  ('9d000000-0000-0000-0000-00000000aa05', '9d000000-0000-0000-0000-0000000a6001');

-- 002 = Club A's CLUB_ADMIN (used to author the test fixtures below).
-- 004 = team_admin ONLY on U7 (a genuine component of the group, NOT the
-- stored anchor U6) -- proves Section 9's "any component, not just the
-- literal anchor" claim. 005 = team_admin on an entirely unrelated team
-- -- must have zero authority over any fixture in this test.
insert into public.club_memberships (id, club_id, user_id, role, status) values
  ('9d000000-0000-0000-0000-0000000ea001', '9d000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active'),
  ('9d000000-0000-0000-0000-0000000ea002', '9d000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-000000000004', 'BASIC_USER', 'active'),
  ('9d000000-0000-0000-0000-0000000ea003', '9d000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-000000000005', 'BASIC_USER', 'active');
insert into public.team_permissions (membership_id, team_id, permission, created_by) values
  ('9d000000-0000-0000-0000-0000000ea002', '9d000000-0000-0000-0000-0000000a7001', 'team_admin', '00000000-0000-0000-0000-000000000002'),
  ('9d000000-0000-0000-0000-0000000ea003', '9d000000-0000-0000-0000-000000a12001', 'team_admin', '00000000-0000-0000-0000-000000000002');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

-- === A. TEAM vs TEAM ===
do $$
declare v_id uuid; r record;
begin
  insert into public.fixtures (id, owning_team_id, opponent_team_id, kickoff_date, home_away, status, raw_opposition_text, source)
  values ('9d000000-0000-0000-0000-00000000fa01', '9d000000-0000-0000-0000-000000a12001', '9d000000-0000-0000-0000-000000b12001', current_date + 10, 'Home', 'Booked', 'GvG B U12', 'club_created')
  returning id into v_id;

  select * into r from public.get_effective_fixture_participants(v_id);
  if r.home_team_ids = array['9d000000-0000-0000-0000-000000a12001']::uuid[] and r.away_team_ids = array['9d000000-0000-0000-0000-000000b12001']::uuid[] then
    raise notice 'PASS A: TEAM vs TEAM -- one fixture_id, home/away resolve to exactly their own single team';
  else
    raise notice 'FAIL A: home=% away=%', r.home_team_ids, r.away_team_ids;
  end if;
end $$;

-- === B. GROUP vs TEAM ===
do $$
declare v_id uuid; r record;
begin
  insert into public.fixtures (id, owning_team_id, owning_scheduling_group_id, opponent_team_id, kickoff_date, home_away, status, raw_opposition_text, source)
  values ('9d000000-0000-0000-0000-00000000fb01', '9d000000-0000-0000-0000-0000000a6001', '9d000000-0000-0000-0000-00000000aa01', '9d000000-0000-0000-0000-0000000b7002', current_date + 11, 'Home', 'Booked', 'GvG B U12', 'club_created')
  returning id into v_id;

  select * into r from public.get_effective_fixture_participants(v_id);
  if r.home_team_ids::text[] <@ array['9d000000-0000-0000-0000-0000000a6001','9d000000-0000-0000-0000-0000000a7001']::text[]
     and array_length(r.home_team_ids,1) = 2 and r.away_team_ids = array['9d000000-0000-0000-0000-0000000b7002']::uuid[] then
    raise notice 'PASS B: GROUP vs TEAM -- home expands to both real group components, away stays the single team';
  else
    raise notice 'FAIL B: home=% away=%', r.home_team_ids, r.away_team_ids;
  end if;
end $$;

-- === C. TEAM vs GROUP -- the new capability this pass adds: the
-- opponent side genuinely preserved as a group, never collapsed. ===
do $$
declare v_id uuid; r record;
begin
  insert into public.fixtures (id, owning_team_id, opponent_team_id, opponent_scheduling_group_id, kickoff_date, home_away, status, raw_opposition_text, source)
  values ('9d000000-0000-0000-0000-00000000fc01', '9d000000-0000-0000-0000-0000000a7002', '9d000000-0000-0000-0000-0000000b6001', '9d000000-0000-0000-0000-00000000ab01', current_date + 12, 'Home', 'Booked', 'GvG B U6/U7', 'club_created')
  returning id into v_id;

  select * into r from public.get_effective_fixture_participants(v_id);
  if r.home_team_ids = array['9d000000-0000-0000-0000-0000000a7002']::uuid[]
     and array_length(r.away_team_ids,1) = 2 and r.away_team_ids::text[] <@ array['9d000000-0000-0000-0000-0000000b6001','9d000000-0000-0000-0000-0000000b7001']::text[] then
    raise notice 'PASS C: TEAM vs GROUP -- the OPPONENT group expands to both real components -- proves the opponent side is no longer collapsed to one team';
  else
    raise notice 'FAIL C: home=% away=%', r.home_team_ids, r.away_team_ids;
  end if;
end $$;

-- === D. GROUP vs GROUP ===
do $$
declare v_id uuid; r record;
begin
  insert into public.fixtures (id, owning_team_id, owning_scheduling_group_id, opponent_team_id, opponent_scheduling_group_id, kickoff_date, home_away, status, raw_opposition_text, source)
  values ('9d000000-0000-0000-0000-00000000fd01', '9d000000-0000-0000-0000-0000000a6001', '9d000000-0000-0000-0000-00000000aa01', '9d000000-0000-0000-0000-0000000b6001', '9d000000-0000-0000-0000-00000000ab01', current_date + 13, 'Home', 'Booked', 'GvG B U6/U7', 'club_created')
  returning id into v_id;

  select * into r from public.get_effective_fixture_participants(v_id);
  if array_length(r.home_team_ids,1) = 2 and array_length(r.away_team_ids,1) = 2 and array_length(r.all_team_ids,1) = 4
     and r.home_team_ids::text[] <@ array['9d000000-0000-0000-0000-0000000a6001','9d000000-0000-0000-0000-0000000a7001']::text[]
     and r.away_team_ids::text[] <@ array['9d000000-0000-0000-0000-0000000b6001','9d000000-0000-0000-0000-0000000b7001']::text[] then
    raise notice 'PASS D: GROUP vs GROUP -- ONE fixture_id, both sides expand to their own real components, all_team_ids deduped to exactly 4 real teams';
  else
    raise notice 'FAIL D: home=% away=% all=%', r.home_team_ids, r.away_team_ids, r.all_team_ids;
  end if;
end $$;

-- === E. Same-day conflict proof: a Club A U7 fixture the same day as
-- Fixture D (which already commits U7 as a home-side group component)
-- must be rejected -- proves conflict detection consumes the effective
-- team set, not the literal stored anchor. ===
do $$
begin
  begin
    insert into public.fixtures (owning_team_id, opponent_team_id, kickoff_date, home_away, status, raw_opposition_text, source)
    values ('9d000000-0000-0000-0000-0000000a7001', '9d000000-0000-0000-0000-0000000b7002', current_date + 13, 'Home', 'Booked', 'Conflict probe', 'club_created');
    raise notice 'FAIL E: a second same-day fixture for U7 (already committed via Fixture D''s group) was wrongly allowed';
  exception when sqlstate '23514' then
    raise notice 'PASS E: U7 already committed via Fixture D''s GROUP membership correctly blocks a second same-day booking (%)', sqlerrm;
  end;
end $$;

-- === F. Same-day conflict proof, opponent-side gap closed: Club B's
-- U6, named only as an OPPONENT component in Fixture D, cannot separately
-- be booked as an OWNING team the same day either. ===
do $$
begin
  begin
    insert into public.fixtures (owning_team_id, opponent_team_id, kickoff_date, home_away, status, raw_opposition_text, source)
    values ('9d000000-0000-0000-0000-0000000b6001', '9d000000-0000-0000-0000-0000000a7002', current_date + 13, 'Home', 'Booked', 'Conflict probe opponent side', 'club_created');
    raise notice 'FAIL F: Club B U6 (already committed as an OPPONENT-side group component) was wrongly allowed a second same-day fixture';
  exception when sqlstate '23514' then
    raise notice 'PASS F: the opponent-side capacity gap is closed -- Club B U6''s prior commitment as an opponent-side group component is correctly caught (%)', sqlerrm;
  end;
end $$;

-- === G. Authorization: U7's own team admin (004, NOT the stored anchor
-- U6) can manage Fixture D -- a genuine group vs group fixture -- purely
-- because they hold real authority over a genuine component team. ===
reset role;
do $$
declare v_can boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
  select internal.can_manage_fixture_side('9d000000-0000-0000-0000-0000000a6001', '9d000000-0000-0000-0000-00000000aa01') into v_can;
  if v_can then
    raise notice 'PASS G: U7''s own admin (004) can manage the group fixture via component-team authority, not because they own the literal anchor team';
  else
    raise notice 'FAIL G: component-team admin denied authority over their own group''s fixture';
  end if;
end $$;

-- === H. Authorization: an unrelated team admin (005, U12A only) has
-- zero authority over Fixture D's group side, and zero over the group's
-- own COMPOSITION capability either. ===
do $$
declare v_can boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
  select internal.can_manage_fixture_side('9d000000-0000-0000-0000-0000000a6001', '9d000000-0000-0000-0000-00000000aa01') into v_can;
  if not v_can then
    raise notice 'PASS H: an unrelated team admin (005) has zero fixture authority over a group they are not a component of';
  else
    raise notice 'FAIL H: unrelated team admin wrongly granted authority';
  end if;

  select internal.has_capability('manage_mini_rugby_groups', 'club', '9d000000-0000-0000-0000-0000000000ca') into v_can;
  if not v_can then
    raise notice 'PASS H2: fixture-side authority never implies group-COMPOSITION authority -- kept as a fully separate capability';
  else
    raise notice 'FAIL H2: unrelated user wrongly holds group-composition capability';
  end if;
end $$;

-- === I. Unauthorized participant swap: 005 attempts to move Fixture A
-- onto a different opponent -- RLS silently matches zero rows (the
-- established SELECT/UPDATE-scoped RLS pattern throughout this
-- codebase), never actually mutating the row. ===
do $$
declare v_notes text;
begin
  -- 004 manages only U7 (a component of Club A's OWN group, but not
  -- either side of Fixture A at all) -- genuinely unrelated to this
  -- fixture, unlike 005 who (per test H's setup) manages a12001, which
  -- IS Fixture A's own owning team and would legitimately pass RLS.
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
  update public.fixtures set notes = 'tampered by an unrelated team admin' where id = '9d000000-0000-0000-0000-00000000fa01';
  select notes into v_notes from public.fixtures where id = '9d000000-0000-0000-0000-00000000fa01';
  if v_notes is null then
    raise notice 'PASS I: an unauthorized team admin (004, unrelated to either side of this fixture) attempting to edit it matches zero rows under RLS -- fixture unchanged';
  else
    raise notice 'FAIL I: unauthorized participant edit succeeded, notes now %', v_notes;
  end if;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

-- === J. Tamper: fabricated group_id ===
do $$
begin
  begin
    insert into public.fixtures (owning_team_id, owning_scheduling_group_id, opponent_team_id, kickoff_date, home_away, status, raw_opposition_text, source)
    values ('9d000000-0000-0000-0000-0000000a6001', '9d000000-0000-0000-0000-0000000000fa', '9d000000-0000-0000-0000-0000000b7002', current_date + 14, 'Home', 'Booked', 'Tamper probe', 'club_created');
    raise notice 'FAIL J: a fabricated group_id was accepted';
  exception when others then
    raise notice 'PASS J: fabricated group_id rejected (%)', sqlerrm;
  end;
end $$;

-- === K. Tamper: group from another (unrelated) club used as the
-- opponent side against Club A's own U12. ===
do $$
begin
  begin
    insert into public.fixtures (owning_team_id, opponent_team_id, opponent_scheduling_group_id, kickoff_date, home_away, status, raw_opposition_text, source)
    values ('9d000000-0000-0000-0000-0000000a7002', '9d000000-0000-0000-0000-0000000b6001', '9d000000-0000-0000-0000-00000000aa01', current_date + 15, 'Home', 'Booked', 'Tamper probe wrong club', 'club_created');
    raise notice 'FAIL K: an opponent group belonging to a DIFFERENT club than its own anchor team was accepted';
  exception when others then
    raise notice 'PASS K: cross-club group/anchor mismatch rejected (%)', sqlerrm;
  end;
end $$;

-- === L. Tamper: anchor team substituted for one that is NOT actually a
-- member of the referenced group (cross-club participant substitution
-- at the anchor level). ===
do $$
begin
  begin
    insert into public.fixtures (owning_team_id, owning_scheduling_group_id, opponent_team_id, kickoff_date, home_away, status, raw_opposition_text, source)
    values ('9d000000-0000-0000-0000-0000000a7002', '9d000000-0000-0000-0000-00000000aa01', '9d000000-0000-0000-0000-0000000b7002', current_date + 16, 'Home', 'Booked', 'Tamper probe non-member anchor', 'club_created');
    raise notice 'FAIL L: an anchor team that is not a real member of the referenced group was accepted';
  exception when others then
    raise notice 'PASS L: non-member anchor team rejected (%)', sqlerrm;
  end;
end $$;

-- === M. Tamper: closed/inactive group ===
do $$
begin
  begin
    insert into public.fixtures (owning_team_id, owning_scheduling_group_id, opponent_team_id, kickoff_date, home_away, status, raw_opposition_text, source)
    values ('9d000000-0000-0000-0000-0000000a6001', '9d000000-0000-0000-0000-00000000aa02', '9d000000-0000-0000-0000-0000000b7002', current_date + 17, 'Home', 'Booked', 'Tamper probe closed group', 'club_created');
    raise notice 'FAIL M: a CLOSED/inactive Mini-Rugby Group was accepted for a new fixture';
  exception when others then
    raise notice 'PASS M: closed/inactive group rejected (%)', sqlerrm;
  end;
end $$;

-- === N. Tamper: wrong-season group -- Club A's NEXT-season group used
-- for a fixture dated in the CURRENT season window. ===
do $$
begin
  begin
    insert into public.fixtures (owning_team_id, owning_scheduling_group_id, opponent_team_id, kickoff_date, home_away, status, raw_opposition_text, source)
    values ('9d000000-0000-0000-0000-0000000a6001', '9d000000-0000-0000-0000-00000000aa03', '9d000000-0000-0000-0000-0000000b7002', current_date + 18, 'Home', 'Booked', 'Tamper probe wrong season', 'club_created');
    raise notice 'FAIL N: a NEXT-season group was accepted for a fixture dated in the current season -- historical/future group silently reused';
  exception when others then
    raise notice 'PASS N: wrong-season group rejected (%)', sqlerrm;
  end;
end $$;

-- === O. Future-season identity (Section 10): the SAME next-season group
-- IS accepted for a fixture genuinely dated within that future season's
-- own window -- proves the rejection above is about season alignment,
-- not the next-season group being unusable outright. ===
do $$
declare v_id uuid; r record;
begin
  insert into public.fixtures (id, owning_team_id, owning_scheduling_group_id, opponent_team_id, kickoff_date, home_away, status, raw_opposition_text, source)
  values ('9d000000-0000-0000-0000-00000000ff01', '9d000000-0000-0000-0000-0000000a6001', '9d000000-0000-0000-0000-00000000aa03', '9d000000-0000-0000-0000-0000000b7002', current_date + 210, 'Home', 'Booked', 'Future season probe', 'club_created')
  returning id into v_id;
  select * into r from public.get_effective_fixture_participants(v_id);
  if array_length(r.home_team_ids,1) = 2 then
    raise notice 'PASS O: a genuine future-season group correctly resolves for a fixture dated within ITS OWN season window -- no group was fabricated, a real one was required and used';
  else
    raise notice 'FAIL O: home=%', r.home_team_ids;
  end if;
end $$;

-- === P. Tamper: a group with a folded/inactive component team ===
do $$
begin
  begin
    insert into public.fixtures (owning_team_id, owning_scheduling_group_id, opponent_team_id, kickoff_date, home_away, status, raw_opposition_text, source)
    values ('9d000000-0000-0000-0000-0000000a6001', '9d000000-0000-0000-0000-00000000aa04', '9d000000-0000-0000-0000-0000000b7002', current_date + 19, 'Home', 'Booked', 'Tamper probe folded member', 'club_created');
    raise notice 'FAIL P: a group with a folded/inactive component team was accepted for a new fixture';
  exception when others then
    raise notice 'PASS P: group with a folded component team rejected (%)', sqlerrm;
  end;
end $$;

-- === Q. Section 7: same effective team on both sides is rejected, even
-- through two DIFFERENT groups that happen to share a component. ===
do $$
begin
  begin
    insert into public.fixtures (owning_team_id, owning_scheduling_group_id, opponent_team_id, opponent_scheduling_group_id, kickoff_date, home_away, status, raw_opposition_text, source)
    values ('9d000000-0000-0000-0000-0000000a7001', '9d000000-0000-0000-0000-00000000aa01', '9d000000-0000-0000-0000-0000000a6001', '9d000000-0000-0000-0000-00000000aa05', current_date + 20, 'Home', 'Booked', 'Self-conflict probe', 'club_created');
    raise notice 'FAIL Q: two DIFFERENT groups sharing a real component team (U6) were accepted on opposite sides of the same fixture';
  exception when sqlstate '23514' then
    raise notice 'PASS Q: same effective team (U6) on both sides via two different groups correctly rejected (%)', sqlerrm;
  end;
end $$;

-- === R. Cross-club groups with an IDENTICAL label never collide by
-- label -- Fixture D itself (Club A "U6/U7" vs Club B "U6/U7") already
-- proves this: same display_tag, different real team_ids, accepted. ===
do $$
begin
  if exists (select 1 from public.fixtures where id = '9d000000-0000-0000-0000-00000000fd01') then
    raise notice 'PASS R: cross-club groups sharing an identical display_tag ("U6/U7") never collide -- compared by stable team_id, never by label (Fixture D)';
  else
    raise notice 'FAIL R: Fixture D missing';
  end if;
end $$;

rollback;
