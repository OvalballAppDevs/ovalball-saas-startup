-- =====================================================================
-- AN OVALBALL OPPONENT CONFIRMS THEIR OWN TEAM
--
-- A fixture recorded against an Ovalball CLUB -- before it joined, from an
-- import, or chosen in the fixture editor -- has no opposition team, and the
-- owning club cannot simply name one: binding another club's team puts a
-- fixture in that club's calendar and its parents' agendas without anybody
-- there agreeing. The platform rule is that an Ovalball opponent is ASKED.
--
-- So the fixture editor ASKS: public.ask_opponent_to_confirm_team sends that
-- club an ordinary fixture request for the team, carrying the fixture it is
-- about (fixture_requests.existing_fixture_id). The club answers where it
-- answers every request. Accepting completes the existing fixture -- its
-- opponent team is set by the club that owns the team -- and never creates
-- a second fixture. Declining leaves the fixture exactly as it was.
-- =====================================================================

alter table public.fixture_requests
  add column if not exists existing_fixture_id uuid references public.fixtures(id) on delete cascade;

comment on column public.fixture_requests.existing_fixture_id is
  'Set when the request asks the opposition to confirm their team for a fixture that already exists. Accepting completes that fixture instead of inserting one.';

-- One open question per fixture.
create unique index if not exists fixture_requests_one_open_per_existing_fixture
  on public.fixture_requests (existing_fixture_id) where existing_fixture_id is not null and status = 'sent';

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
      game_type, competition_edition_id, pitch_id, venue_id,
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
      v_group.game_type, v_group.competition_edition_id, v_pitch_id, v_venue_id,
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


create or replace function public.ask_opponent_to_confirm_team(p_fixture_id uuid, p_target_team_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  f public.fixtures;
  v_owning_club uuid;
  v_target public.teams;
  v_target_club public.clubs;
  v_group uuid;
  v_request uuid;
  v_side text;
begin
  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;
  if not internal.can_edit_fixture_details(f.id) then
    raise exception 'Only the owning club can ask the opposition to confirm their team.' using errcode = '42501';
  end if;
  if f.status = 'Cancelled' then
    raise exception 'This fixture is cancelled.' using errcode = '23514';
  end if;
  if f.opponent_team_id is not null then
    raise exception 'This fixture already has an opposition team.' using errcode = '23514';
  end if;

  select * into v_target from public.teams where id = p_target_team_id and active;
  if not found then
    raise exception 'That team is not an active team.' using errcode = '23514';
  end if;
  select * into v_target_club from public.clubs where id = v_target.club_id and status = 'active';
  select club_id into v_owning_club from public.teams where id = f.owning_team_id;
  if v_target_club.id is null or v_target_club.id = v_owning_club then
    raise exception 'Choose a team at the opposition club.' using errcode = '23514';
  end if;
  if f.opponent_directory_id is distinct from v_target_club.directory_id then
    raise exception 'That team is not at this fixture''s opposition club. Choose the club first.' using errcode = '23514';
  end if;
  if not internal.teams_can_play_fixture(f.owning_team_id, v_target.id) then
    raise exception 'That team is not eligible to play this fixture.' using errcode = '23514';
  end if;
  if exists (select 1 from public.fixture_requests r where r.existing_fixture_id = f.id and r.status = 'sent') then
    raise exception 'The opposition has already been asked to confirm their team for this fixture.' using errcode = '23505';
  end if;

  v_side := case f.home_away when 'Home' then 'home' when 'Away' then 'away' else 'either' end;

  insert into public.fixture_request_groups (
    requesting_club_id, raw_opponent_text, opponent_directory_id, opponent_club_id,
    proposed_date, notes, game_type, competition_edition_id, created_by
  )
  values (
    v_owning_club, f.raw_opposition_text, f.opponent_directory_id, v_target_club.id,
    f.kickoff_date, f.notes, f.game_type, f.competition_edition_id, auth.uid()
  )
  returning id into v_group;

  insert into public.fixture_requests (
    group_id, requesting_team_id, target_team_id, venue_preference, preferred_kickoff_time,
    pitch_id, venue_id, status, existing_fixture_id, created_by
  )
  values (
    v_group, f.owning_team_id, v_target.id, v_side, f.kickoff_time,
    case when v_side = 'home' then f.pitch_id end,
    case when v_side = 'home' then f.venue_id end,
    'sent', f.id, auth.uid()
  )
  returning id into v_request;

  return v_request;
end;
$function$;

revoke execute on function public.ask_opponent_to_confirm_team(uuid, uuid) from public;
revoke execute on function public.ask_opponent_to_confirm_team(uuid, uuid) from anon;
grant  execute on function public.ask_opponent_to_confirm_team(uuid, uuid) to authenticated, service_role;
