-- Announcements reach the Messenger badge AND the Messenger list
-- (20270245000000, 20270250000000).
--
-- THE DEFECT THIS PINS DOWN. An announcement was registered under the
-- 'messages' notification topic, so it correctly counted on the Messenger
-- badge -- but nothing put it in the conversation LIST. A recipient therefore
-- saw "1 unread message" over an inbox reading "No conversations yet", with
-- nowhere to tap. A badge that points at nothing is worse than no badge: it
-- spends the person's attention and gives nothing back.
--
-- Also proved: it counts on the Messenger badge and NOT also on the bell (the
-- double count the unread-truth work removed), the notification and the inbox
-- row attribute the announcement to the same sender, and reading it clears
-- both together so the two can never disagree.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/announcement_unread_surfaces.sql
--
-- Wrapped in a transaction and rolled back: it writes nothing to the shared
-- local UAT database.

\set ON_ERROR_STOP off
\pset pager off

begin;

do $$
declare
  v_admin uuid; v_team uuid; v_ann uuid; v_g uuid;
  c record; r record; n integer; v_title text; v_label text;
begin
  select id into v_admin from auth.users where email = 'uat.team.admin@ovalball.test';
  if v_admin is null then
    raise notice 'SKIP: the UAT identities this suite reads are not present in this database';
    return;
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  select id into v_team from public.teams
  where internal.can_address_team_audience(id) order by id limit 1;
  if v_team is null then
    raise notice 'SKIP: no team in this database that the UAT team admin may address';
    return;
  end if;

  v_ann := public.create_announcement('team', v_team, 'team', v_team,
    'The clubhouse is open early on Saturday.', 'Saturday Opening');
  perform public.send_announcement(v_ann);

  perform set_config('role', 'postgres', true);
  select recipient_user_id into v_g
  from public.messenger_announcement_deliveries where announcement_id = v_ann limit 1;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_g, 'role', 'authenticated')::text, true);

  -- 1. THE MESSENGER BADGE, because an announcement IS a message.
  select * into c from public.my_unread_counts();
  if c.messages >= 1 then
    raise notice 'PASS 1: the announcement counts on the Messenger badge (messages=%)', c.messages;
  else
    raise notice 'FAIL 1: messages=%, notifications=%', c.messages, c.notifications;
  end if;

  -- 2. AND NOT ALSO THE BELL. Counting it twice is the defect the unread
  -- truth work removed; it must not come back through a new type.
  select count(*) into n from public.my_bell_notifications(50) where type = 'announcement_received';
  if n = 0 then
    raise notice 'PASS 2: it does not also appear on the bell -- no double count';
  else
    raise notice 'FAIL 2: the bell also carried % announcement row(s)', n;
  end if;

  -- 3. AND IT IS IN THE LIST, so the badge has somewhere to point.
  select * into r from public.my_announcements(30) where announcement_id = v_ann;
  if r.announcement_id is not null then
    raise notice 'PASS 3: the announcement appears in the Messenger list';
  else
    raise notice 'FAIL 3: the badge counted it but the list does not contain it';
  end if;

  -- 4. Named as the TEAM, from the canonical name authority.
  if r.sender_label = (select display_name from public.teams where id = v_team) then
    raise notice 'PASS 4: the list row names the team (%), not the person who pressed Send', r.sender_label;
  else
    raise notice 'FAIL 4: the list row said %', coalesce(r.sender_label, '(nothing)');
  end if;

  if r.read_at is null then
    raise notice 'PASS 5: the list row is unread, so the badge and the list agree';
  else
    raise notice 'FAIL 5: delivered and already marked read';
  end if;

  -- 6. THE NOTIFICATION AND THE LIST ROW MUST NOT DISAGREE ABOUT WHO SPOKE.
  perform set_config('role', 'postgres', true);
  select title into v_title from public.notifications
  where user_id = v_g and type = 'announcement_received'
    and (data ->> 'announcement_id') = v_ann::text limit 1;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_g, 'role', 'authenticated')::text, true);

  select sender_label into v_label from public.my_announcements(30) where announcement_id = v_ann;
  if v_title = v_label then
    raise notice 'PASS 6: the notification and the list row attribute it identically (%)', v_title;
  else
    raise notice 'FAIL 6: notification says "%", list says "%"', v_title, v_label;
  end if;

  -- 7. READING CLEARS BOTH TOGETHER.
  --
  -- ASSERTED AS A DELTA, NOT A GLOBAL ZERO. This recipient is a real UAT
  -- person who may legitimately have other unread conversations that have
  -- nothing to do with this announcement, so "messages = 0" was never the
  -- product invariant -- it was an assumption that the whole database had
  -- been cleaned first, and it failed the moment an unrelated club
  -- conversation was left unread by another session.
  --
  -- What the product actually promises is that reading THIS announcement
  -- removes exactly THIS announcement's contribution from the badge, and
  -- sets the list row's read_at, so the two surfaces cannot disagree.
  select messages into n from public.my_unread_counts();
  perform public.mark_announcement_read(v_ann);
  select * into c from public.my_unread_counts();
  select * into r from public.my_announcements(30) where announcement_id = v_ann;
  if r.read_at is not null and c.messages = n - 1 then
    raise notice 'PASS 7: reading it clears the list row and its own badge count together (% -> %)',
      n, c.messages;
  else
    raise notice 'FAIL 7: read_at=%, badge went % -> % (expected %)',
      r.read_at, n, c.messages, n - 1;
  end if;

  -- 8. AND IT CLEARS ONLY ITS OWN. An unrelated unread conversation must
  -- survive reading an announcement -- the regression that makes the delta
  -- above meaningful rather than merely permissive.
  if c.messages = n - 1 then
    raise notice 'PASS 8: unrelated unread conversations are left alone (% remain)', c.messages;
  else
    raise notice 'FAIL 8: reading one announcement changed unrelated unread (% -> %)', n, c.messages;
  end if;
end $$;

rollback;
