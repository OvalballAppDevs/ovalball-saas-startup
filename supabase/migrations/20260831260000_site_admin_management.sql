-- Site Admin Management (Phase 2). Global Ovalball administrative access,
-- deliberately modeled as its OWN thing -- never "Club Admin with more
-- checkboxes", and never folded into permission_groups' club/team scope
-- (permission_groups.scope_type already has a 'global' value reserved,
-- but global admin profiles use their own small fixed enum here rather
-- than that machinery, matching how deliberately narrow this surface
-- needs to stay: six fixed, code-reviewed profiles, not an arbitrary
-- custom-composition system).

-- ============================================================
-- 1. admin_role -- WHICH Site Admin profile this row has. Existing rows
--    backfill to 'full' (today's only real semantics: every existing
--    Site Admin already has full access, so this is not a silent
--    downgrade for anyone).
-- ============================================================

alter table public.site_admins add column admin_role text not null default 'full'
  check (admin_role in ('full', 'fixture_ops', 'club_data', 'user_access', 'message_moderator', 'read_only'));

comment on column public.site_admins.admin_role is
  'Which Site Admin access profile this grant carries. is_site_admin() itself stays a simple boolean (used throughout existing RLS unchanged) -- admin_role is read by the NEWER, narrower helper functions below (internal.is_full_site_admin, internal.site_admin_can(profile)) that gate the admin-console-specific surfaces added this phase (Site Admin Management itself, and the write path of every existing admin action via requireSiteAdmin''s new allowedProfiles parameter). A restricted profile still passes the original is_site_admin() check everywhere that function is already used -- narrowing behavior is additive, not a silent tightening of every existing policy.';

create index site_admins_admin_role_idx on public.site_admins (admin_role) where status = 'active';

-- ============================================================
-- 2. Lockout prevention -- block any UPDATE/DELETE on site_admins that
--    would leave zero active 'full' admins. A trigger, not just an app
--    check, because this must hold even against a direct table write.
-- ============================================================

create function internal.prevent_last_full_admin_lockout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining_full int;
begin
  -- Only relevant when the row being changed/removed WAS an active full
  -- admin -- anything else can never be "the last one".
  if (TG_OP = 'DELETE' and (old.status <> 'active' or old.admin_role <> 'full'))
     or (TG_OP = 'UPDATE' and (old.status <> 'active' or old.admin_role <> 'full')) then
    if TG_OP = 'DELETE' then return old; else return new; end if;
  end if;

  if TG_OP = 'UPDATE' and new.status = 'active' and new.admin_role = 'full' then
    -- Still full and active after the change -- no risk.
    return new;
  end if;

  select count(*) into v_remaining_full
  from public.site_admins
  where status = 'active' and admin_role = 'full' and id <> old.id;

  if v_remaining_full = 0 then
    raise exception 'Cannot remove the last remaining Full Site Admin -- Ovalball would have no recoverable administrator. Promote another admin to Full first.';
  end if;

  if TG_OP = 'DELETE' then return old; else return new; end if;
end;
$$;

create trigger prevent_last_full_admin_lockout
  before update or delete on public.site_admins
  for each row execute function internal.prevent_last_full_admin_lockout();

comment on trigger prevent_last_full_admin_lockout on public.site_admins is
  'Blocks revoking, demoting, or deleting the last active admin_role=full site_admins row, even via a direct table write -- Ovalball must never be left with zero recoverable Full Site Admins.';

-- ============================================================
-- 3. Narrower helper functions for the admin-console-specific surfaces.
--    is_site_admin() (the original, simple boolean) is UNCHANGED and
--    still gates every existing policy exactly as before -- these are
--    additive, used only by the new Site Admin Management surface and
--    (at the application layer, via requireSiteAdmin's allowedProfiles
--    parameter) the write path of the admin console sections that now
--    have a natural profile owner.
-- ============================================================

create function internal.site_admin_role(p_user_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select admin_role from public.site_admins where user_id = p_user_id and status = 'active';
$$;

comment on function internal.site_admin_role(uuid) is
  'The active Site Admin profile for a user, or null if they are not an active Site Admin at all. Never inferred from club membership.';

grant execute on function internal.site_admin_role(uuid) to anon, authenticated;

create function internal.is_full_site_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select internal.is_account_active(auth.uid()) and coalesce(internal.site_admin_role(auth.uid()), '') = 'full';
$$;

comment on function internal.is_full_site_admin() is
  'True only for the Full Site Admin profile -- the only profile that may manage other Site Admins (invite/revoke/change role) or grant additional global powers to anyone, including themselves.';

grant execute on function internal.is_full_site_admin() to anon, authenticated;

-- ============================================================
-- 4. site_admin_invitations -- mirrors public.invitations' own shape and
--    reasoning exactly (a row here never grants anything by itself;
--    accept_site_admin_invitation() is the only path from a pending
--    invitation to a real site_admins row, and it requires the caller's
--    own authenticated session email to match invited_email). Kept as
--    its own table, not reusing invitations, because a site-admin grant
--    is conceptually unrelated to club membership (no club_id) and
--    deliberately high-friction/separately audited.
-- ============================================================

create table public.site_admin_invitations (
  id uuid primary key default gen_random_uuid(),
  invited_email text not null,
  admin_role text not null check (admin_role in ('full', 'fixture_ops', 'club_data', 'user_access', 'message_moderator', 'read_only')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  revoked_by uuid references auth.users(id),
  revoked_at timestamptz,
  invited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.site_admin_invitations is
  'Pending global Site Admin grants sent by email. Shorter default expiry than club invitations (7 days, not 14) reflecting the higher privilege. See accept_site_admin_invitation() -- the only path from here to a real site_admins row.';

create index site_admin_invitations_email_idx on public.site_admin_invitations (lower(invited_email));
create index site_admin_invitations_status_idx on public.site_admin_invitations (status);

alter table public.site_admin_invitations enable row level security;

-- Only a Full Site Admin may see, create, or revoke Site Admin
-- invitations -- inviting a Site Admin is itself a Full-Site-Admin-only
-- action per the brief ("Only appropriately privileged existing Site
-- Admins may issue them... a restricted Site Admin [cannot] grant
-- themselves additional global powers").
create policy site_admin_invitations_select_full_admin on public.site_admin_invitations for select
  using (internal.is_full_site_admin());
create policy site_admin_invitations_insert_full_admin on public.site_admin_invitations for insert
  with check (internal.is_full_site_admin() and invited_by = auth.uid());
create policy site_admin_invitations_update_full_admin on public.site_admin_invitations for update
  using (internal.is_full_site_admin());

create trigger set_updated_at before update on public.site_admin_invitations for each row execute function public.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.site_admin_invitations for each row execute function internal.audit_row_change();
-- public.site_admins already has an audit_row_change trigger from the
-- base migration set -- not recreated here.

-- ============================================================
-- 5. get_site_admin_invitation_preview / accept_site_admin_invitation --
--    same two-function shape as get_invitation_preview/accept_invitation,
--    with the same "requires an authenticated session whose email
--    matches" binding, so a leaked link alone is never enough.
-- ============================================================

create or replace function public.get_site_admin_invitation_preview(p_token text)
returns table(admin_role text, status text, expires_at timestamptz, invited_email text)
language sql
security definer
stable
set search_path = public
as $$
  select sai.admin_role, sai.status, sai.expires_at, sai.invited_email
  from public.site_admin_invitations sai
  where sai.token = p_token;
$$;

revoke execute on function public.get_site_admin_invitation_preview(text) from public;
grant execute on function public.get_site_admin_invitation_preview(text) to anon, authenticated;

create or replace function public.accept_site_admin_invitation(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.site_admin_invitations;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to accept this invitation.' using errcode = '42501';
  end if;

  select * into v_inv from public.site_admin_invitations where token = p_token for update;
  if not found then
    raise exception 'Invitation not found.';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'Invitation is not pending (current status: %).', v_inv.status;
  end if;
  if v_inv.expires_at < now() then
    update public.site_admin_invitations set status = 'expired' where id = v_inv.id;
    raise exception 'Invitation has expired.';
  end if;
  if lower(coalesce(auth.email(), '')) <> lower(v_inv.invited_email) then
    raise exception 'This invitation was sent to a different email address than the one you are signed in as.' using errcode = '42501';
  end if;

  insert into public.site_admins (user_id, admin_role, status, granted_by)
  values (auth.uid(), v_inv.admin_role, 'active', v_inv.invited_by)
  on conflict (user_id) do update set admin_role = excluded.admin_role, status = 'active';

  update public.site_admin_invitations
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_inv.id;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_inv.invited_by,
    'site_admin_invitation_accepted',
    'Site Admin invitation accepted',
    format('Your Site Admin invitation for %s was accepted.', v_inv.invited_email),
    jsonb_build_object('site_admin_invitation_id', v_inv.id)
  );
end;
$$;

revoke execute on function public.accept_site_admin_invitation(text) from public;
grant execute on function public.accept_site_admin_invitation(text) to authenticated;

-- ============================================================
-- 6. revoke_site_admin_invitation -- explicit RPC (not a plain UPDATE)
--    so a revoke is always intentional and always audited the same way,
--    matching the brief's "safe revocation before acceptance" requirement.
-- ============================================================

create or replace function public.revoke_site_admin_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not internal.is_full_site_admin() then
    raise exception 'Only a Full Site Admin may revoke a Site Admin invitation.' using errcode = '42501';
  end if;
  update public.site_admin_invitations
  set status = 'revoked', revoked_by = auth.uid(), revoked_at = now()
  where id = p_invitation_id and status = 'pending';
end;
$$;

revoke execute on function public.revoke_site_admin_invitation(uuid) from public;
grant execute on function public.revoke_site_admin_invitation(uuid) to authenticated;
