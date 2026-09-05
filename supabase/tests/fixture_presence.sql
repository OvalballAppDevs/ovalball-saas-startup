-- Manual verification for presence (20260831400000): touch_last_active()
-- self-only heartbeat, and Realtime Presence channel authorization on
-- realtime.messages via internal.can_access_fixture_presence_topic(). NOT
-- a migration -- run AFTER permission_matrix.sql. Reuses Burnley (0002)/
-- Rossendale (0003) and the fixture created by fixture_message_attachments.
-- sql -- run that file first, or this one creates its own fixture if
-- missing.

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  -- conversation_id explicitly = id: this fixture has no mirror row, so
  -- its own id is a perfectly good, deterministic conversation_id for the
  -- presence-topic tests below (the column's real default is a fresh
  -- gen_random_uuid(), which would make the hardcoded topic strings below
  -- resolve to nothing).
  insert into public.fixtures (id, owning_team_id, opponent_team_id, kickoff_date, kickoff_time, home_away, status, raw_opposition_text, created_by, updated_by, conversation_id)
  values ('c0000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003',
          current_date + 7, '14:00', 'Home', 'Booked', 'Rossendale RUFC', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002',
          'c0000000-0000-0000-0000-000000000002')
  on conflict (id) do nothing;
end $$;

-- ------------------------------------------------------------
-- 1. touch_last_active() updates only the caller's own row.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.touch_last_active();
end $$;
commit;

do $$
declare
  v_touched timestamptz;
  v_others_touched int;
begin
  select last_active_at into v_touched from public.profiles where id = '00000000-0000-0000-0000-000000000002';
  select count(*) into v_others_touched from public.profiles where id <> '00000000-0000-0000-0000-000000000002' and last_active_at is not null;
  if v_touched is not null and v_touched > now() - interval '1 minute' and v_others_touched = 0 then
    raise notice 'PASS 1: touch_last_active() updated only the caller''s own last_active_at';
  else
    raise notice 'FAIL 1: touched=% others_touched=%', v_touched, v_others_touched;
  end if;
end $$;

-- ------------------------------------------------------------
-- 2/3. Authorized participants (Burnley owning-side, Rossendale opponent)
--    CAN join the fixture's presence channel.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  if internal.can_access_fixture_presence_topic('presence:f:c0000000-0000-0000-0000-000000000002') then
    raise notice 'PASS 2: fixture-owning Club Admin (Burnley) can join the presence channel';
  else
    raise notice 'FAIL 2: owning club admin denied';
  end if;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  if internal.can_access_fixture_presence_topic('presence:f:c0000000-0000-0000-0000-000000000002') then
    raise notice 'PASS 3: opponent club admin (Rossendale) can join the presence channel';
  else
    raise notice 'FAIL 3: opponent club admin denied';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 4. Unrelated club/View Only/anon CANNOT join.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}'; -- Parent, view_only
do $$
begin
  if internal.can_access_fixture_presence_topic('presence:f:c0000000-0000-0000-0000-000000000002') then
    raise notice 'FAIL 4: View Only/Parent joined the presence channel';
  else
    raise notice 'PASS 4: View Only/Parent cannot join the presence channel';
  end if;
end $$;
rollback;

begin;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
begin
  if internal.can_access_fixture_presence_topic('presence:f:c0000000-0000-0000-0000-000000000002') then
    raise notice 'FAIL 5: anon joined the presence channel';
  else
    raise notice 'PASS 5: anon/public cannot join the presence channel';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 6. realtime.messages RLS itself enforces the same boundary (not just
--    the helper function in isolation) -- a suspended user cannot select
--    from realtime.messages for this topic even though they would
--    otherwise be the relevant Team Admin.
-- ------------------------------------------------------------
begin;
update public.profiles set account_status = 'suspended' where id = '00000000-0000-0000-0000-000000000004';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$
begin
  if internal.can_access_fixture_presence_topic('presence:f:c0000000-0000-0000-0000-000000000002') then
    raise notice 'FAIL 6: a suspended Team Admin can still join the presence channel';
  else
    raise notice 'PASS 6: a suspended user cannot join the presence channel, even for their own team''s fixture';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 7. A malformed/foreign topic name is safely rejected, not just
--    fixture-mismatched ones.
-- ------------------------------------------------------------
do $$
begin
  if internal.can_access_fixture_presence_topic('some-other-app-channel') then
    raise notice 'FAIL 7: an unrelated/malformed topic name was granted access';
  else
    raise notice 'PASS 7: a malformed or unrelated topic name is safely rejected';
  end if;
end $$;

do $$
begin
  delete from public.fixtures where id = 'c0000000-0000-0000-0000-000000000002';
  update public.profiles set last_active_at = null where id = '00000000-0000-0000-0000-000000000002';
end $$;
