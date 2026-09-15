-- Membership and role transitions.
--
-- Identity/Auth Slice 2 (Phase 2 M.1, M.2, AH R7-R9).
--
-- Until now a Club Admin changed someone's club role or removed them by
-- editing the membership row directly, and a Site Admin "reactivated" a
-- removed membership by switching its status back on. After this migration
-- every change to a membership or a role is a named transition, made by one
-- database function that checks who is asking, what state the record is in,
-- whether a reason is needed, and records a security event:
--
--   transition_club_membership   suspend, restore, remove, leave
--   decide_club_join_request     approve or decline a request to join
--   grant_club_membership        Site Admin admission (a new membership row)
--   assign_role                  give a club or team role
--   transition_role_assignment   suspend, restore or revoke one role
--   set_primary_club_role        Member / Fixtures Secretary / Club Admin
--   set_team_access              Coach / Team Manager / Team Admin on a team
--   remove_team_access           end a person's roles on a team
--   set_membership_governance_title   Chair, Secretary... (a title only)
--   change_membership_access_profile  Site Admin Club Management profile
--   list_pending_club_join_requests   the Club Admin's join-request queue
--
-- A request to join a club now opens a PENDING membership, so the request and
-- its decision are part of the membership's own history.
--
-- Rules that hold on every path:
--   * A removed, declined or expired membership never comes back; re-admission
--     is a new row.
--   * A club is never left without a Club Admin, decided under a per-club
--     advisory lock (R8). Only a Full Site Admin can override, with a reason.
--   * A Club Admin cannot lift a suspension placed by a Site Admin.
--   * Team Administration rests on an active Coach or Team Manager role for the
--     same team, and is suspended and revoked with it.
--   * Staff roles are never given to anyone under 18.
--
-- Authority until Slice 3 (documented adapters, no new bypass): club-scoped
-- people management is an ACTIVE Club Admin role at an active club held by an
-- active account; site-scoped management is a Full Site Admin. Team roles are
-- assigned by the same two, exactly as before; Team Administration holders do
-- not gain assignment authority in this slice.
--
-- The browser's direct UPDATE on club_memberships (a Phase 0 grant) is
-- removed; the application writes through these functions.

-- ---------------------------------------------------------------------
-- 1. Provenance for staff carried over at season handover
-- ---------------------------------------------------------------------

alter table public.role_assignments drop constraint role_assignments_source_check;
alter table public.role_assignments add constraint role_assignments_source_check check (source in (
  'INVITATION', 'JOIN_REQUEST', 'TEAM_CODE', 'CLAIM_APPROVAL', 'SITE_ADMIN_ASSIGNMENT',
  'CLUB_ADMIN_ASSIGNMENT', 'TEAM_ADMIN_ASSIGNMENT', 'SAFEGUARDING_APPOINTMENT', 'SEASON_HANDOVER', 'LEGACY_BACKFILL'
));

-- ---------------------------------------------------------------------
-- 2. Shared helpers (no API access)
-- ---------------------------------------------------------------------

create or replace function internal.require_reason(p_reason text, p_required boolean)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_required and v_reason is null then
    raise exception 'Please give a reason.' using errcode = '22023';
  end if;
  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'Keep the reason to 500 characters or fewer.' using errcode = '22023';
  end if;
  return v_reason;
end;
$$;

-- An ACTIVE club-wide role on an ACTIVE membership, at an active club, held by
-- an active account.
create or replace function internal.holds_club_role(p_club_id uuid, p_role_key text, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and internal.is_account_active(p_user_id)
    and internal.is_club_active(p_club_id)
    and exists (
      select 1
      from public.role_assignments ra
      join public.club_memberships cm on cm.id = ra.membership_id
      where ra.club_id = p_club_id and ra.user_id = p_user_id and ra.role_key = p_role_key
        and ra.team_id is null and ra.state = 'ACTIVE' and cm.state = 'ACTIVE'
    );
$$;

-- The level at which the caller may manage this club's people: CLUB for its
-- Club Admin, SITE for a Full Site Admin, otherwise null.
create or replace function internal.club_people_authority(p_club_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when internal.holds_club_role(p_club_id, 'CLUB_ADMIN', auth.uid()) then 'CLUB'
    when internal.is_full_site_admin() then 'SITE'
  end;
$$;

create or replace function internal.lock_club_people(p_club_id uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('club-admin:' || p_club_id::text));
$$;

-- Refuses a change that would leave an active club with no ACTIVE Club Admin.
-- Callers hold internal.lock_club_people for the club.
create or replace function internal.assert_club_keeps_an_admin(p_club_id uuid, p_ending uuid[], p_allow boolean, p_reason text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not internal.is_club_active(p_club_id) then
    return;
  end if;
  if not exists (
    select 1 from public.role_assignments ra
    where ra.id = any (p_ending) and ra.role_key = 'CLUB_ADMIN' and ra.state = 'ACTIVE'
  ) then
    return;
  end if;
  if exists (
    select 1
    from public.role_assignments ra
    join public.club_memberships cm on cm.id = ra.membership_id
    where ra.club_id = p_club_id and ra.role_key = 'CLUB_ADMIN' and ra.team_id is null
      and ra.state = 'ACTIVE' and cm.state = 'ACTIVE' and ra.id <> all (p_ending)
  ) then
    return;
  end if;
  if coalesce(p_allow, false) and internal.is_full_site_admin() and p_reason is not null then
    return;
  end if;
  raise exception 'This would leave the club without a Club Admin. Make someone else Club Admin first.' using errcode = '23514';
end;
$$;

-- An open membership always holds at least one of Club Admin, Fixtures
-- Secretary or Member.
create or replace function internal.ensure_club_member_role(p_membership_id uuid, p_source text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.club_memberships;
begin
  select * into v_membership from public.club_memberships where id = p_membership_id;
  if v_membership.state not in ('ACTIVE', 'SUSPENDED') then
    return;
  end if;
  if exists (
    select 1 from public.role_assignments
    where membership_id = p_membership_id and team_id is null
      and role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY', 'MEMBER') and state in ('ACTIVE', 'SUSPENDED')
  ) then
    return;
  end if;
  insert into public.role_assignments (user_id, club_id, membership_id, role_key, state, suspended_level, suspended_at, source, granted_by, reason, attributes)
  values (v_membership.user_id, v_membership.club_id, v_membership.id, 'MEMBER',
          case v_membership.state when 'SUSPENDED' then 'SUSPENDED' else 'ACTIVE' end,
          v_membership.suspended_level,
          case when v_membership.state = 'SUSPENDED' then now() end,
          p_source, auth.uid(), p_reason,
          case when v_membership.state = 'SUSPENDED' then jsonb_build_object('suspension_cause', 'MEMBERSHIP') else '{}'::jsonb end);
end;
$$;

-- Admits a person to a club: approves their PENDING membership, returns their
-- existing ACTIVE one, or creates a new ACTIVE membership with its Member
-- role. A suspended membership is never lifted by admission.
create or replace function internal.admit_club_member(
  p_club_id uuid, p_user_id uuid, p_source text, p_reason text,
  p_invitation_id uuid default null, p_request_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open public.club_memberships;
  v_id uuid;
  v_prev text;
begin
  select * into v_open from public.club_memberships
  where club_id = p_club_id and user_id = p_user_id and state in ('PENDING', 'ACTIVE', 'SUSPENDED')
  for update;

  if v_open.state = 'SUSPENDED' then
    raise exception 'This person''s membership of the club is suspended. Restore it rather than admitting them again.' using errcode = '23514';
  elsif v_open.state = 'ACTIVE' then
    return v_open.id;
  end if;

  v_prev := internal.membership_sync_on();
  if v_open.state = 'PENDING' then
    update public.club_memberships
    set state = 'ACTIVE', approved_by = auth.uid(), approved_at = now(), updated_by = auth.uid(),
        source_invitation_id = coalesce(source_invitation_id, p_invitation_id),
        reason = coalesce(p_reason, reason)
    where id = v_open.id;
    v_id := v_open.id;
    perform internal.ensure_club_member_role(v_id, v_open.source, p_reason);
    perform internal.emit_security_event('membership.approved', p_user_id, 'SUCCESS', p_reason,
      jsonb_build_object('membership_id', v_id, 'source', v_open.source, 'decided_by_source', p_source), p_club_id, null, null);
  else
    insert into public.club_memberships (club_id, user_id, role, status, state, source, created_by, updated_by, granted_by, granted_at, reason, source_invitation_id, source_request_id, approved_by, approved_at)
    values (p_club_id, p_user_id, 'BASIC_USER', 'active', 'ACTIVE', p_source, auth.uid(), auth.uid(), auth.uid(), now(), p_reason, p_invitation_id, p_request_id,
            case when p_source = 'JOIN_REQUEST' then auth.uid() end,
            case when p_source = 'JOIN_REQUEST' then now() end)
    returning id into v_id;
    perform internal.ensure_club_member_role(v_id, p_source, p_reason);
    perform internal.emit_security_event(
      case when p_source = 'JOIN_REQUEST' then 'membership.approved' else 'membership.granted' end,
      p_user_id, 'SUCCESS', p_reason, jsonb_build_object('membership_id', v_id, 'source', p_source), p_club_id, null, null);
  end if;
  perform internal.membership_sync_restore(v_prev);
  return v_id;
end;
$$;

-- Gives one role on an ACTIVE membership. No authority check: callers decide
-- who may ask. Returns the open assignment (an existing ACTIVE one is reused).
create or replace function internal.grant_role(
  p_membership_id uuid, p_role_key text, p_team_id uuid, p_source text, p_reason text,
  p_attributes jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.club_memberships;
  v_role public.role_definitions;
  v_team public.teams;
  v_existing public.role_assignments;
  v_base uuid;
  v_id uuid;
  v_member record;
begin
  select * into v_membership from public.club_memberships where id = p_membership_id;
  if v_membership.id is null then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;
  if v_membership.state <> 'ACTIVE' then
    raise exception 'Roles can only be given to an active member of the club.' using errcode = '23514';
  end if;
  select * into v_role from public.role_definitions where role_key = p_role_key;
  if v_role.role_key is null then
    raise exception 'Unknown role.' using errcode = '22023';
  end if;
  if p_role_key = 'SAFEGUARDING_OFFICER' and p_source <> 'SAFEGUARDING_APPOINTMENT' then
    raise exception 'A Safeguarding Officer is appointed through nomination and acceptance, not assigned.' using errcode = '42501';
  end if;
  if not internal.is_account_active(v_membership.user_id) then
    raise exception 'That account is not active.' using errcode = '23514';
  end if;
  if v_role.minor_prohibited and internal.person_is_minor(v_membership.user_id) then
    raise exception 'The % role cannot be held by someone under 18.', v_role.label using errcode = '23514';
  end if;
  if v_role.scope = 'CLUB' and p_team_id is not null then
    raise exception 'The % role is held club-wide, not for a team.', v_role.label using errcode = '22023';
  elsif v_role.scope = 'TEAM' and p_team_id is null then
    raise exception 'The % role is held for a team.', v_role.label using errcode = '22023';
  end if;
  if p_team_id is not null then
    select * into v_team from public.teams where id = p_team_id;
    if v_team.id is null or v_team.club_id <> v_membership.club_id then
      raise exception 'That team is not part of this club.' using errcode = '42501';
    end if;
    if not v_team.active then
      raise exception 'That team is archived.' using errcode = '23514';
    end if;
  end if;

  select * into v_existing from public.role_assignments
  where membership_id = p_membership_id and role_key = p_role_key and team_id is not distinct from p_team_id
    and state in ('ACTIVE', 'SUSPENDED')
  for update;
  if v_existing.state = 'ACTIVE' then
    return v_existing.id;
  elsif v_existing.state = 'SUSPENDED' then
    raise exception 'This role is suspended. Restore it rather than assigning it again.' using errcode = '23514';
  end if;

  if v_role.requires_base_role is not null then
    select id into v_base from public.role_assignments
    where membership_id = p_membership_id and team_id = p_team_id and role_key = any (v_role.requires_base_role) and state = 'ACTIVE'
    order by case role_key when 'TEAM_MANAGER' then 1 else 2 end
    limit 1;
    if v_base is null then
      raise exception 'Team Admin rests on a Coach or Team Manager role for the same team. Give one of those first.' using errcode = '23514';
    end if;
  end if;

  insert into public.role_assignments (user_id, club_id, team_id, membership_id, role_key, base_assignment_id, state, source, granted_by, reason, attributes,
                                       confirmation_state, confirmed_at)
  values (v_membership.user_id, v_membership.club_id, p_team_id, p_membership_id, p_role_key, v_base, 'ACTIVE', p_source, auth.uid(), p_reason,
          coalesce(p_attributes, '{}'::jsonb),
          case when p_role_key = 'SAFEGUARDING_OFFICER' then 'CONFIRMED' end,
          case when p_role_key = 'SAFEGUARDING_OFFICER' then now() end)
  returning id into v_id;

  perform internal.emit_security_event('role.granted', v_membership.user_id, 'SUCCESS', p_reason,
    jsonb_build_object('membership_id', p_membership_id, 'assignment_id', v_id, 'role_key', p_role_key, 'source', p_source),
    v_membership.club_id, p_team_id, null);

  -- Club Admin and Fixtures Secretary replace the plain Member role.
  if p_role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY') then
    for v_member in
      select id from public.role_assignments
      where membership_id = p_membership_id and team_id is null and role_key = 'MEMBER' and state <> 'REVOKED'
    loop
      perform internal.end_role(v_member.id, 'REVOKED', coalesce(p_reason, 'Replaced by ' || v_role.label), null);
    end loop;
  end if;

  return v_id;
end;
$$;

-- Moves one assignment to SUSPENDED, ACTIVE or REVOKED. No authority check,
-- no last-admin check: callers do both first.
create or replace function internal.end_role(p_assignment_id uuid, p_to_state text, p_reason text, p_level text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.role_assignments;
begin
  select * into v_assignment from public.role_assignments where id = p_assignment_id for update;
  if p_to_state = 'REVOKED' then
    if v_assignment.state = 'REVOKED' then
      return;
    end if;
    update public.role_assignments
    set state = 'REVOKED', revoked_at = now(), revoked_by = auth.uid(), revocation_reason = p_reason,
        suspended_level = null
    where id = p_assignment_id;
    perform internal.emit_security_event('role.revoked', v_assignment.user_id, 'SUCCESS', p_reason,
      jsonb_build_object('assignment_id', v_assignment.id, 'membership_id', v_assignment.membership_id, 'role_key', v_assignment.role_key, 'from_state', v_assignment.state),
      v_assignment.club_id, v_assignment.team_id, null);
  elsif p_to_state = 'SUSPENDED' then
    update public.role_assignments
    set state = 'SUSPENDED', suspended_level = p_level, suspended_at = now(), suspended_by = auth.uid(),
        attributes = attributes || jsonb_build_object('suspension_cause', 'ROLE')
    where id = p_assignment_id;
    perform internal.emit_security_event('role.suspended', v_assignment.user_id, 'SUCCESS', p_reason,
      jsonb_build_object('assignment_id', v_assignment.id, 'membership_id', v_assignment.membership_id, 'role_key', v_assignment.role_key, 'level', p_level),
      v_assignment.club_id, v_assignment.team_id, null);
  elsif p_to_state = 'ACTIVE' then
    update public.role_assignments
    set state = 'ACTIVE', suspended_level = null, suspended_at = null, suspended_by = null,
        attributes = attributes - 'suspension_cause'
    where id = p_assignment_id;
    perform internal.emit_security_event('role.restored', v_assignment.user_id, 'SUCCESS', p_reason,
      jsonb_build_object('assignment_id', v_assignment.id, 'membership_id', v_assignment.membership_id, 'role_key', v_assignment.role_key, 'level', p_level),
      v_assignment.club_id, v_assignment.team_id, null);
  else
    raise exception 'Unknown role state.' using errcode = '22023';
  end if;
end;
$$;

-- Legacy single-select club role. Returns nothing; the membership's open
-- Club Admin / Fixtures Secretary / Member roles are left matching p_role.
create or replace function internal.apply_primary_club_role(p_membership_id uuid, p_role text, p_source text, p_reason text, p_allow_no_club_admin boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.club_memberships;
  v_target text;
  v_ending uuid[];
  v_row record;
begin
  select * into v_membership from public.club_memberships where id = p_membership_id;
  v_target := case p_role
    when 'CLUB_ADMIN' then 'CLUB_ADMIN'
    when 'FIXTURE_SECRETARY' then 'FIXTURES_SECRETARY'
    when 'BASIC_USER' then 'MEMBER'
  end;
  if v_target is null then
    raise exception 'Choose Member, Fixtures Secretary or Club Admin.' using errcode = '22023';
  end if;
  if v_membership.state <> 'ACTIVE' then
    raise exception 'Only an active member''s club role can be changed.' using errcode = '23514';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[]) into v_ending
  from public.role_assignments
  where membership_id = p_membership_id and team_id is null
    and role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY', 'MEMBER') and role_key <> v_target and state <> 'REVOKED';
  perform internal.assert_club_keeps_an_admin(v_membership.club_id, v_ending, p_allow_no_club_admin, p_reason);

  perform internal.grant_role(p_membership_id, v_target, null, p_source, p_reason);

  for v_row in
    select id from public.role_assignments
    where membership_id = p_membership_id and team_id is null
      and role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY', 'MEMBER') and role_key <> v_target and state <> 'REVOKED'
  loop
    perform internal.end_role(v_row.id, 'REVOKED', coalesce(p_reason, 'Club role changed'), null);
  end loop;
end;
$$;

-- Legacy single team permission for a membership and team (replace
-- semantics, as the old upsert had). Returns the id the team_permissions view
-- shows for the pair.
create or replace function internal.apply_team_access(p_membership_id uuid, p_team_id uuid, p_permission text, p_source text, p_reason text, p_attributes jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_role text;
  v_base uuid;
  v_ta uuid;
  v_row record;
begin
  if p_permission = 'view_only' then
    raise exception 'View Only does not give any team access. Choose Coach, Team Manager or Team Admin.' using errcode = '22023';
  end if;
  if p_permission not in ('coach', 'manager', 'team_admin') then
    raise exception 'Choose Coach, Team Manager or Team Admin.' using errcode = '22023';
  end if;
  v_base_role := case p_permission when 'coach' then 'COACH' else 'TEAM_MANAGER' end;

  v_base := internal.grant_role(p_membership_id, v_base_role, p_team_id, p_source, p_reason, p_attributes);
  if p_permission = 'team_admin' then
    v_ta := internal.grant_role(p_membership_id, 'TEAM_ADMINISTRATION', p_team_id, p_source, p_reason, p_attributes);
  end if;

  for v_row in
    select id from public.role_assignments
    where membership_id = p_membership_id and team_id = p_team_id and state <> 'REVOKED'
      and role_key in ('COACH', 'TEAM_MANAGER', 'TEAM_ADMINISTRATION')
      and role_key <> v_base_role
      and not (role_key = 'TEAM_ADMINISTRATION' and p_permission = 'team_admin')
    order by case role_key when 'TEAM_ADMINISTRATION' then 1 else 2 end
  loop
    perform internal.end_role(v_row.id, 'REVOKED', coalesce(p_reason, 'Team access changed'), null);
  end loop;

  return coalesce(v_ta, v_base);
end;
$$;

create or replace function internal.clear_team_access(p_membership_id uuid, p_team_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select id from public.role_assignments
    where membership_id = p_membership_id and team_id = p_team_id and state <> 'REVOKED'
      and role_key in ('COACH', 'TEAM_MANAGER', 'TEAM_ADMINISTRATION')
    order by case role_key when 'TEAM_ADMINISTRATION' then 1 else 2 end
  loop
    perform internal.end_role(v_row.id, 'REVOKED', coalesce(p_reason, 'Team access removed'), null);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function internal.require_reason(text, boolean) from public, anon, authenticated, service_role;
revoke all on function internal.holds_club_role(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function internal.club_people_authority(uuid) from public, anon, authenticated, service_role;
revoke all on function internal.lock_club_people(uuid) from public, anon, authenticated, service_role;
revoke all on function internal.assert_club_keeps_an_admin(uuid, uuid[], boolean, text) from public, anon, authenticated, service_role;
revoke all on function internal.ensure_club_member_role(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function internal.admit_club_member(uuid, uuid, text, text, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function internal.grant_role(uuid, text, uuid, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function internal.end_role(uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function internal.apply_primary_club_role(uuid, text, text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function internal.apply_team_access(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function internal.clear_team_access(uuid, uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Team Administration follows its base role through suspension too
-- ---------------------------------------------------------------------

create or replace function internal.role_assignment_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    -- Team Administration ends, pauses and resumes with the Coach or Team
    -- Manager role it rests on.
    if tg_op = 'UPDATE' and new.state is distinct from old.state and new.role_key in ('COACH', 'TEAM_MANAGER') then
      if new.state = 'REVOKED' then
        update public.role_assignments ta
        set state = 'REVOKED', revoked_at = now(), revoked_by = coalesce(new.revoked_by, auth.uid()),
            revocation_reason = 'Its base role ended', suspended_level = null
        where ta.base_assignment_id = new.id and ta.state <> 'REVOKED';
      elsif new.state = 'SUSPENDED' then
        update public.role_assignments ta
        set state = 'SUSPENDED', suspended_level = new.suspended_level, suspended_at = now(), suspended_by = new.suspended_by,
            attributes = ta.attributes || jsonb_build_object('suspension_cause', 'BASE_ROLE')
        where ta.base_assignment_id = new.id and ta.state = 'ACTIVE';
      elsif new.state = 'ACTIVE' then
        update public.role_assignments ta
        set state = 'ACTIVE', suspended_level = null, suspended_at = null, suspended_by = null,
            attributes = ta.attributes - 'suspension_cause'
        where ta.base_assignment_id = new.id and ta.state = 'SUSPENDED' and ta.attributes ->> 'suspension_cause' = 'BASE_ROLE';
      end if;
    end if;
    perform internal.refresh_membership_legacy_columns(new.membership_id);
    return null;
  end if;
  perform internal.refresh_membership_legacy_columns(old.membership_id);
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. A join request opens a PENDING membership
-- ---------------------------------------------------------------------

create or replace function internal.club_join_request_opens_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text;
  v_id uuid;
begin
  if new.status <> 'pending' then
    return null;
  end if;
  if exists (
    select 1 from public.club_memberships
    where club_id = new.club_id and user_id = new.requesting_user_id and state in ('PENDING', 'ACTIVE', 'SUSPENDED')
  ) then
    return null;
  end if;
  v_prev := internal.membership_sync_on();
  insert into public.club_memberships (club_id, user_id, role, status, state, source, source_request_id, created_by, updated_by, granted_by)
  values (new.club_id, new.requesting_user_id, 'BASIC_USER', 'pending', 'PENDING', 'JOIN_REQUEST', new.id, new.requesting_user_id, new.requesting_user_id, null)
  returning id into v_id;
  perform internal.membership_sync_restore(v_prev);
  perform internal.emit_security_event('membership.requested', new.requesting_user_id, 'SUCCESS', null,
    jsonb_build_object('membership_id', v_id, 'join_request_id', new.id), new.club_id, null, null);
  return null;
end;
$$;

revoke all on function internal.club_join_request_opens_membership() from public, anon, authenticated, service_role;

create trigger club_join_request_opens_membership
  after insert on public.club_join_requests
  for each row execute function internal.club_join_request_opens_membership();

-- ---------------------------------------------------------------------
-- 5. Transition RPCs
-- ---------------------------------------------------------------------

create or replace function public.transition_club_membership(
  p_membership_id uuid, p_to_state text, p_reason text default null, p_allow_no_club_admin boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club uuid;
  v_membership public.club_memberships;
  v_level text;
  v_self boolean;
  v_reason text;
  v_ending uuid[];
  v_prev text;
  v_event text;
begin
  if auth.uid() is null or not internal.is_account_active(auth.uid()) then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select club_id into v_club from public.club_memberships where id = p_membership_id;
  if v_club is null then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;
  perform internal.lock_club_people(v_club);
  select * into v_membership from public.club_memberships where id = p_membership_id for update;

  v_level := internal.club_people_authority(v_club);
  v_self := v_membership.user_id = auth.uid();

  if p_to_state = 'REVOKED' then
    if v_level is null and not v_self then
      raise exception 'You are not authorised to remove people from this club.' using errcode = '42501';
    end if;
    if v_membership.state not in ('ACTIVE', 'SUSPENDED') then
      raise exception 'This membership is not active, so there is nothing to remove.' using errcode = '23514';
    end if;
    v_reason := internal.require_reason(p_reason, not v_self);
    select coalesce(array_agg(id), '{}'::uuid[]) into v_ending
    from public.role_assignments where membership_id = p_membership_id and state = 'ACTIVE';
    perform internal.assert_club_keeps_an_admin(v_club, v_ending, p_allow_no_club_admin, v_reason);
    v_prev := internal.membership_sync_on();
    update public.club_memberships
    set state = 'REVOKED', revoked_at = now(), revoked_by = auth.uid(),
        revocation_reason = coalesce(v_reason, 'Left the club'), updated_by = auth.uid()
    where id = p_membership_id;
    perform internal.membership_sync_restore(v_prev);
    v_event := 'membership.revoked';

  elsif p_to_state = 'SUSPENDED' then
    if v_level is null then
      raise exception 'You are not authorised to suspend people at this club.' using errcode = '42501';
    end if;
    if v_self then
      raise exception 'You cannot suspend your own membership.' using errcode = '42501';
    end if;
    if v_membership.state <> 'ACTIVE' then
      raise exception 'Only an active membership can be suspended.' using errcode = '23514';
    end if;
    v_reason := internal.require_reason(p_reason, true);
    select coalesce(array_agg(id), '{}'::uuid[]) into v_ending
    from public.role_assignments where membership_id = p_membership_id and state = 'ACTIVE';
    perform internal.assert_club_keeps_an_admin(v_club, v_ending, p_allow_no_club_admin, v_reason);
    v_prev := internal.membership_sync_on();
    update public.club_memberships
    set state = 'SUSPENDED', suspended_level = v_level, suspended_at = now(), suspended_by = auth.uid(),
        reason = v_reason, updated_by = auth.uid()
    where id = p_membership_id;
    perform internal.membership_sync_restore(v_prev);
    v_event := 'membership.suspended';

  elsif p_to_state = 'ACTIVE' then
    if v_membership.state in ('REVOKED', 'DECLINED', 'EXPIRED') then
      raise exception 'A removed membership cannot be switched back on. Re-admit the person as a new membership.' using errcode = '23514';
    end if;
    if v_membership.state = 'PENDING' then
      raise exception 'Decide the person''s join request instead.' using errcode = '23514';
    end if;
    if v_membership.state <> 'SUSPENDED' then
      raise exception 'This membership is not suspended.' using errcode = '23514';
    end if;
    if v_level is null or v_self then
      raise exception 'You are not authorised to restore this membership.' using errcode = '42501';
    end if;
    if v_membership.suspended_level = 'SITE' and v_level <> 'SITE' then
      raise exception 'This membership was suspended by a Site Admin, so only a Site Admin can restore it.' using errcode = '42501';
    end if;
    v_reason := internal.require_reason(p_reason, true);
    v_prev := internal.membership_sync_on();
    update public.club_memberships
    set state = 'ACTIVE', suspended_level = null, suspended_at = null, suspended_by = null,
        reason = v_reason, updated_by = auth.uid()
    where id = p_membership_id;
    perform internal.membership_sync_restore(v_prev);
    v_event := 'membership.restored';

  else
    raise exception 'A membership can be suspended, restored or removed.' using errcode = '22023';
  end if;

  perform internal.emit_security_event(v_event, v_membership.user_id, 'SUCCESS', v_reason,
    jsonb_build_object('membership_id', p_membership_id, 'from_state', v_membership.state, 'to_state', p_to_state,
                       'authority_level', coalesce(v_level, 'SELF'), 'self', v_self,
                       'override_last_club_admin', coalesce(p_allow_no_club_admin, false)),
    v_club, null, null);
end;
$$;

create or replace function public.decide_club_join_request(p_request_id uuid, p_decision text, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club uuid;
  v_request public.club_join_requests;
  v_level text;
  v_reason text;
  v_membership_id uuid;
  v_pending public.club_memberships;
  v_prev text;
begin
  if auth.uid() is null or not internal.is_account_active(auth.uid()) then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if p_decision not in ('APPROVE', 'DECLINE') then
    raise exception 'A join request is approved or declined.' using errcode = '22023';
  end if;
  select club_id into v_club from public.club_join_requests where id = p_request_id;
  if v_club is null then
    raise exception 'Join request not found.' using errcode = 'P0002';
  end if;
  perform internal.lock_club_people(v_club);
  select * into v_request from public.club_join_requests where id = p_request_id for update;

  v_level := internal.club_people_authority(v_club);
  if v_level is null then
    raise exception 'Only that club''s admin or a Site Admin may decide a join request.' using errcode = '42501';
  end if;
  if v_request.requesting_user_id = auth.uid() then
    raise exception 'You cannot decide your own join request.' using errcode = '42501';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This join request has already been decided.' using errcode = '23514';
  end if;
  v_reason := internal.require_reason(p_reason, p_decision = 'DECLINE' or v_level = 'SITE');

  if p_decision = 'APPROVE' then
    v_membership_id := internal.admit_club_member(v_club, v_request.requesting_user_id, 'JOIN_REQUEST', v_reason, null, p_request_id);
    update public.club_join_requests
    set status = 'approved', decided_by = auth.uid(), decided_at = now(), review_notes = v_reason
    where id = p_request_id;
    insert into public.notifications (user_id, type, title, body, data)
    values (v_request.requesting_user_id, 'club_claim_approved', 'Club access approved',
            'Your request to join has been approved.',
            jsonb_build_object('club_id', v_club, 'join_request_id', p_request_id));
    return v_membership_id;
  end if;

  select * into v_pending from public.club_memberships
  where club_id = v_club and user_id = v_request.requesting_user_id and state = 'PENDING'
  for update;
  if v_pending.id is not null then
    v_prev := internal.membership_sync_on();
    update public.club_memberships
    set state = 'DECLINED', reason = v_reason, updated_by = auth.uid()
    where id = v_pending.id;
    perform internal.membership_sync_restore(v_prev);
  end if;
  update public.club_join_requests
  set status = 'rejected', decided_by = auth.uid(), decided_at = now(), review_notes = v_reason
  where id = p_request_id;
  insert into public.notifications (user_id, type, title, body, data)
  values (v_request.requesting_user_id, 'club_claim_rejected', 'Club access request update',
          'Your request to join was not approved this time.',
          jsonb_build_object('join_request_id', p_request_id));
  perform internal.emit_security_event('membership.declined', v_request.requesting_user_id, 'SUCCESS', v_reason,
    jsonb_build_object('membership_id', v_pending.id, 'join_request_id', p_request_id, 'authority_level', v_level),
    v_club, null, null);
  return null;
end;
$$;

create or replace function public.grant_club_membership(p_club_id uuid, p_user_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
begin
  if not internal.is_full_site_admin() then
    raise exception 'Only a Full Site Admin can admit someone to a club directly.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'A Site Admin cannot admit themselves to a club.' using errcode = '42501';
  end if;
  v_reason := internal.require_reason(p_reason, true);
  if not internal.is_club_active(p_club_id) then
    raise exception 'Reactivate the club before admitting anyone.' using errcode = '23514';
  end if;
  if not internal.is_account_active(p_user_id) then
    raise exception 'That account is not active.' using errcode = '23514';
  end if;
  perform internal.lock_club_people(p_club_id);
  if exists (select 1 from public.club_memberships where club_id = p_club_id and user_id = p_user_id and state in ('PENDING', 'ACTIVE', 'SUSPENDED')) then
    raise exception 'This person already has a membership of this club.' using errcode = '23514';
  end if;
  return internal.admit_club_member(p_club_id, p_user_id, 'SITE_ADMIN_ASSIGNMENT', v_reason, null, null);
end;
$$;

create or replace function public.assign_role(p_membership_id uuid, p_role_key text, p_team_id uuid default null, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club uuid;
  v_membership public.club_memberships;
  v_role public.role_definitions;
  v_level text;
  v_reason text;
begin
  if auth.uid() is null or not internal.is_account_active(auth.uid()) then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select club_id into v_club from public.club_memberships where id = p_membership_id;
  if v_club is null then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;
  perform internal.lock_club_people(v_club);
  select * into v_membership from public.club_memberships where id = p_membership_id for update;

  select * into v_role from public.role_definitions where role_key = p_role_key;
  if v_role.role_key is null then
    raise exception 'Unknown role.' using errcode = '22023';
  end if;
  v_level := internal.club_people_authority(v_club);
  if v_level is null or not (v_level = any (v_role.assignable_by)) then
    raise exception 'You are not authorised to give the % role at this club.', v_role.label using errcode = '42501';
  end if;
  if p_role_key = 'SAFEGUARDING_OFFICER' then
    raise exception 'A Safeguarding Officer is appointed through nomination and acceptance, not assigned.' using errcode = '42501';
  end if;
  if v_level = 'SITE' and v_membership.user_id = auth.uid() then
    raise exception 'A Site Admin cannot give themselves a club role.' using errcode = '42501';
  end if;
  v_reason := internal.require_reason(p_reason, v_level = 'SITE');

  return internal.grant_role(p_membership_id, p_role_key, p_team_id,
    case v_level when 'SITE' then 'SITE_ADMIN_ASSIGNMENT' else 'CLUB_ADMIN_ASSIGNMENT' end, v_reason);
end;
$$;

create or replace function public.transition_role_assignment(
  p_assignment_id uuid, p_to_state text, p_reason text default null, p_allow_no_club_admin boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club uuid;
  v_assignment public.role_assignments;
  v_membership public.club_memberships;
  v_role public.role_definitions;
  v_level text;
  v_reason text;
begin
  if auth.uid() is null or not internal.is_account_active(auth.uid()) then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select club_id into v_club from public.role_assignments where id = p_assignment_id;
  if v_club is null then
    raise exception 'Role not found.' using errcode = 'P0002';
  end if;
  perform internal.lock_club_people(v_club);
  select * into v_assignment from public.role_assignments where id = p_assignment_id for update;
  select * into v_membership from public.club_memberships where id = v_assignment.membership_id for update;
  select * into v_role from public.role_definitions where role_key = v_assignment.role_key;

  v_level := internal.club_people_authority(v_club);
  if v_level is null or not (v_level = any (v_role.assignable_by)) then
    raise exception 'You are not authorised to change the % role at this club.', v_role.label using errcode = '42501';
  end if;
  if v_assignment.role_key = 'SAFEGUARDING_OFFICER' then
    raise exception 'A Safeguarding Officer is changed through the club''s safeguarding settings.' using errcode = '42501';
  end if;
  if v_level = 'SITE' and v_assignment.user_id = auth.uid() then
    raise exception 'A Site Admin cannot change their own club roles.' using errcode = '42501';
  end if;

  if p_to_state = 'SUSPENDED' then
    if v_assignment.state <> 'ACTIVE' then
      raise exception 'Only an active role can be suspended.' using errcode = '23514';
    end if;
    v_reason := internal.require_reason(p_reason, true);
    perform internal.assert_club_keeps_an_admin(v_club, array[p_assignment_id], p_allow_no_club_admin, v_reason);
    perform internal.end_role(p_assignment_id, 'SUSPENDED', v_reason, v_level);

  elsif p_to_state = 'ACTIVE' then
    if v_assignment.state = 'REVOKED' then
      raise exception 'A revoked role cannot be restored. Assign it again.' using errcode = '23514';
    end if;
    if v_assignment.state <> 'SUSPENDED' then
      raise exception 'This role is not suspended.' using errcode = '23514';
    end if;
    if coalesce(v_assignment.attributes ->> 'suspension_cause', '') <> 'ROLE' then
      raise exception 'This role was paused by something else (the membership, the club''s status, its base role or a review); resolve that instead.' using errcode = '23514';
    end if;
    if v_assignment.suspended_level = 'SITE' and v_level <> 'SITE' then
      raise exception 'This role was suspended by a Site Admin, so only a Site Admin can restore it.' using errcode = '42501';
    end if;
    if v_membership.state <> 'ACTIVE' then
      raise exception 'Restore the membership before its roles.' using errcode = '23514';
    end if;
    if v_role.minor_prohibited and internal.person_is_minor(v_assignment.user_id) then
      raise exception 'The % role cannot be held by someone under 18.', v_role.label using errcode = '23514';
    end if;
    if v_assignment.base_assignment_id is not null
       and not exists (select 1 from public.role_assignments where id = v_assignment.base_assignment_id and state = 'ACTIVE') then
      raise exception 'Restore the Coach or Team Manager role this rests on first.' using errcode = '23514';
    end if;
    v_reason := internal.require_reason(p_reason, true);
    perform internal.end_role(p_assignment_id, 'ACTIVE', v_reason, v_level);

  elsif p_to_state = 'REVOKED' then
    if v_assignment.state = 'REVOKED' then
      raise exception 'This role has already been revoked.' using errcode = '23514';
    end if;
    v_reason := internal.require_reason(p_reason, v_level = 'SITE');
    perform internal.assert_club_keeps_an_admin(v_club, array[p_assignment_id], p_allow_no_club_admin, v_reason);
    perform internal.end_role(p_assignment_id, 'REVOKED', coalesce(v_reason, 'Role removed'), v_level);
    if v_assignment.team_id is null and v_assignment.role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY') then
      perform internal.ensure_club_member_role(v_assignment.membership_id,
        case v_level when 'SITE' then 'SITE_ADMIN_ASSIGNMENT' else 'CLUB_ADMIN_ASSIGNMENT' end, v_reason);
    end if;

  else
    raise exception 'A role can be suspended, restored or revoked.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.set_primary_club_role(p_membership_id uuid, p_role text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club uuid;
  v_membership public.club_memberships;
  v_level text;
  v_reason text;
begin
  if auth.uid() is null or not internal.is_account_active(auth.uid()) then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select club_id into v_club from public.club_memberships where id = p_membership_id;
  if v_club is null then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;
  perform internal.lock_club_people(v_club);
  select * into v_membership from public.club_memberships where id = p_membership_id for update;
  v_level := internal.club_people_authority(v_club);
  if v_level is null then
    raise exception 'You are not authorised to change club roles at this club.' using errcode = '42501';
  end if;
  if v_level = 'SITE' and v_membership.user_id = auth.uid() then
    raise exception 'A Site Admin cannot change their own club role.' using errcode = '42501';
  end if;
  v_reason := internal.require_reason(p_reason, v_level = 'SITE');
  perform internal.apply_primary_club_role(p_membership_id, p_role,
    case v_level when 'SITE' then 'SITE_ADMIN_ASSIGNMENT' else 'CLUB_ADMIN_ASSIGNMENT' end, v_reason, false);
end;
$$;

create or replace function public.set_team_access(p_membership_id uuid, p_team_id uuid, p_permission text, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club uuid;
  v_membership public.club_memberships;
  v_level text;
  v_reason text;
begin
  if auth.uid() is null or not internal.is_account_active(auth.uid()) then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select club_id into v_club from public.club_memberships where id = p_membership_id;
  if v_club is null then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;
  perform internal.lock_club_people(v_club);
  select * into v_membership from public.club_memberships where id = p_membership_id for update;
  v_level := internal.club_people_authority(v_club);
  if v_level is null then
    raise exception 'You are not authorised to assign team roles at this club.' using errcode = '42501';
  end if;
  if v_level = 'SITE' and v_membership.user_id = auth.uid() then
    raise exception 'A Site Admin cannot give themselves a team role.' using errcode = '42501';
  end if;
  v_reason := internal.require_reason(p_reason, v_level = 'SITE');
  return internal.apply_team_access(p_membership_id, p_team_id, p_permission,
    case v_level when 'SITE' then 'SITE_ADMIN_ASSIGNMENT' else 'CLUB_ADMIN_ASSIGNMENT' end, v_reason);
end;
$$;

-- Takes the id the team_permissions view shows for a person on a team.
create or replace function public.remove_team_access(p_team_permission_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.role_assignments;
  v_level text;
  v_reason text;
begin
  if auth.uid() is null or not internal.is_account_active(auth.uid()) then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into v_assignment from public.role_assignments where id = p_team_permission_id and team_id is not null;
  if v_assignment.id is null then
    raise exception 'Team role not found.' using errcode = 'P0002';
  end if;
  perform internal.lock_club_people(v_assignment.club_id);
  perform 1 from public.club_memberships where id = v_assignment.membership_id for update;
  v_level := internal.club_people_authority(v_assignment.club_id);
  if v_level is null then
    raise exception 'You are not authorised to remove team roles at this club.' using errcode = '42501';
  end if;
  if v_level = 'SITE' and v_assignment.user_id = auth.uid() then
    raise exception 'A Site Admin cannot change their own team roles.' using errcode = '42501';
  end if;
  v_reason := internal.require_reason(p_reason, v_level = 'SITE');
  if internal.clear_team_access(v_assignment.membership_id, v_assignment.team_id, v_reason) = 0 then
    raise exception 'This person has no team role here to remove.' using errcode = '23514';
  end if;
end;
$$;

create or replace function public.set_membership_governance_title(p_membership_id uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.club_memberships;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_prev text;
begin
  select * into v_membership from public.club_memberships where id = p_membership_id for update;
  if v_membership.id is null then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;
  if internal.club_people_authority(v_membership.club_id) is null then
    raise exception 'You are not authorised to change titles at this club.' using errcode = '42501';
  end if;
  if v_title is not null and length(v_title) > 80 then
    raise exception 'Keep the title to 80 characters or fewer.' using errcode = '22023';
  end if;
  v_prev := internal.membership_sync_on();
  update public.club_memberships set governance_title = v_title, updated_by = auth.uid() where id = p_membership_id;
  perform internal.membership_sync_restore(v_prev);
end;
$$;

-- Site Admin Club Management: set a member's club-wide and per-team access
-- from Permission Management groups, in one transaction.
-- p_team_assignments: [{"team_id": uuid, "group_id": uuid|null}, ...]
create or replace function public.change_membership_access_profile(
  p_membership_id uuid, p_club_group_id uuid, p_team_assignments jsonb, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.club_memberships;
  v_club_group public.permission_groups;
  v_reason text;
  v_item record;
  v_team_permission text;
  v_kept uuid[] := '{}'::uuid[];
  v_existing record;
  v_prev text;
begin
  if not internal.is_full_site_admin() then
    raise exception 'Only a Full Site Admin can change a member''s access profile.' using errcode = '42501';
  end if;
  v_reason := internal.require_reason(p_reason, true);
  if p_team_assignments is null or jsonb_typeof(p_team_assignments) <> 'array' then
    raise exception 'Team assignments must be a list.' using errcode = '22023';
  end if;
  select * into v_club_group from public.permission_groups
  where id = p_club_group_id and scope_type = 'club' and maps_to_role is not null;
  if v_club_group.id is null then
    raise exception 'That club-wide access group could not be found.' using errcode = 'P0002';
  end if;

  select * into v_membership from public.club_memberships where id = p_membership_id;
  if v_membership.id is null then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;
  if v_membership.user_id = auth.uid() then
    raise exception 'A Site Admin cannot change their own access.' using errcode = '42501';
  end if;
  perform internal.lock_club_people(v_membership.club_id);
  select * into v_membership from public.club_memberships where id = p_membership_id for update;

  perform internal.apply_primary_club_role(p_membership_id, v_club_group.maps_to_role, 'SITE_ADMIN_ASSIGNMENT', v_reason, false);
  v_prev := internal.membership_sync_on();
  update public.club_memberships set assigned_group_id = v_club_group.id, updated_by = auth.uid() where id = p_membership_id;
  update public.role_assignments
  set attributes = attributes || jsonb_build_object('assigned_group_id', v_club_group.id)
  where membership_id = p_membership_id and team_id is null and state = 'ACTIVE'
    and role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY', 'MEMBER');
  perform internal.membership_sync_restore(v_prev);

  for v_item in
    select (e ->> 'team_id')::uuid as team_id, nullif(e ->> 'group_id', '')::uuid as group_id
    from jsonb_array_elements(p_team_assignments) e
  loop
    if v_item.group_id is null then
      continue;
    end if;
    select maps_to_team_permission into v_team_permission
    from public.permission_groups where id = v_item.group_id and scope_type = 'team';
    if not found then
      raise exception 'One of the selected team access groups could not be found.' using errcode = 'P0002';
    end if;
    if v_team_permission is null or v_team_permission = 'view_only' then
      continue;
    end if;
    perform internal.apply_team_access(p_membership_id, v_item.team_id, v_team_permission, 'SITE_ADMIN_ASSIGNMENT', v_reason,
      jsonb_build_object('assigned_group_id', v_item.group_id));
    update public.role_assignments
    set attributes = attributes || jsonb_build_object('assigned_group_id', v_item.group_id)
    where membership_id = p_membership_id and team_id = v_item.team_id and state = 'ACTIVE';
    v_kept := v_kept || v_item.team_id;
  end loop;

  for v_existing in
    select distinct team_id from public.role_assignments
    where membership_id = p_membership_id and team_id is not null and state <> 'REVOKED'
      and role_key in ('COACH', 'TEAM_MANAGER', 'TEAM_ADMINISTRATION')
      and team_id <> all (v_kept)
  loop
    perform internal.clear_team_access(p_membership_id, v_existing.team_id, v_reason);
  end loop;
end;
$$;

create or replace function public.list_pending_club_join_requests(p_club_id uuid)
returns table (request_id uuid, requesting_user_id uuid, first_name text, surname text, requested_role text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if internal.club_people_authority(p_club_id) is null then
    raise exception 'You are not authorised to see this club''s join requests.' using errcode = '42501';
  end if;
  return query
  select j.id, j.requesting_user_id, p.first_name, p.surname, j.requested_role, j.created_at
  from public.club_join_requests j
  left join public.profiles p on p.id = j.requesting_user_id
  where j.club_id = p_club_id and j.status = 'pending'
  order by j.created_at;
end;
$$;

revoke all on function public.transition_club_membership(uuid, text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.decide_club_join_request(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.grant_club_membership(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.assign_role(uuid, text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.transition_role_assignment(uuid, text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.set_primary_club_role(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.set_team_access(uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.remove_team_access(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.set_membership_governance_title(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.change_membership_access_profile(uuid, uuid, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.list_pending_club_join_requests(uuid) from public, anon, authenticated, service_role;

grant execute on function public.transition_club_membership(uuid, text, text, boolean) to authenticated, service_role;
grant execute on function public.decide_club_join_request(uuid, text, text) to authenticated, service_role;
grant execute on function public.grant_club_membership(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.assign_role(uuid, text, uuid, text) to authenticated, service_role;
grant execute on function public.transition_role_assignment(uuid, text, text, boolean) to authenticated, service_role;
grant execute on function public.set_primary_club_role(uuid, text, text) to authenticated, service_role;
grant execute on function public.set_team_access(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.remove_team_access(uuid, text) to authenticated, service_role;
grant execute on function public.set_membership_governance_title(uuid, text) to authenticated, service_role;
grant execute on function public.change_membership_access_profile(uuid, uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.list_pending_club_join_requests(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. Existing writers move onto the canonical model
-- ---------------------------------------------------------------------

-- Legacy entry points keep their signatures and route to the decision RPC.
create or replace function public.approve_club_join_request(p_request_id uuid, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.decide_club_join_request(p_request_id, 'APPROVE', p_notes);
end;
$$;

create or replace function public.reject_club_join_request(p_request_id uuid, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.decide_club_join_request(p_request_id, 'DECLINE', p_notes);
end;
$$;

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
  v_membership_id uuid;
  v_item record;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to accept an invitation.' using errcode = '42501';
  end if;

  select * into v_inv from public.invitations where token = p_token for update;
  if not found then
    raise exception 'Invitation not found.';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'Invitation is not pending (current status: %).', v_inv.status;
  end if;
  if v_inv.expires_at < now() then
    update public.invitations set status = 'expired' where id = v_inv.id;
    raise exception 'Invitation has expired.';
  end if;
  if lower(coalesce(auth.email(), '')) <> lower(v_inv.invited_email) then
    raise exception 'This invitation was sent to a different email address than the one you are signed in as.' using errcode = '42501';
  end if;

  perform internal.lock_club_people(v_inv.club_id);

  -- A removed membership is history: this invitation admits the person as a
  -- new membership, and nothing the old one held comes back. An existing
  -- active membership keeps what it has; the invitation only adds.
  v_membership_id := internal.admit_club_member(v_inv.club_id, auth.uid(), 'INVITATION', null, v_inv.id, null);

  if v_inv.club_role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY') then
    perform internal.grant_role(v_membership_id,
      case v_inv.club_role when 'CLUB_ADMIN' then 'CLUB_ADMIN' else 'FIXTURES_SECRETARY' end,
      null, 'INVITATION', null, jsonb_build_object('invitation_id', v_inv.id));
  end if;

  for v_item in
    select it.team_id, it.team_permission
    from public.invitation_teams it
    join public.teams t on t.id = it.team_id and t.club_id = v_inv.club_id and t.active
    where it.invitation_id = v_inv.id
  loop
    if v_item.team_permission = 'view_only' then
      -- View Only never gave team authority; record it for review rather
      -- than inventing a role.
      insert into public.access_review_items (kind, user_id, club_id, team_id, membership_id, detail)
      values ('VIEW_ONLY_UNRESOLVED', auth.uid(), v_inv.club_id, v_item.team_id, v_membership_id, jsonb_build_object('invitation_id', v_inv.id))
      on conflict do nothing;
    else
      perform internal.apply_team_access(v_membership_id, v_item.team_id, v_item.team_permission, 'INVITATION', null,
        jsonb_build_object('invitation_id', v_inv.id));
    end if;
  end loop;

  update public.invitations
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_inv.id;

  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id, 'club_invitation_accepted', 'Invitation accepted',
    format('%s accepted your invitation.', coalesce(p.first_name || ' ' || p.surname, 'A new member')),
    jsonb_build_object('club_id', v_inv.club_id, 'invitation_id', v_inv.id)
  from public.club_memberships cm
  left join public.profiles p on p.id = auth.uid()
  where cm.club_id = v_inv.club_id and cm.role = 'CLUB_ADMIN' and cm.status = 'active' and cm.user_id <> auth.uid();

  return v_inv.club_id;
end;
$$;

create or replace function public.approve_club_claim(p_claim_id uuid, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim record;
  v_club_id uuid;
  v_club_name text;
  v_rugby_code text;
  v_membership_id uuid;
begin
  if not internal.is_site_admin() then
    raise exception 'Only a site admin may approve a club claim.' using errcode = '42501';
  end if;

  select * into v_claim from public.club_claims where id = p_claim_id for update;
  if v_claim.id is null then
    raise exception 'Claim not found.';
  end if;
  if v_claim.status <> 'pending' then
    raise exception 'Claim is not pending (current status: %).', v_claim.status;
  end if;

  select c.id, cd.name, cd.rugby_code into v_club_id, v_club_name, v_rugby_code from public.clubs c
    join public.club_directory cd on cd.id = c.directory_id
    where c.directory_id = v_claim.directory_id;

  if v_club_id is null then
    select cd.name, cd.rugby_code into v_club_name, v_rugby_code from public.club_directory cd where cd.id = v_claim.directory_id;
    insert into public.clubs (directory_id, slug, status, created_by, updated_by)
    values (v_claim.directory_id, internal.generate_club_slug(v_club_name), 'active', auth.uid(), auth.uid())
    returning id into v_club_id;

    -- A genuinely new club has not been set up yet. An existing club being
    -- re-claimed keeps whatever state it already had.
    insert into public.club_setup_state (club_id, status, current_step)
    values (v_club_id, 'NOT_STARTED', 1)
    on conflict (club_id) do nothing;
  end if;

  perform internal.lock_club_people(v_club_id);
  v_membership_id := internal.admit_club_member(v_club_id, v_claim.claimant_user_id, 'CLAIM_APPROVAL', p_notes, null, null);
  perform internal.grant_role(v_membership_id, 'CLUB_ADMIN', null, 'CLAIM_APPROVAL', p_notes, jsonb_build_object('claim_id', p_claim_id));

  perform internal.seed_teams_from_proposal(v_club_id, v_rugby_code, v_claim.proposed_teams);

  perform internal.reconcile_partner_invitations(v_claim.directory_id, v_club_id, v_claim.created_at);

  perform internal.begin_club_platform_trial(v_club_id);

  update public.club_claims
  set status = 'verified', decided_by = auth.uid(), decided_at = now(), review_notes = p_notes
  where id = p_claim_id;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_claim.claimant_user_id,
    'club_claim_approved',
    'Club claim approved',
    format('Your access to %s has been approved.', v_club_name),
    jsonb_build_object('club_id', v_club_id, 'claim_id', p_claim_id)
  );

  return v_club_id;
end;
$$;

create or replace function public.accept_safeguarding_officer_invitation(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.club_safeguarding_officer_invitations;
  v_officer public.club_safeguarding_officers;
  v_membership_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to accept this invitation.' using errcode = '42501';
  end if;

  select * into v_inv from public.club_safeguarding_officer_invitations where token = p_token for update;
  if not found then
    raise exception 'Invitation not found.';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'Invitation is not pending (current status: %).', v_inv.status;
  end if;
  if v_inv.expires_at < now() then
    update public.club_safeguarding_officer_invitations set status = 'expired' where id = v_inv.id;
    raise exception 'Invitation has expired.';
  end if;
  if lower(coalesce(auth.email(), '')) <> lower(v_inv.invited_email) then
    raise exception 'This invitation was sent to a different email address than the one you are signed in as.' using errcode = '42501';
  end if;

  update public.club_safeguarding_officers
  set user_id = auth.uid(), status = 'active', activated_at = now(), updated_by = auth.uid(), updated_at = now()
  where id = v_inv.officer_id
  returning * into v_officer;

  perform internal.lock_club_people(v_inv.club_id);
  v_membership_id := internal.admit_club_member(v_inv.club_id, auth.uid(), 'SAFEGUARDING_APPOINTMENT', null, null, null);
  -- The club's nomination and the officer's own email-bound acceptance are
  -- the confirmation.
  perform internal.grant_role(v_membership_id, 'SAFEGUARDING_OFFICER', null, 'SAFEGUARDING_APPOINTMENT', null,
    jsonb_build_object('safeguarding_officer_id', v_inv.officer_id, 'officer_type', v_officer.officer_type,
                       'confirmation_basis', 'NOMINATION_AND_ACCEPTANCE'));

  update public.club_safeguarding_officer_invitations
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_inv.id;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_inv.invited_by,
    'safeguarding_officer_invitation_accepted',
    'Safeguarding Officer invitation accepted',
    format('Your Safeguarding Officer invitation for %s was accepted.', v_inv.invited_email),
    jsonb_build_object('officer_id', v_inv.officer_id, 'invitation_id', v_inv.id)
  );
end;
$$;

create or replace function public.deactivate_safeguarding_officer(p_officer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_officer public.club_safeguarding_officers;
  v_row record;
begin
  select * into v_officer from public.club_safeguarding_officers where id = p_officer_id for update;
  if not found then
    raise exception 'Safeguarding Officer assignment not found.';
  end if;
  if not internal.has_capability('club.safeguarding.manage_contact', 'club', v_officer.club_id) then
    raise exception 'Not authorized to manage this club''s Safeguarding Officer.' using errcode = '42501';
  end if;

  update public.club_safeguarding_officers
  set status = 'inactive', deactivated_by = auth.uid(), deactivated_at = now(), updated_by = auth.uid(), updated_at = now()
  where id = p_officer_id;

  update public.club_safeguarding_officer_invitations
  set status = 'revoked', revoked_by = auth.uid(), revoked_at = now()
  where officer_id = p_officer_id and status = 'pending';

  if v_officer.user_id is not null then
    update public.capability_overrides
    set status = 'revoked', revoked_by = auth.uid(), revoked_at = now(), updated_at = now()
    where user_id = v_officer.user_id and scope_type = 'club' and club_id = v_officer.club_id
      and capability_key in ('club.dispensation.view', 'club.dispensation.notify', 'club.transfer.safeguarding_view', 'club.transfer.safeguarding_notify')
      and status = 'active';

    for v_row in
      select id from public.role_assignments
      where club_id = v_officer.club_id and user_id = v_officer.user_id and role_key = 'SAFEGUARDING_OFFICER' and state <> 'REVOKED'
        and (attributes ->> 'safeguarding_officer_id' = p_officer_id::text
             or not exists (select 1 from public.club_safeguarding_officers o
                            where o.club_id = v_officer.club_id and o.user_id = v_officer.user_id and o.status = 'active' and o.id <> p_officer_id))
    loop
      perform internal.end_role(v_row.id, 'REVOKED', 'Safeguarding Officer deactivated', null);
    end loop;
  end if;
end;
$$;

-- Staff follow the cohort at season handover: the ACTIVE Coach, Team Manager
-- and Team Administration roles on the source team are given on the new team,
-- with their own provenance.
create or replace function internal.apply_planned_team(p_planned_id uuid, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pt public.age_grade_rollover_planned_teams;
  r public.age_grade_rollovers;
  ctt public.canonical_team_types;
  v_existing public.teams;
  v_label text;
  v_id uuid;
  v_reactivated boolean := false;
  v_staff integer := 0;
  v_member record;
  v_role record;
begin
  select * into pt from public.age_grade_rollover_planned_teams where id = p_planned_id for update;
  if pt.applied_at is not null then return pt.created_team_id; end if;
  select * into r from public.age_grade_rollovers where id = pt.rollover_id;
  select * into ctt from public.canonical_team_types where id = pt.canonical_team_type_id;

  v_label := ctt.label || case when pt.squad_designation is null then '' else ' ' || pt.squad_designation end;

  -- Adopt before creating. A team the club folded keeps its stable id and
  -- everything attached to it, so reactivating is always better than standing
  -- a second one beside it -- and the identity_key constraint would refuse the
  -- second one anyway.
  select * into v_existing from public.teams
  where club_id = r.club_id and rugby_code = r.rugby_code
    and category = ctt.category and age_group = ctt.age_group
    and gender is not distinct from ctt.gender
    and squad_designation is not distinct from pt.squad_designation
  order by active desc, created_at asc
  limit 1;

  if v_existing.id is not null then
    v_id := v_existing.id;
    if not v_existing.active then
      update public.teams
      set active = true, archived_at = null, archived_by = null,
          folded_at = null, folded_by = null, fold_reason = null,
          display_name = v_label, updated_by = p_actor
      where id = v_id;
      v_reactivated := true;
    end if;
  else
    insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation,
                              display_name, slug, created_by, updated_by)
    values (r.club_id, r.rugby_code, ctt.category, ctt.age_group, ctt.gender, pt.squad_designation,
            v_label,
            trim(both '-' from regexp_replace(lower(v_label), '[^a-z0-9]+', '-', 'g'))
              || '-' || substr(gen_random_uuid()::text, 1, 8),
            p_actor, p_actor)
    returning id into v_id;
  end if;

  -- Staff follow the cohort. A progressing team keeps its own id and so keeps
  -- its staff automatically; a newly created one would start with nobody.
  -- Never into an adult team, and never around a safeguarding check: these are
  -- existing club memberships being given a team assignment, not new people.
  -- A person who already has a role on the new team keeps what they have.
  if pt.source_team_id is not null and ctt.category = 'youth' and v_id <> pt.source_team_id then
    for v_member in
      select distinct ra.membership_id
      from public.role_assignments ra
      join public.club_memberships cm on cm.id = ra.membership_id and cm.state = 'ACTIVE'
      where ra.team_id = pt.source_team_id and ra.state = 'ACTIVE'
        and ra.role_key in ('COACH', 'TEAM_MANAGER', 'TEAM_ADMINISTRATION')
        and not internal.person_is_minor(ra.user_id)
        and not exists (
          select 1 from public.role_assignments x
          where x.membership_id = ra.membership_id and x.team_id = v_id and x.state <> 'REVOKED'
            and x.role_key in ('COACH', 'TEAM_MANAGER', 'TEAM_ADMINISTRATION'))
    loop
      for v_role in
        select ra.role_key from public.role_assignments ra
        where ra.membership_id = v_member.membership_id and ra.team_id = pt.source_team_id and ra.state = 'ACTIVE'
          and ra.role_key in ('COACH', 'TEAM_MANAGER', 'TEAM_ADMINISTRATION')
        order by case ra.role_key when 'TEAM_ADMINISTRATION' then 2 else 1 end
      loop
        perform internal.grant_role(v_member.membership_id, v_role.role_key, v_id, 'SEASON_HANDOVER', null,
          jsonb_build_object('carried_from_team_id', pt.source_team_id, 'rollover_id', r.id));
      end loop;
      v_staff := v_staff + 1;
    end loop;
  end if;

  update public.age_grade_rollover_planned_teams
  set created_team_id = v_id, reactivated = v_reactivated, applied_at = now()
  where id = p_planned_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('teams', v_id, case when v_reactivated then 'update' else 'insert' end, p_actor,
    jsonb_build_object('event', case when v_reactivated then 'HANDOVER_TEAM_REACTIVATED' else 'HANDOVER_TEAM_CREATED' end,
                       'rollover_id', r.id, 'planned_team_id', p_planned_id, 'origin', pt.origin,
                       'source_team_id', pt.source_team_id, 'staff_carried_over', v_staff,
                       'target_season_id', r.to_season_id));

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. The browser no longer edits membership rows directly
-- ---------------------------------------------------------------------

revoke update (role, status, updated_by, updated_at, club_role_title, assigned_group_id) on public.club_memberships from authenticated;
revoke update on public.club_memberships from authenticated;
drop policy if exists club_memberships_update_scoped on public.club_memberships;
