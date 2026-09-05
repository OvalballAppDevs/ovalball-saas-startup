-- Manual verification for Phase D (message request half) -- club-to-club
-- direct conversations (20260903600000). NOT a migration -- run AFTER
-- permission_matrix.sql AND partner_clubs_and_messaging.sql (reuses
-- Burnley/Rossendale's real active partnership, established by that
-- file, for the partner-bypass scenario).
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/partner_clubs_and_messaging.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/club_conversations.sql

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  -- Six fresh standalone clubs: Home/Away (ordinary case), Home2/Away2
  -- (decline+cooldown), Deactivated (unactivated-club case), plus four
  -- more (Spam1-4) purely to fill the rate-limit cap in test 13.
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  select
    ('99a00000-0000-0000-0000-0000000d' || lpad(n::text, 4, '0'))::uuid,
    'Club Conv Test Club ' || n,
    'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'club-conv-test-club-' || n || '-99a00000'
  from generate_series(1, 9) n
  on conflict (id) do nothing;

  insert into public.clubs (id, directory_id, slug, status)
  select
    ('99a00000-0000-0000-0000-0000000c' || lpad(n::text, 4, '0'))::uuid,
    ('99a00000-0000-0000-0000-0000000d' || lpad(n::text, 4, '0'))::uuid,
    'club-conv-test-club-' || n || '-99a00000', 'active'
  from generate_series(1, 9) n
  on conflict (id) do nothing;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  select
    ('99a00000-0000-0000-0000-000000010' || lpad(n::text, 3, '0'))::uuid,
    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'test.clubconv' || n || '@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''
  from generate_series(1, 9) n
  on conflict (id) do nothing;
  insert into public.profiles (id, first_name, surname, email)
  select
    ('99a00000-0000-0000-0000-000000010' || lpad(n::text, 3, '0'))::uuid,
    'Test', 'ClubConv' || n, 'test.clubconv' || n || '@ovalball.local'
  from generate_series(1, 9) n
  on conflict (id) do nothing;
  insert into public.club_memberships (id, club_id, user_id, role, status)
  select
    ('99a00000-0000-0000-0000-000000020' || lpad(n::text, 3, '0'))::uuid,
    ('99a00000-0000-0000-0000-0000000c' || lpad(n::text, 4, '0'))::uuid,
    ('99a00000-0000-0000-0000-000000010' || lpad(n::text, 3, '0'))::uuid,
    'CLUB_ADMIN', 'active'
  from generate_series(1, 9) n
  on conflict (id) do nothing;
end $$;

-- Club 9 is deactivated for the "unactivated club" scenario.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  perform public.deactivate_club('99a00000-0000-0000-0000-0000000c0009', 'test: deactivated for unactivated-club messaging check');
end $$;
commit;

-- ------------------------------------------------------------
-- 1/2/3. Ordinary request: Club 1 (Home) messages Club 2 (Away, a
-- non-partner). Exactly one pending conversation, first message
-- preserved exactly once, recipient notified.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99a00000-0000-0000-0000-000000010001","role":"authenticated"}';
do $$
declare
  v_conversation_id uuid;
  v_status text;
  v_is_new boolean;
  v_message_count integer;
  v_body text;
begin
  select conversation_id, status, is_new into v_conversation_id, v_status, v_is_new
  from public.start_or_get_club_conversation('99a00000-0000-0000-0000-0000000c0001', '99a00000-0000-0000-0000-0000000c0002', 'Would you like to arrange a pre-season fixture?');

  if v_status = 'pending' and v_is_new then
    raise notice 'PASS 1: a non-partner club conversation starts as a pending Message Request, never auto-accepted';
  else
    raise notice 'FAIL 1: status=%, is_new=%', v_status, v_is_new;
  end if;

  select count(*), max(body) into v_message_count, v_body from public.fixture_messages where club_conversation_id = v_conversation_id;
  if v_message_count = 1 and v_body = 'Would you like to arrange a pre-season fixture?' then
    raise notice 'PASS 2: the original first message is preserved exactly once, unmodified';
  else
    raise notice 'FAIL 2: message_count=%, body=%', v_message_count, v_body;
  end if;
end $$;
commit;

do $$
begin
  if exists (select 1 from public.notifications where user_id = '99a00000-0000-0000-0000-000000010002' and type = 'club_message_request_received') then
    raise notice 'PASS 3: the recipient club''s admin is notified of the new message request';
  else
    raise notice 'FAIL 3: no club_message_request_received notification found';
  end if;
end $$;

-- ------------------------------------------------------------
-- 4/5. Visibility: the recipient (Away) can see the pending request; an
-- unrelated club (Club 3) cannot.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99a00000-0000-0000-0000-000000010002","role":"authenticated"}';
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.club_conversations
  where requesting_club_id = '99a00000-0000-0000-0000-0000000c0001' and recipient_club_id = '99a00000-0000-0000-0000-0000000c0002';
  if v_count = 1 then
    raise notice 'PASS 4: the invited (recipient) club can see the pending request';
  else
    raise notice 'FAIL 4: recipient saw % rows', v_count;
  end if;
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99a00000-0000-0000-0000-000000010003","role":"authenticated"}';
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.club_conversations
  where requesting_club_id = '99a00000-0000-0000-0000-0000000c0001' and recipient_club_id = '99a00000-0000-0000-0000-0000000c0002';
  if v_count = 0 then
    raise notice 'PASS 5: an unrelated club cannot see the pending request at all (RLS)';
  else
    raise notice 'FAIL 5: unrelated club saw % rows', v_count;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 6. Unauthorized responder: Club 1's OWN admin (the requester, not the
-- recipient) cannot accept/decline their own outgoing request.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99a00000-0000-0000-0000-000000010001","role":"authenticated"}';
do $$
declare
  v_conversation_id uuid;
begin
  select id into v_conversation_id from public.club_conversations
  where requesting_club_id = '99a00000-0000-0000-0000-0000000c0001' and recipient_club_id = '99a00000-0000-0000-0000-0000000c0002';
  begin
    perform public.respond_to_club_conversation(v_conversation_id, true);
    raise notice 'FAIL 6: the requesting club unexpectedly authorized to respond to its own request';
  exception when others then
    raise notice 'PASS 6: only the invited (recipient) club may respond -- the requester cannot self-approve';
  end;
end $$;
commit;

-- ------------------------------------------------------------
-- 7/8/9. Accept: system event written into the SAME conversation, exactly
-- once, visible to both sides; original message still present; a second
-- accept call is refused (idempotency).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99a00000-0000-0000-0000-000000010002","role":"authenticated"}';
do $$
declare
  v_conversation_id uuid;
  v_status text;
begin
  select id into v_conversation_id from public.club_conversations
  where requesting_club_id = '99a00000-0000-0000-0000-0000000c0001' and recipient_club_id = '99a00000-0000-0000-0000-0000000c0002';
  perform public.respond_to_club_conversation(v_conversation_id, true);
  select status into v_status from public.club_conversations where id = v_conversation_id;
  if v_status = 'accepted' then
    raise notice 'PASS 7: accepting moves the conversation to accepted';
  else
    raise notice 'FAIL 7: status=%', v_status;
  end if;
end $$;
commit;

do $$
declare
  v_conversation_id uuid;
  v_total_messages integer;
  v_first_message_count integer;
  v_system_event_count integer;
  v_system_event_body text;
begin
  select id into v_conversation_id from public.club_conversations
  where requesting_club_id = '99a00000-0000-0000-0000-0000000c0001' and recipient_club_id = '99a00000-0000-0000-0000-0000000c0002';
  select count(*) into v_total_messages from public.fixture_messages where club_conversation_id = v_conversation_id;
  select count(*) into v_first_message_count from public.fixture_messages where club_conversation_id = v_conversation_id and body = 'Would you like to arrange a pre-season fixture?';
  select count(*), max(body) into v_system_event_count, v_system_event_body from public.fixture_messages where club_conversation_id = v_conversation_id and kind = 'system_event';

  if v_total_messages = 2 and v_first_message_count = 1 then
    raise notice 'PASS 8: the original first message remains exactly once, alongside exactly one new system event -- never duplicated, never a disconnected second conversation';
  else
    raise notice 'FAIL 8: total_messages=%, first_message_count=%', v_total_messages, v_first_message_count;
  end if;

  if v_system_event_count = 1 and v_system_event_body = 'Message request accepted by Club Conv Test Club 2' then
    raise notice 'PASS 9: the accepted system event reads "Message request accepted by <Club>" and is inserted exactly once';
  else
    raise notice 'FAIL 9: system_event_count=%, body=%', v_system_event_count, v_system_event_body;
  end if;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99a00000-0000-0000-0000-000000010002","role":"authenticated"}';
do $$
declare
  v_conversation_id uuid;
begin
  select id into v_conversation_id from public.club_conversations
  where requesting_club_id = '99a00000-0000-0000-0000-0000000c0001' and recipient_club_id = '99a00000-0000-0000-0000-0000000c0002';
  begin
    perform public.respond_to_club_conversation(v_conversation_id, true);
    raise notice 'FAIL 10: re-accepting an already-accepted conversation unexpectedly succeeded';
  exception when others then
    raise notice 'PASS 10: an already-answered request cannot be answered again -- no duplicate system event possible';
  end;
end $$;
commit;

-- ------------------------------------------------------------
-- 11. Reusable: a further + New Message attempt between the same two
-- clubs returns the SAME accepted conversation, never a new one.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99a00000-0000-0000-0000-000000010001","role":"authenticated"}';
do $$
declare
  v_conversation_id uuid;
  v_status text;
  v_is_new boolean;
  v_original_id uuid;
begin
  select id into v_original_id from public.club_conversations
  where requesting_club_id = '99a00000-0000-0000-0000-0000000c0001' and recipient_club_id = '99a00000-0000-0000-0000-0000000c0002';

  select conversation_id, status, is_new into v_conversation_id, v_status, v_is_new
  from public.start_or_get_club_conversation('99a00000-0000-0000-0000-0000000c0001', '99a00000-0000-0000-0000-0000000c0002', 'ignored -- an accepted conversation already exists');

  if v_conversation_id = v_original_id and v_status = 'accepted' and not v_is_new then
    raise notice 'PASS 11: a further + New Message attempt reuses the SAME accepted conversation, never creates a duplicate';
  else
    raise notice 'FAIL 11: conversation_id=% (expected %), status=%, is_new=%', v_conversation_id, v_original_id, v_status, v_is_new;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 12. Opposite-direction dedup: while Club 4 -> Club 5's request is still
-- pending, Club 5 attempting to message Club 4 surfaces the SAME pending
-- request rather than crossing a duplicate.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99a00000-0000-0000-0000-000000010004","role":"authenticated"}';
do $$
begin
  perform public.start_or_get_club_conversation('99a00000-0000-0000-0000-0000000c0004', '99a00000-0000-0000-0000-0000000c0005', 'Hello from Club 4');
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99a00000-0000-0000-0000-000000010005","role":"authenticated"}';
do $$
declare
  v_conversation_id uuid;
  v_status text;
  v_is_new boolean;
  v_row_count integer;
begin
  select conversation_id, status, is_new into v_conversation_id, v_status, v_is_new
  from public.start_or_get_club_conversation('99a00000-0000-0000-0000-0000000c0005', '99a00000-0000-0000-0000-0000000c0004', 'Hello back from Club 5');

  select count(*) into v_row_count from public.club_conversations
  where least(requesting_club_id, recipient_club_id) = least('99a00000-0000-0000-0000-0000000c0004'::uuid, '99a00000-0000-0000-0000-0000000c0005'::uuid)
    and greatest(requesting_club_id, recipient_club_id) = greatest('99a00000-0000-0000-0000-0000000c0004'::uuid, '99a00000-0000-0000-0000-0000000c0005'::uuid);

  if v_status = 'pending' and not v_is_new and v_row_count = 1 then
    raise notice 'PASS 12: an opposite-direction attempt while a request is already pending surfaces the SAME pending request rather than creating a crossing duplicate';
  else
    raise notice 'FAIL 12: status=%, is_new=%, row_count=%', v_status, v_is_new, v_row_count;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 13. Decline: no accepted conversation results, requester is notified
-- with a restrained message (no individual person named), and no system
-- event is written since the conversation was never accepted.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99a00000-0000-0000-0000-000000010006","role":"authenticated"}';
do $$
begin
  perform public.start_or_get_club_conversation('99a00000-0000-0000-0000-0000000c0006', '99a00000-0000-0000-0000-0000000c0007', 'Can we discuss a shared training session?');
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99a00000-0000-0000-0000-000000010007","role":"authenticated"}';
do $$
declare
  v_conversation_id uuid;
  v_status text;
  v_system_event_count integer;
begin
  select id into v_conversation_id from public.club_conversations
  where requesting_club_id = '99a00000-0000-0000-0000-0000000c0006' and recipient_club_id = '99a00000-0000-0000-0000-0000000c0007';
  perform public.respond_to_club_conversation(v_conversation_id, false);
  select status into v_status from public.club_conversations where id = v_conversation_id;
  select count(*) into v_system_event_count from public.fixture_messages where club_conversation_id = v_conversation_id and kind = 'system_event';

  if v_status = 'declined' and v_system_event_count = 0 then
    raise notice 'PASS 13: declining leaves the conversation declined (never accepted) and writes no accepted-system-event';
  else
    raise notice 'FAIL 13: status=%, system_event_count=%', v_status, v_system_event_count;
  end if;
end $$;
commit;

do $$
declare
  v_body text;
begin
  select body into v_body from public.notifications
  where user_id = '99a00000-0000-0000-0000-000000010006' and type = 'club_message_request_declined' order by created_at desc limit 1;
  if v_body = 'Your message request to Club Conv Test Club 7 was declined.' then
    raise notice 'PASS 14: the requester receives a restrained decline notification naming only the club, never the individual who declined';
  else
    raise notice 'FAIL 14: body=%', v_body;
  end if;
end $$;

-- ------------------------------------------------------------
-- 14. Cooldown: an immediate retry after the decline above is blocked.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99a00000-0000-0000-0000-000000010006","role":"authenticated"}';
do $$
begin
  begin
    perform public.start_or_get_club_conversation('99a00000-0000-0000-0000-0000000c0006', '99a00000-0000-0000-0000-0000000c0007', 'Trying again immediately');
    raise notice 'FAIL 15: an immediate retry after a decline unexpectedly succeeded -- no cooldown enforced';
  exception when others then
    raise notice 'PASS 15: an immediate retry after a decline is blocked by the cooldown -- no immediate spam';
  end;
end $$;
commit;

-- ------------------------------------------------------------
-- 15. Existing active partners bypass the request stage entirely.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_status text;
  v_is_new boolean;
  v_conversation_id uuid;
  v_notif_count integer;
begin
  select conversation_id, status, is_new into v_conversation_id, v_status, v_is_new
  from public.start_or_get_club_conversation('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'Fancy a chat about next season?');

  if v_status = 'accepted' then
    raise notice 'PASS 16: two clubs with an existing ACTIVE partnership skip the request stage entirely -- the conversation opens accepted immediately';
  else
    raise notice 'FAIL 16: status=% (Burnley/Rossendale must already be active partners by this point in the ordered suite)', v_status;
  end if;

  select count(*) into v_notif_count from public.notifications
  where user_id = '00000000-0000-0000-0000-000000000003' and type = 'club_message_request_received' and data->>'club_conversation_id' = v_conversation_id::text;
  if v_notif_count = 0 then
    raise notice 'PASS 17: no Message Request notification is sent for a partner-bypass conversation -- there was never a request to notify about';
  else
    raise notice 'FAIL 17: unexpected club_message_request_received notification for a partner-bypass conversation';
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 16. Unactivated club: messaging a deactivated club is refused, and
-- creates no row at all (never a fake request/delivery).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99a00000-0000-0000-0000-000000010001","role":"authenticated"}';
do $$
declare
  v_count_before integer;
  v_count_after integer;
begin
  select count(*) into v_count_before from public.club_conversations;
  begin
    perform public.start_or_get_club_conversation('99a00000-0000-0000-0000-0000000c0001', '99a00000-0000-0000-0000-0000000c0009', 'Hello?');
    raise notice 'FAIL 18: messaging a deactivated club unexpectedly succeeded';
  exception when others then
    select count(*) into v_count_after from public.club_conversations;
    if v_count_after = v_count_before then
      raise notice 'PASS 18: messaging a deactivated club is refused and creates no row at all -- never a fake request or delivery';
    else
      raise notice 'FAIL 18: refused, but a row was still created (count % -> %)', v_count_before, v_count_after;
    end if;
  end;
end $$;
commit;

-- ------------------------------------------------------------
-- 17. Rate limit: a club may not have more than 5 pending outgoing
-- requests open at once.
-- ------------------------------------------------------------
-- Target clubs are canonical reference data (Site-Admin-write-scoped) --
-- created as postgres, same as every other test club in this file, never
-- inside the authenticated Club Admin transaction below.
do $$
declare
  v_i integer;
begin
  for v_i in 1..6 loop
    insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
    values (('99a00000-0000-0000-0000-d' || lpad(v_i::text, 11, '0'))::uuid, 'Club Conv Rate Target ' || v_i, 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'club-conv-rate-target-' || v_i || '-99a00000')
    on conflict (id) do nothing;
    insert into public.clubs (id, directory_id, slug, status)
    values (('99a00000-0000-0000-0000-c' || lpad(v_i::text, 11, '0'))::uuid, ('99a00000-0000-0000-0000-d' || lpad(v_i::text, 11, '0'))::uuid, 'club-conv-rate-target-' || v_i || '-99a00000', 'active')
    on conflict (id) do nothing;
  end loop;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99a00000-0000-0000-0000-000000010008","role":"authenticated"}';
do $$
declare
  v_i integer;
  v_blocked boolean := false;
begin
  -- Club 8 already has zero pending outgoing requests; five distinct
  -- targets are needed (the unordered-pair uniqueness would otherwise
  -- collapse repeats against the same target into one row).
  for v_i in 1..5 loop
    perform public.start_or_get_club_conversation('99a00000-0000-0000-0000-0000000c0008', ('99a00000-0000-0000-0000-c' || lpad(v_i::text, 11, '0'))::uuid, 'Rate limit test message ' || v_i);
  end loop;

  begin
    perform public.start_or_get_club_conversation('99a00000-0000-0000-0000-0000000c0008', '99a00000-0000-0000-0000-c00000000006', 'Sixth pending request should be blocked');
  exception when others then
    v_blocked := true;
  end;

  if v_blocked then
    raise notice 'PASS 19: a sixth simultaneous pending outgoing request is blocked -- a simple anti-spam cap, server-side';
  else
    raise notice 'FAIL 19: a sixth pending outgoing request was unexpectedly allowed';
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 18. Fixture messaging is unaffected by this whole migration -- a plain
-- fixture message still inserts normally (the widened 3-way check
-- constraint and RLS policy both still accept it).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  insert into public.fixture_messages (fixture_id, sender_user_id, body)
  values ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'Sanity check: fixture messaging still works after the club_conversation_id widening.');
  raise notice 'PASS 20: an ordinary fixture message still inserts normally -- fixture conversations are unaffected by this migration';
exception when others then
  raise notice 'FAIL 20: ordinary fixture message insert unexpectedly failed: %', sqlerrm;
end $$;
commit;
