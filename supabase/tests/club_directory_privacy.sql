-- =====================================================================================================
-- A SESSION IS NOT AUTHORITY OVER EVERY CLUB'S PRIVATE COLUMNS (Convergence Step 6; ledger L17)
--
-- Deterministic and self-seeding.
--
-- WHAT L17 WAS. Measured at the end of Step 5 and again at the start of Step 6: `authenticated` held a
-- TABLE-level SELECT on club_directory, which silently overrode the 17-column public grant that was
-- also present on the same table. So any signed-in account -- a parent, a player, a coach at an
-- unrelated club -- could read `notes` and `official_email` for all 1,395 clubs.
--
-- The intent had been recorded in the grants and then overridden by a wider one, which is why nothing
-- looked wrong: `anon` was correctly restricted and the column list existed for `authenticated` too.
--
-- WHAT THE COLUMN ACTUALLY HOLDS, recovered rather than assumed: governing-body research provenance
-- ("Official WRU 2026/27 community amateur competition participant"). Not personal data. The severity
-- was therefore low -- and the boundary is asserted anyway, because `notes` is free text a Site Admin
-- writes, so what it may hold tomorrow follows the writer's licence rather than today's sample.
--
-- Every refusal below is paired with a POSITIVE CONTROL. A grant that refused everybody would pass the
-- refusals exactly as well as the right one, and would also have broken Ovie's opponent search, the
-- competitions workspace and the Partner Clubs map -- all of which legitimately read latitude,
-- longitude and geocode_status from this table.
-- =====================================================================================================
begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text, p_email text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',p_email,'',now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
  values (v,'L17',p_label,p_email,(current_date - interval '33 years')::date,'ACTIVE');
  perform internal.refresh_account_security_state(v);
  return v;
end $$;

create or replace function pg_temp.admin(p_user uuid, p_profile text) returns void language plpgsql as $$
begin
  insert into public.site_admins (user_id, status, profile_key) values (p_user, 'active', p_profile)
  on conflict (user_id) do update set status = 'active', profile_key = excluded.profile_key;
end $$;

create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  if p_subject is null then
    perform set_config('request.jwt.claims', '', true);
  else
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  end if;
  begin
    execute 'set local role ' || case when p_subject is null then 'anon' else 'authenticated' end;
    execute p_sql;
    v := 'OK';
  exception when others then get stacked diagnostics v = returned_sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

do $$
declare
  v_tag     text := substr(gen_random_uuid()::text, 1, 8);
  v_member  uuid;
  v_other   uuid;
  v_clubadm uuid;
  v_site    uuid;
  v_dir     uuid;
  v_club    uuid;
  v_rc      text;
  v_n       int;
begin
  v_member  := pg_temp.person('Member',   'l17.member.'   || v_tag || '@ovalball.test');
  v_other   := pg_temp.person('Other',    'l17.other.'    || v_tag || '@ovalball.test');
  v_clubadm := pg_temp.person('ClubAdmin','l17.clubadm.'  || v_tag || '@ovalball.test');
  v_site    := pg_temp.person('SiteAdmin','l17.site.'     || v_tag || '@ovalball.test');
  perform pg_temp.admin(v_site, 'SITE_FULL');

  insert into public.club_directory (name, normalized_key, source, rugby_code, country, nation, verification_status, active, notes, official_email)
  values ('L17 Test RFC ' || v_tag, 'l17-test-rfc-' || v_tag, 'MANUAL', 'union', 'England', 'England', 'unverified', true,
          'Private research provenance for the L17 suite.', 'secretary@l17.test')
  returning id into v_dir;
  insert into public.clubs (directory_id, slug) values (v_dir, 'l17-club-' || v_tag) returning id into v_club;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_clubadm, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_member, 'BASIC_USER', 'active');

  -- ---------------------------------------------------------------------------------------------
  -- A. WHO MAY READ THE PRIVATE COLUMNS
  -- ---------------------------------------------------------------------------------------------
  v_rc := pg_temp.try_as(null, 'select notes from public.club_directory limit 1');
  perform pg_temp.check(v_rc = '42501', 'S6L17-01 anon cannot read notes (' || v_rc || ')');

  v_rc := pg_temp.try_as(v_other, 'select notes from public.club_directory limit 1');
  perform pg_temp.check(v_rc = '42501',
    'S6L17-02 a signed-in person with no relationship to any club cannot read notes -- THIS IS L17 ('
    || v_rc || ')');

  v_rc := pg_temp.try_as(v_member, 'select notes from public.club_directory limit 1');
  perform pg_temp.check(v_rc = '42501',
    'S6L17-03 nor can an ordinary member of a club, for their own club or any other (' || v_rc || ')');

  v_rc := pg_temp.try_as(v_clubadm, format('select notes from public.club_directory where id = %L', v_dir));
  perform pg_temp.check(v_rc = '42501',
    'S6L17-04 nor a CLUB ADMIN of the club the row describes -- the directory record is the platform''s '
    'inventory, not the club''s own profile (' || v_rc || ')');

  v_rc := pg_temp.try_as(v_other, 'select official_email from public.club_directory limit 1');
  perform pg_temp.check(v_rc = '42501', 'S6L17-05 and official_email is closed the same way (' || v_rc || ')');

  v_rc := pg_temp.try_as(v_other, 'select * from public.club_directory limit 1');
  perform pg_temp.check(v_rc = '42501',
    'S6L17-06 and a wildcard select cannot be used to get round naming the column (' || v_rc || ')');

  -- ---------------------------------------------------------------------------------------------
  -- B. POSITIVE CONTROLS -- nothing legitimate was taken away.
  -- ---------------------------------------------------------------------------------------------
  v_rc := pg_temp.try_as(v_other, 'select id, name, town, rugby_code from public.club_directory limit 1');
  perform pg_temp.check(v_rc = 'OK',
    'S6L17-10 POSITIVE CONTROL: a signed-in person still reads the public directory facts, so the '
    'refusals above are about the private columns and not about the table (' || v_rc || ')');

  v_rc := pg_temp.try_as(v_other, 'select latitude, longitude, geocode_status from public.club_directory limit 1');
  perform pg_temp.check(v_rc = 'OK',
    'S6L17-11 POSITIVE CONTROL: and the geo columns Ovie opponent search, the competitions workspace '
    'and the Partner Clubs map read (' || v_rc || ')');

  v_rc := pg_temp.try_as(null, 'select id, name, town from public.club_directory limit 1');
  perform pg_temp.check(v_rc = 'OK',
    'S6L17-12 POSITIVE CONTROL: the signed-out public directory still works (' || v_rc || ')');

  -- ---------------------------------------------------------------------------------------------
  -- C. THE LEGITIMATE READER
  -- ---------------------------------------------------------------------------------------------
  v_rc := pg_temp.try_as(v_site, format('select * from public.site_club_directory_record(%L)', v_dir));
  perform pg_temp.check(v_rc = 'OK',
    'S6L17-20 a Site Admin holding site.clubs.view reads the whole record through the narrow RPC ('
    || v_rc || ')');

  v_rc := pg_temp.try_as(v_other, format('select * from public.site_club_directory_record(%L)', v_dir));
  perform pg_temp.check(v_rc = 'OK',
    'S6L17-21 and somebody without the capability is not refused by the RPC -- it returns NOTHING, '
    'which is the same answer without telling them the row exists (' || v_rc || ')');

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.site_club_directory_record(v_dir);
  reset role;
  perform pg_temp.check(v_n = 0, 'S6L17-22 -- zero rows, specifically (' || v_n || ')');

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_site, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.site_club_directory_record(v_dir) where notes is not null;
  reset role;
  perform pg_temp.check(v_n = 1,
    'S6L17-23 while the Site Admin gets the row WITH its notes -- the capability is the boundary ('
    || v_n || ')');

  perform pg_temp.check(
    not has_function_privilege('anon', 'public.site_club_directory_record(uuid)', 'EXECUTE'),
    'S6L17-24 and anon cannot call it at all');

  -- ---------------------------------------------------------------------------------------------
  -- D. THE GRANT SHAPE ITSELF, so this cannot regress by a later migration re-granting the table.
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(not has_table_privilege('authenticated', 'public.club_directory', 'SELECT'),
    'S6L17-30 there is no table-level SELECT to override the column grant -- the exact shape L17 was');

  perform pg_temp.check(
    has_column_privilege('authenticated', 'public.club_directory', 'name', 'SELECT')
    and not has_column_privilege('authenticated', 'public.club_directory', 'notes', 'SELECT')
    and not has_column_privilege('authenticated', 'public.club_directory', 'official_email', 'SELECT')
    and not has_column_privilege('authenticated', 'public.club_directory', 'source_url', 'SELECT'),
    'S6L17-31 the column grant is the public facts plus geo, and excludes notes, official_email and '
    'the research provenance');

  perform pg_temp.check(
    (select coalesce(array_to_string(reloptions, ','), '') from pg_class where oid = 'public.admin_club_overview'::regclass)
      not like '%security_invoker=true%'
    and pg_get_viewdef('public.admin_club_overview'::regclass, true) ~ 'site\.clubs\.view',
    'S6L17-32 admin_club_overview is owner-rights AND still carries the capability gate that is now its '
    'only boundary -- one without the other would be either broken or open');

  -- Writes are unaffected: RLS already gates them on site.directory.manage.
  --
  -- ASSERTED ON THE EFFECT, NOT THE SQLSTATE, and the first draft of this suite got it wrong. The
  -- UPDATE policy has a USING clause and no WITH CHECK, so an unauthorised writer matches no rows:
  -- Postgres updates nothing and raises nothing, and the call returns 'OK'. Reading that as "allowed"
  -- reported a Club Admin as able to write notes when they had in fact changed nothing. A write test
  -- has to read the value back.
  v_rc := pg_temp.try_as(v_site, format('update public.club_directory set notes = %L where id = %L', 'rewritten by the L17 suite', v_dir));
  select count(*) into v_n from public.club_directory where id = v_dir and notes = 'rewritten by the L17 suite';
  perform pg_temp.check(v_rc = 'OK' and v_n = 1,
    'S6L17-33 POSITIVE CONTROL: a Site Admin can still WRITE notes, and the value actually changed -- '
    'closing a read did not close the editor (' || v_rc || ', ' || v_n || ' row changed)');

  v_rc := pg_temp.try_as(v_clubadm, format('update public.club_directory set notes = %L where id = %L', 'written by a club admin', v_dir));
  select count(*) into v_n from public.club_directory where id = v_dir and notes = 'written by a club admin';
  perform pg_temp.check(v_n = 0,
    'S6L17-34 and a Club Admin changes NOTHING -- the statement is not refused, it matches no rows, '
    'which is why this reads the value back rather than trusting the status (' || v_rc || ', '
    || v_n || ' row changed)');

  raise notice '--- Step 6 L17 suite complete ---';
end $$;

rollback;
