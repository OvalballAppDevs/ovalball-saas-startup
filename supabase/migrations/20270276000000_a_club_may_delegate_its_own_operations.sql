-- =====================================================================
-- A CLUB MAY DELEGATE ITS OWN OPERATIONS
--
-- set_capability_override is the canonical way a capability is granted or
-- withheld from one person, and it is careful: it checks the scope shape,
-- that a team really belongs to the named club, and that the person has a
-- real relationship at that scope before narrowing or extending it.
--
-- Its one limitation is who may call it. Today that is Site Admin alone,
-- so "this coach may run training but not fixtures" is a decision no club
-- can actually make about its own people -- the product promises
-- delegation and the server permits none.
--
-- This widens the CALLER, and nothing else. Every validation below the
-- authority check is untouched, so a club delegate is subject to exactly
-- the same rules a Site Admin is.
--
-- FOUR BOUNDARIES MAKE THAT SAFE:
--
--   SCOPE     a club delegate may act only at club or team scope, and only
--             for the club they hold the authority in. Site scope stays
--             Site Admin's alone.
--
--   SUBJECT   only operational capabilities are delegable. The allow-list
--             is explicit rather than "anything not obviously dangerous",
--             so adding a future billing or safeguarding capability does
--             not silently become a club's to hand out.
--
--   NO SELF-ESCALATION  club.capabilities.manage is deliberately NOT
--             delegable. A club administrator cannot mint more people who
--             can grant capabilities, nor strip the authority from a peer
--             and lock the club out of its own permissions screen.
--
--   SITE CEILING  unchanged and automatic: internal.has_capability checks
--             an explicit DENY before anything else, so a site-level
--             denial still wins over a club grant. A club can restrict
--             within what Ovalball allows; it can never exceed it.
-- =====================================================================

create or replace function internal.club_delegable_capability(p_capability_key text)
returns boolean
language sql
immutable
as $$
  select p_capability_key in (
    -- Fixture operations
    'fixture.view',
    'fixture.create',
    'fixture.edit',
    'fixture.cancel',
    'fixture.manage_requests',
    'fixture.import',
    'fixture.bulk_edit',
    -- Training operations
    'club.training.manage',
    'team.training.manage',
    -- Calendar and events
    'calendar.view',
    'calendar.manage'
  );
$$;

comment on function internal.club_delegable_capability(text) is
  'The operational capabilities a club may hand to its own people. Deliberately an explicit list: a capability added later is NOT delegable until somebody decides it should be. club.capabilities.manage is excluded on purpose -- a club administrator must not be able to mint or strip the authority to grant capabilities.';

create or replace function public.set_capability_override(
  p_user_id uuid,
  p_capability_key text,
  p_scope_type text,
  p_club_id uuid,
  p_team_id uuid,
  p_effect text,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_id uuid;
  v_team_club uuid;
  v_has_relationship boolean;
  v_allowed_scopes text[];
  v_is_site_authority boolean;
begin
  v_is_site_authority := internal.can_manage_permissions();

  -- A club administrator holding club.capabilities.manage may delegate the
  -- operational capabilities of their OWN club. Everything else below is
  -- unchanged and applies to them identically.
  if not v_is_site_authority then
    if p_scope_type not in ('club', 'team') or p_club_id is null then
      raise exception 'Only a Full Site Admin, or a Site Admin with the Permission Management capability, can grant or deny capabilities at that scope.' using errcode = '42501';
    end if;
    if not internal.has_capability('club.capabilities.manage', 'club', p_club_id, null) then
      raise exception 'You do not have permission to manage this club''s capabilities.' using errcode = '42501';
    end if;
    if not internal.club_delegable_capability(p_capability_key) then
      raise exception 'That capability is not a club''s to grant.' using errcode = '42501';
    end if;
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You cannot grant or deny your own capabilities.' using errcode = '42501';
  end if;
  if p_effect not in ('grant', 'deny') then
    raise exception 'Invalid effect.';
  end if;

  select applicable_scopes into v_allowed_scopes from public.capabilities where key = p_capability_key;
  if v_allowed_scopes is null then
    raise exception 'Unknown capability.';
  end if;
  if not (p_scope_type = any(v_allowed_scopes)) then
    raise exception 'Capability % cannot be granted at % scope -- it is only valid at: %', p_capability_key, p_scope_type, array_to_string(v_allowed_scopes, ', ') using errcode = '23514';
  end if;

  if p_scope_type = 'team' then
    if p_club_id is null or p_team_id is null then
      raise exception 'A team-scoped grant needs both a club and a team.';
    end if;
    select club_id into v_team_club from public.teams where id = p_team_id;
    if v_team_club is null or v_team_club <> p_club_id then
      raise exception 'That team does not belong to the specified club.' using errcode = '23514';
    end if;
    select exists (
      select 1 from public.club_memberships cm where cm.club_id = p_club_id and cm.user_id = p_user_id and cm.status = 'active'
      union all
      select 1 from public.team_permissions tp join public.club_memberships cm on cm.id = tp.membership_id
      where tp.team_id = p_team_id and cm.user_id = p_user_id and cm.status = 'active'
    ) into v_has_relationship;
  elsif p_scope_type = 'club' then
    if p_club_id is null or p_team_id is not null then
      raise exception 'A club-scoped grant needs exactly a club, no team.';
    end if;
    select exists (select 1 from public.club_memberships cm where cm.club_id = p_club_id and cm.user_id = p_user_id and cm.status = 'active') into v_has_relationship;
  elsif p_scope_type = 'site' then
    if p_club_id is not null or p_team_id is not null then
      raise exception 'A site-scoped grant must not name a club or team.';
    end if;
    select exists (select 1 from public.site_admins where user_id = p_user_id and status = 'active') into v_has_relationship;
  else
    raise exception 'Invalid scope type.';
  end if;

  if not v_has_relationship then
    raise exception 'This person has no existing relationship at that scope -- a capability override narrows or extends real authority, it does not invent a relationship.' using errcode = '23514';
  end if;

  update public.capability_overrides
  set status = 'revoked', revoked_by = auth.uid(), revoked_at = now(), updated_at = now()
  where user_id = p_user_id and capability_key = p_capability_key and scope_type = p_scope_type
    and club_id is not distinct from p_club_id and team_id is not distinct from p_team_id
    and status = 'active';

  insert into public.capability_overrides (user_id, capability_key, scope_type, club_id, team_id, effect, reason, granted_by)
  values (p_user_id, p_capability_key, p_scope_type, p_club_id, p_team_id, p_effect, p_reason, auth.uid())
  returning id into v_id;

  return v_id;
end;
$function$;

comment on function public.set_capability_override(uuid, text, text, uuid, uuid, text, text) is
  'Grants or denies one capability for one person at one scope. Callable by Site Admin permission management, and by a club administrator holding club.capabilities.manage for their own club -- limited to that club, to operational capabilities (internal.club_delegable_capability), and never to the delegation authority itself. Every other validation is identical for both callers, and a site-level deny still wins because internal.has_capability checks denials first.';

-- revoke_capability_override answers the same question in reverse, so it
-- takes the same widening: a club that can grant must be able to undo it.
create or replace function public.revoke_capability_override(p_override_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_override public.capability_overrides;
begin
  select * into v_override from public.capability_overrides where id = p_override_id;
  if not found then
    raise exception 'Override not found.';
  end if;

  if not internal.can_manage_permissions() then
    if v_override.scope_type not in ('club', 'team') or v_override.club_id is null then
      raise exception 'Only a Full Site Admin, or a Site Admin with the Permission Management capability, can revoke that.' using errcode = '42501';
    end if;
    if not internal.has_capability('club.capabilities.manage', 'club', v_override.club_id, null) then
      raise exception 'You do not have permission to manage this club''s capabilities.' using errcode = '42501';
    end if;
    if not internal.club_delegable_capability(v_override.capability_key) then
      raise exception 'That capability is not a club''s to manage.' using errcode = '42501';
    end if;
  end if;

  update public.capability_overrides
  set status = 'revoked', revoked_by = auth.uid(), revoked_at = now(), updated_at = now()
  where id = p_override_id and status = 'active';
end;
$function$;

revoke all on function public.set_capability_override(uuid, text, text, uuid, uuid, text, text) from public, anon;
grant execute on function public.set_capability_override(uuid, text, text, uuid, uuid, text, text) to authenticated;
revoke all on function public.revoke_capability_override(uuid) from public, anon;
grant execute on function public.revoke_capability_override(uuid) to authenticated;
