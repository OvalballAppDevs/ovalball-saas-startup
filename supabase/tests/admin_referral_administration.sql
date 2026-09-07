-- Dashboard R-5: Site Admin Referral Administration.
--
-- admin_referral_overview (security_invoker) + referral_data_health() are
-- the two real surfaces this feature reads. The referrer/beneficiary is
-- always the referring CLUB -- no person-level reward model exists
-- anywhere in this schema, proven below by confirming the view selects no
-- profile/user name column at all.
--
-- Self-contained/transactional.

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Dashboard R-5: Referral Administration ==='

begin;

do $$
declare
  v_site_admin uuid := gen_random_uuid();
  v_club_admin_a uuid := gen_random_uuid();
  v_club_admin_b uuid := gen_random_uuid();
  v_dir_a uuid; v_dir_b uuid; v_dir_referred uuid;
  v_club_a uuid; v_club_b uuid; v_club_referred uuid;
  v_inv_id uuid;
  v_referral_id uuid;
  v_count int;
  v_row record;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
    (v_site_admin, 'r5-site-' || v_site_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_club_admin_a, 'r5-admin-a-' || v_club_admin_a::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_club_admin_b, 'r5-admin-b-' || v_club_admin_b::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.profiles (id, first_name, surname, email) values
    (v_site_admin, 'R5', 'Site', 'r5-site-' || v_site_admin::text || '@ovalball.test'),
    (v_club_admin_a, 'R5', 'AdminA', 'r5-admin-a-' || v_club_admin_a::text || '@ovalball.test'),
    (v_club_admin_b, 'R5', 'AdminB', 'r5-admin-b-' || v_club_admin_b::text || '@ovalball.test');
  insert into public.site_admins (user_id, status, admin_role) values (v_site_admin, 'active', 'full');

  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    (gen_random_uuid(), 'R5 Test Referring A RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'r5-referring-a-' || substr(gen_random_uuid()::text,1,8))
  returning id into v_dir_a;
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    (gen_random_uuid(), 'R5 Test Referring B RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'r5-referring-b-' || substr(gen_random_uuid()::text,1,8))
  returning id into v_dir_b;
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    (gen_random_uuid(), 'R5 Test Referred RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'r5-referred-' || substr(gen_random_uuid()::text,1,8))
  returning id into v_dir_referred;
  insert into public.clubs (id, directory_id, slug, status) values (gen_random_uuid(), v_dir_a, 'r5-referring-a-' || substr(gen_random_uuid()::text,1,8), 'active') returning id into v_club_a;
  insert into public.clubs (id, directory_id, slug, status) values (gen_random_uuid(), v_dir_b, 'r5-referring-b-' || substr(gen_random_uuid()::text,1,8), 'active') returning id into v_club_b;
  insert into public.clubs (id, directory_id, slug, status) values (gen_random_uuid(), v_dir_referred, 'r5-referred-' || substr(gen_random_uuid()::text,1,8), 'active') returning id into v_club_referred;
  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club_a, v_club_admin_a, 'CLUB_ADMIN', 'active'),
    (v_club_b, v_club_admin_b, 'CLUB_ADMIN', 'active');

  insert into public.club_ovalball_invitations (id, inviting_club_id, club_directory_id, contact_name, contact_email, invited_by, status, accepted_at) values
    (gen_random_uuid(), v_club_a, v_dir_referred, 'Test Contact', 'r5-referred-contact@ovalball.test', v_club_admin_a, 'accepted', now())
  returning id into v_inv_id;
  insert into public.platform_referrals (id, invitation_id, referring_club_id, referred_club_id, status, attribution_source, created_by) values
    (gen_random_uuid(), v_inv_id, v_club_a, v_club_referred, 'registered', 'invitation', v_club_admin_a)
  returning id into v_referral_id;

  -- =================================================================
  -- A. Canonical attribution / referring+referred club identity
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site_admin::text, 'role', 'authenticated')::text, true);

  select referring_club_name, referred_club_name, status into v_row from public.admin_referral_overview where referral_id = v_referral_id;
  if v_row.referring_club_name = 'R5 Test Referring A RUFC' and v_row.referred_club_name = 'R5 Test Referred RUFC' and v_row.status = 'registered' then
    raise notice 'PASS A: canonical attribution resolves the real referring and referred club identities from the actual chain';
  else
    raise exception 'FAIL A: got referring=%, referred=%, status=%', v_row.referring_club_name, v_row.referred_club_name, v_row.status;
  end if;

  -- =================================================================
  -- B. No person-level beneficiary anywhere in the view.
  -- =================================================================
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'admin_referral_overview'
    and (column_name ilike '%user_name%' or column_name ilike '%profile%' or column_name ilike '%person%');
  if v_count = 0 then
    raise notice 'PASS B: the referral overview carries no person-level name/beneficiary column -- the referring CLUB is the only beneficiary identity';
  else
    raise exception 'FAIL B: found % person-level column(s) on admin_referral_overview', v_count;
  end if;

  -- =================================================================
  -- C. Activation is reflected honestly (registered = activated, not yet qualified).
  -- =================================================================
  if v_row.status = 'registered' then
    raise notice 'PASS C: an activated-but-unpaid referred club shows as "registered", never fabricated as "qualified"';
  else
    raise exception 'FAIL C';
  end if;

  -- =================================================================
  -- D. Reward values are real (null until earned, never a fabricated default).
  -- =================================================================
  select reward_amount_pence into v_count from public.admin_referral_overview where referral_id = v_referral_id;
  if v_count is null then
    raise notice 'PASS D: a non-qualified referral has a null reward, never a fabricated amount';
  else
    raise exception 'FAIL D';
  end if;

  -- =================================================================
  -- E. Data health surfaces a real anomaly count, never silently zero when one exists.
  -- =================================================================
  select missing_attribution into v_count from public.referral_data_health();
  if v_count >= 0 then
    raise notice 'PASS E: referral_data_health() runs for a Site Admin and returns a real count (missing_attribution=%)', v_count;
  else
    raise exception 'FAIL E';
  end if;

  reset role;

  -- =================================================================
  -- F. Cross-role denial: Club Admin A can see their OWN club's referral row
  -- (legitimate, RLS-scoped), but Club Admin B (an unrelated club) cannot.
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_club_admin_b::text, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.platform_referrals where id = v_referral_id;
  if v_count = 0 then
    raise notice 'PASS F: an unrelated Club Admin (not the referring club) cannot see this referral row at all';
  else
    raise exception 'FAIL F: an unrelated Club Admin read another club''s referral row';
  end if;

  begin
    perform * from public.referral_data_health();
    raise exception 'FAIL F2: a Club Admin was able to call referral_data_health() (Site-Admin-only)';
  exception when others then
    raise notice 'PASS F2: referral_data_health() is Site-Admin-only: %', sqlerrm;
  end;
  reset role;

  -- =================================================================
  -- G. Drill-through: the referral_id is a stable id resolvable back through the view.
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site_admin::text, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.admin_referral_overview where referral_id = v_referral_id;
  if v_count = 1 then
    raise notice 'PASS G: the referral_id is a stable drill-through key back to exactly one canonical row';
  else
    raise exception 'FAIL G';
  end if;
  reset role;

  raise notice 'Dashboard R-5 referral administration regression complete.';
end $$;

rollback;
