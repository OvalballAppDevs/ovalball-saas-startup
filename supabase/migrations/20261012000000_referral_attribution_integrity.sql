-- Phase F0 -- referral attribution and reconciliation integrity.
--
-- The Site Admin Dashboard audit (docs/SITE_ADMIN_DASHBOARD_ARCHITECTURE.md)
-- found that a club could legitimately be introduced to Ovalball, be claimed,
-- be approved, and end up with a real partnership -- while the canonical
-- referral record that entitles the introducing club to its reward silently
-- never existed. This migration closes that, and nothing else: no reward
-- policy changes, no new referral store, no analytics.
--
-- Three defects are fixed here. They compound, which is why they are one
-- migration: R-0 is the reason R-1 fires on every single invitation today.
--
--   R-0  Four CLUB_ADMIN capabilities were silently dropped.
--        20261011000000_training_management_schema.sql re-declared
--        internal.has_club_role_capability() in full from a base that
--        predated the commercial platform, adding 'club.training.manage'
--        and losing 'club.referrals.view', 'club.referrals.manage',
--        'club.platform_billing.view' and 'club.platform_billing.manage'.
--        Because it sorts after 20261006000000, it wins. The live effect is
--        that NO Club Admin can currently make a referral, see a referral,
--        choose an Ovalball plan, or read their own Ovalball billing -- the
--        commercial platform is switched off for every club.
--
--   R-1  Referral creation was an application-layer side effect.
--        create_partner_invitation() committed the invitation, and a
--        SECOND, separate RPC round trip from the server action then tried
--        to record the referral, logging and continuing on failure. Given
--        R-0 that second call has been failing 100% of the time. Even
--        without R-0 it is a lost update waiting to happen: two
--        transactions, no invariant.
--
--   R-2  club_ovalball_invitations had no expiry lifecycle at all, and
--        reconciliation excluded expires_at < now(). A club claimed on day
--        15 produced no partnership AND no referral, permanently -- even
--        though the invitation was live when the club acted on it.
--
-- Attribution and reward remain strictly separate. Nothing here can cause a
-- reward to be issued: a reward still requires the referred club's FIRST
-- successfully collected Ovalball subscription payment, which remains
-- impossible during Beta, and which this migration does not touch.

-- =====================================================================
-- 0. R-0 -- restore the capabilities that were silently dropped
-- =====================================================================

-- Re-declared in full because a function body cannot be amended in place.
-- This is the UNION of what 20261006000000 and 20261011000000 each intended:
-- every key from the training-management version is carried over verbatim
-- (including 'club.training.manage'), and the four commercial keys are put
-- back. Nothing is removed.
--
-- This function has now been re-declared in full by nine separate
-- migrations, and each one is an opportunity to silently drop a key that a
-- different feature added. supabase/tests/referral_attribution_integrity.sql
-- asserts every key in this list resolves for a real CLUB_ADMIN, so the next
-- stale re-declaration fails the suite instead of disabling a product area
-- in silence.
create or replace function internal.has_club_role_capability(p_club_id uuid, p_capability_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not internal.is_club_active(p_club_id) then false
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and cm.role = 'CLUB_ADMIN'
    ) then p_capability_key in (
      'club.edit_profile', 'club.logo.manage', 'club.venues.manage', 'club.pitches.manage',
      'club.teams.manage', 'club.team_lifecycle.manage', 'club.roster.manage', 'club.season_rollover.manage',
      'people.manage', 'people.view', 'club.view', 'team.view',
      'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.manage_requests', 'fixture.view',
      'calendar.manage', 'calendar.view', 'partner.manage', 'messages.fixture_send',
      'manage_mini_rugby_groups', 'manage_fixture_callups', 'approve_fixture_callups',
      'manage_player_dispensations', 'approve_player_dispensations', 'place_graduating_players',
      'team.guardians.invite', 'club.guardians.manage', 'team.community.manage', 'team.attendance.view',
      'club.gocardless.connect', 'club.subscription.configure', 'club.subscription.view_finance',
      'club.subscription.manage_enrolment', 'club.subscription.manage_payment_actions', 'club.subscription.export',
      'club.training.manage',
      -- Restored (R-0):
      'club.platform_billing.view', 'club.platform_billing.manage',
      'club.referrals.view', 'club.referrals.manage'
    )
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and cm.role = 'FIXTURE_SECRETARY'
    ) then p_capability_key in (
      'club.pitches.manage', 'people.view', 'club.view', 'team.view',
      'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.manage_requests', 'fixture.view',
      'calendar.manage', 'calendar.view', 'partner.manage', 'messages.fixture_send',
      'manage_mini_rugby_groups', 'manage_fixture_callups', 'approve_fixture_callups',
      'manage_player_dispensations', 'approve_player_dispensations', 'place_graduating_players'
    )
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false
    ) then p_capability_key in ('club.view', 'team.view', 'people.view', 'calendar.view', 'fixture.view')
    else false
  end;
$$;

-- Fail the migration rather than ship a half-restored capability set.
do $$
declare
  v_missing text;
begin
  select string_agg(k, ', ') into v_missing
  from unnest(array[
    'club.referrals.view', 'club.referrals.manage',
    'club.platform_billing.view', 'club.platform_billing.manage',
    'club.training.manage'
  ]) as k
  where position('''' || k || '''' in pg_get_functiondef(
    'internal.has_club_role_capability(uuid, text)'::regprocedure)) = 0;

  if v_missing is not null then
    raise exception 'R-0 restore incomplete -- missing capability keys: %', v_missing;
  end if;
end $$;

-- =====================================================================
-- 1. How a referral came to exist -- automatic vs repaired vs manual
-- =====================================================================

-- Section 20 of the F0 brief: automated reconciliation must be
-- distinguishable from a manual Site Admin action. audit_log already records
-- who and when for every row change on this table; this column records the
-- PATH, which audit_log cannot infer.
alter table public.platform_referrals
  add column if not exists attribution_source text not null default 'invitation';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.platform_referrals'::regclass
      and conname = 'platform_referrals_attribution_source_check'
  ) then
    alter table public.platform_referrals
      add constraint platform_referrals_attribution_source_check
      check (attribution_source in ('invitation', 'reconciliation', 'manual'));
  end if;
end $$;

comment on column public.platform_referrals.attribution_source is
  'How this attribution came to exist: ''invitation'' (created in the same transaction as the invitation -- the normal path), ''reconciliation'' (repaired afterwards from proven canonical evidence), ''manual'' (a person invoked claim_club_referral for an existing invitation). Never a reward signal: qualification is decided solely by the first successfully collected payment.';

-- =====================================================================
-- 2. R-1 -- one referral-creation path, at the database boundary
-- =====================================================================

-- The single implementation. Deliberately has NO capability check of its
-- own: authorization belongs to the business act that calls it (creating an
-- invitation, or explicitly claiming one), and both callers below check
-- before they get here. Keeping the check out of this function is what
-- makes "one business path, two authorized entry points" true rather than
-- two competing implementations.
--
-- Idempotent by the UNIQUE constraint on invitation_id, and by returning
-- the existing row rather than raising.
create or replace function internal.ensure_club_referral(
  p_invitation_id uuid,
  p_source text default 'invitation',
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation record;
  v_id uuid;
begin
  if p_source not in ('invitation', 'reconciliation', 'manual') then
    raise exception 'Unknown referral attribution source: %.', p_source;
  end if;

  select id, inviting_club_id into v_invitation
  from public.club_ovalball_invitations
  where id = p_invitation_id;

  if v_invitation.id is null then
    raise exception 'No such club invitation.';
  end if;

  -- Lock the invitation, not the referral: the referral may not exist yet,
  -- and two concurrent callers must serialise on something that does.
  perform 1 from public.club_ovalball_invitations
  where id = p_invitation_id for update;

  select id into v_id from public.platform_referrals where invitation_id = p_invitation_id;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.platform_referrals (invitation_id, referring_club_id, created_by, attribution_source)
  values (p_invitation_id, v_invitation.inviting_club_id, p_actor, p_source)
  on conflict (invitation_id) do nothing
  returning id into v_id;

  -- Lost the race to a concurrent transaction; its row is the canonical one.
  if v_id is null then
    select id into v_id from public.platform_referrals where invitation_id = p_invitation_id;
  end if;

  return v_id;
end;
$$;

revoke execute on function internal.ensure_club_referral(uuid, text, uuid) from public, anon, authenticated;

comment on function internal.ensure_club_referral is
  'Creates the canonical referral claim for an invitation, exactly once. The single implementation behind both create_partner_invitation (automatic) and claim_club_referral (explicit). Authorization is the caller''s responsibility -- see each entry point.';

-- Re-declared from 20260917000000 with ONE change: the referral is now
-- created in the same transaction as the invitation. Everything else is
-- carried over verbatim.
--
-- Why here, and not left to the application: this is the transaction that
-- creates the business fact. If the invitation exists, the club made an
-- introduction, and the introduction is the referral. Splitting them across
-- two round trips made attribution depend on the browser finishing its work
-- -- which is exactly the failure the audit found in production data.
--
-- Note on authority: creating an invitation requires
-- can_manage_club_fixtures, which a FIXTURE_SECRETARY holds, whereas
-- claim_club_referral requires club.referrals.manage (CLUB_ADMIN only). A
-- fixture secretary's invitation therefore now records a referral for their
-- club. That is deliberate and is not a broadening of referral ELIGIBILITY:
-- the reward accrues to the club, the club authorised the invitation, and
-- every eligibility gate (self-referral, already-a-subscriber, referring
-- club still active, first collected payment) is unchanged and still
-- enforced downstream.
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

  -- R-1: same transaction, no second round trip, no best effort.
  perform internal.ensure_club_referral(v_id, 'invitation', auth.uid());

  return v_id;
exception
  when unique_violation then
    raise exception 'You already have a pending invitation out to this club.' using errcode = 'P0001';
end;
$$;

revoke execute on function public.create_partner_invitation(uuid, uuid, text, text) from public;
grant execute on function public.create_partner_invitation(uuid, uuid, text, text) to authenticated;

-- The explicit entry point stays, and stays capability-checked, because it
-- is still the right tool for an invitation that predates this migration.
-- It now delegates rather than carrying its own insert, so there is exactly
-- one implementation.
create or replace function public.claim_club_referral(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation record;
begin
  select id, inviting_club_id into v_invitation
  from public.club_ovalball_invitations
  where id = p_invitation_id;

  if v_invitation.id is null then
    raise exception 'No such club invitation.';
  end if;

  if not (internal.has_capability('club.referrals.manage', 'club', v_invitation.inviting_club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to refer clubs on behalf of this club.' using errcode = '42501';
  end if;

  return internal.ensure_club_referral(p_invitation_id, 'manual', auth.uid());
end;
$$;

-- =====================================================================
-- 3. R-2 -- invitation expiry and acceptance lifecycle
-- =====================================================================

-- The lifecycle every other invitation type in this schema already has and
-- this one did not. Purely a status correction: it never touches referrals,
-- never creates a partnership, and never makes anything eligible.
create or replace function internal.expire_due_club_ovalball_invitations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.club_ovalball_invitations
    set status = 'expired', updated_at = now()
    where status = 'pending' and expires_at <= now()
    returning 1
  )
  select count(*)::integer into v_count from expired;
  return v_count;
end;
$$;

revoke execute on function internal.expire_due_club_ovalball_invitations() from public, anon, authenticated;

comment on function internal.expire_due_club_ovalball_invitations is
  'Marks lapsed club-to-Ovalball invitations as expired. Status hygiene only: an expired invitation that was live when the invited club acted on it is still attributable -- see reconcile_partner_invitations, which judges validity against the moment the club submitted its claim, not the moment a Site Admin got round to approving it.';

-- Re-declared with the R-2 fix. Two changes from 20261008000000, both about
-- WHEN an invitation counts, and one about repairing missing attribution.
--
-- The distinction the brief asks for, made precise:
--
--   * An invitation that was live at the moment the invited club acted --
--     i.e. when it submitted its claim -- stays attributable however long a
--     Site Admin takes to approve it. Approval latency is Ovalball's, not
--     the club's, and it must not destroy either the partnership or the
--     referral. Previously it destroyed both.
--
--   * An invitation that had genuinely lapsed BEFORE the club acted does
--     not become a successful referral. It is left alone (and swept to
--     'expired' by the function above).
--
-- p_reference_at is that moment. It defaults to now() so the older two-arg
-- call sites keep their previous meaning, and approve_club_claim passes the
-- claim's own created_at.
create or replace function internal.reconcile_partner_invitations(
  p_directory_id uuid,
  p_new_club_id uuid,
  p_reference_at timestamptz default now()
)
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
    where club_directory_id = p_directory_id
      -- 'expired' is included deliberately: the sweep above may have
      -- relabelled an invitation that was still live when the club acted.
      -- expires_at vs p_reference_at is what actually decides, not status.
      and status in ('pending', 'expired')
      and expires_at > p_reference_at
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
$$;

-- Re-declared from 20261008000000 with ONE change: the claim's own
-- created_at is passed as the reference moment. Everything else verbatim.
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

  -- R-2: judged against when the CLUB acted, not when we got round to it.
  perform internal.reconcile_partner_invitations(v_claim.directory_id, v_club_id, v_claim.created_at);

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

-- =====================================================================
-- 4. Repairing historical attribution -- proven evidence only
-- =====================================================================

-- Classifies every referral anomaly, and repairs only the cases where
-- canonical data already proves the relationship. Nothing here guesses.
--
-- p_dry_run defaults to TRUE: calling this function without thinking about
-- it reports and changes nothing.
--
-- Categories returned:
--   repaired            -- attribution created/completed from proven evidence
--   requires_review     -- a real anomaly a person must decide on
--   unresolvable        -- evidence cannot exist; reported, never touched
create or replace function public.reconcile_referral_attribution(p_dry_run boolean default true)
returns table (
  category text,
  finding text,
  invitation_id uuid,
  referral_id uuid,
  club_id uuid,
  detail text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_ref uuid;
begin
  if not (internal.is_site_admin() and internal.has_capability('site.commercial.manage', 'site')) then
    raise exception 'Not authorized to reconcile referral attribution.' using errcode = '42501';
  end if;

  -- ---------------------------------------------------------------
  -- (a) Accepted invitation, club exists, but no referral record.
  --     R-1's historical damage. Repairable only when this invitation
  --     is the ONLY accepted one for that directory club -- otherwise
  --     which club introduced them is genuinely ambiguous.
  -- ---------------------------------------------------------------
  for v_row in
    select i.id as inv_id,
           i.inviting_club_id,
           c.id as referred_club_id,
           (select count(*) from public.club_ovalball_invitations i2
             where i2.club_directory_id = i.club_directory_id
               and i2.status = 'accepted'
               and i2.inviting_club_id <> i.inviting_club_id) as rival_count
    from public.club_ovalball_invitations i
    join public.clubs c on c.directory_id = i.club_directory_id
    left join public.platform_referrals r on r.invitation_id = i.id
    where i.status = 'accepted' and r.id is null
  loop
    if v_row.rival_count > 0 then
      category := 'requires_review';
      finding := 'ambiguous_referrer';
      invitation_id := v_row.inv_id;
      referral_id := null;
      club_id := v_row.referred_club_id;
      detail := format('%s other club(s) also hold an accepted invitation to this club; the introducing club cannot be determined from data.', v_row.rival_count);
      return next;
      continue;
    end if;

    if v_row.inviting_club_id = v_row.referred_club_id then
      category := 'requires_review';
      finding := 'self_referral_invitation';
      invitation_id := v_row.inv_id;
      referral_id := null;
      club_id := v_row.referred_club_id;
      detail := 'The inviting club and the referred club are the same club.';
      return next;
      continue;
    end if;

    if p_dry_run then
      category := 'repaired';
      finding := 'missing_referral_for_accepted_invitation';
      invitation_id := v_row.inv_id;
      referral_id := null;
      club_id := v_row.referred_club_id;
      detail := 'DRY RUN -- would create the referral and register the referred club.';
      return next;
      continue;
    end if;

    v_ref := internal.ensure_club_referral(v_row.inv_id, 'reconciliation', auth.uid());
    -- register_referred_club applies every eligibility gate (self-referral,
    -- already-a-subscriber) and records a rejection reason rather than
    -- raising. A rejected repair is still a correct repair: the truthful
    -- outcome is "attributed, and ineligible", not "no record".
    perform public.register_referred_club(v_row.inv_id, v_row.referred_club_id);

    category := 'repaired';
    finding := 'missing_referral_for_accepted_invitation';
    invitation_id := v_row.inv_id;
    referral_id := v_ref;
    club_id := v_row.referred_club_id;
    detail := (select 'Referral created and registered; status is now ' || r.status
               from public.platform_referrals r where r.id = v_ref);
    return next;
  end loop;

  -- ---------------------------------------------------------------
  -- (b) Referral exists and is still 'pending', but the invited club
  --     is demonstrably on Ovalball. R-2's historical damage.
  -- ---------------------------------------------------------------
  for v_row in
    select r.id as ref_id, i.id as inv_id, c.id as referred_club_id
    from public.platform_referrals r
    join public.club_ovalball_invitations i on i.id = r.invitation_id
    join public.clubs c on c.directory_id = i.club_directory_id
    where r.status = 'pending'
  loop
    if p_dry_run then
      category := 'repaired';
      finding := 'pending_referral_for_activated_club';
      invitation_id := v_row.inv_id;
      referral_id := v_row.ref_id;
      club_id := v_row.referred_club_id;
      detail := 'DRY RUN -- would register the referred club against this referral.';
      return next;
      continue;
    end if;

    perform public.register_referred_club(v_row.inv_id, v_row.referred_club_id);

    category := 'repaired';
    finding := 'pending_referral_for_activated_club';
    invitation_id := v_row.inv_id;
    referral_id := v_row.ref_id;
    club_id := v_row.referred_club_id;
    detail := (select 'Status is now ' || r.status from public.platform_referrals r where r.id = v_row.ref_id);
    return next;
  end loop;

  -- ---------------------------------------------------------------
  -- (c) A referral reward credit that no referral owns.
  --     Never repaired, never deleted -- financial history is preserved
  --     and a person decides. The ownership FK runs referral -> credit,
  --     so the credit itself carries no evidence of which referral (if
  --     any) produced it; reconstructing one would be a guess.
  -- ---------------------------------------------------------------
  for v_row in
    select cr.id as credit_id, cr.club_id, cr.amount_pence, cr.reason, cr.created_at
    from public.platform_credits cr
    left join public.platform_referrals r on r.reward_credit_id = cr.id
    where cr.source = 'referral_reward' and r.id is null
  loop
    category := 'unresolvable';
    finding := 'reward_credit_without_referral';
    invitation_id := null;
    referral_id := null;
    club_id := v_row.club_id;
    detail := format('Credit %s of %s pence created %s (%s). Preserved for audit; no referral can be reconstructed from a credit.',
                     v_row.credit_id, v_row.amount_pence, v_row.created_at::date, coalesce(v_row.reason, 'no reason recorded'));
    return next;
  end loop;

  -- ---------------------------------------------------------------
  -- (d) A qualified referral whose reward credit is missing. This is
  --     money owed and unpaid -- always a person's decision.
  -- ---------------------------------------------------------------
  for v_row in
    select r.id as ref_id, r.invitation_id as inv_id, r.referring_club_id
    from public.platform_referrals r
    where r.status = 'qualified' and r.reward_credit_id is null
  loop
    category := 'requires_review';
    finding := 'qualified_referral_without_reward';
    invitation_id := v_row.inv_id;
    referral_id := v_row.ref_id;
    club_id := v_row.referring_club_id;
    detail := 'This referral qualified but holds no reward credit. Issue the credit deliberately; never automatically.';
    return next;
  end loop;

  return;
end;
$$;

revoke execute on function public.reconcile_referral_attribution(boolean) from public, anon, authenticated;
grant execute on function public.reconcile_referral_attribution(boolean) to authenticated;

comment on function public.reconcile_referral_attribution is
  'Classifies and (when p_dry_run is false) repairs referral attribution from proven canonical evidence only. Idempotent: a repaired referral is no longer missing, so a second run finds nothing to do. Requires Site Admin AND site.commercial.manage. Never issues a reward, never deletes a financial record, never guesses an ambiguous referrer.';

-- =====================================================================
-- 5. Referral data health
-- =====================================================================

-- The aggregate. Counts and a status, no identifiers, no PII -- this is the
-- one a dashboard tile calls.
create or replace function public.referral_data_health()
returns table (
  status text,
  missing_attribution int,
  pending_for_activated_club int,
  ambiguous_referrer int,
  qualified_without_reward int,
  reward_without_referral int,
  duplicate_attribution int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_missing int; v_pending int; v_ambiguous int;
  v_qual_no_reward int; v_orphan_reward int; v_dupe int;
begin
  if not (internal.is_site_admin() and internal.has_capability('site.commercial.view', 'site')) then
    raise exception 'Not authorized to read referral data health.' using errcode = '42501';
  end if;

  -- An accepted invitation whose club exists, with no referral at all.
  select count(*) into v_missing
  from public.club_ovalball_invitations i
  join public.clubs c on c.directory_id = i.club_directory_id
  left join public.platform_referrals r on r.invitation_id = i.id
  where i.status = 'accepted' and r.id is null;

  -- A referral still 'pending' although the invited club is on Ovalball.
  select count(*) into v_pending
  from public.platform_referrals r
  join public.club_ovalball_invitations i on i.id = r.invitation_id
  join public.clubs c on c.directory_id = i.club_directory_id
  where r.status = 'pending';

  -- More than one club holding an accepted invitation to the same club.
  select count(*) into v_ambiguous
  from (
    select i.club_directory_id
    from public.club_ovalball_invitations i
    join public.clubs c on c.directory_id = i.club_directory_id
    left join public.platform_referrals r on r.invitation_id = i.id
    where i.status = 'accepted' and r.id is null
    group by i.club_directory_id
    having count(distinct i.inviting_club_id) > 1
  ) ambiguous;

  -- Every column here is table-qualified on purpose: this function's OUT
  -- parameters include `status`, which would otherwise shadow
  -- platform_referrals.status and make the reference ambiguous.
  select count(*) into v_qual_no_reward
  from public.platform_referrals pr
  where pr.status = 'qualified' and pr.reward_credit_id is null;

  select count(*) into v_orphan_reward
  from public.platform_credits cr
  left join public.platform_referrals r on r.reward_credit_id = cr.id
  where cr.source = 'referral_reward' and r.id is null;

  -- Two qualified referrals for one referred club. The partial unique index
  -- makes this impossible; counted anyway, because a detector that only
  -- checks what it believes cannot fail is not a detector.
  select count(*) into v_dupe
  from (
    select pr.referred_club_id from public.platform_referrals pr
    where pr.status = 'qualified' and pr.referred_club_id is not null
    group by pr.referred_club_id having count(*) > 1
  ) dupes;

  missing_attribution        := v_missing;
  pending_for_activated_club := v_pending;
  ambiguous_referrer         := v_ambiguous;
  qualified_without_reward   := v_qual_no_reward;
  reward_without_referral    := v_orphan_reward;
  duplicate_attribution      := v_dupe;

  -- ACTION REQUIRED is reserved for money and for ambiguity a person must
  -- settle. RECONCILIATION NEEDED means safe repair will fix it.
  if v_qual_no_reward > 0 or v_orphan_reward > 0 or v_dupe > 0 or v_ambiguous > 0 then
    status := 'ACTION REQUIRED';
  elsif v_missing > 0 or v_pending > 0 then
    status := 'RECONCILIATION NEEDED';
  else
    status := 'HEALTHY';
  end if;

  return next;
end;
$$;

revoke execute on function public.referral_data_health() from public, anon, authenticated;
grant execute on function public.referral_data_health() to authenticated;

comment on function public.referral_data_health is
  'Aggregate referral attribution health for Site Admin. Counts only -- no identifiers, no emails, no tokens. HEALTHY / RECONCILIATION NEEDED / ACTION REQUIRED, where ACTION REQUIRED is reserved for money and for ambiguity that data cannot settle.';

-- The drill-through. Stable identifiers and club names only: no contact
-- email, no invitation token, no personal data. Deliberately a thin wrapper
-- over the dry run, so the list a Site Admin reads and the list the repair
-- would act on can never disagree.
create or replace function public.referral_data_health_detail()
returns table (
  category text,
  finding text,
  invitation_id uuid,
  referral_id uuid,
  club_id uuid,
  club_name text,
  detail text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (internal.is_site_admin() and internal.has_capability('site.commercial.view', 'site')) then
    raise exception 'Not authorized to read referral data health.' using errcode = '42501';
  end if;

  return query
  select d.category, d.finding, d.invitation_id, d.referral_id, d.club_id,
         coalesce(cd.name, c.slug) as club_name,
         d.detail
  from public.reconcile_referral_attribution(true) d
  left join public.clubs c on c.id = d.club_id
  left join public.club_directory cd on cd.id = c.directory_id;
end;
$$;

revoke execute on function public.referral_data_health_detail() from public, anon, authenticated;
grant execute on function public.referral_data_health_detail() to authenticated;

comment on function public.referral_data_health_detail is
  'Per-anomaly referral health detail for Site Admin drill-through: stable ids and club names only, never a contact email or an invitation token. A read-only view of exactly what reconcile_referral_attribution would act on.';

-- reconcile_referral_attribution is SECURITY DEFINER and checks
-- site.commercial.manage, but the detail wrapper above only needs
-- site.commercial.view. That is intentional and safe -- the wrapper is
-- itself SECURITY DEFINER, so the inner call runs as the function owner --
-- but it means the view-only path must never be able to reach the mutating
-- form. It cannot: p_dry_run is hard-coded true here, and the mutating call
-- re-checks site.commercial.manage against auth.uid(), which the wrapper
-- does not change.

-- =====================================================================
-- 6. Keep the lifecycle swept
-- =====================================================================

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('expire-club-ovalball-invitations')
      where exists (select 1 from cron.job where jobname = 'expire-club-ovalball-invitations');

    perform cron.schedule(
      'expire-club-ovalball-invitations',
      '30 3 * * *',
      $cron$select internal.expire_due_club_ovalball_invitations();$cron$
    );
  end if;
end $$;
