-- Staff communications: exactly who receives them, and who does not.
--
-- This suite is the whole safeguarding case for Phase 3B. Every assertion is
-- written as the wrong audience it prevents, because the failure mode here is
-- not an error message -- it is a message about a child arriving at an adult
-- who should not have received it, silently, with the sender told "Sent".
--
-- Assertions compare canonical IDs, never display names.
--
-- Self-contained/transactional.

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Fixture communications: recipient resolution ==='

begin;

do $$
declare
  v_coach uuid := gen_random_uuid();          -- staff for the home side
  v_other_coach uuid := gen_random_uuid();    -- staff at an unrelated club
  v_stranger uuid := gen_random_uuid();
  -- Guardians
  v_gA uuid := gen_random_uuid();
  v_gD uuid := gen_random_uuid();
  v_gE1 uuid := gen_random_uuid();            -- E has TWO active guardians
  v_gE2 uuid := gen_random_uuid();
  v_gPending uuid := gen_random_uuid();       -- pending link request, not a guardian
  v_gRejected uuid := gen_random_uuid();      -- rejected link request
  v_gUnrelated uuid := gen_random_uuid();
  -- Player-owned accounts
  v_uMinor uuid := gen_random_uuid();         -- 12yo with a login
  v_uTeen uuid := gen_random_uuid();          -- 16yo with a login
  v_uAdult uuid := gen_random_uuid();         -- 19yo with a login
  v_club uuid; v_other_club uuid; v_team uuid; v_mini_a uuid; v_mini_b uuid;
  v_group uuid; v_season uuid; v_dir uuid;
  v_fixture uuid; v_mini_fixture uuid; v_other_fixture uuid; v_empty_team uuid; v_source_team uuid;
  pA uuid; pB uuid; pC uuid; pD uuid; pE uuid; pF uuid;
  pMinor uuid; pTeen uuid; pAdult uuid; pUnrelated uuid; pMiniOverlap uuid;
  v_r record; v_n int; v_dupcheck int; v_expect uuid[]; v_got uuid[];
begin
  select c.id into v_club from public.clubs c
  join public.club_directory d on d.id = c.directory_id where d.normalized_key = 'ovalball-uat-rufc';
  if v_club is null then raise exception 'FAIL setup: local UAT club missing'; end if;
  -- A team created FOR this suite, not the shared seeded U12. Reusing the
  -- seeded team made every audience assertion depend on how many players the
  -- seed happens to contain, so a later seed change would break tests that
  -- have nothing to do with it. Here the population is exactly what this
  -- suite puts in it.
  select id into v_dir from public.club_directory where normalized_key <> 'ovalball-uat-rufc' limit 1;
  select id into v_season from public.seasons where starts_on <= current_date and ends_on >= current_date limit 1;
  select c.id into v_other_club from public.clubs c where c.id <> v_club and c.status = 'active' limit 1;

  for v_r in select unnest(array[v_coach, v_other_coach, v_stranger, v_gA, v_gD, v_gE1, v_gE2,
                                 v_gPending, v_gRejected, v_gUnrelated, v_uMinor, v_uTeen, v_uAdult]) as id loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_r.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','fc-'||v_r.id::text||'@ovalball.test','',now(),now(),now(),
      '{}'::jsonb,'{}'::jsonb,'','','','','','','','');
    insert into public.profiles (id, first_name, surname, email) values (v_r.id,'FC','Tester','fc-'||v_r.id::text||'@ovalball.test');
  end loop;

  -- Staff: club admin at the home club, and one at an unrelated club.
  insert into public.club_memberships (user_id, club_id, role, status) values (v_coach, v_club, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (user_id, club_id, role, status) values (v_other_coach, v_other_club, 'CLUB_ADMIN', 'active');

  insert into public.teams (club_id, category, age_group, gender, squad_designation, rugby_code, created_by)
  values (v_club, 'youth', 'U12', null, 'C', 'union', v_coach)
  returning id into v_team;

  -- Players. DOBs chosen so the age bands are unambiguous.
  insert into public.players (first_name, surname, date_of_birth) values ('Alpha','Fcfam','2014-01-01') returning id into pA;
  insert into public.players (first_name, surname, date_of_birth) values ('Bravo','Fcfam','2014-02-02') returning id into pB;
  insert into public.players (first_name, surname, date_of_birth) values ('Charlie','Fcfam','2014-03-03') returning id into pC;
  insert into public.players (first_name, surname, date_of_birth) values ('Delta','Fcfam','2014-04-04') returning id into pD;
  insert into public.players (first_name, surname, date_of_birth) values ('Echo','Fcfam','2014-05-05') returning id into pE;
  insert into public.players (first_name, surname, date_of_birth) values ('Foxtrot','Fcfam','2014-06-06') returning id into pF;
  insert into public.players (first_name, surname, date_of_birth, user_id) values ('Minor','Fcfam', (current_date - interval '12 years')::date, v_uMinor) returning id into pMinor;
  insert into public.players (first_name, surname, date_of_birth, user_id) values ('Teen','Fcfam', (current_date - interval '16 years' - interval '2 months')::date, v_uTeen) returning id into pTeen;
  insert into public.players (first_name, surname, date_of_birth, user_id) values ('Adult','Fcfam', (current_date - interval '19 years')::date, v_uAdult) returning id into pAdult;
  insert into public.players (first_name, surname, date_of_birth) values ('Unrelated','Fcfam','2014-07-07') returning id into pUnrelated;

  for v_r in select unnest(array[pA,pB,pC,pD,pE,pMinor,pTeen,pAdult]) as id loop
    insert into public.player_team_memberships (player_id, team_id, status) values (v_r.id, v_team, 'active');
  end loop;
  -- pF is NOT a member of this team; they arrive by call-up only.
  -- pUnrelated belongs to another club entirely.
  insert into public.player_team_memberships (player_id, team_id, status)
  select pUnrelated, t.id, 'active' from public.teams t where t.club_id = v_other_club limit 1;

  -- Guardians.
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values
    (v_gA, pA, 'guardian', 'active'),
    (v_gD, pD, 'guardian', 'active'),
    (v_gE1, pE, 'guardian', 'active'),
    (v_gE2, pE, 'guardian', 'active'),
    (v_gD, pMinor, 'guardian', 'active'),   -- ONE adult guardians TWO children
    (v_gD, pTeen, 'guardian', 'active'),
    (v_gUnrelated, pUnrelated, 'guardian', 'active');

  -- A PENDING and a REJECTED guardian link request for pD -- neither is a
  -- guardian, and neither may receive anything.
  insert into public.guardian_link_requests (kind, status, requested_by_user_id, subject_user_id, club_id, target_player_id)
  values ('ADDITIONAL_GUARDIAN', 'PENDING', v_gD, v_gPending, v_club, pD);
  insert into public.guardian_link_requests (kind, status, requested_by_user_id, subject_user_id, club_id, target_player_id, decided_by, decided_at)
  values ('ADDITIONAL_GUARDIAN', 'REJECTED', v_gD, v_gRejected, v_club, pD, v_coach, now());

  -- The fixture, against an unclaimed directory opposition.
  insert into public.fixtures (owning_team_id, opponent_directory_id, raw_opposition_text, kickoff_date, kickoff_time, meet_time, home_away, status, season_id, created_by)
  values (v_team, v_dir, 'Directory Opposition RFC', current_date + 6, '10:30', '09:45', 'Home', 'Booked', v_season, v_coach)
  returning id into v_fixture;

  -- An approved call-up bringing pF into this fixture from a SECOND squad at
  -- the same club. The call-up domain refuses a forged source team, which is
  -- correct -- a called-up player is a real member of somewhere else.
  insert into public.teams (club_id, category, age_group, gender, squad_designation, rugby_code, created_by)
  values (v_club, 'youth', 'U12', null, 'B', 'union', v_coach)
  returning id into v_source_team;
  insert into public.player_team_memberships (player_id, team_id, status) values (pF, v_source_team, 'active');
  insert into public.fixture_player_call_up (fixture_id, player_id, source_team_id, target_team_id, status, eligibility_rule_reference)
  values (v_fixture, pF, v_source_team, v_team, 'approved', 'RFU Regulation 15 - playing up one age grade');

  -- Responses: A attending, B cannot, C unsure, D and E silent.
  -- F (called up) attending. Minor/Teen/Adult silent.
  insert into public.player_fixture_attendance (fixture_id, player_id, status, responded_by_user_id, response_source) values
    (v_fixture, pA, 'ATTENDING', v_gA, 'guardian'),
    (v_fixture, pB, 'CANNOT_ATTEND', v_gA, 'guardian'),
    (v_fixture, pC, 'UNSURE', v_gA, 'guardian'),
    (v_fixture, pF, 'ATTENDING', v_gA, 'guardian');

  -- =================================================================
  -- A. ATTENDANCE REMINDER -- only the outstanding population
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach::text,'role','authenticated')::text, true);

  select array_agg(player_id order by player_id) into v_got
  from internal.fixture_audience_players(v_fixture, 'ATTENDANCE_REMINDER');
  select array_agg(x order by x) into v_expect from unnest(array[pD, pE, pMinor, pTeen, pAdult]) x;
  if v_got = v_expect then
    raise notice 'PASS 1 (A): the reminder audience is EXACTLY the players with no response';
  else
    raise exception 'FAIL 1 (A): reminder audience is % , expected %', v_got, v_expect;
  end if;

  -- Answered players are never chased -- including UNSURE, which is an answer.
  if not (pA = any(v_got)) and not (pB = any(v_got)) and not (pC = any(v_got)) and not (pF = any(v_got)) then
    raise notice 'PASS 2 (A): ATTENDING, CANNOT_ATTEND and UNSURE are all treated as answered';
  else
    raise exception 'FAIL 2 (A): an already-answered player is in the reminder audience';
  end if;

  -- =================================================================
  -- B. MESSAGE ATTENDEES -- only ATTENDING, including the call-up
  -- =================================================================
  select array_agg(player_id order by player_id) into v_got
  from internal.fixture_audience_players(v_fixture, 'MESSAGE_ATTENDEES');
  select array_agg(x order by x) into v_expect from unnest(array[pA, pF]) x;
  if v_got = v_expect then
    raise notice 'PASS 3 (B): the attendee audience is EXACTLY the ATTENDING players, call-up included';
  else
    raise exception 'FAIL 3 (B): attendee audience is %, expected %', v_got, v_expect;
  end if;

  -- =================================================================
  -- C. MESSAGE TEAM -- effective participants, membership not attendance
  -- =================================================================
  select array_agg(player_id order by player_id) into v_got
  from internal.fixture_audience_players(v_fixture, 'MESSAGE_TEAM');
  select array_agg(x order by x) into v_expect from unnest(array[pA,pB,pC,pD,pE,pF,pMinor,pTeen,pAdult]) x;
  if v_got = v_expect then
    raise notice 'PASS 4 (C): the team audience is every effective participant, including the call-up';
  else
    raise exception 'FAIL 4 (C): team audience is %, expected %', v_got, v_expect;
  end if;

  if not (pUnrelated = any(v_got)) then
    raise notice 'PASS 5 (C): a player at ANOTHER club is never in the audience';
  else
    raise exception 'FAIL 5 (C): another club''s player is in the audience';
  end if;

  -- =================================================================
  -- D. RECIPIENTS -- guardians, and the safeguarding line on players
  -- =================================================================
  select array_agg(user_id order by user_id) into v_got
  from internal.fixture_audience_recipients(v_fixture, 'ATTENDANCE_REMINDER');

  if v_gD = any(v_got) and v_gE1 = any(v_got) and v_gE2 = any(v_got) then
    raise notice 'PASS 6 (D): every ACTIVE guardian receives it, including both of a child''s two guardians';
  else
    raise exception 'FAIL 6 (D): an active guardian was omitted: %', v_got;
  end if;

  if not (v_gPending = any(v_got)) then
    raise notice 'PASS 7 (D): a PENDING guardian-link request receives nothing';
  else
    raise exception 'FAIL 7 (D): a pending guardian received a communication';
  end if;

  if not (v_gRejected = any(v_got)) then
    raise notice 'PASS 8 (D): a REJECTED guardian receives nothing';
  else
    raise exception 'FAIL 8 (D): a rejected guardian received a communication';
  end if;

  if not (v_gUnrelated = any(v_got)) then
    raise notice 'PASS 9 (D): an unrelated family''s guardian receives nothing';
  else
    raise exception 'FAIL 9 (D): an unrelated guardian received a communication';
  end if;

  -- The safeguarding line: having a login is not consent.
  if not (v_uMinor = any(v_got)) then
    raise notice 'PASS 10 (D): a 12-year-old with their OWN login is NOT messaged directly';
  else
    raise exception 'FAIL 10 (D): a minor was messaged directly because they have an account';
  end if;

  if v_uAdult = any(v_got) then
    raise notice 'PASS 11 (D): an adult player is messaged directly';
  else
    raise exception 'FAIL 11 (D): an adult player was not reachable';
  end if;

  -- 16-17 without the canonical grant: not directly reachable.
  if not (v_uTeen = any(v_got)) then
    raise notice 'PASS 12 (D): a 16-year-old is NOT messaged directly without guardian consent';
  else
    raise exception 'FAIL 12 (D): a 16-year-old was messaged without the canonical consent grant';
  end if;
  reset role;

  -- ...and WITH the grant, they are.
  insert into public.guardian_player_permissions (player_id, guardian_user_id, permission_key, granted, actor)
  values (pTeen, v_gD, 'direct_coach_communication', true, v_gD);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach::text,'role','authenticated')::text, true);
  select array_agg(user_id order by user_id) into v_got
  from internal.fixture_audience_recipients(v_fixture, 'ATTENDANCE_REMINDER');
  if v_uTeen = any(v_got) then
    raise notice 'PASS 13 (D): a 16-year-old IS reachable once guardians grant direct communication';
  else
    raise exception 'FAIL 13 (D): the canonical consent grant did not take effect';
  end if;

  -- =================================================================
  -- E. NO DUPLICATES
  -- =================================================================
  select count(*), count(distinct user_id) into v_n, v_dupcheck
  from internal.fixture_audience_recipients(v_fixture, 'MESSAGE_TEAM');
  if v_n = v_dupcheck then
    raise notice 'PASS 14 (E): recipients are distinct -- one adult guardianing three children is contacted once';
  else
    raise exception 'FAIL 14 (E): the recipient list contains duplicates';
  end if;
  reset role;

  -- =================================================================
  -- F. AUTHORITY -- who may send
  -- =================================================================
  for v_r in select unnest(array[v_gD, v_uAdult, v_stranger, v_other_coach]) as id loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', v_r.id::text,'role','authenticated')::text, true);
    begin
      perform public.send_fixture_communication(v_fixture, 'MESSAGE_TEAM', 'hello');
      raise exception 'FAIL 15 (F): a non-staff or unrelated account sent a fixture communication';
    exception when insufficient_privilege then
      null; -- expected
    end;
    reset role;
  end loop;
  raise notice 'PASS 15 (F): guardian, player, stranger and another club''s admin are all refused';

  -- A forged fixture id gives the same answer as an invisible one.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach::text,'role','authenticated')::text, true);
  begin
    perform public.send_fixture_communication(gen_random_uuid(), 'MESSAGE_TEAM', 'hello');
    raise exception 'FAIL 16 (F): a forged fixture id was accepted';
  exception when insufficient_privilege then
    raise notice 'PASS 16 (F): a forged fixture id is refused, with no hint about whether it exists';
  end;

  -- =================================================================
  -- G. COUNTS respect authority -- never a confident zero
  -- =================================================================
  select outstanding_count into v_n from public.fixture_communication_counts(v_fixture);
  if v_n = 5 then
    raise notice 'PASS 17 (G): staff see a real outstanding count (5)';
  else
    raise exception 'FAIL 17 (G): staff outstanding count is %', v_n;
  end if;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_gD::text,'role','authenticated')::text, true);
  select outstanding_count into v_n from public.fixture_communication_counts(v_fixture);
  if v_n is null then
    raise notice 'PASS 18 (G): an unauthorized viewer gets NULL, not an authoritative 0';
  else
    raise exception 'FAIL 18 (G): a guardian saw an outstanding count of %', v_n;
  end if;
  reset role;

  -- =================================================================
  -- H. SENDING -- outcomes, delivery, audit and rate limiting
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach::text,'role','authenticated')::text, true);

  select * into v_r from public.send_fixture_communication(v_fixture, 'ATTENDANCE_REMINDER', null);
  if v_r.outcome = 'SENT' and v_r.player_count = 5 and v_r.recipient_count > 0 then
    raise notice 'PASS 19 (H): a reminder reports SENT for % players / % recipients', v_r.player_count, v_r.recipient_count;
  else
    raise exception 'FAIL 19 (H): outcome=% players=% recipients=%', v_r.outcome, v_r.player_count, v_r.recipient_count;
  end if;
  reset role;

  select count(*) into v_n from public.notifications
  where type = 'fixture_attendance_reminder' and data->>'fixture_id' = v_fixture::text;
  if v_n > 0 then
    raise notice 'PASS 20 (H): canonical notifications were created (%), deep-linked to the fixture', v_n;
  else
    raise exception 'FAIL 20 (H): no notification rows were created';
  end if;

  -- Nobody outside the audience got one.
  select count(*) into v_n from public.notifications
  where type = 'fixture_attendance_reminder' and data->>'fixture_id' = v_fixture::text
    and user_id in (v_gPending, v_gRejected, v_gUnrelated, v_uMinor, v_stranger, v_other_coach);
  if v_n = 0 then
    raise notice 'PASS 21 (H): no notification reached a pending/rejected/unrelated/minor account';
  else
    raise exception 'FAIL 21 (H): % notification(s) reached an ineligible account', v_n;
  end if;

  -- Audit records counts, never contact details.
  select count(*) into v_n from public.fixture_communications
  where fixture_id = v_fixture and action = 'ATTENDANCE_REMINDER' and outcome = 'SENT';
  if v_n = 1 then
    raise notice 'PASS 22 (H): the send is recorded once in the audit trail';
  else
    raise exception 'FAIL 22 (H): % audit rows', v_n;
  end if;

  select count(*) into v_n from information_schema.columns
  where table_schema = 'public' and table_name = 'fixture_communications'
    and (column_name like '%email%' or column_name like '%recipient_id%' or column_name like '%user_ids%');
  if v_n = 0 then
    raise notice 'PASS 23 (H): the audit trail stores no addresses or recipient identities';
  else
    raise exception 'FAIL 23 (H): the audit table carries % contact column(s)', v_n;
  end if;

  -- Immediate repeat is refused -- this is the double-click guard.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach::text,'role','authenticated')::text, true);
  select * into v_r from public.send_fixture_communication(v_fixture, 'ATTENDANCE_REMINDER', null);
  if v_r.outcome = 'RATE_LIMITED' then
    raise notice 'PASS 24 (H): an immediate repeat is RATE_LIMITED, not sent twice';
  else
    raise exception 'FAIL 24 (H): a duplicate send returned %', v_r.outcome;
  end if;

  -- A DIFFERENT action is not blocked by the reminder's cooldown.
  select * into v_r from public.send_fixture_communication(v_fixture, 'MESSAGE_ATTENDEES', 'Bring both kits please.');
  if v_r.outcome = 'SENT' and v_r.player_count = 2 then
    raise notice 'PASS 25 (H): a different action is unaffected by another action''s cooldown';
  else
    raise exception 'FAIL 25 (H): outcome=% players=%', v_r.outcome, v_r.player_count;
  end if;

  reset role;

  -- An empty audience is reported honestly, never as "Sent". A brand-new
  -- team with no players is the realistic way this happens.
  insert into public.teams (club_id, category, age_group, gender, rugby_code, created_by)
  values (v_club, 'youth', 'U14', null, 'union', v_coach)
  returning id into v_empty_team;
  insert into public.fixtures (owning_team_id, opponent_directory_id, raw_opposition_text, kickoff_date, kickoff_time, home_away, status, season_id, created_by)
  values (v_empty_team, v_dir, 'Directory Opposition RFC', current_date + 8, '11:00', 'Home', 'Booked', v_season, v_coach)
  returning id into v_other_fixture;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach::text,'role','authenticated')::text, true);
  select * into v_r from public.send_fixture_communication(v_other_fixture, 'MESSAGE_TEAM', 'Anyone there?');
  reset role;
  if v_r.outcome = 'NO_ELIGIBLE_RECIPIENTS' then
    raise notice 'PASS 26 (H): an empty audience reports NO_ELIGIBLE_RECIPIENTS, never "Sent"';
  else
    raise exception 'FAIL 26 (H): an empty audience returned %', v_r.outcome;
  end if;

  -- Message body is required for the message actions.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach::text,'role','authenticated')::text, true);
  begin
    perform public.send_fixture_communication(v_fixture, 'MESSAGE_TEAM', '   ');
    raise exception 'FAIL 27 (H): an empty message body was accepted';
  exception when others then
    if sqlerrm like 'FAIL 27%' then raise; end if;
    raise notice 'PASS 27 (H): an empty message body is refused';
  end;

  begin
    perform public.send_fixture_communication(v_fixture, 'DELETE_EVERYTHING', 'x');
    raise exception 'FAIL 28 (H): an unknown action was accepted';
  exception when others then
    if sqlerrm like 'FAIL 28%' then raise; end if;
    raise notice 'PASS 28 (H): an unknown action is refused';
  end;
  reset role;

  -- =================================================================
  -- I. NO CLIENT WRITES
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach::text,'role','authenticated')::text, true);
  begin
    insert into public.fixture_communications (fixture_id, action, sent_by, outcome, body)
    values (v_fixture, 'MESSAGE_TEAM', v_coach, 'SENT', 'forged');
    raise exception 'FAIL 29 (I): a client wrote the audit trail directly';
  exception when insufficient_privilege then
    raise notice 'PASS 29 (I): the audit trail takes no client writes';
  end;
  reset role;

  -- =================================================================
  -- J. MINI-RUGBY -- one physical fixture, overlapping components
  -- =================================================================
  -- A Mini-Rugby side is a scheduling GROUP of component teams, and a child
  -- can legitimately sit in more than one component. The failure this
  -- prevents is three copies of one message landing on one parent because
  -- U6/U7/U8 overlap.
  insert into public.teams (club_id, category, age_group, gender, rugby_code, created_by)
  values (v_club, 'youth', 'U7', 'mixed', 'union', v_coach) returning id into v_mini_a;
  -- U8 already exists at this club, so the second component is U9 -- the
  -- point is two DIFFERENT component teams in one group, not the labels.
  insert into public.teams (club_id, category, age_group, gender, rugby_code, created_by)
  values (v_club, 'youth', 'U9', 'mixed', 'union', v_coach) returning id into v_mini_b;

  insert into public.scheduling_groups (club_id, display_tag, season_id, created_by)
  values (v_club, 'Minis', v_season, v_coach) returning id into v_group;
  insert into public.scheduling_group_members (group_id, team_id) values (v_group, v_mini_a), (v_group, v_mini_b);

  insert into public.players (first_name, surname, date_of_birth) values ('Overlap','Fcfam','2019-01-01') returning id into pMiniOverlap;
  -- The SAME child, active in BOTH components.
  insert into public.player_team_memberships (player_id, team_id, status) values (pMiniOverlap, v_mini_a, 'active');
  insert into public.player_team_memberships (player_id, team_id, status) values (pMiniOverlap, v_mini_b, 'active');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_gA, pMiniOverlap, 'guardian', 'active');

  insert into public.fixtures (owning_team_id, owning_scheduling_group_id, opponent_directory_id, raw_opposition_text, kickoff_date, kickoff_time, home_away, status, season_id, created_by)
  values (v_mini_a, v_group, v_dir, 'Directory Opposition RFC', current_date + 9, '10:00', 'Home', 'Booked', v_season, v_coach)
  returning id into v_mini_fixture;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach::text,'role','authenticated')::text, true);

  select count(*) into v_n from internal.fixture_audience_players(v_mini_fixture, 'MESSAGE_TEAM') where player_id = pMiniOverlap;
  if v_n = 1 then
    raise notice 'PASS 30 (J): a child in TWO Mini components appears ONCE in the audience';
  else
    raise exception 'FAIL 30 (J): the overlapping child appears % times', v_n;
  end if;

  select count(*) into v_n from internal.fixture_audience_recipients(v_mini_fixture, 'MESSAGE_TEAM') where user_id = v_gA;
  if v_n = 1 then
    raise notice 'PASS 31 (J): their guardian is contacted ONCE, not once per component team';
  else
    raise exception 'FAIL 31 (J): the guardian appears % times', v_n;
  end if;

  -- One physical fixture, one communication -- never one per component.
  select * into v_r from public.send_fixture_communication(v_mini_fixture, 'MESSAGE_TEAM', 'Minis: meet by the clubhouse.');
  reset role;
  select count(*) into v_n from public.notifications
  where type = 'fixture_staff_message' and data->>'fixture_id' = v_mini_fixture::text and user_id = v_gA;
  if v_n = 1 then
    raise notice 'PASS 32 (J): exactly ONE notification per person for one physical Mini fixture';
  else
    raise exception 'FAIL 32 (J): the guardian received % notifications', v_n;
  end if;

  select count(*) into v_n from public.fixture_communications where fixture_id = v_mini_fixture;
  if v_n = 1 then
    raise notice 'PASS 33 (J): one audit row for one physical fixture, not one per component';
  else
    raise exception 'FAIL 33 (J): % audit rows for one Mini fixture', v_n;
  end if;

  raise notice 'Fixture communications complete.';
end $$;

rollback;
