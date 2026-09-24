-- CA-M4 -- ROLES & PERMISSIONS: A PERMISSION SAYS WHAT THE SERVER ENFORCES.
--
-- Before a switch is offered to a Club Admin, the operation behind it must ask the capability the switch
-- names. The audit that preceded this migration found three that did not, and this migration closes them
-- in the domain that owns each:
--
--   1. Suspending, restoring and removing a membership were authorised through people.role.assign_club
--      (internal.club_people_authority). They now ask people.membership.suspend and
--      people.membership.revoke, the keys the catalogue names for them. Nothing is broadened: both keys
--      are grant_level 'N' and only the Club Admin bundle holds them, exactly the holder set of the old
--      check. What is new is that a Site Admin withhold of either key now bites.
--   2. cancel_fixture asked internal.can_submit_fixture_result -- the RESULT key -- so a withhold of
--      fixture.fixture.cancel changed nothing. It now asks fixture.fixture.cancel through
--      internal.can_cancel_fixture, the same shape (either side's team or club, or Ovalball support).
--   3. The pitch allocation tables were guarded by the legacy fixture.edit key, so the Pitch Allocation
--      switches decided nothing. They now ask venue.pitch_allocation.manage (writes) and .view (reads).
--
-- Then the permission model itself:
--
--   4. R. people.capability.manage, people.membership.suspend and people.membership.revoke are declared
--      'R' in the catalogue and were never enforced for club work. set_capability_override,
--      revoke_capability_override (and, through it, apply_capability_preset) and transition_club_membership
--      now call internal.require_recent_aal2('10 minutes') AFTER the authority decision: a person without
--      the capability is refused as such; a person with it and no code entered in the last ten minutes is
--      told to enter one. Both clients inherit this from the one place.
--   5. A TEAM decision names somebody who currently works with that team. set_capability_override refuses
--      a team scope for a person with no active role on the team, and the engine's rule 5 stops honouring
--      a TEAM allow once that role has gone (TEAM_ROLE_LAPSED) -- no grant outlives the relationship.
--   6. One read model for both clients: internal.person_capability_rows answers, per capability, the role
--      default (what the bundles supply, ignoring decisions), the explicit decision (effect, level, reason,
--      when, by whom, until when), the effective result with the engine's rule and reason, and whether the
--      caller may decide it here. club_member_capabilities and club_team_capabilities (the website's grids)
--      are re-expressed over it, and club_person_permissions asks it for one person at one scope.
--      club_person_permission_scopes lists the scopes a decision about a person can name.
--
-- Forward-only. No applied migration is edited. The engine's precedence is unchanged except for 5.

-- ================================================================================================
-- 1. Membership operations ask the capability the catalogue names for them
-- ================================================================================================

create or replace function internal.club_membership_authority(p_club_id uuid, p_capability text)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when internal.can(p_capability, 'club', p_club_id, null, null) then 'CLUB'
    when internal.has_site_capability('site.club_roles.manage') then 'SITE'
  end;
$$;
comment on function internal.club_membership_authority(uuid, text) is
  'CA-M4: the level at which the caller may change a membership, decided by the named capability (people.membership.suspend / people.membership.revoke) or the site master.';

CREATE OR REPLACE FUNCTION public.transition_club_membership(p_membership_id uuid, p_to_state text, p_reason text DEFAULT NULL::text, p_allow_no_club_admin boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- CA-M4: the operation asks the capability the catalogue names for it, not the club-role key.
  v_level := case when p_to_state = 'REVOKED' then internal.club_membership_authority(v_club, 'people.membership.revoke')
                  else internal.club_membership_authority(v_club, 'people.membership.suspend') end;
  v_self := v_membership.user_id = auth.uid();

  if p_to_state = 'REVOKED' then
    if v_level is null and not v_self then
      raise exception 'You are not authorised to remove people from this club.' using errcode = '42501';
    end if;
    if v_membership.state not in ('ACTIVE', 'SUSPENDED') then
      raise exception 'This membership is not active, so there is nothing to remove.' using errcode = '23514';
    end if;
    -- R (people.membership.revoke): removing somebody else needs a code entered within the last ten minutes.
    if not v_self then perform internal.require_recent_aal2(interval '10 minutes'); end if;
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
    -- R (people.membership.suspend).
    perform internal.require_recent_aal2(interval '10 minutes');
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
    -- R (people.membership.suspend): a restore is the same authority as the suspension it undoes.
    perform internal.require_recent_aal2(interval '10 minutes');
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
$function$;

-- ================================================================================================
-- 2. Cancelling a fixture asks fixture.fixture.cancel
-- ================================================================================================

create or replace function internal.can_cancel_fixture(p_fixture_id uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
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
  -- Either side's fixture staff may call the match off: the team itself, or its club.
  return internal.can('fixture.fixture.cancel', 'team', v_own_club, f.owning_team_id, null)
      or internal.can('fixture.fixture.cancel', 'club', v_own_club, null, null)
      or (f.opponent_team_id is not null and (
            internal.can('fixture.fixture.cancel', 'team', v_opp_club, f.opponent_team_id, null)
            or internal.can('fixture.fixture.cancel', 'club', v_opp_club, null, null)))
      or internal.has_site_capability('site.fixtures.support');
end;
$$;

create or replace function public.cancel_fixture(p_fixture_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = 'public'
as $$
declare
  f public.fixtures;
begin
  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;

  -- CA-M4: the CANCEL key, not the result key, decides who may call a match off.
  if not internal.can_cancel_fixture(p_fixture_id) then
    raise exception 'You are not authorized to cancel this fixture.' using errcode = '42501';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to cancel a fixture.';
  end if;

  if f.status = 'Cancelled' then
    raise exception 'This fixture is already cancelled.';
  end if;

  if f.archived_at is not null then
    raise exception 'This fixture has been archived -- restore it before cancelling.';
  end if;

  update public.fixtures
  set status = 'Cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancellation_reason = trim(p_reason)
  where id = p_fixture_id;

  if f.mirror_fixture_id is not null then
    update public.fixtures
    set status = 'Cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
        cancellation_reason = format('Cancelled by the opposing club: %s', trim(p_reason))
    where id = f.mirror_fixture_id and status <> 'Cancelled';
  end if;

  perform internal.fixture_result_system_event(p_fixture_id, auth.uid(), format('This fixture has been cancelled. Reason: %s', trim(p_reason)));
  perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_cancelled', 'Fixture cancelled',
    format('The fixture on %s has been cancelled. Reason: %s', to_char(f.kickoff_date, 'DD Mon YYYY'), trim(p_reason)));
end;
$$;

-- ================================================================================================
-- 3. Pitch allocation asks venue.pitch_allocation.manage / .view
-- ================================================================================================

drop policy if exists pitch_allocation_proposals_insert on public.pitch_allocation_proposals;
drop policy if exists pitch_allocation_proposals_select on public.pitch_allocation_proposals;
drop policy if exists pitch_allocation_proposals_update on public.pitch_allocation_proposals;
drop policy if exists pitch_allocation_proposal_items_insert on public.pitch_allocation_proposal_items;
drop policy if exists pitch_allocation_proposal_items_select on public.pitch_allocation_proposal_items;
drop policy if exists pitch_allocation_proposal_items_delete on public.pitch_allocation_proposal_items;

create policy pitch_allocation_proposals_select on public.pitch_allocation_proposals for select
  using (internal.can('venue.pitch_allocation.view', 'club', club_id, null, null)
         or internal.can('venue.pitch_allocation.manage', 'club', club_id, null, null)
         or internal.has_site_capability('site.fixtures.support'));
create policy pitch_allocation_proposals_insert on public.pitch_allocation_proposals for insert
  with check (internal.can('venue.pitch_allocation.manage', 'club', club_id, null, null)
              or internal.has_site_capability('site.fixtures.support'));
create policy pitch_allocation_proposals_update on public.pitch_allocation_proposals for update
  using (internal.can('venue.pitch_allocation.manage', 'club', club_id, null, null)
         or internal.has_site_capability('site.fixtures.support'));

create policy pitch_allocation_proposal_items_select on public.pitch_allocation_proposal_items for select
  using (exists (select 1 from public.pitch_allocation_proposals p where p.id = proposal_id
                   and (internal.can('venue.pitch_allocation.view', 'club', p.club_id, null, null)
                        or internal.can('venue.pitch_allocation.manage', 'club', p.club_id, null, null)
                        or internal.has_site_capability('site.fixtures.support'))));
create policy pitch_allocation_proposal_items_insert on public.pitch_allocation_proposal_items for insert
  with check (exists (select 1 from public.pitch_allocation_proposals p where p.id = proposal_id
                        and (internal.can('venue.pitch_allocation.manage', 'club', p.club_id, null, null)
                             or internal.has_site_capability('site.fixtures.support'))));
create policy pitch_allocation_proposal_items_delete on public.pitch_allocation_proposal_items for delete
  using (exists (select 1 from public.pitch_allocation_proposals p where p.id = proposal_id
                   and (internal.can('venue.pitch_allocation.manage', 'club', p.club_id, null, null)
                        or internal.has_site_capability('site.fixtures.support'))));

-- ================================================================================================
-- 4 + 5. R on the permission decisions; a TEAM decision is about the team's own staff
-- ================================================================================================

CREATE OR REPLACE FUNCTION internal.capability_decision(p_subject uuid, p_key text, p_scope_type text, p_club uuid DEFAULT NULL::uuid, p_team uuid DEFAULT NULL::uuid, p_player uuid DEFAULT NULL::uuid, p_check_session boolean DEFAULT true, p_trace boolean DEFAULT false, OUT allowed boolean, OUT decisive_rule text, OUT reason_code text, OUT decisive_source jsonb, OUT trail jsonb)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.capabilities;
  v_club uuid := p_club;
  v_team_active boolean;
  v_is_view boolean;
  v_impersonation text;
  v_override public.capability_overrides;
  v_source jsonb;
  v_rank int;
  v_membership_state text;
  v_club_status text;
  v_has_overrides boolean;
begin
  allowed := false;
  trail := '[]'::jsonb;

  -- rule 0: session
  if p_subject is null then
    decisive_rule := '0'; reason_code := 'NO_SUBJECT'; return;
  end if;
  if p_check_session and p_subject = auth.uid() and not internal.session_live() then
    decisive_rule := '0'; reason_code := 'SESSION'; return;
  end if;
  if p_trace then trail := trail || jsonb_build_object('rule', '0', 'result', 'pass'); end if;

  -- rule 1: hard prohibitions
  select * into c from public.capabilities where key = p_key;
  if c.key is null then
    decisive_rule := '1'; reason_code := 'UNKNOWN_CAPABILITY'; return;
  end if;
  if c.status <> 'ACTIVE' then
    decisive_rule := '1'; reason_code := 'CAPABILITY_RETIRED'; return;
  end if;
  if p_scope_type = 'organisation' then
    decisive_rule := '1'; reason_code := 'SCOPE_NOT_IMPLEMENTED'; return;
  end if;
  if p_scope_type is null or p_scope_type not in ('self', 'child', 'team', 'club', 'site') or not (p_scope_type = any (c.valid_scopes)) then
    decisive_rule := '1'; reason_code := 'OUT_OF_SCOPE'; return;
  end if;
  case p_scope_type
    when 'site' then
      if p_club is not null or p_team is not null or p_player is not null then
        decisive_rule := '1'; reason_code := 'SCOPE_MALFORMED'; return;
      end if;
    when 'club' then
      if p_club is null or p_team is not null or p_player is not null then
        decisive_rule := '1'; reason_code := 'SCOPE_MALFORMED'; return;
      end if;
    when 'team' then
      if p_team is null or p_player is not null then
        decisive_rule := '1'; reason_code := 'SCOPE_MALFORMED'; return;
      end if;
      select t.club_id, t.active into v_club, v_team_active from public.teams t where t.id = p_team;
      if v_club is null then
        decisive_rule := '1'; reason_code := 'SCOPE_MALFORMED'; return;
      end if;
      if p_club is not null and p_club <> v_club then
        decisive_rule := '1'; reason_code := 'SCOPE_TAMPERED'; return;
      end if;
    when 'child' then
      if p_player is null or p_club is not null or p_team is not null
         or not exists (select 1 from public.players pl where pl.id = p_player) then
        decisive_rule := '1'; reason_code := 'SCOPE_MALFORMED'; return;
      end if;
    when 'self' then
      if p_club is not null or p_team is not null then
        decisive_rule := '1'; reason_code := 'SCOPE_MALFORMED'; return;
      end if;
  end case;

  if not internal.is_account_active(p_subject) then
    decisive_rule := '1'; reason_code := 'ACCOUNT_INACTIVE'; return;
  end if;

  v_is_view := coalesce(c.action, '') ~ '^view';
  v_impersonation := case when p_subject = auth.uid() then internal.impersonation_mode() end;
  if v_impersonation = 'VIEW' and not v_is_view then
    decisive_rule := '1'; reason_code := 'IMPERSONATION_VIEW_ONLY'; return;
  end if;
  if v_impersonation is not null and c.impersonation_blocked then
    decisive_rule := '1'; reason_code := 'IMPERSONATION_BLOCKED'; return;
  end if;

  if c.minor_prohibited and internal.person_is_minor(p_subject) then
    decisive_rule := '1'; reason_code := 'MINOR_PROHIBITED'; return;
  end if;

  if v_club is not null then
    select cl.status, (select cm.state from public.club_memberships cm
                       where cm.club_id = v_club and cm.user_id = p_subject and cm.state in ('ACTIVE', 'SUSPENDED') limit 1)
    into v_club_status, v_membership_state
    from public.clubs cl where cl.id = v_club;
    if v_club_status is distinct from 'active' then
      decisive_rule := '1'; reason_code := 'CLUB_INACTIVE'; return;
    end if;
    if v_membership_state = 'SUSPENDED' then
      decisive_rule := '1'; reason_code := 'MEMBERSHIP_SUSPENDED'; return;
    end if;
  end if;
  if p_trace then trail := trail || jsonb_build_object('rule', '1', 'result', 'pass'); end if;

  -- site scope: overrides never target site capabilities (K.3); only rule 7 can allow.
  if p_scope_type = 'site' then
    v_source := internal.subject_site_capability(p_subject, p_key);
    if v_source is not null then
      allowed := true; decisive_rule := '7'; reason_code := 'SITE_CAPABILITY'; decisive_source := v_source;
      if p_trace then trail := trail || jsonb_build_object('rule', '7', 'result', 'allow', 'source', v_source); end if;
      return;
    end if;
    decisive_rule := '8'; reason_code := 'DEFAULT_DENY';
    if p_trace then trail := trail || jsonb_build_object('rule', '8', 'result', 'deny'); end if;
    return;
  end if;

  -- rules 2-5 read decisions only when the person has one for this key (one index probe otherwise)
  v_has_overrides := exists (select 1 from public.capability_overrides o
                             where o.user_id = p_subject and o.capability_key = p_key and o.status = 'active');

  -- rules 2-4: explicit withholds, most senior level first
  select o.* into v_override
  from public.capability_overrides o
  where v_has_overrides and o.user_id = p_subject and o.capability_key = p_key and o.status = 'active' and o.effect = 'deny'
    and (o.expires_at is null or o.expires_at > now())
    and (
      (o.granted_level = 'SITE' and (o.scope_type = 'site'
         or (o.club_id = v_club and (o.scope_type = 'club' or o.team_id = p_team))))
      or (o.granted_level = 'CLUB' and o.club_id = v_club
         and ((o.scope_type = 'club' and (p_scope_type = 'club' or c.inherits_to_team)) or (o.scope_type = 'team' and o.team_id = p_team)))
      or (o.granted_level = 'TEAM' and o.scope_type = 'team' and o.team_id = p_team)
    )
  order by case o.granted_level when 'SITE' then 1 when 'CLUB' then 2 else 3 end
  limit 1;
  if v_override.id is not null then
    decisive_rule := case v_override.granted_level when 'SITE' then '2' when 'CLUB' then '3' else '4' end;
    reason_code := 'EXPLICIT_DENY';
    decisive_source := jsonb_build_object('kind', 'OVERRIDE', 'override_id', v_override.id, 'level', v_override.granted_level,
      'scope_type', v_override.scope_type, 'club_id', v_override.club_id, 'team_id', v_override.team_id,
      'granted_by', v_override.granted_by, 'granted_at', v_override.granted_at, 'reason', v_override.reason);
    if p_trace then trail := trail || jsonb_build_object('rule', decisive_rule, 'result', 'deny', 'source', decisive_source); end if;
    return;
  end if;
  if p_trace then trail := trail || jsonb_build_object('rule', '2-4', 'result', 'pass'); end if;

  -- rule 5: explicit allows, re-validated against the grantor's authority now
  for v_override in
    select o.* from public.capability_overrides o
    where v_has_overrides and o.user_id = p_subject and o.capability_key = p_key and o.status = 'active' and o.effect = 'grant'
      and (o.expires_at is null or o.expires_at > now())
      and p_scope_type in ('club', 'team')
      and (
        (o.scope_type = 'site' and o.granted_level = 'SITE')
        or (o.scope_type = 'club' and o.club_id = v_club and (p_scope_type = 'club' or c.inherits_to_team))
        or (o.scope_type = 'team' and p_scope_type = 'team' and o.team_id = p_team)
      )
    order by case o.granted_level when 'SITE' then 1 when 'CLUB' then 2 else 3 end
  loop
    v_source := jsonb_build_object('kind', 'OVERRIDE', 'override_id', v_override.id, 'level', v_override.granted_level,
      'scope_type', v_override.scope_type, 'club_id', v_override.club_id, 'team_id', v_override.team_id,
      'granted_by', v_override.granted_by, 'granted_at', v_override.granted_at, 'reason', v_override.reason);
    if v_membership_state is distinct from 'ACTIVE' then
      if p_trace then trail := trail || jsonb_build_object('rule', '5', 'result', 'ignored', 'why', 'MEMBERSHIP_INACTIVE', 'source', v_source); end if;
      continue;
    end if;
    if v_override.granted_level = 'SITE' then
      allowed := true; decisive_rule := '5'; reason_code := 'EXPLICIT_ALLOW'; decisive_source := v_source;
      if p_trace then trail := trail || jsonb_build_object('rule', '5', 'result', 'allow', 'source', v_source); end if;
      return;
    end if;
    -- CA-M4: a TEAM decision is about somebody who works with the team. When the person no longer holds
    -- a role on that team, the allow stops answering -- it is not an orphaned grant that outlives the
    -- relationship it was made for. (A withhold is harmless and simply adjusts nothing.)
    if v_override.scope_type = 'team' and not exists (
      select 1 from public.role_assignments ra
      join public.club_memberships cm on cm.id = ra.membership_id and cm.state = 'ACTIVE'
      where ra.user_id = p_subject and ra.team_id = v_override.team_id and ra.state = 'ACTIVE') then
      if p_trace then trail := trail || jsonb_build_object('rule', '5', 'result', 'ignored', 'why', 'TEAM_ROLE_LAPSED', 'source', v_source); end if;
      continue;
    end if;
    -- a club or team delegate: the key must be delegable at that level, not safeguarding-sensitive,
    -- and the grantor must still hold both the delegation authority and the key itself.
    if not c.delegable or c.safeguarding_sensitive
       or (v_override.granted_level = 'CLUB' and c.grant_level not in ('C', 'T'))
       or (v_override.granted_level = 'TEAM' and c.grant_level <> 'T')
       or v_override.granted_by is null
       or not internal.is_account_active(v_override.granted_by)
       or internal.bundle_source(v_override.granted_by, 'people.capability.manage', v_override.scope_type, v_override.club_id,
            v_override.team_id, null, true) is null
       or internal.bundle_source(v_override.granted_by, p_key, v_override.scope_type, v_override.club_id,
            v_override.team_id, null, c.inherits_to_team) is null
       or exists (select 1 from public.club_memberships gm where gm.club_id = v_override.club_id and gm.user_id = v_override.granted_by and gm.state = 'SUSPENDED')
    then
      if p_trace then trail := trail || jsonb_build_object('rule', '5', 'result', 'ignored', 'why', 'GRANTOR_AUTHORITY_LAPSED', 'source', v_source); end if;
      continue;
    end if;
    allowed := true; decisive_rule := '5'; reason_code := 'EXPLICIT_ALLOW'; decisive_source := v_source;
    if p_trace then trail := trail || jsonb_build_object('rule', '5', 'result', 'allow', 'source', v_source); end if;
    return;
  end loop;

  -- rule 6: role bundle or relationship
  v_source := internal.bundle_source(p_subject, p_key, p_scope_type, v_club, p_team, p_player, c.inherits_to_team);
  if v_source is not null then
    allowed := true; decisive_rule := '6'; reason_code := 'ROLE_BUNDLE'; decisive_source := v_source;
    if p_trace then trail := trail || jsonb_build_object('rule', '6', 'result', 'allow', 'source', v_source); end if;
    return;
  end if;

  -- rule 8: default deny, naming the nearest reason for explanation (P05: a suspended role gives nothing)
  decisive_rule := '8';
  v_source := case when p_scope_type in ('club', 'team')
    then internal.bundle_source(p_subject, p_key, p_scope_type, v_club, p_team, p_player, c.inherits_to_team, 'SUSPENDED') end;
  if v_source is not null then
    reason_code := 'ROLE_SUSPENDED'; decisive_source := v_source;
  elsif p_scope_type in ('club', 'team') and v_membership_state is null
        and exists (select 1 from public.club_memberships cm where cm.club_id = v_club and cm.user_id = p_subject) then
    reason_code := 'MEMBERSHIP_INACTIVE';
  elsif p_scope_type = 'child' and internal.player_is_adult(p_player)
        and exists (select 1 from public.guardians g where g.guardian_user_id = p_subject and g.player_id = p_player and g.state = 'ACTIVE') then
    reason_code := 'ADULT_PLAYER';
  else
    reason_code := 'DEFAULT_DENY';
  end if;
  if p_trace then trail := trail || jsonb_build_object('rule', '8', 'result', 'deny', 'reason', reason_code); end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_capability_override(p_user_id uuid, p_capability_key text, p_scope_type text, p_club_id uuid, p_team_id uuid, p_effect text, p_reason text DEFAULT NULL::text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := internal.actor();
  v_key text;
  c public.capabilities;
  v_team_club uuid;
  v_level text;
  v_existing public.capability_overrides;
  v_blocking public.capability_overrides;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  perform internal.require_not_impersonating();
  if p_effect not in ('grant', 'deny') then
    raise exception 'Choose whether to allow or withhold.' using errcode = '22023';
  end if;
  if p_scope_type not in ('club', 'team', 'site') then
    raise exception 'Invalid scope.' using errcode = '22023';
  end if;
  if p_scope_type = 'team' then
    select t.club_id into v_team_club from public.teams t where t.id = p_team_id;
    if p_club_id is null or p_team_id is null or v_team_club is distinct from p_club_id then
      raise exception 'You are not authorised to do that.' using errcode = '42501';
    end if;
  elsif p_scope_type = 'club' and (p_club_id is null or p_team_id is not null) then
    raise exception 'A club decision names a club and no team.' using errcode = '22023';
  elsif p_scope_type = 'site' and (p_club_id is not null or p_team_id is not null) then
    raise exception 'A site-wide decision names no club or team.' using errcode = '22023';
  end if;

  -- R19 and its neighbours: a club decision is taken in order with that club's membership and role
  -- transitions (the same lock), before anything about the person or the actor is read, so a decision
  -- never races a suspension or the actor's own loss of authority.
  if p_club_id is not null then
    perform internal.lock_club_people(p_club_id);
  end if;

  select m.capability_key into v_key from public.capability_key_map m
  where m.legacy_key = p_capability_key and m.legacy_scope = p_scope_type;
  v_key := coalesce(v_key, p_capability_key);
  select * into c from public.capabilities where key = v_key;
  if c.key is null or c.status <> 'ACTIVE' then
    raise exception 'Unknown capability.' using errcode = '22023';
  end if;
  if c.key like 'site.%' or c.valid_scopes = array['site']::text[] then
    raise exception 'Site capabilities are given through Site Admin profiles, not permission decisions.' using errcode = '22023';
  end if;
  if p_scope_type <> 'site' and not (p_scope_type = any (c.valid_scopes)) then
    raise exception 'That permission does not apply at % level.', p_scope_type using errcode = '23514';
  end if;

  v_level := case when p_scope_type = 'site' then case when internal.has_site_capability('site.capabilities.override') then 'SITE' end
                  else internal.override_authority_level(v_key, p_scope_type, p_club_id, p_team_id) end;
  if v_level is null then
    raise exception 'You are not authorised to change that permission.' using errcode = '42501';
  end if;
  if p_user_id = v_actor then
    raise exception 'You cannot change your own permissions.' using errcode = '42501';
  end if;
  -- R (people.capability.manage / site.capabilities.override): authority first, then recency -- a person
  -- with no authority is refused as such and never asked for a code they could not use.
  perform internal.require_recent_aal2(interval '10 minutes');
  if not internal.is_account_active(p_user_id) then
    raise exception 'That account is not active.' using errcode = '23514';
  end if;
  if p_scope_type in ('club', 'team') and not exists (
    select 1 from public.club_memberships cm where cm.club_id = p_club_id and cm.user_id = p_user_id and cm.state = 'ACTIVE') then
    raise exception 'This person is not an active member of the club -- a permission decision adjusts real authority, it does not create a relationship.' using errcode = '23514';
  end if;
  -- CA-M4: a team decision names somebody who currently works with that team. A stale screen naming a
  -- team the person has since left is refused here, so no decision is recorded against a relationship
  -- that no longer exists.
  if p_scope_type = 'team' and not exists (
    select 1 from public.role_assignments ra
    join public.club_memberships cm on cm.id = ra.membership_id and cm.state = 'ACTIVE'
    where ra.user_id = p_user_id and ra.team_id = p_team_id and ra.state = 'ACTIVE') then
    raise exception 'This person holds no role on that team. A team decision is about somebody who works with the team -- give them a team role first.' using errcode = '23514';
  end if;
  if p_scope_type = 'site' and not exists (select 1 from public.club_memberships cm where cm.user_id = p_user_id and cm.state = 'ACTIVE') then
    raise exception 'This person holds no club membership for a site-wide decision to adjust.' using errcode = '23514';
  end if;
  if p_effect = 'grant' and c.minor_prohibited and not internal.person_is_established_adult(p_user_id) then
    raise exception 'That permission needs a date of birth on file showing this person is an adult.'
      using errcode = '23514', hint = 'AGE_ELIGIBILITY_REQUIRED';
  end if;
  if p_effect = 'grant' and c.minor_prohibited and internal.person_is_minor(p_user_id) then
    raise exception 'That permission cannot be given to someone under 18.' using errcode = '23514';
  end if;
  if p_effect = 'grant' and v_level <> 'SITE' and (c.domain in ('finance', 'people'))
     and exists (select 1 from public.role_assignments ra where ra.user_id = p_user_id and ra.club_id = p_club_id and ra.state = 'ACTIVE' and ra.role_key = 'VOLUNTEER')
     and not exists (select 1 from public.role_assignments ra where ra.user_id = p_user_id and ra.club_id = p_club_id and ra.state = 'ACTIVE'
                     and ra.role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY', 'COACH', 'TEAM_MANAGER', 'SAFEGUARDING_OFFICER')) then
    raise exception 'A Volunteer cannot be given people or finance permissions by the club.' using errcode = '23514';
  end if;
  if p_effect = 'deny' and v_level <> 'SITE' and v_reason is null then
    raise exception 'Give a reason for withholding this permission.' using errcode = '22023';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'The end date must be in the future.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('capability-override:' || p_user_id::text || ':' || v_key, 0));

  select * into v_existing from public.capability_overrides o
  where o.user_id = p_user_id and o.capability_key = v_key and o.scope_type = p_scope_type
    and o.club_id is not distinct from p_club_id and o.team_id is not distinct from p_team_id and o.status = 'active'
  for update;
  if v_existing.id is not null and internal.override_level_rank(v_existing.granted_level) > internal.override_level_rank(v_level) then
    -- a person holding several levels decides at the one the existing decision needs
    v_level := case when p_scope_type = 'site' then v_level
                    else internal.override_authority_level(v_key, p_scope_type, p_club_id, p_team_id, v_existing.granted_level) end;
    if v_level is null then
      raise exception 'Ovalball has already decided this permission at a higher level, so it cannot be changed here.' using errcode = '42501';
    end if;
  end if;
  -- P37: an allow that a more senior withhold at a broader scope would defeat is refused, not recorded.
  if p_effect = 'grant' then
    select * into v_blocking from public.capability_overrides o
    where o.user_id = p_user_id and o.capability_key = v_key and o.status = 'active' and o.effect = 'deny'
      and (o.expires_at is null or o.expires_at > now())
      and o.id is distinct from v_existing.id
      and (internal.override_level_rank(o.granted_level) > internal.override_level_rank(v_level)
           or (o.granted_level = 'SITE' and o.scope_type <> p_scope_type))
      and (o.scope_type = 'site' or (o.club_id = p_club_id and (o.scope_type = 'club' or o.team_id is not distinct from p_team_id)))
    limit 1;
    if v_blocking.id is not null then
      raise exception 'Ovalball has withheld this permission at a higher level, so allowing it here would have no effect.' using errcode = '42501';
    end if;
  end if;

  if v_existing.id is not null then
    update public.capability_overrides
    set status = 'revoked', revoked_by = v_actor, revoked_at = now(), revoked_level = v_level,
        revocation_reason = 'Replaced by a new decision', updated_at = now()
    where id = v_existing.id;
    perform internal.emit_security_event('override.revoked', p_user_id, 'SUCCESS', 'Replaced by a new decision',
      jsonb_build_object('override_id', v_existing.id, 'capability_key', v_key, 'effect', v_existing.effect,
                         'granted_level', v_existing.granted_level, 'revoked_level', v_level, 'scope_type', p_scope_type),
      p_club_id, p_team_id, null);
  end if;

  insert into public.capability_overrides (user_id, capability_key, scope_type, club_id, team_id, effect, reason, granted_by,
                                           granted_level, expires_at)
  values (p_user_id, v_key, p_scope_type, p_club_id, p_team_id, p_effect, v_reason, v_actor, v_level, p_expires_at)
  returning id into v_id;

  perform internal.emit_security_event('override.granted', p_user_id, 'SUCCESS', v_reason,
    jsonb_build_object('override_id', v_id, 'capability_key', v_key, 'effect', p_effect, 'granted_level', v_level,
                       'scope_type', p_scope_type, 'expires_at', p_expires_at),
    p_club_id, p_team_id, null);
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_capability_override(p_override_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := internal.actor();
  v_override public.capability_overrides;
  v_level text;
begin
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  perform internal.require_not_impersonating();
  select * into v_override from public.capability_overrides where id = p_override_id;
  if v_override.id is null then
    raise exception 'You are not authorised to change that permission.' using errcode = '42501';
  end if;
  if v_override.club_id is not null then
    perform internal.lock_club_people(v_override.club_id);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('capability-override:' || v_override.user_id::text || ':' || v_override.capability_key, 0));
  select * into v_override from public.capability_overrides where id = p_override_id for update;

  v_level := case when v_override.scope_type = 'site' then case when internal.has_site_capability('site.capabilities.override') then 'SITE' end
                  else internal.override_authority_level(v_override.capability_key, v_override.scope_type, v_override.club_id, v_override.team_id,
                                                         v_override.granted_level) end;
  if v_level is null then
    raise exception 'You are not authorised to change that permission.' using errcode = '42501';
  end if;
  -- P36: a lower level never removes a higher decision.
  if internal.override_level_rank(v_override.granted_level) > internal.override_level_rank(v_level) then
    raise exception 'Ovalball decided this permission at a higher level, so it cannot be removed here.' using errcode = '42501';
  end if;
  if v_override.user_id = v_actor then
    raise exception 'You cannot change your own permissions.' using errcode = '42501';
  end if;
  -- R: restoring a default is a permission decision like any other.
  perform internal.require_recent_aal2(interval '10 minutes');
  if v_override.status <> 'active' then
    return;
  end if;

  update public.capability_overrides
  set status = 'revoked', revoked_by = v_actor, revoked_at = now(), revoked_level = v_level,
      revocation_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now()
  where id = p_override_id;
  perform internal.emit_security_event('override.revoked', v_override.user_id, 'SUCCESS', nullif(btrim(coalesce(p_reason, '')), ''),
    jsonb_build_object('override_id', v_override.id, 'capability_key', v_override.capability_key, 'effect', v_override.effect,
                       'granted_level', v_override.granted_level, 'revoked_level', v_level, 'scope_type', v_override.scope_type),
    v_override.club_id, v_override.team_id, null);
end;
$function$;

-- ================================================================================================
-- 6. One read model for both clients
-- ================================================================================================

create or replace function internal.person_capability_rows(p_subject uuid, p_scope_type text, p_club uuid, p_team uuid, p_keys text[])
returns table(
  capability_key text, label text, description text, domain text,
  effective boolean, decisive_rule text, reason_code text, source text,
  role_default boolean, role_default_role text,
  override_id uuid, override_effect text, override_level text, override_reason text,
  override_granted_at timestamptz, override_granted_by uuid, override_expires_at timestamptz,
  editable boolean)
language sql stable security definer set search_path = ''
as $$
  with keys as (
    select c.key, c.label, c.description, c.domain, c.inherits_to_team,
           internal.override_authority_level(c.key, p_scope_type, p_club, p_team, 'CLUB') as club_level,
           internal.override_authority_level(c.key, p_scope_type, p_club, p_team, 'SITE') as site_level
    from public.capabilities c
    where c.status = 'ACTIVE' and p_scope_type = any (c.valid_scopes) and c.delegable and c.grant_level in ('C', 'T')
      and not c.safeguarding_sensitive
      and (p_keys is null or c.key = any (
        select coalesce((select m.capability_key from public.capability_key_map m where m.legacy_key = k and m.legacy_scope = p_scope_type), k)
        from unnest(p_keys) k))
  )
  select k.key, k.label, k.description, k.domain,
    d.allowed, d.decisive_rule, d.reason_code,
    case d.reason_code
      when 'ROLE_BUNDLE' then 'role'
      when 'EXPLICIT_ALLOW' then 'granted'
      when 'EXPLICIT_DENY' then case when d.decisive_source ->> 'level' = 'SITE' then 'restricted' else 'denied' end
      else 'none' end,
    -- THE ROLE DEFAULT: what the person's bundles supply at this scope, with every decision ignored.
    b.src is not null,
    case b.src ->> 'kind' when 'ROLE' then rd.label when 'PLAYER' then 'Player' when 'GUARDIAN' then 'Parent/Guardian' else null end,
    o.id, o.effect, o.granted_level, o.reason, o.granted_at, o.granted_by, o.expires_at,
    (p_subject <> internal.actor()
      and case when o.granted_level = 'SITE' then k.site_level is not null else coalesce(k.club_level, k.site_level) is not null end)
  from keys k
  cross join lateral internal.capability_decision(p_subject, k.key, p_scope_type, p_club, p_team, null, false, false) d
  cross join lateral (select internal.bundle_source(p_subject, k.key, p_scope_type, p_club, p_team, null, k.inherits_to_team) as src) b
  left join public.role_definitions rd on rd.role_key = b.src ->> 'role_key'
  left join public.capability_overrides o
    on o.user_id = p_subject and o.capability_key = k.key and o.scope_type = p_scope_type
   and o.club_id = p_club and o.team_id is not distinct from p_team and o.status = 'active';
$$;
comment on function internal.person_capability_rows(uuid, text, uuid, uuid, text[]) is
  'CA-M4: the one computation behind every permission screen -- role default, explicit decision, effective result and editability per delegable capability, for one person at one scope.';

drop function if exists public.club_member_capabilities(uuid, text[]);
create function public.club_member_capabilities(p_club_id uuid, p_capability_keys text[] default null)
returns table(
  user_id uuid, capability_key text, label text, description text, domain text,
  effective boolean, decisive_rule text, reason_code text, source text,
  role_default boolean, role_default_role text,
  override_id uuid, override_effect text, override_level text, override_reason text,
  override_granted_at timestamptz, override_granted_by uuid, override_expires_at timestamptz,
  editable boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_site_view boolean := internal.has_site_capability('site.users.view');
begin
  if not (v_site_view or internal.can('people.capability.manage', 'club', p_club_id, null, null)) then
    raise exception 'You do not have permission to view this club''s capabilities.' using errcode = '42501';
  end if;
  return query
  select m.user_id, r.*
  from (select cm.user_id from public.club_memberships cm where cm.club_id = p_club_id and cm.state = 'ACTIVE') m
  cross join lateral internal.person_capability_rows(m.user_id, 'club', p_club_id, null, p_capability_keys) r;
end;
$$;

drop function if exists public.club_team_capabilities(uuid, uuid, text[]);
create function public.club_team_capabilities(p_club_id uuid, p_team_id uuid, p_capability_keys text[] default null)
returns table(
  user_id uuid, capability_key text, label text, description text, domain text,
  effective boolean, decisive_rule text, reason_code text, source text,
  role_default boolean, role_default_role text,
  override_id uuid, override_effect text, override_level text, override_reason text,
  override_granted_at timestamptz, override_granted_by uuid, override_expires_at timestamptz,
  editable boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_site_view boolean := internal.has_site_capability('site.users.view');
begin
  if not exists (select 1 from public.teams t where t.id = p_team_id and t.club_id = p_club_id) then
    raise exception 'That team does not belong to this club.' using errcode = '22023';
  end if;
  if not (v_site_view or internal.can('people.capability.manage', 'club', p_club_id, null, null)) then
    raise exception 'You do not have permission to view this club''s capabilities.' using errcode = '42501';
  end if;
  return query
  -- THE PEOPLE THIS DECISION IS ABOUT: those with a role on the team (the same rule the write applies).
  select s.user_id, r.*
  from (select distinct ra.user_id
          from public.role_assignments ra
          join public.club_memberships cm on cm.user_id = ra.user_id and cm.club_id = p_club_id and cm.state = 'ACTIVE'
         where ra.team_id = p_team_id and ra.state = 'ACTIVE') s
  cross join lateral internal.person_capability_rows(s.user_id, 'team', p_club_id, p_team_id, p_capability_keys) r;
end;
$$;

create or replace function public.club_person_permissions(p_club_id uuid, p_user_id uuid, p_scope_type text, p_team_id uuid default null, p_capability_keys text[] default null)
returns table(
  capability_key text, label text, description text, domain text,
  effective boolean, decisive_rule text, reason_code text, source text,
  role_default boolean, role_default_role text,
  override_id uuid, override_effect text, override_level text, override_reason text,
  override_granted_at timestamptz, override_granted_by uuid, override_expires_at timestamptz,
  editable boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if p_club_id is null or p_user_id is null then
    raise exception 'A permission question names a club and a person.' using errcode = '22023';
  end if;
  -- Seeing a person's permissions is the same question as explaining their access; deciding them is
  -- people.capability.manage (reflected per row in `editable`). A Site Admin who may view users reads too.
  if not (internal.has_site_capability('site.users.view')
          or internal.can('people.capability.manage', 'club', p_club_id, null, null)
          or internal.can('people.access.explain', 'club', p_club_id, null, null)) then
    raise exception 'You are not authorised to see permissions at this club.' using errcode = '42501';
  end if;
  if p_scope_type not in ('club', 'team') then
    raise exception 'A club decides at club or team scope.' using errcode = '22023';
  end if;
  if p_scope_type = 'club' and p_team_id is not null then
    raise exception 'A club decision names a club and no team.' using errcode = '22023';
  end if;
  if p_scope_type = 'team' and not exists (select 1 from public.teams t where t.id = p_team_id and t.club_id = p_club_id) then
    raise exception 'That team does not belong to this club.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.club_memberships cm where cm.club_id = p_club_id and cm.user_id = p_user_id and cm.state in ('ACTIVE', 'SUSPENDED')) then
    raise exception 'This person is not a member of the club.' using errcode = '22023';
  end if;
  if p_scope_type = 'team' and not exists (
    select 1 from public.role_assignments ra
    join public.club_memberships cm on cm.id = ra.membership_id and cm.state = 'ACTIVE'
    where ra.user_id = p_user_id and ra.team_id = p_team_id and ra.state = 'ACTIVE') then
    raise exception 'This person holds no role on that team. A team decision is about somebody who works with the team -- give them a team role first.' using errcode = '23514';
  end if;
  return query select * from internal.person_capability_rows(p_user_id, p_scope_type, p_club_id, p_team_id, p_capability_keys);
end;
$$;
comment on function public.club_person_permissions(uuid, uuid, text, uuid, text[]) is
  'CA-M4: one person''s delegable permissions at one scope -- role default, explicit decision, effective result and whether the caller may decide it. Read by both clients.';

create or replace function public.club_person_permission_scopes(p_club_id uuid, p_user_id uuid)
returns table(scope_type text, team_id uuid, team_display_name text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not (internal.has_site_capability('site.users.view')
          or internal.can('people.capability.manage', 'club', p_club_id, null, null)
          or internal.can('people.access.explain', 'club', p_club_id, null, null)) then
    raise exception 'You are not authorised to see permissions at this club.' using errcode = '42501';
  end if;
  return query
  select 'club'::text, null::uuid, null::text
  union all
  select 'team'::text, t.id, t.display_name
  from public.teams t
  where t.club_id = p_club_id and t.active and t.folded_at is null and t.archived_at is null
    and exists (select 1 from public.role_assignments ra
                join public.club_memberships cm on cm.id = ra.membership_id and cm.state = 'ACTIVE'
                where ra.user_id = p_user_id and ra.team_id = t.id and ra.state = 'ACTIVE')
  order by 1, 3;
end;
$$;
comment on function public.club_person_permission_scopes(uuid, uuid) is
  'CA-M4: the scopes a decision about this person can name -- the club, and each team they currently hold a role on.';

revoke all on function public.club_member_capabilities(uuid, text[]) from public, anon;
revoke all on function public.club_team_capabilities(uuid, uuid, text[]) from public, anon;
revoke all on function public.club_person_permissions(uuid, uuid, text, uuid, text[]) from public, anon;
revoke all on function public.club_person_permission_scopes(uuid, uuid) from public, anon;
grant execute on function public.club_member_capabilities(uuid, text[]) to authenticated, service_role;
grant execute on function public.club_team_capabilities(uuid, uuid, text[]) to authenticated, service_role;
grant execute on function public.club_person_permissions(uuid, uuid, text, uuid, text[]) to authenticated, service_role;
grant execute on function public.club_person_permission_scopes(uuid, uuid) to authenticated, service_role;

-- ================================================================================================
-- The migration checks its own claims
-- ================================================================================================

do $$
declare
  v_src text;
  v_name text;
begin
  select prosrc into v_src from pg_proc where oid = 'public.transition_club_membership'::regproc;
  if v_src not like '%people.membership.suspend%' or v_src not like '%people.membership.revoke%' or v_src like '%club_people_authority%' then
    raise exception 'transition_club_membership must ask people.membership.suspend / .revoke and nothing else';
  end if;
  if v_src not like '%require_recent_aal2%' then
    raise exception 'transition_club_membership must enforce R';
  end if;
  select prosrc into v_src from pg_proc where oid = 'public.cancel_fixture'::regproc;
  if v_src like '%can_submit_fixture_result%' or v_src not like '%can_cancel_fixture%' then
    raise exception 'cancel_fixture must ask fixture.fixture.cancel';
  end if;
  foreach v_name in array array['public.set_capability_override', 'public.revoke_capability_override'] loop
    if (select prosrc from pg_proc where oid = v_name::regproc) not like '%require_recent_aal2%' then
      raise exception '% must enforce R', v_name;
    end if;
  end loop;
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'internal' and p.proname = 'capability_decision';
  if v_src not like '%TEAM_ROLE_LAPSED%' then
    raise exception 'a TEAM allow must lapse with the team role';
  end if;
  if exists (select 1 from pg_policies where tablename like 'pitch_allocation%' and (coalesce(qual, '') like '%fixture.edit%' or coalesce(with_check, '') like '%fixture.edit%')) then
    raise exception 'pitch allocation must ask venue.pitch_allocation.*';
  end if;
  for v_name in select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where (n.nspname = 'internal' and p.proname in ('club_membership_authority', 'can_cancel_fixture', 'person_capability_rows'))
                   or (n.nspname = 'public' and p.proname in ('club_person_permissions', 'club_person_permission_scopes', 'club_member_capabilities', 'club_team_capabilities'))
  loop
    if exists (select 1 from pg_proc p2 join pg_namespace n2 on n2.oid = p2.pronamespace where p2.proname = v_name and n2.nspname in ('public', 'internal')
               and (p2.prosrc like '%has_capability(%' or p2.prosrc like '%is_own_linked_player%')) then
      raise exception '% must use the canonical resolver', v_name;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.club_person_permissions(uuid, uuid, text, uuid, text[])', 'execute') then
    raise exception 'club_person_permissions must not be executable by anon';
  end if;
end $$;
