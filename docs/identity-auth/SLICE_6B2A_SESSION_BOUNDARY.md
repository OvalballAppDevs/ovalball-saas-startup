# Slice 6b.2a — the session boundary, and the challenge on signup

**Stage 1 of 4 of Slice 6b.2** (D-S6B-AUTO-11). Delivers **S6-9**, the D-S6B-AUTO-10 suspension
proofs, and **SO-7**. `auth_flow_states` (SO-4), the `ovalballSignupPayload` retirement (H-7) and
transport security (S6-17) are **NOT STARTED**.

**Status: READY FOR RELEASE REVIEW — not released.**

**Baseline reverified before editing:** production `c03e2b8`; ledger **521 / `20270430000000`**; Full
Site Admin `full` / `SITE_FULL`, ACTIVE / COMPLETE; 0 TOTP factors; 0 MFA enforcement groups; 1
pending second-admin invitation; `auth_flow_states` **0 rows**; protected logos unchanged.

---

## What was wrong

`lib/auth/require-session.ts` existed with **zero callers**. Phase 2 D.2 names three enforcement
layers and layer 2 was entirely absent: a protected Server Action invoked directly — and a Server
Action *is* a POST endpoint — met no identity, liveness, account-state or assurance check of its own.
The database refused correctly, so this was **defence-in-depth and honest refusals, not an open
door**; but the refusal a person met was a bare database error, and the enforcement layer the design
specifies was not there.

Separately, the signup wizard carried the **exact shape that locked the platform owner out on 17
September**: two `useState`s for one fact, cleared on the success branch only. And the signup account
step handed the provider buttons a hardcoded `turnstileToken={null}` while leaving them enabled, so
every click was refused by the server's fail-closed check.

## What changed

| Area | Change |
|---|---|
| `app/(app)/layout.tsx` | `getUser()`-or-`/login` replaced by `requireSession`, which also covers liveness, account state and assurance |
| 14 protected Server Actions across 6 files | now pass through `guardAction` |
| `lib/auth/action-boundary.ts` | **new** — the Server Action boundary |
| `lib/auth/require-session.ts` | accepts a request client and returns the verified user (no extra round trip); gains `allowAalElevation` |
| `app/signup/signup-shell.tsx` | one challenge fact from the shared module; spent on **both** branches |
| `app/signup/steps/account-step.tsx` | provider buttons carry the real token and report the spend |
| `app/(app)/account/security/recovery-actions.ts` | gained a boundary it never had, and stopped returning raw Postgres messages to the browser |

### The two traps avoided, and why they are not obvious

**T0 must stay T0.** D.2 literally says `requireSession({ aal: 'aal2' })`. Wired that way onto a
platform with **zero** enrolled factors, every person would be redirected to `/security/verify` for
ever. The implementation reads `enforcement_required` from `my_session_assurance()`, so AAL1 passes
while no group is enforced. `SB-03` asserts it in SQL and `S6B2-02` watches a real person arrive.

**The T1 enrolment loop.** Once a group *is* enforced, `enforcement_required` is true for exactly the
people who have not enrolled — so an unqualified boundary on `/security/enrol` would refuse them at
the only page that could fix it, and send them back to it. `allowAalElevation` stands down the
assurance gate there and nowhere else; a permanent guard fails if any other file uses it
(D-S6B-AUTO-12).

## Evidence

| Gate | Result |
|---|---|
| `supabase/tests/session_boundary.sql` (**new**, wired into `SUITES`) | **13 / 13** — live, revoked, suspended, disabled, no-session, claimed-vs-granted AAL, with positive controls |
| `session_boundary_coverage.test.mts` (**new**) | **6 / 6** — coverage, no capability duplication, no redirect loop, public surfaces still ungated |
| `turnstile_challenge_state.test.mts` (extended) | **19 / 19** (was 15) |
| `65-session-boundary-and-signup-challenge.mjs` (**new**, wired) | see below |
| `63-turnstile-login-recovery.mjs` | **12 / 12** — login unaffected |
| Performance | `my_session_assurance()` **0.141 ms/call** over 200 calls; **zero** extra `getUser()` round trips (the client and verified user are passed through) |

All eight suspension properties from the authorisation are proven in a browser: session terminated,
stale cookie useless, refresh useless, another guarded route useless, reauthentication-while-suspended
useless — each with a positive control showing reinstatement restores access.

## Stated boundaries — what is NOT claimed

- **The social half of SO-7 is not browser-exercised.** No OAuth provider is configured locally, and
  production has **none** enabled (`external` lists `email` only), so the provider buttons do not
  render for anybody. The null-token defect was therefore **latent, not live**, and fixing it now
  means it is correct before any provider is switched on. Its fix is held by structural guards.
- **No provider UAT of any kind.** No Google, Apple or Facebook.
- **Not every one of the 467 Server Actions carries the boundary.** The Slice-6 protected surfaces do.
  Blanket application was explicitly rejected by the authorisation and would, on the public auth
  surfaces, have been an outage rather than a win — sign-in, signup, OAuth start and the reset request
  are reached by people with no session, and a guard asserts they stay ungated.
- **Capability is not re-decided in the application**, by design and by guard.

---

## Reconciliation accounting — BEFORE / AFTER / EVIDENCE / REMAINING BLOCKER

Nothing below is marked closed on the strength of `requireSession` appearing in source. The
authorisation's four anti-inflation rules are applied literally.

| Row | BEFORE | AFTER | EVIDENCE | REMAINING BLOCKER |
|---|---|---|---|---|
| **S6-9** `requireSession` on every boundary | MISSED — exists, **zero callers** | **PARTIALLY CLOSED** | `(app)` layout + 14 protected Server Actions; `session_boundary.sql` 13/13; coverage guard 6/6; `65` 18/18 | Route handlers are classified but not all gated; the wider 467-action surface is deliberately out of scope. **Not claimed closed.** |
| **S6-8** `/account/suspended` + suspension | route exists, nothing routes to it | **PARTIALLY CLOSED** — the *enforcement* half is proven | All eight properties from §2, in a browser, with positive controls | The route itself stays unreachable by design (D-S6B-AUTO-10). Stays **open for 6b.2**'s later stages |
| **NEW-1 / SO-7** social-signup null Turnstile | MISSED — `turnstileToken={null}`, buttons enabled | **CODE CLOSED, NOT BROWSER-EXERCISED** | 4 structural guards; the wizard's one-fact rule; `S6B2-14` | **No OAuth provider is enabled anywhere**, so no browser can exercise it. Honestly **not claimed fully closed** |
| **S6-17** headers, CSP, cookie `secure` | none present at all | **UNCHANGED — NOT STARTED** | — | stage 6b.2d |
| **S5-7 / SO-4** `auth_flow_states` | dead schema, 0 callers, 0 rows | **UNCHANGED — NOT STARTED** | — | stage 6b.2b. Still dead schema, so **not closed** |
| **S5-6 / H-7** `ovalballSignupPayload` | 3 live occurrences | **UNCHANGED — NOT STARTED** | — | stage 6b.2c, which cannot precede 6b.2b. Legacy payload still trusted, so **not closed** |

### Not done in this stage, and not pretended otherwise

The authorisation asks for a 23-scenario attack matrix, five `auth_flow_states` races, a ten-mutant
campaign and a migration with expand/cutover/contract staging. **Those belong to stages 6b.2b–d and
were not run**, because the subsystem they exercise does not exist yet: there is no flow state to
replay, expire, rebind or race. Running a "race suite" against a table with no callers would produce
a green tick that means nothing, which is the outcome §20 exists to prevent.

What this stage *does* carry from that list: the suspension attack scenarios (stale session, revoked
session, suspended identity, reauthentication-while-suspended), the direct-boundary refusals, and
claimed-vs-granted AAL — each with a positive control.

## Required production release ordering

**No migration.** Application-only, so the ordering is simply: review, then deploy. The release must
still be **isolated** the same way 6b.1 was — local `main` remains ahead of production by the two
withheld programme-documentation commits, so a plain `git push` would promote them.
