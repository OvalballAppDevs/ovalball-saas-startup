-- Manual verification for club-level fixture CSV import/export
-- (20260905200000_club_fixture_import.sql) -- the Master Fixture
-- Registry mega-spec's Section BE-BQ: the SAME staged Upload -> Parse ->
-- Validate -> Resolve -> Review -> Authorise -> Commit engine as the
-- pre-existing Site Admin import, widened to a club-scoped variant. NOT a
-- migration -- run AFTER permission_matrix.sql (reuses its seeded
-- users/clubs/teams).
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/club_fixture_import.sql

\set ON_ERROR_STOP off
\pset pager off

-- ------------------------------------------------------------
-- 1. Burnley's own Club Admin can create a club-scoped import batch and
--    stage/publish a row for their own U12 A team.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_batch_id uuid;
  v_row_id uuid;
  v_fixture_id uuid;
begin
  insert into public.fixture_import_batches (uploaded_by, filename, row_count, state, club_id)
  values ('00000000-0000-0000-0000-000000000002', 'burnley-fixtures.csv', 1, 'processing', '10000000-0000-0000-0000-000000000001')
  returning id into v_batch_id;

  insert into public.fixture_import_rows (batch_id, row_number, raw, status, resolved_home_team_id, raw_opposition_text, normalized_game_type, fixture_date, kickoff_time)
  values (v_batch_id, 1, '{"home_club":"Burnley RUFC","home_team":"U12 A"}'::jsonb, 'ready', '30000000-0000-0000-0000-000000000001', 'Rossendale RUFC', 'Friendly', current_date + 30, '14:00')
  returning id into v_row_id;

  select public.publish_import_row(v_row_id) into v_fixture_id;
  if v_fixture_id is not null then
    raise notice 'PASS 1: Burnley''s Club Admin can create a club-scoped batch and publish a row for their own team';
  else
    raise notice 'FAIL 1: publish_import_row returned null';
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 2. A Club Admin from a DIFFERENT club cannot even INSERT a batch
--    scoped to Burnley -- real RLS rejection, not UI hiding.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  insert into public.fixture_import_batches (uploaded_by, filename, row_count, state, club_id)
  values ('00000000-0000-0000-0000-000000000003', 'hijack.csv', 1, 'processing', '10000000-0000-0000-0000-000000000001');
  raise notice 'FAIL 2: Rossendale''s admin unexpectedly created a batch scoped to Burnley';
exception when insufficient_privilege then
  raise notice 'PASS 2: a Club Admin from a different club cannot create an import batch scoped to Burnley -- rejected by RLS';
end $$;
rollback;

-- ------------------------------------------------------------
-- 3. Even if a row somehow named a team belonging to a DIFFERENT club
--    (should never happen given the app-layer matching restricts the
--    search itself), publish_import_row's own defense-in-depth check
--    rejects it directly -- proven as Burnley's own real, otherwise-
--    authorised Club Admin (not merely "no acting user at all"), so this
--    is the hard invariant itself doing the rejecting, not just the
--    outer authorisation check.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_batch_id uuid;
  v_row_id uuid;
begin
  insert into public.fixture_import_batches (uploaded_by, filename, row_count, state, club_id)
  values ('00000000-0000-0000-0000-000000000002', 'cross-club-attempt.csv', 1, 'processing', '10000000-0000-0000-0000-000000000001')
  returning id into v_batch_id;

  -- resolved_home_team_id deliberately points at a ROSSENDALE team even
  -- though this batch's club_id is Burnley.
  insert into public.fixture_import_rows (batch_id, row_number, raw, status, resolved_home_team_id, raw_opposition_text, normalized_game_type, fixture_date, kickoff_time)
  values (v_batch_id, 1, '{"home_club":"Burnley RUFC","home_team":"U12 A"}'::jsonb, 'ready', '30000000-0000-0000-0000-000000000003', 'Someone', 'Friendly', current_date + 31, '14:00')
  returning id into v_row_id;

  begin
    perform public.publish_import_row(v_row_id);
    raise notice 'FAIL 3: publish_import_row unexpectedly published a row whose team belongs to a different club';
  exception when check_violation then
    raise notice 'PASS 3: publish_import_row rejects a row whose resolved home team does not belong to the batch''s own club -- a real invariant, not just the outer authorisation check';
  end;
end $$;
commit;

-- ------------------------------------------------------------
-- 4. Cancelling a staged batch (never authorising it) produces zero
--    fixture writes.
-- ------------------------------------------------------------
do $$
declare
  v_batch_id uuid;
  v_before integer;
  v_after integer;
begin
  select count(*) into v_before from public.fixtures;

  insert into public.fixture_import_batches (uploaded_by, filename, row_count, state, club_id)
  values ('00000000-0000-0000-0000-000000000002', 'cancelled-import.csv', 1, 'processing', '10000000-0000-0000-0000-000000000001')
  returning id into v_batch_id;

  insert into public.fixture_import_rows (batch_id, row_number, raw, status, resolved_home_team_id, raw_opposition_text, normalized_game_type, fixture_date, kickoff_time)
  values (v_batch_id, 1, '{"home_club":"Burnley RUFC","home_team":"U12 A"}'::jsonb, 'ready', '30000000-0000-0000-0000-000000000001', 'Someone Else', 'Friendly', current_date + 32, '14:00');

  -- Deliberately never call publish_import_row -- this is what "Cancel"
  -- means in the UI: the staged rows just sit there, unpublished.
  select count(*) into v_after from public.fixtures;
  if v_before = v_after then
    raise notice 'PASS 4: staging a batch without publishing it creates zero fixture rows';
  else
    raise notice 'FAIL 4: fixture count changed from % to % without an explicit publish', v_before, v_after;
  end if;
end $$;

-- ------------------------------------------------------------
-- 5. fixture_id-based update: a row naming an existing, permitted
--    fixture_id stages/publishes as an UPDATE, never a second fixture.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_batch_id uuid;
  v_row_id uuid;
  v_existing_fixture_id uuid;
  v_fixture_count_before integer;
  v_fixture_count_after integer;
  v_updated_notes text;
  v_result uuid;
begin
  select id into v_existing_fixture_id from public.fixtures where owning_team_id = '30000000-0000-0000-0000-000000000001' order by created_at desc limit 1;

  select count(*) into v_fixture_count_before from public.fixtures;

  insert into public.fixture_import_batches (uploaded_by, filename, row_count, state, club_id)
  values ('00000000-0000-0000-0000-000000000002', 'update-existing.csv', 1, 'processing', '10000000-0000-0000-0000-000000000001')
  returning id into v_batch_id;

  insert into public.fixture_import_rows (batch_id, row_number, raw, status, matched_fixture_id, notes)
  values (v_batch_id, 1, jsonb_build_object('fixture_id', v_existing_fixture_id::text), 'update', v_existing_fixture_id, 'Updated via CSV re-import')
  returning id into v_row_id;

  select public.publish_import_row(v_row_id) into v_result;

  select count(*) into v_fixture_count_after from public.fixtures;
  select notes into v_updated_notes from public.fixtures where id = v_existing_fixture_id;

  if v_result = v_existing_fixture_id and v_fixture_count_after = v_fixture_count_before and v_updated_notes = 'Updated via CSV re-import' then
    raise notice 'PASS 5: a row naming an existing fixture_id updates that SAME fixture (notes changed, total fixture count unchanged) -- never a duplicate create';
  else
    raise notice 'FAIL 5: result=%, count_before=%, count_after=%, notes=%', v_result, v_fixture_count_before, v_fixture_count_after, v_updated_notes;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 6. A club-scoped batch cannot update a fixture belonging to a
--    DIFFERENT club via a supplied fixture_id -- proven as Burnley's
--    own real, otherwise-authorised Club Admin.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_batch_id uuid;
  v_row_id uuid;
  v_rossendale_fixture_id uuid;
begin
  select id into v_rossendale_fixture_id from public.fixtures where owning_team_id = '30000000-0000-0000-0000-000000000003' limit 1;
  if v_rossendale_fixture_id is null then
    raise notice 'SKIP 6: no existing Rossendale fixture to test against in this run';
  else
    insert into public.fixture_import_batches (uploaded_by, filename, row_count, state, club_id)
    values ('00000000-0000-0000-0000-000000000002', 'cross-club-update.csv', 1, 'processing', '10000000-0000-0000-0000-000000000001')
    returning id into v_batch_id;

    insert into public.fixture_import_rows (batch_id, row_number, raw, status, matched_fixture_id, notes)
    values (v_batch_id, 1, jsonb_build_object('fixture_id', v_rossendale_fixture_id::text), 'update', v_rossendale_fixture_id, 'Should never apply')
    returning id into v_row_id;

    begin
      perform public.publish_import_row(v_row_id);
      raise notice 'FAIL 6: Burnley''s club-scoped batch unexpectedly updated a Rossendale-owned fixture';
    exception when check_violation then
      raise notice 'PASS 6: a club-scoped batch cannot update a fixture belonging to a different club';
    end;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 7. Venue instruction Section 20: publish_import_row carries a resolved
--    venue onto the created fixture, and rejects one belonging to a
--    different club -- same shape as pitch_id's own existing checks,
--    self-contained venue rows so this file never depends on another
--    test file's leftover data.
-- ------------------------------------------------------------
do $$
begin
  insert into public.venues (id, club_id, name, slug)
  values ('95000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'CSV Import Test Venue (Burnley)', 'csv-import-test-venue-burnley-95000001'),
         ('95000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'CSV Import Test Venue (Rossendale)', 'csv-import-test-venue-rossendale-95000002')
  on conflict (id) do nothing;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_batch_id uuid;
  v_row_id uuid;
  v_result uuid;
  v_published_venue_id uuid;
begin
  insert into public.fixture_import_batches (uploaded_by, filename, row_count, state, club_id)
  values ('00000000-0000-0000-0000-000000000002', 'venue-resolution.csv', 1, 'processing', '10000000-0000-0000-0000-000000000001')
  returning id into v_batch_id;

  insert into public.fixture_import_rows (
    batch_id, row_number, raw, status, resolved_home_team_id, resolved_venue_id, raw_opposition_text, fixture_date
  )
  values (
    v_batch_id, 1, jsonb_build_object('venue_id', '95000000-0000-0000-0000-000000000001'), 'ready',
    '30000000-0000-0000-0000-000000000001', '95000000-0000-0000-0000-000000000001', 'Venue Test Opposition', current_date + 45
  )
  returning id into v_row_id;

  select public.publish_import_row(v_row_id) into v_result;
  select venue_id into v_published_venue_id from public.fixtures where id = v_result;

  if v_published_venue_id = '95000000-0000-0000-0000-000000000001' then
    raise notice 'PASS 7: a row with a resolved venue_id carries it through to the published fixture';
  else
    raise notice 'FAIL 7: published fixture venue_id=%, expected the Burnley test venue', v_published_venue_id;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 8. A club-scoped batch cannot publish a row whose resolved venue
--    belongs to a DIFFERENT club -- server-side rejection, mirroring
--    test 6's cross-club fixture check.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_batch_id uuid;
  v_row_id uuid;
begin
  insert into public.fixture_import_batches (uploaded_by, filename, row_count, state, club_id)
  values ('00000000-0000-0000-0000-000000000002', 'venue-cross-club.csv', 1, 'processing', '10000000-0000-0000-0000-000000000001')
  returning id into v_batch_id;

  insert into public.fixture_import_rows (
    batch_id, row_number, raw, status, resolved_home_team_id, resolved_venue_id, raw_opposition_text, fixture_date
  )
  values (
    v_batch_id, 1, jsonb_build_object('venue_id', '95000000-0000-0000-0000-000000000002'), 'ready',
    '30000000-0000-0000-0000-000000000001', '95000000-0000-0000-0000-000000000002', 'Venue Cross-Club Test', current_date + 46
  )
  returning id into v_row_id;

  begin
    perform public.publish_import_row(v_row_id);
    raise notice 'FAIL 8: a club-scoped batch unexpectedly published against a different club''s venue';
  exception when others then
    raise notice 'PASS 8: a club-scoped batch cannot publish against a venue belonging to a different club (%)', sqlerrm;
  end;
end $$;
commit;
