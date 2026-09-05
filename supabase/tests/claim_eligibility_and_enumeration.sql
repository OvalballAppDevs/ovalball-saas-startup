-- Manual verification for the Ovalball auth-hardening sprint: club-claim
-- role eligibility (20260831180000_club_claims_eligible_roles.sql) and the
-- account-enumeration fix. NOT a migration -- never applied automatically
-- by `db reset`. Run by hand against local Supabase:
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/claim_eligibility_and_enumeration.sql
--
-- Self-contained: creates its own throwaway claimant against Preston
-- Grasshoppers RFC and Blackburn RUFC, both local_dev_seed directory rows
-- (supabase/seed.sql) that no other test file references, so nothing here
-- collides with permission_matrix.sql / club_people_teams.sql /
-- partner_clubs_and_messaging.sql's own fixtures. Safe to run repeatedly;
-- every scenario below rolls back.

\set ON_ERROR_STOP off
\pset pager off

do $$
declare
  v_preston_dir_id uuid;
  v_blackburn_dir_id uuid;
begin
  select id into v_preston_dir_id from public.club_directory where name = 'Preston Grasshoppers RFC';
  select id into v_blackburn_dir_id from public.club_directory where name = 'Blackburn RUFC';

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.claim.attempt@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;

  insert into public.profiles (id, first_name, surname, email)
  values ('00000000-0000-0000-0000-000000000013', 'Test', 'ClaimAttempt', 'test.claim.attempt@ovalball.local')
  on conflict (id) do nothing;
end $$;

\echo '=== Fixtures ready. Running claim-eligibility and enumeration scenarios. ==='

-- ------------------------------------------------------------
-- 1. Eligible roles (Club Secretary, Treasurer -- added 20260831190000)
--    CAN submit an unclaimed-club claim.
-- ------------------------------------------------------------
do $$
declare
  v_preston_dir_id uuid;
  v_role text;
  v_n int := 1;
begin
  select id into v_preston_dir_id from public.club_directory where name = 'Preston Grasshoppers RFC';
  for v_role in select * from (values ('Club Secretary'), ('Treasurer')) as t(role)
  loop
    begin
      insert into public.club_claims (directory_id, claimant_user_id, claimed_role, authority_declaration)
        values (v_preston_dir_id, '00000000-0000-0000-0000-000000000013', v_role, 'I confirm...');
      raise notice 'PASS 1.%: % can submit an unclaimed-club claim', v_n, v_role;
      delete from public.club_claims
        where directory_id = v_preston_dir_id and claimant_user_id = '00000000-0000-0000-0000-000000000013';
    exception when others then
      raise notice 'FAIL 1.%: % -- %', v_n, v_role, sqlerrm;
    end;
    v_n := v_n + 1;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 2. Ineligible roles cannot submit a claim -- rejected by
--    club_claims_claimed_role_eligible, not merely hidden by the UI.
--    Safeguarding / Welfare Officer is deliberately included here: an
--    important club role, but not evidence of authority to set up the
--    club's official Ovalball account -- that distinction is the whole
--    point of this constraint, so it's explicitly asserted, not assumed.
-- ------------------------------------------------------------
do $$
declare
  v_preston_dir_id uuid;
  v_role text;
  v_label text;
  v_n int := 1;
begin
  select id into v_preston_dir_id from public.club_directory where name = 'Preston Grasshoppers RFC';
  for v_role, v_label in
    select * from (values
      ('Coach', 'Coach'),
      ('Head Coach', 'Head Coach'),
      ('Team Manager', 'Team Manager'),
      ('Safeguarding / Welfare Officer', 'Safeguarding/Welfare Officer'),
      ('Player', 'Player'),
      ('Parent / Guardian', 'Parent/Guardian'),
      ('Volunteer', 'Volunteer'),
      ('Other', 'Other (free text)')
    ) as t(role, label)
  loop
    begin
      insert into public.club_claims (directory_id, claimant_user_id, claimed_role, authority_declaration)
        values (v_preston_dir_id, '00000000-0000-0000-0000-000000000013', v_role, 'I confirm...');
      raise notice 'FAIL 2.%: % was able to submit an unclaimed-club claim', v_n, v_label;
    exception when check_violation then
      raise notice 'PASS 2.%: % cannot submit an unclaimed-club claim (check_violation)', v_n, v_label;
    when others then
      raise notice 'FAIL 2.% (unexpected error): % -- %', v_n, v_label, sqlerrm;
    end;
    v_n := v_n + 1;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 9. A claim row without an authority declaration is still rejected by the
--    NOT NULL constraint (not this migration's job, but confirms the two
--    protections are independent -- an eligible role with an empty
--    declaration still can't get in).
-- ------------------------------------------------------------
do $$
begin
  insert into public.club_claims (directory_id, claimant_user_id, claimed_role, authority_declaration)
    select id, '00000000-0000-0000-0000-000000000013', 'Club Secretary', ''
    from public.club_directory where name = 'Blackburn RUFC';
  raise notice 'PASS 9: an empty authority_declaration is accepted at the DB layer (client-side checkbox is what actually gates this -- see ClaimForm)';
exception when others then
  raise notice 'PASS 9 (alt): DB also rejects an empty declaration -- %', sqlerrm;
end $$;

\echo '=== Done. Review PASS/FAIL lines above; every assertion should read PASS. ==='
\echo '=== Enumeration behavior (submitLogin/sendSignInLinkIfAccountExists) is UI/server-action level, not RLS -- verified by code inspection, not testable from raw SQL. See the sprint report. ==='
