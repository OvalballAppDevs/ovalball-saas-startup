-- Manual verification for club_pitches / create_club_pitch / rename_club_pitch
-- / reorder_club_pitches / set_club_pitch_active / update_fixture_pitch
-- (20260901180000, 20260901190000). NOT a migration -- run AFTER
-- permission_matrix.sql (reuses Burnley RUFC/0002 CLUB_ADMIN, Rossendale
-- RUFC/0003 CLUB_ADMIN, Burnley U12 A team) and site_admin_management.sql
-- (reuses the 'full' Site Admin, user 0001).
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/club_pitches.sql

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  -- Burnley U12 A (owning, Home) vs Rossendale U12 A (opponent).
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('f0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date + 7, 'Booked', 'club_created')
  on conflict (id) do nothing;
  -- Same pairing, but Burnley U12 A is the AWAY side this time.
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('f0000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Away', 'Rossendale RUFC', current_date + 8, 'Booked', 'club_created')
  on conflict (id) do nothing;
end $$;

-- ------------------------------------------------------------
-- 1. Burnley Club Admin can create a pitch for Burnley.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_id uuid;
begin
  v_id := public.create_club_pitch('10000000-0000-0000-0000-000000000001', 'Main Pitch', null);
  if v_id is not null then
    raise notice 'PASS 1: Burnley Club Admin created a pitch (%)', v_id;
  else
    raise notice 'FAIL 1: create_club_pitch returned null';
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 2. An unrelated club's admin (Rossendale) cannot create a pitch for Burnley.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  perform public.create_club_pitch('10000000-0000-0000-0000-000000000001', 'Rossendale''s Fake Pitch', null);
  raise notice 'FAIL 2: an unrelated club''s admin created a pitch for Burnley';
exception when others then
  raise notice 'PASS 2: an unrelated club cannot create another club''s pitch (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 3. Anon cannot create a pitch.
-- ------------------------------------------------------------
begin;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
begin
  perform public.create_club_pitch('10000000-0000-0000-0000-000000000001', 'Anon Pitch', null);
  raise notice 'FAIL 3: anon created a pitch';
exception when others then
  raise notice 'PASS 3: anon cannot create a pitch (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 4. Duplicate name (case-insensitive) within the same club is rejected.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.create_club_pitch('10000000-0000-0000-0000-000000000001', 'main pitch', null);
  raise notice 'FAIL 4: a case-insensitive duplicate pitch name was accepted';
exception when others then
  raise notice 'PASS 4: a duplicate pitch name (case-insensitive) is rejected (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 5. Site Admin can create/manage a pitch for any club.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_id uuid;
begin
  v_id := public.create_club_pitch('10000000-0000-0000-0000-000000000001', 'Pitch 1', 'Grass');
  if v_id is not null then
    raise notice 'PASS 5: Site Admin created a pitch for Burnley (%)', v_id;
  else
    raise notice 'FAIL 5: create_club_pitch returned null for Site Admin';
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 6. Rename preserves stable id; fixtures already pointing at it keep the
--    same pitch_id and display the new name.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_pitch_id uuid;
  v_name_after text;
begin
  select id into v_pitch_id from public.club_pitches where club_id = '10000000-0000-0000-0000-000000000001' and lower(display_name) = 'pitch 1';
  perform public.update_fixture_pitch('f0000000-0000-0000-0000-000000000001', v_pitch_id, null);
  perform public.rename_club_pitch(v_pitch_id, 'Pitch 2');
  select pitch_id into v_pitch_id from public.fixtures where id = 'f0000000-0000-0000-0000-000000000001';
  select display_name into v_name_after from public.club_pitches where id = v_pitch_id;
  if v_pitch_id is not null and v_name_after = 'Pitch 2' then
    raise notice 'PASS 6: rename preserved the fixture''s pitch_id and updated the displayed name to %', v_name_after;
  else
    raise notice 'FAIL 6: pitch_id=% name=% after rename', v_pitch_id, v_name_after;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 7. Reorder updates sort_order correctly.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_agp_id uuid;
  v_ids_original uuid[];
  v_ids_reversed uuid[];
  v_first_name text;
begin
  v_agp_id := public.create_club_pitch('10000000-0000-0000-0000-000000000001', 'AGP', 'Artificial grass, floodlit');
  select array_agg(id order by sort_order) into v_ids_original from public.club_pitches where club_id = '10000000-0000-0000-0000-000000000001';
  -- Reverse the order and apply it (no native array_reverse in Postgres).
  select array_agg(elem order by ord desc) into v_ids_reversed from unnest(v_ids_original) with ordinality as t(elem, ord);
  perform public.reorder_club_pitches('10000000-0000-0000-0000-000000000001', v_ids_reversed);
  select display_name into v_first_name from public.club_pitches where club_id = '10000000-0000-0000-0000-000000000001' order by sort_order limit 1;
  if v_first_name = (select display_name from public.club_pitches where id = v_ids_original[array_upper(v_ids_original, 1)]) then
    raise notice 'PASS 7: reorder moved the previously-last pitch (%) to sort_order 0', v_first_name;
  else
    raise notice 'FAIL 7: unexpected first pitch after reorder: %', v_first_name;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 8. Archiving a pitch makes it unavailable for a NEW assignment, but does
--    not orphan a fixture already pointing at a different, still-active
--    pitch (Pitch 2 from test 6 is untouched by archiving AGP).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_agp_id uuid;
  v_pitch2_still_set uuid;
begin
  select id into v_agp_id from public.club_pitches where club_id = '10000000-0000-0000-0000-000000000001' and display_name = 'AGP';
  perform public.set_club_pitch_active(v_agp_id, false);
  select pitch_id into v_pitch2_still_set from public.fixtures where id = 'f0000000-0000-0000-0000-000000000001';
  if v_pitch2_still_set is not null then
    raise notice 'PASS 8a: archiving AGP left the unrelated fixture''s existing pitch_id untouched';
  else
    raise notice 'FAIL 8a: archiving AGP orphaned an unrelated fixture''s pitch_id';
  end if;

  begin
    perform public.update_fixture_pitch('f0000000-0000-0000-0000-000000000001', v_agp_id, null);
    raise notice 'FAIL 8b: an archived pitch was accepted for a new assignment';
  exception when others then
    raise notice 'PASS 8b: an archived pitch is rejected for a new assignment (%)', sqlerrm;
  end;
end $$;
commit;

-- ------------------------------------------------------------
-- 9. A named pitch can only be set on a HOME fixture -- rejected on the
--    AWAY-side copy of the same pairing.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_pitch_id uuid;
begin
  select id into v_pitch_id from public.club_pitches where club_id = '10000000-0000-0000-0000-000000000001' and display_name = 'Pitch 2';
  perform public.update_fixture_pitch('f0000000-0000-0000-0000-000000000002', v_pitch_id, null);
  raise notice 'FAIL 9: a named pitch was accepted on an away fixture';
exception when others then
  raise notice 'PASS 9: a named pitch is rejected on an away fixture (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 10. An away club can never assign one of ITS OWN pitches to the
--     opponent's home fixture -- Rossendale's pitch on Burnley's home fixture.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_rossendale_pitch_id uuid;
begin
  v_rossendale_pitch_id := public.create_club_pitch('10000000-0000-0000-0000-000000000002', 'Rossendale Home Pitch', null);
  perform public.update_fixture_pitch('f0000000-0000-0000-0000-000000000001', v_rossendale_pitch_id, null);
  raise notice 'FAIL 10: Rossendale assigned its own pitch to Burnley''s home fixture';
exception when others then
  raise notice 'PASS 10: an away club cannot assign its own pitch to the opponent''s home fixture (%)', sqlerrm;
end $$;
rollback;
