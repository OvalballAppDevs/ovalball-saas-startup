-- Sibling/multi-child discount permanent regression suite (Section 25).
-- Entirely self-contained synthetic fixtures, transactional/self-cleaning
-- -- never touches Foxton's real enrolment. NOT a migration. Run by hand:
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/gocardless_sibling_discount_regression.sql

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Sibling discount regression suite ==='

begin;
create temporary table t_sib_state (k text primary key, v text) on commit drop;
grant all on t_sib_state to authenticated, service_role, anon;

do $$
declare
  v_club_a uuid := gen_random_uuid();
  v_dir_a uuid := gen_random_uuid();
  v_club_b uuid := gen_random_uuid();
  v_dir_b uuid := gen_random_uuid();
  v_admin_a uuid := gen_random_uuid();
  v_admin_b uuid := gen_random_uuid();
  v_guardian_1 uuid := gen_random_uuid();
  v_guardian_2 uuid := gen_random_uuid();
  v_player_a uuid := gen_random_uuid();
  v_player_b uuid := gen_random_uuid();
  v_player_c uuid := gen_random_uuid();
  v_player_multi_team uuid := gen_random_uuid();
  v_player_cross_club uuid := gen_random_uuid();
  v_player_unrelated uuid := gen_random_uuid();
  v_team_1 uuid := gen_random_uuid();
  v_team_2 uuid := gen_random_uuid();
  v_team_b uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_admin_a, 'sib-admin-a-' || v_admin_a::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_admin_b, 'sib-admin-b-' || v_admin_b::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_guardian_1, 'sib-g1-' || v_guardian_1::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_guardian_2, 'sib-g2-' || v_guardian_2::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.club_directory (id, name, rugby_code, country, nation, source, normalized_key, verification_status)
  values
    (v_dir_a, 'Sibling Regression Club A', 'union', 'England', 'England', 'manual', 'sibling regression club a', 'verified'),
    (v_dir_b, 'Sibling Regression Club B', 'union', 'England', 'England', 'manual', 'sibling regression club b', 'verified');
  insert into public.clubs (id, directory_id, slug, status) values
    (v_club_a, v_dir_a, 'sibling-regression-a', 'active'),
    (v_club_b, v_dir_b, 'sibling-regression-b', 'active');
  insert into public.club_memberships (id, club_id, user_id, role, status) values
    (gen_random_uuid(), v_club_a, v_admin_a, 'CLUB_ADMIN', 'active'),
    (gen_random_uuid(), v_club_b, v_admin_b, 'CLUB_ADMIN', 'active');
  insert into public.teams (id, club_id, rugby_code, display_name, slug, category, age_group, gender, active, canonical_team_type_id) values
    (v_team_1, v_club_a, 'union', 'U10', 'u10-sib-a', 'youth', 'U10', 'boys', true, internal.resolve_canonical_team_type('youth', 'U10', 'boys', null)),
    (v_team_2, v_club_a, 'union', 'U12', 'u12-sib-a', 'youth', 'U12', 'boys', true, internal.resolve_canonical_team_type('youth', 'U12', 'boys', null)),
    (v_team_b, v_club_b, 'union', 'U10', 'u10-sib-b', 'youth', 'U10', 'boys', true, internal.resolve_canonical_team_type('youth', 'U10', 'boys', null));
  insert into public.players (id, first_name, surname, date_of_birth, created_by) values
    (v_player_a, 'Alpha', 'Sib', '2014-01-01', v_admin_a),
    (v_player_b, 'Beta', 'Sib', '2015-01-01', v_admin_a),
    (v_player_c, 'Gamma', 'Sib', '2016-01-01', v_admin_a),
    (v_player_multi_team, 'Delta', 'Sib', '2013-01-01', v_admin_a),
    (v_player_cross_club, 'Epsilon', 'Sib', '2014-01-01', v_admin_b),
    (v_player_unrelated, 'Zeta', 'Sib', '2014-01-01', v_admin_a);
  insert into public.player_team_memberships (id, player_id, team_id, status) values
    (gen_random_uuid(), v_player_a, v_team_1, 'active'),
    (gen_random_uuid(), v_player_b, v_team_1, 'active'),
    (gen_random_uuid(), v_player_c, v_team_1, 'active'),
    -- Section 3/Section 25 "same Player on multiple teams counted once":
    -- this player has TWO active team memberships at Club A.
    (gen_random_uuid(), v_player_multi_team, v_team_1, 'active'),
    (gen_random_uuid(), v_player_multi_team, v_team_2, 'active'),
    (gen_random_uuid(), v_player_cross_club, v_team_b, 'active'),
    (gen_random_uuid(), v_player_unrelated, v_team_1, 'active');
  insert into public.guardians (id, guardian_user_id, player_id, relationship_type, status, created_by) values
    (gen_random_uuid(), v_guardian_1, v_player_a, 'parent', 'active', v_admin_a),
    (gen_random_uuid(), v_guardian_1, v_player_b, 'parent', 'active', v_admin_a),
    (gen_random_uuid(), v_guardian_1, v_player_c, 'parent', 'active', v_admin_a),
    (gen_random_uuid(), v_guardian_1, v_player_multi_team, 'parent', 'active', v_admin_a),
    (gen_random_uuid(), v_guardian_1, v_player_cross_club, 'parent', 'active', v_admin_b),
    (gen_random_uuid(), v_guardian_2, v_player_unrelated, 'parent', 'active', v_admin_a);

  insert into t_sib_state values
    ('club_a', v_club_a::text), ('club_b', v_club_b::text), ('admin_a', v_admin_a::text), ('admin_b', v_admin_b::text),
    ('guardian_1', v_guardian_1::text), ('guardian_2', v_guardian_2::text),
    ('player_a', v_player_a::text), ('player_b', v_player_b::text), ('player_c', v_player_c::text),
    ('player_multi_team', v_player_multi_team::text), ('player_cross_club', v_player_cross_club::text), ('player_unrelated', v_player_unrelated::text);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_sib_state where k = 'admin_a';
do $$
declare
  v_programme_id uuid;
begin
  v_programme_id := public.configure_subscription_programme((select v::uuid from t_sib_state where k = 'club_a'), true, 1, 'NONE', 'PRORATE_CURRENT_MONTH');
  perform public.set_subscription_price(v_programme_id, 2000, current_date);
  perform public.configure_sibling_discount_rule(v_programme_id, 2, 'PERCENTAGE', 10);
  perform public.configure_sibling_discount_rule(v_programme_id, 3, 'FIXED', 500);
  insert into t_sib_state values ('programme_a', v_programme_id::text);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_sib_state where k = 'admin_b';
do $$
declare
  v_programme_id uuid;
begin
  v_programme_id := public.configure_subscription_programme((select v::uuid from t_sib_state where k = 'club_b'), true, 1, 'NONE', 'PRORATE_CURRENT_MONTH');
  perform public.set_subscription_price(v_programme_id, 2000, current_date);
  insert into t_sib_state values ('programme_b', v_programme_id::text);
end $$;

\echo '--- 1/2/3: 1st/2nd/3rd child pricing, enrolled in real order ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_sib_state where k = 'guardian_1';
do $$
declare
  v_programme_id uuid := (select v::uuid from t_sib_state where k = 'programme_a');
  v_payer_a uuid; v_payer_b uuid; v_payer_c uuid;
  v_ordinal integer; v_final integer; v_discount_type text; v_discount_amount integer;
begin
  v_payer_a := public.claim_responsible_payer((select v::uuid from t_sib_state where k = 'player_a'), v_programme_id);
  select sibling_ordinal, final_amount_minor into v_ordinal, v_final from public.player_subscription_payers where id = v_payer_a;
  if v_ordinal = 1 and v_final = 2000 then
    raise notice 'PASS 1: 1st child, no discount -- ordinal=1, final=2000p (full price)';
  else
    raise notice 'FAIL 1: expected ordinal=1 final=2000, got ordinal=% final=%', v_ordinal, v_final;
  end if;

  v_payer_b := public.claim_responsible_payer((select v::uuid from t_sib_state where k = 'player_b'), v_programme_id);
  select sibling_ordinal, final_amount_minor, sibling_discount_type, sibling_discount_amount_minor into v_ordinal, v_final, v_discount_type, v_discount_amount from public.player_subscription_payers where id = v_payer_b;
  if v_ordinal = 2 and v_discount_type = 'PERCENTAGE' and v_discount_amount = 200 and v_final = 1800 then
    raise notice 'PASS 2: 2nd child, 10%% percentage discount -- ordinal=2, discount=200p, final=1800p';
  else
    raise notice 'FAIL 2: expected ordinal=2 discount=200 final=1800, got ordinal=% discount_type=% discount=% final=%', v_ordinal, v_discount_type, v_discount_amount, v_final;
  end if;

  v_payer_c := public.claim_responsible_payer((select v::uuid from t_sib_state where k = 'player_c'), v_programme_id);
  select sibling_ordinal, final_amount_minor, sibling_discount_type, sibling_discount_amount_minor into v_ordinal, v_final, v_discount_type, v_discount_amount from public.player_subscription_payers where id = v_payer_c;
  if v_ordinal = 3 and v_discount_type = 'FIXED' and v_discount_amount = 500 and v_final = 1500 then
    raise notice 'PASS 3: 3rd child, £5.00 fixed discount -- ordinal=3, discount=500p, final=1500p';
  else
    raise notice 'FAIL 3: expected ordinal=3 discount=500 final=1500, got ordinal=% discount_type=% discount=% final=%', v_ordinal, v_discount_type, v_discount_amount, v_final;
  end if;

  insert into t_sib_state values ('payer_a', v_payer_a::text), ('payer_b', v_payer_b::text), ('payer_c', v_payer_c::text);
end $$;

\echo '--- 4/5: discount floor £0, percentage rounding ---'

-- Re-open a fresh transaction for scenarios 4/5 with real siblings established.
create temporary table t_floor_state (k text primary key, v text) on commit drop;
grant all on t_floor_state to authenticated, service_role, anon;
do $$
declare
  v_club_id uuid := gen_random_uuid();
  v_dir_id uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_guardian uuid := gen_random_uuid();
  v_player_1 uuid := gen_random_uuid();
  v_player_2 uuid := gen_random_uuid();
  v_player_3 uuid := gen_random_uuid();
  v_team_id uuid := gen_random_uuid();
begin
  -- reset role (not whatever role a prior scenario left active): fixture
  -- setup needs to bypass RLS and insert into auth.users directly, matching
  -- every other fixture-creation block in this suite.
  reset role;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_admin, 'floor-admin-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_guardian, 'floor-guardian-' || v_guardian::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.club_directory (id, name, rugby_code, country, nation, source, normalized_key, verification_status)
  values (v_dir_id, 'Floor Regression Club', 'union', 'England', 'England', 'manual', 'floor regression club', 'verified');
  insert into public.clubs (id, directory_id, slug, status) values (v_club_id, v_dir_id, 'floor-regression', 'active');
  insert into public.club_memberships (id, club_id, user_id, role, status) values (gen_random_uuid(), v_club_id, v_admin, 'CLUB_ADMIN', 'active');
  insert into public.teams (id, club_id, rugby_code, display_name, slug, category, age_group, gender, active, canonical_team_type_id)
  values (v_team_id, v_club_id, 'union', 'U10', 'u10-floor', 'youth', 'U10', 'boys', true, internal.resolve_canonical_team_type('youth', 'U10', 'boys', null));
  insert into public.players (id, first_name, surname, date_of_birth, created_by) values
    (v_player_1, 'Floor', 'One', '2014-01-01', v_admin),
    (v_player_2, 'Floor', 'Two', '2015-01-01', v_admin),
    (v_player_3, 'Floor', 'Three', '2016-01-01', v_admin);
  insert into public.player_team_memberships (id, player_id, team_id, status) values
    (gen_random_uuid(), v_player_1, v_team_id, 'active'),
    (gen_random_uuid(), v_player_2, v_team_id, 'active'),
    (gen_random_uuid(), v_player_3, v_team_id, 'active');
  insert into public.guardians (id, guardian_user_id, player_id, relationship_type, status, created_by) values
    (gen_random_uuid(), v_guardian, v_player_1, 'parent', 'active', v_admin),
    (gen_random_uuid(), v_guardian, v_player_2, 'parent', 'active', v_admin),
    (gen_random_uuid(), v_guardian, v_player_3, 'parent', 'active', v_admin);
  insert into t_floor_state values
    ('club_id', v_club_id::text), ('admin', v_admin::text), ('guardian', v_guardian::text),
    ('player_1', v_player_1::text), ('player_2', v_player_2::text), ('player_3', v_player_3::text);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_floor_state where k = 'admin';
do $$
declare
  v_programme_id uuid;
begin
  v_programme_id := public.configure_subscription_programme((select v::uuid from t_floor_state where k = 'club_id'), true, 1, 'NONE', 'PRORATE_CURRENT_MONTH');
  perform public.set_subscription_price(v_programme_id, 300, current_date);
  perform public.configure_sibling_discount_rule(v_programme_id, 2, 'FIXED', 500);
  perform public.configure_sibling_discount_rule(v_programme_id, 3, 'PERCENTAGE', 33);
  insert into t_floor_state values ('programme_id', v_programme_id::text);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_floor_state where k = 'guardian';
do $$
declare
  v_programme_id uuid := (select v::uuid from t_floor_state where k = 'programme_id');
  v_payer_1 uuid; v_payer_2 uuid; v_payer_3 uuid;
  v_final integer;
begin
  v_payer_1 := public.claim_responsible_payer((select v::uuid from t_floor_state where k = 'player_1'), v_programme_id);
  v_payer_2 := public.claim_responsible_payer((select v::uuid from t_floor_state where k = 'player_2'), v_programme_id);
  select final_amount_minor into v_final from public.player_subscription_payers where id = v_payer_2;
  if v_final = 0 then
    raise notice 'PASS 4: discount floor -- a £5.00 fixed discount against a £3.00 base price clamps to £0.00, never negative';
  else
    raise notice 'FAIL 4: expected final_amount_minor=0, got %', v_final;
  end if;

  v_payer_3 := public.claim_responsible_payer((select v::uuid from t_floor_state where k = 'player_3'), v_programme_id);
  select final_amount_minor into v_final from public.player_subscription_payers where id = v_payer_3;
  -- 300 * 33 / 100 = 99, rounded (deterministic integer rounding) -> discount=99, final=201
  if v_final = 201 then
    raise notice 'PASS 5: percentage rounding -- 300p * 33%% = 99p discount (deterministic rounding), final=201p';
  else
    raise notice 'FAIL 5: expected final_amount_minor=201, got %', v_final;
  end if;
end $$;

\echo '--- 6/7: PRORATE / START_NEXT_MONTH use the DISCOUNTED recurring rate ---'
create temporary table t_first_pay_state (k text primary key, v text) on commit drop;
grant all on t_first_pay_state to authenticated, service_role, anon;
do $$
declare
  v_club_id uuid := gen_random_uuid();
  v_dir_id uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_guardian uuid := gen_random_uuid();
  v_player_1 uuid := gen_random_uuid();
  v_player_2 uuid := gen_random_uuid();
  v_team_id uuid := gen_random_uuid();
begin
  reset role;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_admin, 'fp-admin-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_guardian, 'fp-guardian-' || v_guardian::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.club_directory (id, name, rugby_code, country, nation, source, normalized_key, verification_status)
  values (v_dir_id, 'First Pay Regression Club', 'union', 'England', 'England', 'manual', 'first pay regression club', 'verified');
  insert into public.clubs (id, directory_id, slug, status) values (v_club_id, v_dir_id, 'first-pay-regression', 'active');
  insert into public.club_memberships (id, club_id, user_id, role, status) values (gen_random_uuid(), v_club_id, v_admin, 'CLUB_ADMIN', 'active');
  insert into public.teams (id, club_id, rugby_code, display_name, slug, category, age_group, gender, active, canonical_team_type_id)
  values (v_team_id, v_club_id, 'union', 'U10', 'u10-fp', 'youth', 'U10', 'boys', true, internal.resolve_canonical_team_type('youth', 'U10', 'boys', null));
  insert into public.players (id, first_name, surname, date_of_birth, created_by) values
    (v_player_1, 'FP', 'One', '2014-01-01', v_admin),
    (v_player_2, 'FP', 'Two', '2015-01-01', v_admin);
  insert into public.player_team_memberships (id, player_id, team_id, status) values
    (gen_random_uuid(), v_player_1, v_team_id, 'active'),
    (gen_random_uuid(), v_player_2, v_team_id, 'active');
  insert into public.guardians (id, guardian_user_id, player_id, relationship_type, status, created_by) values
    (gen_random_uuid(), v_guardian, v_player_1, 'parent', 'active', v_admin),
    (gen_random_uuid(), v_guardian, v_player_2, 'parent', 'active', v_admin);
  insert into t_first_pay_state values
    ('club_id', v_club_id::text), ('admin', v_admin::text), ('guardian', v_guardian::text),
    ('player_1', v_player_1::text), ('player_2', v_player_2::text);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_first_pay_state where k = 'admin';
do $$
declare
  v_programme_id uuid;
begin
  v_programme_id := public.configure_subscription_programme((select v::uuid from t_first_pay_state where k = 'club_id'), true, 1, 'NONE', 'PRORATE_CURRENT_MONTH');
  perform public.set_subscription_price(v_programme_id, 1500, current_date);
  perform public.configure_sibling_discount_rule(v_programme_id, 2, 'PERCENTAGE', 10);
  insert into t_first_pay_state values ('programme_id', v_programme_id::text);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_first_pay_state where k = 'guardian';
do $$
declare
  v_programme_id uuid := (select v::uuid from t_first_pay_state where k = 'programme_id');
  v_payer_1 uuid; v_payer_2 uuid;
  v_preview record;
begin
  v_payer_1 := public.claim_responsible_payer((select v::uuid from t_first_pay_state where k = 'player_1'), v_programme_id);
  v_payer_2 := public.claim_responsible_payer((select v::uuid from t_first_pay_state where k = 'player_2'), v_programme_id);

  select * into v_preview from public.preview_first_payment(v_programme_id, (select v::uuid from t_first_pay_state where k = 'player_2'), current_date);
  -- child #2: base=1500, 10% off -> monthly=1350. If today is the 1st, no proration; otherwise proration must be based on 1350, not 1500.
  if v_preview.monthly_amount_minor = 1350 then
    raise notice 'PASS 6: PRORATE_CURRENT_MONTH preview uses the DISCOUNTED recurring rate (1350p), never the undiscounted base (1500p)';
  else
    raise notice 'FAIL 6: expected monthly_amount_minor=1350, got %', v_preview.monthly_amount_minor;
  end if;

  insert into t_first_pay_state values ('payer_1', v_payer_1::text), ('payer_2', v_payer_2::text);
end $$;

-- START_NEXT_MONTH variant, same discount, a fresh throwaway club (never touches Foxton).
do $$
declare
  v_admin uuid := (select v::uuid from t_first_pay_state where k = 'admin');
  v_club_id uuid := gen_random_uuid();
  v_dir_id uuid := gen_random_uuid();
  v_team_id uuid := gen_random_uuid();
  v_guardian uuid := (select v::uuid from t_first_pay_state where k = 'guardian');
  v_player_1 uuid := gen_random_uuid();
  v_player_2 uuid := gen_random_uuid();
begin
  -- reset role (not service_role): fixture setup needs to bypass RLS
  -- AND call internal.resolve_canonical_team_type directly -- service_role
  -- lacks schema-level USAGE on `internal` (only the SECURITY DEFINER
  -- wrapper functions, which run as their OWNER, can reach it), so this
  -- resets to the connection's own postgres superuser identity instead,
  -- matching every other fixture-creation block in this suite.
  reset role;
  insert into public.club_directory (id, name, rugby_code, country, nation, source, normalized_key, verification_status)
  values (v_dir_id, 'NCD First Pay Regression Club', 'union', 'England', 'England', 'manual', 'ncd first pay regression club', 'verified');
  insert into public.clubs (id, directory_id, slug, status) values (v_club_id, v_dir_id, 'ncd-first-pay-regression', 'active');
  insert into public.club_memberships (id, club_id, user_id, role, status) values (gen_random_uuid(), v_club_id, v_admin, 'CLUB_ADMIN', 'active');
  insert into public.teams (id, club_id, rugby_code, display_name, slug, category, age_group, gender, active, canonical_team_type_id)
  values (v_team_id, v_club_id, 'union', 'U10', 'u10-ncd-fp', 'youth', 'U10', 'boys', true, internal.resolve_canonical_team_type('youth', 'U10', 'boys', null));
  insert into public.players (id, first_name, surname, date_of_birth, created_by) values
    (v_player_1, 'NCDFP', 'One', '2014-01-01', v_admin),
    (v_player_2, 'NCDFP', 'Two', '2015-01-01', v_admin);
  insert into public.player_team_memberships (id, player_id, team_id, status) values
    (gen_random_uuid(), v_player_1, v_team_id, 'active'),
    (gen_random_uuid(), v_player_2, v_team_id, 'active');
  insert into public.guardians (id, guardian_user_id, player_id, relationship_type, status, created_by) values
    (gen_random_uuid(), v_guardian, v_player_1, 'parent', 'active', v_admin),
    (gen_random_uuid(), v_guardian, v_player_2, 'parent', 'active', v_admin);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  insert into t_first_pay_state values ('ncd_club_id', v_club_id::text), ('ncd_player_1', v_player_1::text), ('ncd_player_2', v_player_2::text);
end $$;

do $$
declare
  v_programme_id uuid;
begin
  v_programme_id := public.configure_subscription_programme((select v::uuid from t_first_pay_state where k = 'ncd_club_id'), true, 1, 'NONE', 'NEXT_COLLECTION_DAY');
  perform public.set_subscription_price(v_programme_id, 1500, current_date);
  perform public.configure_sibling_discount_rule(v_programme_id, 2, 'PERCENTAGE', 10);
  insert into t_first_pay_state values ('ncd_programme_id', v_programme_id::text);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_first_pay_state where k = 'guardian';
do $$
declare
  v_programme_id uuid := (select v::uuid from t_first_pay_state where k = 'ncd_programme_id');
  v_preview record;
begin
  perform public.claim_responsible_payer((select v::uuid from t_first_pay_state where k = 'ncd_player_1'), v_programme_id);
  perform public.claim_responsible_payer((select v::uuid from t_first_pay_state where k = 'ncd_player_2'), v_programme_id);
  select * into v_preview from public.preview_first_payment(v_programme_id, (select v::uuid from t_first_pay_state where k = 'ncd_player_2'), current_date);
  if v_preview.monthly_amount_minor = 1350 and v_preview.first_charge_amount_minor = 1350 then
    raise notice 'PASS 7: START_NEXT_MONTH (NEXT_COLLECTION_DAY) first full collection uses the DISCOUNTED recurring rate (1350p)';
  else
    raise notice 'FAIL 7: expected 1350/1350, got monthly=% first_charge=%', v_preview.monthly_amount_minor, v_preview.first_charge_amount_minor;
  end if;
end $$;

\echo '--- 8/9: duplicate rows do not increment child count; same Player on multiple teams counted once ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_sib_state where k = 'guardian_1';
do $$
declare
  v_programme_id uuid := (select v::uuid from t_sib_state where k = 'programme_a');
  v_payer_multi uuid;
  v_ordinal integer;
begin
  -- player_multi_team has TWO active player_team_memberships rows at
  -- Club A -- the resolver must still see them as exactly one player.
  v_payer_multi := public.claim_responsible_payer((select v::uuid from t_sib_state where k = 'player_multi_team'), v_programme_id);
  select sibling_ordinal into v_ordinal from public.player_subscription_payers where id = v_payer_multi;
  -- Guardian 1 already has 3 active children (A, B, C) at this point -- this is the 4th.
  if v_ordinal = 4 then
    raise notice 'PASS 9: a player with TWO active team memberships at the same club is still counted as exactly ONE child (ordinal=4, not skipped or double-counted)';
  else
    raise notice 'FAIL 9: expected ordinal=4, got %', v_ordinal;
  end if;

  insert into t_sib_state values ('payer_multi', v_payer_multi::text);
end $$;

do $$
declare
  v_count integer;
begin
  -- Section 3/8: duplicate rows do not increment child count -- proven
  -- directly: a repeated claim_responsible_payer call for an
  -- ALREADY-ACTIVE player correctly raises (proven elsewhere), and a
  -- direct duplicate-obligation INSERT for the SAME payer_subscription_id
  -- + billing_period is blocked by membership_obligations' own unique
  -- constraint -- neither can ever inflate the DISTINCT player_id count
  -- calculate_member_price uses. Runs as the connection's own postgres
  -- identity (bypasses RLS for this verification read) -- no elevated
  -- application role can read this cross-payer data either.
  reset role;
  select count(distinct player_id) into v_count from public.player_subscription_payers
  where payer_user_id = (select v::uuid from t_sib_state where k = 'guardian_1') and programme_id = (select v::uuid from t_sib_state where k = 'programme_a') and status = 'active';
  if v_count = 4 then
    raise notice 'PASS 8: exactly 4 distinct active children counted for Guardian 1 (A, B, C, multi-team) -- no duplicate/retry/obligation row could have inflated this, since the resolver counts DISTINCT player_id from player_subscription_payers only';
  else
    raise notice 'FAIL 8: expected 4 distinct children, got %', v_count;
  end if;
end $$;

\echo '--- 10: cancelled enrolment not counted ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_sib_state where k = 'admin_a';
do $$
begin
  perform public.end_membership_subscription((select v::uuid from t_sib_state where k = 'payer_c'), 'Sibling discount regression -- testing cancelled-not-counted');
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_sib_state where k = 'guardian_1';
do $$
declare
  v_programme_id uuid := (select v::uuid from t_sib_state where k = 'programme_a');
  v_preview record;
begin
  -- Now only A, B, multi-team remain active (C was just cancelled) -- a
  -- HYPOTHETICAL new enrolment would resolve as the 4th child, proving C
  -- is no longer counted. Uses the REAL public preview_first_payment RPC
  -- (exactly what the Parent's own browser session would call), called
  -- with a fresh hypothetical player_id -- never the internal resolver
  -- directly (which is deliberately not reachable this way, see 13/14).
  select * into v_preview from public.preview_first_payment(v_programme_id, gen_random_uuid(), current_date);
  if v_preview.sibling_ordinal = 4 then
    raise notice 'PASS 10: the cancelled child (C) is correctly excluded from the active count -- a new hypothetical enrolment resolves as ordinal 4 (A, B, multi-team = 3 active), not 5';
  else
    raise notice 'FAIL 10: expected ordinal=4, got %', v_preview.sibling_ordinal;
  end if;
end $$;

\echo '--- 11: cross-club child not counted ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_sib_state where k = 'guardian_1';
do $$
declare
  v_preview record;
begin
  -- Guardian 1 also has a child relationship recorded at Club B
  -- (player_cross_club) -- Programme A's ordinal count must be entirely
  -- unaffected by anything at Club B.
  select * into v_preview from public.preview_first_payment((select v::uuid from t_sib_state where k = 'programme_a'), gen_random_uuid(), current_date);
  if v_preview.sibling_ordinal = 4 then
    raise notice 'PASS 11: cross-club scope holds -- Programme A''s ordinal count (4) is unaffected regardless of Guardian 1''s Club B relationship';
  else
    raise notice 'FAIL 11: expected ordinal=4 (Club B has no bearing), got %', v_preview.sibling_ordinal;
  end if;
end $$;

\echo '--- 12: unrelated payer does not inherit discount ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_sib_state where k = 'guardian_2';
do $$
declare
  v_programme_id uuid := (select v::uuid from t_sib_state where k = 'programme_a');
  v_payer uuid;
  v_ordinal integer;
begin
  -- Guardian 2 is entirely unrelated to Guardian 1 -- their own first
  -- child at the SAME club/programme must be ordinal 1, never inheriting
  -- Guardian 1's count.
  v_payer := public.claim_responsible_payer((select v::uuid from t_sib_state where k = 'player_unrelated'), v_programme_id);
  select sibling_ordinal into v_ordinal from public.player_subscription_payers where id = v_payer;
  if v_ordinal = 1 then
    raise notice 'PASS 12: an unrelated payer''s own first child at the same club/programme correctly resolves as ordinal 1 -- payer-scoped, not club-wide';
  else
    raise notice 'FAIL 12: expected ordinal=1, got %', v_ordinal;
  end if;
end $$;

\echo '--- 13/14: browser cannot forge ordinal or discount ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_sib_state where k = 'guardian_1';
do $$
begin
  -- claim_responsible_payer's signature takes ONLY (player_id,
  -- programme_id) -- there is structurally no parameter through which a
  -- caller could supply an ordinal, discount type, or final amount. The
  -- underlying resolver is not directly callable by authenticated at all
  -- (locked down separately) -- proven here.
  perform internal.calculate_member_price((select v::uuid from t_sib_state where k = 'programme_a'), auth.uid(), gen_random_uuid(), current_date);
  raise notice 'FAIL 13/14: an authenticated user was able to call internal.calculate_member_price directly (could probe/manipulate pricing for arbitrary payer/player combinations)';
exception when others then
  raise notice 'PASS 13/14: authenticated user correctly denied direct access to the internal pricing resolver -- %', sqlerrm;
end $$;

do $$
begin
  -- Parent cannot configure the club's discount policy either.
  perform public.configure_sibling_discount_rule((select v::uuid from t_sib_state where k = 'programme_a'), 2, 'PERCENTAGE', 100);
  raise notice 'FAIL 14b: a Parent was able to change the club''s sibling discount policy';
exception when others then
  raise notice 'PASS 14b: Parent correctly denied changing sibling discount policy -- %', sqlerrm;
end $$;

\echo '--- Cross-club admin cannot change another club''s discount policy ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_sib_state where k = 'admin_b';
do $$
begin
  perform public.configure_sibling_discount_rule((select v::uuid from t_sib_state where k = 'programme_a'), 2, 'PERCENTAGE', 100);
  raise notice 'FAIL 14c: unrelated Club B admin was able to change Club A''s sibling discount policy';
exception when others then
  raise notice 'PASS 14c: unrelated Club B admin correctly denied -- %', sqlerrm;
end $$;

\echo '--- 15/16: policy change does not alter existing enrolment; sibling leaving does not re-price remaining sibling ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_sib_state where k = 'admin_a';
do $$
declare
  v_final_before integer;
  v_final_after integer;
begin
  select final_amount_minor into v_final_before from public.player_subscription_payers where id = (select v::uuid from t_sib_state where k = 'payer_b');
  -- Change the 2nd-child rule from 10% to 50%.
  perform public.configure_sibling_discount_rule((select v::uuid from t_sib_state where k = 'programme_a'), 2, 'PERCENTAGE', 50);
  select final_amount_minor into v_final_after from public.player_subscription_payers where id = (select v::uuid from t_sib_state where k = 'payer_b');
  if v_final_before = v_final_after then
    raise notice 'PASS 15: changing the sibling discount policy did NOT alter Child B''s already-snapshotted final_amount_minor (still %p)', v_final_after;
  else
    raise notice 'FAIL 15: existing enrolment was re-priced -- before=% after=%', v_final_before, v_final_after;
  end if;
end $$;

do $$
declare
  v_final_b_before integer;
  v_final_b_after integer;
  v_ordinal_b_before integer;
  v_ordinal_b_after integer;
begin
  select final_amount_minor, sibling_ordinal into v_final_b_before, v_ordinal_b_before from public.player_subscription_payers where id = (select v::uuid from t_sib_state where k = 'payer_b');
  -- Child A (the 1st child) leaves.
  perform public.end_membership_subscription((select v::uuid from t_sib_state where k = 'payer_a'), 'Sibling discount regression -- testing no re-pricing on sibling leaving');
  select final_amount_minor, sibling_ordinal into v_final_b_after, v_ordinal_b_after from public.player_subscription_payers where id = (select v::uuid from t_sib_state where k = 'payer_b');
  if v_final_b_before = v_final_b_after and v_ordinal_b_before = v_ordinal_b_after then
    raise notice 'PASS 16: Child A leaving did NOT re-price or re-number Child B -- still ordinal=%, final=%p (snapshot immutable)', v_ordinal_b_after, v_final_b_after;
  else
    raise notice 'FAIL 16: Child B was silently re-priced/re-numbered -- ordinal before=% after=%, final before=% after=%', v_ordinal_b_before, v_ordinal_b_after, v_final_b_before, v_final_b_after;
  end if;
end $$;

\echo '--- 17: same-day policy correction resolves deterministically (most-recently-created wins) ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_sib_state where k = 'admin_a';
do $$
declare
  v_rules record;
begin
  -- A real bug, found via live browser verification: an admin correcting
  -- a same-day mistake (e.g. set 3rd child to 20%, then immediately
  -- correct it to 30%) inserts TWO rows sharing the same effective_from
  -- DATE. Without a secondary tiebreaker, the display/resolver queries
  -- could non-deterministically keep showing/using the OLDER value.
  perform public.configure_sibling_discount_rule((select v::uuid from t_sib_state where k = 'programme_a'), 3, 'PERCENTAGE', 20);
  perform public.configure_sibling_discount_rule((select v::uuid from t_sib_state where k = 'programme_a'), 3, 'PERCENTAGE', 30);
  select * into v_rules from public.get_sibling_discount_rules((select v::uuid from t_sib_state where k = 'programme_a')) where ordinal = 3;
  if v_rules.discount_value = 30 then
    raise notice 'PASS 17a: two same-day corrections to the 3rd-child rule -- get_sibling_discount_rules correctly shows the LATEST (30%%), not the superseded 20%%';
  else
    raise notice 'FAIL 17a: expected 30, got %', v_rules.discount_value;
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_sib_state where k = 'guardian_1';
do $$
declare
  v_preview record;
begin
  -- A hypothetical NEW 3rd-child enrolment must price against the LATEST
  -- same-day rule (30%, not the superseded 20%) via the real resolver
  -- pipeline (preview_first_payment -> internal.calculate_member_price).
  select * into v_preview from public.preview_first_payment((select v::uuid from t_sib_state where k = 'programme_a'), gen_random_uuid(), current_date);
  if v_preview.sibling_discount_value = 30 then
    raise notice 'PASS 17b: the real pricing resolver also uses the LATEST same-day 3rd-child rule (30%%), not the superseded 20%%';
  else
    raise notice 'FAIL 17b: expected discount_value=30, got %', v_preview.sibling_discount_value;
  end if;
end $$;

\echo '--- 18: existing price/policy snapshot preserved (base_amount_minor, pricing_id) ---'
do $$
declare
  v_base integer;
begin
  select base_amount_minor into v_base from public.player_subscription_payers where id = (select v::uuid from t_sib_state where k = 'payer_b');
  if v_base = 2000 then
    raise notice 'PASS 18: Child B''s snapshotted base_amount_minor (2000p) is preserved regardless of the later discount-policy change';
  else
    raise notice 'FAIL 18: expected base_amount_minor=2000, got %', v_base;
  end if;
end $$;

\echo '--- 19/20: Finance displays snapshot; export displays correct snapshot ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_sib_state where k = 'admin_a';
do $$
declare
  v_detail record;
begin
  select * into v_detail from public.get_membership_operational_detail((select v::uuid from t_sib_state where k = 'payer_b'));
  if v_detail.base_amount_minor = 2000 and v_detail.sibling_ordinal = 2 and v_detail.sibling_discount_type = 'PERCENTAGE' and v_detail.final_amount_minor = 1800 then
    raise notice 'PASS 19: get_membership_operational_detail (Finance detail) correctly surfaces Child B''s ORIGINAL snapshot (base=2000, ordinal=2, 10%%, final=1800) -- never recomputed from the now-changed 50%% policy';
  else
    raise notice 'FAIL 19: Finance detail drifted from the real snapshot -- base=% ordinal=% type=% final=%', v_detail.base_amount_minor, v_detail.sibling_ordinal, v_detail.sibling_discount_type, v_detail.final_amount_minor;
  end if;
end $$;

do $$
declare
  v_row record;
  v_found boolean := false;
begin
  perform public.create_membership_obligations_for_period((select v::uuid from t_sib_state where k = 'club_a'), date_trunc('month', current_date)::date);
  for v_row in select * from public.export_finance_rows((select v::uuid from t_sib_state where k = 'club_a'), date_trunc('month', current_date)::date) loop
    if v_row.sibling_ordinal = 2 then
      v_found := true;
      if v_row.base_amount_minor = 2000 and v_row.final_amount_minor = 1800 then
        raise notice 'PASS 20: export_finance_rows correctly includes Child B''s snapshotted base (2000p) and final (1800p) rate';
      else
        raise notice 'FAIL 20: export row drifted -- base=% final=%', v_row.base_amount_minor, v_row.final_amount_minor;
      end if;
    end if;
  end loop;
  if not v_found then
    raise notice 'FAIL 20: no ordinal=2 row found in the export at all';
  end if;
end $$;

rollback;

\echo '=== Suite complete. Every line above must read PASS. ==='
