-- Club activation -- the first-run setup lifecycle, structured venue
-- address, safe team removal and pitch->venue integrity.
--
-- What matters here: setup state is orchestration and never a second copy
-- of the club's data; completion re-derives every requirement rather than
-- trusting a step number; a club cannot be activated while something it
-- needs is missing; onboarding is not a route to destroy history; and a
-- pitch cannot be attached to another club's ground.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin_a uuid := gen_random_uuid();   -- Club Admin, club A
  v_admin_b uuid := gen_random_uuid();   -- Club Admin, club B
  v_coach   uuid := gen_random_uuid();   -- Coach at club A (no setup authority)
  v_dir_a uuid; v_dir_b uuid; v_club_a uuid; v_club_b uuid;
  v_venue_a uuid; v_venue_b uuid; v_venue_a2 uuid;
  v_pitch uuid; v_pitch_b uuid;
  v_team_pristine uuid; v_team_used uuid;
  v_season uuid; v_type_senior uuid; v_type_junior uuid;
  v_cat1 text; v_age1 text; v_gen1 text; v_squad1 text;
  v_cat2 text; v_age2 text; v_gen2 text; v_squad2 text;
  r record;
  v_count int; v_text text; v_uuid uuid;
  v_ok boolean;
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (v_admin_a,'setupadmina@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_admin_b,'setupadminb@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_coach,  'setupcoach@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  insert into public.profiles (id, first_name, surname, email) values
    (v_admin_a,'Setup','AdminA','setupadmina@ovalball-test.invalid'),
    (v_admin_b,'Setup','AdminB','setupadminb@ovalball-test.invalid'),
    (v_coach,'Setup','Coach','setupcoach@ovalball-test.invalid');

  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key) values
    ('Setup Test A RUFC','union','England','England','manual','verified','setup-test-a'),
    ('Setup Test B RUFC','union','England','England','manual','verified','setup-test-b');
  select id into v_dir_a from public.club_directory where normalized_key='setup-test-a';
  select id into v_dir_b from public.club_directory where normalized_key='setup-test-b';
  insert into public.clubs (directory_id, slug, status) values (v_dir_a,'setup-test-a','active') returning id into v_club_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b,'setup-test-b','active') returning id into v_club_b;

  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club_a, v_admin_a, 'CLUB_ADMIN','active'),
    (v_club_b, v_admin_b, 'CLUB_ADMIN','active'),
    (v_club_a, v_coach,   'BASIC_USER','active');

  -- Both clubs start unset-up. The trigger/backfill grandfathered only the
  -- clubs that existed when 20261016000000 ran, so a club created now is
  -- genuinely NOT_STARTED -- which is the whole point of the lifecycle.
  insert into public.club_setup_state (club_id) values (v_club_a), (v_club_b)
  on conflict (club_id) do nothing;

  -- =================================================================
  -- A. Requirements are derived, not stored
  -- =================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role','authenticated')::text, true);

  select * into r from public.club_setup_requirements(v_club_a);
  if not r.has_logo and not r.has_primary_kit and not r.has_default_venue
     and not r.teams_confirmed and not r.step1_complete then
    raise notice 'PASS 1 (A): a brand new club meets no requirement';
  else
    raise notice 'FAIL 1 (A): new club already claims requirements met';
  end if;

  -- =================================================================
  -- B. Completion refuses an unfinished club, and names what is missing
  -- =================================================================
  begin
    perform public.complete_club_setup(v_club_a);
    raise notice 'FAIL 2 (B): an unfinished club was activated';
  exception when others then
    if sqlerrm like '%Still needed%' and sqlerrm like '%club logo%' and sqlerrm like '%home kit%' then
      raise notice 'PASS 2 (B): completion refuses and lists what is missing';
    else
      raise notice 'FAIL 2 (B): wrong refusal: %', sqlerrm;
    end if;
  end;

  -- =================================================================
  -- C. Step 1 -- logo and kit
  -- =================================================================
  update public.clubs set logo_storage_path = 'club-logos/setup-a.png' where id = v_club_a;
  select * into r from public.club_setup_requirements(v_club_a);
  if r.has_logo and not r.step1_complete then
    raise notice 'PASS 3 (C): a logo alone does not finish step 1';
  else
    raise notice 'FAIL 3 (C): step1_complete=% with kit missing', r.step1_complete;
  end if;

  perform public.upsert_club_kit(v_club_a, 'HOOPS', '#7a1f3d', '#ffffff', null);
  select * into r from public.club_setup_requirements(v_club_a);
  if r.has_primary_kit and r.step1_complete then
    raise notice 'PASS 4 (C): logo + home kit finishes step 1';
  else
    raise notice 'FAIL 4 (C): step 1 still incomplete';
  end if;

  -- The requirement is re-derived, so removing the logo un-finishes it.
  update public.clubs set logo_storage_path = null where id = v_club_a;
  select * into r from public.club_setup_requirements(v_club_a);
  if not r.step1_complete then
    raise notice 'PASS 5 (C): removing the logo un-finishes step 1 (derived, not cached)';
  else
    raise notice 'FAIL 5 (C): step 1 stayed complete after the logo was removed';
  end if;
  update public.clubs set logo_storage_path = 'club-logos/setup-a.png' where id = v_club_a;

  -- =================================================================
  -- D. Step 2 -- venue, structured address, pitch
  -- =================================================================
  v_venue_a := public.create_venue(v_club_a, 'Setup A Ground', '', 'BB11 1AA', '', true);

  select * into r from public.club_setup_requirements(v_club_a);
  if r.has_default_venue and not r.default_venue_has_address and not r.default_venue_has_pitch then
    raise notice 'PASS 6 (D): a bare default venue satisfies neither address nor pitch';
  else
    raise notice 'FAIL 6 (D): addr=% pitch=%', r.default_venue_has_address, r.default_venue_has_pitch;
  end if;

  perform public.set_venue_address(v_venue_a, 'Coal Clough Lane', '', 'Burnley', 'Lancashire', 'BB11 1AA', 'United Kingdom');

  select address_line_1, town, county, postcode, country, address
  into r from public.venues where id = v_venue_a;
  if r.address_line_1 = 'Coal Clough Lane' and r.town = 'Burnley' and r.county = 'Lancashire'
     and r.postcode = 'BB11 1AA' and r.country = 'United Kingdom' then
    raise notice 'PASS 7 (D): the structured address columns are written';
  else
    raise notice 'FAIL 7 (D): structured address wrong';
  end if;

  -- The legacy display line is regenerated from the structured parts rather
  -- than left stale beside them.
  if r.address = 'Coal Clough Lane, Burnley, Lancashire' then
    raise notice 'PASS 8 (D): the legacy display line is regenerated, not stale';
  else
    raise notice 'FAIL 8 (D): legacy address is "%"', r.address;
  end if;

  select * into r from public.club_setup_requirements(v_club_a);
  if r.default_venue_has_address and not r.step2_complete then
    raise notice 'PASS 9 (D): an address without a pitch does not finish step 2';
  else
    raise notice 'FAIL 9 (D): step2_complete=% with no pitch', r.step2_complete;
  end if;

  -- =================================================================
  -- E. Pitch -> venue: created attached, and the attachment is validated
  -- =================================================================
  v_pitch := public.create_club_pitch(v_club_a, 'Main Pitch', null, v_venue_a);
  select venue_id into v_uuid from public.club_pitches where id = v_pitch;
  if v_uuid = v_venue_a then
    raise notice 'PASS 10 (E): a pitch can be created already attached to its venue';
  else
    raise notice 'FAIL 10 (E): pitch venue_id is %', v_uuid;
  end if;

  select * into r from public.club_setup_requirements(v_club_a);
  if r.default_venue_has_pitch and r.step2_complete then
    raise notice 'PASS 11 (E): venue + address + attached pitch finishes step 2';
  else
    raise notice 'FAIL 11 (E): step 2 still incomplete';
  end if;

  -- A pitch at a venue that is NOT the default does not satisfy the
  -- requirement -- the requirement is about the home ground specifically.
  v_venue_a2 := public.create_venue(v_club_a, 'Setup A Second Ground', '', 'BB11 2BB', '', false);
  perform public.set_club_pitch_venue(v_pitch, v_venue_a2);
  select * into r from public.club_setup_requirements(v_club_a);
  if not r.default_venue_has_pitch then
    raise notice 'PASS 12 (E): a pitch at a non-default venue does not count as the home pitch';
  else
    raise notice 'FAIL 12 (E): a pitch elsewhere satisfied the home-venue requirement';
  end if;
  perform public.set_club_pitch_venue(v_pitch, v_venue_a);

  -- The cross-club hole. Club B's venue must be unreachable from club A's
  -- pitch, through the RPC and through the direct table update alike.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_b, 'role','authenticated')::text, true);
  v_venue_b := public.create_venue(v_club_b, 'Setup B Ground', '', 'BB12 1CC', '', true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role','authenticated')::text, true);
  begin
    perform public.set_club_pitch_venue(v_pitch, v_venue_b);
    raise notice 'FAIL 13 (E): club A attached its pitch to club B''s venue';
  exception when others then
    if sqlerrm like '%does not belong to this club%' then
      raise notice 'PASS 13 (E): a pitch cannot be attached to another club''s venue';
    else
      raise notice 'FAIL 13 (E): wrong refusal: %', sqlerrm;
    end if;
  end;

  begin
    perform public.create_club_pitch(v_club_a, 'Smuggled Pitch', null, v_venue_b);
    raise notice 'FAIL 14 (E): a pitch was created at another club''s venue';
  exception when others then
    if sqlerrm like '%does not belong to this club%' then
      raise notice 'PASS 14 (E): a pitch cannot be created at another club''s venue';
    else
      raise notice 'FAIL 14 (E): wrong refusal: %', sqlerrm;
    end if;
  end;

  -- Clearing the attachment is a legitimate correction, not a delete.
  perform public.set_club_pitch_venue(v_pitch, null);
  select count(*) into v_count from public.club_pitches where id = v_pitch;
  select venue_id into v_uuid from public.club_pitches where id = v_pitch;
  if v_count = 1 and v_uuid is null then
    raise notice 'PASS 15 (E): clearing a venue detaches the pitch without deleting it';
  else
    raise notice 'FAIL 15 (E): count=% venue=%', v_count, v_uuid;
  end if;
  perform public.set_club_pitch_venue(v_pitch, v_venue_a);

  -- Exactly one create_club_pitch signature -- the overload trap.
  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_club_pitch';
  if v_count = 1 then
    raise notice 'PASS 16 (E): create_club_pitch has exactly one signature';
  else
    raise notice 'FAIL 16 (E): % create_club_pitch signatures', v_count;
  end if;

  -- =================================================================
  -- F. Step 3 -- team confirmation
  -- =================================================================
  -- Team fields are derived from the canonical type rather than typed by
  -- hand: teams_canonical_type_matches_fields requires them to agree.
  select id, category, age_group, gender, fixed_squad_designation
  into v_type_senior, v_cat1, v_age1, v_gen1, v_squad1
  from public.canonical_team_types where is_active and category = 'senior' order by sort_order limit 1;
  select id, category, age_group, gender, fixed_squad_designation
  into v_type_junior, v_cat2, v_age2, v_gen2, v_squad2
  from public.canonical_team_types where is_active and category = 'youth' order by sort_order limit 1;

  insert into public.teams (club_id, display_name, category, age_group, gender, squad_designation, rugby_code, canonical_team_type_id, active)
  values (v_club_a, 'Setup A Seniors', v_cat1, v_age1, v_gen1, v_squad1, 'union', v_type_senior, true) returning id into v_team_pristine;
  insert into public.teams (club_id, display_name, category, age_group, gender, squad_designation, rugby_code, canonical_team_type_id, active)
  values (v_club_a, 'Setup A Youth', v_cat2, v_age2, v_gen2, v_squad2, 'union', v_type_junior, true) returning id into v_team_used;

  select * into r from public.club_setup_requirements(v_club_a);
  if not r.teams_confirmed then
    raise notice 'PASS 17 (F): having teams is not the same as confirming them';
  else
    raise notice 'FAIL 17 (F): teams counted as confirmed without confirmation';
  end if;

  perform public.confirm_club_teams(v_club_a);
  select * into r from public.club_setup_requirements(v_club_a);
  if r.teams_confirmed and r.step3_complete then
    raise notice 'PASS 18 (F): confirming the team list finishes step 3';
  else
    raise notice 'FAIL 18 (F): step 3 still incomplete';
  end if;

  -- Idempotent: confirming twice keeps the FIRST confirmation.
  select teams_confirmed_at into v_text from public.club_setup_state where club_id = v_club_a;
  perform pg_sleep(0.01);
  perform public.confirm_club_teams(v_club_a);
  select (teams_confirmed_at::text = v_text) into v_ok from public.club_setup_state where club_id = v_club_a;
  if v_ok then
    raise notice 'PASS 19 (F): re-confirming keeps the original confirmation timestamp';
  else
    raise notice 'FAIL 19 (F): the confirmation timestamp moved';
  end if;

  -- =================================================================
  -- G. Safe team removal
  -- =================================================================
  select classification into v_text from public.classify_team_removal(v_team_pristine);
  if v_text = 'pristine' then
    raise notice 'PASS 20 (G): a team with no references classifies as PRISTINE';
  else
    raise notice 'FAIL 20 (G): classification is %', v_text;
  end if;

  -- Give the second team real history, then confirm it is protected.
  insert into public.team_contacts (team_id, role, name, is_public)
  values (v_team_used, 'head_coach', 'Setup Coach', false);

  select classification into v_text from public.classify_team_removal(v_team_used);
  if v_text = 'referenced' then
    raise notice 'PASS 21 (G): a team with history classifies as REFERENCED';
  else
    raise notice 'FAIL 21 (G): classification is %', v_text;
  end if;

  v_text := public.remove_setup_team(v_team_pristine);
  select count(*) into v_count from public.teams where id = v_team_pristine;
  if v_text = 'deleted' and v_count = 0 then
    raise notice 'PASS 22 (G): a pristine team is removed outright';
  else
    raise notice 'FAIL 22 (G): result=% remaining=%', v_text, v_count;
  end if;

  v_text := public.remove_setup_team(v_team_used);
  select count(*) into v_count from public.teams where id = v_team_used;
  select active into v_ok from public.teams where id = v_team_used;
  if v_text = 'folded' and v_count = 1 and not v_ok then
    raise notice 'PASS 23 (G): a referenced team is retired, never deleted';
  else
    raise notice 'FAIL 23 (G): result=% remaining=% active=%', v_text, v_count, v_ok;
  end if;

  -- The membership that made it REFERENCED is still there. Onboarding did
  -- not cascade through the club's real records.
  select count(*) into v_count from public.team_contacts where team_id = v_team_used;
  if v_count = 1 then
    raise notice 'PASS 24 (G): retiring a team leaves its history intact';
  else
    raise notice 'FAIL 24 (G): % memberships survive', v_count;
  end if;

  -- =================================================================
  -- H. Completion
  -- =================================================================
  select * into r from public.club_setup_requirements(v_club_a);
  if r.step1_complete and r.step2_complete and r.step3_complete then
    v_text := public.complete_club_setup(v_club_a);
    if v_text = 'completed' then
      raise notice 'PASS 25 (H): a club meeting every requirement activates';
    else
      raise notice 'FAIL 25 (H): completion returned %', v_text;
    end if;
  else
    raise notice 'FAIL 25 (H): requirements not met at completion time';
  end if;

  select status, completed_by into r from public.club_setup_state where club_id = v_club_a;
  if r.status = 'COMPLETED' and r.completed_by = v_admin_a then
    raise notice 'PASS 26 (H): completion records who activated the club';
  else
    raise notice 'FAIL 26 (H): status=% by=%', r.status, r.completed_by;
  end if;

  -- Idempotent: a double-clicked Finish answers the same, it does not fail.
  v_text := public.complete_club_setup(v_club_a);
  if v_text = 'already_complete' then
    raise notice 'PASS 27 (H): completing twice is idempotent';
  else
    raise notice 'FAIL 27 (H): second completion returned %', v_text;
  end if;

  -- A completed club whose venue is later deactivated stays COMPLETED. The
  -- lifecycle is a one-way activation, not a live health check -- a working
  -- club must never be dropped back into onboarding mid-season.
  perform public.set_venue_active(v_venue_a, false);
  select status into v_text from public.club_setup_state where club_id = v_club_a;
  select * into r from public.club_setup_requirements(v_club_a);
  if v_text = 'COMPLETED' and not r.step2_complete then
    raise notice 'PASS 28 (H): an activated club is not re-gated when data later changes';
  else
    raise notice 'FAIL 28 (H): status=% step2=%', v_text, r.step2_complete;
  end if;
  perform public.set_venue_active(v_venue_a, true);

  -- =================================================================
  -- I. Authority
  -- =================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach, 'role','authenticated')::text, true);

  begin
    perform public.advance_club_setup(v_club_b, 1);
    raise notice 'FAIL 29 (I): a coach advanced setup';
  exception when others then
    raise notice 'PASS 29 (I): a coach cannot advance setup';
  end;

  begin
    perform public.complete_club_setup(v_club_b);
    raise notice 'FAIL 30 (I): a coach activated a club';
  exception when others then
    raise notice 'PASS 30 (I): a coach cannot activate a club';
  end;

  -- A member CAN read the state -- the shell shows them a bounded "not
  -- ready yet" screen and needs to know why.
  begin
    select * into r from public.club_setup_requirements(v_club_a);
    raise notice 'PASS 31 (I): a club member can read their own club''s setup state';
  exception when others then
    raise notice 'FAIL 31 (I): a member could not read setup state: %', sqlerrm;
  end;

  -- Cross-club: club A's admin has no authority over club B.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role','authenticated')::text, true);
  begin
    perform public.confirm_club_teams(v_club_b);
    raise notice 'FAIL 32 (I): club A confirmed club B''s teams';
  exception when others then
    raise notice 'PASS 32 (I): a Club Admin has no setup authority over another club';
  end;

  begin
    select * into r from public.club_setup_requirements(v_club_b);
    raise notice 'FAIL 33 (I): club A read club B''s setup state';
  exception when others then
    raise notice 'PASS 33 (I): a Club Admin cannot read another club''s setup state';
  end;

  -- =================================================================
  -- J. Orchestration only -- no shadow copy of club data
  -- =================================================================
  perform set_config('request.jwt.claims', null, true);
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'club_setup_state'
    and column_name in ('logo_storage_path','kit_pattern','venue_name','postcode','team_count','address');
  if v_count = 0 then
    raise notice 'PASS 34 (J): club_setup_state stores no copy of the club''s own data';
  else
    raise notice 'FAIL 34 (J): % duplicated columns on club_setup_state', v_count;
  end if;

  -- Dropping the progress row loses progress and nothing else: every piece
  -- of real data survives it.
  delete from public.club_setup_state where club_id = v_club_a;
  select count(*) into v_count from public.venues where club_id = v_club_a;
  if v_count = 2 and exists (select 1 from public.club_kits where club_id = v_club_a)
     and exists (select 1 from public.club_pitches where club_id = v_club_a) then
    raise notice 'PASS 35 (J): deleting the setup row destroys no operational data';
  else
    raise notice 'FAIL 35 (J): operational data went with the setup row';
  end if;

  -- =================================================================
  -- K. Existing clubs were grandfathered
  -- =================================================================
  select count(*) into v_count
  from public.clubs c
  left join public.club_setup_state s on s.club_id = c.id
  where c.status = 'active' and c.created_at < '2026-09-01' and coalesce(s.status,'MISSING') <> 'COMPLETED';
  if v_count = 0 then
    raise notice 'PASS 36 (K): no pre-existing active club was left gated';
  else
    raise notice 'FAIL 36 (K): % pre-existing clubs are gated', v_count;
  end if;
end;
$$;

rollback;
