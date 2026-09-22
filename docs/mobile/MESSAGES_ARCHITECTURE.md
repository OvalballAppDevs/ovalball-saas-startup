# Ovalball Mobile — Messages

What the platform already had, and what the app does with it. Written to build against.

## The canonical model, as found

**Seven containers, one message table.** `public.fixture_messages` holds every message, with exactly
one container column set — enforced by a CHECK constraint:

| container | conversation |
|---|---|
| `fixture_id` | a fixture's thread |
| `fixture_request_id` | an inter-club fixture request |
| `club_conversation_id` | a club-to-club thread (`club_conversations`) |
| `direct_conversation_id` | 1:1 (`direct_conversations`, one ordered-pair row per pair) |
| `team_conversation_id` | a team's own thread (`team_conversations`) |
| `safeguarding_conversation_id` | a safeguarding thread, with its own access rules |
| `announcement_id` | a one-to-many announcement, with a reply mode — not a conversation |

**Readers are RPCs or RLS, always caller-scoped.** `my_direct_conversations`,
`my_unread_message_counts`, `direct_conversation_header`, `my_direct_message_candidates`,
`my_announcements`, `can_view_team_conversation` / `can_send_team_conversation`. There is no readable
table of "who may message whom" — discovery is a **function**, computed per caller.

**Read state** is `mark_direct_conversation_read`, and unread comes from the same notification rows
the web badge counts. **Read is not resolved**: nothing here touches a notification's resolved state.

**Sending** is an ordinary insert into `fixture_messages` with one container column set. RLS decides.
No RPC, no service role — the same insert on both clients.

**Safeguarding and policy** live in `message_policies`, `user_message_blocks`, `club_message_blocks`
and the RLS behind them. `getDirectThread` returns `canSend` plus a single `unavailableReason` that
reads identically for a block in either direction, messaging switched off, and a lapsed relationship —
because the difference is exactly what must not be disclosed.

## What was extracted, and what was not

`lib/` held the right code behind `server-only`, which is a bundling directive rather than a secrecy
one. These moved to `packages/contracts` unchanged, and `lib/` re-exports them, so no web import
changed:

`messenger-view-model` · `messenger-rows` (the one place a conversation becomes a row) ·
`conversations` · `support-conversations` · `support-types` · `messenger-thread` ·
`messenger-thread-types` · `messenger-direct` · `resolve-identities`

**React lives on one side of the line.** No Next.js component and no React Native component crossed;
only readers, types and the view model.

## What the app does

- **Inbox** — `loadInbox` runs `getMessengerRows`, the website's own assembler, so the phone's inbox
  is the browser's inbox. The one product rule that travels with it: a parent or player context does
  not see club-to-club fixture negotiation, applied by the web's own `isFamilyFacingContext`.
- **Conversation** — `getDirectThread` for 1:1; `loadThreadMessages` for fixture, request and club
  threads. Ownership is `ThreadMessage.isOwn`, computed server-side; the app never recomputes it from
  a sender id, because the canonical type carries a note about a club-scoped flag that once coloured a
  colleague's messages as the reader's own.
- **Sending** — the same insert. One undifferentiated failure sentence, matching the web's.
- **Unread** — summed from the same rows the list shows, so the badge and the list cannot disagree.

## Authority

**The client decides nothing.** A conversation id is a destination, never a permission: an id for a
conversation the viewer is not in returns nothing and the screen says so — which is also what a
deleted one does, deliberately. Proved in `supabase/tests/mobile_message_authority.sql` (in the
canonical gate): holding an id reveals no messages, no conversation row and no header; a forged
`sender_user_id` is refused; an outsider cannot rewrite a message; the inbox reader never lists
somebody else's conversation.

**Context is a scope, not a key.** The server is never told which context is selected, so switching
cannot widen what comes back. The app clears the previous context's data before the next read so
nothing stale is shown under a new name.

## Deep links and the push boundary

`resolveIntent` returns `MESSAGES` and `MESSAGE_THREAD{conversationId, conversationKind}`. An intent
arriving while signed out is **held** and delivered after authentication — a tapped message link must
survive signing in. **A message push notification will use this same route**: a notification becomes an
intent, the intent is already handled, and nothing about authority changes when push arrives (M7).

## Deferred, deliberately

Attachments, document shares and contact cards (the reader returns them; no native renderer yet) ·
announcements and Support threads (listed with their unread state, not openable — hiding them would
make the badge disagree with the list) · message reporting and deletion · typing and delivery
receipts · **realtime**: the platform has it, but a subscription that must be torn down on every
context switch is a correctness problem before it is a performance one, so unread refreshes on
app-resume, context change and read.
