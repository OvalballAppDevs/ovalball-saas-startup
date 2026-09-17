-- =====================================================================================================
-- CLUB CLAIM AUTHORITY (Identity/Auth Slice 5, Phase 2 P, Y.13)
--
-- Deterministic and self-seeding.
--
-- The defect this suite exists to hold closed: approving a claim used to grant CLUB_ADMIN
-- unconditionally, on a blanket is_site_admin() test. A person who claimed a club as "Committee
-- Member" became its Club Admin because approval had exactly one outcome. L9 says a claimed title
-- grants nothing; section P makes the roles the REVIEWER's choice, with the title only suggesting.
-- =====================================================================================================
begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','clm-'||v::text||'@ovalball.test','',
    now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v,'Clm',p_label,'clm-'||v::text||'@ovalball.test',(current_date - interval '38 years')::date);
  return v;
end $$;

create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub',p_subject,'role','authenticated')::text, true);
  begin execute p_sql; v := 'OK'; exception when others then get stacked diagnostics v = returned_sqlstate; end;
  perform set_config('request.jwt.claims','', true);
  return v;
end $$;

create or replace function pg_temp.json_as(p_subject uuid, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub',p_subject,'role','authenticated')::text, true);
  execute p_sql into v;
  perform set_config('request.jwt.claims','', true);
  return v;
end $$;

create or replace function pg_temp.uuid_as(p_subject uuid, p_sql text) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub',p_subject,'role','authenticated')::text, true);
  execute p_sql into v;
  perform set_config('request.jwt.claims','', true);
  return v;
end $$;

create or replace function pg_temp.count_as(p_subject uuid, p_sql text) returns integer language plpgsql as $$
declare v integer;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub',p_subject,'role','authenticated')::text, true);
  perform set_config('role','authenticated', true);
  execute p_sql into v;
  perform set_config('role','none', true); perform set_config('request.jwt.claims','', true);
  return coalesce(v,0);
end $$;

-- =====================================================================================================
-- CL-A. Structure.
-- =====================================================================================================
do $$
begin
  perform pg_temp.check(
    (select count(*) from unnest(array['SUBMITTED','NEEDS_INFORMATION','APPROVED','REJECTED','WITHDRAWN','SUPERSEDED']) s
      where pg_get_constraintdef((select oid from pg_constraint where conrelid='public.club_claims'::regclass and conname='club_claims_state_check')) like '%'||s||'%') = 6,
    'CL-A1 all six claim states from section P exist');
  perform pg_temp.check(
    exists (select 1 from pg_indexes where tablename='club_claims' and indexdef like '%SUBMITTED%NEEDS_INFORMATION%'),
    'CL-A2 one live claim per person per club is an index, not a hope');
  perform pg_temp.check(to_regclass('public.club_claim_messages') is not null,
    'CL-A3 the NEEDS_INFORMATION conversation has somewhere to live');
  perform pg_temp.check(
    not has_table_privilege('anon','public.club_claims','SELECT')
    and not has_table_privilege('authenticated','public.club_claims','DELETE'),
    'CL-A4 anon reads no claim and nobody deletes one through the API');
  perform pg_temp.check(
    (select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='decide_club_claim') !~ '\minternal\.is_site_admin\(',
    'CL-A5 and deciding a claim no longer asks a blanket site-admin question');
end $$;

-- =====================================================================================================
-- CL-B .. CL-G. Behaviour.
-- =====================================================================================================
do $$
declare
  v_tag text := substr(gen_random_uuid()::text,1,8);
  v_dir uuid; v_dir2 uuid; v_claimant uuid; v_rival uuid; v_full uuid; v_data uuid; v_ro uuid; v_stranger uuid;
  v_claim uuid; v_rival_claim uuid; v_res jsonb; v_club uuid; v_i int; v_state text;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Claim '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','claim-'||v_tag) returning id into v_dir;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Claim Two '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','claim2-'||v_tag) returning id into v_dir2;

  v_claimant := pg_temp.person('CLAIMANT');
  v_rival    := pg_temp.person('RIVAL');
  v_stranger := pg_temp.person('STRANGER');
  v_full := pg_temp.person('FULL'); insert into public.site_admins (user_id,status,admin_role) values (v_full,'active','full');
  v_data := pg_temp.person('DATA'); insert into public.site_admins (user_id,status,admin_role) values (v_data,'active','club_data');
  v_ro   := pg_temp.person('RO');   insert into public.site_admins (user_id,status,admin_role) values (v_ro,'active','read_only');

  -- ---------------------------------------------------------------------------------------------
  -- CL-B  submitting
  -- ---------------------------------------------------------------------------------------------
  v_claim := pg_temp.uuid_as(v_claimant, format(
    'select public.submit_club_claim(%L, ''Committee Member'', ''I help run the club'', ''{}''::jsonb)', v_dir));
  perform pg_temp.check(v_claim is not null,
    'CL-B1 a signed-in person submits a claim');
  perform pg_temp.check((select state from public.club_claims where id = v_claim) = 'SUBMITTED',
    'CL-B2 which lands in SUBMITTED');
  perform pg_temp.check((select status from public.club_claims where id = v_claim) = 'pending',
    'CL-B3 and the legacy status column follows it, so the existing screen still works');
  perform pg_temp.check(
    pg_temp.try_as(v_claimant, format(
      'select public.submit_club_claim(%L, ''Club Secretary'', ''again'', ''{}''::jsonb)', v_dir)) <> 'OK',
    'CL-B4 one live claim per person per club -- a second is refused');
  perform pg_temp.check((select has_existing_admin from public.club_claims where id = v_claim) = false,
    'CL-B5 and the club has no existing Club Admin, which the reviewer is told');

  -- ---------------------------------------------------------------------------------------------
  -- CL-C  THE LOCKED INVARIANT: a claimed title grants nothing (L9)
  -- ---------------------------------------------------------------------------------------------
  v_res := pg_temp.json_as(v_full, format(
    'select public.decide_club_claim(%L, ''APPROVED'', ''matrix: approving a committee member'', null)', v_claim));
  perform pg_temp.check(v_res->>'outcome' = 'APPROVED',
    'CL-C1 a Full Site Admin approves the claim');
  perform pg_temp.check(jsonb_array_length(v_res->'roles') = 0,
    'CL-C2 and "Committee Member" grants NO role at all -- the title is L9, it describes a relationship');
  v_club := (v_res->>'club_id')::uuid;
  perform pg_temp.check(
    (select count(*) from public.role_assignments ra join public.club_memberships m on m.id = ra.membership_id
      where m.user_id = v_claimant and m.club_id = v_club and ra.role_key = 'CLUB_ADMIN' and ra.state = 'ACTIVE') = 0,
    'CL-C3 specifically: approving it did not manufacture a Club Admin, which is what it used to do');
  perform pg_temp.check(
    (select count(*) from public.club_memberships m where m.user_id = v_claimant and m.club_id = v_club and m.state = 'ACTIVE') = 1,
    'CL-C4 while the claimant IS an active member -- the claim was accepted, it just is not authority');
  perform pg_temp.check(
    internal.claim_suggested_roles('Club Chair / Chairman / Chairperson') = array['CLUB_ADMIN']::text[]
    and internal.claim_suggested_roles('Fixture Secretary') = array['FIXTURES_SECRETARY']::text[]
    and internal.claim_suggested_roles('Committee Member') = array[]::text[],
    'CL-C5 the title SUGGESTS a default to the reviewer -- Chair suggests Club Admin, Committee Member suggests nothing');

  -- ---------------------------------------------------------------------------------------------
  -- CL-D  who may decide, and who may grant
  -- ---------------------------------------------------------------------------------------------
  v_rival_claim := pg_temp.uuid_as(v_rival, format(
    'select public.submit_club_claim(%L, ''Club Chair / Chairman / Chairperson'', ''I chair it'', ''{}''::jsonb)', v_dir2));
  perform pg_temp.check(
    pg_temp.try_as(v_stranger, format('select public.decide_club_claim(%L, ''REJECTED'', ''no'', null)', v_rival_claim)) = '42501',
    'CL-D1 an ordinary person cannot decide a claim');
  perform pg_temp.check(
    pg_temp.try_as(v_ro, format('select public.decide_club_claim(%L, ''REJECTED'', ''no'', null)', v_rival_claim)) = '42501',
    'CL-D2 nor a read-only Site Admin');
  perform pg_temp.check(
    pg_temp.try_as(v_data, format('select public.decide_club_claim(%L, ''APPROVED'', ''triage approve'', array[''CLUB_ADMIN''])', v_rival_claim)) = '42501',
    'CL-D3 a club-data Site Admin may TRIAGE but may not grant a role -- section P splits those deliberately');
  perform pg_temp.check(
    pg_temp.try_as(v_data, format('select public.decide_club_claim(%L, ''APPROVED'', ''no roles'', array[]::text[])', v_rival_claim)) = 'OK',
    'CL-D4 and the same admin CAN approve when no role is being granted, which is the split working');
  perform pg_temp.check(
    (select state from public.club_claims where id = v_rival_claim) = 'APPROVED',
    'CL-D5 leaving the claim approved');
  perform pg_temp.check(
    pg_temp.try_as(v_full, format('select public.decide_club_claim(%L, ''REJECTED'', ''too late'', null)', v_rival_claim)) = 'P0001',
    'CL-D6 and a decided claim cannot be decided twice');

  -- ---------------------------------------------------------------------------------------------
  -- CL-E  the conversation
  -- ---------------------------------------------------------------------------------------------
  declare v_c3 uuid;
  begin
    v_c3 := pg_temp.uuid_as(v_stranger, format(
      'select public.submit_club_claim(%L, ''Treasurer'', ''I keep the books'', ''{}''::jsonb)', v_dir2));
    perform pg_temp.check(
      pg_temp.try_as(v_full, format('select public.reply_to_claim(%L, ''Can you send something official?'')', v_c3)) = 'OK',
      'CL-E1 a reviewer can ask the claimant a question');
    perform pg_temp.check((select state from public.club_claims where id = v_c3) = 'NEEDS_INFORMATION',
      'CL-E2 which moves the claim to NEEDS_INFORMATION');
    perform pg_temp.check(
      pg_temp.try_as(v_stranger, format('select public.reply_to_claim(%L, ''Here is my club email'')', v_c3)) = 'OK',
      'CL-E3 the claimant can answer');
    perform pg_temp.check((select state from public.club_claims where id = v_c3) = 'SUBMITTED',
      'CL-E4 which puts it back in front of a reviewer');
    perform pg_temp.check(
      pg_temp.try_as(v_rival, format('select public.reply_to_claim(%L, ''let me in'')', v_c3)) = '42501',
      'CL-E5 while somebody else''s claim is none of a stranger''s business');
    perform pg_temp.check(pg_temp.count_as(v_rival, format('select count(*) from public.club_claim_messages where claim_id = %L', v_c3)) = 0,
      'CL-E6 and they cannot read the conversation either');
    perform pg_temp.check(pg_temp.count_as(v_stranger, format('select count(*) from public.club_claim_messages where claim_id = %L', v_c3)) = 2,
      'CL-E7 while the claimant reads their own');
  end;

  -- ---------------------------------------------------------------------------------------------
  -- CL-F  competing claims are superseded, not silently left open
  -- ---------------------------------------------------------------------------------------------
  declare v_a uuid; v_b uuid; v_dir3 uuid;
  begin
    insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
    values ('Claim Three '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','claim3-'||v_tag) returning id into v_dir3;
    v_a := pg_temp.uuid_as(v_claimant, format('select public.submit_club_claim(%L, ''Club Secretary'', ''me'', ''{}''::jsonb)', v_dir3));
    v_b := pg_temp.uuid_as(v_rival,    format('select public.submit_club_claim(%L, ''Treasurer'', ''no, me'', ''{}''::jsonb)', v_dir3));
    v_res := pg_temp.json_as(v_full, format('select public.decide_club_claim(%L, ''APPROVED'', ''the secretary'', null)', v_a));
    perform pg_temp.check((v_res->>'superseded')::int = 1,
      'CL-F1 approving one claim supersedes the competing one');
    perform pg_temp.check((select state from public.club_claims where id = v_b) = 'SUPERSEDED'
      and (select superseded_by_claim_id from public.club_claims where id = v_b) = v_a,
      'CL-F2 and the superseded claim records which claim beat it, so the rival can be told why');
    perform pg_temp.check(jsonb_array_length(v_res->'roles') = 1 and v_res->'roles'->>0 = 'CLUB_ADMIN',
      'CL-F3 and "Club Secretary" does suggest Club Admin, so the default is not simply "nothing"');
  end;

  -- ---------------------------------------------------------------------------------------------
  -- CL-G  a claimant sees their own claim and nobody else's
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(pg_temp.count_as(v_claimant, format('select count(*) from public.club_claims where id = %L', v_claim)) = 1,
    'CL-G1 a claimant reads their own claim');
  perform pg_temp.check(pg_temp.count_as(v_rival, format('select count(*) from public.club_claims where id = %L', v_claim)) = 0,
    'CL-G2 and not somebody else''s');
  perform pg_temp.check(pg_temp.count_as(v_full, format('select count(*) from public.club_claims where id = %L', v_claim)) = 1,
    'CL-G3 while a reviewer sees it');

  -- ---------------------------------------------------------------------------------------------
  -- CL-H  approval carries the WHOLE canonical effect, not just the parts section P lists
  --
  -- The first cut of decide_club_claim reproduced only what section P describes and silently dropped
  -- five behaviours the Slice 2 approval had carried since it was written -- most damagingly the
  -- referral reconciliation, which is how a referral learns which club it produced.
  -- platform_activation caught that one; these pin all of them.
  -- ---------------------------------------------------------------------------------------------
  declare v_src text;
  begin
    select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'decide_club_claim';
    perform pg_temp.check(v_src ~ 'reconcile_partner_invitations',
      'CL-H1 approval still reconciles partner invitations, so a referral learns which club it produced');
    perform pg_temp.check(v_src ~ 'seed_teams_from_proposal',
      'CL-H2 and still seeds the teams the claimant proposed');
    perform pg_temp.check(v_src ~ 'lock_club_people',
      'CL-H3 and still takes the club-people lock before touching membership');
    perform pg_temp.check(v_src ~ 'admit_club_member',
      'CL-H4 and still admits through the canonical path rather than inserting a membership directly');
    perform pg_temp.check(v_src ~ 'club_setup_state',
      'CL-H5 and still gives a genuinely new club its setup state');
    perform pg_temp.check(v_src ~ 'club_claim_approved',
      'CL-H6 and still tells the claimant');
  end;

  -- And behaviourally: a new club really is set up, and the claimant really is admitted.
  perform pg_temp.check(
    (select count(*) from public.club_setup_state where club_id = v_club) = 1,
    'CL-H7 the club created by an approval has setup state');
  perform pg_temp.check(
    (select source from public.club_memberships where user_id = v_claimant and club_id = v_club and state = 'ACTIVE') = 'CLAIM_APPROVAL',
    'CL-H8 and the membership records that a claim approval is where it came from');
end $$;

rollback;
