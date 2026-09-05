-- RESUME SEASON HANDOVER Section 26: narrow, named, server-enforced
-- capabilities for the Handover/Mini-Rugby/call-up/dispensation/
-- graduation domains, replacing the broad internal.can_manage_club_fixtures
-- / internal.is_club_admin checks these RPCs used directly. Per the
-- explicit instruction to reuse an existing narrower equivalent rather
-- than duplicate one: club.season_rollover.manage (added in
-- 20260923000000_season_rollover_capability.sql, already wired at the
-- APP layer into 5 club pages) is reused as manage_season_handover --
-- no new capability row is created for it, only its RPC wiring below.
--
-- Six new capability keys are added for the remaining domains. Every
-- existing effective authorization boundary is PRESERVED (this is a
-- naming/wiring pass, not a re-permissioning pass) with one deliberate
-- exception: generate_rollover_proposal currently accepts
-- can_manage_club_fixtures (CLUB_ADMIN or FIXTURE_SECRETARY), but every
-- app page that links to Season Rollover already gates on
-- club.season_rollover.manage, which FIXTURE_SECRETARY does NOT hold --
-- so FIXTURE_SECRETARY could reach this RPC only by calling it directly,
-- bypassing the UI's own intended boundary. Routing the RPC through the
-- SAME capability the UI already checks closes that gap, exactly
-- matching Section 26's "UI hiding alone insufficient" -- the RPC now
-- enforces what the UI already implied.
insert into public.capabilities (key, label, description, category, applicable_scopes) values
  ('manage_mini_rugby_groups', 'Manage Mini-Rugby Groups', 'Create and edit shared Mini-Rugby scheduling groups for this club.', 'team', array['club']),
  ('manage_fixture_callups', 'Request fixture call-ups', 'Request a player call-up onto a team for a specific fixture.', 'fixture', array['club', 'team']),
  ('approve_fixture_callups', 'Approve fixture call-ups', 'Approve, reject, or revoke a call-up as the source team lending the player.', 'fixture', array['club', 'team']),
  ('manage_player_dispensations', 'Request player dispensations', 'Request a player dispensation to move between two teams at the same club.', 'team', array['club', 'team']),
  ('approve_player_dispensations', 'Give source-team dispensation approval', 'Approve or reject a dispensation as the source team lending the player.', 'team', array['club', 'team']),
  ('place_graduating_players', 'Place graduating players', 'Place a player from the graduation queue onto a target team.', 'team', array['club', 'team'])
on conflict (key) do nothing;

create or replace function internal.has_club_role_capability(p_club_id uuid, p_capability_key text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when not internal.is_club_active(p_club_id) then false
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and cm.role = 'CLUB_ADMIN'
    ) then p_capability_key in (
      'club.edit_profile', 'club.logo.manage', 'club.venues.manage', 'club.pitches.manage',
      'club.teams.manage', 'club.team_lifecycle.manage', 'club.roster.manage', 'club.season_rollover.manage',
      'people.manage', 'people.view', 'club.view', 'team.view',
      'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.manage_requests', 'fixture.view',
      'calendar.manage', 'calendar.view', 'partner.manage', 'messages.fixture_send',
      'manage_mini_rugby_groups', 'manage_fixture_callups', 'approve_fixture_callups',
      'manage_player_dispensations', 'approve_player_dispensations', 'place_graduating_players'
    )
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and cm.role = 'FIXTURE_SECRETARY'
    ) then p_capability_key in (
      'club.pitches.manage', 'people.view', 'club.view', 'team.view',
      'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.manage_requests', 'fixture.view',
      'calendar.manage', 'calendar.view', 'partner.manage', 'messages.fixture_send',
      'manage_mini_rugby_groups', 'manage_fixture_callups', 'approve_fixture_callups',
      'manage_player_dispensations', 'approve_player_dispensations', 'place_graduating_players'
    )
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false
    ) then p_capability_key in ('club.view', 'team.view', 'people.view', 'calendar.view', 'fixture.view')
    else false
  end;
$$;

-- The three new keys added here (manage_fixture_callups,
-- approve_fixture_callups, place_graduating_players) preserve exactly
-- the authority internal.can_manage_team() already granted this same
-- role tier -- they are not a new grant of team-management authority,
-- only a name for authority these roles already held. This does not
-- revisit the standing decision (see the comment below) that this tier
-- gets no NEW club.teams.manage/club.team_lifecycle.manage/
-- club.roster.manage/team.roster.manage capability.
create or replace function internal.has_team_role_capability(p_team_id uuid, p_club_id uuid, p_capability_key text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when not internal.is_club_active(p_club_id) then false
    when internal.is_club_admin(p_club_id) then p_capability_key in (
      'club.teams.manage', 'club.team_lifecycle.manage', 'club.roster.manage', 'team.roster.manage',
      'team.view', 'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.view', 'calendar.view', 'messages.fixture_send',
      'manage_fixture_callups', 'approve_fixture_callups', 'place_graduating_players'
    )
    when exists (
      select 1 from public.team_permissions tp join public.club_memberships cm on cm.id = tp.membership_id
      where tp.team_id = p_team_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false
        and tp.permission in ('team_admin', 'coach', 'manager')
    ) then p_capability_key in (
      -- Deliberately NOT club.teams.manage / club.team_lifecycle.manage /
      -- club.roster.manage / team.roster.manage -- preserves the standing
      -- "no new Team Admin write capability granted" decision. A
      -- team_admin/coach/manager receives only their existing real
      -- authority (their own team's fixtures, and read access) plus the
      -- three call-up/placement capabilities that internal.can_manage_team()
      -- already granted this tier before this migration.
      'team.view', 'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.view', 'calendar.view', 'messages.fixture_send',
      'manage_fixture_callups', 'approve_fixture_callups', 'place_graduating_players'
    )
    when exists (
      select 1 from public.team_permissions tp join public.club_memberships cm on cm.id = tp.membership_id
      where tp.team_id = p_team_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false
    ) then p_capability_key in ('team.view', 'fixture.view', 'calendar.view')
    else false
  end;
$$;

create or replace function public.generate_rollover_proposal(p_club_id uuid, p_rugby_code text, p_to_season_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not internal.has_capability('club.season_rollover.manage', 'club', p_club_id) then
    raise exception 'Not authorized to propose a rollover for this club.' using errcode = '42501';
  end if;
  if p_rugby_code not in ('union', 'league') then
    raise exception 'rugby_code must be union or league.';
  end if;
  return internal.generate_rollover_proposal_core(p_club_id, p_rugby_code, p_to_season_id, auth.uid());
end;
$$;

create or replace function public.create_scheduling_group(p_club_id uuid, p_team_ids uuid[], p_season_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_tag text;
begin
  if not internal.has_capability('manage_mini_rugby_groups', 'club', p_club_id) then
    raise exception 'Not authorized to manage this club''s Mini-Rugby Groups.' using errcode = '42501';
  end if;
  perform internal.validate_mini_rugby_team_set(p_club_id, p_team_ids);
  perform internal.validate_scheduling_group_season(p_club_id, p_season_id);
  v_tag := internal.mini_rugby_display_tag(p_team_ids);

  insert into public.scheduling_groups (club_id, display_tag, season_id, created_by)
  values (p_club_id, v_tag, p_season_id, auth.uid())
  returning id into v_id;

  insert into public.scheduling_group_members (group_id, team_id)
  select v_id, unnest(p_team_ids);

  return v_id;
end;
$$;

create or replace function public.set_scheduling_group_members(p_group_id uuid, p_team_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_club_id uuid;
  v_tag text;
  v_fixture_count integer;
begin
  select club_id into v_club_id from public.scheduling_groups where id = p_group_id;
  if v_club_id is null then
    raise exception 'Mini-Rugby Group not found.';
  end if;
  if not internal.has_capability('manage_mini_rugby_groups', 'club', v_club_id) then
    raise exception 'Not authorized to manage this club''s Mini-Rugby Groups.' using errcode = '42501';
  end if;

  select count(*) into v_fixture_count from public.fixtures where owning_scheduling_group_id = p_group_id and status <> 'Cancelled';
  if v_fixture_count > 0 then
    raise exception 'This Mini-Rugby Group already has a fixture booked against it -- its composition is now historical and cannot change. Create a new Mini-Rugby Group instead.';
  end if;

  perform internal.validate_mini_rugby_team_set(v_club_id, p_team_ids);
  v_tag := internal.mini_rugby_display_tag(p_team_ids);

  delete from public.scheduling_group_members where group_id = p_group_id;
  insert into public.scheduling_group_members (group_id, team_id)
  select p_group_id, unnest(p_team_ids);

  update public.scheduling_groups set display_tag = v_tag, updated_by = auth.uid() where id = p_group_id;
end;
$$;

create or replace function public.set_scheduling_group_alias(p_group_id uuid, p_alias text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.scheduling_groups where id = p_group_id;
  if v_club_id is null then
    raise exception 'Mini-Rugby Group not found.';
  end if;
  if not internal.has_capability('manage_mini_rugby_groups', 'club', v_club_id) then
    raise exception 'Not authorized to manage this club''s Mini-Rugby Groups.' using errcode = '42501';
  end if;

  update public.scheduling_groups
  set alias = nullif(trim(p_alias), ''), updated_by = auth.uid()
  where id = p_group_id;
end;
$$;

create or replace function public.set_scheduling_group_active(p_group_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.scheduling_groups where id = p_group_id;
  if v_club_id is null then
    raise exception 'Mini-Rugby Group not found.';
  end if;
  if not internal.has_capability('manage_mini_rugby_groups', 'club', v_club_id) then
    raise exception 'Not authorized to manage this club''s Mini-Rugby Groups.' using errcode = '42501';
  end if;

  update public.scheduling_groups set active = p_active, updated_by = auth.uid() where id = p_group_id;
end;
$$;

create or replace function public.request_player_call_up(p_fixture_id uuid, p_player_id uuid, p_source_team_id uuid, p_target_team_id uuid, p_eligibility_rule_reference text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_target_club uuid;
begin
  select club_id into v_target_club from public.teams where id = p_target_team_id;
  if not (internal.has_capability('manage_fixture_callups', 'team', v_target_club, p_target_team_id) or internal.has_capability('manage_fixture_callups', 'club', v_target_club)) then
    raise exception 'Not authorized to request a call-up onto this team.' using errcode = '42501';
  end if;
  if coalesce(trim(p_eligibility_rule_reference), '') = '' then
    raise exception 'A call-up requires a stated eligibility rule reference (or "GOVERNING-BODY CONFIRMATION REQUIRED" if not yet verified).';
  end if;

  insert into public.fixture_player_call_up (fixture_id, player_id, source_team_id, target_team_id, eligibility_rule_reference, requested_by)
  values (p_fixture_id, p_player_id, p_source_team_id, p_target_team_id, p_eligibility_rule_reference, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.decide_player_call_up(p_call_up_id uuid, p_action text, p_reason text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c public.fixture_player_call_up;
  v_source_club uuid;
  v_kickoff_date date;
  v_conflict_count integer;
begin
  select * into c from public.fixture_player_call_up where id = p_call_up_id for update;
  if not found then
    raise exception 'Call-up not found.';
  end if;
  select club_id into v_source_club from public.teams where id = c.source_team_id;
  if not (internal.has_capability('approve_fixture_callups', 'team', v_source_club, c.source_team_id) or internal.has_capability('approve_fixture_callups', 'club', v_source_club)) then
    raise exception 'Not authorized to decide this call-up -- only the source team (the one lending the player) or that club''s fixture secretary/admin may approve or reject it.' using errcode = '42501';
  end if;
  if c.status <> 'requested' and p_action in ('approve', 'reject') then
    raise exception 'This call-up has already been decided (%).', c.status;
  end if;
  if p_action = 'revoke' and c.status <> 'approved' then
    raise exception 'Only an approved call-up can be revoked.';
  end if;

  if p_action = 'approve' then
    select kickoff_date into v_kickoff_date from public.fixtures where id = c.fixture_id;

    select count(*) into v_conflict_count
    from public.fixture_player_call_up other
    join public.fixtures f on f.id = other.fixture_id
    where other.player_id = c.player_id
      and other.id <> c.id
      and other.status = 'approved'
      and f.kickoff_date = v_kickoff_date;
    if v_conflict_count > 0 then
      raise exception 'This player already holds an approved call-up to a different fixture on %. A player may hold only one physical fixture commitment per day.', v_kickoff_date using errcode = '23514';
    end if;

    select count(*) into v_conflict_count
    from public.player_team_memberships ptm
    join public.fixtures f on f.owning_team_id = ptm.team_id or f.opponent_team_id = ptm.team_id
    where ptm.player_id = c.player_id
      and ptm.status = 'active' and ptm.ended_at is null
      and f.kickoff_date = v_kickoff_date
      and f.status <> 'Cancelled'
      and f.id <> c.fixture_id;
    if v_conflict_count > 0 then
      raise exception 'This player''s own team already has a fixture commitment on %. A player may hold only one physical fixture commitment per day.', v_kickoff_date using errcode = '23514';
    end if;

    update public.fixture_player_call_up set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_reason = p_reason where id = p_call_up_id;
  elsif p_action = 'reject' then
    update public.fixture_player_call_up set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_reason = p_reason where id = p_call_up_id;
  elsif p_action = 'revoke' then
    update public.fixture_player_call_up set status = 'revoked', decided_by = auth.uid(), decided_at = now(), decision_reason = p_reason where id = p_call_up_id;
  else
    raise exception 'Unknown call-up action: %', p_action;
  end if;
end;
$$;

create or replace function public.request_player_dispensation(p_player_id uuid, p_source_team_id uuid, p_target_team_id uuid, p_season_id uuid, p_eligibility_rule_reference text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_source_club uuid;
  v_target_club uuid;
begin
  select club_id into v_source_club from public.teams where id = p_source_team_id;
  select club_id into v_target_club from public.teams where id = p_target_team_id;
  if v_source_club is distinct from v_target_club then
    raise exception 'A dispensation can only move a player between two teams of the SAME club.' using errcode = '23514';
  end if;
  if not (internal.has_capability('manage_player_dispensations', 'team', v_target_club, p_target_team_id) or internal.has_capability('manage_player_dispensations', 'club', v_target_club)) then
    raise exception 'Not authorized to request a dispensation onto this team.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.player_team_memberships
    where player_id = p_player_id and team_id = p_source_team_id and status = 'active' and ended_at is null
  ) then
    raise exception 'This player is not an active member of the stated source team -- source_team_id cannot be forged.' using errcode = '23514';
  end if;
  if coalesce(trim(p_eligibility_rule_reference), '') = '' then
    raise exception 'A dispensation requires a stated eligibility rule reference (or "GOVERNING-BODY CONFIRMATION REQUIRED" if not yet verified).';
  end if;

  insert into public.player_team_dispensation (player_id, source_team_id, target_team_id, season_id, eligibility_rule_reference, requested_by)
  values (p_player_id, p_source_team_id, p_target_team_id, p_season_id, p_eligibility_rule_reference, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- Only the source_team stage is rewired to the new
-- approve_player_dispensations capability -- it is the stage whose
-- current check (can_manage_team/can_manage_club_fixtures) has exactly
-- the same shape as request_player_dispensation's own check, i.e. the
-- ordinary team/fixture-secretary decision this capability names. The
-- club and governing_body stages are deliberately left on their
-- existing internal.is_club_admin() check: they are already a strictly
-- narrower, CLUB_ADMIN-only gate (FIXTURE_SECRETARY cannot reach them
-- today), and folding them into approve_player_dispensations would
-- either wrongly widen them to FIXTURE_SECRETARY or require a second,
-- redundant capability key -- which Section 26 explicitly says not to
-- create.
create or replace function public.decide_player_dispensation(p_id uuid, p_stage text, p_approve boolean, p_governing_body_reference text default null::text, p_reason text default null::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d public.player_team_dispensation;
  v_source_club uuid;
begin
  select * into d from public.player_team_dispensation where id = p_id for update;
  if not found then
    raise exception 'Dispensation not found.';
  end if;
  select club_id into v_source_club from public.teams where id = d.source_team_id;

  if p_stage = 'source_team' then
    if d.status <> 'requested' then
      raise exception 'This dispensation is not awaiting source-team approval (current status: %).', d.status;
    end if;
    if not (internal.has_capability('approve_player_dispensations', 'team', v_source_club, d.source_team_id) or internal.has_capability('approve_player_dispensations', 'club', v_source_club)) then
      raise exception 'Not authorized to give source-team approval -- only the source team (the one lending the player) or that club''s fixture secretary/admin may decide this stage.' using errcode = '42501';
    end if;
    update public.player_team_dispensation
    set status = case when p_approve then 'source_team_approved' else 'rejected' end,
        source_team_decided_by = auth.uid(), source_team_decided_at = now(),
        decision_reason = case when not p_approve then p_reason else decision_reason end,
        updated_at = now()
    where id = p_id;

  elsif p_stage = 'club' then
    if d.status <> 'source_team_approved' then
      raise exception 'This dispensation is not awaiting club approval (current status: %).', d.status;
    end if;
    if not (internal.is_club_admin(v_source_club) or internal.is_site_admin()) then
      raise exception 'Not authorized to give club approval -- only this club''s Club Admin may decide this stage.' using errcode = '42501';
    end if;
    update public.player_team_dispensation
    set status = case when p_approve then 'club_approved' else 'rejected' end,
        club_decided_by = auth.uid(), club_decided_at = now(),
        decision_reason = case when not p_approve then p_reason else decision_reason end,
        updated_at = now()
    where id = p_id;

  elsif p_stage = 'governing_body' then
    if d.status <> 'club_approved' then
      raise exception 'This dispensation is not awaiting governing-body approval (current status: %).', d.status;
    end if;
    if not (internal.is_club_admin(v_source_club) or internal.is_site_admin()) then
      raise exception 'Not authorized to record governing-body approval -- only this club''s Club Admin may decide this stage.' using errcode = '42501';
    end if;
    if p_approve and coalesce(trim(p_governing_body_reference), '') = '' then
      raise exception 'Recording governing-body approval requires a reference (e.g. the dispensation certificate/case number the club holds).';
    end if;
    update public.player_team_dispensation
    set status = case when p_approve then 'approved' else 'rejected' end,
        governing_body_reference = p_governing_body_reference,
        governing_body_decided_by = auth.uid(), governing_body_decided_at = now(),
        decision_reason = case when not p_approve then p_reason else decision_reason end,
        updated_at = now()
    where id = p_id;

  else
    raise exception 'Unknown dispensation stage: %', p_stage;
  end if;
end;
$$;

create or replace function public.place_graduating_player(p_queue_id uuid, p_target_team_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  q public.player_graduation_queue;
  v_target_club_id uuid;
begin
  select * into q from public.player_graduation_queue where id = p_queue_id for update;
  if not found then
    raise exception 'Graduation queue entry not found.';
  end if;
  select club_id into v_target_club_id from public.teams where id = p_target_team_id;
  if v_target_club_id is distinct from q.club_id then
    raise exception 'A graduating player can only be placed onto a team at the same club they graduated from.' using errcode = '23514';
  end if;
  if not (internal.has_capability('place_graduating_players', 'team', q.club_id, p_target_team_id) or internal.has_capability('place_graduating_players', 'club', q.club_id)) then
    raise exception 'Not authorized to place this player.' using errcode = '42501';
  end if;
  if q.status <> 'pending_placement' then
    raise exception 'This player has already been decided (%).', q.status;
  end if;

  insert into public.player_team_memberships (player_id, team_id, status, created_by)
  values (q.player_id, p_target_team_id, 'active', auth.uid());

  update public.player_graduation_queue
  set status = 'placed', placed_team_id = p_target_team_id, placed_by = auth.uid(), placed_at = now(), updated_at = now()
  where id = p_queue_id;
end;
$$;
