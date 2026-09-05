-- Policy-lock pass permanent regression suite: Parent self-cancellation
-- (including the parent_ui audit-source derivation), the new
-- get_finance_action_required resolver's relationship-change reasons
-- (team move, eligibility loss, guardian-relationship end), and the new
-- get_membership_operational_detail RPC's guardian isolation. Entirely
-- self-contained synthetic fixtures, transactional/self-cleaning -- never
-- touches Foxton's real enrolment. NOT a migration. Run by hand:
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/gocardless_policy_lock_regression.sql

\set ON_ERROR_STOP off
\pset pager off

\echo '=== GoCardless policy-lock regression suite ==='

begin;
create temporary table t_policy_state (k text primary key, v text) on commit drop;
grant all on t_policy_state to authenticated, service_role, anon;

do $$
declare
  v_club uuid := gen_random_uuid();
  v_dir uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_guardian_1 uuid := gen_random_uuid();
  v_guardian_2 uuid := gen_random_uuid();
  v_player_id uuid := gen_random_uuid();
  v_team_1 uuid := gen_random_uuid();
  v_team_2 uuid := gen_random_uuid();
  v_programme_id uuid;
  v_payer_id uuid;
  v_customer_id uuid;
  v_mandate_row_id uuid;
  v_pricing_id uuid;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_admin, 'policy-admin-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_guardian_1, 'policy-g1-' || v_guardian_1::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_guardian_2, 'policy-g2-' || v_guardian_2::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.club_directory (id, name, rugby_code, country, nation, source, normalized_key, verification_status)
  values (v_dir, 'Policy Lock Regression Club', 'union', 'England', 'England', 'manual', 'policy lock regression club', 'verified');
  insert into public.clubs (id, directory_id, slug, status) values (v_club, v_dir, 'policy-lock-regression', 'active');
  insert into public.club_memberships (id, club_id, user_id, role, status) values (gen_random_uuid(), v_club, v_admin, 'CLUB_ADMIN', 'active');
  insert into public.teams (id, club_id, rugby_code, display_name, slug, category, age_group, gender, active, canonical_team_type_id) values
    (v_team_1, v_club, 'union', 'U12', 'u12-policy-lock-1', 'youth', 'U12', 'boys', true, internal.resolve_canonical_team_type('youth', 'U12', 'boys', null)),
    (v_team_2, v_club, 'union', 'U13', 'u13-policy-lock-2', 'youth', 'U13', 'boys', true, internal.resolve_canonical_team_type('youth', 'U13', 'boys', null));
  insert into public.players (id, first_name, surname, date_of_birth, created_by) values (v_player_id, 'Policy', 'Lock', '2014-01-01', v_admin);
  insert into public.player_team_memberships (id, player_id, team_id, status) values (gen_random_uuid(), v_player_id, v_team_1, 'active');
  insert into public.guardians (id, guardian_user_id, player_id, relationship_type, status, created_by) values
    (gen_random_uuid(), v_guardian_1, v_player_id, 'parent', 'active', v_admin),
    (gen_random_uuid(), v_guardian_2, v_player_id, 'parent', 'active', v_admin);

  insert into t_policy_state values
    ('club', v_club::text), ('admin', v_admin::text), ('guardian_1', v_guardian_1::text), ('guardian_2', v_guardian_2::text),
    ('player_id', v_player_id::text), ('team_1', v_team_1::text), ('team_2', v_team_2::text);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_policy_state where k = 'admin';
do $$
declare
  v_programme_id uuid;
begin
  v_programme_id := public.configure_subscription_programme((select v::uuid from t_policy_state where k = 'club'), true, 1, 'NONE', 'PRORATE_CURRENT_MONTH');
  perform public.set_subscription_price(v_programme_id, 1500, current_date);
  insert into t_policy_state values ('programme_id', v_programme_id::text);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_policy_state where k = 'guardian_1';
do $$
declare
  v_payer_id uuid;
begin
  v_payer_id := public.claim_responsible_payer((select v::uuid from t_policy_state where k = 'player_id'), (select v::uuid from t_policy_state where k = 'programme_id'));
  insert into t_policy_state values ('payer_id', v_payer_id::text);
end $$;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare
  v_club_id uuid := (select v::uuid from t_policy_state where k = 'club');
  v_payer_id uuid := (select v::uuid from t_policy_state where k = 'payer_id');
  v_programme_id uuid := (select v::uuid from t_policy_state where k = 'programme_id');
  v_customer_id uuid;
  v_mandate_row_id uuid;
  v_pricing_id uuid;
  v_sub_id uuid;
begin
  insert into public.gocardless_customers (club_id, payer_user_id, gc_customer_id) values (v_club_id, (select v::uuid from t_policy_state where k = 'guardian_1'), 'CU_POLICY_LOCK') returning id into v_customer_id;
  insert into public.gocardless_mandates (club_id, gocardless_customer_id, gc_mandate_id, status, scheme) values (v_club_id, v_customer_id, 'MD_POLICY_LOCK', 'active', 'bacs') returning id into v_mandate_row_id;
  select id into v_pricing_id from public.club_subscription_pricing where programme_id = v_programme_id order by effective_from desc limit 1;
  v_sub_id := public.record_gocardless_subscription(v_payer_id, v_pricing_id, v_mandate_row_id, 'SB_POLICY_LOCK', 1500, 'active');
  insert into t_policy_state values ('sub_id', v_sub_id::text), ('mandate_row_id', v_mandate_row_id::text);
end $$;

\echo '--- 1. Parent self-cancellation: the genuine payer (Guardian 1) can cancel via the same service-role-mediated path cancelOwnMembershipAction uses, and the audit source is correctly derived as parent_ui (not admin_ui) ---'
do $$
declare
  v_status text;
  v_source text;
  v_actor uuid;
begin
  perform public.end_membership_subscription(
    (select v::uuid from t_policy_state where k = 'payer_id'),
    'Parent self-cancellation -- policy lock test',
    (select v::uuid from t_policy_state where k = 'guardian_1')
  );
  select status into v_status from public.player_subscription_payers where id = (select v::uuid from t_policy_state where k = 'payer_id');
  select source, actor_user_id into v_source, v_actor from public.finance_audit_log where target_id = (select v::uuid from t_policy_state where k = 'payer_id') and action = 'membership_cancelled';
  if v_status = 'ended' and v_source = 'parent_ui' and v_actor = (select v::uuid from t_policy_state where k = 'guardian_1') then
    raise notice 'PASS 1: Parent self-cancellation succeeded, membership ended, audit source correctly derived as parent_ui with the real Parent as actor';
  else
    raise notice 'FAIL 1: status=% source=% actor=%', v_status, v_source, v_actor;
  end if;
end $$;

-- Re-activate for the remaining scenarios.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
begin
  update public.player_subscription_payers set status = 'active', effective_to = null, ended_by = null, ended_at = null, end_reason = null
  where id = (select v::uuid from t_policy_state where k = 'payer_id');
end $$;

\echo '--- 2. Relationship-change A: player moves team WITHIN THE SAME CLUB -- no duplicate/cancelled Subscription, programme eligibility unaffected (club-level programme) ---'
do $$
declare
  v_sub_count_before integer;
  v_sub_count_after integer;
  v_sub_status text;
  v_eligibility_flag_count integer;
begin
  select count(*) into v_sub_count_before from public.gocardless_subscriptions where payer_subscription_id = (select v::uuid from t_policy_state where k = 'payer_id');

  update public.player_team_memberships set status = 'ended', ended_at = now() where player_id = (select v::uuid from t_policy_state where k = 'player_id') and team_id = (select v::uuid from t_policy_state where k = 'team_1');
  insert into public.player_team_memberships (id, player_id, team_id, status) values (gen_random_uuid(), (select v::uuid from t_policy_state where k = 'player_id'), (select v::uuid from t_policy_state where k = 'team_2'), 'active');

  select count(*) into v_sub_count_after from public.gocardless_subscriptions where payer_subscription_id = (select v::uuid from t_policy_state where k = 'payer_id');
  select status into v_sub_status from public.gocardless_subscriptions where payer_subscription_id = (select v::uuid from t_policy_state where k = 'payer_id');
  select count(*) into v_eligibility_flag_count from public.get_finance_action_required((select v::uuid from t_policy_state where k = 'club')) where payer_subscription_id = (select v::uuid from t_policy_state where k = 'payer_id') and reason = 'PROGRAMME_ELIGIBILITY_ENDED';

  if v_sub_count_before = v_sub_count_after and v_sub_status = 'active' and v_eligibility_flag_count = 0 then
    raise notice 'PASS 2: same-club team move left the club-level Subscription completely untouched (count %, status %), no eligibility flag (still eligible via Team 2)', v_sub_count_after, v_sub_status;
  else
    raise notice 'FAIL 2: sub_count before=% after=% status=% eligibility_flags=%', v_sub_count_before, v_sub_count_after, v_sub_status, v_eligibility_flag_count;
  end if;
end $$;

\echo '--- 3. Relationship-change B/C: player loses ALL team membership at this club (club exit / eligibility loss) -- PROGRAMME_ELIGIBILITY_ENDED review flag, NO automatic financial mutation ---'
do $$
declare
  v_payer_status_before text;
  v_sub_status_before text;
  v_payer_status_after text;
  v_sub_status_after text;
  v_flag_count integer;
begin
  select status into v_payer_status_before from public.player_subscription_payers where id = (select v::uuid from t_policy_state where k = 'payer_id');
  select status into v_sub_status_before from public.gocardless_subscriptions where payer_subscription_id = (select v::uuid from t_policy_state where k = 'payer_id');

  update public.player_team_memberships set status = 'ended', ended_at = now() where player_id = (select v::uuid from t_policy_state where k = 'player_id') and team_id = (select v::uuid from t_policy_state where k = 'team_2');

  select status into v_payer_status_after from public.player_subscription_payers where id = (select v::uuid from t_policy_state where k = 'payer_id');
  select status into v_sub_status_after from public.gocardless_subscriptions where payer_subscription_id = (select v::uuid from t_policy_state where k = 'payer_id');
  select count(*) into v_flag_count from public.get_finance_action_required((select v::uuid from t_policy_state where k = 'club')) where payer_subscription_id = (select v::uuid from t_policy_state where k = 'payer_id') and reason = 'PROGRAMME_ELIGIBILITY_ENDED';

  if v_payer_status_before = v_payer_status_after and v_sub_status_before = v_sub_status_after and v_flag_count = 1 then
    raise notice 'PASS 3: losing all team membership at this club produced exactly one PROGRAMME_ELIGIBILITY_ENDED review flag, with ZERO automatic mutation of payer/Subscription status (still % / %)', v_payer_status_after, v_sub_status_after;
  else
    raise notice 'FAIL 3: payer before=% after=%, sub before=% after=%, flags=%', v_payer_status_before, v_payer_status_after, v_sub_status_before, v_sub_status_after, v_flag_count;
  end if;

  -- Restore eligibility for the remaining scenarios.
  insert into public.player_team_memberships (id, player_id, team_id, status) values (gen_random_uuid(), (select v::uuid from t_policy_state where k = 'player_id'), (select v::uuid from t_policy_state where k = 'team_1'), 'active');
end $$;

\echo '--- 4. Relationship-change D: payer Guardian relationship ends -- PAYER_RELATIONSHIP_REQUIRES_REVIEW flag, NO payer transfer, NO automatic mutation ---'
do $$
declare
  v_payer_status_before text;
  v_payer_user_id_before uuid;
  v_payer_status_after text;
  v_payer_user_id_after uuid;
  v_flag_count integer;
begin
  select status, payer_user_id into v_payer_status_before, v_payer_user_id_before from public.player_subscription_payers where id = (select v::uuid from t_policy_state where k = 'payer_id');

  update public.guardians set status = 'revoked' where player_id = (select v::uuid from t_policy_state where k = 'player_id') and guardian_user_id = (select v::uuid from t_policy_state where k = 'guardian_1');

  select status, payer_user_id into v_payer_status_after, v_payer_user_id_after from public.player_subscription_payers where id = (select v::uuid from t_policy_state where k = 'payer_id');
  select count(*) into v_flag_count from public.get_finance_action_required((select v::uuid from t_policy_state where k = 'club')) where payer_subscription_id = (select v::uuid from t_policy_state where k = 'payer_id') and reason = 'PAYER_RELATIONSHIP_REQUIRES_REVIEW';

  if v_payer_status_before = v_payer_status_after and v_payer_user_id_before = v_payer_user_id_after and v_payer_user_id_after = (select v::uuid from t_policy_state where k = 'guardian_1') and v_flag_count = 1 then
    raise notice 'PASS 4: revoking the payer''s Guardian relationship produced exactly one PAYER_RELATIONSHIP_REQUIRES_REVIEW flag -- payer_user_id was NEVER transferred (still the original Guardian 1), no automatic status mutation';
  else
    raise notice 'FAIL 4: payer status before=% after=%, payer_user_id before=% after=%, flags=%', v_payer_status_before, v_payer_status_after, v_payer_user_id_before, v_payer_user_id_after, v_flag_count;
  end if;
end $$;

\echo '--- 5. Relationship-change E: Guardian 2 remains actively related but never inherits payer authority (already partially proven in Test 6 -- re-confirmed here after Guardian 1''s relationship was revoked) ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_policy_state where k = 'guardian_2';
do $$
begin
  perform public.end_membership_subscription((select v::uuid from t_policy_state where k = 'payer_id'), 'Guardian 2 attempting to cancel despite Guardian 1''s revoked relationship');
  raise notice 'FAIL 5: Guardian 2 (a remaining active but non-payer guardian) was able to cancel the membership';
exception when others then
  raise notice 'PASS 5: Guardian 2 correctly denied -- remaining actively related to the player does not grant payer authority -- %', sqlerrm;
end $$;

\echo '--- 6. No financial/payer detail exposed to a non-payer guardian via get_membership_operational_detail (new RPC introduced this pass) ---'
do $$
begin
  perform public.get_membership_operational_detail((select v::uuid from t_policy_state where k = 'payer_id'));
  raise notice 'FAIL 6: Guardian 2 (non-payer, no club capability) was able to read membership operational detail';
exception when others then
  raise notice 'PASS 6: Guardian 2 correctly denied reading membership operational detail -- %', sqlerrm;
end $$;

\echo '--- 7. Cross-club Parent cannot cancel (new RPC signature re-check after the parent_ui fix) ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
do $$
begin
  perform public.end_membership_subscription((select v::uuid from t_policy_state where k = 'payer_id'), 'Completely unrelated user attempting to cancel');
  raise notice 'FAIL 7: a completely unrelated user was able to cancel the membership';
exception when others then
  raise notice 'PASS 7: unrelated user correctly denied -- %', sqlerrm;
end $$;

\echo '--- 8. Authorized Club Finance (the real admin) can still cancel -- positive control, proving Sections 1-7''s changes did not break the legitimate admin path ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_policy_state where k = 'admin';
do $$
declare
  v_status text;
  v_source text;
begin
  perform public.end_membership_subscription((select v::uuid from t_policy_state where k = 'payer_id'), 'Admin cancellation -- positive control after policy-lock changes');
  select status into v_status from public.player_subscription_payers where id = (select v::uuid from t_policy_state where k = 'payer_id');
  select source into v_source from public.finance_audit_log where target_id = (select v::uuid from t_policy_state where k = 'payer_id') and action = 'membership_cancelled' order by created_at desc limit 1;
  if v_status = 'ended' then
    raise notice 'PASS 8: the legitimate Club Admin cancellation path still works correctly after the policy-lock changes (audit source recorded as %)', v_source;
  else
    raise notice 'FAIL 8: expected ended, got %', v_status;
  end if;
end $$;

rollback;

\echo '=== Suite complete. Every line above must read PASS. ==='
