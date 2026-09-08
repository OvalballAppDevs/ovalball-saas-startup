-- Phase 2A: Calendar -> Match Centre, on one canonical fixture id.
--
-- The application half of this phase is three one-line href changes, so what
-- is worth pinning permanently is not the link markup -- it is the set of
-- invariants that make linking safe, and that a future change could quietly
-- break:
--
--   * there is exactly ONE physical fixture identity, and no second one
--     appears anywhere in the schema
--   * a Mini-Rugby group plays ONE physical fixture, not one per component team
--   * training keeps its own identity and never becomes a fixture
--   * an unclaimed opposition needs no fake clubs/teams row
--   * fixture SCHEDULING facts are deliberately public product-wide, but
--     participants, attendance and conversation are not -- and an unrelated
--     signed-in account gets none of them, however it reaches the URL
--
-- Self-contained/transactional.

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Phase 2A: Calendar -> Match Centre ==='

begin;

do $$
declare
  v_site uuid := gen_random_uuid();
  v_guardian uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_dir uuid; v_opp_dir uuid; v_club uuid;
  v_team uuid; v_team_b uuid; v_group uuid;
  v_player uuid; v_other_player uuid;
  v_fixture uuid; v_minis uuid; v_training uuid;
  v_season uuid;
  v_count int; v_text text;
begin
  -- The season that CONTAINS today, from the canonical resolver. Taking the
  -- latest season by starts_on picked a FUTURE season the moment one existed,
  -- so a group filed against it no longer matched its own fixtures' kickoff.
  v_season := internal.resolve_season_for_date('union', current_date);

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
    (v_site,'cmc-site-'||v_site::text||'@ovalball.test','',now(),now(),now(),'{}'::jsonb,'{}'::jsonb),
    (v_guardian,'cmc-guardian-'||v_guardian::text||'@ovalball.test','',now(),now(),now(),'{}'::jsonb,'{}'::jsonb),
    (v_stranger,'cmc-stranger-'||v_stranger::text||'@ovalball.test','',now(),now(),now(),'{}'::jsonb,'{}'::jsonb);
  insert into public.profiles (id, first_name, surname, email) values
    (v_site,'CMC','Site','cmc-site-'||v_site::text||'@ovalball.test'),
    (v_guardian,'CMC','Guardian','cmc-guardian-'||v_guardian::text||'@ovalball.test'),
    (v_stranger,'CMC','Stranger','cmc-stranger-'||v_stranger::text||'@ovalball.test');
  insert into public.site_admins (user_id, status, admin_role) values (v_site,'active','full');

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CMC Test RUFC','Testville','Testshire','union','United Kingdom','England',true,'unverified','site_admin_manual','cmc-'||substr(gen_random_uuid()::text,1,8))
  returning id into v_dir;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CMC Unclaimed Opposition RFC','Testville','Testshire','union','United Kingdom','England',true,'unverified','site_admin_manual','cmc-opp-'||substr(gen_random_uuid()::text,1,8))
  returning id into v_opp_dir;

  insert into public.clubs (directory_id, slug, status) values (v_dir,'cmc-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club;
  insert into public.teams (club_id, rugby_code, category, age_group, active) values (v_club,'union','youth','U12',true) returning id into v_team;
  insert into public.teams (club_id, rugby_code, category, age_group, squad_designation, active) values (v_club,'union','youth','U12','B',true) returning id into v_team_b;

  insert into public.players (first_name, surname, date_of_birth, active, playing_pathway) values ('CMC','Child','2014-05-01',true, 'MALE') returning id into v_player;
  insert into public.players (first_name, surname, date_of_birth, active, playing_pathway) values ('CMC','Unrelated','2014-05-01',true, 'MALE') returning id into v_other_player;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_player, v_team, 'active');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_guardian, v_player, 'parent', 'active');

  insert into public.fixtures (owning_team_id, season_id, kickoff_date, kickoff_time, home_away, status, game_type, source, raw_opposition_text, opponent_directory_id)
  values (v_team, v_season, current_date + 10, '10:30', 'Home', 'Booked', 'League Fixture', 'club_created', 'CMC Unclaimed Opposition RFC', v_opp_dir)
  returning id into v_fixture;

  insert into public.training_sessions (club_id, team_id, season_id, session_date, start_time)
  values (v_club, v_team, v_season, current_date + 3, '18:00') returning id into v_training;

  -- =================================================================
  -- A. ONE physical fixture identity, and no second one anywhere
  -- =================================================================
  select count(*) into v_count
  from information_schema.columns
  where table_schema='public'
    and column_name in ('calendar_fixture_id','match_centre_fixture_id','event_fixture_id','master_fixture_id');
  if v_count = 0 then
    raise notice 'PASS 1 (A): no calendar/match-centre/master fixture identity column exists anywhere -- one physical fixture id';
  else
    raise exception 'FAIL 1 (A): % duplicate fixture identity column(s) appeared', v_count;
  end if;

  select count(*) into v_count from pg_tables
  where schemaname='public' and (tablename like 'calendar_event%' or tablename like 'calendar_fixture%' or tablename like 'match_centre%');
  if v_count = 0 then
    raise notice 'PASS 2 (A): no calendar-owned or Match-Centre-owned event table -- the calendar projects canonical rows, it does not own them';
  else
    raise exception 'FAIL 2 (A): % calendar/match-centre owned table(s) exist', v_count;
  end if;

  -- mirror_fixture_id remains legacy-only: this new fixture has none.
  select count(*) into v_count from public.fixtures where id = v_fixture and mirror_fixture_id is null;
  if v_count = 1 then
    raise notice 'PASS 3 (A): a newly created fixture carries no mirror -- mirroring is legacy compatibility, not the model';
  else
    raise exception 'FAIL 3 (A): a new fixture was given a mirror';
  end if;

  -- =================================================================
  -- B. Mini-Rugby: one physical fixture for the group
  -- =================================================================
  insert into public.scheduling_groups (club_id, display_tag, active, season_id)
  values (v_club, 'CMC Minis', true, v_season) returning id into v_group;
  insert into public.scheduling_group_members (group_id, team_id) values (v_group, v_team), (v_group, v_team_b);

  insert into public.fixtures (owning_team_id, owning_scheduling_group_id, season_id, kickoff_date, kickoff_time, home_away, status, game_type, source, raw_opposition_text, opponent_directory_id)
  values (v_team, v_group, v_season, current_date + 17, '09:30', 'Home', 'Booked', 'Friendly', 'club_created', 'CMC Unclaimed Opposition RFC', v_opp_dir)
  returning id into v_minis;

  select count(*) into v_count from public.fixtures where owning_scheduling_group_id = v_group;
  if v_count = 1 then
    raise notice 'PASS 4 (B): a Mini-Rugby group of 2 component teams has ONE physical fixture, not one per team';
  else
    raise exception 'FAIL 4 (B): the group produced % fixtures', v_count;
  end if;

  select count(*) into v_count from public.scheduling_group_members where group_id = v_group;
  if v_count = 2 then
    raise notice 'PASS 5 (B): both component teams reach that single fixture through the group, not through copies of it';
  else
    raise exception 'FAIL 5 (B): group has % members', v_count;
  end if;

  -- =================================================================
  -- C. Training stays training
  -- =================================================================
  select count(*) into v_count from public.fixtures where id = v_training;
  if v_count = 0 then
    raise notice 'PASS 6 (C): a training session id is NOT a fixture id -- the two identities never collide';
  else
    raise exception 'FAIL 6 (C): a training session id resolved as a fixture';
  end if;

  select count(*) into v_count
  from information_schema.columns
  where table_schema='public' and table_name='player_fixture_attendance'
    and column_name in ('fixture_id','training_session_id');
  if v_count = 2 then
    raise notice 'PASS 7 (C): attendance carries fixture_id and training_session_id as separate columns -- training is never recorded as a fixture';
  else
    raise exception 'FAIL 7 (C): the attendance identity columns changed';
  end if;

  -- =================================================================
  -- D. Unclaimed opposition needs no fake club
  -- =================================================================
  select count(*) into v_count from public.clubs where directory_id = v_opp_dir;
  if v_count = 0 then
    raise notice 'PASS 8 (D): the opposition stays directory-only -- no clubs row was invented, so it counts as zero activated clubs';
  else
    raise exception 'FAIL 8 (D): a clubs row was created for an unclaimed opposition';
  end if;

  select count(*) into v_count from public.fixtures where id = v_fixture and opponent_team_id is null and opponent_directory_id is not null;
  if v_count = 1 then
    raise notice 'PASS 9 (D): the fixture resolves its opposition from club_directory, with no fake team';
  else
    raise exception 'FAIL 9 (D): the unclaimed opposition fixture is not directory-resolved';
  end if;

  -- =================================================================
  -- E. Fixture scheduling facts are public BY DESIGN -- recorded, not assumed
  -- =================================================================
  -- This is a pre-existing product decision (fixtures_select_all applies to
  -- anon as well as authenticated), not something the Calendar link
  -- introduced. It is asserted here so that if it ever changes, the change
  -- is deliberate and this test is the thing that says so.
  select count(*) into v_count from pg_policies
  where tablename='fixtures' and cmd='SELECT' and 'anon' = any(roles);
  if v_count >= 1 then
    raise notice 'PASS 10 (E): fixture scheduling rows are readable publicly by existing design -- Match Centre''s hero is not a new exposure';
  else
    raise exception 'FAIL 10 (E): fixture visibility changed; the Match Centre link needs re-reviewing against the new rule';
  end if;

  -- =================================================================
  -- F. What a stranger must NOT get, however they reach the URL
  -- =================================================================
  -- Seeded as owner, not as a viewer: a stranger cannot write this row and
  -- must not be able to, so writing it under their session would be testing
  -- the wrong thing.
  insert into public.player_fixture_attendance (fixture_id, player_id, status, responded_by_user_id, response_source)
  values (v_fixture, v_player, 'ATTENDING', v_guardian, 'guardian');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger::text, 'role','authenticated')::text, true);
  select count(*) into v_count from public.player_fixture_attendance where fixture_id = v_fixture;
  if v_count = 0 then
    raise notice 'PASS 11 (F): an unrelated signed-in account sees NO attendance on a fixture it can name';
  else
    raise exception 'FAIL 11 (F): a stranger read % attendance row(s)', v_count;
  end if;

  select count(*) into v_count from public.players where id = v_player;
  if v_count = 0 then
    raise notice 'PASS 12 (F): an unrelated account cannot read the player row at all -- no name, no date of birth';
  else
    raise exception 'FAIL 12 (F): a stranger read a child''s player row';
  end if;

  select count(*) into v_count from public.guardians where player_id = v_player;
  if v_count = 0 then
    raise notice 'PASS 13 (F): an unrelated account cannot read the guardian relationship';
  else
    raise exception 'FAIL 13 (F): a stranger read a guardian relationship';
  end if;

  -- The capability wrapper the Match Centre page itself calls: every gate
  -- closed for someone with no relationship to this fixture.
  -- The function has OUT parameters, so its columns are already named.
  select case when q.can_view_participants or q.can_message or q.can_manage_fixture
              then 'OPEN' else 'CLOSED' end
  into v_text
  from public.get_match_centre_capabilities(v_fixture) q;
  if v_text = 'CLOSED' then
    raise notice 'PASS 16 (F): get_match_centre_capabilities returns participants/message/manage ALL false for an unrelated account';
  else
    raise exception 'FAIL 16 (F): a stranger holds a Match Centre capability on this fixture';
  end if;
  reset role;

  -- =================================================================
  -- G. What the guardian legitimately DOES get
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_guardian::text, 'role','authenticated')::text, true);

  select count(*) into v_count from public.player_fixture_attendance where fixture_id = v_fixture and player_id = v_player;
  if v_count = 1 then
    raise notice 'PASS 14 (G): the guardian sees their own linked child''s attendance on this fixture';
  else
    raise exception 'FAIL 14 (G): the guardian could not see their own child''s attendance';
  end if;

  select count(*) into v_count from public.players where id = v_other_player;
  if v_count = 0 then
    raise notice 'PASS 15 (G): the guardian sees ONLY their own child -- an unrelated player on the same platform stays invisible';
  else
    raise exception 'FAIL 15 (G): the guardian read an unrelated child''s player row';
  end if;
  reset role;

  raise notice 'Phase 2A Calendar -> Match Centre invariants complete.';
end $$;

rollback;
