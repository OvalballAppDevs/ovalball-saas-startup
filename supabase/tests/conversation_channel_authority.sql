-- Realtime topic authorisation and cross-container reporting
-- (20270264000000, 20270266000000).
--
-- Both migrations fix the same shape of defect: a function written when the
-- message store had two containers, still deciding for seven. The failure
-- mode is silent in each case -- a realtime channel that simply never
-- delivers, and a report that is refused only after the reason is typed --
-- so permanent coverage matters more here than usual.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/conversation_channel_authority.sql
--
-- Wrapped in a transaction and rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;

do $$
declare
  v_coach uuid;
  v_guardian uuid;
  v_outsider uuid;
  v_conv uuid;
  v_msg uuid;
begin
  select id into v_coach from auth.users where email = 'uat.coach@ovalball.test';
  select id into v_guardian from auth.users where email = 'uat.guardian.one@ovalball.test';
  select id into v_outsider from auth.users where email = 'uat.unrelated@ovalball.test';

  if v_coach is null or v_guardian is null or v_outsider is null then
    raise notice 'SKIP: the UAT identities this suite reads are not present in this database';
    return;
  end if;

  -- A direct conversation between the two adults.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);
  v_conv := public.open_direct_conversation(v_guardian);

  insert into public.fixture_messages (direct_conversation_id, sender_user_id, body, kind)
  values (v_conv, v_coach, 'channel authority fixture', 'message')
  returning id into v_msg;

  -- =================================================================
  -- 1. EVERY CONTAINER THAT BROADCASTS CAN ALSO BE JOINED
  -- The prefixes t, s, a and d were all refused before 20270264000000,
  -- so the database was broadcasting into rooms nobody could enter.
  -- =================================================================
  if internal.can_access_fixture_presence_topic('presence:d:' || v_conv::text) then
    raise notice 'PASS 1: a participant may join their own direct conversation''s topic';
  else
    raise notice 'FAIL 1: a participant is refused their own direct conversation''s topic';
  end if;

  -- 2. AND SOMEBODY ELSE'S CONVERSATION STAYS SHUT.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  if internal.can_access_fixture_presence_topic('presence:d:' || v_conv::text) then
    raise notice 'FAIL 2: an outsider joined a direct conversation topic';
  else
    raise notice 'PASS 2: an outsider cannot join a direct conversation topic';
  end if;

  -- 3. A MALFORMED OR UNKNOWN TOPIC IS REFUSED, not accepted by default.
  if internal.can_access_fixture_presence_topic('presence:zz:' || v_conv::text)
     or internal.can_access_fixture_presence_topic('nonsense')
     or internal.can_access_fixture_presence_topic('presence:d:not-a-uuid') then
    raise notice 'FAIL 3: a malformed or unknown topic was authorised';
  else
    raise notice 'PASS 3: unknown prefixes and malformed topics are refused';
  end if;

  -- =================================================================
  -- 4. REPORTING REACHES EVERY CONTAINER THE REPORTER CAN SEE
  -- report_fixture_message only ever checked the fixture predicate, so a
  -- direct message could not be reported at all.
  -- =================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_guardian, 'role', 'authenticated')::text, true);
  begin
    perform public.report_fixture_message(v_msg, 'automated coverage');
    raise notice 'PASS 4: a direct message can be reported by its recipient';
  exception when others then
    raise notice 'FAIL 4: reporting a direct message was refused (%)', sqlerrm;
  end;

  -- 5. AND SOMEBODY WHO CANNOT SEE IT CANNOT REPORT IT -- otherwise a
  -- guessed message id becomes a way to confirm a conversation exists.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  begin
    perform public.report_fixture_message(v_msg, 'automated coverage');
    raise notice 'FAIL 5: an outsider reported a message they cannot read';
  exception when insufficient_privilege then
    raise notice 'PASS 5: an outsider cannot report a message they cannot read';
  end;

  -- 6. Reporting your own message is not a route to Support.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);
  begin
    perform public.report_fixture_message(v_msg, 'automated coverage');
    raise notice 'FAIL 6: a sender reported their own message';
  exception when insufficient_privilege then
    raise notice 'PASS 6: a sender cannot report their own message';
  end;

  -- 7. A reason is still required, whatever the container.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_guardian, 'role', 'authenticated')::text, true);
  begin
    perform public.report_fixture_message(v_msg, '   ');
    raise notice 'FAIL 7: a blank reason was accepted';
  exception when others then
    raise notice 'PASS 7: a blank reason is still refused';
  end;

  -- 8. The per-message predicate agrees with the conversation's own view.
  if internal.can_access_message((select f from public.fixture_messages f where f.id = v_msg)) then
    raise notice 'PASS 8: a participant may see their own direct message';
  else
    raise notice 'FAIL 8: a participant cannot see their own direct message';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  if internal.can_access_message((select f from public.fixture_messages f where f.id = v_msg)) then
    raise notice 'FAIL 9: an outsider may see a direct message';
  else
    raise notice 'PASS 9: an outsider may not see a direct message';
  end if;
end $$;

rollback;
