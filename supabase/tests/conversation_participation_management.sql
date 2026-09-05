-- Manual verification for chat participant management (20260901090000):
-- mute/leave/rejoin/remove operate on SUBSCRIPTION state only, never
-- club_memberships/team_permissions/message history, own-club-side-only
-- remove authority, and muted/left users stop receiving routine message
-- notifications. NOT a migration -- run AFTER permission_matrix.sql.

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('a1000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date + 7, 'Booked', 'club_created')
  on conflict (id) do nothing;
end $$;

-- ------------------------------------------------------------
-- 1. Self-mute: no routine notification for a new message while muted.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$
begin
  perform public.set_fixture_conversation_mute('a1000000-0000-0000-0000-000000000001', null, true);
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  insert into public.fixture_messages (fixture_id, sender_user_id, body) values ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'Message while 0004 is muted');
end $$;
commit;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.notifications
  where user_id = '00000000-0000-0000-0000-000000000004' and type = 'new_fixture_message'
    and data->>'fixture_id' = 'a1000000-0000-0000-0000-000000000001';
  if v_count = 0 then
    raise notice 'PASS 1: a muted user receives no routine notification for a new message';
  else
    raise notice 'FAIL 1: a muted user received % notification(s)', v_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 2. Unmute restores notifications.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$
begin
  perform public.set_fixture_conversation_mute('a1000000-0000-0000-0000-000000000001', null, false);
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  insert into public.fixture_messages (fixture_id, sender_user_id, body) values ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'Message after unmute');
end $$;
commit;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.notifications
  where user_id = '00000000-0000-0000-0000-000000000004' and type = 'new_fixture_message'
    and data->>'fixture_id' = 'a1000000-0000-0000-0000-000000000001';
  if v_count > 0 then
    raise notice 'PASS 2: unmuting restores routine notifications (%)', v_count;
  else
    raise notice 'FAIL 2: still no notification after unmuting';
  end if;
end $$;

-- ------------------------------------------------------------
-- 3/4. Leave: stops notifications, does NOT touch club_memberships/
--    team_permissions, does NOT delete message history.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$
begin
  perform public.leave_fixture_conversation('a1000000-0000-0000-0000-000000000001', null);
end $$;
commit;

do $$
declare
  v_membership_exists boolean;
  v_permission_exists boolean;
begin
  select exists (select 1 from public.club_memberships where user_id = '00000000-0000-0000-0000-000000000004' and status = 'active') into v_membership_exists;
  select exists (select 1 from public.team_permissions tp join public.club_memberships cm on cm.id = tp.membership_id where cm.user_id = '00000000-0000-0000-0000-000000000004') into v_permission_exists;
  if v_membership_exists and v_permission_exists then
    raise notice 'PASS 3: leaving the conversation does not touch club membership or team permissions';
  else
    raise notice 'FAIL 3: membership=%, permission=%', v_membership_exists, v_permission_exists;
  end if;
end $$;

do $$
begin
  perform set_config('test.notif_count_before_leave_send', (
    select count(*)::text from public.notifications
    where user_id = '00000000-0000-0000-0000-000000000004' and type = 'new_fixture_message'
      and data->>'fixture_id' = 'a1000000-0000-0000-0000-000000000001'
  ), false);
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  insert into public.fixture_messages (fixture_id, sender_user_id, body) values ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'Message after 0004 left');
end $$;
commit;

do $$
declare
  v_count_after int;
  v_msg_count int;
begin
  select count(*) into v_count_after from public.notifications
  where user_id = '00000000-0000-0000-0000-000000000004' and type = 'new_fixture_message'
    and data->>'fixture_id' = 'a1000000-0000-0000-0000-000000000001';
  select count(*) into v_msg_count from public.fixture_messages where fixture_id = 'a1000000-0000-0000-0000-000000000001';
  if v_count_after = current_setting('test.notif_count_before_leave_send')::int and v_msg_count >= 4 then
    raise notice 'PASS 4: a user who left gets no further notifications (still %), and history is preserved (% messages)', v_count_after, v_msg_count;
  else
    raise notice 'FAIL 4: notification count went from % to %, message_count=%', current_setting('test.notif_count_before_leave_send'), v_count_after, v_msg_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 5. Rejoin: clears left_at, requires real access still held.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$
declare
  v_left_at timestamptz;
begin
  perform public.rejoin_fixture_conversation('a1000000-0000-0000-0000-000000000001', null);
  select left_at into v_left_at from public.fixture_conversation_subscriptions
  where fixture_id = 'a1000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-000000000004';
  if v_left_at is null then
    raise notice 'PASS 5: rejoin clears left_at';
  else
    raise notice 'FAIL 5: left_at is still %', v_left_at;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 6/7. Remove: Burnley manager can remove a fellow Burnley participant;
--    cannot remove a Rossendale (opponent-side) participant.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_left_at timestamptz;
begin
  perform public.remove_fixture_conversation_participant('a1000000-0000-0000-0000-000000000001', null, '00000000-0000-0000-0000-000000000004');
  select left_at into v_left_at from public.fixture_conversation_subscriptions
  where fixture_id = 'a1000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-000000000004';
  if v_left_at is not null then
    raise notice 'PASS 6: Burnley manager removed a fellow Burnley participant';
  else
    raise notice 'FAIL 6: target was not marked as left';
  end if;
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.remove_fixture_conversation_participant('a1000000-0000-0000-0000-000000000001', null, '00000000-0000-0000-0000-000000000003');
  raise notice 'FAIL 7: Burnley manager removed a Rossendale (opponent-side) participant';
exception when others then
  raise notice 'PASS 7: Burnley manager cannot remove an opponent-side participant (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 8. An ordinary participant (not a club/team official) cannot remove
--    someone else -- only Leave is available to them.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000011","role":"authenticated"}';
do $$
begin
  perform public.remove_fixture_conversation_participant('a1000000-0000-0000-0000-000000000001', null, '00000000-0000-0000-0000-000000000002');
  raise notice 'FAIL 8: an unrelated/unauthorized user removed a participant';
exception when others then
  raise notice 'PASS 8: an unrelated user cannot remove a participant (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 9. Removing yourself via remove_fixture_conversation_participant is
--    rejected -- Leave Conversation is the correct path for that.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.remove_fixture_conversation_participant('a1000000-0000-0000-0000-000000000001', null, '00000000-0000-0000-0000-000000000002');
  raise notice 'FAIL 9: a user removed themselves via the remove RPC';
exception when others then
  raise notice 'PASS 9: self-removal via remove RPC is rejected (%)', sqlerrm;
end $$;
rollback;

do $$
begin
  delete from public.fixture_conversation_subscriptions where fixture_id = 'a1000000-0000-0000-0000-000000000001';
  delete from public.fixture_conversation_participants where fixture_id = 'a1000000-0000-0000-0000-000000000001';
  delete from public.notifications where data->>'fixture_id' = 'a1000000-0000-0000-0000-000000000001';
  delete from public.fixture_messages where fixture_id = 'a1000000-0000-0000-0000-000000000001';
  delete from public.fixtures where id = 'a1000000-0000-0000-0000-000000000001';
exception when others then null;
end $$;
