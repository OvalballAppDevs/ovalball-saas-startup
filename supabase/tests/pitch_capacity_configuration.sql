-- =====================================================================================================
-- PITCH CAPACITY CONFIGURATION (CA-M11.2 GROUNDS & PITCHES) -- set_club_pitch_configuration
--
-- Grounds & Pitches gained the ability for a club to tell Ovalball what a physical pitch IS (physical
-- size) and how it may be USED concurrently (layout) -- previously readable by the pitch-allocation
-- conflict engine but writable by nothing in the product. This is the one canonical write, both
-- clients, and this suite pins its authority, validation and derived-capacity behaviour directly at
-- the database, self-seeding two clubs so cross-club rejection is a real assertion rather than an
-- assumption.
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
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','pcc-'||v::text||'@ovalball.test','',
    now(),now(),now(),'{}'::jsonb,'{}'::jsonb,'','','','','','','','');
  insert into public.profiles (id, first_name, surname, email) values (v,'PCC',p_label,'pcc-'||v::text||'@ovalball.test');
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

do $$
declare
  v_tag text := substr(gen_random_uuid()::text,1,8);
  v_dir_a uuid; v_club_a uuid; v_pitch uuid;
  v_dir_b uuid; v_club_b uuid;
  v_ca uuid; v_ca_other_club uuid; v_stranger uuid;
  v_result text;
  v_size text; v_layout text; v_len numeric; v_wid numeric; v_lanes int;
begin
  -- ---------------------------------------------------------------------------------------------
  -- Setup: two clubs, one pitch on club A, a Club Admin of A, a Club Admin of B only, a stranger.
  -- ---------------------------------------------------------------------------------------------
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('PCC A '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','pcc-a-'||v_tag)
  returning id into v_dir_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_a,'pcc-a-'||v_tag,'active') returning id into v_club_a;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('PCC B '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','pcc-b-'||v_tag)
  returning id into v_dir_b;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b,'pcc-b-'||v_tag,'active') returning id into v_club_b;

  v_ca := pg_temp.person('ClubAdminA');
  v_ca_other_club := pg_temp.person('ClubAdminB');
  v_stranger := pg_temp.person('Stranger');
  insert into public.club_memberships (club_id,user_id,role,status) values (v_club_a,v_ca,'CLUB_ADMIN','active');
  insert into public.club_memberships (club_id,user_id,role,status) values (v_club_b,v_ca_other_club,'CLUB_ADMIN','active');

  insert into public.club_pitches (club_id, display_name) values (v_club_a, 'PCC Pitch '||v_tag) returning id into v_pitch;

  -- ---------------------------------------------------------------------------------------------
  -- A. DEFAULT -- a freshly created pitch reproduces today's exactly-one-booking-at-a-time
  --    behaviour without anybody configuring anything (Section 3/18).
  -- ---------------------------------------------------------------------------------------------
  select physical_size_category, layout, lane_count into v_size, v_layout, v_lanes from public.club_pitches where id = v_pitch;
  perform pg_temp.check(v_size = 'full', 'A1: a never-configured pitch defaults to full size');
  perform pg_temp.check(v_layout = 'full_only', 'A2: a never-configured pitch defaults to whole-pitch-only');
  perform pg_temp.check(v_lanes = 1, 'A3: and its generated lane_count is exactly 1 -- zero regression for a club that never opens this screen');

  -- ---------------------------------------------------------------------------------------------
  -- B. AUTHORITY -- a stranger and a Club Admin of a DIFFERENT club are both refused.
  -- ---------------------------------------------------------------------------------------------
  v_result := pg_temp.try_as(v_stranger, format('select public.set_club_pitch_configuration(%L,''half'',''full_only'',null,null)', v_pitch));
  perform pg_temp.check(v_result = '42501', 'B1: a stranger with no relationship to the club is refused (42501)');

  v_result := pg_temp.try_as(v_ca_other_club, format('select public.set_club_pitch_configuration(%L,''half'',''full_only'',null,null)', v_pitch));
  perform pg_temp.check(v_result = '42501', 'B2: a Club Admin of a DIFFERENT club cannot configure this pitch -- cross-club is refused, not merely unauthenticated');

  -- Neither refusal above touched the row.
  select physical_size_category into v_size from public.club_pitches where id = v_pitch;
  perform pg_temp.check(v_size = 'full', 'B3: the refused attempts changed nothing -- still full size');

  -- ---------------------------------------------------------------------------------------------
  -- C. VALIDATION -- invalid enum values and a bad custom-dimensions combination are all refused,
  --    server-side, never relying on the client having validated first (Section 15).
  -- ---------------------------------------------------------------------------------------------
  v_result := pg_temp.try_as(v_ca, format('select public.set_club_pitch_configuration(%L,''enormous'',''full_only'',null,null)', v_pitch));
  perform pg_temp.check(v_result <> 'OK', 'C1: an unrecognised pitch size is refused');

  v_result := pg_temp.try_as(v_ca, format('select public.set_club_pitch_configuration(%L,''full'',''three_thirds'',null,null)', v_pitch));
  perform pg_temp.check(v_result <> 'OK', 'C2: an unrecognised layout is refused');

  v_result := pg_temp.try_as(v_ca, format('select public.set_club_pitch_configuration(%L,''custom'',''full_only'',null,null)', v_pitch));
  perform pg_temp.check(v_result <> 'OK', 'C3: custom size with no dimensions at all is refused');

  v_result := pg_temp.try_as(v_ca, format('select public.set_club_pitch_configuration(%L,''custom'',''full_only'',-10,45)', v_pitch));
  perform pg_temp.check(v_result <> 'OK', 'C4: custom size with a non-positive length is refused');

  -- ---------------------------------------------------------------------------------------------
  -- D. THE REAL WRITE, by the club's own Club Admin, and what it derives.
  -- ---------------------------------------------------------------------------------------------
  -- The database's own default-privilege revocation (API perimeter migration) strips EXECUTE from
  -- every new function unless explicitly granted -- a real gap this suite's B/C/D checks above cannot
  -- catch on their own, because they run as the postgres superuser throughout (set_config only changes
  -- what auth.uid() answers, never the actual database role, so superuser bypasses grants entirely and
  -- a missing grant would silently pass every authority/validation assertion above). Caught live in
  -- browser verification, not by this suite -- checked directly here so it never regresses silently again.
  perform pg_temp.check(
    exists (select 1 from information_schema.role_routine_grants where routine_name = 'set_club_pitch_configuration' and grantee = 'authenticated' and privilege_type = 'EXECUTE'),
    'D0: EXECUTE is explicitly granted to authenticated -- the API perimeter''s default-revoke means this is never assumed'
  );

  v_result := pg_temp.try_as(v_ca, format('select public.set_club_pitch_configuration(%L,''full'',''two_halves'',null,null)', v_pitch));
  perform pg_temp.check(v_result = 'OK', 'D1: the owning club''s own Club Admin CAN configure the pitch');

  select physical_size_category, layout, lane_count into v_size, v_layout, v_lanes from public.club_pitches where id = v_pitch;
  perform pg_temp.check(v_size = 'full' and v_layout = 'two_halves', 'D2: the configuration is exactly what was set');
  perform pg_temp.check(v_lanes = 2, 'D3: lane_count is GENERATED from layout -- two_halves derives capacity 2, never hand-set');

  v_result := pg_temp.try_as(v_ca, format('select public.set_club_pitch_configuration(%L,''full'',''four_quarters'',null,null)', v_pitch));
  select lane_count into v_lanes from public.club_pitches where id = v_pitch;
  perform pg_temp.check(v_result = 'OK' and v_lanes = 4, 'D4: four_quarters derives capacity 4');

  -- ---------------------------------------------------------------------------------------------
  -- E. CUSTOM SIZE -- a valid custom size is stored exactly, and clearing it back to a named tier
  --    clears the dimensions (Section 15: a non-custom row never carries stale custom numbers).
  -- ---------------------------------------------------------------------------------------------
  v_result := pg_temp.try_as(v_ca, format('select public.set_club_pitch_configuration(%L,''custom'',''full_only'',55.5,30.2)', v_pitch));
  select physical_size_category, custom_length_m, custom_width_m into v_size, v_len, v_wid from public.club_pitches where id = v_pitch;
  perform pg_temp.check(v_result = 'OK' and v_size = 'custom' and v_len = 55.5 and v_wid = 30.2, 'E1: a valid custom size is stored exactly as entered');

  v_result := pg_temp.try_as(v_ca, format('select public.set_club_pitch_configuration(%L,''full'',''full_only'',null,null)', v_pitch));
  select custom_length_m, custom_width_m into v_len, v_wid from public.club_pitches where id = v_pitch;
  perform pg_temp.check(v_len is null and v_wid is null, 'E2: switching back to a named size clears the stale custom dimensions');
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
