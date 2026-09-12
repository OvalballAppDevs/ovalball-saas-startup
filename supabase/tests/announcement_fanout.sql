-- Composing and sending an announcement (20270245000000).
--
-- The two properties a fan-out lives or dies on:
--
--   IDEMPOTENCE   pressing Send twice finishes sending; it does not send
--                 twice. Proved by running send_announcement again and
--                 asserting the delivery and notification counts are
--                 unchanged -- and by deleting one delivery to simulate an
--                 interrupted run and asserting the re-run repairs exactly
--                 that gap.
--
--   LATE BINDING  the audience is resolved at SEND, not at compose, so a
--                 draft written before somebody joined still reaches them.
--
-- Plus: the notification carries no audience, a recipient's unread badge
-- tracks their own copy, and neither compose nor send can reach an audience
-- the sender may not address.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/announcement_fanout.sql
--
-- Wrapped in a transaction and rolled back: it writes nothing to the shared
-- local UAT database.

\set ON_ERROR_STOP off
\pset pager off

begin;

do $$
declare
  v_admin uuid;
  v_outsider uuid;
  v_team uuid;
  v_ann uuid;
  v_sent integer;
  v_again integer;
  v_deliveries integer;
  v_notifications integer;
  v_recipient uuid;
  v_removed uuid;
  v_label text;
  v_data jsonb;
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

  -- =================================================================
  -- 1. COMPOSE
  -- =================================================================
  v_ann := public.create_announcement(
    'team', v_team, 'team', v_team,
    'Training on Thursday is moved to the top pitch.', 'Thursday Training',
    'PRIVATE_REPLY');

  if exists (select 1 from public.messenger_announcements
             where id = v_ann and status = 'draft' and fanout_state = 'pending') then
    raise notice 'PASS 1: composing creates a draft that has not been sent to anybody';
  else
    raise notice 'FAIL 1: a freshly composed announcement was not a pending draft';
  end if;

  if not exists (select 1 from public.messenger_announcement_deliveries where announcement_id = v_ann) then
    raise notice 'PASS 2: a draft has no deliveries -- the audience is not resolved at compose time';
  else
    raise notice 'FAIL 2: composing already wrote delivery rows';
  end if;

  -- =================================================================
  -- 2. SEND
  -- =================================================================
  v_sent := public.send_announcement(v_ann);
  select count(*) into v_deliveries
  from public.messenger_announcement_deliveries where announcement_id = v_ann;
  -- Counted with RLS out of the way, because this is ACCOUNTING: the
  -- question is how many rows exist, not how many this reader may see.
  -- What the sender may see is asserted separately, at test 8b.
  perform set_config('role', 'postgres', true);
  select count(*) into v_notifications
  from public.notifications
  where type = 'announcement_received' and (data ->> 'announcement_id') = v_ann::text;
  perform set_config('role', 'authenticated', true);

  if v_sent > 0 and v_sent = v_deliveries then
    raise notice 'PASS 3: sending resolved and delivered to % recipients', v_sent;
  else
    raise notice 'FAIL 3: send reported % but % delivery rows exist', v_sent, v_deliveries;
  end if;

  if v_notifications = v_deliveries then
    raise notice 'PASS 4: every delivery produced exactly one notification';
  else
    raise notice 'FAIL 4: % deliveries but % notifications', v_deliveries, v_notifications;
  end if;

  if exists (select 1 from public.messenger_announcements
             where id = v_ann and status = 'sent' and fanout_state = 'complete'
               and resolved_recipient_count = v_deliveries) then
    raise notice 'PASS 5: the announcement records what it actually reached';
  else
    raise notice 'FAIL 5: the announcement''s recorded state does not match its deliveries';
  end if;

  -- =================================================================
  -- 3. IDEMPOTENCE -- THE PROPERTY THAT MATTERS
  -- =================================================================
  v_again := public.send_announcement(v_ann);
  perform set_config('role', 'postgres', true);
  if v_again = v_sent
     and (select count(*) from public.messenger_announcement_deliveries where announcement_id = v_ann) = v_deliveries
     and (select count(*) from public.notifications
          where type = 'announcement_received' and (data ->> 'announcement_id') = v_ann::text) = v_notifications then
    raise notice 'PASS 6: pressing Send again delivers to nobody twice';
  else
    raise notice 'FAIL 6: a second send changed the delivery or notification count';
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- 6b. An INTERRUPTED fan-out is repaired by the same second press.
  select recipient_user_id into v_removed
  from public.messenger_announcement_deliveries where announcement_id = v_ann limit 1;
  perform set_config('role', 'postgres', true);
  delete from public.messenger_announcement_deliveries
  where announcement_id = v_ann and recipient_user_id = v_removed;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  perform public.send_announcement(v_ann);
  perform set_config('role', 'postgres', true);
  if (select count(*) from public.messenger_announcement_deliveries where announcement_id = v_ann) = v_deliveries
     and exists (select 1 from public.messenger_announcement_deliveries
                 where announcement_id = v_ann and recipient_user_id = v_removed) then
    raise notice 'PASS 6b: re-running an interrupted send completes exactly the missing recipient';
  else
    raise notice 'FAIL 6b: the interrupted fan-out was not repaired correctly';
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- =================================================================
  -- 4. WHAT THE RECIPIENT IS TOLD
  -- =================================================================
  perform set_config('role', 'postgres', true);
  select recipient_user_id into v_recipient
  from public.messenger_announcement_deliveries where announcement_id = v_ann limit 1;
  perform set_config('role', 'authenticated', true);

  -- 8b. THE SENDER CANNOT READ THE RECIPIENT'S COPY. Asserted before
  -- reading it as the recipient, because the whole point of resolving this
  -- as N private rows is that the sender's session cannot enumerate them.
  if not exists (
    select 1 from public.notifications
    where user_id = v_recipient and type = 'announcement_received'
      and (data ->> 'announcement_id') = v_ann::text
  ) then
    raise notice 'PASS 8b: the sender cannot read a recipient''s own notification row';
  else
    raise notice 'FAIL 8b: the sender could read a recipient''s notification';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_recipient, 'role', 'authenticated')::text, true);
  select title, data into v_label, v_data from public.notifications
  where user_id = v_recipient and type = 'announcement_received'
    and (data ->> 'announcement_id') = v_ann::text limit 1;

  if v_label = (select display_name from public.teams where id = v_team) then
    raise notice 'PASS 7: the recipient is told the TEAM said this, not which volunteer pressed Send';
  else
    raise notice 'FAIL 7: the notification was attributed to "%"', coalesce(v_label, '(nothing)');
  end if;

  if not (v_data ? 'recipient_count' or v_data ? 'recipients' or v_data ? 'audience') then
    raise notice 'PASS 8: the notification carries no audience and no recipient count';
  else
    raise notice 'FAIL 8: the notification leaked audience information: %', v_data;
  end if;

  -- =================================================================
  -- 5. READING MY OWN COPY
  -- =================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_recipient, 'role', 'authenticated')::text, true);
  perform public.mark_announcement_read(v_ann);

  if (select read_at is not null from public.messenger_announcement_deliveries
      where announcement_id = v_ann and recipient_user_id = v_recipient)
     and not exists (select 1 from public.notifications
      where user_id = v_recipient and type = 'announcement_received'
        and (data ->> 'announcement_id') = v_ann::text and read_at is null) then
    raise notice 'PASS 9: reading marks the delivery and clears the badge together';
  else
    raise notice 'FAIL 9: the delivery record and the unread badge disagree after reading';
  end if;

  -- 9b. And reading MY copy is not reading anybody else's. Checked with RLS
  -- out of the way, because a recipient can only ever SEE their own row --
  -- the question here is what was WRITTEN, not what is visible.
  perform set_config('role', 'postgres', true);
  if exists (select 1 from public.messenger_announcement_deliveries
             where announcement_id = v_ann and recipient_user_id <> v_recipient and read_at is null) then
    raise notice 'PASS 9b: one person reading it does not mark it read for the others';
  else
    raise notice 'FAIL 9b: reading marked other recipients'' copies read (or there were none to check)';
  end if;
  perform set_config('role', 'authenticated', true);

  -- =================================================================
  -- 6. AUTHORITY, AT BOTH ENDS
  -- =================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  begin
    perform public.create_announcement('team', v_team, 'team', v_team, 'Not mine to send.');
    raise notice 'FAIL 10: an outsider composed an announcement as a team they do not run';
  exception when insufficient_privilege then
    raise notice 'PASS 10: an outsider cannot compose as a team they do not run';
  end;

  begin
    perform public.send_announcement(v_ann);
    raise notice 'FAIL 11: an outsider sent somebody else''s announcement';
  exception when insufficient_privilege then
    raise notice 'PASS 11: an outsider cannot send somebody else''s announcement';
  end;

  -- 12. A withdrawn announcement cannot be sent again.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.withdraw_announcement(v_ann);
  begin
    perform public.send_announcement(v_ann);
    raise notice 'FAIL 12: a withdrawn announcement was sent';
  exception when others then
    raise notice 'PASS 12: a withdrawn announcement cannot be sent';
  end;
end $$;

rollback;
