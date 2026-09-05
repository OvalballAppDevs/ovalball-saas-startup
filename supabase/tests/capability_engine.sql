-- Canonical Scoped Capability Engine -- security regression + fixture
-- setup (Master Architecture Pass, before Access & Teams).
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/capability_engine.sql
--
-- SETUP is self-contained and PERSISTS (matches player_guardian_security.
-- sql's own strategy) -- a fresh Home/Away club pair, prefixed 99e00000-,
-- never touching Burnley/Rossendale/League Test Club A. The Home Club
-- Admin (test.multiclub.admin@ovalball.local) is the "ordinary multi-club
-- persona" Section 31 asked for: real CLUB_ADMIN membership at BOTH
-- clubs, and NO site_admins row at all -- unlike test.burnley.admin
-- (which happens to also be a full Site Admin, contaminating the previous
-- pass's live cross-club test). Real magic-link-loginable via Mailpit.
--
-- TESTS below are read-only has_capability() calls except where a write
-- (grant/deny/revoke/self-escalation/malformed) is under test -- those
-- are wrapped in begin/rollback so the persona's default-bundle state
-- stays clean and reusable for repeated live testing.

\set ON_ERROR_STOP off
\pset pager off

-- ============================================================
-- Setup: Home/Away clubs, teams, users, memberships, roster, and one
-- Guardian/Player relationship (no club_memberships at all) for the
-- Parent/Player safeguarding tests.
-- ============================================================
do $$
begin
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    ('99e00000-0000-0000-0000-0000000e0001', 'Capability Engine Test Home RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'cap-eng-test-home-99e00000'),
    ('99e00000-0000-0000-0000-0000000e0002', 'Capability Engine Test Away RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'cap-eng-test-away-99e00000')
  on conflict (id) do nothing;
  insert into public.clubs (id, directory_id, slug, status) values
    ('99e00000-0000-0000-0000-0000000c0001', '99e00000-0000-0000-0000-0000000e0001', 'cap-eng-test-home-99e00000', 'active'),
    ('99e00000-0000-0000-0000-0000000c0002', '99e00000-0000-0000-0000-0000000e0002', 'cap-eng-test-away-99e00000', 'active')
  on conflict (id) do nothing;

  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, display_name, slug, active, canonical_team_type_id) values
    ('99e00000-0000-0000-0000-000000100001', '99e00000-0000-0000-0000-0000000c0001', 'union', 'youth', 'U12', 'boys', 'Cap Engine Home U12', 'cap-engine-home-u12', true, '8f1de46c-9450-4a92-9abf-54f61ea17bba'),
    ('99e00000-0000-0000-0000-000000100002', '99e00000-0000-0000-0000-0000000c0001', 'union', 'youth', 'U13', 'boys', 'Cap Engine Home U13', 'cap-engine-home-u13', true, '0b5d8f47-6e53-4bb5-bf4f-0ed3206dd101'),
    ('99e00000-0000-0000-0000-000000110001', '99e00000-0000-0000-0000-0000000c0002', 'union', 'youth', 'U13', 'boys', 'Cap Engine Away U13', 'cap-engine-away-u13', true, '0b5d8f47-6e53-4bb5-bf4f-0ed3206dd101')
  on conflict (id) do nothing;

  -- MultiClubAdmin: ORDINARY multi-club Club Admin, no Site Admin row at all.
  -- HomeFixtureSecretary: Fixture Secretary at Home only.
  -- HomeCoachTeam1: coach of Home U12 only (not U13 -- proves sibling-team isolation).
  -- HomeGuardian: Guardian of a Home U12 player, with NO club_memberships row anywhere.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change) values
    ('99e00000-0000-0000-0000-000000200001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.multiclub.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('99e00000-0000-0000-0000-000000200002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.capeng.fixturesec@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('99e00000-0000-0000-0000-000000200003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.capeng.coach@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('99e00000-0000-0000-0000-000000200004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.capeng.guardian@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;

  insert into public.profiles (id, first_name, surname) values
    ('99e00000-0000-0000-0000-000000200001', 'Test', 'MultiClubAdmin'),
    ('99e00000-0000-0000-0000-000000200002', 'Test', 'CapEngFixtureSec'),
    ('99e00000-0000-0000-0000-000000200003', 'Test', 'CapEngCoach'),
    ('99e00000-0000-0000-0000-000000200004', 'Test', 'CapEngGuardian')
  on conflict (id) do nothing;

  insert into public.club_memberships (id, club_id, user_id, role, status) values
    ('99e00000-0000-0000-0000-000000600001', '99e00000-0000-0000-0000-0000000c0001', '99e00000-0000-0000-0000-000000200001', 'CLUB_ADMIN', 'active'),
    ('99e00000-0000-0000-0000-000000600002', '99e00000-0000-0000-0000-0000000c0002', '99e00000-0000-0000-0000-000000200001', 'CLUB_ADMIN', 'active'),
    ('99e00000-0000-0000-0000-000000600003', '99e00000-0000-0000-0000-0000000c0001', '99e00000-0000-0000-0000-000000200002', 'FIXTURE_SECRETARY', 'active'),
    ('99e00000-0000-0000-0000-000000600004', '99e00000-0000-0000-0000-0000000c0001', '99e00000-0000-0000-0000-000000200003', 'BASIC_USER', 'active')
  on conflict (id) do nothing;

  insert into public.team_permissions (id, membership_id, team_id, permission) values
    ('99e00000-0000-0000-0000-000000700001', '99e00000-0000-0000-0000-000000600004', '99e00000-0000-0000-0000-000000100001', 'coach')
  on conflict (id) do nothing;

  insert into public.players (id, first_name, surname, date_of_birth) values
    ('99e00000-0000-0000-0000-000000300001', 'Cap Engine', 'TestPlayer', null)
  on conflict (id) do nothing;
  insert into public.guardians (id, guardian_user_id, player_id, relationship_type, status) values
    ('99e00000-0000-0000-0000-000000400001', '99e00000-0000-0000-0000-000000200004', '99e00000-0000-0000-0000-000000300001', 'guardian', 'active')
  on conflict (id) do nothing;
  insert into public.player_team_memberships (id, player_id, team_id, status) values
    ('99e00000-0000-0000-0000-000000500001', '99e00000-0000-0000-0000-000000300001', '99e00000-0000-0000-0000-000000100001', 'active')
  on conflict (id) do nothing;
end $$;

-- ============================================================
-- 1. Role default capability works in the correct club.
-- ============================================================
do $$
declare v_ok boolean;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99e00000-0000-0000-0000-000000200001","role":"authenticated"}';
  select internal.has_capability('club.venues.manage', 'club', '99e00000-0000-0000-0000-0000000c0001', null) into v_ok;
  if v_ok then raise notice 'PASS 1: MultiClubAdmin has club.venues.manage at Home (their own club)';
  else raise notice 'FAIL 1: MultiClubAdmin lacks club.venues.manage at Home'; end if;
end $$;

-- ============================================================
-- 2. Same capability fails at a club the actor does NOT administer.
-- ============================================================
do $$
declare v_ok boolean;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99e00000-0000-0000-0000-000000200002","role":"authenticated"}';
  select internal.has_capability('club.venues.manage', 'club', '99e00000-0000-0000-0000-0000000c0001', null) into v_ok;
  if not v_ok then raise notice 'PASS 2: Fixture Secretary lacks club.venues.manage at Home (Club-Admin-only capability, deliberate asymmetry)';
  else raise notice 'FAIL 2: Fixture Secretary has club.venues.manage -- capability boundary broken'; end if;
end $$;

-- ============================================================
-- 3. Team capability works for the correct team.
-- ============================================================
do $$
declare v_ok boolean;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99e00000-0000-0000-0000-000000200003","role":"authenticated"}';
  select internal.has_capability('fixture.create', 'team', '99e00000-0000-0000-0000-0000000c0001', '99e00000-0000-0000-0000-000000100001') into v_ok;
  if v_ok then raise notice 'PASS 3: Home Coach has fixture.create on their own team (Home U12)';
  else raise notice 'FAIL 3: Home Coach lacks fixture.create on their own team'; end if;
end $$;

-- ============================================================
-- 4. Team capability fails for a SIBLING team in the same club.
-- ============================================================
do $$
declare v_ok boolean;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99e00000-0000-0000-0000-000000200003","role":"authenticated"}';
  select internal.has_capability('fixture.create', 'team', '99e00000-0000-0000-0000-0000000c0001', '99e00000-0000-0000-0000-000000100002') into v_ok;
  if not v_ok then raise notice 'PASS 4: Home Coach (U12 only) lacks fixture.create on the sibling team (Home U13) in the same club';
  else raise notice 'FAIL 4: Home Coach gained authority over a sibling team they were never assigned to'; end if;
end $$;

-- ============================================================
-- 5. Team capability fails when the team belongs to a DIFFERENT club --
-- direct malformed club_id/team_id pairing (the exact vulnerability class
-- fixed last pass).
-- ============================================================
do $$
declare v_ok boolean;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99e00000-0000-0000-0000-000000200001","role":"authenticated"}';
  -- Home club_id paired with an Away team_id -- has_capability() must reject the pairing itself.
  select internal.has_capability('club.roster.manage', 'team', '99e00000-0000-0000-0000-0000000c0001', '99e00000-0000-0000-0000-000000110001') into v_ok;
  if not v_ok then raise notice 'PASS 5: has_capability() rejects a malformed (Home club_id, Away team_id) pairing outright';
  else raise notice 'FAIL 5: has_capability() honored a cross-club club_id/team_id pairing'; end if;
end $$;

-- ============================================================
-- 6. Explicit grant works (Site Admin grants an additional legitimate
-- capability the role wouldn't otherwise carry).
-- ============================================================
begin;
do $$
declare v_ok_before boolean; v_ok_after boolean;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99e00000-0000-0000-0000-000000200002","role":"authenticated"}';
  select internal.has_capability('club.venues.manage', 'club', '99e00000-0000-0000-0000-0000000c0001', null) into v_ok_before;

  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}'; -- test.site.admin, full
  perform public.set_capability_override('99e00000-0000-0000-0000-000000200002', 'club.venues.manage', 'club', '99e00000-0000-0000-0000-0000000c0001', null, 'grant', 'capability engine test 6');

  set local request.jwt.claims = '{"sub":"99e00000-0000-0000-0000-000000200002","role":"authenticated"}';
  select internal.has_capability('club.venues.manage', 'club', '99e00000-0000-0000-0000-0000000c0001', null) into v_ok_after;

  if not v_ok_before and v_ok_after then raise notice 'PASS 6: explicit grant gave Fixture Secretary club.venues.manage at Home (was false, now true)';
  else raise notice 'FAIL 6: explicit grant did not take effect (before=%, after=%)', v_ok_before, v_ok_after; end if;
end $$;
rollback;

-- ============================================================
-- 7. Explicit deny works (Site Admin removes a capability the role
-- default would otherwise grant).
-- ============================================================
begin;
do $$
declare v_ok_before boolean; v_ok_after boolean;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99e00000-0000-0000-0000-000000200001","role":"authenticated"}';
  select internal.has_capability('club.venues.manage', 'club', '99e00000-0000-0000-0000-0000000c0001', null) into v_ok_before;

  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
  perform public.set_capability_override('99e00000-0000-0000-0000-000000200001', 'club.venues.manage', 'club', '99e00000-0000-0000-0000-0000000c0001', null, 'deny', 'capability engine test 7');

  set local request.jwt.claims = '{"sub":"99e00000-0000-0000-0000-000000200001","role":"authenticated"}';
  select internal.has_capability('club.venues.manage', 'club', '99e00000-0000-0000-0000-0000000c0001', null) into v_ok_after;

  if v_ok_before and not v_ok_after then raise notice 'PASS 7: explicit deny removed MultiClubAdmin''s club.venues.manage at Home despite the Club Admin default (was true, now false)';
  else raise notice 'FAIL 7: explicit deny did not take effect (before=%, after=%)', v_ok_before, v_ok_after; end if;
end $$;
rollback;

-- ============================================================
-- 8. Revocation propagates (deny, confirm false, revoke, confirm the
-- role default is restored -- no other page/table needed editing).
-- ============================================================
begin;
do $$
declare v_id uuid; v_denied boolean; v_restored boolean;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
  select public.set_capability_override('99e00000-0000-0000-0000-000000200001', 'club.venues.manage', 'club', '99e00000-0000-0000-0000-0000000c0001', null, 'deny', 'capability engine test 8') into v_id;

  set local request.jwt.claims = '{"sub":"99e00000-0000-0000-0000-000000200001","role":"authenticated"}';
  select internal.has_capability('club.venues.manage', 'club', '99e00000-0000-0000-0000-0000000c0001', null) into v_denied;

  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
  perform public.revoke_capability_override(v_id);

  set local request.jwt.claims = '{"sub":"99e00000-0000-0000-0000-000000200001","role":"authenticated"}';
  select internal.has_capability('club.venues.manage', 'club', '99e00000-0000-0000-0000-0000000c0001', null) into v_restored;

  if not v_denied and v_restored then raise notice 'PASS 8: deny -> false, revoke -> role default restored to true, with zero other edits';
  else raise notice 'FAIL 8: revocation did not propagate correctly (denied=%, restored=%)', v_denied, v_restored; end if;
end $$;
rollback;

-- ============================================================
-- 9. Self-escalation fails: nobody may grant/deny/revoke their OWN
-- capabilities, even a Full Site Admin.
-- ============================================================
begin;
do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}'; -- test.site.admin, full
  begin
    perform public.set_capability_override('00000000-0000-0000-0000-000000000001', 'site.permissions.manage', 'site', null, null, 'grant', 'self-escalation attempt');
    raise notice 'FAIL 9: a Full Site Admin self-granted a capability -- self-escalation succeeded';
  exception when others then
    raise notice 'PASS 9: self-escalation blocked (%)', sqlerrm;
  end;
end $$;
rollback;

-- ============================================================
-- 10. Cross-club malformed grant fails: Home membership relationship,
-- Away team_id -- must be rejected by set_capability_override() itself,
-- before it ever reaches the table's own trigger.
-- ============================================================
begin;
do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
  begin
    perform public.set_capability_override(
      '99e00000-0000-0000-0000-000000200003', 'team.roster.manage', 'team',
      '99e00000-0000-0000-0000-0000000c0001', -- Home club
      '99e00000-0000-0000-0000-000000110001', -- Away team
      'grant', 'malformed cross-club attempt'
    );
    raise notice 'FAIL 10: a cross-club club_id/team_id pairing was accepted by set_capability_override()';
  exception when others then
    raise notice 'PASS 10: cross-club malformed grant rejected (%)', sqlerrm;
  end;
end $$;
rollback;

-- ============================================================
-- 11. Parent cannot gain administrative authority through relationship
-- alone. The Guardian has NO club_memberships row anywhere.
-- ============================================================
do $$
declare v_ok boolean;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99e00000-0000-0000-0000-000000200004","role":"authenticated"}';
  select internal.has_capability('club.roster.manage', 'team', '99e00000-0000-0000-0000-0000000c0001', '99e00000-0000-0000-0000-000000100001') into v_ok;
  if not v_ok then raise notice 'PASS 11: the Guardian of a Home U12 player has zero administrative capability over that team -- relationship alone grants nothing';
  else raise notice 'FAIL 11: a Guardian relationship alone granted administrative capability'; end if;
end $$;

-- ============================================================
-- 12. Player cannot gain administrative authority through relationship
-- alone. (This fixture's Player has no linked auth.users account, so this
-- asserts the same has_capability() call for an unrelated actor with zero
-- relationship to the club -- the Away Fixture-Secretary-less club admin
-- test account has none at Home -- proving the negative independently of
-- the Player/Guardian tables even being consulted.)
-- ============================================================
do $$
declare v_ok boolean;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"93900000-0000-0000-0000-000000000001","role":"authenticated"}'; -- Rossendale Fixture Secretary, no relationship to Home at all
  select internal.has_capability('club.roster.manage', 'team', '99e00000-0000-0000-0000-0000000c0001', '99e00000-0000-0000-0000-000000100001') into v_ok;
  if not v_ok then raise notice 'PASS 12: an actor with no relationship to this club/team (proxy for Player-side safeguarding) has zero administrative capability';
  else raise notice 'FAIL 12: an unrelated actor gained administrative capability'; end if;
end $$;

-- ============================================================
-- 13. Narrow Site Admin capability does not imply an unrelated Site Admin
-- capability. test.plain.lookups.admin is admin_role='read_only' (NOT
-- full, so no master bypass) -- temporarily grant it ONLY
-- manage_global_lookups within this rolled-back transaction and confirm
-- every other narrow capability stays false.
-- ============================================================
begin;
update public.site_admins set manage_global_lookups = true where user_id = '96100000-0000-0000-0000-000000000002';
do $$
declare v_lookups boolean; v_competitions boolean; v_permissions boolean;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"96100000-0000-0000-0000-000000000002","role":"authenticated"}'; -- test.plain.lookups.admin, read_only base role
  select internal.has_capability('site.lookups.manage', 'site', null, null) into v_lookups;
  select internal.has_capability('site.competitions.manage', 'site', null, null) into v_competitions;
  select internal.has_capability('site.permissions.manage', 'site', null, null) into v_permissions;
  if v_lookups and not v_competitions and not v_permissions then
    raise notice 'PASS 13: a non-full Site Admin with only manage_global_lookups has site.lookups.manage but NOT site.competitions.manage or site.permissions.manage -- narrow flags do not cross-imply';
  else
    raise notice 'FAIL 13: narrow Site Admin capability leaked into an unrelated domain (lookups=%, competitions=%, permissions=%)', v_lookups, v_competitions, v_permissions;
  end if;
end $$;
rollback;

-- ============================================================
-- 14. Capability applicable-scope closure (addendum Section 17): a
-- club-only capability structurally rejects being checked at team/site
-- scope, and a site-only capability structurally rejects being checked at
-- club scope -- even for an actor who would otherwise clearly pass.
-- ============================================================
do $$
declare v_wrong_scope boolean; v_right_scope boolean;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99e00000-0000-0000-0000-000000200001","role":"authenticated"}'; -- MultiClubAdmin, real Club Admin at Home
  -- club.venues.manage is applicable_scopes = {club} only -- checking it at
  -- 'team' scope must structurally reject, regardless of club_id/team_id validity.
  select internal.has_capability('club.venues.manage', 'team', '99e00000-0000-0000-0000-0000000c0001', '99e00000-0000-0000-0000-000000100001') into v_wrong_scope;
  select internal.has_capability('club.venues.manage', 'club', '99e00000-0000-0000-0000-0000000c0001', null) into v_right_scope;
  if not v_wrong_scope and v_right_scope then
    raise notice 'PASS 14a: club.venues.manage (club-only) structurally rejected at team scope, still correctly true at club scope';
  else
    raise notice 'FAIL 14a: applicable-scope closure did not hold for club.venues.manage (wrong_scope=%, right_scope=%)', v_wrong_scope, v_right_scope;
  end if;
end $$;

do $$
declare v_wrong_scope boolean;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}'; -- test.site.admin, full
  -- site.permissions.manage is applicable_scopes = {site} only -- checking
  -- it at 'club' scope must structurally reject even for a Full Site Admin.
  select internal.has_capability('site.permissions.manage', 'club', '10000000-0000-0000-0000-000000000001', null) into v_wrong_scope;
  if not v_wrong_scope then
    raise notice 'PASS 14b: site.permissions.manage (site-only) structurally rejected at club scope, even for a Full Site Admin';
  else
    raise notice 'FAIL 14b: applicable-scope closure did not hold for site.permissions.manage (wrong_scope=%)', v_wrong_scope;
  end if;
end $$;

-- ============================================================
-- 15. Applicable-scope closure also applies to grant/deny itself: an
-- attempt to grant a club-only capability at team scope is rejected by
-- set_capability_override(), never silently coerced.
-- ============================================================
begin;
do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
  begin
    perform public.set_capability_override(
      '99e00000-0000-0000-0000-000000200002', 'club.venues.manage', 'team',
      '99e00000-0000-0000-0000-0000000c0001', '99e00000-0000-0000-0000-000000100001',
      'grant', 'scope-closure test'
    );
    raise notice 'FAIL 15: set_capability_override() accepted a club-only capability at team scope';
  exception when others then
    raise notice 'PASS 15: set_capability_override() rejected a club-only capability granted at team scope (%)', sqlerrm;
  end;
end $$;
rollback;

-- ============================================================
-- 16. A deactivated club grants NO capability to its own Club Admin, even
-- with an untouched (active, non-suspended) club_memberships row --
-- regression coverage for a real gap found live this pass:
-- has_club_role_capability()/has_team_role_capability() never checked
-- internal.is_club_active(), unlike the legacy is_club_admin() /
-- can_manage_club_fixtures() / can_manage_team() functions they were
-- meant to be equivalent to. Fixed in
-- 20260924200000_capability_engine_club_active_gap.sql.
-- ============================================================
begin;
do $$
declare v_club_scope boolean; v_team_scope boolean;
begin
  update public.clubs set status = 'deactivated' where id = '99e00000-0000-0000-0000-0000000c0001';

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99e00000-0000-0000-0000-000000200001","role":"authenticated"}';
  select internal.has_capability('club.venues.manage', 'club', '99e00000-0000-0000-0000-0000000c0001', null) into v_club_scope;
  select internal.has_capability('fixture.create', 'team', '99e00000-0000-0000-0000-0000000c0001', '99e00000-0000-0000-0000-000000100001') into v_team_scope;

  if not v_club_scope and not v_team_scope then
    raise notice 'PASS 16: a deactivated club grants zero capability to its own (still active, non-suspended) Club Admin, at both club and team scope';
  else
    raise notice 'FAIL 16: deactivated-club gap not closed (club_scope=%, team_scope=%)', v_club_scope, v_team_scope;
  end if;
end $$;
rollback;
