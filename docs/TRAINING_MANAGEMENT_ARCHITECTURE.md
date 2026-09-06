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

## CALENDAR FIXTURE LIFECYCLE + MESSAGE CLUB HARDENING (extension of Training Management)

A second, sibling extension pass — Calendar as a safe operational control surface for fixtures, never a second fixture store. One fixture stays one canonical `fixtures` row throughout.

**Correction made at pre-integration reconciliation** (this section originally, incorrectly, described a confirmed fixture as two mirror-linked rows — that was already stale when first written here): a confirmed two-sided fixture has been genuinely **one** physical row, with `fixtures.id` as its stable identity, since `20260904600000_master_fixture_consolidation.sql` — a pre-existing, pre-fork Main migration whose own words are "makes a confirmed two-sided fixture genuinely ONE row with ONE stable fixture_id, not two 'mirror-linked' rows" and "mirror_fixture_id is legacy-only, that code path has not created a new pair since." `conversation_id` is a messaging convenience, never fixture identity. `mirror_fixture_id` is retained purely as legacy compatibility for historical pre-consolidation data; every "if mirror_fixture_id is not null" branch this extension adds is real, harmless, and a guaranteed no-op for any fixture created via the current `accept_fixture_request` — kept rather than removed, since it costs nothing and correctly serves any surviving historical pair.

### Cancellation semantics
`cancel_fixture(p_fixture_id, p_reason)` is the first genuinely callable, safe cancellation path for an ordinary Club Admin/Team Admin/Coach/Manager — cancellation was previously only reachable via a raw, unguarded status-dropdown flip in the fixture Edit panel (no reason, no confirmation, no mirror sync), which is now blocked both in the UI (the dropdown no longer offers "Cancelled") and server-side (`updateCalendarFixture` explicitly rejects a submitted `status: "Cancelled"`). Reuses `internal.can_submit_fixture_result`'s exact existing authority boundary (team official or club-level official of either side) — this is not new authority, it is the same status flip made safe. Required non-blank reason; posts a system-event message into the shared conversation and notifies both sides' officials via the existing `internal.fixture_result_notify`. Also includes a `mirror_fixture_id`-propagation branch (with a reworded reason on the mirror side: "Cancelled by the opposing club: ...") matching `fold_team()`'s own precedent — this is legacy-compatibility-only, a guaranteed no-op for any fixture created via the current `accept_fixture_request` (see the corrected fixture-model note above), kept only to correctly serve any surviving historical mirror pair.

**Reconciliation note on authority** (Section 6 of the Main pre-merge audit): Main has had a dedicated `fixture.cancel` capability since before this side project's fork, granted to the same role set `can_submit_fixture_result` already covers. `cancel_fixture()` does not yet call `internal.has_capability('fixture.cancel', ...)`, so a Site Admin's `capability_overrides` grant/deny on `fixture.cancel` has no effect on it today — this matches the current, already-accepted state of Main's OTHER fixture-mutation RPCs (`submit_fixture_result`, `update_fixture_schedule`, `fold_team`), none of which call `has_capability()` either; migrating the whole surface is Main's own explicitly deferred, app-wide decision (see `atomic_fixture_schedule.sql`'s own comment). This is disclosed technical debt, not a regression introduced here, and is not resolved as part of this integration. A cancelled fixture is suppressed from Parent/Player Calendar (see below) but stays visible, clearly marked, to every back-office role.

### Delete/archive semantics
"Delete Fixture" in the product is `archive_fixture(p_fixture_id, p_reason)` — never a physical row delete (`delete_fixture()` remains the separate, narrower, Site-Admin-only hard-delete path for genuinely orphaned rows with zero activity, unchanged). Adds three new, purely additive columns to `fixtures`: `archived_at`/`archived_by`/`archival_reason`, mirroring the table's own existing `cancelled_at`/`cancelled_by`/`cancellation_reason` naming triple. Deliberately **orthogonal to `status`** — archiving does not itself cancel a fixture, and cancelling does not archive one; a fixture can be cancelled-and-archived, archived-only (e.g. a duplicate/erroneous entry deleted directly), or cancelled-only. This means every consumer that must stop treating an archived fixture as live has its own explicit `archived_at is null` filter (Calendar's main query, Pitch Allocation's occupancy query) rather than relying on `status <> 'Cancelled'` alone to also catch archived rows. Authority is narrower than cancel — `can_manage_club_fixtures` on the fixture's own `owning_team_id`'s club only (Club Admin/Fixtures Secretary), matching the product's role matrix where Team Admin/Coach/Manager do not get delete by default. Single-row-scoped: does **not** propagate to a mirror row, since archiving is this club's own operational housekeeping decision about its own calendar, not a mutual "this match didn't happen" fact (Cancel already covers that case and does propagate). `restore_fixture(p_fixture_id)` is the minimal safe reuse of `reactivate_training_plan`'s own established pattern — reverses only the archive step, never touches status/cancellation, same authority boundary.

### Parent/Player suppression
The existing `ActiveContextKind` switcher (`"club" | "team" | "parent" | "player" | "site_admin"`) already distinguishes a genuine Parent/Player View from every staff context — no new role-detection logic was needed. Calendar's fixture query adds `.is("archived_at", null)` unconditionally (archived fixtures never appear in a normal Calendar query for anyone, staff included) and `.neq("status", "Cancelled")` only when `boardContext.kind` is `"parent"` or `"player"`. Verified live: a real guardian account, whose child is on the same team as a fixture that was cancelled moments earlier by the Club Admin, sees that fixture disappear from their Calendar entirely, while unrelated active fixtures for the same team remain visible.

### Back-office visibility
Cancel/Delete/Message Club/Directions all live in the Calendar fixture detail Sheet's action row (`FixtureLifecycleActions` in `fixture-lifecycle-panel.tsx`, shared by week/month/mobile), gated per-fixture by three booleans computed server-side in `page.tsx`: `canEdit` (existing, reused for Cancel — same boundary), `canDelete` (new, narrower — `!iAmOpponent && hasClubFixtureAuthorityEarly`, i.e. only for a fixture whose `owning_team_id` is genuinely one of the viewer's own teams), and `canMessageClub` (see below). Never trusts a client-submitted actor identity anywhere — every RPC re-derives `auth.uid()` server-side.

### Deleted Calendar Events
`public.deleted_calendar_events` is a `security_invoker` view — a normalized READ projection (Section R) unioning archived fixtures and genuinely-removed training (individually-cancelled sessions, or any session belonging to a deactivated plan), never a merged table. Each row carries `event_type` + `canonical_id` so a consumer always resolves back to the one real `fixtures`/`training_sessions` row. Since the view is `security_invoker`, it inherits exactly the underlying tables' own (already fully open, club-scoped-by-query) RLS — the page itself (`/club/calendar/deleted-events`) additionally scopes by the active club's id and gates access on `canManageClubFixturesAnywhere(ctx) || club.training.manage`, never a Parent/Player, Coach, or Manager by default.

### Message Club eligibility
No new "claimed club" detection was needed — `clubs` is already documented as "one row per **claimed** club_directory entry", so `fixture.opponent_team_id is not null` (a resolved real team) is already the stable, existing signal that the opposition is a claimed Ovalball club (teams only exist under claimed clubs). Eligibility additionally requires that opponent club's `status = 'active'` (the exact same `clubs.status === 'active'` signal Pitch Allocation's own `activeOpponentClubIds` already computes). Message Club routes into the exact same canonical `/messages/fixture/[id]` conversation thread that already existed (previously labeled "Open Conversation" and shown unconditionally for every fixture) — this extension's only change is gating that link's visibility on genuine eligibility, per Section D's explicit "hide the action rather than showing a broken button" for a legacy/unclaimed/free-text opponent. No second messaging system, no client-supplied target club_id (the eligibility check and the route both resolve everything server-side from the fixture row itself).

### Canonical season switcher (verification, not a build)
Audited and live-proven, not rebuilt — this was already fully canonical: `resolveCalendarSeasonContext` reads the real `seasons` table, excludes `is_regression_fixture` rows, orders by `starts_on`, and every season-switch link/query uses the real `season.id` while only the header label uses `season_ref`. Live-verified: switching to a genuinely nonexistent-in-this-fork "27/28" Union season (added as one real row for this verification) correctly shows an empty, real-data-scoped calendar rather than fabricating anything, and switching back to "26/27" shows the exact same real fixtures/training with team identity (U12/U13/U14 filter chips) completely unmutated by having switched away and back.

### Fixture/training shared Calendar projection boundary
Calendar's `page.tsx` already normalizes fixtures and training into one `WeekEntry` read shape for rendering (Section R's "event view"), but every mutation still dispatches to its own canonical domain: `cancel_fixture`/`archive_fixture` write only `fixtures`, and Training's own `cancel_training_session`/`deactivate_training_plan` (unchanged by this pass) write only `training_sessions`/`training_plans`. `deleted_calendar_events` follows the same discipline at the read layer — a `UNION ALL` view, never a merged table.

### Bugs found and fixed in this extension pass
1. The fixture Edit panel's plain `status` dropdown allowed silently flipping a fixture to `Cancelled` with zero reason, confirmation, or mirror sync — a real, pre-existing safety gap this pass closed by removing `Cancelled` from the dropdown's options and rejecting it server-side, redirecting all cancellation through the new guided path.
2. A view definition's LEFT JOIN through `club_pitches` for venue name (an early draft of `deleted_calendar_events`) missed that `fixtures` already carries its own `venue_id` directly — corrected to join `venues` straight off `fixtures.venue_id` before this ever shipped.
3. **UI/UX pass** (direct user feedback mid-build): the original fixture detail Sheet rendered an unstyled status line, a bare `dl`, and a ragged `flex-wrap` row of differently-styled buttons (solid black Edit, plain outline Open Fixture, small icon-only cancellation-info button). Extracted `fixture-action-button-styles.ts` (one shared primary/secondary/destructive button treatment with a subtle "3D" raised bottom-edge shadow and a consistent `active:translate-y-px` press effect, laid out in an even `grid-cols-2`) used identically across week/month/mobile Calendar and by `FixtureLifecycleActions`, and wrapped the fixture's own uneditable detail fields in a bordered card, separating "Kick Off" from "Date" and adding a resolved structured "Venue" row (fixtures' own `venue_id` was being fetched but never resolved to a name before this pass, so a fixture with a structured venue but no free-text `venue_address` showed no Venue row at all).
4. **Training-session naming inconsistency** (direct user feedback): three separate Calendar surfaces (`mobile-agenda.tsx`, `month-view.tsx`'s day drawer, `agenda/page.tsx`) each independently rendered a training entry's title as a bare `"<Team> training"` suffix. Standardized to `"<Team> Scheduled Training Session"` everywhere a training entry gets a title (the Agenda page's own day-by-day cards were also restructured into real per-day sections with the same 3D card treatment, rather than one flat list under a month header).

## PRE-INTEGRATION REMEDIATION (Side Project 2 → Main)

Follow-up to the pre-merge reconciliation audit, which returned `NOT READY` with two blocking items and several tracked non-blocking ones. This section records what was actually done to remove the blockers and prove genuine integration-readiness — not a repeat of the audit's own findings.

### A. Blocker remediation
Both blocking items resolved:
1. The 5 exact migration-version collisions — resolved by renumbering (B).
2. Main's two post-fork Mini-Rugby/fixture bug fixes — proven to survive the rebase, behaviorally, not by inspection (C).

### B. Migration rename map
All 14 Side2 post-fork migrations renumbered onto a clean, monotonically increasing range starting after Main's actual final migration (`20261010000000`), preserving exact execution order. Content unchanged except two later, separate comment-only corrections (D) and one real bug fix (a syntax error my own rename edit introduced — see "Bugs found" below).

| Original (Side2 dev-time) | Integration version |
|---|---|
| `20260929000000_training_management_schema.sql` | `20261011000000` |
| `20260929100000_training_management_recurrence_and_generation.sql` | `20261011010000` |
| `20260929200000_training_management_manual_reconciliation_and_reads.sql` | `20261011020000` |
| `20260929300000_training_session_schedule_rule_fk_fix.sql` | `20261011030000` |
| `20260929400000_reactivate_plan_restores_cancelled_sessions_fix.sql` | `20261011040000` |
| `20260930000000_training_card_fields_and_cancellation.sql` | `20261011050000` |
| `20260930100000_training_session_actions_and_notifications.sql` | `20261011060000` |
| `20260930200000_training_attendance.sql` | `20261011070000` |
| `20260930300000_training_session_card.sql` | `20261011080000` |
| `20260930400000_training_session_card_ambiguous_id_fix.sql` | `20261011090000` |
| `20260930500000_training_session_card_alias_shadow_fix.sql` | `20261011100000` |
| `20260930600000_training_my_players_for_session.sql` | `20261011110000` |
| `20260930700000_duplicate_function_overload_fix.sql` | `20261011120000` |
| `20261001000000_calendar_fixture_lifecycle.sql` | `20261011130000` |

The original development-time filenames remain in this document's own earlier "Migrations" list, unedited, for historical accuracy — only cross-referenced to this map, never rewritten.

### C. Main bug-fix preservation proof
Proven three ways, not asserted:
1. **Structural**: confirmed via `grep` that no Side2 migration (pre- or post-fork) redefines `accept_fixture_request` or `set_scheduling_group_members` — Main's fixed definitions are never at risk of being overwritten, by construction.
2. **Negative control**: `supabase/tests/main_bugfix_preservation_regression.sql`, run against Side2's own pre-rebase database, correctly **failed** — reproducing the exact real bug (a check-constraint violation on group-targeted requests with a directory opponent), proving the test itself is valid and the bug was genuinely present before remediation.
3. **Positive proof**: the same test, run again after the rebase against a reconciled database, **passes both assertions** — the group-opponent fix and the opponent-side composition freeze are both intact.

### D. Fixture-model documentation correction
The Calendar Fixture Lifecycle section above (and the migration's own header/function comments) previously stated a confirmed fixture is "genuinely two rows... reciprocally linked by mirror_fixture_id" — wrong when written, corrected here. See that section for the corrected text. No SQL logic changed, comments only. `mirror_fixture_id`'s defensive branches are kept, not removed — real, harmless compatibility code for historical pre-consolidation data.

### E. Rebase result
Side2's 4 feature commits (plus the renumbering commit) rebased cleanly onto Main's real `c60c083` via `git rebase --onto` (Main fetched read-only into Side2's own repo as `main-readonly/main` — Main's repository itself was never written to). One real conflict, in the auto-generated `types/database.types.ts` (expected — both sides had evolved it independently since the fork); resolved with a placeholder during the rebase and properly regenerated afterward (F) from a live database reflecting the true combined schema. No other file conflicted across all 5 commits. Commercial/platform preservation explicitly verified: `git diff --name-status` between Main's `c60c083` and the rebased HEAD shows **zero** files under billing/subscription/referral/beta/GoCardless/legal/social-auth/finance/trial/commercial/release/mode-related paths — Side2 touches none of it.

### F. Clean replay
Repeated for real against the actual rebased/renumbered migration files (no hand-editing, no skipped SQL) — a fresh throwaway database, Main's real local database dump plus the 10 Main migrations missing from that local instance (bringing it to genuine current-HEAD schema), then all 14 of Side2's renumbered migrations, applied in order. **Result: 24/24 migrations, 0 errors.** One real bug was caught by this replay and only by this replay (not by inspection): an unescaped apostrophe in a comment I had added moments earlier broke a `COMMENT ON TABLE` statement outright (SQLSTATE syntax error). Fixed, and the full 24-migration replay re-run clean. `types/database.types.ts` was regenerated directly from this reconciled database. Disclosed test-environment adaptation (unavoidable, not a schema issue): `pg_cron`'s single-database restriction means one Main migration's own `CREATE EXTENSION pg_cron`/`cron.schedule(...)` lines cannot run in a differently-named throwaway database on the same cluster — stripped for the replay only, real file untouched, no cron-related content is Side2's concern either way.

### G. Regression
- Side2's own suites: **84/84 PASS** — the existing 35 + 27 + 20, plus the new 2-assertion `main_bugfix_preservation_regression.sql`.
- Main's own suites, run against the reconciled database: `scheduling_groups.sql`, `fixture_status_lifecycle.sql`, `season_transitions.sql`, `season_rollover.sql`, `capability_engine.sql`, `group_vs_group_fixture_model.sql`, `group_vs_group_acceptance.sql` all clean. Four files (`fixture_management.sql`, `shared_team_capacity.sql`, `team_lifecycle.sql`, `permission_matrix.sql`) show failures — **proven, not assumed, to be pre-existing/test-environment, not a Side2 regression**: run a second time against a Main-only replica with zero Side2 migrations applied, every one of these four files fails with byte-for-byte identical errors at identical line numbers. Whether these tests pass depends on accumulated state/run order (Main's own suite is documented, by Main itself, as a sequential chain meant to run via a runner script this fork never had), not on schema content.
- **No new Main regression introduced by this integration** — the isolation test above is the proof.

### H. Dashboard/Upcoming Events status
**VERIFIED** (upgraded from the audit's "PARTIAL"). Live-verified on the rebased branch: the Training Management dashboard's "Upcoming Training Sessions" table correctly labels `Automatic` (plan-generated) vs `Manual` (ad-hoc) sessions distinctly; no duplicates; the U12 SEASON plan deleted earlier in this engagement correctly appears under "Past / archived plans" and none of its cancelled sessions appear in the upcoming list; the Calendar's own fixture rendering (cancelled fixture shown red/marked, active fixtures shown normally) remains intact alongside training; season/team context (U12/U13/U14 filter chips) correct throughout.

### I. Mini-Rugby Training status
**PARTIAL — real, disclosed, structural gap found and precisely characterized** (upgraded from the audit's "untested" to "tested and understood," not silently promoted to VERIFIED). `save_training_plan` (Side2's entire recurring-plan/generation system) has **no `p_scheduling_group_id` parameter at all**, confirmed structurally (`pg_get_function_identity_arguments`) before writing any test — a Mini-Rugby Group can never be given an *automatic recurring* Training Plan today. This fails safely: the capability is simply absent from the RPC surface (and the Club Admin UI's team picker only ever lists real teams), so there is no path to silently create duplicate or corrupted sessions — the feature is unreachable, not misbehaving. Separately, `create_training_session` (Main's original, pre-existing *manual* one-off booking function, untouched by Side2) does accept a scheduling group directly, and `supabase/tests/mini_rugby_training_reconciliation_check.sql` proves that specific path is correct after all of Side2's extensions: exactly one canonical `training_sessions` row per group session (no per-component-team duplication), correct component-team resolution via `scheduling_group_members`, training-v-training shared-pitch semantics preserved for group sessions too, and cross-club access correctly rejected. Not classified as a material defect (Section 21's bar) because it fails safe and does not regress anything Main already had.

### J. fixture.cancel technical debt
Documented, not resolved (per the remediation brief's own explicit instruction not to solve Main's app-wide capability migration here). `cancel_fixture()` follows Main's current, accepted legacy fixture-mutation authorization pattern (`can_submit_fixture_result`) — it does not yet make `fixture.cancel`/`capability_overrides` authoritative. This matches the same, already-accepted state of Main's other fixture-mutation RPCs (`submit_fixture_result`, `update_fixture_schedule`, `fold_team`) and is not claimed as resolved anywhere in this documentation.

### K. Browser UAT
Performed live on the rebased branch (`remediation/integration-renumber`, Side2's own running dev environment — its code is the actual rebased/renumbered code; its persistent local database, unaffected by the migration-filename-only rename, was not reset, preserving real demo data): Main's own redesigned passwordless login (confirming the rebase pulled in Main's current UI, not stale code); Club Admin → Training Management dashboard; Calendar automatic + manual training display; fixture detail Sheet (Edit/Open Fixture/Message Club/Cancel Fixture/Delete Fixture, correctly styled, BETA banner from Main's own newer platform-mode feature rendering without layout interference); Deleted Calendar Events. Not independently re-walked in the browser this pass (already extensively verified live earlier in this same engagement, on functionally identical code — the rebase changes zero Side2 logic): fixture cancel/archive/restore end-to-end, parent training attendance, staff training register. Mobile-viewport UAT: performed earlier this engagement (420×844), not repeated this pass.

### L. Remaining gaps
- Mini-Rugby recurring Training Plans: not implemented (I) — a real product decision needed before it can be claimed as supported, out of scope for this remediation.
- `fixture.cancel` capability-engine migration: deferred, Main's own explicit decision (J).
- Dashboard/Mini-Rugby browser re-verification this specific pass was via direct live UAT (H) and SQL-level proof (I) respectively, not a from-scratch UI walkthrough of every listed Section 18 item.

### M. Exact proposed integration range
`fcd0731..daf7121` (5 commits: `fcd0731`, `6989a51`, `7be714c`, `054bd1b`, `310f6d7`, `daf7121` — six, precisely; the training foundation, verification pass, extension, Calendar Fixture Lifecycle, migration renumbering, and doc/bug-fix commits), rebased onto Main's `c60c083`, on branch `remediation/integration-renumber`. Safety point preserved at tag/branch `pre-remediation-73854f7` (the original, pre-rebase `main` branch tip).

### N. Git state
- Main: branch `main`, HEAD `c60c083` (unchanged throughout this remediation — confirmed at the start and never touched).
- Side2: branch `remediation/integration-renumber`, HEAD `daf7121`. Original `main` branch still points at `73854f7`, untouched. Safety tag `pre-remediation-73854f7` and branch `safety/pre-remediation-73854f7` both point at `73854f7`.
- No push. No merge into Main. No remote migrations applied.
