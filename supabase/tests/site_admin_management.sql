-- Manual verification for Site Admin Management (Phase 2): the
-- site_admin_invitations table and its RLS, get_site_admin_invitation_preview
-- / accept_site_admin_invitation / revoke_site_admin_invitation, the
-- prevent_last_full_admin_lockout trigger, and the site_admins write-RLS
-- narrowing (20260831270000 -- only a Full Site Admin may write
-- site_admins directly, closing the gap where any restricted Site Admin
-- profile could otherwise grant themselves admin_role='full'). NOT a
-- migration -- never applied automatically by `db reset`. Run by hand
-- against local Supabase, AFTER permission_matrix.sql (reuses its Site
-- Admin fixture 0001, now admin_role='full' by column default):
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/site_admin_management.sql
--
-- Self-contained beyond that: creates a restricted Site Admin (00...0016,
-- admin_role='read_only'), an invitation-target user with no prior
-- site_admins row (00...0017), and a second Full Site Admin candidate
-- (00...0018) for the lockout-escalation scenarios. SET LOCAL role/
-- request.jwt.claims are always top-level statements, never inside a DO
-- block. Most scenarios roll back; the lockout scenarios (9a-9c) commit
-- deliberately since they test sequential state transitions.

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values
    ('00000000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.readonly.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000017', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.site.admin.invitee@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000018', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.second.full.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;

  insert into public.profiles (id, first_name, surname, email)
  values
    ('00000000-0000-0000-0000-000000000016', 'Test', 'ReadOnlyAdmin', 'test.readonly.admin@ovalball.local'),
    ('00000000-0000-0000-0000-000000000017', 'Test', 'Invitee', 'test.site.admin.invitee@ovalball.local'),
    ('00000000-0000-0000-0000-000000000018', 'Test', 'SecondFullAdmin', 'test.second.full.admin@ovalball.local')
  on conflict (id) do nothing;

  insert into public.site_admins (user_id, status, admin_role) values ('00000000-0000-0000-0000-000000000016', 'active', 'read_only')
  on conflict (user_id) do update set status = 'active', admin_role = 'read_only';
end $$;

\echo '=== Fixtures ready. Running Site Admin Management scenarios. ==='

-- ------------------------------------------------------------
-- 1. Full Site Admin can create a Site Admin invitation.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  insert into public.site_admin_invitations (invited_email, admin_role, invited_by)
  values ('test.site.admin.invitee@ovalball.local', 'fixture_ops', '00000000-0000-0000-0000-000000000001');
  raise notice 'PASS 1: Full Site Admin can create a Site Admin invitation';
exception when others then
  raise notice 'FAIL 1: %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 2. Ordinary user cannot create a Site Admin invitation.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
do $$
begin
  insert into public.site_admin_invitations (invited_email, admin_role, invited_by)
  values ('test.site.admin.invitee@ovalball.local', 'full', '00000000-0000-0000-0000-000000000007');
  raise notice 'FAIL 2: an ordinary user created a Site Admin invitation';
exception when others then
  raise notice 'PASS 2: ordinary user blocked from creating a Site Admin invitation (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 3. A restricted Site Admin (read_only) cannot create a Site Admin
--    invitation -- only Full may.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000016","role":"authenticated"}';
do $$
begin
  insert into public.site_admin_invitations (invited_email, admin_role, invited_by)
  values ('test.site.admin.invitee@ovalball.local', 'full', '00000000-0000-0000-0000-000000000016');
  raise notice 'FAIL 3: a read_only Site Admin created a Site Admin invitation';
exception when others then
  raise notice 'PASS 3: read_only Site Admin blocked from creating a Site Admin invitation (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 4. Full Site Admin can see pending invitations; a restricted Site
--    Admin sees none (RLS, not just a UI hide).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.site_admin_invitations (invited_email, admin_role, invited_by)
values ('test.site.admin.invitee@ovalball.local', 'fixture_ops', '00000000-0000-0000-0000-000000000001');
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.site_admin_invitations where invited_email = 'test.site.admin.invitee@ovalball.local';
  if v_count = 1 then
    raise notice 'PASS 4a: Full Site Admin can see the pending invitation';
  else
    raise notice 'FAIL 4a: Full Site Admin saw % rows', v_count;
  end if;
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000016","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.site_admin_invitations where invited_email = 'test.site.admin.invitee@ovalball.local';
  if v_count = 0 then
    raise notice 'PASS 4b: restricted Site Admin cannot see pending invitations';
  else
    raise notice 'FAIL 4b: restricted Site Admin saw % rows', v_count;
  end if;
end $$;
rollback;

-- Clean up the committed invitation from scenario 4 before continuing.
delete from public.site_admin_invitations where invited_email = 'test.site.admin.invitee@ovalball.local';

-- ------------------------------------------------------------
-- 5. accept_site_admin_invitation: matching email succeeds and grants
--    real site_admins access with the invited profile.
-- ------------------------------------------------------------
do $$
declare
  v_token text;
begin
  insert into public.site_admin_invitations (invited_email, admin_role, invited_by)
  values ('test.site.admin.invitee@ovalball.local', 'fixture_ops', '00000000-0000-0000-0000-000000000001')
  returning token into v_token;
  perform set_config('test.invite_token', v_token, false);
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000017","role":"authenticated","email":"test.site.admin.invitee@ovalball.local"}';
do $$
declare
  v_token text := current_setting('test.invite_token', true);
  v_role text;
begin
  perform public.accept_site_admin_invitation(v_token);
  select admin_role into v_role from public.site_admins where user_id = '00000000-0000-0000-0000-000000000017' and status = 'active';
  if v_role = 'fixture_ops' then
    raise notice 'PASS 5: accepted invitation grants the invited profile (fixture_ops)';
  else
    raise notice 'FAIL 5: expected fixture_ops, got %', v_role;
  end if;
exception when others then
  raise notice 'FAIL 5: %', sqlerrm;
end $$;
commit;

-- Clean up the granted access from scenario 5 (as the Full admin, bypassing
-- RLS is unnecessary -- Full Site Admin has real UPDATE rights here).
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
delete from public.site_admins where user_id = '00000000-0000-0000-0000-000000000017';
delete from public.site_admin_invitations where invited_email = 'test.site.admin.invitee@ovalball.local';
commit;

-- ------------------------------------------------------------
-- 6. accept_site_admin_invitation: mismatched session email is rejected.
-- ------------------------------------------------------------
do $$
declare
  v_token text;
begin
  insert into public.site_admin_invitations (invited_email, admin_role, invited_by)
  values ('test.site.admin.invitee@ovalball.local', 'club_data', '00000000-0000-0000-0000-000000000001')
  returning token into v_token;
  perform set_config('test.invite_token', v_token, false);
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000017","role":"authenticated","email":"wrong.person@ovalball.local"}';
do $$
declare
  v_token text := current_setting('test.invite_token', true);
begin
  perform public.accept_site_admin_invitation(v_token);
  raise notice 'FAIL 6: acceptance with a mismatched email succeeded';
exception when others then
  if sqlerrm like '%different email address%' then
    raise notice 'PASS 6: acceptance with a mismatched email rejected (%)', sqlerrm;
  else
    raise notice 'FAIL 6: unexpected error: %', sqlerrm;
  end if;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
delete from public.site_admin_invitations where invited_email = 'test.site.admin.invitee@ovalball.local';
commit;

-- ------------------------------------------------------------
-- 7. accept_site_admin_invitation: expired invitation is rejected.
-- ------------------------------------------------------------
do $$
declare
  v_token text;
begin
  insert into public.site_admin_invitations (invited_email, admin_role, invited_by, expires_at)
  values ('test.site.admin.invitee@ovalball.local', 'club_data', '00000000-0000-0000-0000-000000000001', now() - interval '1 day')
  returning token into v_token;
  perform set_config('test.invite_token', v_token, false);
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000017","role":"authenticated","email":"test.site.admin.invitee@ovalball.local"}';
do $$
declare
  v_token text := current_setting('test.invite_token', true);
begin
  perform public.accept_site_admin_invitation(v_token);
  raise notice 'FAIL 7: acceptance of an expired invitation succeeded';
exception when others then
  if sqlerrm like '%expired%' then
    raise notice 'PASS 7: acceptance of an expired invitation rejected (%)', sqlerrm;
  else
    raise notice 'FAIL 7: unexpected error: %', sqlerrm;
  end if;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
delete from public.site_admin_invitations where invited_email = 'test.site.admin.invitee@ovalball.local';
commit;

-- ------------------------------------------------------------
-- 8. revoke_site_admin_invitation: restricted Site Admin cannot revoke;
--    Full Site Admin can.
-- ------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  insert into public.site_admin_invitations (invited_email, admin_role, invited_by)
  values ('test.site.admin.invitee@ovalball.local', 'message_moderator', '00000000-0000-0000-0000-000000000001')
  returning id into v_id;
  perform set_config('test.invite_id', v_id::text, false);
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000016","role":"authenticated"}';
do $$
declare
  v_id uuid := current_setting('test.invite_id', true)::uuid;
begin
  perform public.revoke_site_admin_invitation(v_id);
  raise notice 'FAIL 8a: a read_only Site Admin revoked a Site Admin invitation';
exception when others then
  raise notice 'PASS 8a: read_only Site Admin blocked from revoking (%)', sqlerrm;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_id uuid := current_setting('test.invite_id', true)::uuid;
  v_status text;
begin
  perform public.revoke_site_admin_invitation(v_id);
  select status into v_status from public.site_admin_invitations where id = v_id;
  if v_status = 'revoked' then
    raise notice 'PASS 8b: Full Site Admin can revoke a Site Admin invitation';
  else
    raise notice 'FAIL 8b: expected revoked, got %', v_status;
  end if;
end $$;
commit;

delete from public.site_admin_invitations where invited_email = 'test.site.admin.invitee@ovalball.local';

-- ------------------------------------------------------------
-- 9. Lockout prevention: the sole Full Site Admin cannot be revoked or
--    demoted; once a second Full Site Admin exists, the first can be
--    revoked, but the resulting sole Full Site Admin is protected again.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_full_count int;
begin
  select count(*) into v_full_count from public.site_admins where status = 'active' and admin_role = 'full';
  if v_full_count <> 1 then
    raise notice 'SKIP 9: expected exactly 1 active Full Site Admin before this scenario, found %; run against a fresh db reset', v_full_count;
  end if;
end $$;
do $$
begin
  update public.site_admins set status = 'revoked' where user_id = '00000000-0000-0000-0000-000000000001';
  raise notice 'FAIL 9a: revoked the sole remaining Full Site Admin';
exception when others then
  if sqlerrm like '%last remaining Full Site Admin%' then
    raise notice 'PASS 9a: sole Full Site Admin protected from revocation (%)', sqlerrm;
  else
    raise notice 'FAIL 9a: unexpected error: %', sqlerrm;
  end if;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.site_admins (user_id, status, admin_role, granted_by)
values ('00000000-0000-0000-0000-000000000018', 'active', 'full', '00000000-0000-0000-0000-000000000001');
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  update public.site_admins set status = 'revoked' where user_id = '00000000-0000-0000-0000-000000000001';
  raise notice 'PASS 9b: revoking one of two active Full Site Admins succeeds';
exception when others then
  raise notice 'FAIL 9b: %', sqlerrm;
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000018","role":"authenticated"}';
do $$
begin
  update public.site_admins set status = 'revoked' where user_id = '00000000-0000-0000-0000-000000000018';
  raise notice 'FAIL 9c: revoked the now-sole remaining Full Site Admin';
exception when others then
  if sqlerrm like '%last remaining Full Site Admin%' then
    raise notice 'PASS 9c: sole remaining Full Site Admin protected again after the first revoke (%)', sqlerrm;
  else
    raise notice 'FAIL 9c: unexpected error: %', sqlerrm;
  end if;
end $$;
rollback;

-- Restore baseline for any suite run after this one: 0001 active/full,
-- 0018 removed entirely.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000018","role":"authenticated"}';
update public.site_admins set status = 'active' where user_id = '00000000-0000-0000-0000-000000000001';
commit;

do $$
begin
  delete from public.site_admins where user_id = '00000000-0000-0000-0000-000000000018';
end $$;

-- ------------------------------------------------------------
-- 10. RLS gap closed (20260831270000): a restricted Site Admin cannot
--     write site_admins directly at all -- not even their own row --
--     regardless of what requireSiteAdmin's allowedProfiles would say at
--     the application layer. This is the real boundary.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000016","role":"authenticated"}';
do $$
declare
  v_rows int;
begin
  update public.site_admins set admin_role = 'full' where user_id = '00000000-0000-0000-0000-000000000016';
  get diagnostics v_rows = row_count;
  -- RLS's USING clause silently excludes non-matching rows rather than
  -- raising -- an UPDATE a restricted admin isn't allowed to make affects
  -- 0 rows, it doesn't error. So the real assertion is "0 rows changed",
  -- not "an exception was thrown".
  if v_rows = 0 then
    raise notice 'PASS 10a: read_only Site Admin blocked from self-promoting (0 rows matched under RLS)';
  else
    raise notice 'FAIL 10a: a read_only Site Admin self-promoted to full (% row(s) changed)', v_rows;
  end if;
exception when others then
  raise notice 'PASS 10a: read_only Site Admin blocked from self-promoting (%)', sqlerrm;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000016","role":"authenticated"}';
do $$
begin
  insert into public.site_admins (user_id, status, admin_role) values ('00000000-0000-0000-0000-000000000007', 'active', 'full');
  raise notice 'FAIL 10b: a read_only Site Admin granted Site Admin to another user directly';
exception when others then
  raise notice 'PASS 10b: read_only Site Admin blocked from directly inserting a new Site Admin (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 11. Full Site Admin retains real direct write access (changeSiteAdminRole
--     / revokeActiveSiteAdmin's actual boundary).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_role text;
begin
  update public.site_admins set admin_role = 'user_access' where user_id = '00000000-0000-0000-0000-000000000016';
  select admin_role into v_role from public.site_admins where user_id = '00000000-0000-0000-0000-000000000016';
  if v_role = 'user_access' then
    raise notice 'PASS 11: Full Site Admin can change another Site Admin''s profile directly';
  else
    raise notice 'FAIL 11: expected user_access, got %', v_role;
  end if;
end $$;
rollback;
