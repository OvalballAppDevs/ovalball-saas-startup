-- Reconciliation pass complaint 26 (remainder): the staging review could
-- correct Home Team/Away Club/Away Team/Date/Kickoff, and the backend
-- already carried resolved_competition_edition_id/resolved_pitch_id
-- through to the published fixture, but nothing existed anywhere -- not a
-- CSV column reader, not a staged-row column, not a UI control -- for
-- Status or scores/result. A historical-backfill CSV (the primary real
-- use case for bulk import) commonly DOES carry a final score, so this
-- adds the missing round trip: parse optional status/home_score/
-- away_score columns from the CSV, stage them, allow correcting them,
-- and write them onto the published fixture. Never independently
-- editable: rugby_code (derived from the resolved home team, already
-- cross-validated by matchAndValidateImportRow) and season (auto-resolved
-- from kickoff_date by the pre-existing internal.resolve_season_for_date
-- trigger) -- both stay display-only in the review UI, matching the
-- domain's own immutability/derivation rules rather than faking
-- editability that would let an import silently disagree with the team
-- or date it just resolved.
alter table public.fixture_import_rows
  add column resolved_status text check (resolved_status = any (array['Planned', 'Booked', 'To Be Determined', 'Cancelled', 'Completed'])),
  add column resolved_home_score integer check (resolved_home_score is null or resolved_home_score >= 0),
  add column resolved_away_score integer check (resolved_away_score is null or resolved_away_score >= 0);

comment on column public.fixture_import_rows.resolved_status is
  'Optional fixture status for a historical/backfilled row -- from the CSV''s own status column or a staging-review correction. NULL publishes with the existing default (''Booked''), matching prior behaviour exactly.';
comment on column public.fixture_import_rows.resolved_home_score is
  'Optional final score for a historical/backfilled row. Only used if BOTH scores are set -- publish_import_row writes result_status = ''external_recorded'' when populated, the same value this app already uses elsewhere for a result recorded outside the normal in-app negotiation flow.';
comment on column public.fixture_import_rows.resolved_away_score is
  'See resolved_home_score.';

create or replace function public.publish_import_row(p_row_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.fixture_import_rows;
  v_batch public.fixture_import_batches;
  v_new_fixture_id uuid;
begin
  select * into v_row from public.fixture_import_rows where id = p_row_id for update;
  if not found then
    raise exception 'Import row not found.';
  end if;

  select * into v_batch from public.fixture_import_batches where id = v_row.batch_id;

  if not (internal.is_site_admin() or (v_batch.club_id is not null and internal.can_manage_club_fixtures(v_batch.club_id))) then
    raise exception 'You are not authorised to publish this import.' using errcode = '42501';
  end if;

  if v_row.status = 'update' then
    if v_row.matched_fixture_id is null then
      raise exception 'Row has no matched fixture to update.';
    end if;
    if v_batch.club_id is not null then
      if not exists (
        select 1 from public.fixtures f join public.teams t on t.id = f.owning_team_id
        where f.id = v_row.matched_fixture_id and t.club_id = v_batch.club_id
      ) then
        raise exception 'This row''s matched fixture does not belong to the importing club.' using errcode = '23514';
      end if;
    end if;
    update public.fixtures
    set kickoff_date = coalesce(v_row.fixture_date, kickoff_date),
        kickoff_time = v_row.kickoff_time,
        game_type = coalesce(v_row.normalized_game_type, game_type),
        notes = coalesce(v_row.notes, notes),
        competition_edition_id = coalesce(v_row.resolved_competition_edition_id, competition_edition_id),
        pitch_id = coalesce(v_row.resolved_pitch_id, pitch_id),
        status = coalesce(v_row.resolved_status, status),
        home_score = coalesce(v_row.resolved_home_score, home_score),
        away_score = coalesce(v_row.resolved_away_score, away_score),
        result_status = case when v_row.resolved_home_score is not null and v_row.resolved_away_score is not null then 'external_recorded' else result_status end,
        updated_by = auth.uid()
    where id = v_row.matched_fixture_id
    returning id into v_new_fixture_id;

    update public.fixture_import_rows
    set status = 'published', published_fixture_id = v_new_fixture_id, reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_row_id;

    return v_new_fixture_id;
  end if;

  if v_row.status not in ('ready', 'conflict') then
    raise exception 'Row is not in a publishable state (current status: %).', v_row.status;
  end if;
  if v_row.resolved_home_team_id is null then
    raise exception 'Row has no resolved home team -- cannot publish.';
  end if;
  if v_row.fixture_date is null then
    raise exception 'Row has no fixture date -- cannot publish as a scheduled fixture.';
  end if;

  if v_batch.club_id is not null then
    if not exists (select 1 from public.teams t where t.id = v_row.resolved_home_team_id and t.club_id = v_batch.club_id) then
      raise exception 'This row''s home team does not belong to the importing club.' using errcode = '23514';
    end if;
    if v_row.resolved_pitch_id is not null
       and not exists (select 1 from public.club_pitches cp where cp.id = v_row.resolved_pitch_id and cp.club_id = v_batch.club_id) then
      raise exception 'This row''s pitch does not belong to the importing club.' using errcode = '23514';
    end if;
  end if;

  if v_row.status = 'conflict' then
    if v_row.conflict_decision is null then
      raise exception 'Row has an unresolved conflict -- choose a decision before publishing.';
    end if;
    if v_row.conflict_decision = 'keep_existing' then
      update public.fixture_import_rows set status = 'excluded', reviewed_by = auth.uid(), reviewed_at = now() where id = p_row_id;
      return null;
    end if;
    if v_row.conflict_decision in ('replace_and_notify', 'override_no_notify') and v_row.conflicting_fixture_id is not null then
      update public.fixtures
      set status = 'Cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
          cancellation_reason = 'Replaced by CSV import (' || coalesce(v_batch.filename, 'import') || ')'
      where id = v_row.conflicting_fixture_id;

      if v_row.conflict_decision = 'replace_and_notify' then
        insert into public.fixture_messages (fixture_id, sender_user_id, body)
        values (v_row.conflicting_fixture_id, auth.uid(), 'This fixture has been cancelled and replaced by a newly published fixture from a CSV import.');
      end if;
    end if;
  end if;

  insert into public.fixtures (
    owning_team_id, home_away, opponent_team_id, opponent_directory_id, raw_opposition_text,
    kickoff_date, kickoff_time, game_type, status, notes, source, import_batch_id,
    replaces_fixture_id, competition_edition_id, pitch_id,
    home_score, away_score, result_status
  )
  values (
    v_row.resolved_home_team_id, 'Home', v_row.resolved_away_team_id, v_row.resolved_away_directory_id,
    coalesce(v_row.raw_opposition_text, 'Unknown opposition'),
    v_row.fixture_date, v_row.kickoff_time, v_row.normalized_game_type, coalesce(v_row.resolved_status, 'Booked'), v_row.notes,
    case when v_batch.club_id is not null then 'club_created' else 'csv_import' end,
    v_row.batch_id,
    case when v_row.status = 'conflict' and v_row.conflict_decision in ('replace_and_notify', 'override_no_notify') then v_row.conflicting_fixture_id else null end,
    v_row.resolved_competition_edition_id,
    v_row.resolved_pitch_id,
    v_row.resolved_home_score,
    v_row.resolved_away_score,
    case when v_row.resolved_home_score is not null and v_row.resolved_away_score is not null then 'external_recorded' else 'none' end
  )
  returning id into v_new_fixture_id;

  if v_row.source_reference is not null and v_row.source_reference <> '' then
    insert into public.fixture_source_refs (fixture_id, source_system, source_id, import_batch_id)
    values (v_new_fixture_id, 'csv_import', v_row.source_reference, v_row.batch_id)
    on conflict (source_system, source_id) do nothing;
  end if;

  update public.fixture_import_rows
  set status = 'published', published_fixture_id = v_new_fixture_id, reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_row_id;

  return v_new_fixture_id;
end;
$$;

comment on function public.publish_import_row(uuid) is
  'The only path that turns a staged fixture_import_rows row into a real fixtures row. Atomic per row. resolved_status/resolved_home_score/resolved_away_score (Reconciliation complaint 26 remainder) carry through when a historical-backfill row set them -- a populated score pair always sets result_status = ''external_recorded'', matching this app''s existing convention for a result recorded outside the normal in-app negotiation flow.';
