-- IDENTITY/AUTH SLICE 3 (2 of 3): ONE CAPABILITY RESOLVER, AND SITE ADMIN PROFILES IN THE DATABASE
-- Phase 2 design K (precedence), L (scopes), R (site profiles, SA-1..SA-7), Y.8 / Y.11 / Y.20, AC.
--
-- internal.capability_decision is the single answer to "can this person do this, here?". Everything
-- that decides authority now asks it: internal.can and its scope wrappers, the legacy
-- internal.has_capability (re-implemented over it, WITHOUT the old Site Admin club/team bypass),
-- my_capabilities (what the interface may show) and explain_access (why).
--
-- Evaluation order (K.2); the first rule that matches decides:
--   0 session        the caller's session is not usable
--   1 hard rule      account not ACTIVE, retired key, invalid or tampered scope, organisation scope,
--                    impersonation limits, minor with a minor-prohibited key, club not active,
--                    membership SUSPENDED (an archived team is a domain rule, enforced where it matters)
--   2 site deny      a SITE-level withhold at this scope or any broader one
--   3 club deny      a CLUB-level withhold at the club (reaching teams only when the key inherits)
--                    or at the exact team
--   4 team deny      a TEAM-level withhold at the exact team
--   5 allow          an explicit allow at this or a broader scope, whose grantor still holds the
--                    authority to give it (SITE level is always valid)
--   6 role bundle    an ACTIVE role or relationship whose bundle holds the key here
--   7 site           site-scope keys only: the Site Admin profile or an add-on grant
--   8 default        DENY
--
-- AAL: Phase 2 marks every capability's AAL requirement (capabilities.aal). Enforcement belongs to the
-- authentication slice, and the approved Slice 1 moved enforcement groups there with
-- account_security_state, so rule 0's AAL hook (internal.session_aal_ok) returns true here and says so.
-- Impersonation belongs to Slice 9: internal.impersonation_mode returns null until then.

-- ---------------------------------------------------------------------------------------------
-- 1. Site Admin profiles (Y.11, R)
-- ---------------------------------------------------------------------------------------------

alter table public.site_admins drop constraint site_admins_admin_role_check;
alter table public.site_admins add constraint site_admins_admin_role_check
  check (admin_role in ('full', 'fixture_ops', 'club_data', 'user_access', 'message_moderator', 'read_only', 'content'));
alter table public.site_admins add column profile_key text references public.capability_bundles (bundle_key);

update public.site_admins set profile_key = case admin_role
  when 'full' then 'SITE_FULL'
  when 'fixture_ops' then 'SITE_OPS'
  when 'club_data' then 'SITE_DATA'
  when 'user_access' then 'SITE_SUPPORT'
  when 'message_moderator' then 'SITE_MOD'
  when 'read_only' then 'SITE_RO'
end;
alter table public.site_admins alter column profile_key set not null;
alter table public.site_admins add constraint site_admins_profile_key_site_profile
  check (profile_key in ('SITE_FULL', 'SITE_OPS', 'SITE_DATA', 'SITE_SUPPORT', 'SITE_MOD', 'SITE_CONTENT', 'SITE_RO'));

create or replace function internal.site_profile_for_admin_role(p_admin_role text)
returns text language sql immutable set search_path = '' as $$
  select case p_admin_role
    when 'full' then 'SITE_FULL' when 'fixture_ops' then 'SITE_OPS' when 'club_data' then 'SITE_DATA'
    when 'user_access' then 'SITE_SUPPORT' when 'message_moderator' then 'SITE_MOD' when 'read_only' then 'SITE_RO'
    when 'content' then 'SITE_CONTENT' end;
$$;

create or replace function internal.admin_role_for_site_profile(p_profile_key text)
returns text language sql immutable set search_path = '' as $$
  select case p_profile_key
    when 'SITE_FULL' then 'full' when 'SITE_OPS' then 'fixture_ops' when 'SITE_DATA' then 'club_data'
    when 'SITE_SUPPORT' then 'user_access' when 'SITE_MOD' then 'message_moderator' when 'SITE_RO' then 'read_only'
    when 'SITE_CONTENT' then 'content' end;
$$;

-- admin_role stays the compatibility column: whichever of the two a writer sets, the other follows.
-- Named to run before prevent_last_full_admin_lockout, so the guard sees the final role.
create or replace function internal.site_admin_profile_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.profile_key is null then
      new.profile_key := internal.site_profile_for_admin_role(new.admin_role);
    end if;
    new.admin_role := internal.admin_role_for_site_profile(new.profile_key);
  elsif new.profile_key is distinct from old.profile_key then
    new.admin_role := internal.admin_role_for_site_profile(new.profile_key);
  elsif new.admin_role is distinct from old.admin_role then
    new.profile_key := internal.site_profile_for_admin_role(new.admin_role);
  end if;
  -- An unknown legacy role leaves no profile; the last-Full guard and the NOT NULL constraint refuse it.
  -- SA-2: Read Only carries no add-ons. Moving to Read Only clears the legacy switches with the grants
  -- (site_admin_after_change); switching one on for a Read Only admin is refused.
  if new.profile_key = 'SITE_RO' and (new.diagnostic_club_access or new.manage_team_catalogue or new.manage_competitions
     or new.manage_fixture_support or new.manage_global_lookups or new.manage_permissions or new.manage_seasons or new.manage_system
     or new.view_commercial or new.view_regulatory_content or new.manage_regulatory_content or new.view_hub_content or new.manage_hub_content) then
    if tg_op = 'UPDATE' and old.profile_key is distinct from 'SITE_RO' then
      new.diagnostic_club_access := false; new.manage_team_catalogue := false; new.manage_competitions := false;
      new.manage_fixture_support := false; new.manage_global_lookups := false; new.manage_permissions := false;
      new.manage_seasons := false; new.manage_system := false; new.view_commercial := false; new.view_regulatory_content := false;
      new.manage_regulatory_content := false; new.view_hub_content := false; new.manage_hub_content := false;
    else
      raise exception 'A Read Only Site Admin cannot be given additional capabilities.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger a_site_admin_profile_sync
  before insert or update on public.site_admins
  for each row execute function internal.site_admin_profile_sync();

-- SA-6 made structural: the last active Full Site Admin can be neither revoked, narrowed nor deleted.
create or replace function internal.prevent_last_full_admin_lockout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining int;
begin
  if old.status <> 'active' or old.profile_key <> 'SITE_FULL' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.status = 'active' and new.profile_key = 'SITE_FULL' then
    return new;
  end if;
  select count(*) into v_remaining
  from public.site_admins
  where status = 'active' and profile_key = 'SITE_FULL' and id <> old.id;
  if v_remaining = 0 then
    raise exception 'Cannot remove the last remaining Full Site Admin -- Ovalball would have no recoverable administrator. Promote another admin to Full first.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Site capability add-ons (R): explicit, audited grants on top of a profile.
create table public.site_capability_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  capability_key text not null references public.capabilities (key) on update cascade,
  granted_by uuid references auth.users (id),
  granted_at timestamptz not null default now(),
  reason text,
  revoked_by uuid references auth.users (id),
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),
  constraint site_capability_grants_revocation check (revoked_at is not null or (revoked_by is null and revocation_reason is null))
);
create unique index site_capability_grants_active_unique on public.site_capability_grants (user_id, capability_key) where revoked_at is null;

-- The two-admin grant request record (Y.11). Its RPCs belong to Slice 7; the rule is structural now.
create table public.site_admin_grant_requests (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references auth.users (id) on delete cascade,
  profile_key text not null references public.capability_bundles (bundle_key),
  requested_by uuid not null references auth.users (id),
  reason text not null,
  state text not null default 'PENDING' check (state in ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED')),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  decision_reason text,
  expires_at timestamptz not null default (now() + interval '72 hours'),
  created_at timestamptz not null default now(),
  constraint site_admin_grant_requests_profile check (profile_key like 'SITE\_%'),
  constraint site_admin_grant_requests_not_self_request check (requested_by <> target_user_id),
  constraint site_admin_grant_requests_decider_not_requester check (decided_by is null or decided_by <> requested_by),
  constraint site_admin_grant_requests_decider_not_target check (decided_by is null or decided_by <> target_user_id)
);
create index site_admin_grant_requests_state_idx on public.site_admin_grant_requests (state, created_at);

-- Validation of add-ons (SA-2, SA-5, AN-9) and their security events.
create or replace function internal.guard_site_capability_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.site_admins;
  v_cap public.capabilities;
begin
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.capability_key <> old.capability_key or new.granted_at <> old.granted_at
       or new.granted_by is distinct from old.granted_by then
      raise exception 'A site capability grant cannot be rewritten; revoke it and grant again.' using errcode = '23514';
    end if;
    if old.revoked_at is not null then
      raise exception 'A revoked site capability grant stays revoked.' using errcode = '23514';
    end if;
    if new.revoked_at is not null then
      new.revoked_by := coalesce(new.revoked_by, auth.uid());
    end if;
    return new;
  end if;

  select * into v_admin from public.site_admins where user_id = new.user_id;
  select * into v_cap from public.capabilities where key = new.capability_key;
  if v_admin.id is null or v_admin.status <> 'active' then
    raise exception 'Site capabilities can only be added to an active Site Admin.' using errcode = '23514';
  end if;
  if v_cap.status <> 'ACTIVE' or not v_cap.site_addon_allowed then
    raise exception 'That site capability cannot be added on top of a profile.' using errcode = '23514';
  end if;
  if v_admin.profile_key = 'SITE_RO' then
    raise exception 'A Read Only Site Admin cannot be given additional capabilities.' using errcode = '23514';
  end if;
  if v_admin.profile_key = 'SITE_FULL' then
    raise exception 'A Full Site Admin already holds every site capability.' using errcode = '23514';
  end if;
  if new.capability_key = 'site.safeguarding.review' and v_admin.profile_key <> 'SITE_SUPPORT' then
    raise exception 'Safeguarding review can only be added to the User Support profile.' using errcode = '23514';
  end if;
  new.granted_by := coalesce(new.granted_by, auth.uid());
  return new;
end;
$$;

create trigger guard_site_capability_grant
  before insert or update on public.site_capability_grants
  for each row execute function internal.guard_site_capability_grant();

-- The 13 legacy switches on site_admins and the add-on grants describe the same thing. Grants are
-- canonical; the switches are kept equal to them for legacy readers (removed in Slice 10).
create or replace function internal.site_flag_for_capability(p_key text)
returns text language sql immutable set search_path = '' as $$
  select case p_key
    when 'site.support.view_club' then 'diagnostic_club_access'
    when 'site.team_catalogue.manage' then 'manage_team_catalogue'
    when 'site.competitions.manage' then 'manage_competitions'
    when 'site.fixtures.support' then 'manage_fixture_support'
    when 'site.lookups.manage' then 'manage_global_lookups'
    when 'site.permissions.manage' then 'manage_permissions'
    when 'site.seasons.manage' then 'manage_seasons'
    when 'site.system.release.manage' then 'manage_system'
    when 'site.system.beta.manage' then 'manage_system'
    when 'site.commercial.view' then 'view_commercial'
    when 'site.regulatory.view' then 'view_regulatory_content'
    when 'site.regulatory.manage' then 'manage_regulatory_content'
    when 'site.hub.view' then 'view_hub_content'
    when 'site.hub.manage' then 'manage_hub_content'
  end;
$$;

create or replace function internal.site_grant_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flag text;
  v_on boolean;
  v_admin public.site_admins;
begin
  select * into v_admin from public.site_admins where user_id = new.user_id;
  if tg_op = 'INSERT' then
    perform internal.emit_security_event('site_admin.capability_added', new.user_id, 'SUCCESS', new.reason,
      jsonb_build_object('capability_key', new.capability_key, 'grant_id', new.id, 'profile_key', v_admin.profile_key));
  elsif old.revoked_at is null and new.revoked_at is not null then
    perform internal.emit_security_event('site_admin.capability_removed', new.user_id, 'SUCCESS', new.revocation_reason,
      jsonb_build_object('capability_key', new.capability_key, 'grant_id', new.id, 'profile_key', v_admin.profile_key));
  end if;

  v_flag := internal.site_flag_for_capability(new.capability_key);
  if v_flag is null or coalesce(current_setting('ovalball.site_flag_sync', true), '') = 'on' then
    return null;
  end if;
  select exists (
    select 1 from public.site_capability_grants g
    where g.user_id = new.user_id and g.revoked_at is null and internal.site_flag_for_capability(g.capability_key) = v_flag
  ) into v_on;
  perform set_config('ovalball.site_flag_sync', 'on', true);
  execute format('update public.site_admins set %I = $1 where user_id = $2 and %I is distinct from $1', v_flag, v_flag)
    using v_on, new.user_id;
  perform set_config('ovalball.site_flag_sync', '', true);
  return null;
end;
$$;

create trigger site_grant_after_change
  after insert or update on public.site_capability_grants
  for each row execute function internal.site_grant_after_change();

-- Legacy writers still flip the switches (the per-capability Site Admin RPCs). Each change becomes the
-- matching grant or revocation. Profile changes and revocations drop grants the new state cannot
-- hold (SA-2, SA-7), and a profile change is a security event.
create or replace function internal.site_admin_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flag record;
  v_key text;
  v_old boolean;
  v_new boolean;
begin
  if tg_op = 'UPDATE' and new.profile_key is distinct from old.profile_key then
    perform internal.emit_security_event('site_admin.profile_changed', new.user_id, 'SUCCESS', null,
      jsonb_build_object('from_profile', old.profile_key, 'to_profile', new.profile_key));
  end if;
  if tg_op = 'INSERT' then
    perform internal.emit_security_event('site_admin.granted', new.user_id, 'SUCCESS', null,
      jsonb_build_object('profile_key', new.profile_key));
  elsif old.status = 'active' and new.status <> 'active' then
    perform internal.emit_security_event('site_admin.revoked', new.user_id, 'SUCCESS', null,
      jsonb_build_object('profile_key', new.profile_key));
  end if;

  -- SA-7 and SA-2: revocation, or a move to Full or Read Only, leaves no add-ons behind.
  if new.status <> 'active' or new.profile_key in ('SITE_FULL', 'SITE_RO') then
    perform set_config('ovalball.site_flag_sync', 'on', true);
    update public.site_capability_grants
    set revoked_at = now(), revoked_by = auth.uid(),
        revocation_reason = case when new.status <> 'active' then 'Site Admin access ended' else 'Profile changed to ' || new.profile_key end
    where user_id = new.user_id and revoked_at is null;
    perform set_config('ovalball.site_flag_sync', '', true);
    if new.status <> 'active' and new.profile_key <> 'SITE_FULL' then
      perform set_config('ovalball.site_flag_sync', 'on', true);
      update public.site_admins set diagnostic_club_access = false, manage_team_catalogue = false, manage_competitions = false,
        manage_fixture_support = false, manage_global_lookups = false, manage_permissions = false, manage_seasons = false,
        manage_system = false, view_commercial = false, view_regulatory_content = false, manage_regulatory_content = false,
        view_hub_content = false, manage_hub_content = false
      where id = new.id and (diagnostic_club_access or manage_team_catalogue or manage_competitions or manage_fixture_support
        or manage_global_lookups or manage_permissions or manage_seasons or manage_system or view_commercial
        or view_regulatory_content or manage_regulatory_content or view_hub_content or manage_hub_content);
      perform set_config('ovalball.site_flag_sync', '', true);
    end if;
    return null;
  end if;

  if coalesce(current_setting('ovalball.site_flag_sync', true), '') = 'on' then
    return null;
  end if;

  for v_flag in
    select * from (values
      ('diagnostic_club_access', array['site.support.view_club']), ('manage_team_catalogue', array['site.team_catalogue.manage']),
      ('manage_competitions', array['site.competitions.manage']), ('manage_fixture_support', array['site.fixtures.support']),
      ('manage_global_lookups', array['site.lookups.manage']), ('manage_permissions', array['site.permissions.manage']),
      ('manage_seasons', array['site.seasons.manage']), ('manage_system', array['site.system.release.manage', 'site.system.beta.manage']),
      ('view_commercial', array['site.commercial.view']), ('view_regulatory_content', array['site.regulatory.view']),
      ('manage_regulatory_content', array['site.regulatory.manage']), ('view_hub_content', array['site.hub.view']),
      ('manage_hub_content', array['site.hub.manage'])
    ) as f (flag, keys)
  loop
    execute format('select ($1).%I, ($2).%I', v_flag.flag, v_flag.flag) into v_new, v_old using new, old;
    if tg_op = 'INSERT' then v_old := false; end if;
    if v_new is not distinct from v_old then
      continue;
    end if;
    perform set_config('ovalball.site_flag_sync', 'on', true);
    foreach v_key in array v_flag.keys loop
      if v_new then
        insert into public.site_capability_grants (user_id, capability_key, granted_by, reason)
        select new.user_id, v_key, auth.uid(), 'Set through the legacy Site Admin capability switch'
        where not exists (select 1 from public.site_capability_grants g where g.user_id = new.user_id and g.capability_key = v_key and g.revoked_at is null);
      else
        update public.site_capability_grants
        set revoked_at = now(), revoked_by = auth.uid(), revocation_reason = 'Cleared through the legacy Site Admin capability switch'
        where user_id = new.user_id and capability_key = v_key and revoked_at is null;
      end if;
    end loop;
    perform set_config('ovalball.site_flag_sync', '', true);
  end loop;
  return null;
end;
$$;

-- Backfill (AF): flags become add-on grants. A Full Site Admin's switches are already covered by the
-- profile and create nothing; switches on a Read Only row are cleared, with an event, because Read
-- Only holds no add-ons (SA-2). Runs before the change trigger exists, so nothing is emitted twice.
do $$
declare
  v_admin public.site_admins;
  v_flag record;
  v_on boolean;
  v_key text;
begin
  for v_admin in select * from public.site_admins where status = 'active' and profile_key <> 'SITE_FULL' loop
    for v_flag in
      select * from (values
        ('diagnostic_club_access', array['site.support.view_club']), ('manage_team_catalogue', array['site.team_catalogue.manage']),
        ('manage_competitions', array['site.competitions.manage']), ('manage_fixture_support', array['site.fixtures.support']),
        ('manage_global_lookups', array['site.lookups.manage']), ('manage_permissions', array['site.permissions.manage']),
        ('manage_seasons', array['site.seasons.manage']), ('manage_system', array['site.system.release.manage', 'site.system.beta.manage']),
        ('view_commercial', array['site.commercial.view']), ('view_regulatory_content', array['site.regulatory.view']),
        ('manage_regulatory_content', array['site.regulatory.manage']), ('view_hub_content', array['site.hub.view']),
        ('manage_hub_content', array['site.hub.manage'])
      ) as f (flag, keys)
    loop
      execute format('select ($1).%I', v_flag.flag) into v_on using v_admin;
      if not v_on then continue; end if;
      if v_admin.profile_key = 'SITE_RO' then
        perform internal.emit_security_event('site_admin.capability_removed', v_admin.user_id, 'SUCCESS',
          'Read Only Site Admins hold no additional capabilities (Slice 3 backfill)',
          jsonb_build_object('legacy_flag', v_flag.flag, 'profile_key', v_admin.profile_key));
        continue;
      end if;
      foreach v_key in array v_flag.keys loop
        insert into public.site_capability_grants (user_id, capability_key, granted_by, granted_at, reason)
        values (v_admin.user_id, v_key, v_admin.granted_by, v_admin.updated_at, 'Carried over from the legacy Site Admin capability switch (Slice 3 backfill)');
      end loop;
    end loop;
  end loop;
  -- Read Only rows: every switch cleared in one statement (the profile guard refuses a partial state).
  update public.site_admins set diagnostic_club_access = false, manage_team_catalogue = false, manage_competitions = false,
    manage_fixture_support = false, manage_global_lookups = false, manage_permissions = false, manage_seasons = false,
    manage_system = false, view_commercial = false, view_regulatory_content = false, manage_regulatory_content = false,
    view_hub_content = false, manage_hub_content = false
  where profile_key = 'SITE_RO' and (diagnostic_club_access or manage_team_catalogue or manage_competitions or manage_fixture_support
    or manage_global_lookups or manage_permissions or manage_seasons or manage_system or view_commercial
    or view_regulatory_content or manage_regulatory_content or view_hub_content or manage_hub_content);
end $$;

create trigger site_admin_after_change
  after insert or update on public.site_admins
  for each row execute function internal.site_admin_after_change();

-- ---------------------------------------------------------------------------------------------
-- 2. capability_overrides: level provenance (Y.8)
-- ---------------------------------------------------------------------------------------------

alter table public.capability_overrides
  add column granted_level text,
  add column expires_at timestamptz,
  add column revoked_level text,
  add column revocation_reason text;

-- Existing decisions move to their canonical keys (production holds none).
update public.capability_overrides o set capability_key = m.capability_key
from public.capability_key_map m
where m.legacy_key = o.capability_key and m.legacy_scope = o.scope_type and m.capability_key <> o.capability_key;

-- AF: SITE when the grantor was a Site Admin when the override was created, otherwise CLUB.
update public.capability_overrides o
set granted_level = case
  when o.scope_type = 'site' then 'SITE'
  when exists (select 1 from public.site_admins sa where sa.user_id = o.granted_by and sa.granted_at <= o.granted_at
               and (sa.revoked_at is null or sa.revoked_at > o.granted_at)) then 'SITE'
  else 'CLUB' end
where granted_level is null;
update public.capability_overrides set revoked_level = granted_level where status = 'revoked' and revoked_level is null;

-- Writers that predate levels (and direct test fixtures) get the AF rule at insert time.
create or replace function internal.capability_override_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- one representation: a decision recorded under a legacy key is stored under its canonical key
  new.capability_key := coalesce((select m.capability_key from public.capability_key_map m
                                  where m.legacy_key = new.capability_key and m.legacy_scope = new.scope_type), new.capability_key);
  if new.granted_level is null then
    new.granted_level := case
      when new.scope_type = 'site' or exists (select 1 from public.site_admins sa where sa.user_id = new.granted_by and sa.status = 'active') then 'SITE'
      else 'CLUB' end;
  end if;
  return new;
end;
$$;

create trigger a_capability_override_defaults
  before insert or update of capability_key on public.capability_overrides
  for each row execute function internal.capability_override_defaults();
revoke all on function internal.capability_override_defaults() from public, anon, authenticated;

alter table public.capability_overrides
  alter column granted_level set not null,
  add constraint capability_overrides_granted_level_check check (granted_level in ('SITE', 'CLUB', 'TEAM')),
  add constraint capability_overrides_revoked_level_check check (revoked_level is null or revoked_level in ('SITE', 'CLUB', 'TEAM')),
  add constraint capability_overrides_team_level_scope check (granted_level <> 'TEAM' or scope_type = 'team'),
  add constraint capability_overrides_site_scope_level check (scope_type <> 'site' or granted_level = 'SITE');

-- One active decision per person, key and scope (K.3, R19).
create unique index capability_overrides_active_unique on public.capability_overrides
  (user_id, capability_key, scope_type, coalesce(club_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'active';

-- ---------------------------------------------------------------------------------------------
-- 3. session, person and impersonation hooks (Y.20)
-- ---------------------------------------------------------------------------------------------

-- AAL2 is recorded per capability (capabilities.aal) and enforced by the authentication slice.
create or replace function internal.session_aal_ok()
returns boolean language sql stable set search_path = '' as $$
  select true;  -- AAL2 not yet enforced (Phase 2 AK Slice 3 stub; Slice 6 replaces this body).
$$;

create or replace function internal.impersonation_mode()
returns text language sql stable set search_path = '' as $$
  select null::text;  -- no impersonation until Slice 9.
$$;

create or replace function internal.effective_person()
returns uuid language sql stable set search_path = '' as $$
  select auth.uid();
$$;

create or replace function internal.actor()
returns uuid language sql stable set search_path = '' as $$
  select auth.uid();
$$;

-- A live session (K.2 rule 0): signed in, at the required assurance level, and not revoked (H: deleting
-- the auth.sessions row ends authority on the next request, not at JWT expiry).
create or replace function internal.session_live()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session text := auth.jwt() ->> 'session_id';
begin
  if v_uid is null or not internal.session_aal_ok() then
    return false;
  end if;
  if v_session is null or v_session = '' then
    -- Only a token minted outside GoTrue (the service key holder, tests) lacks a session id.
    return true;
  end if;
  if v_session !~ '^[0-9a-fA-F-]{36}$' then
    return false;
  end if;
  return exists (
    select 1 from auth.sessions s
    where s.id = v_session::uuid and s.user_id = v_uid and (s.not_after is null or s.not_after > now())
  );
end;
$$;

-- A usable session for an RPC guard (AA.1): live, and the account is ACTIVE.
create or replace function internal.session_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select internal.session_live() and internal.is_account_active(auth.uid());
$$;

create or replace function internal.require_not_impersonating()
returns void language plpgsql stable set search_path = '' as $$
begin
  if internal.impersonation_mode() is not null then
    raise exception 'That is not available while viewing Ovalball as someone else.' using errcode = '42501';
  end if;
end;
$$;

create or replace function internal.refuse_self_target(p_user_id uuid)
returns void language plpgsql stable set search_path = '' as $$
begin
  if p_user_id is not null and p_user_id = internal.actor() then
    raise exception 'You cannot do that to your own account.' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. site capability (rule 7)
-- ---------------------------------------------------------------------------------------------

create or replace function internal.subject_site_capability(p_subject uuid, p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.site_admins sa
      join public.bundle_capabilities b on b.bundle_key = sa.profile_key and b.capability_key = p_key and b.scope_type = 'site'
      where sa.user_id = p_subject and sa.status = 'active')
    then (select jsonb_build_object('kind', 'SITE_PROFILE', 'bundle', sa.profile_key) from public.site_admins sa where sa.user_id = p_subject)
    when exists (
      select 1 from public.site_admins sa
      join public.site_capability_grants g on g.user_id = sa.user_id and g.capability_key = p_key and g.revoked_at is null
      join public.capabilities c on c.key = g.capability_key and c.site_addon_allowed
      where sa.user_id = p_subject and sa.status = 'active' and sa.profile_key not in ('SITE_RO', 'SITE_FULL'))
    then (select jsonb_build_object('kind', 'SITE_ADDON', 'grant_id', g.id, 'profile_key', sa.profile_key)
          from public.site_admins sa join public.site_capability_grants g on g.user_id = sa.user_id
          where sa.user_id = p_subject and g.capability_key = p_key and g.revoked_at is null limit 1)
  end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. rule 6: role bundles and relationships
-- ---------------------------------------------------------------------------------------------

create or replace function internal.bundle_source(p_subject uuid, p_key text, p_scope_type text, p_club uuid, p_team uuid,
                                                  p_player uuid, p_inherits boolean, p_assignment_state text default 'ACTIVE')
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
    limit 1;
    return v;

  elsif p_scope_type = 'child' then
    if p_assignment_state <> 'ACTIVE' then return null; end if;
    select jsonb_build_object('kind', 'GUARDIAN', 'bundle', 'PG', 'relationship_id', g.id, 'player_id', g.player_id) into v
    from public.guardians g
    join public.bundle_capabilities b on b.bundle_key = 'PG' and b.capability_key = p_key and b.scope_type = 'child'
    where g.guardian_user_id = p_subject and g.player_id = p_player and g.state = 'ACTIVE'
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

-- ---------------------------------------------------------------------------------------------
-- 6. the decision (K.1, K.2)
-- ---------------------------------------------------------------------------------------------

create or replace function internal.capability_decision(
  p_subject uuid,
  p_key text,
  p_scope_type text,
  p_club uuid default null,
  p_team uuid default null,
  p_player uuid default null,
  p_check_session boolean default true,
  p_trace boolean default false,
  out allowed boolean,
  out decisive_rule text,
  out reason_code text,
  out decisive_source jsonb,
  out trail jsonb
)
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
  else
    reason_code := 'DEFAULT_DENY';
  end if;
  if p_trace then trail := trail || jsonb_build_object('rule', '8', 'result', 'deny', 'reason', reason_code); end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 7. enforcement entry points
-- ---------------------------------------------------------------------------------------------

create or replace function internal.can(p_key text, p_scope_type text, p_club uuid default null, p_team uuid default null, p_player uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((internal.capability_decision(internal.effective_person(), p_key, p_scope_type, p_club, p_team, p_player, true, false)).allowed, false);
$$;

create or replace function internal.can_club(p_key text, p_club uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select internal.can(p_key, 'club', p_club, null, null);
$$;

create or replace function internal.can_team(p_key text, p_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select internal.can(p_key, 'team', null, p_team, null);
$$;

-- A player's own record is self scope; anyone else's is linked-child scope.
create or replace function internal.can_player(p_key text, p_player uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.players p where p.id = p_player and p.user_id = internal.effective_person())
      then internal.can(p_key, 'self', null, null, p_player)
    else internal.can(p_key, 'child', null, null, p_player)
  end;
$$;

-- L: resource resolvers. The client never supplies the scope of a resource.
create or replace function internal.fixture_scope(p_fixture_id uuid)
returns table (team_id uuid, club_id uuid, opposition_team_id uuid, opposition_club_id uuid)
language sql stable security definer set search_path = '' as $$
  select f.owning_team_id, ot.club_id, f.opponent_team_id, opp.club_id
  from public.fixtures f
  join public.teams ot on ot.id = f.owning_team_id
  left join public.teams opp on opp.id = f.opponent_team_id
  where f.id = p_fixture_id;
$$;

create or replace function internal.training_scope(p_session_id uuid)
returns table (team_id uuid, club_id uuid)
language sql stable security definer set search_path = '' as $$
  select s.team_id, s.club_id from public.training_sessions s where s.id = p_session_id;
$$;

-- A shared fixture is decided for the side the person belongs to.
create or replace function internal.can_fixture(p_key text, p_fixture_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(bool_or(
    internal.can(p_key, 'team', null, s.team_id, null)
    or (s.opposition_team_id is not null and internal.can(p_key, 'team', null, s.opposition_team_id, null))
  ), false)
  from internal.fixture_scope(p_fixture_id) s;
$$;

create or replace function internal.can_training(p_key text, p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(bool_or(case when s.team_id is not null then internal.can(p_key, 'team', null, s.team_id, null)
                               else internal.can(p_key, 'club', s.club_id, null, null) end), false)
  from internal.training_scope(p_session_id) s;
$$;

create or replace function internal.has_site_capability(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((internal.capability_decision(internal.effective_person(), p_key, 'site', null, null, null, true, false)).allowed, false);
$$;

create or replace function internal.require_capability(p_key text, p_scope_type text, p_club uuid default null, p_team uuid default null, p_player uuid default null)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not internal.can(p_key, p_scope_type, p_club, p_team, p_player) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;
end;
$$;

create or replace function internal.require_site_capability(p_key text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform internal.require_not_impersonating();
  if not internal.has_site_capability(p_key) then
    raise exception 'You are not authorised to do that.' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 8. legacy entry points, now over the resolver
-- ---------------------------------------------------------------------------------------------

-- Every legacy key resolves through capability_key_map to its canonical key. There is no Site Admin
-- club or team bypass: Site Admin authority is a site capability (rule 7) and never answers a club,
-- team, family or self question (K.3, P25).
create or replace function internal.has_capability(p_capability_key text, p_scope_type text, p_club_id uuid default null, p_team_id uuid default null)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_scope text;
  v_team_club uuid;
begin
  if p_scope_type = 'team' then
    if p_club_id is null or p_team_id is null then return false; end if;
    select t.club_id into v_team_club from public.teams t where t.id = p_team_id;
    if v_team_club is distinct from p_club_id then return false; end if;
  elsif p_scope_type = 'club' then
    if p_club_id is null then return false; end if;
  elsif p_scope_type is distinct from 'site' then
    return false;
  end if;

  select m.capability_key, m.evaluated_scope into v_key, v_scope
  from public.capability_key_map m
  where m.legacy_key = p_capability_key and m.legacy_scope = p_scope_type;
  if v_key is null then
    v_key := p_capability_key;
    v_scope := p_scope_type;
  end if;

  if v_scope = 'site' then
    return internal.has_site_capability(v_key);
  elsif v_scope = 'club' then
    return internal.can(v_key, 'club', p_club_id, null, null);
  end if;
  return internal.can(v_key, 'team', p_club_id, p_team_id, null);
end;
$$;

-- "What does the role give?" -- the role-bundle layer alone (rule 6), without overrides, for legacy callers
-- that ask that narrower question.
create or replace function internal.has_club_role_capability(p_club_id uuid, p_capability_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select internal.is_account_active(auth.uid()) and internal.is_club_active(p_club_id)
    and not exists (select 1 from public.club_memberships cm where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.state = 'SUSPENDED')
    and exists (
      select 1 from public.capability_key_map m right join (select 1) one on m.legacy_key = p_capability_key and m.legacy_scope = 'club'
      cross join lateral (select coalesce(m.capability_key, p_capability_key) as k) kk
      join public.capabilities c on c.key = kk.k and c.status = 'ACTIVE' and 'club' = any (c.valid_scopes)
      where internal.bundle_source(auth.uid(), c.key, 'club', p_club_id, null, null, c.inherits_to_team) is not null);
$$;

create or replace function internal.has_team_role_capability(p_team_id uuid, p_club_id uuid, p_capability_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select internal.is_account_active(auth.uid()) and internal.is_club_active(p_club_id)
    and exists (select 1 from public.teams t where t.id = p_team_id and t.club_id = p_club_id)
    and not exists (select 1 from public.club_memberships cm where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.state = 'SUSPENDED')
    and exists (
      select 1 from public.capability_key_map m right join (select 1) one on m.legacy_key = p_capability_key and m.legacy_scope = 'team'
      cross join lateral (select coalesce(m.capability_key, p_capability_key) as k, coalesce(m.evaluated_scope, 'team') as s) kk
      join public.capabilities c on c.key = kk.k and c.status = 'ACTIVE' and kk.s = any (c.valid_scopes)
      where internal.bundle_source(auth.uid(), c.key, kk.s, p_club_id, case when kk.s = 'team' then p_team_id end, null, c.inherits_to_team) is not null);
$$;

create or replace function internal.has_site_role_capability(p_capability_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select internal.has_capability(p_capability_key, 'site', null, null);
$$;

-- ---------------------------------------------------------------------------------------------
-- 9. what the interface may show, and why (AA.1, AC)
-- ---------------------------------------------------------------------------------------------

-- The caller's own answers at one scope: canonical keys, plus the legacy keys the app still names.
create or replace function public.my_capabilities(p_scope_type text, p_club_id uuid default null, p_team_id uuid default null, p_player_id uuid default null)
returns table (capability_key text, canonical_key text, allowed boolean, decisive_rule text, reason_code text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_club uuid := p_club_id;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if p_scope_type = 'team' and v_club is null then
    select t.club_id into v_club from public.teams t where t.id = p_team_id;
  end if;

  return query
  select c.key, c.key, d.allowed, d.decisive_rule, d.reason_code
  from public.capabilities c
  cross join lateral internal.capability_decision(internal.effective_person(), c.key, p_scope_type,
    case when p_scope_type = 'team' then v_club else p_club_id end, p_team_id, p_player_id, true, false) d
  where c.status = 'ACTIVE' and p_scope_type = any (c.valid_scopes);

  if p_scope_type in ('site', 'club', 'team') then
    return query
    select m.legacy_key, m.capability_key,
      internal.has_capability(m.legacy_key, p_scope_type, v_club, p_team_id), null::text, null::text
    from public.capability_key_map m
    where m.legacy_scope = p_scope_type and m.legacy_key <> m.capability_key;
  end if;
end;
$$;

create or replace function public.my_site_capabilities()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select c.key from public.capabilities c
  where c.status = 'ACTIVE' and 'site' = any (c.valid_scopes) and internal.has_site_capability(c.key)
  order by c.key;
$$;

-- Why a person can or cannot do something. Self: always, with administrative detail removed. Others:
-- a Site Admin with site.users.view, or a holder of people.access.explain where the person belongs.
create or replace function public.explain_access(p_subject uuid, p_capability_key text, p_scope_type text,
                                                 p_club_id uuid default null, p_team_id uuid default null, p_player_id uuid default null)
returns table (allowed boolean, decisive_rule text, reason_code text, decisive_source jsonb, trail jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := internal.effective_person();
  v_key text := p_capability_key;
  v_club uuid := p_club_id;
  v_admin_view boolean;
  d record;
begin
  if v_caller is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select m.capability_key into v_key from public.capability_key_map m
  where m.legacy_key = p_capability_key and m.legacy_scope = p_scope_type;
  v_key := coalesce(v_key, p_capability_key);
  if p_scope_type = 'team' and v_club is null then
    select t.club_id into v_club from public.teams t where t.id = p_team_id;
  end if;

  v_admin_view := internal.has_site_capability('site.users.view')
    or (p_scope_type = 'club' and internal.can('people.access.explain', 'club', p_club_id, null, null)
        and exists (select 1 from public.club_memberships cm where cm.club_id = p_club_id and cm.user_id = p_subject))
    or (p_scope_type = 'team' and internal.can('people.access.explain', 'team', v_club, p_team_id, null)
        and exists (select 1 from public.club_memberships cm where cm.club_id = v_club and cm.user_id = p_subject));

  if p_subject is distinct from v_caller and not v_admin_view then
    raise exception 'You are not authorised to see that.' using errcode = '42501';
  end if;

  select * into d from internal.capability_decision(p_subject, v_key, p_scope_type,
    case when p_scope_type = 'team' then v_club else p_club_id end, p_team_id, p_player_id, p_subject = v_caller, true);

  allowed := d.allowed;
  decisive_rule := d.decisive_rule;
  reason_code := d.reason_code;
  if v_admin_view then
    decisive_source := d.decisive_source;
    trail := d.trail;
  else
    decisive_source := d.decisive_source - 'granted_by' - 'reason' - 'override_id' - 'grant_id';
    trail := (select coalesce(jsonb_agg(case when s ? 'source' then s || jsonb_build_object('source', (s -> 'source') - 'granted_by' - 'reason' - 'override_id' - 'grant_id') else s end), '[]'::jsonb)
              from jsonb_array_elements(d.trail) s);
  end if;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 10. access
-- ---------------------------------------------------------------------------------------------

alter table public.site_capability_grants enable row level security;
alter table public.site_admin_grant_requests enable row level security;

-- SA-3: a mutation capability never gates a read, so these reads follow site.users.view rather than
-- site.admins.manage (Y.11 names the latter; SA-3 is the invariant).
create policy site_capability_grants_select on public.site_capability_grants for select to authenticated
  using (user_id = (select auth.uid()) or (select internal.has_site_capability('site.users.view')));
create policy site_admin_grant_requests_select on public.site_admin_grant_requests for select to authenticated
  using ((select internal.has_site_capability('site.users.view')));

revoke all on public.site_capability_grants, public.site_admin_grant_requests from anon, authenticated;
grant select on public.site_capability_grants, public.site_admin_grant_requests to authenticated;
grant all on public.site_capability_grants, public.site_admin_grant_requests to service_role;

create trigger audit_row_change after insert or update or delete on public.site_capability_grants
  for each row execute function internal.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.site_admin_grant_requests
  for each row execute function internal.audit_row_change();

-- Internal decision machinery is not callable from the browser; the enforcement helpers are, because
-- RLS policies evaluate them as the caller.
revoke all on function internal.capability_decision(uuid, text, text, uuid, uuid, uuid, boolean, boolean) from public, anon, authenticated;
revoke all on function internal.bundle_source(uuid, text, text, uuid, uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function internal.subject_site_capability(uuid, text) from public, anon, authenticated;
revoke all on function internal.site_admin_profile_sync() from public, anon, authenticated;
revoke all on function internal.guard_site_capability_grant() from public, anon, authenticated;
revoke all on function internal.site_grant_after_change() from public, anon, authenticated;
revoke all on function internal.site_admin_after_change() from public, anon, authenticated;
revoke all on function internal.site_flag_for_capability(text) from public, anon, authenticated;
revoke all on function internal.site_profile_for_admin_role(text) from public, anon, authenticated;
revoke all on function internal.admin_role_for_site_profile(text) from public, anon, authenticated;
revoke all on function internal.fixture_scope(uuid) from public, anon, authenticated;
revoke all on function internal.training_scope(uuid) from public, anon, authenticated;
revoke all on function internal.require_capability(text, text, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function internal.require_site_capability(text) from public, anon, authenticated;
revoke all on function internal.require_not_impersonating() from public, anon, authenticated;
revoke all on function internal.refuse_self_target(uuid) from public, anon, authenticated;
revoke all on function internal.session_aal_ok() from public, anon, authenticated;
revoke all on function internal.impersonation_mode() from public, anon, authenticated;
revoke all on function internal.actor() from public, anon, authenticated;

revoke all on function internal.session_live() from public, anon, authenticated;
revoke all on function internal.session_ok() from public, anon;
revoke all on function internal.effective_person() from public, anon;
revoke all on function internal.can(text, text, uuid, uuid, uuid) from public, anon;
revoke all on function internal.can_club(text, uuid) from public, anon;
revoke all on function internal.can_team(text, uuid) from public, anon;
revoke all on function internal.can_player(text, uuid) from public, anon;
revoke all on function internal.can_fixture(text, uuid) from public, anon;
revoke all on function internal.can_training(text, uuid) from public, anon;
revoke all on function internal.has_site_capability(text) from public, anon;
grant execute on function internal.session_ok(), internal.effective_person(), internal.can(text, text, uuid, uuid, uuid),
  internal.can_club(text, uuid), internal.can_team(text, uuid), internal.can_player(text, uuid), internal.can_fixture(text, uuid),
  internal.can_training(text, uuid), internal.has_site_capability(text) to authenticated;

revoke all on function internal.has_club_role_capability(uuid, text) from public, anon, authenticated;
revoke all on function internal.has_team_role_capability(uuid, uuid, text) from public, anon, authenticated;
revoke all on function internal.has_site_role_capability(text) from public, anon, authenticated;

revoke all on function public.my_capabilities(text, uuid, uuid, uuid) from public, anon;
revoke all on function public.my_site_capabilities() from public, anon;
revoke all on function public.explain_access(uuid, text, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.my_capabilities(text, uuid, uuid, uuid), public.my_site_capabilities(),
  public.explain_access(uuid, text, text, uuid, uuid, uuid) to authenticated, service_role;
