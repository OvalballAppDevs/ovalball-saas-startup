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

## 6. Disclosed, non-blocking finding: duplicate seed training sessions

During the live browser smoke test (§7), Burnley RUFC's U13 C team showed 11 stacked, visually-identical "Planned Training · 18:00" entries on both 2026-07-10 and 2026-10-20 in the Calendar. Investigated directly against the database: these are 22 genuine, distinct rows (`source = 'MANUAL'`, no `training_plan_id`/`schedule_rule_id` — nothing preventing an unconstrained manual insert at the same team/date/time), with `created_at` timestamps of 2026-09-05/2026-09-06 — i.e. created during this session's own remediation/integration work, almost certainly from a seed or fixture-generation script being re-run more than once against Main's real persistent local database rather than a disposable throwaway.

This is local dev-database clutter, not a schema, RPC, RLS, or code defect, and it does not affect any regression suite (all suites create their own fresh fixtures). It has **not** been cleaned up — deleting rows from Main's real local database was judged out of scope for a verification pass without being asked, given they are visually confusing but functionally harmless. Flagged here for a deliberate future cleanup (e.g. `delete from training_sessions where id in (...) ` keeping one canonical row per exact duplicate group), not silently fixed or silently ignored.

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
