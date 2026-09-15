-- Identity/Auth Slice 4a (expand): family and player authority through the canonical capability decision.
--
-- Phase 2 AA.3 row 4a, J.6, L, N, W. Every family and player action now asks internal.capability_decision
-- through the Slice 3 wrappers instead of the legacy helpers (can_manage_player, may_complete_player_profile,
-- the deprecated club.guardians.manage / team.guardians.invite keys, and the guardian branches of
-- is_site_admin / is_full_site_admin). This migration is additive for the deployed application: RPC
-- signatures are unchanged and the new staff projection exists alongside the current table policies. The
-- table policies that still let staff read whole player rows are narrowed by the contract migration that
-- follows the application release.
--
-- Owner decisions recorded before coding (scratchpad/slice4/PLAN.md §8):
--   D-S4-3 (FR-6): from a player's 18th birthday, guardian child-scope authority stops applying, decided at
--                  request time; relationship rows and history stay.

-- ---------------------------------------------------------------------------------------------------------
-- 1. FR-6: an adult player's guardians hold no derived authority
-- ---------------------------------------------------------------------------------------------------------

create or replace function internal.player_is_adult(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- An unrecorded date of birth is not treated as adult: the child's guardians keep what they had.
  select coalesce((select pl.date_of_birth <= (current_date - interval '18 years')::date
                   from public.players pl where pl.id = p_player_id), false);
$$;

create or replace function internal.bundle_source(p_subject uuid, p_key text, p_scope_type text, p_club uuid, p_team uuid, p_player uuid, p_inherits boolean, p_assignment_state text default 'ACTIVE')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if p_scope_type = 'club' then
    select jsonb_build_object('kind', 'ROLE', 'bundle', rd.bundle_key, 'role_key', ra.role_key, 'assignment_id', ra.id, 'team_id', ra.team_id)
    into v
    from public.role_assignments ra
    join public.club_memberships cm on cm.id = ra.membership_id and cm.state = 'ACTIVE'
    join public.role_definitions rd on rd.role_key = ra.role_key
    join public.bundle_capabilities b on b.bundle_key = rd.bundle_key and b.capability_key = p_key and b.scope_type = 'club'
    where ra.user_id = p_subject and ra.club_id = p_club and ra.state = p_assignment_state
      and (ra.role_key <> 'SAFEGUARDING_OFFICER' or ra.confirmation_state = 'CONFIRMED')
      -- a team role answers a club key only where its bundle lists the key at club scope ("their club")
      and (ra.team_id is null or rd.scope = 'TEAM')
    order by ra.team_id nulls first
    limit 1;
    if v is not null or p_assignment_state <> 'ACTIVE' then return v; end if;

    select jsonb_build_object('kind', 'PLAYER', 'bundle', 'PL', 'player_id', p.id, 'team_id', ptm.team_id) into v
    from public.players p
    join public.player_team_memberships ptm on ptm.player_id = p.id and ptm.state = 'ACTIVE'
    join public.teams t on t.id = ptm.team_id and t.club_id = p_club
    join public.bundle_capabilities b on b.bundle_key = 'PL' and b.capability_key = p_key and b.scope_type = 'club'
    where p.user_id = p_subject
    limit 1;
    if v is not null then return v; end if;

    select jsonb_build_object('kind', 'GUARDIAN', 'bundle', 'PG', 'relationship_id', g.id, 'player_id', g.player_id, 'team_id', ptm.team_id) into v
    from public.guardians g
    join public.player_team_memberships ptm on ptm.player_id = g.player_id and ptm.state = 'ACTIVE'
    join public.teams t on t.id = ptm.team_id and t.club_id = p_club
    join public.bundle_capabilities b on b.bundle_key = 'PG' and b.capability_key = p_key and b.scope_type = 'club'
    where g.guardian_user_id = p_subject and g.state = 'ACTIVE'
      and not internal.player_is_adult(g.player_id)
    limit 1;
    return v;

  elsif p_scope_type = 'team' then
    select jsonb_build_object('kind', 'ROLE', 'bundle', rd.bundle_key, 'role_key', ra.role_key, 'assignment_id', ra.id, 'team_id', ra.team_id,
                              'inherited', ra.team_id is null)
    into v
    from public.role_assignments ra
    join public.club_memberships cm on cm.id = ra.membership_id and cm.state = 'ACTIVE'
    join public.role_definitions rd on rd.role_key = ra.role_key
    join public.bundle_capabilities b on b.bundle_key = rd.bundle_key and b.capability_key = p_key
    where ra.user_id = p_subject and ra.club_id = p_club and ra.state = p_assignment_state
      and (ra.role_key <> 'SAFEGUARDING_OFFICER' or ra.confirmation_state = 'CONFIRMED')
      and (
        (ra.team_id = p_team and (b.scope_type = 'team' or (ra.role_key = 'VOLUNTEER' and b.scope_type = 'club')))
        or (ra.team_id is null and b.scope_type = 'club' and p_inherits)
      )
    order by ra.team_id nulls last
    limit 1;
    if v is not null or p_assignment_state <> 'ACTIVE' then return v; end if;

    select jsonb_build_object('kind', 'PLAYER', 'bundle', 'PL', 'player_id', p.id, 'team_id', ptm.team_id) into v
    from public.players p
    join public.player_team_memberships ptm on ptm.player_id = p.id and ptm.state = 'ACTIVE' and ptm.team_id = p_team
    join public.bundle_capabilities b on b.bundle_key = 'PL' and b.capability_key = p_key and b.scope_type = 'team'
    where p.user_id = p_subject
    limit 1;
    if v is not null then return v; end if;

    select jsonb_build_object('kind', 'GUARDIAN', 'bundle', 'PG', 'relationship_id', g.id, 'player_id', g.player_id, 'team_id', ptm.team_id) into v
    from public.guardians g
    join public.player_team_memberships ptm on ptm.player_id = g.player_id and ptm.state = 'ACTIVE' and ptm.team_id = p_team
    join public.bundle_capabilities b on b.bundle_key = 'PG' and b.capability_key = p_key and b.scope_type = 'team'
    where g.guardian_user_id = p_subject and g.state = 'ACTIVE'
      and not internal.player_is_adult(g.player_id)
    limit 1;
    return v;

  elsif p_scope_type = 'child' then
    if p_assignment_state <> 'ACTIVE' then return null; end if;
    select jsonb_build_object('kind', 'GUARDIAN', 'bundle', 'PG', 'relationship_id', g.id, 'player_id', g.player_id) into v
    from public.guardians g
    join public.bundle_capabilities b on b.bundle_key = 'PG' and b.capability_key = p_key and b.scope_type = 'child'
    where g.guardian_user_id = p_subject and g.player_id = p_player and g.state = 'ACTIVE'
      and not internal.player_is_adult(g.player_id)
    limit 1;
    return v;

  elsif p_scope_type = 'self' then
    if p_assignment_state <> 'ACTIVE' then return null; end if;
    if p_player is null and exists (select 1 from public.bundle_capabilities b where b.bundle_key = 'SELF' and b.capability_key = p_key and b.scope_type = 'self') then
      return jsonb_build_object('kind', 'SELF', 'bundle', 'SELF');
    end if;
    select jsonb_build_object('kind', 'PLAYER', 'bundle', 'PL', 'player_id', p.id) into v
    from public.players p
    join public.bundle_capabilities b on b.bundle_key = 'PL' and b.capability_key = p_key and b.scope_type = 'self'
    where p.user_id = p_subject and (p_player is null or p.id = p_player)
    limit 1;
    if v is not null or p_player is not null then return v; end if;
    select jsonb_build_object('kind', 'ROLE', 'bundle', rd.bundle_key, 'role_key', ra.role_key, 'assignment_id', ra.id) into v
    from public.role_assignments ra
    join public.club_memberships cm on cm.id = ra.membership_id and cm.state = 'ACTIVE'
    join public.role_definitions rd on rd.role_key = ra.role_key
    join public.bundle_capabilities b on b.bundle_key = rd.bundle_key and b.capability_key = p_key and b.scope_type = 'self'
    where ra.user_id = p_subject and ra.state = 'ACTIVE'
      and (ra.role_key <> 'SAFEGUARDING_OFFICER' or ra.confirmation_state = 'CONFIRMED')
    limit 1;
    return v;
  end if;
  return null;
end;
$$;

-- capability_decision: unchanged except that rule 8 names ADULT_PLAYER when the only thing standing between
-- a guardian and their relationship's child-scope bundle is the child's 18th birthday.
create or replace function internal.capability_decision(p_subject uuid, p_key text, p_scope_type text, p_club uuid default null::uuid, p_team uuid default null::uuid, p_player uuid default null::uuid, p_check_session boolean default true, p_trace boolean default false, out allowed boolean, out decisive_rule text, out reason_code text, out decisive_source jsonb, out trail jsonb)
returns record
language plpgsql
stable
security definer
set search_path = ''
as $$
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
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 2. Scope resolution for a player (L): the club and team come from the player's own places, never the client
-- ---------------------------------------------------------------------------------------------------------

create or replace function internal.player_scopes(p_player_id uuid)
returns table (team_id uuid, club_id uuid, place_state text)
language sql
stable
security definer
set search_path = ''
as $$
  select ptm.team_id, t.club_id, ptm.state
  from public.player_team_memberships ptm
  join public.teams t on t.id = ptm.team_id
  where ptm.player_id = p_player_id and ptm.state in ('ACTIVE', 'PENDING');
$$;

-- The person asking holds p_key at the team or club of one of the player's places (ACTIVE only, or PENDING too
-- where the question is about a place still being decided). Candidate clubs are limited to the asker's ACTIVE
-- memberships: without one, no club or team bundle and no delegated allow can answer (rules 5 and 6).
create or replace function internal.can_player_at_club_or_team(p_key text, p_player_id uuid, p_include_pending boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from internal.player_scopes(p_player_id) s
    where (s.place_state = 'ACTIVE' or (p_include_pending and s.place_state = 'PENDING'))
      and exists (select 1 from public.club_memberships cm
                  where cm.user_id = internal.effective_person() and cm.club_id = s.club_id and cm.state = 'ACTIVE')
      and (internal.can(p_key, 'team', null, s.team_id, null) or internal.can(p_key, 'club', s.club_id, null, null))
  );
$$;

-- self or linked child (J.6 SE / LC)
create or replace function internal.can_player_as_family(p_key text, p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_player_id is not null
    and exists (select 1 from public.players pl where pl.id = p_player_id)
    and internal.can_player(p_key, p_player_id);
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 3. player_staff_view (J.6): what staff see of a player — no date of birth, age grade only
-- ---------------------------------------------------------------------------------------------------------

-- True when the person holds any of p_keys at the given club or team scope (stops at the first allow).
create or replace function internal.can_any(p_keys text[], p_scope_type text, p_club uuid, p_team uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_key text;
begin
  foreach v_key in array p_keys loop
    if internal.can(v_key, p_scope_type, p_club, p_team, null) then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- D-4a-1: players as staff see them. An ACTIVE place is shown to player.profile.view or to the canonical keys that
-- act on a named player in team operations (Phase 2 U: team lists through fixtures, not the family graph); a
-- PENDING place or a pending club join request to whoever decides it; site.users.view sees all.
create or replace function internal.player_staff_rows()
returns table (id uuid, first_name text, surname text, age_grade text, is_adult boolean, has_date_of_birth boolean,
               has_playing_pathway boolean, has_login boolean, avatar_storage_path text, account_avatar_path text, active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with site as materialized (
    select internal.has_site_capability('site.users.view') as may_view_all
  ),
  my_clubs as (
    select cm.club_id from public.club_memberships cm
    where cm.user_id = internal.effective_person() and cm.state = 'ACTIVE'
  ),
  club_authority as materialized (
    select mc.club_id,
      internal.can_any(array['player.profile.view', 'fixture.callup.request', 'fixture.callup.approve', 'fixture.dispensation.request',
                             'team.graduation.place', 'team.handover.prepare'], 'club', mc.club_id, null) as may_view,
      internal.can_any(array['team.roster.manage', 'team.join_request.review'], 'club', mc.club_id, null) as may_review
    from my_clubs mc
  ),
  candidate_places as (
    select ptm.player_id, ptm.team_id, ptm.state, t.club_id, t.rugby_code
    from public.player_team_memberships ptm
    join public.teams t on t.id = ptm.team_id
    where ptm.state in ('ACTIVE', 'PENDING')
      and (t.club_id in (select club_id from my_clubs) or (select may_view_all from site))
  ),
  -- one decision per team, not per place: the distinct teams are taken, and their decisions materialised, before
  -- any place is joined to them (an inlined CTE would be re-evaluated for every place)
  candidate_teams as materialized (
    select distinct cp.team_id, cp.club_id, cp.rugby_code from candidate_places cp
  ),
  visible_teams as materialized (
    select ct.team_id, ct.rugby_code,
      case when (select may_view_all from site) or coalesce(ca.may_view, false) then true
           else internal.can_any(array['player.profile.view', 'fixture.callup.request', 'fixture.dispensation.request', 'team.graduation.place'],
                                 'team', null, ct.team_id) end as may_view,
      case when (select may_view_all from site) or coalesce(ca.may_review, false) then true
           else internal.can_any(array['team.roster.manage', 'team.join_request.review'], 'team', null, ct.team_id) end as may_review
    from candidate_teams ct
    left join club_authority ca on ca.club_id = ct.club_id
  ),
  visible as (
    select cp.player_id, vt.rugby_code, (cp.state = 'ACTIVE') as active_place
    from candidate_places cp
    join visible_teams vt on vt.team_id = cp.team_id
    where (cp.state = 'ACTIVE' and vt.may_view) or (cp.state = 'PENDING' and vt.may_review)
    union all
    select r.player_id, cd.rugby_code, false
    from public.player_club_join_requests r
    join public.clubs c on c.id = r.club_id
    join public.club_directory cd on cd.id = c.directory_id
    left join club_authority ca on ca.club_id = r.club_id
    where r.status = 'pending' and ((select may_view_all from site) or coalesce(ca.may_review, false))
  ),
  chosen as (
    select distinct on (v.player_id) v.player_id, v.rugby_code
    from visible v
    order by v.player_id, v.active_place desc
  )
  select p.id, p.first_name, p.surname,
    -- no age grade (rather than no view) while the canonical season register has no season covering today
    case when p.date_of_birth is null or season.id is null then null
         else (select g.canonical_age_group
               from internal.resolve_player_age_grade(v.rugby_code, season.id, p.date_of_birth) g
               limit 1) end,
    internal.player_is_adult(p.id),
    p.date_of_birth is not null, p.playing_pathway is not null, p.user_id is not null, p.avatar_storage_path,
    -- an adult player's own account picture (a minor's account picture is never offered to staff this way)
    case when internal.player_is_adult(p.id) and p.user_id is not null
         then (select pr.avatar_storage_path from public.profiles pr where pr.id = p.user_id) end,
    p.active
  from chosen v
  join public.players p on p.id = v.player_id
  left join lateral (select internal.resolve_season_for_date(v.rugby_code, current_date) as id) season on v.rugby_code is not null;
$$;

create or replace view public.player_staff_view
with (security_invoker = true)
as select * from internal.player_staff_rows();

comment on view public.player_staff_view is
  'Players as club and team staff see them (Phase 2 J.6 player.profile.view at team/club): no date of birth, age grade only.';

-- ---------------------------------------------------------------------------------------------------------
-- 4. Guardian link requests: who decides (N.1) — never the requester, ADDITIONAL_GUARDIAN at club level only
-- ---------------------------------------------------------------------------------------------------------

alter table public.guardian_link_requests drop constraint if exists guardian_link_requests_kind_check;
alter table public.guardian_link_requests add constraint guardian_link_requests_kind_check
  check (kind = any (array['FIRST_CHILD'::text, 'ADDITIONAL_GUARDIAN'::text, 'SELF_ADDED_CHILD'::text]));

do $$
declare v_name text;
begin
  select conname into v_name from pg_constraint
  where conrelid = 'public.guardian_link_requests'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%FIRST_CHILD%submitted_first_name%target_player_id IS NULL%';
  if v_name is null then
    raise exception 'Slice 4a precondition: the FIRST_CHILD/ADDITIONAL_GUARDIAN shape check was not found.';
  end if;
  execute format('alter table public.guardian_link_requests drop constraint %I', v_name);
end $$;

alter table public.guardian_link_requests add constraint guardian_link_requests_kind_shape_check check (
  (kind = 'FIRST_CHILD' and submitted_first_name is not null and submitted_surname is not null and submitted_date_of_birth is not null and target_player_id is null)
  or (kind = 'ADDITIONAL_GUARDIAN' and target_player_id is not null)
  or (kind = 'SELF_ADDED_CHILD' and target_player_id is not null and submitted_first_name is not null and submitted_surname is not null
      and submitted_date_of_birth is not null and requested_by_user_id is not null and subject_user_id = requested_by_user_id)
);

create or replace function internal.can_decide_guardian_link_request(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.guardian_link_requests r
    where r.id = p_request_id
      and r.requested_by_user_id is distinct from internal.effective_person()
      and r.subject_user_id is distinct from internal.effective_person()
      and (
        internal.can('family.relationship.approve', 'club', r.club_id, null, null)
        or (
          -- a first child can also be decided by the team that holds (or will hold) the child
          r.kind <> 'ADDITIONAL_GUARDIAN'
          and exists (
            select 1
            from public.teams t
            where t.club_id = r.club_id
              and (
                t.id = r.team_id
                or t.id in (select s.team_id from internal.player_scopes(coalesce(r.target_player_id, r.matched_player_id)) s)
              )
              and internal.can('family.relationship.approve', 'team', null, t.id, null)
          )
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 5. RPCs: same signatures, canonical authority
-- ---------------------------------------------------------------------------------------------------------

-- A self-added child whose relationship is declined or withdrawn keeps no pending team place: nobody holds it.
create or replace function internal.close_self_added_child(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.player_team_memberships ptm
  set state = 'DECLINED', updated_by = auth.uid()
  from public.guardian_link_requests r
  where r.id = p_request_id and r.kind = 'SELF_ADDED_CHILD'
    and ptm.player_id = r.target_player_id and ptm.state = 'PENDING' and ptm.source = 'GUARDIAN_ADDED_CHILD'
    and not exists (select 1 from public.guardians g where g.player_id = r.target_player_id and g.state in ('ACTIVE', 'SUSPENDED'));
end;
$$;

create or replace function public.cancel_guardian_link_request(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.guardian_link_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into r from public.guardian_link_requests where id = p_request_id for update;
  if r.id is null or r.requested_by_user_id is distinct from auth.uid() then
    raise exception 'This request is no longer available.' using errcode = '42501';
  end if;
  if r.status <> 'PENDING' then
    raise exception 'This request has already been decided.' using errcode = '23514';
  end if;

  update public.guardian_link_requests
  set status = 'CANCELLED', decided_at = now(), decision_note = 'Withdrawn by the requester.'
  where id = p_request_id;
  perform internal.decline_requested_relationship(p_request_id, 'Withdrawn by the requester.');
  perform internal.close_self_added_child(p_request_id);

  return 'cancelled';
end;
$$;

create or replace function public.approve_guardian_link_request(p_request_id uuid)
returns table(result text, player_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.guardian_link_requests%rowtype;
  v_player_id uuid;
  v_subject uuid;
  v_season_id uuid;
  v_grade record;
  v_team_id uuid;
  v_team_count integer;
  v_relationship public.guardians;
  v_relationship_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  -- Lock the row so two approvers cannot both act on one request and
  -- produce two guardian relationships or two players.
  select * into r from public.guardian_link_requests where id = p_request_id for update;
  if r.id is null or not internal.can_decide_guardian_link_request(p_request_id) then
    -- Same message for "does not exist" and "not yours to decide", so this cannot be used to probe for request ids.
    raise exception 'This request is no longer available.' using errcode = '42501';
  end if;
  if r.status <> 'PENDING' then
    raise exception 'This request has already been decided.';
  end if;

  -- An additional guardian is the SUBJECT of the request, never the person who asked.
  if r.kind = 'ADDITIONAL_GUARDIAN' then
    v_subject := r.subject_user_id;
  else
    v_subject := coalesce(r.subject_user_id, r.requested_by_user_id);
  end if;
  if v_subject is null then
    raise exception 'This person needs to accept their invitation and sign in before the relationship can be approved.';
  end if;
  if r.kind = 'ADDITIONAL_GUARDIAN' and coalesce(r.subject_response, '') <> 'ACCEPTED' then
    raise exception 'The person asked to be a guardian has not accepted yet.' using errcode = '23514';
  end if;

  if r.kind in ('ADDITIONAL_GUARDIAN', 'SELF_ADDED_CHILD') then
    v_player_id := r.target_player_id;
  elsif r.matched_player_id is not null then
    v_player_id := r.matched_player_id;
  else
    -- No existing child: create the canonical Player now, at approval time, by a person with real authority.
    insert into public.players (first_name, surname, date_of_birth, playing_pathway, created_by)
    values (r.submitted_first_name, r.submitted_surname, r.submitted_date_of_birth, r.submitted_playing_pathway, auth.uid())
    returning id into v_player_id;

    v_season_id := internal.resolve_season_for_date(coalesce(r.rugby_code, 'union'), current_date);
    if v_season_id is not null then
      select * into v_grade from internal.resolve_player_age_grade(coalesce(r.rugby_code, 'union'), v_season_id, r.submitted_date_of_birth);
      if v_grade.status not in ('TOO_YOUNG', 'OUT_OF_YOUTH_RANGE') then
        select count(*) into v_team_count
        from public.teams t
        where t.club_id = r.club_id and t.active = true
          and t.category = v_grade.canonical_category and t.age_group = v_grade.canonical_age_group;
        if v_team_count = 1 then
          select t.id into v_team_id
          from public.teams t
          where t.club_id = r.club_id and t.active = true
            and t.category = v_grade.canonical_category and t.age_group = v_grade.canonical_age_group;
          insert into public.player_team_memberships (player_id, team_id, status, created_by, source, approved_by, approved_at)
          values (v_player_id, v_team_id, 'active', auth.uid(), 'LINK_REQUEST_APPROVAL', auth.uid(), now());
        end if;
      end if;
    end if;
  end if;

  select * into v_relationship from public.guardians g
  where g.guardian_user_id = v_subject and g.player_id = v_player_id and g.state in ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED')
  for update;
  if v_relationship.state = 'SUSPENDED' then
    raise exception 'This relationship is on hold, so the request cannot be approved.' using errcode = '23514';
  elsif v_relationship.state = 'PENDING_APPROVAL' then
    update public.guardians
    set state = 'ACTIVE', approved_by = auth.uid(), approved_at = now(), source_request_id = coalesce(source_request_id, p_request_id), updated_by = auth.uid()
    where id = v_relationship.id;
    v_relationship_id := v_relationship.id;
  elsif v_relationship.state = 'ACTIVE' then
    v_relationship_id := v_relationship.id;
  else
    insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, source_request_id, approved_by, approved_at, created_by)
    values (v_subject, v_player_id, 'guardian', 'active', 'ACTIVE',
            case r.kind when 'ADDITIONAL_GUARDIAN' then 'ADDITIONAL_GUARDIAN_REQUEST' when 'SELF_ADDED_CHILD' then 'SELF_ADDED_CHILD' else 'LINK_REQUEST' end,
            p_request_id, auth.uid(), now(), auth.uid())
    returning id into v_relationship_id;
  end if;

  update public.guardian_link_requests
  set status = 'APPROVED', decided_by = auth.uid(), decided_at = now(), resolved_player_id = v_player_id, relationship_id = v_relationship_id
  where id = p_request_id;

  perform internal.emit_security_event('guardian.link_approved', v_subject, 'SUCCESS', null,
    jsonb_build_object('request_id', p_request_id, 'kind', r.kind, 'relationship_id', v_relationship_id),
    r.club_id, null, v_player_id);

  return query select 'approved'::text, v_player_id;
end;
$$;

create or replace function public.reject_guardian_link_request(p_request_id uuid, p_note text default null::text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.guardian_link_requests;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into v_request from public.guardian_link_requests glr where glr.id = p_request_id for update;
  if v_request.id is null or not internal.can_decide_guardian_link_request(p_request_id) then
    raise exception 'This request is no longer available.' using errcode = '42501';
  end if;
  if v_request.status <> 'PENDING' then
    raise exception 'This request has already been decided.';
  end if;

  update public.guardian_link_requests
  set status = 'REJECTED', decided_by = auth.uid(), decided_at = now(), decision_note = v_note
  where id = p_request_id;
  perform internal.decline_requested_relationship(p_request_id, v_note);
  perform internal.close_self_added_child(p_request_id);
  perform internal.emit_security_event('guardian.link_declined', coalesce(v_request.subject_user_id, v_request.requested_by_user_id), 'SUCCESS', v_note,
    jsonb_build_object('request_id', p_request_id, 'kind', v_request.kind, 'decided_by', 'APPROVER'),
    v_request.club_id, null, v_request.target_player_id);

  return 'rejected';
end;
$$;

-- Removal by a club (the club settings screen): family.relationship.remove at a club where the child holds an
-- ACTIVE place. The club is chosen deterministically among the clubs the remover may act for.
create or replace function public.remove_guardian_relationship(p_guardian_id uuid, p_reason text)
returns table(orphaned boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.guardians;
  v_remaining int;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into g from public.guardians where id = p_guardian_id for update;
  if g.id is null or not exists (
    select 1 from internal.player_scopes(g.player_id) s
    where s.place_state = 'ACTIVE' and internal.can('family.relationship.remove', 'club', s.club_id, null, null)
  ) then
    raise exception 'You are not authorised to manage Guardian relationships for this player.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to remove a Guardian relationship.' using errcode = '22023';
  end if;
  if g.state not in ('ACTIVE', 'SUSPENDED') then
    raise exception 'This relationship is not active, so there is nothing to remove.' using errcode = '23514';
  end if;

  update public.guardians
  set state = 'REVOKED', revoked_at = now(), revoked_by = auth.uid(), revocation_reason = trim(p_reason), updated_by = auth.uid()
  where id = p_guardian_id;

  select count(*) into v_remaining from public.guardians where player_id = g.player_id and state = 'ACTIVE';
  return query select (v_remaining = 0);
end;
$$;

-- Guardian relationship transitions (N.1): remove (self, club or site), hold and lift hold (site, AN-7).
drop function if exists public.transition_guardian_relationship(uuid, text, text);
create or replace function public.transition_guardian_relationship(p_guardian_id uuid, p_to_state text, p_reason text default null, p_confidential boolean default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_relationship public.guardians;
  v_self boolean;
  v_club_authority boolean;
  v_site boolean;
  v_reason text;
begin
  if auth.uid() is null or not internal.is_account_active(auth.uid()) then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into v_relationship from public.guardians where id = p_guardian_id for update;
  if v_relationship.id is null then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;
  v_self := v_relationship.guardian_user_id = auth.uid();
  v_club_authority := exists (
    select 1 from internal.player_scopes(v_relationship.player_id) s
    where s.place_state = 'ACTIVE' and internal.can('family.relationship.remove', 'club', s.club_id, null, null));
  v_site := internal.has_site_capability('site.family.manage');

  if p_to_state = 'REVOKED' then
    -- N.1: a guardian may always end their own relationship (ACTIVE or on hold), which only ever removes
    -- authority; anyone else needs family.relationship.remove at the child's club, or site.family.manage.
    if not (v_self or v_club_authority or v_site) then
      raise exception 'You are not authorised to remove this relationship.' using errcode = '42501';
    end if;
    if v_relationship.state not in ('ACTIVE', 'SUSPENDED') then
      raise exception 'This relationship is not active, so there is nothing to remove.' using errcode = '23514';
    end if;
    v_reason := internal.require_reason(p_reason, not v_self);
    update public.guardians
    set state = 'REVOKED', revoked_at = now(), revoked_by = auth.uid(),
        revocation_reason = coalesce(v_reason, 'Removed by the guardian'), updated_by = auth.uid()
    where id = p_guardian_id;

  elsif p_to_state = 'SUSPENDED' then
    if not v_site or v_self then
      raise exception 'You are not authorised to put this relationship on hold.' using errcode = '42501';
    end if;
    if v_relationship.state <> 'ACTIVE' then
      raise exception 'Only an active relationship can be put on hold.' using errcode = '23514';
    end if;
    v_reason := internal.require_reason(p_reason, true);
    update public.guardians
    set state = 'SUSPENDED', suspended_at = now(), suspended_by = auth.uid(), suspension_reason = v_reason,
        confidential = coalesce(p_confidential, false), updated_by = auth.uid()
    where id = p_guardian_id;

  elsif p_to_state = 'ACTIVE' then
    if v_relationship.state in ('REVOKED', 'DECLINED', 'EXPIRED') then
      raise exception 'An ended guardian relationship cannot be switched back on. Link the guardian again.' using errcode = '23514';
    end if;
    if v_relationship.state <> 'SUSPENDED' then
      raise exception 'This relationship is not on hold.' using errcode = '23514';
    end if;
    if not v_site or v_self then
      raise exception 'You are not authorised to take this relationship off hold.' using errcode = '42501';
    end if;
    v_reason := internal.require_reason(p_reason, true);
    update public.guardians
    set state = 'ACTIVE', suspended_at = null, suspended_by = null, suspension_reason = null, reason = v_reason,
        confidential = false, updated_by = auth.uid()
    where id = p_guardian_id;

  else
    raise exception 'A guardian relationship can be removed, put on hold or taken off hold.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.set_guardian_player_permission(p_player_id uuid, p_permission_key text, p_granted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not internal.can_player_as_family('family.permission.manage', p_player_id)
     or not exists (select 1 from public.guardians g
                    where g.player_id = p_player_id and g.guardian_user_id = auth.uid() and g.state = 'ACTIVE') then
    raise exception 'You are not an active guardian of this player.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.player_permission_types where key = p_permission_key) then
    raise exception 'Unknown permission.' using errcode = '22023';
  end if;
  insert into public.guardian_player_permissions (player_id, permission_key, guardian_user_id, granted, actor)
  values (p_player_id, p_permission_key, auth.uid(), p_granted, auth.uid());
end;
$$;

create or replace function public.get_player_permission_summary(p_player_id uuid)
returns table(permission_key text, label text, description text, min_age integer, max_age integer, effective boolean, my_decision boolean, co_guardians_pending boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    internal.can_player_as_family('family.permission.manage', p_player_id)
    or exists (select 1 from public.players pl where pl.id = p_player_id and pl.user_id = auth.uid()
               and internal.can('player.profile.view', 'self', null, null, p_player_id))
    or internal.has_site_capability('site.family.manage')
  ) then
    raise exception 'You are not authorised to view this player''s access settings.' using errcode = '42501';
  end if;

  return query
  select
    pt.key, pt.label, pt.description, pt.min_age, pt.max_age,
    internal.guardian_permission_effective(p_player_id, pt.key),
    (
      select gpp.granted from public.guardian_player_permissions gpp
      where gpp.player_id = p_player_id and gpp.permission_key = pt.key and gpp.guardian_user_id = auth.uid()
      order by gpp.created_at desc limit 1
    ),
    exists (
      select 1 from public.guardians g
      where g.player_id = p_player_id and g.state = 'ACTIVE' and g.guardian_user_id <> auth.uid()
        and coalesce((
          select gpp2.granted from public.guardian_player_permissions gpp2
          where gpp2.player_id = p_player_id and gpp2.permission_key = pt.key and gpp2.guardian_user_id = g.guardian_user_id
          order by gpp2.created_at desc limit 1
        ), false) is not true
    )
  from public.player_permission_types pt
  order by pt.sort_order;
end;
$$;

-- FR-1: only ACTIVE relationships count towards the consent a child's guardians have given.
create or replace function internal.guardian_permission_effective(p_player_id uuid, p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with active_guardians as (
    select guardian_user_id from public.guardians where player_id = p_player_id and state = 'ACTIVE'
  ),
  latest_decision as (
    select ag.guardian_user_id,
      (select gpp.granted from public.guardian_player_permissions gpp
       where gpp.player_id = p_player_id and gpp.permission_key = p_permission_key and gpp.guardian_user_id = ag.guardian_user_id
       order by gpp.created_at desc limit 1) as granted
    from active_guardians ag
  )
  select
    (select count(*) from active_guardians) > 0
    and not exists (select 1 from latest_decision where granted is distinct from true);
$$;

create or replace function public.set_player_playing_pathway(p_player_id uuid, p_playing_pathway text)
returns table(review_state text, reason text, resolved boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player public.players;
  r record;
  v_state text;
  v_reason text;
begin
  select * into v_player from public.players where id = p_player_id for update;
  if v_player.id is null
     or not (internal.can_player_as_family('player.profile.edit_protected', p_player_id)
             or internal.has_site_capability('site.users.identity.correct')) then
    raise exception 'Only this player''s guardian, the player themselves, or Ovalball may record this information.'
      using errcode = '42501';
  end if;

  if p_playing_pathway is null or p_playing_pathway not in ('MALE', 'FEMALE') then
    raise exception 'Choose Boys or Girls. Rugby runs separate boys'' and girls'' age grades from Under-12, and Ovalball must never assume which one a player is registered in.'
      using errcode = '23514';
  end if;

  -- Set once: re-sending the same value is allowed silently; a DIFFERENT value is a correction only Ovalball makes.
  if v_player.playing_pathway is not null and v_player.playing_pathway <> p_playing_pathway then
    if not internal.has_site_capability('site.users.identity.correct') then
      raise exception 'This player''s gender has already been recorded and cannot be changed here. If it is wrong, your club can raise it with Ovalball so it is corrected properly.'
        using errcode = '42501';
    end if;
  end if;

  update public.players
  set playing_pathway = p_playing_pathway, updated_by = auth.uid(), updated_at = now()
  where id = p_player_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('players', p_player_id, 'update', auth.uid(),
    jsonb_build_object('playing_pathway_was_recorded', v_player.playing_pathway is not null),
    jsonb_build_object('event',
      case when v_player.playing_pathway is null
        then 'PLAYER_PLAYING_PATHWAY_RECORDED'
        else 'PLAYER_PLAYING_PATHWAY_CORRECTED_BY_SITE_ADMIN' end));

  for r in
    select distinct ro.id
    from public.age_grade_rollovers ro
    join public.age_grade_rollover_player_proposals pp on pp.rollover_id = ro.id
    where pp.player_id = p_player_id and ro.applied_at is null and pp.placement_applied_at is null
  loop
    perform internal.refresh_rollover_player_proposals(r.id);
  end loop;

  select pp.review_state, pp.reason into v_state, v_reason
  from public.age_grade_rollover_player_proposals pp
  join public.age_grade_rollovers ro on ro.id = pp.rollover_id
  where pp.player_id = p_player_id and ro.applied_at is null
  order by pp.created_at desc
  limit 1;

  return query select v_state, v_reason, v_state = 'READY';
end;
$$;

create or replace function public.request_player_playing_pathway(p_player_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player public.players;
  v_sent integer := 0;
begin
  select * into v_player from public.players where id = p_player_id;
  -- The club may ASK. It may not answer.
  if v_player.id is null or not internal.can_player_at_club_or_team('player.pathway.request', p_player_id) then
    raise exception 'Not authorised to contact this player''s guardians.' using errcode = '42501';
  end if;

  insert into public.notifications (user_id, type, title, body, data)
  select g.guardian_user_id, 'player_information_requested', 'Playing information needed',
    format('%s''s club needs to know which playing pathway %s is registered in before next season''s teams can be confirmed. You can add it from Your Children.',
           v_player.first_name, v_player.first_name),
    jsonb_build_object('player_id', p_player_id)
  from public.guardians g
  where g.player_id = p_player_id and g.state = 'ACTIVE';
  get diagnostics v_sent = row_count;

  return v_sent;
end;
$$;

create or replace function public.player_team_allocation(p_player_id uuid, p_club_id uuid)
returns table(rugby_code text, season_id uuid, season_name text, regulatory_age_label text, allocation_status text, reason text, canonical_team_type_id uuid, compact_label text, display_label text, club_runs_team boolean, operational_team_id uuid, operational_team_name text, operational_team_count integer, membership_status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_dob date;
  v_pathway text;
  v_membership text;
  p record;
begin
  -- A player's date of birth and pathway are protected information: only the player, their guardians and
  -- staff who may view that player at this club may ask what it resolves to.
  if not (internal.can_player_as_family('player.profile.view', p_player_id)
          or exists (select 1 from internal.player_scopes(p_player_id) s
                     where s.club_id = p_club_id
                       and (internal.can('player.profile.view', 'team', null, s.team_id, null)
                            or internal.can('player.profile.view', 'club', s.club_id, null, null)))) then
    raise exception 'Not authorised to view this player''s allocation.' using errcode = '42501';
  end if;

  select pl.date_of_birth, pl.playing_pathway into v_dob, v_pathway
  from public.players pl where pl.id = p_player_id;

  if v_dob is null then
    return query select null::text, null::uuid, null::text, null::text, 'DOB_REQUIRED'::text,
      'This player''s date of birth has not been recorded yet, and it is what decides their age group.'::text,
      null::uuid, null::text, null::text, false, null::uuid, null::text, 0, null::text;
    return;
  end if;

  select ptm.status into v_membership
  from public.player_team_memberships ptm
  join public.teams t on t.id = ptm.team_id
  where ptm.player_id = p_player_id and t.club_id = p_club_id
  order by (ptm.status = 'active') desc, (ptm.status = 'pending') desc, ptm.joined_at desc
  limit 1;

  for p in select * from public.preview_player_allocation(p_club_id, v_dob, v_pathway, null) loop
    return query select p.rugby_code, p.season_id, p.season_name, p.regulatory_age_label,
      p.allocation_status, p.reason, p.canonical_team_type_id, p.compact_label, p.display_label,
      p.club_runs_team, p.operational_team_id, p.operational_team_name, p.operational_team_count,
      v_membership;
  end loop;
end;
$$;

-- The self-registration of an adult player (J.6 player.self_register: "adults 18+", KEEP + age gate).
create or replace function public.create_own_player_profile(p_first_name text, p_surname text, p_date_of_birth date, p_playing_pathway text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_existing uuid;
  v_first text := trim(coalesce(p_first_name, ''));
  v_surname text := trim(coalesce(p_surname, ''));
  v_pathway text := upper(nullif(trim(coalesce(p_playing_pathway, '')), ''));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  -- RESUMABLE, not duplicating: whatever brought them back is the same player.
  select id into v_existing from public.players where user_id = v_uid;
  if v_existing is not null then
    update public.players
    set date_of_birth = coalesce(date_of_birth, p_date_of_birth),
        updated_by = v_uid, updated_at = now()
    where id = v_existing and date_of_birth is null and p_date_of_birth is not null;

    if v_pathway in ('MALE', 'FEMALE')
       and (select playing_pathway from public.players where id = v_existing) is null then
      perform public.set_player_playing_pathway(v_existing, v_pathway);
    end if;
    return v_existing;
  end if;

  if not internal.can('player.self_register', 'self') then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;
  if v_first = '' or v_surname = '' then
    raise exception 'We need your first name and surname.' using errcode = '23514';
  end if;
  if p_date_of_birth is null then
    raise exception 'We need your date of birth. It is what decides which rugby category you play in.' using errcode = '23514';
  end if;
  if p_date_of_birth > (current_date - interval '18 years')::date then
    raise exception 'You need to be 18 or over to register yourself as a player. A parent or guardian can add a younger player.' using errcode = '23514';
  end if;
  if v_pathway is null or v_pathway not in ('MALE', 'FEMALE') then
    raise exception 'Tell us whether you play in the men''s or the women''s game, so Ovalball can work out your rugby category.' using errcode = '23514';
  end if;

  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id, active, created_by, updated_by)
  values (v_first, v_surname, p_date_of_birth, v_pathway, v_uid, true, v_uid, v_uid)
  returning id into v_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('players', v_id, 'insert', v_uid, jsonb_build_object('event', 'PLAYER_SELF_REGISTERED'));

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 6. Adding a child (J.6 family.child.add, N.1): PENDING_APPROVAL unless the parent arrived by invitation
-- ---------------------------------------------------------------------------------------------------------

-- A person may add a child at a club when they hold an ACTIVE relationship with a child there, or accepted a
-- guardian invitation from that club. Club membership alone is not a family relationship (J.6).
create or replace function internal.may_add_child_at_club(p_club_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when internal.effective_person() is null or not internal.can('family.child.add', 'self') then null
    when exists (select 1 from public.guardian_invitations gi
                 where gi.club_id = p_club_id and gi.accepted_by = internal.effective_person() and gi.status = 'accepted')
      then 'INVITATION'
    when exists (select 1 from public.guardians g
                 join public.player_team_memberships ptm on ptm.player_id = g.player_id and ptm.state in ('ACTIVE', 'PENDING')
                 join public.teams t on t.id = ptm.team_id and t.club_id = p_club_id
                 where g.guardian_user_id = internal.effective_person() and g.state = 'ACTIVE')
      then 'RELATIONSHIP'
  end;
$$;

-- The allocation preview asks the same question; a club member may also preview (it computes nothing about a
-- real player, only what a date of birth would resolve to at this club).
create or replace function internal.may_ask_club_allocation(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select internal.effective_person() is not null and (
    internal.may_add_child_at_club(p_club_id) is not null
    or exists (select 1 from public.club_memberships cm
               where cm.user_id = internal.effective_person() and cm.club_id = p_club_id and cm.state = 'ACTIVE')
  );
$$;

create or replace function public.add_child_for_guardian(p_first_name text, p_surname text, p_date_of_birth date, p_club_id uuid, p_rugby_code text, p_playing_pathway text default null::text)
returns table(result text, player_id uuid, age_grade text, school_year integer, team_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first text := trim(coalesce(p_first_name, ''));
  v_surname text := trim(coalesce(p_surname, ''));
  v_route text;
  v_season_id uuid;
  v_grade record;
  v_existing_player_id uuid;
  v_match_player_id uuid;
  v_match_count integer;
  v_match_team_id uuid;
  v_new_player_id uuid;
  v_candidate_team_id uuid;
  v_norm record;
  v_candidate_team_count integer;
  v_result text;
  v_invitation_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if v_first = '' or v_surname = '' then
    raise exception 'First name and surname are required.' using errcode = '23514';
  end if;
  if p_date_of_birth is null then
    raise exception 'Date of birth is required.' using errcode = '23514';
  end if;
  if p_playing_pathway is null or upper(p_playing_pathway) not in ('MALE', 'FEMALE') then
    raise exception 'Tell us which playing pathway applies to this player so their age grade can be worked out correctly.'
      using errcode = '23514';
  end if;
  if not exists (select 1 from public.clubs where id = p_club_id and status = 'active') then
    raise exception 'You need an invitation from this club before you can add a child to it.' using errcode = '42501';
  end if;

  v_route := internal.may_add_child_at_club(p_club_id);
  if v_route is null then
    raise exception 'You need an invitation from this club before you can add a child to it.'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_club_id::text || ':' || lower(v_first) || ':' || lower(v_surname) || ':' || p_date_of_birth::text, 0));

  v_season_id := internal.resolve_season_for_date(p_rugby_code, current_date);
  if v_season_id is null then
    raise exception 'No active season is currently configured for this rugby code -- please contact your club.';
  end if;

  select * into v_grade from internal.resolve_player_age_grade(p_rugby_code, v_season_id, p_date_of_birth);
  if v_grade.status = 'TOO_YOUNG' then
    raise exception 'This date of birth is below the youngest supported youth age grade (U6).' using errcode = '23514';
  elsif v_grade.status = 'OUT_OF_YOUTH_RANGE' then
    raise exception 'This date of birth is outside the supported youth age-grade range (U6-U18). Please contact your club directly.' using errcode = '23514';
  end if;

  select p.id into v_existing_player_id
  from public.players p
  join public.guardians g on g.player_id = p.id and g.guardian_user_id = auth.uid() and g.state in ('ACTIVE', 'PENDING_APPROVAL')
  join public.player_team_memberships ptm on ptm.player_id = p.id and ptm.state in ('PENDING', 'ACTIVE')
  join public.teams t on t.id = ptm.team_id and t.club_id = p_club_id
  where lower(p.first_name) = lower(v_first) and lower(p.surname) = lower(v_surname) and p.date_of_birth is not distinct from p_date_of_birth
  order by (g.state = 'ACTIVE') desc
  limit 1;
  if v_existing_player_id is not null then
    if exists (select 1 from public.guardians g where g.player_id = v_existing_player_id and g.guardian_user_id = auth.uid() and g.state = 'ACTIVE') then
      return query select 'already_linked'::text, v_existing_player_id, v_grade.canonical_age_group, v_grade.school_year, null::uuid;
    else
      return query select 'under_review'::text, null::uuid, v_grade.canonical_age_group, v_grade.school_year, null::uuid;
    end if;
    return;
  end if;

  if exists (
    select 1 from public.player_duplicate_reviews pdr
    where pdr.requesting_guardian_user_id = auth.uid()
      and pdr.status = 'pending'
      and lower(pdr.submitted_first_name) = lower(v_first) and lower(pdr.submitted_surname) = lower(v_surname)
      and pdr.submitted_date_of_birth is not distinct from p_date_of_birth
  ) then
    return query select 'under_review'::text, null::uuid, v_grade.canonical_age_group, v_grade.school_year, null::uuid;
    return;
  end if;

  select count(distinct ptm.player_id) into v_match_count
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  join public.teams t on t.id = ptm.team_id
  where t.club_id = p_club_id and ptm.state in ('PENDING', 'ACTIVE')
    and lower(p.first_name) = lower(v_first) and lower(p.surname) = lower(v_surname)
    and p.date_of_birth is not distinct from p_date_of_birth;

  if v_match_count = 1 then
    select ptm.player_id, ptm.team_id into v_match_player_id, v_match_team_id
    from public.player_team_memberships ptm
    join public.players p on p.id = ptm.player_id
    join public.teams t on t.id = ptm.team_id
    where t.club_id = p_club_id and ptm.state in ('PENDING', 'ACTIVE')
      and lower(p.first_name) = lower(v_first) and lower(p.surname) = lower(v_surname)
      and p.date_of_birth is not distinct from p_date_of_birth
    order by (ptm.state = 'ACTIVE') desc, ptm.joined_at desc
    limit 1;

    insert into public.player_duplicate_reviews (team_id, submitted_first_name, submitted_surname, submitted_date_of_birth, submitted_playing_pathway, matched_player_id, submitted_by, requesting_guardian_user_id)
    values (v_match_team_id, v_first, v_surname, p_date_of_birth, upper(p_playing_pathway), v_match_player_id, auth.uid(), auth.uid());

    return query select 'under_review'::text, null::uuid, v_grade.canonical_age_group, v_grade.school_year, null::uuid;
    return;
  elsif v_match_count > 1 then
    raise exception 'We found more than one possible existing match for this player at this club. Please contact the club directly so they can confirm the correct player.' using errcode = '23514';
  end if;

  insert into public.players (first_name, surname, date_of_birth, playing_pathway, created_by)
  values (v_first, v_surname, p_date_of_birth, upper(p_playing_pathway), auth.uid())
  returning id into v_new_player_id;

  select * into v_norm from public.resolve_normal_operational_identity(
    p_rugby_code, internal.resolve_season_for_date(p_rugby_code, current_date), p_date_of_birth, upper(p_playing_pathway));

  if v_norm.canonical_team_type_id is not null then
    select count(*) into v_candidate_team_count
    from public.teams t
    where t.club_id = p_club_id and t.active = true and t.canonical_team_type_id = v_norm.canonical_team_type_id;
    if v_candidate_team_count = 1 then
      select t.id into v_candidate_team_id
      from public.teams t
      where t.club_id = p_club_id and t.active = true and t.canonical_team_type_id = v_norm.canonical_team_type_id;
      insert into public.player_team_memberships (player_id, team_id, status, state, created_by, source)
      values (v_new_player_id, v_candidate_team_id, 'pending', 'PENDING', auth.uid(), 'GUARDIAN_ADDED_CHILD');
    end if;
  end if;

  if v_route = 'INVITATION' then
    -- invitation-sourced: the club already vouched for this parent (N.1 "(none) -> ACTIVE, GUARDIAN_INVITATION")
    select gi.id into v_invitation_id from public.guardian_invitations gi
    where gi.club_id = p_club_id and gi.accepted_by = auth.uid() and gi.status = 'accepted'
    order by gi.accepted_at desc nulls last limit 1;
    insert into public.guardians (guardian_user_id, player_id, relationship_type, created_by, source, source_invitation_id)
    values (auth.uid(), v_new_player_id, 'guardian', auth.uid(), 'GUARDIAN_INVITATION', v_invitation_id);
    v_result := case when v_candidate_team_id is null then 'created_needs_club_review' else 'created_pending_team' end;
    return query select v_result, v_new_player_id, v_grade.canonical_age_group, v_grade.school_year, v_candidate_team_id;
    return;
  end if;

  -- self-added: the relationship waits for the club (N.1 "(none) -> PENDING_APPROVAL, SELF_ADDED_CHILD")
  insert into public.guardian_link_requests (kind, status, requested_by_user_id, subject_user_id, club_id, team_id, rugby_code,
    submitted_first_name, submitted_surname, submitted_date_of_birth, submitted_playing_pathway, target_player_id)
  values ('SELF_ADDED_CHILD', 'PENDING', auth.uid(), auth.uid(), p_club_id, v_candidate_team_id, p_rugby_code,
    v_first, v_surname, p_date_of_birth, upper(p_playing_pathway), v_new_player_id);
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, created_by, source, source_request_id)
  select auth.uid(), v_new_player_id, 'guardian', 'pending', 'PENDING_APPROVAL', auth.uid(), 'SELF_ADDED_CHILD', r.id
  from public.guardian_link_requests r
  where r.kind = 'SELF_ADDED_CHILD' and r.target_player_id = v_new_player_id and r.requested_by_user_id = auth.uid();
  update public.guardian_link_requests r
  set relationship_id = g.id
  from public.guardians g
  where r.kind = 'SELF_ADDED_CHILD' and r.target_player_id = v_new_player_id and g.source_request_id = r.id;

  return query select 'under_review'::text, v_new_player_id, v_grade.canonical_age_group, v_grade.school_year, v_candidate_team_id;
end;
$$;

create or replace function public.create_player_for_guardian(p_guardian_invitation_id uuid, p_first_name text, p_surname text, p_date_of_birth date, p_playing_pathway text default null::text)
returns table(result text, player_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.guardian_invitations;
  v_match_player_id uuid;
  v_player_id uuid;
begin
  select * into inv from public.guardian_invitations where id = p_guardian_invitation_id;
  if inv.id is null or inv.status <> 'accepted' or inv.accepted_by is distinct from auth.uid()
     or not internal.can('family.child.add', 'self') then
    raise exception 'You do not have an accepted invitation for this team.' using errcode = '42501';
  end if;
  if coalesce(trim(p_first_name), '') = '' or coalesce(trim(p_surname), '') = '' then
    raise exception 'First name and surname are required.' using errcode = '23514';
  end if;

  select ptm.player_id into v_match_player_id
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  where ptm.team_id = inv.team_id
    and ptm.state = 'ACTIVE'
    and lower(p.first_name) = lower(trim(p_first_name))
    and lower(p.surname) = lower(trim(p_surname))
    and p.date_of_birth is not distinct from p_date_of_birth
  limit 1;

  if v_match_player_id is not null then
    insert into public.player_duplicate_reviews (guardian_invitation_id, team_id, submitted_first_name, submitted_surname, submitted_date_of_birth, matched_player_id, submitted_by)
    values (inv.id, inv.team_id, trim(p_first_name), trim(p_surname), p_date_of_birth, v_match_player_id, auth.uid());
    return query select 'under_review'::text, null::uuid;
    return;
  end if;

  if p_playing_pathway is null or upper(p_playing_pathway) not in ('MALE','FEMALE') then
    raise exception 'Tell us which playing pathway applies to this player so their age grade can be worked out correctly.'
      using errcode = '23514';
  end if;

  insert into public.players (first_name, surname, date_of_birth, playing_pathway, created_by)
  values (trim(p_first_name), trim(p_surname), p_date_of_birth, upper(p_playing_pathway), auth.uid())
  returning id into v_player_id;

  insert into public.guardians (guardian_user_id, player_id, relationship_type, created_by, source, source_invitation_id)
  values (auth.uid(), v_player_id, 'guardian', auth.uid(), 'GUARDIAN_INVITATION', p_guardian_invitation_id);

  insert into public.player_team_memberships (player_id, team_id, created_by, source)
  values (v_player_id, inv.team_id, auth.uid(), 'GUARDIAN_INVITATION');

  return query select 'created'::text, v_player_id;
end;
$$;

create or replace function public.link_guardian_to_existing_player(p_guardian_invitation_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.guardian_invitations;
begin
  select * into inv from public.guardian_invitations where id = p_guardian_invitation_id;
  if inv.id is null or inv.status <> 'accepted' or inv.accepted_by is distinct from auth.uid()
     or not internal.can('family.child.add', 'self') then
    raise exception 'You do not have an accepted invitation for this team.' using errcode = '42501';
  end if;
  if inv.replacement_for_player_id is null or inv.replacement_for_player_id <> p_player_id then
    raise exception 'This invitation is not for that player.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.player_team_memberships where player_id = p_player_id and team_id = inv.team_id and state = 'ACTIVE') then
    raise exception 'That player is not on the invited team.' using errcode = '42501';
  end if;

  -- An open relationship (active, awaiting approval or on hold) is left as it is: an invitation never lifts a
  -- hold or skips a pending decision.
  insert into public.guardians (guardian_user_id, player_id, relationship_type, created_by, source, source_invitation_id)
  values (auth.uid(), p_player_id, 'guardian', auth.uid(), 'GUARDIAN_INVITATION', p_guardian_invitation_id)
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 7. Relationship requests (J.6 family.relationship.request)
-- ---------------------------------------------------------------------------------------------------------

create or replace function public.request_child_link(p_first_name text, p_surname text, p_date_of_birth date, p_club_id uuid, p_rugby_code text default 'union'::text, p_playing_pathway text default null::text)
returns table(request_id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first text := trim(coalesce(p_first_name, ''));
  v_surname text := trim(coalesce(p_surname, ''));
  v_user uuid := auth.uid();
  v_match_player_id uuid;
  v_match_count integer;
  v_request_id uuid;
  v_recent integer;
  v_season_id uuid;
  v_grade record;
begin
  if v_user is null or not internal.can('family.relationship.request', 'self') then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;
  if v_first = '' or v_surname = '' then
    raise exception 'First name and surname are required.' using errcode = '23514';
  end if;
  if p_date_of_birth is null then
    raise exception 'Date of birth is required.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.clubs c where c.id = p_club_id and c.status = 'active') then
    raise exception 'Club not found.';
  end if;

  -- Anti-abuse: probable matching is a discovery oracle if it can be run repeatedly.
  select count(*) into v_recent
  from public.guardian_link_requests glr
  where glr.requested_by_user_id = v_user
    and glr.created_at > now() - interval '24 hours';
  if v_recent >= 10 then
    raise exception 'You have submitted several requests recently. Please wait before submitting another, or contact your club directly.'
      using errcode = '42501';
  end if;

  v_season_id := internal.resolve_season_for_date(p_rugby_code, current_date);
  if v_season_id is null then
    raise exception 'No active season is currently configured for this rugby code -- please contact your club.';
  end if;
  select * into v_grade from internal.resolve_player_age_grade(p_rugby_code, v_season_id, p_date_of_birth);
  if v_grade.status = 'TOO_YOUNG' then
    raise exception 'This date of birth is below the youngest supported youth age grade (U6).' using errcode = '23514';
  elsif v_grade.status = 'OUT_OF_YOUTH_RANGE' then
    raise exception 'This date of birth is outside the supported youth age-grade range (U6-U18). Please contact your club directly.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.players p
    join public.guardians g on g.player_id = p.id and g.guardian_user_id = v_user and g.state = 'ACTIVE'
    where lower(p.first_name) = lower(v_first)
      and lower(p.surname) = lower(v_surname)
      and p.date_of_birth is not distinct from p_date_of_birth
  ) then
    return query select null::uuid, 'ALREADY_LINKED'::text;
    return;
  end if;

  select glr.id into v_request_id
  from public.guardian_link_requests glr
  where glr.requested_by_user_id = v_user
    and glr.club_id = p_club_id
    and glr.status = 'PENDING'
    and glr.kind = 'FIRST_CHILD'
    and lower(glr.submitted_first_name) = lower(v_first)
    and lower(glr.submitted_surname) = lower(v_surname)
    and glr.submitted_date_of_birth is not distinct from p_date_of_birth;
  if v_request_id is not null then
    return query select v_request_id, 'PENDING'::text;
    return;
  end if;

  select count(distinct ptm.player_id) into v_match_count
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  join public.teams t on t.id = ptm.team_id
  where t.club_id = p_club_id
    and ptm.state in ('PENDING', 'ACTIVE')
    and lower(p.first_name) = lower(v_first)
    and lower(p.surname) = lower(v_surname)
    and p.date_of_birth is not distinct from p_date_of_birth;

  if v_match_count = 1 then
    select ptm.player_id into v_match_player_id
    from public.player_team_memberships ptm
    join public.players p on p.id = ptm.player_id
    join public.teams t on t.id = ptm.team_id
    where t.club_id = p_club_id
      and ptm.state in ('PENDING', 'ACTIVE')
      and lower(p.first_name) = lower(v_first)
      and lower(p.surname) = lower(v_surname)
      and p.date_of_birth is not distinct from p_date_of_birth
    limit 1;
  end if;

  insert into public.guardian_link_requests (
    kind, status, requested_by_user_id, subject_user_id, club_id, rugby_code,
    submitted_first_name, submitted_surname, submitted_date_of_birth, submitted_playing_pathway, matched_player_id
  )
  values (
    'FIRST_CHILD', 'PENDING', v_user, v_user, p_club_id, p_rugby_code,
    v_first, v_surname, p_date_of_birth, upper(nullif(p_playing_pathway,'')), v_match_player_id
  )
  returning id into v_request_id;

  return query select v_request_id, 'PENDING'::text;
end;
$$;

create or replace function public.request_additional_guardian(p_player_id uuid, p_email text)
returns table(request_id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_subject uuid;
  v_club_id uuid;
  v_request_id uuid;
begin
  if v_user is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  -- Only someone who already holds the relationship may propose another adult for this child.
  if not internal.can_player_as_family('family.relationship.request', p_player_id)
     or not exists (select 1 from public.guardians g
                    where g.guardian_user_id = v_user and g.player_id = p_player_id and g.state = 'ACTIVE') then
    raise exception 'You are not authorised to add a guardian for this player.' using errcode = '42501';
  end if;
  if v_email = '' or v_email not like '%_@_%._%' then
    raise exception 'A valid email address is required.' using errcode = '22023';
  end if;

  select s.club_id into v_club_id
  from internal.player_scopes(p_player_id) s
  order by (s.place_state = 'ACTIVE') desc
  limit 1;
  if v_club_id is null then
    raise exception 'This player is not attached to a club yet.' using errcode = '23514';
  end if;

  select u.id into v_subject from auth.users u where lower(u.email) = v_email limit 1;

  if v_subject is not null and exists (
    select 1 from public.guardians g
    where g.guardian_user_id = v_subject and g.player_id = p_player_id and g.state = 'ACTIVE'
  ) then
    return query select null::uuid, 'ALREADY_LINKED'::text;
    return;
  end if;

  select glr.id into v_request_id
  from public.guardian_link_requests glr
  where glr.kind = 'ADDITIONAL_GUARDIAN'
    and glr.status = 'PENDING'
    and glr.target_player_id = p_player_id
    and coalesce(glr.subject_user_id::text, lower(glr.invited_email)) = coalesce(v_subject::text, v_email);
  if v_request_id is not null then
    return query select v_request_id, 'PENDING'::text;
    return;
  end if;

  insert into public.guardian_link_requests (
    kind, status, requested_by_user_id, subject_user_id, invited_email,
    club_id, target_player_id
  )
  values (
    'ADDITIONAL_GUARDIAN', 'PENDING', v_user, v_subject, v_email,
    v_club_id, p_player_id
  )
  returning id into v_request_id;

  return query select v_request_id, 'PENDING'::text;
end;
$$;

create or replace function public.respond_to_additional_guardian_request(p_request_id uuid, p_response text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.guardian_link_requests;
begin
  if auth.uid() is null or not internal.can('family.relationship.request', 'self') then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if p_response not in ('ACCEPT', 'DECLINE') then
    raise exception 'Accept or decline the request.' using errcode = '22023';
  end if;
  select * into v_request from public.guardian_link_requests where id = p_request_id for update;
  if v_request.id is null or v_request.kind <> 'ADDITIONAL_GUARDIAN'
     or not (v_request.subject_user_id = auth.uid()
             or (v_request.subject_user_id is null and lower(v_request.invited_email) = lower(coalesce(auth.email(), '')))) then
    raise exception 'This request is no longer available.' using errcode = '42501';
  end if;
  if v_request.status <> 'PENDING' then
    raise exception 'This request has already been decided.' using errcode = '23514';
  end if;
  if v_request.subject_response is not null then
    raise exception 'You have already answered this request.' using errcode = '23514';
  end if;
  if exists (select 1 from public.guardians where guardian_user_id = auth.uid() and player_id = v_request.target_player_id and state = 'ACTIVE') then
    raise exception 'You are already a guardian of this child.' using errcode = '23514';
  end if;

  if p_response = 'ACCEPT' then
    update public.guardian_link_requests
    set subject_user_id = auth.uid(), subject_response = 'ACCEPTED', subject_responded_at = now()
    where id = p_request_id;
    perform internal.open_additional_guardian_relationship(p_request_id);
    return 'accepted';
  end if;

  update public.guardian_link_requests
  set subject_user_id = auth.uid(), subject_response = 'DECLINED', subject_responded_at = now(),
      status = 'REJECTED', decided_at = now(), decision_note = 'Declined by the person asked to be a guardian.'
  where id = p_request_id;
  perform internal.decline_requested_relationship(p_request_id, 'Declined by the person asked to be a guardian.');
  perform internal.emit_security_event('guardian.link_declined', auth.uid(), 'SUCCESS', 'Declined by the person asked to be a guardian.',
    jsonb_build_object('request_id', p_request_id, 'kind', v_request.kind, 'decided_by', 'SUBJECT'),
    v_request.club_id, null, v_request.target_player_id);
  return 'declined';
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 8. Player accounts (J.6 player.account.invite / player.account.link). Issuance and redemption stay on the
--    legacy table, with its Phase 0 email binding, until Slice 5's unified invitations.
-- ---------------------------------------------------------------------------------------------------------

create or replace function public.invite_player_account(p_player_id uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_id uuid;
begin
  if not internal.can('player.account.invite', 'child', null, null, p_player_id) then
    raise exception 'You are not authorised to invite a login for this player.' using errcode = '42501';
  end if;
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid email address is required.' using errcode = '22023';
  end if;
  if exists (select 1 from public.players where id = p_player_id and user_id is not null) then
    raise exception 'This player already has their own Ovalball login.' using errcode = '23514';
  end if;
  if exists (select 1 from public.player_account_invitations where player_id = p_player_id and status = 'pending') then
    raise exception 'A login invitation is already pending for this player.' using errcode = '23514';
  end if;

  insert into public.player_account_invitations (player_id, invited_email, invited_by)
  values (p_player_id, v_email, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.accept_player_account_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.player_account_invitations;
begin
  if auth.uid() is null or not internal.can('player.account.link', 'self') then
    raise exception 'You must be signed in to accept this invitation.' using errcode = '42501';
  end if;

  select * into inv from public.player_account_invitations where token = p_token for update;
  if inv.id is null then
    raise exception 'Invitation not found.';
  end if;
  if inv.status <> 'pending' then
    raise exception 'This invitation has already been used or is no longer valid.';
  end if;
  if inv.expires_at < now() then
    update public.player_account_invitations set status = 'expired' where id = inv.id;
    raise exception 'This invitation has expired.';
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and lower(u.email) = lower(inv.invited_email)
  ) then
    raise exception 'This invitation was sent to a different email address than the one you are signed in as.' using errcode = '42501';
  end if;
  if exists (select 1 from public.players where user_id = auth.uid()) then
    raise exception 'Your account is already linked to a player profile.';
  end if;
  if exists (select 1 from public.players where id = inv.player_id and user_id is not null) then
    raise exception 'This player already has an Ovalball login.';
  end if;

  update public.players set user_id = auth.uid() where id = inv.player_id;
  update public.player_account_invitations set status = 'accepted', accepted_by = auth.uid(), accepted_at = now() where id = inv.id;

  return inv.player_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 9. Duplicate review (J.6 family.duplicate.resolve, club) and club guardian administration
-- ---------------------------------------------------------------------------------------------------------

create or replace function internal.may_resolve_duplicate_review(p_review_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.player_duplicate_reviews r
    join public.teams t on t.id = r.team_id
    where r.id = p_review_id
      and r.requesting_guardian_user_id is distinct from internal.effective_person()
      and r.submitted_by is distinct from internal.effective_person()
      and internal.can('family.duplicate.resolve', 'club', t.club_id, null, null)
  );
$$;

create or replace function public.resolve_player_duplicate_review_as_existing(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.player_duplicate_reviews;
  v_submitter uuid;
begin
  select * into r from public.player_duplicate_reviews where id = p_review_id for update;
  if r.id is null or not internal.may_resolve_duplicate_review(p_review_id) then
    raise exception 'You are not authorised to resolve this review.' using errcode = '42501';
  end if;
  if r.status <> 'pending' then
    raise exception 'This review has already been resolved.' using errcode = '23514';
  end if;

  v_submitter := r.requesting_guardian_user_id;
  if v_submitter is null and r.guardian_invitation_id is not null then
    select accepted_by into v_submitter from public.guardian_invitations where id = r.guardian_invitation_id;
  end if;
  if v_submitter is null then
    raise exception 'The original applicant for this review could not be found.';
  end if;

  insert into public.guardians (guardian_user_id, player_id, relationship_type, created_by, source, source_invitation_id)
  values (v_submitter, r.matched_player_id, 'guardian', auth.uid(), 'DUPLICATE_RESOLUTION', r.guardian_invitation_id)
  on conflict do nothing;

  insert into public.player_team_memberships (player_id, team_id, created_by, source)
  select r.matched_player_id, r.team_id, auth.uid(), 'DUPLICATE_RESOLUTION'
  where not exists (
    select 1 from public.player_team_memberships where player_id = r.matched_player_id and team_id = r.team_id and state = 'ACTIVE'
  );

  update public.player_duplicate_reviews set status = 'linked_existing', resolved_by = auth.uid(), resolved_at = now() where id = p_review_id;
end;
$$;

create or replace function public.resolve_player_duplicate_review_as_new(p_review_id uuid)
returns table(player_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.player_duplicate_reviews;
  v_submitter uuid;
  v_player_id uuid;
begin
  select * into r from public.player_duplicate_reviews where id = p_review_id for update;
  if r.id is null or not internal.may_resolve_duplicate_review(p_review_id) then
    raise exception 'You are not authorised to resolve this review.' using errcode = '42501';
  end if;
  if r.status <> 'pending' then
    raise exception 'This review has already been resolved.' using errcode = '23514';
  end if;

  v_submitter := r.requesting_guardian_user_id;
  if v_submitter is null and r.guardian_invitation_id is not null then
    select accepted_by into v_submitter from public.guardian_invitations where id = r.guardian_invitation_id;
  end if;
  if v_submitter is null then
    raise exception 'The original applicant for this review could not be found.';
  end if;

  insert into public.players (first_name, surname, date_of_birth, playing_pathway, created_by)
  values (r.submitted_first_name, r.submitted_surname, r.submitted_date_of_birth, r.submitted_playing_pathway, auth.uid())
  returning id into v_player_id;

  insert into public.guardians (guardian_user_id, player_id, relationship_type, created_by, source, source_invitation_id)
  values (v_submitter, v_player_id, 'guardian', auth.uid(), 'DUPLICATE_RESOLUTION', r.guardian_invitation_id);

  insert into public.player_team_memberships (player_id, team_id, created_by, source)
  values (v_player_id, r.team_id, auth.uid(), 'DUPLICATE_RESOLUTION');

  update public.player_duplicate_reviews set status = 'created_new', resolved_by = auth.uid(), resolved_at = now() where id = p_review_id;

  return query select v_player_id;
end;
$$;

create or replace function public.send_replacement_guardian_invitation(p_player_id uuid, p_team_id uuid, p_invited_email text)
returns table(invitation_id uuid, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_club_id uuid;
  v_row public.guardian_invitations;
begin
  select t.club_id into v_club_id from public.teams t where t.id = p_team_id;
  if v_club_id is null or not internal.can('family.relationship.approve', 'club', v_club_id, null, null) then
    raise exception 'You are not authorised to manage Guardian relationships for this player.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.player_team_memberships where player_id = p_player_id and team_id = p_team_id and state = 'ACTIVE') then
    raise exception 'That player is not on this team.' using errcode = '42501';
  end if;

  insert into public.guardian_invitations (club_id, team_id, invited_email, invited_by_user_id, replacement_for_player_id)
  values (v_club_id, p_team_id, lower(trim(p_invited_email)), auth.uid(), p_player_id)
  returning * into v_row;

  return query select v_row.id, v_row.token;
end;
$$;

create or replace function public.get_team_guardian_directory(p_team_id uuid)
returns table(player_id uuid, player_first_name text, player_surname text, guardian_id uuid, guardian_user_id uuid, guardian_first_name text, guardian_surname text, guardian_email text, relationship_type text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id, p.first_name, p.surname,
    g.id, g.guardian_user_id, prof.first_name, prof.surname, prof.email, g.relationship_type
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  join public.guardians g on g.player_id = p.id and g.state = 'ACTIVE'
  join public.profiles prof on prof.id = g.guardian_user_id
  where ptm.team_id = p_team_id
    and ptm.state = 'ACTIVE'
    and (
      internal.can('family.relationship.approve', 'club', (select t.club_id from public.teams t where t.id = p_team_id), null, null)
      or internal.has_site_capability('site.family.manage')
    );
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 10. Player pictures: viewing follows player.profile.view, changing follows player.profile.edit
-- ---------------------------------------------------------------------------------------------------------

create or replace function internal.can_access_player_avatar(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Team staff do not get a children's photo library from a coaching role (player_avatars C9): beyond the
  -- player and their guardians, only the club-level guardian authority (the legacy club.guardians.manage,
  -- now family.relationship.approve at club) sees a child's picture.
  select p_player_id is not null and (
    internal.can_player_as_family('player.profile.view', p_player_id)
    or exists (select 1 from internal.player_scopes(p_player_id) s
               where internal.can('family.relationship.approve', 'club', s.club_id, null, null))
  );
$$;

create or replace function internal.can_edit_player_avatar(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_player_id is not null and internal.can_player_as_family('player.profile.edit', p_player_id);
$$;

create or replace function public.set_player_avatar(p_player_id uuid, p_storage_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text := nullif(trim(coalesce(p_storage_path, '')), '');
begin
  if auth.uid() is null or not internal.can_edit_player_avatar(p_player_id) then
    raise exception 'You are not authorised to change this player''s picture.' using errcode = '42501';
  end if;
  -- The stored path must belong to THIS player's folder.
  if v_path is not null and internal.player_avatar_path_player_id(v_path) is distinct from p_player_id then
    raise exception 'That picture does not belong to this player.' using errcode = '42501';
  end if;

  update public.players set avatar_storage_path = v_path, updated_by = auth.uid(), updated_at = now()
  where id = p_player_id;

  return coalesce(v_path, '');
end;
$$;

drop policy if exists player_avatars_insert on storage.objects;
drop policy if exists player_avatars_update on storage.objects;
drop policy if exists player_avatars_delete on storage.objects;
create policy player_avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'player-avatars' and internal.can_edit_player_avatar(internal.player_avatar_path_player_id(name)));
create policy player_avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'player-avatars' and internal.can_edit_player_avatar(internal.player_avatar_path_player_id(name)));
create policy player_avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'player-avatars' and internal.can_edit_player_avatar(internal.player_avatar_path_player_id(name)));

-- ---------------------------------------------------------------------------------------------------------
-- 11. FR-5: the child's other ACTIVE guardians are told when a guardian is linked, removed or put on hold;
--     a confidential hold tells only the child's confirmed Safeguarding Officers (AN-7).
-- ---------------------------------------------------------------------------------------------------------

insert into public.notification_types (type_key, topic_key, mandatory_override)
values ('guardian_relationship_changed', 'account_security', null)
on conflict (type_key) do nothing;

create or replace function internal.notify_guardian_relationship_change(p_relationship public.guardians, p_event text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player public.players;
  v_title text;
  v_body text;
begin
  select * into v_player from public.players where id = p_relationship.player_id;
  if v_player.id is null then return; end if;

  if p_event = 'guardian.suspended' and p_relationship.confidential then
    insert into public.notifications (user_id, type, title, body, data)
    select distinct ra.user_id, 'guardian_relationship_changed', 'Guardian relationship on hold',
      format('A guardian relationship for %s has been put on hold by Ovalball.', v_player.first_name),
      jsonb_build_object('player_id', v_player.id, 'relationship_id', p_relationship.id, 'event', p_event, 'confidential', true)
    from internal.player_scopes(v_player.id) s
    join public.role_assignments ra on ra.club_id = s.club_id and ra.role_key = 'SAFEGUARDING_OFFICER'
      and ra.state = 'ACTIVE' and ra.confirmation_state = 'CONFIRMED'
    where ra.user_id is distinct from p_relationship.guardian_user_id;
    return;
  end if;

  v_title := case p_event
    when 'guardian.linked' then 'A guardian has been added'
    when 'guardian.unlinked' then 'A guardian has been removed'
    when 'guardian.suspended' then 'A guardian relationship is on hold'
    else 'A guardian relationship has changed' end;
  v_body := case p_event
    when 'guardian.linked' then format('Another adult is now a guardian of %s in Ovalball.', v_player.first_name)
    when 'guardian.unlinked' then format('An adult is no longer a guardian of %s in Ovalball.', v_player.first_name)
    when 'guardian.suspended' then format('A guardian relationship for %s has been put on hold.', v_player.first_name)
    else format('A guardian relationship for %s has changed.', v_player.first_name) end;

  insert into public.notifications (user_id, type, title, body, data)
  select g.guardian_user_id, 'guardian_relationship_changed', v_title, v_body,
    jsonb_build_object('player_id', v_player.id, 'event', p_event)
  from public.guardians g
  where g.player_id = v_player.id and g.state = 'ACTIVE' and g.id <> p_relationship.id
    and g.guardian_user_id <> p_relationship.guardian_user_id
    and not internal.player_is_adult(v_player.id);
end;
$$;

create or replace function internal.guardian_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
  v_reason text;
begin
  if tg_op = 'INSERT' then
    if new.state = 'ACTIVE' then
      v_event := 'guardian.linked';
    end if;
  elsif new.state is distinct from old.state then
    v_event := case
      when new.state = 'ACTIVE' and old.state = 'PENDING_APPROVAL' then 'guardian.linked'
      when new.state = 'ACTIVE' and old.state = 'SUSPENDED' then 'guardian.restored'
      when new.state = 'SUSPENDED' then 'guardian.suspended'
      when new.state = 'REVOKED' then 'guardian.unlinked'
    end;
    v_reason := case new.state
      when 'REVOKED' then new.revocation_reason
      when 'SUSPENDED' then new.suspension_reason
      else new.reason
    end;
  end if;
  if v_event is not null then
    perform internal.emit_security_event(v_event, new.guardian_user_id, 'SUCCESS', v_reason,
      jsonb_build_object('relationship_id', new.id, 'source', new.source, 'from_state', case when tg_op = 'UPDATE' then old.state end, 'to_state', new.state),
      internal.player_event_club(new.player_id), null, new.player_id);
    if v_event in ('guardian.linked', 'guardian.unlinked', 'guardian.suspended') then
      perform internal.notify_guardian_relationship_change(new, v_event);
    end if;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 11b. Ovalball's view of one person's guardian relationships (AN-7 controls). The hold reason and the
--      confidential flag are safeguarding information: they are not column-granted on guardians, so they are
--      read only here, by site.family.manage.
-- ---------------------------------------------------------------------------------------------------------

create or replace function public.get_person_family_relationships(p_user_id uuid)
returns table (guardian_id uuid, player_id uuid, child_first_name text, child_surname text, relationship_type text,
               state text, confidential boolean, suspension_reason text, suspended_at timestamptz, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform internal.require_site_capability('site.family.manage');
  return query
  select g.id, g.player_id, pl.first_name, pl.surname, g.relationship_type, g.state, g.confidential, g.suspension_reason, g.suspended_at, g.created_at
  from public.guardians g
  join public.players pl on pl.id = g.player_id
  where g.guardian_user_id = p_user_id and g.state in ('ACTIVE', 'SUSPENDED')
  order by pl.first_name, pl.surname;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- 12. Privileges: new helpers are policy/RPC internals; the staff projection is an authenticated read
-- ---------------------------------------------------------------------------------------------------------

revoke all on function internal.player_is_adult(uuid) from public, anon;
revoke all on function internal.player_scopes(uuid) from public, anon;
revoke all on function internal.can_player_at_club_or_team(text, uuid, boolean) from public, anon;
revoke all on function internal.can_player_as_family(text, uuid) from public, anon;
revoke all on function internal.player_staff_rows() from public, anon;
revoke all on function internal.can_any(text[], text, uuid, uuid) from public, anon;
revoke all on function internal.may_add_child_at_club(uuid) from public, anon, authenticated;
revoke all on function internal.may_resolve_duplicate_review(uuid) from public, anon, authenticated;
revoke all on function internal.can_edit_player_avatar(uuid) from public, anon;
revoke all on function internal.notify_guardian_relationship_change(public.guardians, text) from public, anon, authenticated;
revoke all on function internal.close_self_added_child(uuid) from public, anon, authenticated;

grant execute on function internal.player_is_adult(uuid) to authenticated;
grant execute on function internal.player_scopes(uuid) to authenticated;
grant execute on function internal.can_player_at_club_or_team(text, uuid, boolean) to authenticated;
grant execute on function internal.can_player_as_family(text, uuid) to authenticated;
grant execute on function internal.player_staff_rows() to authenticated;
grant execute on function internal.can_any(text[], text, uuid, uuid) to authenticated;
grant execute on function internal.can_edit_player_avatar(uuid) to authenticated;

revoke all on public.player_staff_view from public, anon, authenticated;
grant select on public.player_staff_view to authenticated;

revoke all on function public.transition_guardian_relationship(uuid, text, text, boolean) from public, anon;
revoke all on function public.get_person_family_relationships(uuid) from public, anon;
grant execute on function public.get_person_family_relationships(uuid) to authenticated;
grant execute on function public.transition_guardian_relationship(uuid, text, text, boolean) to authenticated;
