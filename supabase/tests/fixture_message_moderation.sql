-- A club can moderate its own fixture conversation.
--
-- The load-bearing questions are not "does delete set deleted_at". They are
-- the ones a safeguarding review would ask:
--
--   * can staff of THIS fixture remove a message, and can a stranger not?
--   * does a block actually stop the person posting, or only hide a button?
--   * is the block scoped to one club, or has one club silenced somebody
--     everywhere?
--   * can a blocked person still reach a safeguarding officer?
--   * does removing a message destroy the evidence it was removed over?
--
-- Self-contained/transactional.

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Fixture message moderation ==='

begin;

do $$
declare
  v_staff uuid := gen_random_uuid();
  v_poster uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_dirA uuid; v_dirB uuid; v_clubA uuid; v_clubB uuid;
  v_teamA uuid; v_teamB uuid; v_season uuid;
  v_fixtureA uuid; v_fixtureB uuid;
  v_msg uuid; v_other uuid;
  v_count int; v_blocked boolean; v_resolved uuid;
begin
  v_season := internal.resolve_season_for_date('union', current_date);

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
    (v_staff,'fmm-staff-'||v_staff::text||'@ovalball.test','',now(),now(),now(),'{}'::jsonb,'{}'::jsonb),
    (v_poster,'fmm-poster-'||v_poster::text||'@ovalball.test','',now(),now(),now(),'{}'::jsonb,'{}'::jsonb),
    (v_stranger,'fmm-stranger-'||v_stranger::text||'@ovalball.test','',now(),now(),now(),'{}'::jsonb,'{}'::jsonb);
  insert into public.profiles (id, first_name, surname, email) values
    (v_staff,'Fiona','Staff','fmm-staff-'||v_staff::text||'@ovalball.test'),
    (v_poster,'Paul','Poster','fmm-poster-'||v_poster::text||'@ovalball.test'),
    (v_stranger,'Sam','Stranger','fmm-stranger-'||v_stranger::text||'@ovalball.test');

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FMM Club A RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','fmma-'||substr(gen_random_uuid()::text,1,8))
  returning id into v_dirA;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FMM Club B RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','fmmb-'||substr(gen_random_uuid()::text,1,8))
  returning id into v_dirB;
  insert into public.clubs (directory_id, slug, status) values (v_dirA,'fmma-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_clubA;
  insert into public.clubs (directory_id, slug, status) values (v_dirB,'fmmb-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_clubB;

  insert into public.teams (club_id, rugby_code, category, age_group, gender, active) values (v_clubA,'union','senior',null,'mens',true) returning id into v_teamA;
  insert into public.teams (club_id, rugby_code, category, age_group, gender, active) values (v_clubB,'union','senior',null,'mens',true) returning id into v_teamB;

  -- Fiona is a Club Admin of club A only.
  insert into public.club_memberships (user_id, club_id, role, status) values (v_staff, v_clubA, 'CLUB_ADMIN', 'active');

  -- Two fixtures: one at club A, one entirely at club B.
  insert into public.fixtures (owning_team_id, season_id, kickoff_date, kickoff_time, home_away, status, game_type, source, raw_opposition_text, opponent_team_id)
  values (v_teamA, v_season, current_date + 7, '14:30','Home','Booked','League Fixture','club_created','FMM Club B RUFC', v_teamB)
  returning id into v_fixtureA;
  insert into public.fixtures (owning_team_id, season_id, kickoff_date, kickoff_time, home_away, status, game_type, source, raw_opposition_text)
  values (v_teamB, v_season, current_date + 8, '14:30','Home','Booked','League Fixture','club_created','Someone Else RFC')
  returning id into v_fixtureB;

  insert into public.fixture_messages (fixture_id, sender_user_id, body)
  values (v_fixtureA, v_poster, 'Something that needs removing.') returning id into v_msg;
  insert into public.fixture_messages (fixture_id, sender_user_id, body)
  values (v_fixtureA, v_poster, 'A second message, left alone.') returning id into v_other;

  -- =================================================================
  -- A. Removing a message
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger::text, 'role','authenticated')::text, true);
  begin
    perform public.team_delete_fixture_message(v_msg);
    raise exception 'FAIL 1 (A): a stranger removed a message from a fixture they have nothing to do with';
  exception when sqlstate '42501' then
    raise notice 'PASS 1 (A): somebody with no authority on this fixture cannot remove a message';
  end;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text, 'role','authenticated')::text, true);
  perform public.team_delete_fixture_message(v_msg);
  reset role;

  select count(*) into v_count from public.fixture_messages where id = v_msg and deleted_at is not null and deleted_by = v_staff and deleted_by_role = 'team_admin';
  if v_count = 1 then
    raise notice 'PASS 2 (A): club staff removed the message, recorded against them in the team_admin role';
  else
    raise exception 'FAIL 2 (A): the removal was not recorded correctly';
  end if;

  select count(*) into v_count from public.fixture_messages where id = v_msg and body = 'Something that needs removing.';
  if v_count = 1 then
    raise notice 'PASS 3 (A): the message ROW survives -- a removed message is frequently the evidence for what it was removed over';
  else
    raise exception 'FAIL 3 (A): removing a message destroyed it';
  end if;

  select count(*) into v_count from public.fixture_messages where id = v_other and deleted_at is null;
  if v_count = 1 then
    raise notice 'PASS 4 (A): only the message that was acted on was removed';
  else
    raise exception 'FAIL 4 (A): an unrelated message was affected';
  end if;

  -- =================================================================
  -- B. Blocking somebody
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger::text, 'role','authenticated')::text, true);
  begin
    perform public.block_user_from_club_messages(v_clubA, v_poster, 'no reason');
    raise exception 'FAIL 5 (B): a stranger blocked somebody from a club they do not belong to';
  exception when sqlstate '42501' then
    raise notice 'PASS 5 (B): somebody without club fixture authority cannot block anyone';
  end;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text, 'role','authenticated')::text, true);
  perform public.block_user_from_club_messages(v_clubA, v_poster, 'Repeated abuse in the thread.');
  -- The club is resolved from the fixture, never taken from the browser.
  select public.resolve_blocking_club_for_fixture(v_fixtureA) into v_resolved;
  if v_resolved = v_clubA then
    raise notice 'PASS 6 (B): the blocking club is resolved server-side from the fixture and the actor''s own authority';
  else
    raise exception 'FAIL 6 (B): the blocking club resolved to % rather than the club the actor manages', v_resolved;
  end if;
  reset role;

  select internal.is_message_blocked(v_poster, v_clubA) into v_blocked;
  if v_blocked then
    raise notice 'PASS 7 (B): the block is recorded against club A';
  else
    raise exception 'FAIL 7 (B): the block was not recorded';
  end if;

  select internal.is_message_blocked(v_poster, v_clubB) into v_blocked;
  if not v_blocked then
    raise notice 'PASS 8 (B): club B has NOT blocked them -- one club''s judgement is not a platform-wide silencing';
  else
    raise exception 'FAIL 8 (B): one club''s block leaked to another club';
  end if;

  -- =================================================================
  -- C. A block actually stops the posting, not just the button
  -- =================================================================
  begin
    insert into public.fixture_messages (fixture_id, sender_user_id, body)
    values (v_fixtureA, v_poster, 'Trying again anyway.');
    raise exception 'FAIL 9 (C): a blocked person posted into the fixture thread';
  exception when sqlstate '42501' then
    raise notice 'PASS 9 (C): the block is enforced on INSERT, so it holds however the row is written -- not just where a button was hidden';
  end;

  -- The fixture at the OTHER club is unaffected: they were not blocked there.
  insert into public.fixture_messages (fixture_id, sender_user_id, body)
  values (v_fixtureB, v_poster, 'A message at a club that has not blocked me.');
  raise notice 'PASS 10 (C): the same person still posts freely at a club that has not blocked them';

  -- =================================================================
  -- D. A block never closes the safeguarding route
  -- =================================================================
  -- The exemption is on safeguarding_conversation_id, which is exactly the
  -- path a concern is raised through. Somebody a club has fallen out with must
  -- still be able to report something to that club's safeguarding officer.
  select count(*) into v_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'internal' and p.proname = 'enforce_message_block'
    and p.prosrc like '%safeguarding_conversation_id is null%';
  if v_count = 1 then
    raise notice 'PASS 11 (D): the block deliberately does not apply to safeguarding conversations';
  else
    raise exception 'FAIL 11 (D): the safeguarding exemption is gone -- a block could now silence a concern';
  end if;

  -- =================================================================
  -- E. Lifting a block
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text, 'role','authenticated')::text, true);
  perform public.lift_club_message_block(v_clubA, v_poster);
  reset role;

  select internal.is_message_blocked(v_poster, v_clubA) into v_blocked;
  if not v_blocked then
    raise notice 'PASS 12 (E): the block was lifted';
  else
    raise exception 'FAIL 12 (E): the block survived being lifted';
  end if;

  select count(*) into v_count from public.club_message_blocks where club_id = v_clubA and blocked_user_id = v_poster and lifted_at is not null;
  if v_count = 1 then
    raise notice 'PASS 13 (E): the lifted block stays as history -- a club can see somebody was blocked before, and by whom';
  else
    raise exception 'FAIL 13 (E): lifting a block erased the record of it';
  end if;

  insert into public.fixture_messages (fixture_id, sender_user_id, body)
  values (v_fixtureA, v_poster, 'Back in the conversation.');
  raise notice 'PASS 14 (E): posting works again once the block is lifted';

  -- =================================================================
  -- F. The block list is not readable by the people on it
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_poster::text, 'role','authenticated')::text, true);
  select count(*) into v_count from public.club_message_blocks;
  if v_count = 0 then
    raise notice 'PASS 15 (F): a blocked person cannot read the block list';
  else
    raise exception 'FAIL 15 (F): a blocked person read % row(s) of the block list', v_count;
  end if;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text, 'role','authenticated')::text, true);
  select count(*) into v_count from public.club_message_blocks where club_id = v_clubA;
  if v_count >= 1 then
    raise notice 'PASS 16 (F): club staff can read their own club''s blocks';
  else
    raise exception 'FAIL 16 (F): club staff could not read their own block list';
  end if;
  reset role;

  raise notice 'Fixture message moderation invariants complete.';
end $$;

rollback;
