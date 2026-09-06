-- Support requests as a canonical conversation, and its boundary.
--
-- The reported problem was that a support request never appeared in
-- Messages. The audit found the conversation had always existed --
-- support_tickets (the case) + support_ticket_events (the thread) -- and
-- that Messages simply never read it. So these assertions pin the
-- properties that make surfacing it safe, and prove there is exactly ONE
-- reply store on each side.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin     uuid := gen_random_uuid();   -- Full Site Admin (support: manage)
  v_moderator uuid := gen_random_uuid();   -- message_moderator (support: none)
  v_requester uuid := gen_random_uuid();   -- Club Admin who raises the ticket
  v_colleague uuid := gen_random_uuid();   -- Club Admin at the SAME club
  v_outsider  uuid := gen_random_uuid();   -- Club Admin at a different club
  v_dir_a uuid; v_dir_b uuid; v_club_a uuid; v_club_b uuid;
  v_ticket uuid; v_ticket2 uuid;
  v_count int; v_int int; v_text text; v_ref text;
  v_events_before int; v_events_after int;
  v_notif_before int; v_notif_after int;
  v_ok boolean;
begin
  -- =================== fixtures ===================
  insert into auth.users (id, email, instance_id, aud, role) values
    (v_admin,     'supadmin@ovalball-test.invalid',  '00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_moderator, 'supmod@ovalball-test.invalid',    '00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_requester, 'supreq@ovalball-test.invalid',    '00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_colleague, 'supcolleague@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
    (v_outsider,  'supout@ovalball-test.invalid',    '00000000-0000-0000-0000-000000000000','authenticated','authenticated');

  insert into public.profiles (id, first_name, surname, email) values
    (v_admin,'Sup','Admin','supadmin@ovalball-test.invalid'),
    (v_moderator,'Sup','Mod','supmod@ovalball-test.invalid'),
    (v_requester,'Sup','Requester','supreq@ovalball-test.invalid'),
    (v_colleague,'Sup','Colleague','supcolleague@ovalball-test.invalid'),
    (v_outsider,'Sup','Outsider','supout@ovalball-test.invalid');

  insert into public.site_admins (user_id, admin_role, status) values
    (v_admin, 'full', 'active'),
    (v_moderator, 'message_moderator', 'active');

  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key) values
    ('Support Test RUFC','union','England','England','manual','verified','support-test'),
    ('Support Other RUFC','union','England','England','manual','verified','support-other');
  select id into v_dir_a from public.club_directory where normalized_key='support-test';
  select id into v_dir_b from public.club_directory where normalized_key='support-other';

  insert into public.clubs (directory_id, slug, status) values (v_dir_a,'support-test','active') returning id into v_club_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b,'support-other','active') returning id into v_club_b;

  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club_a, v_requester, 'CLUB_ADMIN', 'active'),
    (v_club_a, v_colleague, 'CLUB_ADMIN', 'active'),
    (v_club_b, v_outsider,  'CLUB_ADMIN', 'active');

  -- ============ A/B. one case, one thread, initial content once ============
  perform set_config('request.jwt.claims', json_build_object('sub', v_requester, 'role','authenticated')::text, true);
  select count(*) into v_notif_before from public.notifications;

  -- club_id is derived server-side from the requester's membership; the
  -- caller never asserts which club a request belongs to.
  -- Returns (ticket_id, reference), not a bare uuid.
  select t.id, t.reference into v_ticket, v_ref
  from public.create_support_ticket(
    'fixtures', 'Fixture will not save', 'The kickoff time reverts when I save.',
    null, null, null, '/fixtures'
  ) t;

  select count(*) into v_count from public.support_tickets where id = v_ticket;
  if v_count = 1 then
    raise notice 'PASS 1 (A): a support request creates exactly one canonical case';
  else
    raise notice 'FAIL 1 (A): % case rows', v_count;
  end if;

  select count(*) into v_count from public.support_ticket_events
  where ticket_id = v_ticket and event_type = 'created';
  if v_count = 1 then
    raise notice 'PASS 2 (B): the initial request is represented exactly once, in the thread';
  else
    raise notice 'FAIL 2 (B): % created events', v_count;
  end if;

  -- The thread is the ONLY reply store: no support columns anywhere in the
  -- club-to-club message architecture.
  select count(*)::int into v_count
  from information_schema.columns
  where table_schema='public' and table_name in ('fixture_messages','club_conversations')
    and column_name ilike '%support%';
  if v_count = 0 then
    raise notice 'PASS 3: support is not duplicated into the club/fixture message tables';
  else
    raise notice 'FAIL 3: % support column(s) leaked into club/fixture messaging', v_count;
  end if;

  -- ============ C/F. the requester participates and can read it ============
  select count(*) into v_count from public.support_tickets where id = v_ticket and created_by_user_id = v_requester;
  if v_count = 1 then
    raise notice 'PASS 4 (C): the requester is the case participant';
  else
    raise notice 'FAIL 4 (C): requester is not recorded on the case';
  end if;

  -- This is exactly the query lib/support/conversations.ts runs for Messages.
  select count(*) into v_count from public.support_tickets t where t.created_by_user_id = v_requester;
  if v_count = 1 then
    raise notice 'PASS 5 (F): the requester sees the thread in their Messages read model';
  else
    raise notice 'FAIL 5 (F): Messages read model returned % rows for the requester', v_count;
  end if;

  -- ============ K. retry does not duplicate ============
  select count(*) into v_events_before from public.support_ticket_events where ticket_id = v_ticket;
  select t.id into v_ticket2
  from public.create_support_ticket(
    'fixtures', 'Fixture will not save', 'The kickoff time reverts when I save.',
    null, null, null, '/fixtures'
  ) t;
  select count(*) into v_events_after from public.support_ticket_events where ticket_id = v_ticket;
  if v_events_before = v_events_after then
    raise notice 'PASS 6 (K): resubmitting never adds a second initial message to an existing thread';
  else
    raise notice 'FAIL 6 (K): the original thread gained events on resubmission';
  end if;

  -- A genuinely separate submission is its own case, which is correct --
  -- two different problems are two conversations. Recorded, not asserted as
  -- dedup, because the product has no "same issue" identity to dedup on.
  if v_ticket2 <> v_ticket then
    raise notice 'PASS 7 (K): a second submission is a separate case with its own single thread';
  else
    raise notice 'FAIL 7 (K): the second submission collapsed into the first';
  end if;

  -- ============ E/N. an unrelated user cannot see it ============
  perform set_config('request.jwt.claims', json_build_object('sub', v_outsider, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_count from public.support_tickets where id = v_ticket;
  perform set_config('role', 'postgres', true);
  if v_count = 0 then
    raise notice 'PASS 8 (E): a Club Admin at another club cannot see the case';
  else
    raise notice 'FAIL 8 (E): an unrelated Club Admin saw the case';
  end if;

  -- ============ N. same club is NOT the same as same person ============
  perform set_config('request.jwt.claims', json_build_object('sub', v_colleague, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_count from public.support_tickets where id = v_ticket;
  perform set_config('role', 'postgres', true);
  if v_count = 0 then
    raise notice 'PASS 9 (N): a colleague at the SAME club cannot see a personal support case';
  else
    raise notice 'FAIL 9 (N): club context leaked a colleague''s support case';
  end if;

  -- ============ D/G. authorized Site Admin support can see it ============
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_count from public.support_tickets where id = v_ticket;
  perform set_config('role', 'postgres', true);
  if v_count = 1 then
    raise notice 'PASS 10 (D/G): authorized Site Admin support sees the thread in Messages';
  else
    raise notice 'FAIL 10 (D/G): Site Admin could not see the case';
  end if;

  -- support level is the canonical gate, not "is a Site Admin"
  if internal.site_admin_support_level(v_admin) = 'manage'
     and internal.site_admin_support_level(v_moderator) = 'none' then
    raise notice 'PASS 11: support visibility uses the canonical support level, not context = site_admin';
  else
    raise notice 'FAIL 11: admin=%, moderator=%',
      internal.site_admin_support_level(v_admin), internal.site_admin_support_level(v_moderator);
  end if;

  -- ============ I/O/P. Site Admin reply, actor preserved ============
  select count(*) into v_events_before from public.support_ticket_events where ticket_id = v_ticket;
  perform public.send_support_reply(v_ticket, 'We have reproduced this and are fixing it.');
  select count(*) into v_events_after from public.support_ticket_events where ticket_id = v_ticket;

  if v_events_after = v_events_before + 1 then
    raise notice 'PASS 12 (I): a Site Admin reply stays in the same conversation';
  else
    raise notice 'FAIL 12 (I): reply produced % new events', v_events_after - v_events_before;
  end if;

  select actor_user_id into v_text from public.support_ticket_events
  where ticket_id = v_ticket and event_type = 'support_reply' order by created_at desc limit 1;
  if v_text = v_admin::text then
    raise notice 'PASS 13 (O/P): the real Site Admin actor is preserved behind the Ovalball Support identity';
  else
    raise notice 'FAIL 13 (O/P): actor recorded as %', coalesce(v_text,'<null>');
  end if;

  select visibility into v_text from public.support_ticket_events
  where ticket_id = v_ticket and event_type = 'support_reply' order by created_at desc limit 1;
  if v_text = 'requester' then
    raise notice 'PASS 14: a Site Admin reply is visible to the requester -- not a place they cannot see';
  else
    raise notice 'FAIL 14: support reply visibility = %', v_text;
  end if;

  -- an internal note is the opposite, and must never reach the requester
  perform public.add_support_internal_note(v_ticket, 'Caused by the kickoff amendment path.');
  perform set_config('request.jwt.claims', json_build_object('sub', v_requester, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_count from public.support_ticket_events
  where ticket_id = v_ticket and visibility = 'internal';
  perform set_config('role', 'postgres', true);
  if v_count = 0 then
    raise notice 'PASS 15: internal notes are invisible to the requester (enforced in RLS, not the UI)';
  else
    raise notice 'FAIL 15: the requester could read % internal note(s)', v_count;
  end if;

  -- ============ H. requester reply stays in the same conversation ============
  perform set_config('request.jwt.claims', json_build_object('sub', v_requester, 'role','authenticated')::text, true);
  select count(*) into v_events_before from public.support_ticket_events where ticket_id = v_ticket;
  perform public.add_support_followup(v_ticket, 'Thanks -- still happening this morning.');
  select count(*) into v_events_after from public.support_ticket_events where ticket_id = v_ticket;
  select count(distinct ticket_id) into v_count from public.support_ticket_events where ticket_id = v_ticket;
  if v_events_after = v_events_before + 1 and v_count = 1 then
    raise notice 'PASS 16 (H): a requester reply stays in the one conversation';
  else
    raise notice 'FAIL 16 (H): % new events across % threads', v_events_after - v_events_before, v_count;
  end if;

  -- ============ J. canonical notifications ============
  select count(*) into v_notif_after from public.notifications;
  if v_notif_after > v_notif_before then
    raise notice 'PASS 17 (J): support activity emits canonical notifications rows (no second system)';
  else
    raise notice 'FAIL 17 (J): no notifications were produced';
  end if;

  -- Named explicitly rather than counted: the canonical set is one message
  -- store (notifications) plus its three config tables. A support-specific
  -- notification store would show up here as an extra name.
  select count(*)::int into v_count
  from information_schema.tables
  where table_schema = 'public' and table_name ilike '%notification%'
    and table_name not in ('notifications','notification_preferences','notification_topics','notification_types');
  if v_count = 0 then
    raise notice 'PASS 18 (J): notifications live in the canonical tables only -- no second store';
  else
    raise notice 'FAIL 18 (J): % unexpected notification table(s) exist', v_count;
  end if;

  -- ============ M. resolved threads remain readable ============
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  perform public.update_support_ticket_status(v_ticket, 'closed');

  perform set_config('request.jwt.claims', json_build_object('sub', v_requester, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_count from public.support_ticket_events
  where ticket_id = v_ticket and visibility = 'requester';
  perform set_config('role', 'postgres', true);
  if v_count >= 3 then
    raise notice 'PASS 19 (M): a resolved thread stays fully readable to the requester (% events)', v_count;
  else
    raise notice 'FAIL 19 (M): resolved thread exposed only % events', v_count;
  end if;

  -- ============ L. no orphan cases -- the thread cannot detach ============
  select count(*) into v_count from public.support_tickets t
  where not exists (select 1 from public.support_ticket_events e where e.ticket_id = t.id);
  if v_count = 0 then
    raise notice 'PASS 20 (L): no support case exists without a thread -- nothing to reconcile';
  else
    raise notice 'FAIL 20 (L): % case(s) have no conversation', v_count;
  end if;

  -- the FK makes the reverse impossible too
  select count(*)::int into v_count
  from pg_constraint
  where conrelid = 'public.support_ticket_events'::regclass
    and contype = 'f'
    and confrelid = 'public.support_tickets'::regclass;
  if v_count = 1 then
    raise notice 'PASS 21 (L): a thread cannot exist without its case (foreign key)';
  else
    raise notice 'FAIL 21 (L): expected one FK to support_tickets, found %', v_count;
  end if;

  -- ============ no secrets in the Messages read model ============
  select count(*)::int into v_count
  from information_schema.columns
  where table_schema='public' and table_name='support_tickets'
    and column_name in ('token','access_token','secret');
  if v_count = 0 then
    raise notice 'PASS 22: the support case carries no token or secret to leak into Messages';
  else
    raise notice 'FAIL 22: support_tickets exposes % secret-ish column(s)', v_count;
  end if;
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
