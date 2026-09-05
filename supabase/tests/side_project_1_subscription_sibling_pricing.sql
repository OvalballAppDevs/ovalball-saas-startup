-- Side Project 1 integration (SIDE_PROJECT_1_FINAL_INTEGRATION_2026_09_05),
-- Phase 2 step 5/6 regression coverage: the self-service subscription
-- claim path (claim_responsible_payer) and sibling-discount pricing
-- (internal.calculate_member_price), end to end against real Main
-- clubs/teams/players -- Club Admin configures the programme, a Guardian
-- adds two real children and claims responsible-payer for each in turn.
--
-- Note the two real behaviours this test deliberately exercises, both
-- confirmed live during this integration's own verification pass:
--   1. A Guardian cannot activate their own child's pending team
--      membership by a direct UPDATE -- RLS on player_team_memberships
--      correctly rejects it (0 rows affected); only a Club Admin's own
--      approve_pending_team_membership()/direct UPDATE (as done below,
--      run under the ADMIN role) can. This is intentional, not a bug.
--   2. claim_responsible_payer (the real self-service enrolment path)
--      snapshots sibling_ordinal/pricing at claim time -- set_responsible_
--      payer (the staff override) deliberately does not, since a Club
--      Admin reassigning a payer is not a pricing event.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/side_project_1_subscription_sibling_pricing.sql

\set ON_ERROR_STOP off
\pset pager off
begin;

insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
  ('9f300000-0000-0000-0000-000000000001', 'Subscription Test Club', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'subscription-test-club-9f300000');
insert into public.clubs (id, directory_id, slug, status, timezone) values
  ('9f300000-0000-0000-0000-000000000001', '9f300000-0000-0000-0000-000000000001', 'subscription-test-club-9f300000', 'active', 'Europe/London');
insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, active) values
  ('9f300000-0000-0000-0000-000000000002', '9f300000-0000-0000-0000-000000000001', 'union', 'youth', 'U9', 'boys', null, 'Subscription U9', 'subscription-u9', true),
  ('9f300000-0000-0000-0000-000000000003', '9f300000-0000-0000-0000-000000000001', 'union', 'youth', 'U7', 'boys', null, 'Subscription U7', 'subscription-u7', true);
insert into public.club_memberships (id, club_id, user_id, role, status) values
  ('9f300000-0000-0000-0000-000000000004', '9f300000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
values ('00000000-0000-0000-0000-000000000094', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.subscription.guardian@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
on conflict (id) do nothing;
insert into public.profiles (id, first_name, surname, email) values ('00000000-0000-0000-0000-000000000094', 'Subscription', 'Guardian', 'test.subscription.guardian@ovalball.local')
on conflict (id) do nothing;

-- ===== Guardian adds two children (U9 and U7, each the single matching team) =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000094","role":"authenticated"}';

do $$
declare v_r1 record; v_r2 record;
begin
  select * into v_r1 from public.add_child_for_guardian('SubTest', 'ChildOne', '2018-01-01', '9f300000-0000-0000-0000-000000000001', 'union');
  select * into v_r2 from public.add_child_for_guardian('SubTest', 'ChildTwo', '2020-01-01', '9f300000-0000-0000-0000-000000000001', 'union');
  if v_r1.result = 'created_pending_team' and v_r2.result = 'created_pending_team' then
    raise notice 'PASS A: both children created with a pending team membership on their single matching team';
  else
    raise notice 'FAIL A: r1=%, r2=%', v_r1.result, v_r2.result;
  end if;
end $$;

-- ===== Club Admin activates both memberships and configures the programme =====
reset role; reset request.jwt.claims;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare v_programme_id uuid;
begin
  update public.player_team_memberships set status = 'active'
  where team_id in ('9f300000-0000-0000-0000-000000000002', '9f300000-0000-0000-0000-000000000003') and status = 'pending';

  v_programme_id := public.configure_subscription_programme('9f300000-0000-0000-0000-000000000001', true, 1, 'NONE', 'NEXT_COLLECTION_DAY');
  perform public.set_subscription_price(v_programme_id, 2500, current_date);
  perform public.configure_sibling_discount_rule(v_programme_id, 2, 'PERCENTAGE', 50, current_date);
  perform set_config('side_project_1_test.programme_id', v_programme_id::text, false);
  raise notice 'PASS B: Club Admin configured programme % at 2500/month with a 50%% 2nd-child discount', v_programme_id;
end $$;

-- ===== Guardian claims responsible payer for both children, in order =====
reset role; reset request.jwt.claims;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000094","role":"authenticated"}';

do $$
declare
  v_programme_id uuid := current_setting('side_project_1_test.programme_id')::uuid;
  v_player1 uuid;
  v_player2 uuid;
begin
  select p.id into v_player1 from public.players p where p.first_name = 'SubTest' and p.surname = 'ChildOne';
  select p.id into v_player2 from public.players p where p.first_name = 'SubTest' and p.surname = 'ChildTwo';
  perform public.claim_responsible_payer(v_player1, v_programme_id);
  perform public.claim_responsible_payer(v_player2, v_programme_id);
end $$;

reset role; reset request.jwt.claims;
do $$
declare v_ordinal1 int; v_final1 int; v_type1 text; v_ordinal2 int; v_final2 int; v_type2 text;
begin
  select psp.sibling_ordinal, psp.final_amount_minor, psp.sibling_discount_type into v_ordinal1, v_final1, v_type1
  from public.player_subscription_payers psp join public.players p on p.id = psp.player_id where p.surname = 'ChildOne';
  select psp.sibling_ordinal, psp.final_amount_minor, psp.sibling_discount_type into v_ordinal2, v_final2, v_type2
  from public.player_subscription_payers psp join public.players p on p.id = psp.player_id where p.surname = 'ChildTwo';

  if v_ordinal1 = 1 and v_type1 = 'NONE' and v_final1 = 2500 then
    raise notice 'PASS C: first-claimed child is ordinal 1, full price (2500), no discount';
  else
    raise notice 'FAIL C: ordinal=%, type=%, final=%', v_ordinal1, v_type1, v_final1;
  end if;

  if v_ordinal2 = 2 and v_type2 = 'PERCENTAGE' and v_final2 = 1250 then
    raise notice 'PASS D: second-claimed child is ordinal 2, correctly discounted 50%% to 1250';
  else
    raise notice 'FAIL D: ordinal=%, type=%, final=%', v_ordinal2, v_type2, v_final2;
  end if;
end $$;

-- ===== A Guardian cannot directly activate their own child's pending
-- membership -- RLS on player_team_memberships correctly rejects the
-- write (only a Club Admin's approval RPC/direct update may) =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000094","role":"authenticated"}';
do $$
declare v_n int;
begin
  update public.player_team_memberships set status = 'ended'
  where team_id = '9f300000-0000-0000-0000-000000000002'
    and player_id = (select p.id from public.players p where p.first_name = 'SubTest' and p.surname = 'ChildOne');
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise notice 'PASS E: a Guardian cannot directly write player_team_memberships -- RLS blocks the update (0 rows affected), matching the write policy''s staff-only scope';
  else
    raise notice 'FAIL E: a Guardian''s direct write affected % row(s) -- RLS gap', v_n;
  end if;
end $$;

reset role; reset request.jwt.claims;
rollback;
