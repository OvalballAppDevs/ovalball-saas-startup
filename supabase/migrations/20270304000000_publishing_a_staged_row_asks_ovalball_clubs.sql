-- Publishing a staged fixture row: the guards come back, and an Ovalball club
-- is asked, never booked.
--
-- 1. RESTORED GUARDS. 20270277000000 (and 20270278000000 after it) rewrote
--    publish_import_row to carry home/away and meet time, and in doing so
--    dropped most of the 20260914300000 body without a word: the row lock, the
--    status='update' path, the publishable-status gate, the fixture-date
--    check, the checks that the team, pitch and venue belong to the importing
--    club, the requirement that a conflict has a decision, the keep_existing
--    exclusion, and reviewed_by/reviewed_at. It also wrote fixture_source_refs
--    into a column that does not exist, so any row with a source reference
--    failed. All of that is restored here, with home/away and meet time kept.
--
-- 2. OVALBALL OPPONENTS ARE ASKED. A row whose opponent resolved to a real
--    Ovalball team used to insert a booked fixture straight into both clubs'
--    calendars, while the Planner told the person it had been "sent as a
--    request". The product rule is that every new fixture against an Ovalball
--    team goes through canonical verification. Such a row now creates a
--    fixture_request_groups / fixture_requests pair (status 'sent'), which the
--    existing notification trigger delivers and accept_fixture_request turns
--    into the fixture. External opponents are recorded directly, as before,
--    because nobody on the other side can answer.
--
-- 3. A REPLACE DECISION NEVER TOUCHES ANOTHER CLUB'S FIXTURE. Replacing a
--    conflicting fixture is an explicit choice by the importing club, and it
--    may only cancel a fixture that club owns. A clash with a fixture owned by
--    somebody else has to be resolved with them.
--
-- Authority is bulk planning authority (20270303000000) for a club batch and
-- Site Admin for a platform batch.

alter table public.fixture_import_rows
  add column if not exists published_request_id uuid references public.fixture_requests(id) on delete set null,
  add column if not exists resolved_venue_text text;

comment on column public.fixture_import_rows.resolved_venue_text is
  'For an away fixture against a club not on Ovalball: the home ground recorded for that club in the Club Directory. There is no venue record to point at, so the recorded ground travels as text to fixtures.venue_address. Never free text typed into the row.';

comment on column public.fixture_import_rows.published_request_id is
  'Set when publishing this row sent a fixture request to an Ovalball opponent instead of creating a fixture. The fixture appears when that club accepts.';

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
  v_group_id uuid;
  v_request_id uuid;
  v_home_club uuid;
  v_target_club uuid;
  v_target_directory uuid;
  v_side text;
begin
  select * into v_row from public.fixture_import_rows where id = p_row_id for update;
  if not found then
    raise exception 'Import row not found.';
  end if;

  select * into v_batch from public.fixture_import_batches where id = v_row.batch_id;
  if not found then
    raise exception 'Import batch not found.';
  end if;

  if v_batch.club_id is not null then
    if not internal.can_bulk_plan_fixtures(v_batch.club_id) then
      raise exception 'You are not authorized to publish fixtures for this club.' using errcode = '42501';
    end if;
  elsif not internal.is_site_admin() then
    raise exception 'Only a Site Admin may publish a platform-wide import.' using errcode = '42501';
  end if;

  -- ---------------------------------------------------------------
  -- An existing fixture, named by fixture_id: update it in place.
  -- ---------------------------------------------------------------
  if v_row.status = 'update' then
    if v_row.matched_fixture_id is null then
      raise exception 'Row has no matched fixture to update.';
    end if;
    if v_batch.club_id is not null and not exists (
      select 1 from public.fixtures f join public.teams t on t.id = f.owning_team_id
      where f.id = v_row.matched_fixture_id and t.club_id = v_batch.club_id
    ) then
      raise exception 'This row''s matched fixture does not belong to the importing club.' using errcode = '23514';
    end if;
    update public.fixtures
    set kickoff_date = coalesce(v_row.fixture_date, kickoff_date),
        kickoff_time = coalesce(v_row.kickoff_time, kickoff_time),
        meet_time = coalesce(v_row.meet_time, meet_time),
        game_type = coalesce(v_row.normalized_game_type, game_type),
        notes = coalesce(v_row.notes, notes),
        competition_edition_id = coalesce(v_row.resolved_competition_edition_id, competition_edition_id),
        pitch_id = coalesce(v_row.resolved_pitch_id, pitch_id),
        venue_id = coalesce(v_row.resolved_venue_id, venue_id),
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

  select club_id into v_home_club from public.teams where id = v_row.resolved_home_team_id;
  if v_batch.club_id is not null then
    if v_home_club is distinct from v_batch.club_id then
      raise exception 'This row''s home team does not belong to the importing club.' using errcode = '23514';
    end if;
    if v_row.resolved_pitch_id is not null
       and not exists (select 1 from public.club_pitches cp where cp.id = v_row.resolved_pitch_id and cp.club_id = v_batch.club_id) then
      raise exception 'This row''s pitch does not belong to the importing club.' using errcode = '23514';
    end if;
    if v_row.resolved_venue_id is not null
       and not exists (select 1 from public.venues v where v.id = v_row.resolved_venue_id and v.club_id = v_batch.club_id) then
      raise exception 'This row''s venue does not belong to the importing club.' using errcode = '23514';
    end if;
  end if;

  -- ---------------------------------------------------------------
  -- Conflicts: a decision is required, and replacing is limited to a
  -- fixture the importing club owns.
  -- ---------------------------------------------------------------
  if v_row.status = 'conflict' then
    if v_row.conflict_decision is null then
      raise exception 'Row has an unresolved conflict -- choose a decision before publishing.';
    end if;
    if v_row.conflict_decision = 'keep_existing' then
      update public.fixture_import_rows set status = 'excluded', reviewed_by = auth.uid(), reviewed_at = now() where id = p_row_id;
      return null;
    end if;
    if v_row.conflict_decision in ('replace_and_notify', 'override_no_notify') and v_row.conflicting_fixture_id is not null then
      if not exists (
        select 1 from public.fixtures f join public.teams t on t.id = f.owning_team_id
        where f.id = v_row.conflicting_fixture_id and t.club_id = v_home_club
      ) then
        raise exception 'The conflicting fixture belongs to another club, so it cannot be replaced from here. Resolve it with that club.' using errcode = '42501';
      end if;
      update public.fixtures
      set status = 'Cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
          cancellation_reason = 'Replaced by an imported fixture (' || coalesce(v_batch.filename, 'import') || ')'
      where id = v_row.conflicting_fixture_id;

      if v_row.conflict_decision = 'replace_and_notify' then
        insert into public.fixture_messages (fixture_id, sender_user_id, body)
        values (v_row.conflicting_fixture_id, auth.uid(), 'This fixture has been cancelled and replaced by a newly published fixture.');
      end if;
    end if;
  end if;

  -- ---------------------------------------------------------------
  -- An Ovalball opponent is ASKED.
  -- ---------------------------------------------------------------
  if v_row.resolved_away_team_id is not null then
    select t.club_id, c.directory_id into v_target_club, v_target_directory
    from public.teams t join public.clubs c on c.id = t.club_id
    where t.id = v_row.resolved_away_team_id;

    v_side := case coalesce(v_row.home_away, 'Home') when 'Away' then 'away' else 'home' end;

    insert into public.fixture_request_groups (
      requesting_club_id, raw_opponent_text, opponent_directory_id, opponent_club_id,
      proposed_date, notes, game_type, competition_edition_id, created_by
    )
    values (
      v_home_club, coalesce(v_row.raw_opposition_text, 'Opposition'), v_target_directory, v_target_club,
      v_row.fixture_date, v_row.notes, v_row.normalized_game_type, v_row.resolved_competition_edition_id, auth.uid()
    )
    returning id into v_group_id;

    insert into public.fixture_requests (
      group_id, requesting_team_id, target_team_id, venue_preference, preferred_kickoff_time,
      pitch_id, venue_id, note, status, created_by
    )
    values (
      v_group_id, v_row.resolved_home_team_id, v_row.resolved_away_team_id, v_side, v_row.kickoff_time,
      case when v_side = 'home' then v_row.resolved_pitch_id end,
      case when v_side = 'home' then v_row.resolved_venue_id end,
      v_row.notes, 'sent', auth.uid()
    )
    returning id into v_request_id;

    update public.fixture_import_rows
    set status = 'published', published_request_id = v_request_id, reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_row_id;
    return v_request_id;
  end if;

  -- ---------------------------------------------------------------
  -- An external opponent is recorded. An Ovalball club never is: a row
  -- naming one without a team of theirs is refused, not booked.
  -- ---------------------------------------------------------------
  if v_row.resolved_away_directory_id is not null
     and exists (select 1 from public.clubs c where c.directory_id = v_row.resolved_away_directory_id and c.status = 'active') then
    raise exception '% is on Ovalball, so they are asked rather than booked. Choose which of their teams this fixture is against.',
      coalesce(v_row.raw_opposition_text, 'That club') using errcode = '23514';
  end if;

  insert into public.fixtures (
    owning_team_id, home_away, opponent_team_id, opponent_directory_id, raw_opposition_text,
    kickoff_date, kickoff_time, meet_time, game_type, status, notes, source, import_batch_id,
    replaces_fixture_id, competition_edition_id, pitch_id, venue_id, venue_address,
    home_score, away_score, result_status
  )
  values (
    v_row.resolved_home_team_id,
    coalesce(v_row.home_away, 'Home'),
    null, v_row.resolved_away_directory_id,
    coalesce(v_row.raw_opposition_text, 'Unknown opposition'),
    v_row.fixture_date, v_row.kickoff_time, v_row.meet_time, v_row.normalized_game_type,
    coalesce(v_row.resolved_status, 'Booked'), v_row.notes,
    case when v_batch.club_id is not null then 'club_created' else 'csv_import' end,
    v_row.batch_id,
    case when v_row.status = 'conflict' and v_row.conflict_decision in ('replace_and_notify', 'override_no_notify') then v_row.conflicting_fixture_id else null end,
    v_row.resolved_competition_edition_id,
    v_row.resolved_pitch_id,
    v_row.resolved_venue_id,
    case when coalesce(v_row.home_away, 'Home') = 'Away' then v_row.resolved_venue_text end,
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
$function$;

comment on function public.publish_import_row(uuid) is
  'The only path that turns a staged fixture_import_rows row into a fixture or, for an Ovalball opponent, a fixture request. Bulk planning authority for a club batch, Site Admin for a platform batch. Restores the 20260914300000 guards (update path, status gate, club ownership of team/pitch/venue, conflict decision, keep_existing exclusion) that 20270277000000 dropped. Returns the fixture id, or the fixture_requests id when a request was sent.';
