-- =====================================================================================================
-- A FAMILY SEES WHAT THE DIRECT DEBIT COLLECTS, AND WHO PAYS OVALBALL'S FEE (20270751000000)
--
-- OWNER-LOCKED (6 Oct 2026): each club chooses who pays Ovalball's 2.5%, and the parent's setup must say which.
-- `family_membership_charge` is the one answer a family's screens read. This suite proves:
--
--   FC1-FC3   BEFORE SET-UP: the membership, its price, who pays the fee and what the Direct Debit collects
--             each month -- the club paying it (collect = price) and the members paying it (collect = price +
--             2.5%, half up) -- the club's own collection day, and a first payment from the club's own rules.
--   FC4       SIBLINGS: the price is this payer's (a second child's discount), and so is the fee on it.
--   FC5-FC6   AFTER SET-UP: the payer's answer is their enrolment's snapshot (a later settings change reaches new
--             enrolments only); a guardian who is not the payer learns that somebody else pays, and no figure.
--   FC7       NOTHING TO PAY: a fully discounted membership collects nothing and has no first payment.
--   FC8-FC11  WHO MAY ASK: not another family, not about a club the child has no place at, not the club's own
--             staff (they have the club's board), not signed out.
--   FC12      NO MEMBERSHIPS: a club that never set them up answers so, with no figures.
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

create or replace function pg_temp.person(p_label text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_email text := 'fmc-' || lower(p_label) || '-' || v::text || '@ovalball.test';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_email,'',now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
  values (v, p_label, 'Charge', v_email, (current_date - interval '40 years')::date, 'ACTIVE')
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth, account_state = 'ACTIVE';
  return v;
end $$;

create or replace function pg_temp.as_(p_subject uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', case when p_subject is null then '' else jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text end, true);
end $$;
create or replace function pg_temp.say_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v_state text; v_msg text;
begin
  perform pg_temp.as_(p_subject);
  set local role authenticated;
  begin execute p_sql; v_state := 'OK'; exception when others then get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text; end;
  reset role;
  perform pg_temp.as_(null);
  return v_state || coalesce(': ' || v_msg, '');
end $$;
create or replace function pg_temp.json_as(p_subject uuid, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.as_(p_subject);
  set local role authenticated;
  execute p_sql into v;
  reset role;
  perform pg_temp.as_(null);
  return v;
end $$;
create or replace function pg_temp.uuid_as(p_subject uuid, p_sql text) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp.as_(p_subject);
  set local role authenticated;
  execute p_sql into v;
  reset role;
  perform pg_temp.as_(null);
  return v;
end $$;

create or replace function pg_temp.player(p_key text, p_parent uuid, p_team uuid, p_pathway text default 'MALE') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.players (first_name, surname, date_of_birth, active, playing_pathway)
  values (initcap(p_key), 'Charge', pg_temp.dob('U12'), true, p_pathway) returning id into v;
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source)
  values (p_parent, v, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD');
  if p_team is not null then
    insert into public.player_team_memberships (player_id, team_id, status, state, source) values (v, p_team, 'active', 'ACTIVE', 'CLUB_CREATED');
  end if;
  return pg_temp.put(p_key, v);
end $$;

/** What the family's screens read, asked as this person. */
create or replace function pg_temp.charge(p_who text, p_player text, p_club text default 'club') returns jsonb language sql as $$
  select pg_temp.json_as(pg_temp.id(p_who), format('select public.family_membership_charge(%L, %L)', pg_temp.id(p_player), pg_temp.id(p_club))) $$;
create or replace function pg_temp.refused(p_who text, p_player text, p_club text default 'club') returns text language sql as $$
  select pg_temp.say_as(pg_temp.id(p_who), format('select public.family_membership_charge(%L, %L)', pg_temp.id(p_player), pg_temp.id(p_club))) $$;

-- =====================================================================================================
-- SEED: a club with its Under 12s, set up through the real doors (terms; the club pays Ovalball's fee; whole
-- months from the next collection day; collection on the 1st; one £20.00 membership; a verified connection;
-- Activate). Pam has two boys there (Abe, Bea) and shares Abe with Gus. Ola's girl plays at another club.
-- =====================================================================================================
do $$
declare v_tag text := substr(gen_random_uuid()::text, 1, 8); v_dir uuid; v_club uuid; v_team uuid; v_product uuid; v_prog uuid; v jsonb;
        v_other_dir uuid; v_other uuid; v_other_team uuid;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Charge ' || v_tag || ' RFC', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'fmc-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'fmc-' || v_tag, 'active') returning id into v_club;
  perform pg_temp.put('club', v_club);
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 12 Boys', 'fmc-' || v_tag || '-u12', 'youth', 'U12', 'boys', 'union', true) returning id into v_team;
  perform pg_temp.put('u12', v_team);

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Elsewhere ' || v_tag || ' RFC', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'fmc-o-' || v_tag)
  returning id into v_other_dir;
  insert into public.clubs (directory_id, slug, status) values (v_other_dir, 'fmc-o-' || v_tag, 'active') returning id into v_other;
  perform pg_temp.put('other', v_other);
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_other, 'Under 12 Girls', 'fmc-o-' || v_tag || '-u12', 'youth', 'U12', 'girls', 'union', true) returning id into v_other_team;

  perform pg_temp.put('ca', pg_temp.person('Clubadmin'));
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, pg_temp.id('ca'), 'CLUB_ADMIN', 'active');
  perform pg_temp.put('pam', pg_temp.person('Pam'));
  perform pg_temp.put('gus', pg_temp.person('Gus'));
  perform pg_temp.put('ola', pg_temp.person('Ola'));

  perform pg_temp.player('abe', pg_temp.id('pam'), v_team);
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source)
  values (pg_temp.id('gus'), pg_temp.id('abe'), 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD');
  perform pg_temp.player('bea', pg_temp.id('pam'), v_team);
  perform pg_temp.player('ivy', pg_temp.id('ola'), v_other_team, 'FEMALE');

  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.accept_club_membership_terms(%L, %L)', v_club, internal.club_membership_terms_version()));
  v_prog := pg_temp.uuid_as(pg_temp.id('ca'), format('select public.save_membership_settings(%L, 1, %L, %L)', v_club, 'NEXT_COLLECTION_DAY', 'CLUB'));
  perform pg_temp.put('programme', v_prog);
  select id into v_product from public.membership_products where club_id = v_club and status = 'active';
  perform pg_temp.put('product', v_product);
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.set_membership_product_price(%L, 2000, %L)', v_product, current_date));
  insert into public.gocardless_merchant_connections (club_id, environment, gc_organisation_id, access_token, scope, verification_status, connected_by, connected_at)
  values (v_club, 'sandbox', 'OR_FMC_' || v_tag, null, 'read_write', 'successful', pg_temp.id('ca'), now());
  v := pg_temp.json_as(pg_temp.id('ca'), format('select public.activate_membership_programme(%L)', v_club));
  perform pg_temp.check(v ->> 'outcome' = 'ACTIVATED', 'FC0 the world is set up through the real doors and switched on with Activate');
end $$;

-- =====================================================================================================
-- FC1-FC3 BEFORE SET-UP
-- =====================================================================================================
do $$
declare c jsonb := pg_temp.charge('pam', 'abe');
begin
  perform pg_temp.check(c ->> 'set_up' = 'false' and c ->> 'you_pay' = 'true' and c -> 'membership' ->> 'id' = pg_temp.id('product')::text
                        and (c -> 'membership' ->> 'name') is not null and c ->> 'taking_memberships' = 'true',
    'FC1 before set-up a parent is told the membership by name, that they would pay, and that the club is taking memberships');
  perform pg_temp.check(c ->> 'fee_bearer' = 'CLUB' and (c ->> 'fee_bps')::int = 250 and (c ->> 'monthly_amount_minor')::int = 2000
                        and (c ->> 'monthly_fee_minor')::int = 50 and (c ->> 'monthly_collect_minor')::int = 2000,
    'FC1b the club pays Ovalball''s fee: the Direct Debit collects the £20.00 price, and the page can say the club pays the 50p');
  perform pg_temp.check((c ->> 'collection_day')::int = 1 and c ->> 'first_payment_policy' = 'NEXT_COLLECTION_DAY'
                        and c -> 'first' is not null and (c -> 'first' ->> 'monthly_collect_minor')::int = 2000
                        and c -> 'first' ->> 'is_prorated' = 'false',
    'FC1c the club''s own collection day and first-payment rule, and a first payment worked out by the club''s own example rules');
end $$;

do $$
declare c jsonb;
begin
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.save_membership_settings(%L, 15, %L, %L)', pg_temp.id('club'), 'PRORATE_CURRENT_MONTH', 'PAYER'));
  c := pg_temp.charge('pam', 'abe');
  perform pg_temp.check(c ->> 'fee_bearer' = 'PAYER' and (c ->> 'monthly_amount_minor')::int = 2000
                        and (c ->> 'monthly_fee_minor')::int = 50 and (c ->> 'monthly_collect_minor')::int = 2050,
    'FC2 members pay Ovalball''s fee: the Direct Debit collects £20.50, and the page says so before anything is authorised');
  perform pg_temp.check((c ->> 'collection_day')::int = 15,
    'FC3 the collection day is the club''s (the 15th), not "the 1st of each month"');
  perform pg_temp.check((c -> 'first' ->> 'first_collect_minor')::int
                          = case when (c -> 'first' ->> 'below_minimum')::boolean then 0
                                 else (c -> 'first' ->> 'first_amount_minor')::int + internal.ovalball_fee_minor((c -> 'first' ->> 'first_amount_minor')::int, 250) end
                        and c -> 'first' ->> 'fee_bearer' = 'PAYER',
    'FC3b the first payment carries the members'' fee on its own amount, by the same rules as the club''s worked example');
end $$;

-- =====================================================================================================
-- FC4 SIBLINGS: this payer's price, and the fee on it
-- =====================================================================================================
do $$
declare c jsonb; v_psp uuid;
begin
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.configure_sibling_discount_rule(%L, 2, %L, 50, %L)', pg_temp.id('programme'), 'PERCENTAGE', current_date));
  v_psp := pg_temp.uuid_as(pg_temp.id('pam'), format('select public.claim_responsible_payer(%L, %L)', pg_temp.id('abe'), pg_temp.id('programme')));
  perform pg_temp.put('abe_psp', v_psp);
  c := pg_temp.charge('pam', 'bea');
  perform pg_temp.check(c ->> 'set_up' = 'false' and (c ->> 'monthly_amount_minor')::int = 1000
                        and (c ->> 'monthly_fee_minor')::int = 25 and (c ->> 'monthly_collect_minor')::int = 1025,
    'FC4 a second child is priced for this payer (half price, £10.00), and the members'' fee is 2.5% of that (25p): £10.25');
end $$;

-- =====================================================================================================
-- FC5-FC6 AFTER SET-UP
-- =====================================================================================================
do $$
declare c jsonb;
begin
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.save_membership_settings(%L, 15, %L, %L)', pg_temp.id('club'), 'PRORATE_CURRENT_MONTH', 'CLUB'));
  c := pg_temp.charge('pam', 'abe');
  perform pg_temp.check(c ->> 'set_up' = 'true' and c ->> 'you_pay' = 'true' and c ->> 'fee_bearer' = 'PAYER'
                        and (c ->> 'monthly_collect_minor')::int = 2050 and c -> 'first' = 'null'::jsonb,
    'FC5 the payer''s answer is their enrolment''s own terms: they joined while members paid the fee, so the club''s later change does not reach them');
  c := pg_temp.charge('gus', 'abe');
  perform pg_temp.check(c ->> 'set_up' = 'true' and c ->> 'you_pay' = 'false'
                        and not (c ? 'monthly_amount_minor') and not (c ? 'monthly_collect_minor') and not (c ? 'fee_bearer') and not (c ? 'first'),
    'FC6 a guardian who is not the payer learns that somebody else pays, and none of the payer''s figures');
end $$;

-- =====================================================================================================
-- FC7 NOTHING TO PAY
-- =====================================================================================================
do $$
declare c jsonb;
begin
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.configure_sibling_discount_rule(%L, 2, %L, 100, %L)', pg_temp.id('programme'), 'PERCENTAGE', current_date));
  c := pg_temp.charge('pam', 'bea');
  perform pg_temp.check((c ->> 'monthly_amount_minor')::int = 0 and (c ->> 'monthly_collect_minor')::int = 0 and c -> 'first' = 'null'::jsonb,
    'FC7 a fully discounted membership collects nothing, carries no fee and has no first payment');
end $$;

-- =====================================================================================================
-- FC8-FC12 WHO MAY ASK
-- =====================================================================================================
select pg_temp.check(pg_temp.refused('ola', 'abe') like '42501%', 'FC8 another family cannot read a child''s membership charge');
select pg_temp.check(pg_temp.refused('pam', 'abe', 'other') like '42501%' and pg_temp.refused('ola', 'ivy', 'club') like '42501%',
  'FC9 nor about a club the child has no place at -- it is no way to read another club''s prices');
select pg_temp.check(pg_temp.refused('ca', 'abe') like '42501%', 'FC10 the club''s own staff are refused: they read the club''s board, not a family''s answer');
select pg_temp.check(
  (select pg_temp.say_as(null, format('select public.family_membership_charge(%L, %L)', pg_temp.id('abe'), pg_temp.id('club')))) like '42501%',
  'FC11 signed out, nothing');
do $$
declare c jsonb := pg_temp.charge('ola', 'ivy', 'other');
begin
  perform pg_temp.check(c ->> 'programme_id' is null and c ->> 'taking_memberships' = 'false' and not (c ? 'monthly_amount_minor'),
    'FC12 a club that never set up memberships says so, with no figures');
end $$;

rollback;
