-- SP4 Test Email + Delivery Proof: three pieces.

-- ---------------------------------------------------------------------------
-- 1. A public wrapper over the ALREADY-CANONICAL fixture audience resolver
--    (internal.fixture_audience_recipients, Match Centre's own "message the
--    team" feature, 20261103000000_fixture_communications.sql). internal.*
--    functions are not exposed to PostgREST; this adds zero new
--    authorization or eligibility logic, it only makes the existing rule
--    reachable from lib/email so match_cancelled (and any future
--    fixture-scoped event) never needs a second fixture-audience rule.
-- ---------------------------------------------------------------------------

-- TWO REAL BUGS, FOUND BY THE LIVE PROOF THIS MIGRATION EXISTS TO PASS, FIXED
-- HERE RATHER THAN LEFT FOR THE NEXT PERSON TO REDISCOVER.
--
-- Bug 1: this wrapper carried no authority check of its own. internal.
-- fixture_audience_recipients trusts ITS CALLER to have already verified
-- "may this actor manage this fixture" (send_fixture_communication does,
-- immediately before calling it) -- a bare passthrough wrapper skipped that
-- check entirely, so any authenticated user could have named ANY fixture_id
-- and learned which guardians are connected to it. Fixed by re-checking the
-- exact predicate send_fixture_communication itself uses.
--
-- Bug 2: returning bare user_id and reading email addresses back through
-- lib/email/recipients.ts's own `profiles` select (the same shape club_
-- billing_contact already uses) fails silently for any caller who is not
-- reading their own profile or a Site Admin -- profiles_select_self_or_admin
-- allows neither a Club Admin nor a coach to read another user's email this
-- way. club_billing_contact carries the identical latent bug, undiscovered
-- only because referral_reward_earned has never actually been triggered.
-- Fixed HERE, not by touching lib/email/recipients.ts's already-established
-- pattern for every other event: this function already re-checks the
-- caller's authority above, so it is the right, narrow place to also resolve
-- the email server-side, past a restriction the caller was never going to
-- satisfy on their own.
drop function if exists public.fixture_notification_recipients(uuid);

create function public.fixture_notification_recipients(p_fixture_id uuid)
returns table (user_id uuid, email text)
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare f public.fixtures;
begin
  select * into f from public.fixtures where id = p_fixture_id;
  if not found then
    return;
  end if;

  if not (
    internal.is_site_admin()
    or internal.can_manage_fixture_side(f.owning_team_id, f.owning_scheduling_group_id)
    or (f.opponent_team_id is not null and internal.can_manage_fixture_side(f.opponent_team_id, f.opponent_scheduling_group_id))
  ) then
    raise exception 'You are not authorized to notify this fixture''s participants.' using errcode = '42501';
  end if;

  return query
  select r.user_id, p.email
  from internal.fixture_audience_recipients(p_fixture_id, 'MESSAGE_TEAM') r
  join public.profiles p on p.id = r.user_id
  where p.email is not null and btrim(p.email) <> '';
end;
$$;

comment on function public.fixture_notification_recipients(uuid) is
  'Public wrapper over internal.fixture_audience_recipients (audience MESSAGE_TEAM -- the fixture''s full effective participant population), re-checking the exact authority send_fixture_communication itself uses before resolving anything. Returns (user_id, email) directly -- see this migration''s own header for why the email is resolved HERE rather than by the caller''s own profiles read, which fails under profiles RLS for any actor who is not the recipient or a Site Admin.';

revoke all on function public.fixture_notification_recipients(uuid) from public, anon;
grant execute on function public.fixture_notification_recipients(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. A REAL, PRE-EXISTING CATALOGUE DRIFT, FOUND WHILE WIRING THIS EVENT AND
--    FIXED HERE: club_welcome (lib/email/catalogue.ts) was never inserted
--    into public.email_events, and 'club_claimant' was never added to this
--    table's recipient_kind check constraint. club_welcome has been sending
--    successfully in practice only because claim_email_delivery's own FK to
--    email_events(event_key) has apparently never been exercised for it in
--    this dataset -- the first real send would have failed outright. Fixed
--    as part of this migration rather than left for the next person to
--    discover the hard way, per this SP4 pass's own remit to close
--    SP4-local gaps found while proving real delivery.
-- ---------------------------------------------------------------------------

alter table public.email_events drop constraint email_events_recipient_kind_check;
alter table public.email_events add constraint email_events_recipient_kind_check
  check (recipient_kind in (
    'club_invitation', 'guardian_invitation', 'player_account_invitation', 'safeguarding_officer',
    'site_admin_invitation', 'site_admin_inbox', 'support_ticket', 'partner_invitation',
    'club_billing_contact', 'club_claimant', 'fixture_participants'
  ));

insert into public.email_events (event_key, topic_key, classification, recipient_kind, description)
select 'club_welcome', 'access_invitations', 'MANDATORY_OPERATIONAL', 'club_claimant',
  'A club claim was approved, so the club is now live and its claimant is told.'
where not exists (select 1 from public.email_events where event_key = 'club_welcome');

-- ---------------------------------------------------------------------------
-- 3. MATCH CANCELLED -- the one real operational event this phase wires.
--
-- OPTIONAL_OPERATIONAL under the EXISTING fixture_updates topic (registered
-- by 20261103000000_fixture_communications.sql for the attendance reminder;
-- reused here rather than a second fixture-notification topic). A family
-- who has switched fixture updates off is respected, exactly as for every
-- other fixture-update notification.
-- ---------------------------------------------------------------------------

insert into public.email_events (event_key, topic_key, classification, recipient_kind, description)
select 'match_cancelled', 'fixture_updates', 'OPTIONAL_OPERATIONAL', 'fixture_participants',
  'A fixture was cancelled, so its effective participant population is told.'
where not exists (select 1 from public.email_events where event_key = 'match_cancelled');

-- Verification -- both the drift fix and the new event must actually be there.
do $$
begin
  if not exists (select 1 from public.email_events where event_key = 'club_welcome') then
    raise exception 'club_welcome is still missing from public.email_events.';
  end if;
  if not exists (select 1 from public.email_events where event_key = 'match_cancelled') then
    raise exception 'match_cancelled was not inserted into public.email_events.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. SEND TEST EMAIL -- audit + rate limit.
--
-- Reuses public.email_deliveries (the same ledger a real send uses) rather
-- than a second table -- a test send is a real attempt through the real
-- provider path, and belongs where an operator already looks. `initiated_by`
-- is new: no real event needed it (delivery is triggered by a domain event,
-- not a person, everywhere else in this table), but a test send is
-- genuinely a Full Site Admin's own action and both the audit requirement
-- and the rate limit need to know who.
-- ---------------------------------------------------------------------------

alter table public.email_deliveries add column if not exists initiated_by uuid references auth.users(id);

comment on column public.email_deliveries.initiated_by is
  'Set ONLY for recipient_kind = site_admin_test. Every other event is triggered by a domain occurrence, not a person, so this is null for a real send by design -- it is not "who approved this claim" or similar, only "which Site Admin ran this test".';

create index if not exists email_deliveries_test_rate_limit_idx
  on public.email_deliveries (initiated_by, queued_at desc)
  where recipient_kind = 'site_admin_test';

/**
 * Claims a test-email send. Authority + rate limit are checked HERE, in the
 * one place a test send can originate, rather than trusted to the caller --
 * the same reasoning every other write in this registry already follows.
 *
 * Deliberately NOT idempotency-keyed the way a real send is: an admin
 * re-sending the same test on purpose is the normal case, not a retry to
 * deduplicate. A fresh random key satisfies the ledger's unique constraint
 * every time without claiming any real-world occurrence happened twice.
 */
create or replace function public.claim_test_email_send(
  p_event_key text,
  p_recipient_email text,
  p_subject text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_id uuid;
  v_recent integer;
begin
  if not internal.is_full_site_admin() then
    raise exception 'Only a Full Site Admin may send a test email.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.email_events where event_key = p_event_key) then
    raise exception 'That is not an email Ovalball sends.';
  end if;

  -- At most 6 test sends per Site Admin per 10 minutes -- enough for a real
  -- edit-preview-test loop, not enough to become an accidental flood from a
  -- repeatedly-clicked button.
  select count(*) into v_recent
  from public.email_deliveries
  where initiated_by = auth.uid()
    and recipient_kind = 'site_admin_test'
    and queued_at > now() - interval '10 minutes';
  if v_recent >= 6 then
    raise exception 'Too many test emails sent recently. Please wait a few minutes and try again.' using errcode = '42501';
  end if;

  insert into public.email_deliveries (
    event_key, idempotency_key, recipient_kind, recipient_email, subject, initiated_by
  )
  values (
    p_event_key, 'site_admin_test:' || gen_random_uuid()::text, 'site_admin_test', p_recipient_email, p_subject, auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.claim_test_email_send(text, text, text) is
  'Authority (Full Site Admin only) and rate limit (6 per 10 minutes per admin), checked server-side, before a test email is ever attempted. Records the same audit facts a real delivery does: who, which event, which destination, when -- never the rendered body.';

revoke all on function public.claim_test_email_send(text, text, text) from public, anon;
grant execute on function public.claim_test_email_send(text, text, text) to authenticated;
