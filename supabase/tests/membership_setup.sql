-- =====================================================================================================
-- CLUB MEMBERSHIPS PART 1: SETUP, MEMBERSHIPS, OVALBALL'S FEE AND ACTIVATION (20270748000000)
--
--   SU1-SU9   SETUP AND ACTIVATION: the first save creates the programme switched off with one membership
--             covering every team; readiness names what is missing; Activate is re-derived on the server
--             (connection, verification, the fee choice, a priced membership with a team), idempotent and
--             audited; the setup read carries no secret; only the club's finance holders can see or change it;
--             the old configure door saves settings only -- it can neither switch memberships on (Activate's)
--             nor stop new ones (Pause's), asks authority first, and still needs a fee choice.
--   SP1-SP6   MEMBERSHIPS: several per club, one per team; archiving guards what members hold and an active
--             programme's last membership; new teams join a lone membership automatically; prices are
--             effective-dated and at least £1.
--   SR1-SR4   ONE MEMBERSHIP PER PLAYER (owner-locked): the higher-priced applies; the club can switch it while
--             it applies and before a Direct Debit is set up.
--   SE1-SE4   ENROLMENT keeps what it was set up with: membership, collection day, policy and fee terms.
--   SF1-SF6   THE FEE: 2.5% half up per payment; the club or its members pay it; nothing on a free month or a
--             part month below the £1 minimum, and one member's free month stops nobody else's.
--   SFP1-SFP4 WHERE THE FEE STANDS through a payment's life: pending, earned, returned on failure or chargeback,
--             nothing on a cancellation, unresolved on a refund (never counted early); recording twice keeps one.
--   SPA1-SPA2 PAUSING stops new memberships and never strands the existing ones; resuming is the Activate door.
--   SX1-SX3   THE WORKED EXAMPLE the setup screens show, calculated on the server.
--   SST1      WHO NEEDS MEMBERSHIP: a player in a team with no membership is not asked.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.
-- =====================================================================================================

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create temp table ctx (k text primary key, v uuid) on commit drop;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ctx where k = p_k $$;
create or replace function pg_temp.put(p_k text, p_v uuid) returns uuid language sql as $$
  insert into ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v returning v $$;
create or replace function pg_temp.dob(p_age text) returns date language sql as $$
  select internal.date_of_birth_in_age_grade('union', p_age) $$;
create or replace function pg_temp.period() returns date language sql as $$ select date_trunc('month', current_date)::date $$;

create or replace function pg_temp.person(p_label text, p_dob date default (current_date - interval '40 years')::date)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_email text := 'msu-' || lower(p_label) || '-' || v::text || '@ovalball.test';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_email,'',now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
  values (v, p_label, 'Setup', v_email, p_dob, 'ACTIVE')
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth, account_state = 'ACTIVE';
  return v;
end $$;

create or replace function pg_temp.as_(p_subject uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.off() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
end $$;
create or replace function pg_temp.say_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v_state text; v_msg text;
begin
  perform pg_temp.as_(p_subject);
  set local role authenticated;
  begin execute p_sql; v_state := 'OK'; exception when others then get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text; end;
  reset role;
  perform pg_temp.off();
  return v_state || coalesce(': ' || v_msg, '');
end $$;
create or replace function pg_temp.json_as(p_subject uuid, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.as_(p_subject);
  set local role authenticated;
  execute p_sql into v;
  reset role;
  perform pg_temp.off();
  return v;
end $$;
create or replace function pg_temp.uuid_as(p_subject uuid, p_sql text) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp.as_(p_subject);
  set local role authenticated;
  execute p_sql into v;
  reset role;
  perform pg_temp.off();
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_tag text := substr(gen_random_uuid()::text, 1, 8); v_dir uuid; v uuid;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values (p_label || ' ' || v_tag || ' RFC', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'msu-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'msu-' || v_tag, 'active') returning id into v;
  return v;
end $$;
create or replace function pg_temp.team(p_club uuid, p_name text, p_category text, p_age text, p_gender text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, p_name, 'msu-' || substr(gen_random_uuid()::text, 1, 12), p_category, p_age, p_gender, 'union', true) returning id into v;
  return v;
end $$;
create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;
create or replace function pg_temp.player(p_key text, p_dob date, p_parent uuid, p_team uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.players (first_name, surname, date_of_birth, active, playing_pathway)
  values (initcap(p_key), 'Setup', p_dob, true, 'MALE') returning id into v;
  if p_parent is not null then
    insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source)
    values (p_parent, v, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD');
  end if;
  if p_team is not null then
    insert into public.player_team_memberships (player_id, team_id, status, state, source) values (v, p_team, 'active', 'ACTIVE', 'CLUB_CREATED');
  end if;
  perform pg_temp.put(p_key, v);
  return v;
end $$;
create or replace function pg_temp.connect(p_club uuid, p_verification text) returns void language plpgsql as $$
begin
  insert into public.gocardless_merchant_connections (club_id, environment, gc_organisation_id, access_token, scope, verification_status, connected_by, connected_at)
  values (p_club, 'sandbox', 'OR_MSU_' || substr(p_club::text, 1, 8), null, 'read_write', p_verification, pg_temp.id('ca'), now())
  on conflict (club_id) do update set verification_status = excluded.verification_status, disconnected_at = null, disconnected_by = null;
end $$;
create or replace function pg_temp.product(p_name text) returns uuid language sql as $$
  select id from public.membership_products where club_id = pg_temp.id('club') and name = p_name and status = 'active' $$;
create or replace function pg_temp.obligation(p_key text) returns public.membership_obligations language sql as $$
  select o.* from public.membership_obligations o where o.player_id = pg_temp.id(p_key) and o.billing_period = pg_temp.period() $$;

-- =====================================================================================================
-- SEED: a club (Under 12s, Under 13s, Under 18s, a men's side), its Club Admin, a Team Manager and a coach,
-- two parents, an outsider administrator of another club.
-- =====================================================================================================
do $$
declare v_club uuid; v_other uuid; v_ms uuid;
begin
  v_club := pg_temp.put('club', pg_temp.club('Setup'));
  perform pg_temp.put('u12', pg_temp.team(v_club, 'Under 12 Boys', 'youth', 'U12', 'boys'));
  perform pg_temp.put('u13', pg_temp.team(v_club, 'Under 13 Boys', 'youth', 'U13', 'boys'));
  perform pg_temp.put('u18', pg_temp.team(v_club, 'Under 18 Boys', 'youth', 'U18', 'boys'));
  perform pg_temp.put('men', pg_temp.team(v_club, 'Men''s 1st Team', 'senior', null, 'mens'));
  perform pg_temp.put('ca', pg_temp.person('Clubadmin'));
  perform pg_temp.member(v_club, pg_temp.id('ca'), 'CLUB_ADMIN');
  perform pg_temp.put('tm', pg_temp.person('Manager'));
  v_ms := pg_temp.member(v_club, pg_temp.id('tm'));
  perform internal.grant_role(v_ms, 'TEAM_MANAGER', pg_temp.id('u12'), 'LEGACY_BACKFILL', 'msu seed');
  perform pg_temp.put('coach', pg_temp.person('Coach'));
  v_ms := pg_temp.member(v_club, pg_temp.id('coach'));
  perform internal.grant_role(v_ms, 'COACH', pg_temp.id('u12'), 'LEGACY_BACKFILL', 'msu seed');
  perform pg_temp.put('pam', pg_temp.person('Pam'));
  perform pg_temp.put('gus', pg_temp.person('Gus'));
  v_other := pg_temp.put('other_club', pg_temp.club('Elsewhere'));
  perform pg_temp.put('other_ca', pg_temp.person('Otheradmin'));
  perform pg_temp.member(v_other, pg_temp.id('other_ca'), 'CLUB_ADMIN');
  perform pg_temp.player('abe', pg_temp.dob('U12'), pg_temp.id('pam'), pg_temp.id('u12'));
  perform pg_temp.player('ben', pg_temp.dob('U13'), pg_temp.id('pam'), pg_temp.id('u13'));
  perform pg_temp.player('cal', pg_temp.dob('U12'), pg_temp.id('gus'), pg_temp.id('u12'));
end $$;

-- =====================================================================================================
-- SU: SETUP AND ACTIVATION
-- =====================================================================================================
do $$
declare v jsonb; v_prog uuid;
begin
  -- Nothing yet: the setup read says so.
  v := pg_temp.json_as(pg_temp.id('ca'), format('select public.membership_setup_state(%L)', pg_temp.id('club')));
  perform pg_temp.check(v ->> 'state' = 'NOT_STARTED' and v -> 'connection' ->> 'state' = 'NOT_CONNECTED' and (v ->> 'fee_bps')::int = 250
                          and (v ->> 'can_configure')::boolean,
    'SU0 before setup the club reads NOT_STARTED, not connected, Ovalball''s fee as 250 basis points (' || coalesce(v ->> 'state', '-') || ')');

  v_prog := pg_temp.uuid_as(pg_temp.id('ca'), format('select public.save_membership_settings(%L, 1, %L, null)', pg_temp.id('club'), 'PRORATE_CURRENT_MONTH'));
  perform pg_temp.put('programme', v_prog);
  perform pg_temp.check(
    (select not enabled and activated_at is null and platform_fee_mode = 'NONE' from public.club_subscription_programmes where id = v_prog)
    and (select count(*) from public.membership_products where programme_id = v_prog and status = 'active') = 1
    and (select count(*) from public.membership_product_teams where product_id = pg_temp.product('Club Membership')) = 4,
    'SU1 the first save creates the programme switched off, with one Club Membership covering all four teams');

  v := pg_temp.json_as(pg_temp.id('ca'), format('select public.membership_setup_state(%L)', pg_temp.id('club')));
  perform pg_temp.check(v ->> 'state' = 'SETTING_UP'
      and (v -> 'readiness' -> 'missing') ? 'CONNECT' and (v -> 'readiness' -> 'missing') ? 'FEE' and (v -> 'readiness' -> 'missing') ? 'MEMBERSHIP'
      and not (v -> 'readiness' ->> 'can_activate')::boolean,
    'SU2 readiness names what is missing: connect, the fee choice, a priced membership (' || coalesce((v -> 'readiness' -> 'missing')::text, '-') || ')');
  perform pg_temp.check((v -> 'readiness' -> 'missing') ? 'TERMS' and not (v -> 'terms' ->> 'accepted')::boolean
                        and v -> 'terms' ->> 'version' = 'club-memberships-2026-10-06-proposed',
    'SU2b and that the club has not yet agreed to the fee and to what Ovalball does on its GoCardless account');

  perform pg_temp.check(pg_temp.say_as(pg_temp.id('ca'), format('select public.activate_membership_programme(%L)', pg_temp.id('club'))) like '23514%connect GoCardless%',
    'SU3 Activate is refused while not ready, saying what is missing');
  perform pg_temp.check((select not enabled from public.club_subscription_programmes where id = v_prog), 'SU3b and nothing was switched on');

  -- The club agrees -- to the wording it was shown, by its own finance holder.
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('ca'), format('select public.accept_club_membership_terms(%L, %L)', pg_temp.id('club'), 'an-older-wording')) like '22023%',
    'SU2c agreement is to the current wording only: a stale screen''s version is refused');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('tm'), format('select public.accept_club_membership_terms(%L, %L)', pg_temp.id('club'), 'club-memberships-2026-10-06-proposed')) like '42501%',
    'SU2d a Team Manager cannot agree for the club');
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.accept_club_membership_terms(%L, %L)', pg_temp.id('club'), 'club-memberships-2026-10-06-proposed'));
  v := pg_temp.json_as(pg_temp.id('ca'), format('select public.membership_setup_state(%L)', pg_temp.id('club')));
  perform pg_temp.check((v -> 'terms' ->> 'accepted')::boolean and v -> 'terms' ->> 'accepted_by_name' = 'Clubadmin Setup' and not ((v -> 'readiness' -> 'missing') ? 'TERMS')
      and exists (select 1 from public.finance_audit_log where club_id = pg_temp.id('club') and action = 'membership_terms_accepted'),
    'SU2e the Club Admin agrees: recorded with who and when, audited, and no longer missing');

  -- The club chooses that it bears the fee and prices its membership; GoCardless is connected but in review.
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.save_membership_settings(%L, 1, %L, %L)', pg_temp.id('club'), 'PRORATE_CURRENT_MONTH', 'CLUB'));
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.set_membership_product_price(%L, 1600, current_date)', pg_temp.product('Club Membership')));
  perform pg_temp.connect(pg_temp.id('club'), 'in_review');
  v := pg_temp.json_as(pg_temp.id('ca'), format('select public.membership_setup_state(%L)', pg_temp.id('club')));
  perform pg_temp.check(v -> 'connection' ->> 'state' = 'VERIFYING' and (v -> 'readiness' -> 'missing') = '["VERIFY"]'::jsonb,
    'SU4 a connected account GoCardless is still reviewing blocks only on verification (' || coalesce((v -> 'readiness' -> 'missing')::text, '-') || ')');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('ca'), format('select public.activate_membership_programme(%L)', pg_temp.id('club'))) like '23514%verified%',
    'SU4b and Activate says GoCardless has not verified the account');

  perform pg_temp.connect(pg_temp.id('club'), 'successful');
  v := pg_temp.json_as(pg_temp.id('ca'), format('select public.activate_membership_programme(%L)', pg_temp.id('club')));
  perform pg_temp.check(v ->> 'outcome' = 'ACTIVATED' and (select enabled and activated_at is not null from public.club_subscription_programmes where id = v_prog),
    'SU5 with a verified account, a fee choice and a priced membership with teams, Activate switches memberships on');
  v := pg_temp.json_as(pg_temp.id('ca'), format('select public.activate_membership_programme(%L)', pg_temp.id('club')));
  perform pg_temp.check(v ->> 'outcome' = 'ALREADY_ACTIVE'
      and (select count(*) from public.finance_audit_log where club_id = pg_temp.id('club') and action = 'programme_activated') = 1,
    'SU5b a second Activate changes nothing and is audited once');

  v := pg_temp.json_as(pg_temp.id('ca'), format('select public.membership_setup_state(%L)', pg_temp.id('club')));
  perform pg_temp.check(v ->> 'state' = 'ACTIVE' and v -> 'programme' ->> 'fee_bearer' = 'CLUB' and v -> 'connection' ->> 'state' = 'READY'
      and position('access_token' in v::text) = 0 and position('OR_MSU_' in v::text) = 0,
    'SU6 the setup read shows ACTIVE, READY and who pays the fee, and carries no token or GoCardless organisation id');

  -- Connection states as GoCardless defines them.
  update public.gocardless_merchant_connections set verification_status = 'action_required' where club_id = pg_temp.id('club');
  perform pg_temp.check(pg_temp.json_as(pg_temp.id('ca'), format('select public.membership_setup_state(%L)', pg_temp.id('club'))) -> 'connection' ->> 'state' = 'ACTION_REQUIRED',
    'SU7 an account GoCardless needs more information for reads ACTION_REQUIRED');
  update public.gocardless_merchant_connections set disconnected_at = now() where club_id = pg_temp.id('club');
  perform pg_temp.check(pg_temp.json_as(pg_temp.id('ca'), format('select public.membership_setup_state(%L)', pg_temp.id('club'))) -> 'connection' ->> 'state' = 'DISCONNECTED',
    'SU7b a disconnected account reads DISCONNECTED');
  perform pg_temp.connect(pg_temp.id('club'), 'successful');
end $$;

-- SU8: only the club's finance holders see or change setup.
do $$
declare v_who text; v_sql text; v_bad text := '';
begin
  foreach v_who in array array['tm', 'coach', 'pam', 'other_ca'] loop
    foreach v_sql in array array[
      format('select public.membership_setup_state(%L)', pg_temp.id('club')),
      format('select public.save_membership_settings(%L, 5, %L, %L)', pg_temp.id('club'), 'NEXT_COLLECTION_DAY', 'PAYER'),
      format('select public.activate_membership_programme(%L)', pg_temp.id('club')),
      format('select public.pause_membership_programme(%L, %L)', pg_temp.id('club'), 'test'),
      format('select public.create_membership_product(%L, %L, 1000, null)', pg_temp.id('club'), 'Rogue'),
      format('select public.set_membership_product_price(%L, 999999, current_date)', pg_temp.product('Club Membership')),
      format('select public.set_membership_product_teams(%L, array[]::uuid[])', pg_temp.product('Club Membership')),
      format('select public.archive_membership_product(%L)', pg_temp.product('Club Membership'))] loop
      if pg_temp.say_as(pg_temp.id(v_who), v_sql) not like '42501%' then
        v_bad := v_bad || v_who || ': ' || left(v_sql, 60) || '; ';
      end if;
    end loop;
  end loop;
  perform pg_temp.check(v_bad = '', 'SU8 a Team Manager, a coach, a parent and another club''s admin can neither read nor change setup (' || coalesce(nullif(v_bad, ''), 'all refused') || ')');
  perform pg_temp.check((select enabled and collection_day = 1 and platform_fee_mode = 'GOCARDLESS_APP_FEE' from public.club_subscription_programmes where club_id = pg_temp.id('club')),
    'SU8b and nothing changed');
end $$;

-- SU9: the old configure door saves settings and nothing else. Only Activate switches memberships on (it re-derives
-- readiness on the server) and only Pause stops new memberships (with a reason); configure is refused either way,
-- after asking authority first, and it still refuses a programme with no fee choice.
do $$
declare
  v_club2 uuid := pg_temp.put('club2', pg_temp.club('Legacy'));
  v_switch constant text := '22023: Switch Club Memberships on with Activate, and stop new memberships with Pause New Memberships.';
  v_not_holder constant text := '42501: You are not authorised to configure subscriptions for this club.';
  v_result text; v_result2 text; v_audit integer; v_who text; v_sql text; v_bad text := '';
  v_before public.club_subscription_programmes; v_after public.club_subscription_programmes;
begin
  perform pg_temp.member(v_club2, pg_temp.id('ca'), 'CLUB_ADMIN');

  -- (a) A club with no programme: configure cannot create one switched on, even with a fee choice.
  v_result := pg_temp.say_as(pg_temp.id('ca'), format('select public.configure_subscription_programme(%L, true, 1, %L, %L)', v_club2, 'GOCARDLESS_APP_FEE', 'PRORATE_CURRENT_MONTH'));
  perform pg_temp.check(v_result = v_switch
      and not exists (select 1 from public.club_subscription_programmes where club_id = v_club2)
      and not exists (select 1 from public.finance_audit_log where club_id = v_club2),
    'SU9 configure cannot switch memberships on, even with a fee choice: refused, pointing to Activate, with nothing created or audited (' || v_result || ')');

  -- The fee choice is still required when configure creates a programme, which it can only create switched off.
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('ca'), format('select public.configure_subscription_programme(%L, false, 1, %L, %L)', v_club2, 'NONE', 'PRORATE_CURRENT_MONTH')) like '22023: Choose who pays%',
    'SU9b configure refuses a programme with no fee choice');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('ca'), format('select public.configure_subscription_programme(%L, false, 1, %L, %L)', v_club2, 'PARTNER_REVENUE_SHARE', 'PRORATE_CURRENT_MONTH')) like '22023: Choose who pays%'
      and not exists (select 1 from public.club_subscription_programmes where club_id = v_club2),
    'SU9c and refuses partner revenue share, which cannot be combined with app fees');

  -- A programme set up before the fee keeps its mode only while unchanged.
  insert into public.club_subscription_programmes (club_id, enabled, collection_day, platform_fee_mode, created_by) values (v_club2, false, 1, 'NONE', pg_temp.id('ca'));
  -- (c) A settings save that leaves the switch off. Each action runs before what it is checked against: one
  -- boolean expression has no evaluation order.
  v_result := pg_temp.say_as(pg_temp.id('ca'), format('select public.configure_subscription_programme(%L, false, 9, %L, %L)', v_club2, 'NONE', 'NEXT_COLLECTION_DAY'));
  perform pg_temp.check(v_result = 'OK'
      and (select not enabled and activated_at is null and collection_day = 9 and platform_fee_mode = 'NONE' from public.club_subscription_programmes where club_id = v_club2)
      and exists (select 1 from public.finance_audit_log where club_id = v_club2 and action = 'programme_configured' and actor_user_id = pg_temp.id('ca')
                    and (new_value ->> 'collection_day')::int = 9 and not (new_value ->> 'enabled')::boolean),
    'SU9d a switched-off legacy programme still saves its other settings, keeps its mode, stays off, and the save is audited (' || v_result || ')');

  -- (a) An existing switched-off programme: refused with or without a fee choice, and nothing changes.
  select * into v_before from public.club_subscription_programmes where club_id = v_club2;
  select count(*) into v_audit from public.finance_audit_log where club_id = v_club2;
  v_result := pg_temp.say_as(pg_temp.id('ca'), format('select public.configure_subscription_programme(%L, true, 12, %L, %L)', v_club2, 'NONE', 'PRORATE_CURRENT_MONTH'));
  v_result2 := pg_temp.say_as(pg_temp.id('ca'), format('select public.configure_subscription_programme(%L, true, 12, %L, %L)', v_club2, 'PAYER_SURCHARGE', 'PRORATE_CURRENT_MONTH'));
  select * into v_after from public.club_subscription_programmes where club_id = v_club2;
  perform pg_temp.check(v_result = v_switch and v_result2 = v_switch
      and not v_after.enabled and v_after.activated_at is null
      and (v_after.collection_day, v_after.first_payment_policy, v_after.platform_fee_mode) = (v_before.collection_day, v_before.first_payment_policy, v_before.platform_fee_mode)
      and (select count(*) from public.finance_audit_log where club_id = v_club2) = v_audit,
    'SU9e nor can it switch on an existing programme, with or without a fee choice: nothing changes and nothing is audited (' || v_result || ' / ' || v_result2 || ')');

  -- (b) The club's active programme: configure cannot stop new memberships, so Pause and its reason cannot be skipped.
  select * into v_before from public.club_subscription_programmes where club_id = pg_temp.id('club');
  select count(*) into v_audit from public.finance_audit_log where club_id = pg_temp.id('club');
  v_result := pg_temp.say_as(pg_temp.id('ca'), format('select public.configure_subscription_programme(%L, false, 12, %L, %L)', pg_temp.id('club'), 'PAYER_SURCHARGE', 'NEXT_COLLECTION_DAY'));
  select * into v_after from public.club_subscription_programmes where club_id = pg_temp.id('club');
  perform pg_temp.check(v_result = v_switch and v_before.enabled and v_after.enabled
      and v_after.activated_at = v_before.activated_at
      and (v_after.collection_day, v_after.first_payment_policy, v_after.platform_fee_mode) = (v_before.collection_day, v_before.first_payment_policy, v_before.platform_fee_mode)
      and (select count(*) from public.finance_audit_log where club_id = pg_temp.id('club')) = v_audit,
    'SU9f configure cannot switch an active programme off: refused, pointing to Pause, and nothing changes or is audited (' || v_result || ')');

  -- (c) A settings save that leaves the switch on still works on the active programme and is audited. Put back
  -- after, because what follows enrols on the 1st.
  select count(*) into v_audit from public.finance_audit_log where club_id = pg_temp.id('club') and action = 'programme_configured';
  v_result := pg_temp.say_as(pg_temp.id('ca'), format('select public.configure_subscription_programme(%L, true, 2, %L, %L)', pg_temp.id('club'), 'GOCARDLESS_APP_FEE', 'PRORATE_CURRENT_MONTH'));
  select * into v_after from public.club_subscription_programmes where club_id = pg_temp.id('club');
  perform pg_temp.check(v_result = 'OK' and v_after.enabled and v_after.activated_at = v_before.activated_at and v_after.collection_day = 2
      and (select count(*) from public.finance_audit_log where club_id = pg_temp.id('club') and action = 'programme_configured') = v_audit + 1
      and exists (select 1 from public.finance_audit_log where club_id = pg_temp.id('club') and action = 'programme_configured' and actor_user_id = pg_temp.id('ca')
                    and (new_value ->> 'collection_day')::int = 2 and (new_value ->> 'enabled')::boolean),
    'SU9g on an active programme a settings save that leaves it on still works, keeps it on and is audited (' || v_result || ')');
  v_result := pg_temp.say_as(pg_temp.id('ca'), format('select public.configure_subscription_programme(%L, true, 1, %L, %L)', pg_temp.id('club'), 'GOCARDLESS_APP_FEE', 'PRORATE_CURRENT_MONTH'));
  perform pg_temp.check(v_result = 'OK' and (select enabled and collection_day = 1 from public.club_subscription_programmes where club_id = pg_temp.id('club')),
    'SU9g2 and the collection day goes back to the 1st (' || v_result || ')');

  -- (d) Authority is asked first: a non-holder is refused exactly as before, whichever way the switch would go.
  foreach v_who in array array['tm', 'coach', 'pam', 'other_ca'] loop
    foreach v_sql in array array[
      format('select public.configure_subscription_programme(%L, false, 1, %L, %L)', pg_temp.id('club'), 'GOCARDLESS_APP_FEE', 'PRORATE_CURRENT_MONTH'),
      format('select public.configure_subscription_programme(%L, true, 1, %L, %L)', pg_temp.id('club'), 'GOCARDLESS_APP_FEE', 'PRORATE_CURRENT_MONTH'),
      format('select public.configure_subscription_programme(%L, true, 9, %L, %L)', v_club2, 'PAYER_SURCHARGE', 'NEXT_COLLECTION_DAY')] loop
      v_result := pg_temp.say_as(pg_temp.id(v_who), v_sql);
      if v_result is distinct from v_not_holder then
        v_bad := v_bad || v_who || ' -> ' || coalesce(v_result, '-') || '; ';
      end if;
    end loop;
  end loop;
  perform pg_temp.check(v_bad = '' and (select enabled from public.club_subscription_programmes where club_id = pg_temp.id('club'))
      and (select not enabled from public.club_subscription_programmes where club_id = v_club2),
    'SU9h a Team Manager, a coach, a parent and another club''s admin are refused on authority first, with the same sentence, whichever way the switch would go (' || coalesce(nullif(v_bad, ''), 'all refused') || ')');

  -- The refusals bite. The door's previous body (20270748000000 before Activate became the only way on) is swapped
  -- back in inside a block that is then undone, so the swap and everything it lets through are rolled back with it.
  declare
    v_saved constant text := pg_get_functiondef('public.configure_subscription_programme(uuid, boolean, integer, text, text)'::regprocedure);
    v_on text; v_off text; v_on_flipped boolean; v_off_flipped boolean; v_err text;
  begin
    begin
      execute $old$
create or replace function public.configure_subscription_programme(p_club_id uuid, p_enabled boolean, p_collection_day integer, p_platform_fee_mode text, p_first_payment_policy text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_current public.club_subscription_programmes;
begin
  if not (internal.can('finance.subscription.configure', 'club', p_club_id, null, null)) then
    raise exception 'You are not authorized to configure subscriptions for this club.' using errcode = '42501';
  end if;
  if p_collection_day < 1 or p_collection_day > 28 then
    raise exception 'Collection day must be between 1 and 28.';
  end if;
  if p_first_payment_policy not in ('PRORATE_CURRENT_MONTH', 'NEXT_COLLECTION_DAY') then
    raise exception 'Invalid first payment policy.';
  end if;

  select * into v_current from public.club_subscription_programmes where club_id = p_club_id;

  if not internal.fee_mode_is_chosen(p_platform_fee_mode) and p_platform_fee_mode is distinct from v_current.platform_fee_mode then
    raise exception 'Choose who pays Ovalball''s fee: the club (GOCARDLESS_APP_FEE) or its members (PAYER_SURCHARGE).' using errcode = '22023';
  end if;
  if p_enabled and not coalesce(v_current.enabled, false) and not internal.fee_mode_is_chosen(p_platform_fee_mode) then
    raise exception 'Club Memberships cannot be switched on until the club has chosen who pays Ovalball''s fee.' using errcode = '23514';
  end if;

  insert into public.club_subscription_programmes (club_id, enabled, collection_day, platform_fee_mode, first_payment_policy, created_by, activated_at)
  values (p_club_id, p_enabled, p_collection_day, p_platform_fee_mode, p_first_payment_policy, auth.uid(), case when p_enabled then now() end)
  on conflict (club_id) do update set
    enabled = excluded.enabled,
    collection_day = excluded.collection_day,
    platform_fee_mode = excluded.platform_fee_mode,
    first_payment_policy = excluded.first_payment_policy,
    activated_at = coalesce(club_subscription_programmes.activated_at, case when excluded.enabled then now() end),
    updated_by = auth.uid()
  returning id into v_id;

  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
  values (auth.uid(), p_club_id, 'programme_configured', 'club_subscription_programmes', v_id,
    jsonb_build_object('platform_fee_mode', v_current.platform_fee_mode, 'first_payment_policy', v_current.first_payment_policy),
    jsonb_build_object('enabled', p_enabled, 'collection_day', p_collection_day, 'platform_fee_mode', p_platform_fee_mode, 'first_payment_policy', p_first_payment_policy),
    'admin_ui');

  if v_current.first_payment_policy is not null and v_current.first_payment_policy is distinct from p_first_payment_policy then
    insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
    values (auth.uid(), p_club_id, 'first_payment_policy_changed', 'club_subscription_programmes', v_id,
      jsonb_build_object('programme_id', v_id, 'policy', v_current.first_payment_policy),
      jsonb_build_object('programme_id', v_id, 'policy', p_first_payment_policy),
      'admin_ui');
  end if;

  return v_id;
end;
$function$
$old$;
      -- The same calls SU9e and SU9f made.
      v_on := pg_temp.say_as(pg_temp.id('ca'), format('select public.configure_subscription_programme(%L, true, 12, %L, %L)', v_club2, 'PAYER_SURCHARGE', 'PRORATE_CURRENT_MONTH'));
      v_on_flipped := (select enabled and activated_at is not null from public.club_subscription_programmes where club_id = v_club2);
      v_off := pg_temp.say_as(pg_temp.id('ca'), format('select public.configure_subscription_programme(%L, false, 12, %L, %L)', pg_temp.id('club'), 'PAYER_SURCHARGE', 'NEXT_COLLECTION_DAY'));
      v_off_flipped := (select not enabled from public.club_subscription_programmes where club_id = pg_temp.id('club'));
      raise exception using errcode = 'OVB09', message = 'undo the previous body and everything it let through';
    exception
      when sqlstate 'OVB09' then null;
      when others then get stacked diagnostics v_err = message_text;
    end;
    perform pg_temp.check(v_err is null and v_on = 'OK' and v_on_flipped and v_off = 'OK' and v_off_flipped,
      'SU9i the refusals bite: with the previous body swapped back in, the same calls switch memberships on and off (' || coalesce(v_err, v_on || ' / ' || v_off) || ')');
    perform pg_temp.check(pg_get_functiondef('public.configure_subscription_programme(uuid, boolean, integer, text, text)'::regprocedure) = v_saved
        and (select not enabled and activated_at is null from public.club_subscription_programmes where club_id = v_club2)
        and (select enabled from public.club_subscription_programmes where club_id = pg_temp.id('club')),
      'SU9j and once undone the door is the current one again, with nothing it let through left behind');
  end;
end $$;

-- =====================================================================================================
-- SP: MEMBERSHIPS AND TEAMS
-- =====================================================================================================
do $$
declare v_junior uuid; v_senior uuid; v jsonb; v_result text;
begin
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('ca'), format('select public.create_membership_product(%L, %L, 99, null)', pg_temp.id('club'), 'Cheap')) like '22023%',
    'SP0 a monthly price under £1 is refused');
  v_junior := pg_temp.uuid_as(pg_temp.id('ca'), format('select public.create_membership_product(%L, %L, 1000, array[%L, %L, %L]::uuid[])',
                pg_temp.id('club'), 'Junior Membership', pg_temp.id('u12'), pg_temp.id('u13'), pg_temp.id('u18')));
  v_senior := pg_temp.uuid_as(pg_temp.id('ca'), format('select public.create_membership_product(%L, %L, 1500, array[%L]::uuid[])',
                pg_temp.id('club'), 'Senior Membership', pg_temp.id('men')));
  perform pg_temp.put('junior', v_junior);
  perform pg_temp.put('senior', v_senior);
  perform pg_temp.check(
    (select count(*) from public.membership_product_teams where product_id = v_junior) = 3
    and (select count(*) from public.membership_product_teams where product_id = v_senior) = 1
    and (select count(*) from public.membership_product_teams where product_id = pg_temp.product('Club Membership')) = 0,
    'SP1 Junior takes the three age-grade teams and Senior the men''s side; they leave Club Membership');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('ca'), format('select public.create_membership_product(%L, %L, 1200, null)', pg_temp.id('club'), 'junior membership')) like '23505%',
    'SP1b two memberships cannot share a name');

  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.set_membership_product_teams(%L, array[%L, %L]::uuid[])', v_senior, pg_temp.id('men'), pg_temp.id('u18')));
  perform pg_temp.check((select product_id from public.membership_product_teams where team_id = pg_temp.id('u18')) = v_senior
      and (select count(*) from public.membership_product_teams where team_id = pg_temp.id('u18')) = 1,
    'SP2 giving Under 18s to Senior moves them: a team belongs to one membership');
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.set_membership_product_teams(%L, array[%L]::uuid[])', v_senior, pg_temp.id('men')));
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.set_membership_product_teams(%L, array[%L, %L, %L]::uuid[])', v_junior, pg_temp.id('u12'), pg_temp.id('u13'), pg_temp.id('u18')));

  v_result := pg_temp.say_as(pg_temp.id('ca'), format('select public.archive_membership_product(%L)', pg_temp.product('Club Membership')));
  perform pg_temp.check(v_result = 'OK' and (select status from public.membership_products where name = 'Club Membership' and club_id = pg_temp.id('club')) = 'archived',
    'SP3 an unheld membership can be removed (' || v_result || ')');
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.rename_membership_product(%L, %L)', v_senior, 'Adult Membership'));
  perform pg_temp.check((select name from public.membership_products where id = v_senior) = 'Adult Membership', 'SP4 a membership can be renamed');
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.rename_membership_product(%L, %L)', v_senior, 'Senior Membership'));

  -- A new team at a club with several memberships waits; a lone membership takes new teams.
  perform pg_temp.put('u14', pg_temp.team(pg_temp.id('club'), 'Under 14 Boys', 'youth', 'U14', 'boys'));
  perform pg_temp.check(not exists (select 1 from public.membership_product_teams where team_id = pg_temp.id('u14')),
    'SP5 with several memberships a new team is not assigned on the club''s behalf');
  perform pg_temp.put('club2_team', pg_temp.team(pg_temp.id('club2'), 'Under 9 Mixed', 'youth', 'U9', 'mixed'));
  perform pg_temp.check(exists (select 1 from public.membership_product_teams where team_id = pg_temp.id('club2_team')),
    'SP5b with one membership a new team joins it, as every team paid before');

  perform pg_temp.check(pg_temp.say_as(pg_temp.id('ca'), format('select public.set_membership_product_price(%L, 1100, current_date - 1)', v_junior)) like '22023%',
    'SP6 a price cannot start in the past');
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.set_membership_product_price(%L, 1100, current_date + 40)', v_junior));
  v := pg_temp.json_as(pg_temp.id('ca'), format('select public.membership_setup_state(%L)', pg_temp.id('club')));
  perform pg_temp.check(
    (select (m ->> 'monthly_amount_minor')::int = 1000 and (m -> 'next_price' ->> 'amount_minor')::int = 1100
       from jsonb_array_elements(v -> 'memberships') m where m ->> 'name' = 'Junior Membership'),
    'SP6b a future price shows as next, while today''s stays');
  perform pg_temp.check(
    (select (m -> 'money' ->> 'fee_minor')::int = 25 and (m -> 'money' ->> 'members_pay_minor')::int = 1000 and (m -> 'money' ->> 'club_receives_minor')::int = 975
       from jsonb_array_elements(v -> 'memberships') m where m ->> 'name' = 'Junior Membership')
    and (select bool_and(t ? 'category' and t ? 'age_group' and t ? 'gender') from jsonb_array_elements(v -> 'teams') t),
    'SP6d each membership says what it means in money by the club''s fee arrangement (the club pays: members pay £10.00, Ovalball 25p, the club receives £9.75), and every team carries its structured identity for grouping');
  -- A DIRECT READ, as the signed-in caller the row policy runs as. The first policy called a helper no signed-in
  -- role may execute, so every read failed with "permission denied" -- nothing in the doors above could see that.
  perform pg_temp.check(
    pg_temp.say_as(pg_temp.id('ca'), format('select count(*) from public.membership_products where club_id = %L', pg_temp.id('club'))) = 'OK'
    and pg_temp.say_as(pg_temp.id('ca'), format('select count(*) from public.membership_product_teams where club_id = %L', pg_temp.id('club'))) = 'OK'
    and (pg_temp.json_as(pg_temp.id('ca'), format('select to_jsonb(count(*)) from public.membership_products where club_id = %L', pg_temp.id('club'))))::int >= 2
    and (pg_temp.json_as(pg_temp.id('ca'), format('select to_jsonb(count(*)) from public.membership_product_teams where club_id = %L', pg_temp.id('club'))))::int >= 1
    and (pg_temp.json_as(pg_temp.id('other_ca'), format('select to_jsonb(count(*)) from public.membership_products where club_id = %L', pg_temp.id('club'))))::int = 0
    and (pg_temp.json_as(pg_temp.id('other_ca'), format('select to_jsonb(count(*)) from public.membership_product_teams where club_id = %L', pg_temp.id('club'))))::int = 0,
    'SP6e the club''s finance holder reads its memberships and their teams directly, under the row policy, without an error; another club''s admin reads none');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('ca'), format('select public.set_subscription_price(%L, 1300, current_date)', pg_temp.id('programme'))) like '22023%several memberships%',
    'SP6c the old one-price door says to price the membership itself when there are several');
end $$;

-- =====================================================================================================
-- SR: ONE MEMBERSHIP PER PLAYER
-- =====================================================================================================
do $$
declare v_result text;
begin
  -- Colin is an Under 18 who also plays for the men's side.
  perform pg_temp.player('colin', pg_temp.dob('U18'), pg_temp.id('gus'), pg_temp.id('u18'));
  -- His senior place stands on an approved dispensation, as an under-18 on an adult side must.
  insert into public.player_team_dispensation (player_id, target_team_id, season_id, eligibility_rule_reference, status, governing_body_reference)
  values (pg_temp.id('colin'), pg_temp.id('men'), internal.resolve_season_for_date('union', current_date), 'Suite fixture', 'approved', 'SUITE-FIXTURE');
  insert into public.player_team_memberships (player_id, team_id, status, state, source) values (pg_temp.id('colin'), pg_temp.id('men'), 'active', 'ACTIVE', 'CLUB_CREATED');
  perform pg_temp.check(internal.membership_product_for_player(pg_temp.id('club'), pg_temp.id('colin')) = pg_temp.id('senior'),
    'SR1 a player in a Junior and a Senior team holds the higher-priced Senior membership');
  v_result := pg_temp.say_as(pg_temp.id('ca'), format('select public.set_player_membership_product(%L, %L, %L)', pg_temp.id('colin'), pg_temp.id('junior'), 'Colts play seniors at junior rate'));
  perform pg_temp.check(v_result = 'OK' and internal.membership_product_for_player(pg_temp.id('club'), pg_temp.id('colin')) = pg_temp.id('junior')
      and exists (select 1 from public.finance_audit_log where action = 'player_membership_product_set' and target_id = pg_temp.id('colin')),
    'SR2 the club switches him to Junior, recorded (' || v_result || ')');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('ca'), format('select public.set_player_membership_product(%L, %L, null)', pg_temp.id('abe'), pg_temp.id('senior'))) like '22023%',
    'SR3 a player cannot be switched to a membership none of their teams has');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('tm'), format('select public.set_player_membership_product(%L, %L, null)', pg_temp.id('colin'), pg_temp.id('senior'))) like '42501%',
    'SR3b a Team Manager cannot switch a player''s membership');
  update public.player_team_memberships set state = 'ENDED', status = 'ended' where player_id = pg_temp.id('colin') and team_id = pg_temp.id('u18');
  perform pg_temp.check(internal.membership_product_for_player(pg_temp.id('club'), pg_temp.id('colin')) = pg_temp.id('senior'),
    'SR4 once he leaves the Under 18s the switch no longer applies and he holds Senior');
end $$;

-- =====================================================================================================
-- SE: ENROLMENT KEEPS WHAT IT WAS SET UP WITH;  SF: THE FEE
-- =====================================================================================================
do $$
declare v_psp uuid; v_psp2 uuid; o public.membership_obligations; v jsonb;
begin
  v_psp := pg_temp.uuid_as(pg_temp.id('pam'), format('select public.claim_responsible_payer(%L, %L)', pg_temp.id('abe'), pg_temp.id('programme')));
  perform pg_temp.put('abe_psp', v_psp);
  perform pg_temp.check((select product_id = pg_temp.id('junior') and collection_day = 1 and first_payment_policy = 'PRORATE_CURRENT_MONTH'
                                and platform_fee_mode = 'GOCARDLESS_APP_FEE' and platform_fee_bps = 250 and final_amount_minor = 1000
                           from public.player_subscription_payers where id = v_psp),
    'SE1 an enrolment records its membership, collection day, first-payment policy and fee terms');

  -- The club then moves to the 15th, starts payments next month, and asks members to pay the fee.
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.save_membership_settings(%L, 15, %L, %L)', pg_temp.id('club'), 'NEXT_COLLECTION_DAY', 'PAYER'));
  perform pg_temp.check((select collection_day = 1 and first_payment_policy = 'PRORATE_CURRENT_MONTH' and platform_fee_mode = 'GOCARDLESS_APP_FEE'
                           from public.player_subscription_payers where id = v_psp),
    'SE2 a settings change leaves an existing enrolment on its own terms');
  v_psp2 := pg_temp.uuid_as(pg_temp.id('pam'), format('select public.claim_responsible_payer(%L, %L)', pg_temp.id('ben'), pg_temp.id('programme')));
  perform pg_temp.put('ben_psp', v_psp2);
  perform pg_temp.check((select collection_day = 15 and first_payment_policy = 'NEXT_COLLECTION_DAY' and platform_fee_mode = 'PAYER_SURCHARGE'
                           from public.player_subscription_payers where id = v_psp2),
    'SE2b a new enrolment takes the new terms');

  -- Both joined on the 1st of this month, so both owe a full month.
  update public.player_subscription_payers set effective_from = pg_temp.period() where id in (v_psp, v_psp2);
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.create_membership_obligations_for_period(%L, %L)', pg_temp.id('club'), pg_temp.period()));
  o := pg_temp.obligation('abe');
  perform pg_temp.check(o.due_date = pg_temp.period() and o.amount_due_minor = 1000 and o.platform_fee_minor = 25 and o.payer_fee_minor = 0
                        and o.collect_amount_minor = 1000 and o.product_id = pg_temp.id('junior'),
    'SE3/SF1 Abe''s month is due on his own day (the 1st): £10.00, Ovalball''s 25p borne by the club, £10.00 collected');
  o := pg_temp.obligation('ben');
  -- Ben's sibling place: the club has no sibling rule, so £10.00; members pay the fee on top.
  perform pg_temp.check(o.due_date = pg_temp.period() + 14 and o.amount_due_minor = 1000 and o.platform_fee_minor = 25 and o.payer_fee_minor = 25
                        and o.collect_amount_minor = 1025,
    'SE3b/SF2 Ben''s month is due on the 15th: £10.00 plus Ovalball''s 25p paid on top, £10.25 collected');

  perform pg_temp.check(internal.ovalball_fee_minor(2500, 250) = 63 and internal.ovalball_fee_minor(1135, 250) = 28
                        and internal.ovalball_fee_minor(1500, 250) = 38 and internal.ovalball_fee_minor(0, 250) = 0,
    'SF3 2.5% rounds half up to the penny: £25.00 → 63p, £11.35 → 28p, £15.00 → 38p, nothing → nothing');

  v := pg_temp.json_as(pg_temp.id('pam'), format('select public.membership_charge_plan(%L)', v_psp2));
  perform pg_temp.check((v ->> 'monthly_collect_minor')::int = 1025 and (v ->> 'monthly_fee_minor')::int = 25 and v ->> 'fee_bearer' = 'PAYER'
                        and (v ->> 'collection_day')::int = 15,
    'SF6 the payer reads what their Direct Debit collects each month, fee included (' || coalesce(v::text, '-') || ')');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('gus'), format('select public.membership_charge_plan(%L)', v_psp2)) like '42501%',
    'SF6b another parent cannot read it');
end $$;

-- SF4/SF5: a free month and a part month below the minimum are exempt, and stop nobody else's month.
do $$
declare v_psp uuid; o public.membership_obligations;
begin
  -- Cal: a full sibling discount (the club's third-child rule at 100%) — modelled on his enrolment.
  v_psp := pg_temp.uuid_as(pg_temp.id('gus'), format('select public.claim_responsible_payer(%L, %L)', pg_temp.id('cal'), pg_temp.id('programme')));
  update public.player_subscription_payers set final_amount_minor = 0, sibling_discount_amount_minor = 1000, effective_from = pg_temp.period() where id = v_psp;
  -- Dot joined yesterday on the last day... modelled as joining on the last day of the month (one day pro rata).
  perform pg_temp.player('dot', pg_temp.dob('U12'), pg_temp.id('gus'), pg_temp.id('u12'));
  v_psp := pg_temp.uuid_as(pg_temp.id('gus'), format('select public.claim_responsible_payer(%L, %L)', pg_temp.id('dot'), pg_temp.id('programme')));
  update public.player_subscription_payers
     set effective_from = (pg_temp.period() + interval '1 month' - interval '1 day')::date, first_payment_policy = 'PRORATE_CURRENT_MONTH', final_amount_minor = 1000
   where id = v_psp;
  -- Eli is an ordinary member whose month must still be generated.
  perform pg_temp.player('eli', pg_temp.dob('U12'), pg_temp.id('gus'), pg_temp.id('u12'));
  v_psp := pg_temp.uuid_as(pg_temp.id('gus'), format('select public.claim_responsible_payer(%L, %L)', pg_temp.id('eli'), pg_temp.id('programme')));
  update public.player_subscription_payers set effective_from = pg_temp.period(), first_payment_policy = 'PRORATE_CURRENT_MONTH' where id = v_psp;

  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.create_membership_obligations_for_period(%L, %L)', pg_temp.id('club'), pg_temp.period()));
  o := pg_temp.obligation('cal');
  perform pg_temp.check(o.status = 'EXEMPT' and o.amount_due_minor = 0 and o.platform_fee_minor = 0 and o.resolved_reason like 'Nothing to collect%zero%',
    'SF4 a fully discounted month is exempt, with no fee');
  o := pg_temp.obligation('dot');
  perform pg_temp.check(o.status = 'EXEMPT' and o.amount_due_minor = 0 and o.platform_fee_minor = 0 and o.resolved_reason like '%below the £1 Direct Debit minimum%',
    'SF5 a one-day part month below the £1 minimum is exempt, with the reason, and no fee (' || coalesce(o.resolved_reason, '-') || ')');
  o := pg_temp.obligation('eli');
  perform pg_temp.check(o.status = 'SETUP_PENDING' and o.amount_due_minor > 0 and o.platform_fee_minor > 0,
    'SF4b another member''s month is still generated beside them');
end $$;

-- =====================================================================================================
-- SFP: WHERE OVALBALL'S FEE STANDS THROUGH A PAYMENT'S LIFE
-- =====================================================================================================
do $$
declare v_ob uuid := (pg_temp.obligation('abe')).id; v_pay uuid; v_pos text;
begin
  select fee_position into v_pos from internal.membership_fee_position(v_ob);
  perform pg_temp.check(v_pos = 'EXPECTED', 'SFP1 before a payment exists the fee is expected (' || coalesce(v_pos, '-') || ')');
  set local role service_role;
  v_pay := public.record_gocardless_payment(v_ob, 'PM_MSU_ABE_' || substr(v_ob::text, 1, 6), 1000, 'GBP', null, 'pending_submission', null, 25);
  -- The same GoCardless payment recorded again (a retried request) keeps one row and one fee.
  perform public.record_gocardless_payment(v_ob, 'PM_MSU_ABE_' || substr(v_ob::text, 1, 6), 1000, 'GBP', null, 'pending_submission', null, 25);
  reset role;
  perform pg_temp.check((select count(*) from public.gocardless_payments where obligation_id = v_ob) = 1
                        and (select app_fee_minor from public.gocardless_payments where id = v_pay) = 25,
    'SFP1b recording the same payment twice keeps one payment and one 25p fee');
  select fee_position into v_pos from internal.membership_fee_position(v_ob);
  perform pg_temp.check(v_pos = 'PENDING', 'SFP1c while the payment is on its way the fee is pending, not earned (' || coalesce(v_pos, '-') || ')');

  update public.gocardless_payments set status = 'confirmed' where id = v_pay;
  select fee_position into v_pos from internal.membership_fee_position(v_ob);
  perform pg_temp.check(v_pos = 'EARNED', 'SFP2 once collected the fee is earned');
  update public.gocardless_payments set status = 'failed' where id = v_pay;
  select fee_position into v_pos from internal.membership_fee_position(v_ob);
  perform pg_temp.check(v_pos = 'RETURNED', 'SFP2b a late failure returns the fee to the club');
  update public.gocardless_payments set status = 'charged_back' where id = v_pay;
  select fee_position into v_pos from internal.membership_fee_position(v_ob);
  perform pg_temp.check(v_pos = 'RETURNED', 'SFP2c a chargeback returns the fee to the club');
  update public.gocardless_payments set status = 'cancelled' where id = v_pay;
  select fee_position into v_pos from internal.membership_fee_position(v_ob);
  perform pg_temp.check(v_pos = 'NONE', 'SFP2d a cancelled payment carries no fee');
  update public.gocardless_payments set status = 'paid_out' where id = v_pay;
  insert into public.payment_refunds (payment_id, amount_minor, reason, status, created_by) values (v_pay, 1000, 'msu refund', 'pending', pg_temp.id('ca'));
  select fee_position into v_pos from internal.membership_fee_position(v_ob);
  perform pg_temp.check(v_pos = 'UNRESOLVED', 'SFP3 a refunded payment''s fee is unresolved, never counted as Ovalball''s until GoCardless says so');

  perform pg_temp.check((select count(*) from public.gocardless_payments where obligation_id = v_ob) = 1,
    'SFP4 one payment for the month throughout its life');
end $$;

do $$
declare v_state text; v_msg text;
begin
  set local role service_role;
  begin
    perform public.record_gocardless_payment((pg_temp.obligation('eli')).id, 'PM_MSU_FEE_TOO_BIG', 1000, 'GBP', null, 'pending_submission', null, 501);
    v_state := 'OK';
  exception when others then get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;
  reset role;
  perform pg_temp.check(v_state <> 'OK', 'SFP4c an app fee over half the payment is refused, as GoCardless requires');
end $$;

-- =====================================================================================================
-- SPA: PAUSING
-- =====================================================================================================
do $$
declare v jsonb; v_board jsonb;
begin
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('ca'), format('select public.pause_membership_programme(%L, %L)', pg_temp.id('club'), ' ')) like '22023%',
    'SPA0 stopping new memberships needs a reason');
  v := pg_temp.json_as(pg_temp.id('ca'), format('select public.pause_membership_programme(%L, %L)', pg_temp.id('club'), 'End of season review'));
  perform pg_temp.check(v ->> 'outcome' = 'PAUSED'
      and pg_temp.json_as(pg_temp.id('ca'), format('select public.membership_setup_state(%L)', pg_temp.id('club'))) ->> 'state' = 'PAUSED',
    'SPA1 pausing stops new memberships: the programme reads PAUSED');
  perform pg_temp.player('fay', pg_temp.dob('U13'), pg_temp.id('pam'), pg_temp.id('u13'));
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('pam'), format('select public.claim_responsible_payer(%L, %L)', pg_temp.id('fay'), pg_temp.id('programme'))) like '%not available%',
    'SPA1b a parent cannot start a new membership while paused');
  delete from public.membership_obligations where player_id = pg_temp.id('abe') and billing_period = (pg_temp.period() + interval '1 month')::date;
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.create_membership_obligations_for_period(%L, %L)', pg_temp.id('club'), (pg_temp.period() + interval '1 month')::date));
  perform pg_temp.check(exists (select 1 from public.membership_obligations where player_id = pg_temp.id('abe') and billing_period = (pg_temp.period() + interval '1 month')::date),
    'SPA1c an existing member''s next month is still generated, so a Direct Debit that keeps collecting has somewhere to land');
  v_board := pg_temp.json_as(pg_temp.id('ca'), format('select public.club_membership_board(%L, null, %L)', pg_temp.id('club'), current_date));
  perform pg_temp.check(exists (select 1 from jsonb_array_elements(coalesce(v_board -> 'rows', '[]'::jsonb)) r where (r ->> 'player_id')::uuid = pg_temp.id('abe'))
      and not exists (select 1 from jsonb_array_elements(coalesce(v_board -> 'rows', '[]'::jsonb)) r where (r ->> 'player_id')::uuid = pg_temp.id('fay')),
    'SPA1d the board still shows existing members, and does not ask a new player to set up while paused');
  v := pg_temp.json_as(pg_temp.id('ca'), format('select public.activate_membership_programme(%L)', pg_temp.id('club')));
  perform pg_temp.check(v ->> 'outcome' = 'RESUMED'
      and exists (select 1 from public.finance_audit_log where club_id = pg_temp.id('club') and action = 'programme_resumed'),
    'SPA2 resuming goes through the Activate door and is recorded as resumed');
end $$;

-- =====================================================================================================
-- SX: THE WORKED EXAMPLE
-- =====================================================================================================
do $$
declare v jsonb;
begin
  v := pg_temp.json_as(pg_temp.id('ca'), format('select public.membership_first_payment_example(%L, 2500, %L, 1, %L, %L)',
         pg_temp.id('club'), '2026-09-18', 'PRORATE_CURRENT_MONTH', 'CLUB'));
  perform pg_temp.check((v ->> 'first_amount_minor')::int = 1083 and (v ->> 'is_prorated')::boolean and (v ->> 'prorated_days')::int = 13
                        and v ->> 'then_monthly_from' = '2026-10-01' and (v ->> 'monthly_fee_minor')::int = 63 and (v ->> 'monthly_collect_minor')::int = 2500
                        and (v ->> 'club_receives_monthly_before_gocardless_minor')::int = 2437,
    'SX1 £25 a month, joining 18 September, pro rata: £10.83 for 13 days, then £25.00 from 1 October; the club bears 63p, receiving £24.37 before GoCardless''s fee (' || coalesce(v::text, '-') || ')');
  v := pg_temp.json_as(pg_temp.id('ca'), format('select public.membership_first_payment_example(%L, 2500, %L, 1, %L, %L)',
         pg_temp.id('club'), '2026-09-18', 'PRORATE_CURRENT_MONTH', 'PAYER'));
  perform pg_temp.check((v ->> 'first_collect_minor')::int = 1083 + 27 and (v ->> 'monthly_collect_minor')::int = 2563
                        and (v ->> 'club_receives_monthly_before_gocardless_minor')::int = 2500,
    'SX1b if members pay the fee they pay £11.10 then £25.63, and the club keeps £25.00 before GoCardless''s fee');
  v := pg_temp.json_as(pg_temp.id('ca'), format('select public.membership_first_payment_example(%L, 2500, %L, 1, %L, %L)',
         pg_temp.id('club'), '2026-09-18', 'NEXT_COLLECTION_DAY', 'CLUB'));
  perform pg_temp.check((v ->> 'nothing_in_joining_month')::boolean and v ->> 'first_billing_period' = '2026-10-01' and (v ->> 'first_amount_minor')::int = 2500,
    'SX2 starting payments next month: nothing for September, £25.00 for October first');
  v := pg_temp.json_as(pg_temp.id('ca'), format('select public.membership_first_payment_example(%L, 1000, %L, 1, %L, %L)',
         pg_temp.id('club'), '2026-09-30', 'PRORATE_CURRENT_MONTH', 'CLUB'));
  perform pg_temp.check((v ->> 'below_minimum')::boolean and (v ->> 'first_amount_minor')::int = 0,
    'SX3 a one-day part month below £1 shows as nothing to pay');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('other_ca'), format('select public.membership_first_payment_example(%L, 2500, current_date, 1, %L, %L)',
         pg_temp.id('club'), 'PRORATE_CURRENT_MONTH', 'CLUB')) like '42501%',
    'SX3b another club''s admin cannot use this club''s figures');
end $$;

-- =====================================================================================================
-- SST: WHO NEEDS MEMBERSHIP
-- =====================================================================================================
do $$
declare v_board jsonb;
begin
  perform pg_temp.player('gil', pg_temp.dob('U14'), pg_temp.id('pam'), pg_temp.id('u14'));
  perform pg_temp.player('hob', pg_temp.dob('U13'), pg_temp.id('pam'), pg_temp.id('u13'));
  v_board := pg_temp.json_as(pg_temp.id('ca'), format('select public.club_membership_board(%L, null, %L)', pg_temp.id('club'), current_date));
  perform pg_temp.check(
    not exists (select 1 from jsonb_array_elements(coalesce(v_board -> 'rows', '[]'::jsonb)) r where (r ->> 'player_id')::uuid = pg_temp.id('gil'))
    and exists (select 1 from jsonb_array_elements(coalesce(v_board -> 'rows', '[]'::jsonb)) r where (r ->> 'player_id')::uuid = pg_temp.id('hob') and r ->> 'standing' = 'NOT_SET_UP'),
    'SST1 a player in a team with no membership is not asked; one in a Junior team is Not set up');
end $$;

rollback;
