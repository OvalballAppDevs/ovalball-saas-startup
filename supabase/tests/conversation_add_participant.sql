-- Manual verification for explicit fixture-conversation participant
-- grants (20260901040000): own-club-only targeting, existing-access
-- required to add, extended can_access_fixture_conversation actually
-- grants real message access, and idempotent re-add. NOT a migration --
-- run AFTER permission_matrix.sql and partner_clubs_and_messaging.sql
-- (reuses Leigh RUFC, 0011, as the unrelated-club negative case).

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('f0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date + 7, 'Booked', 'club_created')
  on conflict (id) do nothing;
end $$;

-- ------------------------------------------------------------
-- 1. Burnley Club Admin adds a Burnley BASIC_USER (0003 is Rossendale --
--    use Burnley's own basic member, 0004) into the conversation.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.add_fixture_conversation_participant('f0000000-0000-0000-0000-000000000001', null, '00000000-0000-0000-0000-000000000004');
  if exists (select 1 from public.fixture_conversation_participants where fixture_id = 'f0000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-000000000004') then
    raise notice 'PASS 1: Burnley Club Admin added a fellow Burnley member to the conversation';
  else
    raise notice 'FAIL 1: no participant row was created';
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 2. The newly-added member (0004, a BASIC_USER with no club/team role)
--    can now actually read the conversation -- the extended
--    can_access_fixture_conversation grant works end to end.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.fixture_messages where fixture_id = 'f0000000-0000-0000-0000-000000000001';
  if v_count > 0 then
    raise notice 'PASS 2: the newly-added participant can read the conversation (% messages visible)', v_count;
  else
    raise notice 'FAIL 2: the newly-added participant still cannot see any messages';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 3. Burnley Club Admin cannot add a Rossendale (opponent-club) user --
--    "any user allocated to THEIR club" means the caller's own club only.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.add_fixture_conversation_participant('f0000000-0000-0000-0000-000000000001', null, '00000000-0000-0000-0000-000000000003');
  raise notice 'FAIL 3: an opponent-club user was addable';
exception when others then
  raise notice 'PASS 3: cannot add a user from the opponent club (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 4. Unrelated club (Leigh) cannot add anyone -- they have no standing to
--    even call the RPC on this fixture.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000011","role":"authenticated"}';
do $$
begin
  perform public.add_fixture_conversation_participant('f0000000-0000-0000-0000-000000000001', null, '00000000-0000-0000-0000-000000000011');
  raise notice 'FAIL 4: an unrelated club could add a participant';
exception when others then
  raise notice 'PASS 4: an unrelated club cannot add anyone to this conversation (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 5. Re-adding the same person is idempotent (no duplicate row, no error).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  perform public.add_fixture_conversation_participant('f0000000-0000-0000-0000-000000000001', null, '00000000-0000-0000-0000-000000000004');
  select count(*) into v_count from public.fixture_conversation_participants where fixture_id = 'f0000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-000000000004';
  if v_count = 1 then
    raise notice 'PASS 5: re-adding the same person is idempotent (still 1 row)';
  else
    raise notice 'FAIL 5: % rows exist after re-adding', v_count;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 6. Parent/player (0007, view_only) is NEVER addable -- "mainly just
--    coaches for that age", never parents/players.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_listed boolean;
begin
  select exists (
    select 1 from public.list_addable_club_members('f0000000-0000-0000-0000-000000000001', null) x where x.user_id = '00000000-0000-0000-0000-000000000007'
  ) into v_listed;
  if v_listed then
    raise notice 'FAIL 6a: the parent/player was listed as addable';
  else
    raise notice 'PASS 6a: the parent/player does not appear in the addable list';
  end if;
end $$;
do $$
begin
  perform public.add_fixture_conversation_participant('f0000000-0000-0000-0000-000000000001', null, '00000000-0000-0000-0000-000000000007');
  raise notice 'FAIL 6b: the parent/player was addable via the RPC';
exception when others then
  raise notice 'PASS 6b: the parent/player cannot be added via the RPC (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 7. A coach (0006, team-scoped coach permission on this fixture's own
--    team) IS addable -- the operational-contact scope includes coaches.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_listed boolean;
begin
  select exists (
    select 1 from public.list_addable_club_members('f0000000-0000-0000-0000-000000000001', null) x where x.user_id = '00000000-0000-0000-0000-000000000006'
  ) into v_listed;
  perform public.add_fixture_conversation_participant('f0000000-0000-0000-0000-000000000001', null, '00000000-0000-0000-0000-000000000006');
  if v_listed and exists (select 1 from public.fixture_conversation_participants where fixture_id = 'f0000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-000000000006') then
    raise notice 'PASS 7: the coach is listed and addable';
  else
    raise notice 'FAIL 7: coach listed=%, added row exists=%', v_listed, (select exists (select 1 from public.fixture_conversation_participants where fixture_id = 'f0000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-000000000006'));
  end if;
end $$;
rollback;

do $$
begin
  delete from public.fixture_conversation_participants where fixture_id = 'f0000000-0000-0000-0000-000000000001';
  delete from public.fixture_messages where fixture_id = 'f0000000-0000-0000-0000-000000000001';
  delete from public.fixtures where id = 'f0000000-0000-0000-0000-000000000001';
exception when others then null;
end $$;
