-- THE NOTIFICATION CATALOGUE
--
-- Three promises, and they were all broken at once.
--
--   REGISTERED   Every type Ovalball emits has a row in
--                public.notification_types, so it belongs to a topic and a
--                person's preferences can actually govern it. Twenty-seven
--                did not, including fixture_cancelled.
--
--   HONEST       "Email available" on the account page means email is
--                actually on for that topic. It used to be a hand-kept
--                boolean, and fixture_updates already carried an ACTIVE
--                email event while its flag said false -- so Ovalball told
--                somebody email was "coming soon" for a topic it was already
--                mailing them about.
--
--   INDEPENDENT  Turning email off for a topic is a decision about EMAIL.
--                The in-app notification still arrives, because it is a
--                different channel and a different preference.
--
-- The first promise is now held by a foreign key rather than by diligence,
-- and this file proves the key actually bites. The second is held by deriving
-- readiness from the same email_events.active row Site Admin toggles, and
-- this file flips that row and watches the answer follow. The third has
-- always been the design; it is asserted here because a consolidation is
-- exactly when it would quietly stop being true.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_slug text := substr(gen_random_uuid()::text, 1, 8);
  v_person uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_n int;
  v_txt text;
  v_bool boolean;
  v_note uuid;
  v_topic text;
  v_event text;
begin

insert into auth.users (id, email, instance_id, aud, role) values
  (v_person,'nc-person-'||v_slug||'@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_other, 'nc-other-'||v_slug||'@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email)
select id, 'Cata', 'Logue', email from auth.users where email like 'nc-%'||v_slug||'%';

-- ==================================================================== A
-- REGISTRY INTEGRITY
-- ==================================================================== --

-- 1. Every registered type belongs to a topic that exists. A type filed under
--    a topic nothing creates is invisible on the account page, so its
--    preference can never be expressed.
select count(*) into v_n
from public.notification_types nt
left join public.notification_topics t on t.key = nt.topic_key
where t.key is null;
if v_n = 0 then
  raise notice 'PASS 1 (A): every registered notification type belongs to a topic that exists';
else
  raise notice 'FAIL 1 (A): % type(s) claim a topic no migration creates', v_n;
end if;

-- 2. No notification row carries a type outside the registry. This is what
--    the foreign key guarantees going forward; asserting it here catches a
--    key that was dropped rather than a type that was added.
select count(*) into v_n
from public.notifications n
left join public.notification_types nt on nt.type_key = n.type
where nt.type_key is null;
if v_n = 0 then
  raise notice 'PASS 2 (A): no stored notification carries an unregistered type';
else
  raise notice 'FAIL 2 (A): % stored notification(s) carry an unregistered type', v_n;
end if;

-- 3. The constraint itself is present and is a foreign key to the registry.
select count(*) into v_n
from pg_constraint c
join pg_class t on t.oid = c.conrelid
where t.relname = 'notifications'
  and c.conname = 'notifications_type_registered'
  and c.contype = 'f';
if v_n = 1 then
  raise notice 'PASS 3 (A): notifications.type is a foreign key into the registry';
else
  raise notice 'FAIL 3 (A): the notifications_type_registered foreign key is not present';
end if;

-- 4. AND IT BITES. Not "a constraint exists" -- an unregistered type is
--    actually refused, at the insert, before anything reaches a person.
begin
  insert into public.notifications (user_id, type, title, body, data)
  values (v_person, 'a_type_nobody_registered_'||v_slug, 'T', 'B', '{}'::jsonb);
  raise notice 'FAIL 4 (A): an unregistered notification type was accepted';
exception when foreign_key_violation then
  raise notice 'PASS 4 (A): emitting an unregistered type is refused by the database';
end;

-- 5. The types this consolidation registered are really there, including the
--    two a hand audit missed because their literal sits nowhere near the
--    insert that emits it.
select count(*) into v_n
from public.notification_types
where type_key in (
  'fixture_cancelled',
  'gocardless_membership_cancelled',
  'training_attendance_reminder',
  'directory_request_submitted'
);
if v_n = 4 then
  raise notice 'PASS 5 (A): fixture_cancelled, the TypeScript-only type and both late finds are registered';
else
  raise notice 'FAIL 5 (A): only % of the 4 named types are registered', v_n;
end if;

-- 6. Every emitted type has somewhere to go. The destination map lives in
--    TypeScript, so this asserts the database half of the contract: the
--    structural guard scripts/verify-notification-catalogue.mjs compares the
--    two mechanically and fails the build if they diverge.
select count(*) into v_n from public.notification_types;
if v_n >= 60 then
  raise notice 'PASS 6 (A): the registry describes the whole catalogue (% types)', v_n;
else
  raise notice 'FAIL 6 (A): the registry has shrunk to % types -- something was removed rather than routed', v_n;
end if;

-- ==================================================================== B
-- CHANNEL READINESS IS DERIVED, NOT DECLARED
-- ==================================================================== --

-- 7. The stale hand-kept booleans are gone from the table. A column left
--    behind is a column somebody selects.
select count(*) into v_n
from information_schema.columns
where table_schema = 'public' and table_name = 'notification_topics'
  and column_name in ('email_ready', 'push_ready');
if v_n = 0 then
  raise notice 'PASS 7 (B): notification_topics no longer stores email_ready/push_ready';
else
  raise notice 'FAIL 7 (B): % stale readiness column(s) remain on notification_topics', v_n;
end if;

-- 8. The view exists and covers every topic. A topic missing from it would
--    simply vanish from the account page.
select count(*) into v_n from public.notification_topic_channels;
select (select count(*) from public.notification_topic_channels)
     = (select count(*) from public.notification_topics)
into v_bool;
if v_bool then
  raise notice 'PASS 8 (B): notification_topic_channels covers every topic (%)', v_n;
else
  raise notice 'FAIL 8 (B): the channels view and the topics table disagree on how many topics exist';
end if;

-- 9. email_ready FOLLOWS THE REAL SWITCH. Pick a topic with an email event,
--    turn the event off, and the account page's answer changes with it --
--    which is the whole point of deriving rather than storing.
select e.topic_key, e.event_key into v_topic, v_event
from public.email_events e
where e.topic_key is not null and e.active
order by e.event_key
limit 1;

if v_topic is null then
  raise notice 'FAIL 9 (B): no active topic-bound email event exists to test readiness against';
else
  select email_ready into v_bool from public.notification_topic_channels where key = v_topic;
  if not v_bool then
    raise notice 'FAIL 9 (B): topic % has an active email event but reads as not email-ready', v_topic;
  else
    update public.email_events set active = false where topic_key = v_topic;
    select email_ready into v_bool from public.notification_topic_channels where key = v_topic;
    if v_bool then
      raise notice 'FAIL 9 (B): switching every email event off for % left it reading as email-ready', v_topic;
    else
      update public.email_events set active = true where event_key = v_event;
      select email_ready into v_bool from public.notification_topic_channels where key = v_topic;
      if v_bool then
        raise notice 'PASS 9 (B): email_ready tracks email_events.active in both directions for topic %', v_topic;
      else
        raise notice 'FAIL 9 (B): switching an email event back on for % did not restore email-ready', v_topic;
      end if;
    end if;
  end if;
end if;

-- 10. push_ready is honest. There is no push infrastructure in this product,
--     and no topic may claim otherwise -- "coming soon" that never comes is
--     the failure this replaced.
select count(*) into v_n from public.notification_topic_channels where push_ready;
if v_n = 0 then
  raise notice 'PASS 10 (B): no topic claims push readiness, because no push channel exists';
else
  raise notice 'FAIL 10 (B): % topic(s) claim push is ready', v_n;
end if;

-- ==================================================================== C
-- EMAIL OFF, IN-APP ON: THE CHANNELS ARE INDEPENDENT
-- ==================================================================== --

-- The two channels are decided in different places, and that IS the
-- independence. In-app delivery is decided by internal.should_deliver_-
-- notification, which the notifications insert trigger consults. Email
-- delivery is decided by the email policy engine, from email_events.active
-- and the recipient's own email preference -- which is why
-- should_deliver_notification answers `false` for the email channel for
-- everything: it is not the authority on email and does not pretend to be.
-- The assertions below check that neither authority can move the other.

select nt.type_key, nt.topic_key into v_txt, v_topic
from public.notification_types nt
join public.notification_topics t on t.key = nt.topic_key
join public.email_events e on e.topic_key = t.key
where not t.mandatory
order by nt.type_key
limit 1;

-- 11. EMAIL OFF DOES NOT MEAN IN-APP OFF. Switch every email event for the
--     topic off -- the same switch Site Admin flips -- and the in-app
--     notification still arrives, because it was never an email decision.
insert into public.notification_preferences (user_id, topic_key, in_app_enabled, email_enabled)
values (v_person, v_topic, true, false)
on conflict (user_id, topic_key) do update set in_app_enabled = true, email_enabled = false;

update public.email_events set active = false where topic_key = v_topic;

insert into public.notifications (user_id, type, title, body, data)
values (v_person, v_txt, 'Channel independence', 'In-app arrives with email switched off.', '{}'::jsonb);
get diagnostics v_n = row_count;

if v_n = 1 and internal.should_deliver_notification(v_person, v_txt, 'in_app') then
  raise notice 'PASS 11 (C): with every email event for % switched off, the in-app notification still arrives', v_topic;
else
  raise notice 'FAIL 11 (C): switching email off for % suppressed the in-app notification', v_topic;
end if;

-- 12. AND IN-APP OFF DOES NOT MEAN EMAIL OFF. The person switches the in-app
--     notification off; the topic's email events are untouched, so the email
--     channel's own answer is unchanged.
update public.email_events set active = true where topic_key = v_topic;
update public.notification_preferences
set in_app_enabled = false
where user_id = v_person and topic_key = v_topic;

select email_ready into v_bool from public.notification_topic_channels where key = v_topic;

insert into public.notifications (user_id, type, title, body, data)
values (v_person, v_txt, 'Suppressed', 'This should not be stored.', '{}'::jsonb);
get diagnostics v_n = row_count;

if v_n = 0 and v_bool then
  raise notice 'PASS 12 (C): switching the in-app notification off suppressed it and left email for % on', v_topic;
else
  raise notice 'FAIL 12 (C): in-app suppression stored % row(s) and left email readiness at %', v_n, v_bool;
end if;

-- 13. A MANDATORY topic cannot be switched off on any channel. A failed
--     Direct Debit has to reach the person whose payment it was.
select nt.type_key into v_txt
from public.notification_types nt
join public.notification_topics t on t.key = nt.topic_key
where t.mandatory
order by nt.type_key
limit 1;

select t.key into v_topic
from public.notification_types nt
join public.notification_topics t on t.key = nt.topic_key
where nt.type_key = v_txt;

insert into public.notification_preferences (user_id, topic_key, in_app_enabled, email_enabled)
values (v_person, v_topic, false, false)
on conflict (user_id, topic_key) do update set in_app_enabled = false, email_enabled = false;

if internal.should_deliver_notification(v_person, v_txt, 'in_app')
   and internal.should_deliver_notification(v_person, v_txt, 'email') then
  raise notice 'PASS 13 (C): a mandatory topic (%) is delivered even when the person has switched it off', v_topic;
else
  raise notice 'FAIL 13 (C): mandatory topic % was suppressed by a preference', v_topic;
end if;

delete from public.notification_preferences where user_id = v_person;

-- ==================================================================== D
-- READING A NOTIFICATION, AND NOT READING SOMEBODY ELSE'S
-- ==================================================================== --

insert into public.notifications (user_id, type, title, body, data)
values (v_person, 'fixture_cancelled', 'Fixture cancelled', 'The game is off.',
        jsonb_build_object('fixture_id', gen_random_uuid()))
returning id into v_note;

perform set_config('role','authenticated',true);
perform set_config('request.jwt.claims', json_build_object('sub', v_person, 'role','authenticated')::text, true);

-- 14. A person can read their own notification.
select count(*) into v_n from public.notifications where id = v_note;
if v_n = 1 then
  raise notice 'PASS 14 (D): a person can see their own notification';
else
  raise notice 'FAIL 14 (D): a person cannot see their own notification';
end if;

-- 15. And mark it read.
update public.notifications set read_at = now() where id = v_note;
select read_at is not null into v_bool from public.notifications where id = v_note;
if v_bool then
  raise notice 'PASS 15 (D): a person can mark their own notification read';
else
  raise notice 'FAIL 15 (D): marking a notification read did not take';
end if;

-- 16. SOMEBODY ELSE'S NOTIFICATION IS NOT VISIBLE, and marking it read is not
--     an update that finds no row by accident -- there is no row to find.
perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role','authenticated')::text, true);
select count(*) into v_n from public.notifications where id = v_note;
if v_n = 0 then
  raise notice 'PASS 16 (D): another person''s notification is not visible';
else
  raise notice 'FAIL 16 (D): another person''s notification was readable';
end if;

update public.notifications set read_at = null where id = v_note;
get diagnostics v_n = row_count;
if v_n = 0 then
  raise notice 'PASS 17 (D): another person''s notification cannot be marked unread';
else
  raise notice 'FAIL 17 (D): % row(s) of another person''s notifications were updated', v_n;
end if;

-- 18. AND THE BODY IS NOT EDITABLE. Marking read is the only permitted
--     update: a notification is a record of what was said, not a document.
perform set_config('request.jwt.claims', json_build_object('sub', v_person, 'role','authenticated')::text, true);
begin
  update public.notifications set title = 'Rewritten' where id = v_note;
  raise notice 'FAIL 18 (D): a notification''s title was rewritten after it was sent';
exception when others then
  raise notice 'PASS 18 (D): a notification''s content cannot be rewritten after sending';
end;

perform set_config('role','postgres',true);

end $$;

rollback;
