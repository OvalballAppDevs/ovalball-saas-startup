-- Ovalball Email Communications Foundation.
--
-- WHAT ALREADY EXISTED, AND IS NOT REBUILT HERE
--
-- The product already has the canonical notification architecture:
--
--   notification_topics       -- 8 topics, each with `mandatory`,
--                                `email_ready`, `push_ready`
--   notification_types        -- 40 in-app domain events, each mapped to a topic
--   notification_preferences  -- per user, per topic: in_app/email/push enabled
--
-- That IS the email policy layer. `mandatory` is already the "cannot be
-- turned off" classification, `email_enabled` is already the per-user
-- consent record, and `email_ready` already exists to say whether a topic
-- has a real email implementation behind it (every topic is currently
-- false, which was accurate -- nothing could send).
--
-- So this migration adds only the two things genuinely missing: a catalogue
-- of the EMAIL events themselves, and a delivery ledger. It creates no
-- second notification system, no parallel preference store, and no second
-- definition of "mandatory".
--
-- WHY EMAIL EVENTS ARE THEIR OWN CATALOGUE
--
-- Email is not a mirror of the in-app feed. Two things separate them:
--
--   * Some email events have NO in-app equivalent and never can -- an
--     invitation is sent to someone who has no Ovalball account yet, so
--     there is no user to notify and no preference row to consult. Those
--     are classified TRANSACTIONAL_IDENTITY and are not subject to a topic
--     preference, because the recipient has no way to hold one.
--   * Some in-app types should never generate email at all.
--
-- Hence: an email event may reference a topic (and then obeys that topic's
-- mandatory/preference rules), or may be identity-scoped (and then does
-- not). It is never both.

-- ---------------------------------------------------------------------
-- 1. The canonical email event catalogue
-- ---------------------------------------------------------------------
create table if not exists public.email_events (
  event_key text primary key,
  -- Nullable ON PURPOSE: identity/invitation email goes to a person with no
  -- account, so there is no preference row and no topic to consult.
  topic_key text references public.notification_topics(key) on update cascade,
  classification text not null check (classification in (
    'MANDATORY_OPERATIONAL',
    'OPTIONAL_OPERATIONAL',
    'TRANSACTIONAL_IDENTITY'
  )),
  -- Which server-side resolver produces the address. The dispatcher accepts
  -- no raw address, so this is the only way a recipient is ever determined.
  recipient_kind text not null check (recipient_kind in (
    'club_invitation',
    'guardian_invitation',
    'player_account_invitation',
    'safeguarding_officer',
    'site_admin_invitation',
    'site_admin_inbox',
    'support_ticket',
    'partner_invitation',
    'club_billing_contact'
  )),
  description text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),

  -- An identity email has no topic; a topic-scoped email must have one.
  constraint email_events_identity_has_no_topic check (
    (classification = 'TRANSACTIONAL_IDENTITY' and topic_key is null)
    or (classification <> 'TRANSACTIONAL_IDENTITY' and topic_key is not null)
  )
);

comment on table public.email_events is
  'The canonical catalogue of every email Ovalball can send. classification decides whether a topic preference applies at all: TRANSACTIONAL_IDENTITY goes to someone with no account (no preference can exist), MANDATORY_OPERATIONAL ignores the preference by policy, OPTIONAL_OPERATIONAL honours it. recipient_kind names the server-side resolver -- the dispatcher never accepts a caller-supplied address.';

comment on column public.email_events.recipient_kind is
  'Which server-side resolver produces the recipient address for this event. This column exists so that "who receives this" is a property of the EVENT, decided once, rather than an argument a caller can pass.';

-- ---------------------------------------------------------------------
-- 2. The delivery ledger
-- ---------------------------------------------------------------------
create table if not exists public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_key text not null references public.email_events(event_key) on update cascade,

  -- The canonical dedupe boundary: one logical event occurrence sends once,
  -- however many times a webhook retries, a transaction replays or a page
  -- refreshes. Built from the event plus the entity it concerns (and, where
  -- amendments are legitimate, a version) -- never from a timestamp, which
  -- would make every retry unique and defeat the point.
  idempotency_key text not null unique,

  recipient_kind text not null,
  /** The canonical record the address was resolved FROM, not an address the caller chose. */
  recipient_ref uuid,
  /** Stored so an operator can answer "who should have received this". Bodies are not stored. */
  recipient_email text not null,
  club_id uuid references public.clubs(id) on delete set null,

  status text not null default 'queued' check (status in (
    'queued', 'sending', 'sent', 'failed', 'suppressed'
  )),
  /** Why a send was deliberately not attempted (preference off, no provider, dev). */
  suppression_reason text,

  provider text,
  provider_message_id text,
  error_code text,
  error_message text,
  attempts int not null default 0,

  subject text not null,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz,

  constraint email_deliveries_suppressed_has_reason check (
    status <> 'suppressed' or suppression_reason is not null
  ),
  constraint email_deliveries_sent_has_time check (
    status <> 'sent' or sent_at is not null
  )
);

comment on table public.email_deliveries is
  'One row per logical email event occurrence. A domain event succeeding is NOT proof an email was delivered -- this ledger is where that question is actually answered. Subject is stored for operator triage; message BODIES deliberately are not, because structured event data plus the template is sufficient to reconstruct what was sent without retaining recipient content indefinitely.';

comment on column public.email_deliveries.idempotency_key is
  'One logical occurrence sends once. A webhook retry, transaction replay or page refresh reuses this key and is rejected by the unique index rather than sending again. A legitimate later amendment is a DIFFERENT occurrence and carries its own key -- suppression must never swallow a genuine second event.';

create index if not exists email_deliveries_status_idx on public.email_deliveries (status, queued_at desc);
create index if not exists email_deliveries_event_idx on public.email_deliveries (event_key, queued_at desc);
create index if not exists email_deliveries_club_idx on public.email_deliveries (club_id, queued_at desc);

-- ---------------------------------------------------------------------
-- 3. Authorization
-- ---------------------------------------------------------------------
alter table public.email_events enable row level security;
alter table public.email_deliveries enable row level security;

-- The catalogue is reference data: any authenticated user may read it (the
-- preferences UI needs to know which topics can actually email). Nobody
-- writes it from the app -- it changes by migration.
create policy email_events_select on public.email_events
  for select to authenticated using (true);

-- The ledger names real people's addresses, so it is Site Admin only.
-- Gated on internal.is_site_admin() alone, which is exactly the boundary
-- /admin/system-health itself uses (requireActiveSiteAdmin, no extra
-- capability). An earlier draft of this migration invented
-- 'site.system.view'; no such capability exists, so has_capability() would
-- have returned false for everyone and made the ledger permanently
-- unreadable -- a lockout that looks identical to "no emails were sent".
create policy email_deliveries_select on public.email_deliveries
  for select to authenticated
  using (internal.is_site_admin());

revoke all on public.email_deliveries from anon;
revoke all on public.email_events from anon;

-- Writes happen through the SECURITY DEFINER function below, never directly:
-- a client that could INSERT here could forge a delivery record.
revoke insert, update, delete on public.email_deliveries from authenticated;
revoke insert, update, delete on public.email_events from authenticated;

-- ---------------------------------------------------------------------
-- 4. Recording a delivery
-- ---------------------------------------------------------------------
-- Claims the idempotency key and returns the new row id, or NULL if this
-- occurrence has already been recorded. The caller sends only when it gets
-- an id back, which is what makes retry-safety structural rather than a
-- convention every call site has to remember.
create or replace function public.claim_email_delivery(
  p_event_key text,
  p_idempotency_key text,
  p_recipient_kind text,
  p_recipient_ref uuid default null,
  p_recipient_email text default null,
  p_club_id uuid default null,
  p_subject text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Email delivery may only be claimed by an authenticated session.' using errcode = '42501';
  end if;

  insert into public.email_deliveries (
    event_key, idempotency_key, recipient_kind, recipient_ref,
    recipient_email, club_id, subject
  )
  values (
    p_event_key, p_idempotency_key, p_recipient_kind, p_recipient_ref,
    p_recipient_email, p_club_id, p_subject
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.claim_email_delivery(text, text, text, uuid, text, uuid, text) from public, anon;
grant execute on function public.claim_email_delivery(text, text, text, uuid, text, uuid, text) to authenticated;

create or replace function public.record_email_delivery_result(
  p_delivery_id uuid,
  p_status text,
  p_provider text default null,
  p_provider_message_id text default null,
  p_error_code text default null,
  p_error_message text default null,
  p_suppression_reason text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Email delivery results may only be recorded by an authenticated session.' using errcode = '42501';
  end if;

  update public.email_deliveries
  set status = p_status,
      provider = coalesce(p_provider, provider),
      provider_message_id = coalesce(p_provider_message_id, provider_message_id),
      error_code = p_error_code,
      error_message = p_error_message,
      suppression_reason = p_suppression_reason,
      attempts = attempts + case when p_status in ('sent', 'failed') then 1 else 0 end,
      sent_at = case when p_status = 'sent' then now() else sent_at end,
      failed_at = case when p_status = 'failed' then now() else failed_at end
  where id = p_delivery_id;
end;
$$;

revoke execute on function public.record_email_delivery_result(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.record_email_delivery_result(uuid, text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. System Health
-- ---------------------------------------------------------------------
-- Deliberately reports "configured?" separately from "failing?". A local
-- machine with no provider on purpose is NOT an outage, and rendering it as
-- one trains operators to ignore the panel.
create or replace function public.email_delivery_health()
returns table (
  sent_24h int,
  failed_24h int,
  queued_backlog int,
  suppressed_24h int,
  last_failure_at timestamptz,
  last_failure_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not internal.is_site_admin() then
    raise exception 'Not authorized to read email delivery health.' using errcode = '42501';
  end if;

  select count(*) filter (where d.status = 'sent' and d.queued_at > now() - interval '24 hours'),
         count(*) filter (where d.status = 'failed' and d.queued_at > now() - interval '24 hours'),
         -- Backlog is anything still unresolved, however old: an item stuck
         -- in 'sending' for a week is exactly what an operator needs to see.
         count(*) filter (where d.status in ('queued', 'sending')),
         count(*) filter (where d.status = 'suppressed' and d.queued_at > now() - interval '24 hours')
  into sent_24h, failed_24h, queued_backlog, suppressed_24h
  from public.email_deliveries d;

  select d.failed_at, coalesce(d.error_message, d.error_code)
  into last_failure_at, last_failure_reason
  from public.email_deliveries d
  where d.status = 'failed'
  order by d.failed_at desc nulls last
  limit 1;

  return next;
end;
$$;

revoke execute on function public.email_delivery_health() from public, anon;
grant execute on function public.email_delivery_health() to authenticated;

comment on function public.email_delivery_health is
  'Email subsystem signals for System Health. Reports delivery outcomes only; whether a provider is CONFIGURED is an environment fact the application layer reports, because a local machine with no provider is a deliberate state and must never render as a production outage.';

-- ---------------------------------------------------------------------
-- 6. Seed the catalogue -- only events that real workflows already raise
-- ---------------------------------------------------------------------
insert into public.email_events (event_key, topic_key, classification, recipient_kind, description) values
  -- Identity / invitations: the recipient has no Ovalball account yet, so no
  -- preference can exist and no topic applies.
  ('club_invitation', null, 'TRANSACTIONAL_IDENTITY', 'club_invitation',
   'Someone has been invited to join a club on Ovalball.'),
  ('guardian_invitation', null, 'TRANSACTIONAL_IDENTITY', 'guardian_invitation',
   'A parent/guardian has been invited to link to a player.'),
  ('player_account_invitation', null, 'TRANSACTIONAL_IDENTITY', 'player_account_invitation',
   'A player has been invited to create their own Ovalball login.'),
  ('safeguarding_officer_invitation', null, 'TRANSACTIONAL_IDENTITY', 'safeguarding_officer',
   'A club has invited someone to be its Safeguarding Officer.'),
  ('site_admin_invitation', null, 'TRANSACTIONAL_IDENTITY', 'site_admin_invitation',
   'Someone has been invited to become an Ovalball Site Administrator.'),
  ('partner_club_invitation', null, 'TRANSACTIONAL_IDENTITY', 'partner_invitation',
   'A club has invited another club to join Ovalball. This is the referral invitation.'),

  -- Safeguarding fallback. Operational and mandatory: a safeguarding message
  -- must never be gated on a marketing-style preference, and the recipient
  -- has no account to hold one anyway.
  ('safeguarding_officer_message', null, 'TRANSACTIONAL_IDENTITY', 'safeguarding_officer',
   'A message to a Safeguarding Officer who has no active Ovalball account, sent to the club''s own recorded contact.'),

  -- Topic-scoped operational mail.
  ('club_claim_submitted', 'access_invitations', 'MANDATORY_OPERATIONAL', 'site_admin_inbox',
   'A club claim needs Site Admin review.'),
  ('support_ticket_reply', 'support_moderation', 'MANDATORY_OPERATIONAL', 'support_ticket',
   'A reply to a support request raised from the public site, where the requester has no account to read it in.'),
  ('referral_reward_earned', 'platform_billing', 'MANDATORY_OPERATIONAL', 'club_billing_contact',
   'A referred club paid its first subscription, so the referring club earned a free month.')
on conflict (event_key) do nothing;

-- Topics that now genuinely have an email implementation behind them.
-- Everything else stays false, which remains the honest answer.
update public.notification_topics
set email_ready = true
where key in ('access_invitations', 'support_moderation', 'platform_billing');
