-- Venue / pitch / team integrity across the first-run setup surface.
--
-- The wizard writes through the canonical RPCs, so what has to hold is that
-- those RPCs keep the identities stable and the history intact: a venue and
-- a pitch keep their id through a rename, a fixture keeps pointing at the
-- same physical pitch, a referenced team is never destroyed, and nothing
-- reaches across clubs.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_admin2 uuid := gen_random_uuid();
  v_dir uuid; v_dir2 uuid; v_club uuid; v_club2 uuid;
  v_venue uuid; v_venue_b uuid; v_venue2 uuid;
  v_pitch uuid; v_pitch2 uuid;
  v_team uuid; v_team_ref uuid; v_team_dup uuid;
  v_season uuid; v_fixture uuid;
  v_type_a uuid; v_type_b uuid;
  v_cat text; v_age text; v_gen text; v_squad text;
  v_cat2 text; v_age2 text; v_gen2 text; v_squad2 text;
  r record;
  v_count int; v_text text; v_uuid uuid; v_ok boolean;
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (v_admin, 'vpadmin@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_admin2,'vpadmin2@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  insert into public.profiles (id, first_name, surname, email) values
    (v_admin, 'VP','Admin','vpadmin@ovalball-test.invalid'),
    (v_admin2,'VP','Admin2','vpadmin2@ovalball-test.invalid');

  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key) values
    ('VP Test RUFC','union','England','England','manual','verified','vp-test'),
    ('VP Test Two RLFC','league','England','England','manual','verified','vp-test-2');
  select id into v_dir from public.club_directory where normalized_key='vp-test';
  select id into v_dir2 from public.club_directory where normalized_key='vp-test-2';
  insert into public.clubs (directory_id, slug, status) values (v_dir,'vp-test','active') returning id into v_club;
  insert into public.clubs (directory_id, slug, status) values (v_dir2,'vp-test-2','active') returning id into v_club2;

  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club,  v_admin,  'CLUB_ADMIN','active'),
    (v_club2, v_admin2, 'CLUB_ADMIN','active');

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);

  -- =================================================================
  -- A. Stable venue identity through a rename
  -- =================================================================
  v_venue := public.create_venue(v_club, 'VP Home Ground', '', 'BB11 1AA', '', true);
  perform public.set_venue_address(v_venue, 'Ground Lane', '', 'Burnley', 'Lancashire', 'BB11 1AA', 'United Kingdom');
  v_pitch := public.create_club_pitch(v_club, 'Main Pitch', null, v_venue);

  perform public.update_venue(v_venue, 'VP Home Ground (Renamed)', 'Ground Lane', 'BB11 1AA', '');
  select id, name into r from public.venues where id = v_venue;
  if r.id = v_venue and r.name = 'VP Home Ground (Renamed)' then
    raise notice 'PASS 1 (A): renaming a venue keeps its id';
  else
    raise notice 'FAIL 1 (A): venue identity changed on rename';
  end if;

  perform public.rename_club_pitch(v_pitch, 'Main Pitch (Renamed)');
  select id, display_name, venue_id into r from public.club_pitches where id = v_pitch;
  if r.id = v_pitch and r.venue_id = v_venue then
    raise notice 'PASS 2 (A): renaming a pitch keeps its id and its venue';
  else
    raise notice 'FAIL 2 (A): pitch identity or venue changed on rename';
  end if;

  -- =================================================================
  -- B. Club and venue relationships are the ones that were set
  -- =================================================================
  select club_id into v_uuid from public.club_pitches where id = v_pitch;
  if v_uuid = v_club then
    raise notice 'PASS 3 (B): the pitch belongs to the club that created it';
  else
    raise notice 'FAIL 3 (B): pitch club is %', v_uuid;
  end if;

  -- =================================================================
  -- C. Exactly one default home venue
  -- =================================================================
  v_venue2 := public.create_venue(v_club, 'VP Second Ground', '', 'BB11 2BB', '', true);
  select count(*) into v_count from public.venues where club_id = v_club and is_default_home;
  if v_count = 1 then
    raise notice 'PASS 4 (C): creating a second default leaves exactly one';
  else
    raise notice 'FAIL 4 (C): % default venues', v_count;
  end if;

  perform public.set_default_venue(v_venue);
  select count(*) into v_count from public.venues where club_id = v_club and is_default_home;
  select is_default_home into v_ok from public.venues where id = v_venue;
  if v_count = 1 and v_ok then
    raise notice 'PASS 5 (C): switching the default still leaves exactly one';
  else
    raise notice 'FAIL 5 (C): count=% correct=%', v_count, v_ok;
  end if;

  -- =================================================================
  -- D. An inactive venue cannot be the default, and cannot take a pitch
  -- =================================================================
  perform public.set_venue_active(v_venue2, false);
  begin
    perform public.set_default_venue(v_venue2);
    raise notice 'FAIL 6 (D): an inactive venue became the default';
  exception when others then
    raise notice 'PASS 6 (D): an inactive venue cannot be made the default';
  end;

  begin
    perform public.set_club_pitch_venue(v_pitch, v_venue2);
    raise notice 'FAIL 7 (D): a pitch was attached to an inactive venue';
  exception when others then
    raise notice 'PASS 7 (D): a pitch cannot be attached to an inactive venue';
  end;
  perform public.set_venue_active(v_venue2, true);

  -- =================================================================
  -- E. Cross-club is refused in both directions
  -- =================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin2, 'role','authenticated')::text, true);
  v_venue_b := public.create_venue(v_club2, 'VP Other Ground', '', 'BB12 1CC', '', true);

  begin
    perform public.rename_club_pitch(v_pitch, 'Stolen Pitch');
    raise notice 'FAIL 8 (E): another club renamed this club''s pitch';
  exception when others then
    raise notice 'PASS 8 (E): a Club Admin cannot rename another club''s pitch';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  begin
    perform public.set_club_pitch_venue(v_pitch, v_venue_b);
    raise notice 'FAIL 9 (E): a pitch was attached across clubs';
  exception when others then
    raise notice 'PASS 9 (E): a pitch cannot be attached to another club''s venue';
  end;

  -- =================================================================
  -- F. A fixture keeps pointing at the same physical venue and pitch
  -- =================================================================
  select id into v_season from public.seasons where rugby_code = 'union' order by starts_on desc limit 1;

  select id, category, age_group, gender, fixed_squad_designation
  into v_type_a, v_cat, v_age, v_gen, v_squad
  from public.canonical_team_types where is_active and category = 'youth' order by sort_order limit 1;
  select id, category, age_group, gender, fixed_squad_designation
  into v_type_b, v_cat2, v_age2, v_gen2, v_squad2
  from public.canonical_team_types where is_active and category = 'senior' order by sort_order limit 1;

  insert into public.teams (club_id, display_name, category, age_group, gender, squad_designation, rugby_code, canonical_team_type_id, active)
  values (v_club, 'VP Youth', v_cat, v_age, v_gen, v_squad, 'union', v_type_a, true) returning id into v_team;
  insert into public.teams (club_id, display_name, category, age_group, gender, squad_designation, rugby_code, canonical_team_type_id, active)
  values (v_club, 'VP Seniors', v_cat2, v_age2, v_gen2, v_squad2, 'union', v_type_b, true) returning id into v_team_ref;

  insert into public.fixtures (owning_team_id, season_id, kickoff_date, home_away, raw_opposition_text, venue_id, pitch_id)
  values (v_team_ref, v_season, current_date + 21, 'Home', 'VP Integrity Opponent', v_venue, v_pitch)
  returning id into v_fixture;

  -- Rename both, then re-read through the fixture.
  perform public.update_venue(v_venue, 'VP Home Ground (Again)', 'Ground Lane', 'BB11 1AA', '');
  perform public.rename_club_pitch(v_pitch, 'Main Pitch (Again)');

  select f.id, f.venue_id, f.pitch_id, v.name as vname, p.display_name as pname, p.venue_id as pvenue
  into r
  from public.fixtures f
  join public.venues v on v.id = f.venue_id
  join public.club_pitches p on p.id = f.pitch_id
  where f.id = v_fixture;

  if r.id = v_fixture and r.venue_id = v_venue and r.pitch_id = v_pitch and r.pvenue = v_venue then
    raise notice 'PASS 10 (F): a fixture still resolves the same venue and pitch after renames';
  else
    raise notice 'FAIL 10 (F): fixture now points at venue=% pitch=%', r.venue_id, r.pitch_id;
  end if;

  -- =================================================================
  -- G. A referenced pitch is archived, never destroyed
  -- =================================================================
  perform public.set_club_pitch_active(v_pitch, false);
  select count(*) into v_count from public.club_pitches where id = v_pitch;
  select pitch_id into v_uuid from public.fixtures where id = v_fixture;
  if v_count = 1 and v_uuid = v_pitch then
    raise notice 'PASS 11 (G): archiving a pitch preserves it and the fixture that references it';
  else
    raise notice 'FAIL 11 (G): pitch rows=% fixture pitch=%', v_count, v_uuid;
  end if;

  -- An archived pitch is not offered for new use.
  select count(*) into v_count
  from public.club_pitches where club_id = v_club and active and venue_id = v_venue;
  if v_count = 0 then
    raise notice 'PASS 12 (G): an archived pitch is no longer an active choice';
  else
    raise notice 'FAIL 12 (G): % active pitches remain at the venue', v_count;
  end if;
  perform public.set_club_pitch_active(v_pitch, true);

  -- =================================================================
  -- H. Training resolves the same pitch as the fixture surface
  -- =================================================================
  insert into public.training_sessions (club_id, team_id, session_date, occurrence_date, start_time, end_time, venue_id, pitch_id, source, status, created_by, updated_by)
  values (v_club, v_team, current_date + 7, current_date + 7, '18:00', '19:30', v_venue, v_pitch, 'MANUAL', 'PLANNED', v_admin, v_admin);

  select count(*) into v_count
  from public.training_sessions ts
  join public.fixtures f on f.pitch_id = ts.pitch_id and f.venue_id = ts.venue_id
  where ts.club_id = v_club and f.id = v_fixture;
  if v_count = 1 then
    raise notice 'PASS 13 (H): training and fixtures resolve the same pitch record';
  else
    raise notice 'FAIL 13 (H): training/fixture pitch mismatch';
  end if;

  -- =================================================================
  -- I. Team removal -- pristine vs referenced
  -- =================================================================
  select classification into v_text from public.classify_team_removal(v_team);
  if v_text = 'referenced' then
    raise notice 'PASS 14 (I): a team with a training session classifies as referenced';
  else
    raise notice 'FAIL 14 (I): classification is %', v_text;
  end if;

  v_text := public.remove_setup_team(v_team_ref);
  select count(*) into v_count from public.teams where id = v_team_ref;
  select active into v_ok from public.teams where id = v_team_ref;
  if v_text = 'folded' and v_count = 1 and not v_ok then
    raise notice 'PASS 15 (I): a team with a fixture is folded, not deleted';
  else
    raise notice 'FAIL 15 (I): result=% rows=% active=%', v_text, v_count, v_ok;
  end if;

  select count(*) into v_count from public.fixtures where id = v_fixture;
  if v_count = 1 then
    raise notice 'PASS 16 (I): folding a team destroys none of its fixture history';
  else
    raise notice 'FAIL 16 (I): the fixture went with the team';
  end if;

  -- Retrying is idempotent -- a second Remove neither errors nor duplicates.
  v_text := public.remove_setup_team(v_team_ref);
  select count(*) into v_count from public.teams where id = v_team_ref;
  if v_count = 1 then
    raise notice 'PASS 17 (I): removing an already-folded team is idempotent';
  else
    raise notice 'FAIL 17 (I): % rows after a repeat removal', v_count;
  end if;

  -- =================================================================
  -- J. Canonical team rules survive the setup surface
  -- =================================================================
  -- A folded team's identity is RESERVED, not released. teams carries an
  -- unconditional UNIQUE (club_id, identity_key) alongside the partial
  -- active-only canonical index, so a club can never hold two teams of the
  -- same identity in any state. Removing a team by mistake during setup is
  -- therefore undone by reactivating it in Team Administration, never by
  -- adding a second one -- which is what keeps a folded team's fixtures,
  -- memberships and season history attached to the team they belong to.
  begin
    insert into public.teams (club_id, display_name, category, age_group, gender, squad_designation, rugby_code, canonical_team_type_id, active)
    values (v_club, 'VP Seniors Again', v_cat2, v_age2, v_gen2, v_squad2, 'union', v_type_b, true);
    raise notice 'FAIL 18 (J): a second team was created at a folded team''s identity';
  exception when others then
    raise notice 'PASS 18 (J): a folded team''s identity stays reserved to it';
  end;

  -- Two ACTIVE teams cannot claim the same canonical identity.
  begin
    insert into public.teams (club_id, display_name, category, age_group, gender, squad_designation, rugby_code, canonical_team_type_id, active)
    values (v_club, 'VP Youth Duplicate', v_cat, v_age, v_gen, v_squad, 'union', v_type_a, true);
    raise notice 'FAIL 19 (J): two active teams claimed the same canonical identity';
  exception when others then
    raise notice 'PASS 19 (J): a duplicate active canonical identity is rejected';
  end;

  -- An active team is always anchored to a canonical type. Omitting the id
  -- does not mean "free text": teams_set_canonical_type_trigger RESOLVES it
  -- from the structured fields, and teams_active_requires_canonical_type
  -- rejects the row if nothing resolves. So the closed catalogue holds from
  -- either direction -- naming a type, or describing one that exists.
  begin
    insert into public.teams (club_id, display_name, category, age_group, gender, rugby_code, active)
    values (v_club, 'VP Not A Real Grade', 'youth', 'U17', 'mixed', 'union', true);
    raise notice 'FAIL 20 (J): a team outside the canonical catalogue was activated';
  exception when others then
    raise notice 'PASS 20 (J): a team whose fields match no canonical type cannot be active';
  end;

  -- Rugby-code isolation: this club is union, and its teams say so.
  select count(*) into v_count from public.teams where club_id = v_club and rugby_code <> 'union';
  if v_count = 0 then
    raise notice 'PASS 21 (J): every team at a union club carries the union code';
  else
    raise notice 'FAIL 21 (J): % teams carry another rugby code', v_count;
  end if;

  -- B/C squad designations belong to youth teams only.
  begin
    insert into public.teams (club_id, display_name, category, age_group, gender, squad_designation, rugby_code, canonical_team_type_id, active)
    values (v_club, 'VP Colts B', 'colts', 'JuniorColts', null, 'B', 'union',
            (select id from public.canonical_team_types where category='colts' and age_group='JuniorColts' limit 1), true);
    raise notice 'FAIL 22 (J): a colts team took a B squad designation';
  exception when others then
    raise notice 'PASS 22 (J): squad designations stay within their category rules';
  end;

  -- =================================================================
  -- K. Idempotent kit save from the wizard
  -- =================================================================
  perform public.upsert_club_kit(v_club, 'HOOPS', '#7a1f3d', '#ffffff', null);
  perform public.upsert_club_kit(v_club, 'HOOPS', '#7a1f3d', '#ffffff', null);
  select count(*) into v_count from public.club_kits where club_id = v_club and variant = 'primary';
  if v_count = 1 then
    raise notice 'PASS 23 (K): saving the same kit twice keeps one row';
  else
    raise notice 'FAIL 23 (K): % primary kit rows', v_count;
  end if;

  -- =================================================================
  -- L. Duplicate venue and pitch names are refused, so a double-click
  --    cannot produce two grounds
  -- =================================================================
  begin
    perform public.create_venue(v_club, 'VP Second Ground', '', 'BB11 2BB', '', false);
    raise notice 'FAIL 24 (L): a duplicate venue name was accepted';
  exception when others then
    raise notice 'PASS 24 (L): a duplicate venue name is refused';
  end;

  begin
    perform public.create_club_pitch(v_club, 'Main Pitch (Again)', null, v_venue);
    raise notice 'FAIL 25 (L): a duplicate pitch name was accepted';
  exception when others then
    raise notice 'PASS 25 (L): a duplicate pitch name is refused';
  end;
end;
$$;

rollback;
