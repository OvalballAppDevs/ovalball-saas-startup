-- Ovie Phase 1/2 security regression: Ovie introduces NO new tables, RPCs,
-- or RLS policies of its own (supabase/migrations/20260918000000_ovie_
-- foundation.sql adds one provenance column only) -- every real write and
-- read Ovie ever performs travels through the SAME fixture_request_groups/
-- fixture_requests/venues/club_pitches/fixtures RLS this suite already
-- exercises elsewhere. This file exists to make that boundary explicit
-- and permanently regression-tested IN OVIE'S OWN NAME, for the exact
-- actor scenarios the security review demanded (D: Parent/Player, F:
-- cross-club privacy of sensitive tables Ovie must never touch, H: direct
-- invocation bypassing the UI/model entirely) -- not a re-run of the
-- generic fixture-permission coverage permission_matrix.sql and
-- team_scoped_fixture_requests.sql already provide.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/ovie_security.sql
--
-- Self-contained: two fresh standalone clubs, never Burnley/Rossendale.

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    ('99c00000-0000-0000-0000-0000000e0001', 'Ovie Security Test Home RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ovie-sec-test-home-99c00000'),
    ('99c00000-0000-0000-0000-0000000e0002', 'Ovie Security Test Away RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ovie-sec-test-away-99c00000')
  on conflict (id) do nothing;
  insert into public.clubs (id, directory_id, slug, status) values
    ('99c00000-0000-0000-0000-0000000c0001', '99c00000-0000-0000-0000-0000000e0001', 'ovie-sec-test-home-99c00000', 'active'),
    ('99c00000-0000-0000-0000-0000000c0002', '99c00000-0000-0000-0000-0000000e0002', 'ovie-sec-test-away-99c00000', 'active')
  on conflict (id) do nothing;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change) values
    ('99c00000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.oviesec.parent@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('99c00000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.oviesec.u12coach@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('99c00000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.oviesec.awayadmin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;
  insert into public.profiles (id, first_name, surname, email) values
    ('99c00000-0000-0000-0000-000000000101', 'Test', 'OvieSecParent', 'test.oviesec.parent@ovalball.local'),
    ('99c00000-0000-0000-0000-000000000102', 'Test', 'OvieSecU12Coach', 'test.oviesec.u12coach@ovalball.local'),
    ('99c00000-0000-0000-0000-000000000201', 'Test', 'OvieSecAwayAdmin', 'test.oviesec.awayadmin@ovalball.local')
  on conflict (id) do nothing;

  -- D: a genuine view-only Parent/Player -- BASIC_USER club membership,
  -- view_only team permission, exactly what makes
  -- isViewOnlyEverywhere()/OvieActorContext.viewOnly true.
  insert into public.club_memberships (id, club_id, user_id, role, status) values
    ('99c00000-0000-0000-0000-000000000103', '99c00000-0000-0000-0000-0000000c0001', '99c00000-0000-0000-0000-000000000101', 'BASIC_USER', 'active'),
    ('99c00000-0000-0000-0000-000000000104', '99c00000-0000-0000-0000-0000000c0001', '99c00000-0000-0000-0000-000000000102', 'BASIC_USER', 'active'),
    ('99c00000-0000-0000-0000-000000000202', '99c00000-0000-0000-0000-0000000c0002', '99c00000-0000-0000-0000-000000000201', 'CLUB_ADMIN', 'active')
  on conflict (id) do nothing;

  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug) values
    ('99c00000-0000-0000-0000-000000000105', '99c00000-0000-0000-0000-0000000c0001', 'union', 'youth', 'U12', 'boys', null, 'Ovie Security Test Home RUFC U12 Boys', 'ovie-sec-home-u12-boys'),
    ('99c00000-0000-0000-0000-000000000106', '99c00000-0000-0000-0000-0000000c0001', 'union', 'youth', 'U13', 'boys', null, 'Ovie Security Test Home RUFC U13 Boys', 'ovie-sec-home-u13-boys'),
    ('99c00000-0000-0000-0000-000000000203', '99c00000-0000-0000-0000-0000000c0002', 'union', 'youth', 'U12', 'boys', null, 'Ovie Security Test Away RUFC U12 Boys', 'ovie-sec-away-u12-boys')
  on conflict (id) do nothing;

  insert into public.team_permissions (id, membership_id, team_id, permission) values
    ('99c00000-0000-0000-0000-000000000107', '99c00000-0000-0000-0000-000000000103', '99c00000-0000-0000-0000-000000000105', 'view_only'),
    ('99c00000-0000-0000-0000-000000000108', '99c00000-0000-0000-0000-000000000104', '99c00000-0000-0000-0000-000000000105', 'coach')
  on conflict (id) do nothing;

  -- A private, sensitive fixture message on a real fixture between the two
  -- test clubs -- used to prove Ovie's own read surface (fixtures/
  -- club_pitches/venues) staying open by design does NOT mean message
  -- content is reachable the same way.
  insert into public.fixtures (id, owning_team_id, opponent_team_id, kickoff_date, home_away, status, raw_opposition_text, season_id) values
    ('99c00000-0000-0000-0000-000000000301', '99c00000-0000-0000-0000-000000000105', '99c00000-0000-0000-0000-000000000203', current_date + 14, 'Home', 'Booked', 'Ovie Security Test Away RUFC', null)
  on conflict (id) do nothing;
  insert into public.fixture_messages (id, fixture_id, sender_user_id, body) values
    ('99c00000-0000-0000-0000-000000000302', '99c00000-0000-0000-0000-000000000301', '99c00000-0000-0000-0000-000000000201', 'Private note: our star player is injured, keep this between us')
  on conflict (id) do nothing;
end $$;

\echo '=== Ovie security fixtures ready. Running scenarios. ==='

-- ------------------------------------------------------------
-- D. Parent/Player (genuine view-only): direct attempt to create a
-- fixture_request_groups row for their own club, bypassing Ovie/the UI
-- entirely -- exactly what "H. Direct API invocation" also demands: the
-- protection lives at the RLS boundary, not in Ovie's own TypeScript, so
-- it holds even when Ovie is skipped altogether.
-- ------------------------------------------------------------
do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99c00000-0000-0000-0000-000000000101","role":"authenticated"}';
  begin
    insert into public.fixture_request_groups (requesting_club_id, opponent_club_id, proposed_date, raw_opponent_text, created_by, source)
    values ('99c00000-0000-0000-0000-0000000c0001', '99c00000-0000-0000-0000-0000000c0002', current_date + 30, 'Ovie Security Test Away RUFC', '99c00000-0000-0000-0000-000000000101', 'ovie_assistant');
    raise notice 'FAIL D/H: view-only Parent/Player created a fixture_request_groups row directly, bypassing the UI/Ovie entirely';
  exception when others then
    raise notice 'PASS D/H: view-only Parent/Player blocked from direct fixture_request_groups insert (%)', sqlerrm;
  end;
end $$;

-- ------------------------------------------------------------
-- B. A team-scoped U12 Coach (no club-wide role) CAN create a request for
-- their own U12 -- but must NOT be able to act "on behalf of" a sibling
-- team (U13) at the same club they have no scope over. Confirms Ovie's
-- own canActOnTeam() gate is backed by a real RLS wall, not just app logic
-- a direct API call could route around.
-- ------------------------------------------------------------
do $$
declare
  v_group_id uuid;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99c00000-0000-0000-0000-000000000102","role":"authenticated"}';

  insert into public.fixture_request_groups (requesting_club_id, opponent_club_id, proposed_date, raw_opponent_text, created_by, source)
  values ('99c00000-0000-0000-0000-0000000c0001', '99c00000-0000-0000-0000-0000000c0002', current_date + 31, 'Ovie Security Test Away RUFC', '99c00000-0000-0000-0000-000000000102', 'ovie_assistant')
  returning id into v_group_id;

  begin
    insert into public.fixture_requests (group_id, requesting_team_id, venue_preference, created_by)
    values (v_group_id, '99c00000-0000-0000-0000-000000000105', 'home', '99c00000-0000-0000-0000-000000000102');
    raise notice 'PASS B: U12 Coach created a fixture_requests row for their own U12 (source=ovie_assistant, exactly Ovie''s own write path)';
  exception when others then
    raise notice 'FAIL B: U12 Coach could not create a request for their own team (%)', sqlerrm;
  end;

  begin
    insert into public.fixture_requests (group_id, requesting_team_id, venue_preference, created_by)
    values (v_group_id, '99c00000-0000-0000-0000-000000000106', 'home', '99c00000-0000-0000-0000-000000000102');
    raise notice 'FAIL B: U12 Coach created a fixture_requests row for the UNRELATED U13 team they have no scope over';
  exception when others then
    raise notice 'PASS B: U12 Coach blocked from acting on the sibling U13 team (%)', sqlerrm;
  end;
end $$;
rollback;

-- ------------------------------------------------------------
-- F. Cross-club privacy: the away club's PRIVATE fixture message must
-- never be selectable by the home club's own view-only Parent -- proving
-- the open reads Ovie relies on (fixtures/venues/club_pitches, all
-- `using (true)` by deliberate, documented design) do NOT extend to
-- fixture_messages, which stays properly scoped. Ovie itself never
-- queries fixture_messages at all (see lib/ovie/opponent-search.ts's own
-- module comment) -- this proves the boundary would hold even if it did.
-- ------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99c00000-0000-0000-0000-000000000101","role":"authenticated"}';
  select count(*) into v_count from public.fixture_messages where id = '99c00000-0000-0000-0000-000000000302';
  if v_count = 0 then
    raise notice 'PASS F: view-only Parent cannot see the private fixture_messages row on their own club''s fixture';
  else
    raise notice 'FAIL F: view-only Parent could see a private fixture_messages row (count=%)', v_count;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- E (narrow Site Admin -> full Site Admin escalation): documented, not
-- runnable here -- Ovie's own actor-context.ts reads ctx.isSiteAdmin
-- verbatim from lib/app-context/session-context.ts, the exact same
-- boolean every other RLS-facing surface in this app already uses (see
-- internal.is_site_admin()). Ovie adds no separate narrow-capability
-- check of its own to accidentally bypass -- there is nothing here for a
-- narrow Site Admin to escalate THROUGH beyond what site_admin_management.sql
-- already regression-tests for is_site_admin() itself. A dedicated
-- assertion in this file would only re-test that existing coverage under
-- Ovie's name, not prove anything Ovie-specific.
-- ------------------------------------------------------------
\echo '=== Done. E is a documentation-only scenario -- see the comment above. ==='
