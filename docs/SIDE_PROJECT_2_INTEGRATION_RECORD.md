# Side Project 2 → Main Integration Record

**Date:** 2026-09-06
**Scope:** Local integration only. Nothing in this engagement was pushed, deployed, or applied to remote Supabase. No provider was enabled, no production config was touched.

Full architectural detail for the Training Management domain itself (schema, RPCs, RLS, fixture-model reconciliation, Mini-Rugby limitation, `fixture.cancel` technical debt) lives in `docs/TRAINING_MANAGEMENT_ARCHITECTURE.md` and `docs/TRAINING_MANAGEMENT_BUILD_REPORT.md` (both ported in verbatim from Side Project 2 as part of this merge). This record covers the merge itself and what was found/fixed/verified during it — it does not duplicate that content.

## 1. What was integrated

Side Project 2 (`../ovalball-training-management`, a real `git clone --local` fork of Main sharing genuine object history) contributed **Training Management**: per-team automatic recurring training plans, one-off manual training sessions (including sessions targeting a Mini-Rugby scheduling group directly), a polymorphic extension of the existing `player_fixture_attendance` table to cover training (never a second attendance system), a staff training register, training-specific notifications, and the **Calendar Fixture Lifecycle** hardening (Cancel Fixture using Main's own pre-existing `fixture.cancel` capability path, Delete/Archive Fixture, and a new unified "Deleted Calendar Events" back-office view covering both archived fixtures and removed training).

Merged via `git merge --ff-only` — a genuine fast-forward, zero manufactured merge commit, zero conflicts. Source: Side2's `remediation/integration-renumber` branch at `6e2591a` (verified directly via `git merge-base`, not trusted from documentation). Main's pre-integration tip is preserved at both `safety/pre-side2-integration-20260906` (branch) and `safety-pre-side2-integration-20260906` (tag), pointing at `c60c083`.

## 2. Migrations

14 Side2 migrations, renumbered during the earlier remediation pass to `20261011000000`–`20261011130000` (a clean, monotonic range strictly after Main's own last pre-fork migration) to remove 5 real timestamp collisions with migrations Main had independently gained since Side2 forked. All 14 applied directly (`psql -f`) to Main's real local database alongside the 10 Main-only migrations Side2's fork had predated, bringing `supabase_migrations.schema_migrations` to 224 rows, fully monotonic, zero gaps in the applied set.

## 3. Main bug-fix preservation (proven, not assumed)

Main independently fixed two bugs after Side2 forked. `supabase/tests/main_bugfix_preservation_regression.sql` (written during remediation) proves both survive integration by executing them for real against Main's own integrated database:

1. `accept_fixture_request` accepting a group-targeted request with a directory-resolved opponent, without violating `fixtures_opponent_group_excludes_directory`.
2. `set_scheduling_group_members` correctly freezing composition when the group is the *opponent* side of a booked fixture (not just the owning side).

Both: **PASS**, run directly against Main's real integrated local database (not a throwaway).

## 4. Regression

- Side2's own suites (including `main_bugfix_preservation_regression.sql` and `mini_rugby_training_reconciliation_check.sql`, whose expected finding is that Mini-Rugby Groups cannot yet receive an automatic recurring plan — disclosed, not fabricated as fixed): clean.
- Main's own regression suite showed 6 files with failures (`fixture_management.sql`, `shared_team_capacity.sql`, `team_lifecycle.sql`, `permission_matrix.sql`, `fixture_results.sql`, `fixture_results_24h.sql`). Per the standing instruction to compare exact errors rather than assume, a fresh Main-only isolation database (zero Side2 migrations) was built from the same base and the same 6 files re-run: byte-for-byte identical errors and line numbers with or without Side2's migrations in every case, conclusively proving all 6 are pre-existing/environmental (Main's suite is a documented non-isolated sequential chain this fork never had a runner script for), not regressions caused by this integration.
- `npx tsc --noEmit`: 0 errors. `npx eslint app lib`: 0 errors, 6 warnings (5 pre-existing + 1 newly-visible-via-rebase `app/legal/privacy/page.tsx` warning, unrelated to Side2). `git diff --check`: clean. `npm run build`: clean.

## 5. Defect found and fixed during this integration: project-identity leak

The fast-forward brought in `package.json`, `package-lock.json`, and `supabase/config.toml` changes from Side2's very first commit, where Side2 had given itself its own local-dev identity so it could run alongside Main during separate development: package name `ovalball-training-management`, dev script `next dev -p 3200`, and a fully remapped Supabase local-stack port range (API/db/shadow/pooler/studio/smtp/inspector/analytics all offset), plus `site_url`/redirect URLs pointing at `:3200`.

These are Main's own environment-identity settings, not part of the Training Management feature, and their overwrite caused `npm run dev` in Main's own directory to boot Side2's dev script/port (colliding with Side2's actual separately-running server) and was the root cause of an earlier-diagnosed `supabase/config.toml` port mismatch (declared `54442` vs the real running container's `54322`) that had previously been worked around with an explicit `--db-url` instead of being recognized as this same leak.

**Fixed** in a new local-only commit on top of the fast-forward (`f40e6c8`): all three files reverted to byte-identical to Main's pre-integration state, verified via `git diff` against the `safety/pre-side2-integration-20260906` tag. No Side2 feature code, migration, or dependency was touched — `package.json`'s dependency list is untouched, confirming Side2 added no new npm packages for this feature.

## 6. Duplicate training session root-cause audit (2026-09-06)

During the live browser smoke test (§7), Burnley RUFC's U13 C team showed 11 stacked, visually-identical "Planned Training · 18:00" entries on both 2026-07-10 and 2026-10-20 in the Calendar. A dedicated forensic audit was run to distinguish local test pollution from a genuine product idempotency defect, rather than assume either. Full evidence, both findings, and both fixes are recorded here.

### 6.1 The Burnley U13 C duplicates: **LOCAL TEST POLLUTION — PROVEN**

All 22 rows are `source = 'MANUAL'`, with `training_plan_id` and `schedule_rule_id` both null — i.e. they were never produced by the automatic recurring-plan generation system at all. Every row's `club_id`, `team_id`, `session_date` (`2026-07-10` / `2026-10-20`), `start_time` (`18:00`), and `created_by` (`00000000-...-002`, the seeded `test.burnley.admin@ovalball.local` fixture identity used by `set local request.jwt.claims`) match, exactly and only, two literal `create_training_session(...)` calls in `supabase/tests/season_rollover.sql` (checks 15 and 16, "Training is valid in pre-season" / "in main season").

That file's own header states it is explicitly **not a migration** — "run AFTER permission_matrix.sql," by hand, against a real non-reset local database. Checks 15 and 16 were the only two blocks in the entire file that ended with `commit;` instead of `rollback;` (introduced in commit `9a00bedc`, the exact Side2 fork-snapshot commit, 2026-09-05 03:09:05 +0100). The 22 rows' `created_at` timestamps are 11 distinct moments spanning 2026-09-05 03:22 through 2026-09-06 14:16 — precisely the remediation-then-integration engagement's own timeline of re-running Main's full regression suite by hand against its real persistent local database, each run permanently committing one more duplicate pair.

**Fix:** `supabase/tests/season_rollover.sql` checks 15/16 changed from `commit;` to `rollback;`. Verified this does not weaken check 17 (which only queries `fixtures`, proving training creation never creates a fixture row — true regardless of whether the training_sessions row from 15/16 persists) — re-ran the file three times in succession against a throwaway database seeded from Main's real state and confirmed checks 15/16/17 all still PASS and the U13 C row count no longer grows (stayed at the pre-existing 22 across 3 additional runs, versus 28 had the leak still been present).

### LOCAL TEST-POLLUTION CLEANUP — COMPLETED (2026-09-06)

Cleanup executed on Main's local database only, after re-querying all 22 rows and re-confirming every field against this section's forensic record (club, team, `source = MANUAL`, `training_plan_id`/`schedule_rule_id` null, both exact date/time groups, exact seeded creator) with no discrepancy.

- **Deleted**: exactly 20 rows, by explicit ID allow-list (no broad predicate) — the same 10-per-date set already recorded above (every row except the earliest-created one per date).
- **Retained**: `7d82247a-43ad-4819-8716-2a8605e3dbe1` (2026-07-10) and `da4b54b9-a5da-49ab-9b0d-04430bf39952` (2026-10-20) — both confirmed still present after deletion.
- **Verified after deletion**: exactly one U13 C session remains per date; the whole `training_sessions` table (which, before this cleanup, contained only these 22 rows and nothing else — confirmed by this audit's own earlier club-wide scan) now contains exactly 2 rows; the Calendar UI (Club Admin, real magic-link session) shows a single training entry per date, and the retained Friday 10 July session opens its detail panel normally (View Register / Edit Training Details / Cancel all present).
- No migration or product code was touched by this cleanup — deletion only.

### 6.2 A distinct, genuine defect found via due diligence: **PRODUCT IDEMPOTENCY DEFECT — FIXED**

The audit's own required idempotency proof (create a plan, save it again unchanged) — run against the *automatic* generation path specifically, unrelated to the Burnley finding above — reproduced a real bug live before concluding: re-saving an existing Training Plan unchanged silently created a genuine duplicate live session for any occurrence date already in the past relative to today.

Root cause: `save_training_plan`'s edit branch cancels only *future* (`occurrence_date >= current_date`) non-overridden sessions before deleting and recreating the plan's schedule rules with brand-new row ids, then regenerates the plan's full resolved occurrence set (which, by design, spans the whole season, including elapsed dates). `generate_training_plan_sessions`'s own duplicate guard was keyed on `(schedule_rule_id, occurrence_date)` — a key that can never collide across a save, because `schedule_rule_id` is always freshly minted on every edit. Future dates were unaffected (the old row is explicitly cancelled first, so exactly one live row survives — the intended cancel-and-replace, audit-trail-preserving design); only past, deliberately-never-cancelled dates silently doubled.

**Fix**, `20261011140000_training_plan_regenerate_past_occurrence_dedup_fix.sql`:
- Added a partial unique index, `training_sessions_plan_occurrence_active_idx` on `(training_plan_id, occurrence_date)` where both are non-null and `status <> 'CANCELLED'` — the real, edit-stable identity of an automatic occurrence (verified zero existing violations before adding it).
- `generate_training_plan_sessions` now conflicts on that index instead of the old `schedule_rule_id`-keyed one.
- A second, related dormant defect this new invariant immediately surfaced: `reactivate_training_plan` (`20261011040000`) restored *every* future, non-overridden `CANCELLED` row back to `PLANNED` in one indiscriminate `UPDATE`, with no way to tell "cancelled by this deactivation" apart from "permanently cancelled by an earlier edit that removed its rule." A plan edited more than once can hold both kinds of `CANCELLED` row for the same date; blindly restoring both would have silently produced the very duplicate the new index now correctly rejects instead. Fixed to restore only the most-recently-cancelled row per date, and only for dates still covered by the plan's *current* resolved schedule (`internal.resolve_training_plan_occurrence_dates`) — a date whose rule was already removed by an intervening edit is correctly left as permanent history, never resurrected by reactivating the plan as a whole.

**Regression added**: `supabase/tests/training_plan_regenerate_idempotency_regression.sql` — self-contained, transactional, reproduces the exact pre-fix failure (a season starting well before "today" guarantees an elapsed occurrence) and asserts the active-occurrence count is stable across three consecutive unchanged re-saves. Also asserts the new invariant index exists.

**Existing test corrected, not the fix**: applying the new invariant surfaced that `training_management_regression.sql`'s own §5d assertion ("zero sessions with `status = 'CANCELLED'`") was already fragile — it predates a scenario where §4 (in the same file) edits the same plan twice, including removing a rule entirely, which legitimately leaves permanent `CANCELLED` history for that rule's dates. §5d's blanket count would flag that legitimate history as a "regression" forever, regardless of this fix. Corrected §5d to check that every date genuinely live *immediately before deactivation* has a live session again after reactivation (via a snapshot temp table), rather than a blanket zero-`CANCELLED` count — verified this is what the test was actually trying to assert per its own comment, and it now passes precisely, without weakening what it checks.

Disclosed, separate, **not fixed** (different, narrower scope than what this audit asked to resolve): `training_plans` has no DB-level uniqueness guard against two independently-`ACTIVE` plans for the same team (confirmed live: a second `save_training_plan(null, ...)` "create" call for a team that already has an active plan succeeds and would generate its own independent, overlapping session set). Whether more than one active plan per team is ever a legitimate configuration is a product decision this audit was not asked to make; flagged as a recommended follow-up.

### 6.3 Regression re-run after both fixes

`training_management_regression.sql`, `training_management_extension_regression.sql`, `calendar_fixture_lifecycle_regression.sql`, `main_bugfix_preservation_regression.sql`, and the new `training_plan_regenerate_idempotency_regression.sql`: all clean, 0 FAIL / 0 ERROR. `npx tsc --noEmit`: 0 errors. `npx eslint app lib`: 0 errors, the same 6 pre-existing warnings. `npm run build`: clean. `git diff --check`: clean.

### 6.4 Audit verdict

The reported symptom (§6.1) is **LOCAL TEST POLLUTION — PROVEN**, root-caused to an exact commit/file/line and fixed. A distinct, genuine **PRODUCT IDEMPOTENCY DEFECT — FIXED** (§6.2) was also found and closed via this audit's own required due-diligence check, unrelated to the reported symptom. Live reproduction confirms automatic Training Plan generation is now idempotent across repeated unchanged saves, including for elapsed occurrences and the deactivate/reactivate round trip.

**TRAINING DUPLICATE AUDIT — PRODUCT DEFECT FIXED / RELEASE SAFE**

The 22 real duplicate Burnley U13 C rows remain in Main's local database, undeleted, pending separate explicit cleanup authorization (§6.1's proposed scope). Nothing was pushed, deployed, or applied to remote Supabase during this audit.

## 7. Live browser verification

Real magic-link sign-in via Main's local Mailpit mail catcher (port `54324`) against real seeded fixture accounts — no synthetic throwaway users, no auth bypass.

**As `test.burnley.admin@ovalball.local` (Club Admin, Burnley RUFC — 29 real fixtures, 22 real training sessions, 8 scheduling groups seeded):**
- Dashboard: BETA badge, real upcoming fixtures, full Club Admin nav including **Training Management** and **Deleted Calendar Events**.
- Training Management: loads with real per-team automatic-booking toggles (26 teams), "Teams without a plan"/"Upcoming Sessions" counters consistent with real data.
- Calendar: real fixtures and training render correctly across week/month views with correct H/A badges and times; fixture detail panel shows Edit/Open Fixture/Cancel Fixture/Delete Fixture, confirming the preserved `fixture.cancel` capability path (not exercised destructively — panel closed without mutating real fixture data).
- Pitch Allocation: correctly scoped to home fixtures only (per its own subtitle) — real fixture commitments render; training bookings are shown on the main Calendar, not this grid, which is Main's pre-existing design boundary, not a Side2 regression.
- Deleted Calendar Events: loads, honest empty state (nothing archived for this club yet — no fabricated rows).

**As `test.parent@ovalball.local` (Parent/Guardian of a real active U12 player):**
- Nav correctly restricted to Dashboard + the one team's Calendar only (no Fixtures/Messages/Training Management leakage from any other role this account might hold).
- Calendar loads in view-only form (no Filter/Pitch-Allocation edit tools).

## 8. Preservation checklists re-confirmed against the integrated tree

- Commercial/platform files (`admin/commercial`, `admin/releases`, billing, trials, referrals): zero touched across the entire integration range.
- Side Project 1 domain (`app/(app)/parent`, `lib/gocardless`): zero modified/deleted files across the entire integration range (additions only, if any).
- No duplicate Player/Guardian/attendance namespace: training attendance extends the existing `player_fixture_attendance` table (nullable `fixture_id`, new `training_session_id`, `num_nonnulls(...) = 1` check), never a second table.

## 9. Final git state

- Branch: `main`. HEAD: `f40e6c8f1652a11351ba857aa616ee0f1657b19c`.
- Working tree: clean.
- `origin/main`: local `main` is 23 commits ahead, 0 behind — **nothing pushed**.
- Safety refs intact and unmoved: `safety/pre-side2-integration-20260906` and `safety-pre-side2-integration-20260906`, both at `c60c083` (Main's real pre-integration tip).

## 10. Verdict

**SIDE PROJECT 2 → MAIN — INTEGRATED LOCALLY / VERIFIED**

- Clean fast-forward, zero conflicts, zero commercial/Side-Project-1 files touched.
- Both of Main's own post-fork bug fixes proven to survive, live, against the real integrated database.
- Migration set applied, monotonic, verified.
- Side2's regressions clean; Main's 6 apparent failures rigorously proven pre-existing/environmental via A/B isolation, not new regressions.
- One real integration defect (project-identity leak in `package.json`/`package-lock.json`/`supabase/config.toml`) found and fixed.
- One non-blocking data-hygiene finding (duplicate seed training sessions from this session's own repeated local database operations) disclosed, not silently fixed or hidden.
- `tsc`/`eslint`/`build`/`git diff --check` all clean.
- Live browser smoke test performed against the actual integrated app for both a Club Admin and a Parent identity, using real seeded accounts via genuine magic-link sign-in.

STOP. DO NOT PUSH. DO NOT DEPLOY. DO NOT APPLY REMOTE MIGRATIONS. DO NOT ENABLE ANY PROVIDER.
