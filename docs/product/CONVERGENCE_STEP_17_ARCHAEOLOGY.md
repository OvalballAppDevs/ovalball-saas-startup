# Convergence Step 17 — Identity/Auth Slice 10 — archaeology

Measured against `1858392`, before any Step 17 migration.

## IDENTITY/AUTH SLICE 10 — CANONICAL CHECKED-IN SCOPE

Verbatim, from `docs/identity-auth/IDENTITY_AUTH_PROGRAMME_RECONCILIATION.md` — the only place the
repository defines it:

> **Slice 10 — Legacy retirement.** Drop compatibility columns and views (`account_status`,
> `club_memberships.role/status/authority_suspended*`, `team_permissions`, `role_capability_defaults`,
> `permission_groups*`, `site_admins` flags and `admin_role`), legacy invitation tables, deprecated
> capability keys, magic-link code paths, the Phase 0 signup binding, legacy helpers. `no_role_literals`
> shrink reaches 0. **Acceptance: zero references in CI; full runner, clean boot and all browser suites
> green; production usage telemetry zero for 30 days before each drop.**

Corroborated by: `SLICE_6_PRODUCTION_RELEASE_REPORT.md` §146 (*"T7 — Slice 10 removes the legacy
sign-in code paths"*), `SLICE_5_*` (*"the adapter surface reaches zero at Slice 10"*),
`SLICE_4_PLAN.md` §87 (*"Dropping compatibility columns/views, legacy helpers themselves — LATER —
Slice 10"*), `SLICE_4_CLOSURE_AUDIT.md` §42, `SLICE_4B_ARCHAEOLOGY.md` §59, and
`IDENTITY_AUTH_CLOSURE_LEDGER.md` §116.

**So Slice 10 is a retirement slice. It owns no new authentication feature.** Every mechanism a person
uses — password, TOTP, recovery codes, sessions, social, invitations, impersonation, recovery,
suspension — was delivered in Slices 1–9 and is not reopened here.

## 1. The finding that shapes the step: no drop is due

Slice 10's own acceptance requires **zero references in CI** before each drop. Measured now:

| drop target | exists | DB function references | TypeScript files | drop due? |
|---|---|---:|---:|---|
| `profiles.account_status` | yes | 2 | 5 | **no** |
| `club_memberships.role` | yes | **61** | — | **no** |
| `club_memberships.status` | yes | (with `.role`) | — | **no** |
| `club_memberships.authority_suspended*` | yes (2 cols) | — | — | **no** |
| `team_permissions` (view) | yes | **23** | 14 | **no** |
| `role_capability_defaults` | yes | 1 | 1 | **no** |
| `permission_groups*` | yes | 1 | 3 | **no** |
| `site_admins.admin_role` | yes | 7 | 6 | **no** |
| `site_admins.manage_*` (9 flags) | yes | 14 | — | **no** |
| `has_capability` adapter | yes | **61** | 7 | **no** |
| Phase 0 signup binding | yes | — | 1 | **no** |
| legacy invitation tables (5) | all yes | — | — | **no** — see §3 |

And two further preconditions cannot be met in this step at all:

- **"full runner, clean boot and all browser suites green"** is precisely the hardening work the sprint
  defers (§1, §30, §36 of the authorisation).
- **"production usage telemetry zero for 30 days before each drop"** cannot begin: nothing is deployed.
  §20 states it directly — `accept_invitation` and `get_invitation_preview` must survive while the
  deployed compatibility bridge needs them, and those are Slice 10 drop targets.

**Conclusion: the drops are blocked by their own stated precondition, not by effort.** Step 17 therefore
does the part of Slice 10 that *is* due — stop the legacy surfaces that are still live, and make "zero
references" a measured ratchet so the drops become mechanical when their gate opens.

## 2. A guard is asserting something untrue

`scripts/verify-legacy-invitation-token-readers.mjs` says, in its own header:

> **THE LIST IS NOW EMPTY.** All of them moved to the canonical issuer, so nothing in the application
> reads a plaintext legacy token any more, and the column grant itself has been revoked.

Its database half looks for a function whose body matches:

```
p.prosrc ~ 'returning[^;]*\ytoken\y'
```

**`public.send_replacement_guardian_invitation` hands out a plaintext legacy token and is not caught**,
because it does not use a `returning … token` clause:

```sql
insert into public.guardian_invitations (…) values (…)
returning * into v_row;            --  `[^;]*` stops at this semicolon

return query select v_row.id, v_row.token;   --  the token leaves here
```

`IDENTITY_AUTH_PROGRAMME_RECONCILIATION.md` §M already flagged this function and
`public.invite_player_account` as *"two legacy paths [that] can still mint new plaintext-token
credentials"*, classified **PARTIALLY IMPLEMENTED**, owner **Slice 10**, *"flagged for the owner's
ruling"*. The guard's regex is why it has looked closed since.

**Fixing the guard is a Step 17 defect fix** (§32): a check that says "none at all" while one path does
is worse than no check.

## 3. The legacy invitation estate, measured now

| table | rows | plaintext token | client grant on `token` | can still ISSUE | notes |
|---|---:|---|---|---|---|
| `access_invitations` | — | **no** (hashed) | none | canonical | the one system |
| `guardian_invitations` | **1** | yes | **none** | **yes** — `send_replacement_guardian_invitation` | the row is a live pending invitation to the product owner's own address |
| `player_account_invitations` | **0** | yes | **none** | **yes** — `invite_player_account`, **which has zero callers** | the app already issues `PLAYER_ACCOUNT` through `issue_invitation` |
| `invitations` | **0** | yes | **INSERT + UPDATE** to `authenticated` | no RPC inserts | a client can write a plaintext token into it |
| `site_admin_invitations` | 0 | yes | none | no | behind the two-admin gate |
| `club_ovalball_invitations` | 1 | yes | **SELECT** to `authenticated` | club-scoped | the last client-**readable** plaintext legacy token |

Three of those have their precondition genuinely met, and are Step 17's work:

1. **`invite_player_account` — zero callers, mints a plaintext token, its table is empty.** Dropping it
   is a real Slice 10 drop, and CLAUDE.md is explicit that a zero-caller helper is still a hazard.
2. **`invitations` client INSERT/UPDATE** — 0 rows, no application writer (Slice 5 moved the read off it,
   recorded in `app/(app)/people/page.tsx`), no RPC inserts. Revoking a grant destroys nothing.
3. **`club_ovalball_invitations.token` client SELECT** — two live readers need `id`, `contact_email` and
   `inviting_club_id`; none needs `token`. A column-level grant keeps them working.

**`send_replacement_guardian_invitation` is deliberately NOT converted**, and the reason is measured
rather than assumed: the journey completes through `link_guardian_to_existing_player` and
`create_player_for_guardian`, **both of which take a `p_guardian_invitation_id`** — a legacy row id. The
canonical `GUARDIAN` kind's redemption returns `ACCEPTED` and links nobody. So re-pointing the issuer
would break the replacement-guardian journey outright, which is functionality loss. Porting those two
functions onto the canonical invitation is **family-architecture work, not retirement**, and the one live
row is the owner's own pending invitation. Recorded for the owner's ruling, with the exposure stated:
`guardian_invitations` has **no grant to `anon` or `authenticated` at all**, so no API role can read that
token; the only readers are SECURITY DEFINER functions.

## 4. Slice 10's other named targets

- **Magic-link code paths (T7).** `/login` is password-primary with *"Email me a link instead"* still
  present, and the acceptance harness signs in through it. T7's own gate is *"zero magic-link sessions
  for 30 days"* — undeployed, so unmeasurable. §21 of the authorisation says not to redesign current auth
  to satisfy the stale harness. **Not due.**
- **Deprecated capability keys.** `public.capabilities` carries a `status` of `ACTIVE | DEPRECATED`;
  retirement is per-key and each retires with the slice owning its domain. Counted in the ratchet.
- **`no_role_literals` shrink reaches 0.** The list stands at 74 files. Step 16 shrank one of them by
  consolidating a fixture. Reaching zero is the whole remaining legacy estate, not a sprint task.

## 5. Final-slice ownership matrix for the original Identity/Auth goals (§3)

| goal | status |
|---|---|
| email/password | **COMPLETE IN EARLIER SLICE** (6) |
| password policy | **COMPLETE IN EARLIER SLICE** (6) — 12 characters, locked decision |
| MFA/TOTP | **COMPLETE IN EARLIER SLICE** (6) — mandatory for all roles |
| recovery codes | **COMPLETE IN EARLIER SLICE** (6b.1) |
| sessions | **COMPLETE IN EARLIER SLICE** (6) — `session_live()`, `revoke_my_other_sessions` |
| Google | **COMPLETE IN EARLIER SLICE** (6) |
| Apple/Facebook readiness | **OWNER DECISION** — provider credentials do not exist; §12 forbids pretending |
| one identity / multiple contexts | **COMPLETE IN EARLIER SLICE**, extended by Step 16's `governing` context |
| Club Admin · Safeguarding Officer · Fixture Secretary · Coach · Team Manager · Volunteer · Player · Parent/Guardian | **COMPLETE IN EARLIER SLICES** (2, 4, 7, 8, 9) |
| Site Admin independent of club membership | **COMPLETE IN EARLIER SLICE** (7e) |
| capability-scoped authority | **COMPLETE IN EARLIER SLICE** (3) — `organisation` scope remains **HARDENING** (Step 16 H13.1) |
| invitations/joining | **COMPLETE IN EARLIER SLICE** (5), extended by Step 16; **SLICE 10** owns retiring the legacy estate |
| account recovery | **COMPLETE IN EARLIER SLICE** (6b.1) |
| controlled impersonation | **COMPLETE IN EARLIER SLICE** (9) |
| audit/security events | **COMPLETE IN EARLIER SLICE** (1, 4) — append-only, guarded |
| suspension/revocation | **COMPLETE IN EARLIER SLICE** (2, 4) |
| signup/claim | **COMPLETE IN EARLIER SLICE** (6); **LATER UX** owns the entrance journeys (Step 19) |
| AAL2-sensitive operations | **COMPLETE IN EARLIER SLICE** (6) |
| **legacy retirement** | **SLICE 10** — this step, bounded by §1 above |

**Nothing in this matrix is reimplemented by Step 17.**

## 6. FUNCTIONS BEFORE — 34

Step 16's thirty-four, in `CONVERGENCE_STEP_16_FUNCTIONALITY_MATRIX.md`, unchanged.
