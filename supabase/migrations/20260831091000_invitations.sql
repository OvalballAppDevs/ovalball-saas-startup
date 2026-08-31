-- Club/team role invitations. A row here never grants anything by itself
-- (requirement: "never grant access merely because an email address was
-- entered") -- accept_invitation() is the only path from a pending
-- invitation to a real club_memberships/team_permissions row, and it
-- requires the CALLER's own authenticated session email to match
-- invited_email, so an invitation can't be redeemed by anyone but its
-- intended recipient no matter who has the link.

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  invited_email text not null,
  -- Real-world title, informational only (e.g. "Team Manager") -- never
  -- read by any authorization check. See club_memberships.role's comment
  -- for the same separation applied to claims.
  declared_role text,
  -- Club-wide grant this invitation carries, if any. Nullable: a
  -- team-only invite (e.g. "Coach, U12 A") has no club-wide role at all.
  club_role text check (club_role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  -- Unqualified gen_random_bytes, matching every other table's unqualified
  -- gen_random_uuid() default in this schema -- extensions is already on
  -- this project's default search_path (pgcrypto, created in
  -- 20260830143452_extensions_and_helpers.sql).
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.invitations is
  'Pending club/team role grants sent by email. See accept_invitation() -- the only path from here to a real permission.';

create index invitations_club_id_idx on public.invitations (club_id);
create index invitations_invited_email_idx on public.invitations (lower(invited_email));
create index invitations_status_idx on public.invitations (status);

create table public.invitation_teams (
  invitation_id uuid not null references public.invitations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  team_permission text not null check (team_permission in ('team_admin', 'coach', 'manager', 'view_only')),
  primary key (invitation_id, team_id)
);

comment on table public.invitation_teams is
  'One row per team this invitation grants access to -- an invite can name several teams (e.g. Coach on both U12 A and U13 A) without duplicating the invitation.';

alter table public.invitations enable row level security;
alter table public.invitation_teams enable row level security;

-- Inviting is club administration, not fixture management -- gated the
-- same as club-profile/role authority (is_club_admin), deliberately not
-- extended to can_manage_club_fixtures (a Fixture Secretary manages
-- fixtures, not who has access to the club).
create policy invitations_select_club_scoped on public.invitations for select
  using (internal.is_site_admin() or internal.is_club_admin(club_id));
create policy invitations_insert_club_scoped on public.invitations for insert
  with check (internal.is_site_admin() or internal.is_club_admin(club_id));
create policy invitations_update_club_scoped on public.invitations for update
  using (internal.is_site_admin() or internal.is_club_admin(club_id));

create policy invitation_teams_select_scoped on public.invitation_teams for select
  using (exists (
    select 1 from public.invitations i
    where i.id = invitation_id and (internal.is_site_admin() or internal.is_club_admin(i.club_id))
  ));
create policy invitation_teams_insert_scoped on public.invitation_teams for insert
  with check (exists (
    select 1 from public.invitations i
    join public.teams t on t.id = team_id
    where i.id = invitation_id
      and t.club_id = i.club_id
      and (internal.is_site_admin() or internal.is_club_admin(i.club_id))
  ));
create policy invitation_teams_delete_scoped on public.invitation_teams for delete
  using (exists (
    select 1 from public.invitations i
    where i.id = invitation_id and (internal.is_site_admin() or internal.is_club_admin(i.club_id))
  ));

create trigger set_updated_at before update on public.invitations for each row execute function public.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.invitations for each row execute function internal.audit_row_change();

create index invitation_teams_created_by_idx on public.invitation_teams (team_id);

-- Narrow, purpose-built preview for the (possibly not-yet-authenticated)
-- recipient to see what they're accepting before signing in -- deliberately
-- NOT a SELECT policy on invitations itself, which would either expose
-- every invitation to no one (useless) or require exposing the whole row
-- to anon (leaks other invitees' emails/club ids). Returns only what the
-- accept screen needs.
create or replace function public.get_invitation_preview(p_token text)
returns table(club_name text, club_role text, declared_role text, status text, expires_at timestamptz, invited_email text)
language sql
security definer
stable
set search_path = public
as $$
  select cd.name, i.club_role, i.declared_role, i.status, i.expires_at, i.invited_email
  from public.invitations i
  join public.clubs c on c.id = i.club_id
  join public.club_directory cd on cd.id = c.directory_id
  where i.token = p_token;
$$;

revoke execute on function public.get_invitation_preview(text) from public;
grant execute on function public.get_invitation_preview(text) to anon, authenticated;

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invitations;
  v_membership_id uuid;
  v_role text;
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

  v_role := coalesce(v_inv.club_role, 'BASIC_USER');

  -- On conflict (an existing membership, e.g. from an earlier join
  -- request), never silently downgrade: keep whichever of the two roles
  -- ranks higher rather than overwriting an existing CLUB_ADMIN with a
  -- lesser team-only invite's implicit BASIC_USER.
  insert into public.club_memberships (club_id, user_id, role, status, created_by, updated_by)
  values (v_inv.club_id, auth.uid(), v_role, 'active', v_inv.created_by, auth.uid())
  on conflict (club_id, user_id) do update
    set status = 'active',
        role = case
          when public.club_memberships.role = 'CLUB_ADMIN' or excluded.role = 'CLUB_ADMIN' then 'CLUB_ADMIN'
          when public.club_memberships.role = 'FIXTURE_SECRETARY' or excluded.role = 'FIXTURE_SECRETARY' then 'FIXTURE_SECRETARY'
          else 'BASIC_USER'
        end,
        updated_by = auth.uid()
  returning id into v_membership_id;

  insert into public.team_permissions (membership_id, team_id, permission, created_by)
  select v_membership_id, it.team_id, it.team_permission, v_inv.created_by
  from public.invitation_teams it
  where it.invitation_id = v_inv.id
  on conflict (membership_id, team_id) do update set permission = excluded.permission;

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

revoke execute on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;
