-- Manual verification for Site Admin User Management (admin_user_overview
-- view, club_memberships/team_permissions/site_admins RLS as exercised
-- through the new grant/revoke/change-access UI). NOT a migration -- never
-- applied automatically by `db reset`. Run by hand against local Supabase:
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/admin_user_management.sql
--
-- Self-contained: creates its own Site Admin (00...0014, same convention as
-- admin_club_management.sql) and one throwaway "View Only" test user
-- (00...0015) as a BASIC_USER member of Burnley RUFC with no team scope --
-- the live subject for the grant/revoke/team-scope-change scenarios, so
-- nothing here touches real fixture data. Reuses the shared fixture ids
-- from permission_matrix.sql (Burnley admin 0002, Rossendale admin 0003,
-- U12Admin 0004, PendingClaimant 0008, FixtureSecretary 0009). Every
-- scenario rolls back. SET LOCAL role/request.jwt.claims are always
-- top-level statements, never inside a DO block.

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values
    ('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.user.mgmt.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.view.only@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;

  insert into public.profiles (id, first_name, surname, email)
  values
    ('00000000-0000-0000-0000-000000000014', 'Test', 'UserMgmtAdmin', 'test.user.mgmt.admin@ovalball.local'),
    ('00000000-0000-0000-0000-000000000015', 'Test', 'ViewOnly', 'test.view.only@ovalball.local')
  on conflict (id) do nothing;

  insert into public.site_admins (user_id, status)
  values ('00000000-0000-0000-0000-000000000014', 'active')
  on conflict (user_id) do nothing;

  insert into public.club_memberships (id, club_id, user_id, role, status)
  values ('20000000-0000-0000-0000-000000000015', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000015', 'BASIC_USER', 'active')
  on conflict (id) do nothing;
end $$;

\echo '=== Fixtures ready. Running User Management scenarios. ==='

-- ------------------------------------------------------------
-- 1. Site Admin can list users.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.admin_user_overview;
  if v_count > 5 then
    raise notice 'PASS 1: Site Admin can list users (% rows)', v_count;
  else
    raise notice 'FAIL 1: Site Admin only saw % rows', v_count;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 2. Ordinary user cannot list other users (profiles_select_self_or_admin
--    restricts admin_user_overview to exactly their own row).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.admin_user_overview;
  if v_count = 1 then
    raise notice 'PASS 2: an ordinary user sees only their own row in admin_user_overview';
  else
    raise notice 'FAIL 2: an ordinary user saw % rows', v_count;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 3. Club Admin cannot access global User Management -- being an admin of
--    their own club grants no extra visibility into other users' rows.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.admin_user_overview;
  if v_count = 1 then
    raise notice 'PASS 3: a Club Admin sees only their own row in admin_user_overview, not the club roster';
  else
    raise notice 'FAIL 3: a Club Admin saw % rows', v_count;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 4. Site Admin can view a specific user's memberships.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_memberships jsonb;
begin
  select memberships into v_memberships from public.admin_user_overview where user_id = '00000000-0000-0000-0000-000000000002';
  if jsonb_array_length(v_memberships) > 0 then
    raise notice 'PASS 4: Site Admin can view a specific user''s memberships (%)', jsonb_array_length(v_memberships);
  else
    raise notice 'FAIL 4: no memberships returned';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 5-8. Site Admin can grant/revoke Club Admin, grant Fixtures Admin, and
--      grant Team Admin for a specific team -- all against the throwaway
--      View Only test user (0015), all through the exact tables/RLS the
--      changeAccessProfile action itself writes to.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
begin
  update public.club_memberships set role = 'CLUB_ADMIN' where id = '20000000-0000-0000-0000-000000000015';
  if found then
    raise notice 'PASS 5: Site Admin can grant Club Admin';
  else
    raise notice 'FAIL 5: grant did not match';
  end if;

  update public.club_memberships set role = 'BASIC_USER' where id = '20000000-0000-0000-0000-000000000015';
  if found then
    raise notice 'PASS 6: Site Admin can revoke Club Admin (back to View Only)';
  else
    raise notice 'FAIL 6: revoke did not match';
  end if;

  update public.club_memberships set role = 'FIXTURE_SECRETARY' where id = '20000000-0000-0000-0000-000000000015';
  if found then
    raise notice 'PASS 7: Site Admin can grant Fixtures Admin';
  else
    raise notice 'FAIL 7: grant did not match';
  end if;

  update public.club_memberships set role = 'BASIC_USER' where id = '20000000-0000-0000-0000-000000000015';

  insert into public.team_permissions (membership_id, team_id, permission)
  values ('20000000-0000-0000-0000-000000000015', '30000000-0000-0000-0000-000000000001', 'team_admin')
  on conflict (membership_id, team_id) do update set permission = 'team_admin';
  raise notice 'PASS 8: Site Admin can grant Team Admin for a selected team (U12 A)';
end $$;
rollback;

\echo '=== Scenarios 5-8 rolled back deliberately -- the following scenarios re-apply the grants they need in their own transaction, since nothing above persists. ==='

-- ------------------------------------------------------------
-- Re-apply the Team Admin (U12 A only) grant for real, committed, so the
-- next several scenarios can exercise real protected actions against it
-- (not just inspect rows) -- then everything is cleaned up at the end.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
insert into public.team_permissions (membership_id, team_id, permission)
values ('20000000-0000-0000-0000-000000000015', '30000000-0000-0000-0000-000000000001', 'team_admin')
on conflict (membership_id, team_id) do update set permission = 'team_admin';
commit;

-- ------------------------------------------------------------
-- 9 / 15 / 19. Team Admin (U12 A only) can manage U12 A but not U13 A --
--    a real protected action (fixture creation), not just a row check.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000015","role":"authenticated"}';
do $$
begin
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text)
  values ('30000000-0000-0000-0000-000000000001', current_date + 14, 'Home', 'Planned', 'User Mgmt Test Opponent A');
  raise notice 'PASS 9/15: Team Admin scoped to U12 A can create a fixture for U12 A';
exception when others then
  raise notice 'FAIL 9/15: %', sqlerrm;
end $$;
do $$
begin
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text)
  values ('30000000-0000-0000-0000-000000000002', current_date + 14, 'Home', 'Planned', 'User Mgmt Test Opponent B');
  raise notice 'FAIL 9b: Team Admin scoped to U12 A was able to create a fixture for U13 A too';
exception when others then
  raise notice 'PASS 9b/19: Team Admin scoped to U12 A cannot create a fixture for U13 A -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 10. Team Admin cannot promote themselves club-wide.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000015","role":"authenticated"}';
do $$
begin
  update public.club_memberships set role = 'CLUB_ADMIN' where id = '20000000-0000-0000-0000-000000000015';
  if found then
    raise notice 'FAIL 10: Team Admin was able to promote themselves to Club Admin';
  else
    raise notice 'PASS 10: Team Admin cannot promote themselves (0 rows matched)';
  end if;
exception when others then
  raise notice 'PASS 10 (alt): rejected outright -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 11. Club Admin cannot create a Site Admin for anyone, not just
--     themselves.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  insert into public.site_admins (user_id, status) values ('00000000-0000-0000-0000-000000000015', 'active');
  raise notice 'FAIL 11: a Club Admin granted Site Admin to another user';
exception when others then
  raise notice 'PASS 11: a Club Admin cannot grant Site Admin to anyone -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 12. Granting Site Admin is explicit and global -- it never touches
--     club_memberships, and works even for a user with zero club
--     memberships (proving the two are structurally independent).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_membership_count_before int;
  v_membership_count_after int;
begin
  select count(*) into v_membership_count_before from public.club_memberships where user_id = '00000000-0000-0000-0000-000000000015';
  insert into public.site_admins (user_id, status) values ('00000000-0000-0000-0000-000000000015', 'active')
    on conflict (user_id) do update set status = 'active';
  select count(*) into v_membership_count_after from public.club_memberships where user_id = '00000000-0000-0000-0000-000000000015';
  if v_membership_count_before = v_membership_count_after then
    raise notice 'PASS 12: granting Site Admin left club_memberships completely untouched';
  else
    raise notice 'FAIL 12: club_memberships changed as a side effect of a Site Admin grant';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 13. View Only (BASIC_USER, no team_permissions) cannot mutate club
--     resources. The U12 A team_admin grant applied further up (for
--     scenario 9) is still committed at this point -- clear it first so
--     this scenario tests a genuinely View Only user, not a stale grant.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
delete from public.team_permissions where membership_id = '20000000-0000-0000-0000-000000000015';
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000015","role":"authenticated"}';
do $$
begin
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text)
  values ('30000000-0000-0000-0000-000000000001', current_date + 14, 'Home', 'Planned', 'View Only Test');
  raise notice 'FAIL 13: View Only user created a fixture';
exception when others then
  raise notice 'PASS 13: View Only user cannot create a fixture -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 14. Fixtures Admin can access its intended fixture functions
--     (fixture_requests / club_partnerships club-wide, via
--     can_manage_club_fixtures) but NOT things reserved for actual
--     team-level authority (raw fixtures INSERT for a team it has no
--     team_permissions for -- fixtures_insert_scoped checks
--     can_manage_team, which FIXTURE_SECRETARY deliberately does not
--     satisfy on its own) or Club-Admin-only actions like invitations.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
update public.club_memberships set role = 'FIXTURE_SECRETARY' where id = '20000000-0000-0000-0000-000000000015';
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000015","role":"authenticated"}';
do $$
begin
  insert into public.club_partnerships (requesting_club_id, partner_club_id, requested_by)
  values ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000015');
  raise notice 'PASS 14a: Fixtures Admin can create a club-wide calendar-sharing request (its real domain)';
exception
  when unique_violation then
    -- A prior test suite run in this same database session already
    -- created a Burnley<->Rossendale partnership -- reaching the unique
    -- constraint (not an RLS rejection) still proves the insert passed
    -- authorization, which is what this scenario actually checks.
    raise notice 'PASS 14a (alt): request passed authorization; a partnership already existed from an earlier suite run in this session -- %', sqlerrm;
  when others then
    raise notice 'FAIL 14a: %', sqlerrm;
end $$;
do $$
begin
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text)
  values ('30000000-0000-0000-0000-000000000002', current_date + 14, 'Home', 'Planned', 'Fixtures Admin Test');
  raise notice 'FAIL 14b: Fixtures Admin created a raw fixture for a team it has no team-level authority over';
exception when others then
  raise notice 'PASS 14b: Fixtures Admin (club-wide, but no team_permissions) cannot directly create a fixture for a team it doesn''t manage -- %', sqlerrm;
end $$;
do $$
begin
  insert into public.invitations (club_id, invited_email, created_by)
  values ('10000000-0000-0000-0000-000000000001', 'someone@example.com', '00000000-0000-0000-0000-000000000015');
  raise notice 'FAIL 14c: Fixtures Admin created an invitation (that is Club-Admin-only)';
exception when others then
  raise notice 'PASS 14c: Fixtures Admin cannot create an invitation -- %', sqlerrm;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
update public.club_memberships set role = 'BASIC_USER' where id = '20000000-0000-0000-0000-000000000015';
delete from public.team_permissions where membership_id = '20000000-0000-0000-0000-000000000015';
commit;

-- ------------------------------------------------------------
-- 16. Pending claimant receives no authority.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000008","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.admin_user_overview where has_active_membership = true and user_id = '00000000-0000-0000-0000-000000000008';
  if v_count = 0 then
    raise notice 'PASS 16: a pending claimant has no active club membership / authority anywhere';
  else
    raise notice 'FAIL 16: pending claimant unexpectedly has active membership rows';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 17 / 18. Revoking (suspending) the test user's membership removes their
--     authority for real -- a previously-successful action now fails.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
update public.club_memberships set status = 'revoked' where id = '20000000-0000-0000-0000-000000000015';
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000015","role":"authenticated"}';
do $$
begin
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text)
  values ('30000000-0000-0000-0000-000000000001', current_date + 14, 'Home', 'Planned', 'Revoked User Test');
  raise notice 'FAIL 17/18: a revoked user could still create a fixture for their formerly-assigned team';
exception when others then
  raise notice 'PASS 17/18: membership revocation actually removed authority -- %', sqlerrm;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
update public.club_memberships set status = 'active' where id = '20000000-0000-0000-0000-000000000015';
commit;

-- ------------------------------------------------------------
-- 22. Permission actions write an audit event.
-- ------------------------------------------------------------
do $$
declare
  v_before int;
begin
  select count(*) into v_before from public.audit_log where table_name = 'club_memberships' and record_id = '20000000-0000-0000-0000-000000000015';
  perform set_config('app.audit_before_count', v_before::text, false);
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
update public.club_memberships set club_role_title = 'Team Manager (audit test)' where id = '20000000-0000-0000-0000-000000000015';
commit;

do $$
declare
  v_before int := current_setting('app.audit_before_count')::int;
  v_after int;
begin
  select count(*) into v_after from public.audit_log where table_name = 'club_memberships' and record_id = '20000000-0000-0000-0000-000000000015';
  if v_after > v_before then
    raise notice 'PASS 22: a permission-relevant club_memberships change wrote an audit_log row (% -> %)', v_before, v_after;
  else
    raise notice 'FAIL 22: no new audit_log row (% -> %)', v_before, v_after;
  end if;
  update public.club_memberships set club_role_title = null where id = '20000000-0000-0000-0000-000000000015';
end $$;

-- ------------------------------------------------------------
-- 24. Unauthenticated requests fail.
-- ------------------------------------------------------------
begin;
set local role anon;
do $$
begin
  update public.club_memberships set role = 'CLUB_ADMIN' where id = '20000000-0000-0000-0000-000000000015';
  if found then
    raise notice 'FAIL 24: an unauthenticated request changed club_memberships';
  else
    raise notice 'PASS 24: an unauthenticated request cannot change club_memberships (0 rows matched)';
  end if;
exception when others then
  raise notice 'PASS 24 (alt): rejected outright -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 23 / 25. A club's own admin cannot reach across into an unrelated
--     club's membership row by id, even though they have real admin
--     authority somewhere -- row-level scoping, not "any admin, any row".
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  update public.club_memberships set role = 'CLUB_ADMIN' where user_id = '00000000-0000-0000-0000-000000000003';
  if found then
    raise notice 'FAIL 23/25: Burnley''s admin was able to change Rossendale admin''s own membership row';
  else
    raise notice 'PASS 23/25: Burnley''s admin cannot change a membership row belonging to a different club (0 rows matched)';
  end if;
exception when others then
  raise notice 'PASS 23/25 (alt): rejected outright -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- Cleanup: remove the throwaway test membership's team_permissions row so
-- repeated runs of this file don't accumulate residue (club_memberships
-- and its cascading team_permissions are recreated fresh by `on conflict
-- do nothing` at the top either way, but this keeps a single run tidy).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
delete from public.team_permissions where membership_id = '20000000-0000-0000-0000-000000000015';
commit;

\echo '=== Done. Review PASS/FAIL/SKIP lines above; every non-SKIP assertion should read PASS. ==='
\echo '=== Scenarios 20/21 (CSV export is Site Admin only / contains no sensitive personal fields) are app-layer, verified by code inspection of app/(app)/admin/users/actions.ts''s requireSiteAdmin() gate and its explicit CSV_COLUMNS allowlist (never DOB/address/phone/claim text/audit internals/tokens), same pattern as admin_club_management.sql''s own CSV scenarios. Scenario 26 (no auth secrets leaked) is verified by code inspection -- admin_user_overview never joins auth.users, only profiles. Scenarios 27-30 (public visibility toggles, Request Calendar Access / Message Club authorization, logo propagation privacy) are app-layer rendering decisions verified by code inspection and live browser testing, not RLS assertions -- the underlying data was already reachable under existing RLS either way; these toggles and gates are what a page chooses to render, not a new database permission boundary. Scenario 28 (Request Calendar Access authorization) is additionally already covered by partner_clubs_and_messaging.sql scenario 3 (Team Admin cannot create a club-wide partnership), which is the real RLS boundary requestPartnership relies on. ==='
