-- Manual verification for age-grade fixture eligibility (20260831320000):
-- internal.teams_can_play_fixture(), and the enforce_fixture_age_eligibility
-- trigger on public.fixtures that makes it the real, unbypassable
-- boundary (not just UI filtering). NOT a migration -- never applied
-- automatically by `db reset`. Run by hand, AFTER permission_matrix.sql:
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/fixture_age_eligibility.sql
--
-- Self-contained: creates its own throwaway teams at Burnley RUFC and
-- Rossendale RUFC (permission_matrix.sql's own activated clubs) covering
-- every age/category/gender combination the brief's scenarios need,
-- including U6 (20260831330000 added it as a legitimate teams.age_group
-- value, closing what was originally a real schema gap here).

\set ON_ERROR_STOP off
\pset pager off

do $$
declare
  v_burnley_club_id uuid;
  v_rossendale_club_id uuid;
  v_league_directory_id uuid;
  v_league_club_id uuid;
begin
  select id into v_burnley_club_id from public.clubs where id = '10000000-0000-0000-0000-000000000001';
  select id into v_rossendale_club_id from public.clubs where id = '10000000-0000-0000-0000-000000000002';

  -- No real seeded club_directory row has rugby_code='league' -- a
  -- throwaway one is needed to test the rugby-code-mismatch scenario at
  -- all (every existing team belongs to a real, union-only club, and the
  -- enforce_team_rugby_code trigger already blocks mixing codes within
  -- one club, so a cross-code pair only exists between two clubs).
  insert into public.club_directory (id, name, rugby_code, country, nation, source, normalized_key, verification_status)
  values ('90000000-0000-0000-0000-000000000099', 'Age Eligibility Test League Club', 'league', 'United Kingdom', 'England', 'site_admin_manual', 'age eligibility test league club', 'unverified')
  on conflict (id) do nothing
  returning id into v_league_directory_id;
  if v_league_directory_id is null then v_league_directory_id := '90000000-0000-0000-0000-000000000099'; end if;

  insert into public.clubs (id, directory_id, slug, status)
  values ('90000000-0000-0000-0000-000000000098', v_league_directory_id, 'age-elig-test-league-club', 'active')
  on conflict (id) do nothing
  returning id into v_league_club_id;
  if v_league_club_id is null then v_league_club_id := '90000000-0000-0000-0000-000000000098'; end if;

  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, display_name, slug)
  values ('90000000-0000-0000-0000-000000000009', v_league_club_id, 'league', 'youth', 'U12', 'boys', 'U12 League', 'age-elig-league-u12')
  on conflict (id) do nothing;

  -- Individual statements, not one multi-row VALUES list -- a single row
  -- colliding on the (club_id, identity_key) unique constraint would
  -- otherwise silently roll back every sibling row in the same INSERT,
  -- and downstream scenarios would misreport "eligible" for pairs
  -- involving the never-created teams (teams_can_play_fixture treats an
  -- unresolvable team id the same as a genuinely unresolved opponent).
  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, gender, display_name, slug) values ('90000000-0000-0000-0000-000000000001', v_burnley_club_id, 'union', 'youth', 'U11', null, 'mixed', 'U11 A', 'age-elig-burnley-u11-a') on conflict (id) do nothing;
  -- gender left null (not 'boys') to match its primary sibling
  -- (30000000-...-001, from permission_matrix.sql, which never set
  -- gender either) -- the new B/C-requires-active-primary invariant
  -- compares gender exactly, so a mismatched gender would make this an
  -- orphaned squad even though it is really the same real side.
  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, gender, display_name, slug) values ('90000000-0000-0000-0000-000000000002', v_burnley_club_id, 'union', 'youth', 'U12', 'B', null, 'U12 B', 'age-elig-burnley-u12-b') on conflict (id) do nothing;
  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, gender, display_name, slug) values ('90000000-0000-0000-0000-000000000003', v_burnley_club_id, 'union', 'youth', 'U9', null, 'mixed', 'U9 A', 'age-elig-burnley-u9-a') on conflict (id) do nothing;
  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, gender, display_name, slug) values ('90000000-0000-0000-0000-000000000004', v_burnley_club_id, 'union', 'youth', 'U16', null, 'boys', 'U16 A', 'age-elig-burnley-u16-a') on conflict (id) do nothing;
  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, gender, display_name, slug) values ('90000000-0000-0000-0000-000000000006', v_burnley_club_id, 'union', 'youth', 'U7', null, 'mixed', 'U7 A', 'age-elig-burnley-u7-a') on conflict (id) do nothing;
  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, gender, display_name, slug) values ('90000000-0000-0000-0000-000000000012', v_burnley_club_id, 'union', 'youth', 'U6', null, 'mixed', 'U6 A', 'age-elig-burnley-u6-a') on conflict (id) do nothing;
  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, gender, display_name, slug) values ('90000000-0000-0000-0000-000000000007', v_burnley_club_id, 'union', 'senior', null, '2nd', 'mens', 'Men''s 2nd', 'age-elig-burnley-mens-2nd') on conflict (id) do nothing;
  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, gender, display_name, slug) values ('90000000-0000-0000-0000-000000000008', v_burnley_club_id, 'union', 'senior', null, '1st', 'womens', 'Women''s 1st', 'age-elig-burnley-womens-1st') on conflict (id) do nothing;
  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, gender, display_name, slug) values ('90000000-0000-0000-0000-000000000010', v_burnley_club_id, 'union', 'youth', 'U14', null, 'girls', 'U14 Girls', 'age-elig-burnley-u14-girls') on conflict (id) do nothing;
  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, gender, display_name, slug) values ('90000000-0000-0000-0000-000000000011', v_burnley_club_id, 'union', 'senior', null, '3rd', 'mens', 'Men''s 3rd', 'age-elig-burnley-colts') on conflict (id) do nothing;

  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, gender, display_name, slug) values ('90000000-0000-0000-0000-000000000023', v_rossendale_club_id, 'union', 'youth', 'U8', null, 'mixed', 'U8 A', 'age-elig-rossendale-u8-a') on conflict (id) do nothing;
  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, gender, display_name, slug) values ('90000000-0000-0000-0000-000000000031', v_rossendale_club_id, 'union', 'youth', 'U6', null, 'mixed', 'U6 A', 'age-elig-rossendale-u6-a') on conflict (id) do nothing;
  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, gender, display_name, slug) values ('90000000-0000-0000-0000-000000000024', v_rossendale_club_id, 'union', 'senior', null, '3rd', 'mens', 'Men''s 3rd', 'age-elig-rossendale-mens-3rd') on conflict (id) do nothing;
  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, gender, display_name, slug) values ('90000000-0000-0000-0000-000000000025', v_rossendale_club_id, 'union', 'senior', null, '2nd', 'womens', 'Women''s 2nd', 'age-elig-rossendale-womens-2nd') on conflict (id) do nothing;
  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, gender, display_name, slug) values ('90000000-0000-0000-0000-000000000026', v_rossendale_club_id, 'union', 'senior', null, '1st', 'mens', 'Men''s 1st', 'age-elig-rossendale-colts-senior') on conflict (id) do nothing;
  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, gender, display_name, slug) values ('90000000-0000-0000-0000-000000000027', v_rossendale_club_id, 'union', 'youth', 'U15', null, 'boys', 'U15 A', 'age-elig-rossendale-u15-a') on conflict (id) do nothing;
  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, gender, display_name, slug) values ('90000000-0000-0000-0000-000000000028', v_rossendale_club_id, 'union', 'youth', 'U10', null, 'mixed', 'U10 A', 'age-elig-rossendale-u10-a') on conflict (id) do nothing;
  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, gender, display_name, slug) values ('90000000-0000-0000-0000-000000000029', v_rossendale_club_id, 'union', 'youth', 'U16', null, 'girls', 'U16 Girls', 'age-elig-rossendale-u16-girls') on conflict (id) do nothing;
  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, gender, display_name, slug) values ('90000000-0000-0000-0000-000000000030', v_rossendale_club_id, 'union', 'youth', 'U9', null, 'mixed', 'U9 A', 'age-elig-rossendale-u9-a') on conflict (id) do nothing;
end $$;

\echo '=== Fixtures ready. Running age-eligibility scenarios. ==='

do $$
declare
  v_burnley_u12_a uuid := '30000000-0000-0000-0000-000000000001'; -- from permission_matrix.sql
  v_burnley_u13_a uuid := '30000000-0000-0000-0000-000000000002'; -- from permission_matrix.sql
  v_burnley_u12_b uuid := '90000000-0000-0000-0000-000000000002';
  v_burnley_u11_a uuid := '90000000-0000-0000-0000-000000000001';
  v_burnley_u9_a uuid := '90000000-0000-0000-0000-000000000003';
  v_burnley_u16_a uuid := '90000000-0000-0000-0000-000000000004';
  v_burnley_u7_a uuid := '90000000-0000-0000-0000-000000000006';
  v_burnley_u6_a uuid := '90000000-0000-0000-0000-000000000012';
  v_burnley_mens_2nd uuid := '90000000-0000-0000-0000-000000000007';
  v_burnley_womens_1st uuid := '90000000-0000-0000-0000-000000000008';
  v_burnley_u12_league uuid := '90000000-0000-0000-0000-000000000009';
  v_burnley_u14_girls uuid := '90000000-0000-0000-0000-000000000010';
  v_burnley_colts uuid := '90000000-0000-0000-0000-000000000011';
  v_rossendale_u12_a uuid := '30000000-0000-0000-0000-000000000003'; -- from permission_matrix.sql
  v_rossendale_u8_a uuid := '90000000-0000-0000-0000-000000000023';
  v_rossendale_u6_a uuid := '90000000-0000-0000-0000-000000000031';
  v_rossendale_mens_3rd uuid := '90000000-0000-0000-0000-000000000024';
  v_rossendale_womens_2nd uuid := '90000000-0000-0000-0000-000000000025';
  v_rossendale_colts_senior uuid := '90000000-0000-0000-0000-000000000026';
  v_rossendale_u15_a uuid := '90000000-0000-0000-0000-000000000027';
  v_rossendale_u10_a uuid := '90000000-0000-0000-0000-000000000028';
  v_rossendale_u16_girls uuid := '90000000-0000-0000-0000-000000000029';
  v_rossendale_u9_a uuid := '90000000-0000-0000-0000-000000000030';
  v_actual boolean;
begin
  select internal.teams_can_play_fixture(v_burnley_u12_a, v_rossendale_u12_a) into v_actual;
  if v_actual = true then raise notice 'PASS 1: U12 A vs U12 A (own club sanity)'; else raise notice 'FAIL 1: expected true, got %', v_actual; end if;

  select internal.teams_can_play_fixture(v_burnley_u12_a, v_burnley_u12_b) into v_actual;
  if v_actual = true then raise notice 'PASS 2: U12 A vs U12 B (squad designation irrelevant)'; else raise notice 'FAIL 2: expected true, got %', v_actual; end if;

  select internal.teams_can_play_fixture(v_burnley_u12_a, v_burnley_u11_a) into v_actual;
  if v_actual = false then raise notice 'PASS 3: U12 vs U11 rejected'; else raise notice 'FAIL 3: expected false, got %', v_actual; end if;

  select internal.teams_can_play_fixture(v_burnley_u12_a, v_burnley_u13_a) into v_actual;
  if v_actual = false then raise notice 'PASS 4: U12 vs U13 rejected'; else raise notice 'FAIL 4: expected false, got %', v_actual; end if;

  select internal.teams_can_play_fixture(v_burnley_u9_a, v_rossendale_u10_a) into v_actual;
  if v_actual = false then raise notice 'PASS 5: U9 vs U10 rejected'; else raise notice 'FAIL 5: expected false, got %', v_actual; end if;

  select internal.teams_can_play_fixture(v_burnley_u16_a, v_rossendale_u15_a) into v_actual;
  if v_actual = false then raise notice 'PASS 6: U16 vs U15 rejected'; else raise notice 'FAIL 6: expected false, got %', v_actual; end if;

  select internal.teams_can_play_fixture(v_burnley_u16_a, v_rossendale_colts_senior) into v_actual;
  if v_actual = false then raise notice 'PASS 7: U16 (youth) vs Colts (senior category) not auto-compatible'; else raise notice 'FAIL 7: expected false, got %', v_actual; end if;

  select internal.teams_can_play_fixture(v_burnley_u7_a, v_rossendale_u8_a) into v_actual;
  if v_actual = true then raise notice 'PASS 8: U7 vs U8 allowed (tag band)'; else raise notice 'FAIL 8: expected true, got %', v_actual; end if;

  select internal.teams_can_play_fixture(v_burnley_u6_a, v_rossendale_u6_a) into v_actual;
  if v_actual = true then raise notice 'PASS 9a: U6 vs U6 allowed'; else raise notice 'FAIL 9a: expected true, got %', v_actual; end if;

  select internal.teams_can_play_fixture(v_burnley_u6_a, v_burnley_u7_a) into v_actual;
  if v_actual = true then raise notice 'PASS 9b: U6 vs U7 allowed (tag band)'; else raise notice 'FAIL 9b: expected true, got %', v_actual; end if;

  select internal.teams_can_play_fixture(v_burnley_u6_a, v_rossendale_u8_a) into v_actual;
  if v_actual = true then raise notice 'PASS 9c: U6 vs U8 allowed (tag band)'; else raise notice 'FAIL 9c: expected true, got %', v_actual; end if;

  select internal.teams_can_play_fixture(v_burnley_u6_a, v_burnley_u9_a) into v_actual;
  if v_actual = false then raise notice 'PASS 9d: U6 vs U9 rejected (tag band stops at U8)'; else raise notice 'FAIL 9d: expected false, got %', v_actual; end if;

  select internal.teams_can_play_fixture(v_rossendale_u8_a, v_burnley_u9_a) into v_actual;
  if v_actual = false then raise notice 'PASS 10: U8 vs U9 rejected (tag band stops at U8)'; else raise notice 'FAIL 10: expected false, got %', v_actual; end if;

  select internal.teams_can_play_fixture(v_burnley_mens_2nd, v_rossendale_mens_3rd) into v_actual;
  if v_actual = true then raise notice 'PASS 11: Men''s 2nd vs Men''s 3rd NOT rejected solely on team number'; else raise notice 'FAIL 11: expected true, got %', v_actual; end if;

  select internal.teams_can_play_fixture(v_burnley_womens_1st, v_rossendale_womens_2nd) into v_actual;
  if v_actual = true then raise notice 'PASS 12: Women''s 1st vs Women''s 2nd NOT rejected solely on team number'; else raise notice 'FAIL 12: expected true, got %', v_actual; end if;

  select internal.teams_can_play_fixture(v_burnley_u14_girls, v_rossendale_u16_girls) into v_actual;
  if v_actual = true then raise notice 'PASS 13: girls differing age labels NOT rejected by the strict boys/mixed rule'; else raise notice 'FAIL 13: expected true, got %', v_actual; end if;

  select internal.teams_can_play_fixture(v_burnley_u12_a, v_burnley_u12_league) into v_actual;
  if v_actual = false then raise notice 'PASS 14: rugby-code mismatch (union vs league) remains invalid'; else raise notice 'FAIL 14: expected false, got %', v_actual; end if;

  select internal.teams_can_play_fixture(v_burnley_colts, v_burnley_mens_2nd) into v_actual;
  if v_actual = true then raise notice 'PASS 15: Colts (senior category) vs Men''s 2nd (senior category) allowed -- category match is the only senior rule'; else raise notice 'FAIL 15: expected true, got %', v_actual; end if;

  select internal.teams_can_play_fixture(v_rossendale_u9_a, v_burnley_u9_a) into v_actual;
  if v_actual = true then raise notice 'PASS 16: U9 vs U9 (same strict band) allowed'; else raise notice 'FAIL 16: expected true, got %', v_actual; end if;

  select internal.teams_can_play_fixture(v_burnley_mens_2nd, v_rossendale_womens_2nd) into v_actual;
  if v_actual = false then raise notice 'PASS 16b: Men''s never auto-matches against Women''s at senior level'; else raise notice 'FAIL 16b: expected false, got %', v_actual; end if;
end $$;

-- ------------------------------------------------------------
-- 17. Direct server-side attempt cannot bypass the U9-U16 rule -- the
--     trigger on fixtures itself blocks it, not just app-layer validation
--     or UI filtering.
-- ------------------------------------------------------------
do $$
begin
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('30000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'Home', 'U11 A', current_date + 60, 'Planned', 'site_admin_manual');
  raise notice 'FAIL 17: an age-ineligible fixture (U12 vs U11) was saved directly';
exception when others then
  if sqlerrm like '%Age-grade mismatch%' then
    raise notice 'PASS 17: direct insert of an age-ineligible fixture blocked at the trigger (%)', sqlerrm;
  else
    raise notice 'FAIL 17: unexpected error: %', sqlerrm;
  end if;
end $$;

-- ------------------------------------------------------------
-- 18. A genuinely eligible fixture (same age band) still saves fine --
--     the trigger isn't overly broad.
-- ------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('30000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', 'Home', 'U12 B', current_date + 61, 'Planned', 'site_admin_manual')
  returning id into v_id;
  raise notice 'PASS 18: an age-eligible fixture (U12 A vs U12 B) saved successfully';
  delete from public.fixtures where id = v_id;
exception when others then
  raise notice 'FAIL 18: %', sqlerrm;
end $$;

-- ------------------------------------------------------------
-- 19. An unresolved opponent (no team row -- raw text / directory-only)
--     is never blocked by this rule -- nothing to check yet.
-- ------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  insert into public.fixtures (owning_team_id, opponent_team_id, raw_opposition_text, home_away, kickoff_date, status, source)
  values ('30000000-0000-0000-0000-000000000001', null, 'Some Unresolved Club U11s', 'Home', current_date + 62, 'Planned', 'site_admin_manual')
  returning id into v_id;
  raise notice 'PASS 19: an unresolved (team-less) opponent is never blocked by the age rule';
  delete from public.fixtures where id = v_id;
exception when others then
  raise notice 'FAIL 19: %', sqlerrm;
end $$;

-- ------------------------------------------------------------
-- Cleanup -- every insert above used bare top-level `do $$` blocks (no
-- explicit transaction), so it all committed immediately rather than
-- rolling back. Remove it explicitly, including the throwaway league
-- club_directory/clubs row scenario 14 needed, so club_directory_integrity.sql's
-- row-count and activation-source assertions stay accurate afterwards.
-- ------------------------------------------------------------
do $$
begin
  delete from public.teams where id::text like '90000000-0000-0000-0000-0000000000%';
  delete from public.clubs where id = '90000000-0000-0000-0000-000000000098';
  delete from public.club_directory where id = '90000000-0000-0000-0000-000000000099';
end $$;
