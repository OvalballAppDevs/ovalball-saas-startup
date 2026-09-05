-- Manual verification for 20260924850000_automatic_season_transition.sql
-- + 20260924860000_confirm_rollover_proposal_core.sql: the Automatic
-- Season Transition engine's full staged lifecycle (prepared -> ready
-- -> applying -> completed/needs_attention), idempotency, notifications,
-- and needs_attention's self-healing sweep back to completed.
--
-- Unlike this project's other isolated-test-club files (which leave
-- their rows in place so they can be re-run and inspected), this WHOLE
-- file runs inside one transaction that always ROLLS BACK at the end.
-- That is deliberate, not an oversight: this engine's very reason to
-- exist is mutating real, shared, global state (teams.age_group,
-- notifications, season_transitions) off of the `seasons` table, which
-- is global reference data shared by every club on that rugby_code --
-- there is no isolated-club trick that fully contains a real run of it
-- the way an isolated club_id contains a scheduling-group test. A
-- transaction-scoped test proves the real engine really ran, then
-- guarantees nothing it touched survives the file.
--
-- Found and fixed two real bugs while first writing this test (see the
-- two migrations above): (1) resolving "current season, then next
-- season after it" broke at the exact instant the calendar date
-- reached the boundary, because resolve_season_for_date correctly
-- starts reporting the NEW season as current at that exact moment --
-- fixed by walking the season chain for the earliest not-yet-completed
-- due boundary instead. (2) the engine's auto-confirm step called the
-- INTERACTIVE confirm_rollover_team_proposal, which requires a real
-- auth.uid() and always failed "Not authorized" when run by the system
-- -- fixed by extracting an internal core both paths share.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/season_transitions.sql

\set ON_ERROR_STOP off
\pset pager off

begin;

insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
  ('9d000000-0000-0000-0000-0000000d0004', 'Season Transition Test Club', 'Testville', 'Testshire', 'league', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'season-transition-test-club-9d000000');
insert into public.clubs (id, directory_id, slug, status, timezone) values
  ('9d000000-0000-0000-0000-0000000c0004', '9d000000-0000-0000-0000-0000000d0004', 'season-transition-test-club-9d000000', 'active', 'Europe/London');
insert into public.club_memberships (id, club_id, user_id, role, status) values
  ('9d000000-0000-0000-0000-000000600004', '9d000000-0000-0000-0000-0000000c0004', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active');
-- One ordinary U9 (mechanical progression -- must auto-confirm to U10
-- with zero human input) and one Mixed U11 (hits the real U11 -> U12
-- structural boundary -- must NEVER be auto-confirmed, only ever a
-- human via the dedicated Girls-team decision flow).
insert into public.teams (id, club_id, rugby_code, category, age_group, gender, display_name, slug, active) values
  ('9d000000-0000-0000-0000-0000000005e1', '9d000000-0000-0000-0000-0000000c0004', 'league', 'youth', 'U9', null, 'U9', 'stt-u9', true),
  ('9d000000-0000-0000-0000-0000000005e2', '9d000000-0000-0000-0000-0000000c0004', 'league', 'youth', 'U11', 'mixed', 'U11', 'stt-u11-mixed', true);
-- A synthetic, properly SEQUENTIAL season pair (current ends the day
-- before next starts -- never overlapping, matching how every real
-- season in this product's seed data is modelled) whose boundary has
-- already passed as of "now" -- lets one engine tick exercise prepare
-- -> warn -> apply immediately rather than waiting on wall-clock time.
-- The synthetic "current" season's starts_on is deliberately LATER
-- than the real already-seeded league season so it -- not the real one
-- -- resolves as this test club's anchor.
-- season_year_start sentinels (2195/2196, never the real calendar year of
-- these relative dates) avoid colliding with the real Rugby League 2026/
-- 2027 seasons under the (rugby_code, season_year_start) uniqueness
-- constraint added in 20260924930000.
-- pre_season_starts_on on the "next" season is the real boundary now
-- (RESUME SEASON HANDOVER Section 1) -- set in the past so one engine
-- tick exercises prepare -> warn -> apply immediately, exactly as this
-- test's own comments already describe.
insert into public.seasons (id, name, starts_on, ends_on, pre_season_starts_on, rugby_code, season_year_start, is_regression_fixture) values
  ('9d000000-0000-0000-0000-00000000fe01', 'League Test Current', current_date - 10, current_date - 1, null, 'league', 2195, true),
  ('9d000000-0000-0000-0000-00000000fe02', 'League Test Next', current_date, current_date + 400, current_date - 5, 'league', 2196, true);

do $$
declare
  v_status text; v_rollover_id uuid; v_warned boolean; v_applied boolean;
  v_u9_age text; v_u11_age text; v_u9_decision text; v_u11_decision text;
  v_notif_count integer;
begin
  perform internal.process_due_season_transitions();

  select status, rollover_id, warning_sent_at is not null, applied_at is not null
  into v_status, v_rollover_id, v_warned, v_applied
  from public.season_transitions where club_id = '9d000000-0000-0000-0000-0000000c0004';

  if v_status = 'needs_attention' and v_warned and not v_applied and v_rollover_id is not null then
    raise notice 'PASS 1: one engine tick reaches needs_attention (warned, not applied) because the Mixed U11 genuinely needs a human';
  else
    raise notice 'FAIL 1: status=% warned=% applied=% rollover_id=%', v_status, v_warned, v_applied, v_rollover_id;
  end if;

  select age_group into v_u9_age from public.teams where id = '9d000000-0000-0000-0000-0000000005e1';
  select age_group into v_u11_age from public.teams where id = '9d000000-0000-0000-0000-0000000005e2';
  select decision into v_u9_decision from public.age_grade_rollover_team_proposals where team_id = '9d000000-0000-0000-0000-0000000005e1';
  select decision into v_u11_decision from public.age_grade_rollover_team_proposals where team_id = '9d000000-0000-0000-0000-0000000005e2';

  if v_u9_age = 'U10' and v_u9_decision = 'confirmed' then
    raise notice 'PASS 2: the ordinary U9 team was auto-confirmed to U10 with zero human input';
  else
    raise notice 'FAIL 2: U9 team age_group=% decision=%', v_u9_age, v_u9_decision;
  end if;

  -- FUTURE-SEASON FIXTURE OWNERSHIP: the whole reason
  -- confirm_rollover_team_proposal_core snapshots the OUTGOING season's
  -- identity before mutating teams.age_group. A fixture already
  -- played/booked during the season that just ended must keep reading
  -- back as U9 forever -- never silently relabel itself U10 the
  -- instant this same team rolls forward.
  declare
    v_spent_identity record;
    v_from_season_id uuid;
  begin
    select from_season_id into v_from_season_id from public.season_transitions where club_id = '9d000000-0000-0000-0000-0000000c0004';
    select * into v_spent_identity from public.get_team_identity_for_season('9d000000-0000-0000-0000-0000000005e1', v_from_season_id);
    if v_spent_identity.age_group = 'U9' and v_spent_identity.display_name = 'U9' then
      raise notice 'PASS 2b: a fixture belonging to the team''s NOW-ENDED season still resolves to U9 (its real age when that fixture happened) even though the live team row is already U10';
    else
      raise notice 'FAIL 2b: spent-season identity resolved to age_group=% display_name=% (expected U9)', v_spent_identity.age_group, v_spent_identity.display_name;
    end if;
  end;

  if v_u11_age = 'U11' and v_u11_decision = 'pending' then
    raise notice 'PASS 3: the Mixed U11 team was left completely untouched -- never auto-confirmed across a structural boundary';
  else
    raise notice 'FAIL 3: Mixed U11 team age_group=% decision=%', v_u11_age, v_u11_decision;
  end if;

  -- Scoped to THIS test club's own transition id specifically -- user
  -- 002 is reused as the generic CLUB_ADMIN test identity across many
  -- clubs in this seed data (including other real league clubs whose
  -- own due, unrelated transitions this same engine run legitimately
  -- also processes), so a bare user_id + type filter would over-count.
  select count(*) into v_notif_count from public.notifications
  where user_id = '00000000-0000-0000-0000-000000000002'
    and type in ('season_transition_warning', 'season_transition_needs_attention')
    and (data->>'season_transition_id')::uuid = (select id from public.season_transitions where club_id = '9d000000-0000-0000-0000-0000000c0004');
  if v_notif_count = 2 then
    raise notice 'PASS 4: both the 24h warning and the needs_attention notification reached the club''s CLUB_ADMIN';
  else
    raise notice 'FAIL 4: found % matching notifications, expected 2', v_notif_count;
  end if;

  -- Idempotency: run it again immediately -- nothing should change.
  perform internal.process_due_season_transitions();
  select status, applied_at is not null into v_status, v_applied from public.season_transitions where club_id = '9d000000-0000-0000-0000-0000000c0004';
  select age_group into v_u9_age from public.teams where id = '9d000000-0000-0000-0000-0000000005e1';
  if v_status = 'needs_attention' and not v_applied and v_u9_age = 'U10' then
    raise notice 'PASS 5: a second immediate run is a genuine no-op -- no double-application, no status flicker';
  else
    raise notice 'FAIL 5: status=% applied=% u9_age=% after re-running', v_status, v_applied, v_u9_age;
  end if;
end $$;

-- A human now resolves the Mixed U11 the correct way (the dedicated
-- Girls-team decision flow, as a real Club Admin), simulated with the
-- real capability check in force.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select public.confirm_mixed_boundary_rollover(
  (select id from public.age_grade_rollover_team_proposals where team_id = '9d000000-0000-0000-0000-0000000005e2'),
  false, null, null
);
reset role;

do $$
declare
  v_status text; v_applied boolean;
begin
  perform internal.process_due_season_transitions();
  select status, applied_at is not null into v_status, v_applied from public.season_transitions where club_id = '9d000000-0000-0000-0000-0000000c0004';
  if v_status = 'completed' and v_applied then
    raise notice 'PASS 6: needs_attention self-heals to completed once the outstanding human decision is made -- no re-running the auto-confirm step on the already-decided U9 row';
  else
    raise notice 'FAIL 6: status=% applied=%', v_status, v_applied;
  end if;
end $$;

rollback;
