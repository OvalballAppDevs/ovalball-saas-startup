-- MESSENGER CONVERSATION FEATURES -- what 20270755000000 lets people do, and what it never lets them do.
--
--   R. REACTIONS: a participant reacts, changes and takes back one reaction; a retry leaves one row; an outsider
--      can neither react nor see reactions; only the fixed set; nothing on a deleted message.
--   I. ONE MESSAGE PER SEND: the same send reference twice is one message; the invoker send keeps every refusal
--      the insert policy makes (outsider, forged team, empty).
--   P. REPLIES stay inside their own conversation.
--   L. PRESENCE: only for my own direct conversations, only adults, never across a block.
--   T. Request threads broadcast on their own topic.
--   U. A push carries who and where, never the message.
--   D. A document shared in a direct message opens for its recipient, and for nobody else.
--
-- Self-seeding and rolled back. No persistent identity is touched.
\set ON_ERROR_STOP off
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
  v_alice uuid := gen_random_uuid();     -- club admin, in the direct conversation
  v_bob uuid := gen_random_uuid();       -- member, in the direct conversation
  v_outsider uuid := gen_random_uuid();  -- member of the same club, not in the conversation
  v_carol uuid := gen_random_uuid();     -- another club's adult, in a direct conversation with alice
  v_minor uuid := gen_random_uuid();     -- a 15-year-old account
  v_club uuid; v_dir uuid; v_club2 uuid; v_dir2 uuid; v_team uuid; v_type uuid;
  v_dm uuid; v_dm_carol uuid; v_dm_minor uuid; v_other_dm uuid;
  v_msg uuid; v_msg2 uuid; v_carol_msg uuid; v_other_msg uuid;
  v_client uuid := gen_random_uuid();
  v_id1 uuid; v_id2 uuid;
  v_n int; v_txt text; v_j jsonb; v_body text; v_q bigint; v_doc uuid; v_path text;
begin
  foreach v_person in array array[v_alice, v_bob, v_outsider, v_carol, v_minor] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'mcf-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Msg', 'Feature', 'mcf-' || v_person::text || '@ovalball.test',
            case when v_person = v_minor then (current_date - interval '15 years')::date else (current_date - interval '35 years')::date end)
    on conflict (id) do update set date_of_birth = excluded.date_of_birth;
  end loop;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('MCF RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mcf-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'mcf-' || v_tag, 'active') returning id into v_club;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('MCF Two RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mcf2-' || v_tag)
  returning id into v_dir2;
  insert into public.clubs (directory_id, slug, status) values (v_dir2, 'mcf2-' || v_tag, 'active') returning id into v_club2;
  select id into v_type from public.canonical_team_types_by_code where rugby_code='union' and key='u12' and is_offered limit 1;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type, true) returning id into v_team;

  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_alice, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_bob, 'BASIC_USER', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_outsider, 'BASIC_USER', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club2, v_carol, 'BASIC_USER', 'active');

  insert into public.direct_conversations (user_a, user_b, created_by)
  values (least(v_alice, v_bob), greatest(v_alice, v_bob), v_alice) returning id into v_dm;
  insert into public.fixture_messages (direct_conversation_id, sender_user_id, body, kind, content_type)
  values (v_dm, v_alice, 'Training on tonight?', 'message', 'text') returning id into v_msg;
  insert into public.fixture_messages (direct_conversation_id, sender_user_id, body, kind, content_type)
  values (v_dm, v_alice, 'Bring the cones.', 'message', 'text') returning id into v_msg2;
  -- A second conversation the outsider IS in, to prove replies cannot cross conversations.
  insert into public.direct_conversations (user_a, user_b, created_by)
  values (least(v_alice, v_outsider), greatest(v_alice, v_outsider), v_alice) returning id into v_other_dm;
  insert into public.fixture_messages (direct_conversation_id, sender_user_id, body, kind, content_type)
  values (v_other_dm, v_alice, 'Different thread.', 'message', 'text') returning id into v_other_msg;
  -- Alice and Carol (another club) -- the conversation a library document will be shared into.
  insert into public.direct_conversations (user_a, user_b, created_by)
  values (least(v_alice, v_carol), greatest(v_alice, v_carol), v_alice) returning id into v_dm_carol;
  -- A row that must never become a presence answer: a conversation with a minor (direct messaging refuses minors,
  -- so it can only exist here, made by hand, to prove the presence rule does not lean on that).
  insert into public.direct_conversations (user_a, user_b, created_by)
  values (least(v_alice, v_minor), greatest(v_alice, v_minor), v_alice) returning id into v_dm_minor;
  update public.profiles set last_active_at = now() - interval '30 seconds' where id in (v_alice, v_bob, v_minor, v_carol, v_outsider);

  -- =====================================================================
  -- R. REACTIONS
  -- =====================================================================
  perform pg_temp.act('authenticated', v_bob);
  v_j := public.set_message_reaction(v_msg, '👍');
  perform pg_temp.check(v_j = '[{"emoji": "👍", "count": 1, "mine": true}]'::jsonb, 'R1 a participant reacts, and is told the server''s answer (' || v_j::text || ')');
  v_j := public.set_message_reaction(v_msg, '❤️');
  select count(*) into v_n from public.message_reactions where message_id = v_msg and user_id = v_bob;
  perform pg_temp.check(v_n = 1 and (select emoji from public.message_reactions where message_id = v_msg and user_id = v_bob) = '❤️',
    'R2 a different emoji CHANGES the reaction: still one row, now ❤️');
  v_j := public.set_message_reaction(v_msg, '❤️');
  select count(*) into v_n from public.message_reactions where message_id = v_msg and user_id = v_bob;
  perform pg_temp.check(v_n = 0 and v_j = '[]'::jsonb, 'R3 the same emoji again takes it back');
  perform public.set_message_reaction(v_msg, '🎉');
  perform public.set_message_reaction(v_msg, '🎉');
  perform public.set_message_reaction(v_msg, '🎉');
  select count(*) into v_n from public.message_reactions where message_id = v_msg;
  perform pg_temp.check(v_n <= 1, format('R4 repeated calls never leave duplicate rows (%s)', v_n));
  perform public.set_message_reaction(v_msg, '🎉');
  perform public.set_message_reaction(v_msg, null);
  select count(*) into v_n from public.message_reactions where message_id = v_msg and user_id = v_bob;
  perform pg_temp.check(v_n = 0, 'R5 null takes a reaction back explicitly');

  perform public.set_message_reaction(v_msg, '👏');
  perform pg_temp.act('authenticated', v_alice);
  perform public.set_message_reaction(v_msg, '👏');
  select count(*) into v_n from public.message_reactions where message_id = v_msg;
  perform pg_temp.check(v_n = 2, format('R6 the other participant sees and adds to them (%s)', v_n));

  perform pg_temp.act('authenticated', v_outsider);
  v_txt := pg_temp.try(format('select public.set_message_reaction(%L, ''👍'')', v_msg));
  perform pg_temp.check(v_txt = '42501', format('R7 an outsider holding the message id cannot react (%s)', v_txt));
  select count(*) into v_n from public.message_reactions where message_id = v_msg;
  perform pg_temp.check(v_n = 0, format('R8 nor see who reacted (%s visible)', v_n));
  v_txt := pg_temp.try('insert into public.message_reactions (message_id, user_id, emoji) values (''' || v_msg || ''', ''' || v_outsider || ''', ''👍'')');
  perform pg_temp.check(v_txt <> 'OK', format('R9 nor write a reaction row directly (%s)', v_txt));
  v_txt := pg_temp.try(format('select public.set_message_reaction(%L, ''👍'')', gen_random_uuid()));
  perform pg_temp.check(v_txt = '42501', format('R10 an id that does not exist gets the same answer as one that is not yours (%s)', v_txt));

  perform pg_temp.act('authenticated', v_bob);
  v_txt := pg_temp.try(format('select public.set_message_reaction(%L, ''🤬'')', v_msg));
  perform pg_temp.check(v_txt = '22023', format('R11 only the fixed set of reactions (%s)', v_txt));
  perform pg_temp.act_postgres();
  update public.fixture_messages set deleted_at = now(), deleted_by = v_alice, deleted_by_role = 'sender' where id = v_msg2;
  perform pg_temp.act('authenticated', v_bob);
  v_txt := pg_temp.try(format('select public.set_message_reaction(%L, ''👍'')', v_msg2));
  perform pg_temp.check(v_txt = '42501', format('R12 nothing on a deleted message (%s)', v_txt));

  -- =====================================================================
  -- I. ONE MESSAGE PER SEND
  -- =====================================================================
  v_id1 := public.send_conversation_message('direct', v_dm, 'See you at six', v_client, null);
  v_id2 := public.send_conversation_message('direct', v_dm, 'See you at six', v_client, null);
  select count(*) into v_n from public.fixture_messages where sender_user_id = v_bob and client_message_id = v_client;
  perform pg_temp.check(v_id1 is not null and v_id1 = v_id2 and v_n = 1, format('I1 the same send twice is ONE message (%s rows)', v_n));

  perform pg_temp.act('authenticated', v_outsider);
  v_txt := pg_temp.try(format('select public.send_conversation_message(''direct'', %L, ''let me in'', %L, null)', v_dm, gen_random_uuid()));
  perform pg_temp.check(v_txt = '42501', format('I2 the send keeps the insert policy: an outsider cannot send into the conversation (%s)', v_txt));
  -- A reused send reference cannot read someone else's message back.
  v_txt := pg_temp.try(format('select public.send_conversation_message(''direct'', %L, ''x'', %L, null)', v_dm, v_client));
  perform pg_temp.check(v_txt = '42501', format('I3 nor reuse another person''s send reference to learn anything (%s)', v_txt));

  perform pg_temp.act('authenticated', v_bob);
  v_txt := pg_temp.try(format('select public.send_conversation_message(''team'', %L, ''hello team'', %L, null)', v_team, gen_random_uuid()));
  perform pg_temp.check(v_txt = '42501', format('I4 nor send into a team conversation that is not yours to post in (%s)', v_txt));
  v_txt := pg_temp.try(format('select public.send_conversation_message(''direct'', %L, ''   '', %L, null)', v_dm, gen_random_uuid()));
  perform pg_temp.check(v_txt = '22023', format('I5 an empty message is refused (%s)', v_txt));

  -- A minor's account cannot use the send to open what direct messaging refuses.
  perform pg_temp.act('authenticated', v_minor);
  v_txt := pg_temp.try(format('select public.send_conversation_message(''direct'', %L, ''hi'', %L, null)', v_dm_minor, gen_random_uuid()));
  perform pg_temp.check(v_txt = '42501', format('I6 a minor cannot send in a direct conversation, even one that exists (%s)', v_txt));
  perform pg_temp.act('authenticated', v_alice);
  v_txt := pg_temp.try(format('select public.send_conversation_message(''direct'', %L, ''hi'', %L, null)', v_dm_minor, gen_random_uuid()));
  perform pg_temp.check(v_txt = '42501', format('I7 nor can an adult send to a minor through it (%s)', v_txt));

  -- =====================================================================
  -- P. REPLIES STAY IN THEIR CONVERSATION
  -- =====================================================================
  perform pg_temp.act('authenticated', v_bob);
  v_txt := pg_temp.try(format('select public.send_conversation_message(''direct'', %L, ''Yes, on'', %L, %L)', v_dm, gen_random_uuid(), v_msg));
  perform pg_temp.check(v_txt = 'OK', format('P1 a reply to a message in the same conversation is sent (%s)', v_txt));
  v_txt := pg_temp.try(format('select public.send_conversation_message(''direct'', %L, ''sneaky'', %L, %L)', v_dm, gen_random_uuid(), v_other_msg));
  perform pg_temp.check(v_txt = '22023', format('P2 a reply cannot point into another conversation (%s)', v_txt));
  v_txt := pg_temp.try(format('update public.fixture_messages set reply_to_message_id = %L where sender_user_id = %L and reply_to_message_id = %L', v_other_msg, v_bob, v_msg));
  perform pg_temp.check(v_txt <> 'OK' or not exists (select 1 from public.fixture_messages where reply_to_message_id = v_other_msg),
    format('P3 nor be re-pointed afterwards (%s)', v_txt));

  -- =====================================================================
  -- L. PRESENCE
  -- =====================================================================
  perform pg_temp.act('authenticated', v_bob);
  select count(*) into v_n from public.my_direct_presence() p where p.other_user_id = v_alice and p.last_active_at is not null;
  perform pg_temp.check(v_n = 1, 'L1 Bob sees when Alice was last active -- they share a direct conversation');
  select count(*) into v_n from public.my_direct_presence() p where p.other_user_id <> v_alice;
  perform pg_temp.check(v_n = 0, format('L2 and nobody else: no directory (%s others)', v_n));
  perform pg_temp.act('authenticated', v_alice);
  select count(*) into v_n from public.my_direct_presence() p where p.other_user_id = v_minor;
  perform pg_temp.check(v_n = 0, 'L3 a minor''s presence is never shown, even where a conversation row exists');
  perform pg_temp.act('authenticated', v_minor);
  select count(*) into v_n from public.my_direct_presence();
  perform pg_temp.check(v_n = 0, 'L4 nor does a minor''s account see anyone''s');
  perform pg_temp.act_postgres();
  insert into public.user_message_blocks (blocker_user_id, blocked_user_id) values (v_alice, v_bob);
  perform pg_temp.act('authenticated', v_bob);
  select count(*) into v_n from public.my_direct_presence() p where p.other_user_id = v_alice;
  perform pg_temp.check(v_n = 0, 'L5 a block in either direction hides presence');
  perform pg_temp.act('authenticated', v_outsider);
  select count(*) into v_n from public.profiles where id = v_alice and last_active_at is not null;
  perform pg_temp.check(v_n = 0, 'L6 the profile column itself stays private');
  perform pg_temp.act_postgres();
  delete from public.user_message_blocks where blocker_user_id = v_alice and blocked_user_id = v_bob;

  -- =====================================================================
  -- T. REQUEST THREADS BROADCAST ON THEIR OWN TOPIC
  -- =====================================================================
  v_id1 := gen_random_uuid();
  v_txt := internal.message_realtime_topic(jsonb_populate_record(null::public.fixture_messages, jsonb_build_object('fixture_request_id', v_id1)));
  perform pg_temp.check(v_txt = 'presence:r:' || v_id1::text, format('T0 a request message broadcasts on its request''s topic (%s)', v_txt));
  select internal.message_realtime_topic(m) into v_txt from public.fixture_messages m where m.id = v_msg;
  perform pg_temp.check(v_txt = 'presence:d:' || v_dm::text, format('T1 a direct message keeps its topic (%s)', v_txt));

  -- =====================================================================
  -- U. A PUSH NEVER CARRIES THE MESSAGE
  -- =====================================================================
  perform pg_temp.act_postgres();
  insert into public.push_device_tokens (user_id, token, platform, app_variant) values (v_bob, 'ExponentPushToken[mcf-' || v_tag || ']', 'ios', 'production');
  select coalesce(max(id), 0) into v_q from net.http_request_queue;
  insert into public.notifications (user_id, type, title, body, data)
  values (v_bob, 'new_direct_message', 'Alice', 'The secret plan is under the shed', jsonb_build_object('conversation_id', v_dm));
  select convert_from(body, 'utf8') into v_body from net.http_request_queue where id > v_q order by id desc limit 1;
  perform pg_temp.check(v_body is not null and position('secret plan' in v_body) = 0 and position('Sent you a message.' in v_body) > 0,
    'U1 a direct-message push says who, never what');
  perform pg_temp.check(position('ovalball-direct' in coalesce(v_body, '')) > 0, 'U2 and offers the direct-message actions (20270756: Reply, react)');
  select coalesce(max(id), 0) into v_q from net.http_request_queue;
  insert into public.notifications (user_id, type, title, body, data)
  values (v_bob, 'new_fixture_message', 'New message', 'Alice · U12 v Town' || E'\n' || '“The secret plan is under the shed”', '{}'::jsonb);
  select convert_from(body, 'utf8') into v_body from net.http_request_queue where id > v_q order by id desc limit 1;
  perform pg_temp.check(v_body is not null and position('secret plan' in v_body) = 0 and position('U12 v Town' in v_body) > 0,
    'U3 a conversation push keeps the sender and the fixture, not the words');

  -- =====================================================================
  -- D. A DOCUMENT SHARED IN A DIRECT MESSAGE
  -- =====================================================================
  v_path := v_club::text || '/' || gen_random_uuid()::text || '.pdf';
  insert into public.club_documents (club_id, title, category, original_filename, storage_path, mime_type, size_bytes, uploaded_by)
  values (v_club, 'Visitor Guide', 'visitor_guide', 'guide.pdf', v_path, 'application/pdf', 1000, v_alice) returning id into v_doc;
  insert into public.fixture_messages (direct_conversation_id, sender_user_id, body, kind, content_type)
  values (v_dm_carol, v_alice, 'Here is the guide', 'message', 'text') returning id into v_carol_msg;
  insert into public.fixture_message_document_refs (message_id, document_id, shared_by) values (v_carol_msg, v_doc, v_alice);

  perform pg_temp.act('authenticated', v_carol);
  perform pg_temp.check(internal.can_access_document_storage_path(v_path, false), 'D1 the recipient of a direct-message share can open the file');
  perform pg_temp.check(not internal.can_access_document_storage_path(v_path, true), 'D2 but never write it');
  perform pg_temp.act_postgres();
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club2, v_bob, 'BASIC_USER', 'active');
  perform pg_temp.act('authenticated', v_outsider);
  -- the outsider is a member of the sending club, so may read its library anyway: use a stranger instead.
  perform pg_temp.act('authenticated', v_minor);
  perform pg_temp.check(not internal.can_access_document_storage_path(v_path, false), 'D3 somebody outside the conversation and the library cannot');
  perform pg_temp.act_postgres();
  update public.fixture_messages set deleted_at = now(), deleted_by = v_alice, deleted_by_role = 'sender' where id = v_carol_msg;
  perform pg_temp.act('authenticated', v_carol);
  perform pg_temp.check(not internal.can_access_document_storage_path(v_path, false), 'D4 a share in a deleted message opens nothing');
end $$;

rollback;
