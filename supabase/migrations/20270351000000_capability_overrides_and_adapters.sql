-- IDENTITY/AUTH SLICE 3 (3 of 3): EXPLICIT ALLOWS AND WITHHOLDS, AND THE ADAPTERS OVER THE RESOLVER
-- Phase 2 design K.3 (levels), S/V (delegation ceilings), AH R19, AC (provenance), I (Team
-- Administration assigns Coach and Team Manager), J.14 (explicit site capabilities).
--
--   * set_capability_override / revoke_capability_override record the level a decision was made at
--     (SITE, CLUB or TEAM) and refuse anything above the actor's ceiling. A lower level can neither
--     overwrite nor remove a higher decision, nor add an allow a higher withhold would defeat.
--   * club_member_capabilities returns every answer with the rule and level it came from.
--   * The Club Home content adapters and the fixture planning adapters ask the canonical keys.
--   * Team Administration holders assign and remove Coach and Team Manager on their own team.
--   * Site Admin club-profile editing, which relied on the removed club bypass, is now the explicit
--     site capability site.clubs.profile.manage; the legacy site switches resolve as site capabilities.

-- ---------------------------------------------------------------------------------------------
-- 1. explicit allows and withholds
-- ---------------------------------------------------------------------------------------------

create or replace function internal.override_level_rank(p_level text)
returns int language sql immutable set search_path = '' as $$
  select case p_level when 'SITE' then 3 when 'CLUB' then 2 when 'TEAM' then 1 else 0 end;
$$;

-- The level at which the caller decides this key for this scope: the lowest level they hold that is at
-- least p_minimum (a Club Admin who is also a Site Admin decides their own club's permissions as the
-- club; only a Site Admin reaches SITE), or null when they hold none.
create or replace function internal.override_authority_level(p_key text, p_scope_type text, p_club uuid, p_team uuid, p_minimum text default null)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.capabilities;
  v_actor uuid := internal.actor();
  v_levels text[] := array[]::text[];
begin
  select * into c from public.capabilities where key = p_key;
  if c.key is null then
    return null;
  end if;
  -- a club or team delegate must hold the key itself at that scope: nobody delegates what they do not have
  -- The level is the decider's own level: a club authority decides as the club even on a team; only a
  -- person whose delegation authority is the team's alone decides at TEAM level.
  if p_scope_type in ('club', 'team') and c.delegable and not c.safeguarding_sensitive then
    if c.grant_level in ('C', 'T')
       and internal.bundle_source(v_actor, 'people.capability.manage', 'club', p_club, null, null, true) is not null
       and internal.can('people.capability.manage', 'club', p_club, null, null)
       and internal.bundle_source(v_actor, p_key, p_scope_type, p_club, p_team, null, c.inherits_to_team) is not null then
      v_levels := array_append(v_levels, 'CLUB');
    elsif p_scope_type = 'team' and c.grant_level = 'T'
       and internal.can('people.capability.manage', 'team', p_club, p_team, null)
       and internal.bundle_source(v_actor, p_key, 'team', p_club, p_team, null, c.inherits_to_team) is not null then
      v_levels := array_append(v_levels, 'TEAM');
    end if;
  end if;
  if internal.has_site_capability('site.capabilities.override') then
    v_levels := array_append(v_levels, 'SITE');
  end if;
  return (select l from unnest(v_levels) l
          where internal.override_level_rank(l) >= internal.override_level_rank(p_minimum)
          order by internal.override_level_rank(l) limit 1);
end;
$$;

drop function if exists public.set_capability_override(uuid, text, text, uuid, uuid, text, text);

create or replace function public.set_capability_override(
  p_user_id uuid,
  p_capability_key text,
  p_scope_type text,
  p_club_id uuid,
  p_team_id uuid,
  p_effect text,
  p_reason text default null,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
  if not internal.is_account_active(p_user_id) then
    raise exception 'That account is not active.' using errcode = '23514';
  end if;
  if p_scope_type in ('club', 'team') and not exists (
    select 1 from public.club_memberships cm where cm.club_id = p_club_id and cm.user_id = p_user_id and cm.state = 'ACTIVE') then
    raise exception 'This person is not an active member of the club -- a permission decision adjusts real authority, it does not create a relationship.' using errcode = '23514';
  end if;
  if p_scope_type = 'site' and not exists (select 1 from public.club_memberships cm where cm.user_id = p_user_id and cm.state = 'ACTIVE') then
    raise exception 'This person holds no club membership for a site-wide decision to adjust.' using errcode = '23514';
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
$$;

drop function if exists public.revoke_capability_override(uuid);

create or replace function public.revoke_capability_override(p_override_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- The catalogue now says what a club may delegate.
create or replace function internal.club_delegable_capability(p_capability_key text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.capabilities c
    where c.key = coalesce((select m.capability_key from public.capability_key_map m where m.legacy_key = p_capability_key and m.legacy_scope = 'club'), p_capability_key)
      and c.status = 'ACTIVE' and c.delegable and c.grant_level in ('C', 'T') and not c.safeguarding_sensitive);
$$;

drop policy if exists capability_overrides_select_scoped on public.capability_overrides;
create policy capability_overrides_select_scoped on public.capability_overrides for select to authenticated
  using (
    user_id = (select auth.uid())
    or (club_id is not null and internal.can('people.capability.manage', 'club', club_id, null, null))
    or (select internal.has_site_capability('site.users.view'))
  );

-- ---------------------------------------------------------------------------------------------
-- 2. Club Permissions: every answer with its provenance (AC)
-- ---------------------------------------------------------------------------------------------

drop function if exists public.club_member_capabilities(uuid);

create or replace function public.club_member_capabilities(p_club_id uuid, p_capability_keys text[] default null)
returns table (user_id uuid, capability_key text, effective boolean, source text, override_id uuid,
               decisive_rule text, reason_code text, override_level text, editable boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_site_view boolean := internal.has_site_capability('site.users.view');
begin
  if not (v_site_view or internal.can('people.capability.manage', 'club', p_club_id, null, null)) then
    raise exception 'You do not have permission to view this club''s capabilities.' using errcode = '42501';
  end if;

  return query
  with keys as (
    select c.key, internal.override_authority_level(c.key, 'club', p_club_id, null, 'CLUB') as club_level,
           internal.override_authority_level(c.key, 'club', p_club_id, null, 'SITE') as site_level
    from public.capabilities c
    where c.status = 'ACTIVE' and 'club' = any (c.valid_scopes) and c.delegable and c.grant_level in ('C', 'T')
      and not c.safeguarding_sensitive
      and (p_capability_keys is null or c.key = any (
        select coalesce((select m.capability_key from public.capability_key_map m where m.legacy_key = k and m.legacy_scope = 'club'), k)
        from unnest(p_capability_keys) k))
  ),
  members as (
    select cm.user_id from public.club_memberships cm where cm.club_id = p_club_id and cm.state = 'ACTIVE'
  )
  select m.user_id, k.key, d.allowed,
    case d.reason_code
      when 'ROLE_BUNDLE' then 'role'
      when 'EXPLICIT_ALLOW' then 'granted'
      when 'EXPLICIT_DENY' then case when d.decisive_source ->> 'level' = 'SITE' then 'restricted' else 'denied' end
      else 'none' end,
    o.id, d.decisive_rule, d.reason_code, o.granted_level,
    (m.user_id <> internal.actor()
      and case when o.granted_level = 'SITE' then k.site_level is not null else coalesce(k.club_level, k.site_level) is not null end)
  from members m
  cross join keys k
  cross join lateral internal.capability_decision(m.user_id, k.key, 'club', p_club_id, null, null, false, false) d
  left join public.capability_overrides o
    on o.user_id = m.user_id and o.capability_key = k.key and o.scope_type = 'club' and o.club_id = p_club_id and o.status = 'active';
end;
$$;

-- Deactivating a Safeguarding Officer ends every decision about their safeguarding capabilities, whichever
-- key it was recorded under.
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
      -- the four Safeguarding Officer capabilities, under their legacy and canonical keys
      and capability_key in ('club.dispensation.view', 'club.dispensation.notify', 'club.transfer.safeguarding_view', 'club.transfer.safeguarding_notify',
                             'safeguarding.dispensation.view', 'safeguarding.dispensation.notify', 'safeguarding.transfer.view', 'safeguarding.transfer.notify')
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

-- Safeguarding notifications go to the club's active officers who hold the capability now: the
-- Safeguarding Officer bundle by default (J.12, replacing per-officer grants), less any withhold.
create or replace function internal.notify_club_safeguarding_officers(p_club_id uuid, p_capability_key text, p_type text, p_title text, p_body text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  select m.capability_key into v_key from public.capability_key_map m where m.legacy_key = p_capability_key and m.legacy_scope = 'club';
  v_key := coalesce(v_key, p_capability_key);
  insert into public.notifications (user_id, type, title, body, data)
  select distinct o.user_id, p_type, p_title, p_body, p_data
  from public.club_safeguarding_officers o
  where o.club_id = p_club_id and o.status = 'active' and o.user_id is not null
    and (internal.capability_decision(o.user_id, v_key, 'club', p_club_id, null, null, false, false)).allowed;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. adapters behind their existing boundaries
-- ---------------------------------------------------------------------------------------------

-- Club Home: the same boundary functions, now asking the canonical resolver directly.
create or replace function internal.may_edit_club_content(p_club_id uuid, p_team_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_club_id is null then
    return false;
  end if;
  -- A team is only ever a scope inside its own club.
  if p_team_id is not null
     and not exists (select 1 from public.teams t where t.id = p_team_id and t.club_id = p_club_id) then
    return false;
  end if;
  if internal.can('club.news.manage', 'club', p_club_id, null, null) then
    return true;
  end if;
  return p_team_id is not null and internal.can('team.news.manage', 'team', p_club_id, p_team_id, null);
end;
$$;

create or replace function internal.may_publish_club_content(p_club_id uuid, p_team_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Deliberately separate, with today the same answer: publishing is where a future split would land.
  return internal.may_edit_club_content(p_club_id, p_team_id);
end;
$$;

create or replace function internal.may_view_club_member_content(p_club_id uuid, p_team_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_club_id is null then
    return false;
  end if;
  if p_team_id is not null
     and not exists (select 1 from public.teams t where t.id = p_team_id and t.club_id = p_club_id) then
    return false;
  end if;
  return internal.can('club.profile.view', 'club', p_club_id, null, null)
      or (p_team_id is not null and internal.can('team.team.view', 'team', p_club_id, p_team_id, null));
end;
$$;

-- Fixtures: single-fixture authority and bulk planning authority stay two different questions.
create or replace function internal.can_bulk_plan_fixtures(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_club_id is not null
    and internal.can_manage_club_fixtures(p_club_id)
    -- bulk planning is club administration (CA, FS) or explicit Ovalball fixture support (J.7 site
    -- master equivalent), never team authority and never a blanket Site Admin bypass
    and (internal.can('fixture.planner.use', 'club', p_club_id, null, null)
         or internal.has_site_capability('site.fixtures.support'));
$$;

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
        (internal.can_manage_club_fixtures(p_club_id)
          and (internal.can('fixture.fixture.create', 'club', p_club_id, null, null) or internal.has_site_capability('site.fixtures.support')))
        or (internal.can_manage_team(p_team_id) and internal.can('fixture.fixture.create', 'team', p_club_id, p_team_id, null))
      )
  );
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Team Administration assigns Coach and Team Manager on its own team (I, J.3)
-- ---------------------------------------------------------------------------------------------

alter table public.role_assignments drop constraint if exists role_assignments_suspended_level_check;
alter table public.role_assignments add constraint role_assignments_suspended_level_check
  check (suspended_level = any (array['CLUB', 'SITE', 'TEAM']));

-- CLUB level is a Club Admin whose people authority resolves (a withhold on people.role.assign_club stops
-- it); SITE level is the explicit master-control capability (only Full Site Admins hold it, SA-5).
create or replace function internal.club_people_authority(p_club_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when internal.holds_club_role(p_club_id, 'CLUB_ADMIN', auth.uid())
         and internal.can('people.role.assign_club', 'club', p_club_id, null, null) then 'CLUB'
    when internal.has_site_capability('site.club_roles.manage') then 'SITE'
  end;
$$;

-- CLUB and SITE as for club roles; TEAM_ADMIN when the caller holds people.role.assign_team on this team
-- through Team Administration (or a valid delegated allow). Returns null otherwise.
create or replace function internal.team_people_level(p_club_id uuid, p_team_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when internal.holds_club_role(p_club_id, 'CLUB_ADMIN', auth.uid())
         and (p_team_id is null or internal.can('people.role.assign_team', 'team', p_club_id, p_team_id, null)) then 'CLUB'
    when internal.has_site_capability('site.team_roles.manage') then 'SITE'
    when p_team_id is not null and not internal.holds_club_role(p_club_id, 'CLUB_ADMIN', auth.uid())
         and internal.can('people.role.assign_team', 'team', p_club_id, p_team_id, null) then 'TEAM_ADMIN'
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
  if auth.uid() is null or not internal.session_ok() then
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
  v_level := case when v_role.scope = 'CLUB' or p_team_id is null then internal.club_people_authority(v_club)
                  else internal.team_people_level(v_club, p_team_id) end;
  if v_level is null or not (v_level = any (v_role.assignable_by)) then
    raise exception 'You are not authorised to give the % role at this club.', v_role.label using errcode = '42501';
  end if;
  if p_role_key = 'SAFEGUARDING_OFFICER' then
    raise exception 'A Safeguarding Officer is appointed through nomination and acceptance, not assigned.' using errcode = '42501';
  end if;
  if v_level in ('SITE', 'TEAM_ADMIN') and v_membership.user_id = auth.uid() then
    raise exception 'You cannot give yourself a role.' using errcode = '42501';
  end if;
  v_reason := internal.require_reason(p_reason, v_level = 'SITE');

  return internal.grant_role(p_membership_id, p_role_key, p_team_id,
    case v_level when 'SITE' then 'SITE_ADMIN_ASSIGNMENT' when 'TEAM_ADMIN' then 'TEAM_ADMIN_ASSIGNMENT' else 'CLUB_ADMIN_ASSIGNMENT' end, v_reason);
end;
$$;

create or replace function public.transition_role_assignment(p_assignment_id uuid, p_to_state text, p_reason text default null, p_allow_no_club_admin boolean default false)
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
  v_store_level text;
  v_reason text;
begin
  if auth.uid() is null or not internal.session_ok() then
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

  v_level := case when v_assignment.team_id is null then internal.club_people_authority(v_club)
                  else internal.team_people_level(v_club, v_assignment.team_id) end;
  if v_level is null or not (v_level = any (v_role.assignable_by)) then
    raise exception 'You are not authorised to change the % role at this club.', v_role.label using errcode = '42501';
  end if;
  if v_assignment.role_key = 'SAFEGUARDING_OFFICER' then
    raise exception 'A Safeguarding Officer is changed through the club''s safeguarding settings.' using errcode = '42501';
  end if;
  if v_level in ('SITE', 'TEAM_ADMIN') and v_assignment.user_id = auth.uid() then
    raise exception 'You cannot change your own roles.' using errcode = '42501';
  end if;
  v_store_level := case v_level when 'TEAM_ADMIN' then 'TEAM' else v_level end;

  if p_to_state = 'SUSPENDED' then
    if v_assignment.state <> 'ACTIVE' then
      raise exception 'Only an active role can be suspended.' using errcode = '23514';
    end if;
    v_reason := internal.require_reason(p_reason, true);
    perform internal.assert_club_keeps_an_admin(v_club, array[p_assignment_id], p_allow_no_club_admin, v_reason);
    perform internal.end_role(p_assignment_id, 'SUSPENDED', v_reason, v_store_level);

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
    -- A lower level never lifts a more senior suspension.
    if (v_assignment.suspended_level = 'SITE' and v_level <> 'SITE')
       or (v_assignment.suspended_level = 'CLUB' and v_level = 'TEAM_ADMIN') then
      raise exception 'This role was suspended at a higher level, so it can only be restored there.' using errcode = '42501';
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
    perform internal.end_role(p_assignment_id, 'ACTIVE', v_reason, v_store_level);

  elsif p_to_state = 'REVOKED' then
    if v_assignment.state = 'REVOKED' then
      raise exception 'This role has already been revoked.' using errcode = '23514';
    end if;
    v_reason := internal.require_reason(p_reason, v_level = 'SITE');
    perform internal.assert_club_keeps_an_admin(v_club, array[p_assignment_id], p_allow_no_club_admin, v_reason);
    perform internal.end_role(p_assignment_id, 'REVOKED', coalesce(v_reason, 'Role removed'), v_store_level);
    if v_assignment.team_id is null and v_assignment.role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY') then
      perform internal.ensure_club_member_role(v_assignment.membership_id,
        case v_level when 'SITE' then 'SITE_ADMIN_ASSIGNMENT' else 'CLUB_ADMIN_ASSIGNMENT' end, v_reason);
    end if;

  else
    raise exception 'A role can be suspended, restored or revoked.' using errcode = '22023';
  end if;
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
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select club_id into v_club from public.club_memberships where id = p_membership_id;
  if v_club is null then
    raise exception 'Membership not found.' using errcode = 'P0002';
  end if;
  perform internal.lock_club_people(v_club);
  select * into v_membership from public.club_memberships where id = p_membership_id for update;
  v_level := internal.team_people_level(v_club, p_team_id);
  if v_level is null then
    raise exception 'You are not authorised to assign team roles at this club.' using errcode = '42501';
  end if;
  if v_level in ('SITE', 'TEAM_ADMIN') and v_membership.user_id = auth.uid() then
    raise exception 'You cannot give yourself a team role.' using errcode = '42501';
  end if;
  if v_level = 'TEAM_ADMIN' then
    -- Team Administration assigns Coach and Team Manager only, and never takes Team Administration
    -- away from someone else (changing their role would end it).
    if p_permission not in ('coach', 'manager') then
      raise exception 'Only the club can give Team Admin.' using errcode = '42501';
    end if;
    if exists (select 1 from public.role_assignments ra where ra.membership_id = p_membership_id and ra.team_id = p_team_id
               and ra.role_key = 'TEAM_ADMINISTRATION' and ra.state <> 'REVOKED') then
      raise exception 'Only the club can change the role of someone with Team Admin.' using errcode = '42501';
    end if;
  end if;
  v_reason := internal.require_reason(p_reason, v_level = 'SITE');
  return internal.apply_team_access(p_membership_id, p_team_id, p_permission,
    case v_level when 'SITE' then 'SITE_ADMIN_ASSIGNMENT' when 'TEAM_ADMIN' then 'TEAM_ADMIN_ASSIGNMENT' else 'CLUB_ADMIN_ASSIGNMENT' end, v_reason);
end;
$$;

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
  if auth.uid() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into v_assignment from public.role_assignments where id = p_team_permission_id and team_id is not null;
  if v_assignment.id is null then
    raise exception 'Team role not found.' using errcode = 'P0002';
  end if;
  perform internal.lock_club_people(v_assignment.club_id);
  perform 1 from public.club_memberships where id = v_assignment.membership_id for update;
  v_level := internal.team_people_level(v_assignment.club_id, v_assignment.team_id);
  if v_level is null then
    raise exception 'You are not authorised to remove team roles at this club.' using errcode = '42501';
  end if;
  if v_level in ('SITE', 'TEAM_ADMIN') and v_assignment.user_id = auth.uid() then
    raise exception 'You cannot change your own team roles.' using errcode = '42501';
  end if;
  if v_level = 'TEAM_ADMIN' and exists (
    select 1 from public.role_assignments ra where ra.membership_id = v_assignment.membership_id and ra.team_id = v_assignment.team_id
      and ra.role_key = 'TEAM_ADMINISTRATION' and ra.state <> 'REVOKED') then
    raise exception 'Only the club can remove someone with Team Admin.' using errcode = '42501';
  end if;
  v_reason := internal.require_reason(p_reason, v_level = 'SITE');
  if internal.clear_team_access(v_assignment.membership_id, v_assignment.team_id, v_reason) = 0 then
    raise exception 'This person has no team role here to remove.' using errcode = '23514';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. explicit site capabilities where Site Admin relied on the removed bypass
-- ---------------------------------------------------------------------------------------------

drop policy if exists clubs_update_admin on public.clubs;
create policy clubs_update_admin on public.clubs for update
  using (internal.has_capability('club.edit_profile', 'club', id, null)
         or (select internal.has_site_capability('site.clubs.profile.manage')));

drop policy if exists club_logos_insert_club_admin on storage.objects;
drop policy if exists club_logos_update_club_admin on storage.objects;
drop policy if exists club_logos_delete_club_admin on storage.objects;
create policy club_logos_insert_club_admin on storage.objects for insert
  with check (bucket_id = 'club-logos' and (
    internal.has_capability('club.logo.manage', 'club', ((storage.foldername(name))[1])::uuid, null)
    or (select internal.has_site_capability('site.clubs.profile.manage'))));
create policy club_logos_update_club_admin on storage.objects for update
  using (bucket_id = 'club-logos' and (
    internal.has_capability('club.logo.manage', 'club', ((storage.foldername(name))[1])::uuid, null)
    or (select internal.has_site_capability('site.clubs.profile.manage'))));
create policy club_logos_delete_club_admin on storage.objects for delete
  using (bucket_id = 'club-logos' and (
    internal.has_capability('club.logo.manage', 'club', ((storage.foldername(name))[1])::uuid, null)
    or (select internal.has_site_capability('site.clubs.profile.manage'))));

-- The legacy site switches are site capabilities now (profile bundle or add-on grant), one answer.
create or replace function internal.can_manage_competitions()
returns boolean language sql stable security definer set search_path = '' as $$
  select internal.has_site_capability('site.competitions.manage');
$$;

create or replace function internal.can_manage_fixture_support()
returns boolean language sql stable security definer set search_path = '' as $$
  select internal.has_site_capability('site.fixtures.support');
$$;

create or replace function internal.can_manage_global_lookups()
returns boolean language sql stable security definer set search_path = '' as $$
  select internal.has_site_capability('site.lookups.manage');
$$;

create or replace function internal.can_manage_permissions()
returns boolean language sql stable security definer set search_path = '' as $$
  select internal.has_site_capability('site.permissions.manage');
$$;

create or replace function internal.can_manage_team_catalogue()
returns boolean language sql stable security definer set search_path = '' as $$
  select internal.has_site_capability('site.team_catalogue.manage');
$$;

create or replace function public.enter_diagnostic_club(p_club_id uuid)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_session_id uuid;
  v_club_status text;
begin
  if not internal.is_site_admin() then
    raise exception 'Site Admin access is required.' using errcode = '42501';
  end if;

  -- Declared support viewing is the site capability site.support.view_club (profile bundle or add-on).
  if not internal.has_site_capability('site.support.view_club') then
    raise exception 'Diagnostic club access has not been granted to your account.' using errcode = '42501';
  end if;

  select c.status into v_club_status from public.clubs c where c.id = p_club_id;
  if v_club_status is null then
    raise exception 'Club not found.';
  end if;
  if v_club_status <> 'active' then
    raise exception 'That club is not active.';
  end if;

  -- Close any session this admin left open (e.g. they navigated away
  -- without hitting Exit) before opening a new one, so exactly one
  -- diagnostic session is ever open per admin.
  update public.site_admin_diagnostic_sessions
  set exited_at = now()
  where site_admin_user_id = auth.uid() and exited_at is null;

  insert into public.site_admin_diagnostic_sessions (site_admin_user_id, club_id)
  values (auth.uid(), p_club_id)
  returning id into v_session_id;

  return v_session_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 6. access
-- ---------------------------------------------------------------------------------------------

revoke all on function public.set_capability_override(uuid, text, text, uuid, uuid, text, text, timestamptz) from public, anon;
revoke all on function public.revoke_capability_override(uuid, text) from public, anon;
revoke all on function public.club_member_capabilities(uuid, text[]) from public, anon;
grant execute on function public.set_capability_override(uuid, text, text, uuid, uuid, text, text, timestamptz),
  public.revoke_capability_override(uuid, text), public.club_member_capabilities(uuid, text[]) to authenticated, service_role;

revoke all on function internal.override_level_rank(text) from public, anon, authenticated;
revoke all on function internal.override_authority_level(text, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function internal.team_people_level(uuid, uuid) from public, anon, authenticated;
