# Main Production Release Readiness

**Date:** 2026-09-06
**Status:** READ-ONLY / LOCAL release gate. Nothing in this document has been executed. No push, migration, or deployment occurred while producing it.

## A. Proposed release commit

`60477c1` (`docs(integration): record local test-pollution cleanup completion`) — Main's current local `main` HEAD, working tree clean.

## B. Origin baseline

`origin/main` = `fc0d248` (`docs(commercial): Phase A audit of the commercial platform`). Recalculated directly from Git in this session, not assumed. `origin/main` already contains Side Project 1 (GoCardless, player/guardian foundation) and the passwordless/social-auth/Turnstile work — those are **not** part of this release range; they shipped previously.

## C. Release commit range

`origin/main..HEAD` — **28 commits**, recalculated directly (`git rev-list --left-right --count origin/main...HEAD` → `0  28`). Pure linear history: every commit has exactly one parent, the chain's root parent is `origin/main` itself, zero merge commits, zero divergence. Fast-forward confirmed possible (`git merge-base --is-ancestor origin/main HEAD`).

## D. Workstreams included

Chronological (oldest first), classified:

| # | Commit | Workstream | Note |
|---|---|---|---|
| 1 | `2161665` feat(onboarding): require club authority before adding a child | **COMMERCIAL** (security) | Closes a real pre-existing vulnerability: any signed-in user could create a player/guardian identity at any active club. Ties to the invite-only requirement. |
| 2 | `16c8fd9` feat(platform): record releases, Beta append-only history | COMMERCIAL | |
| 3 | `bee950c` feat(platform): thirty usable trial days | COMMERCIAL | |
| 4 | `08ef177` feat(platform): Standard and Pro, Pro closed | COMMERCIAL | |
| 5 | `e5ffd84` feat(platform): club subscriptions to Ovalball, credit ledger | COMMERCIAL | |
| 6 | `8af2bec` feat(platform): Ovalball's own GoCardless domain, gated off | COMMERCIAL | Distinct `platform_*` namespace from Side 1's club-member billing — deliberate, audited separation. |
| 7 | `edd1e27` feat(platform): referral rewards on collected first payment | COMMERCIAL | |
| 8 | `54700b1` feat(admin): release, platform mode, commercial overview | COMMERCIAL | |
| 9 | `f394baa` feat(club): the Ovalball Plan page | COMMERCIAL | |
| 10 | `6b791e4` feat(signup): club-first framing, trial at activation | COMMERCIAL | |
| 11 | `292456a` feat(legal): platform + referral terms | COMMERCIAL | |
| 12 | `6932a03` test(platform): role-switched RLS sweep | COMMERCIAL | Security regression, not product code. |
| 13 | `d952018` fix(legal): JSX whitespace bug | COMMERCIAL | Trivial. |
| 14 | `c60c083` feat(platform): spec reconciliation — Beta badge, System Health, referral CTA | COMMERCIAL | Last pre-Side2 commit; the earlier remediation's own safety-point tag. |
| 15 | `fcd0731` Side Project 2: Training Management foundation | SIDE PROJECT 2 | |
| 16 | `6989a51` Training Management: browser verification, 3 bugs fixed | SIDE PROJECT 2 | |
| 17 | `7be714c` feat(training-management): pitches, cancellation, attendance, notifications | SIDE PROJECT 2 | |
| 18 | `054bd1b` feat(calendar): fixture lifecycle hardening | SIDE PROJECT 2 | |
| 19 | `310f6d7` chore(integration): renumber Side2 migrations | POST-INTEGRATION FIX | |
| 20 | `daf7121` fix(integration): fixture-model docs, SQL syntax bug, types | POST-INTEGRATION FIX | |
| 21 | `55caa68` docs(integration): pre-integration remediation report | DOCUMENTATION | |
| 22 | `6e2591a` docs(integration): correct commit range | DOCUMENTATION | |
| 23 | `f40e6c8` fix(integration): restore Main's identity/ports after Side2 fast-forward | POST-INTEGRATION FIX | The project-identity leak fix. |
| 24 | `31e5068` docs(integration): Side Project 2 integration record | DOCUMENTATION | |
| 25 | `d81ca91` fix(tests): season_rollover.sql commit→rollback | POST-INTEGRATION FIX | Root cause of the Burnley duplicate-training-session finding. |
| 26 | `4dd0f1b` fix(training): Training Plan regeneration past-occurrence dedup | POST-INTEGRATION FIX | Real product idempotency defect, fixed, regression-covered. |
| 27 | `9af1a9f` docs(integration): record proven root cause | DOCUMENTATION | |
| 28 | `60477c1` docs(integration): record cleanup completion | DOCUMENTATION | |

No SIDE PROJECT 1 or AUTH commits in this range — both already shipped on `origin/main`. No commit flagged as not belonging.

## E. Pending migration inventory (source: `npx supabase migration list`, read-only)

**27 pending**, not 24+1 — recalculated from the CLI's own local/remote comparison, not assumed. No duplicate versions among all 225 local files. No remote-only migration unknown to local Main (`remote`-only set is empty). Pending versions are monotonic with no gaps.

| Version | File | Workstream | Destructive? | Backfill? | RLS/Grant/Fn | Cron | Risk |
|---|---|---|---|---|---|---|---|
| 20260930000000 | policy_acknowledgements.sql | COMMERCIAL | No | No | New table + RLS | — | New table only |
| 20260930100000 | invite_only_add_child_guard.sql | COMMERCIAL (security) | No | No | Function replace | — | Tightens auth on `add_child_for_guardian`; makes one old test assertion stale (see §K) |
| 20261001000000 | platform_release_and_mode.sql | COMMERCIAL | No | Seeds 1 row | New tables + RLS | — | Seeds `platform_mode_events` = `'beta'`, guarded `where not exists` (idempotent) |
| 20261002000000 | platform_trials.sql | COMMERCIAL | No | No | New tables + RLS + grants | **Yes** — schedules `process-due-trials` | See §I cron audit |
| 20261003000000 | platform_plans_entitlements.sql | COMMERCIAL | No | No | New tables + RLS | — | `platform_entitlements`/`platform_plan_entitlements` intentionally public-read (pricing data) |
| 20261004000000 | platform_club_subscriptions.sql | COMMERCIAL | No | No | New tables + RLS | — | New tables only |
| 20261005000000 | platform_gocardless.sql | COMMERCIAL | No | No (fn-body UPDATEs only) | New tables + RLS + grants | — | Ovalball's own billing domain; `OVALBALL_SAAS_BILLING_ENABLED` unset everywhere |
| 20261006000000 | platform_referrals.sql | COMMERCIAL | No | No (fn-body UPDATEs only) | New tables + RLS + grants | — | New tables only |
| 20261007000000 | platform_commercial_overview.sql | COMMERCIAL | No | No | New table | — | Read-only overview |
| 20261008000000 | activation_starts_trial.sql | COMMERCIAL | No | No | Function only | — | |
| 20261009000000 | mode_events_no_direct_insert.sql | COMMERCIAL | No | No | RLS tightening | — | Removes direct-insert path, forces the audited RPC |
| 20261010000000 | beta_badge_and_release_link.sql | COMMERCIAL | No | No | Grant (`platform_public_state` to anon) | — | Verified safe-for-anon by its own `comment on function` — no club data, no unpublished release |
| 20261011000000 | training_management_schema.sql | SIDE PROJECT 2 | No | No | New tables + RLS | — | Extends existing `training_sessions`, doesn't redefine it |
| 20261011010000 | recurrence_and_generation.sql | SIDE PROJECT 2 | No | No (fn-body) | Functions + grants | — | |
| 20261011020000 | manual_reconciliation_and_reads.sql | SIDE PROJECT 2 | No | No | Functions + grants | — | |
| 20261011030000 | schedule_rule_fk_fix.sql | SIDE PROJECT 2 | No | No | FK replace (`ON DELETE SET NULL`) | — | Column is brand-new in this same batch — no pre-existing data at risk |
| 20261011040000 | reactivate_plan_restores_cancelled_sessions_fix.sql | SIDE PROJECT 2 | No | No (fn-body) | Function replace | — | Superseded in behavior by `20261011140000` below |
| 20261011050000 | training_card_fields_and_cancellation.sql | SIDE PROJECT 2 | No | No | Column adds + FK | — | |
| 20261011060000 | training_session_actions_and_notifications.sql | SIDE PROJECT 2 | No | No (fn-body) | Functions + grants | — | |
| 20261011070000 | training_attendance.sql | SIDE PROJECT 2 | No | No | Alters existing `player_fixture_attendance`: drops NOT NULL on `fixture_id`, adds `training_session_id`, adds `num_nonnulls(...) = 1` CHECK | — | Safe against existing rows: every existing row already has `fixture_id` non-null and the new column defaults null → check holds automatically |
| 20261011080000 | training_session_card.sql | SIDE PROJECT 2 | No | No | Function + grant | — | |
| 20261011090000 | ambiguous_id_fix.sql | SIDE PROJECT 2 | No | No | Function replace | — | |
| 20261011100000 | alias_shadow_fix.sql | SIDE PROJECT 2 | No | No | Function replace | — | |
| 20261011110000 | training_my_players_for_session.sql | SIDE PROJECT 2 | No | No | Function + grant | — | |
| 20261011120000 | duplicate_function_overload_fix.sql | POST-INTEGRATION FIX | `DROP FUNCTION` x2 | No | Drops 2 stale short-signature overloads | — | Self-inflicted duplicate overload from earlier in Side2's own build (Postgres treats differing arg-counts as separate functions); confirmed the current complete signature is defined earlier in this same batch |
| 20261011130000 | calendar_fixture_lifecycle.sql | SIDE PROJECT 2 | No | No | Functions + grants | — | Cancel/Delete Fixture use Main's pre-existing `fixture.cancel` capability path |
| **20261011140000** | training_plan_regenerate_past_occurrence_dedup_fix.sql | POST-INTEGRATION FIX | No | No | New partial unique index + 2 function replaces | — | **The occurrence-idempotency fix — confirmed present, confirmed last in canonical order** |

No `DROP TABLE`, `TRUNCATE`, or bare top-level `DELETE`/backfill `UPDATE` anywhere in the 27. No `ALTER COLUMN ... SET NOT NULL` and no `ADD COLUMN ... NOT NULL` without a default anywhere (checked explicitly, not inferred) — zero risk of an existing-data NOT NULL violation. Every `UPDATE` found is inside a function body (runs only when the RPC is later called, not at migration-apply time).

## F. Migration risk review (Section 5 detail)

- **RLS policy replacements**: all `drop policy if exists` / `create policy` pairs target brand-new `platform_*` or `training_*` tables introduced in this same range — no pre-existing production policy is weakened, because there is no pre-existing policy on these tables to weaken.
- **Anon grants**: two found — `platform_public_state()` (self-documented as safe: mode + published version only, no club data) and `platform_entitlements`/`platform_plan_entitlements` SELECT (public pricing/feature data, matching a pricing page's own requirements). Both reviewed and judged intentional and correctly scoped.
- **`training_plans`/`training_plan_schedule_rules` SELECT is `using (true)` with no `to` clause** (applies to all roles, including anon) — the migration's own comment states this matches the existing precedent that individual `training_sessions` rows (and fixtures) are already publicly readable in this app (a public schedule-browsing design, not a new leak).
- **FK/constraint changes**: the one non-additive FK change (`20261011030000`) touches a column that is itself brand-new in the same migration batch — no existing row can be affected.

## G. Security/RLS review

No RLS disable statement anywhere in the range. No weakened policy on any pre-existing table. One genuine security **tightening** (`20260930100000`, closes a real add-child vulnerability) ships in this release.

## H. Cron review (Section 9)

Canonical migration (`20261002000000_platform_trials.sql`):

- **Job name**: `process-due-trials`
- **Schedule**: `*/15 * * * *` (every 15 minutes)
- **Target function**: `internal.process_due_trials()`
- **Idempotency**: `perform cron.unschedule('process-due-trials')` wrapped in `exception when others then null` (safe first-run-or-not), followed by `cron.schedule(...)` — this is the exact pattern the migration's own comment says three existing jobs already use in this project, and it is **re-runnable without creating a duplicate job** (unschedule-then-schedule, not schedule-only).
- The migration's own comment ("this migration only ever touches the local database") reflects this development session's own local-only testing, **not** a structural constraint — `pg_cron` requires the extension's database to match `cron.database_name` (normally `postgres`), which Supabase's own production database is named, so `CREATE EXTENSION IF NOT EXISTS pg_cron` is expected to succeed there (and is a no-op if already enabled, which the commercial platform's own Phase A audit already found true for three other jobs).
- **Whether the job already exists remotely, and whether applying this migration will create it correctly**: **not verifiable from this local read-only session** — the CLI-based `migration list` comparison confirms the *migration itself* hasn't been applied to production, but does not expose `cron.job` contents on the remote database. This must be confirmed by whoever applies the migration, immediately after, via `select * from cron.job where jobname = 'process-due-trials';` on the production database.
- **Classification: PRODUCTION READY**, conditional on that one post-apply verification step being performed (Section J below).

## I. Commercial platform / Beta safety

- `platform_mode_events` seed row is explicitly `'beta'`, inserted only `where not exists (select 1 from platform_mode_events)` — idempotent, and since this table doesn't exist in production yet, its very first row will be Beta. Nothing in this range writes any other mode.
- `OVALBALL_SAAS_BILLING_ENABLED` is compared with `=== "true"` (strict string equality) everywhere it's read — fails closed by default, confirmed unset in every environment this session could inspect.
- `GOCARDLESS_PRODUCTION_GO_LIVE_CONFIRMED` — same fail-closed pattern, unchanged by this release.
- Pro plan status remains `"coming_soon"` in `lib/platform/plans.ts`, enforced at the database level per that file's own comment.
- No pending migration or diff line flips any of the above.

## J. Auth / configuration state

- **Zero auth-mechanism changes** in this release range. The only auth-adjacent diff is a cosmetic copy change on `app/login/page.tsx`'s footer (two links instead of one — "Bring it to Ovalball" / "Invited by your club?"). Turnstile, passwordless flow, social-auth, and redirect URLs are unchanged from `origin/main`'s current (already-shipped) state.
- **Production environment variables cannot be queried from this local session** — this session only has access to the local `.env.local`/`.env.example`, not the actual hosting platform's configured environment. Reported here is what the *code in this release* requires, cross-referenced against local dev config only as a sanity check — **production presence must be confirmed separately by whoever manages the deployment platform**:

| Variable | Required by | Local dev state | Production state |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `..._PUBLISHABLE_KEY` | Core app | PRESENT (local) | **VERIFY SEPARATELY** |
| `SUPABASE_SERVICE_ROLE_KEY` | GoCardless OAuth/webhook routes (already shipped) | MISSING/EMPTY (local) | **VERIFY SEPARATELY** — required if those routes are live |
| `GOCARDLESS_CLIENT_ID/SECRET/WEBHOOK_SECRET/ENV` | Side 1 (already shipped) | PRESENT (local, sandbox) | **VERIFY SEPARATELY** |
| `GOCARDLESS_PRODUCTION_GO_LIVE_CONFIRMED` | Side 1 kill switch | MISSING/EMPTY (local) — correct | INTENTIONALLY DISABLED (expected) |
| `GOCARDLESS_PLATFORM_ACCESS_TOKEN` / `..._WEBHOOK_SECRET` | New in this release (Ovalball's own billing) | MISSING/EMPTY (local) — correct, not needed for this release | INTENTIONALLY DISABLED (expected) |
| `OVALBALL_SAAS_BILLING_ENABLED` | New in this release | MISSING/EMPTY (local) — correct | INTENTIONALLY DISABLED (expected) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Already-shipped auth | MISSING/EMPTY (local) | **VERIFY SEPARATELY** — required if Turnstile-gated flows are live |
| `NEXT_PUBLIC_AUTH_GOOGLE/FACEBOOK/APPLE_ENABLED` | Already-shipped auth | MISSING/EMPTY (local) | **VERIFY SEPARATELY** |

None of the above are new *requirements* introduced by this release except the three explicitly-still-disabled platform-billing variables, which this release does not need set to ship safely (billing stays off either way).

## K. Regression results

Ran fresh at final HEAD (`60477c1`), not reused from earlier in the engagement:

| Suite | Result |
|---|---|
| `auth_session_versioning.sql` | 100% PASS (initial FAIL count was a false-positive grep match on a header comment) |
| `permission_matrix.sql` | 8 FAIL / 1 ERROR — **proven pre-existing**: traced to the exact same team UUID (`30000000-...-0001`) and root cause already documented in `docs/SIDE_PROJECT_1_INTEGRATION_RECORD.md` §5, dated 2026-09-05, predating Side2's fork. Not a regression from this release. |
| `player_guardian_security.sql` | Clean |
| `player_movement_*` (6 files) | All clean |
| `team_scoped_fixture_requests.sql` | Clean |
| `mini_rugby_next_season_group.sql` | Clean |
| `mini_rugby_training_reconciliation_check.sql` | Clean (expected PARTIAL Mini-Rugby finding reported accurately, not fabricated as fixed) |
| `season_rollover.sql` | Clean (post-fix) |
| `side_project_1_player_guardian_foundation.sql` | 22 ERROR — **proven stale, not broken**: every error traces to the exact rejection message added by commit `2161665` in *this same release*. The test predates that deliberate security fix; its old assumption (no invitation required) is what the fix correctly closes. Flagged for test cleanup, not a release blocker. |
| `training_management_regression.sql` | Clean |
| `training_management_extension_regression.sql` | Clean |
| `calendar_fixture_lifecycle_regression.sql` | Clean |
| `main_bugfix_preservation_regression.sql` | Clean |
| `training_plan_regenerate_idempotency_regression.sql` | Clean |

## L. Build results

`npx tsc --noEmit`: 0 errors. `npx eslint app lib`: 0 errors, 6 pre-existing warnings (unchanged from before this release range). `npm run build`: clean. `git diff --check`: clean.

## M. Known non-blockers

- Multiple simultaneously-`ACTIVE` Training Plans per team have no DB-level uniqueness guard (confirmed live). **Not fixed, not blocking** — may be legitimate; banked as a future product-policy decision per explicit instruction.
- Mini-Rugby Groups cannot receive an automatic recurring Training Plan (`save_training_plan` has no `p_scheduling_group_id` parameter) — structurally unreachable, fails safe, already disclosed.
- `fixture.cancel` capability path doesn't consult `capability_overrides` — pre-existing, disclosed technical debt shared with other fixture-mutation RPCs.
- A handful of ported Side2 test-file header comments still reference `docker exec ... supabase_db_ovalball-training-management` (the fork's own container name) instead of Main's real `supabase_db_ovalball-saas-startup` — cosmetic, comment-only, never executed.
- `lib/pitch-allocation/training-conflicts.verify.ts` is a manual dev-run verification script (not imported anywhere, not bundled into the production build) — organizationally unusual location but zero runtime risk.
- `permission_matrix.sql` and `side_project_1_player_guardian_foundation.sql` need updating to reflect pre-existing test-data drift and the new invite-only guard, respectively — not release-blocking, recommended cleanup.

## N. Known provider-deferred items

- Ovalball's own GoCardless platform billing (`platform_*` schema) ships this release but stays fully inert: no access token, no webhook secret, `OVALBALL_SAAS_BILLING_ENABLED` unset.
- Club-member GoCardless (Side 1) already shipped previously; production go-live remains gated by its own two-flag switch, unchanged here.
- Turnstile / social-auth provider configuration is unchanged by this release; its production readiness is whatever it already was on `origin/main`.

## O. Exact release sequence (DO NOT EXECUTE)

Derived from this actual platform (Next.js app, Supabase-hosted Postgres, CLI-linked project `ywwdizmaanbujcfitpcj`):

1. **A** — Confirm no new local commits since this report (`git status` clean, HEAD still `60477c1`).
2. **B** — `git push origin main` (clean fast-forward; no force needed).
3. **C** — `git ls-remote origin main` (or GitHub UI) to confirm the remote tip is now `60477c1`.
4. **D** — `npx supabase db push` (applies all 27 pending migrations, in canonical order, to the linked production project). Do not use a raw `psql -f` loop for production — unlike this session's local throwaway/verification work, production should go through the CLI's own migration-ledger-aware path.
5. **E** — `npx supabase migration list` again; confirm all 225 rows now show matching `local`/`remote` versions, in particular that `20261011140000` is present on `remote`.
6. **F** — Production DB invariant checks (read queries only): `select mode, release_version from platform_public_state();` (expect `beta`, `null`); `select * from cron.job where jobname = 'process-due-trials';` (expect exactly one row, schedule `*/15 * * * *`); `select indexname from pg_indexes where indexname = 'training_sessions_plan_occurrence_active_idx';` (expect one row).
7. **G** — Deploy commit `60477c1` on the hosting platform (confirm first whether it auto-deploys from a `main` push or needs a manual trigger).
8. **H** — Confirm the deployed app's own build-SHA/version surface (`lib/version.ts`) reports `60477c1`, and that the production domain resolves correctly.
9. **I** — Production smoke test: passwordless sign-in, Beta badge renders, Club Admin → Training Management loads, Calendar shows fixtures/training correctly, Cancel Fixture/Delete Fixture/Deleted Calendar Events all load, a real Training Plan save-and-resave doesn't duplicate, GoCardless connect panels still show disconnected/gated.
10. **J** — Explicitly confirm no provider was enabled and no config flag flipped as a side effect of deployment (diff the platform's env-var list before/after if the hosting UI supports it).
11. **K** — See failure/rollback plan below; only declare the release complete once F, H, and I all pass.

## P. Failure / rollback plan

**Last known-good production code commit: `fc0d248`.**

- **Push succeeds, migration apply fails**: Production is running old code against an unchanged schema — safe, no user-facing impact. Identify the exact failed migration from the CLI's error output, fix forward with a new migration (never edit an already-numbered file in this range), reapply only the remainder. Do not deploy the new frontend code until migrations are confirmed fully applied.
- **Migrations succeed, deployment fails**: Schema now has new, unused tables/columns; the still-old deployed app never references them — harmless. Retry deployment. No database rollback needed.
- **Deployment succeeds, smoke test finds a critical defect**: Roll back the *deployment* to `fc0d248` via the hosting platform's own previous-deployment/rollback mechanism. Do **not** roll back the database — the new schema is purely additive and harmless to leave in place under the reverted code. Fix forward on a new branch, re-run this same gate, redeploy.
- **A migration partially succeeds**: Inspect exactly which statement failed inside that specific migration file. Do not attempt to auto-rollback a partially-applied DDL migration; assess by hand whether the partial state is inert (most of these migrations are `CREATE TABLE`/`CREATE POLICY`/`CREATE FUNCTION` — a partial failure typically means "nothing new is reachable yet," not "existing data is corrupted"). Write a new corrective migration once the exact state is understood.
- **Cron ends up wrong** (missing, or duplicated): Never hand-edit `cron.job` rows. If missing, the same idempotent `unschedule`-then-`schedule` block from `20261002000000` can be safely re-run (it's already exception-guarded for a first-time unschedule). If somehow duplicated, `cron.unschedule('process-due-trials')` once, then re-run the `cron.schedule(...)` call once — never via manual SQL outside the tracked migration pattern.

## Q. Proposed SP3 baseline

**PROPOSED SP3 BASELINE = `60477c1`**, to become the *actual* baseline only once this release is successfully pushed, migrated, deployed, and verified per Section O. Side Project 3 is explicitly **not** created in this prompt.

---

## Final verdict

**MAIN PRODUCTION RELEASE — READY TO SHIP**

- Clean Main (`60477c1`), no remote divergence (`0` ahead-of-origin conflicts, `0` behind), pure linear 28-commit range fully understood and classified.
- Diff review found and disclosed one cosmetic issue (stale container-name comments) and confirmed the earlier project-identity leak fix held — no accidental config, secrets, or provider enablement anywhere in the range.
- Exact remote migration delta established from source of truth (27, not an assumed 24+1); no divergence, no duplicates, canonical monotonic order confirmed, `20261011140000` present and last.
- Every pending migration reviewed individually for destructive/backfill/RLS/grant/cron risk — nothing destructive, nothing touches existing data unsafely.
- Cron path verified against its canonical migration and classified PRODUCTION READY, with one explicit post-apply verification step required (not a blocker, a checklist item).
- Beta/billing safety verified at the code and migration level — nothing in this release can silently flip Beta→Live or enable billing.
- Production configuration requirements enumerated; actual production state must be confirmed by whoever manages the hosting platform (out of this session's reach) before Section O's deploy steps.
- All critical regressions pass; the two exceptions were proven — not assumed — to be pre-existing/expected, with exact root causes cited.
- `tsc`/`eslint`/`build`/`git diff --check` all clean.
- Release and rollback plans documented above, derived from this actual platform.

STOP. DO NOT PUSH. DO NOT APPLY REMOTE MIGRATIONS. DO NOT DEPLOY. Production release requires separate explicit authorization.
