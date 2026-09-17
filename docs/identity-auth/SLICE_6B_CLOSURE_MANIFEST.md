# Slice 6b — authentication contract closure manifest

**Authority:** the original Phase 2 Slice 6 contract (AK), sections D, E, F, G, H, X and AG; every
Slice-6-owned row in `IDENTITY_AUTH_PROGRAMME_RECONCILIATION.md`; defects demonstrably caused by
Slice 6; and Phase 1 findings whose recorded closure owner is 6b.

**Baseline verified before any work:** production release `cd18ba6` live; ledger **520 /
`20270429000000`**; Full Site Admin `active / SITE_FULL`, identity INTACT; **0** TOTP factors; **0**
MFA enforcement groups; pending second-admin invitation `pending`, `accepted_by = null`, expires
2026-09-21; protected logos `be2bef0c…` / `bdd32248…` unchanged; local `main` carries the two
still-unpushed programme documentation commits and nothing else.

---

## Closure units and dependency order

Chosen from archaeology, not from the illustrative list. The ordering rule is **lockout risk last**:
additive routes first, then the enforcement layer that could refuse real users, then the surfaces that
depend on external configuration.

| Unit | Scope | Migration | Owner action | Lockout risk | Depends on |
|---|---|---|---|---|---|
| **6b.1 Password recovery and account destinations** | S6-2, S6-5, S6-6, S6-7, S6-8, S6-3 (code half) | **one** — an anon RPC to record `password.reset_requested` | none | **low** — all additive routes | — |
| **6b.1b Recovery hardening** | S6-12, S6-13 | likely (minor age gate) | none | low | 6b.1 |
| **6b.2 Session enforcement layer** | S6-9, S6-17 | none | none | **high** — can refuse real users | 6b.1 (needs `/account/setup`, `/account/suspended` to redirect to) |
| **6b.3 Turnstile, signup flow-state and legacy retirement** | social-signup null token, S5-7 (`auth_flow_states`, SO-4), S5-6 (H-7) | possible | none | medium | 6b.1 |
| **6b.4 Social providers and linked methods** | S6-16, S6-18 (SO-1/2/3/5/6), S6-21 (AN-12), S6-22 | possible | **provider consoles** | medium | 6b.3 (flow state carries onboarding context) |
| **6b.5 External Auth configuration manifest** | S6-3 (config half), S6-4, S6-10, S6-11, S6-19, S6-20 | none | **yes — dashboard** | none | all above |

**S6-14, S6-23, S6-24** stay outside 6b: they are AN-3 / T-stage items and are not 6b's to close.

---

## Requirement rows

| ID | Phase 2 § | Requirement | Status now | Closure artefact | Permanent test | Browser journey | Prod/config evidence | Owner action | Unit |
|---|---|---|---|---|---|---|---|---|---|
| S6-1 | D, E | Email + password sign-in | PRODUCTION VERIFIED | — | `61`, `63` | done | live | no | closed |
| S6-2 | E (L1) | ≥12, uppercase, special, ≤72 bytes | PARTIALLY IMPLEMENTED | validator on every surface | `password_policy` (ext) | recovery + setup | app-side | no | **6b.1** |
| S6-3 | E | GoTrue minimum length 12 **natively** | REGRESSED | correct `minimum_password_length` key | config assertion | — | **dashboard** | **yes** | 6b.1 (code) / **6b.5** (prod) |
| S6-4 | E | Breached-password protection | NOT PRODUCTION CONFIGURED | app HIBP already fails closed | `password_policy` | — | advisor shows disabled | **yes** | **6b.5** |
| S6-5 | E | Validator on **every** password surface | PARTIALLY IMPLEMENTED | reset + setup call it | new suite | recovery journey | — | no | **6b.1** |
| S6-6 | G | `/forgot-password` reset flow | **REGRESSED** (live 404) | the route and its journey | new suite | yes | — | no | **6b.1** |
| S6-7 | D.2 | `/account/setup` setup-restricted landing | **MISSED** (404) | the route | new suite | yes | — | no | **6b.1** |
| S6-8 | D.2 | `/account/suspended` landing | **MISSED** (404) | the route | new suite | yes | — | no | **6b.1** |
| S6-9 | D.2 | `requireSession` on every named surface | **MISSED** (zero callers) | wiring + guard | reach-proving test | yes | — | no | **6b.2** |
| S6-10 | F | TOTP enrol/challenge/≤3/last-factor | NOT PRODUCTION CONFIGURED | code complete | `aal_enforcement` 38 | `61` | **dashboard** | **yes** | **6b.5** |
| S6-11 | G | Recovery codes | NOT PRODUCTION CONFIGURED | code complete | `recovery_codes` 26 | `61` | **dashboard** | **yes** | **6b.5** |
| S6-12 | F | Recovery/MFA attempt limits (5/15 min) | PARTIALLY IMPLEMENTED | functions exist, 1 caller | **no wired suite** | — | — | no | **6b.1b** |
| S6-13 | F, G | Minor guardian-assisted recovery + age gate | PARTIALLY IMPLEMENTED | **no age gate in `request_privileged_recovery`** | new suite | — | — | no | **6b.1b** |
| S6-14 | G | Privileged recovery two-person rule | IMPLEMENTED — NOT ENFORCED | — | schema CHECK | — | AN-3 | **yes** | out of 6b |
| S6-15 | H | Session liveness, revocation, sign-out | PRODUCTION VERIFIED | — | `auth_races` | — | live | no | closed |
| S6-16 | H, X | Account → Security **Linked Sign-In Methods** | PARTIALLY IMPLEMENTED | the panel | new suite | yes | — | no | **6b.4** |
| S6-17 | H | Security headers, CSP, cookie `secure` | PARTIALLY IMPLEMENTED | **none present at all** | header assertions | — | — | no | **6b.2** |
| S6-18 | X | SO-1…SO-7 | **MISSED** (5 of 7) | see 6b.3/6b.4 | per rule | `50` | provider consoles | partly | **6b.3 / 6b.4** |
| S6-19 | AN-1 | Native composition superset | BLOCKED — OWNER | decision + setting | — | — | **dashboard** | **yes** | **6b.5** |
| S6-20 | AN-4 | Plan features verified | BLOCKED — EXTERNAL | read and record | — | — | **dashboard** | **yes** | **6b.5** |
| S6-21 | AN-12 | FULL Site Admin holds email+password | **MISSED** | a check | new suite | — | — | no | **6b.4** |
| S6-22 | AJ.3 | Browser 40, 41, 42, **50**, **52** | PARTIALLY IMPLEMENTED | 50 (social), 52 (minor) | — | yes | — | partly | **6b.3 / 6b.4** |
| S6-23 | AG.2 | T0 deploy, no enforcement | PRODUCTION VERIFIED | — | `aal_enforcement` | — | live | no | closed |
| S6-24 | AK | Acceptance: two FULL enrolled, break-glass, T3 | LEGITIMATELY DEFERRED | — | — | — | AN-3 / T1–T3 | **yes** | out of 6b |
| **S5-6** | AK S5, Ph1 **H-7** | Remove `ovalballSignupPayload` | **MISSED** | retire after SO-4 lands | preplanting test | — | — | no | **6b.3** |
| **S5-7** | X SO-4 | `auth_flow_states` has zero callers | **MISSED** | migrate the journey onto it | flow-state suite | — | — | no | **6b.3** |
| **NEW-1** | X SO-1, Ph1 P | Social **signup** passes `turnstileToken={null}` | **MISSED** (found by the hotfix) | plumb the challenge | Turnstile suite (ext) | signup | — | no | **6b.3** |

---

## Decisions

- **D-S6B-AUTO-1** — units are ordered by **lockout risk**, not by reconciliation order. `requireSession`
  (S6-9) is the one change in 6b that can refuse real users, and it needs `/account/setup` and
  `/account/suspended` to exist as redirect targets, so 6b.1 precedes it.
- **D-S6B-AUTO-2** — S6-3 is split. The **code** half (using the real `minimum_password_length` key in
  `config.toml`) is 6b.1; the **production** half is a dashboard setting and belongs to 6b.5. Neither
  half is claimed production verified on the other's evidence.
- **D-S6B-AUTO-3** — S6-5 cannot close before S6-6 and S6-7, because today there is exactly **one**
  password-setting surface. "The validator on every surface" is only meaningful once the other
  surfaces exist, so all three close together in 6b.1.
- **D-S6B-AUTO-5** — Phase 2 G requires a `password.reset_requested` event, which fires **before any
  session exists**, and nothing anon-callable can write one today. 6b.1 therefore adds one small
  SECURITY DEFINER RPC, declared in the perimeter manifest, that takes an email, emits the event when
  the account exists, and returns void either way so it cannot be used as an existence oracle. Using
  the service role from a public request was rejected: Slice 6 deliberately removed it from this path.
- **D-S6B-AUTO-6** — Phase 2 names `/forgot-password` for the request but never names the completion
  route. It is placed at **`/account/reset-password`**, beside the other `/account` destinations D.2
  does name, rather than invented under `/security`, which is the enrolment/verification family.
- **D-S6B-AUTO-7** — S6-12 and S6-13 move to a separate **6b.1b**. They are recovery *hardening*, not
  routes, and S6-13 needs its own migration; bundling them would make 6b.1 harder to review and
  slower to land while the owner has no recovery route at all.
- **D-S6B-AUTO-8** — the reset does **not** call `public.sign_out_my_other_devices()`, even though its
  name is exactly what Phase 2 E asks for. That RPC requires `internal.recent_aal2(10)`, and somebody
  completing a recovery is at AAL1 by definition; the call raised `42501` every time and the error was
  ignored. The gate is **not** weakened — the reset uses GoTrue's own others-scoped sign-out, which is
  authorised by holding the session rather than by AAL — and `PRJ-08` pins the reason so the
  obvious-looking RPC is not put back. If the revocation fails the reset **fails closed**: every
  session ends, including the one resetting, and the person signs in again.
- **D-S6B-AUTO-9** — the Slice 6b browser journeys (`63`, `64`) are wired into
  `scripts/run-platform-tests.sh` rather than left as tooling somebody remembers to run. They need a
  dev server, the mail catcher, a service-role key and a linked `playwright-core`; when any of that is
  missing they are **NOT RUN and say so loudly**, and are never silently skipped or counted as
  passing. `SKIP_BROWSER_JOURNEYS=1` is an explicit, announced opt-out for an inner-loop run.
- **D-S6B-AUTO-10 — OPEN QUESTION FOR THE OWNER. Phase 2 D.2 and the shipped session layer disagree
  about what a suspended person experiences, and 6b.1 does not resolve it.** D.2 names
  `/account/suspended` as a destination, which presumes the person keeps a session and is shown a page.
  `lib/supabase/middleware.ts` (reached through `proxy.ts`) instead re-reads `profiles.account_status`
  on **every** request and, on `suspended`, signs the session out and redirects to
  `/login?reason=suspended` — which `/login` already explains in words. So the live behaviour is
  **stronger** than the design, and `/account/suspended` is **not reachable**.

  6b.1 does not change that policy. The session layer is 6b.2, the one unit with high lockout risk, and
  making a suspended session survive is a security-relevant loosening that is the owner's decision, not
  an implementation detail. What 6b.1 does is build the route D.2 names, prove its own guard (an active
  account is sent on rather than held — S6B1-28), assert the behaviour the product actually has
  (S6B1-25, -26, -26b, -26c), and **not claim S6-8 closed**. The owner has three options at 6b.2:
  keep the stronger policy and retire the route; route to it and accept a surviving, powerless session;
  or keep both, sending only DISABLED accounts to the harder path.
- **D-S6B-AUTO-4** — S6-14, S6-23 and S6-24 are **not** 6b rows. They are AN-3 and T-stage operations
  and are recorded here only so they cannot be mistaken for omissions.

---

## First unit: 6b.1

**Password recovery and account destinations.** Chosen because it carries the highest live risk — the
platform owner currently has **no in-product password recovery at all**: the login page links to
`/forgot-password`, which is a production 404. One forgotten password and the only Full Site Admin is
locked out, with AN-3 unresolved and no second administrator to help. It is also the safest unit to do
first: every route is additive, nothing existing changes behaviour, and no external configuration is
involved.
