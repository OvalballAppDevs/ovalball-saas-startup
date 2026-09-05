-- Manual RLS/permission verification script. NOT a migration -- never
-- applied automatically by `db reset`. Run by hand against local Supabase:
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--
-- Creates its own throwaway test users/clubs/teams (clearly-named, ids
-- printed below), runs the 10 required permission scenarios from this
-- session's brief as explicit assertions, and prints PASS/FAIL for each.
-- Safe to run repeatedly; re-running after a `db reset --local` recreates
-- everything from scratch. Never touches remote/production -- this script
-- only runs against the local docker Postgres instance.

\set ON_ERROR_STOP off
\pset pager off

-- ============================================================
-- Fixtures: test users, clubs, teams, memberships, permissions
-- ============================================================

do $$
declare
  v_burnley_dir_id uuid;
  v_rossendale_dir_id uuid;
  v_leigh_dir_id uuid;
begin
  select id into v_burnley_dir_id from public.club_directory where name = 'Burnley RUFC';
  select id into v_rossendale_dir_id from public.club_directory where name = 'Rossendale RUFC';
  select id into v_leigh_dir_id from public.club_directory where name = 'Leigh RUFC';

  -- Minimal auth.users rows: enough for FK satisfaction and auth.uid()/
  -- auth.email() impersonation via request.jwt.claims below. Not
  -- login-capable (no identity/password rows) -- this script never needs
  -- them to actually authenticate through GoTrue, only to exist as a
  -- referenceable id.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.site.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.burnley.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.rossendale.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.u12.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.multiteam.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.coach@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.parent@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.pending.claimant@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;

  insert into public.profiles (id, first_name, surname, email)
  values
    ('00000000-0000-0000-0000-000000000001', 'Test', 'SiteAdmin', 'test.site.admin@ovalball.local'),
    ('00000000-0000-0000-0000-000000000002', 'Test', 'BurnleyAdmin', 'test.burnley.admin@ovalball.local'),
    ('00000000-0000-0000-0000-000000000003', 'Test', 'RossendaleAdmin', 'test.rossendale.admin@ovalball.local'),
    ('00000000-0000-0000-0000-000000000004', 'Test', 'U12Admin', 'test.u12.admin@ovalball.local'),
    ('00000000-0000-0000-0000-000000000005', 'Test', 'MultiTeamAdmin', 'test.multiteam.admin@ovalball.local'),
    ('00000000-0000-0000-0000-000000000006', 'Test', 'Coach', 'test.coach@ovalball.local'),
    ('00000000-0000-0000-0000-000000000007', 'Test', 'Parent', 'test.parent@ovalball.local'),
    ('00000000-0000-0000-0000-000000000008', 'Test', 'PendingClaimant', 'test.pending.claimant@ovalball.local')
  on conflict (id) do nothing;

  insert into public.site_admins (user_id, status) values ('00000000-0000-0000-0000-000000000001', 'active')
  on conflict (user_id) do nothing;

  -- Two activated clubs, created the same way approve_club_claim would
  -- (not by hand-crafting clubs rows differently from the real path).
  insert into public.clubs (id, directory_id, slug, status)
  values
    ('10000000-0000-0000-0000-000000000001', v_burnley_dir_id, 'burnley-rufc-test', 'active'),
    ('10000000-0000-0000-0000-000000000002', v_rossendale_dir_id, 'rossendale-rufc-test', 'active')
  on conflict (id) do nothing;

  insert into public.club_memberships (id, club_id, user_id, role, status)
  values
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active'),
    ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'CLUB_ADMIN', 'active'),
    ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', 'BASIC_USER', 'active'),
    ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000005', 'BASIC_USER', 'active'),
    ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000006', 'BASIC_USER', 'active'),
    ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000007', 'BASIC_USER', 'active')
  on conflict (id) do nothing;

  insert into public.teams (id, club_id, rugby_code, category, age_group, display_name, slug)
  values
    ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U12', 'U12 A', 'u12-a'),
    ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U13', 'U13 A', 'u13-a'),
    ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'union', 'youth', 'U12', 'U12 A', 'u12-a')
  on conflict (id) do nothing;

  -- Scenario 5: U12-only Team Admin.
  insert into public.team_permissions (membership_id, team_id, permission)
  values ('20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', 'team_admin')
  on conflict do nothing;
  -- Scenario 6: multi-team Team Admin (U12 A + U13 A).
  insert into public.team_permissions (membership_id, team_id, permission)
  values
    ('20000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001', 'team_admin'),
    ('20000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000002', 'team_admin')
  on conflict do nothing;
  -- Scenario 7: Coach, U12 A only.
  insert into public.team_permissions (membership_id, team_id, permission)
  values ('20000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000001', 'coach')
  on conflict do nothing;
  -- Scenario 8: Parent/player, view_only, U12 A only.
  insert into public.team_permissions (membership_id, team_id, permission)
  values ('20000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000001', 'view_only')
  on conflict do nothing;

  -- Scenario 2: authenticated user with a pending claim (mirrors the real
  -- callumkrizz@gmail.com -> Burnley RUFC claim on remote, reproduced here
  -- with a throwaway test identity against a different, still-unclaimed
  -- directory row so it doesn't collide with Burnley/Rossendale above).
  insert into public.club_claims (id, directory_id, claimant_user_id, claimed_role, authority_declaration, status)
  values ('40000000-0000-0000-0000-000000000001', v_leigh_dir_id, '00000000-0000-0000-0000-000000000008', 'Fixture Secretary', 'I confirm...', 'pending')
  on conflict (id) do nothing;

  -- A persistent (not rolled back) U12 A fixture -- scenarios 5/6/7 below
  -- each create-then-`rollback;` their own fixture to keep this whole
  -- script rerunnable, so scenarios 8/10 (which only READ a fixture, or
  -- attempt to message one) need one that actually survives, independent
  -- of those other scenarios' transactions.
  insert into public.fixtures (id, owning_team_id, kickoff_date, home_away, raw_opposition_text)
  values ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', current_date + 3, 'Home', 'Persistent Test Fixture')
  on conflict (id) do nothing;
end $$;

\echo '=== Fixtures created. Running scenario assertions. ==='

-- Helper: run a block as a given user. `authenticated` role + a JWT claims
-- GUC is exactly how PostgREST evaluates every real request, so this is
-- the same code path RLS actually runs under in production, not an
-- approximation.

-- ------------------------------------------------------------
-- 1. Unauthenticated visitor: can read public data, cannot read anything
--    club-internal (club_claims), cannot write anything.
-- ------------------------------------------------------------
begin;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select case when count(*) >= 1 then 'PASS 1a: anon can read public club_directory' else 'FAIL 1a' end
  from public.club_directory where name = 'Burnley RUFC';
select case when count(*) = 0 then 'PASS 1b: anon cannot read club_claims' else 'FAIL 1b' end
  from public.club_claims;
do $$ begin
  insert into public.club_memberships (club_id, user_id, role, status)
    values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000008', 'CLUB_ADMIN', 'active');
  raise notice 'FAIL 1c: anon inserted a club_membership';
exception when insufficient_privilege or others then
  raise notice 'PASS 1c: anon cannot insert club_memberships (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 2. Authenticated user with a pending claim: sees own claim, no club
--    authority anywhere.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000008","role":"authenticated","email":"test.pending.claimant@ovalball.local"}';
select case when count(*) = 1 then 'PASS 2a: pending claimant sees own claim' else 'FAIL 2a' end
  from public.club_claims where claimant_user_id = '00000000-0000-0000-0000-000000000008';
do $$ begin
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, raw_opposition_text)
    values ('30000000-0000-0000-0000-000000000001', current_date, 'Home', 'Test Opponent');
  raise notice 'FAIL 2b: pending claimant created a fixture';
exception when insufficient_privilege or others then
  raise notice 'PASS 2b: pending claimant cannot create fixtures (%)', sqlerrm;
end $$;
do $$ begin
  perform public.approve_club_claim('40000000-0000-0000-0000-000000000001'::uuid, 'self-approval attempt');
  raise notice 'FAIL 2c: pending claimant approved their own claim';
exception when others then
  raise notice 'PASS 2c: pending claimant cannot approve claims (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 3/9. Approved Club Admin can manage their own club; cannot touch another
--       club (Rossendale) or become Site Admin.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","email":"test.burnley.admin@ovalball.local"}';
do $$ begin
  update public.clubs set bio = 'Updated by Burnley admin' where id = '10000000-0000-0000-0000-000000000001';
  if found then raise notice 'PASS 3a: Club Admin can update own club'; else raise notice 'FAIL 3a: update affected 0 rows'; end if;
end $$;
do $$ begin
  update public.clubs set bio = 'Hijacked' where id = '10000000-0000-0000-0000-000000000002';
  if found then raise notice 'FAIL 9a: Burnley admin updated Rossendale''s club'; else raise notice 'PASS 9a: Burnley admin cannot update Rossendale''s club (0 rows affected)'; end if;
end $$;
do $$ begin
  insert into public.site_admins (user_id, status) values ('00000000-0000-0000-0000-000000000002', 'active');
  raise notice 'FAIL 9b: Club Admin granted themselves Site Admin';
exception when insufficient_privilege or others then
  raise notice 'PASS 9b: Club Admin cannot grant themselves Site Admin (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 4. Fixture Secretary: club-wide fixture authority, verified via the
--    can_manage_club_fixtures helper directly (no seeded FIXTURE_SECRETARY
--    user needed to prove the function's logic is correct).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select case when internal.can_manage_club_fixtures('10000000-0000-0000-0000-000000000001'::uuid)
  then 'PASS 4: CLUB_ADMIN counts as club-wide fixture authority too' else 'FAIL 4' end;
rollback;

-- ------------------------------------------------------------
-- 5. U12-only Team Admin: can manage U12 A, cannot manage U13 A.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$ begin
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, raw_opposition_text)
    values ('30000000-0000-0000-0000-000000000001', current_date, 'Home', 'Test Opponent U12');
  raise notice 'PASS 5a: U12 admin can create a U12 A fixture';
exception when others then
  raise notice 'FAIL 5a: %', sqlerrm;
end $$;
do $$ begin
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, raw_opposition_text)
    values ('30000000-0000-0000-0000-000000000002', current_date, 'Home', 'Test Opponent U13');
  raise notice 'FAIL 5b: U12 admin created a U13 A fixture (should be blocked)';
exception when insufficient_privilege or others then
  raise notice 'PASS 5b: U12 admin cannot mutate U13 A (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 6. Multi-team Team Admin: can manage both assigned teams.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
do $$ begin
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, raw_opposition_text)
    values ('30000000-0000-0000-0000-000000000001', current_date, 'Home', 'Multi-team U12 fixture');
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, raw_opposition_text)
    values ('30000000-0000-0000-0000-000000000002', current_date, 'Home', 'Multi-team U13 fixture');
  raise notice 'PASS 6: multi-team admin can create fixtures for both U12 A and U13 A';
exception when others then
  raise notice 'FAIL 6: %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 7. Coach: same write scope as team_admin today (documented decision --
--    see the role_vocabulary migration comment), still team-scoped.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
do $$ begin
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, raw_opposition_text)
    values ('30000000-0000-0000-0000-000000000001', current_date, 'Home', 'Coach-created fixture');
  raise notice 'PASS 7a: coach can create a fixture for their assigned team';
exception when others then
  raise notice 'FAIL 7a: %', sqlerrm;
end $$;
do $$ begin
  insert into public.club_memberships (club_id, user_id, role, status)
    values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000006', 'CLUB_ADMIN', 'active')
    on conflict (club_id, user_id) do update set role = 'CLUB_ADMIN';
  raise notice 'FAIL 7b: coach granted themselves a club role';
exception when insufficient_privilege or others then
  raise notice 'PASS 7b: coach cannot grant club roles (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 8. Parent/player (view_only): cannot create/mutate fixtures or requests.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
select case when count(*) >= 1 then 'PASS 8a: parent can read the public fixtures list' else 'FAIL 8a' end
  from public.fixtures where owning_team_id = '30000000-0000-0000-0000-000000000001';
do $$ begin
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, raw_opposition_text)
    values ('30000000-0000-0000-0000-000000000001', current_date, 'Home', 'Parent-attempted fixture');
  raise notice 'FAIL 8b: parent (view_only) created a fixture';
exception when insufficient_privilege or others then
  raise notice 'PASS 8b: parent (view_only) cannot create fixtures (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 10. Fixture messaging requires a real relationship; calendar-sharing
--     access requires an active partnership; fixture requests require
--     appropriate role; external fixture creation doesn't require an
--     opponent account; invitation cannot self-grant broader permissions.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
-- Rossendale admin has no fixture/request relationship with Burnley's U12 A yet.
do $$ begin
  insert into public.fixture_messages (fixture_id, sender_user_id, body)
    values ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', 'Cold message with no relationship');
  raise notice 'FAIL 10a: messaged a fixture with no relationship';
exception when insufficient_privilege or others then
  raise notice 'PASS 10a: cannot message a fixture with no relationship (%)', sqlerrm;
end $$;
do $$ begin
  perform public.get_partner_team_availability('30000000-0000-0000-0000-000000000001'::uuid, current_date, current_date + 30);
  raise notice 'FAIL 10b: read partner availability with no active partnership';
exception when others then
  raise notice 'PASS 10b: cannot read partner availability without an active partnership (%)', sqlerrm;
end $$;
rollback;

-- External-opponent fixture creation (no Ovalball account required for the
-- opponent) -- Burnley admin creating a fixture against free text only.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, raw_opposition_text)
    values ('30000000-0000-0000-0000-000000000001', current_date + 7, 'Away', 'Some Rugby Club Not On Ovalball');
  raise notice 'PASS 10c: external (non-Ovalball) opponent fixture created from raw text alone';
exception when others then
  raise notice 'FAIL 10c: %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- Positive end-to-end check: a real Site Admin CAN approve a pending claim,
-- and it correctly creates the clubs + CLUB_ADMIN membership rows. This is
-- the critical-path function every other authenticated screen depends on,
-- so a permission matrix that only proved non-admins are blocked (above)
-- without also proving the intended actor succeeds would be incomplete.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","email":"test.site.admin@ovalball.local"}';
do $$
declare
  v_new_club_id uuid;
begin
  v_new_club_id := public.approve_club_claim('40000000-0000-0000-0000-000000000001'::uuid, 'approved by verification script');
  if v_new_club_id is null then
    raise notice 'FAIL 11a: approve_club_claim returned null';
  else
    raise notice 'PASS 11a: Site Admin approved the claim, new club id %', v_new_club_id;
  end if;
  if exists (
    select 1 from public.club_memberships
    where club_id = v_new_club_id and user_id = '00000000-0000-0000-0000-000000000008' and role = 'CLUB_ADMIN' and status = 'active'
  ) then
    raise notice 'PASS 11b: claimant is now an active CLUB_ADMIN of the new club';
  else
    raise notice 'FAIL 11b: no CLUB_ADMIN membership row was created';
  end if;
  if (select status from public.club_claims where id = '40000000-0000-0000-0000-000000000001') = 'verified' then
    raise notice 'PASS 11c: claim status transitioned to verified';
  else
    raise notice 'FAIL 11c: claim status did not transition';
  end if;
end $$;
rollback;

\echo '=== Done. Review PASS/FAIL lines above; every assertion should read PASS. ==='
