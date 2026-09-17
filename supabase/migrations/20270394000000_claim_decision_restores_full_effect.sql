-- =====================================================================================================
-- SLICE 5 (13/n) -- decide_club_claim carries the WHOLE of the canonical approval
--
-- The first cut of decide_club_claim reproduced only the parts of approve_club_claim that section P
-- happens to list, and silently dropped five behaviours the canonical approval has carried since
-- Slice 2:
--
--   * club_setup_state seeded for a genuinely new club;
--   * internal.lock_club_people, which serialises everything that touches a club's people;
--   * internal.admit_club_member, the canonical admission path (rather than a raw insert);
--   * internal.seed_teams_from_proposal, which creates the teams the claimant proposed;
--   * internal.reconcile_partner_invitations, which is how a referral learns which club it produced;
--   * and the claimant's notification.
--
-- supabase/tests/platform_activation.sql caught the referral one. Section P describes what is NEW
-- about the decision -- the authority split and the role choice -- not an exhaustive list of what
-- approval does, and reading it as exhaustive is what lost the rest.
--
-- This restores all of them. The only deliberate differences from the canonical approval remain the
-- two Phase 2 requires: the authority is site.claims.review (+ site.club_roles.manage to grant), and
-- the roles are the reviewer's choice rather than an unconditional CLUB_ADMIN.
-- =====================================================================================================
create or replace function public.decide_club_claim(
  p_claim_id uuid,
  p_decision text,
  p_reason text,
  p_roles text[] default null
) returns jsonb language plpgsql security definer set search_path = 'public' as $$
declare
  v_actor uuid := auth.uid();
  v_claim public.club_claims; v_club uuid; v_membership uuid; v_role text;
  v_roles text[]; v_superseded int := 0; v_slug text; v_name text; v_code text; v_new_club boolean := false;
begin
  if v_actor is null then raise exception 'You must be signed in.' using errcode = '42501'; end if;
  if p_decision not in ('APPROVED','REJECTED') then
    raise exception 'A claim is either approved or rejected.' using errcode = '22023';
  end if;
  if not internal.has_site_capability('site.claims.review') then
    raise exception 'You are not authorised to review club claims.' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required.' using errcode = '22023';
  end if;

  -- The directory row is the lock: two reviewers approving competing claims for the same club must
  -- serialise, or both could create a club and an administrator.
  perform 1 from public.club_directory
   where id = (select directory_id from public.club_claims where id = p_claim_id) for update;

  select * into v_claim from public.club_claims where id = p_claim_id for update;
  if v_claim.id is null then raise exception 'Claim not found.' using errcode = 'P0002'; end if;
  if v_claim.state in ('APPROVED','REJECTED','WITHDRAWN','SUPERSEDED') then
    raise exception 'That claim has already been decided (%).', v_claim.state using errcode = 'P0001';
  end if;

  if p_decision = 'REJECTED' then
    update public.club_claims set state = 'REJECTED', decision_reason = p_reason, review_notes = p_reason,
           reviewed_by = v_actor, reviewed_at = now(), decided_by = v_actor, decided_at = now(), updated_at = now()
     where id = p_claim_id;
    insert into public.security_events (event_type, actor_user_id, reason, metadata)
    values ('claim.rejected', v_actor, p_reason, jsonb_build_object('claim_id', p_claim_id));
    return jsonb_build_object('outcome','REJECTED','claim_id',p_claim_id);
  end if;

  -- The roles are the REVIEWER's choice; the claimed title only suggests a default (L9).
  v_roles := coalesce(p_roles, internal.claim_suggested_roles(v_claim.claimed_role));
  if cardinality(v_roles) > 0 and not internal.has_site_capability('site.club_roles.manage') then
    raise exception 'You may review a claim but not grant a role. A Full Site Admin must do that.'
      using errcode = '42501';
  end if;

  select c.id, cd.name, cd.rugby_code into v_club, v_name, v_code
    from public.clubs c join public.club_directory cd on cd.id = c.directory_id
   where c.directory_id = v_claim.directory_id;
  if v_club is null then
    v_new_club := true;
    select cd.name, cd.rugby_code into v_name, v_code
      from public.club_directory cd where cd.id = v_claim.directory_id;
    select coalesce(nullif(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), ''),
                    'club-' || left(v_claim.directory_id::text, 8)) into v_slug;
    insert into public.clubs (directory_id, slug, status, created_by, updated_by)
    values (v_claim.directory_id, v_slug || '-' || left(gen_random_uuid()::text, 4), 'active', v_actor, v_actor)
    returning id into v_club;
    -- A genuinely new club has not been set up yet. A re-claimed club keeps whatever state it had.
    insert into public.club_setup_state (club_id, status, current_step)
    values (v_club, 'NOT_STARTED', 1) on conflict (club_id) do nothing;
  end if;

  perform internal.lock_club_people(v_club);
  v_membership := internal.admit_club_member(v_club, v_claim.claimant_user_id, 'CLAIM_APPROVAL', p_reason, null, null);

  foreach v_role in array v_roles loop
    perform internal.grant_role(v_membership, v_role, null, 'CLAIM_APPROVAL', p_reason,
                                jsonb_build_object('claim_id', p_claim_id));
  end loop;

  perform internal.seed_teams_from_proposal(v_club, v_code, v_claim.proposed_teams);
  -- How a referral learns which club it produced. Dropping this silently broke referral attribution.
  perform internal.reconcile_partner_invitations(v_claim.directory_id, v_club, v_claim.created_at);
  perform internal.begin_club_platform_trial(v_club);

  update public.club_claims
     set state = 'APPROVED', decision_reason = p_reason, review_notes = p_reason,
         reviewed_by = v_actor, reviewed_at = now(), decided_by = v_actor, decided_at = now(),
         resulting_membership_id = v_membership, updated_at = now()
   where id = p_claim_id;

  update public.club_claims
     set state = 'SUPERSEDED', superseded_by_claim_id = p_claim_id, updated_at = now()
   where directory_id = v_claim.directory_id and id <> p_claim_id and state in ('SUBMITTED','NEEDS_INFORMATION');
  get diagnostics v_superseded = row_count;

  insert into public.notifications (user_id, type, title, body, data)
  values (v_claim.claimant_user_id, 'club_claim_approved', 'Club claim approved',
          format('Your access to %s has been approved.', v_name),
          jsonb_build_object('club_id', v_club, 'claim_id', p_claim_id));

  insert into public.security_events (event_type, actor_user_id, club_id, reason, metadata)
  values ('claim.approved', v_actor, v_club, p_reason,
          jsonb_build_object('claim_id', p_claim_id, 'roles', to_jsonb(v_roles),
                             'superseded', v_superseded, 'new_club', v_new_club));

  return jsonb_build_object('outcome','APPROVED','claim_id',p_claim_id,'club_id',v_club,
                            'membership_id',v_membership,'roles',to_jsonb(v_roles),'superseded',v_superseded);
end $$;

do $$
declare v text;
begin
  select prosrc into v from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='decide_club_claim';
  -- Every canonical effect the Slice 2 approval carried must still be here.
  if v !~ 'reconcile_partner_invitations' then raise exception 'Slice 5: referral reconciliation is missing.'; end if;
  if v !~ 'seed_teams_from_proposal' then raise exception 'Slice 5: proposed team seeding is missing.'; end if;
  if v !~ 'lock_club_people' then raise exception 'Slice 5: the club people lock is missing.'; end if;
  if v !~ 'admit_club_member' then raise exception 'Slice 5: the canonical admission path is missing.'; end if;
  if v !~ 'club_setup_state' then raise exception 'Slice 5: club setup state is missing.'; end if;
  if v !~ 'club_claim_approved' then raise exception 'Slice 5: the claimant notification is missing.'; end if;
  if v ~ '\minternal\.is_site_admin\(' then raise exception 'Slice 5: a blanket site-admin test came back.'; end if;
  raise notice 'Slice 5: decide_club_claim carries the whole canonical approval';
end $$;
