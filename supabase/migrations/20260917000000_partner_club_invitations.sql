-- Invite a not-yet-claimed canonical Club Directory club to Ovalball.
--
-- club_partnerships (20260831093000) cannot represent this case: both its
-- FKs point to public.clubs, which requires an *activated* club to exist.
-- Inviting an unclaimed club has no clubs.id yet -- only a club_directory
-- row -- so this is a genuinely separate, smaller mechanism: an
-- invitation record that gets reconciled into a real club_partnerships
-- row once (and only if) the invited club is later claimed. Structurally
-- mirrors site_admin_invitations (token/expiry/status shape), never
-- copied verbatim since the semantics differ (a directory club + inviting
-- club, not a role grant).

create table public.club_ovalball_invitations (
  id uuid primary key default gen_random_uuid(),
  inviting_club_id uuid not null references public.clubs(id),
  club_directory_id uuid not null references public.club_directory(id),
  contact_name text not null,
  contact_email text not null,
  invited_by uuid not null references auth.users(id),
  token text not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id),
  resulting_partnership_id uuid references public.club_partnerships(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.club_ovalball_invitations is
  'A club not yet on Ovalball, invited by an existing club to join. Reconciled into a real club_partnerships row by approve_club_claim once (and only if) the invited club_directory_id is actually claimed -- never before, never auto-claims, never fabricates a clubs/user row. Distinct from club_partnerships (which requires both sides already activated) and from site_admin_invitations (a different privilege-grant concept), structurally similar to neither by accident.';

-- One pending invitation per (inviting club, target directory club) pair
-- at a time -- matches the idempotency the user asked for without
-- blocking a legitimate re-invite after the first one expires/is revoked.
create unique index club_ovalball_invitations_unique_pending_idx on public.club_ovalball_invitations
  (inviting_club_id, club_directory_id) where status = 'pending';

create index club_ovalball_invitations_directory_id_idx on public.club_ovalball_invitations (club_directory_id);
create index club_ovalball_invitations_inviting_club_id_idx on public.club_ovalball_invitations (inviting_club_id);

alter table public.club_ovalball_invitations enable row level security;

-- Only the inviting club's own fixture-authority users (same boundary
-- club_partnerships already uses) can see or create their own club's
-- invitations. The invited party has no account yet to grant read access
-- to -- they interact purely via the emailed token link, never a table read.
create policy club_ovalball_invitations_select_scoped on public.club_ovalball_invitations for select
  using (internal.is_site_admin() or internal.can_manage_club_fixtures(inviting_club_id));

create policy club_ovalball_invitations_insert_scoped on public.club_ovalball_invitations for insert
  with check (internal.can_manage_club_fixtures(inviting_club_id) and invited_by = auth.uid());

-- ============================================================
-- create_partner_invitation: validates the target directory club is
-- genuinely NOT yet claimed (no clubs row), and that the inviting club
-- itself is real -- refuses rather than silently no-opping either way.
-- ============================================================
create or replace function public.create_partner_invitation(
  p_inviting_club_id uuid, p_club_directory_id uuid, p_contact_name text, p_contact_email text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already_claimed boolean;
  v_id uuid;
begin
  if not internal.can_manage_club_fixtures(p_inviting_club_id) then
    raise exception 'Not authorised to send invitations for this club.' using errcode = '42501';
  end if;
  if p_contact_name is null or trim(p_contact_name) = '' then
    raise exception 'A contact name is required.';
  end if;
  if p_contact_email is null or trim(p_contact_email) = '' then
    raise exception 'A contact email is required.';
  end if;

  select exists(select 1 from public.clubs where directory_id = p_club_directory_id) into v_already_claimed;
  if v_already_claimed then
    raise exception 'This club is already on Ovalball -- use Request Partnership instead.' using errcode = 'P0001';
  end if;

  insert into public.club_ovalball_invitations (inviting_club_id, club_directory_id, contact_name, contact_email, invited_by)
  values (p_inviting_club_id, p_club_directory_id, trim(p_contact_name), lower(trim(p_contact_email)), auth.uid())
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'You already have a pending invitation out to this club.' using errcode = 'P0001';
end;
$$;

revoke execute on function public.create_partner_invitation(uuid, uuid, text, text) from public;
grant execute on function public.create_partner_invitation(uuid, uuid, text, text) to authenticated;

-- ============================================================
-- internal.reconcile_partner_invitations: called from approve_club_claim
-- once the newly-claimed club's real clubs.id is known. Marks every
-- still-pending invitation for that directory club as accepted, and
-- creates (or reuses, if one already exists from a normal Request
-- Partnership in the meantime) the resulting club_partnerships row.
-- Idempotent by construction: club_partnerships' own unique partial index
-- (requesting/partner pair, status <> revoked) is the real duplicate
-- guard, caught here rather than pre-checked imperfectly.
-- ============================================================
create or replace function internal.reconcile_partner_invitations(p_directory_id uuid, p_new_club_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv record;
  v_partnership_id uuid;
begin
  for v_inv in
    select * from public.club_ovalball_invitations
    where club_directory_id = p_directory_id and status = 'pending' and expires_at > now()
    for update
  loop
    begin
      insert into public.club_partnerships (requesting_club_id, partner_club_id, status, requested_by, responded_by, responded_at)
      values (v_inv.inviting_club_id, p_new_club_id, 'pending', v_inv.invited_by, v_inv.invited_by, null)
      returning id into v_partnership_id;
    exception
      when unique_violation then
        select id into v_partnership_id from public.club_partnerships
        where least(requesting_club_id, partner_club_id) = least(v_inv.inviting_club_id, p_new_club_id)
          and greatest(requesting_club_id, partner_club_id) = greatest(v_inv.inviting_club_id, p_new_club_id)
          and status <> 'revoked'
        limit 1;
    end;

    update public.club_ovalball_invitations
    set status = 'accepted', accepted_at = now(), accepted_by = auth.uid(), resulting_partnership_id = v_partnership_id, updated_at = now()
    where id = v_inv.id;
  end loop;
end;
$$;

comment on function internal.reconcile_partner_invitations is
  'Deliberately leaves the resulting partnership in status=pending (a real Request Partnership, not auto-active) so the newly-joined club still explicitly accepts it themselves via the normal respond_to_club_partnership flow -- the invitation got them to Ovalball, it does not silently bind them into a calendar-sharing agreement without their own consent.';

-- ============================================================
-- approve_club_claim, redefined to also reconcile any pending partner
-- invitations for the newly-claimed directory club. Every prior
-- behaviour (team seeding, membership grant, notification) is preserved
-- verbatim from the 20260904100000 definition -- only the reconciliation
-- call is new, added right after v_club_id is known (whether freshly
-- created or already existing), before the claim itself is marked verified.
-- ============================================================
create or replace function public.approve_club_claim(p_claim_id uuid, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.club_claims;
  v_club_id uuid;
  v_club_name text;
  v_rugby_code text;
begin
  if not internal.is_site_admin() then
    raise exception 'Only a Site Admin may approve a club claim.' using errcode = '42501';
  end if;

  select * into v_claim from public.club_claims where id = p_claim_id for update;
  if not found then
    raise exception 'Claim not found.';
  end if;
  if v_claim.status <> 'pending' then
    raise exception 'Claim is not pending (current status: %).', v_claim.status;
  end if;

  select c.id, cd.name, cd.rugby_code into v_club_id, v_club_name, v_rugby_code from public.clubs c
    join public.club_directory cd on cd.id = c.directory_id
    where c.directory_id = v_claim.directory_id;

  if v_club_id is null then
    select cd.name, cd.rugby_code into v_club_name, v_rugby_code from public.club_directory cd where cd.id = v_claim.directory_id;
    insert into public.clubs (directory_id, slug, status, created_by, updated_by)
    values (v_claim.directory_id, internal.generate_club_slug(v_club_name), 'active', auth.uid(), auth.uid())
    returning id into v_club_id;
  end if;

  insert into public.club_memberships (club_id, user_id, role, status, created_by, updated_by)
  values (v_club_id, v_claim.claimant_user_id, 'CLUB_ADMIN', 'active', auth.uid(), auth.uid())
  on conflict (club_id, user_id) do update set role = 'CLUB_ADMIN', status = 'active', updated_by = auth.uid();

  perform internal.seed_teams_from_proposal(v_club_id, v_rugby_code, v_claim.proposed_teams);

  perform internal.reconcile_partner_invitations(v_claim.directory_id, v_club_id);

  update public.club_claims
  set status = 'verified', decided_by = auth.uid(), decided_at = now(), review_notes = p_notes
  where id = p_claim_id;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_claim.claimant_user_id,
    'club_claim_approved',
    'Club claim approved',
    format('Your access to %s has been approved.', v_club_name),
    jsonb_build_object('club_id', v_club_id, 'claim_id', p_claim_id)
  );

  return v_club_id;
end;
$$;
