-- Phase D (partnership half): when a fixture request between two ACTIVE
-- Ovalball clubs is accepted, and the two clubs are not already
-- partners (and there is no existing pending request between them),
-- automatically create exactly ONE Partnership Request. Never
-- auto-accepted -- club_partnerships already starts every row at
-- status='pending', and only respond_to_club_partnership ever moves it
-- to 'active'. The fixture itself is entirely unaffected by whatever
-- happens to that partnership afterward (accept_fixture_request never
-- touches club_partnerships.status, and respond_to_club_partnership
-- never touches fixtures) -- this migration only makes the DECLINE
-- notification say so explicitly when the partnership traces back to a
-- fixture, so the message is a fixture is confirmed, its accompanying
-- reassurance, not something the person has to infer.

alter table public.club_partnerships
  add column source_fixture_id uuid references public.fixtures(id);

comment on column public.club_partnerships.source_fixture_id is
  'Set only when this partnership request was created automatically by accept_fixture_request -- never set for a partnership a Club Admin requested directly through Partner Clubs. Purely informational (which fixture triggered it); a declined auto-partnership never touches the fixture itself.';

-- ============================================================
-- respond_to_club_partnership: identical authorization/state-transition
-- logic. Only the decline notification body changes, and only when this
-- specific partnership traces back to a fixture acceptance.
-- ============================================================

create or replace function public.respond_to_club_partnership(p_partnership_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p public.club_partnerships;
begin
  select * into v_p from public.club_partnerships where id = p_partnership_id for update;
  if not found then raise exception 'Partnership request not found.'; end if;
  if v_p.status <> 'pending' then raise exception 'Partnership is not pending (current status: %).', v_p.status; end if;

  if not (internal.is_site_admin() or internal.can_manage_club_fixtures(v_p.partner_club_id)) then
    raise exception 'Only the invited club may respond to this partnership request.' using errcode = '42501';
  end if;

  update public.club_partnerships
  set status = case when p_approve then 'active' else 'revoked' end,
      responded_by = auth.uid(), responded_at = now()
  where id = p_partnership_id;

  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id,
    case when p_approve then 'calendar_share_approved' else 'calendar_share_declined' end,
    case when p_approve then 'Calendar sharing agreed' else 'Calendar sharing request declined' end,
    case
      when p_approve then 'Your partner club request has been accepted.'
      when v_p.source_fixture_id is not null then 'Partnership request declined. Your fixture remains confirmed.'
      else 'Your partner club request has been declined.'
    end,
    jsonb_build_object('partnership_id', p_partnership_id, 'source_fixture_id', v_p.source_fixture_id)
  from public.club_memberships cm
  where cm.club_id = v_p.requesting_club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');

  -- The responding side (who accepted the fixture and is now declining the
  -- partnership) gets the same reassurance -- they made the decision, but
  -- should see the same confirmation their fixture is unaffected.
  if not p_approve and v_p.source_fixture_id is not null then
    insert into public.notifications (user_id, type, title, body, data)
    select cm.user_id, 'calendar_share_declined', 'Partnership request declined',
      'Partnership request declined. Your fixture remains confirmed.',
      jsonb_build_object('partnership_id', p_partnership_id, 'source_fixture_id', v_p.source_fixture_id)
    from public.club_memberships cm
    where cm.club_id = v_p.partner_club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
  end if;
end;
$$;

revoke execute on function public.respond_to_club_partnership(uuid, boolean) from public;
grant execute on function public.respond_to_club_partnership(uuid, boolean) to authenticated;

-- ============================================================
-- accept_fixture_request: re-declared with the SAME signature purely to
-- add the auto-partnership step at the very end, after the fixture(s)
-- and the request's own 'accepted' status are already fully committed.
-- Every other line unchanged from 20260903100000.
-- ============================================================

create or replace function public.accept_fixture_request(p_request_id uuid, p_target_team_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.fixture_requests;
  v_group public.fixture_request_groups;
  v_target_team_id uuid;
  v_requesting_team_id uuid;
  v_requesting_club_venue text;
  v_target_venue text;
  v_fixture_id uuid;
  v_mirror_fixture_id uuid;
  v_target_club_id uuid;
  v_eligible_member_count integer;
  v_auto_resolved_team_id uuid;
  v_conversation_id uuid;
  v_both_clubs_active boolean;
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
    else
      select count(*), (array_agg(sgm.team_id))[1] into v_eligible_member_count, v_auto_resolved_team_id
      from public.scheduling_group_members sgm
      where sgm.group_id = v_req.target_scheduling_group_id
        and internal.teams_can_play_fixture(v_requesting_team_id, sgm.team_id);

      if v_eligible_member_count = 0 then
        raise exception 'No team in this shared calendar is age-eligible against the requesting team.';
      elsif v_eligible_member_count = 1 then
        v_target_team_id := v_auto_resolved_team_id;
      else
        raise exception 'More than one team in this shared calendar is eligible -- select the real team before accepting.' using errcode = 'P0001';
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

  v_conversation_id := gen_random_uuid();

  insert into public.fixtures (
    owning_team_id, owning_scheduling_group_id, kickoff_date, kickoff_time, home_away, status,
    raw_opposition_text, opponent_directory_id, opponent_team_id,
    created_by, updated_by, conversation_id
  )
  values (
    v_requesting_team_id, v_req.requesting_scheduling_group_id, v_group.proposed_date, v_req.preferred_kickoff_time,
    v_requesting_club_venue, 'Booked',
    v_group.raw_opponent_text, v_group.opponent_directory_id, v_target_team_id,
    v_req.created_by, auth.uid(), v_conversation_id
  )
  returning id into v_fixture_id;

  if v_target_team_id is not null then
    insert into public.fixtures (
      owning_team_id, owning_scheduling_group_id, kickoff_date, kickoff_time, home_away, status,
      raw_opposition_text, opponent_directory_id, opponent_team_id,
      created_by, updated_by, conversation_id
    )
    select v_target_team_id, v_req.target_scheduling_group_id, v_group.proposed_date, v_req.preferred_kickoff_time,
      v_target_venue, 'Booked',
      cd.name, cd.id, v_requesting_team_id,
      auth.uid(), auth.uid(), v_conversation_id
    from public.clubs c
    join public.club_directory cd on cd.id = c.directory_id
    where c.id = v_group.requesting_club_id
    returning id into v_mirror_fixture_id;

    update public.fixtures set mirror_fixture_id = v_mirror_fixture_id where id = v_fixture_id;
    update public.fixtures set mirror_fixture_id = v_fixture_id where id = v_mirror_fixture_id;
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

  -- Phase D: automatic Partnership Request between two distinct, ACTIVE
  -- Ovalball clubs, if not already partners and no pending request
  -- exists between them. Never for an external/unresolved opponent
  -- (v_target_club_id null) or a deactivated club -- deactivated clubs
  -- already lose the authority a partnership would be acted on with.
  -- The unique-pair partial index is the real duplicate guard; the
  -- exists() check here just avoids a spurious 23505 aborting the whole
  -- fixture acceptance when it inevitably matches.
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
        null; -- a concurrent request/response won the race -- never abort the fixture acceptance over it
      end;
    end if;
  end if;

  return v_fixture_id;
end;
$$;

revoke execute on function public.accept_fixture_request(uuid, uuid) from public;
grant execute on function public.accept_fixture_request(uuid, uuid) to authenticated;
