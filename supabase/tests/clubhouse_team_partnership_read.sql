-- CLUBHOUSE PROGRAMME SECTION 5 -- PARTNERS: get_team_club_partnerships (20270555000000).
--
-- Closes the Section 1/2 defect: club_partnerships_select_scoped RLS only ever returns rows to a
-- caller holding club.partners.manage at CLUB scope, so a legitimate team-context Coach or Team
-- Manager could never truthfully be told "this opposition club is one of our club's partners." This
-- proves the closure: READ works for a real team-scoped viewer, MANAGE never does, and a crafted call
-- against a team the caller has no attachment to is refused exactly the same way an unrelated team's
-- would be.
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

create or replace function pg_temp.act_postgres() returns void language plpgsql as $$
begin perform set_config('role','none',true); perform set_config('request.jwt.claims','',true); end $$;

create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v_state text;
begin execute p_sql; return 'OK';
exception when others then get stacked diagnostics v_state = returned_sqlstate; return v_state; end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
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
  v_a_admin uuid := gen_random_uuid();    -- Club A: CLUB_ADMIN, holds club.partners.manage
  v_a_coach uuid := gen_random_uuid();    -- Club A: team-scoped Coach on team A1 only, no club role beyond BASIC_USER
  v_a_basic uuid := gen_random_uuid();    -- Club A: BASIC_USER, no team_permissions row at all
  v_b_admin uuid := gen_random_uuid();    -- Club B: CLUB_ADMIN, accepts the partnership
  v_c_coach uuid := gen_random_uuid();    -- Club C: team-scoped Coach on team C1, unrelated to A/B entirely
  v_person uuid;
  v_dir_a uuid; v_dir_b uuid; v_dir_c uuid;
  v_club_a uuid; v_club_b uuid; v_club_c uuid;
  v_mem_a_admin uuid; v_mem_a_coach uuid; v_mem_c_coach uuid;
  v_team_a1 uuid; v_team_c1 uuid;
  v_type_u12 uuid;
  v_partnership uuid;
  v_n int;
begin
  foreach v_person in array array[v_a_admin, v_a_coach, v_a_basic, v_b_admin, v_c_coach] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'ctpr-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Team', 'PartnerRead', 'ctpr-' || v_person::text || '@ovalball.test', (current_date - interval '40 years')::date)
    on conflict (id) do nothing;
  end loop;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CTPR A RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ctpr-a-' || v_tag)
  returning id into v_dir_a;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CTPR B RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ctpr-b-' || v_tag)
  returning id into v_dir_b;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CTPR C RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ctpr-c-' || v_tag)
  returning id into v_dir_c;

  insert into public.clubs (directory_id, slug, status) values (v_dir_a, 'ctpr-a-' || v_tag, 'active') returning id into v_club_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b, 'ctpr-b-' || v_tag, 'active') returning id into v_club_b;
  insert into public.clubs (directory_id, slug, status) values (v_dir_c, 'ctpr-c-' || v_tag, 'active') returning id into v_club_c;

  select id into v_type_u12 from public.canonical_team_types_by_code where rugby_code='union' and key='u12' and is_offered limit 1;

  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club_a, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type_u12, true) returning id into v_team_a1;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club_c, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type_u12, true) returning id into v_team_c1;

  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_a, v_a_admin, 'CLUB_ADMIN', 'active') returning id into v_mem_a_admin;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_a, v_a_coach, 'BASIC_USER', 'active') returning id into v_mem_a_coach;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_a, v_a_basic, 'BASIC_USER', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_b, v_b_admin, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_c, v_c_coach, 'BASIC_USER', 'active') returning id into v_mem_c_coach;

  -- Team-scoped Coach bundle, real fixture.request.create at TEAM scope, no club-level role.
  insert into public.team_permissions (membership_id, team_id, permission) values (v_mem_a_coach, v_team_a1, 'coach');
  insert into public.team_permissions (membership_id, team_id, permission) values (v_mem_c_coach, v_team_c1, 'coach');

  -- =====================================================================
  -- SETUP: Club A requests, Club B accepts -- an ordinary, real, ACTIVE partnership.
  -- =====================================================================
  perform pg_temp.act('authenticated', v_a_admin);
  insert into public.club_partnerships (requesting_club_id, partner_club_id, requested_by)
  values (v_club_a, v_club_b, v_a_admin) returning id into v_partnership;
  perform pg_temp.check(v_partnership is not null, 'SETUP authorised Club A admin can request partnership with Club B');

  perform pg_temp.act('authenticated', v_b_admin);
  perform pg_temp.check(pg_temp.try(format('select public.respond_to_club_partnership(%L, true)', v_partnership)) = 'OK',
    'SETUP authorised Club B admin can accept the incoming request');

  -- =====================================================================
  -- READ: Club A's team-scoped Coach (no club.partners.manage) gets the REAL, active state.
  -- =====================================================================
  perform pg_temp.act('authenticated', v_a_coach);
  perform pg_temp.check(not internal.can('club.partners.manage', 'club', v_club_a, null, null),
    'R1 the Coach genuinely holds no club.partners.manage -- this is the defect Section 5 closes, confirmed still true');
  select count(*) into v_n from public.get_team_club_partnerships(v_team_a1) where partner_club_id = v_club_b and status = 'active';
  perform pg_temp.check(v_n = 1, 'R2 the Coach truthfully reads Club B as an ACTIVE partner via get_team_club_partnerships');
  select count(*) into v_n from public.club_partnerships where requesting_club_id = v_club_a or partner_club_id = v_club_a;
  perform pg_temp.check(v_n = 0,
    'R3 the OLD direct-table path stays exactly as silent as before for this same Coach -- RLS empties it rather than erroring, which is the defect get_team_club_partnerships exists to work around');

  -- =====================================================================
  -- REFUSED: no fixture authority at all, even for the caller's own team.
  -- =====================================================================
  perform pg_temp.act('authenticated', v_a_basic);
  perform pg_temp.check(pg_temp.try(format('select * from public.get_team_club_partnerships(%L)', v_team_a1)) = '42501',
    'A1 an ordinary club member with no team_permissions row at all is refused for their own club''s own team');

  -- =====================================================================
  -- CRAFTED CROSS-CLUB CALL: Club C's own coach cannot read Club A's partnerships by naming Club A's team.
  -- Done BEFORE the M2 setup below deliberately mints a pending A<->C request, so "their own team has
  -- zero partnerships" stays a true, unpolluted empty rather than one the test itself later created.
  -- =====================================================================
  perform pg_temp.act('authenticated', v_c_coach);
  perform pg_temp.check(pg_temp.try(format('select * from public.get_team_club_partnerships(%L)', v_team_a1)) = '42501',
    'X1 Club C''s own coach cannot read Club A''s partnership state by calling with Club A''s team id -- they hold no fixture authority AT THAT TEAM, whatever they hold at their own');
  select count(*) into v_n from public.get_team_club_partnerships(v_team_c1);
  perform pg_temp.check(v_n = 0, 'X2 and their own team genuinely has zero partnerships -- a true empty, not a masked refusal');

  -- =====================================================================
  -- READ != MANAGE: the same Coach still cannot accept, decline or revoke anything.
  -- =====================================================================
  perform pg_temp.act('authenticated', v_a_coach);
  perform pg_temp.check(pg_temp.try(format('select public.revoke_club_partnership(%L)', v_partnership)) = '42501',
    'M1 the Coach cannot revoke the partnership they can now truthfully see');
  perform pg_temp.act('authenticated', v_a_admin);
  insert into public.club_partnerships (requesting_club_id, partner_club_id, requested_by)
  values (v_club_a, v_club_c, v_a_admin) returning id into v_partnership;
  perform pg_temp.act('authenticated', v_a_coach);
  perform pg_temp.check(pg_temp.try(format('select public.respond_to_club_partnership(%L, true)', v_partnership)) = '42501',
    'M2 the Coach cannot accept/respond to a pending request either (not the invited side, and no authority even if they were)');

  -- =====================================================================
  -- MINIMAL PAYLOAD: exactly four columns, nothing else.
  -- =====================================================================
  perform pg_temp.check(
    (select array_to_string(proargnames, ',') from pg_proc where pronamespace = 'public'::regnamespace and proname = 'get_team_club_partnerships')
      = 'p_team_id,id,requesting_club_id,partner_club_id,status',
    'P1 the return shape is exactly id, requesting_club_id, partner_club_id, status -- no requester name, email, notes or extra timestamp');

  perform pg_temp.act_postgres();
end $$;

rollback;
