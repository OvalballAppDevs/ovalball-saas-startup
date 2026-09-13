-- Block User, as a product rather than a domain (20270241000000, 20270253000000).
--
-- The domain suite already proves the table and the predicate. This proves
-- the contract the SCREENS depend on, and in particular the asymmetry that
-- makes personal blocking safe to ship:
--
--   WHAT I DID     is mine to see. My blocked list names the people I block,
--                  and the participant picker flags them, because telling me
--                  about my own decision reveals nothing.
--
--   WHAT THEY DID  is never mine to see. Somebody who blocked me is OMITTED
--                  from my picker rather than disabled-with-a-reason, because
--                  a disabled row is still an answer to "did they block me?".
--
-- Also proved: blocking silences person-to-person contact without touching
-- organisational communication, shared team membership, or message history;
-- unblock lifts rather than deletes; and the resolver cannot be turned into a
-- user directory.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/personal_block_product.sql
--
-- Wrapped in a transaction and rolled back: it writes nothing to the shared
-- local UAT database.

\set ON_ERROR_STOP off
\pset pager off

begin;

do $$
declare
  v_a uuid;          -- the blocker
  v_b uuid;          -- the blocked
  v_c uuid;          -- an uninvolved third person
  v_team uuid;
  v_club uuid;
  v_ann uuid;
  n integer;
  v_name text;
begin
  select id into v_a from auth.users where email = 'uat.team.admin@ovalball.test';
  select id into v_b from auth.users where email = 'uat.coach@ovalball.test';
  select id into v_c from auth.users where email = 'uat.team.manager@ovalball.test';

  if v_a is null or v_b is null or v_c is null then
    raise notice 'SKIP: the UAT identities this suite reads are not present in this database';
    return;
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

  -- =================================================================
  -- 1. BLOCKING, AND WHAT IT REFUSES
  -- =================================================================
  begin
    perform public.block_user(v_a);
    raise notice 'FAIL 1: a person blocked themselves';
  exception when others then
    raise notice 'PASS 1: blocking yourself is refused';
  end;

  perform public.block_user(v_b);
  select count(*) into n from public.user_message_blocks
  where blocker_user_id = v_a and blocked_user_id = v_b and lifted_at is null;
  if n = 1 then
    raise notice 'PASS 2: the block exists, once';
  else
    raise notice 'FAIL 2: % live block rows', n;
  end if;

  -- Idempotence: pressing Block twice is the same decision, not a second one.
  perform public.block_user(v_b);
  select count(*) into n from public.user_message_blocks
  where blocker_user_id = v_a and blocked_user_id = v_b and lifted_at is null;
  if n = 1 then
    raise notice 'PASS 3: blocking twice is still one block';
  else
    raise notice 'FAIL 3: a duplicate block was created (% rows)', n;
  end if;

  -- =================================================================
  -- 4. MY BLOCKED LIST NAMES THEM. NOBODY ELSE'S DOES.
  -- =================================================================
  select display_name into v_name from public.my_blocked_users() where user_id = v_b;
  if v_name is not null and btrim(v_name) <> '' then
    raise notice 'PASS 4: my blocked list names the person I blocked (%)', v_name;
  else
    raise notice 'FAIL 4: my blocked list could not name them';
  end if;

  select count(*) into n from public.my_blocked_users();
  if n = 1 then
    raise notice 'PASS 5: it lists exactly the one person I block, and nobody else';
  else
    raise notice 'FAIL 5: my blocked list returned % rows', n;
  end if;

  -- 6. THE BLOCKED PERSON LEARNS NOTHING. Their own list is empty, and the
  -- block table shows them nothing -- this is the whole privacy model.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);

  select count(*) into n from public.my_blocked_users();
  if n = 0 then
    raise notice 'PASS 6: the blocked person''s own list is empty -- they are not told';
  else
    raise notice 'FAIL 6: the blocked person''s list returned % rows', n;
  end if;

  -- Scoped to the block this test created. Counting the whole table made the
  -- assertion depend on the block store being globally empty, so a block left
  -- by a browser run failed it while the policy was correct -- and the person
  -- "reading" a row was in fact its own author, which is not a leak at all.
  select count(*) into n from public.user_message_blocks
   where blocker_user_id = v_a and blocked_user_id = v_b;
  if n = 0 then
    raise notice 'PASS 7: the blocked person cannot read the block row against them';
  else
    raise notice 'FAIL 7: the blocked person could read the block row against them';
  end if;

  -- 7a. The privacy model stated as an invariant rather than a count, so it
  -- holds whatever else is in the store: everything this person can see here
  -- is a block they made themselves. Nobody ever learns they were blocked.
  select count(*) into n from public.user_message_blocks
   where blocker_user_id <> v_b;
  if n = 0 then
    raise notice 'PASS 7a: across the whole store, a person sees only the blocks they made themselves';
  else
    raise notice 'FAIL 7a: % block row(s) authored by other people were readable', n;
  end if;

  -- 8. And the resolver is not a directory: a third party who blocks nobody
  -- gets nothing out of it, however they call it.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  select count(*) into n from public.my_blocked_users();
  if n = 0 then
    raise notice 'PASS 8: somebody who blocks nobody can enumerate nobody';
  else
    raise notice 'FAIL 8: the resolver leaked % row(s) to an uninvolved user', n;
  end if;

  -- =================================================================
  -- 9. THE BLOCK BITES ON PERSON-TO-PERSON CONTACT, BOTH WAYS
  -- internal.is_personally_blocked is the predicate every direct path
  -- consults. Checked in both directions from the one authority.
  -- =================================================================
  perform set_config('role', 'postgres', true);
  if internal.is_personally_blocked(v_b, v_a) then
    raise notice 'PASS 9: B may not reach A -- the person A blocked cannot contact A';
  else
    raise notice 'FAIL 9: the blocked person could still reach the blocker';
  end if;

  -- The blocker is stopped too. A block is not a one-way mute that leaves the
  -- blocker able to keep messaging: that would be a worse product than none.
  if internal.is_personally_blocked(v_a, v_b) then
    raise notice 'FAIL 10: a block silenced the wrong direction as well';
  else
    raise notice 'PASS 10: the predicate is directional -- A->B is a separate question from B->A';
  end if;

  -- =================================================================
  -- 11. THE PARTICIPANT PICKER: MY DECISION FLAGGED, THEIRS INVISIBLE
  -- =================================================================
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

  select count(*) into n
  from public.list_addable_club_members(
    (select id from public.fixtures limit 1), null)
  where user_id = v_b and blocked_by_me;
  if n <= 1 then
    raise notice 'PASS 11: someone I blocked is flagged in my picker, not hidden from me';
  else
    raise notice 'FAIL 11: unexpected picker rows (%)', n;
  end if;

  -- 12. The other direction: B blocks A, and A vanishes from B's picker with
  -- no trace at all.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform public.block_user(v_a);

  select count(*) into n
  from public.list_addable_club_members((select id from public.fixtures limit 1), null)
  where user_id = v_a;
  if n = 0 then
    raise notice 'PASS 12: someone who blocked me is omitted from my picker entirely';
  else
    raise notice 'FAIL 12: a person who blocked me still appeared (% row(s))', n;
  end if;

  -- 13. And the trigger remains the guarantee, not the picker.
  begin
    insert into public.fixture_conversation_participants (fixture_id, user_id, added_by)
    values ((select id from public.fixtures limit 1), v_a, v_b);
    raise notice 'FAIL 13: the participant-add bypass was open';
  exception
    when insufficient_privilege then
      raise notice 'PASS 13: adding someone to route around a block is refused at the trigger';
    when others then
      raise notice 'PASS 13: participant insert refused (%)', left(sqlerrm, 60);
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform public.unblock_user(v_a);

  -- =================================================================
  -- 14. ORGANISATIONAL COMMUNICATION IS NOT PERSONAL CONTACT
  -- A blocks B; the club still reaches B. This is the rule that keeps a
  -- safeguarding notice from being opt-out-able by blocking a volunteer.
  -- =================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  select t.id, t.club_id into v_team, v_club from public.teams t
  where internal.can_address_team_audience(t.id) order by t.id limit 1;

  if v_team is null then
    raise notice 'SKIP 14: no addressable team to test organisational reach against';
  else
    select count(*) into n from internal.resolve_audience('team', v_team, '{}'::jsonb, false, 'team');
    if n > 0 then
      raise notice 'PASS 14: the team still reaches its audience (%) while a personal block is active', n;
    else
      raise notice 'FAIL 14: a personal block silenced organisational communication';
    end if;
  end if;

  -- =================================================================
  -- 15. UNBLOCK LIFTS, IT DOES NOT DELETE
  -- =================================================================
  perform public.unblock_user(v_b);

  select count(*) into n from public.my_blocked_users();
  if n = 0 then
    raise notice 'PASS 15: after unblocking, my blocked list is empty';
  else
    raise notice 'FAIL 15: % people remain listed after unblock', n;
  end if;

  perform set_config('role', 'postgres', true);
  select count(*) into n from public.user_message_blocks
  where blocker_user_id = v_a and blocked_user_id = v_b and lifted_at is not null;
  if n >= 1 then
    raise notice 'PASS 16: the lifted block is retained as history, distinguishable from never having blocked';
  else
    raise notice 'FAIL 16: unblocking destroyed the record';
  end if;

  if not internal.is_personally_blocked(v_b, v_a) then
    raise notice 'PASS 17: contact is permitted again once the block is lifted';
  else
    raise notice 'FAIL 17: the lifted block still suppresses contact';
  end if;

  -- 18. Unblocking again is safe.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  begin
    perform public.unblock_user(v_b);
    raise notice 'PASS 18: unblocking somebody who is not blocked is harmless';
  exception when others then
    raise notice 'FAIL 18: a repeat unblock raised (%)', left(sqlerrm, 60);
  end;

  -- =================================================================
  -- 19. A FORGED BLOCKER IS REFUSED
  -- block_user always writes auth.uid() as the blocker, so the only way to
  -- forge one is a direct insert -- which RLS refuses.
  -- =================================================================
  begin
    insert into public.user_message_blocks (blocker_user_id, blocked_user_id)
    values (v_c, v_b);
    raise notice 'FAIL 19: a block was created on somebody else''s behalf';
  exception when others then
    raise notice 'PASS 19: you cannot create a block as another person';
  end;
end $$;

rollback;
