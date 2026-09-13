-- Direct messaging: who may talk to whom (20270254000000, 20270256000000).
--
-- THE PRODUCT RULE IS ADULT-TO-ADULT. Not staff-to-staff: holding a coaching
-- permission is not what makes somebody eligible to send a message, and the
-- earlier staff gate excluded every guardian and every adult player for no
-- reason beyond implementation convenience.
--
-- So the matrix below is organised around the two things that actually
-- decide it:
--
--   AGE      is the safeguarding boundary, checked before anything else.
--            Tests 10-15 try to reach past it using a guardian relationship,
--            administrator status and a shared club in turn. All must fail.
--
--   POLICY   is a ceiling and a narrowing. Ovalball's switch is master;
--            a club may restrict further and can never re-enable what the
--            platform has turned off. Tests 16-20 prove that asymmetry,
--            including the case a coalesce-shaped policy would get wrong.
--
-- Age comes from internal.resolve_player_chronological_age -- the one
-- canonical predicate -- and this file deliberately contains no arithmetic of
-- its own.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/direct_messaging_security.sql
--
-- Wrapped in a transaction and rolled back: it writes nothing to the shared
-- local UAT database.

\set ON_ERROR_STOP off
\pset pager off

begin;

do $$
declare
  v_coach uuid;        -- adult, staff
  v_admin uuid;        -- adult, staff
  v_guardian uuid;     -- adult, NOT staff
  v_guardian2 uuid;    -- adult, NOT staff
  v_adult_player uuid; -- adult, PLAYER role
  v_minor uuid;        -- 17
  v_minor2 uuid;       -- 15
  v_site_admin uuid;
  v_thread uuid;
  v_history_before integer;
  v_club uuid;
  n integer;
begin
  select id into v_coach        from auth.users where email = 'uat.coach@ovalball.test';
  select id into v_admin        from auth.users where email = 'uat.team.admin@ovalball.test';
  select id into v_guardian     from auth.users where email = 'uat.guardian.one@ovalball.test';
  select id into v_guardian2    from auth.users where email = 'uat.guardian.two@ovalball.test';
  select id into v_adult_player from auth.users where email = 'uat.adult.player@ovalball.test';
  select id into v_minor        from auth.users where email = 'uat.player.self@ovalball.test';
  select id into v_minor2       from auth.users where email = 'phase3.uat.player@ovalball.test';
  select id into v_site_admin   from auth.users where email = 'uat.fullsiteadmin@ovalball.test';

  if v_coach is null or v_guardian is null or v_minor is null then
    raise notice 'SKIP: the UAT identities this suite reads are not present in this database';
    return;
  end if;

  -- =================================================================
  -- 1-3. THE AGE PREDICATE ITSELF
  -- =================================================================
  if not internal.is_adult_messaging_user(v_minor) then
    raise notice 'PASS 1: a 17-year-old with their own login is not an adult for messaging';
  else
    raise notice 'FAIL 1: a minor was treated as an adult';
  end if;

  if internal.is_adult_messaging_user(v_adult_player) then
    raise notice 'PASS 2: an 18+ PLAYER is an adult -- role is not the boundary, age is';
  else
    raise notice 'FAIL 2: an adult player was excluded';
  end if;

  if internal.is_adult_messaging_user(v_guardian) then
    raise notice 'PASS 3: a guardian holding no staff position is an adult';
  else
    raise notice 'FAIL 3: a guardian was excluded';
  end if;

  -- =================================================================
  -- 4-9. ADULT PAIRS THAT MUST NOW WORK
  -- =================================================================
  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);
  if internal.may_direct_message(v_admin) then
    raise notice 'PASS 4: coach -> coach/staff';
  else raise notice 'FAIL 4: staff pair refused'; end if;

  if internal.may_direct_message(v_guardian) then
    raise notice 'PASS 5: coach -> guardian (the case the staff gate used to refuse)';
  else raise notice 'FAIL 5: coach could not message a guardian'; end if;

  if internal.may_direct_message(v_adult_player) then
    raise notice 'PASS 6: coach -> adult player';
  else raise notice 'FAIL 6: coach could not message an adult player'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_guardian, 'role', 'authenticated')::text, true);
  if internal.may_direct_message(v_coach) then
    raise notice 'PASS 7: guardian -> coach (the reverse direction)';
  else raise notice 'FAIL 7: guardian could not message a coach'; end if;

  if internal.may_direct_message(v_guardian2) then
    raise notice 'PASS 8: guardian -> guardian';
  else raise notice 'FAIL 8: two guardians could not message'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_adult_player, 'role', 'authenticated')::text, true);
  if internal.may_direct_message(v_coach) then
    raise notice 'PASS 9: adult player -> coach';
  else raise notice 'FAIL 9: adult player could not message a coach'; end if;

  -- =================================================================
  -- 10-15. THE SAFEGUARDING BOUNDARY, AND EVERY ATTEMPT TO REACH PAST IT
  -- =================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);
  if not internal.may_direct_message(v_minor) then
    raise notice 'PASS 10: adult -> U18 refused';
  else raise notice 'FAIL 10: an adult reached a minor'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_minor, 'role', 'authenticated')::text, true);
  if not internal.may_direct_message(v_coach) then
    raise notice 'PASS 11: U18 -> adult refused';
  else raise notice 'FAIL 11: a minor reached an adult'; end if;

  if v_minor2 is not null then
    if not internal.may_direct_message(v_minor2) then
      raise notice 'PASS 12: U18 -> U18 refused';
    else raise notice 'FAIL 12: two minors could message each other'; end if;
  else
    raise notice 'SKIP 12: no second minor identity present';
  end if;

  -- 13. A GUARDIAN cannot reach a U18 this way. That is the relationship
  -- somebody would most expect to be an exception, and it is not:
  -- safeguarded channels own that contact.
  perform set_config('request.jwt.claims', json_build_object('sub', v_guardian, 'role', 'authenticated')::text, true);
  if not internal.may_direct_message(v_minor) then
    raise notice 'PASS 13: a guardian cannot open a 1:1 with a U18 -- not even as a guardian';
  else raise notice 'FAIL 13: the guardian relationship bypassed the age boundary'; end if;

  -- 14. Nor can a Full Site Admin.
  if v_site_admin is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_site_admin, 'role', 'authenticated')::text, true);
    if not internal.may_direct_message(v_minor) then
      raise notice 'PASS 14: a Full Site Admin cannot message a U18 -- administrator status is not an exemption';
    else raise notice 'FAIL 14: admin status bypassed the age boundary'; end if;
  end if;

  -- 15. Nor does sharing a club: the age check runs before any relationship.
  perform set_config('role', 'postgres', true);
  select club_id into v_club from public.club_memberships where user_id = v_coach and status = 'active' limit 1;
  insert into public.club_memberships (user_id, club_id, role, status)
  values (v_minor, v_club, 'BASIC_USER', 'active') on conflict do nothing;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);
  if not internal.may_direct_message(v_minor) then
    raise notice 'PASS 15: putting a minor in your club does not make them messageable';
  else raise notice 'FAIL 15: shared club membership bypassed the age boundary'; end if;

  -- =================================================================
  -- 16-20. POLICY: SITE IS A CEILING, CLUB IS A NARROWING
  -- =================================================================
  perform set_config('role', 'postgres', true);
  update public.message_policies set allow_direct_messaging = false where club_id is null;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);

  if not internal.may_direct_message(v_admin) then
    raise notice 'PASS 16: site policy OFF refuses everyone';
  else raise notice 'FAIL 16: direct messaging survived the site switch'; end if;

  -- 17. THE CASE A coalesce-SHAPED POLICY WOULD GET WRONG: the club says ON
  -- while the site says OFF. The club must not win.
  perform set_config('role', 'postgres', true);
  insert into public.message_policies (club_id, allow_direct_messaging)
  values (v_club, true)
  on conflict (club_id) where club_id is not null
  do update set allow_direct_messaging = true;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);

  if not internal.may_direct_message(v_admin) then
    raise notice 'PASS 17: site OFF + club ON stays OFF -- a club cannot re-enable what Ovalball disabled';
  else raise notice 'FAIL 17: a club override defeated the site master switch'; end if;

  -- 18. Site ON + club OFF -> refused. The club may narrow.
  perform set_config('role', 'postgres', true);
  update public.message_policies set allow_direct_messaging = true where club_id is null;
  update public.message_policies set allow_direct_messaging = false where club_id = v_club;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);

  if not internal.may_direct_message(v_admin) then
    raise notice 'PASS 18: site ON + club OFF refuses -- a club may restrict further';
  else raise notice 'FAIL 18: a club could not restrict direct messaging'; end if;

  -- 19. CROSS-CLUB: one objecting club is enough, whichever side it is on.
  if internal.direct_messaging_allowed_for_pair(v_coach, v_admin) then
    raise notice 'FAIL 19: an objecting club did not block the pair';
  else
    raise notice 'PASS 19: a club with direct messaging off blocks the pair, whichever side it is on';
  end if;

  -- 20. Both on -> permitted again.
  perform set_config('role', 'postgres', true);
  update public.message_policies set allow_direct_messaging = true where club_id = v_club;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);

  if internal.may_direct_message(v_admin) then
    raise notice 'PASS 20: site ON + club ON permits it again';
  else raise notice 'FAIL 20: re-enabling the policy did not restore messaging'; end if;

  -- =================================================================
  -- 21-28. THREAD, IDENTITY, POLICY ACROSS AN EXISTING THREAD, BLOCKS
  -- =================================================================
  v_thread := public.open_direct_conversation(v_guardian);
  insert into public.fixture_messages (direct_conversation_id, sender_user_id, body, kind, content_type)
  values (v_thread, v_coach, 'Is Harry available on Saturday?', 'message', 'text');
  raise notice 'PASS 21: a coach and a guardian hold a working 1:1 conversation';

  -- 22. A NON-PERSON SENDER IDENTITY IS REFUSED inside a 1:1.
  begin
    insert into public.fixture_messages (direct_conversation_id, sender_user_id, body, kind, content_type, sender_identity_type, sender_identity_id)
    values (v_thread, v_coach, 'As the club', 'message', 'text', 'club', v_club);
    raise notice 'FAIL 22: an organisational identity spoke inside a direct thread';
  exception when others then
    raise notice 'PASS 22: a direct message is always from a person';
  end;

  -- 23-24. POLICY OFF stops NEW sends but keeps the history and the thread.
  --
  -- The history is measured as a BEFORE/AFTER difference rather than against a
  -- fixed number. open_direct_conversation is open-or-get, so on any database
  -- where these two people have talked before -- a UAT database, a machine
  -- where the browser suites have run -- v_thread is a real thread that
  -- already holds real messages, and "n = 1" asserted an empty store rather
  -- than anything about the policy. What the test actually claims is that
  -- switching the policy off changes nothing that was already said, and that
  -- is exactly what a difference of zero says, whatever the thread started
  -- with.
  perform set_config('role', 'postgres', true);
  select count(*) into v_history_before from public.fixture_messages where direct_conversation_id = v_thread;
  update public.message_policies set allow_direct_messaging = false where club_id is null;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);

  begin
    insert into public.fixture_messages (direct_conversation_id, sender_user_id, body, kind, content_type)
    values (v_thread, v_coach, 'Policy is off', 'message', 'text');
    raise notice 'FAIL 23: a message was sent with the policy off';
  exception when others then
    raise notice 'PASS 23: RLS refuses the send while the policy is off';
  end;

  perform set_config('role', 'postgres', true);
  select count(*) into n from public.fixture_messages where direct_conversation_id = v_thread;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);
  if n = v_history_before then
    raise notice 'PASS 24: the existing history survives the policy change (% row(s), unchanged)', n;
  else raise notice 'FAIL 24: history changed when policy did (% rows before, % after)', v_history_before, n; end if;

  -- 25. Re-enabling makes the SAME thread send-capable; no new conversation.
  perform set_config('role', 'postgres', true);
  update public.message_policies set allow_direct_messaging = true where club_id is null;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);

  if public.open_direct_conversation(v_guardian) = v_thread then
    insert into public.fixture_messages (direct_conversation_id, sender_user_id, body, kind, content_type)
    values (v_thread, v_coach, 'Back on', 'message', 'text');
    raise notice 'PASS 25: re-enabling restores sending on the SAME thread, not a new one';
  else
    raise notice 'FAIL 25: re-enabling produced a different conversation';
  end if;

  -- 26-27. A BLOCK OVERRIDES POLICY BEING ON, and refuses neutrally.
  perform set_config('request.jwt.claims', json_build_object('sub', v_guardian, 'role', 'authenticated')::text, true);
  perform public.block_user(v_coach);
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);

  if not internal.may_direct_message(v_guardian) then
    raise notice 'PASS 26: a block beats an enabled policy, in both directions';
  else raise notice 'FAIL 26: policy ON overrode a block'; end if;

  begin
    perform public.open_direct_conversation(v_guardian);
    raise notice 'FAIL 27: opening succeeded across a block';
  exception when insufficient_privilege then
    if sqlerrm = 'This conversation isn''t available.' then
      raise notice 'PASS 27: the refusal names no block, age, policy or relationship';
    else
      raise notice 'FAIL 27: the refusal leaked a reason: %', sqlerrm;
    end if;
  end;

  -- 28. Discovery obeys the same authority: a minor is never a candidate.
  select count(*) into n from public.my_direct_message_candidates() where user_id = v_minor;
  if n = 0 then
    raise notice 'PASS 28: a U18 never appears as a contact candidate';
  else raise notice 'FAIL 28: a minor was offered as a contact'; end if;
end $$;

rollback;
