-- Announcement privacy and reply-mode bounds (20270242000000).
--
-- The property under test is the reason messenger_announcements exists as a
-- separate domain rather than as fixture_messages rows: an announcement's
-- AUDIENCE IS NOT VISIBLE TO ITS AUDIENCE. Four hundred families being told
-- Saturday is off must not become four hundred families holding a list of
-- each other. That is a schema property here -- one private delivery row per
-- recipient -- so it is provable, and this file proves it rather than
-- trusting the composer to hide something.
--
-- Also proved: GROUP_DISCUSSION cannot escape a bounded audience, an empty
-- announcement is impossible, one logical recipient receives exactly one
-- delivery however many times a fan-out worker runs, and withdrawal hides
-- content from readers WITHOUT destroying the evidence of what was sent.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/announcement_privacy.sql
--
-- Wrapped in a transaction and rolled back: it writes nothing to the shared
-- local UAT database.

\set ON_ERROR_STOP off
\pset pager off

begin;

do $$
declare
  v_actor uuid;      -- may speak as the team
  v_colleague uuid;  -- also may speak as the team, and is a recipient
  v_recipient uuid;  -- an ordinary recipient with no authority over the team
  v_team uuid;
  v_club uuid;
  v_ann uuid;
  v_n integer;
  v_body text;
begin
  select id into v_actor      from auth.users where email = 'uat.team.admin@ovalball.test';
  select id into v_colleague  from auth.users where email = 'uat.coach@ovalball.test';
  select id into v_recipient  from auth.users where email = 'uat.guardian.one@ovalball.test';

  if v_actor is null or v_colleague is null or v_recipient is null then
    raise notice 'SKIP: the UAT identities this suite reads are not present in this database';
    return;
  end if;

  -- The team this actor genuinely administers, asked of the same authority
  -- the product uses, so the suite is not pinned to one fixture id.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);
  select t.id, t.club_id into v_team, v_club
  from public.teams t
  where internal.may_send_as('team', t.id)
  order by t.id
  limit 1;
  perform set_config('request.jwt.claims', '', true);

  if v_team is null then
    raise notice 'SKIP: no team in this database that the UAT team admin may speak as';
    return;
  end if;

  -- =================================================================
  -- 1-2. A BROAD ANNOUNCEMENT CANNOT BECOME A GROUP CHAT
  -- Refused by CHECK, so no future call site, RPC or worker can decide
  -- otherwise. A club-wide thread nobody chose to join is not a feature.
  -- =================================================================
  begin
    insert into public.messenger_announcements
      (actor_user_id, sender_identity_type, sender_identity_id, scope, scope_id, reply_mode, body)
    values (v_actor, 'club', v_club, 'club', v_club, 'GROUP_DISCUSSION', 'Everyone talk at once');
    raise notice 'FAIL 1: a club-wide announcement was allowed to become a group discussion';
  exception when check_violation then
    raise notice 'PASS 1: a club-wide announcement cannot become a group discussion';
  end;

  begin
    insert into public.messenger_announcements
      (actor_user_id, sender_identity_type, scope, reply_mode, body)
    values (v_actor, 'platform', 'platform', 'GROUP_DISCUSSION', 'Everyone talk at once');
    raise notice 'FAIL 2: a platform-wide announcement was allowed to become a group discussion';
  exception when check_violation then
    raise notice 'PASS 2: a platform-wide announcement cannot become a group discussion';
  end;

  -- 3. Bounded audiences may discuss. The rule is a bound, not a ban.
  insert into public.messenger_announcements
    (actor_user_id, sender_identity_type, sender_identity_id, scope, scope_id,
     reply_mode, title, body, status, sent_at)
  values (v_actor, 'team', v_team, 'team', v_team,
          'GROUP_DISCUSSION', 'Saturday', 'Training is cancelled.', 'sent', now())
  returning id into v_ann;
  raise notice 'PASS 3: a team announcement may be a bounded group discussion';

  -- 4. An announcement must actually say something.
  begin
    insert into public.messenger_announcements
      (actor_user_id, sender_identity_type, sender_identity_id, scope, scope_id, body)
    values (v_actor, 'team', v_team, 'team', v_team, '   ');
    raise notice 'FAIL 4: an announcement of three spaces was accepted';
  exception when check_violation then
    raise notice 'PASS 4: an announcement must actually say something';
  end;

  insert into public.messenger_announcement_deliveries
    (announcement_id, recipient_user_id, status, delivered_at, safeguarding_route, idempotency_key)
  values
    (v_ann, v_colleague, 'delivered', now(), 'direct',   v_ann::text || ':' || v_colleague::text),
    (v_ann, v_recipient, 'delivered', now(), 'guardian', v_ann::text || ':' || v_recipient::text);

  -- =================================================================
  -- 5-6. DELIVERY INTEGRITY
  -- =================================================================
  begin
    insert into public.messenger_announcement_deliveries
      (announcement_id, recipient_user_id, status, idempotency_key)
    values (v_ann, v_colleague, 'pending', v_ann::text || ':' || v_colleague::text);
    raise notice 'FAIL 5: a re-run of fan-out created a second delivery for one recipient';
  exception when unique_violation then
    raise notice 'PASS 5: one logical recipient gets exactly one delivery';
  end;

  begin
    insert into public.messenger_announcement_deliveries
      (announcement_id, recipient_user_id, status, read_at, idempotency_key)
    values (v_ann, v_actor, 'pending', now(), 'unsent-' || v_ann::text);
    raise notice 'FAIL 6: a message was marked read before it was ever delivered';
  exception when check_violation then
    raise notice 'PASS 6: nothing can be read before it is delivered';
  end;

  -- =================================================================
  -- 7. AUDIENCE SECRECY -- THE POINT OF THE DOMAIN
  -- =================================================================
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_recipient, 'role', 'authenticated')::text, true);

  -- Scoped to THIS announcement. Counting the whole table made the assertion
  -- depend on the store being globally empty, so any other announcement that
  -- happened to exist -- one left by a browser run, one another suite created
  -- -- failed it while the policy was doing exactly the right thing.
  select count(*) into v_n from public.messenger_announcement_deliveries
   where announcement_id = v_ann;
  if v_n = 1 then
    raise notice 'PASS 7: an ordinary recipient can read exactly one delivery of this announcement -- their own';
  else
    raise notice 'FAIL 7: an ordinary recipient could read % delivery rows of this announcement', v_n;
  end if;

  -- 7a. And the privacy claim itself, made STRONGER rather than narrower by
  -- the scoping above: whatever else is in the store, every row this person
  -- can see anywhere is addressed to them. That holds however much data other
  -- suites or browser runs have left behind -- indeed the more there is, the
  -- more this proves.
  select count(*) into v_n from public.messenger_announcement_deliveries
   where recipient_user_id <> v_recipient;
  if v_n = 0 then
    raise notice 'PASS 7a: across the whole store, a recipient sees no delivery addressed to anybody else';
  else
    raise notice 'FAIL 7a: a recipient could read % delivery row(s) addressed to other people', v_n;
  end if;

  if internal.is_announcement_sender(v_ann) then
    raise notice 'FAIL 7b: an ordinary recipient is treated as the sending side';
  else
    raise notice 'PASS 7b: an ordinary recipient is not the sending side';
  end if;

  -- 7c. The wider view exists, and only where authority does. A colleague who
  -- may speak AS the team sees the audience because they are the sender, not
  -- because they were sent it -- which is what 7 and 7b together isolate.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_colleague, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.messenger_announcement_deliveries
   where announcement_id = v_ann;
  if v_n = 2 and internal.is_announcement_sender(v_ann) then
    raise notice 'PASS 7c: the audience is visible to the sending side, by authority';
  else
    raise notice 'FAIL 7c: sending side saw % rows of this announcement, is_sender=%',
      v_n, internal.is_announcement_sender(v_ann);
  end if;

  -- 8. And a recipient can read what they were actually sent.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_recipient, 'role', 'authenticated')::text, true);
  select body into v_body from public.my_announcements(10) where announcement_id = v_ann;
  if v_body = 'Training is cancelled.' then
    raise notice 'PASS 8: the recipient reads the announcement';
  else
    raise notice 'FAIL 8: the recipient read %', coalesce(v_body, '(nothing)');
  end if;

  -- =================================================================
  -- 9-10. WITHDRAWAL IS NOT DELETION
  -- =================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_actor, 'role', 'authenticated')::text, true);
  perform public.withdraw_announcement(v_ann);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_recipient, 'role', 'authenticated')::text, true);
  select body into v_body from public.my_announcements(10) where announcement_id = v_ann;
  if v_body = 'This announcement has been withdrawn.' then
    raise notice 'PASS 9: a withdrawn announcement keeps its place and hides its content';
  else
    raise notice 'FAIL 9: a withdrawn announcement read back as %', coalesce(v_body, '(nothing)');
  end if;

  perform set_config('role', 'postgres', true);
  select body into v_body from public.messenger_announcements where id = v_ann;
  if v_body = 'Training is cancelled.' then
    raise notice 'PASS 10: the withdrawn content survives as evidence of what was sent';
  else
    raise notice 'FAIL 10: withdrawal destroyed the evidence';
  end if;
end $$;

rollback;
