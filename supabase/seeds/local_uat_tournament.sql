-- A realistic multi-team tournament, for local browser UAT.
--
-- WHAT IT REPRESENTS
--
-- One occasion. Two of our teams. Different opponents for each. Several games
-- each. Three pitches held over deliberately overlapping periods, because a
-- festival genuinely does hold three pitches at once and that is not the
-- tournament conflicting with itself.
--
--   Ovalball UAT Festival -- Ovalball UAT Ground
--     Under 12 Boys  v  Clitheroe, Blackburn, Wigan
--     Under 13 Boys  v  Blackburn, Liverpool St Helens, Didsbury Toc H, Skipton
--
-- EVERY OPPOSITION IDENTITY IS A REAL CANONICAL CLUB DIRECTORY ROW already
-- present locally. Nothing here invents a club, and nothing activates one:
-- a directory entry that is not an Ovalball club is recorded exactly as that,
-- which is what tournament_participants' 'external_recorded' status is for.
--
-- WHY IT IS HOSTED AT OUR OWN GROUND. The brief's illustration is a festival
-- at Preston. Preston Grasshoppers exists in the canonical directory but is
-- not an activated Ovalball club, so it owns no club_pitches rows and a
-- tournament there would reserve nothing -- which is correct, and also proves
-- nothing about Pitch Allocation. Hosting at Ovalball UAT Ground is what makes
-- the pitch-reservation and same-tournament-overlap behaviour observable.
--
-- Written through the canonical RPCs under a real Club Admin identity, never
-- by direct insert, so the seed exercises the same authority a person does.

do $$
declare
  v_club uuid := '0671e78c-a0fe-40e1-847a-195b6cf14f7a';   -- Ovalball UAT RUFC
  v_admin uuid;
  v_u12 uuid; v_u13 uuid;
  v_tournament uuid;
  v_entry_u12 uuid; v_entry_u13 uuid;
  v_date date;
  v_pitch1 uuid; v_pitch2 uuid; v_pitch3 uuid;
  v_type_u12 uuid; v_type_u13 uuid;
  v_clitheroe uuid; v_blackburn uuid; v_wigan uuid;
  v_sthelens uuid; v_didsbury uuid; v_skipton uuid;
  v_o uuid;
  o_clith uuid; o_black12 uuid; o_wigan uuid;
  o_black13 uuid; o_sth uuid; o_dids uuid; o_skip uuid;
begin
  select id into v_admin from auth.users where email = 'uat.coach@ovalball.test';
  if v_admin is null then
    raise notice 'SKIPPED: uat.coach@ovalball.test is not present in this database.';
    return;
  end if;

  select id into v_u12 from public.teams where club_id = v_club and display_name = 'Under 12 Boys';
  select id into v_u13 from public.teams where club_id = v_club and display_name = 'Under 13 Boys';

  select id into v_type_u12 from public.canonical_team_types where key = 'u12';
  select id into v_type_u13 from public.canonical_team_types where key = 'u13';

  select id into v_clitheroe from public.club_directory where name = 'Clitheroe Rugby Football Club';
  select id into v_blackburn from public.club_directory where name = 'Blackburn RUFC';
  select id into v_wigan     from public.club_directory where name = 'Wigan Rugby Union Football Club';
  select id into v_sthelens  from public.club_directory where name = 'Liverpool St Helens';
  select id into v_didsbury  from public.club_directory where name = 'Didsbury Toc H Rugby Football Club';
  select id into v_skipton   from public.club_directory where name = 'Skipton RFC';

  -- THE GROUND. A festival needs more than one pitch to be a festival; the UAT
  -- club had only ever needed one. These are ordinary club pitch records, the
  -- same shape Club Settings -> Pitches creates.
  insert into public.club_pitches (club_id, display_name, sort_order, venue_id, size_category)
  select v_club, 'Pitch 1', 1, (select id from public.venues where club_id = v_club order by is_default_home desc, name limit 1), 'full'
  where not exists (select 1 from public.club_pitches where club_id = v_club and display_name = 'Pitch 1');
  insert into public.club_pitches (club_id, display_name, sort_order, venue_id, size_category)
  select v_club, 'Pitch 3', 3, (select id from public.venues where club_id = v_club order by is_default_home desc, name limit 1), 'mini'
  where not exists (select 1 from public.club_pitches where club_id = v_club and display_name = 'Pitch 3');

  select id into v_pitch1 from public.club_pitches where club_id = v_club and display_name = 'Pitch 1';
  select id into v_pitch2 from public.club_pitches where club_id = v_club and display_name = 'Pitch 2';
  select id into v_pitch3 from public.club_pitches where club_id = v_club and display_name = 'Pitch 3';

  -- A Saturday inside the current canonical season, resolved from the register
  -- rather than from a hardcoded month boundary.
  select s.starts_on + ((6 - extract(dow from s.starts_on)::int + 7) % 7) + 63
    into v_date
  from public.seasons s
  where s.rugby_code = 'union' and current_date between s.starts_on and s.ends_on
  limit 1;
  if v_date is null then
    raise notice 'SKIPPED: no current Union season in the canonical register.';
    return;
  end if;

  -- Idempotent: a re-run replaces the seeded occasion rather than stacking a
  -- second identical one beside it.
  delete from public.tournaments where name = 'Ovalball UAT Festival';

  -- Act as the Club Admin, through the real RPCs.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  v_tournament := public.save_tournament(
    p_club_id => v_club,
    p_name => 'Ovalball UAT Festival',
    p_starts_on => v_date,
    p_ends_on => v_date,
    p_rugby_code => 'union',
    p_venue_id => (select id from public.venues where club_id = v_club order by is_default_home desc, name limit 1),
    p_notes => 'Festival day. Teams to arrive 30 minutes before their first game.'
  );

  v_entry_u12 := public.add_tournament_team_entry(v_tournament, v_u12);
  v_entry_u13 := public.add_tournament_team_entry(v_tournament, v_u13);

  -- U12's opponents. Note Blackburn appears for BOTH our teams: two distinct
  -- canonical identities (Blackburn U12, Blackburn U13), never one row implying
  -- both of our teams play the same side.
  o_clith  := public.record_tournament_opponent(v_entry_u12, v_clitheroe, v_type_u12);
  o_black12:= public.record_tournament_opponent(v_entry_u12, v_blackburn, v_type_u12);
  o_wigan  := public.record_tournament_opponent(v_entry_u12, v_wigan,     v_type_u12);

  o_black13:= public.record_tournament_opponent(v_entry_u13, v_blackburn, v_type_u13);
  o_sth    := public.record_tournament_opponent(v_entry_u13, v_sthelens,  v_type_u13);
  o_dids   := public.record_tournament_opponent(v_entry_u13, v_didsbury,  v_type_u13);
  o_skip   := public.record_tournament_opponent(v_entry_u13, v_skipton,   v_type_u13);

  -- THE PITCHES THE DAY HOLDS. Deliberately overlapping, and deliberately
  -- belonging to the same parent: this is the exact shape that must not be
  -- reported as the tournament conflicting with itself.
  perform public.reserve_tournament_pitch(v_tournament, v_pitch1, v_date, '09:30', '14:00');
  perform public.reserve_tournament_pitch(v_tournament, v_pitch2, v_date, '09:30', '14:00');
  perform public.reserve_tournament_pitch(v_tournament, v_pitch3, v_date, '11:00', '13:00');

  -- U12's day.
  perform public.save_tournament_game(v_entry_u12, o_clith,   v_date, p_start_time => '10:00', p_duration_minutes => 30, p_pitch_id => v_pitch1);
  perform public.save_tournament_game(v_entry_u12, o_black12, v_date, p_start_time => '10:40', p_duration_minutes => 30, p_pitch_id => v_pitch2);
  perform public.save_tournament_game(v_entry_u12, o_wigan,   v_date, p_start_time => '11:20', p_duration_minutes => 30, p_pitch_id => v_pitch1);

  -- U13's day -- different opponents, different times, different pitches.
  perform public.save_tournament_game(v_entry_u13, o_black13, v_date, p_start_time => '10:20', p_duration_minutes => 30, p_pitch_id => v_pitch3);
  perform public.save_tournament_game(v_entry_u13, o_sth,     v_date, p_start_time => '11:00', p_duration_minutes => 30, p_pitch_id => v_pitch3);
  perform public.save_tournament_game(v_entry_u13, o_dids,    v_date, p_start_time => '11:40', p_duration_minutes => 30, p_pitch_id => v_pitch2);
  perform public.save_tournament_game(v_entry_u13, o_skip,    v_date, p_start_time => '12:20', p_duration_minutes => 30, p_pitch_id => v_pitch1);

  perform set_config('role', 'postgres', true);
  raise notice 'Seeded "Ovalball UAT Festival" (%) on % -- 2 entries, 7 opponents, 7 games, 3 pitch reservations.', v_tournament, v_date;
end $$;
