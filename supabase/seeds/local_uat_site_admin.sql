-- A dedicated local Site Admin for browser UAT.
--
-- WHY THIS EXISTS
--
-- Every Site Admin surface -- Team Directory, Seasons, Club Management,
-- Permissions -- has been unreachable in local browser testing, because the
-- only Site Admin on this database is the product owner's own account. Signing
-- in as a real person's identity to run a test is not something a session
-- should do, so those surfaces have been repeatedly reported as
-- NOT DEMONSTRATED. This closes that, permanently and reproducibly.
--
-- WHAT IT IS NOT
--
-- Not a bypass. There is no hardcoded email check anywhere, no development-only
-- authorisation branch, no RLS exception and no client-side permission. This
-- seed writes exactly the row public.site_admins holds for a real Site Admin,
-- and the application authorises it through precisely the same model:
-- internal.is_site_admin() sees the row, internal.can_manage_team_catalogue()
-- sees the capability, and requireActiveSiteAdmin() still demands that the
-- account has actually switched into Site Admin context. Take the row away and
-- the account is an ordinary user again.
--
-- DELIBERATELY NOT A FULL SITE ADMIN
--
-- admin_role is 'club_data', not 'full'. The account gets the minimum
-- authority the job needs: reach the Site Admin surfaces under Clubs & People,
-- and manage the Team Directory. That keeps the Full Site Admin invariant
-- exactly where it was -- a genuine Full Site Admin is still the only account
-- with full authority, and nothing here special-cases or weakens that rule.
--
-- Reusing an existing UAT identity was considered and rejected: every one of
-- them carries an established meaning that other tests depend on. Priya Nair
-- is the Club Admin, Dana Whitaker is the guardian with two children, and
-- uat.unrelated@ovalball.test exists precisely to be denied things. Making any
-- of them a Site Admin would quietly change what those tests are testing.

do $$
begin
  -- The same local-only guard the Parent/Player UAT seed uses. A Site Admin
  -- row is the highest authority on the platform, so this must never run
  -- anywhere that holds real data.
  if exists (select 1 from public.clubs c join public.club_directory d on d.id = c.directory_id
             where d.source not in ('local_dev_seed','site_admin_manual','manual') limit 1)
     and not exists (select 1 from public.club_directory where source = 'local_dev_seed') then
    raise exception 'This looks like a real dataset. The UAT Site Admin seed is local-only.';
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
       'uat.siteadmin@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb,
       '', '', '', '', '', '', '', ''
where not exists (select 1 from auth.users u where u.email = 'uat.siteadmin@ovalball.test');

insert into public.profiles (id, first_name, surname, email)
select u.id, 'UAT', 'Siteadmin', u.email
from auth.users u
where u.email = 'uat.siteadmin@ovalball.test'
  and not exists (select 1 from public.profiles p where p.id = u.id);

-- The authorisation itself. One row in the same table, read by the same
-- functions, subject to the same active-context rule.
insert into public.site_admins (user_id, status, admin_role, manage_team_catalogue)
select u.id, 'active', 'club_data', true
from auth.users u
where u.email = 'uat.siteadmin@ovalball.test'
on conflict (user_id) do update
set status = 'active',
    admin_role = 'club_data',
    manage_team_catalogue = true,
    updated_at = now();

do $$
declare v_role text; v_cat boolean;
begin
  select sa.admin_role, sa.manage_team_catalogue into v_role, v_cat
  from public.site_admins sa join public.profiles p on p.id = sa.user_id
  where p.email = 'uat.siteadmin@ovalball.test' and sa.status = 'active';

  if v_role is null then
    raise exception 'The UAT Site Admin was not granted.';
  end if;
  if v_role = 'full' then
    raise exception 'The UAT Site Admin must not hold Full Site Admin authority.';
  end if;
  if not v_cat then
    raise exception 'The UAT Site Admin cannot manage the Team Directory.';
  end if;
  raise notice 'Local UAT Site Admin ready: uat.siteadmin@ovalball.test (role %, Team Directory management on).', v_role;
end $$;
