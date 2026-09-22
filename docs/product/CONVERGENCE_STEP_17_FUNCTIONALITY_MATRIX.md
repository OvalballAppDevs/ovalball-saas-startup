# Convergence Step 17 — functionality accounting

**FUNCTIONS BEFORE 34 · FUNCTIONS AFTER 36 · FUNCTIONALITY LOST 0.**

Slice 10 is **legacy retirement**. It owns no new authentication feature and adds no user-facing
surface, and §31 of the authorisation says not to expand the step to grow this number. The two
additions are platform properties, not product features.

## Before — 34

Step 16's thirty-four, in `CONVERGENCE_STEP_16_FUNCTIONALITY_MATRIX.md`, unchanged.

## After — 36

| # | function | how |
|---|---|---|
| 35 | **The compatibility estate is measured, and cannot grow.** 12 retirement targets, 458 references, counted across the database, the application and CI — the first clause of Slice 10's own acceptance, enforced as a ratchet | `scripts/verify-slice10-retirement.mjs` + `supabase/security/slice10-retirement-baseline.json`, wired into the gate |
| 36 | **No browser role can reach invitation secret material at all** — not a legacy plaintext token, and not the canonical hash | column grants on `invitations`, `club_ovalball_invitations`, `access_invitations` |

## Functionality lost: zero, checked item by item

| could have been lost | proof it was not |
|---|---|
| Issuing, previewing, redeeming, resending and revoking a canonical invitation | `invitation_authority_matrix` **71/71**, `invitation_joining_closure` **23/23**, `invitation_team_list` **39/39**, `invite_only_onboarding` **7/7**; `step17` **F1–F2**; browser **A1–A3** |
| Every legacy redemption bridge (`accept_invitation`, `get_invitation_preview`, and the four others) | `step17` **D1** — asserted by name, one assertion each |
| All seven legacy invitation tables, and the `team_permissions` view | `step17` **D2**, **D3** |
| The partner-club referral journey, which reads `club_ovalball_invitations` | `step17` **C1**; browser **B**, **E1**, **E3** — the columns it uses still read, at HTTP 200 |
| The Site Admin user and invitation surfaces, which read `access_invitations` | browser **A1**, **A3** |
| The printed invitation code hint | `step17` guard asserts `code_hint` survives; browser **D** reads it at HTTP 200 |
| The live pending legacy guardian invitation — a real person's link | `step17` **E1**; migration guard; browser cleanup assertion. **Never written, only read** |
| The club-scoped INSERT/UPDATE rules on the legacy table | `step17` **B4** — the policies are retained and merely unreachable |
| Suspension, revocation, MFA, sessions, recovery, impersonation | untouched: Step 17 changed no function in any of them |
| The capability engine, the organisation-scope refusal, Step 16's governing context | `step17` **G1–G5** |
| `team_permissions`, `has_capability`, `account_status`, `admin_role` and the rest | nothing dropped; the ratchet's 458 references are unchanged from before this step |

## Three things changed rather than added

1. **A guard stopped asserting something untrue.**
   `verify-legacy-invitation-token-readers.mjs` said *"nothing reads a plaintext legacy token … THE LIST
   IS NOW EMPTY"* while `send_replacement_guardian_invitation` handed one out. Its database regex looked
   for `returning … token`, and that function does `returning * into v_row` then returns `v_row.token` in
   a separate statement. The check now also reads what a function **gives back**, and the survivor is a
   named shrink-list entry with a reason and an owner.
2. **The legacy estate stopped being reachable from a browser.** Three grants narrowed; nothing dropped.
3. **The canonical table stopped publishing its hash material** — found by this step's own suite while
   asserting the claim in (2).

## What was deliberately NOT done, and why it is a decision

| candidate | why not |
|---|---|
| Drop any compatibility column, view or helper | **every one still has references** — 61 database functions read `club_memberships.role`, 62 call the `has_capability` adapter, 22 read `team_permissions`. Slice 10's acceptance is zero references |
| Drop `invite_player_account` (zero application callers, mints a plaintext token) | `parent_add_child_regression` exercises it. A permanent suite is a CI reference, and a drop that removes coverage of a journey whose redemption half is still live is not a retirement |
| Drop `role_capability_defaults` (zero database readers) | seven permanent suites reference it |
| Convert `send_replacement_guardian_invitation` to the canonical issuer | `link_guardian_to_existing_player` and `create_player_for_guardian` both take a **legacy invitation id**, and the canonical `GUARDIAN` redemption links nobody. Re-pointing would break the replacement-guardian journey — that is family-architecture work, not retirement |
| Hash `guardian_invitations.token` at rest | it would touch six functions in the family journey, and the one live row is a real person's pending invitation. Phase 2 O.5's tested policy is that a live invitation keeps its token |
| Remove the magic-link path (T7) | T7's gate is *"zero magic-link sessions for 30 days"*, and nothing is deployed. §21 says not to redesign auth for the stale harness |
| Implement the `organisation` capability scope | Slice 10 does not own it (Step 16, H13.1) |
