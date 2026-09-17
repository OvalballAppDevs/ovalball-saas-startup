# Slice 5 — progress record

**Status: IN PROGRESS. Not released. Production is unchanged at ledger 474, tip `20270381000000`.**

This file exists so the work survives a session or tool interruption. It is the resume point.

## Done, verified locally, committed

| | Commit |
|---|---|
| **D-S5-1 age eligibility** — predicate, write-boundary gates, grandfathering, 32-assertion matrix, 6 mutants 0 survivors | `819830a` |
| **Canonical invitation core** — schema, Vault-peppered secrets, issue/preview/redeem/revoke/resend/expiry, 49-assertion matrix, perimeter registration | `e2ede9f` |

Platform battery at the time of writing: **4493 passed, 0 failed across 211 suites.** `tsc` clean.

### What the invitation core actually provides

`access_invitations` with a SHA-256 link token and an HMAC-SHA256 human code under a Vault pepper;
both plaintexts returned once and never stored; `invitations_admin_view` that cannot select either
hash. Redemption implements O.2: rate limits before lookup, `FOR UPDATE`, expiry persisted before
refusal, email binding against the session's own confirmed address, scope revalidation, the
**issuer's** authority re-checked at redemption, role ceiling, canonical transitions only, single-use
and multi-use idempotency, and events. A team code yields a join request and never access. The
safeguarding path calls 4G's `enter_safeguarding_nomination` — no second state machine.

Three autonomous decisions are in `IDENTITY_AUTH_DECISION_RECORD.md` as D-S5-AUTO-1..3. AUTO-2 was a
genuine defect: refusals raised, and the raise rolled back the attempt log, so the O.2 rate limits
could never fire and two probe-detection events were never written.

## Not done — the remainder of Slice 5

1. **Legacy retirement (O.5).** The six plaintext-token tables are still live and untouched. Phase 2
   honours their rows until expiry, then nulls plaintext columns for terminal rows. Not started.
2. **Club claims (P, Y.13).** `club_claims` state machine, `club_claim_messages`, `submit_club_claim`,
   `reply_to_claim`, `decide_club_claim`, the state backfill. Not started.
3. **Application layer.** `/join` (link and code) unifying the four existing routes — `/invite`,
   `/invited`, `/guardian-invite`, `/player-invite` — plus invitation emails, People & Access Invite,
   Team Join Codes UI, Claim a Club, Site Admin claims review, onboarding for invitees without
   accounts, the public entry points, and removal of `ovalballSignupPayload`. Not started.
4. **Evidence still owed.** Races R1–R6, R12, R18; mutation testing of the invitation seams; browser
   UAT 43 and 44; accessibility; performance; clean empty-database rebuild; production-shaped
   rehearsal; release-order proof.

## Resume here

The database core is sound and tested, so the next session should start at **legacy retirement and
claims**, then the application layer, then the evidence battery. Nothing in the committed work
depends on the order of the remainder.

## Honest note on the conveyor

The overnight authorisation asks for Slices 5 through 10 in one run. Slice 5 alone is a large slice —
three new tables, ten RPCs, a claims state machine, six legacy mechanisms to retire and roughly nine
user-facing surfaces — and Slices 6 to 10 include authentication, MFA, sessions, Site Admin Users &
Access, Create User, club people and access, impersonation and the full legacy closure.

What is recorded above is what has actually been built and verified. Nothing here is released, and no
later slice has been started. The work is banked in small, independently verified units precisely so
that an interruption costs nothing and the next session can continue without re-deriving anything.
