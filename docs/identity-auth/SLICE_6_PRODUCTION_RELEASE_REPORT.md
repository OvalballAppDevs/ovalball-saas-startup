# Identity/Auth Slice 6 — Production Release Report

**Verdict: IDENTITY/AUTH SLICE 6 — PRODUCTION VERIFIED**

Released 17 September 2026. Commit `53e1575`. Production at **507 migrations**, tip `20270416000000`.

This is **AG.2 step T0**: password, TOTP and recovery codes are available to everyone, the Security
page is live, and **no enforcement is switched on for anybody**. Steps T1–T7 are separately authorised
operations and are listed as deferred at the end.

## What Slice 6 delivers

**The AAL seam stops being a stub.** Slice 3 left `internal.session_aal_ok()` returning `select true`
with a comment saying Slice 6 would replace the body. It is already folded into `session_live()` →
`session_ok()` → `internal.can()` and `has_site_capability()`, which is why Slice 5 could say invitation
redemption *"inherits the AAL2 requirement without being changed here"*. Replacing that one body is how
that promise is kept, and it is why Slice 6 scatters no MFA checks through the application.

**Enforcement is data, not code.** `mfa_enforcement_policy` holds one row per rollout group; every one
ships `null`, meaning not enforced. Enabling a group later is an UPDATE and so is rolling it back —
AG.4's requirement that rollback needs no deploy.

**The database refuses, not just the application.** 209 RESTRICTIVE `session_ok_required` policies
cover every non-public table, so a plain table read is gated even where no capability is consulted.

**Recovery that survives losing a phone.** Ten codes, shown once, stored only as HMACs under their own
Vault pepper. Redeeming one deletes every factor and leaves the session at AAL1: a code is a way back
to the enrolment page, never a way past it.

**Privileged recovery keeps the two-person rule in the schema.** `approved_by <> requested_by` is a
CHECK constraint, not a convention in a function.

## Why nobody was locked out

Production before this release: **four identities, ZERO verified TOTP factors, two of the four with no
password at all, nine live sessions, and exactly ONE Full Site Admin.** A `session_ok` that demanded
AAL2 would have locked every user out of Ovalball, including the only person who could fix it.

Rehearsed at production's own ledger (494, tip `20270403000000`) with that population reproduced —
including the two identities that have no `auth.identities` row, which is production's real shape:

| | |
|---|---|
| Live AAL1 sessions denied after the expand stage | **0 of 9** |
| Rollout groups enforced | **0 of 6** |
| Magic-link login blocked for any group | **0 of 6** |
| Sole Full Site Admin still able to work | **yes** |

The deferred step was rehearsed too, and rolled back. With `PRIVILEGED` enforcement switched on,
**exactly 5 of 9 sessions were denied, and they were exactly the 5 PRIVILEGED sessions** — the
mechanism is precisely targeted. One UPDATE returned it to 0 denied, with no deploy.

## Defects this slice found

| | |
|---|---|
| **The attempt limits counted a column that is always null.** The recovery-code and authenticator limits counted `actor_user_id`, which a trigger sets from `auth.uid()` — and both ran with no session. Every count was zero: **guessing at recovery codes was uncapped.** | Found by the recovery suite |
| **The session gate ran once per row.** 171.3 ms versus 0.4 ms on a 5,000-row read — 0.034 ms/row across 209 tables, on every query. A platform-wide regression introduced by a security control. | Found by measuring, not reading |
| **The security writes borrowed the service role**, which its own comment forbids from an authenticated Server Action, and broke the page outright when the key was absent | Found by the browser suite |
| **`next/image` refuses an SVG data URL**, and Supabase returns the enrolment QR as one, so the page died with an unhandled error — enrolment would have been broken for everyone | Found by the browser suite |
| **The shared UAT harness signed in by clicking a button Slice 6 had just disabled**, which would have broken every existing browser suite | Found by the browser suite |
| **Account security was unreachable for anyone without a club**, so the page people are sent to in order to secure their account was the one page they could not open | Found by the browser suite |
| **A future enforcement date counted as enforcement**, so a scheduled rollout would have taken effect the moment it was announced and the promised grace window would not have existed | Found by a surviving mutant |
| **A suspended account was not refused** by anything in the mutated suites — suspension that waits for a token to expire is not suspension | Found by a surviving mutant |

## Evidence

| | |
|---|---|
| Platform battery (development) | **4,688 passed, 0 failed across 219 suites** |
| Clean boot from empty | **507 migrations** and every declared seed, then **4,619 passed, 0 failed** |
| Production-shaped rehearsal | booted at **494 / `20270403000000`** with production's identity shape, expanded to **507 / `20270416000000`**, **4,619 passed, 0 failed** |
| Mutation campaign | **10 mutants, 0 survivors** (two survived first; both were real gaps, now closed) |
| Races | **R13, R14, R17** — two genuinely concurrent psql sessions, self-cleaning, repeatable |
| Browser UAT | **21/21**, desktop and 320px, with **real TOTP codes** computed from the enrolment secret |
| Accessibility | one `h1`; every control named; the one-time-code field announces itself |
| Performance | `session_aal_ok` **0.010 ms**, `session_ok` **0.048 ms**, `recent_aal2` **0.012 ms**, capability composed with the gate **0.132 ms**; gate cost on 5,000 rows **1.25 ms** after hoisting |
| Perimeter | manifest updated for every new table and RPC, not loosened around them |

## Production verification

**Migrations** — ledger **507**, tip `20270416000000`, all 13 Slice 6 migrations recorded, none
unexpected.

**Nobody locked out** — 0 of 6 groups enforced; 0 live sessions with an unusable account; every
identity has a posture row; magic-link login still permitted for every group. Group distribution:
`PRIVILEGED=1, NONE=3`.

**The AAL seam** — the Slice 3 stub is gone; the decision never reads the JWT `aal` claim; it reads
`auth.sessions.aal`; R is derived from this session's own `totp` amr entry.

**The gate** — 209 RESTRICTIVE policies, every one restrictive, every one hoisted, none on a publicly
readable table, and the setup path keeps the weaker live-session gate so an account can still become
usable.

**Recovery** — no column a code could live in; RLS on with no policies and no grants, so not even the
owner can read their own hashes; its pepper is separate from the invitation pepper; neither pepper is
reachable by a browser role; redeeming never touches the assurance level; the limits count
`subject_user_id`; the two-person rule is a CHECK constraint — and with one Full Site Admin it cannot
be satisfied, which is the designed outcome.

**Perimeter** — no self-service security write takes a user id; the service-role writes are unreachable
from a browser; `anon` reaches none of the new surface.

**Audit** — all 14 new event types registered; a sweep of `security_events` finds no secret-shaped
metadata key anywhere.

**Slice 5 regression boundary** — redemption still goes through `session_ok` and has grown no
authentication mechanism of its own; invitations still store no plaintext; the D-S5-1
`NEEDS_ATTENTION` population is still zero; memberships and role assignments are unchanged.

**Live** — `/`, `/login`, `/join`, `/invited`, `/clubs`, `/public-fixtures` all 200 on both hosts;
`/security/enrol`, `/security/verify`, `/security/recovery` and `/account/security` all redirect a
signed-out visitor to sign in. `/security/enrol` going **404 → 307** is what confirmed the new build
was serving, rather than the push having succeeded.

## NOT OBSERVABLE IN PRODUCTION

| Flow | Why not | Covered by |
|---|---|---|
| Enrolling an authenticator end to end | Would mean manufacturing a production persona, and TOTP is not yet enabled in production auth settings | Browser UAT C1–C7 with real TOTP codes |
| Redeeming a recovery code | Same, and it would consume a real credential | Browser UAT E1–E4; `recovery_codes` (26) |
| A session being refused at AAL1 | No group is enforced, so by design nothing is refused | `aal_enforcement` (38); rehearsal showing exactly 5 of 9 denied when switched on |
| Signing out other devices | Would end a real person's sessions | `my_sessions` verified present; race R13 proves revocation bites |
| Privileged recovery approval | Needs two Full Site Admins, and production has one | Schema CHECK verified live; the refusal is the designed outcome |
| Break-glass | Requires the dashboard owner and a real incident | `docs/security/BREAK_GLASS.md`; rehearsal explicitly **not yet done**, and it gates T3, not this release |

## Deferred — and what gates each

These are **separately authorised operations**, not code. Phase 2 AL.5 keeps auth configuration
changes out of a code push entirely.

1. **Production auth settings (T0 config).** TOTP enrol/verify on, `max_enrolled_factors = 3`,
   `password_min_length = 12`, leaked-password protection, secure password change, CAPTCHA, session
   timebox and inactivity, redirect URLs. Set locally in `supabase/config.toml`; **production is
   unchanged.** Until TOTP is enabled there, `/security/enrol` will refuse — the page exists, the
   database is ready, the auth server is not yet configured. AN-1 also decides whether to set the
   native composition superset.
2. **T1 — a second Full Site Admin** (AN-3). Production has one. Until then a privileged recovery
   genuinely cannot be approved, which is the rule working, not a fault.
3. **T2 — both Full Site Admins enrolled, and break-glass rehearsed** on a disposable clone (L16).
4. **T3 — PRIVILEGED enforcement**, then T4 STAFF, T5 FAMILY/PLAYER/MINOR, each with its own denial
   monitoring.
5. **T6 — magic-link retirement.** Still offered, deliberately: two of four production identities have
   never had a password.
6. **T7 — Slice 10** removes the legacy sign-in code paths.

Everything above is reversible by an UPDATE to `mfa_enforcement_policy`, which is the point of the
design.
