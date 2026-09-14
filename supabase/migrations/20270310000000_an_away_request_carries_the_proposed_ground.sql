-- =====================================================================
-- AN AWAY REQUEST CARRIES THE GROUND IT PROPOSES
--
-- The Season Planner defaults an away row's ground to the opposition's own
-- ground, and the person planning may change it. Against a club not on
-- Ovalball that ground is recorded on the fixture. Against an Ovalball club
-- the fixture is a request, and the request had nowhere to put a ground, so a
-- deliberate choice was silently dropped when it was sent.
--
-- fixture_requests.proposed_ground (and proposed_pitch) now carry it. The host sees it on the
-- request it is answering, and accepting creates the fixture at that ground:
-- one of the host's own venue records when the name matches one, otherwise the
-- ground as text (fixtures.venue_address), exactly as an away ground at a club
-- not on Ovalball is kept. Nothing is proposed for a home request, whose venue
-- and pitch are the requesting club's own records as before.
-- =====================================================================

alter table public.fixture_requests
  add column if not exists proposed_ground text,
  add column if not exists proposed_pitch text;

alter table public.fixture_import_rows
  add column if not exists resolved_pitch_text text;

alter table public.fixture_requests
  drop constraint if exists fixture_requests_proposed_pitch_length;
alter table public.fixture_requests
  add constraint fixture_requests_proposed_pitch_length
  check (proposed_pitch is null or char_length(btrim(proposed_pitch)) between 1 and 200);

alter table public.fixture_requests
  drop constraint if exists fixture_requests_proposed_ground_length;
alter table public.fixture_requests
  add constraint fixture_requests_proposed_ground_length
  check (proposed_ground is null or char_length(btrim(proposed_ground)) between 1 and 200);

comment on column public.fixture_requests.proposed_ground is
  'Away requests only: the ground at the host club the requesting side proposed (the Season Planner or an import). Accepting creates the fixture there -- the host''s venue record when the name matches one, otherwise fixtures.venue_address.';

comment on column public.fixture_requests.proposed_pitch is
  'Away requests only: the pitch at the proposed ground. Accepting books that pitch when it is one of the host venue''s pitches; with a ground kept as text it travels with the text.';

comment on column public.fixture_import_rows.resolved_pitch_text is
  'Away rows against an Ovalball team only: the host''s pitch proposed with the ground, carried to fixture_requests.proposed_pitch.';

comment on column public.fixture_import_rows.resolved_venue_text is
  'Away rows only. Against a club not on Ovalball: the home ground recorded for that club (its default venue or Club Directory home ground), carried to fixtures.venue_address. Against an Ovalball team: the ground proposed to the host, carried to fixture_requests.proposed_ground for the host to accept.';

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
      pitch_id, venue_id, proposed_ground, proposed_pitch, note, status, created_by
    )
    values (
      v_group_id, v_row.resolved_home_team_id, v_row.resolved_away_team_id, v_side, v_row.kickoff_time,
      case when v_side = 'home' then v_row.resolved_pitch_id end,
      case when v_side = 'home' then v_row.resolved_venue_id end,
      -- Away: the ground the planner proposed at the host's club travels with
      -- the request, so the choice is put to the host rather than dropped.
      case when v_side = 'away' then nullif(btrim(v_row.resolved_venue_text), '') end,
      case when v_side = 'away' then nullif(btrim(v_row.resolved_pitch_text), '') end,
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


create or replace function public.accept_fixture_request(p_request_id uuid, p_target_team_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req public.fixture_requests;
  v_group public.fixture_request_groups;
  v_target_team_id uuid;
  v_target_group_id uuid;
  v_requesting_team_id uuid;
  v_requesting_club_venue text;
  v_target_venue text;
  v_fixture_id uuid;
  v_target_club_id uuid;
  v_eligible_member_count integer;
  v_auto_resolved_team_id uuid;
  v_both_clubs_active boolean;
  v_pitch_id uuid;
  v_venue_id uuid;
  v_venue_address text;
begin
  select * into v_req from public.fixture_requests where id = p_request_id for update;
  if not found then raise exception 'Fixture request not found.'; end if;
  if v_req.status <> 'sent' then raise exception 'Request is not awaiting a response (current status: %).', v_req.status; end if;

  select * into v_group from public.fixture_request_groups where id = v_req.group_id;

  if v_req.requesting_team_id is not null then
    v_requesting_team_id := v_req.requesting_team_id;
  else
    select min(team_id) into v_requesting_team_id from public.scheduling_group_members where group_id = v_req.requesting_scheduling_group_id;
    if v_requesting_team_id is null then
      raise exception 'This shared calendar has no member teams to book against.';
    end if;
  end if;

  if v_req.target_team_id is null and v_req.target_scheduling_group_id is not null then
    if p_target_team_id is not null then
      if not exists (select 1 from public.scheduling_group_members where group_id = v_req.target_scheduling_group_id and team_id = p_target_team_id) then
        raise exception 'That team is not a member of this shared calendar.';
      end if;
      if not internal.teams_can_play_fixture(v_requesting_team_id, p_target_team_id) then
        raise exception 'That team is not age-eligible against your requesting team.';
      end if;
      v_target_team_id := p_target_team_id;
      v_target_group_id := null;
    else
      select count(*), (array_agg(sgm.team_id))[1] into v_eligible_member_count, v_auto_resolved_team_id
      from public.scheduling_group_members sgm
      where sgm.group_id = v_req.target_scheduling_group_id
        and internal.teams_can_play_fixture(v_requesting_team_id, sgm.team_id);

      if v_eligible_member_count = 0 then
        raise exception 'No team in this shared calendar is age-eligible against the requesting team.';
      end if;
      -- One or more eligible members: accept against the WHOLE group
      -- (the auto-resolved member is only the required real anchor).
      v_target_team_id := v_auto_resolved_team_id;
      v_target_group_id := v_req.target_scheduling_group_id;
    end if;
  else
    v_target_team_id := coalesce(v_req.target_team_id, p_target_team_id);
    v_target_group_id := null;
  end if;

  if v_target_team_id is not null then
    select club_id into v_target_club_id from public.teams where id = v_target_team_id;
  else
    v_target_club_id := v_group.opponent_club_id;
  end if;

  if not (internal.is_site_admin()
          or (v_target_team_id is not null and internal.can_manage_team(v_target_team_id))
          or (v_target_club_id is not null and internal.can_manage_club_fixtures(v_target_club_id))) then
    raise exception 'You are not authorised to respond to this fixture request.' using errcode = '42501';
  end if;

  v_requesting_club_venue := case v_req.venue_preference
    when 'home' then 'Home' when 'away' then 'Away' else 'TBD' end;
  v_target_venue := case v_req.venue_preference
    when 'home' then 'Away' when 'away' then 'Home' else 'TBD' end;

  v_pitch_id := case when v_requesting_club_venue = 'Home' then v_req.pitch_id else null end;
  v_venue_id := case when v_requesting_club_venue = 'Home' then v_req.venue_id else null end;

  -- AN AWAY REQUEST'S PROPOSED GROUND. The host is accepting the fixture at the
  -- ground it was asked about. When that names one of the host's own venues it
  -- becomes that venue record; otherwise it is kept as the ground's text.
  if v_requesting_club_venue = 'Away' and nullif(btrim(v_req.proposed_ground), '') is not null then
    select v.id into v_venue_id
    from public.venues v
    where v.club_id = v_target_club_id and v.active and lower(btrim(v.name)) = lower(btrim(v_req.proposed_ground))
    order by v.is_default_home desc, v.id
    limit 1;
    if v_venue_id is null then
      v_venue_address := btrim(v_req.proposed_ground)
        || coalesce(', ' || nullif(btrim(v_req.proposed_pitch), ''), '');
    elsif nullif(btrim(v_req.proposed_pitch), '') is not null then
      select p.id into v_pitch_id
      from public.club_pitches p
      where p.venue_id = v_venue_id and p.active and lower(btrim(p.display_name)) = lower(btrim(v_req.proposed_pitch))
      limit 1;
    end if;
  end if;

  -- AN EXISTING FIXTURE, CONFIRMED. A request raised from the fixture editor
  -- asks the opposition to confirm which of their teams plays a fixture that
  -- already exists; accepting it completes that fixture rather than creating
  -- a second one. Anything else is the ordinary new fixture.
  if v_req.existing_fixture_id is not null then
    update public.fixtures f
    set opponent_team_id = v_target_team_id,
        opponent_directory_id = coalesce((select c.directory_id from public.clubs c where c.id = v_target_club_id), f.opponent_directory_id),
        updated_by = auth.uid()
    where f.id = v_req.existing_fixture_id
      and f.status <> 'Cancelled'
      and f.opponent_team_id is null
      and f.owning_team_id = v_requesting_team_id
    returning f.id into v_fixture_id;
    if v_fixture_id is null then
      raise exception 'That fixture has been cancelled or changed since this request was sent, so there is nothing to confirm.' using errcode = '23514';
    end if;
  else
    insert into public.fixtures (
      owning_team_id, owning_scheduling_group_id, kickoff_date, kickoff_time, home_away, status,
      raw_opposition_text, opponent_directory_id, opponent_team_id, opponent_scheduling_group_id,
      game_type, competition_edition_id, pitch_id, venue_id, venue_address,
      created_by, updated_by
    )
    values (
      v_requesting_team_id, v_req.requesting_scheduling_group_id, v_group.proposed_date, v_req.preferred_kickoff_time,
      v_requesting_club_venue, 'Booked',
      v_group.raw_opponent_text,
      -- A fixture carries ONE canonical opponent identity: either an
      -- opponent scheduling group or an opponent directory club, never
      -- both (fixtures_opponent_group_excludes_directory). When the
      -- request resolves against a Mini-Rugby Group, the group IS the
      -- opponent identity, so the directory reference must be dropped.
      -- Previously both were inserted unconditionally, so accepting any
      -- group-targeted request whose opponent came from the directory
      -- (the normal case) failed outright on that check constraint.
      case when v_target_group_id is not null then null else v_group.opponent_directory_id end,
      v_target_team_id, v_target_group_id,
      v_group.game_type, v_group.competition_edition_id, v_pitch_id, v_venue_id, v_venue_address,
      v_req.created_by, auth.uid()
    )
    returning id into v_fixture_id;
  end if;

  update public.fixture_requests
  set status = 'accepted', target_team_id = v_target_team_id,
      resulting_fixture_id = v_fixture_id, decided_by = auth.uid(), decided_at = now()
  where id = p_request_id;

  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id, 'fixture_request_accepted', 'Fixture confirmed',
    format('Your fixture on %s has been confirmed.', to_char(v_group.proposed_date, 'DD Mon YYYY')),
    jsonb_build_object('fixture_id', v_fixture_id, 'fixture_request_id', p_request_id)
  from public.team_permissions tp
  join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
  where tp.team_id = v_requesting_team_id;

  if v_target_team_id is not null then
    insert into public.notifications (user_id, type, title, body, data)
    select cm.user_id, 'fixture_request_accepted', 'Fixture confirmed',
      format('Your fixture on %s has been confirmed.', to_char(v_group.proposed_date, 'DD Mon YYYY')),
      jsonb_build_object('fixture_id', v_fixture_id, 'fixture_request_id', p_request_id)
    from public.team_permissions tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
    where tp.team_id = v_target_team_id;
  end if;

  if v_target_club_id is not null and v_group.requesting_club_id <> v_target_club_id then
    select (select status from public.clubs where id = v_group.requesting_club_id) = 'active'
           and (select status from public.clubs where id = v_target_club_id) = 'active'
      into v_both_clubs_active;

    if v_both_clubs_active and not exists (
      select 1 from public.club_partnerships cp
      where cp.status <> 'revoked'
        and least(cp.requesting_club_id, cp.partner_club_id) = least(v_group.requesting_club_id, v_target_club_id)
        and greatest(cp.requesting_club_id, cp.partner_club_id) = greatest(v_group.requesting_club_id, v_target_club_id)
    ) then
      begin
        insert into public.club_partnerships (requesting_club_id, partner_club_id, requested_by, source_fixture_id)
        values (v_group.requesting_club_id, v_target_club_id, v_req.created_by, v_fixture_id);
      exception when unique_violation then
        null;
      end;
    end if;
  end if;

  return v_fixture_id;
end;
$function$;
