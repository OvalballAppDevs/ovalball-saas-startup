-- =====================================================================================================
-- CLUB MEMBERSHIPS, PART 2 -- LEAVING, SEASON HANDOVER AND FAMILIES, PROVED (brief sections 33, 34, 35)
--
-- These are separate concepts, and each is proved against the canonical doors (claim_responsible_payer, the
-- obligation generator, archive/move of a team place, end_membership_subscription, the one standing):
--
--   LL1-LL4   LEAVING A TEAM IS NOT CANCELLING A MEMBERSHIP: the enrolment, its price, its Direct Debit and its
--             collection carry on; the club is told (Action needed) and the generator still bills it -- the
--             current rule for decision #1 (an owner decision), shown here exactly as it is.
--   LD1-LD2   DEACTIVATING ACCESS IS NOT DELETING HISTORY: a payer's account switched off keeps every enrolment,
--             month and payment, and the club still sees the member.
--   LC1-LC3   CANCELLING ONE CHILD'S MEMBERSHIP IS NOT CANCELLING THE PAYER'S OTHER DIRECT DEBITS: the sibling's
--             mandate and collection are untouched; Ovalball never deletes a mandate.
--   LR1-LR2   A RETURNING PLAYER IS THE SAME PERSON: a new team place picks the membership back up; an ended one is
--             set up afresh as a new enrolment beside the old, never a second player.
--   LS1-LS3   SEASON HANDOVER: moving up a team under the same membership changes nothing financial; moving to a
--             team under a different membership keeps the price the member joined on, and the club cannot switch a
--             live membership (decision #6, an owner decision) -- history is never rewritten.
--   LP1-LP4   NOBODY TAKES ANOTHER'S PLACE AS PAYER, AND A NEW ROLE IS NOT A NEW PERSON.
--   LF1-LF5   FAMILIES: one payer, two children, two teams, two memberships -- one payer record, one GoCardless
--             customer, one reminder per child to the same adult, amounts per child, totals that reconcile; a
--             sibling discount priced at enrolment; a free child never stops a sibling's month.
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
create or replace function pg_temp.next_month() returns date language sql as $$ select (date_trunc('month', current_date) + interval '1 month')::date $$;

create or replace function pg_temp.person(p_label text, p_dob date default (current_date - interval '40 years')::date)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_email text := 'mlj-' || lower(p_label) || '-' || v::text || '@ovalball.test';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_email,'',now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
  values (v, p_label, 'Journey', v_email, p_dob, 'ACTIVE')
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
create or replace function pg_temp.team(p_club uuid, p_name text, p_category text, p_age text, p_gender text, p_squad text default null) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active, squad_designation)
  values (p_club, p_name, 'mlj-' || substr(gen_random_uuid()::text, 1, 12), p_category, p_age, p_gender, 'union', true, p_squad) returning id into v;
  return v;
end $$;
create or replace function pg_temp.player(p_key text, p_dob date, p_guardians uuid[], p_team uuid) returns uuid language plpgsql as $$
declare v uuid; g uuid;
begin
  insert into public.players (first_name, surname, date_of_birth, active, playing_pathway)
  values (initcap(p_key), 'Journey', p_dob, true, 'MALE') returning id into v;
  foreach g in array coalesce(p_guardians, array[]::uuid[]) loop
    insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source)
    values (g, v, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD');
  end loop;
  if p_team is not null then
    insert into public.player_team_memberships (player_id, team_id, status, state, source) values (v, p_team, 'active', 'ACTIVE', 'CLUB_CREATED')
    returning id into g;
    perform pg_temp.put(p_key || '_place', g);
  end if;
  perform pg_temp.put(p_key, v);
  return v;
end $$;
create or replace function pg_temp.product(p_name text) returns uuid language sql as $$
  select id from public.membership_products where club_id = pg_temp.id('club') and name = p_name and status = 'active' $$;
-- The family door: a guardian takes the membership on (claim_responsible_payer), and is the payer.
create or replace function pg_temp.claim(p_key text, p_payer text) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := pg_temp.uuid_as(pg_temp.id(p_payer), format('select public.claim_responsible_payer(%L, %L)', pg_temp.id(p_key), pg_temp.id('programme')));
  perform pg_temp.put(p_key || '_psp', v);
  return v;
end $$;
-- The Direct Debit GoCardless reconciled for that enrolment, and (optionally) the collection the payer started.
create or replace function pg_temp.direct_debit(p_key text, p_collecting boolean) returns uuid language plpgsql as $$
declare v_br uuid; v uuid; v_payer uuid := (select payer_user_id from public.player_subscription_payers where id = pg_temp.id(p_key || '_psp'));
        v_cust uuid;
begin
  insert into public.gocardless_customers (club_id, payer_user_id, gc_customer_id)
  values (pg_temp.id('club'), v_payer, 'CU_MLJ_' || substr(v_payer::text, 1, 8))
  on conflict (club_id, payer_user_id) do update set updated_at = now()
  returning id into v_cust;
  insert into public.gocardless_billing_requests (club_id, payer_subscription_id, gc_billing_request_id, status, created_by)
  values (pg_temp.id('club'), pg_temp.id(p_key || '_psp'), 'BRQ_MLJ_' || p_key || '_' || substr(gen_random_uuid()::text, 1, 6), 'fulfilled', v_payer)
  returning id into v_br;
  insert into public.gocardless_mandates (club_id, gocardless_customer_id, billing_request_id, gc_mandate_id, status)
  values (pg_temp.id('club'), v_cust, v_br, 'MD_MLJ_' || p_key || '_' || substr(gen_random_uuid()::text, 1, 6), 'active')
  returning id into v;
  perform pg_temp.put(p_key || '_md', v);
  if p_collecting then
    insert into public.gocardless_subscriptions (club_id, payer_subscription_id, gocardless_mandate_id, pricing_id, gc_subscription_id, amount_minor, status)
    select pg_temp.id('club'), psp.id, v, psp.pricing_id, 'SB_MLJ_' || p_key || '_' || substr(gen_random_uuid()::text, 1, 6), psp.final_amount_minor, 'active'
      from public.player_subscription_payers psp where psp.id = pg_temp.id(p_key || '_psp')
    returning id into v_br;
    perform pg_temp.put(p_key || '_sub', v_br);
  end if;
  return v;
end $$;
create or replace function pg_temp.row_of(p_board jsonb, p_key text) returns jsonb language sql as $$
  select r from jsonb_array_elements(coalesce(p_board -> 'rows', '[]'::jsonb)) r where (r ->> 'player_id')::uuid = pg_temp.id(p_key) $$;
create or replace function pg_temp.standing(p_key text) returns text language sql as $$
  select (r ->> 'standing') || '/' || (r ->> 'reason')
    from (select pg_temp.row_of(pg_temp.json_as(pg_temp.id('ca'), format('select public.club_membership_board(%L)', pg_temp.id('club'))), p_key) r) x $$;

-- =====================================================================================================
-- SEED: a club with a Junior Membership (Under 12s, Under 13s, Under 18s; £16) and a Senior Membership (the
-- men's side; £30), a 50% second-child sibling discount, collected on the 1st, set up through the Club Admin's
-- doors. Families: Pam (Abe, Under 12s, and Ben, Under 18s), Gus (Cal, Under 12s), Hana (Dee, Under 13s).
-- =====================================================================================================
do $$
declare v_club uuid; v_dir uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8); v_prog uuid; v jsonb;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Journey ' || v_tag || ' RFC', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mlj-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'mlj-' || v_tag, 'active') returning id into v_club;
  perform pg_temp.put('club', v_club);
  perform pg_temp.put('u12', pg_temp.team(v_club, 'Under 12 Boys', 'youth', 'U12', 'boys'));
  perform pg_temp.put('u13', pg_temp.team(v_club, 'Under 13 Boys', 'youth', 'U13', 'boys'));
  perform pg_temp.put('u18', pg_temp.team(v_club, 'Under 18 Boys', 'youth', 'U18', 'boys'));
  perform pg_temp.put('men', pg_temp.team(v_club, 'Men''s 1st Team', 'senior', null, 'mens'));
  perform pg_temp.put('ca', pg_temp.person('Clubadmin'));
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, pg_temp.id('ca'), 'CLUB_ADMIN', 'active');
  perform pg_temp.put('pam', pg_temp.person('Pam'));
  perform pg_temp.put('gus', pg_temp.person('Gus'));
  perform pg_temp.put('hana', pg_temp.person('Hana'));

  v_prog := pg_temp.uuid_as(pg_temp.id('ca'), format('select public.save_membership_settings(%L, 1, %L, %L)', v_club, 'NEXT_COLLECTION_DAY', 'CLUB'));
  perform pg_temp.put('programme', v_prog);
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.rename_membership_product(%L, %L)', pg_temp.product('Club Membership'), 'Junior Membership'));
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.set_membership_product_teams(%L, %L::uuid[])', pg_temp.product('Junior Membership'),
                                                  array[pg_temp.id('u12'), pg_temp.id('u13'), pg_temp.id('u18')]));
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.set_membership_product_price(%L, 1600, current_date)', pg_temp.product('Junior Membership')));
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.create_membership_product(%L, %L, 3000, %L::uuid[])', v_club, 'Senior Membership', array[pg_temp.id('men')]));
  insert into public.club_subscription_sibling_rules (programme_id, ordinal, discount_type, discount_value, effective_from, created_by)
  values (v_prog, 2, 'PERCENTAGE', 50, current_date - 30, pg_temp.id('ca'));
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.accept_club_membership_terms(%L, %L)', v_club, 'club-memberships-2026-10-06-proposed'));
  insert into public.gocardless_merchant_connections (club_id, environment, gc_organisation_id, access_token, scope, verification_status, connected_by, connected_at)
  values (v_club, 'sandbox', 'OR_MLJ_' || v_tag, null, 'read_write', 'successful', pg_temp.id('ca'), now());
  v := pg_temp.json_as(pg_temp.id('ca'), format('select public.activate_membership_programme(%L)', v_club));
  if v ->> 'outcome' <> 'ACTIVATED' then raise exception 'seed: could not activate (%)', v; end if;

  perform pg_temp.player('abe', pg_temp.dob('U12'), array[pg_temp.id('pam')], pg_temp.id('u12'));
  perform pg_temp.player('ben', pg_temp.dob('U18'), array[pg_temp.id('pam')], pg_temp.id('u18'));
  perform pg_temp.player('cal', pg_temp.dob('U12'), array[pg_temp.id('gus')], pg_temp.id('u12'));
  perform pg_temp.player('dee', pg_temp.dob('U13'), array[pg_temp.id('hana')], pg_temp.id('u13'));

  -- Each family takes its membership on through the family door, and sets up its Direct Debit.
  perform pg_temp.claim('abe', 'pam'); perform pg_temp.direct_debit('abe', true);
  perform pg_temp.claim('ben', 'pam'); perform pg_temp.direct_debit('ben', true);
  perform pg_temp.claim('cal', 'gus'); perform pg_temp.direct_debit('cal', true);
  perform pg_temp.claim('dee', 'hana'); perform pg_temp.direct_debit('dee', true);
end $$;

-- =====================================================================================================
-- LF. FAMILIES (section 35)
-- =====================================================================================================
do $$
declare b jsonb; v_rem jsonb;
begin
  perform pg_temp.check((select final_amount_minor from public.player_subscription_payers where id = pg_temp.id('abe_psp')) = 1600
                        and (select final_amount_minor from public.player_subscription_payers where id = pg_temp.id('ben_psp')) = 800
                        and (select sibling_ordinal from public.player_subscription_payers where id = pg_temp.id('ben_psp')) = 2,
    'LF1 Pam''s second child is priced with the sibling discount when she takes it on: £16 and £8');
  perform pg_temp.check((select count(*) from public.gocardless_customers where club_id = pg_temp.id('club') and payer_user_id = pg_temp.id('pam')) = 1
                        and (select count(distinct payer_user_id) from public.player_subscription_payers where id in (pg_temp.id('abe_psp'), pg_temp.id('ben_psp'))) = 1,
    'LF2 one payer and one GoCardless customer for both of Pam''s children -- never a second identity');
  -- Two Direct Debits today: one per child's enrolment (decision #17 asks the owner whether siblings share one).
  perform pg_temp.check((select count(*) from public.gocardless_mandates m join public.gocardless_billing_requests br on br.id = m.billing_request_id
                          where br.payer_subscription_id in (pg_temp.id('abe_psp'), pg_temp.id('ben_psp'))) = 2,
    'LF3 the current integration gives each child''s membership its own Direct Debit (recorded for decision #17)');

  -- A free child never stops a sibling's month. Everybody joined today on "from the next collection day", so next
  -- month is everybody's first full month: Abe is exempted from it, and Ben is still billed.
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.create_membership_obligations_for_period(%L, %L)', pg_temp.id('club'), pg_temp.next_month()));
  update public.membership_obligations set status = 'EXEMPT', resolved_reason = 'mlj: exempt this month', resolved_at = now()
   where player_id = pg_temp.id('abe') and billing_period = pg_temp.next_month();
  perform pg_temp.check((select status from public.membership_obligations where player_id = pg_temp.id('ben') and billing_period = pg_temp.next_month()) <> 'EXEMPT'
                        and (select amount_due_minor from public.membership_obligations where player_id = pg_temp.id('ben') and billing_period = pg_temp.next_month()) = 800,
    'LF4 one child exempt for a month leaves the other''s £8 to collect');

  b := pg_temp.json_as(pg_temp.id('ca'), format('select public.club_membership_board(%L, null, %L)', pg_temp.id('club'), pg_temp.next_month() + 19));
  perform pg_temp.check((b -> 'money' ->> 'expected_minor')::int = (select sum(amount_due_minor) from public.membership_obligations
                           where club_id = pg_temp.id('club') and billing_period = pg_temp.next_month() and status not in ('CANCELLED', 'EXEMPT', 'WAIVED', 'REFUNDED'))
                        and (b -> 'money' ->> 'expected_minor')::int = 800 + 1600 + 1600 and (b -> 'money' ->> 'waived_minor')::int = 1600,
    'LF5 the board''s money reconciles with the month''s records, child by child: £8 + £16 + £16 expected, Abe''s £16 exempt (' || coalesce(b -> 'money' ->> 'expected_minor', '-') || ')');
end $$;

-- =====================================================================================================
-- LL. LEAVING A TEAM IS NOT CANCELLING A MEMBERSHIP (section 34; decision #1)
-- =====================================================================================================
do $$
declare v_before integer;
begin
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.archive_player_team_membership(%L)', pg_temp.id('cal_place')));
  perform pg_temp.check((select state from public.player_team_memberships where id = pg_temp.id('cal_place')) = 'ENDED'
                        and (select status from public.player_subscription_payers where id = pg_temp.id('cal_psp')) = 'active',
    'LL1 Cal leaves his team; his membership is still active -- leaving a team is not cancelling');
  perform pg_temp.check((select status from public.gocardless_subscriptions where id = pg_temp.id('cal_sub')) = 'active'
                        and (select status from public.gocardless_mandates where id = pg_temp.id('cal_md')) = 'active',
    'LL2 his Direct Debit and its collection are untouched: only the club or the payer ends them');
  perform pg_temp.check(pg_temp.standing('cal') = 'ACTION_NEEDED/LEFT_THE_TEAM',
    'LL3 the club is told: still enrolled, no longer in a team (' || coalesce(pg_temp.standing('cal'), '-') || ')');
  v_before := (select count(*) from public.membership_obligations where player_id = pg_temp.id('cal'));
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.create_membership_obligations_for_period(%L, %L)', pg_temp.id('club'), (pg_temp.next_month() + interval '1 month')::date));
  perform pg_temp.check((select count(*) from public.membership_obligations where player_id = pg_temp.id('cal')) = v_before + 1,
    'LL4 and next month is still billed: today''s rule for decision #1 (flag, do not stop) -- shown, not changed');
end $$;

-- =====================================================================================================
-- LD. DEACTIVATING ACCESS IS NOT DELETING HISTORY
-- =====================================================================================================
do $$
declare v_obligations integer := (select count(*) from public.membership_obligations where club_id = pg_temp.id('club'));
begin
  -- What the Site Admin's account switch (site_set_account_state) writes: the profile's state, and nothing else.
  update public.profiles set account_state = 'DISABLED' where id = pg_temp.id('hana');
  perform pg_temp.check((select status from public.player_subscription_payers where id = pg_temp.id('dee_psp')) = 'active'
                        and (select count(*) from public.membership_obligations where club_id = pg_temp.id('club')) = v_obligations
                        and (select count(*) from public.gocardless_mandates where id = pg_temp.id('dee_md')) = 1,
    'LD1 Hana''s account is switched off; her enrolment, every month and her Direct Debit record remain');
  perform pg_temp.check(pg_temp.standing('dee') is not null and pg_temp.standing('dee') not like 'ENDED%',
    'LD2 the club still sees Dee''s membership (' || coalesce(pg_temp.standing('dee'), '-') || ')');
  update public.profiles set account_state = 'ACTIVE' where id = pg_temp.id('hana');
end $$;

-- =====================================================================================================
-- LC. CANCELLING ONE CHILD'S MEMBERSHIP IS NOT CANCELLING THE PAYER'S OTHER DIRECT DEBITS
-- =====================================================================================================
do $$
declare v_psp uuid := pg_temp.id('abe_psp'); v_actor uuid := pg_temp.id('ca');
begin
  -- The cancel door (end_membership_subscription), as the website calls it once GoCardless has stopped Abe's collection.
  update public.gocardless_subscriptions set status = 'cancelled' where id = pg_temp.id('abe_sub');
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  set local role service_role;
  perform public.end_membership_subscription(v_psp, 'mlj: Abe has stopped playing', v_actor);
  reset role;
  perform pg_temp.off();
  perform pg_temp.check((select status from public.player_subscription_payers where id = pg_temp.id('abe_psp')) = 'ended'
                        and (select status from public.player_subscription_payers where id = pg_temp.id('ben_psp')) = 'active',
    'LC1 Abe''s membership ends; Ben''s, paid by the same parent, carries on');
  perform pg_temp.check((select status from public.gocardless_mandates where id = pg_temp.id('ben_md')) = 'active'
                        and (select status from public.gocardless_subscriptions where id = pg_temp.id('ben_sub')) = 'active',
    'LC2 Ben''s Direct Debit and collection are untouched');
  perform pg_temp.check((select count(*) from public.gocardless_mandates where id = pg_temp.id('abe_md')) = 1
                        and (select count(*) from public.membership_obligations where player_id = pg_temp.id('abe')) > 0,
    'LC3 nothing is deleted: Abe''s Direct Debit record and his months stay as history');
end $$;

-- =====================================================================================================
-- LR. A RETURNING PLAYER IS THE SAME PERSON
-- =====================================================================================================
do $$
declare v_new uuid;
begin
  -- Cal comes back to the Under 12s: his membership never ended, so it simply carries on.
  insert into public.player_team_memberships (player_id, team_id, status, state, source) values (pg_temp.id('cal'), pg_temp.id('u12'), 'active', 'ACTIVE', 'CLUB_CREATED');
  perform pg_temp.check(pg_temp.standing('cal') not like 'ACTION_NEEDED/LEFT_THE_TEAM%'
                        and (select count(*) from public.player_subscription_payers where player_id = pg_temp.id('cal')) = 1,
    'LR1 Cal returns to a team: the same membership carries on, no new enrolment (' || coalesce(pg_temp.standing('cal'), '-') || ')');
  -- Abe's membership ended; when he is placed again, his family sets it up afresh, beside the old one.
  perform pg_temp.check(pg_temp.standing('abe') = 'NOT_SET_UP/NO_PAYER', 'LR2a Abe, still in a team after his membership ended, is Not set up');
  v_new := pg_temp.uuid_as(pg_temp.id('pam'), format('select public.claim_responsible_payer(%L, %L)', pg_temp.id('abe'), pg_temp.id('programme')));
  perform pg_temp.check(v_new is not null and v_new <> pg_temp.id('abe_psp')
                        and (select count(*) from public.player_subscription_payers where player_id = pg_temp.id('abe')) = 2
                        and (select count(*) from public.players where id = pg_temp.id('abe')) = 1,
    'LR2 he is set up again as a new enrolment beside the ended one -- the same player, history kept');
end $$;

-- =====================================================================================================
-- LS. SEASON HANDOVER (section 33; decision #6)
-- =====================================================================================================
do $$
declare v_place uuid; v_before jsonb; v_after jsonb;
begin
  -- Dee moves to the club's other Under 13 side, on the same Junior Membership (a move within his age grade; the
  -- age-grade guard rightly refuses anything else without a dispensation).
  perform pg_temp.put('u13b', pg_temp.team(pg_temp.id('club'), 'Under 13 Boys B', 'youth', 'U13', 'boys', 'B'));
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.set_membership_product_teams(%L, %L::uuid[])', pg_temp.product('Junior Membership'),
                                                  array[pg_temp.id('u12'), pg_temp.id('u13'), pg_temp.id('u13b'), pg_temp.id('u18')]));
  v_before := (select to_jsonb(psp) from public.player_subscription_payers psp where id = pg_temp.id('dee_psp'));
  v_place := pg_temp.uuid_as(pg_temp.id('ca'), format('select public.move_player_team_membership(%L, %L, %L)', pg_temp.id('dee_place'), pg_temp.id('u13b'), 'Squads rebalanced'));
  v_after := (select to_jsonb(psp) from public.player_subscription_payers psp where id = pg_temp.id('dee_psp'));
  perform pg_temp.check(v_place is not null and v_before = v_after
                        and (select count(*) from public.player_subscription_payers where player_id = pg_temp.id('dee')) = 1
                        and (select status from public.gocardless_subscriptions where payer_subscription_id = pg_temp.id('dee_psp')) = 'active'
                        and pg_temp.standing('dee') not like 'ACTION_NEEDED%',
    'LS1 moving team under the same membership changes nothing financial: same enrolment, price, Direct Debit, collection');
  -- A new season's memberships: the club puts its Under 18s on the Senior Membership. Ben joined on the Junior one.
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.set_membership_product_teams(%L, %L::uuid[])', pg_temp.product('Junior Membership'),
                                                  array[pg_temp.id('u12'), pg_temp.id('u13'), pg_temp.id('u13b')]));
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.set_membership_product_teams(%L, %L::uuid[])', pg_temp.product('Senior Membership'),
                                                  array[pg_temp.id('men'), pg_temp.id('u18')]));
  perform pg_temp.check((select product_id from public.player_subscription_payers where id = pg_temp.id('ben_psp')) = pg_temp.product('Junior Membership')
                        and (select final_amount_minor from public.player_subscription_payers where id = pg_temp.id('ben_psp')) = 800
                        and pg_temp.row_of(pg_temp.json_as(pg_temp.id('ca'), format('select public.club_membership_board(%L)', pg_temp.id('club'))), 'ben') -> 'membership' ->> 'name' = 'Junior Membership',
    'LS2 re-mapping teams to memberships keeps the price a member joined on -- and the board says which membership he holds');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('ca'), format('select public.set_player_membership_product(%L, %L, %L)', pg_temp.id('ben'), pg_temp.product('Senior Membership'), 'Under 18s are seniors now')) like '23514%',
    'LS3 and the club cannot switch a live membership to the other price: decision #6 is the owner''s, so nothing is rewritten');
end $$;

-- =====================================================================================================
-- LP. NOBODY TAKES ANOTHER'S PLACE AS PAYER, AND A NEW ROLE IS NOT A NEW PERSON (section 37)
-- =====================================================================================================
do $$
declare v_users integer := (select count(*) from public.profiles); v_ms uuid;
begin
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('hana'), format('select public.claim_responsible_payer(%L, %L)', pg_temp.id('ben'), pg_temp.id('programme'))) like '42501%',
    'LP1 a parent cannot make herself the payer for somebody else''s child');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source)
  values (pg_temp.id('gus'), pg_temp.id('ben'), 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('gus'), format('select public.claim_responsible_payer(%L, %L)', pg_temp.id('ben'), pg_temp.id('programme'))) like '%already has an active responsible payer%'
                        and (select payer_user_id from public.player_subscription_payers where id = pg_temp.id('ben_psp')) = pg_temp.id('pam'),
    'LP2 even Ben''s other guardian cannot take over a membership Pam pays for: the club changes who pays');
  -- Pam becomes the Under 12s' Team Manager: the same person, the same money.
  insert into public.club_memberships (club_id, user_id, role, status) values (pg_temp.id('club'), pg_temp.id('pam'), 'BASIC_USER', 'active') returning id into v_ms;
  perform internal.grant_role(v_ms, 'TEAM_MANAGER', pg_temp.id('u12'), 'LEGACY_BACKFILL', 'mlj: a parent becomes staff');
  perform pg_temp.check((select count(*) from public.profiles) = v_users
                        and (select payer_user_id from public.player_subscription_payers where id = pg_temp.id('ben_psp')) = pg_temp.id('pam')
                        and pg_temp.row_of(pg_temp.json_as(pg_temp.id('ca'), format('select public.club_membership_board(%L)', pg_temp.id('club'))), 'ben') -> 'payer' ->> 'user_id' = pg_temp.id('pam')::text,
    'LP3 a parent who becomes staff stays one person: no new profile, and she still pays for Ben');
  perform pg_temp.check(jsonb_array_length(pg_temp.json_as(pg_temp.id('pam'), format('select public.team_membership_board(%L)', pg_temp.id('u12'))) -> 'rows') >= 1
                        and pg_temp.say_as(pg_temp.id('pam'), format('select public.club_membership_board(%L)', pg_temp.id('club'))) like '42501%',
    'LP4 her new role gives her the team''s board, and still not the club''s money');
end $$;

rollback;
