-- =====================================================================================================
-- A CLUB HEARS WHEN GOCARDLESS VERIFIES ITS ACCOUNT (20270752000000)
--
--   GV1   while a club is setting up, the moment its live connection becomes verified, the people who can switch
--         memberships on are told -- once, by the one notification system, with nothing but the club's name;
--   GV2   nobody else at the club is told (a member, a Fixture Secretary);
--   GV3   a status that was already verified (a webhook delivered twice, a replay, a re-check) tells nobody again;
--   GV4   'unknown' still never replaces a status GoCardless gave (20270749000000, G8);
--   GV5   a club whose memberships are already on is not told to switch them on;
--   GV6   a disconnected connection is not touched and tells nobody;
--   GV7   only the server may record a status: a signed-in person is refused.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.
-- =====================================================================================================

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create temp table ctx (k text primary key, v uuid) on commit drop;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ctx where k = p_k $$;
create or replace function pg_temp.put(p_k text, p_v uuid) returns uuid language sql as $$
  insert into ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v returning v $$;

create or replace function pg_temp.person(p_label text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_email text := 'gvn-' || lower(p_label) || '-' || v::text || '@ovalball.test';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_email,'',now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
  values (v, p_label, 'Verified', v_email, (current_date - interval '40 years')::date, 'ACTIVE')
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth, account_state = 'ACTIVE';
  return v;
end $$;

create or replace function pg_temp.club(p_key text, p_by uuid) returns uuid language plpgsql as $$
declare v_tag text := substr(gen_random_uuid()::text, 1, 8); v_dir uuid; v_club uuid;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values (initcap(p_key) || ' ' || v_tag || ' RFC', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'gvn-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'gvn-' || v_tag, 'active') returning id into v_club;
  insert into public.gocardless_merchant_connections (club_id, environment, gc_organisation_id, access_token, scope, verification_status, connected_by, connected_at)
  values (v_club, 'sandbox', 'OR_GVN_' || v_tag, null, 'read_write', 'in_review', p_by, now());
  return pg_temp.put(p_key, v_club);
end $$;

/** As the server records a status GoCardless gave. */
create or replace function pg_temp.verify(p_club uuid, p_status text) returns void language plpgsql as $$
begin
  set local role service_role;
  perform public.update_gocardless_verification_status(p_club, p_status);
  reset role;
end $$;

create or replace function pg_temp.told(p_user uuid) returns integer language sql as $$
  select count(*)::int from public.notifications where user_id = p_user and type = 'membership_gocardless_verified' $$;

-- SEED: a club setting up (a Club Admin, a coach, a member), and a second club whose memberships are already on.
do $$
declare v_club uuid; v_on uuid;
begin
  perform pg_temp.put('ca', pg_temp.person('Clubadmin'));
  perform pg_temp.put('coach', pg_temp.person('Coach'));
  perform pg_temp.put('member', pg_temp.person('Member'));
  perform pg_temp.put('ca2', pg_temp.person('Liveadmin'));
  v_club := pg_temp.club('setting', pg_temp.id('ca'));
  v_on := pg_temp.club('live', pg_temp.id('ca2'));
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, pg_temp.id('ca'), 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, pg_temp.id('coach'), 'BASIC_USER', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, pg_temp.id('member'), 'FIXTURE_SECRETARY', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_on, pg_temp.id('ca2'), 'CLUB_ADMIN', 'active');
  insert into public.club_subscription_programmes (club_id, enabled, collection_day, first_payment_policy, platform_fee_mode, activated_at, created_by)
  values (v_on, true, 1, 'NEXT_COLLECTION_DAY', 'GOCARDLESS_APP_FEE', now(), pg_temp.id('ca2'));
end $$;

-- GV7 first, before anything is verified: a person cannot record a status.
do $$
declare v_state text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.id('ca'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.update_gocardless_verification_status(pg_temp.id('setting'), 'successful');
    v_state := 'OK';
  exception when others then v_state := sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(v_state = '42501' and (select verification_status from public.gocardless_merchant_connections where club_id = pg_temp.id('setting')) = 'in_review',
    'GV7 a signed-in person cannot record a verification status (' || coalesce(v_state, '-') || ')');
end $$;

do $$
begin
  perform pg_temp.verify(pg_temp.id('setting'), 'successful');
  perform pg_temp.check(pg_temp.told(pg_temp.id('ca')) = 1
                        and (select body from public.notifications where user_id = pg_temp.id('ca') and type = 'membership_gocardless_verified') like 'GoCardless has verified % account. You can now switch Club Memberships on.'
                        and (select data ->> 'club_id' from public.notifications where user_id = pg_temp.id('ca') and type = 'membership_gocardless_verified') = pg_temp.id('setting')::text,
    'GV1 the moment the account becomes verified, the Club Admin is told once, about this club, that memberships can be switched on');
  perform pg_temp.check(pg_temp.told(pg_temp.id('coach')) = 0 and pg_temp.told(pg_temp.id('member')) = 0,
    'GV2 nobody else at the club is told (a member, a Fixture Secretary)');

  perform pg_temp.verify(pg_temp.id('setting'), 'successful');
  perform pg_temp.verify(pg_temp.id('setting'), 'successful');
  perform pg_temp.check(pg_temp.told(pg_temp.id('ca')) = 1, 'GV3 a status already verified (a duplicate webhook, a replay, a re-check) tells nobody again');

  perform pg_temp.verify(pg_temp.id('setting'), 'unknown');
  perform pg_temp.check((select verification_status from public.gocardless_merchant_connections where club_id = pg_temp.id('setting')) = 'successful',
    'GV4 an unknown check never replaces the status GoCardless gave');

  perform pg_temp.verify(pg_temp.id('live'), 'successful');
  perform pg_temp.check(pg_temp.told(pg_temp.id('ca2')) = 0 and (select verification_status from public.gocardless_merchant_connections where club_id = pg_temp.id('live')) = 'successful',
    'GV5 a club whose memberships are already on records the status and is not told to switch them on');

  update public.gocardless_merchant_connections set disconnected_at = now(), verification_status = 'in_review' where club_id = pg_temp.id('setting');
  perform pg_temp.verify(pg_temp.id('setting'), 'successful');
  perform pg_temp.check(pg_temp.told(pg_temp.id('ca')) = 1 and (select verification_status from public.gocardless_merchant_connections where club_id = pg_temp.id('setting')) = 'in_review',
    'GV6 a disconnected connection is left alone and tells nobody');
end $$;

rollback;
