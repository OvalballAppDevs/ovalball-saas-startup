# Training Management Build Report (Side Project 2)

Isolated project: `/Users/Devs/ovalball-training-management` (`git clone --local` of a local snapshot commit of Main, `origin` removed — see Section A of the final report for the exact source commit). Local Supabase ports remapped to the 5444x range / app port 3200 so it runs alongside Main and Side Project 1 without collision. No push, no deploy, no remote Supabase, no write to Main after the initial snapshot.

This report covers two passes: an initial implementation pass, and a second, deliberately slower pass driven by direct user feedback ("you didn't take much time doing that... go section to section and cover all of the points") that went back through the dashboard depth, ran a real live browser walkthrough with real persistent demo data, and found three further real bugs that the first pass's code-review-and-SQL-tests-only approach had missed.

## Architecture decisions (see `TRAINING_MANAGEMENT_ARCHITECTURE.md` for full detail)

- Extended the **pre-existing** `public.training_sessions` table rather than creating a second training entity, after auditing it first and confirming it was already a real, non-fake calendar-event model.
- `training_sessions.status` stores only `PLANNED`/`CANCELLED` — "needs allocation" and "Completed" are computed, matching the existing Pitch Allocation feature's own precedent for fixtures, not stored as a third status source.
- One new capability, `club.training.manage`, Club-Admin-only.
- Training/Fixture pitch-conflict detection lives in a **new, separate** module (`training-conflicts.ts`) rather than modifying the existing `detectConflicts()`, so Pitch Allocation's existing fixture-only behaviour and regression suite are provably unaffected. The same module is reused a second time by the Training Management dashboard's own Exceptions/Conflicts panel (`app/(app)/club/training/exceptions.ts`) — one shared conflict engine, two consumers, never a second ad hoc check.
- Full bounded generation at plan save/activation time (not a rolling background generator) — every schedule mode already resolves to a finite range, so there is nothing a rolling generator would be needed for.

## Migrations (all local-only, applied via `npx supabase migration up`)

1. `20260929000000_training_management_schema.sql` — `club.training.manage` capability, `training_plans`, `training_plan_schedule_rules`, additive `training_sessions` columns, cancellation-sync trigger.
2. `20260929100000_training_management_recurrence_and_generation.sql` — the canonical recurrence resolver, preview RPC, `generate_training_plan_sessions`, `save_training_plan`, `deactivate_training_plan`, `reactivate_training_plan`, `override_training_session`.
3. `20260929200000_training_management_manual_reconciliation_and_reads.sql` — reconciles `create_training_session`/`cancel_training_session`, `internal.effective_training_session_status`, `get_training_management_overview`.
4. `20260929300000_training_session_schedule_rule_fk_fix.sql` — same-day bug fix (plan-edit FK violation, see below).
5. `20260929400000_reactivate_plan_restores_cancelled_sessions_fix.sql` — second-pass bug fix (reactivation orphaning, see below).

## Bugs found and fixed

**First pass (caught by an SQL smoke test, before any UI existed):**
1. **Plan-edit FK violation**: editing a plan's schedule tried to `delete` its old `training_plan_schedule_rules` rows, but `training_sessions.schedule_rule_id` had a default `ON DELETE NO ACTION` FK, blocking the delete on the very first edit ever attempted. Fixed by changing the FK to `ON DELETE SET NULL` — a session's own columns are already a complete, self-contained historical record at generation time, so it never needs to keep resolving through the rule that produced it.

**Second pass (all three caught live in the browser against real persistent demo data — none of these were visible from SQL tests or code review alone):**
2. **Overlapping training cards rendered fully stacked on Pitch Allocation.** The deliberate demo pitch conflict (two sessions double-booked onto Main Pitch) rendered as an unreadable, fully-overlapping mess — the conflict *detection* was correct (one card correctly showed the warning triangle and red styling), but there was no lane-assignment logic for the training-card layer the way fixtures already have for multi-lane pitches. Fixed by adding `assignTrainingLanes()` (the same greedy interval-scheduling algorithm as the existing fixture lane assigner, applied to the training layer independently) and growing the pitch row's height to fit however many training lanes are actually needed.
3. **Reactivating a Training Plan did not actually restore its sessions.** `deactivate_training_plan` correctly cancels (never deletes) future non-overridden sessions. `reactivate_training_plan` then called `generate_training_plan_sessions`, which is deliberately idempotent via `ON CONFLICT (schedule_rule_id, occurrence_date) DO NOTHING` — but that meant it silently skipped every row that already existed, i.e. every one of the sessions deactivation had just cancelled. The plan came back `ACTIVE` in the UI, but all 38 of its real future sessions stayed permanently `CANCELLED` with no way back short of a manual per-session override. Live-verified in the browser: toggling Under 13's Automatic Booking off then back on left "Upcoming Sessions" at 48 instead of the correct 86. Fixed by having `reactivate_training_plan` explicitly restore every future, non-overridden `CANCELLED` session back to `PLANNED` before regenerating — safe because `is_overridden=false` is exactly the set deactivation itself is willing to touch, so a genuinely individually-cancelled session (`is_overridden=true` via `override_training_session`) is never resurrected by this fix. A new regression assertion (`training_management_regression.sql` test 5d) now asserts this directly, since the original test 5 only checked the plan's own status column, not its sessions — exactly why it passed while the real bug shipped.
4. **Calendar week-view training cards said only "Training · 18:00"**, with team identity conveyed solely by the row/lane rather than the card text, and no venue/pitch shown at all — not meeting Section 28's explicit "`<Team Name> — Planned Training`" wording. Fixed by resolving the real team label (via the existing `compactTeamLabel` helper, same as fixture cards) and the pitch name into each training entry and rendering `"<Team> — Planned Training · <time>"` with the pitch name on a second line. Confirmed live: Monday 7 Sept now reads "U12 — Planned Training · 18:00 / Main Pitch" and "U13 — Planned Training · 18:15 / Main Pitch" as two distinct, correctly-labelled cards.

No security vulnerability was found or needed fixing in either pass — every authorization boundary (capability-gated RPCs, RLS policies, cross-club tamper matrix) passed on every run of the regression suite.

## Dashboard depth added in the second pass

The first pass's Training Management landing page had overview *counts* for "Upcoming Sessions" and "Needs Attention" but no actual browsable content behind either — a real gap given Section 6 explicitly asks for both as first-class sections. Second pass added:
- **Exceptions / Conflicts panel** (`app/(app)/club/training/exceptions.ts` + a real list on the page): scans the next 30 days for any date with a training session on a pitch, and runs the exact same `detectResourceConflicts` engine Pitch Allocation uses across that date's real training sessions *and* real fixtures, surfacing genuine double-bookings with a direct link to resolve them in Pitch Allocation. Verified live against the planted demo conflict.
- **Upcoming Training Sessions table** with a team filter (`?team=<id>`, server-rendered). Originally implemented as "next 50 rows regardless of date," which in live testing turned out to mean "every Monday until next May" for a single weekly plan — not a useful "upcoming" view even though every row was technically in the future. Changed to a genuine 14-day window (with a safety cap, not the intended bound) after finding this live.
- Both new sections read live, real data — neither is a static placeholder.

## Tests

- `lib/pitch-allocation/training-conflicts.verify.ts` — 13/13 PASS.
- `supabase/tests/training_management_regression.sql` — **35/35 PASS, 0 FAIL** (grew from 30 to 35 in the second pass: 4 new sub-assertions plus the new 5d regression guard for the reactivation bug), fully self-contained.
- Re-ran `permission_matrix.sql` (18/0), `club_pitches.sql` (11/0) after the capability-engine edit — clean.
- `capability_engine.sql` shows one pre-existing, unrelated failure (a narrow Site-Admin-capability-leak assertion, nothing to do with this workstream) — disclosed, not fixed.

## TypeScript / Lint

- `tsc --noEmit`: clean except one pre-existing, unrelated error in `app/(app)/teams/[teamId]/team-edit-form.tsx`, confirmed via `git status` to be untouched by this workstream (part of Main's own in-progress Team Administration work).
- `eslint` (full repo): 0 errors, 5 pre-existing warnings in files this workstream never touched.

## Baseline-testing environmental finding (disclosed, not a Training bug)

Main's pre-existing SQL "regression suite" is an ordered chain of sequential fixture-building scripts meant to run one after another against an accumulating dev database, not independently isolated tests, and the runner script that would normally sequence them (`run_regression.sh`, referenced in Main's own `HANDOFF.md`) was not present in the snapshot this project forked from. This workstream's own test deliberately follows the more robust, fully-self-contained convention instead.

## Integration findings

- Team Admin integration required **zero new code**: Main's existing Calendar query already reads `training_sessions` filtered by the caller's own `team_id` set.
- Pitch Allocation's existing board is fixture-specific and fairly involved (drag-and-drop staging, proposal review, multi-lane rendering) — training was integrated as a genuinely new, parallel read-only layer sharing the same conflict-detection engine, to avoid any risk of regressing that already-complex surface.

## Browser / UAT — now genuinely performed

Real, live browser verification was carried out in the second pass, against **real persistent local demo data** (not throwaway rows) — Burnley RUFC's real seeded Club Admin (`test.burnley.admin@ovalball.local`), its two real active teams, and a new venue/pitch assignment (see `supabase/tests/fixtures/training_management_demo_data.sql`, committed, non-rolled-back). Verified live in Chrome:
- The full Training Management dashboard: overview cards, Automatic Training Booking toggles, Active Training Plans table, Exceptions/Conflicts panel, Upcoming Training Sessions table.
- Editing an existing CUSTOM-mode plan: real pre-filled data (two schedule rows with independent weekday/time/duration/date-range), the "Preview" button correctly computing "8 planned training sessions" for the exact real September Friday+Sunday combination.
- The full deactivate → reactivate round trip for a real plan (this is what surfaced bug #3 above).
- The Pitch Allocation board rendering a real planted pitch conflict, including the layout bug (#2) found and fixed live.
- The Calendar week view rendering training cards with the corrected wording (#4), scoped correctly per team lane.
- Real magic-link authentication end-to-end via the local Mailpit instance (port 54444), consistent with this codebase's established local-verification convention.

**Not completed in this pass, disclosed rather than silently dropped:**
- Tablet/mobile-width verification and a dedicated keyboard-only accessibility walkthrough were not performed — this session's Claude-in-Chrome tooling became unstable partway through desktop verification (a tab-level fault where click/keypress/screenshot actions started failing with a `chrome-extension://` permission error, most likely triggered by a native password-manager autofill overlay on the login page; DOM-level tools — `read_page`, `form_input`, `find` — kept working throughout and were used to route around it for the remaining desktop checks). Desktop verification itself is complete and real; narrower viewports were not attempted a second time given the tool instability and are left as a genuinely deferred item rather than reported as done.
- Drag-and-drop reallocation of a training session directly on the Pitch Allocation board (domain/RPC support exists via `override_training_session`; no UI control calls it from that board yet).
- Notification wiring (event names only, documented as a future-extension vocabulary).
- Season-to-season plan rollover policy.
- `schedule-training-dialog.tsx` (manual Calendar training) does not yet offer an explicit venue selector (relies on the pitch→venue fallback, which is always correct but less flexible).
