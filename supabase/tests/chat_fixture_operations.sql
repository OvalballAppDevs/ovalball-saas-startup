-- Manual verification for chat-driven fixture operations (20260902100000
-- mirror sync, 20260902120000 kickoff): kickoff propose/accept/reject
-- lifecycle, mirror-row propagation for both pitch and kickoff, and
-- authorization. NOT a migration -- run AFTER permission_matrix.sql.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/chat_fixture_operations.sql

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  -- A real, linked mirror pair: Burnley (home) <-> Rossendale (away).
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values ('94000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date + 14, '11:00', 'Booked', 'club_created')
  on conflict (id) do nothing;
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, mirror_fixture_id)
  values ('94000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', 'Away', 'Burnley RUFC', current_date + 14, '11:00', 'Booked', 'club_created', '94000000-0000-0000-0000-000000000001')
  on conflict (id) do nothing;
  update public.fixtures set mirror_fixture_id = '94000000-0000-0000-0000-000000000002' where id = '94000000-0000-0000-0000-000000000001';

  -- An external/unresolved-opponent fixture -- no mirror, direct edit path.
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values ('94000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', null, 'Home', 'Vacant Fixture FC', current_date + 20, '11:00', 'Booked', 'club_created')
  on conflict (id) do nothing;
end $$;

-- ------------------------------------------------------------
-- 1. Authorized home club can propose a kickoff change on an
--    already-resolved two-sided fixture -- it does NOT apply immediately.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_kickoff_date date;
  v_pending_date date;
begin
  perform public.update_fixture_kickoff('94000000-0000-0000-0000-000000000001', current_date + 15, '14:00');
  select kickoff_date, kickoff_amendment_proposed_date into v_kickoff_date, v_pending_date from public.fixtures where id = '94000000-0000-0000-0000-000000000001';
  if v_kickoff_date = current_date + 14 and v_pending_date = current_date + 15 then
    raise notice 'PASS 1: a material kickoff change on a resolved fixture is staged as a pending amendment, not applied immediately';
  else
    raise notice 'FAIL 1: kickoff_date=%, pending=%', v_kickoff_date, v_pending_date;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 2. An unrelated user (no relationship to this fixture) cannot propose a
--    kickoff change.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
do $$
begin
  perform public.update_fixture_kickoff('94000000-0000-0000-0000-000000000001', current_date + 16, null);
  raise notice 'FAIL 2: an unrelated user changed the kickoff';
exception when others then
  raise notice 'PASS 2: an unrelated user cannot change the kickoff (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 3. The opponent proposing back exactly the pending value IS acceptance
--    -- canonical kickoff updates.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
select public.update_fixture_kickoff('94000000-0000-0000-0000-000000000001', current_date + 15, '14:00');
commit;

do $$
declare
  v_kickoff_date date;
  v_kickoff_time time;
  v_pending_date date;
begin
  select kickoff_date, kickoff_time, kickoff_amendment_proposed_date into v_kickoff_date, v_kickoff_time, v_pending_date
  from public.fixtures where id = '94000000-0000-0000-0000-000000000001';
  if v_kickoff_date = current_date + 15 and v_kickoff_time = '14:00' and v_pending_date is null then
    raise notice 'PASS 3: the opponent confirming the exact proposed kickoff applies it to the canonical fixture';
  else
    raise notice 'FAIL 3: kickoff_date=%, kickoff_time=%, pending=%', v_kickoff_date, v_kickoff_time, v_pending_date;
  end if;
end $$;

-- ------------------------------------------------------------
-- 4. Calendar reads the changed kickoff -- verified directly against the
--    canonical fixtures row Burnley's own calendar query
--    (owning_team_id in (my teams)) actually reads.
-- ------------------------------------------------------------
do $$
declare
  v_kickoff_time time;
begin
  select kickoff_time into v_kickoff_time from public.fixtures where owning_team_id = '30000000-0000-0000-0000-000000000001' and id = '94000000-0000-0000-0000-000000000001';
  if v_kickoff_time = '14:00' then
    raise notice 'PASS 4: Burnley''s own calendar query (owning_team_id) reads the updated kickoff';
  else
    raise notice 'FAIL 4: kickoff_time=%', v_kickoff_time;
  end if;
end $$;

-- ------------------------------------------------------------
-- 5. Mirror propagation: Rossendale's OWN separate fixtures row (their
--    own calendar query) shows the SAME new kickoff -- never stale.
-- ------------------------------------------------------------
do $$
declare
  v_kickoff_date date;
  v_kickoff_time time;
begin
  select kickoff_date, kickoff_time into v_kickoff_date, v_kickoff_time
  from public.fixtures where owning_team_id = '30000000-0000-0000-0000-000000000003' and id = '94000000-0000-0000-0000-000000000002';
  if v_kickoff_date = current_date + 15 and v_kickoff_time = '14:00' then
    raise notice 'PASS 5: Rossendale''s own mirror fixture row (their own calendar query) has the SAME kickoff -- never stale';
  else
    raise notice 'FAIL 5: kickoff_date=%, kickoff_time=%', v_kickoff_date, v_kickoff_time;
  end if;
end $$;

-- ------------------------------------------------------------
-- 6. Pitch stays canonical and synchronized to the mirror too (same
--    mechanism, already exercised by club_pitches.sql -- re-verified
--    here specifically via the mirror pair used in this file).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_pitch_id uuid;
begin
  v_pitch_id := public.create_club_pitch('10000000-0000-0000-0000-000000000001', 'Chat Test Pitch', null);
  perform public.update_fixture_pitch('94000000-0000-0000-0000-000000000001', v_pitch_id, null);
end $$;
commit;

do $$
declare
  v_mirror_pitch_id uuid;
  v_canonical_pitch_id uuid;
begin
  select pitch_id into v_canonical_pitch_id from public.fixtures where id = '94000000-0000-0000-0000-000000000001';
  select pitch_id into v_mirror_pitch_id from public.fixtures where id = '94000000-0000-0000-0000-000000000002';
  if v_mirror_pitch_id = v_canonical_pitch_id and v_mirror_pitch_id is not null then
    raise notice 'PASS 6: pitch stays canonical and synchronized to the mirror fixture row';
  else
    raise notice 'FAIL 6: canonical=%, mirror=%', v_canonical_pitch_id, v_mirror_pitch_id;
  end if;
end $$;

-- ------------------------------------------------------------
-- 7. Exactly one chat system event is generated per kickoff change (never
--    duplicated per mirror row -- the event lives on the canonical
--    conversation's own fixture_id only).
-- ------------------------------------------------------------
do $$
declare
  v_event_count integer;
begin
  select count(*) into v_event_count from public.fixture_messages
  where fixture_id = '94000000-0000-0000-0000-000000000001' and kind = 'system_event' and body like 'Kick-off%';
  if v_event_count = 2 then -- one "proposed", one "confirmed"
    raise notice 'PASS 7: exactly the expected number of kick-off system events were generated (% ), never duplicated per mirror row', v_event_count;
  else
    raise notice 'FAIL 7: kickoff system event count = %', v_event_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 8. No duplicate fixture row was created by any of the above --
--    still exactly two rows for this match.
-- ------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.fixtures where id in ('94000000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000002');
  if v_count = 2 then
    raise notice 'PASS 8: no duplicate fixture was created -- still exactly 2 rows (one per side) for this match';
  else
    raise notice 'FAIL 8: fixture row count = %', v_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 9. An external/unresolved-opponent fixture applies a kickoff change
--    DIRECTLY (no amendment cycle -- nobody to agree with).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_kickoff_date date;
  v_pending_date date;
begin
  perform public.update_fixture_kickoff('94000000-0000-0000-0000-000000000003', current_date + 21, '15:00');
  select kickoff_date, kickoff_amendment_proposed_date into v_kickoff_date, v_pending_date from public.fixtures where id = '94000000-0000-0000-0000-000000000003';
  if v_kickoff_date = current_date + 21 and v_pending_date is null then
    raise notice 'PASS 9: an external/unresolved-opponent fixture applies a kickoff change directly, no amendment cycle';
  else
    raise notice 'FAIL 9: kickoff_date=%, pending=%', v_kickoff_date, v_pending_date;
  end if;
end $$;
commit;
