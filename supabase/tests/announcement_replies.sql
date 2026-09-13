-- Replying to an announcement (20270246000000).
--
-- The property under test is that PRIVATE_REPLY keeps the audience private
-- in the REPLY thread too. It is easy to protect the delivery list and then
-- leak the same information back through "three people replied" -- knowing
-- who else answered is knowing who else received it.
--
-- Also proved: NO_REPLY genuinely takes no replies, GROUP_DISCUSSION lets a
-- bounded audience see each other, the sending side reads everything, a
-- non-recipient reads nothing, and a reply is an ordinary message in the one
-- canonical store -- so the existing soft-delete tombstones it like any
-- other, rather than needing its own copy of that behaviour.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/announcement_replies.sql
--
-- Wrapped in a transaction and rolled back: it writes nothing to the shared
-- local UAT database.

\set ON_ERROR_STOP off
\pset pager off

begin;

do $$
declare
  v_admin uuid; v_outsider uuid; v_team uuid; v_ann uuid;
  v_a uuid; v_b uuid; v_msg uuid; v_n integer; v_body text;
begin
  select id into v_admin    from auth.users where email = 'uat.team.admin@ovalball.test';
  select id into v_outsider from auth.users where email = 'uat.unrelated@ovalball.test';
  if v_admin is null or v_outsider is null then
    raise notice 'SKIP: the UAT identities this suite reads are not present in this database';
    return;
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select t.id into v_team from public.teams t
  where internal.can_address_team_audience(t.id) order by t.id limit 1;
  if v_team is null then
    raise notice 'SKIP: no team in this database that the UAT team admin may address';
    return;
  end if;

  v_ann := public.create_announcement(
    'team', v_team, 'team', v_team,
    'Please confirm your child''s kit size.', 'Kit Sizes', 'PRIVATE_REPLY');
  perform public.send_announcement(v_ann);

  perform set_config('role', 'postgres', true);
  select recipient_user_id into v_a from public.messenger_announcement_deliveries
  where announcement_id = v_ann order by recipient_user_id limit 1;
  select recipient_user_id into v_b from public.messenger_announcement_deliveries
  where announcement_id = v_ann and recipient_user_id <> v_a order by recipient_user_id limit 1;
  perform set_config('role', 'authenticated', true);

  if v_a is null or v_b is null then
    raise notice 'SKIP: this announcement reached fewer than two people, so audience privacy cannot be tested';
    return;
  end if;

  -- Both recipients answer.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  v_msg := public.reply_to_announcement(v_ann, 'Age 11 shirt please.');

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform public.reply_to_announcement(v_ann, 'Age 13, thank you.');

  -- 1. A REPLIES, AND SEES ONLY THEIR OWN.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.announcement_replies(v_ann);
  if v_n = 1 then
    raise notice 'PASS 1: under a private reply mode, a recipient sees only their own answer';
  else
    raise notice 'FAIL 1: recipient A could read % replies -- the other repliers ARE the audience', v_n;
  end if;

  -- 2. And specifically not the other person's words.
  if not exists (select 1 from public.announcement_replies(v_ann) where body like '%Age 13%') then
    raise notice 'PASS 2: one recipient cannot read another recipient''s private reply';
  else
    raise notice 'FAIL 2: recipient A read recipient B''s private reply';
  end if;

  -- 3. THE SENDING SIDE READS EVERYTHING. That is what private reply means.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.announcement_replies(v_ann);
  if v_n = 2 then
    raise notice 'PASS 3: the sending side reads every private reply';
  else
    raise notice 'FAIL 3: the sending side read % of 2 replies', v_n;
  end if;

  -- 4. SOMEBODY WHO WAS NOT SENT IT READS NOTHING.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.announcement_replies(v_ann);
  if v_n = 0 then
    raise notice 'PASS 4: somebody outside the audience reads nothing at all';
  else
    raise notice 'FAIL 4: an outsider read % replies', v_n;
  end if;

  begin
    perform public.reply_to_announcement(v_ann, 'Butting in.');
    raise notice 'FAIL 5: an outsider replied to an announcement they never received';
  exception when insufficient_privilege then
    raise notice 'PASS 5: an outsider cannot reply to an announcement they never received';
  end;

  -- =================================================================
  -- 6. A REPLY IS AN ORDINARY MESSAGE
  -- Soft delete is not reimplemented for replies; the existing one works on
  -- them because they live in the same table.
  -- =================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform public.soft_delete_own_message(v_msg);
  select body into v_body from public.announcement_replies(v_ann) where message_id = v_msg;
  if v_body = 'This message was deleted.' then
    raise notice 'PASS 6: the existing soft delete tombstones a reply, with no reply-specific code';
  else
    raise notice 'FAIL 6: a deleted reply read back as %', coalesce(v_body, '(nothing)');
  end if;

  perform set_config('role', 'postgres', true);
  select body into v_body from public.fixture_messages where id = v_msg;
  if v_body = 'Age 11 shirt please.' then
    raise notice 'PASS 6b: the deleted reply''s words are retained as evidence, as elsewhere in Messenger';
  else
    raise notice 'FAIL 6b: deleting a reply destroyed the evidence';
  end if;
  perform set_config('role', 'authenticated', true);

  -- =================================================================
  -- 7. NO_REPLY MEANS NO REPLY
  -- =================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_ann := public.create_announcement(
    'team', v_team, 'team', v_team, 'The clubhouse is closed on Sunday.', null, 'NO_REPLY');
  perform public.send_announcement(v_ann);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  begin
    perform public.reply_to_announcement(v_ann, 'Why?');
    raise notice 'FAIL 7: a NO_REPLY announcement accepted a reply';
  exception when insufficient_privilege then
    raise notice 'PASS 7: an announcement that takes no replies takes no replies';
  end;

  -- =================================================================
  -- 8. GROUP_DISCUSSION: THE BOUNDED AUDIENCE CAN SEE EACH OTHER
  -- =================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_ann := public.create_announcement(
    'team', v_team, 'team', v_team, 'Who can help with the raffle?', 'Raffle', 'GROUP_DISCUSSION');
  perform public.send_announcement(v_ann);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform public.reply_to_announcement(v_ann, 'I can do the first hour.');
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform public.reply_to_announcement(v_ann, 'I''ll take the second.');

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.announcement_replies(v_ann);
  if v_n = 2 then
    raise notice 'PASS 8: in a group discussion the bounded audience sees each other';
  else
    raise notice 'FAIL 8: a group discussion showed % of 2 replies', v_n;
  end if;

  -- 9. And the boundary still holds -- a group discussion is not public.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.announcement_replies(v_ann);
  if v_n = 0 then
    raise notice 'PASS 9: a group discussion is bounded -- an outsider still reads nothing';
  else
    raise notice 'FAIL 9: an outsider read % messages from a group discussion', v_n;
  end if;

  -- =================================================================
  -- 10. ONE ROW, ONE CONVERSATION -- STILL TRUE WITH SEVEN CONTAINERS
  --
  -- direct_conversation_id is the seventh. It arrived with direct messaging
  -- after this assertion was written, and because the check works by counting
  -- non-null containers, a kind it does not know about does not read as "a
  -- seventh kind" -- it reads as "belongs to NO conversation". Every direct
  -- message in the store therefore counted as an orphan, and the invariant
  -- reported itself broken while it was in fact holding.
  --
  -- Note conversation_id is deliberately NOT in this list: it is a generic
  -- pointer carried ALONGSIDE the specific container, so counting it would
  -- make every message look like it belonged to two conversations at once.
  -- =================================================================
  perform set_config('role', 'postgres', true);
  select count(*) into v_n from public.fixture_messages
  where num_nonnulls(fixture_request_id, fixture_id, club_conversation_id,
                     team_conversation_id, safeguarding_conversation_id,
                     announcement_id, direct_conversation_id) <> 1;
  if v_n = 0 then
    raise notice 'PASS 10: every message in the store belongs to exactly one conversation';
  else
    raise notice 'FAIL 10: % message(s) belong to none or several conversations', v_n;
  end if;
end $$;

rollback;
