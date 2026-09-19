# Identity/Auth closure ledger

Authoritative sequence for finishing the Identity/Auth programme. Derived from
`IDENTITY_AUTH_PROGRAMME_RECONCILIATION.md` (commit `cea1167`), which remains the gap register.

**Rule.** Every reconciliation row keeps its **original owner** and gains a **closure owner**. A row
never moves between units silently; if a row's closure owner changes, the change is recorded here with
a reason. Nothing is "absorbed" into a later slice to make a unit look complete.

---

## Sequence

| Unit | Scope | Status | Prerequisite |
|---|---|---|---|
| **STAGE 0** | Production TOTP availability, then enrolment by the existing legitimate administrator | **CLOSED LOCALLY** — the AAL2 boundary is proved end to end against a real factor (`71-recent-aal2-authority`, `72-totp-enrolment-journey`, banked `7885fc6`). Production enrolment itself remains an owner action | — |
| **SLICE 6b** | Close missed/regressed Slice 6 authentication requirements | Largely delivered across Convergence Steps 3–5; **L11 (a deep link is dropped at sign-in) is still open and is 6b's** | Stage 0 |
| **SLICE 7e** | Close missed/partial Slice 7 Users & Access product requirements | **DELIVERED, NOT RELEASED** — see `SLICE_7E_IMPLEMENTATION_REPORT.md` and `SLICE_7E_RELEASE_PLAN.md`. S7-5, S7-6, S7-7 and S7-8's UI half are closed in code and proved locally | Stage 0 |
| **TEST / PERIMETER CLOSURE** | Wire and run the security estate; close AO C6/C10/C12 and the unwired-suite drift | **AO C12 / S1-15 closed by Convergence Step 5** (`service_role_usage.test.mts`). C6, C10 and the unwired-suite drift are still open | — (may run in parallel) |
| **AN-3 / T1+** | Second Full Site Admin, break-glass rehearsal, then enforcement stages | Not started | Stage 0, then each stage's own gate |
| **SLICE 8** | Club People & Access, as originally designed | Not started | The four units above |

---

## STAGE 0 — production TOTP availability

**Objective.** Restore the designed path by which the existing Full Site Admin can hold a recent TOTP,
so the 22 privileged RPCs that require one become usable. Not a weakening of any requirement.

**Phase 2 basis.** AG.2 **T0** is *"Password + TOTP + recovery codes available to everyone … account
Security page live … no enforcement"*. AN-3's Blocks column reads *"Slice 6 **T1+**, Slice 7c"*, and
L16 says AN-3 *"blocks **enforcement**"*. TOTP **availability** is T0; AN-3 gates T1 onward. No
contradiction, and no code change is required.

| Step | Owner | Status |
|---|---|---|
| 0.1 Enable TOTP enrol/verify in production Auth settings (+ max factors 3) | **Platform owner, Supabase dashboard** | **BLOCKED — OWNER ACTION** |
| 0.2 Existing Full Site Admin enrols through `/account/security` or `/security/enrol` | Platform owner | Pending 0.1 |
| 0.3 Read-only verification that the factor exists, is verified, and enforcement is still off | Claude, follow-up run | Pending 0.2 |

**Explicitly out of scope for Stage 0:** AN-3 bootstrap, the pending Site Admin invitation, any T1+
enforcement, password configuration, social providers, and every Slice 6b/7e/test-closure row.

---

## SLICE 6b — authentication closure

Closes reconciliation rows whose original owner is **Slice 6** and which have **no documentary basis
for deferment** (§Q items 16–19 plus the regressed rows).

| Reconciliation row | Original owner | Closure owner | Item |
|---|---|---|---|
| S6-3 | Slice 6 | 6b | Real `minimum_password_length`; the config key in use is not a GoTrue key |
| S6-5 | Slice 6 | 6b | The validator on every password surface, not one |
| S6-6 | Slice 6 | 6b | `/forgot-password` — currently a live 404 linked from `/login` |
| S6-7 | Slice 6 | 6b | `/account/setup` |
| S6-8 | Slice 6 | 6b | `/account/suspended` |
| S6-9 | Slice 6 | 6b | `requireSession` wired into the `(app)` layout, server actions and route handlers |
| S6-12 | Slice 6 | 6b | Recovery-code attempt limits — no wired coverage |
| S6-13 | Slice 6 | 6b | Minor guardian-assisted recovery age gate — no wired coverage |
| S6-16 | Slice 6 | 6b | Account → Security: Linked Sign-In Methods |
| S6-17 | Slice 6 | 6b | Security headers, CSP, cookie `secure` — never evidenced |
| S6-18 | Slice 6 | 6b | **SO-2, SO-3, SO-4, SO-5, SO-6** |
| S6-21 | Slice 6 | 6b | AN-12 — a FULL Site Admin must hold email+password |
| S6-22 | Slice 6 | 6b | Browser 50 (social) and 52 (minor onboarding) |
| S5-6 | **Slice 5** | 6b | `ovalballSignupPayload` removal — closes Phase 1 **H-7**. *Moved with reason:* SO-4 replaces the metadata binding with `auth_flow_states`, so the two are one change |
| S5-7 | **Slice 5** | 6b | `auth_flow_states` has zero callers — same change as SO-4 |

---

## SLICE 7e — Users & Access closure

| Reconciliation row | Original owner | Closure owner | Item |
|---|---|---|---|
| S7-5 | Slice 7a | 7e | AB.1 detail tabs; **17 of 23 master-control RPCs have no UI** — **CLOSED**: thirteen URL-addressed tabs, every RPC given a caller, held permanently by `site_admin_master_control_reachability.test.mts` |
| S7-6 | Slice 7b | 7e | AB.4 Create User wizard — Assignments step — **CLOSED**: three steps, and `p_intended` is finally sent |
| S7-7 | Slice 7a | 7e | `site_search_users` — **CLOSED**: `20270504000000` |
| S7-8 (UI half) | Slice 7c | 7e | Screens to raise and approve a Site Admin grant — **CLOSED**: raised on the person's record, decided on Site Admin Management |

**Four things 7e found on the way, all recorded in `docs/product/CONVERGENCE_LEDGER.md`:**

| | |
|---|---|
| **L13** | A Site Admin could change a player's team placement without being able to read one. Closed with a narrow per-person definer read; the roster RLS policy deliberately left alone |
| **L14** | Seven of the sixteen master-control event types were displayed by no timeline at all. Closed by discriminating on the scope column and adding `site_account_history` |
| **L15** | The perimeter manifest declared consumer files that did not call the function, four of them deleted routes. Slice 7's are true and checked; fourteen remain in a shrink-only baseline for their own slices |
| **L16** | `internal.is_site_admin()` survived the Slice 4/7 retirement inside a view's `WHERE` clause. Closed, and the helper dropped |

---

## TEST / PERIMETER CLOSURE

| Reconciliation row | Original owner | Closure owner | Item |
|---|---|---|---|
| §Q-22 | Slice 1 (runner) | Test closure | 105 unwired SQL suites triaged — wire, delete with a reason, or record superseded. Start with the twelve `gocardless_*_regression` suites guarding Phase 1 P0-4 |
| S1-8 | Slice 1 (AO C6) | Test closure | `function_search_path_mutable` advisor 73 → 0 |
| S1-10 | Slice 1 (AO C10) | Test closure | `pg_trgm` out of `public` |
| S1-15 | Slice 1 (AO C12) | **CLOSED by Convergence Step 5** | Service-role usage guard — `supabase/tests/js/service_role_usage.test.mts`, a named allow-list of the two modules holding the key and the seven call sites importing the factory |
| S1-17, S1-18 | Slice 1 | Test closure | Person-name null-safety script; browser `40a-public-surfaces-anon` |
| S3-7 | Slice 3 | Test closure | Permanent performance gate (K.5) |
| §P | all | Test closure | Sweep the 161 wired suites for vacuous positive controls |

---

## AN-3 / T1+ — owner operations

Each stage keeps its own AG.2 gate. Nothing here starts until Stage 0 is closed.

| Stage | Gate |
|---|---|
| T1 — bootstrap second Full Site Admin | `SITE_ADMIN_BOOTSTRAP.md`; two distinct people hold FULL |
| T2 — both enrolled, break-glass rehearsed | Rehearsal evidence recorded |
| T3 — PRIVILEGED enforcement | 24 h denial monitoring, expected users only |
| T4 / T5 | Grace then enforce, with monitoring |
| T6 — magic-link retirement | 14 days clear after T5 |
| T7 — Slice 10 | Zero magic-link sessions for 30 days |

**The pending `full` Site Admin invitation (expires 21 Sep 2026) is untouched and remains a T1
decision**, per `SITE_ADMIN_BOOTSTRAP.md` §"The pending invitation".

---

## SLICE 8 and beyond

Slice 8 (Club People & Access), Slice 9 (Impersonation) and Slice 10 (Legacy retirement) proceed as
originally designed in AK. Reconciliation rows already owned by them — Volunteer presets (V-3),
Effective Access editing, club audit timeline, Team Admin string retirement, legacy invitation
tables, the `has_capability` adapter — stay with them and are **not** pulled forward.
