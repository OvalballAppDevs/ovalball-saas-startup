# Training Management Build Report (Side Project 2)

Isolated project: `/Users/Devs/ovalball-training-management` (`git clone --local` of a local snapshot commit of Main, `origin` removed — see Section A of the final report for the exact source commit). Local Supabase ports remapped to the 5444x range / app port 3200 so it runs alongside Main and Side Project 1 without collision. No push, no deploy, no remote Supabase, no write to Main after the initial snapshot.

## Architecture decisions (see `TRAINING_MANAGEMENT_ARCHITECTURE.md` for full detail)

- Extended the **pre-existing** `public.training_sessions` table rather than creating a second training entity, after auditing it first and confirming it was already a real, non-fake calendar-event model.
- `training_sessions.status` stores only `PLANNED`/`CANCELLED` — "needs allocation" and "Completed" are computed, matching the existing Pitch Allocation feature's own precedent for fixtures, not stored as a third status source.
- One new capability, `club.training.manage`, Club-Admin-only.
- Training/Fixture pitch-conflict detection lives in a **new, separate** module (`training-conflicts.ts`) rather than modifying the existing `detectConflicts()`, so Pitch Allocation's existing fixture-only behaviour and regression suite are provably unaffected.
- Full bounded generation at plan save/activation time (not a rolling background generator) — every schedule mode already resolves to a finite range, so there is nothing a rolling generator would be needed for.

## Migrations (all local-only, applied via `npx supabase migration up`)

1. `20260929000000_training_management_schema.sql` — `club.training.manage` capability, `training_plans`, `training_plan_schedule_rules`, additive `training_sessions` columns, cancellation-sync trigger.
2. `20260929100000_training_management_recurrence_and_generation.sql` — the canonical recurrence resolver, preview RPC, `generate_training_plan_sessions`, `save_training_plan`, `deactivate_training_plan`, `reactivate_training_plan`, `override_training_session`.
3. `20260929200000_training_management_manual_reconciliation_and_reads.sql` — reconciles `create_training_session`/`cancel_training_session`, `internal.effective_training_session_status`, `get_training_management_overview`.
4. `20260929300000_training_session_schedule_rule_fk_fix.sql` — same-day bug fix (see below).

## Bugs found and fixed (live, during development — not audit-only)

1. **Plan-edit FK violation** (caught by the smoke test, before any UI existed): editing a plan's schedule tried to `delete` its old `training_plan_schedule_rules` rows, but `training_sessions.schedule_rule_id` had a default `ON DELETE NO ACTION` FK, blocking the delete on the very first edit ever attempted. Fixed by changing the FK to `ON DELETE SET NULL` (migration 4) — a session's own columns are already a complete, self-contained historical record at generation time, so it never needs to keep resolving through the rule that produced it.
2. **Type-generator/RLS quirk, not a real bug**: `supabase gen types` marks every RPC parameter as non-nullable in its `Args` type regardless of the function's own `default null`, requiring narrow, commented `as any` casts in `actions.ts` for the handful of genuinely-nullable parameters (`p_plan_id`, `p_season_id`, `p_reason`). The database itself accepts `null` correctly in every case; this is purely a TypeScript-side generator limitation, documented inline at each cast site.

No security vulnerability was found or needed fixing — every authorization boundary (capability-gated RPCs, RLS policies, cross-club tamper matrix) passed on first real run of the regression suite.

## Tests

- `lib/pitch-allocation/training-conflicts.verify.ts` — 13/13 PASS. Covers training-vs-training overlap/non-overlap, training-vs-fixture overlap in both start orders, fixture warm-up window catching training, multi-lane pitch capacity, unallocated/needs-review detection, cancelled-training exclusion, and card-title wording.
- `supabase/tests/training_management_regression.sql` — **30/30 PASS, 0 FAIL**, fully self-contained (own throwaway club/teams/venues/pitches/seasons/users, rolls back). Covers: required-field validation (8 sub-cases), bounded/idempotent SEASON generation, SEASON_PRE_SEASON fail-safe behaviour, plan-edit reconciliation with override protection (5 sub-cases), deactivate/reactivate history preservation, manual-training reconciliation, single-occurrence override + venue/pitch mismatch rejection, cross-club tamper (4 sub-cases), unauthorized-user denial with read-remains-open, and the computed effective-status function.
- Re-ran (post-change) `permission_matrix.sql` (18/0), `club_pitches.sql` (11/0) after the capability-engine edit — both clean, confirming `internal.has_club_role_capability`'s change didn't regress any existing role/capability behaviour.
- `capability_engine.sql` showed one pre-existing, unrelated failure (a narrow Site-Admin-capability-leak assertion, nothing to do with `club.training.manage` or any file this workstream touched) — disclosed, not fixed, per the standing "don't repair unrelated failures" instruction.

## TypeScript / Lint

- `tsc --noEmit`: clean except one pre-existing, unrelated error in `app/(app)/teams/[teamId]/team-edit-form.tsx` (references exports that don't exist in `./actions` — confirmed via `git status` that this workstream never touched either file; it is part of Main's own in-progress, uncommitted Team Administration work).
- `eslint` (full repo): 0 errors, 5 pre-existing warnings in files this workstream never touched (same files this whole multi-session engagement has repeatedly confirmed stable: `admin/fixtures/opponent-resolver.tsx`, `admin/fixtures/owning-team-resolver.tsx`, `messages/[kind]/[id]/fixture-presence.tsx`, `lib/directory-research/provider.ts`, `lib/supabase/remember.ts`).

## Baseline-testing environmental finding (disclosed, not a Training bug)

Main's pre-existing SQL "regression suite" is an ordered chain of sequential fixture-building scripts meant to run one after another against an accumulating dev database (e.g. `club_pitches.sql`'s own header: "run AFTER permission_matrix.sql... and site_admin_management.sql"), not independently isolated tests. The runner script that would normally sequence all ~80 files (`run_regression.sh`, referenced in Main's own `HANDOFF.md`) was not present in the snapshot this project forked from. Running files individually without that exact prerequisite chain produces cascading foreign-key errors unrelated to Training. This workstream's own new test (`training_management_regression.sql`) deliberately follows the more robust, fully-self-contained convention instead (own throwaway users/club/data, runs in any order, rolls back).

## Integration findings

- Team Admin integration required **zero new code**: Main's existing Calendar query already reads `training_sessions` filtered by the caller's own `team_id` set, which is the exact mechanism Team Admin's team-scoped context already uses. Extending the table additively was sufficient.
- Pitch Allocation's existing board/data/type architecture is fixture-specific and fairly involved (drag-and-drop staging, proposal review, multi-lane rendering) — training was integrated as a genuinely new, parallel read-only layer sharing the same conflict-detection *concept* (via a new module) rather than retrofitted into the existing fixture-only types, to avoid any risk of regressing that already-complex, already-tested surface.

## Browser / UAT

**BLOCKED — DEFER UNTIL USER RETURNS.** Claude-in-Chrome tooling was not exercised in this pass given the explicit instruction to proceed autonomously through implementation/database/regression/type/lint/security work without waiting, and the volume of that work; a live desktop/tablet/mobile walkthrough of the new `/club/training` page, the Automatic Training Booking toggle flow, and the Pitch Allocation training cards has not been performed. Everything else in Sections 97's phase list is complete.

## Deferred items (explicit, not hidden)

- Live browser UAT (desktop/tablet/mobile) and its accessibility walkthrough (keyboard-only pass through the plan form, focus order, screen-reader labelling beyond the `<label htmlFor>`/`aria-label` already written into the markup).
- Drag-and-drop reallocation of a training session directly on the Pitch Allocation board (domain/RPC support exists via `override_training_session`; no UI control calls it from that board yet).
- Literal "Team Name — Planned Training" wording in every Calendar card view (implemented in Pitch Allocation's new card; Calendar's own existing lane-based labelling was left as-is).
- Notification wiring (event names only, documented as a future-extension vocabulary).
- Season-to-season plan rollover policy.
- `schedule-training-dialog.tsx` does not yet offer an explicit venue selector (relies on the pitch→venue fallback).
