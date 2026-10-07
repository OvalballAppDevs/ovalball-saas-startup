-- =====================================================================================================
-- ONE DOOR FOR CLAIMS, REQUESTS AND REFERRALS (2026-10-05)
--
-- The owner's brief for the invite/referral hardening: fix and permanently test signup-created claims
-- bypassing the three-a-day limit, an invitation created after a claim being attributed to that claim, an
-- invitation with no referral record, and any other path that can leave attribution, membership or guardian
-- state inconsistent -- one canonical implementation per step, web and app alike. What this closes:
--
--   1. A CLAIM HAS ONE DOOR. Web signup wrote club_claims itself (lib/signup/complete-signup.ts), so its claims
--      skipped submit_club_claim's three-a-day limit, its session check, the has-existing-admin flag and the
--      claim.submitted event, and resolved the referral link on its own. Any signed-in person could do the same
--      through the API -- choosing created_at (escaping the daily count, and moving a link referral earlier in
--      the queue for the reward) and state. submit_club_claim now takes the teams signup proposes; signup calls
--      it; the table no longer accepts a person's own insert.
--
--   2. A REFERRAL COUNTS ONLY IF IT CAME FIRST. At approval a club's named invitations were matched by directory
--      and expiry alone, so one sent AFTER the club had already asked to join was registered and could earn the
--      month's reward; likewise a competing claim through another club's link made after the approved claim.
--      Both now have to predate the approved claim. A late named invitation's referral is closed with its
--      reason, so no referral is left pending against a club that exists (referral_data_health stays HEALTHY).
--
--   3. EVERY CLUB INVITATION IS A REFERRAL. create_partner_invitation records both in one transaction, but
--      nothing stopped another write making the invitation alone -- a fixture did, which is the local invitation
--      aa9d7850 with no referral. A deferred constraint now refuses an invitation that ends its transaction
--      without its referral. CLUB_REFERRAL as a people-invitation kind, which recorded no referral and did
--      nothing when redeemed, can no longer be issued: a club is referred from the Clubhouse or by its link.
--
--   4. A PARTNERSHIP REQUEST IS A REQUEST. Clubs wrote club_partnerships directly -- the website from its own
--      action, the app from the shared contract -- so a Club Admin could write an ACTIVE partnership with any
--      club and name somebody else as having accepted it. request_club_partnership is now the one door.
--
--   5. A JOIN REQUEST IS A REQUEST. Signup wrote club_join_requests directly, so the row could say approved,
--      name a decider, or cite an invitation it never came from. request_club_membership is the one door.
--
--   6. A NEW-CLUB REQUEST is still written by the person at signup, but what its reviewers own -- the status,
--      the review, the directory entry it produced and any bulk-import provenance -- is set by the server.
--
-- Existing rows are not rewritten: an invitation made before create_partner_invitation recorded referrals is
-- still repaired by reconciliation when its club arrives (ensure_club_referral 'reconciliation'), and an
-- accepted one without a referral is what referral_data_health already counts as missing attribution.
-- =====================================================================================================


-- -----------------------------------------------------------------------------------------------------
-- 1. A CLAIM HAS ONE DOOR
-- -----------------------------------------------------------------------------------------------------
drop function public.submit_club_claim(uuid, text, text, jsonb, text);

create function public.submit_club_claim(
  p_directory_id uuid,
  p_claimed_role text,
  p_authority_declaration text,
  p_evidence jsonb default '{}'::jsonb,
  p_referral_slug text default null,
  p_proposed_teams jsonb default null)
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
  -- The teams a new club proposes (signup asks for them); a list or nothing.
  if p_proposed_teams is not null and jsonb_typeof(p_proposed_teams) <> 'array' then
    raise exception 'The proposed teams must be a list.' using errcode = '22023';
  end if;

  -- Section P: three claims per person per day -- however the claim is made.
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
                                  state, evidence, has_existing_admin, referred_by_club_id, proposed_teams)
  values (p_directory_id, v_actor, p_claimed_role, p_authority_declaration, 'SUBMITTED',
          coalesce(p_evidence, '{}'::jsonb), v_has_admin, v_referrer, coalesce(p_proposed_teams, '[]'::jsonb))
  returning id, referred_by_club_id into v_id, v_kept;

  insert into public.security_events (event_type, actor_user_id, reason, metadata)
  values ('claim.submitted', v_actor, 'club claim submitted',
          jsonb_build_object('claim_id', v_id, 'directory_id', p_directory_id, 'has_existing_admin', v_has_admin,
                             'through_referral_link', v_kept is not null));
  return v_id;
end $function$;
revoke all on function public.submit_club_claim(uuid, text, text, jsonb, text, jsonb) from public, anon;
grant execute on function public.submit_club_claim(uuid, text, text, jsonb, text, jsonb) to authenticated, service_role;

-- The table takes no claim a person writes for themselves: submit_club_claim (SECURITY DEFINER) is the door.
drop policy if exists club_claims_insert_self on public.club_claims;
revoke insert on public.club_claims from authenticated, anon;


-- -----------------------------------------------------------------------------------------------------
-- 2. A REFERRAL COUNTS ONLY IF IT CAME FIRST
--
-- The reference moment is when the approved claim was made: the club had asked to join then. A competing
-- claim's link counts only if it was made by then too; so does a club's own named invitation that would stand
-- instead of its link.
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
       -- ...and made by the time the club itself asked: a link used afterwards introduced nobody.
       and c.created_at <= v_reference
     order by c.referred_by_club_id, c.created_at
  loop
    if exists (select 1 from public.club_ovalball_invitations i
                where i.inviting_club_id = v_row.club_id
                  and i.club_directory_id = p_directory_id
                  and i.status in ('pending', 'expired')
                  and i.expires_at > v_reference
                  and i.created_at <= v_reference) then
      continue;
    end if;

    -- The same club's named invitation sent AFTER the club asked is not an introduction (reconciliation closes
    -- its referral with the reason); its link, used first, is. A pair has one pending invitation at most, so
    -- the late one lapses here.
    update public.club_ovalball_invitations i
       set status = 'expired', updated_at = now()
     where i.inviting_club_id = v_row.club_id
       and i.club_directory_id = p_directory_id
       and i.status = 'pending'
       and i.created_at > v_reference;

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
      -- An introduction made before the club itself asked. One sent afterwards is not an introduction:
      -- it is closed below, never counted.
      and created_at <= p_reference_at
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

  -- A NAMED INVITATION SENT AFTER THE CLUB HAD ALREADY ASKED is not an introduction. Its referral is closed with
  -- the reason, so no referral is left pending against a club that exists; the invitation lapses as any
  -- unanswered one does.
  update public.platform_referrals r
     set status = 'rejected',
         rejection_reason = 'That club had already asked to join Ovalball before this invitation was sent.',
         updated_at = now()
    from public.club_ovalball_invitations i
   where r.invitation_id = i.id
     and i.club_directory_id = p_directory_id
     and i.created_at > p_reference_at
     and r.status = 'pending';
end;
$function$;


-- -----------------------------------------------------------------------------------------------------
-- 3. EVERY CLUB INVITATION IS A REFERRAL
-- -----------------------------------------------------------------------------------------------------
-- Checked when the transaction ends, so the canonical writers (create_partner_invitation and the link's
-- introduction) can make the invitation and then its referral; nothing can end with the invitation alone.
create or replace function internal.club_invitation_has_its_referral()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if exists (select 1 from public.club_ovalball_invitations i where i.id = new.id)
     and not exists (select 1 from public.platform_referrals r where r.invitation_id = new.id) then
    raise exception 'A club invitation is always recorded as a referral in the same transaction: create_partner_invitation does both.'
      using errcode = '23514';
  end if;
  return null;
end;
$function$;
revoke all on function internal.club_invitation_has_its_referral() from public, anon, authenticated;

create constraint trigger club_ovalball_invitation_has_its_referral
  after insert on public.club_ovalball_invitations
  deferrable initially deferred
  for each row execute function internal.club_invitation_has_its_referral();

-- A club referral is its own domain record (club_ovalball_invitations + platform_referrals), not a people
-- invitation: the CLUB_REFERRAL kind recorded no referral and its redemption did nothing.
create or replace function internal.club_referral_is_not_a_people_invitation()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  raise exception 'A club referral is not a people invitation. Refer a club from the Clubhouse, or share your club''s referral link.'
    using errcode = '22023';
end;
$function$;
revoke all on function internal.club_referral_is_not_a_people_invitation() from public, anon, authenticated;

create trigger access_invitations_no_club_referral
  before insert on public.access_invitations
  for each row when (new.kind = 'CLUB_REFERRAL')
  execute function internal.club_referral_is_not_a_people_invitation();


-- -----------------------------------------------------------------------------------------------------
-- 4. A PARTNERSHIP REQUEST IS A REQUEST
-- -----------------------------------------------------------------------------------------------------
create function public.request_club_partnership(p_requesting_club_id uuid, p_partner_club_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  -- Who may ask on a club's behalf is who the old insert policy allowed: the club's partnership managers,
  -- or Ovalball acting on a club's profile.
  if not (internal.has_site_capability('site.clubs.profile.manage')
          or p_requesting_club_id = any(internal.club_ids_with('club.partners.manage'))) then
    raise exception 'Only the club''s administrators can ask another club to partner with it.' using errcode = '42501';
  end if;
  if p_partner_club_id is null or p_partner_club_id = p_requesting_club_id then
    raise exception 'Choose another club to partner with.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clubs c where c.id = p_partner_club_id and c.status = 'active') then
    raise exception 'That club is not on Ovalball.' using errcode = 'P0002';
  end if;

  -- Always a request, always from the person asking: only the other club can make it active.
  begin
    insert into public.club_partnerships (requesting_club_id, partner_club_id, status, requested_by)
    values (p_requesting_club_id, p_partner_club_id, 'pending', v_actor)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'You already have a pending or active relationship with this club.' using errcode = '23505';
  end;
  return v_id;
end;
$function$;
revoke all on function public.request_club_partnership(uuid, uuid) from public, anon;
grant execute on function public.request_club_partnership(uuid, uuid) to authenticated, service_role;

drop policy if exists club_partnerships_insert_scoped on public.club_partnerships;
revoke insert on public.club_partnerships from authenticated, anon;


-- -----------------------------------------------------------------------------------------------------
-- 5. A JOIN REQUEST IS A REQUEST
--
-- The row a team code's "Just Me, as a Member" writes, written for signup: pending, from the person asking,
-- citing no invitation. The table's own trigger opens the PENDING membership, exactly as for a code.
-- -----------------------------------------------------------------------------------------------------
create function public.request_club_membership(p_club_id uuid, p_requested_role text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_role text := nullif(btrim(coalesce(p_requested_role, '')), '');
  v_state text;
  v_id uuid;
begin
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if v_role is null or length(v_role) > 120 then
    raise exception 'Say what you do at the club (up to 120 characters).' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clubs c where c.id = p_club_id and c.status = 'active') then
    raise exception 'That club is not on Ovalball.' using errcode = 'P0002';
  end if;

  select m.state into v_state from public.club_memberships m
   where m.club_id = p_club_id and m.user_id = v_actor and m.state in ('ACTIVE', 'SUSPENDED')
   limit 1;
  if v_state = 'ACTIVE' then
    raise exception 'You are already a member of this club.' using errcode = '23505';
  elsif v_state = 'SUSPENDED' then
    raise exception 'Your membership of this club is deactivated. The club must reactivate it.' using errcode = '23505';
  end if;

  -- Asked already: the same request, never a second one.
  select r.id into v_id from public.club_join_requests r
   where r.club_id = p_club_id and r.requesting_user_id = v_actor and r.status = 'pending'
   order by r.created_at
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.club_join_requests (club_id, requesting_user_id, requested_role, status)
  values (p_club_id, v_actor, v_role, 'pending')
  returning id into v_id;
  return v_id;
end;
$function$;
revoke all on function public.request_club_membership(uuid, text) from public, anon;
grant execute on function public.request_club_membership(uuid, text) to authenticated, service_role;

drop policy if exists club_join_requests_insert_self on public.club_join_requests;
revoke insert on public.club_join_requests from authenticated, anon;


-- -----------------------------------------------------------------------------------------------------
-- 6. A NEW-CLUB REQUEST'S REVIEW IS THE SERVER'S
--
-- Signup still writes the request a person makes for a club the directory does not have. When a person writes
-- it (the browser roles), everything after the asking is set here; the curated bulk imports, which write as
-- the server, keep their provenance.
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.directory_request_review_is_the_server_s()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if current_user in ('authenticated', 'anon') then
    new.submitted_by := auth.uid();
    new.status := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.review_notes := null;
    new.created_directory_id := null;
    new.source := null;
    new.created_at := now();
    new.updated_at := now();
  end if;
  return new;
end;
$function$;
revoke all on function internal.directory_request_review_is_the_server_s() from public, anon, authenticated;

create trigger directory_requests_review_is_the_server_s
  before insert on public.directory_requests
  for each row execute function internal.directory_request_review_is_the_server_s();


-- -----------------------------------------------------------------------------------------------------
-- 7. A LEGACY GUARDIAN INVITATION IS USED ONCE, FOR WHAT IT WAS SENT FOR
--
-- The club's "replacement guardian" link still uses the older guardian_invitations store: Step 17 kept it,
-- because link_guardian_to_existing_player and create_player_for_guardian take its id, and
-- send_replacement_guardian_invitation is the only thing that has ever written it. Three ways it could leave
-- guardian state the canonical engine would refuse (found by this hardening's audit) are closed here:
--
--   a. It was never spent. A guardian the club had REVOKED could call link_guardian_to_existing_player again
--      with the same accepted invitation and be ACTIVE again. An invitation is now used once: the first link
--      spends it, whatever becomes of the relationship afterwards.
--   b. create_player_for_guardian did not ask what the invitation was for. A replacement link -- sent for one
--      existing child -- could create new children with ACTIVE team places, as often as its holder liked. A
--      replacement link now only links its own child, and any invitation creates at most one child.
--   c. An accepted invitation was trusted forever (may_add_child_at_club), so a person whose relationship
--      from it the club had revoked could still add a child straight to ACTIVE. That trust now ends when the
--      club ends the relationship the invitation made.
--
-- As in the canonical engine, an invitation also stops working once the person who sent it has lost the
-- authority to send it.
-- -----------------------------------------------------------------------------------------------------
alter table public.guardian_invitations add column if not exists used_at timestamptz;
comment on column public.guardian_invitations.used_at is
  'When the invitation was spent -- its child linked, or a child (or a duplicate review) created from it. An invitation is used once (20270743000000).';

-- An invitation already used before this migration is recorded as used, from what it already produced -- the
-- relationship it made, or the duplicate review it opened -- so an old one cannot bring back a guardian the club
-- has since removed. (One whose link found an open relationship already in place left no trace to read; it
-- stays usable once, which is the only gap this cannot close from the data.)
update public.guardian_invitations gi
   set used_at = coalesce(gi.accepted_at, gi.updated_at)
 where gi.used_at is null
   and gi.status = 'accepted'
   and (exists (select 1 from public.guardians g where g.source_invitation_id = gi.id)
        or exists (select 1 from public.player_duplicate_reviews r where r.guardian_invitation_id = gi.id));

-- Whether the person who sent a legacy guardian invitation still holds the authority it was sent with.
create or replace function internal.legacy_guardian_invitation_issuer_ok(p_invitation public.guardian_invitations)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select p_invitation.invited_by_user_id is not null
     and (internal.capability_decision(p_invitation.invited_by_user_id, 'family.relationship.approve', 'club',
                                       p_invitation.club_id, null, null)).allowed;
$function$;
revoke all on function internal.legacy_guardian_invitation_issuer_ok(public.guardian_invitations) from public, anon, authenticated;

create or replace function public.link_guardian_to_existing_player(p_guardian_invitation_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  inv public.guardian_invitations;
begin
  select * into inv from public.guardian_invitations where id = p_guardian_invitation_id for update;
  if inv.id is null or inv.status <> 'accepted' or inv.accepted_by is distinct from auth.uid()
     or not internal.can('family.child.add', 'self') then
    raise exception 'You do not have an accepted invitation for this team.' using errcode = '42501';
  end if;
  if inv.replacement_for_player_id is null or inv.replacement_for_player_id <> p_player_id then
    raise exception 'This invitation is not for that player.' using errcode = '42501';
  end if;
  -- (a) Used once.
  if inv.used_at is not null then
    raise exception 'This invitation has already been used. Ask the club to send a new one.' using errcode = '42501';
  end if;
  if not internal.legacy_guardian_invitation_issuer_ok(inv) then
    raise exception 'This invitation can no longer be used. Ask the club to send a new one.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.player_team_memberships where player_id = p_player_id and team_id = inv.team_id and state = 'ACTIVE') then
    raise exception 'That player is not on the invited team.' using errcode = '42501';
  end if;

  -- An open relationship (active, awaiting approval or on hold) is left as it is: an invitation never lifts a
  -- hold or skips a pending decision. Either way the invitation is spent.
  insert into public.guardians (guardian_user_id, player_id, relationship_type, created_by, source, source_invitation_id)
  values (auth.uid(), p_player_id, 'guardian', auth.uid(), 'GUARDIAN_INVITATION', p_guardian_invitation_id)
  on conflict do nothing;
  update public.guardian_invitations set used_at = now(), updated_at = now() where id = inv.id;
end;
$function$;

create or replace function public.create_player_for_guardian(p_guardian_invitation_id uuid, p_first_name text, p_surname text, p_date_of_birth date, p_playing_pathway text default null::text)
returns table(result text, player_id uuid)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  inv public.guardian_invitations;
  v_match_player_id uuid;
  v_player_id uuid;
begin
  select * into inv from public.guardian_invitations where id = p_guardian_invitation_id for update;
  if inv.id is null or inv.status <> 'accepted' or inv.accepted_by is distinct from auth.uid()
     or not internal.can('family.child.add', 'self') then
    raise exception 'You do not have an accepted invitation for this team.' using errcode = '42501';
  end if;
  -- (b) What it was sent for: a replacement link is for one existing child, and never adds a new one.
  if inv.replacement_for_player_id is not null then
    raise exception 'This invitation links you to the child it was sent for. It cannot add a new child.' using errcode = '42501';
  end if;
  -- Used once: a duplicate review it already opened is still the answer; anything else is spent.
  if inv.used_at is not null then
    if exists (select 1 from public.player_duplicate_reviews r where r.guardian_invitation_id = inv.id) then
      return query select 'under_review'::text, null::uuid;
      return;
    end if;
    raise exception 'This invitation has already been used. Ask the club to send a new one.' using errcode = '42501';
  end if;
  if not internal.legacy_guardian_invitation_issuer_ok(inv) then
    raise exception 'This invitation can no longer be used. Ask the club to send a new one.' using errcode = '42501';
  end if;
  if coalesce(trim(p_first_name), '') = '' or coalesce(trim(p_surname), '') = '' then
    raise exception 'First name and surname are required.' using errcode = '23514';
  end if;

  select ptm.player_id into v_match_player_id
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  where ptm.team_id = inv.team_id
    and ptm.state = 'ACTIVE'
    and lower(p.first_name) = lower(trim(p_first_name))
    and lower(p.surname) = lower(trim(p_surname))
    and p.date_of_birth is not distinct from p_date_of_birth
  limit 1;

  if v_match_player_id is not null then
    insert into public.player_duplicate_reviews (guardian_invitation_id, team_id, submitted_first_name, submitted_surname, submitted_date_of_birth, matched_player_id, submitted_by)
    values (inv.id, inv.team_id, trim(p_first_name), trim(p_surname), p_date_of_birth, v_match_player_id, auth.uid());
    update public.guardian_invitations set used_at = now(), updated_at = now() where id = inv.id;
    return query select 'under_review'::text, null::uuid;
    return;
  end if;

  if p_playing_pathway is null or upper(p_playing_pathway) not in ('MALE','FEMALE') then
    raise exception 'Tell us which playing pathway applies to this player so their age grade can be worked out correctly.'
      using errcode = '23514';
  end if;

  insert into public.players (first_name, surname, date_of_birth, playing_pathway, created_by)
  values (trim(p_first_name), trim(p_surname), p_date_of_birth, upper(p_playing_pathway), auth.uid())
  returning id into v_player_id;

  insert into public.guardians (guardian_user_id, player_id, relationship_type, created_by, source, source_invitation_id)
  values (auth.uid(), v_player_id, 'guardian', auth.uid(), 'GUARDIAN_INVITATION', p_guardian_invitation_id);

  insert into public.player_team_memberships (player_id, team_id, created_by, source)
  values (v_player_id, inv.team_id, auth.uid(), 'GUARDIAN_INVITATION');

  update public.guardian_invitations set used_at = now(), updated_at = now() where id = inv.id;
  return query select 'created'::text, v_player_id;
end;
$function$;

-- (c) The club's trust in a person it invited lasts while the relationship that invitation made stands.
create or replace function internal.may_add_child_at_club(p_club_id uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select case
    when internal.effective_person() is null or not internal.can('family.child.add', 'self') then null
    when exists (select 1 from public.guardian_invitations gi
                 where gi.club_id = p_club_id and gi.accepted_by = internal.effective_person() and gi.status = 'accepted'
                   and not exists (select 1 from public.guardians g
                                    where g.source_invitation_id = gi.id
                                      and g.state in ('REVOKED', 'DECLINED', 'EXPIRED', 'SUSPENDED')))
      then 'INVITATION'
    when exists (select 1 from public.guardians g
                 join public.player_team_memberships ptm on ptm.player_id = g.player_id and ptm.state in ('ACTIVE', 'PENDING')
                 join public.teams t on t.id = ptm.team_id and t.club_id = p_club_id
                 where g.guardian_user_id = internal.effective_person() and g.state = 'ACTIVE')
      then 'RELATIONSHIP'
  end;
$function$;
