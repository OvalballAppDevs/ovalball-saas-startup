-- Reconciliation pass complaints 25, 26: a staged import row previously had
-- no way to carry a resolved competition edition or pitch through to the
-- published fixture at all -- publish_import_row's insert list never
-- included them, so a CSV column (however matched) or a staging-review
-- correction had nowhere real to land. Two new nullable, real-FK columns
-- (never free text) so import can only ever reference an EXISTING
-- competition_editions/club_pitches row, exactly like the equivalent Site
-- Admin fixture-detail editors -- never a row invented from CSV/UI text.
alter table public.fixture_import_rows
  add column resolved_competition_edition_id uuid references public.competition_editions(id),
  add column resolved_pitch_id uuid references public.club_pitches(id);

comment on column public.fixture_import_rows.resolved_competition_edition_id is
  'A real competition_editions row this staged row will attach to the published fixture -- resolved from the CSV''s competition_edition_id/competition columns or set via a staging-review correction; never a competition/edition created from import data.';
comment on column public.fixture_import_rows.resolved_pitch_id is
  'A real club_pitches row (must belong to the resolving club) this staged row will attach to the published fixture -- resolved from the CSV''s pitch_id/pitch_name columns or set via a staging-review correction.';

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

  -- 'update' short-circuits the whole create/conflict path below: the row
  -- named an existing, permitted fixture_id explicitly, so this UPDATEs
  -- that row's scheduling fields (never its team/opponent identity --
  -- bulk-reassigning who a fixture is between is not something a CSV
  -- update row does) rather than inserting a second fixture for the same
  -- real-world match.
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

  -- Defense in depth: even if a row's home team was somehow resolved
  -- outside this batch's own club (should never happen given the
  -- app-layer matching restricts the search itself), a club-scoped batch
  -- can never publish a fixture owned by a different club.
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
    replaces_fixture_id, competition_edition_id, pitch_id
  )
  values (
    v_row.resolved_home_team_id, 'Home', v_row.resolved_away_team_id, v_row.resolved_away_directory_id,
    coalesce(v_row.raw_opposition_text, 'Unknown opposition'),
    v_row.fixture_date, v_row.kickoff_time, v_row.normalized_game_type, 'Booked', v_row.notes,
    case when v_batch.club_id is not null then 'club_created' else 'csv_import' end,
    v_row.batch_id,
    case when v_row.status = 'conflict' and v_row.conflict_decision in ('replace_and_notify', 'override_no_notify') then v_row.conflicting_fixture_id else null end,
    v_row.resolved_competition_edition_id,
    v_row.resolved_pitch_id
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
  'The only path that turns a staged fixture_import_rows row into a real fixtures row. Atomic per row. Authorises either Site Admin (batch.club_id null, the original global import) or the real fixture authority for the batch''s own club (Club Admin/FIXTURE_SECRETARY, via internal.can_manage_club_fixtures) -- a club-scoped import always publishes with source=''club_created'', a Site Admin global import keeps source=''csv_import'', matching each path''s own real provenance. resolved_competition_edition_id/resolved_pitch_id (Reconciliation complaints 25/26) carry through to the created/updated fixture when a staged row resolved or was corrected to reference them.';
