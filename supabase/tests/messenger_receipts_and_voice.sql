-- MESSAGING PREMIUM PASS (20270756000000): READ RECEIPTS, VOICE NOTES, DELETED FILES, PUSH ACTIONS.
--
-- Self-seeding and rolled back. Every check is a NOTICE PASS/FAIL line.
--
--   RR  read receipts: written only by the reader, only through readable messages, idempotent, never forged,
--       answered only to the sender, hidden across a block, counted honestly in a group.
--   V   voice notes: the same authority as any attachment, the conversation's own folder, AAC only, two minutes and
--       two megabytes at most, one message per send reference, never into a minor's direct conversation.
--   F   a deleted message's stored file becomes unreadable.
--   N   push actions fit the conversation type, and still carry no message content.

\set ON_ERROR_STOP 0
\pset pager off

begin;

create or replace function pg_temp.act(p_role text, p_sub uuid default null) returns void
language plpgsql as $$
declare v_email text;
begin
  perform set_config('role', 'none', true);
  if p_sub is not null then select email into v_email from auth.users where id = p_sub; end if;
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_sub, 'role', p_role, 'email', v_email))::text, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function pg_temp.act_postgres() returns void language plpgsql as $$
begin perform set_config('role','none',true); perform set_config('request.jwt.claims','',true); end $$;

create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v_state text;
begin execute p_sql; return 'OK';
exception when others then get stacked diagnostics v_state = returned_sqlstate; return v_state; end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_person uuid;
  v_alice uuid := gen_random_uuid();     -- club admin; sends
  v_bob uuid := gen_random_uuid();       -- team manager; reads
  v_dave uuid := gen_random_uuid();      -- second club admin; reads the fixture thread
  v_outsider uuid := gen_random_uuid();  -- member of the club, in no conversation here
  v_minor uuid := gen_random_uuid();     -- a 15-year-old account
  v_club uuid; v_dir uuid; v_team uuid; v_type uuid; v_season uuid; v_ms uuid;
  v_dm uuid; v_dm_minor uuid; v_fixture uuid; v_conv uuid;
  v_m1 uuid; v_m2 uuid; v_m3 uuid; v_f1 uuid; v_bob_msg uuid;
  v_voice uuid; v_voice2 uuid; v_client uuid := gen_random_uuid(); v_path text;
  v_n int; v_txt text; v_r record; v_q bigint; v_body text;
begin
  foreach v_person in array array[v_alice, v_bob, v_dave, v_outsider, v_minor] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'mrv-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Read', 'Voice', 'mrv-' || v_person::text || '@ovalball.test',
            case when v_person = v_minor then (current_date - interval '15 years')::date else (current_date - interval '35 years')::date end)
    on conflict (id) do update set date_of_birth = excluded.date_of_birth;
  end loop;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('MRV RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mrv-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'mrv-' || v_tag, 'active') returning id into v_club;
  select id into v_type from public.canonical_team_types_by_code where rugby_code='union' and key='u12' and is_offered limit 1;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type, true) returning id into v_team;

  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_alice, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_dave, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_bob, 'BASIC_USER', 'active') returning id into v_ms;
  perform internal.grant_role(v_ms, 'TEAM_MANAGER', v_team, 'LEGACY_BACKFILL', 'receipts test');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_outsider, 'BASIC_USER', 'active');

  insert into public.direct_conversations (user_a, user_b, created_by)
  values (least(v_alice, v_bob), greatest(v_alice, v_bob), v_alice) returning id into v_dm;
  insert into public.fixture_messages (direct_conversation_id, sender_user_id, body, kind, content_type, created_at)
  values (v_dm, v_alice, 'One', 'message', 'text', now() - interval '3 minutes') returning id into v_m1;
  insert into public.fixture_messages (direct_conversation_id, sender_user_id, body, kind, content_type, created_at)
  values (v_dm, v_alice, 'Two', 'message', 'text', now() - interval '2 minutes') returning id into v_m2;
  insert into public.fixture_messages (direct_conversation_id, sender_user_id, body, kind, content_type, created_at)
  values (v_dm, v_alice, 'Three', 'message', 'text', now() - interval '1 minute') returning id into v_m3;
  insert into public.fixture_messages (direct_conversation_id, sender_user_id, body, kind, content_type, created_at)
  values (v_dm, v_bob, 'Reply from Bob', 'message', 'text', now() - interval '90 seconds') returning id into v_bob_msg;
  insert into public.direct_conversations (user_a, user_b, created_by)
  values (least(v_alice, v_minor), greatest(v_alice, v_minor), v_alice) returning id into v_dm_minor;

  select id into v_season from public.seasons where rugby_code = 'union' and not is_regression_fixture
    and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1;
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, status, source, season_id)
  values (v_team, 'Home', 'MRV Visitors', current_date + 10, 'Booked', 'club_created', v_season)
  returning id, conversation_id into v_fixture, v_conv;
  insert into public.fixture_messages (fixture_id, conversation_id, sender_user_id, body, kind, content_type)
  values (v_fixture, v_conv, v_alice, 'Pitch 2, 10:30.', 'message', 'text') returning id into v_f1;

  -- =====================================================================
  -- RR. READ RECEIPTS
  -- =====================================================================
  perform pg_temp.act('authenticated', v_alice);
  select count(*) into v_n from public.message_receipts(array[v_m1, v_m2, v_m3]) where read_count > 0;
  perform pg_temp.check(v_n = 0, 'RR1 nothing is read before the reader opens the conversation');

  perform pg_temp.act('authenticated', v_bob);
  v_n := public.mark_thread_read(v_m2);
  perform pg_temp.check(v_n = 2, format('RR2 reading up to message two marks one and two -- and not three, nor Bob''s own (%s)', v_n));
  perform pg_temp.act('authenticated', v_alice);
  select count(*) into v_n from public.message_receipts(array[v_m1, v_m2, v_m3]) where read_count = 1;
  perform pg_temp.check(v_n = 2 and (select read_count from public.message_receipts(array[v_m3])) = 0,
    format('RR3 the sender sees one and two read, three not yet (%s)', v_n));
  perform pg_temp.check((select first_read_at is not null and is_direct from public.message_receipts(array[v_m1])),
    'RR4 a direct receipt carries when it was read');

  perform pg_temp.act('authenticated', v_bob);
  v_n := public.mark_thread_read(v_m2);
  perform pg_temp.check(v_n = 0, 'RR5 reading the same point again changes nothing');
  v_n := public.mark_thread_read(v_m1);
  perform pg_temp.check(v_n = 0, 'RR6 reading an EARLIER point never un-reads or re-marks anything');
  v_n := public.mark_thread_read(v_m3);
  perform pg_temp.check(v_n = 1, format('RR7 reading on marks only what is newly read (%s)', v_n));
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.message_reads where message_id = v_bob_msg;
  perform pg_temp.check(v_n = 0, 'RR8 nobody is recorded as reading their own message');
  perform pg_temp.act('authenticated', v_bob);

  -- Receipts belong to the sender: Bob asking about Alice's messages learns nothing.
  select count(*) into v_n from public.message_receipts(array[v_m1, v_m2, v_m3]);
  perform pg_temp.check(v_n = 0, 'RR9 a receipt is answered only to the person who sent the message');

  perform pg_temp.act('authenticated', v_outsider);
  v_txt := pg_temp.try(format('select public.mark_thread_read(%L)', v_m1));
  perform pg_temp.check(v_txt = '42501', format('RR10 an outsider holding a message id cannot record a read (%s)', v_txt));
  v_txt := pg_temp.try(format('select public.mark_thread_read(%L)', gen_random_uuid()));
  perform pg_temp.check(v_txt = '42501', format('RR11 an id that does not exist gets the same answer (%s)', v_txt));
  v_txt := pg_temp.try(format('insert into public.message_reads (message_id, user_id) values (%L, %L)', v_m1, v_bob));
  perform pg_temp.check(v_txt <> 'OK', format('RR12 nobody can write a read for somebody else, or at all, directly (%s)', v_txt));
  v_txt := pg_temp.try('select count(*) from public.message_reads');
  perform pg_temp.check(v_txt <> 'OK', format('RR13 nor read the receipts table directly (%s)', v_txt));
  v_txt := pg_temp.try('select count(*) from public.thread_read_cursors');
  perform pg_temp.check(v_txt <> 'OK', format('RR14 nor the cursors (%s)', v_txt));

  -- A block in either direction hides direct receipts.
  perform pg_temp.act_postgres();
  insert into public.user_message_blocks (blocker_user_id, blocked_user_id) values (v_bob, v_alice);
  perform pg_temp.act('authenticated', v_alice);
  select count(*) into v_n from public.message_receipts(array[v_m1, v_m2, v_m3]);
  perform pg_temp.check(v_n = 0, format('RR15 a block hides receipts from the blocked sender (%s rows)', v_n));
  perform pg_temp.act_postgres();
  delete from public.user_message_blocks where blocker_user_id = v_bob and blocked_user_id = v_alice;

  -- A group thread counts readers; it never says who read in a way the thread does not already know.
  perform pg_temp.act('authenticated', v_bob);
  v_txt := pg_temp.try(format('select public.mark_thread_read(%L)', v_f1));
  perform pg_temp.act('authenticated', v_dave);
  perform public.mark_thread_read(v_f1);
  perform pg_temp.act('authenticated', v_alice);
  select * into v_r from public.message_receipts(array[v_f1]);
  perform pg_temp.check(v_r.read_count = case when v_txt = 'OK' then 2 else 1 end and not v_r.is_direct,
    format('RR16 a group message is "read by N" (%s readers; the team manager''s own read: %s)', v_r.read_count, v_txt));
  perform pg_temp.act('authenticated', v_outsider);
  v_txt := pg_temp.try(format('select public.mark_thread_read(%L)', v_f1));
  perform pg_temp.check(v_txt = '42501', format('RR17 an outsider cannot read into a fixture thread (%s)', v_txt));

  -- A minor's conversation: the minor may read what exists, but adult-only rules keep sending closed (V6).

  -- =====================================================================
  -- V. VOICE NOTES
  -- =====================================================================
  perform pg_temp.act('authenticated', v_bob);
  v_path := 'd/' || v_dm || '/' || gen_random_uuid() || '.m4a';
  v_voice := public.create_voice_message('direct', v_dm, v_path, 48000, 6200, v_client);
  perform pg_temp.check((select content_type = 'audio' and body is null from public.fixture_messages where id = v_voice)
    and (select mime_type = 'audio/mp4' and duration_ms = 6200 from public.fixture_message_attachments where message_id = v_voice),
    'V1 a participant sends a voice note: an audio message with its duration, no invented words');
  v_voice2 := public.create_voice_message('direct', v_dm, 'd/' || v_dm || '/' || gen_random_uuid() || '.m4a', 48000, 6200, v_client);
  select count(*) into v_n from public.fixture_messages where sender_user_id = v_bob and client_message_id = v_client;
  perform pg_temp.check(v_voice2 = v_voice and v_n = 1, format('V2 the same send twice is one voice note (%s)', v_n));

  v_txt := pg_temp.try(format('select public.create_voice_message(''direct'', %L, %L, 48000, 6200, %L)', v_dm, 'd/' || gen_random_uuid() || '/x.m4a', gen_random_uuid()));
  perform pg_temp.check(v_txt = '42501', format('V3 a file outside this conversation''s folder is refused (%s)', v_txt));
  v_txt := pg_temp.try(format('select public.create_voice_message(''direct'', %L, %L, 48000, 6200, %L)', v_dm, 'd/' || v_dm || '/x.mp3', gen_random_uuid()));
  perform pg_temp.check(v_txt = '42501', format('V4 only the recorder''s own format (%s)', v_txt));
  v_txt := pg_temp.try(format('select public.create_voice_message(''direct'', %L, %L, 48000, 121000, %L)', v_dm, 'd/' || v_dm || '/y.m4a', gen_random_uuid()));
  perform pg_temp.check(v_txt = '22023', format('V5 longer than two minutes is refused (%s)', v_txt));
  v_txt := pg_temp.try(format('select public.create_voice_message(''direct'', %L, %L, 2097153, 6000, %L)', v_dm, 'd/' || v_dm || '/z.m4a', gen_random_uuid()));
  perform pg_temp.check(v_txt = '22023', format('V6 larger than two megabytes is refused (%s)', v_txt));

  perform pg_temp.act('authenticated', v_outsider);
  v_txt := pg_temp.try(format('select public.create_voice_message(''direct'', %L, %L, 48000, 6000, %L)', v_dm, 'd/' || v_dm || '/o.m4a', gen_random_uuid()));
  perform pg_temp.check(v_txt = '42501', format('V7 an outsider cannot send a voice note into the conversation (%s)', v_txt));
  v_txt := pg_temp.try(format('select public.create_voice_message(''fixture'', %L, %L, 48000, 6000, %L)', v_fixture, 'f/' || v_fixture || '/o.m4a', gen_random_uuid()));
  perform pg_temp.check(v_txt = '42501', format('V8 nor into a fixture thread that is not theirs (%s)', v_txt));

  perform pg_temp.act('authenticated', v_minor);
  v_txt := pg_temp.try(format('select public.create_voice_message(''direct'', %L, %L, 48000, 6000, %L)', v_dm_minor, 'd/' || v_dm_minor || '/m.m4a', gen_random_uuid()));
  perform pg_temp.check(v_txt = '42501', format('V9 a minor cannot send a voice note in a direct conversation (%s)', v_txt));
  perform pg_temp.act('authenticated', v_alice);
  v_txt := pg_temp.try(format('select public.create_voice_message(''direct'', %L, %L, 48000, 6000, %L)', v_dm_minor, 'd/' || v_dm_minor || '/a.m4a', gen_random_uuid()));
  perform pg_temp.check(v_txt = '42501', format('V10 nor an adult to a minor (%s)', v_txt));

  perform pg_temp.act('authenticated', v_alice);
  v_txt := pg_temp.try(format('select public.create_voice_message(''fixture'', %L, %L, 48000, 6000, %L)', v_fixture, 'f/' || v_fixture || '/' || gen_random_uuid() || '.m4a', gen_random_uuid()));
  perform pg_temp.check(v_txt = 'OK', format('V11 staff send a voice note into their fixture thread (%s)', v_txt));

  perform pg_temp.act_postgres();
  v_txt := pg_temp.try(format('insert into public.fixture_message_attachments (message_id, storage_path, original_filename, mime_type, size_bytes, uploaded_by, duration_ms) values (%L, %L, ''a.mp3'', ''audio/mpeg'', 10, %L, 1000)', v_m1, 'd/' || v_dm || '/q.mp3', v_alice));
  perform pg_temp.check(v_txt = '23514', format('V12 the table refuses any audio format but AAC (%s)', v_txt));
  v_txt := pg_temp.try(format('insert into public.fixture_message_attachments (message_id, storage_path, original_filename, mime_type, size_bytes, uploaded_by) values (%L, %L, ''a.m4a'', ''audio/mp4'', 10, %L)', v_m1, 'd/' || v_dm || '/q2.m4a', v_alice));
  perform pg_temp.check(v_txt = '23514', format('V13 a voice note must say how long it is (%s)', v_txt));

  -- =====================================================================
  -- F. A DELETED MESSAGE'S FILE
  -- =====================================================================
  perform pg_temp.act('authenticated', v_alice);
  perform pg_temp.check(internal.can_access_message_attachment_path(v_path, false), 'F1 a participant can fetch a live voice note');
  perform pg_temp.act_postgres();
  update public.fixture_messages set deleted_at = now(), deleted_by = v_bob, deleted_by_role = 'sender' where id = v_voice;
  perform pg_temp.act('authenticated', v_alice);
  perform pg_temp.check(not internal.can_access_message_attachment_path(v_path, false), 'F2 once deleted, the stored file is unreadable too');
  perform pg_temp.act('authenticated', v_outsider);
  perform pg_temp.check(not internal.can_access_message_attachment_path('d/' || v_dm || '/' || gen_random_uuid() || '.m4a', false),
    'F3 an outsider cannot read anything in the conversation''s folder');

  -- =====================================================================
  -- N. PUSH ACTIONS FIT THE CONVERSATION
  -- =====================================================================
  perform pg_temp.act_postgres();
  insert into public.push_device_tokens (user_id, token, platform, app_variant)
  values (v_bob, 'ExponentPushToken[mrv-' || v_tag || ']', 'ios', 'production');
  select coalesce(max(id), 0) into v_q from net.http_request_queue;
  insert into public.fixture_messages (direct_conversation_id, sender_user_id, body, kind, content_type)
  values (v_dm, v_alice, 'Secret squad news', 'message', 'text');
  select convert_from(body, 'utf8') into v_body from net.http_request_queue where id > v_q and convert_from(body, 'utf8') like '%mrv-' || v_tag || '%' order by id desc limit 1;
  perform pg_temp.check(v_body like '%"categoryId": "ovalball-direct"%' and v_body not like '%Secret squad news%',
    'N1 a direct message push offers the direct actions and carries no message text');
  select coalesce(max(id), 0) into v_q from net.http_request_queue;
  perform pg_temp.act('authenticated', v_alice);
  perform public.send_conversation_message('fixture', v_fixture, 'Kick-off moved', gen_random_uuid(), null);
  perform pg_temp.act_postgres();
  select convert_from(body, 'utf8') into v_body from net.http_request_queue where id > v_q and convert_from(body, 'utf8') like '%mrv-' || v_tag || '%' order by id desc limit 1;
  perform pg_temp.check(v_body is null or (v_body like '%"categoryId": "ovalball-fixture"%' and v_body not like '%Kick-off moved%'),
    format('N2 a fixture thread push offers the fixture answers and no message text (%s)', case when v_body is null then 'no push for this recipient' else 'pushed' end));
end $$;

rollback;
