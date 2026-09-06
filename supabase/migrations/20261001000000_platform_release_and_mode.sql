-- Commercial Platform, Phase C -- release history and platform mode.
--
-- Two ideas, deliberately separate:
--
--   * A RELEASE is a record that a version of Ovalball was shipped, with
--     notes people can read. It is editable: notes get corrected.
--   * The PLATFORM MODE (Beta or Live) is the switch that decides whether
--     Ovalball charges clubs at all. Its history is append-only, because
--     "when did Beta end" is a question that decides money.
--
-- Naming follows the Phase A decision: everything to do with Ovalball
-- charging clubs is prefixed `platform_`, keeping it a clear namespace
-- apart from `club_subscription_*` / `gocardless_*`, which are a club
-- charging its own members. See docs/COMMERCIAL_PLATFORM_ARCHITECTURE.md.

-- ---------------------------------------------------------------------
-- 1. Capabilities and their per-person delegation flags
-- ---------------------------------------------------------------------

-- Two flags, not three. Recording a release and flipping Beta are the
-- same operational act performed by the same person on the same day, so
-- one delegation flag covers both. Seeing commercial data is a genuinely
-- different concern -- it is money, and it is readable without being
-- able to change anything -- so it gets its own.
alter table public.site_admins add column if not exists manage_system boolean not null default false;
alter table public.site_admins add column if not exists view_commercial boolean not null default false;

insert into public.capabilities (key, label, description, category, applicable_scopes)
values
  ('site.system.release.manage', 'Manage releases', 'Record a release of Ovalball and publish its release notes.', 'site', array['site']),
  ('site.system.beta.manage', 'Manage platform mode', 'Switch Ovalball between Beta and Live. Beta suspends Ovalball charging clubs and pauses trial time.', 'site', array['site']),
  ('site.commercial.view', 'View commercial data', 'Read Ovalball subscription, trial and referral data across all clubs.', 'site', array['site'])
on conflict (key) do nothing;

-- Re-declared in full because plpgsql/sql function bodies cannot be
-- amended in place. Every existing branch is carried over verbatim; the
-- three new branches are the only change.
create or replace function internal.has_site_role_capability(p_capability_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when internal.is_full_site_admin() then true
    when p_capability_key = 'site.permissions.manage' then coalesce((select manage_permissions from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.lookups.manage' then coalesce((select manage_global_lookups from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.team_catalogue.manage' then coalesce((select manage_team_catalogue from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.competitions.manage' then coalesce((select manage_competitions from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.fixture_support.manage' then coalesce((select manage_fixture_support from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.diagnostic.access' then coalesce((select diagnostic_club_access from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.seasons.manage' then coalesce((select manage_seasons from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.system.release.manage' then coalesce((select manage_system from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.system.beta.manage' then coalesce((select manage_system from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.commercial.view' then coalesce((select view_commercial from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    else internal.is_site_admin()
  end;
$$;

-- Grant/revoke RPCs, mirroring set_site_admin_seasons_capability exactly.
create or replace function public.set_site_admin_system_capability(p_user_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not internal.is_full_site_admin() then
    raise exception 'Only a Full Site Admin may grant or revoke platform system access.' using errcode = '42501';
  end if;

  update public.site_admins
  set manage_system = p_enabled
  where user_id = p_user_id and status = 'active';

  if not found then
    raise exception 'No active Site Admin found for that user.';
  end if;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    p_user_id,
    'site_admin_system_access_changed',
    case when p_enabled then 'Platform system access granted' else 'Platform system access revoked' end,
    case
      when p_enabled then 'You can now record releases and switch Ovalball between Beta and Live.'
      else 'Your platform system access has been revoked.'
    end,
    jsonb_build_object('enabled', p_enabled, 'changed_by', auth.uid())
  );
end;
$$;

create or replace function public.set_site_admin_commercial_capability(p_user_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not internal.is_full_site_admin() then
    raise exception 'Only a Full Site Admin may grant or revoke commercial data access.' using errcode = '42501';
  end if;

  update public.site_admins
  set view_commercial = p_enabled
  where user_id = p_user_id and status = 'active';

  if not found then
    raise exception 'No active Site Admin found for that user.';
  end if;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    p_user_id,
    'site_admin_commercial_access_changed',
    case when p_enabled then 'Commercial data access granted' else 'Commercial data access revoked' end,
    case
      when p_enabled then 'You can now view Ovalball subscription, trial and referral data across clubs.'
      else 'Your commercial data access has been revoked.'
    end,
    jsonb_build_object('enabled', p_enabled, 'changed_by', auth.uid())
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 2. platform_releases
-- ---------------------------------------------------------------------

create table if not exists public.platform_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  -- The immutable build identity (lib/version.ts APP_BUILD_SHA). Nullable
  -- because a release may be recorded from a machine that does not know
  -- the deployed SHA; a recorded one is never edited afterwards.
  build_sha text,
  channel text not null default 'production',
  title text,
  notes text,
  status text not null default 'draft',
  released_at timestamptz not null default now(),
  released_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_releases_channel_check check (channel in ('production', 'preview')),
  constraint platform_releases_status_check check (status in ('draft', 'published')),
  constraint platform_releases_version_not_blank check (length(btrim(version)) > 0),
  constraint platform_releases_channel_version_key unique (channel, version)
);

create index if not exists platform_releases_released_at_idx
  on public.platform_releases (released_at desc);

alter table public.platform_releases enable row level security;

-- Published release notes are written for users, so everyone may read
-- them. Drafts are visible only to Site Admins, which is the whole point
-- of a draft.
drop policy if exists platform_releases_select on public.platform_releases;
create policy platform_releases_select on public.platform_releases
  for select
  to anon, authenticated
  using (status = 'published' or internal.is_site_admin());

drop policy if exists platform_releases_insert on public.platform_releases;
create policy platform_releases_insert on public.platform_releases
  for insert
  with check (internal.has_capability('site.system.release.manage', 'site'));

drop policy if exists platform_releases_update on public.platform_releases;
create policy platform_releases_update on public.platform_releases
  for update
  using (internal.has_capability('site.system.release.manage', 'site'));

-- No DELETE policy, deliberately: release history is not tidied away.

drop trigger if exists set_updated_at on public.platform_releases;
create trigger set_updated_at
  before update on public.platform_releases
  for each row execute function set_updated_at();

drop trigger if exists audit_row_change on public.platform_releases;
create trigger audit_row_change
  after insert or update or delete on public.platform_releases
  for each row execute function internal.audit_row_change();

-- ---------------------------------------------------------------------
-- 3. platform_mode_events -- append-only
-- ---------------------------------------------------------------------

create table if not exists public.platform_mode_events (
  id uuid primary key default gen_random_uuid(),
  -- `changed_at` defaults to now(), which is transaction time and therefore
  -- identical for two events written in the same transaction. `seq` is what
  -- actually orders the history, so "the current mode" is never decided by
  -- a tie-break on a random uuid.
  seq bigint generated always as identity,
  previous_mode text,
  new_mode text not null,
  release_id uuid references public.platform_releases(id),
  reason text,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now(),
  constraint platform_mode_events_new_mode_check check (new_mode in ('beta', 'live')),
  constraint platform_mode_events_previous_mode_check check (previous_mode is null or previous_mode in ('beta', 'live')),
  constraint platform_mode_events_actually_changed check (previous_mode is distinct from new_mode)
);

create unique index if not exists platform_mode_events_seq_idx
  on public.platform_mode_events (seq desc);

-- Exactly one row may open the history.
create unique index if not exists platform_mode_events_genesis_idx
  on public.platform_mode_events ((true)) where previous_mode is null;

alter table public.platform_mode_events enable row level security;

-- `reason` is written for internal record-keeping, so the table itself is
-- Site Admin only. Everyone else reads the mode through
-- public.current_platform_mode(), which exposes the mode and nothing else.
drop policy if exists platform_mode_events_select on public.platform_mode_events;
create policy platform_mode_events_select on public.platform_mode_events
  for select
  using (internal.is_site_admin());

drop policy if exists platform_mode_events_insert on public.platform_mode_events;
create policy platform_mode_events_insert on public.platform_mode_events
  for insert
  with check (internal.has_capability('site.system.beta.manage', 'site'));

-- No UPDATE or DELETE policy. The trigger below is the real guard,
-- because a SECURITY DEFINER function would bypass RLS entirely.

create or replace function internal.platform_mode_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Platform mode history is append-only. Record a new transition instead of altering an old one.'
    using errcode = '42501';
end;
$$;

drop trigger if exists platform_mode_events_append_only on public.platform_mode_events;
create trigger platform_mode_events_append_only
  before update or delete on public.platform_mode_events
  for each row execute function internal.platform_mode_events_append_only();

-- The current mode, straight from the history. Null only before the
-- genesis row exists, which this migration seeds.
create or replace function internal.current_platform_mode()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select new_mode
  from public.platform_mode_events
  order by seq desc
  limit 1;
$$;

-- The chain cannot be forged: previous_mode is always derived here, never
-- taken from the caller, so a direct client INSERT cannot claim a
-- transition that did not happen.
create or replace function internal.platform_mode_events_set_previous()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
begin
  select new_mode into v_current
  from public.platform_mode_events
  order by seq desc
  limit 1;

  new.previous_mode := v_current;

  if v_current is not distinct from new.new_mode then
    raise exception 'Ovalball is already in % mode.', new.new_mode using errcode = '23514';
  end if;

  if new.changed_by is null then
    new.changed_by := auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists platform_mode_events_set_previous on public.platform_mode_events;
create trigger platform_mode_events_set_previous
  before insert on public.platform_mode_events
  for each row execute function internal.platform_mode_events_set_previous();

drop trigger if exists audit_row_change on public.platform_mode_events;
create trigger audit_row_change
  after insert or update or delete on public.platform_mode_events
  for each row execute function internal.audit_row_change();

-- ---------------------------------------------------------------------
-- 4. Public surface
-- ---------------------------------------------------------------------

-- What the application asks. Returns the mode and when it started, and
-- nothing else -- no reason text, no actor.
create or replace function public.current_platform_mode()
returns table (mode text, since timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(e.new_mode, 'beta'), e.changed_at
  from (
    select new_mode, changed_at
    from public.platform_mode_events
    order by seq desc
    limit 1
  ) e;
$$;

-- Recording a release. Returns the release id.
create or replace function public.record_platform_release(
  p_version text,
  p_build_sha text default null,
  p_title text default null,
  p_notes text default null,
  p_channel text default 'production',
  p_publish boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not internal.has_capability('site.system.release.manage', 'site') then
    raise exception 'Not authorized to manage releases.' using errcode = '42501';
  end if;

  if p_version is null or length(btrim(p_version)) = 0 then
    raise exception 'A release needs a version.';
  end if;

  insert into public.platform_releases (version, build_sha, title, notes, channel, status, released_by)
  values (
    btrim(p_version),
    nullif(btrim(coalesce(p_build_sha, '')), ''),
    nullif(btrim(coalesce(p_title, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_channel,
    case when p_publish then 'published' else 'draft' end,
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Switching Beta on or off. Idempotent: asking for the mode Ovalball is
-- already in returns null and records nothing, so a retried request
-- cannot create a phantom transition.
--
-- Phase D attaches trial pause/resume here. Nothing in the club-charges-
-- its-members domain reads platform mode, and nothing here may ever touch
-- it.
create or replace function public.set_platform_mode(
  p_mode text,
  p_reason text default null,
  p_release_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
  v_id uuid;
begin
  if not internal.has_capability('site.system.beta.manage', 'site') then
    raise exception 'Not authorized to change the platform mode.' using errcode = '42501';
  end if;

  if p_mode not in ('beta', 'live') then
    raise exception 'Unknown platform mode: %.', p_mode;
  end if;

  v_current := internal.current_platform_mode();
  if v_current is not distinct from p_mode then
    return null;
  end if;

  insert into public.platform_mode_events (new_mode, release_id, reason, changed_by)
  values (p_mode, p_release_id, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Genesis
-- ---------------------------------------------------------------------

-- Ovalball is in Beta today: invite-only, no billing enabled, no SaaS
-- collection configured. Recording that as the opening event means the
-- history answers "was the platform charging on date X" from the first
-- day the model exists, rather than starting with an unexplained gap.
-- changed_by is null because no person made this transition -- it is the
-- state the model found.
insert into public.platform_mode_events (new_mode, reason, changed_by)
select 'beta', 'Initial platform mode recorded when the release and mode model was introduced. Ovalball was already operating in Beta: invite-only, with no Ovalball billing enabled.', null
where not exists (select 1 from public.platform_mode_events);
