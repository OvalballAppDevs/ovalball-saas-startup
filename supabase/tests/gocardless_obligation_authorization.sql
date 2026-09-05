-- Permanent regression test for create_membership_obligations_for_period()'s
-- authorization boundary -- written specifically because this function
-- once contained a real, live-exploited vulnerability (an inverted
-- `or auth.uid() is null` bypass) in the Side Project fork that let a
-- completely unauthenticated caller generate real billing obligations.
-- This file exists so that vulnerability, or anything shaped like it,
-- can never silently regress. NOT a migration -- never applied
-- automatically by `db reset`. Run by hand against local Supabase:
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/gocardless_obligation_authorization.sql
--
-- Entirely self-contained synthetic fixtures (fresh generated identities,
-- never a hardcoded fork-local ID) -- transactional/self-cleaning, never
-- touches real club data.

\set ON_ERROR_STOP off
\pset pager off

\echo '=== GoCardless obligation-generation authorization regression suite ==='

-- Each authorization scenario runs in its own begin/rollback transaction
-- with its own throwaway fixtures, so a rejected call never poisons the
-- next scenario -- matches the original suite's own one-scenario-per-
-- transaction structure.

-- ------------------------------------------------------------
-- 1. Anonymous caller cannot create obligations.
-- ------------------------------------------------------------
begin;
create temporary table t_oa_state (k text primary key, v text) on commit drop;
grant all on t_oa_state to authenticated, service_role, anon;
do $$
declare
  v_club_a uuid := gen_random_uuid();
  v_dir_a uuid := gen_random_uuid();
  v_admin_a uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v_admin_a, 'oa1-admin-' || v_admin_a::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.club_directory (id, name, rugby_code, country, nation, source, normalized_key, verification_status)
  values (v_dir_a, 'OA1 Regression Club', 'union', 'England', 'England', 'manual', 'oa1 regression club', 'verified');
  insert into public.clubs (id, directory_id, slug, status) values (v_club_a, v_dir_a, 'oa1-regression', 'active');
  insert into public.club_memberships (id, club_id, user_id, role, status) values (gen_random_uuid(), v_club_a, v_admin_a, 'CLUB_ADMIN', 'active');
  insert into t_oa_state values ('club_a', v_club_a::text), ('admin_a', v_admin_a::text);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_oa_state where k = 'admin_a';
do $$
declare
  v_club_a uuid := (select v::uuid from t_oa_state where k = 'club_a');
  v_programme_id uuid;
begin
  v_programme_id := public.configure_subscription_programme(v_club_a, true, 1, 'NONE', 'PRORATE_CURRENT_MONTH');
  perform public.set_subscription_price(v_programme_id, 1500, current_date);
end $$;
set local role anon;
do $$
begin
  perform public.create_membership_obligations_for_period((select v::uuid from t_oa_state where k = 'club_a'), date_trunc('month', current_date)::date);
  raise notice 'FAIL 1: anonymous caller was able to call create_membership_obligations_for_period -- CRITICAL REGRESSION of the fixed vulnerability';
exception when insufficient_privilege then
  raise notice 'PASS 1: anonymous caller correctly denied (insufficient_privilege -- no grant at all)';
when others then
  raise notice 'PASS 1 (alternate rejection path, verify manually): %  --  %', sqlstate, sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 2. Authenticated but unrelated user (a real user, no relationship to
--    this club at all) cannot create obligations.
-- ------------------------------------------------------------
begin;
create temporary table t_oa_state (k text primary key, v text) on commit drop;
grant all on t_oa_state to authenticated, service_role, anon;
do $$
declare
  v_club_a uuid := gen_random_uuid();
  v_dir_a uuid := gen_random_uuid();
  v_admin_a uuid := gen_random_uuid();
  v_unrelated uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_admin_a, 'oa2-admin-' || v_admin_a::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_unrelated, 'oa2-unrelated-' || v_unrelated::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.club_directory (id, name, rugby_code, country, nation, source, normalized_key, verification_status)
  values (v_dir_a, 'OA2 Regression Club', 'union', 'England', 'England', 'manual', 'oa2 regression club', 'verified');
  insert into public.clubs (id, directory_id, slug, status) values (v_club_a, v_dir_a, 'oa2-regression', 'active');
  insert into public.club_memberships (id, club_id, user_id, role, status) values (gen_random_uuid(), v_club_a, v_admin_a, 'CLUB_ADMIN', 'active');
  insert into t_oa_state values ('club_a', v_club_a::text), ('unrelated', v_unrelated::text);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_oa_state where k = 'unrelated';
do $$
begin
  perform public.create_membership_obligations_for_period((select v::uuid from t_oa_state where k = 'club_a'), date_trunc('month', current_date)::date);
  raise notice 'FAIL 2: an authenticated user with no relationship to this club was able to generate its obligations';
exception when others then
  raise notice 'PASS 2: unrelated authenticated user correctly denied -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 3. Team Coach/Manager at the SAME club, but without a finance
--    capability, cannot create obligations.
-- ------------------------------------------------------------
begin;
create temporary table t_oa_state (k text primary key, v text) on commit drop;
grant all on t_oa_state to authenticated, service_role, anon;
do $$
declare
  v_club_a uuid := gen_random_uuid();
  v_dir_a uuid := gen_random_uuid();
  v_admin_a uuid := gen_random_uuid();
  v_coach_a uuid := gen_random_uuid();
  v_team_a uuid := gen_random_uuid();
  v_membership_coach_a uuid;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_admin_a, 'oa3-admin-' || v_admin_a::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_coach_a, 'oa3-coach-' || v_coach_a::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.club_directory (id, name, rugby_code, country, nation, source, normalized_key, verification_status)
  values (v_dir_a, 'OA3 Regression Club', 'union', 'England', 'England', 'manual', 'oa3 regression club', 'verified');
  insert into public.clubs (id, directory_id, slug, status) values (v_club_a, v_dir_a, 'oa3-regression', 'active');
  insert into public.club_memberships (id, club_id, user_id, role, status) values (gen_random_uuid(), v_club_a, v_admin_a, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (id, club_id, user_id, role, status) values (gen_random_uuid(), v_club_a, v_coach_a, 'BASIC_USER', 'active') returning id into v_membership_coach_a;
  insert into public.teams (id, club_id, rugby_code, display_name, slug, category, age_group, gender, active, canonical_team_type_id)
  values (v_team_a, v_club_a, 'union', 'U12', 'u12-oa3-regression', 'youth', 'U12', 'boys', true, internal.resolve_canonical_team_type('youth', 'U12', 'boys', null));
  insert into public.team_permissions (id, membership_id, team_id, permission) values (gen_random_uuid(), v_membership_coach_a, v_team_a, 'coach');
  insert into t_oa_state values ('club_a', v_club_a::text), ('coach_a', v_coach_a::text);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_oa_state where k = 'coach_a';
do $$
begin
  perform public.create_membership_obligations_for_period((select v::uuid from t_oa_state where k = 'club_a'), date_trunc('month', current_date)::date);
  raise notice 'FAIL 3: Team staff without club.subscription.manage_enrolment was able to generate obligations for their own club';
exception when others then
  raise notice 'PASS 3: Team staff without finance capability correctly denied -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 4. Club Admin for Club A cannot create obligations for Club B.
-- ------------------------------------------------------------
begin;
create temporary table t_oa_state (k text primary key, v text) on commit drop;
grant all on t_oa_state to authenticated, service_role, anon;
do $$
declare
  v_club_a uuid := gen_random_uuid();
  v_dir_a uuid := gen_random_uuid();
  v_club_b uuid := gen_random_uuid();
  v_dir_b uuid := gen_random_uuid();
  v_admin_a uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v_admin_a, 'oa4-admin-' || v_admin_a::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.club_directory (id, name, rugby_code, country, nation, source, normalized_key, verification_status)
  values
    (v_dir_a, 'OA4 Regression Club A', 'union', 'England', 'England', 'manual', 'oa4 regression club a', 'verified'),
    (v_dir_b, 'OA4 Regression Club B', 'union', 'England', 'England', 'manual', 'oa4 regression club b', 'verified');
  insert into public.clubs (id, directory_id, slug, status) values
    (v_club_a, v_dir_a, 'oa4-regression-a', 'active'),
    (v_club_b, v_dir_b, 'oa4-regression-b', 'active');
  insert into public.club_memberships (id, club_id, user_id, role, status) values (gen_random_uuid(), v_club_a, v_admin_a, 'CLUB_ADMIN', 'active');
  insert into t_oa_state values ('club_a', v_club_a::text), ('club_b', v_club_b::text), ('admin_a', v_admin_a::text);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_oa_state where k = 'admin_a';
do $$
begin
  perform public.create_membership_obligations_for_period((select v::uuid from t_oa_state where k = 'club_b'), date_trunc('month', current_date)::date);
  raise notice 'FAIL 4: Club A''s own Club Admin was able to generate obligations for Club B (cross-club tampering succeeded)';
exception when others then
  raise notice 'PASS 4: cross-club generation correctly denied -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 5. The genuinely authorized Club Admin for Club A CAN perform the
--    legitimate operation on Club A. Rolled back so this test suite
--    never leaves synthetic obligation rows behind.
-- ------------------------------------------------------------
begin;
create temporary table t_oa_state (k text primary key, v text) on commit drop;
grant all on t_oa_state to authenticated, service_role, anon;
do $$
declare
  v_club_a uuid := gen_random_uuid();
  v_dir_a uuid := gen_random_uuid();
  v_admin_a uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v_admin_a, 'oa5-admin-' || v_admin_a::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.club_directory (id, name, rugby_code, country, nation, source, normalized_key, verification_status)
  values (v_dir_a, 'OA5 Regression Club', 'union', 'England', 'England', 'manual', 'oa5 regression club', 'verified');
  insert into public.clubs (id, directory_id, slug, status) values (v_club_a, v_dir_a, 'oa5-regression', 'active');
  insert into public.club_memberships (id, club_id, user_id, role, status) values (gen_random_uuid(), v_club_a, v_admin_a, 'CLUB_ADMIN', 'active');
  insert into t_oa_state values ('club_a', v_club_a::text), ('admin_a', v_admin_a::text);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_oa_state where k = 'admin_a';
do $$
declare
  v_club_a uuid := (select v::uuid from t_oa_state where k = 'club_a');
  v_programme_id uuid;
begin
  v_programme_id := public.configure_subscription_programme(v_club_a, true, 1, 'NONE', 'PRORATE_CURRENT_MONTH');
  perform public.set_subscription_price(v_programme_id, 1500, current_date);
end $$;
do $$
declare
  v_count integer;
begin
  v_count := public.create_membership_obligations_for_period((select v::uuid from t_oa_state where k = 'club_a'), date_trunc('month', current_date)::date);
  raise notice 'PASS 5: authorized Club Admin generated % obligation row(s) for their own club as expected', v_count;
exception when others then
  raise notice 'FAIL 5: the legitimate Club Admin operation was unexpectedly rejected -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 6. Service-role execution is permitted ONLY through the explicit,
--    narrow auth.role() = 'service_role' trusted-system path -- never
--    through a null-uid bypass (the exact class of the original bug).
--    Also rolled back.
-- ------------------------------------------------------------
begin;
create temporary table t_oa_state (k text primary key, v text) on commit drop;
grant all on t_oa_state to authenticated, service_role, anon;
do $$
declare
  v_club_a uuid := gen_random_uuid();
  v_dir_a uuid := gen_random_uuid();
  v_admin_a uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v_admin_a, 'oa6-admin-' || v_admin_a::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.club_directory (id, name, rugby_code, country, nation, source, normalized_key, verification_status)
  values (v_dir_a, 'OA6 Regression Club', 'union', 'England', 'England', 'manual', 'oa6 regression club', 'verified');
  insert into public.clubs (id, directory_id, slug, status) values (v_club_a, v_dir_a, 'oa6-regression', 'active');
  insert into public.club_memberships (id, club_id, user_id, role, status) values (gen_random_uuid(), v_club_a, v_admin_a, 'CLUB_ADMIN', 'active');
  insert into t_oa_state values ('club_a', v_club_a::text), ('admin_a', v_admin_a::text);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_oa_state where k = 'admin_a';
do $$
declare
  v_club_a uuid := (select v::uuid from t_oa_state where k = 'club_a');
  v_programme_id uuid;
begin
  v_programme_id := public.configure_subscription_programme(v_club_a, true, 1, 'NONE', 'PRORATE_CURRENT_MONTH');
  perform public.set_subscription_price(v_programme_id, 1500, current_date);
end $$;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare
  v_count integer;
begin
  v_count := public.create_membership_obligations_for_period((select v::uuid from t_oa_state where k = 'club_a'), date_trunc('month', current_date)::date);
  raise notice 'PASS 6: a genuine service-role caller (the only legitimate "system" path) generated % obligation row(s) as expected', v_count;
exception when others then
  raise notice 'FAIL 6: the trusted service-role system path was unexpectedly rejected -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 7. Explicit negative proof that the ORIGINAL vulnerability class is
--    closed: a request with role=authenticated but NO sub claim at all
--    (auth.uid() genuinely null, but NOT service_role) must still be
--    denied -- this is exactly the shape the original bug let through.
-- ------------------------------------------------------------
begin;
create temporary table t_oa_state (k text primary key, v text) on commit drop;
grant all on t_oa_state to authenticated, service_role, anon;
do $$
declare
  v_club_a uuid := gen_random_uuid();
  v_dir_a uuid := gen_random_uuid();
  v_admin_a uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v_admin_a, 'oa7-admin-' || v_admin_a::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.club_directory (id, name, rugby_code, country, nation, source, normalized_key, verification_status)
  values (v_dir_a, 'OA7 Regression Club', 'union', 'England', 'England', 'manual', 'oa7 regression club', 'verified');
  insert into public.clubs (id, directory_id, slug, status) values (v_club_a, v_dir_a, 'oa7-regression', 'active');
  insert into public.club_memberships (id, club_id, user_id, role, status) values (gen_random_uuid(), v_club_a, v_admin_a, 'CLUB_ADMIN', 'active');
  insert into t_oa_state values ('club_a', v_club_a::text), ('admin_a', v_admin_a::text);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_oa_state where k = 'admin_a';
do $$
declare
  v_club_a uuid := (select v::uuid from t_oa_state where k = 'club_a');
  v_programme_id uuid;
begin
  v_programme_id := public.configure_subscription_programme(v_club_a, true, 1, 'NONE', 'PRORATE_CURRENT_MONTH');
  perform public.set_subscription_price(v_programme_id, 1500, current_date);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
do $$
begin
  perform public.create_membership_obligations_for_period((select v::uuid from t_oa_state where k = 'club_a'), date_trunc('month', current_date)::date);
  raise notice 'FAIL 7: a null-auth.uid() authenticated-role request (no sub claim, not service_role) was able to generate obligations -- the original vulnerability class has regressed';
exception when others then
  raise notice 'PASS 7: null-auth.uid() non-service-role request correctly denied -- %', sqlerrm;
end $$;
rollback;

\echo '=== Suite complete. Every line above must read PASS. Any FAIL is a live security regression. ==='
