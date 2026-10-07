-- =====================================================================================================
-- ONE REFERRAL LINK PER CLUB (People & Invitations follow-up, 2026-10-05 -- the owner's decisions)
--
-- A club can now share one reusable link -- /r/<its slug> -- as well as referring a club by name. It is the
-- SAME referral process, not a second one: there is no new table, and the reward is still earned only by
-- `internal.qualify_referral_for_payment` on the referred club's first collected payment.
--
--   1. CAPTURED WITH THE CLAIM. Signing up or claiming through a link records the referring club on the claim
--      itself (`club_claims.referred_by_club_id`), in the claim's own insert, so attribution never depends on
--      a second call. A guard clears it unless the referring club is active, is not the club being claimed,
--      and the claimed club is not already on Ovalball (what `create_partner_invitation` refuses too) -- and
--      once written it cannot be changed, so nobody can redirect a reward afterwards. Directory clubs only:
--      a club still waiting to be added to the directory carries no link (the owner's decision).
--   2. AN INTRODUCTION LIKE ANY OTHER. When the claim is approved, the link becomes an ordinary introduction:
--      an invitation row (source 'link', no contact, no inviter, no token -- nothing secret) dated when they
--      signed up, and its referral (attribution 'link'). The existing reconciliation then registers it and
--      sends the partnership request, exactly as for a club referred by name -- marked as coming from the
--      link, because nobody asked (the owner chose to send it; it is never attributed to a person).
--   3. FIRST COMES FIRST. One club's own live introduction to the same club stands; between clubs, the earliest
--      introduction is first, whichever way it was made.
--   4. CREDIT PASSES ON. When the club pays, the earliest registered referral that CAN be credited earns the
--      month; one that cannot (the referrer is inactive or on no plan) is closed with its reason and the next
--      is considered. Before this, an ineligible first referrer meant nobody was credited -- which is not what
--      the published Referral Terms say ("the first qualifying referral earns the reward").
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- 1. AN INTRODUCTION MADE THROUGH A LINK
-- -----------------------------------------------------------------------------------------------------
alter table public.club_ovalball_invitations
  add column source text not null default 'invitation',
  add column claim_id uuid references public.club_claims(id);

alter table public.club_ovalball_invitations
  add constraint club_ovalball_invitations_source_check check (source in ('invitation', 'link'));

alter table public.club_ovalball_invitations alter column contact_name drop not null;
alter table public.club_ovalball_invitations alter column contact_email drop not null;
alter table public.club_ovalball_invitations alter column invited_by drop not null;

-- A club referred by name still names who sent it and to whom; only an introduction through a link has
-- nobody to name -- and it carries no token, because a link holds no secret.
alter table public.club_ovalball_invitations
  add constraint club_ovalball_invitations_named_unless_link check (
    source = 'link' or (contact_name is not null and contact_email is not null and invited_by is not null));
alter table public.club_ovalball_invitations
  add constraint club_ovalball_invitations_link_is_a_claim check (
    source <> 'link' or (claim_id is not null and token is null));

grant select (source) on public.club_ovalball_invitations to authenticated;

alter table public.platform_referrals drop constraint platform_referrals_attribution_source_check;
alter table public.platform_referrals
  add constraint platform_referrals_attribution_source_check
  check (attribution_source in ('invitation', 'reconciliation', 'manual', 'link'));

-- A partnership request a link produced: the referring club asked, through its link, and no person did.
alter table public.club_partnerships add column requested_via text;
alter table public.club_partnerships
  add constraint club_partnerships_requested_via_check check (requested_via in ('referral_link'));
alter table public.club_partnerships alter column requested_by drop not null;
-- coalesce, because a CHECK that evaluates to NULL passes: without it a request naming neither would slip through.
alter table public.club_partnerships
  add constraint club_partnerships_someone_asked check (requested_by is not null or coalesce(requested_via = 'referral_link', false));

-- -----------------------------------------------------------------------------------------------------
-- 2. THE CLAIM REMEMBERS WHICH CLUB'S LINK BROUGHT IT
-- -----------------------------------------------------------------------------------------------------
alter table public.club_claims add column referred_by_club_id uuid references public.clubs(id);

-- Definer rights: the guard must see every club, whichever path inserts the claim and whatever that caller
-- may read, or a check meant to refuse could quietly pass.
create or replace function internal.guard_claim_referral()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Written once, with the claim. A later update -- a reviewer's, or anybody's -- cannot redirect a reward.
  if tg_op = 'UPDATE' then
    new.referred_by_club_id := old.referred_by_club_id;
    return new;
  end if;

  if new.referred_by_club_id is not null and (
       -- the referring club must be a live club
       not exists (select 1 from public.clubs c where c.id = new.referred_by_club_id and c.status = 'active')
       -- a club cannot introduce itself
       or exists (select 1 from public.clubs c where c.id = new.referred_by_club_id and c.directory_id = new.directory_id)
       -- and a club already on Ovalball cannot be introduced to it
       or exists (select 1 from public.clubs c where c.directory_id = new.directory_id)) then
    new.referred_by_club_id := null;
  end if;
  return new;
end;
$$;
revoke all on function internal.guard_claim_referral() from public, anon, authenticated;

create trigger club_claims_referral_guard
  before insert or update on public.club_claims
  for each row execute function internal.guard_claim_referral();

-- A claim made in the Clubhouse through a link says which club's link it was. The slug is the club's public
-- address (/club/<slug>) and nothing more; an unknown or inactive one is simply no referral.
drop function public.submit_club_claim(uuid, text, text, jsonb);

create function public.submit_club_claim(
  p_directory_id uuid,
  p_claimed_role text,
  p_authority_declaration text,
  p_evidence jsonb default '{}'::jsonb,
  p_referral_slug text default null)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $function$
declare v_actor uuid := auth.uid(); v_id uuid; v_today int; v_has_admin boolean; v_referrer uuid; v_kept uuid;
begin
  if v_actor is null then raise exception 'You must be signed in.' using errcode = '42501'; end if;
  if not internal.session_ok() then raise exception 'Your session cannot be used for this.' using errcode = '42501'; end if;
  if not exists (select 1 from public.club_directory d where d.id = p_directory_id) then
    raise exception 'That club is not in the directory.' using errcode = 'P0002';
  end if;

  -- Section P: three claims per person per day.
  select count(*) into v_today from public.club_claims c
   where c.claimant_user_id = v_actor and c.created_at > now() - interval '1 day';
  if v_today >= 3 then
    raise exception 'You have submitted too many claims today. Try again tomorrow.' using errcode = 'P0001';
  end if;

  -- Does the club already have an active Club Admin? The reviewer needs to know, and the existing
  -- administrators are told a claim arrived -- without any of the claimant's details.
  select exists (
    select 1 from public.clubs cl
    join public.club_memberships m on m.club_id = cl.id and m.state = 'ACTIVE'
    join public.role_assignments ra on ra.membership_id = m.id and ra.role_key = 'CLUB_ADMIN' and ra.state = 'ACTIVE'
    where cl.directory_id = p_directory_id) into v_has_admin;

  select c.id into v_referrer from public.clubs c
   where c.slug = lower(btrim(nullif(p_referral_slug, ''))) and c.status = 'active';

  insert into public.club_claims (directory_id, claimant_user_id, claimed_role, authority_declaration,
                                  state, evidence, has_existing_admin, referred_by_club_id)
  values (p_directory_id, v_actor, p_claimed_role, p_authority_declaration, 'SUBMITTED',
          coalesce(p_evidence, '{}'::jsonb), v_has_admin, v_referrer)
  returning id, referred_by_club_id into v_id, v_kept;

  insert into public.security_events (event_type, actor_user_id, reason, metadata)
  values ('claim.submitted', v_actor, 'club claim submitted',
          jsonb_build_object('claim_id', v_id, 'directory_id', p_directory_id, 'has_existing_admin', v_has_admin,
                             'through_referral_link', v_kept is not null));
  return v_id;
end $function$;
revoke all on function public.submit_club_claim(uuid, text, text, jsonb, text) from public, anon;
grant execute on function public.submit_club_claim(uuid, text, text, jsonb, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------------------------------
-- 3. AT APPROVAL, A LINK BECOMES AN INTRODUCTION
--
-- The approved claim and any it is about to supersede may each carry a referring club. Each referring club is
-- counted once, from its earliest such claim, and only while that introduction was still live (14 days, as for
-- a club referred by name) when the approved claim was made -- so reconciliation registers every row this
-- creates and no referral is left pending against a club that exists. A club's own live introduction to the
-- same club stands instead.
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.record_link_introductions(p_directory_id uuid, p_approved_claim_id uuid)
returns integer
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_reference timestamptz;
  v_row record;
  v_invitation uuid;
  v_count integer := 0;
begin
  select created_at into v_reference from public.club_claims where id = p_approved_claim_id;
  if v_reference is null then
    return 0;
  end if;

  -- An introduction that had lapsed before the club acted is relabelled first, so it cannot stand in the
  -- way of a live one (only one live introduction per pair).
  perform internal.expire_due_club_ovalball_invitations();

  for v_row in
    select distinct on (c.referred_by_club_id) c.id as claim_id, c.referred_by_club_id as club_id, c.created_at
      from public.club_claims c
     where c.directory_id = p_directory_id
       and c.referred_by_club_id is not null
       and (c.id = p_approved_claim_id or c.state in ('SUBMITTED', 'NEEDS_INFORMATION'))
       and c.created_at + interval '14 days' > v_reference
     order by c.referred_by_club_id, c.created_at
  loop
    if exists (select 1 from public.club_ovalball_invitations i
                where i.inviting_club_id = v_row.club_id
                  and i.club_directory_id = p_directory_id
                  and i.status in ('pending', 'expired')
                  and i.expires_at > v_reference) then
      continue;
    end if;

    insert into public.club_ovalball_invitations (inviting_club_id, club_directory_id, contact_name, contact_email,
                                                  invited_by, token, status, expires_at, created_at, updated_at,
                                                  source, claim_id)
    values (v_row.club_id, p_directory_id, null, null, null, null, 'pending',
            v_row.created_at + interval '14 days', v_row.created_at, now(), 'link', v_row.claim_id)
    returning id into v_invitation;

    -- Its referral, dated when they signed up through the link: that is when this club introduced them.
    -- A fresh row made here, so nobody else can have created its referral first.
    insert into public.platform_referrals (invitation_id, referring_club_id, attribution_source, created_at)
    values (v_invitation, v_row.club_id, 'link', v_row.created_at);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;
revoke all on function internal.record_link_introductions(uuid, uuid) from public, anon, authenticated;

-- The live reconciliation, with one change: a partnership request a link produced says so.
create or replace function internal.reconcile_partner_invitations(p_directory_id uuid, p_new_club_id uuid, p_reference_at timestamp with time zone default now())
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_inv record;
  v_partnership_id uuid;
begin
  for v_inv in
    select * from public.club_ovalball_invitations
    where club_directory_id = p_directory_id
      -- 'expired' is included deliberately: the sweep above may have
      -- relabelled an invitation that was still live when the club acted.
      -- expires_at vs p_reference_at is what actually decides, not status.
      and status in ('pending', 'expired')
      and expires_at > p_reference_at
    for update
  loop
    begin
      insert into public.club_partnerships (requesting_club_id, partner_club_id, status, requested_by, responded_by, responded_at, requested_via)
      values (v_inv.inviting_club_id, p_new_club_id, 'pending', v_inv.invited_by, v_inv.invited_by, null,
              case when v_inv.source = 'link' then 'referral_link' end)
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

    -- Belt and braces for invitations that predate R-1's fix: make sure the
    -- claim exists before trying to register a club against it. For every
    -- invitation created after this migration this is already a no-op,
    -- because create_partner_invitation made the row in its own transaction.
    perform internal.ensure_club_referral(v_inv.id, 'reconciliation', null);

    -- Unchanged: records which club the referral produced, and rejects it
    -- with a reason when the club is not eligible. Never raises, so a
    -- referral problem still cannot fail a club's approval.
    perform public.register_referred_club(v_inv.id, p_new_club_id);
  end loop;
end;
$function$;

-- The live decision, with one line added: links become introductions before reconciliation reads them.
create or replace function public.decide_club_claim(p_claim_id uuid, p_decision text, p_reason text, p_roles text[] default null::text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  -- A club that signed up through another club's referral link is introduced by it, before reconciliation
  -- reads the introductions (One Referral Link per Club).
  perform internal.record_link_introductions(v_claim.directory_id, p_claim_id);
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
end $function$;

-- -----------------------------------------------------------------------------------------------------
-- 4. CREDIT PASSES ON TO THE NEXT CLUB THAT CAN RECEIVE IT
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.qualify_referral_for_payment(p_payment_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_payment record;
  v_ref record;
  v_plan record;
  v_credit uuid;
  v_earlier int;
begin
  select id, club_id, status, confirmed_at into v_payment
  from public.platform_payments
  where id = p_payment_id;

  if v_payment.id is null or v_payment.status <> 'confirmed' then
    return null;
  end if;

  -- "First successfully collected payment" -- counted against the ledger of
  -- confirmed payments, not inferred from the subscription's status.
  select count(*) into v_earlier
  from public.platform_payments
  where club_id = v_payment.club_id
    and status = 'confirmed'
    and id <> p_payment_id;

  if v_earlier > 0 then
    return null;
  end if;

  -- THE FIRST QUALIFYING REFERRAL EARNS THE REWARD, as the Referral Terms say: the earliest registered
  -- referral that can be credited is; one that cannot is closed with its reason and the next considered.
  for v_ref in
    select r.id, r.referring_club_id, r.referred_club_id
      from public.platform_referrals r
     where r.referred_club_id = v_payment.club_id
       and r.status = 'registered'
     order by r.created_at asc, r.id asc
     for update
  loop
    if v_ref.referring_club_id = v_ref.referred_club_id then
      update public.platform_referrals
      set status = 'rejected', rejection_reason = 'A club cannot refer itself.'
      where id = v_ref.id;
      continue;
    end if;

    if not exists (select 1 from public.clubs where id = v_ref.referring_club_id and status = 'active') then
      update public.platform_referrals
      set status = 'rejected', rejection_reason = 'The referring club is no longer active.'
      where id = v_ref.id;
      continue;
    end if;

    -- One month of the referring club's OWN current plan (section 41). Read
    -- once, snapshotted, never recomputed.
    select p.code, p.price_pence, p.price_version
    into v_plan
    from public.platform_plans p
    where p.code = internal.club_effective_plan(v_ref.referring_club_id);

    if v_plan.code is null then
      update public.platform_referrals
      set status = 'rejected', rejection_reason = 'The referring club is not on an Ovalball plan.'
      where id = v_ref.id;
      continue;
    end if;

    insert into public.platform_credits (
      club_id, amount_pence, source, reason,
      snapshot_plan_code, snapshot_price_pence, snapshot_price_version
    )
    values (
      v_ref.referring_club_id, v_plan.price_pence, 'referral_reward',
      'One month of your Ovalball plan, for referring a club that has now paid its first subscription.',
      v_plan.code, v_plan.price_pence, v_plan.price_version
    )
    returning id into v_credit;

    update public.platform_referrals
    set status = 'qualified',
        qualifying_payment_id = p_payment_id,
        reward_credit_id = v_credit,
        reward_amount_pence = v_plan.price_pence,
        reward_plan_code = v_plan.code,
        reward_price_version = v_plan.price_version,
        qualified_at = now()
    where id = v_ref.id;

    perform internal.notify_club_platform_billing(
      v_ref.referring_club_id,
      'platform_referral_reward_earned',
      'You have earned a month of Ovalball',
      'A club you referred has paid its first Ovalball subscription. One month of your plan has been credited to your account.',
      jsonb_build_object('club_id', v_ref.referring_club_id, 'amount_pence', v_plan.price_pence)
    );

    return v_credit;
  end loop;

  return null;
end;
$function$;
