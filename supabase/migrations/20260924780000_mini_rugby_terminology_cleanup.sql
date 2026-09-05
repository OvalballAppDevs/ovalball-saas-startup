-- Remove obsolete 'Shared Calendar' user-facing terminology (Section 3/4
-- of the Mini-Rugby brief) from the live SQL functions that raise it as
-- real exception text a Club Admin or Fixture Secretary can see. Pure
-- wording changes only -- every WHERE clause, join, and validation rule
-- below is byte-for-byte identical to each function's current live
-- definition (pulled directly from pg_get_functiondef on the running
-- local DB), so this migration changes zero behaviour.

CREATE OR REPLACE FUNCTION public.accept_fixture_request(p_request_id uuid, p_target_team_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req public.fixture_requests;
  v_group public.fixture_request_groups;
  v_target_team_id uuid;
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
      raise exception 'This Mini-Rugby Group has no member teams to book against.';
    end if;
  end if;

  if v_req.target_team_id is null and v_req.target_scheduling_group_id is not null then
    if p_target_team_id is not null then
      if not exists (select 1 from public.scheduling_group_members where group_id = v_req.target_scheduling_group_id and team_id = p_target_team_id) then
        raise exception 'That team is not a member of this Mini-Rugby Group.';
      end if;
      if not internal.teams_can_play_fixture(v_requesting_team_id, p_target_team_id) then
        raise exception 'That team is not age-eligible against your requesting team.';
      end if;
      v_target_team_id := p_target_team_id;
    else
      select count(*), (array_agg(sgm.team_id))[1] into v_eligible_member_count, v_auto_resolved_team_id
      from public.scheduling_group_members sgm
      where sgm.group_id = v_req.target_scheduling_group_id
        and internal.teams_can_play_fixture(v_requesting_team_id, sgm.team_id);

      if v_eligible_member_count = 0 then
        raise exception 'No team in this Mini-Rugby Group is age-eligible against the requesting team.';
      elsif v_eligible_member_count = 1 then
        v_target_team_id := v_auto_resolved_team_id;
      else
        raise exception 'More than one team in this Mini-Rugby Group is eligible -- select the real team before accepting.' using errcode = 'P0001';
      end if;
    end if;
  else
    v_target_team_id := coalesce(v_req.target_team_id, p_target_team_id);
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

  -- The requester's proposed pitch/venue only ever applies when THEY end
  -- up Home -- neither has any meaning for an Away or TBD fixture.
  v_pitch_id := case when v_requesting_club_venue = 'Home' then v_req.pitch_id else null end;
  v_venue_id := case when v_requesting_club_venue = 'Home' then v_req.venue_id else null end;

  insert into public.fixtures (
    owning_team_id, owning_scheduling_group_id, kickoff_date, kickoff_time, home_away, status,
    raw_opposition_text, opponent_directory_id, opponent_team_id,
    game_type, competition_edition_id, pitch_id, venue_id,
    created_by, updated_by
  )
  values (
    v_requesting_team_id, v_req.requesting_scheduling_group_id, v_group.proposed_date, v_req.preferred_kickoff_time,
    v_requesting_club_venue, 'Booked',
    v_group.raw_opponent_text, v_group.opponent_directory_id, v_target_team_id,
    v_group.game_type, v_group.competition_edition_id, v_pitch_id, v_venue_id,
    v_req.created_by, auth.uid()
  )
  returning id into v_fixture_id;

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

CREATE OR REPLACE FUNCTION public.set_scheduling_group_active(p_group_id uuid, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.scheduling_groups where id = p_group_id;
  if v_club_id is null then
    raise exception 'Mini-Rugby Group not found.';
  end if;
  if not internal.can_manage_club_fixtures(v_club_id) then
    raise exception 'Not authorized to manage this club''s Mini-Rugby Groups.' using errcode = '42501';
  end if;

  update public.scheduling_groups set active = p_active, updated_by = auth.uid() where id = p_group_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_scheduling_group_availability(p_group_id uuid, p_from date, p_to date)
 RETURNS TABLE(fixture_date date, availability text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner_club_id uuid;
  v_member_count integer;
begin
  select club_id into v_partner_club_id from public.scheduling_groups where id = p_group_id and active;
  if v_partner_club_id is null then
    raise exception 'Mini-Rugby Group not found.';
  end if;

  if not exists (
    select 1 from public.club_partnerships cp
    where cp.status = 'active'
      and ((cp.requesting_club_id = v_partner_club_id and internal.can_manage_club_fixtures(cp.partner_club_id))
        or (cp.partner_club_id = v_partner_club_id and internal.can_manage_club_fixtures(cp.requesting_club_id)))
  ) and not internal.is_site_admin() then
    raise exception 'No active calendar-sharing agreement with this club.' using errcode = '42501';
  end if;

  select count(*) into v_member_count from public.scheduling_group_members where group_id = p_group_id;

  return query
  select f.kickoff_date, 'unavailable'::text
  from public.fixtures f
  join public.scheduling_group_members sgm on sgm.team_id = f.owning_team_id and sgm.group_id = p_group_id
  where f.kickoff_date between p_from and p_to
    and f.status not in ('Cancelled')
  group by f.kickoff_date
  having count(distinct f.owning_team_id) >= v_member_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.request_fixture_restoration(p_fixture_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f public.fixtures;
  t public.teams;
  v_is_external boolean;
  v_conflict_count integer;
  v_group_id uuid;
  v_new_request_group_id uuid;
  v_new_request_id uuid;
begin
  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;
  select * into t from public.teams where id = f.owning_team_id;
  if not (internal.is_club_admin(t.club_id) or internal.is_full_site_admin()) then
    raise exception 'Only this club''s Club Admin or a Full Site Admin may request fixture restoration.' using errcode = '42501';
  end if;
  if not t.active then
    raise exception 'Reactivate the team before restoring its fixtures.';
  end if;
  if not f.cancelled_due_to_fold then
    raise exception 'This fixture was not cancelled by a team fold.';
  end if;
  if f.restoration_requested_at is not null then
    raise exception 'Restoration has already been requested for this fixture.';
  end if;

  -- Conflict check: the owning team's own calendar.
  select count(*) into v_conflict_count
  from public.fixtures
  where owning_team_id = f.owning_team_id and kickoff_date = f.kickoff_date and status <> 'Cancelled' and id <> f.id;
  if v_conflict_count > 0 then
    raise exception 'This team already has another fixture on %s -- restoring would double-book it. Resolve the conflict first.', f.kickoff_date;
  end if;

  -- Shared-team capacity: any group this team belongs to.
  for v_group_id in
    select sg.id from public.scheduling_groups sg
    join public.scheduling_group_members sgm on sgm.group_id = sg.id and sgm.team_id = f.owning_team_id
    where sg.active
  loop
    select count(*) into v_conflict_count
    from public.fixtures f2
    where f2.kickoff_date = f.kickoff_date and f2.status <> 'Cancelled' and f2.id <> f.id
      and (f2.owning_scheduling_group_id = v_group_id
           or exists (select 1 from public.scheduling_group_members sgm2 where sgm2.group_id = v_group_id and sgm2.team_id = f2.owning_team_id));
    if v_conflict_count > 0 then
      raise exception 'This team''s Mini-Rugby Group already has a commitment on %s -- restoring would double-book it. Resolve the conflict first.', f.kickoff_date;
    end if;
  end loop;

  v_is_external := f.opponent_team_id is null
    or not exists (select 1 from public.teams t2 join public.clubs c on c.id = t2.club_id where t2.id = f.opponent_team_id and c.status = 'active');

  update public.fixtures set restoration_requested_at = now(), restoration_requested_by = auth.uid() where id = p_fixture_id;

  if v_is_external then
    update public.fixtures set status = 'Booked', cancelled_at = null, cancellation_reason = null, cancelled_due_to_fold = false where id = p_fixture_id;
    return p_fixture_id;
  end if;

  -- A real, activated opponent -- a fresh, reviewable request, never a
  -- silent reinstatement into their calendar.
  insert into public.fixture_request_groups (requesting_club_id, raw_opponent_text, opponent_directory_id, opponent_club_id, proposed_date, notes, created_by)
  values (t.club_id, f.raw_opposition_text, f.opponent_directory_id, (select club_id from public.teams where id = f.opponent_team_id), f.kickoff_date,
    'Restoration request -- this fixture was previously cancelled when the owning team folded and has since been reactivated.', auth.uid())
  returning id into v_new_request_group_id;

  insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, status, created_by)
  values (v_new_request_group_id, f.owning_team_id, f.opponent_team_id, case f.home_away when 'Home' then 'home' when 'Away' then 'away' else 'either' end, 'sent', auth.uid())
  returning id into v_new_request_id;

  return v_new_request_id;
end;
$function$;
