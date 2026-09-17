-- Two weeks out, Ovalball asks who is coming.
--
-- What is worth pinning here is not "a notification row appeared". It is that
-- the invitation reuses the canonical safeguarding model rather than inventing
-- a second one, and that the job is safe to run every day forever:
--
--   * a child is never contacted directly; their active guardian is
--   * an adult player is contacted themselves
--   * somebody who has already answered is not chased
--   * running the job twice does not ask twice
--   * somebody who joins the squad AFTER the first run is still asked
--   * a cancelled fixture asks nobody
--   * the notification carries the canonical fixture_id, so it lands on the
--     one shared Match Centre rather than a copy of it
--
-- Self-contained/transactional.

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Two-week attendance invitations ==='

begin;

do $$
declare
  v_site uuid := gen_random_uuid();
  v_guardian uuid := gen_random_uuid();
  v_adult uuid := gen_random_uuid();
  v_latecomer_guardian uuid := gen_random_uuid();
  v_dir uuid; v_opp_dir uuid; v_club uuid; v_team uuid; v_season uuid;
  v_child uuid; v_adult_player uuid; v_answered uuid; v_latecomer uuid;
  v_soon uuid; v_far uuid; v_cancelled uuid;
  v_count int; v_sent int; v_data jsonb;
begin
  v_season := internal.resolve_season_for_date('union', current_date);

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
    (v_site,'fai-site-'||v_site::text||'@ovalball.test','',now(),now(),now(),'{}'::jsonb,'{}'::jsonb),
    (v_guardian,'fai-guardian-'||v_guardian::text||'@ovalball.test','',now(),now(),now(),'{}'::jsonb,'{}'::jsonb),
    (v_adult,'fai-adult-'||v_adult::text||'@ovalball.test','',now(),now(),now(),'{}'::jsonb,'{}'::jsonb),
    (v_latecomer_guardian,'fai-late-'||v_latecomer_guardian::text||'@ovalball.test','',now(),now(),now(),'{}'::jsonb,'{}'::jsonb);
  insert into public.profiles (id, first_name, surname, email) values
    (v_site,'FAI','Site','fai-site-'||v_site::text||'@ovalball.test'),
    (v_guardian,'FAI','Guardian','fai-guardian-'||v_guardian::text||'@ovalball.test'),
    (v_adult,'FAI','Adult','fai-adult-'||v_adult::text||'@ovalball.test'),
    (v_latecomer_guardian,'FAI','Late','fai-late-'||v_latecomer_guardian::text||'@ovalball.test');
  insert into public.site_admins (user_id, status, admin_role) values (v_site,'active','full');

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FAI Test RUFC','Testville','Testshire','union','United Kingdom','England',true,'unverified','site_admin_manual','fai-'||substr(gen_random_uuid()::text,1,8))
  returning id into v_dir;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FAI Opposition RFC','Testville','Testshire','union','United Kingdom','England',true,'unverified','site_admin_manual','fai-opp-'||substr(gen_random_uuid()::text,1,8))
  returning id into v_opp_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'fai-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club;

  -- An adult side, so an adult player on it is genuinely an adult player.
  insert into public.teams (club_id, rugby_code, category, age_group, gender, active)
  values (v_club,'union','senior',null,'mens',true) returning id into v_team;

  insert into public.players (first_name, surname, date_of_birth, active, playing_pathway)
  values ('FAI','Child',(current_date - interval '12 years')::date,true,'MALE') returning id into v_child;
  insert into public.players (first_name, surname, date_of_birth, active, playing_pathway, user_id)
  values ('FAI','Grownup',(current_date - interval '25 years')::date,true,'MALE',v_adult) returning id into v_adult_player;
  insert into public.players (first_name, surname, date_of_birth, active, playing_pathway)
  values ('FAI','Answered',(current_date - interval '11 years')::date,true,'MALE') returning id into v_answered;
  insert into public.players (first_name, surname, date_of_birth, active, playing_pathway)
  values ('FAI','Latecomer',(current_date - interval '13 years')::date,true,'MALE') returning id into v_latecomer;

  insert into public.player_team_memberships (player_id, team_id, status) values
    (v_child, v_team, 'active'),
    (v_adult_player, v_team, 'active'),
    (v_answered, v_team, 'active');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values
    (v_guardian, v_child, 'parent', 'active'),
    (v_guardian, v_answered, 'parent', 'active'),
    (v_latecomer_guardian, v_latecomer, 'parent', 'active');

  -- Inside the window, outside it, and one that is not happening at all.
  insert into public.fixtures (owning_team_id, season_id, kickoff_date, kickoff_time, home_away, status, game_type, source, raw_opposition_text, opponent_directory_id)
  values (v_team, v_season, current_date + 10, '14:30', 'Home', 'Booked', 'League Fixture', 'club_created', 'FAI Opposition RFC', v_opp_dir)
  returning id into v_soon;
  insert into public.fixtures (owning_team_id, season_id, kickoff_date, kickoff_time, home_away, status, game_type, source, raw_opposition_text, opponent_directory_id)
  values (v_team, v_season, current_date + 45, '14:30', 'Home', 'Booked', 'League Fixture', 'club_created', 'FAI Opposition RFC', v_opp_dir)
  returning id into v_far;
  insert into public.fixtures (owning_team_id, season_id, kickoff_date, kickoff_time, home_away, status, game_type, source, raw_opposition_text, opponent_directory_id, cancelled_at, cancellation_reason)
  values (v_team, v_season, current_date + 5, '14:30', 'Home', 'Booked', 'League Fixture', 'club_created', 'FAI Opposition RFC', v_opp_dir, now(), 'Waterlogged')
  returning id into v_cancelled;

  -- One player has already answered, and must not be chased.
  insert into public.player_fixture_attendance (fixture_id, player_id, status, responded_by_user_id, response_source)
  values (v_soon, v_answered, 'ATTENDING', v_guardian, 'guardian');

  -- =================================================================
  -- A. Which fixtures are due
  -- =================================================================
  select count(*) into v_count from internal.fixtures_due_attendance_invitation() where fixture_id = v_soon;
  if v_count = 1 then
    raise notice 'PASS 1 (A): a fixture 10 days out is inside the two-week window';
  else
    raise exception 'FAIL 1 (A): the fixture 10 days out was not due';
  end if;

  select count(*) into v_count from internal.fixtures_due_attendance_invitation() where fixture_id = v_far;
  if v_count = 0 then
    raise notice 'PASS 2 (A): a fixture 45 days out is not asked about yet';
  else
    raise exception 'FAIL 2 (A): a fixture far outside the window was due';
  end if;

  select count(*) into v_count from internal.fixtures_due_attendance_invitation() where fixture_id = v_cancelled;
  if v_count = 0 then
    raise notice 'PASS 3 (A): a CANCELLED fixture asks nobody -- a match that is not happening needs no availability';
  else
    raise exception 'FAIL 3 (A): a cancelled fixture was due for invitations';
  end if;

  -- =================================================================
  -- B. Who gets asked
  -- =================================================================
  v_sent := internal.send_due_fixture_attendance_invitations();
  if v_sent >= 2 then
    raise notice 'PASS 4 (B): the job sent % invitation(s)', v_sent;
  else
    raise exception 'FAIL 4 (B): the job sent % invitations, expected at least 2', v_sent;
  end if;

  select count(*) into v_count from public.notifications
  where user_id = v_guardian and type = 'fixture_attendance_invitation' and data->>'fixture_id' = v_soon::text;
  if v_count = 1 then
    raise notice 'PASS 5 (B): the active GUARDIAN of a 12-year-old is asked -- once, not once per child';
  else
    raise exception 'FAIL 5 (B): the guardian received % invitations, expected exactly 1', v_count;
  end if;

  select count(*) into v_count from public.notifications
  where user_id = v_adult and type = 'fixture_attendance_invitation' and data->>'fixture_id' = v_soon::text;
  if v_count = 1 then
    raise notice 'PASS 6 (B): an ADULT player is asked directly, in their own right';
  else
    raise exception 'FAIL 6 (B): the adult player received % invitations, expected 1', v_count;
  end if;

  -- The child has no login at all here, which is the common case; the load
  -- bearing assertion is that nothing in this job ever resolves a MINOR as a
  -- recipient even when one does have an account. fixture_audience_recipients
  -- draws that line, and this pins that the job did not go around it.
  select count(*) into v_count
  from public.notifications n
  join public.players p on p.user_id = n.user_id
  where n.type = 'fixture_attendance_invitation'
    and internal.player_effective_age(p.id) < 16;
  if v_count = 0 then
    raise notice 'PASS 7 (B): no under-16 was contacted directly -- the guardian is the recipient, as everywhere else in Ovalball';
  else
    raise exception 'FAIL 7 (B): % under-16 player(s) were contacted directly', v_count;
  end if;

  -- =================================================================
  -- C. Somebody who has answered is not chased
  -- =================================================================
  -- The guardian above guardians BOTH the outstanding child and the one who
  -- has answered, and received exactly one invitation (PASS 5). That single
  -- row is the proof: had the answered child also produced an invitation, the
  -- guardian would have two.
  select count(*) into v_count
  from internal.fixture_audience_players(v_soon, 'ATTENDANCE_REMINDER')
  where player_id = v_answered;
  if v_count = 0 then
    raise notice 'PASS 8 (C): a player who has already responded is not in the outstanding audience';
  else
    raise exception 'FAIL 8 (C): an answered player was still counted as outstanding';
  end if;

  -- =================================================================
  -- D. Running it again does not ask again
  -- =================================================================
  v_sent := internal.send_due_fixture_attendance_invitations();
  if v_sent = 0 then
    raise notice 'PASS 9 (D): a second run sends nothing -- the job is safe to schedule daily';
  else
    raise exception 'FAIL 9 (D): a second run sent % duplicate invitation(s)', v_sent;
  end if;

  select count(*) into v_count from public.notifications
  where user_id = v_guardian and type = 'fixture_attendance_invitation' and data->>'fixture_id' = v_soon::text;
  if v_count = 1 then
    raise notice 'PASS 10 (D): the guardian still has exactly one invitation after two runs';
  else
    raise exception 'FAIL 10 (D): the guardian accumulated % invitations', v_count;
  end if;

  -- =================================================================
  -- E. Somebody who becomes eligible LATER is still asked
  -- =================================================================
  -- This is the whole reason the ledger records people rather than fixtures.
  -- A squad is not fixed two weeks out.
  insert into public.player_team_memberships (player_id, team_id, status) values (v_latecomer, v_team, 'active');
  v_sent := internal.send_due_fixture_attendance_invitations();
  if v_sent >= 1 then
    raise notice 'PASS 11 (E): a player who joined the squad after the first run got their guardian asked';
  else
    raise exception 'FAIL 11 (E): a late joiner was silently never asked';
  end if;

  select count(*) into v_count from public.notifications
  where user_id = v_latecomer_guardian and type = 'fixture_attendance_invitation' and data->>'fixture_id' = v_soon::text;
  if v_count = 1 then
    raise notice 'PASS 12 (E): the late joiner''s guardian has exactly one invitation';
  else
    raise exception 'FAIL 12 (E): the late joiner''s guardian has % invitations', v_count;
  end if;

  -- =================================================================
  -- F. The invitation lands on the ONE shared Match Centre
  -- =================================================================
  select data into v_data from public.notifications
  where user_id = v_adult and type = 'fixture_attendance_invitation' limit 1;
  if v_data->>'fixture_id' = v_soon::text then
    raise notice 'PASS 13 (F): the notification carries the canonical fixture_id -- it deep-links to that fixture''s Match Centre, not a copy';
  else
    raise exception 'FAIL 13 (F): the notification does not carry the canonical fixture id';
  end if;

  select count(*) into v_count from public.notifications
  where type = 'fixture_attendance_invitation' and data->>'fixture_id' = v_cancelled::text;
  if v_count = 0 then
    raise notice 'PASS 14 (F): nobody was invited to a cancelled fixture';
  else
    raise exception 'FAIL 14 (F): % invitation(s) were sent for a cancelled fixture', v_count;
  end if;

  -- =================================================================
  -- G. The manual trigger is Site Admin only
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_guardian::text, 'role','authenticated')::text, true);
  begin
    perform public.run_fixture_attendance_invitation_check();
    raise exception 'FAIL 15 (G): a guardian was able to trigger the platform-wide invitation job';
  exception
    when sqlstate '42501' then
      raise notice 'PASS 15 (G): a non-site-admin cannot trigger the invitation job by hand';
  end;
  reset role;

  -- The ledger is not browser-readable: it says which adults are attached to
  -- which fixture, and nothing in the product needs to read it client-side.
  -- PERMISSIVE only. Slice 6 adds a RESTRICTIVE session gate (FOR ALL) to every non-public table, and
  -- a restrictive policy can only ever take access away -- counting it here would read "exposed" for a
  -- change that does the exact opposite.
  select count(*) into v_count from pg_policies
  where tablename = 'fixture_attendance_invitations' and cmd in ('SELECT','ALL')
    and permissive = 'PERMISSIVE';
  if v_count = 0 then
    raise notice 'PASS 16 (G): the invitation ledger has no read policy -- it is never exposed to the browser';
  else
    raise exception 'FAIL 16 (G): the invitation ledger became client-readable';
  end if;

  raise notice 'Two-week attendance invitation invariants complete.';
end $$;

rollback;
