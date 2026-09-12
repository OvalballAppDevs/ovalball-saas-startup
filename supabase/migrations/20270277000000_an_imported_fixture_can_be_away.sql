-- =====================================================================
-- AN IMPORTED FIXTURE CAN BE AWAY
--
-- publish_import_row writes 'Home' as a literal. Every fixture the import
-- pipeline has ever created is a home fixture, whatever the source file
-- said -- so a club importing a season has been silently told that half
-- of its matches are at its own ground.
--
-- Nothing surfaced because home_away is not a column the importer reads:
-- there was no value to disagree with. The staged row simply had nowhere
-- to record it.
--
-- The fix is one nullable column on the staging row and one coalesce at
-- publish time. Existing rows and existing files are unaffected: a row
-- that says nothing still publishes as Home, exactly as before.
--
-- This matters now because the Mass Fixture Planner has an explicit
-- Home/Away cell, and every input route -- typing, spreadsheet paste, CSV
-- and Fixture Day -- converges on this same staging row. Without the
-- column the planner would have to create a fixture and then correct it,
-- which is two audit entries and a moment where the record is wrong.
-- =====================================================================

alter table public.fixture_import_rows
  add column if not exists home_away text;

alter table public.fixture_import_rows
  drop constraint if exists fixture_import_rows_home_away_check;

alter table public.fixture_import_rows
  add constraint fixture_import_rows_home_away_check
  check (home_away is null or home_away in ('Home', 'Away'));

comment on column public.fixture_import_rows.home_away is
  'Which side of the fixture the importing club is on. Null means Home, which is what every row published before this column existed already meant.';

create or replace function public.publish_import_row(p_row_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $function$
declare
  v_row public.fixture_import_rows;
  v_batch public.fixture_import_batches;
  v_new_fixture_id uuid;
begin
  select * into v_row from public.fixture_import_rows where id = p_row_id;
  if not found then
    raise exception 'Import row not found.';
  end if;

  select * into v_batch from public.fixture_import_batches where id = v_row.batch_id;
  if not found then
    raise exception 'Import batch not found.';
  end if;

  -- Unchanged authority: the batch's own club decides, never the caller's
  -- claim about it.
  if v_batch.club_id is not null then
    if not internal.can_manage_club_fixtures(v_batch.club_id) then
      raise exception 'You are not authorized to publish fixtures for this club.' using errcode = '42501';
    end if;
  elsif not internal.is_site_admin() then
    raise exception 'Only a Site Admin may publish a platform-wide import.' using errcode = '42501';
  end if;

  if v_row.status = 'excluded' then
    return null;
  end if;
  if v_row.published_fixture_id is not null then
    return v_row.published_fixture_id;
  end if;
  if v_row.resolved_home_team_id is null then
    raise exception 'This row has no resolved team and cannot be published.';
  end if;
  if v_row.status = 'conflict' and coalesce(v_row.conflict_decision, '') = 'keep_existing' then
    return null;
  end if;

  insert into public.fixtures (
    owning_team_id, home_away, opponent_team_id, opponent_directory_id, raw_opposition_text,
    kickoff_date, kickoff_time, game_type, status, notes, source, import_batch_id,
    replaces_fixture_id, competition_edition_id, pitch_id, venue_id,
    home_score, away_score, result_status
  )
  values (
    v_row.resolved_home_team_id,
    -- THE ONE CHANGE. A staged row that says nothing is still Home.
    coalesce(v_row.home_away, 'Home'),
    v_row.resolved_away_team_id, v_row.resolved_away_directory_id,
    coalesce(v_row.raw_opposition_text, 'Unknown opposition'),
    v_row.fixture_date, v_row.kickoff_time, v_row.normalized_game_type,
    coalesce(v_row.resolved_status, 'Booked'), v_row.notes,
    case when v_batch.club_id is not null then 'club_created' else 'csv_import' end,
    v_row.batch_id,
    case when v_row.status = 'conflict' and v_row.conflict_decision in ('replace_and_notify', 'override_no_notify') then v_row.conflicting_fixture_id else null end,
    v_row.resolved_competition_edition_id,
    v_row.resolved_pitch_id,
    v_row.resolved_venue_id,
    v_row.resolved_home_score,
    v_row.resolved_away_score,
    case when v_row.resolved_home_score is not null and v_row.resolved_away_score is not null then 'external_recorded' else 'none' end
  )
  returning id into v_new_fixture_id;

  if v_row.source_reference is not null and v_row.source_reference <> '' then
    insert into public.fixture_source_refs (fixture_id, source_reference)
    values (v_new_fixture_id, v_row.source_reference)
    on conflict do nothing;
  end if;

  update public.fixture_import_rows
  set published_fixture_id = v_new_fixture_id, status = 'published'
  where id = p_row_id;

  return v_new_fixture_id;
end;
$function$;

comment on function public.publish_import_row(uuid) is
  'Publishes one staged import row as a fixture, under the batch club''s own authority. Honours the row''s home_away where it has one; a row that does not say publishes as Home, which is what every row did before the column existed.';
