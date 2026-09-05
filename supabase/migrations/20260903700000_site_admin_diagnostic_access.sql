-- Site Admin diagnostic club access. A narrow, explicitly-granted, always-
-- audited capability letting a specific Site Admin temporarily VIEW one
-- club's dashboard/calendar as a read-only diagnostic aid (support/
-- debugging) -- never impersonation. The real Site Admin actor is always
-- the one recorded and audited; a diagnostic session never grants write
-- authority (every write-path RLS policy and RPC in this codebase is
-- completely unaffected by this migration -- a diagnostic session only
-- changes what the APP LAYER chooses to render for that admin, exactly
-- the way active-context.ts's switcher cookie is a UI preference that can
-- never widen real authorization).
--
-- Deliberately kept SEPARATE from the ordinary Context Switcher
-- (active-context.ts / ovalball_ctx cookie): that switches between
-- contexts the session genuinely holds membership/permission at. This is
-- a support-only capability into a club the Site Admin holds no
-- membership at all, so it needs its own explicit per-person grant and
-- its own audit trail rather than being folded into the switcher's list
-- of "my real contexts".

-- ============================================================
-- 1. The capability flag itself. Off by default for every admin,
--    including Full -- must be explicitly granted per person, never
--    inferred from admin_role.
-- ============================================================

alter table public.site_admins
  add column diagnostic_club_access boolean not null default false;

comment on column public.site_admins.diagnostic_club_access is
  'Whether this specific Site Admin has been granted the capability to enter diagnostic club-viewing sessions (see site_admin_diagnostic_sessions below). Granted/revoked only via set_site_admin_diagnostic_capability, never a direct table write from the app layer.';

-- ============================================================
-- 2. Grant/revoke -- Full Site Admin only, mirroring is_full_site_admin's
--    existing exclusive authority over other Site Admins' standing
--    (site_admin_invitations, admin_role changes). This never touches
--    admin_role or status, so internal.prevent_last_full_admin_lockout's
--    existing protection is completely unaffected -- diagnostic access is
--    orthogonal to who the last recoverable Full Admin is.
-- ============================================================

create or replace function public.set_site_admin_diagnostic_capability(p_user_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not internal.is_full_site_admin() then
    raise exception 'Only a Full Site Admin may grant or revoke diagnostic club access.' using errcode = '42501';
  end if;

  update public.site_admins
  set diagnostic_club_access = p_enabled
  where user_id = p_user_id and status = 'active';

  if not found then
    raise exception 'No active Site Admin found for that user.';
  end if;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    p_user_id,
    'site_admin_diagnostic_access_changed',
    case when p_enabled then 'Diagnostic club access granted' else 'Diagnostic club access revoked' end,
    case
      when p_enabled then 'You can now open a club in read-only diagnostic mode from Club Management.'
      else 'Your diagnostic club access has been revoked.'
    end,
    jsonb_build_object('enabled', p_enabled, 'changed_by', auth.uid())
  );
end;
$$;

revoke execute on function public.set_site_admin_diagnostic_capability(uuid, boolean) from public;
grant execute on function public.set_site_admin_diagnostic_capability(uuid, boolean) to authenticated;

-- ============================================================
-- 3. site_admin_diagnostic_sessions -- the actual audit trail: who
--    entered diagnostic view of which club, when, and when they left.
--    Deliberately a dedicated table rather than piggybacking on the
--    generic audit_log (that trigger records table-row INSERT/UPDATE/
--    DELETE; this records a session/viewing event, a different kind of
--    fact worth its own clear shape).
-- ============================================================

create table public.site_admin_diagnostic_sessions (
  id uuid primary key default gen_random_uuid(),
  site_admin_user_id uuid not null references auth.users(id),
  club_id uuid not null references public.clubs(id),
  entered_at timestamptz not null default now(),
  exited_at timestamptz
);

comment on table public.site_admin_diagnostic_sessions is
  'Append-only audit trail of Site Admin diagnostic club-viewing sessions. entered_at/exited_at bound exactly how long the banner was live; the app never trusts a client-supplied club_id without an open row here naming the real actor.';

create index site_admin_diagnostic_sessions_admin_idx on public.site_admin_diagnostic_sessions (site_admin_user_id, entered_at desc);
create index site_admin_diagnostic_sessions_open_idx on public.site_admin_diagnostic_sessions (site_admin_user_id) where exited_at is null;

alter table public.site_admin_diagnostic_sessions enable row level security;

-- A Full Site Admin may review the whole audit trail; any Site Admin may
-- see their own sessions (so their own "currently viewing as" state can
-- be resolved). No one else -- this is Site-Admin-only machinery, not
-- club-visible.
create policy site_admin_diagnostic_sessions_select on public.site_admin_diagnostic_sessions for select
  using (internal.is_full_site_admin() or site_admin_user_id = auth.uid());

-- ============================================================
-- 4. enter_diagnostic_club / exit_diagnostic_club -- the only path to a
--    session row. enter_diagnostic_club re-validates the capability and
--    the target club server-side on every call (never trusts a cached
--    client read), matching this session's established pattern for every
--    other "re-validate before creating" RPC this phase.
-- ============================================================

create or replace function public.enter_diagnostic_club(p_club_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_club_status text;
begin
  if not internal.is_site_admin() then
    raise exception 'Site Admin access is required.' using errcode = '42501';
  end if;

  if coalesce((select diagnostic_club_access from public.site_admins where user_id = auth.uid() and status = 'active'), false) is not true then
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

revoke execute on function public.enter_diagnostic_club(uuid) from public;
grant execute on function public.enter_diagnostic_club(uuid) to authenticated;

create or replace function public.exit_diagnostic_club(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.site_admin_diagnostic_sessions
  set exited_at = now()
  where id = p_session_id and site_admin_user_id = auth.uid() and exited_at is null;
end;
$$;

revoke execute on function public.exit_diagnostic_club(uuid) from public;
grant execute on function public.exit_diagnostic_club(uuid) to authenticated;

-- ============================================================
-- 5. resolve_diagnostic_session -- the read the app layer uses on every
--    page load to turn a session id (from a cookie -- a UI pointer only,
--    same trust model as ovalball_ctx) into real, currently-valid
--    session facts. Returns nothing for a closed, foreign, or unknown
--    session id -- the cookie can never itself grant a session that
--    doesn't genuinely belong to the caller and remain open.
-- ============================================================

create or replace function public.resolve_diagnostic_session(p_session_id uuid)
returns table(club_id uuid, club_name text, club_logo_storage_path text, entered_at timestamptz)
language sql
security definer
stable
set search_path = public
as $$
  select c.id, cd.name, c.logo_storage_path, s.entered_at
  from public.site_admin_diagnostic_sessions s
  join public.clubs c on c.id = s.club_id
  join public.club_directory cd on cd.id = c.directory_id
  where s.id = p_session_id
    and s.site_admin_user_id = auth.uid()
    and s.exited_at is null
    and c.status = 'active';
$$;

revoke execute on function public.resolve_diagnostic_session(uuid) from public;
grant execute on function public.resolve_diagnostic_session(uuid) to authenticated;
