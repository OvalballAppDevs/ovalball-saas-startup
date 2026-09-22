-- TEAM FIXTURE OPERATIONS -- DELEGATED AUTHORITY, AND ITS EDGES.
--
-- The owner's model: a Club Admin decides who may administer fixtures, a team staff member gets no
-- fixture authority from their title, and somebody granted it may act for THEIR OWN TEAM only.
--
--   A. NO CAPABILITY: sees the team's fixtures, changes nothing.
--   B. CREATE for one team is not create for another.
--   C. EDIT for one team is not edit for another.
--   D. CANCEL for one team is not cancel for another.
--   E. REQUEST is bounded by team AND by age eligibility.
--   F. Club-wide authority still works in a club context.
--   G. Planner, import and bulk remain separate and club-only.
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

create or replace function pg_temp.msg(p_sql text) returns text language plpgsql as $$
declare v text;
begin execute p_sql; return 'OK';
exception when others then get stacked diagnostics v = message_text; return v; end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.msg(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_person uuid;
  v_none uuid := gen_random_uuid();      -- team staff with NO fixture capability
  v_staff uuid := gen_random_uuid();     -- granted fixture authority for team A only
  v_clubadmin uuid := gen_random_uuid();
  v_club uuid; v_dir uuid;
  v_a uuid; v_b uuid; v_senior uuid;     -- team A (U12), team B (U14), a senior side
  v_type_u12 uuid; v_type_u14 uuid; v_type_senior uuid;
  v_mem_none uuid; v_mem_staff uuid; v_mem_admin uuid;
  v_fixture_a uuid; v_fixture_b uuid;
  v_group uuid; v_opp_u12 uuid;
  v_txt text; v_n int;
begin
  foreach v_person in array array[v_none, v_staff, v_clubadmin] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'tfa-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Team', 'Fixture', 'tfa-' || v_person::text || '@ovalball.test', (current_date - interval '40 years')::date)
    on conflict (id) do nothing;
  end loop;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TFA RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'tfa-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'tfa-' || v_tag, 'active') returning id into v_club;

  select id into v_type_u12 from public.canonical_team_types_by_code where rugby_code='union' and key='u12' and is_offered limit 1;
  select id into v_type_u14 from public.canonical_team_types_by_code where rugby_code='union' and key='u14' and is_offered limit 1;
  select id into v_type_senior from public.canonical_team_types_by_code where rugby_code='union' and key='mens_1st' and is_offered limit 1;

  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type_u12, true) returning id into v_a;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club, 'Under 14 Boys', 'youth', 'U14', 'union', 'boys', v_type_u14, true) returning id into v_b;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club, 'Men''s 1st Team', 'senior', null, 'union', 'mens', v_type_senior, true) returning id into v_senior;

  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_none, 'BASIC_USER', 'active') returning id into v_mem_none;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_staff, 'BASIC_USER', 'active') returning id into v_mem_staff;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_clubadmin, 'CLUB_ADMIN', 'active') returning id into v_mem_admin;

  -- Both team people are attached to TEAM A. The difference between them is capability, never title.
  insert into public.team_permissions (membership_id, team_id, permission) values (v_mem_none, v_a, 'coach');
  insert into public.team_permissions (membership_id, team_id, permission) values (v_mem_staff, v_a, 'manager');

  -- THE GRANT. Team-scoped, for team A only, through the canonical override architecture -- not a
  -- boolean on the membership and not a role rename.
  insert into public.capability_overrides (user_id, capability_key, scope_type, team_id, club_id, effect, reason, granted_by, granted_level)
  values
    (v_staff, 'fixture.fixture.create', 'team', v_a, v_club, 'grant', 'team fixture authority test', v_clubadmin, 'CLUB'),
    (v_staff, 'fixture.fixture.edit',   'team', v_a, v_club, 'grant', 'team fixture authority test', v_clubadmin, 'CLUB'),
    (v_staff, 'fixture.fixture.cancel', 'team', v_a, v_club, 'grant', 'team fixture authority test', v_clubadmin, 'CLUB'),
    (v_staff, 'fixture.request.create', 'team', v_a, v_club, 'grant', 'team fixture authority test', v_clubadmin, 'CLUB');

  -- =====================================================================
  -- A. NO CAPABILITY: reads the team, changes nothing.
  -- =====================================================================
  -- WHAT THE COACH BUNDLE ACTUALLY GRANTS, recorded rather than assumed.
  --
  -- The owner's model says a title confers no fixture authority. The shipped bundles say otherwise: CO
  -- (Coach) already carries fixture.fixture.create/edit/cancel/view and request.create at TEAM scope,
  -- and TM (Team Manager) adds archive and request.respond. That is authority by title, and stripping
  -- it would remove from every coach in the product something they may be using today -- which is an
  -- owner decision, not a tidy-up. It is recorded in TEAM_OPERATIONS_CONVERGENCE.md as D5.
  --
  -- So this asserts the product as it IS, and asserts the thing that makes it safe either way: a Club
  -- Admin can take it away for one person on one team, which is what the handoff asks for.
  perform pg_temp.act('authenticated', v_none);
  perform pg_temp.check(internal.can('fixture.fixture.view', 'team', v_club, v_a, null),
    'A1 a coach sees their team''s fixtures');
  perform pg_temp.check(internal.can('fixture.fixture.create', 'team', v_club, v_a, null),
    'A2 and the shipped Coach bundle DOES grant create at team scope -- recorded, not assumed');
  perform pg_temp.check(not internal.can('fixture.fixture.create', 'team', v_club, v_b, null),
    'A3 but never for a team they are not attached to');
  perform pg_temp.check(not internal.can('fixture.fixture.create', 'club', v_club, null, null),
    'A4 and never club-wide');
  perform pg_temp.check(not internal.can('fixture.request.respond', 'team', v_club, v_a, null),
    'A5 answering another club''s request is a Team Manager job, not a coach''s');

  -- THE CLUB ADMIN CAN TAKE IT AWAY. A scoped deny for one person on one team.
  perform pg_temp.act_postgres();
  insert into public.capability_overrides (user_id, capability_key, scope_type, team_id, club_id, effect, reason, granted_by, granted_level)
  values (v_none, 'fixture.fixture.create', 'team', v_a, v_club, 'deny', 'club admin withdrew fixture creation', v_clubadmin, 'CLUB');

  perform pg_temp.act('authenticated', v_none);
  perform pg_temp.check(not internal.can('fixture.fixture.create', 'team', v_club, v_a, null),
    'A6 a scoped DENY from the Club Admin overrides the role bundle');
  perform pg_temp.check(internal.can('fixture.fixture.view', 'team', v_club, v_a, null),
    'A7 and takes nothing else with it -- they still see the fixtures');

  -- AND THE SHAPE THE PERMISSIONS SCREEN ACTUALLY WRITES. app/(app)/club/permissions/actions.ts sends
  -- set_capability_override with p_scope_type 'club' and no team -- it has no per-team control. A club
  -- deny must therefore reach a team-scope question or the screen would be answering a different
  -- question from the one the product asks, and the Club Admin would believe they had withdrawn
  -- something they had not. It reaches it because these capabilities inherit to team; the cost is that
  -- it is all-or-nothing across the club, which is recorded as an owner decision rather than hidden.
  perform pg_temp.act_postgres();
  delete from public.capability_overrides where user_id = v_none and capability_key = 'fixture.fixture.create';
  insert into public.capability_overrides (user_id, capability_key, scope_type, team_id, club_id, effect, reason, granted_by, granted_level)
  values (v_none, 'fixture.fixture.create', 'club', null, v_club, 'deny', 'set from the club permissions screen', v_clubadmin, 'CLUB');

  perform pg_temp.act('authenticated', v_none);
  perform pg_temp.check(not internal.can('fixture.fixture.create', 'team', v_club, v_a, null),
    'A8 a club-scope deny -- the only kind the permissions screen can write -- reaches the team');
  perform pg_temp.check(not internal.can('fixture.fixture.create', 'team', v_club, v_b, null),
    'A9 and reaches every team they coach, which is what club-wide means');
  perform pg_temp.check(internal.can('fixture.fixture.view', 'team', v_club, v_a, null),
    'A10 while still taking nothing else with it');

  perform pg_temp.act_postgres();
  delete from public.capability_overrides where user_id = v_none and capability_key = 'fixture.fixture.create';
  insert into public.capability_overrides (user_id, capability_key, scope_type, team_id, club_id, effect, reason, granted_by, granted_level)
  values (v_none, 'fixture.fixture.create', 'team', v_a, v_club, 'deny', 'club admin withdrew fixture creation', v_clubadmin, 'CLUB');

  -- =====================================================================
  -- B-D. THE GRANT IS FOR ONE TEAM.
  -- =====================================================================
  perform pg_temp.act('authenticated', v_staff);
  perform pg_temp.check(internal.can('fixture.fixture.create', 'team', v_club, v_a, null),
    'B1 the granted person may create for THEIR team');
  perform pg_temp.check(not internal.can('fixture.fixture.create', 'team', v_club, v_b, null),
    'B2 and not for the club''s other team');
  perform pg_temp.check(internal.can('fixture.fixture.edit', 'team', v_club, v_a, null),
    'C1 may edit their team''s fixtures');
  perform pg_temp.check(not internal.can('fixture.fixture.edit', 'team', v_club, v_b, null),
    'C2 and not another team''s');
  perform pg_temp.check(internal.can('fixture.fixture.cancel', 'team', v_club, v_a, null),
    'D1 may cancel their team''s fixtures');
  perform pg_temp.check(not internal.can('fixture.fixture.cancel', 'team', v_club, v_b, null),
    'D2 and not another team''s');

  -- AND IT IS NOT CLUB AUTHORITY. This is the whole point of a team-scoped grant.
  perform pg_temp.check(not internal.can('fixture.fixture.create', 'club', v_club, null, null),
    'B3 a team grant is not club-wide fixture authority');
  perform pg_temp.check(not internal.can('fixture.fixture.delete', 'club', v_club, null, null),
    'D3 nor the club-only delete');

  -- =====================================================================
  -- E. REQUESTS: bounded by team, and by age eligibility.
  -- =====================================================================
  perform pg_temp.check(internal.can('fixture.request.create', 'team', v_club, v_a, null),
    'E1 may request a fixture for their team');
  perform pg_temp.check(not internal.can('fixture.request.create', 'team', v_club, v_b, null),
    'E2 and not on behalf of another team');

  perform pg_temp.act_postgres();
  -- An opponent of the right age at a different club, so the eligibility rule is the only variable.
  -- The opponent is an identical age grade at ANOTHER club, so age eligibility is the only variable
  -- and nothing collides with this club's own team identity uniqueness.
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TFA Opponent RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'tfa-opp-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'tfa-opp-' || v_tag, 'active') returning id into v_opp_u12;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_opp_u12, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type_u12, true) returning id into v_opp_u12;

  insert into public.fixture_request_groups (requesting_club_id, created_by, raw_opponent_text, proposed_date)
  values (v_club, v_staff, 'TFA probe', (current_date + 30)) returning id into v_group;

  v_txt := pg_temp.msg(format(
    'insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, status, venue_preference, created_by)
     values (%L,%L,%L,''sent'',''home'',%L)', v_group, v_a, v_opp_u12, v_staff));
  perform pg_temp.check(v_txt = 'OK', format('E3 a request against a same-age opponent is accepted (%s)', v_txt));

  v_txt := pg_temp.msg(format(
    'insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, status, venue_preference, created_by)
     values (%L,%L,%L,''sent'',''home'',%L)', v_group, v_a, v_b, v_staff));
  perform pg_temp.check(v_txt like '%age-eligible%',
    format('E4 against a U14 side it is refused BY THE AGE RULE, not by a coincidence (%s)', v_txt));

  v_txt := pg_temp.msg(format(
    'insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, status, venue_preference, created_by)
     values (%L,%L,%L,''sent'',''home'',%L)', v_group, v_a, v_senior, v_staff));
  perform pg_temp.check(v_txt like '%age-eligible%', format('E5 and against a senior side (%s)', v_txt));

  -- A request whose opponent is not yet known is legitimate and must survive: it is resolved later,
  -- and accept_fixture_request applies the same rule then.
  v_txt := pg_temp.msg(format(
    'insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, status, venue_preference, created_by)
     values (%L,%L,null,''sent'',''home'',%L)', v_group, v_a, v_staff));
  perform pg_temp.check(v_txt = 'OK', format('E6 a request with no target team yet is still allowed (%s)', v_txt));

  -- =====================================================================
  -- F. CLUB-WIDE AUTHORITY IS UNCHANGED.
  -- =====================================================================
  perform pg_temp.act('authenticated', v_clubadmin);
  perform pg_temp.check(internal.can('fixture.fixture.create', 'club', v_club, null, null),
    'F1 a Club Admin still holds club-wide fixture authority');
  perform pg_temp.check(internal.can('fixture.fixture.create', 'team', v_club, v_b, null),
    'F2 which reaches every team at their club');

  -- =====================================================================
  -- G. THE BULK TOOLS ARE SEPARATE, AND STILL CLUB-ONLY.
  -- =====================================================================
  perform pg_temp.act('authenticated', v_staff);
  perform pg_temp.check(not internal.can('fixture.planner.use', 'club', v_club, null, null),
    'G1 team fixture authority does not bring the Planner');
  perform pg_temp.check(not internal.can('fixture.import.run', 'club', v_club, null, null),
    'G2 nor bulk import');
  perform pg_temp.check(not internal.can('fixture.fixture.bulk_edit', 'club', v_club, null, null),
    'G3 nor bulk edit');

  perform pg_temp.act_postgres();
  select count(*) into v_n from public.capabilities
   where key in ('fixture.planner.use', 'fixture.import.run', 'fixture.fixture.bulk_edit', 'fixture.fixture.delete')
     and 'team' = any(valid_scopes);
  perform pg_temp.check(v_n = 0,
    format('G4 and none of them is even grantable at team scope (%s with team scope)', v_n));
end $$;

rollback;
