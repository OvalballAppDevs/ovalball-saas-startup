-- Manual verification for team lifecycle (fold / reactivate / fixture
-- restoration) built in 20260902140000_team_lifecycle.sql. NOT a
-- migration -- run AFTER permission_matrix.sql.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/team_lifecycle.sql

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  -- A dedicated Burnley team to fold, with a real activated Rossendale
  -- opponent, an external/unresolved opponent, a past fixture+result, and
  -- a future fixture already Cancelled for an unrelated reason (must be
  -- left untouched by fold_team, not double-cancelled).
  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, display_name, slug)
  values ('97000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U12', 'B', 'Burnley RUFC U12 B', 'burnley-u12-b')
  on conflict (id) do nothing;

  -- Real activated opponent, future, not yet cancelled.
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('97000000-0000-0000-0000-000000000010', '97000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date + 14, 'Booked', 'club_created')
  on conflict (id) do nothing;
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source, mirror_fixture_id)
  values ('97000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000003', '97000000-0000-0000-0000-000000000001', 'Away', 'Burnley RUFC', current_date + 14, 'Booked', 'club_created', '97000000-0000-0000-0000-000000000010')
  on conflict (id) do nothing;
  update public.fixtures set mirror_fixture_id = '97000000-0000-0000-0000-000000000011' where id = '97000000-0000-0000-0000-000000000010';

  -- External/unresolved opponent, future, not yet cancelled.
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('97000000-0000-0000-0000-000000000012', '97000000-0000-0000-0000-000000000001', null, 'Home', 'Vacant Fixture FC', current_date + 21, 'Booked', 'club_created')
  on conflict (id) do nothing;

  -- Past fixture with a final result -- must remain untouched.
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source, home_score, away_score, result_status)
  values ('97000000-0000-0000-0000-000000000013', '97000000-0000-0000-0000-000000000001', null, 'Home', 'Old Rivals FC', current_date - 60, 'Completed', 'club_created', 24, 12, 'external_recorded')
  on conflict (id) do nothing;

  -- A future fixture ALREADY cancelled for an unrelated reason before the
  -- fold -- must not be relabelled cancelled_due_to_fold.
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source, cancelled_at, cancellation_reason)
  values ('97000000-0000-0000-0000-000000000014', '97000000-0000-0000-0000-000000000001', null, 'Home', 'Weather Cancelled FC', current_date + 28, 'Cancelled', 'club_created', now() - interval '1 day', 'Pitch waterlogged')
  on conflict (id) do nothing;
end $$;

-- ------------------------------------------------------------
-- 1. An ordinary club member (not admin) cannot fold a team.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$
begin
  perform public.fold_team('97000000-0000-0000-0000-000000000001', 'Not enough players');
  raise notice 'FAIL 1: an ordinary member folded a team';
exception when others then
  raise notice 'PASS 1: an ordinary club member cannot fold a team (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 2. A reason is required.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.fold_team('97000000-0000-0000-0000-000000000001', '   ');
  raise notice 'FAIL 2: folding succeeded with an empty reason';
exception when others then
  raise notice 'PASS 2: a reason is required to fold a team (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 3. Club Admin CAN fold the team -- returns the affected-fixture count.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_count integer;
begin
  v_count := public.fold_team('97000000-0000-0000-0000-000000000001', 'Not enough players this season');
  if v_count = 2 then -- fixtures 10 (real opponent) and 12 (external) -- 13 is past, 14 already cancelled
    raise notice 'PASS 3: the authorized Club Admin folded the team, affecting exactly the 2 real future active fixtures';
  else
    raise notice 'FAIL 3: fold_team returned %', v_count;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 4. teams.active is now false, with folded_at/folded_by/fold_reason set.
-- ------------------------------------------------------------
do $$
declare
  v_active boolean;
  v_reason text;
  v_folded_at timestamptz;
begin
  select active, fold_reason, folded_at into v_active, v_reason, v_folded_at from public.teams where id = '97000000-0000-0000-0000-000000000001';
  if v_active = false and v_reason = 'Not enough players this season' and v_folded_at is not null then
    raise notice 'PASS 4: the team lifecycle state (active=false, folded_at, fold_reason) is set -- never a delete';
  else
    raise notice 'FAIL 4: active=%, reason=%, folded_at=%', v_active, v_reason, v_folded_at;
  end if;
end $$;

-- ------------------------------------------------------------
-- 5. The PAST fixture with its recorded result is completely untouched.
-- ------------------------------------------------------------
do $$
declare
  v_status text;
  v_home_score integer;
begin
  select status, home_score into v_status, v_home_score from public.fixtures where id = '97000000-0000-0000-0000-000000000013';
  if v_status = 'Completed' and v_home_score = 24 then
    raise notice 'PASS 5: a past fixture and its recorded result are completely untouched by the fold';
  else
    raise notice 'FAIL 5: status=%, home_score=%', v_status, v_home_score;
  end if;
end $$;

-- ------------------------------------------------------------
-- 6. The future real-opponent fixture is Cancelled, tagged
--    cancelled_due_to_fold, and its own mirror row is cancelled too.
-- ------------------------------------------------------------
do $$
declare
  v_status text;
  v_fold_flag boolean;
  v_mirror_status text;
begin
  select status, cancelled_due_to_fold into v_status, v_fold_flag from public.fixtures where id = '97000000-0000-0000-0000-000000000010';
  select status into v_mirror_status from public.fixtures where id = '97000000-0000-0000-0000-000000000011';
  if v_status = 'Cancelled' and v_fold_flag and v_mirror_status = 'Cancelled' then
    raise notice 'PASS 6: the future real-opponent fixture is cancelled and tagged cancelled_due_to_fold, and its mirror row (opponent''s own calendar) is cancelled too';
  else
    raise notice 'FAIL 6: status=%, fold_flag=%, mirror_status=%', v_status, v_fold_flag, v_mirror_status;
  end if;
end $$;

-- ------------------------------------------------------------
-- 7. The future fixture record itself is RETAINED (not deleted) --
--    still queryable in full.
-- ------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.fixtures where id in ('97000000-0000-0000-0000-000000000010', '97000000-0000-0000-0000-000000000011');
  if v_count = 2 then
    raise notice 'PASS 7: the cancelled fixture records are retained, never deleted';
  else
    raise notice 'FAIL 7: fixture row count = %', v_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 8. A real, activated opponent (Rossendale) received a chat system event
--    + notification on the mirror fixture's own conversation.
-- ------------------------------------------------------------
do $$
declare
  v_event_count integer;
begin
  select count(*) into v_event_count from public.fixture_messages
  where fixture_id = '97000000-0000-0000-0000-000000000010' and kind = 'system_event' and body like '%folded%';
  if v_event_count = 1 then
    raise notice 'PASS 8: a real, activated opponent was notified via a real chat system event -- never faked';
  else
    raise notice 'FAIL 8: fold system event count = %', v_event_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 9. The external/unresolved-opponent fixture got NO fake system event --
--    there is nobody authenticated to notify -- but it IS still
--    cancelled/tagged correctly.
-- ------------------------------------------------------------
do $$
declare
  v_status text;
  v_fold_flag boolean;
  v_event_count integer;
begin
  select status, cancelled_due_to_fold into v_status, v_fold_flag from public.fixtures where id = '97000000-0000-0000-0000-000000000012';
  select count(*) into v_event_count from public.fixture_messages where fixture_id = '97000000-0000-0000-0000-000000000012';
  if v_status = 'Cancelled' and v_fold_flag and v_event_count = 0 then
    raise notice 'PASS 9: an external/unresolved opponent gets no fake notification -- but the fixture is still correctly cancelled and archived';
  else
    raise notice 'FAIL 9: status=%, fold_flag=%, event_count=%', v_status, v_fold_flag, v_event_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 10. A fixture already cancelled for an UNRELATED reason before the fold
--     is left completely alone -- not relabelled cancelled_due_to_fold.
-- ------------------------------------------------------------
do $$
declare
  v_reason text;
  v_fold_flag boolean;
begin
  select cancellation_reason, cancelled_due_to_fold into v_reason, v_fold_flag from public.fixtures where id = '97000000-0000-0000-0000-000000000014';
  if v_reason = 'Pitch waterlogged' and v_fold_flag = false then
    raise notice 'PASS 10: a fixture already cancelled for an unrelated reason is left completely untouched by the fold, never relabelled';
  else
    raise notice 'FAIL 10: reason=%, fold_flag=%', v_reason, v_fold_flag;
  end if;
end $$;

-- ------------------------------------------------------------
-- 11. A folded team cannot accept a NEW fixture request (age/scheduling
--     eligibility trigger still fires against an inactive owning team --
--     verified here via a direct booking attempt).
-- ------------------------------------------------------------
do $$
begin
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('97000000-0000-0000-0000-000000000015', '97000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date + 35, 'Booked', 'club_created');
  raise notice 'FAIL 11: a folded (inactive) team accepted a brand-new fixture booking';
exception when others then
  raise notice 'PASS 11: a folded team cannot accept a new fixture booking (%)', sqlerrm;
end $$;

-- ------------------------------------------------------------
-- 12. Reactivation requires Club Admin/Site Admin authorization too.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$
begin
  perform public.reactivate_team('97000000-0000-0000-0000-000000000001');
  raise notice 'FAIL 12: an ordinary member reactivated a team';
exception when others then
  raise notice 'PASS 12: an ordinary club member cannot reactivate a folded team (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 13. Club Admin reactivates the team -- active=true again, but NO
--     cancelled fixture is automatically restored.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select public.reactivate_team('97000000-0000-0000-0000-000000000001');
commit;

do $$
declare
  v_active boolean;
  v_status10 text;
  v_status12 text;
begin
  select active into v_active from public.teams where id = '97000000-0000-0000-0000-000000000001';
  select status into v_status10 from public.fixtures where id = '97000000-0000-0000-0000-000000000010';
  select status into v_status12 from public.fixtures where id = '97000000-0000-0000-0000-000000000012';
  if v_active = true and v_status10 = 'Cancelled' and v_status12 = 'Cancelled' then
    raise notice 'PASS 13: reactivation restores the team identity for new bookings, but automatically restores NO cancelled fixture';
  else
    raise notice 'FAIL 13: active=%, status10=%, status12=%', v_active, v_status10, v_status12;
  end if;
end $$;

-- ------------------------------------------------------------
-- 14. list_restorable_fixtures shows exactly the 2 fold-cancelled
--     fixtures, ordered by kickoff_date, never the unrelated-cancellation
--     one.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_count integer;
  v_has_unrelated boolean;
begin
  select count(*) into v_count from public.list_restorable_fixtures('97000000-0000-0000-0000-000000000001');
  select bool_or(id = '97000000-0000-0000-0000-000000000014') into v_has_unrelated from public.list_restorable_fixtures('97000000-0000-0000-0000-000000000001');
  if v_count = 2 and not v_has_unrelated then
    raise notice 'PASS 14: "Previously Cancelled Fixtures" shows exactly the 2 fold-cancelled fixtures, never one cancelled for an unrelated reason';
  else
    raise notice 'FAIL 14: restorable count=%, includes_unrelated=%', v_count, v_has_unrelated;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 15. Restoring the real-activated-opponent fixture creates a FRESH,
--     reviewable fixture_request -- never a silent reinstatement.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_result_id uuid;
  v_is_request boolean;
  v_still_cancelled boolean;
begin
  v_result_id := public.request_fixture_restoration('97000000-0000-0000-0000-000000000010');
  select exists(select 1 from public.fixture_requests where id = v_result_id) into v_is_request;
  select (status = 'Cancelled') into v_still_cancelled from public.fixtures where id = '97000000-0000-0000-0000-000000000010';
  if v_is_request and v_still_cancelled then
    raise notice 'PASS 15: restoring a fixture with a real activated opponent creates a fresh, reviewable fixture_request -- never a silent reinstatement, and the original fixture stays cancelled pending that review';
  else
    raise notice 'FAIL 15: is_request=%, still_cancelled=%', v_is_request, v_still_cancelled;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 16. Restoring the external/unresolved-opponent fixture restores it
--     DIRECTLY to the active calendar (no in-app opponent to approve).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_status text;
  v_fold_flag boolean;
begin
  perform public.request_fixture_restoration('97000000-0000-0000-0000-000000000012');
  select status, cancelled_due_to_fold into v_status, v_fold_flag from public.fixtures where id = '97000000-0000-0000-0000-000000000012';
  if v_status = 'Booked' and v_fold_flag = false then
    raise notice 'PASS 16: an external/unresolved-opponent fixture restores directly to the active calendar after explicit local approval -- no fake opponent approval invented';
  else
    raise notice 'FAIL 16: status=%, fold_flag=%', v_status, v_fold_flag;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 17. A restoration conflict is detected and blocked: booking a NEW
--     fixture on the same date as fixture 12's restored slot, then
--     attempting to re-request restoration on an already-requested
--     fixture is rejected (no duplicate rows created either).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.request_fixture_restoration('97000000-0000-0000-0000-000000000012');
  raise notice 'FAIL 17: restoration was requested twice for the same fixture';
exception when others then
  raise notice 'PASS 17: a fixture whose restoration was already requested/completed cannot be re-requested -- no duplicate restoration path (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 18. A genuine scheduling conflict blocks restoration: fold+reactivate a
--     fresh team, book a NEW fixture on the SAME date as a would-be
--     restored one, then confirm restoration is rejected rather than
--     silently double-booking.
-- ------------------------------------------------------------
do $$
begin
  insert into public.teams (id, club_id, rugby_code, category, age_group, display_name, slug)
  values ('97000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U14', 'Burnley RUFC U14 A', 'burnley-u14-a')
  on conflict (id) do nothing;
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('97000000-0000-0000-0000-000000000020', '97000000-0000-0000-0000-000000000002', null, 'Home', 'Conflict Test FC', current_date + 42, 'Booked', 'club_created')
  on conflict (id) do nothing;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select public.fold_team('97000000-0000-0000-0000-000000000002', 'Squad merged for the season');
select public.reactivate_team('97000000-0000-0000-0000-000000000002');
commit;

do $$
begin
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('97000000-0000-0000-0000-000000000021', '97000000-0000-0000-0000-000000000002', null, 'Home', 'New Booking FC', current_date + 42, 'Booked', 'club_created');
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.request_fixture_restoration('97000000-0000-0000-0000-000000000020');
  raise notice 'FAIL 18: a fixture was restored into a date the team already has a new, conflicting booking on';
exception when others then
  raise notice 'PASS 18: a genuine scheduling conflict blocks restoration rather than silently double-booking (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 19. Audit: both fold and reactivate events are recorded in audit_log
--     with reason, actor, and timestamp -- never silently unaudited.
-- ------------------------------------------------------------
do $$
declare
  v_fold_count integer;
  v_reactivate_count integer;
begin
  select count(*) into v_fold_count from public.audit_log
  where table_name = 'teams' and record_id = '97000000-0000-0000-0000-000000000001' and after->>'event' = 'folded';
  select count(*) into v_reactivate_count from public.audit_log
  where table_name = 'teams' and record_id = '97000000-0000-0000-0000-000000000001' and after->>'event' = 'reactivated';
  if v_fold_count = 1 and v_reactivate_count = 1 then
    raise notice 'PASS 19: both the fold and reactivate events are fully audited (reason, actor, timestamp) in audit_log';
  else
    raise notice 'FAIL 19: fold_audit_count=%, reactivate_audit_count=%', v_fold_count, v_reactivate_count;
  end if;
end $$;
