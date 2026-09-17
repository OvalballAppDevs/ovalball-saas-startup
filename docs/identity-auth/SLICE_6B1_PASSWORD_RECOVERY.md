# Slice 6b.1 — password recovery and account destinations

**Unit:** the first closure unit of Slice 6b, per `SLICE_6B_CLOSURE_MANIFEST.md`.
**Rows this unit addresses:** S6-2, S6-5, S6-6, S6-7 and the **code half only** of S6-3 are built and
locally verified. **S6-8 is NOT closed** — the route exists but nothing reaches it, for the reason set
out under D.2 below.
**Status:** **BANKED — VERIFIED LOCALLY ON A CLEAN BOOT — NOT RELEASED.** The emergency hotfix
authority covered `cd18ba6` alone and does not extend to this unit, so nothing here is in production
and no reconciliation row has changed status.

---

## Why this unit came first

The reconciliation recorded S6-6 as **REGRESSED**: `/forgot-password` was linked from the Sign In
page and served a production 404. S6-7 and S6-8 were recorded as **MISSED** for the same reason —
`/account/setup` and `/account/suspended` were named by Phase 2 D.2, referenced by `requireSession`,
and did not exist.

Taken together that meant the platform's **only** Full Site Admin had no in-product way back into
their own account. One forgotten password and Ovalball would have had no administrator at all, with
AN-3 unresolved and no second administrator able to help. The unit is also the safest to do first:
every route it adds is additive, no existing behaviour changes, and it needs nothing from an external
console.

---

## What was built

| Artefact | What it is |
|---|---|
| `app/forgot-password/` | Ask for a reset link. Turnstile-gated. Answers identically for every well-formed address. |
| `app/account/reset-password/` | Where a recovery link lands. Validates server-side, revokes other sessions, records the event, then sends the person to `/security/verify` or `/dashboard`. |
| `app/account/setup/` | The D.2 setup-restricted destination. |
| `app/account/suspended/` | The D.2 suspended destination. |
| `lib/auth/password-policy-shared.ts` | The two numbers a browser may know (12 characters, 72 bytes), so the rule can be **shown** while remaining **enforced** only on the server. |
| `supabase/migrations/20270430000000_…` | `public.record_password_reset_requested(text)`, and `PASSWORD_RESET` added to `record_security_change`'s vocabulary. |
| `supabase/config.toml` | `minimum_password_length = 12`. |

---

## The three things worth arguing about

**1. An anon-executable SECURITY DEFINER function.** Phase 2 G requires a
`password.reset_requested` event, and that event happens *before any session exists*. Nothing
anon-callable could write one. The alternative was the service role on a public request, which Slice 6
deliberately removed from exactly this path (`96d65ae`); putting it back to buy one audit line would
undo a security decision to satisfy a logging one. The RPC is therefore as narrow as it can be: it
takes an email, returns void whether or not the address matches, raises nothing, and writes only to
`security_events`, which no browser role can read. It is declared in the perimeter manifest with that
reasoning, and the migration itself refuses to install if `anon` can read `security_events`.

**2. `password_min_length` was never a Supabase key.** `config.toml` carried
`password_min_length = 12` next to `minimum_password_length = 6`. The first does not exist; the second
is the one the CLI reads. GoTrue was therefore receiving **6**, and the direct Auth API would accept a
six-character password regardless of what Ovalball's own validator said. The dead key is left in place
as a commented gravestone rather than deleted, so that nobody adds it back believing it does
something. **This is the code half of S6-3 only** — the production project's setting lives in the
Supabase dashboard and belongs to 6b.5. Neither half is claimed on the other's evidence.

**3. The completion route is `/account/reset-password`.** Phase 2 names `/forgot-password` for the
request and never names where the link lands. It is placed beside the other `/account` destinations
D.2 does name, rather than under `/security`, which is the enrolment and verification family
(D-S6B-AUTO-6).

---

## What this unit does NOT close

- **S6-3 production half**, S6-4 (breached-password protection at the provider), S6-19 (AN-1
  composition) — all dashboard settings, all 6b.5, all owner action.
- **S6-9 `requireSession`** — 6b.2. This unit builds the destinations that layer will redirect *to*;
  it does not wire the layer. Nothing yet sends a setup-restricted or suspended person to these pages
  automatically, and the pages say so by refusing to hold anybody in a state they are not in.
- **S6-12, S6-13** — recovery hardening, 6b.1b.
- Provider UAT of any kind. No claim is made about Google, Apple or a genuine Cloudflare human
  challenge.

---

## What the verification found, and what was changed because of it

**The reset was not revoking other sessions by its own act.** The first draft called
`public.sign_out_my_other_devices()`. That RPC guards itself with `internal.recent_aal2(10)`, and
somebody completing a recovery is at AAL1 by definition — the TOTP challenge comes *after* the reset,
which is exactly what Phase 2 E describes. So it raised `42501` every time, and because the refusal
arrived as an ignored `error` field on an `rpc()` call, the reset looked like it worked. It was dead
code shaped like a security control.

It did not show up as a failing assertion, and the reason is worth recording: **GoTrue revokes a
user's other sessions itself when the password changes**, so the browser journey saw the sessions
correctly gone. The dead call proved nothing either way, and would have failed silently for exactly
the account that matters — one holding a TOTP factor — the day that provider behaviour changed.

The AAL gate was **not** weakened. The reset now uses GoTrue's own others-scoped sign-out, which is
authorised by holding the session rather than by AAL, and which makes the revocation Ovalball's own
act rather than one it inherits. If that revocation fails, the reset **fails closed**: every session
is ended, including the one doing the resetting, and the person signs in again with the password they
just chose — `/login?reset=1` explains this rather than dumping them on a bare form. `PRJ-08` pins the
reason the obvious-looking RPC cannot be used here, so nobody re-simplifies it back.

**`config.toml` alone was not enough.** The corrected `minimum_password_length` only reaches GoTrue
when the containers are rebuilt. Verified against the running provider after the clean boot, rather
than from the file:

```
GOTRUE_PASSWORD_MIN_LENGTH=12
POST /auth/v1/signup with a 6-character password
  -> 422 weak_password "Password should be at least 12 characters."
POST /auth/v1/signup with a 12-character password  -> a session
```

The **admin** API still accepts a short password, which is correct and worth knowing: admin user
creation is a privileged path that bypasses strength checks, so it is not evidence either way.

**Phase 2 D.2 and the shipped session layer disagree about suspension, and this unit does not
resolve it.** D.2 names `/account/suspended` as a destination, which presumes a suspended person keeps
a session and is shown a page. `lib/supabase/middleware.ts` instead re-reads `profiles.account_status`
on **every** request and, on `suspended`, signs the session out and redirects to
`/login?reason=suspended` — which `/login` already explains in words. The live behaviour is therefore
**stronger** than the design, and the page D.2 names is **not reachable**.

6b.1 builds the route, proves its own guard (an active account is sent on rather than held), asserts
the behaviour the product actually has, and **does not claim S6-8 closed**. Changing the policy would
mean making a suspended session survive, which is a security-relevant loosening and belongs to 6b.2 —
the one unit with high lockout risk — and is the owner's decision. Recorded as **D-S6B-AUTO-10**,
which sets out the three options.

**Three perimeter guards fired on the new RPC, and all three were right to.** `security_perimeter_guard`
P1 (reviewed inventory of anon-executable definer functions), `security_events_no_secrets` V6 (the
event writer must not be reachable through the API) and `public_team_season_identity` T2 (the count of
anon-executable functions). Each was extended by exactly one name with the reasoning written beside
it. None was loosened: the shape of every guard is unchanged.

---

## Production-shaped rehearsal (read-only; nothing was mutated)

Read from the production project before any release is proposed, so the migration's own guards are
known to pass rather than hoped to:

| Precondition | Production reads | Consequence |
|---|---|---|
| Migration ledger | **520 / `20270429000000`** | unchanged from the 6b baseline; `20270430000000` applies on top |
| `password.reset_requested` registered | **yes** | the migration's first guard passes |
| `password.reset_completed` registered | **yes** | `record_security_change`'s new word has somewhere to write |
| `anon` can read `security_events` | **no** | the migration's second guard passes; the RPC cannot become an oracle |
| `record_password_reset_requested` exists | **no** | genuinely new; nothing is being replaced |
| anon-executable `public` functions | **11** | becomes 12, i.e. the 19 the updated T2 counts across `public` + `internal` |
| Verified TOTP factors | **0** | a production reset today has no MFA step, which is T0 and expected |

---

## Permanent tests, and where they run

| Suite | Assertions | Wired into |
|---|---|---|
| `supabase/tests/password_reset_journey.sql` | 12 (PRJ-01…PRJ-08) | `SUITES=()` in `scripts/run-platform-tests.sh` |
| `scripts/browser-verification/64-password-recovery-journey.mjs` | 33 (S6B1-01…S6B1-31) | the runner's browser-journey section |

The browser section is new. Slice 6b's journeys (`63`, `64`) were tooling somebody had to remember to
run; they are now part of `run-platform-tests.sh`. They need a dev server, the mail catcher, a
service-role key and a linked `playwright-core`, and when any of that is missing they are **NOT RUN
and say so loudly** — never silently skipped, never counted as passing, and a suite that records zero
assertions is treated as a failure rather than a clean run. `SKIP_BROWSER_JOURNEYS=1` is an explicit,
announced opt-out (D-S6B-AUTO-9).

**Never printed by either suite:** the recovery link, its token, or any password. The browser suite
reads the link out of the local mail catcher and passes it straight to the browser; its presence is
asserted, its contents never logged.

---

## Verification

**Clean boot is mandatory for this unit** (it carries a migration), and it was done properly: the
local stack was stopped **without a backup** and started from empty, so every one of the 521
migrations ran in order on a database that had never existed before — `20270430000000` last — and the
containers were rebuilt, which is the only way the `config.toml` change reaches GoTrue at all.

| Gate | Result |
|---|---|
| Clean boot from empty | all migrations applied, seeds ran, `20270430000000` installed with its own two guards passing |
| GoTrue after rebuild | `GOTRUE_PASSWORD_MIN_LENGTH=12`; public signup refuses 6 characters and accepts 12 |
| `scripts/run-platform-tests.sh`, SQL + TypeScript only | **4734 passed, 0 failed across 225 suites** |
| `scripts/run-platform-tests.sh`, **including the browser journeys it now runs** | **4780 passed, 0 failed** |
| `supabase/tests/password_reset_journey.sql` | **12 / 12** (PRJ-01…PRJ-08) |
| `scripts/browser-verification/64-password-recovery-journey.mjs` | **34 / 34** (S6B1-01…S6B1-31) |
| `scripts/browser-verification/63-turnstile-login-recovery.mjs` | **12 / 12**, re-run after the runner wiring |
| `tsc --noEmit` | clean |
| `eslint` on every changed file | clean |

Three guards failed on the first pass and were **not** worked around: `security_perimeter_guard` P1,
`security_events_no_secrets` V6 and `public_team_season_identity` T2 each gained exactly one name with
its reasoning written beside it, and their shape is unchanged. One content-standard failure
(`Set A New Password` → `Set a New Password`) was a real Title Case breach and was fixed.

The browser suite also caught two of my own errors before they were banked: an assertion that insisted
on `/dashboard` when `/welcome` is the correct landing for an account with no club, and a suspended-page
assertion that tested behaviour the product deliberately does not have.

### What was NOT verified, stated plainly

- **Nothing in production.** No migration applied, no deploy, no configuration changed. The only
  production access this unit made was **read-only**, to check the migration's preconditions.
- **No provider UAT.** Nothing here exercises Google, Apple, or a genuine Cloudflare human challenge.
  Turnstile runs against Cloudflare's own published always-passes test keys.
- **The breached-password refusal** depends on `api.pwnedpasswords.com` being reachable. It was, and
  S6B1-12 exercised it; on a machine without network the suite records it as NOT EXERCISED rather than
  as a pass.
- **`/account/suspended` is not reachable**, for the reason set out above. S6-8 is not claimed closed.

---

## Release gate — STOP

This unit is **not** authorised for release. The emergency authority granted for the login incident
covered `cd18ba6` alone. 6b.1 carries a **migration** and changes the authentication perimeter, so it
needs its own authorisation.

When it is authorised, the order is fixed and matters: **apply `20270430000000` to production first,
then push `main`**, because the push *is* the deployment — Vercel builds on it, and an application
that calls `record_password_reset_requested` before the function exists would 404 the reset request
rather than the route.

Also still local and still unreleased, and **not** part of this unit: the two programme documentation
commits `cea1167` and `e4d25e7`.

---

## The one question this unit needs answered

**What should a suspended person see?** Phase 2 D.2 says a page at `/account/suspended`. The shipped
session layer ends their session and explains it on `/login`. Both are defensible; they are not the
same product. The three options are set out in **D-S6B-AUTO-10**, and 6b.2 cannot wire `requireSession`
without an answer, because that is the layer that would do the routing.
