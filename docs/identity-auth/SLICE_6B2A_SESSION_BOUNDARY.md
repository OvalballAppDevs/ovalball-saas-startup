# Slice 6b.2a — the session boundary, and the challenge on signup

**Stage 1 of 4 of Slice 6b.2** (D-S6B-AUTO-11). Delivers **S6-9**, the D-S6B-AUTO-10 suspension
proofs, and **SO-7**. `auth_flow_states` (SO-4), the `ovalballSignupPayload` retirement (H-7) and
transport security (S6-17) are **NOT STARTED**.

**Status: READY FOR RELEASE REVIEW — not released.** Banked in two commits: `b1f5c26` (the boundary)
and a completion commit closing the route-handler gap the first pass left knowingly open.

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


---

# Completion pass — closing the knowingly-partial S6-9

`b1f5c26` reported S6-9 as **PARTIALLY CLOSED: route handlers classified but not all gated.** This
pass closes that, and does the evidence work the review asked for. The full boundary inventory is in
`SLICE_6B2A_D2_BOUNDARY_INVENTORY.md`; this records what changed and what it cost.

## Newly gated

| Surface | Was | Is |
|---|---|---|
| `api/gocardless/oauth/start` | `getUser()` — identity only | `requireSession` — identity, liveness, account state, assurance |
| `api/gocardless/oauth/callback` | `getUser()` — identity only | `requireSession` |

Both are GET endpoints anybody can navigate to directly, so "the layout checked" was never available
to them. A revoked session's access token stays valid until it expires and a suspended
administrator's session row may still exist; neither should be able to start or complete a
payment-provider connection.

## Two more raw-database-error leaks, found by the guard written for the first one

The `cancelRecovery` finding in `b1f5c26` turned out to be an instance, not an incident. A permanent
guard written to stop it recurring immediately found two more on the same class of surface:

- **`api/gocardless/oauth/callback`** rethrew a Postgres exception and the catch interpolated it into
  a **URL query parameter** — publishing internal function and column names to the address bar,
  browser history and any referrer.
- **`account/security/actions.ts`** returned `error.message` from `sign_out_my_other_devices`.

Both are logged server-side and normalised now. The second needed care rather than a blanket rule:
that RPC's `42501` is its own deliberate, actionable refusal ("Enter a code from your authenticator
first"), and GoTrue's password refusals ("Password should be at least 12 characters") name nothing
internal and are exactly what a person must read. So the guard does not ban `error.message`; it
requires the safe cases to be **declared** — a `PROVIDER_MESSAGE` comment, or an explicit `42501`
branch — and refuses everything else.

## Suspension, through a genuinely fresh authentication

`b1f5c26` said "reauthentication-while-suspended useless". That was measured by a browser that had
just been signed out, which is a weaker claim than it sounds. Suite **66** performs a real password
grant against GoTrue from no cookies at all, and separates the two questions:

| | SUSPENDED | DISABLED | ACTIVE control |
|---|---|---|---|
| **Provider** issues a token for correct credentials | **yes** | **yes** | yes |
| Ovalball allows any capability | **0 of 56** | **0 of 56** | 0 (no grant) |
| …and the stated reason is | **ACCOUNT_INACTIVE** on every key carrying a reason | **ACCOUNT_INACTIVE** | **not** ACCOUNT_INACTIVE — simply no grant |
| Session-gated table read | — | — | succeeds |

**GoTrue authenticating a password is not Ovalball granting authority**, and the `reason_code` is what
proves which of the two happened. The ACTIVE control refuses for a *different* stated reason, which is
what makes the suspended result mean something.

Also proven directly, without navigation: a **revoked** session's still-valid token reads nothing
(`session_live()`, not the JWT signature, decides), and a protected route handler invoked with no
session at all redirects rather than acting.

## The three refusal families, told apart

§10 forbids "it threw something" as a security assertion, so suite 66 shows each family with a
different observable:

- **SESSION** — `session_live()` false, or account not usable → no rows, `ACCOUNT_INACTIVE`
- **AAL** — live and usable, second factor missing → *"Enter a code from your authenticator first."*
- **CAPABILITY** — live, usable, assured, not allowed → *"You are not authorised to do that."*

## Mutation campaign — 10 mutants, 0 survivors

`scripts/slice6b2a-mutation-campaign.sh`. It found two real gaps in the first run, and both were
closed rather than argued away:

- **M4 survived.** Making `allowAalElevation` globally true was noticed by nothing, because the only
  permanent test was structural — it asserts which *files* may pass the option, which is a different
  question from whether the flag is *honoured*. Fixed by extracting the pure decision into
  `lib/auth/session-decision.ts` and testing the table exhaustively (13 assertions); D13 is the
  assertion that now goes red.
- **The harness itself was wrong twice.** `gate_js` anchored on `'^. fail 0$'`, and node prints a
  multibyte `ℹ` — the pattern never matched, so *every* mutant would have looked killed. A false
  green is worse than a survivor. And M3's mutant named the parameter `p_user` when it is `p_user_id`,
  so `CREATE OR REPLACE` errored and the mutant was never live: a survivor that was never alive.

**A mistake worth recording:** the campaign's first cleanup step was `git checkout -- app lib`. It
looked safe because the script had only just edited those files, but `git checkout` restores to
**HEAD** — and it silently discarded every uncommitted change made earlier in the same session,
including the route-handler gating above. Nothing warned; it surfaced only because a passing suite
suddenly reported three failures. The work was redone, and the campaign now snapshots each file it
touches into a temp directory and restores from there, finishing by proving every file is
byte-identical to its snapshot. Database functions are captured with `pg_get_functiondef` rather than
by re-running a migration, because a migration is a script with guards and side effects, not a
definition.

## Races

6b.2a adds no new mutable state, so there is no new race to invent — and inventing one would be the
fake-evidence the review warns against. What it *does* do is make a request's authority depend on two
rows an administrator can change underneath it, so those are the races that exist:

- **suspension racing an in-flight request** — SB-15/15b: a later statement in the same transaction
  already sees the new state, so a request cannot finish under authority it lost mid-flight;
- **revocation racing an in-flight request** — SB-16/16b: the next check sees the session gone, so
  sign-out-everywhere takes effect on the next request rather than at token expiry;
- **an AAL refresh racing a sensitive operation** — SB-17: `recent_aal2` is computed per call from
  `auth.mfa_amr_claims`, so there is nothing cached and no window to race. Recorded rather than
  dramatised.

## Completion evidence

Every number below is the suite's own count, taken from the wired runner rather than a standalone
invocation, so nothing here depends on an environment the runner does not reproduce.

| Gate | b1f5c26 | After completion |
|---|---|---|
| `supabase/tests/session_boundary.sql` | 13 / 13 | **25 / 25** — SB-01…SB-17, adding boundary shape, session-≠-capability and the three races |
| `supabase/tests/js/session_boundary_coverage.test.mts` | 6 / 6 | **10 / 10** — adds the two route-handler lists, the no-bare-`getUser` rule and the declared-exception raw-error guard |
| `supabase/tests/js/session_decision.test.mts` | — | **13 / 13** (new) — the decision table; D13 is the assertion M4 escaped |
| `supabase/tests/js/turnstile_challenge_state.test.mts` | 19 / 19 | 19 / 19 |
| `scripts/browser-verification/65-session-boundary-and-signup-challenge.mjs` | 18 / 18 | 18 / 18 |
| `scripts/browser-verification/66-direct-invocation-boundary.mjs` | — | **19 / 19** (new, wired) — fresh authentication, no Playwright |
| `scripts/browser-verification/63-turnstile-login-recovery.mjs` | 12 / 12 | 12 / 12 |
| `scripts/slice6b2a-mutation-campaign.sh` | — | **10 killed, 0 survivors**; all 7 touched files restored byte-identically |

Every permanent test above is in the runner: the two SQL and JS suites through `SUITES` / the JS glob,
and suite 66 through `BROWSER_SUITES`. Nothing security-critical runs only by hand.

## Reconciliation after the completion pass

| Row | State | Why not more |
|---|---|---|
| **S6-9** | **PARTIALLY CLOSED** — every protected *route handler* and the Slice-6 protected Server Actions now carry the boundary | **15 SECURITY DEFINER RPCs** still authorise on `auth.uid()` alone and bypass RLS. Closing them needs a migration, which §13 says to stop and explain rather than create. Named in full in the boundary inventory. |
| **S6-8** | **PARTIALLY CLOSED** — the enforcement half is now proven through a genuinely fresh authentication, not a replayed cookie | `/account/suspended` stays unreachable by the owner's decision (D-S6B-AUTO-10) |
| **SO-7** | **CODE + STATE-MACHINE VERIFIED** | No OAuth provider is enabled anywhere, so no browser can exercise it. Deliberately not claimed end-to-end. |

## The full runner number, and the one caveat on how it was obtained

**4869 assertions passed, 0 failed, across 232 suites** on the current disk.

It was not produced by a single process, and saying otherwise would be the kind of tidy claim this
review exists to catch. `scripts/run-platform-tests.sh` reached **230 suites / 4832 assertions / 0
failures** — every SQL suite, every JS suite, and browser suites 63 (12) and 64 (34) — and was then
killed by the machine's low-memory guard part-way through suite 65. That happened twice, at a
different point each time, and in neither case did a test fail: the Playwright half is simply the
heaviest thing this machine runs. Suites **65 (18/18)** and **66 (19/19)** were therefore run
standalone, immediately afterwards, in the same shell environment against the same disk.

An earlier complete single-process run of the same tree reported **4868 passed, 1 failed** — the one
failure being the redirect-loop guard still reading `require-session.ts` after `sessionRefusal` moved
to `session-decision.ts`. 4832 + 18 + 19 = 4869 = 4868 + 1, which is the arithmetic that says the fix
added nothing and removed one failure.

---

# S6-9, closed

The completion pass left S6-9 partially closed and named what remained: browser-callable SECURITY
DEFINER functions that mutate state and bypass RLS. A narrow contract migration was authorised for
exactly that, and the full record is in `SLICE_6B2A_DEFINER_RPC_SESSION_CONTRACT.md`.

Two things changed in the accounting.

**The set was 26, not 15.** The earlier figure came from a single direct-body regex and undercounted.
Re-derived from first principles as a fixpoint over the call graph, eleven more appeared — including
`redeem_my_recovery_code`, which can strip every MFA factor from an account, and
`accept_site_admin_invitation`. Reporting fifteen and closing fifteen would have left those open while
the ledger said the work was done.

**Twenty-five are gated; one is a declared public exception.** `submit_public_support_ticket` is the
anon-callable contact form, and gating it would refuse the people it exists for.

| Closure criterion | Count |
|---|---|
| Protected route handlers without a direct session boundary | **0** |
| Protected Slice-6 Server Actions without the required direct boundary | **0** |
| Browser-callable SECURITY DEFINER mutation paths bypassing canonical session/account-state enforcement | **0** (one declared public exception, named and tested) |

**S6-9: CLOSED.**

## S6-8, classified against the original requirement

The original requirement has two halves. The **enforcement** half — suspended or disabled means no
usable Ovalball session or authority — is now proven at every layer: the proxy terminates the session,
`requireSession` refuses at layer 2, the RESTRICTIVE policy refuses 209 tables, and as of this
migration the definer RPCs refuse too, through a genuinely fresh authentication rather than a replayed
cookie. That half is **met**.

The **presentation** half — that `/account/suspended` is where a suspended person lands — is not, and
will not be. The owner's decision (D-S6B-AUTO-10) is that the fail-closed model stands: the session is
ended rather than carried in a degraded state, so nothing routes to that page. That is a superseded
presentation assumption in the Phase 2 text, not a hole in the authority boundary, and it is recorded
as such rather than either pretended closed or left looking like an open security gap.

**S6-8: enforcement CLOSED; the `/account/suspended` destination remains intentionally unreachable.**

## SO-7, unchanged

**CODE + STATE-MACHINE VERIFIED. REAL PROVIDER UAT PENDING THE SOCIAL-PROVIDER UNIT.** No OAuth
provider is configured locally or enabled in production, and none was configured for this work.

---

# The defect the S6-9 review found next door

Reviewing the contract migration surfaced an **authorisation** defect in one of the functions it had
just touched: `record_email_delivery_result` let any live authenticated caller rewrite any
`email_deliveries` row whose id they knew. That is not a session-liveness defect — a revoked or
suspended caller was already refused by `20270501000000` — and it is deliberately **not** absorbed into
S6-9. It is recorded as its own defect, with its own migration
(`20270502000000_a_delivery_result_belongs_to_its_claimant.sql`) and its own unit record,
`SLICE_6B2A_EMAIL_DELIVERY_RESULT_AUTHORITY.md`.

It was reproduced before it was fixed: on a production-shaped database at ledger 521, a stranger wrote
`sent/forged` onto somebody else's delivery. It is closed by binding the result to the claim the
architecture already had — `email_deliveries.initiated_by`, which `claim_test_email_send` has always
written — rather than by inventing a role.

| Closure question | Answer |
|---|---|
| Browser-callable SECURITY DEFINER mutation paths bypassing canonical session/account-state enforcement | **0** (one declared public-by-design path) |
| Browser callers able to mutate an email delivery outside their legitimate authority | **0** |

A third finding, the `internal` schema grant surface, is recorded for a later unit in
`SLICE_6B2A_INTERNAL_SCHEMA_PERIMETER.md` with a cheap regression guard
(`supabase/tests/js/api_schema_perimeter.test.mts`) and **no production configuration change**.
