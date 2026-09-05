# Training Management Architecture (Side Project 2)

## Source of truth (Section 91)

**Training Management owns Training Plans. `public.training_sessions` is the ONE canonical dated training occurrence.** Calendar is a consumer. Pitch Allocation is a consumer/editor of resource allocation (via `override_training_session`, not a second write path). Team Admin is a scoped consumer of the same rows, filtered by `team_id`. There is no synchronization copy anywhere — Calendar, Pitch Allocation, and Team Admin all issue their own read query against `public.training_sessions` directly.

**Acceptance question, answered:** can we change one canonical Training Session once and have every legitimate surface reflect it? **Yes.** Every surface (Calendar's week/month/agenda views, Pitch Allocation's board, Team Admin's calendar) reads `training_sessions` live; nothing caches or copies a session's fields elsewhere.

## Canonical entities

```
training_plans            -- recurring scheduling intent, ONE per (team, config)
  └─ training_plan_schedule_rules   -- one weekly pattern (weekday/time/duration/[dates])
       └─ generates ─┐
training_sessions     ◄──┘ -- ONE concrete dated occurrence (pre-existing table, extended)
```

- `training_plans`: `club_id`, `team_id` (one team per plan — a team may have more than one plan, e.g. two different weekly patterns), `season_id` (required for `SEASON`/`SEASON_PRE_SEASON`, null for `CUSTOM`), `schedule_mode`, `preferred_venue_id`, `preferred_pitch_id`, `status` (`ACTIVE`/`INACTIVE`/`NEEDS_ATTENTION`).
- `training_plan_schedule_rules`: `weekday` (0-6), `start_time`, `duration_minutes`, and — CUSTOM mode only — its own `starts_on`/`ends_on`. `SEASON`/`SEASON_PRE_SEASON` rules leave these null; the effective range is resolved fresh from the plan's `season_id` every time (never duplicated per rule), so a season-date correction is picked up automatically.
- `training_sessions` (pre-existing table from `20260902160000_training_sessions.sql`, extended additively): gained `training_plan_id`, `schedule_rule_id`, `season_id`, `venue_id`, `duration_minutes`, `status` (`PLANNED`/`CANCELLED`), `source` (`MANUAL`/`AUTOMATIC_PLAN`), `occurrence_date`, `is_overridden`. Every pre-existing column (`club_id`, `team_id`, `scheduling_group_id`, `session_date`, `start_time`, `end_time`, `pitch_id`, `notes`, `cancelled_at`, `cancellation_reason`) is unchanged in meaning.

## Why Plan and Session are separate (Section 4)

A recurring plan defines intent ("Mondays, 18:00, 90 minutes, 1 Sep → 31 Mar"); a session is one concrete, independently-mutable commitment. This is what lets a single occurrence be time-changed, pitch-changed, or cancelled without touching the other 38 Mondays in the plan, and lets the plan itself be edited later without silently rewriting history.

## Deliberate status-model decision (Section 26/84)

`training_sessions.status` stores **only** the real lifecycle: `PLANNED` or `CANCELLED`. "Needs pitch allocation" and "Completed" are **never stored** — both are computed:
- **Needs allocation / conflict**: exactly like Main's own existing Pitch Allocation feature already treats a fixture's "allocated vs unallocated" state (a computed property of `pitch_id`/`kickoff_time` presence — `partitionAllocation()` in `lib/pitch-allocation/auto-allocate.ts` — never a stored column on `fixtures`), a training session's allocation state is computed live from `(pitch_id, start_time)` presence plus `detectResourceConflicts()` (`lib/pitch-allocation/training-conflicts.ts`), never persisted.
- **Completed**: `internal.effective_training_session_status(status, session_date, end_time)` is a pure SQL function of already-stored data + `now()` — no cron job, no background worker, cannot go stale because nothing is ever written back. "Completed" here means the session's time has passed; it is **explicitly not** attendance-taken (this codebase has no training-attendance concept at all yet — see "Future extension points" below).

This mirrors the established convention in this exact codebase rather than inventing a parallel one, per Section 26's own instruction to check first.

## Recurrence resolution (Section 79) — the ONE canonical resolver

`internal.resolve_training_plan_occurrence_dates(plan_id)` is the single function that turns plan rules into occurrence dates. It is used by:
1. `public.generate_training_plan_sessions(plan_id)` — the real generator, idempotent via `insert ... on conflict (schedule_rule_id, occurrence_date) do nothing`.
2. `public.preview_training_plan_occurrences(...)` — the pre-save "this will create N sessions" preview the UI calls (Section 78), same underlying date math, callable before a plan even exists.

Calendar and Pitch Allocation never independently interpret recurrence — they only ever read the `training_sessions` rows the generator already produced.

## Season / Pre-Season / Custom semantics (Section 12-14, 41-42)

- `SEASON`: `season.starts_on` → `season.ends_on`, read fresh from the plan's own `season_id` every generation — never a hardcoded date, never Union-specific (League's season dates differ and are honoured identically).
- `SEASON_PRE_SEASON`: `season.pre_season_starts_on` → `season.ends_on`. If the canonical season has no `pre_season_starts_on`, the plan is set to `NEEDS_ATTENTION` and **zero** sessions are generated — never a fabricated fallback date (proven in the regression suite, test 3).
- `CUSTOM`: each rule supplies its own `starts_on`/`ends_on`; a range that never actually contains the rule's own weekday is rejected at save time (test 1g).

## Idempotent, bounded generation (Section 19, 22, 80-81)

- Bounded by construction: every mode resolves to a finite date range (a real season, or an explicit custom range) — there is no code path that can generate an occurrence with no upper bound.
- Idempotent by construction: `training_sessions_occurrence_key_idx`, a unique index on `(schedule_rule_id, occurrence_date)`, makes `ON CONFLICT DO NOTHING` the entire deduplication mechanism — no client-side tracking, safe under a repeated or concurrent call.
- Transactional by construction: `save_training_plan`/`generate_training_plan_sessions` are each one PL/pgSQL function invocation — Postgres gives the whole body one implicit transaction, so a mid-function failure leaves nothing partially applied.
- **Automation mechanism chosen**: full bounded generation at plan creation/activation time (not a rolling generator). A `SEASON` plan generates its whole season's sessions immediately, in one call, inside `save_training_plan`. This was chosen because every mode already resolves to a genuinely finite, known-in-advance range — there is no "keep extending forever" case a rolling generator would be needed for. **Consequence, documented rather than silently assumed**: a new season's sessions require either editing the plan's `season_id` (which this codebase deliberately does NOT allow casually — see "Season/team identity is never casually changed" below) or creating a fresh plan for the new season. No automatic season-rollover behavior exists for Training Plans in this pass; this is the same "explicit next-season plan or review policy" the spec itself anticipated (Section 19) and is listed as a deferred item below.

## Plan editing and single-occurrence overrides (Section 23, 25, 37)

Editing a plan's schedule (`save_training_plan` on an existing `plan_id`):
1. Cancels (never deletes) every **future**, **non-overridden** `AUTOMATIC_PLAN` session belonging to the plan.
2. Replaces the schedule rules.
3. Regenerates from the fresh rule set — the unique occurrence index means anything still valid is naturally re-created with the exact same identity it would have had anyway (no gap, no duplicate).
4. **Never touches** a past session, or one where `is_overridden = true`.

`public.override_training_session(...)` changes exactly one occurrence's time/venue/pitch, or cancels it — and sets `is_overridden = true` so no future plan edit or regeneration ever silently reclaims it. Overriding a session's pitch **never** writes back to the plan's own `preferred_pitch_id` — preferred (recurring intent) and allocated (this occurrence's actual assignment) are kept genuinely independent, per Section 37.

## Pitch/resource conflict engine (Section 32-38, 60, 67)

`lib/pitch-allocation/training-conflicts.ts` is a **new, separate** module from the pre-existing `lib/pitch-allocation/auto-allocate.ts` — deliberately not a modification of `detectConflicts()`, so that function's existing behaviour and its own regression suite (`auto-allocate.verify.ts`) are completely unaffected. `detectResourceConflicts(fixtures, trainingSessions, pitches, buffers)` runs the same sweep-line overlap algorithm across the **combined** occupancy of fixtures and training sessions on each pitch, honouring the hard rule that **training has no warm-up/pack-up window** (fixtures keep their existing buffers; training's occupied window is always exactly `start → start + duration`). It reports fixture-side and training-side conflicts as two separate arrays so existing fixture-card rendering needs no change. Wired into `app/(app)/calendar/pitch-allocation/data.ts` (server-side board data) and `pitch-allocation-board.tsx` (a new, visually distinct, read-only `TrainingCard` rendered on the same timeline).

Training is never represented as a fixture (Section 59) — it has its own type (`TrainingOccupancy`), its own card component, and is never counted in `board.fixtures`.

## Calendar / Team Admin integration (Section 28-29, 39-40)

Main's Calendar (`app/(app)/calendar/page.tsx`) already reads `training_sessions` filtered by the caller's own `team_id`/`scheduling_group_id` set — this is the exact mechanism that already serves Team Admin (a team-scoped active context reads only that team's rows) as well as Club Admin (club-wide). No new query, no new "Team Admin training" table was introduced — Section 39's "no separate Team Admin training database" is satisfied because there never was one to begin with; this workstream only added columns to the one table everyone already reads.

## Manual Calendar training reconciliation (Section 30-31, 62 — audited first, per instruction)

Audited before writing any new schema: `app/(app)/calendar/schedule-training-dialog.tsx` already calls `create_training_session`/`cancel_training_session`, writing directly into `public.training_sessions` with **no parallel/legacy table** — the existing model was already strong. Both RPCs were reconciled (additive parameter/column changes only, every existing call site keeps working unchanged):
- `create_training_session` gained an optional trailing `p_venue_id` parameter and now populates `venue_id` (explicit, or derived from the chosen pitch's own venue — matching how `fixtures.venue_id` already falls back to its pitch's venue), `duration_minutes` (computed from `start_time`/`end_time` when both are given), `source = 'MANUAL'`, and `status = 'PLANNED'`.
- `cancel_training_session` now sets `status = 'CANCELLED'` (a database trigger, `sync_training_session_cancellation`, keeps the pre-existing `cancelled_at`/`cancellation_reason` columns in lockstep automatically, so any code still reading only those two columns keeps working unchanged).

Manual sessions have `training_plan_id = NULL` and appear in Training Management's overview counts identically to automatic ones.

## Permissions (Section 43-44)

One new capability: **`club.training.manage`** — Club-Admin-only (added to `internal.has_club_role_capability`'s `CLUB_ADMIN` branch only; re-derived from this database's current live definition before editing, so no other role's existing grant, including the six capability keys Main's own independent season/team-identity work had already added, was touched). Gates every Training Plan mutation (`save_training_plan`, `deactivate_training_plan`, `reactivate_training_plan`, `generate_training_plan_sessions`, `preview_training_plan_occurrences`) plus club-scoped occurrence overrides. Manual ad-hoc "Schedule Training" keeps its pre-existing, unchanged `fixture.create`-based authority (Club Admin/Fixture Secretary at club scope, Team Admin/Coach/Manager at team scope) — Team Admin/Coach can still schedule one-off sessions for their own team exactly as before; they cannot touch club-wide automatic Training Plans (Section 44's explicit instruction). Read access to `training_plans`/`training_plan_schedule_rules` is open (`using (true)`), matching `training_sessions`' own established "plan/pitch names are not sensitive" posture.

## RLS / security summary

Every new table (`training_plans`, `training_plan_schedule_rules`) has RLS enabled: open `SELECT`, capability-gated `ALL` for writes (both the direct-table policy and every RPC independently re-check `internal.has_capability('club.training.manage', 'club', club_id, null)` — defense in depth, matching this codebase's established convention). The cross-club tamper matrix (`supabase/tests/training_management_regression.sql`, section 8) proves an authenticated Club Admin from an unrelated club cannot create, edit, deactivate, or generate sessions for another club's plan even when supplying its real, known ID.

## Team/season/fixture identity contract (Section 40-41, 88-89)

- `training_plans.team_id` / `training_sessions.team_id` are Main's stable `teams.id` — never a display name or alias. A team rename or alias change never breaks a plan or a historical session.
- `training_plans.season_id` is one specific season row — a plan is never silently retargeted to a different season. Changing a plan's team or season identity is deliberately **not** exposed as an in-place edit in this pass (Section 88-89's own instruction: "if needed, deactivate and create a new plan" rather than mutate identity) — `save_training_plan`'s edit path does technically accept a `team_id`/`season_id` in its argument list for implementation simplicity, but the UI never offers changing them on an existing plan (the team selector is disabled when editing — see `training-management-client.tsx`). This is disclosed as a UI-level guard rather than a database-level immutability constraint; hardening the RPC itself to reject a team/season change outright is a reasonable follow-up, not done in this pass.
- No parallel `clubs`/`teams`/`seasons`/`fixtures` table was created anywhere in this workstream (verified via a direct grep across every new migration for `create table ... (clubs|teams|seasons|fixtures)` — zero matches).

## Future extension points (Section 57-58)

- **Notifications**: no notification table was created. Event names this domain naturally maps to (`training.created`, `training.changed`, `training.cancelled`, `training.pitch_changed`) are named here so a future pass wiring into Main's existing `notification_types`/`notification_topics` catalogue (used elsewhere in this codebase) has an agreed vocabulary to start from — nothing is built or stubbed for it yet.
- **Attendance**: explicitly out of scope (Section 58: "do not implement a second attendance system here"). `training_session_id` is a stable, permanent identity any future attendance feature can key off directly.
- **Parent/Player consumption**: `training_session_id`, `team_id`, date/time, venue/pitch, and status are all already stable and queryable — no redesign would be needed to expose them to a future Parent/Player surface.

## Known, disclosed gaps (not hidden)

1. Pitch Allocation's drag-and-drop reallocation UI was scoped to fixtures only in this pass — training sessions render as read-only cards with live conflict badges on the same board; moving one to a different pitch/time goes through `override_training_session` (already fully supported server-side) from the Training Management plan editor, not a drag gesture on the Pitch Allocation board itself.
2. ~~The Calendar's compact card wording...~~ **Resolved in a later pass**: Calendar week/month training cards now read `"<Team> — Planned Training · <time>"` with the pitch name shown, matching Pitch Allocation's own `TrainingCard` wording exactly (see "Shared training pitches" section below for the pass that fixed this).
3. No automatic season-rollover for Training Plans (see "Automation mechanism chosen" above) — a next season requires a deliberate new plan.
4. The existing `schedule-training-dialog.tsx` (manual Calendar training) does not have an explicit venue `<select>` — it relies on the server-side pitch→venue fallback, which is always correct but means a Club Admin cannot pick a venue different from their chosen pitch's own venue through this particular dialog.

---

## EXTENSION PASS: shared pitches, cancellation, attendance, agenda, notifications

The sections below document a second, later extension to this same architecture (still one `training_session_id`, still one `training_plan_id` — no second training system was introduced). Old sections above remain accurate for what they describe; this extension changes one important rule (shared pitches) and adds several new capabilities on top of the existing schema.

### Shared training pitches (a deliberate reversal of the original conflict rule)

**Multiple training sessions may now legitimately occupy the same pitch at overlapping times.** Three age groups drilling on thirds of one full pitch is normal, not a conflict. This changes `lib/pitch-allocation/training-conflicts.ts`'s `detectResourceConflicts`: the sweep-line now tracks **fixture** occupancy and **training** occupancy as two independent active sets per pitch. A new fixture still conflicts with other active fixtures (respecting `lane_count`, unchanged) and with any active training (a fixture occupies its pitch exclusively — unchanged). A new training session **only ever conflicts with an active fixture**, never with another active training session, regardless of how many are already sharing that pitch — there is no invented per-pitch training capacity (`lane_count` is a fixture-capacity concept only and does not apply to training-vs-training). This is a real, deliberate behavioural reversal from the original conflict engine, not an oversight — the original pass had training obey the same lane-capacity rule as fixtures, which was correct for the spec it was built against but wrong for this one.

Fixture exclusivity is otherwise completely unchanged: a fixture's full occupancy window (kickoff minus warm-up, through final whistle plus pack-up) still conflicts with any training that overlaps it, and vice versa, with precise interval semantics (training starting exactly when a fixture's occupancy ends is allowed, not a phantom overlap).

### Cancellation (individual occurrence)

`cancel_training_session(p_session_id, p_reason)` now **requires** a real, non-blank reason (validated server-side, not just in the UI), records `cancelled_by` (a stable `auth.users` id, resolved to a display name only at read time via `get_training_session_card`), blocks cancelling an already-cancelled or genuinely past/completed session, and sends a `training_session_cancelled` notification to real participants. The row is never deleted — `status` becomes `CANCELLED`, every other field (team, venue, pitch, agenda, notes, attendance, audit history) is preserved exactly as it was.

### Delete Training Plan

UI-labelled "Delete Training Plan" for user clarity; internally this is still `deactivate_training_plan` (Section 70's own instruction: user-facing language may differ from internal implementation as long as the semantics are safe). It now also requires a real reason, and:
- Sets the plan to `INACTIVE` (never physically deleted).
- Cancels (never deletes) every future, non-overridden session the plan generated.
- Leaves every past session, every individually-overridden/cancelled session, and every *other* plan (including a second plan for the same team) completely untouched.
- Sends **one aggregated** notification per affected recipient (never one per cancelled session) naming the nearest affected date and the total count.
- Is idempotent: calling it again on an already-inactive plan cancels nothing further and errors on nothing. Calling the session generator again on a deleted plan creates zero new sessions (its own `status <> 'ACTIVE'` short-circuit, unchanged from the original foundation pass).

`get_training_plan_deletion_impact(plan_id)` is a dedicated read (team, schedule, venue, pitch, real future-session count) so the confirmation dialog shows real impact before the user commits, never an estimate.

### Attendance — extends the canonical Side Project 1 model, does not duplicate it

Audited first: this fork's Main-integration snapshot already included Side Project 1's Player/Guardian Safeguarding Foundation, including the real canonical fixture-attendance table `public.player_fixture_attendance` (fixture_id, player_id, status, response_source, responded_by_user_id) and its age/consent rule (`respond_to_attendance`: an active guardian may always respond; a self-managed player needs to be 18+, or 16-17 with the existing `approve_own_attendance` consent grant; under-16 is blocked outright).

**Chosen extension: polymorphic, not a second table** (Section 20's option A). `player_fixture_attendance.fixture_id` became nullable, a new nullable `training_session_id` column was added, and `check (num_nonnulls(fixture_id, training_session_id) = 1)` enforces exactly one activity type per row — purely additive/relaxing, zero risk to existing fixture rows. The age/consent logic itself was extracted, unchanged, into `internal.resolve_attendance_response_source(player_id)`, and both `respond_to_attendance` (fixture, refactored to call it, identical external behaviour) and the new `respond_to_training_attendance` (training) call the same function — one rule, never two copies that could drift.

**Naming trade-off, disclosed**: the table keeps its original name (`player_fixture_attendance`) despite now covering both activities. A rename would touch every existing fixture-attendance call site across the app for a purely cosmetic gain; in an already-large extension pass, that risk was judged not worth it. If a future pass has more headroom, renaming to something activity-agnostic (with a compatibility view under the old name) would be the clean follow-up.

`get_training_register(session_id)` is the ONE canonical register per `training_session_id` (Section 47) — eligible players are every active roster member of the session's team, or every real component team of its Mini-Rugby Group (via `scheduling_group_members`, never a fabricated membership). Gated to `team.attendance.view`/`can_manage_training`, matching the fixture attendance summary's own existing authority tier. Parents/players never see the aggregate register or counts — only their own linked player's response (via `get_training_session_card`'s `my_attendance_status`) — a deliberate, conservative choice to mirror the fixture-attendance feature's existing visibility posture (Section 78) rather than invent broader visibility that doesn't exist anywhere else in this codebase yet.

### Agenda, further notes, one canonical card

`training_sessions` gained `agenda` (not null, with a single canonical default baked into the column's own `DEFAULT` — every insert path gets it for free, never copy-pasted into application code) and `further_notes` (nullable, participant/family-visible, explicitly documented as never for safeguarding/medical/internal-staff content). `get_training_session_card(session_id)` is the one consolidated read every surface (Calendar week/month/mobile-agenda) calls for a given `training_session_id` — team label, venue/pitch names, agenda, notes, cancellation detail (with a resolved display name, never a raw id), the caller's own attendance response, and two pre-computed authority flags (`can_manage`, `can_view_register`) so the client never needs a second round trip to know what controls to show (Section 66's "no N+1").

`override_training_session` (the existing single-occurrence edit RPC from the original pass) gained `p_agenda`/`p_further_notes` as new trailing optional parameters and now sends a `training_session_updated` notification, but only when a participant-visible field actually changed — comparing old and new values inside the same transaction as the write, so a no-op save never spams a duplicate notification.

### Notifications — reused, not duplicated

Three new `notification_types` rows (`training_session_updated`, `training_session_cancelled`, `training_plan_cancelled`) were added under the **already-existing** `calendar_training_updates` topic ("Calendar and training updates") — no new topic, no new preferences table, no new delivery mechanism. `internal.notify_training_participants(session_id, type, title, body)` resolves recipients as every active guardian plus every self-managed adult player on the session's own team (or its Mini-Rugby Group's real component teams) — the exact same eligibility the attendance model already establishes, not a separate resolver — and inserts into the existing generic `public.notifications` table with `data: {training_session_id, training_plan_id}` as the deep-link payload. Delivery is still gated per-recipient by the pre-existing `should_deliver_notification`/preferences mechanism, so an opted-out user is silently skipped exactly as for every other notification type in this codebase. Sending happens inside the same transaction as the underlying mutation (Section 72) — if the transaction rolls back, so does the notification insert; no outbox pattern was needed since nothing here spans multiple transactions.

### Bugs found and fixed in this extension pass

1. **`RETURNS TABLE(id uuid, ...)` column-name shadowing.** `get_training_session_card`'s own declared return columns (`id`, `team_id`, etc.) are implicitly visible as bare names throughout the function body in PL/pgSQL — a plain `where id = p_training_session_id` at the top of the function became genuinely ambiguous against the table's own `id` column, and even a qualified `s.id` was ambiguous a second time when the query's own FROM-alias was also named `s`, colliding with the outer declared row-type variable of the same name. Fixed by qualifying every reference and renaming the query alias to `sess`, distinct from the outer variable `s`.
2. **Duplicate function overloads from adding trailing parameters.** `CREATE OR REPLACE FUNCTION` does **not** replace an existing function when the new version's argument count differs from the old one, even when the added parameters are all optional/defaulted — Postgres treats it as a second, distinct overload identified by the full argument-type list. This had already happened silently once before (`create_training_session` gaining `p_venue_id` in the original pass) and happened again when `override_training_session` gained `p_agenda`/`p_further_notes` — both went unnoticed until a call using the *old*, shorter argument list became genuinely ambiguous between the stale overload and the new one's satisfied defaults ("function ... is not unique"). Fixed by explicitly `DROP FUNCTION`-ing both stale short overloads by their exact original signatures. **This is a durable lesson for any future migration in this codebase**: adding a new trailing optional parameter to an existing function requires an explicit `DROP FUNCTION <old signature>` in the same migration, never relying on `CREATE OR REPLACE` alone to retire the old shape.
3. **Reactivating a deleted plan didn't actually restore its sessions** (found in the prior pass, listed here only because the *pattern* recurred): `generate_training_plan_sessions`'s idempotent `ON CONFLICT DO NOTHING` correctly skips rows that already exist — including ones a prior deactivation had just marked `CANCELLED`. `reactivate_training_plan` was fixed to explicitly restore matching rows to `PLANNED` first. The same "idempotent insert silently no-ops against an already-existing-but-wrong-state row" shape is worth watching for in any future plan-lifecycle change.
4. **The persistent demo-data fixture script was not idempotent.** Re-running it (done once, live, while re-verifying this extension) silently duplicated every plan and manual session, since `save_training_plan`/`create_training_session` have no natural "this exact demo scenario already exists" key to conflict on. Fixed by adding an explicit existence guard at the top of the script (skip entirely if Burnley's U12 SEASON plan already exists) and cleaning up the real duplicated rows this created before the fix.
5. **Demo guardian's `auth.users` row was unusable for real sign-in.** Added to the fixture script to give the register/attendance feature a real person to test with, the first insert left `instance_id`/`aud`/`role` blank and several `*_token` columns `NULL`. This produced no visible error at first — GoTrue's user lookup filters by `instance_id`, so a blank one just never matched, and `signInWithOtp` intentionally returns the same "check your email" response whether or not a user exists, for security — then a real 500 (`sql: Scan error on column index 3, name "confirmation_token": converting NULL to string is unsupported`) on the very next attempt, since GoTrue's Go driver cannot scan a NULL into a Go `string` field. Only surfaced by actually attempting a real magic-link sign-in as the new user; neither the SQL regression suite nor a code review would have caught it. Fixed in both the live database and the fixture script by matching the shape of the already-working admin row: real `instance_id`/`aud`/`role`, and every token column defaulted to `''` rather than left `NULL`.
