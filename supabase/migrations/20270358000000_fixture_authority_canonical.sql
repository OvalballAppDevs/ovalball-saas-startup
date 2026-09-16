-- Slice 4C (fixtures, requests, results, Planner, Import) -- part 1 of 2: move the fixture
-- authority gates onto the canonical capability decision (Phase 2 AA.3 row 4c, J.6 lines 456-474).
--
-- Expand step. These gates keep answering the same questions; they answer them from
-- internal.can with the canonical fixture keys instead of from internal.can_manage_club_fixtures,
-- internal.can_manage_team and a bare internal.is_site_admin().
--
-- What the legacy helper actually was:
--
--   can_manage_club_fixtures(club) = account active AND ( is_site_admin()                 <- blanket bypass
--                                                       OR is_club_admin(club)
--                                                       OR a club_memberships row whose
--                                                          role string = 'FIXTURE_SECRETARY' )  <- raw role
--
-- Both of those are things the canonical model does not do: a blanket Site Admin bypass, and
-- authority read from a role string rather than from a capability. The shadow comparison across
-- every persona is 6 agree / 1 mismatch, and the single mismatch is exactly that bypass:
--
--   Club Admin          legacy t  canonical t
--   Fixtures Secretary  legacy t  canonical t
--   Coach (team only)   legacy f  canonical f
--   Team Manager        legacy f  canonical f
--   club Member         legacy f  canonical f
--   stranger            legacy f  canonical f
--   Full Site Admin     legacy t  canonical f   <- INTENDED: the blanket bypass is gone
--
-- A Full Site Admin is not shut out: they hold the site master equivalent
-- site.fixtures.support, which these gates consult explicitly. Site authority becomes something
-- they are granted rather than something the helper assumes.
--
-- The §11 invariant is preserved and is now canonical rather than incidental: fixture.planner.use,
-- fixture.import.run and fixture.fixture.bulk_edit are granted to CA and FS at CLUB scope only, with
-- no team bundle at all, so a Coach or Team Manager cannot reach Planner, Import or bulk edit while
-- keeping their team-scoped fixture.fixture.create and fixture.result.record.

-- 1. Creating a fixture for a team -------------------------------------------------------
create or replace function internal.can_create_team_fixture(p_club_id uuid, p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.teams t
    where t.id = p_team_id
      and t.club_id = p_club_id
      and t.active
      and (
        internal.can('fixture.fixture.create', 'club', p_club_id, null, null)
        or internal.can('fixture.fixture.create', 'team', p_club_id, p_team_id, null)
        or internal.has_site_capability('site.fixtures.support')
      )
  );
$$;

comment on function internal.can_create_team_fixture(uuid, uuid) is
  'Slice 4C: creating a fixture for a team is fixture.fixture.create, answered by the canonical decision '
  'at the club or at the team, or by the site master equivalent site.fixtures.support. The former '
  'can_manage_club_fixtures conjunct, and the blanket is_site_admin inside it, are gone.';

-- 2. Bulk planning stays club authority ---------------------------------------------------
create or replace function internal.can_bulk_plan_fixtures(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Bulk planning is club administration (CA, FS) or explicit Ovalball fixture support. It is never
  -- team authority: fixture.planner.use has no team bundle, so this cannot be reached from a team
  -- role however it is called (Phase 2 J.6 line 463, and the Slice 4C invariant on mass fixture tools).
  select p_club_id is not null
    and (internal.can('fixture.planner.use', 'club', p_club_id, null, null)
         or internal.has_site_capability('site.fixtures.support'));
$$;

comment on function internal.can_bulk_plan_fixtures(uuid) is
  'Slice 4C: Planner, Mass Planner and competition-wide generation are fixture.planner.use at CLUB scope '
  'only. fixture.create never implies bulk. No team bundle holds this key.';

-- 3. Editing a fixture's details ----------------------------------------------------------
create or replace function internal.can_edit_fixture_details(p_fixture_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.fixtures f
    join public.teams t on t.id = f.owning_team_id
    where f.id = p_fixture_id
      and (
        internal.can('fixture.fixture.edit', 'team', t.club_id, f.owning_team_id, null)
        or internal.can('fixture.fixture.edit', 'club', t.club_id, null, null)
        or internal.has_site_capability('site.fixtures.support')
      )
  );
$$;

comment on function internal.can_edit_fixture_details(uuid) is
  'Slice 4C: editing a fixture is fixture.fixture.edit at the owning team or its club, or the site '
  'master equivalent. The bare is_site_admin branch is gone.';

-- 4. Recording a result --------------------------------------------------------------------
create or replace function internal.can_submit_fixture_result(p_fixture_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f record;
  v_own_club uuid;
  v_opp_club uuid;
begin
  select owning_team_id, opponent_team_id into f from public.fixtures where id = p_fixture_id;
  if not found then
    return false;
  end if;
  select club_id into v_own_club from public.teams where id = f.owning_team_id;
  if f.opponent_team_id is not null then
    select club_id into v_opp_club from public.teams where id = f.opponent_team_id;
  end if;

  -- Either side's fixture staff may record the result: the team itself, or its club.
  return internal.can('fixture.result.record', 'team', v_own_club, f.owning_team_id, null)
      or internal.can('fixture.result.record', 'club', v_own_club, null, null)
      or (f.opponent_team_id is not null and (
            internal.can('fixture.result.record', 'team', v_opp_club, f.opponent_team_id, null)
            or internal.can('fixture.result.record', 'club', v_opp_club, null, null)))
      or internal.has_site_capability('site.fixtures.support');
end;
$$;

comment on function internal.can_submit_fixture_result(uuid) is
  'Slice 4C: recording a result is fixture.result.record, for either side of the fixture, at the team '
  'or its club, or the site master equivalent.';

-- 5. Which side of a fixture may this person act for? ---------------------------------------
create or replace function internal.can_manage_fixture_side(p_anchor_team_id uuid, p_group_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.teams t
    where t.id = p_anchor_team_id
      and (internal.can('fixture.fixture.edit', 'team', t.club_id, t.id, null)
           or internal.can('fixture.fixture.edit', 'club', t.club_id, null, null))
  )
  or (p_group_id is not null and exists (
    select 1 from public.scheduling_group_members sgm
    join public.teams t on t.id = sgm.team_id
    where sgm.group_id = p_group_id
      and (internal.can('fixture.fixture.edit', 'team', t.club_id, t.id, null)
           or internal.can('fixture.fixture.edit', 'club', t.club_id, null, null))
  ))
  or internal.has_site_capability('site.fixtures.support');
$$;

comment on function internal.can_manage_fixture_side(uuid, uuid) is
  'Slice 4C: acting for one side of a fixture is fixture.fixture.edit at that side''s team or club, or '
  'through a scheduling group the team belongs to. Replaces the can_manage_team reading.';

-- 6. Who is fixture-relevant at this club? --------------------------------------------------
create or replace function internal.can_manage_club_fixtures_or_any_team(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Club fixture authority, or fixture authority at any one team of this club. The legacy form
  -- read team_permissions rows for the strings 'team_admin', 'coach', 'manager'; authority now
  -- comes from the capability those roles carry, not from the role name.
  select internal.can('fixture.fixture.edit', 'club', p_club_id, null, null)
      or exists (
        select 1 from public.teams t
        where t.club_id = p_club_id and t.active
          and internal.can('fixture.fixture.edit', 'team', p_club_id, t.id, null)
      )
      or internal.has_site_capability('site.fixtures.support');
$$;

comment on function internal.can_manage_club_fixtures_or_any_team(uuid) is
  'Slice 4C: fixture authority at this club, or at any one of its teams, read from capabilities rather '
  'than from team_permissions role strings.';

-- 7. Who may see a fixture row? ---------------------------------------------------------------
create or replace function internal.fixture_visible_row(p_owning_team_id uuid, p_opponent_team_id uuid, p_owning_group_id uuid, p_opponent_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with sides as (
    select unnest(array[p_owning_team_id, p_opponent_team_id]) as team_id
    union
    select sgm.team_id from public.scheduling_group_members sgm
    where sgm.group_id in (p_owning_group_id, p_opponent_group_id)
  ),
  side_teams as (select team_id from sides where team_id is not null)
  select
    -- Anyone holding fixture.fixture.view at either side's club or team. The Member bundle carries
    -- it at club scope, which is how a club's own fixture list stays a club-wide artefact
    -- (Phase 2 J.6 line 456: RENAME + enforce).
    exists (
      select 1 from side_teams s
      join public.teams t on t.id = s.team_id
      where internal.can('fixture.fixture.view', 'club', t.club_id, null, null)
         or internal.can('fixture.fixture.view', 'team', t.club_id, t.id, null)
    )

    -- The people it is actually about: a player on either side, or the adult responsible for one.
    -- Guardians routinely hold no club_memberships row, so without this a parent would lose their
    -- own child's fixtures. This branch is Slice 4A family authority and is unchanged.
    or exists (
      select 1 from side_teams s
      join public.player_team_memberships ptm on ptm.team_id = s.team_id and ptm.status = 'active'
      where internal.is_own_linked_player(ptm.player_id) or internal.is_active_player_guardian(ptm.player_id)
    )

    or internal.has_site_capability('site.fixtures.view');
$$;

comment on function internal.fixture_visible_row(uuid, uuid, uuid, uuid) is
  'Slice 4C: fixture visibility is fixture.fixture.view at either side''s club or team, plus the 4A '
  'family branch for the player and their guardians. The bare is_site_admin branch is replaced by the '
  'site master equivalent site.fixtures.view.';

-- 8. Which side of a fixture is the caller acting for? ----------------------------------------
create or replace function internal.caller_fixture_club_id(p_fixture_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f record;
  v_owning_club_id uuid;
  v_opponent_club_id uuid;
begin
  select owning_team_id, opponent_team_id into f from public.fixtures where id = p_fixture_id;
  select club_id into v_owning_club_id from public.teams where id = f.owning_team_id;
  if f.opponent_team_id is not null then
    select club_id into v_opponent_club_id from public.teams where id = f.opponent_team_id;
  end if;

  if internal.can('fixture.fixture.edit', 'team', v_owning_club_id, f.owning_team_id, null)
     or internal.can('fixture.fixture.edit', 'club', v_owning_club_id, null, null) then
    return v_owning_club_id;
  end if;
  if v_opponent_club_id is not null
     and (internal.can('fixture.fixture.edit', 'team', v_opponent_club_id, f.opponent_team_id, null)
          or internal.can('fixture.fixture.edit', 'club', v_opponent_club_id, null, null)) then
    return v_opponent_club_id;
  end if;
  return null;
end;
$$;

comment on function internal.caller_fixture_club_id(uuid) is
  'Slice 4C: the club whose side of this fixture the caller may act for, decided by fixture.fixture.edit '
  'at that side''s team or club.';

-- 9. Archiving and restoring a fixture ---------------------------------------------------------
--
-- INTENDED CHANGE, from Phase 2 J.6 line 460: fixture.fixture.archive is granted to CA, FS **and
-- TM**, where the legacy gate admitted only the club's CA/FS. A Team Manager may now archive and
-- restore their own team's fixture. This is a deliberate widening written in the contract, not a
-- side effect of the migration, and the 4C matrix asserts it explicitly so it can never become an
-- accident. Deleting a fixture outright remains separate and narrower (J.6 line 461,
-- fixture.fixture.delete: CA and FS, drafts with no result, at R).

create or replace function public.archive_fixture(p_fixture_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.fixtures;
  v_owning_club_id uuid;
begin
  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;

  select club_id into v_owning_club_id from public.teams where id = f.owning_team_id;

  if not (internal.can('fixture.fixture.archive', 'team', v_owning_club_id, f.owning_team_id, null)
          or internal.can('fixture.fixture.archive', 'club', v_owning_club_id, null, null)
          or internal.has_site_capability('site.fixtures.support')) then
    raise exception 'You are not authorised to delete this fixture.' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to delete a fixture.';
  end if;

  if f.archived_at is not null then
    raise exception 'This fixture has already been deleted.';
  end if;

  update public.fixtures
  set archived_at = now(), archived_by = auth.uid(), archival_reason = trim(p_reason)
  where id = p_fixture_id;
end;
$$;

create or replace function public.restore_fixture(p_fixture_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.fixtures;
  v_owning_club_id uuid;
begin
  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;

  select club_id into v_owning_club_id from public.teams where id = f.owning_team_id;

  if not (internal.can('fixture.fixture.archive', 'team', v_owning_club_id, f.owning_team_id, null)
          or internal.can('fixture.fixture.archive', 'club', v_owning_club_id, null, null)
          or internal.has_site_capability('site.fixtures.support')) then
    raise exception 'You are not authorised to restore this fixture.' using errcode = '42501';
  end if;

  if f.archived_at is null then
    raise exception 'This fixture is not deleted.';
  end if;

  update public.fixtures
  set archived_at = null, archived_by = null, archival_reason = null
  where id = p_fixture_id;
end;
$$;

-- 10. Editing opposition and owning team -------------------------------------------------------
-- Both asked the same question three different ways. They now ask internal.can_edit_fixture_details,
-- which is the canonical answer migrated above, so the RPC and the gate cannot drift apart.
CREATE OR REPLACE FUNCTION public.update_fixture_opposition(p_fixture_id uuid, p_opponent_team_id uuid, p_opponent_directory_id uuid, p_raw_opposition_text text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_fixture public.fixtures;
  v_before jsonb;
begin
  select * into v_fixture from public.fixtures where id = p_fixture_id for update;
  if not found then raise exception 'Fixture not found.'; end if;

  -- Slice 4C: the same question internal.can_edit_fixture_details already answers canonically,
  -- asked once rather than re-derived here from legacy helpers.
  if not internal.can_edit_fixture_details(p_fixture_id) then
    raise exception 'Not authorised to edit this fixture.' using errcode = '42501';
  end if;

  if p_raw_opposition_text is null or trim(p_raw_opposition_text) = '' then
    raise exception 'An opponent (resolved team, or a description) is required.';
  end if;

  v_before := jsonb_build_object('opponent_team_id', v_fixture.opponent_team_id, 'opponent_directory_id', v_fixture.opponent_directory_id, 'raw_opposition_text', v_fixture.raw_opposition_text);

  update public.fixtures
  set opponent_team_id = p_opponent_team_id,
      opponent_directory_id = p_opponent_directory_id,
      raw_opposition_text = trim(p_raw_opposition_text),
      updated_by = auth.uid()
  where id = p_fixture_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('fixtures', p_fixture_id, 'update', auth.uid(), v_before,
    jsonb_build_object('opponent_team_id', p_opponent_team_id, 'opponent_directory_id', p_opponent_directory_id, 'raw_opposition_text', trim(p_raw_opposition_text)));
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_fixture_owning_team(p_fixture_id uuid, p_new_owning_team_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_fixture public.fixtures;
  v_current_team public.teams;
  v_new_team public.teams;
  v_before jsonb;
begin
  select * into v_fixture from public.fixtures where id = p_fixture_id for update;
  if not found then raise exception 'Fixture not found.'; end if;

  -- Slice 4C: the same question internal.can_edit_fixture_details already answers canonically,
  -- asked once rather than re-derived here from legacy helpers.
  if not internal.can_edit_fixture_details(p_fixture_id) then
    raise exception 'Not authorised to edit this fixture.' using errcode = '42501';
  end if;

  select * into v_current_team from public.teams where id = v_fixture.owning_team_id;

  select * into v_new_team from public.teams where id = p_new_owning_team_id;
  if not found then raise exception 'That team does not exist.'; end if;
  if not v_new_team.active then raise exception 'That team is not currently active.'; end if;
  if v_new_team.club_id is distinct from v_current_team.club_id then
    raise exception 'The home team can only be changed to another active team at the same club -- reassigning a fixture to a different club is not supported as an edit.' using errcode = 'P0001';
  end if;
  if v_new_team.rugby_code is distinct from v_current_team.rugby_code then
    raise exception 'That team plays a different rugby code to this fixture.' using errcode = 'P0001';
  end if;

  v_before := jsonb_build_object('owning_team_id', v_fixture.owning_team_id);

  update public.fixtures
  set owning_team_id = p_new_owning_team_id,
      updated_by = auth.uid()
  where id = p_fixture_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('fixtures', p_fixture_id, 'update', auth.uid(), v_before, jsonb_build_object('owning_team_id', p_new_owning_team_id));
end;
$function$;

-- 11. Incoming requests and partner availability ------------------------------------------------
-- Responding to an incoming request is fixture.request.respond at the club being asked. Reading a
-- partner club's availability is fixture.fixture.view at the club doing the asking. Both previously
-- consulted the legacy helper and a bare is_site_admin.
CREATE OR REPLACE FUNCTION public.check_incoming_request_target(p_request_id uuid)
 RETURNS TABLE(resolution text, existing_team_id uuid, message text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_req public.fixture_requests;
  v_group public.fixture_request_groups;
begin
  select * into v_req from public.fixture_requests where id = p_request_id;
  if not found then raise exception 'Fixture request not found.'; end if;
  select * into v_group from public.fixture_request_groups where id = v_req.group_id;
  -- Slice 4C: responding to an incoming request is fixture.request.respond at the club being asked.
  if not ((v_group.opponent_club_id is not null
           and internal.can('fixture.request.respond', 'club', v_group.opponent_club_id, null, null))
          or internal.has_site_capability('site.fixtures.support')) then
    raise exception 'Not authorized to review this fixture request.' using errcode = '42501';
  end if;
  return query select * from internal.resolve_incoming_request_target(p_request_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_partner_team_availability(p_team_id uuid, p_from date, p_to date)
 RETURNS TABLE(fixture_date date, availability text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_partner_club_id uuid;
  v_caller_club_id uuid;
begin
  select club_id into v_partner_club_id from public.teams where id = p_team_id;
  if v_partner_club_id is null then
    raise exception 'Team not found.';
  end if;

  if not exists (
    select 1 from public.club_partnerships cp
    where cp.status = 'active'
      -- Slice 4C: reading a partner club's availability is fixture.fixture.view at the club doing the asking.
      and ((cp.requesting_club_id = v_partner_club_id and internal.can('fixture.fixture.view', 'club', cp.partner_club_id, null, null))
        or (cp.partner_club_id = v_partner_club_id and internal.can('fixture.fixture.view', 'club', cp.requesting_club_id, null, null)))
  ) and not internal.has_site_capability('site.fixtures.view') then
    raise exception 'No active calendar-sharing agreement with this club.' using errcode = '42501';
  end if;

  return query
  select f.kickoff_date, 'unavailable'::text
  from public.fixtures f
  where f.owning_team_id = p_team_id
    and f.kickoff_date between p_from and p_to
    and f.status not in ('Cancelled');
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_scheduling_group_availability(p_group_id uuid, p_from date, p_to date)
 RETURNS TABLE(fixture_date date, availability text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
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
      -- Slice 4C: reading a partner club's availability is fixture.fixture.view at the club doing the asking.
      and ((cp.requesting_club_id = v_partner_club_id and internal.can('fixture.fixture.view', 'club', cp.partner_club_id, null, null))
        or (cp.partner_club_id = v_partner_club_id and internal.can('fixture.fixture.view', 'club', cp.requesting_club_id, null, null)))
  ) and not internal.has_site_capability('site.fixtures.view') then
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

-- 12. Responding to a request, and which fields a fixture exposes as editable ---------------------
-- J.6 line 466 grants fixture.request.respond to CA, FS and TM: a Coach may raise a fixture request
-- but not answer one. fixture_editable_fields reports what the UI may offer, and must ask the same
-- question the write path refuses with, so the two cannot disagree.
CREATE OR REPLACE FUNCTION public.accept_fixture_request(p_request_id uuid, p_target_team_id uuid DEFAULT NULL::uuid)
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
begin
  select * into v_req from public.fixture_requests where id = p_request_id for update;
  if not found then
    raise exception 'You are not authorised to respond to this fixture request.' using errcode = '42501';
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
  if v_req.status <> 'sent' then raise exception 'Request is not awaiting a response (current status: %).', v_req.status; end if;

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

CREATE OR REPLACE FUNCTION public.fixture_editable_fields(p_fixture_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f public.fixtures;
  v_owning_club uuid;
  v_schedule boolean;
  v_owning_side boolean;
  v_competition_name text;
  v_cancelled boolean;
  v_locked text;
begin
  select * into f from public.fixtures where id = p_fixture_id;
  if not found then
    return null;
  end if;
  select club_id into v_owning_club from public.teams where id = f.owning_team_id;
  v_cancelled := f.status = 'Cancelled';
  v_schedule := internal.can_submit_fixture_result(f.id) or internal.is_site_admin();
  v_owning_side := internal.can_edit_fixture_details(f.id);

  select c.name into v_competition_name
  from public.competition_match_fixtures l
  join public.competition_matches m on m.id = l.match_id
  join public.competition_editions e on e.id = m.edition_id
  join public.competitions c on c.id = e.competition_id
  where l.fixture_id = f.id;
  v_locked := case when v_competition_name is not null then format('Set by the competition "%s". Ask the organiser to change it.', v_competition_name) end;

  return jsonb_build_object(
    'schedule', jsonb_build_object('editable', v_schedule and not v_cancelled and v_locked is null,
      'reason', case when not v_schedule then 'Only the two clubs'' fixture staff can change the date and kick-off.' when v_cancelled then 'This fixture is cancelled.' else v_locked end),
    'meetTime', jsonb_build_object('editable', v_schedule and not v_cancelled,
      'reason', case when not v_schedule then 'Only the two clubs'' fixture staff can change the meet time.' when v_cancelled then 'This fixture is cancelled.' end),
    -- Away with no Ovalball home team: the ground is recorded by name, by the owning club.
    'venue', jsonb_build_object('editable', not v_cancelled and ((v_schedule and f.home_team_id is not null) or (v_owning_side and f.home_away = 'Away' and f.home_team_id is null)),
      'reason', case when v_cancelled then 'This fixture is cancelled.'
        when f.home_team_id is null and f.home_away = 'Away' and not v_owning_side then 'Only the owning club records the other club''s ground.'
        when f.home_team_id is null and f.home_away <> 'Away' then 'Choose Home or Away first -- the venue belongs to the home club.'
        when not v_schedule then 'Only the two clubs'' fixture staff can change the venue.' end),
    'competition', jsonb_build_object('editable', (internal.can('fixture.fixture.edit', 'club', v_owning_club, null, null) or internal.has_site_capability('site.fixtures.support')) and v_locked is null,
      'reason', case when not (internal.can('fixture.fixture.edit', 'club', v_owning_club, null, null) or internal.has_site_capability('site.fixtures.support')) then 'Only the club''s fixture administrators can set the competition.' else v_locked end),
    'opposition', jsonb_build_object('editable', v_owning_side and not v_cancelled and v_locked is null,
      'reason', case when not v_owning_side then 'Only the owning club can change the opposition.' when v_cancelled then 'This fixture is cancelled.' else v_locked end),
    'ourTeam', jsonb_build_object('editable', v_owning_side and not v_cancelled and v_locked is null,
      'reason', case when not v_owning_side then 'Only the owning club can change its team.' when v_cancelled then 'This fixture is cancelled.' else v_locked end),
    'homeAway', jsonb_build_object('editable', v_owning_side and not v_cancelled and v_locked is null,
      'reason', case when not v_owning_side then 'Only the owning club can change Home or Away.' when v_cancelled then 'This fixture is cancelled.' else v_locked end),
    -- The result: the same rule submit_fixture_result enforces.
    'result', jsonb_build_object('editable', internal.can_submit_fixture_result(f.id) and internal.fixture_result_eligible(f.id),
      'reason', case when not internal.can_submit_fixture_result(f.id) then 'Only the two clubs'' fixture staff can record the result.'
        when v_cancelled then 'A cancelled fixture has no result.'
        when not internal.fixture_result_eligible(f.id) then 'The result can be recorded once the match has kicked off.' end),
    'details', jsonb_build_object('editable', v_owning_side,
      'reason', case when not v_owning_side then 'Only the owning club can change the fixture type, status and notes.' end),
    'competitionName', v_competition_name
  );
end;
$function$;

-- 13. The last bare is_site_admin in the 4C surface ------------------------------------------------
CREATE OR REPLACE FUNCTION public.fixture_editable_fields(p_fixture_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  f public.fixtures;
  v_owning_club uuid;
  v_schedule boolean;
  v_owning_side boolean;
  v_competition_name text;
  v_cancelled boolean;
  v_locked text;
begin
  select * into f from public.fixtures where id = p_fixture_id;
  if not found then
    return null;
  end if;
  select club_id into v_owning_club from public.teams where id = f.owning_team_id;
  v_cancelled := f.status = 'Cancelled';
  v_schedule := internal.can_submit_fixture_result(f.id)
                or internal.has_site_capability('site.fixtures.support');
  v_owning_side := internal.can_edit_fixture_details(f.id);

  select c.name into v_competition_name
  from public.competition_match_fixtures l
  join public.competition_matches m on m.id = l.match_id
  join public.competition_editions e on e.id = m.edition_id
  join public.competitions c on c.id = e.competition_id
  where l.fixture_id = f.id;
  v_locked := case when v_competition_name is not null then format('Set by the competition "%s". Ask the organiser to change it.', v_competition_name) end;

  return jsonb_build_object(
    'schedule', jsonb_build_object('editable', v_schedule and not v_cancelled and v_locked is null,
      'reason', case when not v_schedule then 'Only the two clubs'' fixture staff can change the date and kick-off.' when v_cancelled then 'This fixture is cancelled.' else v_locked end),
    'meetTime', jsonb_build_object('editable', v_schedule and not v_cancelled,
      'reason', case when not v_schedule then 'Only the two clubs'' fixture staff can change the meet time.' when v_cancelled then 'This fixture is cancelled.' end),
    -- Away with no Ovalball home team: the ground is recorded by name, by the owning club.
    'venue', jsonb_build_object('editable', not v_cancelled and ((v_schedule and f.home_team_id is not null) or (v_owning_side and f.home_away = 'Away' and f.home_team_id is null)),
      'reason', case when v_cancelled then 'This fixture is cancelled.'
        when f.home_team_id is null and f.home_away = 'Away' and not v_owning_side then 'Only the owning club records the other club''s ground.'
        when f.home_team_id is null and f.home_away <> 'Away' then 'Choose Home or Away first -- the venue belongs to the home club.'
        when not v_schedule then 'Only the two clubs'' fixture staff can change the venue.' end),
    'competition', jsonb_build_object('editable', (internal.can('fixture.fixture.edit', 'club', v_owning_club, null, null) or internal.has_site_capability('site.fixtures.support')) and v_locked is null,
      'reason', case when not (internal.can('fixture.fixture.edit', 'club', v_owning_club, null, null) or internal.has_site_capability('site.fixtures.support')) then 'Only the club''s fixture administrators can set the competition.' else v_locked end),
    'opposition', jsonb_build_object('editable', v_owning_side and not v_cancelled and v_locked is null,
      'reason', case when not v_owning_side then 'Only the owning club can change the opposition.' when v_cancelled then 'This fixture is cancelled.' else v_locked end),
    'ourTeam', jsonb_build_object('editable', v_owning_side and not v_cancelled and v_locked is null,
      'reason', case when not v_owning_side then 'Only the owning club can change its team.' when v_cancelled then 'This fixture is cancelled.' else v_locked end),
    'homeAway', jsonb_build_object('editable', v_owning_side and not v_cancelled and v_locked is null,
      'reason', case when not v_owning_side then 'Only the owning club can change Home or Away.' when v_cancelled then 'This fixture is cancelled.' else v_locked end),
    -- The result: the same rule submit_fixture_result enforces.
    'result', jsonb_build_object('editable', internal.can_submit_fixture_result(f.id) and internal.fixture_result_eligible(f.id),
      'reason', case when not internal.can_submit_fixture_result(f.id) then 'Only the two clubs'' fixture staff can record the result.'
        when v_cancelled then 'A cancelled fixture has no result.'
        when not internal.fixture_result_eligible(f.id) then 'The result can be recorded once the match has kicked off.' end),
    'details', jsonb_build_object('editable', v_owning_side,
      'reason', case when not v_owning_side then 'Only the owning club can change the fixture type, status and notes.' end),
    'competitionName', v_competition_name
  );
end;
$function$;

-- 14. Fixture visibility, evaluated once per statement rather than once per row -----------------
--
-- internal.fixture_visible_row is an RLS predicate, so it runs for every candidate row. Asking
-- internal.can inside it means one full capability resolution per side per row: at 400 fixtures that
-- is ~1600 resolutions and measured at 1652 ms against 30 ms for the gate it replaced, a 55x
-- regression with no change in meaning.
--
-- These two helpers take no arguments, so Postgres evaluates each once per statement and reuses the
-- result for every row. They answer exactly the same question -- where does this caller hold
-- fixture.fixture.view -- and the policy then does an array membership test per row instead of a
-- resolver call. Semantics are unchanged; only the number of times the decision is computed changes.

create or replace function internal.viewable_fixture_clubs()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  -- Bounded by the caller's OWN memberships, not by every club on the platform. A club-scope
  -- capability is refused at rule 1 without an ACTIVE membership for that club, so a club the
  -- caller is not a member of can never qualify and need not be resolved.
  select coalesce(array_agg(cm.club_id), '{}'::uuid[])
  from public.club_memberships cm
  where cm.user_id = auth.uid()
    and cm.state = 'ACTIVE'
    and internal.can('fixture.fixture.view', 'club', cm.club_id, null, null);
$$;

create or replace function internal.viewable_fixture_teams()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  -- Likewise bounded: a team-scope capability needs a role at that team, which needs an ACTIVE
  -- membership at its club, so only the caller's own clubs' teams can qualify.
  select coalesce(array_agg(t.id), '{}'::uuid[])
  from public.teams t
  where t.club_id in (select cm.club_id from public.club_memberships cm
                      where cm.user_id = auth.uid() and cm.state = 'ACTIVE')
    and internal.can('fixture.fixture.view', 'team', t.club_id, t.id, null);
$$;

comment on function internal.viewable_fixture_clubs() is
  'Slice 4C: the clubs where this caller holds fixture.fixture.view. Parameterless and STABLE so the '
  'canonical decision is computed once per statement instead of once per fixture row.';

create or replace function internal.fixture_visible_row(p_owning_team_id uuid, p_opponent_team_id uuid, p_owning_group_id uuid, p_opponent_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with sides as (
    select unnest(array[p_owning_team_id, p_opponent_team_id]) as team_id
    union
    select sgm.team_id from public.scheduling_group_members sgm
    where sgm.group_id in (p_owning_group_id, p_opponent_group_id)
  ),
  side_teams as (select team_id from sides where team_id is not null)
  select
    exists (
      select 1 from side_teams s
      join public.teams t on t.id = s.team_id
      -- Wrapped as uncorrelated scalar subqueries so Postgres evaluates each ONCE as an InitPlan
      -- rather than per candidate row. Calling the function directly here is re-evaluated per row,
      -- which is what produced the 55x regression this replaces.
      where t.club_id in (select unnest(internal.viewable_fixture_clubs()))
         or t.id in (select unnest(internal.viewable_fixture_teams()))
    )
    or exists (
      select 1 from side_teams s
      join public.player_team_memberships ptm on ptm.team_id = s.team_id and ptm.status = 'active'
      where internal.is_own_linked_player(ptm.player_id) or internal.is_active_player_guardian(ptm.player_id)
    )
    or internal.has_site_capability('site.fixtures.view');
$$;

-- 15. The fixture SELECT policy, written so the canonical decision hoists ------------------------
--
-- internal.fixture_visible_row is SECURITY DEFINER, so Postgres cannot inline it. Whatever it
-- contains is therefore re-evaluated for every candidate row, and no amount of restructuring inside
-- it will hoist. Measured at 400 fixtures: 1652 ms with the resolver called per row, 613 ms with the
-- sets computed inside the function, against 30 ms for the gate this replaces.
--
-- The fix is to put the hoistable part in the POLICY, where the planner can see it. The two set
-- helpers are uncorrelated, so each becomes a single InitPlan evaluated once per statement, and the
-- per-row work becomes an index-friendly membership test. The family branch stays inside the
-- SECURITY DEFINER helper, because it genuinely depends on the row.
--
-- Semantics are identical: the same capability, the same scopes, the same family branch.

create or replace function internal.fixture_family_visible_row(p_owning_team_id uuid, p_opponent_team_id uuid, p_owning_group_id uuid, p_opponent_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- The people the fixture is actually about: a player on either side, or the adult responsible for
  -- one. Guardians routinely hold no club_memberships row, so without this a parent would lose their
  -- own child's fixtures. Slice 4A family authority, unchanged.
  select exists (
    select 1
    from (
      select unnest(array[p_owning_team_id, p_opponent_team_id]) as team_id
      union
      select sgm.team_id from public.scheduling_group_members sgm
      where sgm.group_id in (p_owning_group_id, p_opponent_group_id)
    ) s
    join public.player_team_memberships ptm on ptm.team_id = s.team_id and ptm.status = 'active'
    where s.team_id is not null
      and (internal.is_own_linked_player(ptm.player_id) or internal.is_active_player_guardian(ptm.player_id))
  );
$$;

drop policy if exists fixtures_select_related on public.fixtures;
create policy fixtures_select_related on public.fixtures
for select
using (
  -- Hoisted: computed once per statement, not once per fixture.
  owning_team_id in (select unnest(internal.viewable_fixture_teams()))
  or opponent_team_id in (select unnest(internal.viewable_fixture_teams()))
  or owning_team_id in (select t.id from public.teams t where t.club_id in (select unnest(internal.viewable_fixture_clubs())))
  or opponent_team_id in (select t.id from public.teams t where t.club_id in (select unnest(internal.viewable_fixture_clubs())))
  or owning_scheduling_group_id in (
       select sgm.group_id from public.scheduling_group_members sgm
       where sgm.team_id in (select unnest(internal.viewable_fixture_teams()))
          or sgm.team_id in (select t.id from public.teams t where t.club_id in (select unnest(internal.viewable_fixture_clubs()))))
  or opponent_scheduling_group_id in (
       select sgm.group_id from public.scheduling_group_members sgm
       where sgm.team_id in (select unnest(internal.viewable_fixture_teams()))
          or sgm.team_id in (select t.id from public.teams t where t.club_id in (select unnest(internal.viewable_fixture_clubs()))))
  -- Row-dependent, so it stays in a function.
  or internal.fixture_family_visible_row(owning_team_id, opponent_team_id, owning_scheduling_group_id, opponent_scheduling_group_id)
  or internal.has_site_capability('site.fixtures.view')
);

comment on policy fixtures_select_related on public.fixtures is
  'Slice 4C: the capability sets are computed once per statement as InitPlans and tested per row, '
  'rather than resolving the canonical decision for every fixture. Same capability, same scopes, '
  'same Slice 4A family branch.';

-- The two set helpers are now called from the POLICY, which runs as the caller rather than as the
-- definer, so the browser role needs EXECUTE on them. They are SECURITY DEFINER and take no
-- arguments: each returns only the caller's OWN viewable sets, and reveals nothing about anyone else.
grant execute on function internal.viewable_fixture_clubs() to authenticated;
grant execute on function internal.viewable_fixture_teams() to authenticated;
grant execute on function internal.fixture_family_visible_row(uuid, uuid, uuid, uuid) to authenticated;

-- 16. Retire the superseded visibility helper -------------------------------------------------
-- The policy above now asks the hoistable set helpers plus internal.fixture_family_visible_row
-- directly, so internal.fixture_visible_row has no remaining caller: no policy, no function, no
-- application code. Leaving it would duplicate the Slice 4A family-helper references it still
-- contains -- which is exactly what the retirement ledger flagged -- and would leave a second,
-- slower answer to a question that now has one. A zero-caller authority helper is a hazard: the
-- next person to need fixture visibility could find it before they find the policy.
drop function if exists internal.fixture_visible_row(uuid, uuid, uuid, uuid);
