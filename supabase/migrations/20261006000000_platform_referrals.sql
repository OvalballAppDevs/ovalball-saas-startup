-- Commercial Platform, Phase H -- the referral engine.
--
-- The promise (section 45): refer another rugby club; if they start a paid
-- Ovalball subscription and their **first subscription payment is
-- successfully collected**, the referring club gets one month of its own
-- current plan free.
--
-- Everything hard about that sentence is in the words "first" and
-- "successfully collected". Not a click, not a registration, not a trial,
-- not a mandate, not a submitted payment. A reward is earned exactly once,
-- at exactly one moment, and it is given back if that collection later
-- fails.
--
-- No second invitation system is created. `club_ovalball_invitations`
-- already means "this club invited that club onto Ovalball" and has the
-- contact, the token, the expiry and the status. A referral is the
-- **commercial claim** layered on one of those invitations, not a parallel
-- copy of it.
--
-- No separate rewards table either. A reward IS a credit-ledger row, and
-- "one reward per referral" is a unique column on the referral rather than
-- a table whose only job would be to hold that constraint.

-- ---------------------------------------------------------------------
-- 1. Capabilities
-- ---------------------------------------------------------------------

insert into public.capabilities (key, label, description, category, applicable_scopes)
values
  ('club.referrals.view', 'View referrals', 'See the clubs this club has referred to Ovalball and any rewards earned.', 'club', array['club']),
  ('club.referrals.manage', 'Manage referrals', 'Refer another rugby club to Ovalball.', 'club', array['club'])
on conflict (key) do nothing;

-- Re-declared in full; the two referral keys on the CLUB_ADMIN branch are
-- the only change from the Phase D version.
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

-- ---------------------------------------------------------------------
-- 2. The referral
-- ---------------------------------------------------------------------

create table if not exists public.platform_referrals (
  id uuid primary key default gen_random_uuid(),

  -- The outreach this claim is attached to. One claim per invitation.
  invitation_id uuid not null unique references public.club_ovalball_invitations(id) on delete cascade,

  referring_club_id uuid not null references public.clubs(id) on delete cascade,

  -- Null until the invited club actually exists on Ovalball.
  referred_club_id uuid references public.clubs(id) on delete set null,

  status text not null default 'pending',
  rejection_reason text,

  -- The collection that earned it, and the credit it produced.
  qualifying_payment_id uuid references public.platform_payments(id) on delete set null,
  reward_credit_id uuid unique references public.platform_credits(id) on delete set null,

  -- The reward's value, fixed at the moment it was earned. Read from the
  -- referring club's own plan then, and never recomputed: a price change
  -- afterwards must not revalue a reward already given.
  reward_amount_pence int,
  reward_plan_code text references public.platform_plans(code),
  reward_price_version int,

  qualified_at timestamptz,
  reversed_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint platform_referrals_status_check check (
    status in ('pending', 'registered', 'qualified', 'rejected', 'reversed')
  ),

  -- A club cannot refer itself. The structural half of section 39.
  constraint platform_referrals_no_self_referral check (
    referred_club_id is null or referred_club_id <> referring_club_id
  ),

  constraint platform_referrals_qualified_has_reward check (
    status <> 'qualified' or (reward_credit_id is not null and qualifying_payment_id is not null and qualified_at is not null)
  ),
  constraint platform_referrals_registered_has_club check (
    status not in ('registered', 'qualified') or referred_club_id is not null
  )
);

-- A referred club can earn a reward for exactly one referrer, however many
-- clubs claim to have introduced it.
create unique index if not exists platform_referrals_one_qualified_per_referred_club
  on public.platform_referrals (referred_club_id)
  where status = 'qualified';

create index if not exists platform_referrals_referring_idx
  on public.platform_referrals (referring_club_id, created_at desc);
create index if not exists platform_referrals_referred_idx
  on public.platform_referrals (referred_club_id) where referred_club_id is not null;

alter table public.platform_referrals enable row level security;

-- The referring club sees its own referrals. The **referred** club
-- deliberately does not: whether another club earns a commission for
-- introducing you is not your business, and showing it would make the
-- relationship awkward for no benefit.
drop policy if exists platform_referrals_select on public.platform_referrals;
create policy platform_referrals_select on public.platform_referrals
  for select
  using (internal.has_capability('club.referrals.view', 'club', referring_club_id) or internal.is_site_admin());

-- No direct writes; every transition is a function.

drop trigger if exists set_updated_at on public.platform_referrals;
create trigger set_updated_at
  before update on public.platform_referrals
  for each row execute function set_updated_at();

drop trigger if exists audit_row_change on public.platform_referrals;
create trigger audit_row_change
  after insert or update or delete on public.platform_referrals
  for each row execute function internal.audit_row_change();

-- ---------------------------------------------------------------------
-- 3. Claiming a referral
-- ---------------------------------------------------------------------

-- Called when a club invites another club onto Ovalball, to record that
-- the invitation is also a referral claim. Idempotent: the same invitation
-- returns the same referral.
create or replace function public.claim_club_referral(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation record;
  v_id uuid;
begin
  select id, inviting_club_id, status into v_invitation
  from public.club_ovalball_invitations
  where id = p_invitation_id;

  if v_invitation.id is null then
    raise exception 'No such club invitation.';
  end if;

  if not (internal.has_capability('club.referrals.manage', 'club', v_invitation.inviting_club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to refer clubs on behalf of this club.' using errcode = '42501';
  end if;

  select id into v_id from public.platform_referrals where invitation_id = p_invitation_id;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.platform_referrals (invitation_id, referring_club_id, created_by)
  values (p_invitation_id, v_invitation.inviting_club_id, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- The invited club now exists on Ovalball. Called from the club-creation /
-- claim path, never by a browser.
create or replace function public.register_referred_club(p_invitation_id uuid, p_club_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref record;
begin
  select id, referring_club_id, status into v_ref
  from public.platform_referrals
  where invitation_id = p_invitation_id
  for update;

  if v_ref.id is null or v_ref.status <> 'pending' then
    return false;
  end if;

  if v_ref.referring_club_id = p_club_id then
    update public.platform_referrals
    set status = 'rejected', rejection_reason = 'A club cannot refer itself.'
    where id = v_ref.id;
    return false;
  end if;

  -- Genuinely new (section 38): a club that has already paid Ovalball
  -- cannot be introduced to it.
  if exists (
    select 1 from public.platform_payments
    where club_id = p_club_id and status = 'confirmed'
  ) then
    update public.platform_referrals
    set status = 'rejected', rejection_reason = 'That club was already an Ovalball subscriber.'
    where id = v_ref.id;
    return false;
  end if;

  update public.platform_referrals
  set status = 'registered', referred_club_id = p_club_id
  where id = v_ref.id;

  return true;
end;
$$;

revoke execute on function public.register_referred_club(uuid, uuid) from public, anon, authenticated;
grant execute on function public.register_referred_club(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------
-- 4. Earning, and losing, the reward
-- ---------------------------------------------------------------------

-- Called only from apply_platform_payment_status, only on a confirmation.
-- Returns the credit id when a reward is earned, otherwise null.
--
-- Every guard here is deliberate:
--   * the payment must be the referred club's FIRST confirmed payment;
--   * the referral must be 'registered', so a rejected or already-earned
--     one cannot earn again;
--   * the referring club must still be active, so a folded club does not
--     accrue credit it can never use;
--   * the reward's value is read once, here, and written down.
create or replace function internal.qualify_referral_for_payment(p_payment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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

  select r.id, r.referring_club_id, r.referred_club_id, r.status
  into v_ref
  from public.platform_referrals r
  where r.referred_club_id = v_payment.club_id
    and r.status = 'registered'
  order by r.created_at asc
  limit 1
  for update;

  if v_ref.id is null then
    return null;
  end if;

  if v_ref.referring_club_id = v_ref.referred_club_id then
    update public.platform_referrals
    set status = 'rejected', rejection_reason = 'A club cannot refer itself.'
    where id = v_ref.id;
    return null;
  end if;

  if not exists (select 1 from public.clubs where id = v_ref.referring_club_id and status = 'active') then
    update public.platform_referrals
    set status = 'rejected', rejection_reason = 'The referring club is no longer active.'
    where id = v_ref.id;
    return null;
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
    return null;
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
end;
$$;

revoke execute on function internal.qualify_referral_for_payment(uuid) from public, anon, authenticated;

-- The qualifying collection later failed or was charged back. The reward
-- goes back as a reversal row -- the ledger is append-only, and "earned,
-- then withdrawn" is the true history.
create or replace function internal.reverse_referral_for_payment(p_payment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref record;
begin
  select id, referring_club_id, reward_credit_id, reward_amount_pence
  into v_ref
  from public.platform_referrals
  where qualifying_payment_id = p_payment_id and status = 'qualified'
  for update;

  if v_ref.id is null or v_ref.reward_credit_id is null then
    return false;
  end if;

  -- Already reversed by an earlier delivery of the same event.
  if exists (select 1 from public.platform_credits where reverses_credit_id = v_ref.reward_credit_id) then
    return false;
  end if;

  insert into public.platform_credits (club_id, amount_pence, source, reason, reverses_credit_id)
  values (
    v_ref.referring_club_id, -v_ref.reward_amount_pence, 'reversal',
    'The referred club''s first subscription payment did not complete.',
    v_ref.reward_credit_id
  );

  update public.platform_referrals
  set status = 'reversed', reversed_at = now(),
      rejection_reason = 'The referred club''s first subscription payment did not complete.'
  where id = v_ref.id;

  return true;
end;
$$;

revoke execute on function internal.reverse_referral_for_payment(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Wiring qualification into the payment lifecycle
-- ---------------------------------------------------------------------

-- Re-declared from Phase G with two calls added. Everything else is
-- carried over verbatim. Qualification lives here, at the single point
-- where a payment becomes confirmed, so a repeated webhook cannot earn a
-- second reward: the function returns early on an already-terminal payment
-- before ever reaching this code.
create or replace function public.apply_platform_payment_status(
  p_payment_id uuid,
  p_status text,
  p_provider_payment_id text default null,
  p_failure_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
  v_sub record;
begin
  if p_status not in ('pending', 'submitted', 'confirmed', 'failed', 'cancelled', 'skipped') then
    raise exception 'Unknown payment status: %.', p_status;
  end if;

  select id, club_id, subscription_id, status into v_payment
  from public.platform_payments
  where id = p_payment_id
  for update;

  if v_payment.id is null then
    return false;
  end if;

  if v_payment.status = p_status or v_payment.status in ('confirmed', 'failed', 'cancelled', 'skipped') then
    return false;
  end if;

  update public.platform_payments
  set status = p_status,
      provider_payment_id = coalesce(p_provider_payment_id, provider_payment_id),
      confirmed_at = case when p_status = 'confirmed' then now() else confirmed_at end,
      failed_at = case when p_status = 'failed' then now() else failed_at end,
      failure_reason = case when p_status = 'failed' then p_failure_reason else failure_reason end
  where id = p_payment_id;

  select id, status into v_sub
  from public.platform_club_subscriptions
  where id = v_payment.subscription_id
  for update;

  if p_status = 'confirmed' then
    if v_sub.status in ('scheduled', 'past_due') then
      update public.platform_club_subscriptions
      set status = 'active',
          started_at = coalesce(started_at, now())
      where id = v_sub.id;
      perform internal.record_subscription_event(v_payment.club_id, v_sub.id,
        case when v_sub.status = 'past_due' then 'recovered' else 'activated' end,
        v_sub.status, 'active', null);
    end if;
    perform internal.record_subscription_event(v_payment.club_id, v_sub.id, 'payment_confirmed', v_sub.status, null, null);

    -- A referral earns its reward here and nowhere else.
    perform internal.qualify_referral_for_payment(p_payment_id);

  elsif p_status = 'failed' then
    if v_sub.status = 'active' then
      update public.platform_club_subscriptions set status = 'past_due' where id = v_sub.id;
      perform internal.record_subscription_event(v_payment.club_id, v_sub.id, 'past_due', v_sub.status, 'past_due', p_failure_reason);
    end if;
    perform internal.record_subscription_event(v_payment.club_id, v_sub.id, 'payment_failed', v_sub.status, null, p_failure_reason);

    insert into public.platform_credits (club_id, amount_pence, source, reason, reverses_credit_id)
    select v_payment.club_id, -c.amount_pence, 'reversal',
           'The collection this credit was applied to failed.', c.id
    from public.platform_credits c
    where c.applied_to_payment_id = p_payment_id
      and c.source = 'application'
      and not exists (select 1 from public.platform_credits r where r.reverses_credit_id = c.id);

    -- And a reward earned on this collection is withdrawn.
    perform internal.reverse_referral_for_payment(p_payment_id);
  end if;

  return true;
end;
$$;

revoke execute on function public.apply_platform_payment_status(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_platform_payment_status(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------
-- 6. Notifications
-- ---------------------------------------------------------------------

insert into public.notification_types (type_key, topic_key)
values ('platform_referral_reward_earned', 'platform_billing')
on conflict (type_key) do nothing;

-- ---------------------------------------------------------------------
-- 7. Reading a club's referrals
-- ---------------------------------------------------------------------

create or replace function public.club_referral_summary(p_club_id uuid)
returns table (
  referral_id uuid,
  referred_club_name text,
  status text,
  reward_amount_pence int,
  qualified_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id,
         coalesce(d.name, i.contact_name),
         r.status,
         r.reward_amount_pence,
         r.qualified_at,
         r.created_at
  from public.platform_referrals r
  join public.club_ovalball_invitations i on i.id = r.invitation_id
  left join public.club_directory d on d.id = i.club_directory_id
  where r.referring_club_id = p_club_id
    and (internal.has_capability('club.referrals.view', 'club', p_club_id) or internal.is_site_admin())
  order by r.created_at desc;
$$;
