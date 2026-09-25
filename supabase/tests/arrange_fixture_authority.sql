-- CLUBHOUSE PROGRAMME SECTION 8 -- ARRANGE A FIXTURE. Authority + duplicate-refusal proof.
--
-- Two things closed by 20270559000000, proved here rather than assumed:
--   AF-G  fixture_request_groups_insert_scoped now asks fixture.request.create (club-wide or any one
--         active team), the SAME capability the per-team fixture_requests_insert_scoped policy already
--         requires -- not the legacy fixture.fixture.edit-based can_manage_club_fixtures_or_any_team.
--   AF-I  fixture.request.create's independence: fixture.fixture.create, fixture.fixture.edit,
--         fixture.result.record and venue.pitch_allocation.manage held ALONE never substitute for it, at
--         either the group or the row.
--   AF-D  a second simultaneously-pending (sent/counter_proposed) request in the same direction between
--         the same two teams is refused; a resolved (declined) first request never blocks a fresh one.
--
-- Self-contained/transactional.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/arrange_fixture_authority.sql

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text, p_dob date default null) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'af-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Af', p_label, 'af-' || v::text || '@ovalball.test', p_dob)
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('AF ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'af-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'af-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_age text default 'U12') returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, 'Under ' || substr(p_age, 2) || ' Boys', 'af-' || lower(p_age) || '-' || v_tag, 'youth', p_age, 'boys', 'union', true) returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;

-- A team ROLE, not merely a membership: rule 5's override matching (internal.capability_decision)
-- refuses a TEAM-scope grant to someone with no active role_assignments row for that team
-- (TEAM_ROLE_LAPSED) -- team_permissions is the legacy write path that still syncs into it.
create or replace function pg_temp.team_role(p_membership uuid, p_team uuid, p_permission text default 'coach') returns void language plpgsql as $$
begin
  insert into public.team_permissions (membership_id, team_id, permission) values (p_membership, p_team, p_permission);
end $$;

create or replace function pg_temp.override(p_user uuid, p_key text, p_scope text, p_club uuid, p_team uuid, p_by uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.capability_overrides (user_id, capability_key, scope_type, club_id, team_id, effect, status, granted_by, granted_level, reason)
  values (p_user, p_key, p_scope, p_club, p_team, 'grant', 'active', p_by, 'CLUB', 'arrange fixture authority test')
  returning id into v;
  return v;
end $$;

create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v_state text;
begin
  perform set_config('request.jwt.claims', case when p_subject is null then jsonb_build_object('role', 'anon') else jsonb_build_object('sub', p_subject, 'role', 'authenticated') end::text, true);
  perform set_config('role', case when p_subject is null then 'anon' else 'authenticated' end, true);
  begin
    execute p_sql;
    v_state := 'OK';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v_state;
end $$;

do $$
declare
  v_adult date := (current_date - interval '40 years')::date;
  v_club_a uuid; v_club_b uuid;
  v_a_u12 uuid; v_b_u12 uuid;
  v_ca uuid; v_mb uuid;
  v_co uuid; v_mem_co uuid;
  v_edit_only uuid; v_mem_edit uuid;
  v_create_only uuid; v_mem_create uuid;
  v_result_only uuid; v_mem_result uuid;
  v_pitch_only uuid; v_mem_pitch uuid;
  v_group1 uuid; v_group2 uuid; v_group3 uuid;
  v_req1 uuid;
  v_state text;
begin
  v_club_a := pg_temp.club('Arrange Home');
  v_club_b := pg_temp.club('Arrange Away');
  v_a_u12 := pg_temp.team(v_club_a, 'U12');
  v_b_u12 := pg_temp.team(v_club_b, 'U12');

  v_ca := pg_temp.person('CA', v_adult); perform pg_temp.member(v_club_a, v_ca, 'CLUB_ADMIN');
  v_mb := pg_temp.person('MB', v_adult); perform pg_temp.member(v_club_a, v_mb, 'BASIC_USER');

  -- Every TEAM-scope override below needs a genuine team role, not only a club membership --
  -- internal.capability_decision's rule 5 ignores a team-scope grant to someone with no active
  -- role_assignments row for that team (TEAM_ROLE_LAPSED), found running this suite for the first time.
  v_co := pg_temp.person('CO', v_adult); v_mem_co := pg_temp.member(v_club_a, v_co, 'BASIC_USER');
  perform pg_temp.team_role(v_mem_co, v_a_u12, 'coach');
  perform pg_temp.override(v_co, 'fixture.request.create', 'team', v_club_a, v_a_u12, v_ca);

  -- CLUB scope deliberately, not team: a real 'coach' team_permissions role (needed to keep a
  -- TEAM-scope override matched at all, see v_co above) itself grants fixture.request.create by
  -- DEFAULT ROLE BUNDLE (J.6 line 466) -- found running this suite, and it would silently defeat the
  -- very independence these three personas exist to prove. Club scope carries no such team-role
  -- prerequisite and isolates exactly the one capability each persona holds.
  v_edit_only := pg_temp.person('EditOnly', v_adult); v_mem_edit := pg_temp.member(v_club_a, v_edit_only, 'BASIC_USER');
  perform pg_temp.override(v_edit_only, 'fixture.fixture.edit', 'club', v_club_a, null, v_ca);

  v_create_only := pg_temp.person('CreateOnly', v_adult); v_mem_create := pg_temp.member(v_club_a, v_create_only, 'BASIC_USER');
  perform pg_temp.override(v_create_only, 'fixture.fixture.create', 'club', v_club_a, null, v_ca);

  v_result_only := pg_temp.person('ResultOnly', v_adult); v_mem_result := pg_temp.member(v_club_a, v_result_only, 'BASIC_USER');
  perform pg_temp.override(v_result_only, 'fixture.result.record', 'club', v_club_a, null, v_ca);

  v_pitch_only := pg_temp.person('PitchOnly', v_adult); v_mem_pitch := pg_temp.member(v_club_a, v_pitch_only, 'BASIC_USER');
  perform pg_temp.override(v_pitch_only, 'venue.pitch_allocation.manage', 'club', v_club_a, null, v_ca);

  -- =====================================================================================================
  -- AF-G. THE GROUP POLICY ITSELF, closed to the legacy fixture.fixture.edit reading.
  -- =====================================================================================================
  perform pg_temp.check(
    pg_temp.try_as(v_co, format($q$insert into public.fixture_request_groups (requesting_club_id, opponent_club_id, raw_opponent_text, proposed_date, created_by)
      values (%L, %L, 'AF Away RUFC', current_date + 20, auth.uid())$q$, v_club_a, v_club_b)) = 'OK',
    'AF-G1 team-scope fixture.request.create alone is enough to raise the GROUP');
  perform pg_temp.check(
    pg_temp.try_as(v_ca, format($q$insert into public.fixture_request_groups (requesting_club_id, opponent_club_id, raw_opponent_text, proposed_date, created_by)
      values (%L, %L, 'AF Away RUFC', current_date + 21, auth.uid())$q$, v_club_a, v_club_b)) = 'OK',
    'AF-G2 club-wide authority (Club Admin) is also enough for the GROUP');
  perform pg_temp.check(
    pg_temp.try_as(v_mb, format($q$insert into public.fixture_request_groups (requesting_club_id, opponent_club_id, raw_opponent_text, proposed_date, created_by)
      values (%L, %L, 'AF Away RUFC', current_date + 22, auth.uid())$q$, v_club_a, v_club_b)) <> 'OK',
    'AF-G3 an ordinary club Member may not raise the GROUP');

  -- =====================================================================================================
  -- AF-I. INDEPENDENCE: none of these, held alone, substitutes for fixture.request.create -- at either
  -- the GROUP or the ROW. This is the exact gap 20270559000000 closed for the group; the row policy
  -- already asked the right capability, proved here for completeness at both levels together.
  -- =====================================================================================================
  perform pg_temp.check(
    pg_temp.try_as(v_edit_only, format($q$insert into public.fixture_request_groups (requesting_club_id, opponent_club_id, raw_opponent_text, proposed_date, created_by)
      values (%L, %L, 'AF Away RUFC', current_date + 23, auth.uid())$q$, v_club_a, v_club_b)) <> 'OK',
    'AF-I1 fixture.fixture.edit ALONE does not imply request.create (GROUP)');
  perform pg_temp.check(
    pg_temp.try_as(v_create_only, format($q$insert into public.fixture_request_groups (requesting_club_id, opponent_club_id, raw_opponent_text, proposed_date, created_by)
      values (%L, %L, 'AF Away RUFC', current_date + 24, auth.uid())$q$, v_club_a, v_club_b)) <> 'OK',
    'AF-I2 fixture.fixture.create ALONE does not imply request.create (GROUP)');
  perform pg_temp.check(
    pg_temp.try_as(v_result_only, format($q$insert into public.fixture_request_groups (requesting_club_id, opponent_club_id, raw_opponent_text, proposed_date, created_by)
      values (%L, %L, 'AF Away RUFC', current_date + 25, auth.uid())$q$, v_club_a, v_club_b)) <> 'OK',
    'AF-I3 fixture.result.record ALONE does not imply request.create (GROUP)');
  perform pg_temp.check(
    pg_temp.try_as(v_pitch_only, format($q$insert into public.fixture_request_groups (requesting_club_id, opponent_club_id, raw_opponent_text, proposed_date, created_by)
      values (%L, %L, 'AF Away RUFC', current_date + 26, auth.uid())$q$, v_club_a, v_club_b)) <> 'OK',
    'AF-I4 venue.pitch_allocation.manage ALONE does not imply request.create (GROUP)');

  -- The ROW check needs a group that already exists; v_group1 was raised by v_co above (AF-G1).
  select id into v_group1 from public.fixture_request_groups where requesting_club_id = v_club_a and proposed_date = current_date + 20;

  perform pg_temp.check(
    pg_temp.try_as(v_edit_only, format($q$insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, created_by)
      values (%L, %L, %L, 'home', auth.uid())$q$, v_group1, v_a_u12, v_b_u12)) <> 'OK',
    'AF-I5 fixture.fixture.edit ALONE does not imply request.create (ROW)');
  perform pg_temp.check(
    pg_temp.try_as(v_create_only, format($q$insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, created_by)
      values (%L, %L, %L, 'home', auth.uid())$q$, v_group1, v_a_u12, v_b_u12)) <> 'OK',
    'AF-I6 fixture.fixture.create ALONE does not imply request.create (ROW)');
  perform pg_temp.check(
    pg_temp.try_as(v_result_only, format($q$insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, created_by)
      values (%L, %L, %L, 'home', auth.uid())$q$, v_group1, v_a_u12, v_b_u12)) <> 'OK',
    'AF-I7 fixture.result.record ALONE does not imply request.create (ROW)');
  perform pg_temp.check(
    pg_temp.try_as(v_pitch_only, format($q$insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, created_by)
      values (%L, %L, %L, 'home', auth.uid())$q$, v_group1, v_a_u12, v_b_u12)) <> 'OK',
    'AF-I8 venue.pitch_allocation.manage ALONE does not imply request.create (ROW)');

  -- =====================================================================================================
  -- AF-D. DUPLICATE-PENDING REFUSAL. v_co genuinely raises the first request (A_u12 -> B_u12); a second
  -- one in the same direction, from a fresh group, must be refused server-side -- never left to a
  -- disabled button. Resolving the first (declined) must free the pair for a fresh request.
  -- =====================================================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_co, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, created_by)
  values (v_group1, v_a_u12, v_b_u12, 'home', v_co) returning id into v_req1;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(v_req1 is not null, 'AF-D0 setup: the first request (A_u12 -> B_u12) was raised');

  v_state := pg_temp.try_as(v_co, format($q$insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, created_by)
      values (%L, %L, %L, 'away', auth.uid())$q$, v_group1, v_a_u12, v_b_u12));
  perform pg_temp.check(v_state = '23505',
    'AF-D1 a second simultaneously-pending request, same pair, same direction, is refused (23505)');

  -- A DIFFERENT pair (still A_u12, but a fresh unrelated club C's team) is genuinely unaffected --
  -- the refusal is about the PAIR, not about v_co or v_a_u12 having any pending request at all.
  declare
    v_club_c uuid := pg_temp.club('Arrange Third');
    v_c_u12 uuid;
    v_state2 text;
  begin
    v_c_u12 := pg_temp.team(v_club_c, 'U12');
    insert into public.fixture_request_groups (requesting_club_id, opponent_club_id, raw_opponent_text, proposed_date, created_by)
    values (v_club_a, v_club_c, 'AF Third RUFC', current_date + 27, v_co) returning id into v_group2;
    v_state2 := pg_temp.try_as(v_co, format($q$insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, created_by)
        values (%L, %L, %L, 'home', auth.uid())$q$, v_group2, v_a_u12, v_c_u12));
    perform pg_temp.check(v_state2 = 'OK', 'AF-D2 a genuinely different opponent pair is not blocked by the unrelated pending request');
  end;

  -- Resolve the first request (a plain status update, exactly the product's own decline path -- never
  -- routed back through this INSERT-only trigger) and confirm the pair is free again.
  update public.fixture_requests set status = 'declined', decided_at = now() where id = v_req1;
  insert into public.fixture_request_groups (requesting_club_id, opponent_club_id, raw_opponent_text, proposed_date, created_by)
  -- SAME date as v_group1 (current_date + 20) deliberately -- the refusal is date-scoped
  -- (fixture_management_authority's own FA-H5/FA-H7c legitimately reuse a pair on a DIFFERENT date), so
  -- this proves resolution frees the exact pair-and-date the trigger was refusing, not merely a new one.
  values (v_club_a, v_club_b, 'AF Away RUFC', current_date + 20, v_co) returning id into v_group3;
  perform pg_temp.check(
    pg_temp.try_as(v_co, format($q$insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, created_by)
      values (%L, %L, %L, 'home', auth.uid())$q$, v_group3, v_a_u12, v_b_u12)) = 'OK',
    'AF-D3 once the first request is resolved (declined), a fresh request for the same pair is allowed again');

  raise notice 'Arrange fixture authority complete.';
end $$;

rollback;
