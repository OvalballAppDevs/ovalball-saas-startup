-- Slice 4B (teams and roster) -- part 2 of 3: move the roster and team gates onto the
-- canonical capability decision (Phase 2 AA.3 row 4b, J.6 lines 418-429).
--
-- Expand step. Nothing is removed here that the deployed application still depends on:
-- these three gates keep answering the same questions, but they answer them from
-- internal.can with the canonical team keys instead of from internal.has_capability
-- with legacy keys, is_site_admin() and can_manage_team().
--
-- Three separate corrections ride along, each of them a behaviour the legacy gates got
-- wrong rather than a preference:
--
--   1. team_people_authority treated team.guardians.invite as roster authority. That key
--      adapts to family.invitation.create, which is Slice 4A family authority -- inviting
--      a child's guardian is not managing a squad. Holding it no longer opens the roster.
--
--   2. may_resolve_join_request carried an internal.is_site_admin() bypass. Site authority
--      is not a bypass here: it resolves through the canonical decision at rule 7
--      SITE_CAPABILITY via site.team_roles.manage, exactly like every other site answer
--      since Slice 3. Removing it lowers the PG16 ceiling by one.
--
--   3. regulatory_context_for_team carried both an is_site_admin() bypass and a
--      can_manage_team() roster use. Reading a team's regulatory context is a team.team.view
--      question; the player and guardian branch is unchanged.
--
-- team.team.view is deliberately the key for viewing, and it carries no roster implication
-- (J.6 line 418). Rosters are team.roster.view, which the Fixtures Secretary does not hold
-- (AI #70). A Fixtures Secretary who can see that a team exists still cannot read who is in it.

-- 1. Team people: view and manage -------------------------------------------------------
create or replace function internal.team_people_authority(p_team_id uuid)
returns table(may_view boolean, may_manage boolean)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare v_club_id uuid;
begin
  select club_id into v_club_id from public.teams where id = p_team_id;
  if v_club_id is null then
    return query select false, false;
    return;
  end if;

  return query
  select
    -- reading this team's people
    internal.can('team.roster.view', 'team', v_club_id, p_team_id, null)
      or internal.can('team.roster.view', 'club', v_club_id, null, null),
    -- changing this team's roster
    internal.can('team.roster.manage', 'team', v_club_id, p_team_id, null)
      or internal.can('team.roster.manage', 'club', v_club_id, null, null);
end;
$function$;

comment on function internal.team_people_authority(uuid) is
  'Canonical roster authority for one team (Slice 4B). Viewing is team.roster.view and changing is '
  'team.roster.manage, each answered at team scope or inherited from club scope by internal.can. '
  'team.guardians.invite no longer opens the roster: that key is family authority, not squad authority.';

-- 2. Deciding a request to join a team --------------------------------------------------
create or replace function internal.may_resolve_join_request(p_club_id uuid, p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  -- Club-wide roster authority, or authority over the specific squad being assigned.
  -- A site answer arrives through the canonical decision at rule 7, not as a bypass.
  select internal.can('team.join_request.review', 'club', p_club_id, null, null)
      or (p_team_id is not null
          and internal.can('team.join_request.review', 'team', p_club_id, p_team_id, null));
$function$;

comment on function internal.may_resolve_join_request(uuid, uuid) is
  'Canonical authority to decide a request to join a team (Slice 4B): team.join_request.review at club '
  'scope, or at the scope of the squad being assigned. The former internal.is_site_admin() bypass is gone; '
  'a Full Site Admin is answered by the canonical decision at rule 7 SITE_CAPABILITY.';

-- 3. A team's regulatory context ---------------------------------------------------------
create or replace function internal.regulatory_context_for_team(p_team_id uuid)
returns table(rugby_code text, regulatory_identity_id uuid, mapping_type text)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_rugby_code text;
  v_team_type_id uuid;
  v_club_id uuid;
begin
  select t.club_id into v_club_id from public.teams t where t.id = p_team_id;

  if not (
    (v_club_id is not null and internal.can('team.team.view', 'team', v_club_id, p_team_id, null))
    or exists (
      select 1 from public.player_team_memberships ptm
      where ptm.team_id = p_team_id and ptm.status = 'active'
        and (internal.is_own_linked_player(ptm.player_id) or internal.is_active_player_guardian(ptm.player_id))
    )
  ) then
    raise exception 'You are not authorized to view this team''s regulatory context.' using errcode = '42501';
  end if;

  select t.rugby_code, t.canonical_team_type_id into v_rugby_code, v_team_type_id
  from public.teams t where t.id = p_team_id;

  if v_rugby_code is null then
    raise exception 'Team not found.';
  end if;

  return query
  select v_rugby_code, ri.id, ri.mapping_type
  from public.regulatory_identities ri
  where ri.ovalball_canonical_team_type_id = v_team_type_id
    and ri.rugby_code = v_rugby_code;
  -- rugby_code stays part of the join, not just the return value: one
  -- canonical_team_type_id can carry a real union identity AND a real league
  -- identity, and they are different regulatory registers over the same shape.
end;
$function$;

comment on function internal.regulatory_context_for_team(uuid) is
  'A team''s regulatory identity (Slice 4B). Reading it is a team.team.view question answered by the '
  'canonical decision; the player and guardian branch is unchanged. The former is_site_admin() bypass and '
  'can_manage_team() roster use are gone.';
