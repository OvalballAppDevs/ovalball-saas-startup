-- SIDE PROJECT 2 -- TRAINING MANAGEMENT persistent local demo data
-- (Section 100). NOT a regression test -- this COMMITS real, persistent
-- rows into the local dev database using the real, already-seeded Burnley
-- RUFC club (10000000-0000-0000-0000-000000000001), its real Club Admin
-- (test.burnley.admin@ovalball.local, 00000000-0000-0000-0000-000000000002),
-- its two real active teams (U12/U13), and the real current 26/27 season.
-- Clearly local development data -- never run against anything but this
-- isolated local Supabase instance.
--
--   docker exec -i supabase_db_ovalball-training-management psql -U postgres -d postgres -f - < supabase/tests/fixtures/training_management_demo_data.sql

\set ON_ERROR_STOP on
\pset pager off

begin;

-- Burnley had no venues at all yet -- add one real venue and assign it to
-- the two already-active pitches (additive; the AGP pitch stays inactive
-- and venue-less, untouched).
insert into public.venues (id, name, slug, club_id, active)
values ('10000000-0000-0000-0000-0000000000e1', 'Turf Moor Training Ground', 'turf-moor-training-ground', '10000000-0000-0000-0000-000000000001', true)
on conflict (id) do nothing;

update public.club_pitches set venue_id = '10000000-0000-0000-0000-0000000000e1'
where id in ('69fecabc-e2b7-4a16-bf38-e7fa67f67f08', '4d2a00ac-6aa8-4f34-bfe8-05ccc74dcc4b') and venue_id is null;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);

do $$
declare
  v_venue uuid := '10000000-0000-0000-0000-0000000000e1';
  v_main_pitch uuid := '69fecabc-e2b7-4a16-bf38-e7fa67f67f08';
  v_pitch2 uuid := '4d2a00ac-6aa8-4f34-bfe8-05ccc74dcc4b';
  v_season uuid := '98000000-0000-0000-0000-000000000102'; -- Rugby Union 26/27
  v_u12 uuid := '30000000-0000-0000-0000-000000000001';
  v_u13 uuid := '30000000-0000-0000-0000-000000000002';
  v_plan_season uuid;
  v_plan_preseason uuid;
  v_plan_custom uuid;
  v_manual_id uuid;
  v_conflicting_manual_id uuid;
  v_first_monday date;
begin
  -- 1. SEASON plan: Burnley U12, Mondays 18:00, 90 minutes, on Main Pitch.
  v_plan_season := public.save_training_plan(null, '10000000-0000-0000-0000-000000000001', v_u12, 'SEASON', v_season, v_venue, v_main_pitch,
    jsonb_build_array(jsonb_build_object('weekday', 1, 'start_time', '18:00', 'duration_minutes', 90)));
  raise notice 'Demo plan 1 (SEASON, U12 Mondays): %', v_plan_season;

  -- 2. SEASON + PRE-SEASON plan: Burnley U13, Wednesdays 18:30, 60 minutes, on Pitch 2.
  v_plan_preseason := public.save_training_plan(null, '10000000-0000-0000-0000-000000000001', v_u13, 'SEASON_PRE_SEASON', v_season, v_venue, v_pitch2,
    jsonb_build_array(jsonb_build_object('weekday', 3, 'start_time', '18:30', 'duration_minutes', 60)));
  raise notice 'Demo plan 2 (SEASON_PRE_SEASON, U13 Wednesdays): %', v_plan_preseason;

  -- 3. CUSTOM multi-day plan: Burnley U12 also gets a September fitness
  -- block on Fridays AND Sundays (two different weekday rules, different
  -- times/durations, proving Section 15's "not a comma-separated string").
  v_plan_custom := public.save_training_plan(null, '10000000-0000-0000-0000-000000000001', v_u12, 'CUSTOM', null, v_venue, v_pitch2,
    jsonb_build_array(
      jsonb_build_object('weekday', 5, 'starts_on', '2026-09-01', 'ends_on', '2026-09-30', 'start_time', '17:30', 'duration_minutes', 45),
      jsonb_build_object('weekday', 0, 'starts_on', '2026-09-01', 'ends_on', '2026-09-30', 'start_time', '10:00', 'duration_minutes', 60)
    ));
  raise notice 'Demo plan 3 (CUSTOM, U12 September Fri+Sun fitness block): %', v_plan_custom;

  -- 4. One manual (ad-hoc) session: an extra U13 session next Tuesday, no plan.
  select (date_trunc('week', current_date) + interval '1 day' + interval '7 days')::date into v_first_monday; -- next Tuesday-ish, just needs to be a real near-future date
  v_manual_id := public.create_training_session('10000000-0000-0000-0000-000000000001', v_u13, null, current_date + 4, '17:00'::time, '18:00'::time, v_main_pitch, 'Extra session before Saturday''s fixture', v_venue);
  raise notice 'Demo manual session: %', v_manual_id;

  -- 5. One deliberate pitch conflict: another manual session double-booked
  -- onto Main Pitch at a time that overlaps the U12 SEASON plan's very
  -- first generated Monday session, so Pitch Allocation has a real,
  -- visible conflict to show without needing to wait for real time to pass.
  select min(occurrence_date) into v_first_monday from public.training_sessions where training_plan_id = v_plan_season;
  v_conflicting_manual_id := public.create_training_session('10000000-0000-0000-0000-000000000001', v_u13, null, v_first_monday, '18:15'::time, '19:00'::time, v_main_pitch, 'Deliberate demo conflict -- double-booked onto Main Pitch against the U12 Monday plan', v_venue);
  raise notice 'Demo deliberate pitch conflict: manual session % overlaps plan % on % at Main Pitch', v_conflicting_manual_id, v_plan_season, v_first_monday;
end $$;

commit;

\echo 'Training Management demo data committed. Sign in as test.burnley.admin@ovalball.local (Club Admin) and visit /club/training to see it.'
