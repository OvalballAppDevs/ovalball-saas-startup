-- =====================================================================
-- A STAGED FIXTURE CAN HAVE A MEET TIME
--
-- fixtures.meet_time is one of the three times a parent actually plans
-- their Saturday around, and it is the field a club's own spreadsheet is
-- most likely to carry beside the kick-off. The staging row had nowhere
-- to put it, so every imported fixture arrived with no meet time and
-- somebody re-entered two hundred of them by hand.
--
-- Same shape as home_away in 20270277000000: one nullable column, one
-- value carried through publish. Null stays null, which is exactly what
-- every previously published row already has, so nothing changes for
-- existing batches.
--
-- The meet-before-kick-off rule is NOT re-implemented here. It lives on
-- the fixtures table where every writer meets it, and a staged row that
-- breaks it fails at publish with that rule's own message -- named
-- against the row, which is what the planner's per-row result surfaces.
-- Copying the rule into the staging layer would be a second answer to
-- the same question.
-- =====================================================================

alter table public.fixture_import_rows
  add column if not exists meet_time time without time zone;

comment on column public.fixture_import_rows.meet_time is
  'Optional meet time staged for this row. Null means the source said nothing, which is how every row published before this column existed behaved.';

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
    kickoff_date, kickoff_time, meet_time, game_type, status, notes, source, import_batch_id,
    replaces_fixture_id, competition_edition_id, pitch_id, venue_id,
    home_score, away_score, result_status
  )
  values (
    v_row.resolved_home_team_id,
    -- A staged row that says nothing is still Home.
    coalesce(v_row.home_away, 'Home'),
    v_row.resolved_away_team_id, v_row.resolved_away_directory_id,
    coalesce(v_row.raw_opposition_text, 'Unknown opposition'),
    v_row.fixture_date, v_row.kickoff_time, v_row.meet_time, v_row.normalized_game_type,
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
  'Publishes one staged import row as a fixture, under the batch club''s own authority. Carries the row''s home_away and meet_time where it has them; a row that does not say publishes as Home with no meet time, which is what every row did before those columns existed.';
