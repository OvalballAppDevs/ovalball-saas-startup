-- Regression for the past-occurrence duplication bug found and fixed in
-- 20261011140000_training_plan_regenerate_past_occurrence_dedup_fix.sql
-- (POST-SIDE2 INTEGRATION -- DUPLICATE TRAINING SESSION ROOT-CAUSE AUDIT,
-- 2026-09-06). Unrelated to that audit's actual Burnley U13 C finding
-- (which traced to season_rollover.sql committing instead of rolling back
-- -- fixed separately, no product code involved) -- this is a distinct,
-- narrower defect the audit's own idempotency check surfaced in
-- save_training_plan's edit/reconcile path.
--
-- Reproduces the exact failure live before the fix: re-saving an existing
-- Training Plan unchanged regenerated a genuine duplicate PLANNED session
-- for any occurrence date already in the past relative to today, because
-- save_training_plan's edit branch only cancels FUTURE (occurrence_date >=
-- current_date) non-overridden sessions before deleting and recreating the
-- plan's schedule rules with brand-new ids, and generate_training_plan_
-- sessions' own duplicate guard was keyed on (schedule_rule_id,
-- occurrence_date) -- a key that can never collide across saves, since
-- schedule_rule_id always changes. Future occurrences were unaffected
-- (the old row is explicitly cancelled first, so exactly one live row
-- survives) -- only past ones silently doubled.
--
-- Self-contained (fresh gen_random_uuid() identities, a season starting
-- well before "today" so at least one occurrence has already elapsed),
-- transactional, self-cleaning (begin; ... rollback;). Matches the
-- training_management_regression.sql convention.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/training_plan_regenerate_idempotency_regression.sql

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Training Plan regenerate-idempotency regression ==='

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_directory uuid := gen_random_uuid();
  v_club uuid := gen_random_uuid();
  v_season uuid := gen_random_uuid();
  v_venue uuid := gen_random_uuid();
  v_pitch uuid := gen_random_uuid();
  v_team uuid := gen_random_uuid();
  v_past_weekday integer := extract(dow from (current_date - interval '7 days'))::integer;
  v_plan_id uuid;
  v_count_after_first integer;
  v_count_after_second integer;
  v_count_after_third integer;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
    (v_admin, 'tp-idem-admin-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.profiles (id, first_name, surname) values (v_admin, 'Idem', 'Admin');

  insert into public.club_directory (id, name, town, rugby_code, country, nation, source, verification_status, normalized_key) values
    (v_directory, 'Idempotency Regression Club', 'Testville', 'union', 'England', 'England', 'manual', 'source_verified_club', 'idem-regr-' || substr(v_directory::text, 1, 8));
  insert into public.clubs (id, directory_id, status, slug) values
    (v_club, v_directory, 'active', 'idem-regr-' || substr(v_club::text, 1, 8));
  insert into public.club_memberships (id, club_id, user_id, role, status) values
    (gen_random_uuid(), v_club, v_admin, 'CLUB_ADMIN', 'active');

  -- Season starts well before today, guaranteeing at least one occurrence
  -- of v_past_weekday has already elapsed by the time this plan is saved.
  insert into public.seasons (id, name, starts_on, ends_on, pre_season_starts_on, rugby_code, season_year_start, is_regression_fixture) values
    (v_season, 'Idempotency Regression Season', '2026-01-01', '2027-05-31', '2025-12-01', 'union', 2195, true);

  insert into public.venues (id, name, slug, club_id, active) values
    (v_venue, 'Idem Regr Venue', 'idem-regr-venue-' || v_venue::text, v_club, true);
  insert into public.club_pitches (id, club_id, display_name, active, venue_id) values
    (v_pitch, v_club, 'Idem Regr Pitch', true, v_venue);
  insert into public.teams (id, club_id, rugby_code, category, age_group, display_name, slug) values
    (v_team, v_club, 'union', 'youth', 'U10', 'Idem Regr U10', 'idem-regr-u10-' || substr(v_team::text, 1, 8));

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  v_plan_id := public.save_training_plan(null, v_club, v_team, 'SEASON', v_season, v_venue, v_pitch,
    jsonb_build_array(jsonb_build_object('weekday', v_past_weekday, 'start_time', '18:00', 'duration_minutes', 60)));

  select count(*) into v_count_after_first from public.training_sessions
    where training_plan_id = v_plan_id and status <> 'CANCELLED';

  -- Re-save the SAME plan, completely unchanged, twice more.
  perform public.save_training_plan(v_plan_id, v_club, v_team, 'SEASON', v_season, v_venue, v_pitch,
    jsonb_build_array(jsonb_build_object('weekday', v_past_weekday, 'start_time', '18:00', 'duration_minutes', 60)));
  select count(*) into v_count_after_second from public.training_sessions
    where training_plan_id = v_plan_id and status <> 'CANCELLED';

  perform public.save_training_plan(v_plan_id, v_club, v_team, 'SEASON', v_season, v_venue, v_pitch,
    jsonb_build_array(jsonb_build_object('weekday', v_past_weekday, 'start_time', '18:00', 'duration_minutes', 60)));
  select count(*) into v_count_after_third from public.training_sessions
    where training_plan_id = v_plan_id and status <> 'CANCELLED';

  if v_count_after_first > 0 and v_count_after_second = v_count_after_first and v_count_after_third = v_count_after_first then
    raise notice 'PASS 1: re-saving an unchanged Training Plan (including a weekday with an already-elapsed past occurrence) does not multiply active occurrences across repeated saves (% = % = %)', v_count_after_first, v_count_after_second, v_count_after_third;
  else
    raise exception 'FAIL 1: active occurrence count changed across unchanged re-saves: first=%, second=%, third=%', v_count_after_first, v_count_after_second, v_count_after_third;
  end if;

  -- The DB-level invariant itself: no plan may ever hold two live rows for
  -- the same occurrence date, regardless of how they were inserted.
  perform 1 from pg_indexes where indexname = 'training_sessions_plan_occurrence_active_idx';
  if found then
    raise notice 'PASS 2: the (training_plan_id, occurrence_date) partial unique invariant for non-cancelled sessions exists';
  else
    raise exception 'FAIL 2: training_sessions_plan_occurrence_active_idx is missing -- the defence-in-depth invariant was not applied';
  end if;
end $$;

rollback;

\echo 'Training Plan regenerate-idempotency regression complete.'
