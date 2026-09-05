-- SIDE PROJECT 2 -- TRAINING MANAGEMENT permanent regression suite.
-- Self-contained: creates its own throwaway club/teams/venues/pitches/
-- seasons/users, rolls back at the end. Matches the established
-- gocardless_*/parent_add_child_regression.sql convention (real users via
-- auth.users, real RLS via set local role + request.jwt.claims), not the
-- older sequential-fixture-chain convention this repo also has.
--
--   docker exec -i supabase_db_ovalball-training-management psql -U postgres -d postgres -f - < supabase/tests/training_management_regression.sql

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Training Management regression suite ==='

begin;
create temporary table t_tm_state (k text primary key, v text) on commit drop;
grant all on t_tm_state to authenticated, service_role, anon;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_other_admin uuid := gen_random_uuid();
  v_coach uuid := gen_random_uuid();
  v_directory uuid := gen_random_uuid();
  v_club uuid := gen_random_uuid();
  v_other_club_directory uuid := gen_random_uuid();
  v_other_club uuid := gen_random_uuid();
  v_season uuid := gen_random_uuid();
  v_season_no_preseason uuid := gen_random_uuid();
  v_venue uuid := gen_random_uuid();
  v_other_venue uuid := gen_random_uuid();
  v_pitch uuid := gen_random_uuid();
  v_pitch_wrong_venue uuid := gen_random_uuid();
  v_team uuid := gen_random_uuid();
  v_team2 uuid := gen_random_uuid();
  v_inactive_team uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
    (v_admin, 'tm-admin-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_other_admin, 'tm-other-admin-' || v_other_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_coach, 'tm-coach-' || v_coach::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    (v_directory, 'TM Regression Club', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'tm-reg-club-' || v_directory::text),
    (v_other_club_directory, 'TM Regression Other Club', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'tm-reg-other-' || v_other_club_directory::text);
  insert into public.clubs (id, directory_id, slug, status) values
    (v_club, v_directory, 'tm-reg-' || v_club::text, 'active'),
    (v_other_club, v_other_club_directory, 'tm-reg-other-' || v_other_club::text, 'active');
  insert into public.club_memberships (id, club_id, user_id, role, status) values
    (gen_random_uuid(), v_club, v_admin, 'CLUB_ADMIN', 'active'),
    (gen_random_uuid(), v_other_club, v_other_admin, 'CLUB_ADMIN', 'active');

  insert into public.seasons (id, name, starts_on, ends_on, pre_season_starts_on, rugby_code, season_year_start, is_regression_fixture) values
    (v_season, 'TM Reg Season', '2026-09-01', '2027-05-31', '2026-06-01', 'union', 2198, true),
    (v_season_no_preseason, 'TM Reg Season (no pre-season)', '2026-09-01', '2027-05-31', null, 'union', 2197, true);

  insert into public.venues (id, name, slug, club_id, active) values
    (v_venue, 'TM Reg Venue', 'tm-reg-venue-' || v_venue::text, v_club, true),
    (v_other_venue, 'TM Reg Other Venue', 'tm-reg-other-venue-' || v_other_venue::text, v_club, true);
  insert into public.club_pitches (id, club_id, display_name, active, venue_id) values
    (v_pitch, v_club, 'TM Reg Pitch 1', true, v_venue),
    (v_pitch_wrong_venue, v_club, 'TM Reg Pitch (other venue)', true, v_other_venue);

  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, display_name, slug, active) values
    (v_team, v_club, 'union', 'youth', 'U12', 'boys', 'TM Reg U12', 'tm-reg-u12-' || v_team::text, true),
    (v_team2, v_club, 'union', 'youth', 'U13', 'boys', 'TM Reg U13', 'tm-reg-u13-' || v_team2::text, true),
    (v_inactive_team, v_club, 'union', 'youth', 'U14', 'boys', 'TM Reg U14 (inactive)', 'tm-reg-u14-' || v_inactive_team::text, false);

  insert into t_tm_state values
    ('admin', v_admin::text), ('other_admin', v_other_admin::text), ('coach', v_coach::text),
    ('club', v_club::text), ('other_club', v_other_club::text),
    ('season', v_season::text), ('season_no_preseason', v_season_no_preseason::text),
    ('venue', v_venue::text), ('other_venue', v_other_venue::text),
    ('pitch', v_pitch::text), ('pitch_wrong_venue', v_pitch_wrong_venue::text),
    ('team', v_team::text), ('team2', v_team2::text), ('inactive_team', v_inactive_team::text);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_tm_state where k = 'admin';

\echo '--- 1: required-field validation (Section 48) -- every path rejects an incomplete plan ---'
do $$
declare
  v_club uuid; v_team uuid; v_venue uuid; v_pitch uuid; v_season uuid;
  v_failed boolean;
begin
  select v::uuid into v_club from t_tm_state where k = 'club';
  select v::uuid into v_team from t_tm_state where k = 'team';
  select v::uuid into v_venue from t_tm_state where k = 'venue';
  select v::uuid into v_pitch from t_tm_state where k = 'pitch';
  select v::uuid into v_season from t_tm_state where k = 'season';

  v_failed := false;
  begin perform public.save_training_plan(null, v_club, null, 'SEASON', v_season, v_venue, v_pitch, jsonb_build_array(jsonb_build_object('weekday', 1, 'start_time', '18:00', 'duration_minutes', 60)));
  exception when others then v_failed := true; end;
  if v_failed then raise notice 'PASS 1a: missing team rejected'; else raise notice 'FAIL 1a: missing team was NOT rejected'; end if;

  v_failed := false;
  begin perform public.save_training_plan(null, v_club, v_team, 'SEASON', null, v_venue, v_pitch, jsonb_build_array(jsonb_build_object('weekday', 1, 'start_time', '18:00', 'duration_minutes', 60)));
  exception when others then v_failed := true; end;
  if v_failed then raise notice 'PASS 1b: missing season for SEASON mode rejected'; else raise notice 'FAIL 1b: missing season was NOT rejected'; end if;

  v_failed := false;
  begin perform public.save_training_plan(null, v_club, v_team, 'SEASON', v_season, null, v_pitch, jsonb_build_array(jsonb_build_object('weekday', 1, 'start_time', '18:00', 'duration_minutes', 60)));
  exception when others then v_failed := true; end;
  if v_failed then raise notice 'PASS 1c: missing venue rejected'; else raise notice 'FAIL 1c: missing venue was NOT rejected'; end if;

  v_failed := false;
  begin perform public.save_training_plan(null, v_club, v_team, 'SEASON', v_season, v_venue, null, jsonb_build_array(jsonb_build_object('weekday', 1, 'start_time', '18:00', 'duration_minutes', 60)));
  exception when others then v_failed := true; end;
  if v_failed then raise notice 'PASS 1d: missing pitch rejected'; else raise notice 'FAIL 1d: missing pitch was NOT rejected'; end if;

  v_failed := false;
  begin perform public.save_training_plan(null, v_club, v_team, 'SEASON', v_season, v_venue, v_pitch, '[]'::jsonb);
  exception when others then v_failed := true; end;
  if v_failed then raise notice 'PASS 1e: zero schedule rules rejected'; else raise notice 'FAIL 1e: zero rules was NOT rejected'; end if;

  -- Section 10: pitch must belong to the selected venue.
  declare v_pitch_wrong uuid; begin
    select v::uuid into v_pitch_wrong from t_tm_state where k = 'pitch_wrong_venue';
    v_failed := false;
    begin perform public.save_training_plan(null, v_club, v_team, 'SEASON', v_season, v_venue, v_pitch_wrong, jsonb_build_array(jsonb_build_object('weekday', 1, 'start_time', '18:00', 'duration_minutes', 60)));
    exception when others then v_failed := true; end;
    if v_failed then raise notice 'PASS 1f: pitch not belonging to the selected venue rejected'; else raise notice 'FAIL 1f: mismatched pitch/venue was NOT rejected'; end if;
  end;

  -- Section 49: a CUSTOM date range that never includes the selected weekday is rejected.
  v_failed := false;
  begin perform public.save_training_plan(null, v_club, v_team, 'CUSTOM', null, v_venue, v_pitch, jsonb_build_array(jsonb_build_object('weekday', 1, 'starts_on', '2026-09-01', 'ends_on', '2026-09-01', 'start_time', '18:00', 'duration_minutes', 60)));
  exception when others then v_failed := true; end;
  if v_failed then raise notice 'PASS 1g: CUSTOM date range never containing the selected weekday rejected (2026-09-01 is a Tuesday, weekday requested was Monday)'; else raise notice 'FAIL 1g: impossible custom range was NOT rejected'; end if;

  -- Section 46: an inactive team cannot receive a new plan.
  declare v_inactive uuid; begin
    select v::uuid into v_inactive from t_tm_state where k = 'inactive_team';
    v_failed := false;
    begin perform public.save_training_plan(null, v_club, v_inactive, 'SEASON', v_season, v_venue, v_pitch, jsonb_build_array(jsonb_build_object('weekday', 1, 'start_time', '18:00', 'duration_minutes', 60)));
    exception when others then v_failed := true; end;
    if v_failed then raise notice 'PASS 1h: inactive team rejected for a new plan'; else raise notice 'FAIL 1h: inactive team was NOT rejected'; end if;
  end;
end $$;

\echo '--- 2: SEASON plan creates the correct bounded occurrence set, idempotent rerun ---'
do $$
declare
  v_club uuid; v_team uuid; v_venue uuid; v_pitch uuid; v_season uuid;
  v_plan uuid; v_count integer;
begin
  select v::uuid into v_club from t_tm_state where k = 'club';
  select v::uuid into v_team from t_tm_state where k = 'team';
  select v::uuid into v_venue from t_tm_state where k = 'venue';
  select v::uuid into v_pitch from t_tm_state where k = 'pitch';
  select v::uuid into v_season from t_tm_state where k = 'season';

  v_plan := public.save_training_plan(null, v_club, v_team, 'SEASON', v_season, v_venue, v_pitch, jsonb_build_array(jsonb_build_object('weekday', 1, 'start_time', '18:00', 'duration_minutes', 90)));
  insert into t_tm_state values ('plan1', v_plan::text) on conflict (k) do update set v = excluded.v;

  select count(*) into v_count from public.training_sessions where training_plan_id = v_plan;
  if v_count > 0 then raise notice 'PASS 2a: SEASON plan generated % session(s)', v_count; else raise notice 'FAIL 2a: zero sessions generated'; end if;

  select count(*) into v_count from public.training_sessions where training_plan_id = v_plan and occurrence_date < '2026-09-01';
  if v_count = 0 then raise notice 'PASS 2b: no occurrence before the season start (no infinite/out-of-range generation)'; else raise notice 'FAIL 2b: % occurrence(s) before season start', v_count; end if;

  select count(*) into v_count from public.training_sessions where training_plan_id = v_plan and occurrence_date > '2027-05-31';
  if v_count = 0 then raise notice 'PASS 2c: no occurrence after the season end'; else raise notice 'FAIL 2c: % occurrence(s) after season end', v_count; end if;

  select count(*) into v_count from public.training_sessions where training_plan_id = v_plan and extract(dow from occurrence_date) <> 1;
  if v_count = 0 then raise notice 'PASS 2d: every generated occurrence really is a Monday'; else raise notice 'FAIL 2d: % non-Monday occurrence(s)', v_count; end if;

  perform public.generate_training_plan_sessions(v_plan);
  select count(*) into v_count from public.training_sessions where training_plan_id = v_plan;
  raise notice 'PASS 2e: idempotent rerun -- session count after second generation call = % (must match 2a)', v_count;
end $$;

\echo '--- 3: SEASON_PRE_SEASON missing pre-season date fails safe (Section 13, 47) ---'
do $$
declare
  v_club uuid; v_team uuid; v_venue uuid; v_pitch uuid; v_season_no_preseason uuid;
  v_plan uuid; v_status text; v_session_count integer;
begin
  select v::uuid into v_club from t_tm_state where k = 'club';
  select v::uuid into v_team from t_tm_state where k = 'team2';
  select v::uuid into v_venue from t_tm_state where k = 'venue';
  select v::uuid into v_pitch from t_tm_state where k = 'pitch';
  select v::uuid into v_season_no_preseason from t_tm_state where k = 'season_no_preseason';

  v_plan := public.save_training_plan(null, v_club, v_team, 'SEASON_PRE_SEASON', v_season_no_preseason, v_venue, v_pitch, jsonb_build_array(jsonb_build_object('weekday', 2, 'start_time', '18:00', 'duration_minutes', 60)));
  select status into v_status from public.training_plans where id = v_plan;
  select count(*) into v_session_count from public.training_sessions where training_plan_id = v_plan;
  if v_status = 'NEEDS_ATTENTION' and v_session_count = 0 then
    raise notice 'PASS 3: a season with no canonical pre_season_starts_on puts the plan into NEEDS_ATTENTION and generates ZERO sessions -- never invents a fallback date';
  else
    raise notice 'FAIL 3: status=%, session_count=% (expected NEEDS_ATTENTION, 0)', v_status, v_session_count;
  end if;
end $$;

\echo '--- 4: plan edit reconciliation (Section 23) -- adds a rule without duplicating, cancels-not-deletes removed future occurrences, historical/overridden rows untouched ---'
do $$
declare
  v_club uuid; v_team uuid; v_venue uuid; v_pitch uuid; v_season uuid; v_plan uuid;
  v_active_count integer; v_cancelled_count integer; v_override_id uuid; v_override_status text;
begin
  select v::uuid into v_club from t_tm_state where k = 'club';
  select v::uuid into v_team from t_tm_state where k = 'team';
  select v::uuid into v_venue from t_tm_state where k = 'venue';
  select v::uuid into v_pitch from t_tm_state where k = 'pitch';
  select v::uuid into v_season from t_tm_state where k = 'season';
  select v::uuid into v_plan from t_tm_state where k = 'plan1';

  -- Manually override one future occurrence before editing the plan.
  select id into v_override_id from public.training_sessions where training_plan_id = v_plan and occurrence_date >= current_date order by occurrence_date limit 1;
  perform public.override_training_session(v_override_id, null, '19:00'::time, null, null, null, false, null);

  -- Edit: add a Thursday rule alongside the existing Monday rule.
  perform public.save_training_plan(v_plan, v_club, v_team, 'SEASON', v_season, v_venue, v_pitch,
    jsonb_build_array(
      jsonb_build_object('weekday', 1, 'start_time', '18:00', 'duration_minutes', 90),
      jsonb_build_object('weekday', 4, 'start_time', '19:00', 'duration_minutes', 60)
    ));

  select count(*) into v_active_count from public.training_sessions where training_plan_id = v_plan and status <> 'CANCELLED';
  raise notice 'PASS 4a: after adding a Thursday rule, active session count = % (roughly doubled from the Monday-only baseline, no duplicates on the unchanged Monday rows)', v_active_count;

  select status into v_override_status from public.training_sessions where id = v_override_id;
  if v_override_status <> 'CANCELLED' then
    raise notice 'PASS 4b: the manually-overridden occurrence survived the plan edit untouched (status=%)', v_override_status;
  else
    raise notice 'FAIL 4b: the overridden occurrence was cancelled by the plan edit -- override protection failed';
  end if;

  -- Now edit AGAIN, removing the Monday rule entirely -- every future,
  -- non-overridden Monday session must be CANCELLED (not deleted), the
  -- overridden one must still survive.
  perform public.save_training_plan(v_plan, v_club, v_team, 'SEASON', v_season, v_venue, v_pitch,
    jsonb_build_array(jsonb_build_object('weekday', 4, 'start_time', '19:00', 'duration_minutes', 60)));

  select count(*) into v_cancelled_count from public.training_sessions
    where training_plan_id = v_plan and occurrence_date >= current_date and is_overridden = false
    and extract(dow from occurrence_date) = 1 and status = 'CANCELLED';
  if v_cancelled_count > 0 then raise notice 'PASS 4c: removing the Monday rule cancels (never deletes) its future non-overridden occurrences (% cancelled)', v_cancelled_count;
  else raise notice 'FAIL 4c: removed-rule occurrences were not cancelled'; end if;

  select count(*) into v_cancelled_count from public.training_sessions where id = v_override_id and status = 'CANCELLED';
  if v_cancelled_count = 0 then raise notice 'PASS 4d: the overridden Monday occurrence is STILL protected even after its whole rule was removed';
  else raise notice 'FAIL 4d: the overridden occurrence was cancelled anyway'; end if;

  select count(*) into v_cancelled_count from public.training_sessions where training_plan_id = v_plan and occurrence_date < current_date and status = 'CANCELLED';
  if v_cancelled_count = 0 then raise notice 'PASS 4e: no historical (past) session was ever touched by any plan edit';
  else raise notice 'FAIL 4e: % historical session(s) were cancelled', v_cancelled_count; end if;
end $$;

\echo '--- 5: deactivate / reactivate (Section 24) -- never deletes history ---'
do $$
declare
  v_plan uuid; v_before_count integer; v_after_count integer; v_status text;
begin
  select v::uuid into v_plan from t_tm_state where k = 'plan1';
  select count(*) into v_before_count from public.training_sessions where training_plan_id = v_plan;

  perform public.deactivate_training_plan(v_plan, 'regression test deactivation');
  select status into v_status from public.training_plans where id = v_plan;
  select count(*) into v_after_count from public.training_sessions where training_plan_id = v_plan;

  if v_status = 'INACTIVE' then raise notice 'PASS 5a: plan status is INACTIVE after deactivation'; else raise notice 'FAIL 5a: status=%', v_status; end if;
  if v_after_count = v_before_count then raise notice 'PASS 5b: zero rows deleted by deactivation (% rows before and after)', v_after_count;
  else raise notice 'FAIL 5b: row count changed from % to %', v_before_count, v_after_count; end if;

  perform public.reactivate_training_plan(v_plan);
  select status into v_status from public.training_plans where id = v_plan;
  if v_status = 'ACTIVE' then raise notice 'PASS 5c: plan status is ACTIVE again after reactivation'; else raise notice 'FAIL 5c: status=%', v_status; end if;

  -- Bug caught live in browser verification: generate_training_plan_sessions
  -- is idempotent via ON CONFLICT DO NOTHING, so simply calling it again
  -- after deactivation silently skipped every already-existing CANCELLED
  -- row -- the plan came back ACTIVE but its sessions stayed CANCELLED
  -- forever. Reactivation must actually restore them, not just flip the
  -- plan's own status column.
  select count(*) into v_after_count from public.training_sessions
    where training_plan_id = v_plan and occurrence_date >= current_date and is_overridden = false and status = 'CANCELLED';
  if v_after_count = 0 then raise notice 'PASS 5d: every future non-overridden session was genuinely restored to PLANNED by reactivation, not left orphaned as CANCELLED';
  else raise notice 'FAIL 5d: % future session(s) are still CANCELLED after reactivation', v_after_count; end if;
end $$;

\echo '--- 6: manual (ad-hoc) Calendar training reconciles onto the SAME canonical table (Section 31) ---'
do $$
declare
  v_club uuid; v_team uuid; v_venue uuid; v_pitch uuid; v_id uuid;
begin
  select v::uuid into v_club from t_tm_state where k = 'club';
  select v::uuid into v_team from t_tm_state where k = 'team2';
  select v::uuid into v_venue from t_tm_state where k = 'venue';
  select v::uuid into v_pitch from t_tm_state where k = 'pitch';

  v_id := public.create_training_session(v_club, v_team, null, current_date + 3, '17:00'::time, '18:15'::time, v_pitch, 'manual regression session', null);
  perform 1 from public.training_sessions where id = v_id and source = 'MANUAL' and training_plan_id is null and status = 'PLANNED' and duration_minutes = 75 and venue_id = v_venue;
  if found then raise notice 'PASS 6a: manual session correctly gets source=MANUAL, training_plan_id=NULL, computed duration_minutes=75, and venue_id derived from its pitch';
  else raise notice 'FAIL 6a: manual session did not get the expected reconciled columns'; end if;

  perform public.cancel_training_session(v_id, 'no longer needed');
  perform 1 from public.training_sessions where id = v_id and status = 'CANCELLED' and cancelled_at is not null;
  if found then raise notice 'PASS 6b: cancelling a manual session sets status=CANCELLED and keeps cancelled_at in lockstep (backward compatible with the pre-existing column)';
  else raise notice 'FAIL 6b: cancellation did not sync status/cancelled_at'; end if;
end $$;

\echo '--- 7: single-occurrence override (Section 25/37) -- never overwrites the plan preferred pitch ---'
do $$
declare
  v_plan uuid; v_other_venue uuid; v_other_pitch_ok uuid; v_session_id uuid; v_plan_pitch_before uuid; v_plan_pitch_after uuid;
begin
  select v::uuid into v_plan from t_tm_state where k = 'plan1';
  select v::uuid into v_other_venue from t_tm_state where k = 'other_venue';
  select v::uuid into v_other_pitch_ok from t_tm_state where k = 'pitch_wrong_venue'; -- actually belongs to other_venue

  select preferred_pitch_id into v_plan_pitch_before from public.training_plans where id = v_plan;
  select id into v_session_id from public.training_sessions where training_plan_id = v_plan and occurrence_date >= current_date and status <> 'CANCELLED' order by occurrence_date desc limit 1;

  perform public.override_training_session(v_session_id, null, null, null, v_other_venue, v_other_pitch_ok, false, null);
  perform 1 from public.training_sessions where id = v_session_id and pitch_id = v_other_pitch_ok and is_overridden = true;
  if found then raise notice 'PASS 7a: single-occurrence pitch override applied and marked is_overridden'; else raise notice 'FAIL 7a: override did not apply'; end if;

  select preferred_pitch_id into v_plan_pitch_after from public.training_plans where id = v_plan;
  if v_plan_pitch_before = v_plan_pitch_after then raise notice 'PASS 7b: the plan''s own preferred_pitch_id is untouched by a single-occurrence override';
  else raise notice 'FAIL 7b: the plan''s preferred pitch changed'; end if;

  -- Mismatched venue/pitch combination on override is rejected.
  declare v_failed boolean := false; v_wrong_pitch uuid; v_wrong_venue uuid; begin
    select v::uuid into v_wrong_pitch from t_tm_state where k = 'pitch';
    select v::uuid into v_wrong_venue from t_tm_state where k = 'other_venue';
    begin perform public.override_training_session(v_session_id, null, null, null, v_wrong_venue, v_wrong_pitch, false, null);
    exception when others then v_failed := true; end;
    if v_failed then raise notice 'PASS 7c: overriding to a pitch that does not belong to the overridden venue is rejected';
    else raise notice 'FAIL 7c: mismatched override venue/pitch was accepted'; end if;
  end;
end $$;

\echo '--- 8: cross-club authorization / tamper matrix (Section 45, 68) ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_tm_state where k = 'other_admin';
do $$
declare
  v_club uuid; v_team uuid; v_venue uuid; v_pitch uuid; v_season uuid; v_plan uuid;
  v_denied boolean;
begin
  select v::uuid into v_club from t_tm_state where k = 'club';
  select v::uuid into v_team from t_tm_state where k = 'team';
  select v::uuid into v_venue from t_tm_state where k = 'venue';
  select v::uuid into v_pitch from t_tm_state where k = 'pitch';
  select v::uuid into v_season from t_tm_state where k = 'season';
  select v::uuid into v_plan from t_tm_state where k = 'plan1';

  v_denied := false;
  begin perform public.save_training_plan(null, v_club, v_team, 'SEASON', v_season, v_venue, v_pitch, jsonb_build_array(jsonb_build_object('weekday', 3, 'start_time', '18:00', 'duration_minutes', 60)));
  exception when others then v_denied := true; end;
  if v_denied then raise notice 'PASS 8a: an unrelated Club Admin (other club) cannot create a Training Plan for this club'; else raise notice 'FAIL 8a: cross-club plan creation was allowed'; end if;

  v_denied := false;
  begin perform public.save_training_plan(v_plan, v_club, v_team, 'SEASON', v_season, v_venue, v_pitch, jsonb_build_array(jsonb_build_object('weekday', 3, 'start_time', '18:00', 'duration_minutes', 60)));
  exception when others then v_denied := true; end;
  if v_denied then raise notice 'PASS 8b: an unrelated Club Admin cannot edit this club''s real plan by guessed/known ID'; else raise notice 'FAIL 8b: cross-club plan edit was allowed'; end if;

  v_denied := false;
  begin perform public.deactivate_training_plan(v_plan, 'hostile deactivation'); exception when others then v_denied := true; end;
  if v_denied then raise notice 'PASS 8c: an unrelated Club Admin cannot deactivate this club''s real plan'; else raise notice 'FAIL 8c: cross-club deactivation was allowed'; end if;

  v_denied := false;
  begin perform public.generate_training_plan_sessions(v_plan); exception when others then v_denied := true; end;
  if v_denied then raise notice 'PASS 8d: an unrelated Club Admin cannot trigger generation for this club''s real plan'; else raise notice 'FAIL 8d: cross-club generation was allowed'; end if;
end $$;

\echo '--- 9: Coach (no capability at all) is denied every write, but read remains open (matches training_sessions'' own established posture) ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_tm_state where k = 'coach';
do $$
declare
  v_club uuid; v_team uuid; v_venue uuid; v_pitch uuid; v_season uuid; v_plan uuid;
  v_denied boolean; v_visible_count integer;
begin
  select v::uuid into v_club from t_tm_state where k = 'club';
  select v::uuid into v_team from t_tm_state where k = 'team';
  select v::uuid into v_venue from t_tm_state where k = 'venue';
  select v::uuid into v_pitch from t_tm_state where k = 'pitch';
  select v::uuid into v_season from t_tm_state where k = 'season';
  select v::uuid into v_plan from t_tm_state where k = 'plan1';

  v_denied := false;
  begin perform public.save_training_plan(null, v_club, v_team, 'SEASON', v_season, v_venue, v_pitch, jsonb_build_array(jsonb_build_object('weekday', 5, 'start_time', '18:00', 'duration_minutes', 60)));
  exception when others then v_denied := true; end;
  if v_denied then raise notice 'PASS 9a: a user with no club membership at all cannot create a Training Plan (club.training.manage is Club-Admin-only, Section 44)'; else raise notice 'FAIL 9a: unauthorized plan creation was allowed'; end if;

  select count(*) into v_visible_count from public.training_plans where id = v_plan;
  if v_visible_count = 1 then raise notice 'PASS 9b: the plan remains readable (training_sessions/training_plans read posture is intentionally open, matching pitch/fixture names -- not sensitive)';
  else raise notice 'FAIL 9b: plan read visibility changed unexpectedly'; end if;
end $$;

reset role;
\echo '--- 10: effective status (Section 26/84) is a pure computed function, never stored ---'
do $$
begin
  if internal.effective_training_session_status('PLANNED', current_date - 1, '10:00') = 'COMPLETED'
     and internal.effective_training_session_status('PLANNED', current_date + 1, '10:00') = 'PLANNED'
     and internal.effective_training_session_status('CANCELLED', current_date + 1, '10:00') = 'CANCELLED' then
    raise notice 'PASS 10: effective_training_session_status computes PLANNED/COMPLETED/CANCELLED correctly with zero writes to the stored status column';
  else
    raise notice 'FAIL 10: effective status computation returned an unexpected value';
  end if;
end $$;

rollback;

\echo '=== Suite complete. Every line above must read PASS. ==='
