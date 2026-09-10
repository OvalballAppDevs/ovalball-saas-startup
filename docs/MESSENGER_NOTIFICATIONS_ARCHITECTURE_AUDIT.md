# Messenger + Notifications — architecture audit

**This is an audit, not a build.** This SP4 slice's own first instruction
was "audit first — do not rebuild blindly," and the audit found that
Messenger and Notifications already exist as mature, committed **Main
Project** functionality — not a gap SP4 needs to fill. Per the standing
rule that governs every phase of this SP4 work, nothing in this pass
touches a Main Project file. Where the audit found a genuine gap that
would require one, it is listed under **Proposed changes**, below,
awaiting explicit approval — none of them have been applied.

## Message/conversation architecture

There is no generic "conversations" or "messages" table. Instead, **one
canonical message table**, `fixture_messages`, scoped by exactly one of
five mutually-exclusive foreign keys (enforced by a check constraint,
`num_nonnulls(...) = 1`):

| Scope column | Meaning |
|---|---|
| `fixture_id` | A specific fixture's own conversation |
| `fixture_request_id` | A fixture request still being negotiated |
| `club_conversation_id` | A club-to-club (partner club) conversation |
| `team_conversation_id` | A team-wide conversation |
| `safeguarding_conversation_id` | A requester ↔ Safeguarding Officer conversation |

Every row carries a server-generated `id` (uuid PK), `sender_user_id`,
`created_at`, `body`, and (where a real conversation exists)
`conversation_id` — genuine stable identity throughout, never
client-issued. `club_conversations` is itself a first-class **message
request** primitive: `status` is `pending | accepted | declined`, with a
unique-active-pair index preventing duplicate simultaneous requests
between the same two clubs. This already **is** section 15's "Message
Requests" concept — a club conversation starts `pending`, and
`fixture_messages_insert_scoped`'s own RLS policy refuses composing into
one until it is `accepted`.

Report/moderation fields live directly on `fixture_messages`:
`reported_at`, `reported_by`, `report_reason`, `report_status` (`open |
reviewed | resolved`), `reviewed_at`, `reviewed_by`, `deleted_at`,
`deleted_by`, `deleted_by_role` (`sender | moderator | team_admin`).
`club_message_blocks` provides per-club user blocking (`enforce_message_block`
trigger refuses an insert from a blocked sender). `message_policies` is a
per-club, Site-Admin-overridable attachment/sharing policy (max size,
allowed file types, per-club override toggles) — attachments, document
sharing and contact cards are **already built** (`fixture_message_attachments`,
`fixture_message_document_refs`, `fixture_message_contact_cards`), not
absent as the task's own section 25 anticipated might be the case.

Full Site Admin moderation exists at `/admin/messages` — a conversation
table, content viewer, policy panel, support panel and CSV export, already
built.

## RLS / authority — and the critical safeguarding finding

Access to every conversation type is gated by a `security definer` SQL
function, never client state:

- `internal.can_access_fixture_conversation(fixture_id, fixture_request_id)`
  — true for a **team official** (`can_manage_team`) of either side, or a
  **club official** (`can_manage_club_fixtures`) of either club.
- `internal.can_access_any_conversation(...)` — the same, plus club
  conversations (club officials of either side) and Site Admin.
- `internal.can_send_safeguarding_conversation` / `can_view_...` — the
  officer's own side always may reply; the requester's side must hold the
  `club.safeguarding.message` capability.

**Every one of these predicates is staff/official-scoped.** There is no
predicate anywhere in this system that grants a Player or Guardian login,
as such, access to compose or receive a direct message. Concretely, for
the exact matrix this task's section 19 asked for:

| Relationship | Current capability |
|---|---|
| staff ↔ staff (own club) | Yes — team conversation, fixture conversation |
| staff ↔ staff (partner club) | Yes — club conversation (message request) |
| staff → Player (direct) | **No such capability exists** |
| Player → staff (direct) | **No such capability exists** |
| Player → Player | **No such capability exists** |
| Guardian → staff (direct, general) | **No such capability exists** as a general channel |
| staff → Guardian (direct) | **No such capability exists** |
| anyone → Safeguarding Officer | Only via `club_safeguarding_officer_conversations`, and only for a requester who holds `club.safeguarding.message` (a staff-level capability) |

Read plainly: **Ovalball's Messenger today is institutional (club/team
official ↔ club/team official) messaging only.** A Player or Guardian
account cannot send or receive a direct message to/from anyone through
any existing conversation type — the system was built this way
deliberately (every predicate uses the same staff-authority functions
`can_manage_team`/`can_manage_club_fixtures` the rest of the fixture
domain already uses), not by omission. This is the single most important
finding of this audit: it means most of section 19's specific scenarios
(staff → Player, Player → staff, Player ↔ Player, general Guardian ↔
staff) are currently **moot**, because none of those pairings can reach
Messenger at all yet, in either direction. If Ovalball ever wants to allow
any of them, that is a new, explicit product and safeguarding decision —
not something to infer from what already exists.

## Notification architecture

One table, `public.notifications`: server-generated uuid `id`, `user_id`,
`type` (free text, see below), `title`, `body`, `data` (jsonb — carries
stable entity ids like `fixture_id`/`message_id`, never a raw URL),
`read_at`, `created_at`. RLS: `user_id = auth.uid()` on both select and
update — a forged read of another user's notifications is structurally
impossible. An `enforce_notification_read_only_update` trigger means a
client can only ever flip `read_at`, nothing else.

**Read/unread is already single-source-of-truth**: `read_at IS NULL` is
the one fact "unread" means. The existing Messages popover's own unread
count (`lib/app-context/conversations.ts`) is computed by counting unread
`new_fixture_message` notifications per conversation — it does not
maintain a second counter.

**Channel policy already exists**, and already matches the architectural
lesson this task asks SP4 to carry forward: `internal.should_deliver_notification(user_id, type, channel default 'in_app')`
checks, in order: (1) an unregistered type always delivers, (2) a
mandatory topic always delivers, (3) an `in_app`-channel check against
`notification_preferences`, else refused. A `notifications_gate_delivery`
trigger calls this before every insert. The function already takes a
`channel` parameter distinct from `'in_app'` — the seam for a future
`'push'` channel already exists in this one function's signature, not
something SP4 needs to invent.

`notification_topics` already has an `email_ready` boolean column
alongside `mandatory` — a topic-level flag distinguishing which topics
expose an email toggle. Its exact relationship to the transactional email
pipeline SP4 built in earlier phases (which sent real `match_cancelled`
email under the `fixture_updates` topic despite that topic's
`email_ready = false`) was not fully reconciled in this pass and is
flagged as a genuine open question for Main Project — not guessed at
further here.

## Notification event catalogue (42 registered types)

| Type key | Topic | Classification |
|---|---|---|
| `calendar_share_approved`/`declined` | calendar_training_updates | WIRED |
| `club_claim_approved`/`submitted` | access_invitations | WIRED |
| `club_invitation_accepted` | access_invitations | WIRED |
| `club_message_request_declined`/`received` | messages | WIRED |
| `fixture_attendance_reminder` | fixture_updates | WIRED |
| `fixture_cancelled_team_folded` | fixture_updates | WIRED (narrow: team-folded cancellation only) |
| `fixture_kickoff_change_proposed`/`changed` | fixture_updates | WIRED |
| `fixture_pitch_changed` | fixture_updates | WIRED |
| `fixture_request_accepted`/`declined`/`received` | fixture_requests | WIRED |
| `fixture_result_*` (4 types) | fixture_updates | WIRED |
| `fixture_staff_message`, `new_fixture_message` | messages | WIRED |
| `partner_request_received` | fixture_requests | WIRED |
| `platform_referral_reward_earned`, `platform_trial_*` | platform_billing | WIRED |
| `site_admin_*_access_changed` (7 types) | account_security | WIRED |
| `team_created_from_fixture_request` | fixture_requests | WIRED |
| `tournament_*` (5 types) | fixture_requests / fixture_updates | WIRED |
| `training_plan_cancelled`, `training_session_cancelled`/`updated` | calendar_training_updates | WIRED |

**Genuine gap found: `fixture_cancelled` (plain, general cancellation) is
MISSING from `notification_types`, but is used in code.**
`public.cancel_fixture()` calls `internal.fixture_result_notify(...,
'fixture_cancelled', ...)`, and `notifications.type` carries no foreign
key to `notification_types` — so the insert silently succeeds (4 real
rows exist in this local database today), but because the type is
unregistered, `should_deliver_notification`'s first branch treats it as
"always deliver" — it can never be preference-gated, never appears
correctly grouped in a future Personal Settings notification list, and is
invisible to any query that joins through the catalogue. This is the
identical class of bug as the `club_welcome`-missing-from-`email_events`
drift SP4's own Phase 4 found and fixed — same shape, different table.
**Proposed fix, listed below.**

**MISSING entirely (no notification type of any kind)**: Club Events
(created/changed/cancelled), Training created (only updated/cancelled
exist), Event/attendance response reminders for Club Events, generic
Training reminder (only `fixture_attendance_reminder` exists for
fixtures). These mirror gaps already disclosed in SP4's own Dynamic Data
Catalogue pass — Club Events has no email event either, for the same
underlying reason (the domain isn't wired to any notification channel
yet).

**No DUPLICATED or UNUSED entries were found** in the 42 registered
types against their real call sites, beyond the single unregistered
`fixture_cancelled` gap above.

## Email ↔ notification cross-check

| Email event (SP4 catalogue) | In-app notification exists? | Same entity? | Recipient policy aligned? |
|---|---|---|---|
| `club_invitation` | No dedicated type (invitee has no account yet — in-app notification requires a session to receive it, matching this codebase's own TRANSACTIONAL_IDENTITY reasoning) | n/a | n/a |
| `guardian_invitation` | Same as above | n/a | n/a |
| `player_account_invitation` | Same as above | n/a | n/a |
| `safeguarding_officer_invitation` | Same as above | n/a | n/a |
| `safeguarding_officer_message` | Same as above (recipient has no active account, by definition) | n/a | n/a |
| `site_admin_invitation` | Same as above | n/a | n/a |
| `partner_club_invitation` | Same as above | n/a | n/a |
| `club_claim_submitted` | `club_claim_submitted` (WIRED) | Yes | Yes |
| `club_welcome` | `club_claim_approved` (WIRED, same underlying approval event) | Yes | Yes |
| `support_ticket_reply` | No in-app equivalent found | — | Genuine gap: a public support requester has no account to receive an in-app notification in, but this uses `notification_preferences`-topic `support_moderation` — worth Main Project's own review of whether an in-app copy is meaningful for an authenticated requester |
| `referral_reward_earned` | `platform_referral_reward_earned` (WIRED) — **but the email itself is unwired** (Phase 1-4 finding, unchanged) | Yes | Yes |
| `match_cancelled` (SP4-added) | `fixture_cancelled` exists in practice but is **unregistered** (see gap above) | Yes (`fixture_id`) | Cannot be confirmed aligned — unregistered type bypasses preference gating entirely, so its "recipient policy" is unconditional delivery, which may or may not match `match_cancelled` email's own `fixture_updates`/OPTIONAL_OPERATIONAL policy |

**Future push eligibility**: every WIRED notification type is push-eligible
in principle, because `should_deliver_notification`'s `channel` parameter
already generalizes past `'in_app'` — no code change is needed to the
notification *creation* path to add a `'push'` channel later, only a
future device-installation model (documented below) and a future
`notification_deliveries`-style per-channel status record, neither of
which exist today.

## Email OFF / In-App ON — architectural proof

Verified by direct inspection, not assumption: no migration file both
creates/modifies `public.notifications` rows and references
`email_events`/`email_deliveries`/`email_event_active` (confirmed by
`scripts/verify-messenger-notifications-architecture.mjs`, which fails
loudly if this ever becomes untrue). `internal.notify_fixture_message_recipients`,
`internal.fixture_result_notify`, and every other notification-creating
trigger insert directly into `public.notifications` with no dependency on
email state at all. **Disabling `match_cancelled`'s email channel
(`email_events.active = false`) therefore cannot suppress the
`fixture_cancelled` in-app notification** — they are structurally
unconnected code paths triggered independently from the same
`cancel_fixture()` domain function. This was proven at the DB level for
this exact scenario in the previous SP4 phase (Email Delivery Policy),
and the architecture confirmed here shows no coupling exists that would
break it.

## Push / device-installation — future model, not built

No `device_installation`/`push_token`/`installation` table exists
anywhere in the schema (confirmed by direct query). The documented future
model, consuming the *same* canonical `notifications` row via a new
per-channel delivery-status side table (not a second notification store):

```
notification (existing, canonical)
  → notification_channel_delivery (future)
      channel: 'push'
      device_installation_id → device_installations(id)
      status: pending | sent | failed
      attempted_at

device_installations (future)
  id
  user_id
  platform: 'ios' | 'android' | 'web'
  push_token
  enabled
  created_at
  last_seen_at
  invalidated_at
```

Multiple devices per user by construction (one row per installation, not
one token column on `profiles`). Not implemented this pass, per the
explicit "do NOT build native push provider delivery yet" instruction —
documented so a future slice has a concrete starting shape rather than a
blank page.

## Realtime

`fixture-presence.tsx` is the one confirmed Realtime consumer found in
this audit (presence — who is currently viewing a conversation). A
`broadcast_fixture_message` trigger exists on `fixture_messages` (fires
after insert), suggesting message delivery itself may also use Realtime
broadcast, though this pass did not trace its channel-scoping in full
depth — noted as a gap in audit completeness below, not a finding of a
problem.

## What this audit did not exhaustively cover

Given the scope of this task, the following were assessed at the level of
"the relevant table/trigger/component exists and its RLS predicate looks
correct on inspection," not line-by-line, live-browser-proven the way
earlier SP4 phases proved the email pipeline:

- The full moderation Site Admin panel's own UX (content-viewer, CSV
  export, policy-panel) — confirmed to exist, not walked through live.
- `broadcast_fixture_message`'s exact Realtime channel scoping.
- Message attachment storage/privacy details beyond confirming the tables
  and a per-club `message_policies` size/type limit exist.
- The exact New Message / Partner Club picker UX flow (confirmed the
  underlying `club_conversations` data model supports it; did not
  walk the actual `new-message-form.tsx` UI live).
- Mobile/390px live verification of the existing Messenger UI (it is Main
  Project code; SP4 did not modify or re-verify it).

## Proposed changes (Main Project) — awaiting your approval

Nothing below has been applied. Each is small, precisely scoped, and
listed with its exact blast radius.

1. **Register `fixture_cancelled` in `notification_types`.** One `insert
   into notification_types (type_key, topic_key) values ('fixture_cancelled',
   'fixture_updates')` (matching the topic the SP4 email already uses for
   the same event). Closes the catalogue-drift gap above; makes the
   notification finally subject to the same preference gating every other
   `fixture_updates` type already has. Zero behavioural change to
   anything currently working — it only starts respecting a preference
   that currently cannot be set for this specific type.
2. **Nothing else is proposed.** The literal "message bubbles must be
   blue (mine) / green (received)" requirement (task sections 7, 49)
   conflicts with the existing, deliberately-reasoned design (bubble
   colour is **club**-scoped, not person-scoped — a documented decision in
   `conversation-thread.tsx`'s own comment, reflecting that Ovalball's
   Messenger is institutional, not a private 1:1 chat). Changing this
   would be a real product-philosophy reversal, not a bug fix, and is
   deliberately not proposed here — it needs your explicit decision, not
   mine.
