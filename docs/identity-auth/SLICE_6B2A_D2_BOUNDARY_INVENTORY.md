# Slice 6b.2a — the D.2 boundary inventory

Every server entry point the original D.2 / S6-9 contract covers, with what enforces what. Measured,
not assumed: the counts come from the running database and from the files on disk.

---

## The architecture, stated once

Phase 2 D.2 names three layers and assigns them different jobs. The completion work rests on which
layer owns which question, so it is worth being exact:

| | IDENTITY | SESSION LIVENESS | ACCOUNT STATE | AAL | CAPABILITY |
|---|---|---|---|---|---|
| **1. Database** (authoritative) | `auth.uid()` | **yes** | **yes** | **yes** | **yes — sole owner** |
| **2. Server** (`requireSession` / `guardAction`) | verified `getUser()` | yes | yes | yes | **never** |
| **3. Proxy** (`proxy.ts`) | `getUser()` | — | yes (terminates) | — | — |

Layer 1 is not a claim, it is a measurement:

- **209 of 231** RLS-enabled public tables carry the RESTRICTIVE `session_ok_required` policy.
- **206** of those use `session_ok()` — liveness **and** account state.
- **3** use `session_live_only()` — liveness only: `profiles`, `account_security_state`,
  `mfa_enforcement_policy`. They must be weaker, because the session layer reads
  `profiles.account_status` on every request *in order to decide* somebody is suspended. Gate that
  read on not being suspended and nothing can ever see the state it exists to enforce.
- **22** tables carry no RESTRICTIVE policy. Of those, **21** grant no write to a browser role at all
  — they are definer-RPC-only, so their authority lives in the RPC. The twenty-second is
  `invitations`, whose own policies resolve through `internal.capability_decision`.
- `internal.capability_decision` — which `can()`, `has_site_capability()` and `club_ids_with()` all
  funnel through — refuses a session that is not live (`session_live()`) and an account that is not
  usable (`ACCOUNT_INACTIVE`). **Every capability-gated path therefore inherits both checks without
  repeating them.**

`session_boundary.sql` SB-11…SB-14 pins all of this, so the day a table is added without the gate, or
the account-state branch is removed from the resolver, a permanent test goes red.

---

## Route handlers — all eight, classified

| Surface | Class | Before | After | Account state | AAL | Capability |
|---|---|---|---|---|---|---|
| `api/gocardless/oauth/start` | **AUTHENTICATED** | `getUser()` only | **`requireSession`** | now yes | inherited | `hasCapability('finance.gocardless.connect')` — DB |
| `api/gocardless/oauth/callback` | **AUTHENTICATED** | `getUser()` only | **`requireSession`** | now yes | inherited | RPC `store_gocardless_connection` — DB |
| `auth/callback` | **PRE-SESSION** | none | none, justified | n/a | n/a | n/a |
| `api/gocardless/webhooks` | **PUBLIC / SIGNED** | HMAC | HMAC | n/a | n/a | n/a |
| `api/platform-billing/webhooks` | **PUBLIC / SIGNED** | HMAC | HMAC | n/a | n/a | n/a |
| `email-assets/[asset]` | **PUBLIC BY DESIGN** | none | none, justified | n/a | n/a | n/a |
| `email-assets/club-crest/[clubId]` | **PUBLIC BY DESIGN** | none | none, justified | n/a | n/a | n/a |
| `email-assets/directory-crest/[id]` | **PUBLIC BY DESIGN** | none | none, justified | n/a | n/a | n/a |

**The exceptions are a declared list, not a pattern.** `session_boundary_coverage.test.mts` fails if a
new `route.ts` appears that is neither in the protected list nor in the justified pre-session list, so
the next handler cannot hide inside a generic escape hatch.

Justifications, in full: `auth/callback` is the endpoint that *creates* the session, so requiring one
would be circular; the two webhook endpoints are authenticated by HMAC signature from the payment
provider, with no browser and no session in the picture; the three `email-assets` routes are fetched
by mail clients that send no cookies and serve brand images only.

---

## Server Actions — 467, and why 14 + 6 is the right number rather than 467

**The inventory:** 126 files carry `"use server"`, exporting **467** async functions. After this
completion, **20** carry the boundary directly.

Adding `guardAction` to the other 447 was considered and rejected, for three reasons that are not
convenience:

1. **It would duplicate database authority**, which §2 forbids and Phase 2 assigns explicitly to
   layer 1. Every one of those actions reaches the database, and the database refuses a dead session
   and an unusable account before it answers anything — measured above, not assumed.
2. **On the public surfaces it would be an outage.** Sign-in, signup, OAuth start and the reset
   request are reached by people with no session at all. A guard asserts they stay ungated.
3. **It would make the count the goal.** §2 says the target is "every protected server entry point has
   the correct direct session boundary", not "requireSession is imported everywhere".

**What was gated, and why those:** the Slice-6 auth surfaces, where a direct POST is most likely and
where the refusal a person meets matters most — Account → Security (5), Account (5), security enrol
(2), security verify (1), authenticated signup completion (1), recovery cancellation (1), plus the two
route handlers and the `(app)` layout.

### The residual gap, stated plainly

There are **15** SECURITY DEFINER RPCs callable by `authenticated` that reference no `internal.*` gate
at all and authorise on `auth.uid()` alone. A definer function bypasses RLS, so for these fifteen the
layer-1 argument above does **not** hold: a revoked session's access token stays cryptographically
valid until it expires, and nothing in these fifteen checks `session_live()`.

They are: `accept_guardian_invitation`, `add_support_followup`, `block_user`,
`claim_disabled_email_suppression`, `claim_email_delivery`, `exit_diagnostic_club`,
`mark_announcement_read`, `mark_direct_conversation_read`, `record_billing_request`,
`record_email_delivery_result`, `set_notification_preference`, `soft_delete_own_message`,
`touch_last_active`, `unblock_user`, `withdraw_player_club_join_request`.

**Assessed severity: low, and bounded.** Every one is self-scoped — it writes the caller's own row —
and the single one that touches another person's authority, `accept_guardian_invitation`, is bounded
by a pending invitation token *and* an exact email match, so holding a stale token grants nothing that
holding the invitation did not already grant. None of them creates, escalates or transfers club, team,
site or family authority.

**This is not closed, and closing it needs a migration** — fifteen `CREATE OR REPLACE`s adding the
session check. §13 of the authorisation says to stop and explain rather than create one, so that is
what this does. It is recorded here as the precise remaining scope of S6-9 rather than quietly
absorbed into "partially closed".
