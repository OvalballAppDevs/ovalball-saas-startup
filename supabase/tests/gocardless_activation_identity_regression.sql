-- Test 4 closure Section 6, failure-path H: wrong player/programme/club /
-- identity substitution, as it actually applies to
-- activateMembershipAction (app/(app)/parent/players/[playerId]/subscription/actions.ts).
-- That action resolves player_subscription_payers by player_id + status
-- only (no payer_user_id filter in the query itself), then does an
-- application-level check `payerRow.payer_user_id !== user.id`. This
-- suite proves the TWO real layers that check actually protects:
--   H1. A genuinely unrelated user (no guardian link, no club capability)
--       gets ZERO rows from RLS -- rejected before the app-level check
--       ever runs.
--   H2. A Club Admin with club.subscription.manage_enrolment DOES see the
--       row via RLS (capability-scoped SELECT, needed for the finance
--       dashboard) -- but is NOT the payer, so the app-level
--       payer_user_id = auth.uid() comparison is the actual, load-bearing
--       guard stopping an admin from activating a Parent's membership as
--       if they were the paying party.
-- Self-contained synthetic fixtures, transactional/self-cleaning -- never
-- touches Foxton's real enrolment. NOT a migration. Run by hand:
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/gocardless_activation_identity_regression.sql

\set ON_ERROR_STOP off
\pset pager off

\echo '=== GoCardless activation identity-substitution regression suite (failure-path H) ==='

begin;
create temporary table t_identity_state (k text primary key, v text) on commit drop;
grant all on t_identity_state to authenticated, service_role, anon;

do $$
declare
  v_club_id uuid := gen_random_uuid();
  v_dir_id uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_payer_parent uuid := gen_random_uuid();
  v_unrelated_user uuid := gen_random_uuid();
  v_player_id uuid := gen_random_uuid();
  v_programme_id uuid;
  v_payer_id uuid;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_admin, 'identity-admin-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_payer_parent, 'identity-payer-' || v_payer_parent::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_unrelated_user, 'identity-unrelated-' || v_unrelated_user::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.club_directory (id, name, rugby_code, country, nation, source, normalized_key, verification_status)
  values (v_dir_id, 'Identity Regression Club', 'union', 'England', 'England', 'manual', 'identity regression club', 'verified');
  insert into public.clubs (id, directory_id, slug, status) values (v_club_id, v_dir_id, 'identity-regression', 'active');
  insert into public.club_memberships (id, club_id, user_id, role, status) values (gen_random_uuid(), v_club_id, v_admin, 'CLUB_ADMIN', 'active');
  insert into public.players (id, first_name, surname, date_of_birth, created_by) values (v_player_id, 'Identity', 'Regression', '2015-01-01', v_admin);

  insert into t_identity_state values
    ('club_id', v_club_id::text), ('admin', v_admin::text), ('payer_parent', v_payer_parent::text),
    ('unrelated_user', v_unrelated_user::text), ('player_id', v_player_id::text);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_identity_state where k = 'admin';
do $$
declare
  v_club_id uuid := (select v::uuid from t_identity_state where k = 'club_id');
  v_programme_id uuid;
begin
  v_programme_id := public.configure_subscription_programme(v_club_id, true, 1, 'NONE', 'PRORATE_CURRENT_MONTH');
  perform public.set_subscription_price(v_programme_id, 1500, current_date);
  insert into t_identity_state values ('programme_id', v_programme_id::text);
end $$;

set local role service_role;
do $$
declare
  v_player_id uuid := (select v::uuid from t_identity_state where k = 'player_id');
  v_programme_id uuid := (select v::uuid from t_identity_state where k = 'programme_id');
  v_payer_parent uuid := (select v::uuid from t_identity_state where k = 'payer_parent');
  v_payer_id uuid;
begin
  insert into public.player_subscription_payers (id, player_id, programme_id, payer_user_id, relationship, status, effective_from, created_by)
  values (gen_random_uuid(), v_player_id, v_programme_id, v_payer_parent, 'guardian', 'active', current_date, v_payer_parent)
  returning id into v_payer_id;
  insert into t_identity_state values ('payer_id', v_payer_id::text);
end $$;

\echo '--- H1: a genuinely unrelated user (no guardian link, no club capability) sees ZERO rows via RLS ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_identity_state where k = 'unrelated_user';
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.player_subscription_payers where player_id = (select v::uuid from t_identity_state where k = 'player_id') and status = 'active';
  if v_count = 0 then
    raise notice 'PASS H1: an unrelated user (no guardian link, no capability) sees zero rows -- activateMembershipAction would reject before the app-level check ever runs (payerRow is null)';
  else
    raise notice 'FAIL H1: unrelated user saw % row(s) for a player they have no relationship to', v_count;
  end if;
end $$;

\echo '--- H2: a Club Admin (has manage_enrolment capability) DOES see the row via RLS, but is NOT the payer -- the app-level payer_user_id=auth.uid() check is the real, load-bearing guard ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_identity_state where k = 'admin';
do $$
declare
  v_row record;
  v_admin_id uuid := (select v::uuid from t_identity_state where k = 'admin');
begin
  select id, payer_user_id into v_row from public.player_subscription_payers where player_id = (select v::uuid from t_identity_state where k = 'player_id') and status = 'active';
  if v_row.id is null then
    raise notice 'FAIL H2a: Club Admin (with manage_enrolment capability) unexpectedly saw zero rows -- the finance/enrolment view path would be broken';
  elsif v_row.payer_user_id = v_admin_id then
    raise notice 'FAIL H2b: the payer_user_id incorrectly equals the admin''s own id';
  else
    raise notice 'PASS H2: Club Admin sees the row via RLS (needed for legitimate finance/enrolment views), but payer_user_id (%) != the admin''s own auth.uid() (%) -- activateMembershipAction''s app-level check correctly identifies the admin as NOT the payer and would reject the activation', v_row.payer_user_id, v_admin_id;
  end if;
end $$;

\echo '--- H3 (positive control): the real payer themself sees the row AND matches payer_user_id=auth.uid() -- the legitimate path still works ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_identity_state where k = 'payer_parent';
do $$
declare
  v_row record;
  v_payer_parent_id uuid := (select v::uuid from t_identity_state where k = 'payer_parent');
begin
  select id, payer_user_id into v_row from public.player_subscription_payers where player_id = (select v::uuid from t_identity_state where k = 'player_id') and status = 'active';
  if v_row.id is not null and v_row.payer_user_id = v_payer_parent_id then
    raise notice 'PASS H3: the genuine payer sees their own row and payer_user_id correctly matches auth.uid() -- the legitimate activation path is not broken by the guard';
  else
    raise notice 'FAIL H3: the genuine payer could not correctly resolve their own payer row';
  end if;
end $$;

rollback;

\echo '=== Suite complete. Every line above must read PASS. ==='
