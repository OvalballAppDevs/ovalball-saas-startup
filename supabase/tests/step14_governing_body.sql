-- CONVERGENCE STEP 14 — GOVERNING BODY FOUNDATION.
--
--   A. AUTHORITY IS THE RELATIONSHIP, and nothing else — not a club role, not a
--      Fixture Secretary, not a Safeguarding Officer, not a name.
--   B. THE ROLES DIFFER: admin, competitions, viewer.
--   C. WRONG BODY cannot read or write another body's.
--   D. SITE ADMIN reaches it through explicit site capability, and is not a member.
--   E. SUSPENSION AND REVOCATION WIN.
--   F. NO SAFEGUARDING, no second organisation model, competitions additive.
--
-- Self-seeding and rolled back. No persistent review identity is touched.
\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.act(p_role text, p_sub uuid default null) returns void
language plpgsql as $$
declare v_email text;
begin
  perform set_config('role', 'none', true);
  if p_sub is not null then select email into v_email from auth.users where id = p_sub; end if;
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_sub, 'role', p_role, 'email', v_email))::text, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function pg_temp.act_postgres() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $$
declare v_state text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  return v_state;
end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void
language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_person uuid;
  v_body_admin uuid := gen_random_uuid();
  v_body_comps uuid := gen_random_uuid();
  v_body_viewer uuid := gen_random_uuid();
  v_club_admin uuid := gen_random_uuid();
  v_fixsec uuid := gen_random_uuid();
  v_so uuid := gen_random_uuid();
  v_site uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_body uuid; v_other_body uuid; v_dir uuid; v_club uuid; v_ms uuid; v_comp uuid;
  v_n int; v_text text; v_state text; v_id uuid;
begin
  foreach v_person in array array[v_body_admin, v_body_comps, v_body_viewer, v_club_admin, v_fixsec, v_so, v_site, v_stranger] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      's14-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb,
      '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Step', 'Fourteen', 's14-' || v_person::text || '@ovalball.test', (current_date - interval '41 years')::date)
    on conflict (id) do nothing;
  end loop;
  insert into public.site_admins (user_id, status, admin_role, profile_key) values (v_site, 'active', 'full', 'SITE_FULL');

  -- TWO BODIES, both synthetic: nothing here claims anything about a real union.
  insert into public.constituent_bodies (rugby_code, nation, canonical_name, short_name, body_type, active, source)
  values ('union', 'England', 'S14 Test County RFU ' || v_tag, 'S14 County ' || v_tag, 'GEOGRAPHIC', true, 'local_test')
  returning id into v_body;
  insert into public.constituent_bodies (rugby_code, nation, canonical_name, short_name, body_type, active, source)
  values ('union', 'England', 'S14 Other County RFU ' || v_tag, 'S14 Other ' || v_tag, 'GEOGRAPHIC', true, 'local_test')
  returning id into v_other_body;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key, constituent_body_id)
  values ('S14 RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 's14-' || v_tag, v_body)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 's14-' || v_tag, 'active') returning id into v_club;

  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_club_admin, 'CLUB_ADMIN', 'active') returning id into v_ms;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_fixsec, 'BASIC_USER', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_so, 'BASIC_USER', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_stranger, 'BASIC_USER', 'active');

  insert into public.constituent_body_roles (constituent_body_id, user_id, role_key) values
    (v_body, v_body_admin, 'BODY_ADMIN'),
    (v_body, v_body_comps, 'BODY_COMPETITIONS'),
    (v_body, v_body_viewer, 'BODY_VIEWER');

  -- =====================================================================
  -- A. AUTHORITY IS THE RELATIONSHIP
  -- =====================================================================
  perform pg_temp.act_postgres();
  perform pg_temp.check(internal.body_role(v_body, v_body_admin) = 'BODY_ADMIN', 'A1 an ACTIVE relationship is what names somebody to a body');
  perform pg_temp.check(internal.body_role(v_body, v_stranger) is null, 'A2 and somebody with none is nothing to it');

  perform pg_temp.act('authenticated', v_club_admin);
  select pg_temp.try(format('select * from public.get_governing_body(%L)', v_body)) into v_state;
  perform pg_temp.check(v_state = '42501',
    format('A3 a CLUB ADMIN of an affiliated club does NOT inherit governing body access (%s)', v_state));

  perform pg_temp.act('authenticated', v_fixsec);
  select pg_temp.try(format('select * from public.get_governing_body(%L)', v_body)) into v_state;
  perform pg_temp.check(v_state = '42501', format('A4 nor does a Fixture Secretary (%s)', v_state));

  perform pg_temp.act('authenticated', v_so);
  select pg_temp.try(format('select * from public.get_governing_body(%L)', v_body)) into v_state;
  perform pg_temp.check(v_state = '42501', format('A5 nor a Safeguarding Officer (%s)', v_state));

  perform pg_temp.act('authenticated', v_stranger);
  select pg_temp.try(format('select * from public.get_governing_body(%L)', v_body)) into v_state;
  perform pg_temp.check(v_state = '42501', format('A6 nor an ordinary member of an affiliated club (%s)', v_state));

  -- =====================================================================
  -- B. THE ROLES DIFFER
  -- =====================================================================
  perform pg_temp.act('authenticated', v_body_viewer);
  select count(*) into v_n from public.get_governing_body(v_body);
  perform pg_temp.check(v_n = 1, 'B1 a viewer may see the body');
  select can_manage, can_manage_competitions into v_state, v_text from public.get_governing_body(v_body);
  perform pg_temp.check(v_state = 'false' and v_text = 'false', 'B2 and may manage neither it nor its competitions');

  perform pg_temp.act('authenticated', v_body_comps);
  select can_manage, can_manage_competitions into v_state, v_text from public.get_governing_body(v_body);
  perform pg_temp.check(v_state = 'false' and v_text = 'true', 'B3 a competitions role may run competitions but not the body');

  perform pg_temp.act('authenticated', v_body_admin);
  select can_manage, can_manage_competitions into v_state, v_text from public.get_governing_body(v_body);
  perform pg_temp.check(v_state = 'true' and v_text = 'true', 'B4 and an admin may do both');

  select affiliated_club_count into v_n from public.get_governing_body(v_body);
  perform pg_temp.check(v_n = 1, format('B5 the body knows which clubs are affiliated to it (%s)', v_n));
  select count(*) into v_n from public.governing_body_clubs(v_body);
  perform pg_temp.check(v_n = 1, 'B6 and can list them');

  -- =====================================================================
  -- C. WRONG BODY
  -- =====================================================================
  select pg_temp.try(format('select * from public.get_governing_body(%L)', v_other_body)) into v_state;
  perform pg_temp.check(v_state = '42501', format('C1 an officer of one body cannot read another (%s)', v_state));
  select pg_temp.try(format('select public.set_governing_body_role(%L, %L, %L)', v_other_body, v_stranger, 'BODY_VIEWER')) into v_state;
  perform pg_temp.check(v_state = '42501', format('C2 nor grant a role in it (%s)', v_state));

  -- And may grant within their own.
  select public.set_governing_body_role(v_body, v_stranger, 'BODY_VIEWER', 'helping with the county handbook') into v_id;
  perform pg_temp.check(v_id is not null, 'C3 but may grant a role in their own body');

  -- =====================================================================
  -- D. SITE ADMIN, EXPLICITLY
  -- =====================================================================
  perform pg_temp.act('authenticated', v_site);
  select count(*) into v_n from public.get_governing_body(v_body);
  perform pg_temp.check(v_n = 1, 'D1 a Site Admin reaches it through explicit site capability');
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.constituent_body_roles where user_id = v_site;
  perform pg_temp.check(v_n = 0, 'D2 and does not become a member of the body to do so');

  -- =====================================================================
  -- E. SUSPENSION AND REVOCATION WIN
  -- =====================================================================
  update public.constituent_body_roles set state = 'SUSPENDED' where constituent_body_id = v_body and user_id = v_body_admin;
  perform pg_temp.act('authenticated', v_body_admin);
  select pg_temp.try(format('select * from public.get_governing_body(%L)', v_body)) into v_state;
  perform pg_temp.check(v_state = '42501', format('E1 a suspended relationship confers nothing (%s)', v_state));

  perform pg_temp.act_postgres();
  update public.constituent_body_roles set state = 'ACTIVE' where constituent_body_id = v_body and user_id = v_body_admin;
  update public.constituent_body_roles set state = 'REVOKED', revoked_at = now()
   where constituent_body_id = v_body and user_id = v_body_viewer;
  perform pg_temp.act('authenticated', v_body_viewer);
  select pg_temp.try(format('select * from public.get_governing_body(%L)', v_body)) into v_state;
  perform pg_temp.check(v_state = '42501', format('E2 and a revoked one confers nothing either (%s)', v_state));

  -- =====================================================================
  -- F. THE BOUNDARIES
  -- =====================================================================
  perform pg_temp.act_postgres();
  select count(*) into v_n from information_schema.tables
   where table_schema = 'public' and table_name ~ 'governing_bod|organisation|organization' and table_name <> 'constituent_bodies';
  perform pg_temp.check(v_n = 0, 'F1 there is still exactly one organisation model');

  perform pg_temp.check(
    (select count(*) from information_schema.columns where table_schema = 'public'
      and table_name = 'competitions' and column_name in ('organiser_club_id', 'organiser_constituent_body_id')) = 2,
    'F2 a body is one more kind of competition organiser, not a replacement');

  insert into public.competitions (name, slug, normalized_key, rugby_code, organiser_constituent_body_id)
  values ('S14 County Cup ' || v_tag, 's14-cup-' || v_tag, 's14-cup-' || v_tag, 'union', v_body) returning id into v_comp;
  perform pg_temp.act('authenticated', v_body_admin);
  select competition_count into v_n from public.get_governing_body(v_body);
  perform pg_temp.check(v_n = 1, format('F3 and a body knows the competitions it organises (%s)', v_n));

  perform pg_temp.act_postgres();
  -- CONVERGENCE STEP 16 narrowed the FROM, not the guarantee. public.redeem_invitation is the ONE
  -- canonical redemption function for every invitation kind, so once it learned to redeem a governing
  -- body invitation it necessarily contains both 'constituent_body_roles' and the words SAFEGUARDING
  -- and GUARDIAN -- as the names of other kinds, in other branches. Excluding it wholesale would have
  -- weakened the check, so its governing branch is asserted on its own below, which is stronger than
  -- the original: it reads the branch rather than the file.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','internal') and p.prosrc ~ 'constituent_body_roles'
     and p.proname <> 'redeem_invitation'
     and p.prosrc ~* 'safeguard|date_of_birth|medical|guardian';
  perform pg_temp.check(v_n = 0, 'F4 no governing body path reaches safeguarding or family data');

  select substring(p.prosrc from 'GOVERNING_BODY_OFFICER(.*?)elsif') into v_text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'redeem_invitation';
  perform pg_temp.check(v_text is not null and v_text !~* 'safeguard|date_of_birth|medical|guardian',
    'F5 and redeeming a governing body invitation touches only the body relationship');

  perform pg_temp.check(
    (select pg_get_function_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'capability_decision') !~ 'p_body',
    'F5 and the capability engine was not given a sixth scope by the back door');

  perform pg_temp.act('anon');
  select pg_temp.try(format('select * from public.get_governing_body(%L)', v_body)) into v_state;
  perform pg_temp.check(v_state <> 'OK', format('F6 anonymous callers reach none of it (%s)', v_state));

  perform pg_temp.act_postgres();
end $$;

rollback;
