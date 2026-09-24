-- SUBSCRIPTIONS & PAYMENTS (CA-M11.1) -- THE CLUB ADMIN'S MONEY ON THE PHONE, PROVED WHERE IT IS ENFORCED.
--
-- The phone's finance screens consume the website's own domain -- the same RPCs, the same RLS-scoped reads --
-- and cannot widen anything. This suite proves the boundaries those screens depend on:
--
--   CF-A  a club-scope finance.subscription.view holder reads the ledger, the review reasons and one
--         membership's detail, and is refused configuration, pricing, waiving, generation, export, disconnect,
--         refund and cancellation by the RPCs' own gates, with nothing changed
--   CF-B  a Team Manager with the team-scoped view reads only their own squad through team_subscription_status,
--         is refused the sibling team, reads no ledger row, no review reason and no detail, and holds no club
--         finance key -- no team finance escalation
--   CF-C  another club's administrator reads nothing of this club and is refused every operation on it, while
--         their own club still answers
--   CF-D  the merchant access token is unreadable by any signed-in role, no bank-account column exists, the token
--         functions are service-role only, and the result shapes the phone consumes carry no secret
--   CF-E  the functions the phone calls are the web's, by name and signature, executable by authenticated
--   CF-F  the club administrator does the work: idempotent generation, a waive with its audit row, an export with
--         its audit row, an effective-dated price, a sibling rule, a first-payment preview, the connection status
--   CF-G  H20 and H25 are untouched by this slice: finance.subscription.view is still {club,team}, not inherited
--         to team, ceiling C; the TM bundle row is present; no other finance key has team scope
--
-- Self-seeding and rolled back. No persistent review identity or club is touched.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.act(p_role text, p_sub uuid default null, p_session uuid default null) returns void
language plpgsql as $$
declare v_email text;
begin
  perform set_config('role', 'none', true);
  if p_sub is not null then select email into v_email from auth.users where id = p_sub; end if;
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_sub, 'role', p_role, 'email', v_email, 'session_id', p_session))::text, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function pg_temp.act_postgres() returns void language plpgsql as $$
begin perform set_config('role','none',true); perform set_config('request.jwt.claims','',true); end $$;

create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v_state text;
begin execute p_sql; return 'OK';
exception when others then get stacked diagnostics v_state = returned_sqlstate; return v_state; end $$;

/* Rows a query yields, or -1 when the server refuses the query outright. */
create or replace function pg_temp.rows_of(p_sql text) returns bigint language plpgsql as $$
declare v bigint;
begin execute 'select count(*) from (' || p_sql || ') q' into v; return v;
exception when others then return -1; end $$;

create or replace function pg_temp.person(p_label text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cf-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Cf', p_label, 'cf-' || v::text || '@ovalball.test', (current_date - interval '35 years')::date)
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth;
  return v;
end $$;

create or replace function pg_temp.session(p_user uuid, p_aal text default 'aal1', p_recent boolean default false) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (v, p_user, now(), now(), p_aal::auth.aal_level);
  if p_recent then
    insert into auth.mfa_amr_claims (id, session_id, authentication_method, created_at, updated_at) values (gen_random_uuid(), v, 'totp', now(), now());
  end if;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CF ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'cf-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'cf-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_key text, p_age text, p_label text) returns uuid language plpgsql as $$
declare v uuid; v_type uuid;
begin
  select id into v_type from public.canonical_team_types_by_code where rugby_code = 'union' and key = p_key and is_offered limit 1;
  insert into public.teams (club_id, display_name, category, age_group, gender, rugby_code, canonical_team_type_id, active)
  values (p_club, p_label, 'youth', p_age, 'boys', 'union', v_type, true) returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;

create or replace function pg_temp.player(p_label text, p_years int, p_team uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('P', p_label, (current_date - (p_years || ' years')::interval)::date, 'MALE') returning id into v;
  insert into public.player_team_memberships (player_id, team_id, state) values (v, p_team, 'ACTIVE');
  return v;
end $$;

grant execute on function pg_temp.act(text, uuid, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.rows_of(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

do $$
declare
  v_club uuid; v_club_b uuid; v_t12 uuid; v_t14 uuid;
  v_admin uuid; v_viewer uuid; v_tm uuid; v_parent uuid; v_admin_b uuid;
  v_admin_sess uuid; v_viewer_sess uuid; v_tm_sess uuid; v_admin_b_sess uuid;
  v_ms_tm uuid;
  v_child12 uuid; v_child14 uuid;
  v_programme uuid; v_programme_b uuid; v_pricing uuid; v_payer12 uuid; v_payer14 uuid; v_ob12 uuid;
  v_prev date := (date_trunc('month', current_date) - interval '1 month')::date;
  v_this date := date_trunc('month', current_date)::date;
  v_state text; v_text text; v_n bigint; v_m bigint; v_k bigint; v_json jsonb; v_ok boolean;
begin
  -- =====================================================================================
  -- SEED. Club A with two sides, a programme, a price, two children each with a payer and a
  -- previous-month obligation (one FAILED, one PAID). Club B with its own programme.
  -- =====================================================================================
  v_club := pg_temp.club('Finance');
  v_club_b := pg_temp.club('Other');
  v_t12 := pg_temp.team(v_club, 'u12', 'U12', 'Under 12 Boys');
  v_t14 := pg_temp.team(v_club, 'u14', 'U14', 'Under 14 Boys');
  v_admin := pg_temp.person('Admin');
  v_viewer := pg_temp.person('Viewer');
  v_tm := pg_temp.person('Manager');
  v_parent := pg_temp.person('Parent');
  v_admin_b := pg_temp.person('AdminB');
  perform pg_temp.member(v_club, v_admin, 'CLUB_ADMIN');
  perform pg_temp.member(v_club, v_viewer, 'BASIC_USER');
  v_ms_tm := pg_temp.member(v_club, v_tm, 'BASIC_USER');
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms_tm, v_t12, 'manager');
  perform pg_temp.member(v_club_b, v_admin_b, 'CLUB_ADMIN');
  v_admin_sess := pg_temp.session(v_admin, 'aal2', true);
  v_viewer_sess := pg_temp.session(v_viewer, 'aal1', false);
  v_tm_sess := pg_temp.session(v_tm, 'aal1', false);
  v_admin_b_sess := pg_temp.session(v_admin_b, 'aal2', true);
  v_child12 := pg_temp.player('Child12', 11, v_t12);
  v_child14 := pg_temp.player('Child14', 13, v_t14);

  -- The programme and the price through the web's own operations, as the Club Admin.
  perform pg_temp.act('authenticated', v_admin, v_admin_sess);
  v_programme := public.configure_subscription_programme(v_club, true, 1, 'NONE', 'PRORATE_CURRENT_MONTH');
  perform public.set_subscription_price(v_programme, 1500, current_date);
  -- The view-only holder: the web's own override operation, at club scope, for the one key.
  perform public.set_capability_override(v_viewer, 'finance.subscription.view', 'club', v_club, null, 'grant', 'CA-M11.1 suite: a view-only finance holder', null);
  perform pg_temp.act('authenticated', v_admin_b, v_admin_b_sess);
  v_programme_b := public.configure_subscription_programme(v_club_b, true, 1, 'NONE', 'NEXT_COLLECTION_DAY');
  perform pg_temp.act_postgres();

  select id into v_pricing from public.club_subscription_pricing where programme_id = v_programme order by effective_from desc limit 1;
  insert into public.player_subscription_payers (player_id, programme_id, payer_user_id, relationship, status, created_by)
  values (v_child12, v_programme, v_parent, 'guardian', 'active', v_admin) returning id into v_payer12;
  insert into public.player_subscription_payers (player_id, programme_id, payer_user_id, relationship, status, created_by)
  values (v_child14, v_programme, v_parent, 'guardian', 'active', v_admin) returning id into v_payer14;
  insert into public.membership_obligations (programme_id, club_id, player_id, payer_subscription_id, pricing_id, billing_period, amount_due_minor, currency, due_date, status)
  values (v_programme, v_club, v_child12, v_payer12, v_pricing, v_prev, 1500, 'GBP', v_prev + 5, 'FAILED') returning id into v_ob12;
  insert into public.membership_obligations (programme_id, club_id, player_id, payer_subscription_id, pricing_id, billing_period, amount_due_minor, currency, due_date, status)
  values (v_programme, v_club, v_child14, v_payer14, v_pricing, v_prev, 1500, 'GBP', v_prev + 5, 'PAID');

  perform pg_temp.check(v_programme is not null and v_pricing is not null and v_payer12 is not null and v_ob12 is not null,
    'CF-0 seeded: two clubs, two sides, a Club Admin, a view-only holder, a Team Manager on U12, a parent, a programme, a price, two payers, two obligations');

  -- =====================================================================================
  -- CF-A. The view-only holder: reads, and is refused every write by the RPC's own gate.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_viewer, v_viewer_sess);
  select count(*) into v_n from public.my_capabilities('club', v_club) where allowed and capability_key = 'finance.subscription.view';
  select count(*) into v_m from public.my_capabilities('club', v_club) where allowed and capability_key in
    ('finance.subscription.configure','finance.enrolment.manage','finance.payment.act','finance.subscription.export','finance.gocardless.connect','finance.platform_billing.view','finance.platform_billing.manage');
  perform pg_temp.check(v_n = 1 and v_m = 0, format('CF-A1 the probe the phone makes says view (%s) and nothing else (%s)', v_n, v_m));

  v_n := pg_temp.rows_of(format('select 1 from public.membership_obligations where club_id = %L', v_club));
  v_m := pg_temp.rows_of(format('select 1 from public.get_finance_action_required(%L)', v_club));
  v_k := pg_temp.rows_of(format('select 1 from public.get_membership_operational_detail(%L)', v_payer12));
  perform pg_temp.check(v_n = 2 and v_m >= 0 and v_k = 1, format('CF-A2 reads the ledger (%s rows), the review reasons (%s) and one membership''s detail (%s)', v_n, v_m, v_k));

  v_state := pg_temp.try(format('select public.configure_subscription_programme(%L, true, 5, ''NONE'', ''NEXT_COLLECTION_DAY'')', v_club));
  v_text := pg_temp.try(format('select public.set_subscription_price(%L, 1600, current_date)', v_programme));
  perform pg_temp.check(v_state = '42501' and v_text = '42501', format('CF-A3 refused the programme (%s) and the price (%s)', v_state, v_text));
  v_state := pg_temp.try(format('select public.set_obligation_exemption(%L, ''WAIVED'', ''suite'')', v_ob12));
  v_text := pg_temp.try(format('select public.create_membership_obligations_for_period(%L, %L)', v_club, v_this));
  perform pg_temp.check(v_state = '42501' and v_text = '42501', format('CF-A4 refused the waive (%s) and the generation (%s)', v_state, v_text));
  v_state := pg_temp.try(format('select * from public.export_finance_rows(%L, %L)', v_club, v_prev));
  v_text := pg_temp.try(format('select public.disconnect_gocardless(%L, ''suite'')', v_club));
  perform pg_temp.check(v_state = '42501' and v_text = '42501', format('CF-A5 refused the export (%s) and the disconnect (%s)', v_state, v_text));
  v_state := pg_temp.try(format('select public.record_payment_refund(%L, 100, ''suite'')', gen_random_uuid()));
  v_text := pg_temp.try(format('select public.end_membership_subscription(%L, ''suite'', %L)', v_payer12, v_viewer));
  perform pg_temp.check(v_state <> 'OK' and v_text <> 'OK', format('CF-A6 refused the refund (%s) and the cancellation (%s) -- the web-tier provider writes', v_state, v_text));
  v_n := pg_temp.rows_of(format('select 1 from public.get_gocardless_connection_status(%L)', v_club));
  v_m := pg_temp.rows_of(format('select 1 from public.get_active_subscription_impact(%L)', v_club));
  perform pg_temp.check(v_n = 0 and v_m = 0, format('CF-A7 the connection status (%s rows) and the disconnect impact (%s rows) are empty without the GoCardless and configure keys -- no existence signal, which is why the phone asks the probe first and says "status not shown" rather than drawing "Disconnected"', v_n, v_m));
  perform pg_temp.act_postgres();
  select status into v_text from public.membership_obligations where id = v_ob12;
  select collection_day into v_n from public.club_subscription_programmes where id = v_programme;
  select count(*) into v_m from public.club_subscription_pricing where programme_id = v_programme;
  perform pg_temp.check(v_text = 'FAILED' and v_n = 1 and v_m = 1, format('CF-A8 nothing changed: obligation %s, collection day %s, %s price row', v_text, v_n, v_m));

  -- =====================================================================================
  -- CF-B. The Team Manager: their own squad only, through the operation; never the ledger.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_tm, v_tm_sess);
  select count(*) into v_n from public.my_capabilities('club', v_club) where allowed and capability_key like 'finance.%';
  select count(*) into v_m from public.my_capabilities('team', v_club, v_t12) where allowed and capability_key = 'finance.subscription.view';
  select count(*) into v_k from public.my_capabilities('team', v_club, v_t12) where allowed and capability_key like 'finance.%' and capability_key <> 'finance.subscription.view';
  perform pg_temp.check(v_n = 0 and v_m = 1 and v_k = 0, format('CF-B1 no club finance key (%s); the team view (%s) and no other team finance key (%s)', v_n, v_m, v_k));
  v_n := pg_temp.rows_of(format('select 1 from public.team_subscription_status(%L) where player_id = %L', v_t12, v_child12));
  v_m := pg_temp.rows_of(format('select 1 from public.team_subscription_status(%L)', v_t12));
  v_state := pg_temp.try(format('select * from public.team_subscription_status(%L)', v_t14));
  perform pg_temp.check(v_n = 1 and v_m = 1 and v_state = '42501', format('CF-B2 own squad answers with its one child (%s of %s rows); the sibling side is refused (%s)', v_n, v_m, v_state));
  v_n := pg_temp.rows_of(format('select 1 from public.membership_obligations where club_id = %L', v_club));
  v_m := pg_temp.rows_of(format('select 1 from public.player_subscription_payers where player_id = %L', v_child12));
  v_state := pg_temp.try(format('select * from public.get_finance_action_required(%L)', v_club));
  v_k := pg_temp.rows_of(format('select 1 from public.get_membership_operational_detail(%L)', v_payer12));
  perform pg_temp.check(v_n = 0 and v_m = 0 and v_state = '42501' and v_k <= 0, format('CF-B3 no ledger row (%s), no payer row (%s), no review reason (%s), no detail (%s)', v_n, v_m, v_state, v_k));
  v_state := pg_temp.try(format('select public.create_membership_obligations_for_period(%L, %L)', v_club, v_this));
  v_text := pg_temp.try(format('select * from public.export_finance_rows(%L, %L)', v_club, v_prev));
  perform pg_temp.check(v_state = '42501' and v_text = '42501', format('CF-B4 refused generation (%s) and export (%s): no team finance escalation', v_state, v_text));
  perform pg_temp.act_postgres();

  -- =====================================================================================
  -- CF-C. Another club's administrator: nothing of this club, everything of their own.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_admin_b, v_admin_b_sess);
  v_n := pg_temp.rows_of(format('select 1 from public.membership_obligations where club_id = %L', v_club));
  v_m := pg_temp.rows_of(format('select 1 from public.club_subscription_programmes where club_id = %L', v_club));
  v_k := pg_temp.rows_of(format('select 1 from public.player_subscription_payers where programme_id = %L', v_programme));
  perform pg_temp.check(v_n = 0 and v_m = 0 and v_k = 0, format('CF-C1 reads no obligation (%s), no programme (%s), no payer (%s) of the other club', v_n, v_m, v_k));
  v_state := pg_temp.try(format('select * from public.get_finance_action_required(%L)', v_club));
  v_text := pg_temp.try(format('select public.configure_subscription_programme(%L, true, 5, ''NONE'', ''NEXT_COLLECTION_DAY'')', v_club));
  perform pg_temp.check(v_state = '42501' and v_text = '42501', format('CF-C2 refused the review reasons (%s) and the configuration (%s)', v_state, v_text));
  v_state := pg_temp.try(format('select public.create_membership_obligations_for_period(%L, %L)', v_club, v_this));
  v_m := pg_temp.rows_of(format('select 1 from public.get_gocardless_connection_status(%L)', v_club));
  v_n := pg_temp.rows_of(format('select 1 from public.club_platform_billing_state(%L)', v_club));
  perform pg_temp.check(v_state = '42501' and v_m = 0 and v_n <= 0, format('CF-C3 refused generation (%s); the connection (%s rows) and the Ovalball Plan (%s rows) are empty answers', v_state, v_m, v_n));
  v_state := pg_temp.try(format('select * from public.get_finance_action_required(%L)', v_club_b));
  v_m := pg_temp.rows_of(format('select 1 from public.club_subscription_programmes where club_id = %L', v_club_b));
  perform pg_temp.check(v_state = 'OK' and v_m = 1, format('CF-C4 their own club still answers (%s, %s programme)', v_state, v_m));
  perform pg_temp.act_postgres();

  -- =====================================================================================
  -- CF-D. Nothing secret is reachable by a client.
  -- =====================================================================================
  select count(*) into v_n from information_schema.role_table_grants where table_schema = 'public' and table_name = 'gocardless_merchant_connections' and grantee in ('authenticated', 'anon');
  perform pg_temp.check(v_n = 0, format('CF-D1 no grant of any kind on the merchant connection to authenticated or anon (%s)', v_n));
  perform pg_temp.act('authenticated', v_admin, v_admin_sess);
  v_state := pg_temp.try('select access_token from public.gocardless_merchant_connections limit 1');
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = '42501', format('CF-D2 the merchant access token is unreadable even by the Club Admin (%s)', v_state));
  select count(*) into v_n from information_schema.columns where table_schema = 'public' and column_name ~* 'account_number|sort_code|iban|bank_account';
  perform pg_temp.check(v_n = 0, format('CF-D3 no bank-account column exists anywhere a client could select (%s)', v_n));
  v_ok := not has_function_privilege('authenticated', 'public.get_gocardless_token_for_club_admin_action(uuid, uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.get_gocardless_token_for_payer_subscription(uuid, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.get_gocardless_token_for_club_admin_action(uuid, uuid)', 'execute');
  perform pg_temp.check(v_ok, 'CF-D4 the token functions are service-role only');
  select string_agg(pg_get_function_result(p.oid), ' ') into v_text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('get_membership_operational_detail', 'export_finance_rows', 'team_subscription_status', 'get_gocardless_connection_status', 'get_finance_action_required');
  perform pg_temp.check(v_text !~* 'token|account_number|sort_code|iban|secret|payload|authorisation_url', 'CF-D5 the result shapes the phone consumes carry no token, bank or raw-payload column');

  -- =====================================================================================
  -- CF-E. The functions the phone calls are the web's, by name and signature.
  -- =====================================================================================
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname, pg_get_function_identity_arguments(p.oid)) in (
    ('create_membership_obligations_for_period', 'p_club_id uuid, p_billing_period date'),
    ('set_obligation_exemption', 'p_obligation_id uuid, p_status text, p_reason text'),
    ('configure_subscription_programme', 'p_club_id uuid, p_enabled boolean, p_collection_day integer, p_platform_fee_mode text, p_first_payment_policy text'),
    ('set_subscription_price', 'p_programme_id uuid, p_amount_minor integer, p_effective_from date'),
    ('configure_sibling_discount_rule', 'p_programme_id uuid, p_ordinal integer, p_discount_type text, p_discount_value integer, p_effective_from date'),
    ('get_sibling_discount_rules', 'p_programme_id uuid'),
    ('disconnect_gocardless', 'p_club_id uuid, p_reason text'),
    ('get_gocardless_connection_status', 'p_club_id uuid'),
    ('get_active_subscription_impact', 'p_club_id uuid'),
    ('preview_first_payment_illustrative', 'p_programme_id uuid, p_membership_start_date date'),
    ('get_finance_action_required', 'p_club_id uuid'),
    ('get_membership_operational_detail', 'p_payer_subscription_id uuid'),
    ('export_finance_rows', 'p_club_id uuid, p_billing_period date'),
    ('select_club_plan', 'p_club_id uuid, p_plan_code text'),
    ('start_club_trial', 'p_club_id uuid'),
    ('club_platform_billing_state', 'p_club_id uuid'),
    ('club_platform_next_collection', 'p_club_id uuid'),
    ('club_referral_summary', 'p_club_id uuid'),
    ('my_capabilities', 'p_scope_type text, p_club_id uuid, p_team_id uuid, p_player_id uuid'))
   and has_function_privilege('authenticated', p.oid, 'execute');
  perform pg_temp.check(v_n = 19, format('CF-E1 all nineteen functions exist with the web''s signatures and are executable by authenticated (%s)', v_n));
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('create_membership_obligations_for_period','set_obligation_exemption','configure_subscription_programme','set_subscription_price','configure_sibling_discount_rule','disconnect_gocardless','export_finance_rows','select_club_plan','start_club_trial')
   and has_function_privilege('anon', p.oid, 'execute');
  perform pg_temp.check(v_n = 0, format('CF-E2 none of the writing functions is executable by anon (%s)', v_n));

  -- =====================================================================================
  -- CF-F. The Club Admin does the work the phone offers.
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_admin, v_admin_sess);
  v_state := pg_temp.try(format('select public.create_membership_obligations_for_period(%L, %L)', v_club, v_this));
  v_n := pg_temp.rows_of(format('select 1 from public.membership_obligations where club_id = %L and billing_period = %L', v_club, v_this));
  v_text := pg_temp.try(format('select public.create_membership_obligations_for_period(%L, %L)', v_club, v_this));
  v_m := pg_temp.rows_of(format('select 1 from public.membership_obligations where club_id = %L and billing_period = %L', v_club, v_this));
  perform pg_temp.check(v_state = 'OK' and v_text = 'OK' and v_n = v_m, format('CF-F1 generation succeeds (%s, %s rows) and is idempotent (%s, %s rows)', v_state, v_n, v_text, v_m));
  v_state := pg_temp.try(format('select public.set_obligation_exemption(%L, ''WAIVED'', ''CA-M11.1 suite: waived from the phone'')', v_ob12));
  perform pg_temp.act_postgres();
  select status into v_text from public.membership_obligations where id = v_ob12;
  select count(*) into v_n from public.finance_audit_log where club_id = v_club and action = 'waived_applied' and target_id = v_ob12 and actor_user_id = v_admin;
  perform pg_temp.check(v_state = 'OK' and v_text = 'WAIVED' and v_n = 1, format('CF-F2 the waive lands (%s -> %s) with its audit row (%s)', v_state, v_text, v_n));
  perform pg_temp.act('authenticated', v_admin, v_admin_sess);
  v_n := pg_temp.rows_of(format('select 1 from public.export_finance_rows(%L, %L)', v_club, v_prev));
  perform pg_temp.act_postgres();
  select count(*) into v_m from public.finance_audit_log where club_id = v_club and action = 'finance_export_generated' and actor_user_id = v_admin;
  perform pg_temp.check(v_n = 2 and v_m >= 1, format('CF-F3 the export returns the period''s rows (%s) and is recorded in the audit (%s)', v_n, v_m));
  perform pg_temp.act('authenticated', v_admin, v_admin_sess);
  v_state := pg_temp.try(format('select public.set_subscription_price(%L, 1600, current_date + 30)', v_programme));
  select count(*) into v_n from public.club_subscription_pricing where programme_id = v_programme;
  select amount_minor into v_m from public.club_subscription_pricing where programme_id = v_programme and effective_from <= current_date order by effective_from desc limit 1;
  perform pg_temp.check(v_state = 'OK' and v_n = 2 and v_m = 1500, format('CF-F4 a future price is appended (%s, %s rows) and today''s price is unchanged (%s)', v_state, v_n, v_m));
  v_state := pg_temp.try(format('select public.configure_sibling_discount_rule(%L, 2, ''PERCENTAGE'', 15)', v_programme));
  select count(*) into v_n from public.get_sibling_discount_rules(v_programme) where ordinal = 2 and discount_type = 'PERCENTAGE' and discount_value = 15;
  perform pg_temp.check(v_state = 'OK' and v_n = 1, format('CF-F5 the 2nd-child rule is saved (%s) and read back (%s)', v_state, v_n));
  v_n := pg_temp.rows_of(format('select 1 from public.preview_first_payment_illustrative(%L, %L)', v_programme, current_date));
  v_m := pg_temp.rows_of(format('select 1 from public.get_gocardless_connection_status(%L)', v_club));
  v_k := pg_temp.rows_of(format('select 1 from public.get_active_subscription_impact(%L)', v_club));
  perform pg_temp.check(v_n = 1 and v_m = 0 and v_k = 1, format('CF-F6 the first-payment preview (%s row) and the disconnect impact (%s row) answer the Club Admin; a club never connected has no connection row (%s) -- the shape both clients read as "not connected"', v_n, v_k, v_m));
  v_state := pg_temp.try(format('select * from public.club_platform_billing_state(%L)', v_club));
  v_text := pg_temp.try(format('select * from public.club_platform_next_collection(%L)', v_club));
  perform pg_temp.act_postgres();
  perform pg_temp.act('authenticated', v_viewer, v_viewer_sess);
  v_n := pg_temp.rows_of(format('select 1 from public.club_platform_billing_state(%L)', v_club));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = 'OK' and v_text = 'OK' and v_n <= 0, format('CF-F7 the Ovalball Plan answers the Club Admin (%s, %s) and not the view-only holder (%s rows)', v_state, v_text, v_n));

  -- =====================================================================================
  -- CF-G. H20 and H25 untouched by this slice.
  -- =====================================================================================
  select valid_scopes::text, inherits_to_team, grant_level into v_text, v_ok, v_state from public.capabilities where key = 'finance.subscription.view';
  perform pg_temp.check(v_text = '{club,team}' and v_ok = false and v_state = 'C', format('CF-G1 finance.subscription.view is still %s, inherits_to_team %s, ceiling %s (H20/H25 owed elsewhere, not moved here)', v_text, v_ok, v_state));
  select count(*) into v_n from public.bundle_capabilities where bundle_key = 'TM' and capability_key = 'finance.subscription.view' and scope_type = 'team';
  select count(*) into v_m from public.capabilities where key like 'finance.%' and key <> 'finance.subscription.view' and 'team' = any(valid_scopes);
  perform pg_temp.check(v_n = 1 and v_m = 0, format('CF-G2 the TM bundle row is present (%s) and no other finance key has team scope (%s)', v_n, v_m));
end $$;

rollback;
