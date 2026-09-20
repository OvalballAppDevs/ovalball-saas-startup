-- Fixture availability summary -- what an operational surface may count, and
-- what it may not.
--
-- `public.fixture_availability_summary` puts "six of twenty-two still to
-- reply" on a fixture card. The interesting assertions are not the arithmetic.
-- They are:
--
--   * a caller with no attendance authority gets NULL counts, never zeroes --
--     because a screen that renders 0 is asserting that nobody has replied,
--     which is a different and false statement;
--   * a fixture has two sides, and a club's authority over its own squad is
--     not authority over the opposition's, so the opponent's players are not
--     in the caller's numbers;
--   * a fixture the caller cannot see at all is absent from the result, so the
--     function cannot be used to discover that a fixture id exists.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();      -- Club Admin at the owning club
  v_away_admin uuid := gen_random_uuid(); -- Club Admin at the opponent club
  v_outsider uuid := gen_random_uuid();   -- an authenticated member of neither
  v_dir_a uuid; v_dir_b uuid; v_club_a uuid; v_club_b uuid;
  v_team_a uuid; v_team_a2 uuid; v_team_b uuid;
  v_ctt uuid;
  v_fixture uuid; v_other_fixture uuid;
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); p3 uuid := gen_random_uuid(); p4 uuid := gen_random_uuid();
  o1 uuid := gen_random_uuid(); o2 uuid := gen_random_uuid();
  p5 uuid := gen_random_uuid();  -- on our club's OTHER U12 side, for the call-up
  r record; v_count int;
begin
  insert into auth.users (id, email, instance_id, aud, role) values
    (v_admin,'availadmin@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_away_admin,'availaway@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_outsider,'availout@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  insert into public.profiles (id, first_name, surname, email) values
    (v_admin,'Avail','Admin','availadmin@ovalball-test.invalid'),
    (v_away_admin,'Avail','Away','availaway@ovalball-test.invalid'),
    (v_outsider,'Avail','Out','availout@ovalball-test.invalid');

  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key) values
    ('Availability Home RUFC','union','England','England','manual','verified','avail-home'),
    ('Availability Away RUFC','union','England','England','manual','verified','avail-away');
  select id into v_dir_a from public.club_directory where normalized_key='avail-home';
  select id into v_dir_b from public.club_directory where normalized_key='avail-away';
  insert into public.clubs (directory_id, slug, status) values (v_dir_a,'avail-home','active') returning id into v_club_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b,'avail-away','active') returning id into v_club_b;

  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club_a, v_admin, 'CLUB_ADMIN','active'),
    (v_club_b, v_away_admin, 'CLUB_ADMIN','active');

  select id into v_ctt from public.canonical_team_types where key='u12' and is_active limit 1;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, canonical_team_type_id, active)
  values (v_club_a,'Under 12 Boys','avail-home-u12','youth','U12','boys','union',v_ctt,true) returning id into v_team_a;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, canonical_team_type_id, active)
  values (v_club_b,'Under 12 Boys','avail-away-u12','youth','U12','boys','union',v_ctt,true) returning id into v_team_b;
  -- A second U12 side at OUR club. A call-up moves a player between two teams
  -- of the same club; a cross-club arrangement is a Dispensation, which is a
  -- different thing with a different rule.
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, canonical_team_type_id, squad_designation, active)
  values (v_club_a,'Under 12 Boys B','avail-home-u12b','youth','U12','boys','union',v_ctt,'B',true) returning id into v_team_a2;

  -- Four players on our side, two on theirs.
  -- playing_pathway is recorded up front: a team may never assume it, so a
  -- player with none recorded cannot be added to an age-grade side at all.
  insert into public.players (id, first_name, surname, active, playing_pathway) values
    (p1,'Ada','One',true,'MALE'),(p2,'Ben','Two',true,'MALE'),(p3,'Cal','Three',true,'MALE'),(p4,'Dee','Four',true,'MALE'),
    (o1,'Opp','One',true,'MALE'),(o2,'Opp','Two',true,'MALE'),(p5,'Eve','Five',true,'MALE');
  insert into public.player_team_memberships (player_id, team_id, status) values
    (p1,v_team_a,'active'),(p2,v_team_a,'active'),(p3,v_team_a,'active'),(p4,v_team_a,'active'),
    (o1,v_team_b,'active'),(o2,v_team_b,'active'),(p5,v_team_a2,'active');

  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (v_team_a, v_team_b, 'Home', 'Availability Away RUFC', current_date + 30, '11:00', 'Booked', 'club_created')
  returning id into v_fixture;

  -- Three of our four have answered; one has not. Both of theirs have.
  insert into public.player_fixture_attendance (fixture_id, player_id, status, response_source, responded_by_user_id) values
    (v_fixture, p1, 'ATTENDING','staff', v_admin),
    (v_fixture, p2, 'CANNOT_ATTEND','staff', v_admin),
    (v_fixture, p3, 'UNSURE','staff', v_admin),
    (v_fixture, o1, 'ATTENDING','staff', v_away_admin),
    (v_fixture, o2, 'ATTENDING','staff', v_away_admin);

  -- A fixture between two OTHER teams, which our admin has nothing to do with.
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (v_team_b, 'Home', 'Somebody Else RFC', current_date + 31, '11:00', 'Booked', 'club_created')
  returning id into v_other_fixture;

  -- =================================================================
  -- A. The owning club counts ITS OWN squad
  -- =================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);

  select * into r from public.fixture_availability_summary(array[v_fixture]);
  if r.squad_count = 4 and r.attending_count = 1 and r.unavailable_count = 1
     and r.unsure_count = 1 and r.awaiting_count = 1 then
    raise notice 'PASS 1 (A): the owning club counts its own four players, one of them still to reply';
  else
    raise notice 'FAIL 1 (A): squad=% attending=% unavailable=% unsure=% awaiting=%',
      r.squad_count, r.attending_count, r.unavailable_count, r.unsure_count, r.awaiting_count;
  end if;

  -- The opposition's two answers are NOT in our numbers. If they were, squad
  -- would be 6 and attending 3 -- which is the whole of this assertion.
  if r.squad_count = 4 and r.attending_count = 1 then
    raise notice 'PASS 2 (A): the opposition''s squad is not counted into ours';
  else
    raise notice 'FAIL 2 (A): the opponent''s players leaked into the count (squad=%)', r.squad_count;
  end if;

  -- The parts account for the whole -- no player is counted twice or dropped.
  if r.attending_count + r.unavailable_count + r.unsure_count + r.awaiting_count = r.squad_count then
    raise notice 'PASS 3 (A): every player is in exactly one bucket';
  else
    raise notice 'FAIL 3 (A): the buckets do not sum to the squad';
  end if;

  -- =================================================================
  -- B. An approved call-up joins the squad being counted
  -- =================================================================
  insert into public.fixture_player_call_up (fixture_id, player_id, source_team_id, target_team_id, status, requested_by, eligibility_rule_reference)
  values (v_fixture, p5, v_team_a2, v_team_a, 'approved', v_admin, 'RFU age grade -- same age grade, squad move')
  on conflict do nothing;

  select * into r from public.fixture_availability_summary(array[v_fixture]);
  if r.squad_count = 5 then
    raise notice 'PASS 4 (B): an approved call-up is part of the squad the count is over';
  else
    raise notice 'FAIL 4 (B): squad is % with an approved call-up', r.squad_count;
  end if;

  -- =================================================================
  -- C. The opponent's club counts THEIR squad, on the same fixture
  -- =================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_away_admin, 'role','authenticated')::text, true);
  select * into r from public.fixture_availability_summary(array[v_fixture]);
  if r.squad_count = 2 and r.attending_count = 2 and r.awaiting_count = 0 then
    raise notice 'PASS 5 (C): each club sees its own side of the same fixture';
  else
    raise notice 'FAIL 5 (C): squad=% attending=% awaiting=%', r.squad_count, r.attending_count, r.awaiting_count;
  end if;

  -- =================================================================
  -- D. NO ROW -- not a zero, and not a row of nulls
  -- =================================================================
  -- The outsider is a member of neither club. They cannot see the fixture at
  -- all, so it is absent -- the function is not a way to learn that an id
  -- exists.
  perform set_config('request.jwt.claims', json_build_object('sub', v_outsider, 'role','authenticated')::text, true);
  select count(*) into v_count from public.fixture_availability_summary(array[v_fixture]);
  if v_count = 0 then
    raise notice 'PASS 6 (D): a fixture the caller cannot see is absent, not zeroed';
  else
    raise notice 'FAIL 6 (D): an unrelated caller got % row(s) for a fixture they cannot read', v_count;
  end if;

  -- And the case that matters most: somebody who CAN see the fixture -- an
  -- ordinary member of the owning club -- but holds no attendance authority.
  -- Demoting the admin to BASIC_USER removes the capability while leaving the
  -- fixture perfectly visible to them, which is exactly the situation where a
  -- zero would be a lie a person could act on.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  update public.club_memberships set role = 'BASIC_USER' where club_id = v_club_a and user_id = v_admin;

  select count(*) into v_count from public.fixture_availability_summary(array[v_fixture]);
  if v_count = 0 then
    raise notice 'PASS 7 (D): a viewer without attendance authority gets no row -- never a zero';
  else
    raise notice 'FAIL 7 (D): % row(s) came back for a viewer with no attendance authority', v_count;
  end if;

  -- The fixture really was visible to them, so PASS 7 is about authority and
  -- not about the fixture having vanished.
  select count(*) into v_count from public.fixtures where id = v_fixture;
  if v_count = 1 then
    raise notice 'PASS 8 (D): and the fixture itself was readable to them throughout';
  else
    raise notice 'FAIL 8 (D): the fixture was not visible, so PASS 7 proved nothing';
  end if;

  update public.club_memberships set role = 'CLUB_ADMIN' where club_id = v_club_a and user_id = v_admin;

  -- =================================================================
  -- E. The batch is bounded
  -- =================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  begin
    perform public.fixture_availability_summary(
      (select array_agg(gen_random_uuid()) from generate_series(1, 201))
    );
    raise notice 'FAIL 9 (E): an unbounded batch was accepted';
  exception when others then
    if sqlstate = '22023' then
      raise notice 'PASS 9 (E): an over-large batch is refused as malformed (22023)';
    else
      raise notice 'FAIL 9 (E): refused with % rather than 22023', sqlstate;
    end if;
  end;

  -- An empty or null array is not an error -- it is nothing to do.
  select count(*) into v_count from public.fixture_availability_summary(array[]::uuid[]);
  if v_count = 0 then
    raise notice 'PASS 10 (E): an empty batch returns nothing and raises nothing';
  else
    raise notice 'FAIL 10 (E): an empty batch returned % rows', v_count;
  end if;

  -- =================================================================
  -- F. The authority is the one that governs the data
  -- =================================================================
  -- Asserted structurally as well as behaviourally: the readable-teams helper
  -- must answer team.attendance.view, and must NOT answer fixture-management
  -- authority, or the summary could count what a direct read would refuse.
  if position('team.attendance.view' in pg_get_functiondef('internal.fixture_attendance_readable_team_ids(uuid)'::regprocedure)) > 0
     and position('can_manage_fixture_side' in pg_get_functiondef('internal.fixture_attendance_readable_team_ids(uuid)'::regprocedure)) = 0 then
    raise notice 'PASS 11 (F): readability is answered by the capability that governs the rows';
  else
    raise notice 'FAIL 11 (F): the summary authorises on something other than team.attendance.view';
  end if;

  -- =================================================================
  -- G. The public venue projection publishes only what it declares
  -- =================================================================
  if (select string_agg(column_name, ',' order by column_name) from information_schema.columns
      where table_schema='public' and table_name='public_venues')
     = 'club_id,id,is_default_home,name,only_pitch_name' then
    raise notice 'PASS 12 (G): public_venues publishes exactly the declared columns';
  else
    raise notice 'FAIL 12 (G): public_venues publishes %',
      (select string_agg(column_name, ',' order by column_name) from information_schema.columns
       where table_schema='public' and table_name='public_venues');
  end if;
end;
$$;

rollback;
