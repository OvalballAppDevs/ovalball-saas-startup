# Identity/Auth programme reconciliation — Phase 1 + Phase 2 → Slices 1–7 → production

**Audit date:** 17 September 2026. **Production baseline:** 520 migrations, tip `20270429000000`,
release commit `d0acaab`.

**Method.** The ORIGINAL Phase 2 design is the baseline. A slice report does not amend the plan by
omitting something. Every "deferred" below cites the document that authorises it; anything without
documentary authority is classified **MISSED**, not deferred.

**Nothing in this audit changed code, configuration or production.**

---

## A. Current production baseline (verified read-only)

| Fact | Value |
|---|---|
| Migrations | **520**, tip `20270429000000`, ledger equals disk |
| Release | `d0acaab` on `main`; `/admin/users/new` serves 307 (Slice 7 build live) |
| Identities | 4 auth users, 4 profiles (all `created_source = LEGACY`) |
| Sign-in material | 2 of 4 hold a password; identities are `email`×2, `email+google`×1, **none**×2 |
| Site Admins | **1** active, SITE_FULL (AN-3 unresolved) |
| MFA | **0 verified factors, 0 TOTP amr claims, 0 recovery codes** |
| Enforcement | all six groups `require_aal2_from = null`, `block_magic_link_login = false` → **T0** |
| Auth providers (GoTrue) | `google = true`, `apple = false`, `facebook = false`, `email = true` |
| Login UI (live) | Continue with Google · Email + Password · "Email me a link instead" · "Forgotten your password?" |
| Capabilities | 239 rows: **182 ACTIVE** (Slice 3 target), 57 DEPRECATED |
| Site Admin bundles | 7: FULL, OPS, DATA, SUPPORT, MOD, RO, CONTENT (matches R) |
| Role definitions | 8: CLUB_ADMIN, SAFEGUARDING_OFFICER, FIXTURES_SECRETARY, COACH, TEAM_MANAGER, TEAM_ADMINISTRATION, VOLUNTEER, MEMBER (matches I) |
| PG-15 / PG-16 | **0 / 0**, including the presentation-role family |

---

## B. The finding that outranks everything else

### ⛔ REGRESSED — Site Admin master control is unusable in production today

Slice 7 replaced `public.set_account_status` (label-authorised, no second factor) with
`public.site_set_account_state`, which carries the Q.3 preamble including
`internal.require_recent_aal2`. All **20** master-control RPCs, Create User, and — because Slice 7b
strengthened them — **both privileged-recovery RPCs** now require a TOTP `amr` entry from the last ten
minutes.

Production has **zero verified TOTP factors and zero TOTP amr claims**, because Slice 6 deferred
enabling TOTP in the production auth settings (its report says so plainly: *"Until TOTP is enabled
there, `/security/enrol` will refuse"*).

`internal.recent_aal2` returns true only when a session carries no `session_id` (the service key and
the test harness). Every real browser session carries one. Therefore:

- **the single production Site Admin cannot suspend, disable or reinstate any account**;
- cannot add or remove a club membership, team role, guardian link or role assignment;
- cannot create a user, revoke sessions, force a password reset or resend a setup email;
- cannot request, approve or reject a Site Admin grant;
- cannot request or approve a privileged MFA recovery.

`set_account_status`, which worked, has been dropped. Ordinary Site Admin reads and RLS-governed
writes are **unaffected** (`session_aal_ok` passes at AAL1 while no group is enforced), so this is
precisely scoped to the 22 RPCs that demand a recent second factor.

**Cause:** a Slice 6 precondition (AK: *"Preconditions — AN-3, AN-4 resolved"*) was not met, Slice 6
shipped at T0 with production auth configuration deferred, and Slice 7 then built on the assumption
that a recent TOTP could be obtained. **Severity: PRODUCT BLOCKER.** It also has a security dimension:
an administrator cannot suspend a compromised account through the product.

**Unblocked by:** enabling TOTP in production auth settings, then the Site Admin enrolling. No code
change is required. It is owner action, not engineering.

---

## B.0 Owner-login incident — CLOSED, owner confirmed

A production authentication incident on 17 September 2026 locked the established Full Site Admin out
of their own account with a correct password. Root cause: the login page cleared the single-use
Turnstile token on a failed attempt while leaving the "challenge passed" boolean true, so the submit
button stayed enabled and every retry posted a null token, which the server refused fail-closed. It
was introduced by `4ecde7b` (Slice 6) and is **not** a defect in Turnstile, the password, the account
or any authority record.

Released as **`cd18ba6`** and **confirmed by the owner in production**: they can authenticate and
reach the correct Full Site Admin context. No authority repair was required at any point. Full record:
`SLICE_6B_LOGIN_INCIDENT.md`. Row **S6-1 remains PRODUCTION VERIFIED**; the incident did not change
any other row's status.

---

## B.2 Slice 6b.1 — PRODUCTION VERIFIED

Unit 6b.1 (`SLICE_6B1_PASSWORD_RECOVERY.md`) is released. Production release **`c03e2b8`**, migration
ledger **521 / `20270430000000`**. `/forgot-password`, `/account/reset-password`, `/account/setup` and
`/account/suspended` resolve in production; before this release all four were 404.

**Closure accounting, not inflated:**

| Row | Outcome of 6b.1 |
|---|---|
| S6-6 `/forgot-password` reset flow | **CLOSED** |
| S6-7 `/account/setup` landing | **CLOSED** |
| S6-2 L1 password policy | **PARTIALLY CLOSED** — validator on every surface; the provider minimum is code/local only |
| S6-5 validator on every password surface | **CLOSED** for the surfaces that exist |
| S6-3 GoTrue minimum 12 | **PARTIALLY CLOSED** — repository/local config corrected and verified; the **production Auth setting is NOT changed or verified by this release** and stays with 6b.5 |
| S6-8 `/account/suspended` | **STILL OPEN for 6b.2** — the route resolves, but nothing routes to it and the session-layer contract is unclosed |
| S6-9 `requireSession` | **STILL OPEN for 6b.2** |
| S6-4, S6-19, S6-20 | **OWNER / EXTERNAL CONFIGURATION REQUIRED** — unchanged by this release |

### D.2 reconciled — suspension (owner decision, D-S6B-AUTO-10)

Phase 2 D.2 lists `/account/suspended` as a destination, which presumes a suspended identity remains
authenticated. **That assumption is superseded by a recorded owner decision.** The shipped session
layer terminates or refuses a usable session the moment the canonical account-state check reads
suspended or disabled, and lands the person on a safe signed-out explanation. The security intent of
D.2 is preserved; the mechanism is stronger. `/account/suspended` survives as a defensive
presentation destination only, and enforcement must never be weakened to make it reachable.

S6-8 therefore stays **open for 6b.2**, whose permanent tests must prove suspension cannot retain or
recover authority.

---

## B.1 Stage 0 — status as at 17 September 2026

Stage 0 addresses **§B only**. It is the designed path, not a relaxation: `require_recent_aal2` is
untouched, master control keeps its MFA requirement, and no enforcement group is activated.

**Phase 2 basis, verified verbatim rather than assumed.** AG.2 **T0** is *"Password + TOTP + recovery
codes **available to everyone** … account Security page live … **no enforcement**"*. AN-3's Blocks
column reads *"Slice 6 **T1+**, Slice 7c"*; L16 states AN-3 *"blocks **enforcement**"*. TOTP
**availability** therefore belongs to T0, and AN-3 gates T1 onward. **No contradiction.**

| Step | State |
|---|---|
| 0.1 Enable TOTP enrol/verify in the production Auth settings | **BLOCKED — OWNER ACTION.** No MCP tool reads or writes Auth configuration, and the public settings endpoint does not report MFA. Dashboard action by the platform owner |
| 0.2 Existing Full Site Admin enrols through the product | Pending 0.1. Claude must never see the secret or the code |
| 0.3 Read-only verification | Pending 0.2 |

**Security UI proven ready before any owner uses it** (local evidence; no production identity was
created): enrolment runs on the caller's own session with no user id passed and **no service-role
client** — the only mention of the service role in that path is a comment explaining its absence, and
commit `96d65ae` removed it. `account_recovery_codes` grants `authenticated` **nothing**, and the
`_for(uuid)` variants that take a target are not executable by a browser role — only the `my_` ones —
so factor and code management is account-scoped by construction. Codes are stored as `code_hmac`;
there is no plaintext column. Browser suite `61-auth-security` **21/21**, including "a wrong code is
refused", "a real code is accepted", "exactly ten recovery codes, once", "Ovalball stored a hash of
each code, never a code", and recovery-code replay refused. Suites: `recovery_codes` 26,
`aal_enforcement` 38, `security_events_no_secrets` 24, `password_policy` 9 — all green.

**Composition demonstrated on one AAL1 session with no TOTP**, which is exactly production's Site
Admin today: enforcement groups requiring AAL2 = **0**; `session_ok()` = **true**; ordinary site
capability resolves = **true**; the same session attempting master control is **refused** with *"Enter
a code from your authenticator to continue."* T0 does not mean master control loses its recent-TOTP
requirement — it means the general enforcement rollout has not begun.

**Enrolling does not lock anyone out.** `session_aal_ok()` returns `not mfa_enforced_for_group(...)`
on the AAL1 path, and `mfa_enforced_for_group('PRIVILEGED')` is **false** at T0, so an administrator
who enrols keeps ordinary access on an AAL1 session and gains the recent-TOTP capability on demand.

---

## C. Requirement traceability counts

Counted from the **101 requirement rows in section D**. Sections E–P carry supplementary
provider-, control- and suite-level tables that expand several of these rows; they are not
double-counted here.

| Status | Count |
|---|---:|
| PRODUCTION VERIFIED | 56 |
| PARTIALLY IMPLEMENTED | 16 |
| MISSED | 14 |
| REGRESSED | 3 |
| IMPLEMENTED — NOT PRODUCTION CONFIGURED | 3 |
| IMPLEMENTED — NOT ENFORCED | 2 |
| SUPERSEDED BY RECORDED DECISION | 2 |
| BLOCKED — OWNER ACTION | 2 |
| BLOCKED — EXTERNAL CONFIGURATION | 1 |
| LEGITIMATELY DEFERRED | 1 |
| NOT YET DUE | 1 |
| **Total** | **101** |

**55 of 101 rows are something other than PRODUCTION VERIFIED.** The 14 MISSED and 3 REGRESSED rows
are the ones with no documentary basis; §Q separates them from the genuine deferments.

---

## D. Requirement traceability matrix

Columns: **ID** · **Requirement** · **Original owner** · **Later decision** · **Artefact now** ·
**Test** · **Production evidence** · **Status** · **Remaining owner** · **Notes**

### D.1 Slice 1 — perimeter and identity invariants

| ID | Requirement | Owner | Artefact | Test | Production | Status | Remaining | Notes |
|---|---|---|---|---|---|---|---|---|
| S1-1 | ID-1 every auth user has exactly one profile | 1 | `create_profile_for_identity` trigger | `identity_foundation_and_perimeter` | 4 users / 4 profiles | PRODUCTION VERIFIED | — | |
| S1-2 | ID-2 `profiles.email` tracks `auth.users.email` | 1 | `sync_profile_email_from_identity` | same | present | PRODUCTION VERIFIED | — | |
| S1-3 | `account_state` + compatibility `account_status` | 1 | `profiles.account_state` | `identity_security_containment` | 4 ACTIVE | PRODUCTION VERIFIED | — | |
| S1-4 | `set_account_status` rewired, keeps Phase 0 authority | 1 | **dropped by Slice 7** | — | absent | SUPERSEDED BY RECORDED DECISION | — | Q.3 says `site_set_account_state` "Replaces Phase 0 `set_account_status`". Supersession is authorised; see B for the consequence. |
| S1-5 | PG-1 default privileges grant nothing | 1 | `…_database_perimeter.sql` | `security_perimeter_guard` | anon write grants **0** | PRODUCTION VERIFIED | — | |
| S1-6 | PG-2/3 anon + authenticated DML equal the manifest | 1 | `perimeter-manifest.json` | `perimeter_manifest.test.mts` | 0 anon DML | PRODUCTION VERIFIED | — | |
| S1-7 | PG-4 anon-executable functions reduced to the allow-list | 1 | manifest | `security_perimeter_guard` | advisor: 11 anon definer fns | PARTIALLY IMPLEMENTED | Slice 10 | advisor `anon_security_definer_function_executable` = 11; manifest declares them, but AO C5's "equals the manifest" is asserted only locally |
| S1-8 | **PG-6/PG-14 every function has a fixed `search_path`; advisor count 0 in production** | 1 | — | — | **advisor = 73** (9 public, 64 internal) | **MISSED** | needs an owner | AO **C6** states the target is 0 "in production after release". Local is worse (104). No test asserts it. |
| S1-9 | **PG-7 views `security_invoker`; advisor limited to manifest projections (target 1)** | 1 | — | `perimeter_manifest.test.mts` (local only) | **advisor = 2**: `public_club_fixtures`, `public_venues` | PARTIALLY IMPLEMENTED | Slice 10 | `public_venues` is a Slice 1 public projection, so arguably in scope — but AO C7 said target 1, and no document raises it to 2 |
| S1-10 | **C10 `pg_trgm` moved to `extensions`; advisor cleared** | 1 | — | — | **still in `public`** | **MISSED** | needs an owner | Same locally. |
| S1-11 | PG-10 no secret-pattern column reachable outside the manifest | 1 | manifest | `security_events_no_secrets` | 2 genuine: `club_ovalball_invitations.token` (SELECT), `invitations.token` (INSERT/UPDATE) | PARTIALLY IMPLEMENTED | Slice 10 | Both tables are **empty** in production and RLS-scoped, so bounded |
| S1-12 | `security_events` + `audit_log` immutable | 1 | `audit_immutability.sql` | wired | audit_log 7,563 rows intact | PRODUCTION VERIFIED | — | |
| S1-13 | Audit redaction rules applied | 1 | `audit_redaction_rules` | `audit_immutability` | present | PRODUCTION VERIFIED | — | |
| S1-14 | `emit_security_event` refuses secret-shaped metadata | 1 | `internal.emit_security_event` | `security_events_no_secrets` | 116 event types | PRODUCTION VERIFIED | — | |
| S1-15 | **`service_role_usage.test.mts`** | 1 | `supabase/tests/js/service_role_usage.test.mts` | wired (glob), 6 tests | — | **CLOSED by Convergence Step 5** | — | AO **C12**. Named allow-list of the two modules holding the key and the seven call sites importing the factory; asserts none is a client component, no `NEXT_PUBLIC_` alias exists, and each holder carries its own authorisation reasoning |
| S1-16 | `verify-perimeter-manifest` / `verify-no-client-table-writes` / `derive-perimeter` scripts | 1 | superseded by `perimeter_manifest.test.mts`, `no_client_table_writes.test.mts` | wired | — | SUPERSEDED BY RECORDED DECISION | — | Equivalent coverage under different names; substitution is legitimate |
| S1-17 | `verify-person-name-null-safety.mjs` (AO A6) | 1 | absent | none | — | **MISSED** | needs an owner | |
| S1-18 | Browser `40a-public-surfaces-anon` | 1 | absent | none | — | **MISSED** | needs an owner | AO D4's first item |

### D.2 Slice 2 — memberships, relationships, provenance

| ID | Requirement | Owner | Artefact | Test | Production | Status | Remaining | Notes |
|---|---|---|---|---|---|---|---|---|
| S2-1 | Canonical `club_memberships` state machine (M.1) | 2 | transition RPCs | `membership_state_machine` | live | PRODUCTION VERIFIED | — | |
| S2-2 | `role_definitions` + `role_assignments` (M.2) | 2 | 8 roles | `role_assignment_state_machine` | 8 roles present | PRODUCTION VERIFIED | — | |
| S2-3 | Role ceilings and delegation limits | 2 | `validate_role_assignment` | `role_assignment_ceilings` | live | PRODUCTION VERIFIED | — | |
| S2-4 | Minor prohibitions (hard rule) | 2 | `internal.grant_role` | `minor_prohibitions` | live | PRODUCTION VERIFIED | — | |
| S2-5 | Guardian relationship state machine (N.1) | 2 | `guardians` states | `family_relationship_state_machine` | live | PRODUCTION VERIFIED | — | |
| S2-6 | Additional guardian requires acceptance (H-4) | 2 | `respond_to_additional_guardian_request` | `guardian_additional_requires_acceptance` | RPC present | PRODUCTION VERIFIED | — | closes Phase 1 H-4 |
| S2-7 | Revoked authority cannot resurrect (H-5) | 2 | `guard_club_membership_revival` | `membership_state_machine` | guard present | PRODUCTION VERIFIED | — | |
| S2-8 | Races R7–R11, R20 | 2 | `membership_races.test.mts` | wired (glob) | — | PRODUCTION VERIFIED | — | |
| S2-9 | AN-17 Volunteer optionally team-scoped | 2 | `VOLUNTEER` scope `CLUB_OR_TEAM` | `role_assignment_ceilings` | present | PRODUCTION VERIFIED | — | |
| S2-10 | `backfill_verification` queries = 0 | 2 | suite | wired | production had 2 profiles at the time | PRODUCTION VERIFIED | — | |

### D.3 Slice 3 — capability resolution

| ID | Requirement | Owner | Artefact | Test | Production | Status | Remaining | Notes |
|---|---|---|---|---|---|---|---|---|
| S3-1 | 182-key capability catalogue | 3 | `capabilities` | `capability_catalogue_integrity` | **182 ACTIVE** | PRODUCTION VERIFIED | — | exact match to plan |
| S3-2 | `capability_decision` + precedence (K P01–P38) | 3 | `internal.capability_decision` | `capability_precedence_truth_table` | live | PRODUCTION VERIFIED | — | |
| S3-3 | `capability_overrides` with level provenance | 3 | table + RPCs | `capability_override_races.test.mts` | live | PRODUCTION VERIFIED | — | |
| S3-4 | Site Admin profiles in the database (R) | 3 | 7 SITE_* bundles | `site_admin_profile_matrix` | 7 bundles, FULL = 51 caps | PRODUCTION VERIFIED | — | |
| S3-5 | `explain_access` parity with enforcement | 3 | RPC | `explain_access_matches_enforcement` | live | PRODUCTION VERIFIED | — | |
| S3-6 | `has_capability` re-implemented over `can()` without the Site Admin bypass | 3 | adapter | `bundle_legacy_parity` | live | PRODUCTION VERIFIED | — | retires at Slice 10 |
| S3-7 | Performance gate (K.5) | 3 | — | none wired | measured 0.036–0.108 ms | PARTIALLY IMPLEMENTED | Slice 10 | measured each slice by hand; no permanent gate asserts p95 |

### D.4 Slice 4a–4i — domain authority migration

| ID | Requirement | Owner | Artefact | Test | Production | Status | Remaining | Notes |
|---|---|---|---|---|---|---|---|---|
| S4-1 | Domain matrices for all nine sub-slices | 4a–4i | 10 matrix suites | all wired | live | PRODUCTION VERIFIED | — | |
| S4-2 | Cross-club and family isolation matrices | 4 | 2 suites | wired | live | PRODUCTION VERIFIED | — | |
| S4-3 | `authority_helper_retirement` shrink-only | 4 | suite | wired | PG-15/16 = 0 | PRODUCTION VERIFIED | — | extended by Slice 7 with PG-15+/PG-16+ |
| S4-4 | AN-6 Safeguarding Officer confirmation | 4g | `confirm_safeguarding_officer` | `safeguarding_officer_security` | live | PRODUCTION VERIFIED | — | |
| S4-5 | AN-7 safeguarding hold on a guardian relationship | 2 (state) / 4a (UI) | states + `family-relationships-panel` | `family_relationship_state_machine` | live | PRODUCTION VERIFIED | — | |
| S4-6 | AN-11 Fixtures Secretaries may not invite | 4c | bundle excludes `people.invitation.create` | `club_admin_authority_matrix` | live | PRODUCTION VERIFIED | — | |
| S4-7 | D-S4-3 guardian authority stops at 18 | 4a | `can_player_as_family` | `family_authority_matrix` | live | PRODUCTION VERIFIED | — | |
| S4-8 | M-4 Site Admin cannot read safeguarding threads via RLS | 4g | review RPC | `safeguarding_officer_security` | live | PRODUCTION VERIFIED | — | |

### D.5 Slice 5 — invitations, codes, claims

| ID | Requirement | Owner | Artefact | Test | Production | Status | Remaining | Notes |
|---|---|---|---|---|---|---|---|---|
| S5-1 | Unified `access_invitations` with hashed tokens | 5 | table (no plaintext column) | `invitation_authority_matrix` | present, **0 rows** | PRODUCTION VERIFIED | — | never used in production |
| S5-2 | Email binding, expiry, single use, attempt limits | 5 | `redeem_invitation` | `invitation_authority_matrix`, `invitation_races.test.mts` | live | PRODUCTION VERIFIED | — | |
| S5-3 | Issuer authority re-checked at redemption (R3) | 5 | `redeem_invitation` | `invitation_authority_matrix` | live | PRODUCTION VERIFIED | — | |
| S5-4 | Club claim states + `decide_club_claim` | 5 | RPCs | `club_claim_authority_matrix` | live | PRODUCTION VERIFIED | — | |
| S5-5 | D-S5-1 unknown age cannot cross an authority boundary | 5 | age gate | `invitation_authority_matrix` IN-N1..N4 | live | PRODUCTION VERIFIED | — | Slice 7 re-proved it still gates ahead of the two-admin rule |
| S5-6 | **Removal of `ovalballSignupPayload` metadata (Phase 0 binding retired)** | 5 | **still present** in `submit-signup.ts` + `complete-signup.ts` | none | live | **MISSED** | needs an owner | AK Slice 5 Code row lists this explicitly. Phase 1 **H-7** is the vulnerability it closes |
| S5-7 | `auth_flow_states` for onboarding context (SO-4) | 5 | table exists, **0 application references** | none | table present, unused | **MISSED** | Slice 6 (social) | table shipped, nothing uses it |
| S5-8 | Legacy invitations honoured until expiry | 5 | 4 legacy tables remain | partial | see M | PARTIALLY IMPLEMENTED | Slice 10 | two can still **issue** new plaintext-token credentials — see §M |
| S5-9 | Vault pepper for codes | 5 | `recovery_code_pepper` | `recovery_codes` | present | PRODUCTION VERIFIED | — | |
| S5-10 | Browser 43 (invitations) and 44 (claim) | 5 | `60-invitation-journeys.mjs` | — | — | PRODUCTION VERIFIED | — | numbering drifted; journey delivered |

### D.6 Slice 6 — password, MFA, recovery, sessions, social

| ID | Requirement | Owner | Artefact | Test | Production | Status | Remaining | Notes |
|---|---|---|---|---|---|---|---|---|
| S6-1 | Email + password sign-in | 6 | `/login` password primary | `password_policy.test.mts` | **live** | PRODUCTION VERIFIED | — | |
| S6-2 | L1 policy: ≥12, uppercase, special, ≤72 bytes | 6 | `lib/auth/password-policy.ts` | `password_policy.test.mts` (9) | app surfaces only | PARTIALLY IMPLEMENTED | see S6-3 | |
| S6-3 | **GoTrue `password_min_length = 12` natively** | 6 | `config.toml` sets a **non-existent key** | none | `GOTRUE_PASSWORD_MIN_LENGTH=6` | **REGRESSED** | Slice 6 closure | `[auth]` holds both `minimum_password_length = 6` (the real key) and `password_min_length = 12` (ignored). The direct GoTrue API accepts a 6-character password |
| S6-4 | Breached-password protection | 6 | `isBreachedPassword` (HIBP k-anonymity, fails closed in production) | `password_policy.test.mts` | advisor: **leaked-password protection disabled** | IMPLEMENTED — NOT PRODUCTION CONFIGURED | owner | E permits the app-side fallback, which exists — but it runs on **one** surface only (S6-5) |
| S6-5 | The validator on **every** Ovalball password surface | 6 | `checkPassword` called from **1** file | — | — | PARTIALLY IMPLEMENTED | Slice 6 closure | only `account/security/actions.ts`. There is no setup or reset surface to call it from (S6-6) |
| S6-6 | **`/forgot-password` reset flow (G)** | 6 | **route does not exist**; `/login` links to it | none | **404 in production** | **REGRESSED** | Slice 6 closure | Live, user-facing: "Forgotten your password?" leads to a 404, with 2 password-holding accounts |
| S6-7 | `/account/setup` (setup-restricted landing, D.2) | 6 | absent | none | **404** | **MISSED** | Slice 6 closure | |
| S6-8 | `/account/suspended` landing (D.2) | 6 | absent | none | **404** | **MISSED** | Slice 6 closure | |
| S6-9 | **`requireSession` in the `(app)` layout, every Server Action and route handler** | 6 | `lib/auth/require-session.ts` exists with **zero callers** | `require_session.test.mts` **absent** | not in the request path | **MISSED** | Slice 6 closure | Enforcement layer 2 of 3 is absent. The database layer is authoritative and intact, so this is defence-in-depth, not an open door at T0 |
| S6-10 | TOTP enrol / challenge / ≤3 factors / no last-factor removal | 6 | `/security/enrol`, `/security/verify` | `aal_enforcement` (38) | pages live; **0 enrolled** | IMPLEMENTED — NOT PRODUCTION CONFIGURED | owner | TOTP not enabled in production auth settings |
| S6-11 | Recovery codes: 10, HMAC+pepper, single use, regeneration | 6 | `account_recovery_codes` | `recovery_codes` (26) | 0 rows | IMPLEMENTED — NOT PRODUCTION CONFIGURED | owner | |
| S6-12 | Recovery-code attempt limits (5/15 min) | 6 | `mfa_challenge_locked` | **no wired suite** | — | PARTIALLY IMPLEMENTED | Slice 6 closure | `recovery_code_attempt_limits.sql` absent; no wired suite covers the concern |
| S6-13 | Minor guardian-assisted recovery + age gate | 6 | `privileged_recovery_requests` | **no wired suite** | — | PARTIALLY IMPLEMENTED | Slice 6 closure | `minor_recovery_age_gate.sql` absent |
| S6-14 | Privileged recovery two-person rule | 6 | `request_/approve_privileged_recovery` | `identity_security_containment` | CHECK live | IMPLEMENTED — NOT ENFORCED | AN-3 | cannot run: one Full Site Admin, and now also blocked by §B |
| S6-15 | Session liveness, revocation, sign-out scope | 6 | `session_ok`, `revoke_all_sessions` | `auth_races.test.mts` R13/R14/R17 | live | PRODUCTION VERIFIED | — | |
| S6-16 | Account → Security: factors, codes, sessions, **linked methods**, recent activity | 6 | 3 of 5 sections | — | live | PARTIALLY IMPLEMENTED | Slice 6 closure | **Linked Sign-In Methods absent** (SO-5/SO-6) |
| S6-17 | Security headers + CSP, cookie `secure` | 6 | — | none | not verified | PARTIALLY IMPLEMENTED | Slice 6 closure | not evidenced in the Slice 6 report |
| S6-18 | **SO-1…SO-7 social consistency** | 6 | see §E | none | Google live | **MISSED** | Slice 6 closure | 5 of the 7 SO rules are unimplemented (SO-2, SO-3, SO-4, SO-5, SO-6). The Slice 6 report contains **no mention** of social, providers, Google, Apple, Facebook or linking |
| S6-19 | AN-1 native composition superset | 6 | `password_requirements = ""` | — | not set | BLOCKED — OWNER ACTION | owner | decision never recorded |
| S6-20 | AN-4 production plan features verified | 6 | — | — | partially known | BLOCKED — EXTERNAL CONFIGURATION | owner | was a **precondition** of Slice 6 |
| S6-21 | AN-12 Full Site Admins hold email+password (not social-only) | 6 | not enforced anywhere | none | the one FULL holds email+google | **MISSED** | Slice 6 closure | no check exists |
| S6-22 | Browser 40, 41, 42, 50, 52 | 6 | `61-auth-security.mjs` covers 40–42 | — | — | PARTIALLY IMPLEMENTED | Slice 6 closure | **50 (social) and 52 (minor onboarding) absent** |
| S6-23 | T0 deploy, no enforcement | 6 | `mfa_enforcement_policy` all null | `aal_enforcement` | verified T0 | PRODUCTION VERIFIED | — | |
| S6-24 | **Acceptance: two Full Site Admins enrolled; break-glass rehearsed; PRIVILEGED live 24 h** | 6 | none of the three | — | — | LEGITIMATELY DEFERRED | T1–T3 | The three gates are properly deferred (AG.2 sequences T1–T3 as separately authorised operations, and the Slice 6 report defers each with a reason). What this audit disputes is the **slice-level classification**: Slice 6 was recorded PRODUCTION VERIFIED when only **T0** was verified, and its own acceptance row requires T3. Read "Slice 6 = T0 verified", not "Slice 6 complete" |

### D.7 Slice 7 — Site Admin master control

**"CLOSED by Slice 7e" means closed in code and proved locally, NOT released.**
Step 5 banks without a production deployment; those rows become PRODUCTION
VERIFIED when the release actually happens, and not before.

| ID | Requirement | Owner | Artefact | Test | Production | Status | Remaining | Notes |
|---|---|---|---|---|---|---|---|---|
| S7-1 | PG-15 = 0 | 7d | 20270418 | `authority_helper_retirement` | **0** | PRODUCTION VERIFIED | — | |
| S7-2 | PG-16 = 0 | 7d | 20270419 | same | **0** | PRODUCTION VERIFIED | — | |
| S7-3 | Presentation-role authority retired (beyond plan) | 7 (extension) | 20270421, 20270506 | PG-15+/PG-16+ | 0 | PRODUCTION VERIFIED; **extended by Slice 7e** | — | D-S7-AUTO-1. 7e found the last `is_site_admin()` reference inside `admin_club_overview`'s WHERE clause, replaced it with `site.clubs.view` and dropped the helper (ledger L16) |
| S7-4 | Q.3 master-control RPCs | 7a | 20 RPCs | `site_master_control` (62) | present, **unusable** (§B) | **CLOSED by Slice 7e** — the AAL2 boundary is proved end to end (`71-recent-aal2-authority`) and every RPC now has a caller | — | |
| S7-5 | **Users & Access detail tabs (AB.1, 13 tabs)** | 7a | 13 tabs, URL-addressed | browser 73 (33) | live | **CLOSED by Slice 7e** | — | the 17 orphaned RPCs now have callers; `site_admin_master_control_reachability.test.mts` holds it |
| S7-6 | Create User (Q.2) | 7b | RPC + `/admin/users/new` | browser 73 (T-60..T-64) | live | **CLOSED by Slice 7e** | — | AB.4's three steps; `p_intended` is finally sent |
| S7-7 | AB.3 `site_search_users` RPC | 7a | `20270504000000` | `site_admin_users_access_closure` (37) | live | **CLOSED by Slice 7e** | — | authorises first, filters as data, refuses an unknown sort |
| S7-8 | Two-admin Site Admin grant | 7c | 5 RPCs + gate + UI | `site_admin_grant_and_lockout` (29), browser 73 (T-30..T-34) | live | **CLOSED by Slice 7e (UI half)** | AN-3 | raise on the person's record, decide on Site Admin Management |
| S7-9 | `site_admin_lockout_guard` suite | 7 | `site_admin_grant_and_lockout.sql` | wired | — | PRODUCTION VERIFIED | — | renamed; covers revoke, delete and quiet demotion |
| S7-10 | AI #36/#37/#41 profile matrix | 7 | `site_admin_profile_matrix` (generated) | wired | — | PRODUCTION VERIFIED | — | |
| S7-11 | Races R9, R16 | 7 | `site_admin_races.test.mts` | wired (glob) | — | PRODUCTION VERIFIED | — | |
| S7-12 | AN-8 no read-out of setup codes | 7b | no Copy Setup Link; token never returned | browser 62 S7-07 | live | PRODUCTION VERIFIED | — | |
| S7-13 | AN-3 bootstrap procedure documented and audited | 7c | `SITE_ADMIN_BOOTSTRAP.md`, rehearsed | — | not run | BLOCKED — OWNER ACTION | owner | |

### D.8 Cross-cutting requirements

| ID | Requirement | Owner | Artefact | Test | Production | Status | Remaining | Notes |
|---|---|---|---|---|---|---|---|---|
| X-1 | Multi-context: one identity, many roles | 2/3 | `role_assignments`, `capability_decision` | matrices | live | PRODUCTION VERIFIED | — | |
| X-2 | Context switcher UI + persisted cookie | H (no slice named) | `set-context.ts`, layout switcher | `capability_scope_isolation`, browser 42 | live | PRODUCTION VERIFIED | — | **no slice in AK owns this**; it predates Phase 2 and satisfies H |
| X-3 | Context narrows, never widens; server-validated | H | `resolveActiveContext` | `capability_scope_isolation` | live | PRODUCTION VERIFIED | — | |
| X-4 | Stale context invalidation | H | fallback in `resolveActiveContext` | partial | live | PARTIALLY IMPLEMENTED | Slice 8 | no test names the stale case explicitly |
| V-1 | Volunteer default read-only bundle | 3 | VO bundle, no mutation keys | `club_admin_authority_matrix` | live | PRODUCTION VERIFIED | — | |
| V-2 | Club Admin can add/restrict Volunteer permissions | 3/8 | `/club/permissions` + `set_capability_override` | `capability_override_races.test.mts` | live | PRODUCTION VERIFIED | — | |
| V-3 | **Volunteer presets (Pitch Allocation, Calendar, Team Fixtures)** | 8 (AC) | **absent**, 0 preset tables | none | — | **MISSED** | Slice 8 | V names three presets; AC.Presets requires "Apply Preset … in one transaction with one event per override" |
| TA-1 | TEAM_ADMINISTRATION replaces `team_admin` (L8) | 2 | role exists; `team_admin` is the compatibility value | `role_assignment_ceilings` | live | PARTIALLY IMPLEMENTED | Slice 10 | 17 functions + 55 TS files still reference `team_admin` via `team_permissions`; AK Slice 10 owns the drop |
| IMP-1 | Impersonation (AD) | 9 | `effective_person` is a **stub** returning `auth.uid()`; no `impersonation_sessions` | none | absent | NOT YET DUE | Slice 9 | seam in place, correctly |
| AUD-1 | Every security-sensitive action emits an event | 1–7 | 116 event types | `security_events_no_secrets` | live | PRODUCTION VERIFIED | — | |
| AUD-2 | No event emitted inside a transaction that then rolls back | 1–7 | systematic scan | — | **0 instances** | PRODUCTION VERIFIED | — | scanned both shapes: emit-inside-handler-then-raise, and emit-then-raise |

---

## E. Social authentication — provider by provider

Phase 2 **X** required all three. Phase 1 **AL** graded Google "live-capable today", Apple and
Facebook "ready-to-activate". AK assigns **social consistency (SO-1…SO-7) to Slice 6**.
**The Slice 6 production release report does not mention social, providers, Google, Apple, Facebook
or linking anywhere.** That silence is what this audit was called to explain.

The provider *start* path (`app/auth/oauth-actions.ts`, `lib/auth/oauth-providers.ts`) is **pre-Phase-2
work**, and says so: *"Ovalball remains PASSWORDLESS … there is no password path anywhere in this
file."* It was never revisited for Phase 2.

| # | Question | Google | Apple | Facebook |
|---|---|---|---|---|
| 1 | Required by Phase 2? | Yes (X) | Yes (X) | Yes (X) |
| 2 | Original owner | Slice 6 (SO-1…7) | Slice 6 | Slice 6 |
| 3 | Moved by a later decision? | **No** | **No** | **No** |
| 4 | Provider support in app code | Yes (flag-gated) | Yes (flag-gated) | Yes (flag-gated) |
| 5 | Callback / account linking | Callback exists but is **pre-Phase-2**: no `auth_flow_states`, no forced TOTP, still uses `ovalballSignupPayload` | same shared callback; **no relay-address handling** | same shared callback; **no "verify email before redemption"** rule |
| 6 | Configured in local Supabase | **No** (`external.google=false`) | No | No |
| 7 | Configured in production Supabase | **Yes** (`external.google=true`) | **No** | **No** |
| 8 | Provider secret/config present | Present (production only) — *presence inferred from GoTrue reporting the provider enabled; value never read* | ABSENT | ABSENT |
| 9 | Exposed in the production login UI | **Yes** — "Continue with Google" renders live | No | No |
| 10 | Converges on one canonical identity | Yes — one production user holds `email+google` | Untestable | Untestable |
| 11 | Duplicate-account prevention | GoTrue verified-email auto-link only; `enable_manual_linking = false` | **Not implemented** (X requires never auto-linking relay addresses) | **Not implemented** |
| 12 | Provider/email collision rules | Implicit in GoTrue | **MISSED** | **MISSED** |
| 13 | Suspension applies regardless of provider | Yes — `session_ok` → `is_account_active` is provider-agnostic | Yes | Yes |
| 14 | MFA/AAL composes after social login | **Not implemented** — the callback redirects to `next` or `/signup`; SO-2's mandatory TOTP is not applied | — | — |
| 15 | Linking / unlinking (SO-5, SO-6) | **MISSED** — no `linkIdentity`/`unlinkIdentity` anywhere; no Linked Sign-In Methods UI | MISSED | MISSED |
| 16 | Permanently tested | **No** — `social_identity_grants_nothing` (SO-3) does not exist | No | No |
| 17 | Browser tested | **No** — AJ.3 suite 50 absent; zero browser files mention any provider | No | No |
| 18 | Production verified | **No** | No | No |
| | **STATUS** | **PARTIALLY IMPLEMENTED** (start path live and in use; SO-2, SO-3, SO-4, SO-5, SO-6 all missing) | **IMPLEMENTED — NOT PRODUCTION CONFIGURED** | **IMPLEMENTED — NOT PRODUCTION CONFIGURED** |

### SO rules, individually

| Rule | Requirement | Status |
|---|---|---|
| SO-1 | Buttons on Sign In, Create Account and Link Sign-In Method; rendered only when build flag **and server status** agree | PARTIALLY IMPLEMENTED — Sign In and Sign Up only; **no server-side provider-status check**, only the build flag; no Link screen |
| SO-2 | Social sign-in yields AAL1; TOTP mandatory exactly as for password users | **MISSED** — the callback applies no MFA step |
| SO-3 | Social identity grants nothing; test `social_identity_grants_nothing` | PARTIALLY IMPLEMENTED — the principle holds structurally (authority comes only from memberships), but **the named test does not exist** |
| SO-4 | Onboarding context in `auth_flow_states`; OAuth `state` carries only an opaque id | **MISSED** — table exists, **0 application references**; context still rides in `ovalballSignupPayload` user metadata (Phase 1 **H-7**) |
| SO-5 | Unlinking the last method refused; unlink needs R and emits `identity.unlinked` | **MISSED** — no unlink path at all |
| SO-6 | Social-only may add a password; FULL Site Admins must hold email+password (AN-12) | **MISSED** — no check; the one production FULL is `email+google` |
| SO-7 | Signup Turnstile null-token defect and login landing mismatch fixed in Slice 6 | PRODUCTION VERIFIED — `startOAuthSignIn` verifies Turnstile **before** starting the flow, server-side |

---

## F. Password / MFA / magic link

**Password**

| Control | Planned (E) | Actual | Status |
|---|---|---|---|
| Email+password login | Primary | Live in production | PRODUCTION VERIFIED |
| Minimum length 12 | GoTrue native **and** app | App: 12. **GoTrue: 6** (`config.toml` sets a non-existent key) | **REGRESSED** |
| Maximum 72 bytes, never truncated | Yes | Enforced in the app validator | PRODUCTION VERIFIED |
| Uppercase + special | App validator (L1) | Implemented | PRODUCTION VERIFIED (app surfaces) |
| Common/breached protection | Supabase setting, else app HIBP failing closed | App HIBP implemented and fails closed; **Supabase setting disabled** (advisor) | IMPLEMENTED — NOT PRODUCTION CONFIGURED |
| Server-authoritative | Every password surface | **One** surface calls it; direct GoTrue API bypasses it | PARTIALLY IMPLEMENTED |
| Creation (setup token) | ACCOUNT_SETUP → set password | No setup password surface; `/account/setup` 404 | **MISSED** |
| Change | R + GoTrue secure password change | App requires recent AAL2; `secure_password_change = false` | PARTIALLY IMPLEMENTED |
| Reset | `/forgot-password` → email → set → TOTP | **Route absent; 404 in production, linked from /login** | **REGRESSED** |
| Reset expiry / replay | GoTrue recovery semantics | Untestable — no reset flow | **MISSED** |
| Enumeration resistance | Generic responses | Login message is generic; no reset flow to test | PARTIALLY IMPLEMENTED |
| Magic-link user migration (AG.3) | Interstitial → password → TOTP | **No interstitial exists** | **MISSED** |
| Social user adds password | Optional; mandatory for FULL | Not implemented | **MISSED** |
| Audit events | `password.*` | Types registered | PRODUCTION VERIFIED |

**MFA — the four states kept separate**

| State | Truth |
|---|---|
| IMPLEMENTED | Yes — enrol, verify, recovery codes, ≤3 factors, last-factor refusal, attempt-limit function |
| CONFIGURED | **Local yes** (`enroll_enabled`/`verify_enabled` true, max 3). **Production: not verified** — the settings endpoint does not expose MFA, and the Slice 6 report states it is not enabled |
| ENROLLED | **No** — 0 verified factors, 0 amr claims, 0 recovery codes in production |
| ENFORCED | **No** — all six groups null; T0 |

**Magic link**

| Question | Answer |
|---|---|
| Where it remains | `/login` "Email me a link instead"; shared `/auth/callback` |
| Why | AG.2 T6 retires it; two of four production identities have never had a password |
| Can it bypass password/MFA intent? | **At T0, yes by design** — `block_magic_link_login = false` for all groups and no group is enforced, so a magic-link session reaches the app. D.2's "setup-restricted" treatment activates at T6 |
| Retirement stage | **T6**, after T5 + 14 days with no escalations |
| Permanent tests | `aal_enforcement` covers the flags; no suite proves the T6 setup-restriction end state |
| Status | **LEGITIMATELY DEFERRED** (AG.2 T6, restated in the Slice 6 report) |

---

## G. Multi-context / multi-role

| Layer | Status | Evidence |
|---|---|---|
| Data model | PRODUCTION VERIFIED | `role_assignments` supports many assignments per identity across clubs and teams |
| Server authority | PRODUCTION VERIFIED | `capability_decision` resolves per scope; matrices prove isolation |
| UI discovery | PRODUCTION VERIFIED | `listSwitchableContexts` in the `(app)` layout |
| UI context switching | PRODUCTION VERIFIED | `app/(app)/set-context.ts` |
| Persisted context | PRODUCTION VERIFIED | `ovalball_ctx` cookie |
| Stale-context invalidation | PARTIALLY IMPLEMENTED | `resolveActiveContext` falls back silently; no test names the stale case |
| Mobile UX | Not separately evidenced | — |
| Browser testing | PARTIALLY IMPLEMENTED | browser 42 exercises it; no dedicated multi-role journey |

**Plan-ownership finding.** Section **H** requires the active-context rule, but **no slice in AK owns
the context-switching UI**. It exists because it predates Phase 2. That is not a defect in the
product, but it *is* **MISSED PLAN OWNERSHIP**: no slice would have caught a regression in it, and
Slice 8 (People & Access) is the natural owner of the remaining stale-context work.

---

## H. Volunteer custom permissions

| Element | Status |
|---|---|
| Data model (`capability_overrides`, level provenance) | PRODUCTION VERIFIED |
| Capability override mechanism | PRODUCTION VERIFIED |
| Club Admin UI (`/club/permissions`) | PRODUCTION VERIFIED |
| Server enforcement (delegable keys only, ceilings) | PRODUCTION VERIFIED |
| **Presets — "Volunteer – Pitch Allocation", "– Calendar", "– Team Fixtures"** | **MISSED** (0 preset tables, no UI) |
| Tests | `capability_override_races.test.mts`, `club_admin_authority_matrix` |

**Overall: PARTIALLY IMPLEMENTED.** The engine and the Club Admin UI both exist, so the product
requirement ("Volunteer defaults read-only; Club Admin can control its permissions") is met. The three
named presets from V and AC are not built. Owner: **Slice 8**.

---

## I. Team Admin retirement

| Surface | Count | Status |
|---|---:|---|
| `role_definitions` canonical role | `TEAM_ADMINISTRATION` present | PRODUCTION VERIFIED (I: "Replaces `team_admin` (L8)") |
| RLS policies naming `team_admin` | **0** | PRODUCTION VERIFIED |
| Functions referencing `team_admin` | **17** | PARTIALLY IMPLEMENTED |
| TS/UI files referencing Team Admin | **55** | PARTIALLY IMPLEMENTED |
| Compatibility mapping | `team_permissions` view + INSTEAD OF trigger | intentional (Slice 2 compatibility) |

**Planned retirement slice: 10** (AK: "Drop … `team_permissions` …"). The canonical role has replaced
it; the string survives only through the declared compatibility view. **Status: PARTIALLY IMPLEMENTED,
NOT YET DUE for the drop.** Not a miss.

---

## J. People & Access / operator UI

| Requirement | Planned | Actual | Status |
|---|---|---|---|
| AB.5 club People & Access | Slice 8 | `/people` exists from earlier work | NOT YET DUE (Slice 8 owns the overhaul) |
| AC Effective Access panel with provenance | Slice 8 | `/club/permissions` reads the trail (Slice 3 made it read-only) | PARTIALLY IMPLEMENTED |
| AC presets | Slice 8 | absent | MISSED → Slice 8 |
| Club audit timeline | Slice 8 | absent | NOT YET DUE |
| **AB.1 Site Admin Users & Access detail tabs** | **Slice 7a** | **no tabs at all** | **PARTIALLY IMPLEMENTED** — see §K |

---

## K. Site Admin / master control

Authority model: **complete and verified**. Operator UI: **largely absent**.

| RPC | UI caller | |
|---|---|---|
| `site_set_account_state` | `admin/users/[userId]/actions.ts` | ✅ |
| `site_revoke_site_admin` | `admin/users/[userId]/actions.ts` | ✅ |
| `site_change_site_admin_profile` | `admin/site-admins/actions.ts` | ✅ |
| `site_register_created_identity` | `admin/users/new/actions.ts` | ✅ |
| `site_resend_account_setup` | `admin/users/new/actions.ts` | ✅ |
| `site_add_club_membership`, `site_transition_club_membership`, `site_assign_club_role`, `site_revoke_role_assignment`, `site_assign_team_role`, `site_set_player_team_membership`, `site_link_guardian`, `site_end_guardian_relationship`, `site_revoke_sessions`, `site_force_password_reset`, `site_revoke_invitation`, `site_set_capability_override`, `site_request_site_admin_grant`, `site_approve_site_admin_grant`, `site_reject_site_admin_grant`, `site_membership_history`, `site_team_history`, `site_family_history` | **none** | ❌ **17 of 23** |

Consequences worth naming:

- the **two-admin Site Admin grant cannot be performed through the product at all** — there is no
  screen to raise a request and none to approve one. 7c's machinery is reachable only from SQL;
- the three **provenance timelines** built in 7b answer a question no screen asks;
- **Team Memberships, Invitations and Audit History tabs do not exist** in any form.

Everything else in §12 of the brief is verified: Site Admin independent of club membership (SMC-18),
all seven profiles, Read Only refused every mutation (SAPM-02), explicit club support capabilities
retained, last-admin guard (SAG-13a–d), bootstrap documented and rehearsed.

---

## L. Impersonation

**NOT YET DUE — Slice 9.** `impersonation_sessions` absent; `internal.effective_person()` exists as a
deliberate stub returning `auth.uid()`; no cookie, header, banner, blocked-list or suite. AD's contract
(AAL2, reason, 30-minute expiry, view-only default, dual attribution, blocked areas) is unimplemented
and correctly so. AN-9 (notify after the session ends) remains open and is Slice 9's.

---

## M. Legacy invitation estate

| Table | Plaintext token | Can still ISSUE? | Can still REDEEM? | Rows in production | Retirement |
|---|---|---|---|---:|---|
| `access_invitations` | **No** (hashed) | canonical | canonical | 0 | — |
| `guardian_invitations` | Yes | **Yes** — `send_replacement_guardian_invitation` | `accept_guardian_invitation` | — | Slice 10 |
| `player_account_invitations` | Yes | **Yes** — `invite_player_account` | `accept_player_account_invitation` (email-bound; P0-5 closed) | — | Slice 10 |
| `invitations` | Yes | No RPC inserts | `accept_invitation` | **0** | Slice 10 |
| `site_admin_invitations` | Yes | No (7c dropped the INSERT policy) | `accept_site_admin_invitation` — now behind the two-admin gate | **1 pending `full`, expires 21 Sep 2026** | Slice 10 |
| `club_ovalball_invitations` | Yes (`token` SELECT-able by authenticated) | club-scoped | — | **0** | Slice 10 |

**Two legacy paths can still mint new plaintext-token credentials** (`send_replacement_guardian_invitation`,
`invite_player_account`). Slice 5's acceptance says "no plaintext token or code stored (PG-10)", and
**D-S5-AUTO-5/6** record the deliberate decision to keep the legacy token columns nullable and
column-limited "until the application moves". That authorises the *columns*; it does not obviously
authorise two live **issuers**. Classified **PARTIALLY IMPLEMENTED**, owner **Slice 10**, flagged for
the owner's ruling.

---

## N. Security / perimeter regression status (Phase 1 A.2)

| ID | Weakness | Current production | Test | Status |
|---|---|---|---|---|
| P0-1 | Anon INSERT on `players` | anon holds **no** write on any table; policy closed | `security_perimeter_guard` | CLOSED |
| P0-2 | Suspended self-reactivation | `authenticated` UPDATE revoked; policy has WITH CHECK; `account_state` not writable | `identity_security_containment` | CLOSED |
| P0-3 | `admin_fixture_overview` anon | anon SELECT revoked | `security_perimeter_guard` | CLOSED |
| P0-4 | GoCardless token to payers | both token functions revoked from `authenticated` | **12 `gocardless_*_regression` suites exist but are NOT WIRED** | CLOSED — **test not running** |
| P0-5 | Player-account invitation email binding | email compared | `invitation_authority_matrix` | CLOSED |
| H-1 | Team staff bypass family/roster approval | no write policy on `player_team_memberships` | `roster_authority_matrix` | CLOSED |
| H-2 | Guardian invite links any child | canonical guardian state machine | `family_relationship_state_machine` | CLOSED |
| H-3 | `team_people` exposes child/guardian pairs | object gone | `family_isolation_matrix` | CLOSED |
| H-4 | Guardians self-approve additional guardians | acceptance RPC required | `guardian_additional_requires_acceptance` | CLOSED |
| H-5 | Revoked authority resurrects | revival guard present | `membership_state_machine` | CLOSED |
| H-6 | Session-version bypass | `record_session_version` still executable, server-clamped since Phase 0 | `identity_security_containment` | ACCEPTED (H records the clamp) |
| H-7 | **Signup metadata poisoning (`ovalballSignupPayload`)** | **still present in the code path** | none | **OPEN** — Slice 5 was to remove it (S5-6) |
| M-1 | `list_suspended_club_memberships` anon | revoked | `security_perimeter_guard` | CLOSED |
| M-2 | Youth training/venues public | all four revoked from anon | `perimeter` suites | CLOSED |
| M-3 | Diagnostic view not read-only | site.support.view_club capability path | `site_admin_diagnostic_access` **(NOT WIRED)** | CLOSED — test not running |
| M-4 | Site Admin reads safeguarding via RLS | review RPC with reason + event | `safeguarding_officer_security` | CLOSED |
| M-5 | Plaintext tokens in six tables | see §M | partial | PARTIALLY CLOSED |

**One genuinely open Phase 1 item: H-7.** Everything else is closed, but three closures are guarded by
**unwired** suites.

---

## O. Production configuration checklist

Presence only. No value was read, and nothing was changed.

| Item | State | Evidence |
|---|---|---|
| Supabase Auth — Google provider | **PRESENT** | GoTrue `external.google = true`; one `email+google` identity |
| Supabase Auth — Apple provider | **ABSENT** | `external.apple = false` |
| Supabase Auth — Facebook provider | **ABSENT** | `external.facebook = false` |
| TOTP enrol/verify enabled | **UNVERIFIABLE from here** — settings endpoint does not expose MFA | 0 enrolled factors; Slice 6 report states not enabled |
| `max_enrolled_factors = 3` | UNVERIFIABLE | local set to 3 |
| Password minimum length 12 | **ABSENT** — local GoTrue receives 6; the config key used is not real | `GOTRUE_PASSWORD_MIN_LENGTH=6` |
| Password composition (AN-1) | **ABSENT** | `password_requirements` empty |
| Leaked-password protection | **ABSENT** | production advisor `auth_leaked_password_protection` |
| Secure password change (reauthentication) | **ABSENT** | `secure_password_change = false` |
| Session timebox / inactivity (AN-4) | UNVERIFIABLE | plan-dependent |
| CAPTCHA (native Turnstile) | UNVERIFIABLE | app-level Turnstile is implemented and verified server-side |
| Redirect URLs verified (apex vs www) | UNVERIFIABLE | Phase 1 recorded this as "documented inconsistently and unverified" |
| Email templates / SMTP for auth | Not audited here | — |
| `SUPABASE_SERVICE_ROLE_KEY` in Vercel | **UNVERIFIABLE from here** | required by Create User; carried from the Slice 7 report |
| `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED` | **PRESENT** | the button renders in production |
| `NEXT_PUBLIC_AUTH_APPLE_ENABLED` / `_FACEBOOK_` | **ABSENT** | buttons do not render |

---

## P. Test and runner coverage

| Measure | Value |
|---|---:|
| SQL suite files on disk | **269** |
| Wired into `run-platform-tests.sh` | **164** |
| **On disk, never run** | **105** |
| Wired names with no file | 0 |
| JS suites | 58, **all** auto-discovered by glob (cannot drift) |

**The runner's SQL list is hand-maintained, so drift is silent.** Among the 105 unwired are twelve
`gocardless_*_regression` suites (Phase 1 **P0-4** guards), `capability_engine`, `permission_matrix`,
`permission_management`, `player_guardian_security`, `parent_player_foundation_security`,
`claim_eligibility_and_enumeration`, `club_settings_capability_security`,
`season_handover_cross_club_security`, `site_admin_management`, `site_admin_diagnostic_access`,
`auth_session_versioning` and `player_movement_tamper_tests`.

**Phase 2 AJ suites absent entirely (by concern, not merely by filename):**

| Concern | Status |
|---|---|
| `recovery_code_attempt_limits` | **no wired coverage** |
| `minor_recovery_age_gate` | **no wired coverage** |
| `session_revocation_effect` (SQL) | only incidental; the JS race R13 covers the behaviour |
| `require_session.test.mts` | absent (the module has no callers to test) |
| `create_identity_server.test.mts` | absent (browser 62 covers the journey) |
| `recovery_code_route.test.mts` | absent |
| `service_role_usage.test.mts` + script | absent |
| `social_identity_grants_nothing` (SO-3) | absent |
| Browser 50 (social), 52 (minor onboarding), 40a (anon surfaces), 47/48 (Slice 8), 49 (Slice 9) | absent |

**Browser numbering drifted.** AJ.3's numbers 40–52 were already taken by an earlier series, so the
Slice 5/6/7 journeys were delivered as 60, 61 and 62. The journeys exist; the map does not match the
repository, which is how "browser 45, 46" reads as missing when it is not.

**Vacuous-control audit.** Three tests were found lying during Slice 7 and fixed: the profile matrix's
positive control accepted "function does not exist"; SMC-33 tested the session gate while claiming the
AAL2 gate; SMC-37 seeded the state the RPC wanted. No systematic sweep of the other 161 wired suites
for the same shapes has been done — that is itself a gap.

---

## Q. Deferment register

Every unfinished item. "Authorised by" must name a document; where it is blank, the item is **MISSED**,
not deferred.

| # | Item | Original owner | Current owner | Reason | Authorised by | Dependency | Completion condition | Owner action? | Blocks |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Production auth settings (TOTP, password length, leaked-password, secure change, CAPTCHA, timebox, redirects) | Slice 6 | owner | Config is not code | AK Slice 6 "Config (separately authorised)"; Slice 6 report §Deferred 1 | — | Settings applied and re-verified | **Yes** | **§B, T1–T7, all master control** |
| 2 | AN-3 second Full Site Admin | Slice 6 T1 / 7c | owner | Production has one | AN-3; AG.2 T1 | 1 | Bootstrap run per `SITE_ADMIN_BOOTSTRAP.md` | **Yes** | T2–T7, privileged recovery, Site Admin grants |
| 3 | T2 both FULL enrolled + break-glass rehearsed | Slice 6 T2 | owner | Needs 1 and 2 | AG.2 T2 | 1, 2 | Rehearsal evidence recorded | **Yes** | T3 |
| 4 | T3 PRIVILEGED enforcement + 24 h monitoring | Slice 6 T3 | owner | Needs T2 | AG.2 T3 | 3 | 24 h of expected denials only | **Yes** | T4 |
| 5 | T4 STAFF, T5 FAMILY/PLAYER/MINOR | Slice 6 | owner | Sequenced | AG.2 | 4 | Grace + monitoring | **Yes** | T6 |
| 6 | T6 magic-link retirement | Slice 6 | owner | 2 of 4 identities have no password | AG.2 T6; Slice 6 report §5 | 5 | 14 days clear after T5 | **Yes** | T7 |
| 7 | T7 / Slice 10 legacy sign-in removal | Slice 10 | Slice 10 | Sequenced | AK Slice 10 | 6 | Zero magic-link sessions for 30 days | No | — |
| 8 | AN-1 native password composition superset | Slice 6 | owner | Decision never taken | AN-1 (open) | 1 | Decision recorded and applied | **Yes** | closes the direct-API path |
| 9 | AN-4 plan feature verification | Slice 6 **precondition** | owner | Never done | AN-4 (open) | — | Settings read and recorded | **Yes** | was a Slice 6 entry gate |
| 10 | Legacy invitation tables and two live issuers | Slice 5 | Slice 10 | App has not moved | **D-S5-AUTO-5, D-S5-AUTO-6** (columns only) | — | Zero usage, then drop | No | PG-10 closure |
| 11 | Impersonation (AD) | Slice 9 | Slice 9 | Not yet due | AK Slice 9 | — | Slice 9 | No | — |
| 12 | Team Admin string retirement | Slice 10 | Slice 10 | Compatibility view still in use | AK Slice 10 | — | Drop `team_permissions` | No | — |
| 13 | `has_capability` adapter + deprecated keys | Slice 10 | Slice 10 | Dozens of live callers | AK Slice 10 | — | Zero references | No | — |
| 14 | Club People & Access overhaul (AB.5), Effective Access editing, presets, club audit timeline | Slice 8 | Slice 8 | Not yet due | AK Slice 8 | — | Slice 8 | No | — |
| 15 | Volunteer presets | Slice 8 (V/AC) | Slice 8 | Not built | AK Slice 8 (AC presets) | 14 | Slice 8 | No | — |
| 16 | **`requireSession` wiring** | Slice 6 | **unassigned** | — | **none** | — | — | No | defence in depth |
| 17 | **`/forgot-password`, `/account/setup`, `/account/suspended`** | Slice 6 | **unassigned** | — | **none** | — | — | No | **live 404 from /login** |
| 18 | **SO-2, SO-3, SO-4, SO-5, SO-6** | Slice 6 | **unassigned** | — | **none** | — | — | No | Apple/Facebook activation |
| 19 | **AN-12 FULL must hold email+password** | Slice 6 | **unassigned** | — | **none** | 2 | — | No | break-glass independence |
| 20 | **`ovalballSignupPayload` removal (H-7)** | Slice 5 | **unassigned** | — | **none** | — | — | No | Phase 1 H-7 stays open |
| 21 | **Users & Access detail tabs; 17 RPCs with no UI** | Slice 7a | **unassigned** | — | **none** | — | — | No | two-admin grant unusable |
| 22 | **105 unwired SQL suites** | Slice 1 (runner) | **unassigned** | — | **none** | — | — | No | silent regression risk |
| 23 | **`search_path` advisor 73; `pg_trgm` in public; service-role guard** | Slice 1 (AO C6/C10/C12) | **unassigned** | — | **none** | — | — | No | AO not met |
| 24 | AN-9 impersonation notification; AN-10 deletion/export; AN-13 retention; AN-14 token rotation | various | as recorded | Open decisions | AN | — | — | Some | — |

**Items 16–23 have no documentary basis for deferment and are therefore MISSED, not deferred.**

---

## R. Remaining Slice 8/9/10 contracts (from the original plan)

**Slice 8 — Club People & Access.** People & Access (AB.5), Effective Access with provenance and
editing (AC), presets, club audit timeline. Tests: browser 47, 48, `explain_access` parity.
Acceptance: a Club Admin cannot reach site controls or other clubs, directly or via UI; delegation
ceilings proven.

**Slice 9 — Impersonation.** `impersonation_sessions`, header plumbing in `lib/supabase/server.ts`,
`effective_person` (the stub becomes real), view-only restrictive policy, blocked list, banner. Tests:
impersonation suites + browser 49. Acceptance: AD fully proven; audit shows actor and effective person
for every act-as write.

**Slice 10 — Legacy retirement.** Drop compatibility columns and views (`account_status`,
`club_memberships.role/status/authority_suspended*`, `team_permissions`, `role_capability_defaults`,
`permission_groups*`, `site_admins` flags and `admin_role`), legacy invitation tables, deprecated
capability keys, magic-link code paths, the Phase 0 signup binding, legacy helpers. `no_role_literals`
shrink reaches 0. Acceptance: zero references in CI; full runner, clean boot and all browser suites
green; production usage telemetry zero for 30 days before each drop.

**Plus the T-stages** (T1–T7), which are operations, not slices.

### Can 8–10 absorb everything outstanding?

**No.** They absorb items 10–15 of §Q cleanly, and the T-stages absorb 1–9. They do **not** own:

| Orphan | Why 8/9/10 cannot take it |
|---|---|
| §Q-16 `requireSession` wiring | Slice 6 code; Slice 8 is club UI, 9 impersonation, 10 deletion |
| §Q-17 `/forgot-password`, `/account/setup`, `/account/suspended` | Slice 6 authentication surfaces |
| §Q-18 SO-2…SO-6 | Slice 6 social consistency |
| §Q-19 AN-12 | Slice 6 |
| §Q-20 `ovalballSignupPayload` / H-7 | Slice 5; Slice 10 drops "the Phase 0 signup binding" but H-7 is a *live vulnerability*, not cleanup |
| §Q-21 Users & Access tabs | Slice 7a |
| §Q-22 unwired suites | Slice 1 runner discipline |
| §Q-23 AO C6/C10/C12 | Slice 1 perimeter |
| §B master control unusable | Slice 7 built on an unmet Slice 6 precondition |

---

## S. Orphaned requirements

Nine, listed immediately above. They share one cause: **a slice was classified complete while items in
its own contract were outstanding, and no later slice inherited them.** Slice 6 accounts for five.

Putting them into Slice 8 would be exactly the "silently stuff missed Slice 6/7 work into Slice 8" the
brief prohibits. They need a named home.

---

## T. Recommended closure sequence before Slice 8

Nothing below is implementation; it is the order a closure would take.

**Stage 0 — unblock production (owner, no code).**
1. Apply the production auth settings (Q-1): TOTP enrol/verify, `max_enrolled_factors = 3`, password
   minimum 12, leaked-password protection, secure password change, redirect URLs.
2. Site Admin enrols TOTP. **This alone restores all 22 blocked RPCs (§B).**
3. Decide AN-1; record AN-4's answers.

**Stage 1 — Slice 6 closure (a named slice, "6b").** Orphans Q-16 to Q-19, plus S6-3, S6-5, S6-12,
S6-13, S6-17, browser 50 and 52:
`/forgot-password`, `/account/setup`, `/account/suspended`; the real `minimum_password_length`; the
validator on every password surface; `requireSession` wired; SO-2 (mandatory TOTP after social),
SO-3 (the named test), SO-4 (`auth_flow_states` replacing `ovalballSignupPayload`, which also closes
**H-7**), SO-5 and SO-6 (Linked Sign-In Methods); AN-12; the AG.3 upgrade interstitial.

**Stage 2 — Slice 7 closure ("7e").** Orphan Q-21: the AB.1 tabs, so the 17 orphaned RPCs and
especially the two-admin grant become usable; AB.4's Assignments step; `site_search_users`.

**Stage 3 — test-estate closure.** Orphans Q-22 and Q-23: triage all 105 unwired suites (wire, delete
with a reason, or record as superseded), starting with the twelve GoCardless P0-4 guards; add the
missing AJ coverage; sweep the 161 wired suites for vacuous positive controls; close AO C6, C10, C12.

**Stage 4 — T1 onward**, per AG.2, each separately authorised.

**Only then Slice 8.**

### Do not read the green suite as health

4,708 assertions pass across 223 wired suites. That number is compatible with everything above:
105 suites never run, three tests were found lying inside one slice, five Slice 6 contract items were
never built, and the most consequential Site Admin operation in the product cannot be performed in
production at all.
