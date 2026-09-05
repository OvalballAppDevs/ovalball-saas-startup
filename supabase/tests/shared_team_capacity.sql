-- Manual verification for the shared mini-rugby OPERATIONAL team upgrade
-- (20260902130000): fixture capacity conflict (one booking per shared
-- group per day), owning_scheduling_group_id tagging, real lead-team
-- resolution (never a synthetic team), and that component teams stay
-- fully independent. NOT a migration -- run AFTER permission_matrix.sql.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/shared_team_capacity.sql

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, active) values
    ('96000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U7', 'boys', null, 'U7 STC', 'burnley-u7-stc', true),
    ('96000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U8', null, 'B', 'U8 STC', 'burnley-u8-stc', true)
  on conflict (id) do nothing;
  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, display_name, slug, active) values
    ('96000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'union', 'youth', 'U7', 'STC', 'Rossendale U7 STC', 'rossendale-u7-stc', false)
  on conflict (id) do nothing;
end $$;

-- ------------------------------------------------------------
-- 1. Creating a shared U7/U8 group does not touch the real U7/U8 team
--    rows at all -- component teams remain intact and unrenamed.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
  v_u7_name text;
  v_u8_name text;
begin
  v_group_id := public.create_scheduling_group('10000000-0000-0000-0000-000000000001', array['96000000-0000-0000-0000-000000000001'::uuid, '96000000-0000-0000-0000-000000000002'::uuid]);
  select display_name into v_u7_name from public.teams where id = '96000000-0000-0000-0000-000000000001';
  select display_name into v_u8_name from public.teams where id = '96000000-0000-0000-0000-000000000002';
  if v_u7_name = 'U7' and v_u8_name = 'U8 B' then
    raise notice 'PASS 1: creating the shared group left both component teams'' identity completely untouched';
  else
    raise notice 'FAIL 1: u7_name=%, u8_name=%', v_u7_name, v_u8_name;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 2. First fixture booked FOR the shared group succeeds and is tagged
--    with owning_scheduling_group_id -- one real member team as the lead,
--    never a synthetic team.
-- ------------------------------------------------------------
do $$
declare
  v_group_id uuid;
begin
  select sg.id into v_group_id from public.scheduling_groups sg join public.scheduling_group_members sgm on sgm.group_id = sg.id where sg.club_id = '10000000-0000-0000-0000-000000000001' and sgm.team_id = '96000000-0000-0000-0000-000000000001';
  insert into public.fixtures (id, owning_team_id, owning_scheduling_group_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('96000000-0000-0000-0000-000000000010', '96000000-0000-0000-0000-000000000001', v_group_id, '96000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date + 10, 'Booked', 'club_created');
end $$;

do $$
declare
  v_owning_team_id uuid;
  v_group_id uuid;
begin
  select owning_team_id, owning_scheduling_group_id into v_owning_team_id, v_group_id from public.fixtures where id = '96000000-0000-0000-0000-000000000010';
  if v_owning_team_id = '96000000-0000-0000-0000-000000000001' and v_group_id is not null then
    raise notice 'PASS 2: the fixture is owned by a real member team (U7) and tagged with the shared group -- never a synthetic team';
  else
    raise notice 'FAIL 2: owning_team_id=%, group_id=%', v_owning_team_id, v_group_id;
  end if;
end $$;

-- ------------------------------------------------------------
-- 3. A SECOND fixture on the SAME date for the OTHER component team (U8)
--    is rejected -- the shared group already has a commitment that day,
--    even though U8 itself looks "free".
-- ------------------------------------------------------------
do $$
begin
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('96000000-0000-0000-0000-000000000011', '96000000-0000-0000-0000-000000000002', '96000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date + 10, 'Booked', 'club_created');
  raise notice 'FAIL 3: U8 was double-booked on a date the shared U7/U8 group already has a commitment';
exception when others then
  raise notice 'PASS 3: a same-day fixture for U8 (the OTHER member) is rejected -- the shared group may hold only one match per day (%)', sqlerrm;
end $$;

-- ------------------------------------------------------------
-- 4. A fixture explicitly tagged with the SAME owning_scheduling_group_id
--    on the same date (via a different lead team) is ALSO rejected.
-- ------------------------------------------------------------
do $$
declare
  v_group_id uuid;
begin
  select sg.id into v_group_id from public.scheduling_groups sg join public.scheduling_group_members sgm on sgm.group_id = sg.id where sg.club_id = '10000000-0000-0000-0000-000000000001' and sgm.team_id = '96000000-0000-0000-0000-000000000001';
  insert into public.fixtures (id, owning_team_id, owning_scheduling_group_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('96000000-0000-0000-0000-000000000012', '96000000-0000-0000-0000-000000000002', v_group_id, '96000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date + 10, 'Booked', 'club_created');
  raise notice 'FAIL 4: a second explicitly-tagged shared-group fixture was accepted on the same day';
exception when others then
  raise notice 'PASS 4: a second explicitly-tagged shared-group booking on the same day is rejected (%)', sqlerrm;
end $$;

-- ------------------------------------------------------------
-- 5. A DIFFERENT date for the shared group succeeds -- the constraint is
--    per-day, not a blanket "only one fixture ever".
-- ------------------------------------------------------------
do $$
declare
  v_group_id uuid;
begin
  select sg.id into v_group_id from public.scheduling_groups sg join public.scheduling_group_members sgm on sgm.group_id = sg.id where sg.club_id = '10000000-0000-0000-0000-000000000001' and sgm.team_id = '96000000-0000-0000-0000-000000000001';
  insert into public.fixtures (id, owning_team_id, owning_scheduling_group_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('96000000-0000-0000-0000-000000000013', '96000000-0000-0000-0000-000000000002', v_group_id, '96000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date + 17, 'Booked', 'club_created');
  raise notice 'PASS 5: a shared-group fixture on a DIFFERENT date succeeds -- the constraint is per-day, not a blanket single-fixture limit';
exception when others then
  raise notice 'FAIL 5: a genuinely different date was unexpectedly rejected (%)', sqlerrm;
end $$;

-- ------------------------------------------------------------
-- 6. A component team (U7) can still independently book its OWN,
--     non-shared fixture on a day the group has no commitment.
-- ------------------------------------------------------------
do $$
begin
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('96000000-0000-0000-0000-000000000014', '96000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date + 24, 'Booked', 'club_created');
  raise notice 'PASS 6: a component team can still book independently on a date the shared group has no commitment';
exception when others then
  raise notice 'FAIL 6: an unrelated free date was unexpectedly rejected (%)', sqlerrm;
end $$;

-- ------------------------------------------------------------
-- 7. Deactivating the shared group lifts the capacity constraint for new
--    bookings (an inactive group no longer reserves its members'
--    calendars).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
begin
  select sg.id into v_group_id from public.scheduling_groups sg join public.scheduling_group_members sgm on sgm.group_id = sg.id where sg.club_id = '10000000-0000-0000-0000-000000000001' and sgm.team_id = '96000000-0000-0000-0000-000000000001';
  perform public.set_scheduling_group_active(v_group_id, false);
end $$;
commit;

do $$
begin
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('96000000-0000-0000-0000-000000000015', '96000000-0000-0000-0000-000000000002', '96000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date + 10, 'Booked', 'club_created');
  raise notice 'PASS 7: deactivating the shared group lifts the capacity constraint for new bookings on that date';
exception when others then
  raise notice 'FAIL 7: a deactivated group still blocked a new booking (%)', sqlerrm;
end $$;

-- Reactivate for the remaining tests.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
begin
  select sg.id into v_group_id from public.scheduling_groups sg join public.scheduling_group_members sgm on sgm.group_id = sg.id where sg.club_id = '10000000-0000-0000-0000-000000000001' and sgm.team_id = '96000000-0000-0000-0000-000000000001';
  perform public.set_scheduling_group_active(v_group_id, true);
end $$;
commit;
-- (test 15's own fixture is a real, harmless extra booking -- left in place)

-- ------------------------------------------------------------
-- 8. U9 remains fully incompatible with the U6-U8 mini band even for a
--     shared-team-booked opponent (age eligibility unchanged).
-- ------------------------------------------------------------
do $$
begin
  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, display_name, slug, active)
  values ('96000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'union', 'youth', 'U9', 'STC', 'Rossendale U9 STC', 'rossendale-u9-stc', false)
  on conflict (id) do nothing;
end $$;

do $$
declare
  v_can_play boolean;
begin
  select internal.teams_can_play_fixture('96000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000004') into v_can_play;
  if not v_can_play then
    raise notice 'PASS 8: U9 remains fully incompatible with a U6-U8 shared-team member -- age eligibility is unchanged';
  else
    raise notice 'FAIL 8: U7 vs U9 was unexpectedly eligible';
  end if;
end $$;

-- ------------------------------------------------------------
-- 9. Permissions: an unrelated club cannot book a fixture tagged with
--    another club's shared group (the group's own club_id is not theirs).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
begin
  select sg.id into v_group_id from public.scheduling_groups sg join public.scheduling_group_members sgm on sgm.group_id = sg.id where sg.club_id = '10000000-0000-0000-0000-000000000001' and sgm.team_id = '96000000-0000-0000-0000-000000000001';
  perform public.set_scheduling_group_members(v_group_id, array['96000000-0000-0000-0000-000000000001'::uuid, '96000000-0000-0000-0000-000000000002'::uuid]);
  raise notice 'FAIL 9: Rossendale''s admin edited Burnley''s shared group';
exception when others then
  raise notice 'PASS 9: an unrelated club still cannot manage another club''s shared group (unchanged permission boundary) (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 10. Historical fixtures for component teams are completely unaffected
--     by any of the shared-group bookings above.
-- ------------------------------------------------------------
do $$
begin
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('96000000-0000-0000-0000-000000000016', '96000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date - 60, 'Completed', 'club_created')
  on conflict (id) do nothing;
end $$;

do $$
declare
  v_status text;
begin
  select status into v_status from public.fixtures where id = '96000000-0000-0000-0000-000000000016';
  if v_status = 'Completed' then
    raise notice 'PASS 10: a component team''s own historical fixture is completely unaffected by the shared-group capacity rule';
  else
    raise notice 'FAIL 10: status=%', v_status;
  end if;
end $$;

-- ------------------------------------------------------------
-- 11. Calendar aggregation without duplication: the shared group's
--     bookings show as exactly the number of real fixture rows created
--     above (2 for the group so far: tests 2 and 5), never inflated by
--     the capacity trigger itself creating extra rows.
-- ------------------------------------------------------------
do $$
declare
  v_group_id uuid;
  v_count integer;
begin
  select sg.id into v_group_id from public.scheduling_groups sg join public.scheduling_group_members sgm on sgm.group_id = sg.id where sg.club_id = '10000000-0000-0000-0000-000000000001' and sgm.team_id = '96000000-0000-0000-0000-000000000001';
  select count(*) into v_count from public.fixtures where owning_scheduling_group_id = v_group_id;
  if v_count = 2 then
    raise notice 'PASS 11: the shared group''s calendar shows exactly the real bookings made (2), never duplicated by the capacity trigger';
  else
    raise notice 'FAIL 11: owning_scheduling_group_id fixture count = %', v_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 12. A cancelled fixture never counts toward the capacity check --
--     cancelling the original booking frees the date for a new one.
-- ------------------------------------------------------------
do $$
declare
  v_group_id uuid;
begin
  -- A dedicated, previously-unused date -- current_date+10 is no longer
  -- clean for this check since test 7 left fixture ...015 booked on it.
  select sg.id into v_group_id from public.scheduling_groups sg join public.scheduling_group_members sgm on sgm.group_id = sg.id where sg.club_id = '10000000-0000-0000-0000-000000000001' and sgm.team_id = '96000000-0000-0000-0000-000000000001';
  insert into public.fixtures (id, owning_team_id, owning_scheduling_group_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('96000000-0000-0000-0000-000000000018', '96000000-0000-0000-0000-000000000001', v_group_id, '96000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date + 38, 'Booked', 'club_created');
  update public.fixtures set status = 'Cancelled' where id = '96000000-0000-0000-0000-000000000018';
end $$;

do $$
begin
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('96000000-0000-0000-0000-000000000017', '96000000-0000-0000-0000-000000000002', '96000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date + 38, 'Booked', 'club_created');
  raise notice 'PASS 12: a cancelled fixture no longer occupies the shared group''s capacity -- the freed date accepts a new booking';
exception when others then
  raise notice 'FAIL 12: a date freed by cancellation was still rejected (%)', sqlerrm;
end $$;

-- ------------------------------------------------------------
-- 13. team_result_stats never attributes stats to a fake "shared" team --
--     only the real, tagged owning_team_id (a genuine teams row) can ever
--     appear as a team_id in that view.
-- ------------------------------------------------------------
do $$
declare
  v_fake_team_count integer;
begin
  select count(*) into v_fake_team_count
  from public.team_result_stats trs
  where not exists (select 1 from public.teams t where t.id = trs.team_id);
  if v_fake_team_count = 0 then
    raise notice 'PASS 13: every team_id in team_result_stats is a real, existing teams row -- no fake shared-team stats bucket exists';
  else
    raise notice 'FAIL 13: % team_result_stats row(s) reference a non-existent team', v_fake_team_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 14. Reorder/rename of the shared group's own metadata (unchanged from
--     scheduling_groups.sql) still works exactly as before -- the
--     capacity trigger is purely additive, doesn't interfere with normal
--     group management.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
  v_tag text;
begin
  select sg.id into v_group_id from public.scheduling_groups sg join public.scheduling_group_members sgm on sgm.group_id = sg.id where sg.club_id = '10000000-0000-0000-0000-000000000001' and sgm.team_id = '96000000-0000-0000-0000-000000000001';
  perform public.set_scheduling_group_members(v_group_id, array['96000000-0000-0000-0000-000000000001'::uuid, '96000000-0000-0000-0000-000000000002'::uuid]);
  select display_tag into v_tag from public.scheduling_groups where id = v_group_id;
  if v_tag = 'U7/U8' then
    raise notice 'PASS 14: normal group membership management still works unchanged alongside the new capacity trigger';
  else
    raise notice 'FAIL 14: unexpected tag %', v_tag;
  end if;
end $$;
commit;
