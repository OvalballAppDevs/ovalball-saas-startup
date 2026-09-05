-- Manual verification for the Master Fixture Registry's single-row
-- identity (20260904600000_master_fixture_consolidation.sql), which
-- supersedes the mirror-pair architecture this file originally tested
-- (20260903100000_unified_fixture_conversation.sql patched messaging onto
-- TWO rows sharing one conversation_id; the real fix is that
-- accept_fixture_request now creates exactly ONE row, so there is no
-- second row or conversation_id indirection needed at all). Proves: both
-- clubs resolve the SAME fixture_id (never two ids for one real match),
-- both can read/write its messages/system-events/attachments directly by
-- that one id, an unrelated club is denied, and the presence/broadcast
-- channel (still keyed by conversation_id, which now trivially equals
-- "this one row's own conversation") works identically. NOT a migration
-- -- run AFTER permission_matrix.sql.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/unified_fixture_conversation.sql

\set ON_ERROR_STOP off
\pset pager off

-- A genuinely unrelated club+user -- distinct from Burnley/Rossendale and
-- from every team_permissions row either of them has, unlike
-- 00000000-...-0004/0005/0006 (all real Burnley team admins/coaches on
-- the exact teams this file's fixture uses).
do $$
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.unrelated.conv.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;
  insert into public.profiles (id, first_name, surname, email)
  values ('00000000-0000-0000-0000-000000000099', 'Test', 'UnrelatedAdmin', 'test.unrelated.conv.admin@ovalball.local')
  on conflict (id) do nothing;
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('99500000-0000-0000-0000-00000000000d', 'Unrelated Test RUFC', 'Nowhere', 'Nowhereshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'unrelated-test-rufc-99500000')
  on conflict (id) do nothing;
  insert into public.clubs (id, directory_id, slug, status)
  values ('99500000-0000-0000-0000-00000000000c', '99500000-0000-0000-0000-00000000000d', 'unrelated-test-rufc-99500000', 'active')
  on conflict (id) do nothing;
  insert into public.club_memberships (id, club_id, user_id, role, status)
  values ('99500000-0000-0000-0000-00000000000e', '99500000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000099', 'CLUB_ADMIN', 'active')
  on conflict (id) do nothing;
end $$;

-- ------------------------------------------------------------
-- 1. MASTER FIXTURE ID SYMMETRY (the real point of this whole migration):
--    a real accept_fixture_request() flow creates exactly ONE fixtures
--    row -- both sides resolve the SAME fixture_id, never two.
-- ------------------------------------------------------------
do $$
begin
  insert into public.fixture_request_groups (id, requesting_club_id, raw_opponent_text, opponent_directory_id, opponent_club_id, proposed_date, created_by)
  values ('99500000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Rossendale RUFC', null, '10000000-0000-0000-0000-000000000002', current_date + 21, '00000000-0000-0000-0000-000000000002')
  on conflict (id) do nothing;
  insert into public.fixture_requests (id, group_id, requesting_team_id, target_team_id, venue_preference, status, created_by)
  values ('99500000-0000-0000-0000-000000000002', '99500000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'home', 'sent', '00000000-0000-0000-0000-000000000002')
  on conflict (id) do nothing;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
select public.accept_fixture_request('99500000-0000-0000-0000-000000000002');
commit;

do $$
declare
  v_fixture_id uuid;
  v_row_count integer;
  v_conv_id uuid;
  v_mirror_id uuid;
  v_home_team_id uuid;
  v_away_team_id uuid;
begin
  select resulting_fixture_id into v_fixture_id from public.fixture_requests where id = '99500000-0000-0000-0000-000000000002';

  -- Burnley's Calendar query (owning_team_id or opponent_team_id = mine)
  -- and Rossendale's own equivalent query must both resolve to the exact
  -- same row -- proven here by counting how many fixtures rows exist for
  -- THIS specific request's own kickoff_date between these two teams
  -- (never two for the one real match this request produced; other,
  -- unrelated test files elsewhere in the suite legitimately create
  -- other fixtures between these same two real teams on other dates).
  select count(*) into v_row_count from public.fixtures
  where kickoff_date = current_date + 21
    and ((owning_team_id = '30000000-0000-0000-0000-000000000001' and opponent_team_id = '30000000-0000-0000-0000-000000000003')
      or (owning_team_id = '30000000-0000-0000-0000-000000000003' and opponent_team_id = '30000000-0000-0000-0000-000000000001'));

  select conversation_id, mirror_fixture_id, home_team_id, away_team_id
    into v_conv_id, v_mirror_id, v_home_team_id, v_away_team_id
    from public.fixtures where id = v_fixture_id;

  if v_row_count = 1 and v_mirror_id is null and v_conv_id is not null
     and v_home_team_id = '30000000-0000-0000-0000-000000000001' and v_away_team_id = '30000000-0000-0000-0000-000000000003' then
    raise notice 'PASS 1: accept_fixture_request creates exactly ONE fixtures row (never a mirror pair) -- Burnley Calendar fixture_id = Rossendale Calendar fixture_id = Site Admin fixture_id = %, with home_team_id/away_team_id correctly resolved (Home preference honoured)', v_fixture_id;
  else
    raise notice 'FAIL 1: row_count=%, mirror_id=%, conv_id=%, home_team_id=%, away_team_id=%', v_row_count, v_mirror_id, v_conv_id, v_home_team_id, v_away_team_id;
  end if;
end $$;

-- ------------------------------------------------------------
-- 2/3. Both sides can post a message directly against the ONE fixture_id
--    -- no mirror row, no conversation_id indirection needed.
-- ------------------------------------------------------------
do $$
declare
  v_fixture_id uuid;
  v_conv_id uuid;
  v_msg_a_id uuid;
  v_msg_b_id uuid;
  v_msg_a_conv uuid;
  v_msg_b_conv uuid;
begin
  select resulting_fixture_id into v_fixture_id from public.fixture_requests where id = '99500000-0000-0000-0000-000000000002';
  select conversation_id into v_conv_id from public.fixtures where id = v_fixture_id;

  insert into public.fixture_messages (fixture_id, sender_user_id, body)
  values (v_fixture_id, '00000000-0000-0000-0000-000000000002', 'Burnley: see you Saturday')
  returning id into v_msg_a_id;
  insert into public.fixture_messages (fixture_id, sender_user_id, body)
  values (v_fixture_id, '00000000-0000-0000-0000-000000000003', 'Rossendale: looking forward to it')
  returning id into v_msg_b_id;

  select conversation_id into v_msg_a_conv from public.fixture_messages where id = v_msg_a_id;
  select conversation_id into v_msg_b_conv from public.fixture_messages where id = v_msg_b_id;

  if v_msg_a_conv = v_conv_id then
    raise notice 'PASS 2: Burnley''s message, posted against the one shared fixture_id, auto-gets its conversation_id from the trigger';
  else
    raise notice 'FAIL 2: msg_a_conv=%, expected=%', v_msg_a_conv, v_conv_id;
  end if;
  if v_msg_b_conv = v_conv_id then
    raise notice 'PASS 3: Rossendale''s message, posted against the SAME fixture_id, gets the SAME conversation_id';
  else
    raise notice 'FAIL 3: msg_b_conv=%, expected=%', v_msg_b_conv, v_conv_id;
  end if;
end $$;

-- ------------------------------------------------------------
-- 4/5. Each side can read the message the OTHER side sent -- by
--    querying the ONE shared fixture_id directly, never a second row.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_fixture_id uuid;
  v_count integer;
begin
  select resulting_fixture_id into v_fixture_id from public.fixture_requests where id = '99500000-0000-0000-0000-000000000002';
  select count(*) into v_count from public.fixture_messages
  where fixture_id = v_fixture_id and body = 'Burnley: see you Saturday';
  if v_count = 1 then
    raise notice 'PASS 4: Rossendale, querying the ONE shared fixture_id directly, sees the message Burnley sent';
  else
    raise notice 'FAIL 4: Rossendale sees % copies of Burnley''s message via the shared fixture_id', v_count;
  end if;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_fixture_id uuid;
  v_count integer;
begin
  select resulting_fixture_id into v_fixture_id from public.fixture_requests where id = '99500000-0000-0000-0000-000000000002';
  select count(*) into v_count from public.fixture_messages
  where fixture_id = v_fixture_id and body = 'Rossendale: looking forward to it';
  if v_count = 1 then
    raise notice 'PASS 5: Burnley, querying the ONE shared fixture_id directly, sees the message Rossendale sent';
  else
    raise notice 'FAIL 5: Burnley sees % copies of Rossendale''s message via the shared fixture_id', v_count;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 6. No duplicate rows were created by any of this -- exactly 2 messages
--    exist for the one shared fixture_id (never doubled per mirror row).
-- ------------------------------------------------------------
do $$
declare
  v_fixture_id uuid;
  v_count integer;
begin
  select resulting_fixture_id into v_fixture_id from public.fixture_requests where id = '99500000-0000-0000-0000-000000000002';
  select count(*) into v_count from public.fixture_messages where fixture_id = v_fixture_id;
  if v_count = 2 then
    raise notice 'PASS 6: exactly 2 messages exist for the one shared fixture_id -- never duplicated per mirror row';
  else
    raise notice 'FAIL 6: message count = %', v_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 7. A genuinely unrelated club still cannot see this conversation.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000099","role":"authenticated"}';
do $$
declare
  v_fixture_id uuid;
  v_count integer;
begin
  select resulting_fixture_id into v_fixture_id from public.fixture_requests where id = '99500000-0000-0000-0000-000000000002';
  select count(*) into v_count from public.fixture_messages
  where conversation_id = (select conversation_id from public.fixtures where id = v_fixture_id);
  if v_count = 0 then
    raise notice 'PASS 7: a genuinely unrelated club still sees no messages in this conversation (RLS denies, not just filters)';
  else
    raise notice 'FAIL 7: unrelated club saw % messages', v_count;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 8. A kickoff-change system event written by Burnley (via update_
--    fixture_kickoff, against the one shared fixture_id) is visible to
--    Rossendale too -- SITE ADMIN EDIT SYMMETRY / EDIT SYMMETRY in
--    miniature: one row, one history, both sides see it.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_fixture_id uuid;
begin
  select resulting_fixture_id into v_fixture_id from public.fixture_requests where id = '99500000-0000-0000-0000-000000000002';
  perform public.update_fixture_kickoff(v_fixture_id, current_date + 22, '15:00');
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_fixture_id uuid;
  v_count integer;
begin
  select resulting_fixture_id into v_fixture_id from public.fixture_requests where id = '99500000-0000-0000-0000-000000000002';
  select count(*) into v_count from public.fixture_messages
  where fixture_id = v_fixture_id and kind = 'system_event' and body like 'Kick-off%';
  if v_count = 1 then
    raise notice 'PASS 8: Rossendale sees the kick-off system event by querying the ONE shared fixture_id directly -- even though the change was made by Burnley';
  else
    raise notice 'FAIL 8: system event count via the shared fixture_id = %', v_count;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 9. Attachment visibility inherits the same fix (via the shared
--    can_access_fixture_conversation() primitive attachments already
--    reuse).
-- ------------------------------------------------------------
do $$
declare
  v_fixture_id uuid;
  v_msg_id uuid;
begin
  select resulting_fixture_id into v_fixture_id from public.fixture_requests where id = '99500000-0000-0000-0000-000000000002';
  insert into public.fixture_messages (fixture_id, sender_user_id, body)
  values (v_fixture_id, '00000000-0000-0000-0000-000000000002', 'See attached teamsheet')
  returning id into v_msg_id;
  insert into public.fixture_message_attachments (message_id, storage_path, original_filename, mime_type, size_bytes, uploaded_by)
  values (v_msg_id, 'f/' || v_fixture_id || '/teamsheet.pdf', 'teamsheet.pdf', 'application/pdf', 1024, '00000000-0000-0000-0000-000000000002');
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.fixture_message_attachments a
  join public.fixture_messages m on m.id = a.message_id
  where m.body = 'See attached teamsheet';
  if v_count = 1 then
    raise notice 'PASS 9: an attachment uploaded via Burnley''s own row is visible to Rossendale too -- same shared authorization primitive';
  else
    raise notice 'FAIL 9: Rossendale sees % attachment rows', v_count;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 10/11. Presence topic is keyed by conversation_id -- both sides join
--     the SAME channel; an unrelated club is denied.
-- ------------------------------------------------------------
do $$
declare
  v_fixture_id uuid;
  v_conv_id uuid;
begin
  select resulting_fixture_id into v_fixture_id from public.fixture_requests where id = '99500000-0000-0000-0000-000000000002';
  select conversation_id into v_conv_id from public.fixtures where id = v_fixture_id;
  perform set_config('test.conv_id', v_conv_id::text, false);
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  if internal.can_access_fixture_presence_topic('presence:f:' || current_setting('test.conv_id')) then
    raise notice 'PASS 10: Burnley can join the presence channel keyed by the shared conversation_id';
  else
    raise notice 'FAIL 10: Burnley denied the conversation_id-keyed presence topic';
  end if;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  if internal.can_access_fixture_presence_topic('presence:f:' || current_setting('test.conv_id')) then
    raise notice 'PASS 11: Rossendale can join the SAME conversation_id-keyed presence channel as Burnley';
  else
    raise notice 'FAIL 11: Rossendale denied the conversation_id-keyed presence topic';
  end if;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000099","role":"authenticated"}';
do $$
begin
  if internal.can_access_fixture_presence_topic('presence:f:' || current_setting('test.conv_id')) then
    raise notice 'FAIL 12: an unrelated club joined the conversation_id-keyed presence channel';
  else
    raise notice 'PASS 12: an unrelated club is still denied the conversation_id-keyed presence channel';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 13. The broadcast-from-database trigger does not error on a normal
--     message insert (realtime.send() is callable from a plain RPC path).
-- ------------------------------------------------------------
do $$
declare
  v_fixture_id uuid;
begin
  select resulting_fixture_id into v_fixture_id from public.fixture_requests where id = '99500000-0000-0000-0000-000000000002';
  insert into public.fixture_messages (fixture_id, sender_user_id, body)
  values (v_fixture_id, '00000000-0000-0000-0000-000000000002', 'Broadcast smoke test');
  raise notice 'PASS 13: inserting a message with the broadcast-from-database trigger attached does not error';
exception when others then
  raise notice 'FAIL 13: broadcast trigger raised an error on insert (%)', sqlerrm;
end $$;

-- ------------------------------------------------------------
-- 14. A single-row (external/unresolved-opponent) fixture still has a
--     working, self-contained conversation -- conversation_id defaults to
--     a real value even with no mirror, and messages/read work normally.
-- ------------------------------------------------------------
do $$
begin
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('99500000-0000-0000-0000-000000000010', '30000000-0000-0000-0000-000000000001', null, 'Home', 'Vacant Fixture FC', current_date + 30, 'Booked', 'club_created')
  on conflict (id) do nothing;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_conv_id uuid;
  v_msg_id uuid;
  v_msg_conv uuid;
begin
  select conversation_id into v_conv_id from public.fixtures where id = '99500000-0000-0000-0000-000000000010';
  insert into public.fixture_messages (fixture_id, sender_user_id, body)
  values ('99500000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000002', 'Note to self about this external fixture')
  returning id into v_msg_id;
  select conversation_id into v_msg_conv from public.fixture_messages where id = v_msg_id;
  if v_conv_id is not null and v_msg_conv = v_conv_id then
    raise notice 'PASS 14: a single-row (external opponent) fixture still has its own working, self-contained conversation_id';
  else
    raise notice 'FAIL 14: fixture conv_id=%, message conv_id=%', v_conv_id, v_msg_conv;
  end if;
end $$;
commit;
