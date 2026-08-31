-- Manual RLS/permission verification for the Club Profile / People / Roles
-- / Invitations / Team Management vertical slice. NOT a migration -- never
-- applied automatically by `db reset`. Run by hand against local Supabase:
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/club_people_teams.sql
--
-- Self-contained: reuses the same shared fixture ids as permission_matrix.sql
-- and partner_clubs_and_messaging.sql (Burnley/Rossendale/Leigh clubs, U12
-- A/U13 A teams, test users 1-11) via `on conflict do nothing`. Adds one
-- new test user (an invitation recipient with no prior club_memberships row
-- at all, needed for scenario 9/10). Covers the 15 scenarios required for
-- this slice's review. NOT rerunnable without a fresh `db reset --local`
-- in between -- several scenarios `commit` state later ones depend on
-- (matching club_people_and_messaging.sql's own convention).

\set ON_ERROR_STOP off
\pset pager off

do $$
declare
  v_burnley_dir_id uuid;
  v_rossendale_dir_id uuid;
  v_leigh_dir_id uuid;
begin
  select id into v_burnley_dir_id from public.club_directory where name = 'Burnley RUFC';
  select id into v_rossendale_dir_id from public.club_directory where name = 'Rossendale RUFC';
  select id into v_leigh_dir_id from public.club_directory where name = 'Leigh RUFC';

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.burnley.admin@ovalball.local', '', now(), now(), '{}', '{}'),
    ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.rossendale.admin@ovalball.local', '', now(), now(), '{}', '{}'),
    ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.u12.admin@ovalball.local', '', now(), now(), '{}', '{}'),
    ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.coach@ovalball.local', '', now(), now(), '{}', '{}'),
    ('00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.parent@ovalball.local', '', now(), now(), '{}', '{}'),
    ('00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.pending.claimant@ovalball.local', '', now(), now(), '{}', '{}'),
    ('00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.burnley.fixturesec@ovalball.local', '', now(), now(), '{}', '{}'),
    ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.invitee@ovalball.local', '', now(), now(), '{}', '{}')
  on conflict (id) do nothing;

  insert into public.profiles (id, first_name, surname, email)
  values
    ('00000000-0000-0000-0000-000000000002', 'Test', 'BurnleyAdmin', 'test.burnley.admin@ovalball.local'),
    ('00000000-0000-0000-0000-000000000003', 'Test', 'RossendaleAdmin', 'test.rossendale.admin@ovalball.local'),
    ('00000000-0000-0000-0000-000000000004', 'Test', 'U12Admin', 'test.u12.admin@ovalball.local'),
    ('00000000-0000-0000-0000-000000000006', 'Test', 'Coach', 'test.coach@ovalball.local'),
    ('00000000-0000-0000-0000-000000000007', 'Test', 'Parent', 'test.parent@ovalball.local'),
    ('00000000-0000-0000-0000-000000000008', 'Test', 'PendingClaimant', 'test.pending.claimant@ovalball.local'),
    ('00000000-0000-0000-0000-000000000009', 'Test', 'FixtureSecretary', 'test.burnley.fixturesec@ovalball.local'),
    ('00000000-0000-0000-0000-000000000012', 'Test', 'Invitee', 'test.invitee@ovalball.local')
  on conflict (id) do nothing;

  insert into public.clubs (id, directory_id, slug, status)
  values
    ('10000000-0000-0000-0000-000000000001', v_burnley_dir_id, 'burnley-rufc-test', 'active'),
    ('10000000-0000-0000-0000-000000000002', v_rossendale_dir_id, 'rossendale-rufc-test', 'active'),
    ('10000000-0000-0000-0000-000000000003', v_leigh_dir_id, 'leigh-rufc-test', 'active')
  on conflict (id) do nothing;

  insert into public.club_memberships (id, club_id, user_id, role, status)
  values
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active'),
    ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'CLUB_ADMIN', 'active'),
    ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', 'BASIC_USER', 'active'),
    ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000007', 'BASIC_USER', 'active'),
    ('20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000009', 'FIXTURE_SECRETARY', 'active')
  on conflict (id) do nothing;
  insert into public.club_memberships (id, club_id, user_id, role, status)
  values ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000006', 'BASIC_USER', 'active')
  on conflict (id) do nothing;

  insert into public.teams (id, club_id, rugby_code, category, age_group, display_name, slug)
  values
    ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U12', 'U12 A', 'u12-a'),
    ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U13', 'U13 A', 'u13-a'),
    ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'union', 'youth', 'U12', 'U12 A', 'u12-a')
  on conflict (id) do nothing;

  insert into public.team_permissions (membership_id, team_id, permission)
  values
    ('20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', 'team_admin'),
    ('20000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000001', 'view_only'),
    ('20000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000001', 'coach')
  on conflict do nothing;

  -- Deliberately no club_claims row for the pending claimant (user 8) here
  -- -- permission_matrix.sql already establishes exactly one
  -- (id 40000000-...0001, Leigh) for its own scenario 2/11, and club_claims
  -- has no unique constraint on (directory_id, claimant_user_id) to make a
  -- second one here safely idempotent against that. Scenario 8 below only
  -- needs user 8 to exist and have zero club_memberships, not a claim.
end $$;

\echo '=== Fixtures ready. Running club/people/teams scenarios. ==='

-- ------------------------------------------------------------
-- 1. Club Admin can edit own club profile.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  update public.clubs set bio = 'Test bio from Burnley admin' where id = '10000000-0000-0000-0000-000000000001';
  if found then raise notice 'PASS 1: Club Admin can edit own club profile'; else raise notice 'FAIL 1: 0 rows affected'; end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 2. Other club admin cannot edit it.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  update public.clubs set bio = 'Hijacked by Rossendale admin' where id = '10000000-0000-0000-0000-000000000001';
  if found then raise notice 'FAIL 2: Rossendale admin edited Burnley''s profile'; else raise notice 'PASS 2: Rossendale admin cannot edit Burnley''s profile (0 rows)'; end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 3. Team Admin cannot edit club-wide profile.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$ begin
  update public.clubs set bio = 'Team admin overreach' where id = '10000000-0000-0000-0000-000000000001';
  if found then raise notice 'FAIL 3: Team Admin edited the club-wide profile'; else raise notice 'PASS 3: Team Admin cannot edit club-wide profile (0 rows)'; end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 4. Club Admin can create invitation.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  insert into public.invitations (club_id, invited_email, club_role, created_by)
    values ('10000000-0000-0000-0000-000000000001', 'throwaway1@ovalball.local', 'FIXTURE_SECRETARY', '00000000-0000-0000-0000-000000000002');
  raise notice 'PASS 4: Club Admin created an invitation';
exception when others then
  raise notice 'FAIL 4: %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 5. Fixture Secretary cannot create a privileged invitation.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated"}';
do $$ begin
  insert into public.invitations (club_id, invited_email, club_role, created_by)
    values ('10000000-0000-0000-0000-000000000001', 'throwaway2@ovalball.local', 'CLUB_ADMIN', '00000000-0000-0000-0000-000000000009');
  raise notice 'FAIL 5: Fixture Secretary created an invitation';
exception when insufficient_privilege or others then
  raise notice 'PASS 5: Fixture Secretary cannot create an invitation (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 6. Coach cannot grant access.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
do $$ begin
  insert into public.invitations (club_id, invited_email, club_role, created_by)
    values ('10000000-0000-0000-0000-000000000001', 'throwaway3@ovalball.local', 'CLUB_ADMIN', '00000000-0000-0000-0000-000000000006');
  raise notice 'FAIL 6a: Coach created an invitation';
exception when insufficient_privilege or others then
  raise notice 'PASS 6a: Coach cannot create an invitation (%)', sqlerrm;
end $$;
-- An UPDATE blocked by a USING clause just matches 0 rows silently -- it
-- does not raise an exception the way a blocked INSERT/WITH CHECK does, so
-- this checks `found`, not an exception, unlike the invitation attempts
-- above.
do $$ begin
  update public.club_memberships set role = 'CLUB_ADMIN' where id = '20000000-0000-0000-0000-000000000005';
  if found then raise notice 'FAIL 6b: Coach granted themselves a club role'; else raise notice 'PASS 6b: Coach cannot grant themselves a club role (0 rows)'; end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 7. Parent cannot grant access.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
do $$ begin
  insert into public.invitations (club_id, invited_email, club_role, created_by)
    values ('10000000-0000-0000-0000-000000000001', 'throwaway4@ovalball.local', 'CLUB_ADMIN', '00000000-0000-0000-0000-000000000007');
  raise notice 'FAIL 7: Parent created an invitation';
exception when insufficient_privilege or others then
  raise notice 'PASS 7: Parent cannot create an invitation (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 8. Pending claimant cannot grant access.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000008","role":"authenticated"}';
do $$ begin
  insert into public.invitations (club_id, invited_email, club_role, created_by)
    values ('10000000-0000-0000-0000-000000000001', 'throwaway5@ovalball.local', 'CLUB_ADMIN', '00000000-0000-0000-0000-000000000008');
  raise notice 'FAIL 8: pending claimant created an invitation';
exception when insufficient_privilege or others then
  raise notice 'PASS 8: pending claimant cannot create an invitation (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 9. Invite token cannot grant more roles than encoded: a team-only invite
--    (coach on U12 A, no club_role) must leave the acceptor BASIC_USER
--    club-wide and grant exactly the one team_permissions row -- never
--    CLUB_ADMIN, never a second team.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_inv_id uuid;
begin
  insert into public.invitations (id, club_id, invited_email, club_role, token, created_by)
    values ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'test.invitee@ovalball.local', null, 'test-token-scenario-9', '00000000-0000-0000-0000-000000000002')
    returning id into v_inv_id;
  insert into public.invitation_teams (invitation_id, team_id, team_permission)
    values (v_inv_id, '30000000-0000-0000-0000-000000000001', 'coach');
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000012","role":"authenticated","email":"test.invitee@ovalball.local"}';
do $$ begin
  perform public.accept_invitation('test-token-scenario-9');
exception when others then
  raise notice 'FAIL 9: acceptance itself failed: %', sqlerrm;
end $$;
select case when role = 'BASIC_USER' then 'PASS 9a: team-only invite left the acceptor BASIC_USER club-wide (never CLUB_ADMIN)'
  else 'FAIL 9a: role is ' || role end
from public.club_memberships where club_id = '10000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-000000000012';
select case when count(*) = 1 then 'PASS 9b: acceptor got exactly the one encoded team_permissions row (coach, U12 A)'
  else 'FAIL 9b: expected 1 team_permissions row, found ' || count(*) end
from public.team_permissions tp
join public.club_memberships cm on cm.id = tp.membership_id
where cm.user_id = '00000000-0000-0000-0000-000000000012' and cm.club_id = '10000000-0000-0000-0000-000000000001';
commit;

-- ------------------------------------------------------------
-- 10. Expired/revoked invitation cannot be accepted.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  insert into public.invitations (id, club_id, invited_email, club_role, status, expires_at, token, created_by)
    values ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'test.expired@ovalball.local', null, 'pending', now() - interval '1 day', 'test-token-scenario-10a', '00000000-0000-0000-0000-000000000002');
  insert into public.invitations (id, club_id, invited_email, club_role, status, token, created_by)
    values ('60000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'test.revoked@ovalball.local', null, 'revoked', 'test-token-scenario-10b', '00000000-0000-0000-0000-000000000002');
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000008","role":"authenticated","email":"test.expired@ovalball.local"}';
do $$ begin
  perform public.accept_invitation('test-token-scenario-10a');
  raise notice 'FAIL 10a: expired invitation was accepted';
exception when others then
  raise notice 'PASS 10a: expired invitation cannot be accepted (%)', sqlerrm;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000008","role":"authenticated","email":"test.revoked@ovalball.local"}';
do $$ begin
  perform public.accept_invitation('test-token-scenario-10b');
  raise notice 'FAIL 10b: revoked invitation was accepted';
exception when others then
  raise notice 'PASS 10b: revoked invitation cannot be accepted (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 11. U12-only Team Admin cannot edit U13 team.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$ begin
  update public.teams set display_name = 'Hijacked U13' where id = '30000000-0000-0000-0000-000000000002';
  if found then raise notice 'FAIL 11: U12-only Team Admin edited U13 A'; else raise notice 'PASS 11: U12-only Team Admin cannot edit U13 A (0 rows)'; end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 12. Club Admin can assign one person to multiple teams.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  insert into public.team_permissions (membership_id, team_id, permission, created_by)
    values ('20000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000002', 'coach', '00000000-0000-0000-0000-000000000002')
    on conflict (membership_id, team_id) do update set permission = excluded.permission;
  if (select count(*) from public.team_permissions where membership_id = '20000000-0000-0000-0000-000000000006') >= 2 then
    raise notice 'PASS 12: Club Admin assigned one person to a second team (now on U12 A and U13 A)';
  else
    raise notice 'FAIL 12: expected the parent-turned-multi-team member to have 2+ team_permissions rows';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 13. Existing fixture history survives team archive.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_fixture_id uuid;
begin
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, raw_opposition_text)
    values ('30000000-0000-0000-0000-000000000001', current_date + 10, 'Home', 'Pre-archive fixture')
    returning id into v_fixture_id;

  update public.teams set active = false where id = '30000000-0000-0000-0000-000000000001';

  if exists (select 1 from public.fixtures where id = v_fixture_id and owning_team_id = '30000000-0000-0000-0000-000000000001') then
    raise notice 'PASS 13: fixture survives its team being archived, still correctly linked';
  else
    raise notice 'FAIL 13: fixture disappeared or lost its team link after archive';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 14. Logo mutation is club-authorized (Burnley admin can write to
--     Burnley's own logo path). Committed (not rolled back) -- scenario 15
--     needs a real persisted object to prove it can't be touched by
--     another club, not an empty table that would pass for the wrong
--     reason.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  insert into storage.objects (bucket_id, name, owner)
    values ('club-logos', '10000000-0000-0000-0000-000000000001/logo-test.png', '00000000-0000-0000-0000-000000000002');
  raise notice 'PASS 14: Burnley admin can upload to their own club''s logo path';
exception when others then
  raise notice 'FAIL 14: %', sqlerrm;
end $$;
commit;

-- ------------------------------------------------------------
-- 15. Other club cannot replace Burnley's logo.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  insert into storage.objects (bucket_id, name, owner)
    values ('club-logos', '10000000-0000-0000-0000-000000000001/logo-hack.png', '00000000-0000-0000-0000-000000000003');
  raise notice 'FAIL 15a: Rossendale admin uploaded into Burnley''s logo path';
exception when insufficient_privilege or others then
  raise notice 'PASS 15a: Rossendale admin cannot upload into Burnley''s logo path (%)', sqlerrm;
end $$;
-- Same USING-vs-WITH CHECK distinction as scenario 6b: a blocked UPDATE is
-- 0 rows, not an exception.
do $$ begin
  update storage.objects set name = '10000000-0000-0000-0000-000000000001/renamed.png'
    where bucket_id = 'club-logos' and name = '10000000-0000-0000-0000-000000000001/logo-test.png';
  if found then raise notice 'FAIL 15b: Rossendale admin renamed/updated an object under Burnley''s path'; else raise notice 'PASS 15b: Rossendale admin cannot modify objects under Burnley''s path (0 rows)'; end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 16. profiles least-privilege regression (20260831170000): a Club Admin
--     can read fellow members' names/emails through the RPC, but never
--     their date of birth or address directly off the base table -- and
--     nobody without club-admin/site-admin authority over that club gets
--     anything from the RPC at all, including a fellow BASIC_USER, an
--     unrelated club's admin, and a Fixture Secretary (deliberately not
--     extended, same as before this fix).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.get_club_member_directory('10000000-0000-0000-0000-000000000001');
  if v_count >= 4 then
    raise notice 'PASS 16a: Burnley admin sees % fellow members'' names/emails via the directory RPC', v_count;
  else
    raise notice 'FAIL 16a: Burnley admin only saw % rows from the directory RPC', v_count;
  end if;
end $$;
do $$
declare
  v_dob date;
begin
  select date_of_birth into v_dob from public.profiles where id = '00000000-0000-0000-0000-000000000004';
  if v_dob is null and not exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-000000000004') then
    raise notice 'PASS 16b: Burnley admin cannot read U12Admin''s profiles row directly at all (0 rows)';
  else
    raise notice 'FAIL 16b: Burnley admin read a fellow member''s profiles row directly off the base table (date_of_birth=%)', v_dob;
  end if;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.get_club_member_directory('10000000-0000-0000-0000-000000000001');
  if v_count = 0 then
    raise notice 'PASS 16c: Rossendale admin (unrelated club) gets nothing from Burnley''s directory RPC';
  else
    raise notice 'FAIL 16c: Rossendale admin saw % rows from Burnley''s directory RPC', v_count;
  end if;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.get_club_member_directory('10000000-0000-0000-0000-000000000001');
  if v_count = 0 then
    raise notice 'PASS 16d: fellow BASIC_USER (Coach) gets nothing from the directory RPC for their own club';
  else
    raise notice 'FAIL 16d: BASIC_USER saw % rows from the directory RPC', v_count;
  end if;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.get_club_member_directory('10000000-0000-0000-0000-000000000001');
  if v_count = 0 then
    raise notice 'PASS 16e: Fixture Secretary gets nothing from the directory RPC (deliberately not extended)';
  else
    raise notice 'FAIL 16e: Fixture Secretary saw % rows from the directory RPC', v_count;
  end if;
end $$;
rollback;

\echo '=== Done. Review PASS/FAIL lines above; every assertion should read PASS. ==='
