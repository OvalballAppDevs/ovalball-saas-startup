-- Safeguarding Officer Foundation, part 2: RPCs.
--
-- Nominate/invite/edit/deactivate all require club.safeguarding.manage_contact
-- at the officer's own club (spec section 13's own recommendation: Club
-- Admin nominates/invites/manages contact; Site Admin -- via the existing
-- set_capability_override/revoke_capability_override RPCs, no new RPC
-- needed -- controls which of the four Site-Admin-grantable capabilities
-- an ACTIVE accepted officer actually holds).

-- ============================================================
-- 1. nominate_safeguarding_officer -- creates the CONTACT record. This
-- alone is NOT an invitation and grants nothing (spec section 5/8) --
-- status starts 'not_invited'. A club may nominate a contact it never
-- gets around to inviting; that is a valid, real, resting state.
-- ============================================================
create or replace function public.nominate_safeguarding_officer(
  p_club_id uuid, p_officer_type text, p_contact_name text, p_contact_email text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if not internal.has_capability('club.safeguarding.manage_contact', 'club', p_club_id) then
    raise exception 'Not authorized to manage this club''s Safeguarding Officer.' using errcode = '42501';
  end if;
  if p_officer_type not in ('primary', 'deputy') then
    raise exception 'Invalid officer type.';
  end if;
  if coalesce(trim(p_contact_name), '') = '' or coalesce(trim(p_contact_email), '') = '' then
    raise exception 'A name and email are required to nominate a Safeguarding Officer.';
  end if;

  insert into public.club_safeguarding_officers (club_id, officer_type, contact_name, contact_email, created_by, updated_by)
  values (p_club_id, p_officer_type, trim(p_contact_name), lower(trim(p_contact_email)), auth.uid(), auth.uid())
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'This club already has an active % Safeguarding Officer assignment. Deactivate it first before nominating a replacement.', p_officer_type using errcode = '23505';
end;
$$;

revoke all on function public.nominate_safeguarding_officer(uuid, text, text, text) from public, anon;
grant execute on function public.nominate_safeguarding_officer(uuid, text, text, text) to authenticated;

-- ============================================================
-- 2. update_safeguarding_officer_contact -- protects contact changes
-- (spec section 25): editing the contact name/email of an ALREADY-
-- ACCEPTED officer never reassigns the role to someone else or touches
-- their accepted user_id/status -- it only ever updates the free-text
-- contact fields kept for display/reference. The authorization
-- relationship stays bound to user_id, which this function never writes.
-- ============================================================
create or replace function public.update_safeguarding_officer_contact(
  p_officer_id uuid, p_contact_name text, p_contact_email text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.club_safeguarding_officers where id = p_officer_id;
  if not found then
    raise exception 'Safeguarding Officer assignment not found.';
  end if;
  if not internal.has_capability('club.safeguarding.manage_contact', 'club', v_club_id) then
    raise exception 'Not authorized to manage this club''s Safeguarding Officer.' using errcode = '42501';
  end if;
  if coalesce(trim(p_contact_name), '') = '' or coalesce(trim(p_contact_email), '') = '' then
    raise exception 'A name and email are required.';
  end if;

  update public.club_safeguarding_officers
  set contact_name = trim(p_contact_name), contact_email = lower(trim(p_contact_email)), updated_by = auth.uid(), updated_at = now()
  where id = p_officer_id;
end;
$$;

revoke all on function public.update_safeguarding_officer_contact(uuid, text, text) from public, anon;
grant execute on function public.update_safeguarding_officer_contact(uuid, text, text) to authenticated;

-- ============================================================
-- 3. invite_safeguarding_officer -- creates the invitation row only.
-- Idempotent/safe resend (spec section 7): the partial unique index from
-- the previous migration means a second call while one is already
-- pending fails loudly rather than silently creating a duplicate --
-- resend_safeguarding_officer_invitation (below) is the correct path for
-- "send it again".
-- ============================================================
create or replace function public.invite_safeguarding_officer(p_officer_id uuid)
returns table (invitation_id uuid, token text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_officer public.club_safeguarding_officers;
  v_id uuid;
  v_token text;
begin
  select * into v_officer from public.club_safeguarding_officers where id = p_officer_id for update;
  if not found then
    raise exception 'Safeguarding Officer assignment not found.';
  end if;
  if not internal.has_capability('club.safeguarding.manage_contact', 'club', v_officer.club_id) then
    raise exception 'Not authorized to manage this club''s Safeguarding Officer.' using errcode = '42501';
  end if;
  if v_officer.status = 'active' then
    raise exception 'This Safeguarding Officer has already accepted -- nothing to invite.';
  end if;
  if exists (select 1 from public.club_safeguarding_officer_invitations where officer_id = p_officer_id and status = 'pending') then
    raise exception 'An invitation is already pending for this Safeguarding Officer. Resend it instead of creating a new one.' using errcode = '23505';
  end if;

  insert into public.club_safeguarding_officer_invitations (officer_id, club_id, invited_email, invited_by)
  values (p_officer_id, v_officer.club_id, v_officer.contact_email, auth.uid())
  returning id, club_safeguarding_officer_invitations.token into v_id, v_token;

  update public.club_safeguarding_officers set status = 'invite_sent', updated_by = auth.uid(), updated_at = now() where id = p_officer_id;

  return query select v_id, v_token;
end;
$$;

revoke all on function public.invite_safeguarding_officer(uuid) from public, anon;
grant execute on function public.invite_safeguarding_officer(uuid) to authenticated;

-- ============================================================
-- 4. resend_safeguarding_officer_invitation -- revoke-then-recreate
-- (spec section 7 "safe on resend"), matching this codebase's own
-- established resend idiom exactly (there is no separate "resend" concept
-- anywhere else in Main either -- every existing invitation type resends
-- by revoking and re-inviting, confirmed by audit). A brand-new token is
-- issued; the old one stops working immediately.
-- ============================================================
create or replace function public.resend_safeguarding_officer_invitation(p_officer_id uuid)
returns table (invitation_id uuid, token text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.club_safeguarding_officers where id = p_officer_id;
  if not found then
    raise exception 'Safeguarding Officer assignment not found.';
  end if;
  if not internal.has_capability('club.safeguarding.manage_contact', 'club', v_club_id) then
    raise exception 'Not authorized to manage this club''s Safeguarding Officer.' using errcode = '42501';
  end if;

  update public.club_safeguarding_officer_invitations
  set status = 'revoked', revoked_by = auth.uid(), revoked_at = now()
  where officer_id = p_officer_id and status = 'pending';

  return query select * from public.invite_safeguarding_officer(p_officer_id);
end;
$$;

revoke all on function public.resend_safeguarding_officer_invitation(uuid) from public, anon;
grant execute on function public.resend_safeguarding_officer_invitation(uuid) to authenticated;

-- ============================================================
-- 5. revoke_safeguarding_officer_invitation -- explicit RPC, matching
-- revoke_site_admin_invitation's own convention (never a bare UPDATE).
-- ============================================================
create or replace function public.revoke_safeguarding_officer_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_club_id uuid;
  v_officer_id uuid;
begin
  select club_id, officer_id into v_club_id, v_officer_id from public.club_safeguarding_officer_invitations where id = p_invitation_id;
  if not found then
    raise exception 'Invitation not found.';
  end if;
  if not internal.has_capability('club.safeguarding.manage_contact', 'club', v_club_id) then
    raise exception 'Not authorized to manage this club''s Safeguarding Officer.' using errcode = '42501';
  end if;

  update public.club_safeguarding_officer_invitations
  set status = 'revoked', revoked_by = auth.uid(), revoked_at = now()
  where id = p_invitation_id and status = 'pending';

  if found then
    update public.club_safeguarding_officers set status = 'not_invited', updated_by = auth.uid(), updated_at = now()
    where id = v_officer_id and status = 'invite_sent';
  end if;
end;
$$;

revoke all on function public.revoke_safeguarding_officer_invitation(uuid) from public, anon;
grant execute on function public.revoke_safeguarding_officer_invitation(uuid) to authenticated;

-- ============================================================
-- 6. get_safeguarding_officer_invitation_preview / accept_* -- the same
-- two-function shape as every other invitation type (public preview,
-- authenticated accept requiring email match). Acceptance is where
-- authorization actually begins (spec section 8): before this call,
-- nothing the officer can do differs from an anonymous visitor.
--
-- Also ensures a real club_memberships row exists (role='BASIC_USER' if
-- none exists yet -- an existing CLUB_ADMIN/FIXTURE_SECRETARY membership
-- is left completely untouched, per spec section 3 "the same person may
-- legitimately hold multiple Club roles"). This is required, not
-- cosmetic: public.set_capability_override() -- the existing, reused
-- Site-Admin-grant mechanism this feature relies on for the four
-- dispensation/transfer capabilities -- refuses to grant a club-scoped
-- capability to anyone without an active club_memberships row at that
-- club ("a capability override narrows or extends real authority, it
-- does not invent a relationship"). Being the club's authorized
-- Safeguarding Officer as a BASIC_USER-tier member and then
-- INDIVIDUALLY layering the specific safeguarding capabilities on top
-- via that same existing mechanism is precisely "narrows/extends real
-- authority" -- not inventing one from nothing.
-- ============================================================
create or replace function public.get_safeguarding_officer_invitation_preview(p_token text)
returns table (club_id uuid, club_name text, officer_type text, status text, expires_at timestamptz, invited_email text)
language sql
security definer
stable
set search_path to 'public'
as $$
  select i.club_id, cd.name, o.officer_type, i.status, i.expires_at, i.invited_email
  from public.club_safeguarding_officer_invitations i
  join public.club_safeguarding_officers o on o.id = i.officer_id
  join public.clubs c on c.id = i.club_id
  join public.club_directory cd on cd.id = c.directory_id
  where i.token = p_token;
$$;

revoke execute on function public.get_safeguarding_officer_invitation_preview(text) from public;
grant execute on function public.get_safeguarding_officer_invitation_preview(text) to anon, authenticated;

create or replace function public.accept_safeguarding_officer_invitation(p_token text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inv public.club_safeguarding_officer_invitations;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to accept this invitation.' using errcode = '42501';
  end if;

  select * into v_inv from public.club_safeguarding_officer_invitations where token = p_token for update;
  if not found then
    raise exception 'Invitation not found.';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'Invitation is not pending (current status: %).', v_inv.status;
  end if;
  if v_inv.expires_at < now() then
    update public.club_safeguarding_officer_invitations set status = 'expired' where id = v_inv.id;
    raise exception 'Invitation has expired.';
  end if;
  if lower(coalesce(auth.email(), '')) <> lower(v_inv.invited_email) then
    raise exception 'This invitation was sent to a different email address than the one you are signed in as.' using errcode = '42501';
  end if;

  update public.club_safeguarding_officers
  set user_id = auth.uid(), status = 'active', activated_at = now(), updated_by = auth.uid(), updated_at = now()
  where id = v_inv.officer_id;

  insert into public.club_memberships (club_id, user_id, role, status, created_by, updated_by)
  values (v_inv.club_id, auth.uid(), 'BASIC_USER', 'active', auth.uid(), auth.uid())
  on conflict (club_id, user_id) do nothing;

  update public.club_safeguarding_officer_invitations
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = v_inv.id;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_inv.invited_by,
    'safeguarding_officer_invitation_accepted',
    'Safeguarding Officer invitation accepted',
    format('Your Safeguarding Officer invitation for %s was accepted.', v_inv.invited_email),
    jsonb_build_object('officer_id', v_inv.officer_id, 'invitation_id', v_inv.id)
  );
end;
$$;

revoke execute on function public.accept_safeguarding_officer_invitation(text) from public;
grant execute on function public.accept_safeguarding_officer_invitation(text) to authenticated;

-- ============================================================
-- 7. deactivate_safeguarding_officer -- preserves audit/history (spec
-- section 26): the row is never deleted, only marked inactive, freeing
-- the officer_type slot (per the partial unique index) for a future
-- replacement nomination. Deliberately does NOT auto-promote a deputy to
-- primary or otherwise silently fill the gap -- the club is simply left
-- correctly showing "no active primary Safeguarding Officer" until a
-- human nominates one (spec section 26's own explicit instruction).
-- Revokes any capability_overrides this officer held at this club (a
-- deactivated officer keeps no lingering safeguarding capabilities), but
-- never touches their ordinary club_memberships row -- they remain
-- whatever else they legitimately are at this club (e.g. still a parent/
-- coach), matching "the same person may legitimately hold multiple Club
-- roles" precisely: losing the Safeguarding Officer duty does not evict
-- them from the club.
-- ============================================================
create or replace function public.deactivate_safeguarding_officer(p_officer_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_officer public.club_safeguarding_officers;
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
      and capability_key in ('club.dispensation.view', 'club.dispensation.notify', 'club.transfer.safeguarding_view', 'club.transfer.safeguarding_notify')
      and status = 'active';
  end if;
end;
$$;

revoke all on function public.deactivate_safeguarding_officer(uuid) from public, anon;
grant execute on function public.deactivate_safeguarding_officer(uuid) to authenticated;

-- ============================================================
-- 8. get_club_safeguarding_officers -- the one read RPC the Club Admin/
-- Site Admin UI actually needs, joining in profile display info for an
-- accepted officer (name/email come from the contact record either way,
-- but last_active_at is useful Site-Admin-side context) and the current
-- pending invitation, if any.
-- ============================================================
create or replace function public.get_club_safeguarding_officers(p_club_id uuid)
returns table (
  id uuid, officer_type text, contact_name text, contact_email text, status text,
  user_id uuid, activated_at timestamptz,
  pending_invitation_id uuid, pending_invitation_expires_at timestamptz
)
language sql
security definer
stable
set search_path to 'public'
as $$
  select
    o.id, o.officer_type, o.contact_name, o.contact_email, o.status, o.user_id, o.activated_at,
    i.id, i.expires_at
  from public.club_safeguarding_officers o
  left join public.club_safeguarding_officer_invitations i on i.officer_id = o.id and i.status = 'pending'
  where o.club_id = p_club_id and o.status <> 'inactive'
    and (internal.is_site_admin() or internal.has_capability('club.safeguarding.view', 'club', p_club_id) or o.user_id = auth.uid())
  order by o.officer_type;
$$;

revoke all on function public.get_club_safeguarding_officers(uuid) from public, anon;
grant execute on function public.get_club_safeguarding_officers(uuid) to authenticated;
