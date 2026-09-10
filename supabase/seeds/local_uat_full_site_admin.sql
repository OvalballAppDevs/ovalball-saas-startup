-- A dedicated local Full Site Admin, for browser UAT of Full-Site-Admin-only
-- surfaces -- Email Configuration chief among them.
--
-- WHY THIS EXISTS
--
-- Site Admin -> Email Configuration (lib/email/contracts.ts, the template
-- registry, the brand/logo library) is gated on siteAdminRole === 'full', not
-- merely internal.is_site_admin(). The existing local UAT Site Admin
-- (uat.siteadmin@ovalball.test, supabase/seeds/local_uat_site_admin.sql) is
-- deliberately admin_role 'club_data' and cannot reach it. The only Full Site
-- Admin on this database is the product owner's own account, and signing in as
-- a real person's identity to run a test is not something a session should do.
-- That is why Email Configuration has been reported as built-and-tested but
-- never driven through the UI.
--
-- WHAT IT IS NOT
--
-- Not a bypass. No hardcoded email check, no development-only authorisation
-- branch, no RLS exception, no client-side permission. This seed writes
-- exactly the row public.site_admins holds for a real Full Site Admin, and the
-- application authorises it through precisely the same model:
-- internal.is_full_site_admin() sees the row, requireActiveSiteAdmin() still
-- demands the account has actually switched into Site Admin context. Take the
-- row away and the account is an ordinary user again.
--
-- A NEW IDENTITY, NOT A PROMOTION OF THE EXISTING UAT SITE ADMIN
--
-- uat.siteadmin@ovalball.test is established as 'club_data' precisely to keep
-- the Full Site Admin boundary meaningful; promoting it would erase the one
-- distinction it exists to test. A second, clearly-named account keeps both
-- meanings intact and lets a future suite assert the narrower role is still
-- refused where it should be.

do $$
begin
  -- The same local-only guard the other UAT seeds use. A Full Site Admin row
  -- is the highest authority on the platform, so this must never run anywhere
  -- that holds real data.
  if exists (select 1 from public.clubs c join public.club_directory d on d.id = c.directory_id
             where d.source not in ('local_dev_seed','site_admin_manual','manual') limit 1)
     and not exists (select 1 from public.club_directory where source = 'local_dev_seed') then
    raise exception 'This looks like a real dataset. The UAT Full Site Admin seed is local-only.';
  end if;
end $$;

-- The established safe pattern: every GoTrue string column filled. Leaving
-- confirmation_token and friends NULL produces a row the auth service cannot
-- scan, and the account then fails to sign in with an error that has nothing
-- to do with the account.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token)
select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'uat.fullsiteadmin@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb,
       '', '', '', '', '', '', '', ''
where not exists (select 1 from auth.users u where u.email = 'uat.fullsiteadmin@ovalball.test');

insert into public.profiles (id, first_name, surname, email)
select u.id, 'UAT', 'Fullsiteadmin', u.email
from auth.users u
where u.email = 'uat.fullsiteadmin@ovalball.test'
  and not exists (select 1 from public.profiles p where p.id = u.id);

-- The authorisation itself. One row in the same table, read by the same
-- functions, subject to the same active-context rule.
insert into public.site_admins (user_id, status, admin_role, manage_team_catalogue)
select u.id, 'active', 'full', true
from auth.users u
where u.email = 'uat.fullsiteadmin@ovalball.test'
on conflict (user_id) do update
set status = 'active',
    admin_role = 'full',
    manage_team_catalogue = true,
    updated_at = now();

do $$
declare v_role text;
begin
  select sa.admin_role into v_role
  from public.site_admins sa join public.profiles p on p.id = sa.user_id
  where p.email = 'uat.fullsiteadmin@ovalball.test' and sa.status = 'active';

  if v_role is null then
    raise exception 'The UAT Full Site Admin was not granted.';
  end if;
  if v_role <> 'full' then
    raise exception 'The UAT Full Site Admin must hold Full Site Admin authority.';
  end if;
  raise notice 'Local UAT Full Site Admin ready: uat.fullsiteadmin@ovalball.test (role full).';
end $$;
