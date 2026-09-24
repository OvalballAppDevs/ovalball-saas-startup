-- CLUB IDENTITY, VENUES AND TEAMS ARE DOMAIN OPERATIONS (CA-M2) -- permanent regression.
--
-- Pins: `save_club_venue` names and addresses a venue in one transaction through the existing
-- canonical operations (create/update, the one address writer, the default rule), authorised on
-- venue.venue.manage and refused for outsiders and for a deny-overridden holder (stale authority);
-- `create_club_team` adds a team by its Team Directory key, decides every structured field from the
-- Directory and the club's own code, refuses a key not offered for the code and a bad squad letter,
-- and the triggers derive the name; `fold_team` / `reactivate_team` authorise on
-- team.lifecycle.manage -- a capability, never a role: a Fixtures Secretary (a club role without
-- it) is refused, a holder by grant is admitted, a deny override refuses the Club Admin; the kit
-- operation stays on club.profile.edit; and every one of these lands in the one audit history with
-- the acting person.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_site uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_fs uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_volunteer uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_dir2 uuid; v_club2 uuid;
  v_venue uuid; v_venue2 uuid; v_pitch uuid;
  v_team uuid; v_team_b uuid;
  v_override uuid;
  v_n int; v_state text; v_err text; v_text text;
  v_row record;
begin
  insert into auth.users (id, email, instance_id, aud, role)
  values (v_site,     'cam2-site@ovalball-test.invalid',     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_admin,    'cam2-admin@ovalball-test.invalid',    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_fs,       'cam2-fs@ovalball-test.invalid',       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_stranger, 'cam2-stranger@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_volunteer,'cam2-volunteer@ovalball-test.invalid','00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  -- adults on file: a grant of a minor-prohibited capability (team.lifecycle.manage) needs a date of birth
  insert into public.profiles (id, first_name, surname, date_of_birth)
  values (v_admin, 'Cam', 'Admin', (current_date - interval '40 years')::date), (v_fs, 'Cam', 'Fixtures', (current_date - interval '40 years')::date), (v_volunteer, 'Cam', 'Volunteer', (current_date - interval '40 years')::date)
  on conflict (id) do nothing;
  insert into public.site_admins (user_id, admin_role, status) values (v_site, 'full', 'active');
  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('CA-M2 Union Club', 'union', 'England', 'England', 'manual', 'verified', 'ca-m2-union-club') returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'ca-m2-union-club', 'active') returning id into v_club;
  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('CA-M2 Other Club', 'union', 'England', 'England', 'manual', 'verified', 'ca-m2-other-club') returning id into v_dir2;
  insert into public.clubs (directory_id, slug, status) values (v_dir2, 'ca-m2-other-club', 'active') returning id into v_club2;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_admin, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_fs, 'FIXTURE_SECRETARY', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_volunteer, 'BASIC_USER', 'active');

  -- ================================================================= VENUES
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_venue := public.save_club_venue(v_club, null, '  Riverside Ground ', ' Park behind the clubhouse ', ' 1 Mill Lane ', '', ' Ovaltown ', ' Lancashire ', ' bb10 2ls ', '', true);
  select name, directions, address_line_1, town, county, postcode, country, address, is_default_home, active, geocode_status into v_row from public.venues where id = v_venue;
  if v_row.name = 'Riverside Ground' and v_row.directions = 'Park behind the clubhouse' and v_row.address_line_1 = '1 Mill Lane' and v_row.town = 'Ovaltown' and v_row.postcode = 'bb10 2ls' and v_row.country = 'United Kingdom' and v_row.address = '1 Mill Lane, Ovaltown, Lancashire' and v_row.is_default_home and v_row.active and v_row.geocode_status = 'pending' then
    raise notice 'PASS V1: a venue is named, addressed and made the home ground in one operation; the pin is pending, never typed';
  else raise notice 'FAIL V1: venue stored as %', v_row; end if;

  v_venue2 := public.save_club_venue(v_club, null, 'Top Field', '', '', '', 'Ovaltown', '', '', '', false);
  perform public.save_club_venue(v_club, v_venue2, 'Top Field', 'Gate on the lane', 'Top Field', '', 'Ovaltown', '', 'BB11 1AA', 'United Kingdom', true);
  select count(*) into v_n from public.venues where club_id = v_club and is_default_home;
  select is_default_home into v_row from public.venues where id = v_venue2;
  if v_n = 1 and v_row.is_default_home then raise notice 'PASS V2: editing through the operation updates name, directions and address and moves the one home ground';
  else raise notice 'FAIL V2: % defaults, second is default %', v_n, v_row.is_default_home; end if;

  begin
    perform public.save_club_venue(v_club, null, 'riverside ground', '', '', '', '', '', '', '', false);
    raise notice 'FAIL V3: a duplicate venue name (case-insensitive) was accepted';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE;
    if v_state in ('P0001', '23505') then raise notice 'PASS V3: a duplicate venue name is refused by the same rule the website meets';
    else raise notice 'FAIL V3: refused with %', v_state; end if;
  end;
  begin
    perform public.save_club_venue(v_club, null, '   ', '', '', '', '', '', '', '', false);
    raise notice 'FAIL V4: a nameless venue was accepted';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE;
    if v_state = 'P0001' then raise notice 'PASS V4: a venue needs a name';
    else raise notice 'FAIL V4: refused with %', v_state; end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  begin
    perform public.save_club_venue(v_club, v_venue, 'Taken', '', '', '', '', '', '', '', false);
    raise notice 'FAIL V5: a stranger edited a venue';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE;
    if v_state = '42501' then raise notice 'PASS V5: a stranger is refused (42501)';
    else raise notice 'FAIL V5: %', v_state; end if;
  end;
  -- a Fixtures Secretary holds venue.venue.manage by bundle (design J.9) and may edit; an ordinary member does not
  perform set_config('request.jwt.claims', json_build_object('sub', v_fs, 'role', 'authenticated')::text, true);
  perform public.save_club_venue(v_club, v_venue, 'Riverside Ground', 'Park behind the clubhouse', '1 Mill Lane', '', 'Ovaltown', 'Lancashire', 'BB10 2LS', 'United Kingdom', false);
  raise notice 'PASS V5b: a Fixtures Secretary, holding venue.venue.manage by bundle, may edit a venue';
  perform set_config('request.jwt.claims', json_build_object('sub', v_volunteer, 'role', 'authenticated')::text, true);
  begin
    perform public.save_club_venue(v_club, v_venue, 'Taken', '', '', '', '', '', '', '', false);
    raise notice 'FAIL V5c: an ordinary member edited a venue without venue.venue.manage';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE;
    if v_state = '42501' then raise notice 'PASS V5c: a club role without venue.venue.manage is refused (42501)';
    else raise notice 'FAIL V5c: %', v_state; end if;
  end;

  -- stale authority on venues
  perform set_config('request.jwt.claims', json_build_object('sub', v_site, 'role', 'authenticated')::text, true);
  v_override := public.set_capability_override(v_admin, 'venue.venue.manage', 'club', v_club, null, 'deny', 'CA-M2 stale-authority regression', null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  begin
    perform public.save_club_venue(v_club, v_venue, 'After the deny', '', '', '', '', '', '', '', false);
    raise notice 'FAIL V6: a denied holder still saved a venue';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE;
    if v_state = '42501' then raise notice 'PASS V6: a deny override on venue.venue.manage refuses the holder''s stale save (42501)';
    else raise notice 'FAIL V6: %', v_state; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site, 'role', 'authenticated')::text, true);
  perform public.revoke_capability_override(v_override, 'CA-M2 stale-authority regression restored');
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.save_club_venue(v_club, v_venue, 'Riverside Ground', 'Park behind the clubhouse', '1 Mill Lane', '', 'Ovaltown', 'Lancashire', 'BB10 2LS', 'United Kingdom', false);
  raise notice 'PASS V6b: revoking the override restores the holder';

  -- deactivate keeps the row; pitches use their existing operations
  v_pitch := public.create_club_pitch(v_club, 'Pitch 1', null, v_venue);
  perform public.set_venue_active(v_venue, false);
  select active into v_row from public.venues where id = v_venue;
  select count(*) into v_n from public.club_pitches where id = v_pitch;
  if not v_row.active and v_n = 1 then raise notice 'PASS V7: deactivating a venue keeps the venue and its pitch -- nothing is deleted';
  else raise notice 'FAIL V7: active=% pitch rows=%', v_row.active, v_n; end if;
  select count(*) into v_n from public.audit_log a where a.table_name = 'venues' and a.record_id = v_venue and a.actor_user_id = v_admin;
  if v_n >= 3 then raise notice 'PASS V8: the venue''s create, edits and deactivation are in the one audit history with the actor (% rows)', v_n;
  else raise notice 'FAIL V8: only % venue audit rows', v_n; end if;

  -- ================================================================= TEAMS
  v_team := public.create_club_team(v_club, 'u8', null);
  select display_name, category, age_group, gender, rugby_code, canonical_team_type_id, active into v_row from public.teams where id = v_team;
  if v_row.display_name = 'Under 8 Mixed' and v_row.category = 'youth' and v_row.age_group = 'U8' and v_row.gender = 'mixed' and v_row.rugby_code = 'union' and v_row.canonical_team_type_id is not null and v_row.active then
    raise notice 'PASS T1: a team is created from its Directory key; the name, pathway and code are derived, none typed';
  else raise notice 'FAIL T1: team stored as %', v_row; end if;
  select count(*) into v_n from internal.regulatory_context_for_team(v_team) rc where rc.regulatory_identity_id is not null;
  if v_n = 1 then raise notice 'PASS T1b: the new team resolves to a regulatory identity for Rugby Hub and Rules of Play';
  else raise notice 'FAIL T1b: no regulatory identity for the new team'; end if;

  v_team_b := public.create_club_team(v_club, 'u8', 'b');
  select display_name, squad_designation into v_row from public.teams where id = v_team_b;
  if v_row.squad_designation = 'B' and v_row.display_name like 'Under 8 Mixed%B%' then raise notice 'PASS T2: a B squad is added under the same identity (%)', v_row.display_name;
  else raise notice 'FAIL T2: %', v_row; end if;

  begin
    perform public.create_club_team(v_club, 'u8', null);
    raise notice 'FAIL T3: a duplicate team was created';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE, v_err = MESSAGE_TEXT;
    if v_state = '23505' and v_err like '%already has that team%' then raise notice 'PASS T3: the same identity cannot be added twice';
    else raise notice 'FAIL T3: % %', v_state, v_err; end if;
  end;
  begin
    perform public.create_club_team(v_club, 'girls_u13', null);
    raise notice 'FAIL T4: Girls U13 was accepted for a union club';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE;
    if v_state = '22023' then raise notice 'PASS T4: an identity not offered for the club''s code is refused (Girls U13, union)';
    else raise notice 'FAIL T4: %', v_state; end if;
  end;
  begin
    perform public.create_club_team(v_club, 'u8', 'D');
    raise notice 'FAIL T5: a D squad was accepted';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE;
    if v_state = '22023' then raise notice 'PASS T5: only B or C is a squad letter';
    else raise notice 'FAIL T5: %', v_state; end if;
  end;
  begin
    perform public.create_club_team(v_club, 'not-a-key', null);
    raise notice 'FAIL T6: an unknown key was accepted';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE;
    if v_state = '22023' then raise notice 'PASS T6: an unknown Directory key is refused';
    else raise notice 'FAIL T6: %', v_state; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_fs, 'role', 'authenticated')::text, true);
  begin
    perform public.create_club_team(v_club, 'u9', null);
    raise notice 'FAIL T7: a Fixtures Secretary created a team';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE;
    if v_state = '42501' then raise notice 'PASS T7: creating a team needs team.team.manage (a Fixtures Secretary is refused)';
    else raise notice 'FAIL T7: %', v_state; end if;
  end;

  -- ================================================================= FOLD / REACTIVATE: capability, never role
  begin
    perform public.fold_team(v_team_b, 'Not enough players');
    raise notice 'FAIL F1: a Fixtures Secretary folded a team';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE;
    if v_state = '42501' then raise notice 'PASS F1: a club role without team.lifecycle.manage cannot fold (42501)';
    else raise notice 'FAIL F1: %', v_state; end if;
  end;
  -- a person holding the capability by GRANT, not by role, may fold
  perform set_config('request.jwt.claims', json_build_object('sub', v_site, 'role', 'authenticated')::text, true);
  v_override := public.set_capability_override(v_fs, 'team.lifecycle.manage', 'club', v_club, null, 'grant', 'CA-M2 grant regression', null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_fs, 'role', 'authenticated')::text, true);
  select public.fold_team(v_team_b, 'Not enough players') into v_n;
  select active, fold_reason into v_row from public.teams where id = v_team_b;
  if not v_row.active and v_row.fold_reason = 'Not enough players' then raise notice 'PASS F2: a holder by capability grant folds the team (row kept, reason recorded)';
  else raise notice 'FAIL F2: %', v_row; end if;
  perform public.reactivate_team(v_team_b);
  select active into v_row from public.teams where id = v_team_b;
  if v_row.active then raise notice 'PASS F3: the same capability reactivates it';
  else raise notice 'FAIL F3: still folded'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site, 'role', 'authenticated')::text, true);
  perform public.revoke_capability_override(v_override, 'CA-M2 grant regression restored');
  -- a Club Admin denied the capability is refused, role notwithstanding
  v_override := public.set_capability_override(v_admin, 'team.lifecycle.manage', 'club', v_club, null, 'deny', 'CA-M2 deny regression', null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  begin
    perform public.fold_team(v_team_b, 'Denied');
    raise notice 'FAIL F4: a denied Club Admin folded a team';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE;
    if v_state = '42501' then raise notice 'PASS F4: a Club Admin with team.lifecycle.manage withheld is refused -- the role does not decide';
    else raise notice 'FAIL F4: %', v_state; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site, 'role', 'authenticated')::text, true);
  perform public.revoke_capability_override(v_override, 'CA-M2 deny regression restored');
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    perform public.fold_team(v_team_b, '   ');
    raise notice 'FAIL F5: folding without a reason was accepted';
  exception when others then
    raise notice 'PASS F5: folding needs a reason';
  end;
  select count(*) into v_n from public.audit_log a where a.table_name = 'teams' and a.record_id = v_team_b and a.actor_user_id = v_fs and a.after->>'event' in ('folded', 'reactivated');
  if v_n = 2 then raise notice 'PASS F6: fold and reactivate are in the one audit history with the acting person';
  else raise notice 'FAIL F6: % lifecycle audit rows', v_n; end if;

  -- ================================================================= KIT (branding) stays on club.profile.edit
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.upsert_club_kit(v_club, 'HOOPS', '#7A1F3D', '#FFFFFF', null, 'primary');
  select pattern, primary_colour, secondary_colour into v_row from public.club_kits where club_id = v_club and variant = 'primary';
  if v_row.pattern = 'HOOPS' and v_row.primary_colour = '#7a1f3d' and v_row.secondary_colour = '#ffffff' then raise notice 'PASS K1: the kit operation stores the home kit, colours lower-cased';
  else raise notice 'FAIL K1: %', v_row; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_fs, 'role', 'authenticated')::text, true);
  begin
    perform public.upsert_club_kit(v_club, 'SOLID', '#000000', null, null, 'alternate');
    raise notice 'FAIL K2: a Fixtures Secretary changed the kit';
  exception when others then
    get stacked diagnostics v_state = RETURNED_SQLSTATE;
    if v_state = '42501' then raise notice 'PASS K2: the kit needs club.profile.edit';
    else raise notice 'FAIL K2: %', v_state; end if;
  end;
  select count(*) into v_n from public.audit_log a where a.table_name = 'club_kits' and a.actor_user_id = v_admin and a.after->>'club_id' = v_club::text;
  if v_n >= 1 then raise notice 'PASS K3: the kit change is audited with the actor';
  else raise notice 'FAIL K3: no kit audit row'; end if;

  -- the domain operations never reach anon
  if has_function_privilege('anon', 'public.save_club_venue(uuid, uuid, text, text, text, text, text, text, text, text, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_club_team(uuid, text, text)', 'EXECUTE') then
    raise notice 'FAIL G1: anon can execute a CA-M2 operation';
  else
    raise notice 'PASS G1: anon holds no grant on the CA-M2 operations';
  end if;
end $$;

rollback;
