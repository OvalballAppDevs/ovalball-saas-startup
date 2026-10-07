-- ONE NOTIFICATION PER PERSON, AND A SCHEDULE NOTICE THAT SAYS WHICH TOURNAMENT (notification closure UAT).
--
-- accept_fixture_request told every role assignment on each side, so a person holding two roles on one
-- team (Coach and Team Safeguarding Lead) was told twice, at the same instant, about the same fixture.
-- apply_to_tournament had the same shape for someone who is both Club Admin and Fixtures Secretary.
-- Both now select each person once.
--
-- publish_tournament_plan said "The schedule for your tournament has been published." -- two
-- tournaments published together read as one notice delivered twice. It now names the age group and
-- the tournament.
--
-- Bodies are otherwise the live definitions, unchanged.

CREATE OR REPLACE FUNCTION public.accept_fixture_request(p_request_id uuid, p_target_team_id uuid DEFAULT NULL::uuid, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
  v_effective_date date;
  v_effective_kickoff_time time without time zone;
  v_effective_venue_preference text;
  v_accepting_team_id uuid;
  v_accepting_club_id uuid;
begin
  select * into v_req from public.fixture_requests where id = p_request_id for update;
  if not found then
    raise exception 'You are not authorised to respond to this fixture request.' using errcode = '42501';
  end if;

  if p_expected_updated_at is not null and v_req.updated_at is distinct from p_expected_updated_at then
    raise exception 'This request has changed since you last viewed it. Please refresh and try again.' using errcode = '40001';
  end if;

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

  if v_req.status = 'counter_proposed' then
    -- CA-M11.5: whoever did NOT make the standing counter is the only side who may accept it -- never
    -- simply "the target team", which would otherwise let the side that just countered immediately
    -- accept their own counter (Section 19's own state-machine requirement).
    v_accepting_team_id := case when v_req.last_proposed_by_team_id = v_req.requesting_team_id then v_target_team_id else v_req.requesting_team_id end;
    select club_id into v_accepting_club_id from public.teams where id = v_accepting_team_id;
    if not (
      (v_accepting_club_id is not null and internal.can('fixture.request.respond', 'team', v_accepting_club_id, v_accepting_team_id, null))
      or (v_accepting_club_id is not null and internal.can('fixture.request.respond', 'club', v_accepting_club_id, null, null))
      or internal.has_site_capability('site.fixtures.support')
    ) then
      raise exception 'You are not authorized to respond to this fixture request.' using errcode = '42501';
    end if;
  else
    -- Slice 4C: responding to a fixture request is fixture.request.respond, at the team being asked
    -- or at its club. J.6 line 466 grants it to CA, FS and TM -- a Coach may raise a request but not
    -- answer one.
    if not ((v_target_team_id is not null and v_target_club_id is not null
             and internal.can('fixture.request.respond', 'team', v_target_club_id, v_target_team_id, null))
            or (v_target_club_id is not null
                and internal.can('fixture.request.respond', 'club', v_target_club_id, null, null))
            or internal.has_site_capability('site.fixtures.support')) then
      raise exception 'You are not authorised to respond to this fixture request.' using errcode = '42501';
    end if;
  end if;
  if v_req.status not in ('sent', 'counter_proposed') then raise exception 'Request is not awaiting a response (current status: %).', v_req.status; end if;

  -- CA-M11.5: the CURRENT standing proposal -- the original when never countered, or the latest round.
  v_effective_date := coalesce(v_req.countered_date, v_group.proposed_date);
  v_effective_kickoff_time := coalesce(v_req.countered_kickoff_time, v_req.preferred_kickoff_time);
  v_effective_venue_preference := coalesce(v_req.countered_venue_preference, v_req.venue_preference);

  v_requesting_club_venue := case v_effective_venue_preference
    when 'home' then 'Home' when 'away' then 'Away' else 'TBD' end;
  v_target_venue := case v_effective_venue_preference
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
      v_requesting_team_id, v_req.requesting_scheduling_group_id, v_effective_date, v_effective_kickoff_time,
      v_requesting_club_venue, 'Booked',
      v_group.raw_opponent_text,
      -- A fixture carries ONE canonical opponent identity: either an
      -- opponent scheduling group or an opponent directory club, never
      -- both (fixtures_opponent_group_excludes_directory). When the
      -- request resolves against a Mini-Rugby Group, the group IS the
      -- opponent identity, so the directory reference must be dropped.
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

  -- ONE ROW PER PERSON. A person holds a role assignment per role (Coach and Team Safeguarding Lead on
  -- one side are two rows), and may be on both sides; each is told once.
  insert into public.notifications (user_id, type, title, body, data)
  select distinct cm.user_id, 'fixture_request_accepted', 'Fixture confirmed',
    format('Your fixture on %s has been confirmed.', to_char(v_effective_date, 'DD Mon YYYY')),
    jsonb_build_object('fixture_id', v_fixture_id, 'fixture_request_id', p_request_id)
  from public.role_assignments ra
  join public.club_memberships cm on cm.id = ra.membership_id and cm.status = 'active'
  where ra.state in ('ACTIVE', 'SUSPENDED')
    and (ra.team_id = v_requesting_team_id or (v_target_team_id is not null and ra.team_id = v_target_team_id));

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

CREATE OR REPLACE FUNCTION public.apply_to_tournament(p_tournament_id uuid, p_club_id uuid, p_age_group text, p_team_ids uuid[] DEFAULT NULL::uuid[], p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_visibility text;
  v_id uuid;
  v_host_club_id uuid;
  v_applicant_name text;
begin
  if not internal.session_ok() then
    raise exception 'Your session is not able to make this change. Sign in again.' using errcode = '42501';
  end if;
  if not internal.can('tournament.tournament.manage', 'club', p_club_id, null, null) then
    raise exception 'You do not have permission to enter this club into a tournament.' using errcode = '42501';
  end if;

  select visibility, host_club_id into v_visibility, v_host_club_id from public.tournaments where id = p_tournament_id;
  if v_visibility is null then
    raise exception 'Tournament not found.' using errcode = 'P0002';
  end if;
  if v_visibility <> 'public' then
    raise exception 'This tournament is invite only.' using errcode = '42501';
  end if;

  insert into public.tournament_applications (tournament_id, club_id, age_group, applied_by, note)
  values (p_tournament_id, p_club_id, p_age_group, auth.uid(), p_note)
  on conflict (tournament_id, club_id, age_group)
    do update set status = 'pending', applied_by = auth.uid(), applied_at = now(), decided_by = null, decided_at = null, note = excluded.note, updated_at = now()
  returning id into v_id;

  delete from public.tournament_application_teams where application_id = v_id;
  insert into public.tournament_application_teams (application_id, team_id)
  select v_id, tid from unnest(coalesce(p_team_ids, '{}'::uuid[])) as tid
  on conflict do nothing;

  select cd.name into v_applicant_name
  from public.clubs c join public.club_directory cd on cd.id = c.directory_id
  where c.id = p_club_id;

  insert into public.notifications (user_id, type, title, body, data)
  select distinct ra.user_id, 'tournament_application_received', 'A club has applied to your tournament',
    format('%s has applied to enter age group %s.', coalesce(v_applicant_name, 'A club'), p_age_group),
    jsonb_build_object('tournament_id', p_tournament_id, 'tournament_application_id', v_id)
  from public.role_assignments ra
  where ra.club_id = v_host_club_id and ra.team_id is null
    and ra.role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY') and ra.state = 'ACTIVE'
    and ra.user_id <> auth.uid()
    and internal.is_account_active(ra.user_id);

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_tournament_plan(p_plan_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
declare
  v_tournament_id uuid;
  v_age_group text;
begin
  select tournament_id, age_group into v_tournament_id, v_age_group
  from public.tournament_plans where id = p_plan_id;

  if v_tournament_id is null then
    raise exception 'Tournament plan not found.' using errcode = 'P0002';
  end if;
  if not internal.can_manage_tournament(v_tournament_id) then
    raise exception 'You do not have permission to publish this tournament plan.' using errcode = '42501';
  end if;

  -- THE ONE READINESS GATE: nothing holistic existed to reuse (only per-field triggers), and "at
  -- least one game exists" is the natural minimum -- generation is what makes a plan real; publishing
  -- an empty plan would tell every participating side there is a schedule when there is none.
  if not exists (select 1 from public.tournament_games where plan_id = p_plan_id) then
    raise exception 'This plan has no games yet. Generate fixtures before publishing.' using errcode = '22023';
  end if;

  update public.tournament_plans
  set publication_state = 'PUBLISHED', published_by = auth.uid(), published_at = now(),
      updated_by = auth.uid(), updated_at = now()
  where id = p_plan_id and publication_state = 'DRAFT';

  if not found then
    raise exception 'That plan is not in draft, or no longer exists.' using errcode = '22023';
  end if;

  perform internal.notify_tournament_participants(
    v_tournament_id, v_age_group, auth.uid(),
    'tournament_schedule_published',
    'Tournament schedule published',
    format('The %s schedule for %s has been published.', v_age_group, (select name from public.tournaments where id = v_tournament_id)),
    jsonb_build_object('tournament_id', v_tournament_id, 'tournament_plan_id', p_plan_id)
  );
end;
$function$;

-- The copies already delivered: the same person, the same type, the same payload at the same instant.
-- The first is kept as it was; each later copy is dismissed (the row stays -- dismissal is soft and
-- reversible), so an inbox shows the event once.
update public.notifications n
set dismissed_at = now()
where n.dismissed_at is null
  and n.type in ('fixture_request_accepted', 'tournament_application_received')
  and exists (
    select 1 from public.notifications o
    where o.user_id = n.user_id and o.type = n.type and o.data = n.data and o.created_at = n.created_at and o.id < n.id
  );

-- UK spelling in the preferences copy a person reads (CLAUDE.md content standard): kick-off.
update public.notification_topics
set description = 'Kick-off, pitch or result changes to a fixture you are involved in.'
where key = 'fixture_updates' and description = 'Kickoff, pitch, or result changes to a fixture you are involved in.';
