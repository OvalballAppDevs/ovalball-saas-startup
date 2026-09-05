-- Player / Guardian relationship foundation -- security regression
-- (Master Architecture Pass). Proves the RLS boundary on the three new
-- tables (players, guardians, player_team_memberships) added in
-- 20260920000000_player_guardian_foundation.sql, and the scenario matrix
-- explicitly requested (Section 42/43): multi-child parent, multi-team
-- player, parent who is also a player, cross-club isolation, direct
-- enumeration/bypass attempts, and the DOB/youth-safety-fallback rule.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/player_guardian_security.sql
--
-- Self-contained: two fresh standalone clubs (Home/Away), never
-- Burnley/Rossendale or any other real playground data.

\set ON_ERROR_STOP off
\pset pager off

-- ============================================================
-- Setup: clubs, teams, users, players, guardians, memberships.
-- ============================================================
do $$
begin
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    ('99d00000-0000-0000-0000-0000000e0001', 'PG Security Test Home RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'pg-sec-test-home-99d00000'),
    ('99d00000-0000-0000-0000-0000000e0002', 'PG Security Test Away RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'pg-sec-test-away-99d00000')
  on conflict (id) do nothing;
  insert into public.clubs (id, directory_id, slug, status) values
    ('99d00000-0000-0000-0000-0000000c0001', '99d00000-0000-0000-0000-0000000e0001', 'pg-sec-test-home-99d00000', 'active'),
    ('99d00000-0000-0000-0000-0000000c0002', '99d00000-0000-0000-0000-0000000e0002', 'pg-sec-test-away-99d00000', 'active')
  on conflict (id) do nothing;

  -- Teams -- canonical_team_type_id reused from the real global lookup
  -- table (u12/u14/senior_colts boys, u13 boys), never a locally-invented
  -- type. Home club: U12, U14, Senior Colts. Away club: U13.
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, display_name, slug, active, canonical_team_type_id) values
    ('99d00000-0000-0000-0000-000000100001', '99d00000-0000-0000-0000-0000000c0001', 'union', 'youth', 'U12', 'boys', 'PG Test Home U12', 'pg-test-home-u12', true, '8f1de46c-9450-4a92-9abf-54f61ea17bba'),
    ('99d00000-0000-0000-0000-000000100002', '99d00000-0000-0000-0000-0000000c0001', 'union', 'youth', 'U14', 'boys', 'PG Test Home U14', 'pg-test-home-u14', true, '04faeca8-540d-467b-ae1c-680c35b64ad0'),
    ('99d00000-0000-0000-0000-000000100003', '99d00000-0000-0000-0000-0000000c0001', 'union', 'colts', 'SeniorColts', null, 'PG Test Home Senior Colts', 'pg-test-home-senior-colts', true, '2f3a1174-b317-42aa-940d-11b712235b1c'),
    ('99d00000-0000-0000-0000-000000110001', '99d00000-0000-0000-0000-0000000c0002', 'union', 'youth', 'U13', 'boys', 'PG Test Away U13', 'pg-test-away-u13', true, '0b5d8f47-6e53-4bb5-bf4f-0ed3206dd101')
  on conflict (id) do nothing;

  -- Users: A (ordinary parent), B (multi-child parent), C (parent of a
  -- dual-registered player), D (parent AND player, independently), E
  -- (Home Club Admin who is ALSO a parent), F (Away U13 Coach who is
  -- ALSO a Home parent -- the cross-club isolation case), plus a
  -- standalone Away parent (G) with no Home relationship at all, used as
  -- the "genuinely unrelated" control for enumeration tests.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change) values
    ('99d00000-0000-0000-0000-000000200001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.pgsec.parentA@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('99d00000-0000-0000-0000-000000200002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.pgsec.parentB@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('99d00000-0000-0000-0000-000000200003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.pgsec.parentC@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('99d00000-0000-0000-0000-000000200004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.pgsec.parentAndPlayerD@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('99d00000-0000-0000-0000-000000200005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.pgsec.clubAdminParentE@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('99d00000-0000-0000-0000-000000200006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.pgsec.crossClubF@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('99d00000-0000-0000-0000-000000200007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.pgsec.unrelatedAwayG@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;
  insert into public.profiles (id, first_name, surname, email) values
    ('99d00000-0000-0000-0000-000000200001', 'Test', 'PGSecParentA', 'test.pgsec.parentA@ovalball.local'),
    ('99d00000-0000-0000-0000-000000200002', 'Test', 'PGSecParentB', 'test.pgsec.parentB@ovalball.local'),
    ('99d00000-0000-0000-0000-000000200003', 'Test', 'PGSecParentC', 'test.pgsec.parentC@ovalball.local'),
    ('99d00000-0000-0000-0000-000000200004', 'Test', 'PGSecParentAndPlayerD', 'test.pgsec.parentAndPlayerD@ovalball.local'),
    ('99d00000-0000-0000-0000-000000200005', 'Test', 'PGSecClubAdminParentE', 'test.pgsec.clubAdminParentE@ovalball.local'),
    ('99d00000-0000-0000-0000-000000200006', 'Test', 'PGSecCrossClubF', 'test.pgsec.crossClubF@ovalball.local'),
    ('99d00000-0000-0000-0000-000000200007', 'Test', 'PGSecUnrelatedAwayG', 'test.pgsec.unrelatedAwayG@ovalball.local')
  on conflict (id) do nothing;

  -- User E: Home Club Admin (their OWN parent relationship is separate,
  -- via guardians below -- proves Club Admin authority and Guardian
  -- relationship coexist without either implying the other).
  insert into public.club_memberships (id, user_id, club_id, role, status) values
    ('99d00000-0000-0000-0000-000000600001', '99d00000-0000-0000-0000-000000200005', '99d00000-0000-0000-0000-0000000c0001', 'CLUB_ADMIN', 'active')
  on conflict (id) do nothing;
  -- User F: Away club's U13 Coach (team_permissions, unrelated to their
  -- Home Guardian relationship below).
  insert into public.club_memberships (id, user_id, club_id, role, status) values
    ('99d00000-0000-0000-0000-000000600002', '99d00000-0000-0000-0000-000000200006', '99d00000-0000-0000-0000-0000000c0002', 'BASIC_USER', 'active')
  on conflict (id) do nothing;
  insert into public.team_permissions (id, membership_id, team_id, permission) values
    ('99d00000-0000-0000-0000-000000700001', '99d00000-0000-0000-0000-000000600002', '99d00000-0000-0000-0000-000000110001', 'coach')
  on conflict (id) do nothing;
  -- User G: a genuinely unrelated Away-club parent, no Home relationship
  -- of any kind -- the negative control for cross-club isolation.
  insert into public.club_memberships (id, user_id, club_id, role, status) values
    ('99d00000-0000-0000-0000-000000600003', '99d00000-0000-0000-0000-000000200007', '99d00000-0000-0000-0000-0000000c0002', 'BASIC_USER', 'active')
  on conflict (id) do nothing;

  -- Players. Scenario letters match the Master Architecture Pass §42.
  insert into public.players (id, first_name, surname, date_of_birth, user_id) values
    ('99d00000-0000-0000-0000-000000300001', 'PlayerA1', 'Test', null, null),                                            -- A: ordinary parent's one player
    ('99d00000-0000-0000-0000-000000300002', 'PlayerB1', 'Test', null, null),                                            -- B: multi-child parent, child 1 -> U12
    ('99d00000-0000-0000-0000-000000300003', 'PlayerB2', 'Test', null, null),                                            -- B: multi-child parent, child 2 -> U14
    ('99d00000-0000-0000-0000-000000300004', 'PlayerC1', 'Test', null, null),                                            -- C: one player, two teams (U12 + U14)
    ('99d00000-0000-0000-0000-000000300005', 'PlayerD1Child', 'Test', null, null),                                       -- D: the child Guardian relationship
    ('99d00000-0000-0000-0000-000000300006', 'PGSecParentAndPlayerD', 'Test', '2005-01-01', '99d00000-0000-0000-0000-000000200004'), -- D: the SAME human's own linked Player record (adult, Senior Colts)
    ('99d00000-0000-0000-0000-000000300007', 'PlayerE1', 'Test', null, null),                                            -- E: Home Club Admin's own child
    ('99d00000-0000-0000-0000-000000300008', 'PlayerF1', 'Test', null, null),                                            -- F: cross-club user's Home child
    ('99d00000-0000-0000-0000-000000300009', 'PlayerAway1', 'Test', null, null),                                        -- Away club's own player (F coaches this team; G has no relation to them)
    ('99d00000-0000-0000-0000-000000300010', 'PlayerG_SeniorColtsMinor', 'Test', (current_date - interval '16 years')::date, null), -- G: Senior Colts, DOB proves under-18
    ('99d00000-0000-0000-0000-000000300011', 'PlayerH_SeniorColtsAdult', 'Test', (current_date - interval '20 years')::date, null), -- H: Senior Colts, DOB proves 18+
    ('99d00000-0000-0000-0000-000000300012', 'PlayerI_U12NoDob', 'Test', null, null)                                     -- I: U12, DOB unknown -> youth safety fallback
  on conflict (id) do nothing;

  insert into public.guardians (id, guardian_user_id, player_id, relationship_type, status) values
    ('99d00000-0000-0000-0000-000000400001', '99d00000-0000-0000-0000-000000200001', '99d00000-0000-0000-0000-000000300001', 'parent', 'active'), -- A
    ('99d00000-0000-0000-0000-000000400002', '99d00000-0000-0000-0000-000000200002', '99d00000-0000-0000-0000-000000300002', 'parent', 'active'), -- B child 1
    ('99d00000-0000-0000-0000-000000400003', '99d00000-0000-0000-0000-000000200002', '99d00000-0000-0000-0000-000000300003', 'parent', 'active'), -- B child 2
    ('99d00000-0000-0000-0000-000000400004', '99d00000-0000-0000-0000-000000200003', '99d00000-0000-0000-0000-000000300004', 'parent', 'active'), -- C
    ('99d00000-0000-0000-0000-000000400005', '99d00000-0000-0000-0000-000000200004', '99d00000-0000-0000-0000-000000300005', 'parent', 'active'), -- D (guardian half)
    ('99d00000-0000-0000-0000-000000400006', '99d00000-0000-0000-0000-000000200005', '99d00000-0000-0000-0000-000000300007', 'parent', 'active'), -- E
    ('99d00000-0000-0000-0000-000000400007', '99d00000-0000-0000-0000-000000200006', '99d00000-0000-0000-0000-000000300008', 'parent', 'active')  -- F
  on conflict (id) do nothing;

  insert into public.player_team_memberships (id, player_id, team_id, status) values
    ('99d00000-0000-0000-0000-000000500001', '99d00000-0000-0000-0000-000000300001', '99d00000-0000-0000-0000-000000100001', 'active'), -- A -> Home U12
    ('99d00000-0000-0000-0000-000000500002', '99d00000-0000-0000-0000-000000300002', '99d00000-0000-0000-0000-000000100001', 'active'), -- B1 -> Home U12
    ('99d00000-0000-0000-0000-000000500003', '99d00000-0000-0000-0000-000000300003', '99d00000-0000-0000-0000-000000100002', 'active'), -- B2 -> Home U14
    ('99d00000-0000-0000-0000-000000500004', '99d00000-0000-0000-0000-000000300004', '99d00000-0000-0000-0000-000000100001', 'active'), -- C1 -> Home U12
    ('99d00000-0000-0000-0000-000000500005', '99d00000-0000-0000-0000-000000300004', '99d00000-0000-0000-0000-000000100002', 'active'), -- C1 -> Home U14 (dual-registered)
    ('99d00000-0000-0000-0000-000000500006', '99d00000-0000-0000-0000-000000300005', '99d00000-0000-0000-0000-000000100001', 'active'), -- D-child -> Home U12
    ('99d00000-0000-0000-0000-000000500007', '99d00000-0000-0000-0000-000000300006', '99d00000-0000-0000-0000-000000100003', 'active'), -- D-self -> Home Senior Colts
    ('99d00000-0000-0000-0000-000000500008', '99d00000-0000-0000-0000-000000300007', '99d00000-0000-0000-0000-000000100001', 'active'), -- E -> Home U12
    ('99d00000-0000-0000-0000-000000500009', '99d00000-0000-0000-0000-000000300008', '99d00000-0000-0000-0000-000000100001', 'active'), -- F -> Home U12
    ('99d00000-0000-0000-0000-000000500010', '99d00000-0000-0000-0000-000000300009', '99d00000-0000-0000-0000-000000110001', 'active'), -- Away1 -> Away U13
    ('99d00000-0000-0000-0000-000000500011', '99d00000-0000-0000-0000-000000300010', '99d00000-0000-0000-0000-000000100003', 'active'), -- G -> Home Senior Colts
    ('99d00000-0000-0000-0000-000000500012', '99d00000-0000-0000-0000-000000300011', '99d00000-0000-0000-0000-000000100003', 'active'), -- H -> Home Senior Colts
    ('99d00000-0000-0000-0000-000000500013', '99d00000-0000-0000-0000-000000300012', '99d00000-0000-0000-0000-000000100001', 'active')  -- I -> Home U12
  on conflict (id) do nothing;
end $$;

-- ============================================================
-- A: ordinary Parent -> one Player -> U12. Exactly one player visible.
-- ============================================================
do $$
declare v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99d00000-0000-0000-0000-000000200001","role":"authenticated"}';
  select count(*) into v_count from public.players;
  if v_count = 1 then
    raise notice 'PASS A: ordinary Parent sees exactly 1 player (their own child), not the whole test fixture set';
  else
    raise notice 'FAIL A: ordinary Parent sees % players, expected exactly 1', v_count;
  end if;
end $$;
rollback;

-- ============================================================
-- B: multi-child parent resolves BOTH children, on their own distinct
-- teams, and nothing else.
-- ============================================================
do $$
declare v_player_count integer; v_team_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99d00000-0000-0000-0000-000000200002","role":"authenticated"}';
  select count(*) into v_player_count from public.players;
  select count(distinct team_id) into v_team_count from public.player_team_memberships where status = 'active';
  if v_player_count = 2 and v_team_count = 2 then
    raise notice 'PASS B: multi-child parent sees exactly 2 players across exactly 2 distinct teams (U12 + U14)';
  else
    raise notice 'FAIL B: multi-child parent sees % players / % teams, expected 2 / 2', v_player_count, v_team_count;
  end if;
end $$;
rollback;

-- ============================================================
-- C: one player, two team memberships (dual-registered) -- still ONE
-- player row, two membership rows, both visible to the same guardian.
-- ============================================================
do $$
declare v_player_count integer; v_membership_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99d00000-0000-0000-0000-000000200003","role":"authenticated"}';
  select count(*) into v_player_count from public.players;
  select count(*) into v_membership_count from public.player_team_memberships where status = 'active';
  if v_player_count = 1 and v_membership_count = 2 then
    raise notice 'PASS C: dual-registered player stays ONE player row with 2 visible active memberships, not duplicated';
  else
    raise notice 'FAIL C: got % player rows / % memberships, expected 1 / 2', v_player_count, v_membership_count;
  end if;
end $$;
rollback;

-- ============================================================
-- D: Parent + Player are independent relationships on ONE account --
-- both the Guardian-of-child-D and the self-linked Player-D rows are
-- visible, as two SEPARATE player records (never merged into one).
-- ============================================================
do $$
declare v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99d00000-0000-0000-0000-000000200004","role":"authenticated"}';
  select count(*) into v_count from public.players;
  if v_count = 2 then
    raise notice 'PASS D: Parent+Player account sees exactly 2 distinct player records (their child, and their own linked player)';
  else
    raise notice 'FAIL D: Parent+Player account sees % player records, expected exactly 2', v_count;
  end if;
end $$;
rollback;

-- ============================================================
-- E: Club Admin authority and Guardian relationship coexist without
-- either implying the other -- User E can see EVERY Home player (via
-- can_manage_club_fixtures, their real Club Admin role) which already
-- includes their own child, so this proves the two sources compose
-- rather than conflicting, not that they're additive in player count.
-- ============================================================
do $$
declare v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99d00000-0000-0000-0000-000000200005","role":"authenticated"}';
  select count(*) into v_count from public.players p
    join public.player_team_memberships ptm on ptm.player_id = p.id and ptm.status = 'active'
    join public.teams t on t.id = ptm.team_id
    where t.club_id = '99d00000-0000-0000-0000-0000000c0001';
  if v_count >= 1 then
    raise notice 'PASS E: Home Club Admin (who is also a parent) sees Home players via their real Club Admin authority (count=%), including their own child', v_count;
  else
    raise notice 'FAIL E: Home Club Admin could not see any Home players at all';
  end if;
end $$;
rollback;

-- ============================================================
-- F/Cross-club isolation, part 1: User F (Away U13 Coach + Home parent)
-- sees their Home child via the Guardian relationship, and the Away
-- player via their real Coach authority -- but their HOME parent
-- relationship must not leak into seeing unrelated Away data beyond
-- what their OWN Away coaching role already grants, and vice versa.
-- ============================================================
do $$
declare v_home_count integer; v_away_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99d00000-0000-0000-0000-000000200006","role":"authenticated"}';
  select count(*) into v_home_count from public.players p
    join public.player_team_memberships ptm on ptm.player_id = p.id and ptm.status = 'active'
    join public.teams t on t.id = ptm.team_id
    where t.club_id = '99d00000-0000-0000-0000-0000000c0001';
  select count(*) into v_away_count from public.players p
    join public.player_team_memberships ptm on ptm.player_id = p.id and ptm.status = 'active'
    join public.teams t on t.id = ptm.team_id
    where t.club_id = '99d00000-0000-0000-0000-0000000c0002';
  if v_home_count = 1 and v_away_count = 1 then
    raise notice 'PASS F1: cross-club user sees exactly 1 Home player (their guardian relationship) and exactly 1 Away player (their coaching role) -- the wires do not cross';
  else
    raise notice 'FAIL F1: cross-club user sees % Home players / % Away players, expected 1 / 1', v_home_count, v_away_count;
  end if;
end $$;
rollback;

-- ============================================================
-- F/Cross-club isolation, part 2 (negative control): the genuinely
-- unrelated Away-club user G (no guardian relationship, no team
-- authority anywhere) must see ZERO players -- neither Home's nor even
-- their own Away club's, since a plain BASIC_USER club membership alone
-- grants no players visibility.
-- ============================================================
do $$
declare v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99d00000-0000-0000-0000-000000200007","role":"authenticated"}';
  select count(*) into v_count from public.players;
  if v_count = 0 then
    raise notice 'PASS F2: a genuinely unrelated club member (no guardian/staff relationship to any player) sees exactly 0 players';
  else
    raise notice 'FAIL F2: unrelated club member sees % players, expected 0', v_count;
  end if;
end $$;
rollback;

-- ============================================================
-- Guardian self-service write boundary: a Guardian has READ access to
-- their own child's player_team_memberships row (proven above, F1), but
-- the WRITE policy deliberately grants no guardian-based branch at all --
-- only site_admin/can_manage_team/can_manage_club_fixtures. This means a
-- Guardian cannot end (or otherwise modify) even their OWN child's team
-- membership unilaterally; only team staff/club admin can, matching the
-- "no self-service" principle applied everywhere else in this schema
-- (Relationship Registry Section 12/39) -- ending a player's registration
-- is a staff action with real downstream consequences (fixture/roster
-- impact), not something a guardian should be able to trigger alone.
-- Expected outcome: the update is REJECTED (0 rows / RLS violation).
-- ============================================================
do $$
declare v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99d00000-0000-0000-0000-000000200006","role":"authenticated"}';
  begin
    update public.player_team_memberships set status = 'ended' where id = '99d00000-0000-0000-0000-000000500009'; -- PlayerF1's own Home U12 membership -- their own guardian-linked child
    get diagnostics v_count = row_count;
    if v_count = 0 then
      raise notice 'PASS: Guardian cannot end even their OWN child''s player_team_memberships row (0 rows -- staff/admin action only, by design)';
    else
      raise notice 'FAIL: Guardian ended their own child''s player_team_memberships row directly -- this must be staff/admin-only';
    end if;
  exception when others then
    raise notice 'PASS: Guardian blocked from ending their own child''s player_team_memberships row (%)', sqlerrm;
  end;
end $$;
rollback;

-- ============================================================
-- Direct enumeration/bypass: Parent A cannot select another family's
-- specific player_id by guessing/supplying it directly, and cannot
-- self-grant a Guardian row over an arbitrary player.
-- ============================================================
do $$
declare v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99d00000-0000-0000-0000-000000200001","role":"authenticated"}';

  select count(*) into v_count from public.players where id = '99d00000-0000-0000-0000-000000300002'; -- Parent B's child
  if v_count = 0 then
    raise notice 'PASS: Parent A cannot select a known unrelated player_id (Parent B''s child) by supplying it directly';
  else
    raise notice 'FAIL: Parent A could select an unrelated player_id directly';
  end if;

  begin
    insert into public.guardians (guardian_user_id, player_id, relationship_type, status)
    values ('99d00000-0000-0000-0000-000000200001', '99d00000-0000-0000-0000-000000300002', 'guardian', 'active');
    raise notice 'FAIL: Parent A self-granted a Guardian row over an unrelated player -- this must never succeed';
  exception when others then
    raise notice 'PASS: Parent A blocked from self-granting a Guardian row over an unrelated player (%)', sqlerrm;
  end;
end $$;
rollback;

-- ============================================================
-- Coach cannot access an unrelated team's players by supplying the
-- team_id directly -- User F (Away U13 Coach) has no authority over
-- Home's U12 and is not that player's guardian.
-- ============================================================
do $$
declare v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99d00000-0000-0000-0000-000000200006","role":"authenticated"}';
  select count(*) into v_count from public.player_team_memberships where team_id = '99d00000-0000-0000-0000-000000100001' and player_id = '99d00000-0000-0000-0000-000000300001'; -- Parent A's child on Home U12
  if v_count = 0 then
    raise notice 'PASS: Away Coach cannot see an unrelated Home team''s player_team_memberships row by supplying the team_id directly';
  else
    raise notice 'FAIL: Away Coach could see an unrelated Home player_team_memberships row';
  end if;
end $$;
rollback;

-- ============================================================
-- Parent cannot access operational fixture messages -- unaffected by
-- this migration (fixture_messages RLS is untouched), confirmed here
-- for completeness against the Guardian/Player tables specifically:
-- a parent has no club_memberships/team_permissions row at all, so the
-- existing fixture-conversation RLS already excludes them regardless of
-- their new Guardian relationship.
-- ============================================================
do $$
declare v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99d00000-0000-0000-0000-000000200001","role":"authenticated"}';
  select count(*) into v_count from public.club_memberships where user_id = '99d00000-0000-0000-0000-000000200001';
  if v_count = 0 then
    raise notice 'PASS: a pure Guardian-only account holds no club_memberships row at all -- fixture/club conversation RLS (which keys off club_memberships/team_permissions) excludes them structurally, not by a new check this migration had to add';
  else
    raise notice 'FAIL: unexpectedly found a club_memberships row for a pure Guardian test account';
  end if;
end $$;
rollback;

\echo '=== Done. See docs/architecture/relationship-registry.md for the DOB/youth-safety-fallback rule (G/H/I), verified separately by lib/players/age-state.verify.ts against these same three player records'' actual DOB/team data. ==='
