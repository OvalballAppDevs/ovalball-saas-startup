-- Commercial Platform, Phase K -- the canonical activation point.
--
-- A club's thirty usable days should begin when the club actually becomes a
-- club on Ovalball, not when somebody fills in a form. That moment is
-- `approve_club_claim`: the point at which a Site Admin confirms the person
-- really does run the club, the `clubs` row is active, and a Club Admin
-- membership exists.
--
-- Two things are attached there, both of which were previously the only
-- manual steps left in the commercial path:
--
--   1. the club's trial starts;
--   2. any referral that introduced this club is registered against it.
--
-- Neither can be done by the club itself, which is the point: an invitation
-- and a Site Admin decision are what create the relationship.

-- ---------------------------------------------------------------------
-- 1. A referral learns which club it produced
-- ---------------------------------------------------------------------

-- Re-declared from its original migration with one line added. This is
-- already the function that matches a pending club-to-club invitation to a
-- newly created club, so it is where the referral learns the club's id --
-- rather than a second matcher that would have to agree with this one.
create or replace function internal.reconcile_partner_invitations(p_directory_id uuid, p_new_club_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
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

    -- If this invitation was also claimed as a referral, it now knows which
    -- club it introduced. Returns false and records a reason when the club
    -- is not eligible (a self-referral, or a club that already paid
    -- Ovalball); either way it never raises, so a referral problem cannot
    -- fail a club's approval.
    perform public.register_referred_club(v_inv.id, p_new_club_id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Approving a claim starts the club's trial
-- ---------------------------------------------------------------------

create or replace function internal.begin_club_platform_trial(p_club_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Idempotent at the source: start_club_trial returns the existing trial
  -- if there is one, so a re-approval or a second activation path cannot
  -- restart a club's thirty days.
  perform public.start_club_trial(p_club_id);
exception when others then
  -- A trial problem must never fail a club's approval. The club exists,
  -- the Club Admin has access, and a missing trial is recoverable from Site
  -- Admin; a failed approval is not.
  raise warning 'Could not start the Ovalball trial for club %: %', p_club_id, sqlerrm;
end;
$$;

revoke execute on function internal.begin_club_platform_trial(uuid) from public, anon, authenticated;

-- Re-declared in full, because a function body cannot be amended in place.
-- Everything is carried over verbatim from
-- 20260831090000_role_vocabulary_and_claim_approval.sql; the single
-- `begin_club_platform_trial` call is the only change.
create or replace function public.approve_club_claim(p_claim_id uuid, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim record;
  v_club_id uuid;
  v_club_name text;
  v_rugby_code text;
begin
  if not internal.is_site_admin() then
    raise exception 'Only a site admin may approve a club claim.' using errcode = '42501';
  end if;

  select * into v_claim from public.club_claims where id = p_claim_id for update;
  if v_claim.id is null then
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

  -- The canonical activation point. The club is real, active, and has
  -- somebody who runs it; that is when its thirty usable days begin.
  perform internal.begin_club_platform_trial(v_club_id);

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

revoke execute on function public.approve_club_claim(uuid, text) from public;
