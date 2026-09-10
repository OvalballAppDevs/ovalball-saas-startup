-- ONE UNREAD TRUTH
--
-- WHAT WAS WRONG
--
-- Three badges sat in the same header and counted the same rows:
--
--   the bell     every unread notification, whatever its type
--   Messages     unread new_fixture_message notifications
--   Support      unread support_ticket_update notifications
--
-- So an unread fixture message was counted twice -- beside the speech bubble
-- and again beside the bell -- and so was every support reply. A person who
-- cleared their messages watched the bell refuse to move, because the bell
-- had been counting the messages they had just read.
--
-- THE RULE THIS FILE PINS
--
--   A badge counts the things a person will find when they press it.
--   Every unread notification is counted by EXACTLY ONE badge.
--   The three buckets partition the unread set; they never overlap it.
--
-- AND THE SPLIT COMES FROM THE REGISTRY. public.notification_types already
-- says which topic a type belongs to, so a type in the `messages` topic is
-- Messenger's by definition. That matters twice over: the badge counts by
-- topic, and so do the two lists those badges open. Both had drifted from
-- their own number: the conversation list counted one type where the badge
-- counted four, and the bell's panel listed six notifications under a badge
-- reading three, because it showed the messages belonging to the badge next
-- door. A badge and the list it opens are two readings of one definition.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_slug text := substr(gen_random_uuid()::text, 1, 8);
  v_person uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();

  v_fixture_a uuid := gen_random_uuid();
  v_fixture_b uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_club_conversation uuid := gen_random_uuid();

  v_counts record;
  v_n int;
  v_sum int;
  v_note uuid;
begin

insert into auth.users (id, email, instance_id, aud, role) values
  (v_person,'ut-person-'||v_slug||'@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_other, 'ut-other-'||v_slug||'@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email)
select id, 'Un', 'Read', email from auth.users where email like 'ut-%'||v_slug||'%';

-- ------------------------------------------------------------------ setup
-- A realistic unread pile, deliberately spanning all three badges and all
-- four `messages` types -- because the defect this replaces was invisible
-- until more than one message type was unread at the same time.
insert into public.notifications (user_id, type, title, body, data) values
  -- Messenger: four types, one topic.
  (v_person,'new_fixture_message','A message','Body', jsonb_build_object('fixture_id', v_fixture_a)),
  (v_person,'new_fixture_message','A message','Body', jsonb_build_object('fixture_id', v_fixture_a)),
  (v_person,'new_fixture_message','A message','Body', jsonb_build_object('fixture_request_id', v_request)),
  (v_person,'fixture_staff_message','Staff note','Body', jsonb_build_object('fixture_id', v_fixture_b)),
  (v_person,'club_message_request_received','A club wrote','Body', jsonb_build_object('club_conversation_id', v_club_conversation)),
  -- Support: its own control, its own destination.
  (v_person,'support_ticket_update','Ticket updated','Body', jsonb_build_object('support_ticket_id', gen_random_uuid())),
  (v_person,'support_ticket_update','Ticket updated','Body', jsonb_build_object('support_ticket_id', gen_random_uuid())),
  -- The bell: everything else.
  (v_person,'fixture_cancelled','Fixture cancelled','Body', jsonb_build_object('fixture_id', v_fixture_a)),
  (v_person,'training_session_cancelled','Training cancelled','Body', jsonb_build_object('training_session_id', gen_random_uuid())),
  (v_person,'club_join_approved','Approved','Body','{}'::jsonb),
  -- Already read: counted by nobody.
  (v_person,'fixture_cancelled','Old news','Body','{}'::jsonb);

update public.notifications set read_at = now()
where user_id = v_person and title = 'Old news';

-- Somebody else's pile, to prove it never leaks into these numbers.
insert into public.notifications (user_id, type, title, body, data) values
  (v_other,'new_fixture_message','Not yours','Body', jsonb_build_object('fixture_id', v_fixture_a)),
  (v_other,'support_ticket_update','Not yours','Body','{}'::jsonb),
  (v_other,'fixture_cancelled','Not yours','Body','{}'::jsonb);

perform set_config('role','authenticated',true);
perform set_config('request.jwt.claims', json_build_object('sub', v_person, 'role','authenticated')::text, true);

select * into v_counts from public.my_unread_counts();

-- ==================================================================== A
-- THE PARTITION
-- ==================================================================== --

-- 1. Every unread notification is counted exactly once, across the three
--    badges. This is the whole claim: the buckets add up to the total,
--    neither more (double counting) nor less (a notification no badge shows).
if v_counts.notifications + v_counts.messages + v_counts.support = v_counts.total then
  raise notice 'PASS 1 (A): the three badges partition the unread set (% + % + % = %)',
    v_counts.notifications, v_counts.messages, v_counts.support, v_counts.total;
else
  raise notice 'FAIL 1 (A): % + % + % does not equal the total of %',
    v_counts.notifications, v_counts.messages, v_counts.support, v_counts.total;
end if;

-- 2. And the total is the real number of unread rows -- not a figure the
--    function arrived at by its own arithmetic.
select count(*) into v_n
from public.notifications where user_id = v_person and read_at is null;
if v_counts.total = v_n then
  raise notice 'PASS 2 (A): the total matches the % unread rows actually stored', v_n;
else
  raise notice 'FAIL 2 (A): the function reports % unread against % stored rows', v_counts.total, v_n;
end if;

-- 3. THE BELL DOES NOT COUNT MESSAGES. This is the defect itself: before, the
--    bell counted every unread row including the five in the Messenger badge.
select count(*) into v_n
from public.notifications n
join public.notification_types t on t.type_key = n.type
where n.user_id = v_person and n.read_at is null and t.topic_key = 'messages';
if v_counts.messages = v_n and v_counts.notifications = v_counts.total - v_n - v_counts.support then
  raise notice 'PASS 3 (A): the Messenger badge holds all % message notifications and the bell holds none of them', v_n;
else
  raise notice 'FAIL 3 (A): messages badge=% actual=% -- the bell is still counting messages', v_counts.messages, v_n;
end if;

-- 4. THE BELL DOES NOT COUNT SUPPORT EITHER.
select count(*) into v_n
from public.notifications
where user_id = v_person and read_at is null and type = 'support_ticket_update';
if v_counts.support = v_n then
  raise notice 'PASS 4 (A): the Support control holds all % support notifications', v_n;
else
  raise notice 'FAIL 4 (A): support badge=% actual=%', v_counts.support, v_n;
end if;

-- 5. The bell holds exactly what is left, and it is not zero -- a partition
--    that works by emptying one bucket proves nothing.
if v_counts.notifications = 3 then
  raise notice 'PASS 5 (A): the bell holds the 3 notifications no other badge surfaces';
else
  raise notice 'FAIL 5 (A): the bell holds % where 3 were left for it', v_counts.notifications;
end if;

-- ==================================================================== B
-- THE SPLIT COMES FROM THE REGISTRY, NOT FROM A LIST OF NAMES
-- ==================================================================== --

-- 6. All four `messages` types land in the Messenger badge. Counting only
--    new_fixture_message would give 3 here, not 5 -- which is exactly what
--    the badge used to do.
if v_counts.messages = 5 then
  raise notice 'PASS 6 (B): all four message types are counted by topic, not by one type name (5)';
else
  raise notice 'FAIL 6 (B): the Messenger badge counted % of the 5 unread message notifications', v_counts.messages;
end if;

-- 7. AND THE LIST COUNTS WHAT THE BADGE COUNTS. The conversation list builds
--    its per-conversation unread from the same registry-driven source, so the
--    numbers beside the conversations add up to the number on the badge.
select coalesce(sum(unread), 0) into v_sum from public.my_unread_message_counts();
if v_sum = v_counts.messages then
  raise notice 'PASS 7 (B): the per-conversation counts sum to the badge (% = %)', v_sum, v_counts.messages;
else
  raise notice 'FAIL 7 (B): the conversation list sums to % beside a badge reading %', v_sum, v_counts.messages;
end if;

-- 8. And they are attributed to the right conversations, so pressing the
--    badge lands on something that is actually unread.
select count(*) into v_n from public.my_unread_message_counts()
where fixture_id = v_fixture_a and unread = 2;
if v_n = 1 then
  raise notice 'PASS 8 (B): the two unread messages on one fixture are attributed to that fixture';
else
  raise notice 'FAIL 8 (B): the fixture with two unread messages is not reported with a count of 2';
end if;

select count(*) into v_n from public.my_unread_message_counts()
where club_conversation_id = v_club_conversation;
if v_n = 1 then
  raise notice 'PASS 9 (B): a club message request is attributed to its club conversation';
else
  raise notice 'FAIL 9 (B): the club conversation''s unread message is unattributed';
end if;

-- 10. THE BELL LISTS WHAT THE BELL COUNTS. The badge read 3 while the panel
--     it opens listed 6 -- the three it counts plus the three messages
--     belonging to the badge next door. The number and the list contradicted
--     each other on screen, a few pixels apart.
select count(*) into v_n from public.my_bell_notifications(50) where read_at is null;
if v_n = v_counts.notifications then
  raise notice 'PASS 10 (B): the bell''s panel holds exactly what its badge counts (%)', v_n;
else
  raise notice 'FAIL 10 (B): the bell lists % unread beside a badge reading %', v_n, v_counts.notifications;
end if;

-- 11. And it lists none of the other badges' notifications, read or unread.
select count(*) into v_n
from public.my_bell_notifications(50) b
left join public.notification_types t on t.type_key = b.type
where t.topic_key = 'messages' or b.type = 'support_ticket_update';
if v_n = 0 then
  raise notice 'PASS 11 (B): the bell''s panel shows no message or support notification';
else
  raise notice 'FAIL 11 (B): the bell''s panel listed % notification(s) belonging to another badge', v_n;
end if;

-- ==================================================================== C
-- READING SOMETHING MOVES EXACTLY ONE NUMBER
-- ==================================================================== --

-- 12. Read a message: the Messenger badge and the total go down, and the bell
--     -- which was never counting it -- does not move. This is the moment the
--     old behaviour was visible to a person.
select id into v_note from public.notifications
where user_id = v_person and type = 'new_fixture_message' and read_at is null
order by created_at limit 1;
update public.notifications set read_at = now() where id = v_note;

declare
  v_after record;
begin
  select * into v_after from public.my_unread_counts();
  if v_after.messages = v_counts.messages - 1
     and v_after.total = v_counts.total - 1
     and v_after.notifications = v_counts.notifications
     and v_after.support = v_counts.support then
    raise notice 'PASS 12 (C): reading a message moved the Messenger badge and the total, and left the bell alone';
  else
    raise notice 'FAIL 12 (C): after reading one message the counts read n=% m=% s=% total=%',
      v_after.notifications, v_after.messages, v_after.support, v_after.total;
  end if;

  -- 13. And the list follows it down in step with the badge.
  select coalesce(sum(unread), 0) into v_sum from public.my_unread_message_counts();
  if v_sum = v_after.messages then
    raise notice 'PASS 13 (C): the conversation list follows the badge down together (%)', v_sum;
  else
    raise notice 'FAIL 13 (C): list=% badge=% after reading one message', v_sum, v_after.messages;
  end if;

  -- 14. Read a support reply: Support and the total move, nothing else does.
  select id into v_note from public.notifications
  where user_id = v_person and type = 'support_ticket_update' and read_at is null
  order by created_at limit 1;
  update public.notifications set read_at = now() where id = v_note;

  declare
    v_final record;
  begin
    select * into v_final from public.my_unread_counts();
    if v_final.support = v_after.support - 1
       and v_final.total = v_after.total - 1
       and v_final.notifications = v_after.notifications
       and v_final.messages = v_after.messages then
      raise notice 'PASS 14 (C): reading a support reply moved only the Support control and the total';
    else
      raise notice 'FAIL 14 (C): after reading one support reply the counts read n=% m=% s=% total=%',
        v_final.notifications, v_final.messages, v_final.support, v_final.total;
    end if;
  end;
end;

-- ==================================================================== D
-- THE COUNTS ARE THE CALLER'S OWN
-- ==================================================================== --

-- 15. Another person's unread pile is not in these numbers, and this is
--     asserted from the other side too: the same function called as them
--     returns their pile, not this one's.
perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role','authenticated')::text, true);
select * into v_counts from public.my_unread_counts();
if v_counts.total = 3 and v_counts.messages = 1 and v_counts.support = 1 and v_counts.notifications = 1 then
  raise notice 'PASS 15 (D): the counts are the caller''s own -- the other person sees their 3, not this one''s';
else
  raise notice 'FAIL 15 (D): another user''s counts read n=% m=% s=% total=%',
    v_counts.notifications, v_counts.messages, v_counts.support, v_counts.total;
end if;

-- 16. And the per-conversation counts are scoped the same way. A function
--     that is security definer has to be asked who is calling; one that
--     forgets returns everybody's messages to everybody.
select coalesce(sum(unread), 0) into v_sum from public.my_unread_message_counts();
if v_sum = 1 then
  raise notice 'PASS 16 (D): the per-conversation counts are the caller''s own';
else
  raise notice 'FAIL 16 (D): another person''s conversation counts summed to %', v_sum;
end if;

perform set_config('role','postgres',true);

end $$;

rollback;
