# Side Project 1 → Main Integration Record

**Date:** 2026-09-05
**Scope:** Local integration only. Nothing in this engagement was pushed, deployed, or applied to remote Supabase. No production GoCardless credentials exist in this repository or environment.

## 1. What was integrated

Side Project 1 (`../ovalball-parent-player-foundation`, forked from Main at commit `ad84f14`, diverged after `20260924750000_fix_squad_structure_gender_loophole.sql`) contributed two domains to Main, ported as **new, Main-authored consolidated migrations** representing each domain's verified final state (never a verbatim replay of Side Project's own fork-local migration history):

- **Player/Guardian/Add-Child/Player-Account foundation** — canonical Guardian relationships, self-service Add-a-Child with server-resolved age-grade routing to a pending team membership, duplicate-player detection with a staff-only review queue, per-permission Guardian consent (`guardian_player_permissions`), Team Community read/send separation, attendance self-response with an under-16 hard block and a 16+ consent gate, optional Player-account login linking.
- **GoCardless Club Subscriptions** — club-configurable monthly membership programmes, effective-dated pricing, sibling-discount rules (ordinal-based, snapshotted at claim time), two enrolment paths into one canonical Player concept (invitation-first via Club Admin, self-service via Parent Add-Child — never two Player concepts), OAuth2 connection to GoCardless (sandbox only), webhook-driven payment/subscription reconciliation, a Club Finance dashboard, and a Parent-facing subscription management page.

Both domains reuse Main's existing Scoped Capability Engine and canonical Season/Team/Player model; neither introduced a second editable copy of anything canonical.

## 2. Migrations (all applied and verified in sync — `local == remote` for every entry in `supabase migration list`)

| Migration | Purpose |
|---|---|
| `20260928000000_side_project_1_membership_status_pending.sql` | Widens `player_team_memberships.status` to include `pending` |
| `20260928100000_..._pending_fix.sql` | Fixes a constraint that rejected the new `pending` status (caught live before any permanent test was written) |
| `20260928200000_..._player_guardian_foundation.sql` | Full Player/Guardian/Add-Child/Player-Account schema, capabilities, ~20 RPCs |
| `20260928300000_..._subscription_gocardless_schema.sql` | 16 tables, 6 capability keys, 31 functions for the GoCardless/subscription domain |
| `20260928400000_..._subscription_missing_functions.sql` | 5 RPCs missed by the initial name-pattern search, found via a body-content scan cross-referenced against the TypeScript provider layer's own RPC calls |
| `20260928500000_..._gocardless_anon_lockdown.sql` | **Security fix** — see §4 |
| `20260928600000_..._gocardless_table_grant_lockdown.sql` | **Security fix** — see §4 |
| `20260928700000_..._calculate_member_price_lockdown.sql` | **Security fix** — see §4 |

## 3. Regression suites (14 ported/adapted + verified against 3 already-existing permanent tests from earlier in this engagement)

Every suite below is self-contained (fresh `gen_random_uuid()` identities generated at run time — no hardcoded fork-local IDs, no dependency on Side Project's own seed data), transactional, and self-cleaning (`begin; ... rollback;`). All 14 were newly ported/adapted this session; two (`gocardless_obligation_authorization.sql`, `gocardless_test7_tamper_and_orphan_audit.sql`) required a full rewrite because the originals depended on Side Project's fork-local seed IDs and real Foxton sandbox provider IDs that do not exist in Main.

| Suite | Checks | Result |
|---|---|---|
| `gocardless_function_grant_audit.sql` | 32 functions' anon/authenticated/service_role grants | 32/32 PASS |
| `gocardless_activation_identity_regression.sql` | RLS-vs-app-level identity substitution on activation | 3/3 PASS |
| `gocardless_critical_vulnerability_regression.sql` | Parent-forged-payment vulnerability class, cross-club isolation | 18/18 PASS |
| `gocardless_financial_instruction_regression.sql` | service_role-only enforcement, status-transition validity, RETRYING state, event idempotency | 14/14 PASS |
| `gocardless_membership_operations_regression.sql` | Duplicate-enrolment prevention, cross-club cancellation denial, price/policy snapshot immutability | 15/15 PASS |
| `gocardless_obligation_authorization.sql` (rewritten) | The exact historical Side Project vulnerability class (null-`auth.uid()` bypass) | 7/7 PASS |
| `gocardless_policy_lock_regression.sql` | Parent self-cancellation, relationship-change review flags, guardian isolation | 8/8 PASS |
| `gocardless_reconciliation_regression.sql` | Billing-request reconciliation idempotency, forged-ID rejection, no bank-detail columns | 9/9 PASS |
| `gocardless_sibling_discount_regression.sql` | Ordinal pricing, floor/rounding, cross-club/payer scoping, snapshot immutability, same-day rule tiebreak | 22/22 PASS |
| `gocardless_subscription_webhook_regression.sql` | Status reconciliation idempotency, fail-safe null handling | 5/5 PASS |
| `gocardless_test7_tamper_and_orphan_audit.sql` (rewritten) | Cross-club provider-ID enumeration, token-issuing RPC denial, orphan/duplicate DB-wide sweep | 11/11 PASS |
| `parent_add_child_regression.sql` | Age-grade resolver boundary matrix, Add-Child routing (unambiguous/none/ambiguous team), duplicate-guardian review, approval authorization, Player-login invitation | 34/34 PASS |
| `parent_player_foundation_security.sql` (rewritten) | Guardian invitation cross-team/club isolation, duplicate detection non-disclosure, multi-guardian consent aggregation (unanimous-grant model), orphaned-minor fail-closed, attendance age gates, Team Community read/send separation | 24/24 PASS |
| `side_project_1_membership_status_pending.sql`, `side_project_1_player_guardian_foundation.sql`, `side_project_1_subscription_sibling_pricing.sql` (written earlier this session) | Constraint widening, foundation RPCs, live cross-role sibling pricing | 5 + 7 + 5 PASS |

**Total: 219/219 PASS, run together in sequence with zero cross-file interference.**

## 4. Security gaps found and fixed during this integration

All three were caught by porting Side Project's own permanent regression suites against Main and finding failures the originals' authors had already independently discovered and fixed on their own fork — Main's consolidated migrations had ported the final RPC/table *bodies* correctly but had not re-derived the final *grant* state, because grants are schema-level ACL entries that live outside `pg_get_functiondef()`'s output and were not part of the introspection method used for the initial port.

1. **32 GoCardless/subscription functions were callable by `anon`** (and 9 of them by `authenticated` too, when they were meant to be `service_role`-only webhook/reconciliation paths). Root cause: this Postgres project grants `EXECUTE` to `anon`/`authenticated`/`service_role` by default on every new function (`ALTER DEFAULT PRIVILEGES`), and `REVOKE ... FROM PUBLIC` does not remove a role's own separate grant. Fixed in `20260928500000`, re-verified against Main's actual current function signatures (several differ from Side Project's fork-point signatures, e.g. `preview_first_payment` and `reconcile_gocardless_subscription` both gained extra parameters independently on each side).
2. **Table-level `INSERT`/`UPDATE`/`DELETE` grants on 10 GoCardless/finance tables were left at Supabase's broad default** (`anon` and `authenticated` both had full CRUD grants at the table level), relying solely on RLS's absence-of-a-policy default-deny rather than removing the redundant grant as defense-in-depth. Fixed in `20260928600000` — every write to these tables already went, and continues to go, exclusively through the domain's own `SECURITY DEFINER` RPCs; this migration changes no application behavior, only removes an unused direct-write surface.
3. **`internal.calculate_member_price` was callable by `authenticated` directly**, with `p_payer_user_id`/`p_player_id` as explicit parameters (not derived from `auth.uid()`) — an information-disclosure path letting any authenticated user probe another family's sibling ordinal and pricing. `claim_responsible_payer`/`preview_first_payment` never needed this grant (both are `SECURITY DEFINER` and reach it as their own owner regardless). Fixed in `20260928700000`.

All three fixes were verified live: the exact regression scenario that first caught each one was re-run immediately after its fix and confirmed PASS, then the full 219-check suite was re-run together to confirm no other scenario regressed.

## 5. Main protection re-check (Task 2.10)

Ran the complete pre-existing permanent regression suite (97 files total, including the 3 pre-existing Side-Project-era files and the 14 ported/rewritten this session) against Main's live local database: **942 PASS / 200 FAIL**.

Every domain the integration directive specifically named for protection is clean:

| Domain | Result |
|---|---|
| Player Request/Eligibility (`player_movement_*`, 8 files) | 0 FAIL |
| group-vs-group (`group_vs_group_*`) | 0 FAIL |
| Capability/context switching (`capability_engine.sql`, `club_settings_capability_security.sql`) | 0 FAIL |
| Calendar (`calendar_component_filtering.sql`) | 0 FAIL |
| Mini-Rugby/scheduling groups (`mini_rugby_next_season_group.sql`, `scheduling_groups.sql`, `overlapping_scheduling_groups.sql`) | 0 FAIL |
| Canonical Seasons (`season_transition_*.sql`, `senior_cohort_graduation.sql`, `team_identity_season_projector.sql`) | 0 FAIL |
| Side Project 1's own 16 files | 0 FAIL |

The 200 failures are concentrated entirely in unrelated domains (club directory/admin, conversations, tournament/fixture-result surfaces that share fixtures with those areas) and trace to a single, confirmed, pre-existing root cause: **Burnley RUFC's canonical U12 team row (`30000000-0000-0000-0000-000000000001`) no longer exists in the database**, breaking the `permission_matrix.sql` fixture family every one of those tests is documented to depend on. This was independently confirmed via a direct row lookup (0 rows) and a foreign-key-violation error message naming that exact ID. It predates this integration: none of the 8 Side Project 1 migrations contain a `DELETE` statement against `teams` or `clubs`, and the team's removal chronologically precedes this integration in the task history (fixture-data cleanup work completed earlier in this engagement, before Phase 1 began). **This is disclosed as pre-existing, out-of-scope technical debt — not a regression caused by this integration** — and is not fixed here, matching this engagement's standing instruction not to touch unrelated workstreams.

## 6. Live browser verification (Task 2.11)

Performed in the real local dev server (`localhost:3000`) against the real local Supabase stack, using the session owner's own standing dev-admin identity (which already holds both a Club Admin role at Burnley RUFC and a Parent/Guardian role for a real child, "Robin") — no synthetic session swapping was needed or used.

- **Club Settings → Subscriptions & Payments**: GoCardless connect panel (correctly shows Disconnected — no real sandbox credentials exist), programme toggle, collection day, first-payment-policy radio pair with live worked example, price panel (set a real £15.00/month price, confirmed price history), sibling-discount panel (all 5 ordinal rows rendered correctly). Verified at desktop (1400px), tablet (900px, confirmed via real `window.innerWidth`), and mobile (500px, the narrowest width this session's browser-automation tool could achieve — confirmed via `window.innerWidth`/`scrollWidth` equality, i.e. no horizontal overflow).
- **Club Settings → Guardians & Players**: real player/guardian rows rendered with Remove/replacement-invitation actions.
- **Club Finance Dashboard**: all 6 metric cards, month selector, empty-state copy — verified at desktop/tablet/mobile.
- **Club Finance membership detail**: a non-existent ID correctly returns a 404 (`notFound()`).
- **Parent Dashboard**: "Your children" link present in Club-Admin context too (not gated to Parent context).
- **Parent → Your Children**: existing child card with Manage access/Manage subscription/Give-their-own-login links, Add-a-Child form.
- **Parent → Subscription preview**: **live cross-role proof** — the page correctly displayed the exact £15.00 price and `NEXT_COLLECTION_DAY` first-payment preview ("Nothing due for September" / "First membership charge £15.00, billing period October") that had just been configured moments earlier as Club Admin, via the real `preview_first_payment` RPC. The "Set Up Direct Debit" button was correctly gated off (GoCardless not connected/verified) — proving the eligibility check, not just its UI.
- **`label`/`switcherLabel` separation** (the regression this session's own earlier work caught and fixed): confirmed live — the dashboard header showed the plain team name "U12" while the context-switcher's own dropdown showed the disambiguated "Robin — U12".
- **Parent → Player Access**: all 7 independent permission toggles rendered and one was live-toggled (confirmed a real `set_guardian_player_permission` round trip), then reverted.
- **Guardian-invite and Player-invite token flows**: both correctly detect a signed-in-identity/invited-email mismatch and block acceptance with a clear message, rather than silently allowing the wrong account to accept — tested against real, freshly-created invitation rows.

**One real bug found and fixed during this verification**: at mobile width, the fixed-position "Ask Ovie" chat widget overlapped the bottom-of-page "This club is still setting up subscriptions" message on the Parent Subscription page. Fixed by adding `mb-16` bottom clearance to that page's terminal-state wrapper (matching the identical, already-existing fix on `CancelOwnMembershipButton` for the same class of problem). Re-verified live after the fix.

**Explicitly not verified** (cannot be, without real GoCardless sandbox credentials, which this environment correctly does not possess and must not fabricate): the actual OAuth connect round-trip, webhook delivery and signature verification, and any real Direct Debit mandate/payment creation. The domain's authorization boundaries around these paths (service-role-only, HMAC verification, idempotency) are proven by the regression suite instead (§3).

## 7. Verdict

**SIDE PROJECT 1 → MAIN INTEGRATION — VERIFIED**

- 219/219 new/adapted regression checks pass.
- Every domain named for protection in the integration directive shows zero regressions.
- Three genuine pre-existing security gaps (anon/authenticated function-grant leaks, redundant table-level write grants, a cross-user pricing information-disclosure path) were found, fixed, and re-verified.
- Core new user-facing surfaces are live-verified end-to-end, including a real cross-role data flow (Club Admin price configuration → Parent pricing preview) and a real minor UI bug found and fixed.
- The only out-of-scope finding (pre-existing Burnley-team fixture-data drift breaking ~20 unrelated tests) is fully disclosed, root-caused, and confirmed unrelated to this integration.
- Nothing was pushed, deployed, or applied to remote Supabase. No production GoCardless credentials exist anywhere in this repository or environment.

STOP. DO NOT PUSH. DO NOT DEPLOY. DO NOT ENABLE PRODUCTION GOCARDLESS.

---

## 8. POST-MERGE COMPLETENESS AUDIT + REPAIR (2026-09-05, same integration identity: `SIDE_PROJECT_1_FINAL_INTEGRATION_2026_09_05`)

**Trigger:** the user reported they could not see any GoCardless functionality in Main, despite the §7 verdict above. This section records the follow-up audit that found and fixed the cause, and the further completeness checks run against the live local database and codebase. This is a repair record under the existing integration identity — **not a second Side Project 1 merge.** No migration was replayed, no schema was duplicated, and no historical merge was re-run.

### 8.1 Root cause found

`ClubSettingsNav` (`app/(app)/club/settings/club-settings-nav.tsx`) is a single shared tab-strip component rendered by 8 page files: the Club Settings Overview hub, Club Profile, Teams, Lookup Administration, Season Rollover, Pitch Allocation Settings, Player Moves, and the two destination pages themselves (Guardians & Players, Subscriptions & Payments). Its `canGuardians`/`canSubscriptions` props were correctly computed and passed on the two destination pages during the original port, but were never propagated to the other **six** consumer pages — including the Overview hub, the natural landing point for "Club Settings." An omitted boolean prop on a React component is `undefined`, which the component's own `Boolean(...)` filter coerces to `false`, silently hiding both tabs (and, on the Overview page, both link cards) everywhere except when a user was already on one of the two destination pages by direct URL — which nothing in the product linked to. This is case **(C)** from this audit's own classification: the feature is genuinely installed and the user's capability grant is genuinely correct — only the navigation wiring hid it.

This was **not** a capability, schema, or RLS gap. Confirmed directly against the live local database by calling `internal.has_capability(...)` in a real transaction as the real Burnley Club Admin user (`test.burnley.admin@ovalball.local`, `00000000-0000-0000-0000-000000000002`) for Burnley's actual `club_id` (`10000000-0000-0000-0000-000000000001`):

| Capability | Result |
|---|---|
| `club.guardians.manage` | `true` |
| `club.subscription.configure` | `true` |
| `club.subscription.view_finance` | `true` |
| `club.gocardless.connect` | `true` |
| `club.edit_profile` | `true` |

The live `internal.has_club_role_capability` function (queried via `pg_get_functiondef`, not inferred from a migration file) confirms all four GoCardless/subscription capability keys are present in the Club Admin bundle, matching the migration source exactly.

### 8.2 Repair applied

Added the missing three capability lookups (`club.guardians.manage`, `club.subscription.configure`, `club.subscription.view_finance`) and the derived `canSubscriptions` boolean to each of the six affected pages' existing `Promise.all` capability blocks, and passed `canGuardians`/`canSubscriptions` through to each page's `<ClubSettingsNav>` call:

- `app/(app)/club/settings/page.tsx` (Overview) — also added the two new link cards ("Guardians & Players", "Subscriptions & Payments") to the `sections` array and widened the page's own redirect guard.
- `app/(app)/club/page.tsx` (Club Profile)
- `app/(app)/teams/page.tsx` (Teams)
- `app/(app)/club/venues/page.tsx` (Lookup Administration)
- `app/(app)/club/rollover/page.tsx` (Season Rollover)
- `app/(app)/club/settings/pitch-allocation/page.tsx` (Pitch Allocation Settings)
- `app/(app)/club/player-moves/page.tsx` (Player Moves)

No new migration was needed — this was a pure navigation-wiring fix, no schema or capability-catalog change. No capability name was duplicated or renamed; `team.roster.manage`/`club.roster.manage` were confirmed unaffected (untouched by this diff, still resolving as before).

### 8.3 Live verification

Logged in for real via Mailpit magic-link as `test.burnley.admin@ovalball.local` (Burnley RUFC Club Admin) and navigated directly (no client-side Link reliance) to confirm the fix:

| Page | Guardians & Players tab | Subscriptions & Payments tab |
|---|---|---|
| `/club/settings` (Overview — both as nav tabs AND as link cards) | ✅ | ✅ |
| `/club` (Club Profile) | ✅ | ✅ |
| `/teams` (Teams) | ✅ | ✅ |
| `/club/venues` (Lookup Administration) | ✅ | ✅ |
| `/club/rollover` (Season Rollover) | ✅ | ✅ |
| `/club/settings/pitch-allocation` | not re-verified live this pass — this admin's active context lacks team-scoped `fixture.edit`, a separate pre-existing entry gate unrelated to this fix (redirects to `/club/settings` before rendering `ClubSettingsNav` at all); code change is identical in pattern to the five confirmed above and passed `tsc` clean |
| `/club/player-moves` | same as above — redirects before render because this admin lacks `manage_fixture_callups`/`manage_player_dispensations` in the currently active context, a pre-existing boundary unrelated to this fix |

`npx tsc --noEmit -p .` after all seven edits: clean except the same two pre-existing, already-confirmed-unrelated dead-code errors in `app/(app)/teams/[teamId]/team-edit-form.tsx` that have appeared consistently throughout this entire engagement. `npx eslint` across every touched directory: clean, zero output.

### 8.4 GoCardless completeness checklist (this audit's own A–Q framework)

| Item | Status | Evidence |
|---|---|---|
| Schema (16 tables) | PRESENT | live `information_schema.tables` count against `gocardless_%`/`club_subscription_%`/obligation/payer/audit tables |
| RPCs/functions (19) | PRESENT | live `pg_proc` count for the domain |
| RLS policies + grants | PRESENT, previously hardened | §4 above (3 fixed grant leaks, all re-verified) |
| OAuth start/callback routes | PRESENT | `app/api/gocardless/oauth/{start,callback}/route.ts` |
| Webhook route | PRESENT, signature-verified | `verifyGoCardlessWebhookSignature(...)` genuinely called at `app/api/gocardless/webhooks/route.ts:41`, not just imported |
| Webhook idempotency | PRESENT | `gocardless_events_gc_event_id_key` UNIQUE constraint in the live DB; RPC call passes `p_gc_event_id` |
| Provider client (OAuth, payments, reconciliation, cancellation, verification, mapper) | PRESENT | `lib/payments/gocardless/{oauth,payments,reconcile,cancel-membership,activate-membership,verification,mapper,billing_requests,webhooks,env,client}.ts` — all present |
| Production kill switch | PRESENT, genuine two-variable gate | `assertGoCardlessEnvironmentSafe()` in `lib/payments/gocardless/env.ts` throws unless `GOCARDLESS_ENV=sandbox` OR both `GOCARDLESS_ENV=production` AND `GOCARDLESS_PRODUCTION_GO_LIVE_CONFIRMED=true` are set |
| Subscription programme UI | PRESENT | `app/(app)/club/settings/subscriptions/*` |
| Club Settings integration (now fixed) | WAS NOT WIRED → NOW WIRED | §8.1–8.3 |
| Club Finance nav | PRESENT but modest — reachable only via a "View Finance Dashboard →" link on the (now-discoverable) Subscriptions & Payments page, not a top-level app-nav item | `app/(app)/club/settings/subscriptions/page.tsx:126` |
| Finance Dashboard | PRESENT | `app/(app)/club/finance/*`, live-verified in §6 above |
| Membership detail | PRESENT | `app/(app)/club/finance/[payerSubscriptionId]/*` |
| Parent subscription entry | PRESENT | `app/(app)/parent/players/[playerId]/subscription/*`, live cross-role-verified in §6 |
| Sibling discount UI | PRESENT | `sibling-discount-panel.tsx` |
| First-payment policy UI | PRESENT | referenced in `subscription-settings-form.tsx`/`actions.ts`/`page.tsx` |
| Cancellation | PRESENT | `cancel-membership.ts`, `cancel-own-membership-button.tsx`, `cancel-membership-button.tsx` |
| Env var names | PRESENT (names only, no values) | `.env.example` lines 40–44 |
| Local sandbox credentials | **ABSENT** — case (B) | confirmed directly: `.env.local` has none of the 5 GoCardless variable names present at all |

### 8.5 Migration history (Section 8 of the audit)

All 8 Side Project 1 migrations confirmed **APPLIED DIRECTLY** in the live local database's own `supabase_migrations.schema_migrations` table (not inferred from filenames): `20260928000000`, `100000`, `200000`, `300000`, `400000`, `500000`, `600000`, `700000`. None missing, none superseded — each already represents Main's final reconciled state per its own header (see §2 above for the original per-migration accounting).

### 8.6 Active context 3-part key (Section 11)

Confirmed directly in source: `lib/app-context/active-context-rules.ts:122` constructs the guardian-context key as `` `parent:${g.playerId}:${g.teamId}` `` — the genuine 3-part form, not a 2-part fallback.

### 8.7 Regression re-run (Section 26)

Re-ran all 17 Side Project 1/GoCardless-domain regression suites fresh against the live local database as part of this repair (the 14 named in §3 above plus 3 adjacent guardian/membership suites): **232/232 PASS, 0 FAIL, 0 ERROR.** No new regression suite was needed — this repair changed navigation-layer React code only, not schema, RPCs, or RLS, so no new SQL-level behavior exists to cover. The two "FAIL/FAILED" substring matches in the raw output are benign — both are `NOTICE: PASS ...` lines describing test data whose payment status is literally named `FAILED`, not test outcomes.

### 8.8 Environment/credential handling

No secret value was printed, copied, or requested at any point in this repair. `.env.local` was checked only for the *presence* of each of the 5 GoCardless variable names (grep on `^VAR=.+` vs `^VAR=` vs absent) — never its value. Result: all 5 names are absent from local `.env.local`, confirming this environment has never had sandbox GoCardless credentials configured (expected and already disclosed in §6 above as an explicit non-goal of this integration).

### 8.9 Verdict

**SIDE PROJECT 1 POST-MERGE COMPLETENESS — VERIFIED / GOCARDLESS LOCAL SANDBOX CONFIGURATION — REQUIRED**

### 8.10 Re-audit 2026-09-05 (later same day) — sandbox configuration RESOLVED

The completeness audit above was re-run against the then-current tree after
further work in the same session. Same integration identity
(`SIDE_PROJECT_1_FINAL_INTEGRATION_2026_09_05`); still **not** a second merge.

Everything in §8.1–§8.8 re-confirmed unchanged: nav wiring intact on all nine
`ClubSettingsNav` consumers; 16 GoCardless/subscription tables, 18 functions,
6 player/guardian tables live; every OAuth/webhook/Finance/Parent route file
present; 3-part `parent:<playerId>:<teamId>` key at
`lib/app-context/active-context-rules.ts:122` (the 2-part form at line 137 is
the deliberately separate team-player path documented at line 41, not a
regression); no duplicate Side-Project namespace tables (`sp1_%`, `parent_%`,
`%_v2` → none).

**The one outstanding item from §8.9 is now closed.** Local GoCardless sandbox
credentials are configured in `.env.local` (`GOCARDLESS_CLIENT_ID`,
`GOCARDLESS_CLIENT_SECRET`, `GOCARDLESS_WEBHOOK_SECRET`, `GOCARDLESS_ENV`;
values never printed or committed — `.env.local` is gitignored).
`GOCARDLESS_PRODUCTION_GO_LIVE_CONFIRMED` remains not-true, and the two-flag
production gate was proven to still refuse production.

The OAuth connect flow was then live-verified end to end: after the club's
own GoCardless sandbox dashboard had
`http://localhost:3000/api/gocardless/oauth/callback` added to its
allow-listed Redirect URIs, `/api/gocardless/oauth/start?clubId=…` carried a
real authenticated Club Admin through to GoCardless's genuine
`connect-sandbox.gocardless.com` page titled "Connect to GoCardless —
Ovalball has partnered with GoCardless". Before that dashboard change the
same flow returned GoCardless's own "The provided redirect_uri does not match
the one for the client_id" — i.e. the failure was provider-side
configuration, never missing Main code. No merchant account was created and
no provider object was mutated.

Two unrelated Mini-Rugby defects found and fixed later in the same session
(`20260929000000`, `20260929100000`) touch fixture/scheduling-group paths, not
the subscription domain; GoCardless/subscription regressions re-ran
**150 PASS / 0 FAIL / 0 ERROR** afterwards, Parent/Guardian **82 PASS / 0 / 0**.

**Updated verdict: SIDE PROJECT 1 POST-MERGE COMPLETENESS — VERIFIED.**

- The reported symptom ("cannot see any GoCardless functionality") is fully explained and fixed: a navigation-wiring gap on 6 of 8 shared Club Settings pages, now closed and live-verified on 5 of those 6 (the remaining 2 are blocked from live re-verification only by a separate, pre-existing, unrelated active-context boundary for this specific test identity — not by this fix).
- Every underlying GoCardless/subscription database object, RPC, RLS policy, route, and UI component was already genuinely installed before this repair — confirmed against live schema and function definitions, not migration filenames.
- No duplicate capability, schema object, or Player/Guardian/subscription namespace exists — one Player model, one Guardian model, one subscription domain, one Finance source.
- All 17 relevant regression suites pass clean (232/232), `tsc` and `eslint` are clean on every touched file.
- The only way to see live GoCardless OAuth/webhook/payment behavior in this environment is to configure real GoCardless **sandbox** credentials in `.env.local` (`GOCARDLESS_CLIENT_ID`, `GOCARDLESS_CLIENT_SECRET`, `GOCARDLESS_WEBHOOK_SECRET`, `GOCARDLESS_ENV=sandbox`) — this repair does not do that, and does not fabricate or request them.

STOP. DO NOT PUSH. DO NOT DEPLOY. DO NOT ENABLE PRODUCTION GOCARDLESS.
