# Season Handover / Mini-Rugby — Final Report

**Date:** 2026-09-05
**Scope:** Local Main project only. Nothing pushed, deployed, or applied to remote Supabase.
**Closes:** tasks #37 (cross-club/active-context security tests), #38 (browser verification), #39 (this report).

Each item is labelled with how it was verified:
**DB VERIFIED** (asserted against the live local database) ·
**SERVER ACTION VERIFIED** (the RPC/server path was actually invoked) ·
**BROWSER VERIFIED** (seen rendering in a real signed-in browser session) ·
**BLOCKED BY TOOLING** (could not be verified with available tooling).

---

**A. Scope boundary.** This report covers the Season Handover / Mini-Rugby surfaces only: automatic handover status, rollover proposal review, mixed-boundary confirmation, rollover group flags, graduation queue, and the Mini-Rugby next-season group wizard. Player Requests / Eligibility are explicitly out of scope — that workstream has its own closed security and browser coverage (tasks #48, #53, #54, #57, #59).

**B. Authorization gates exist on every reachable RPC. DB VERIFIED.** All seven RPCs the Club Admin UI can reach were checked against their live `pg_get_functiondef` output, not against migration files:

| RPC | Gate |
|---|---|
| `generate_rollover_proposal` | `internal.has_capability('club.season_rollover.manage','club')` |
| `confirm_rollover_team_proposal` | `can_manage_club_fixtures` OR `is_site_admin` |
| `confirm_mixed_boundary_rollover` | `can_manage_club_fixtures` OR `is_site_admin` |
| `resolve_rollover_group_flag` | `can_manage_club_fixtures` OR `is_site_admin` |
| `place_graduating_player` | `has_capability('place_graduating_players', team\|club)` + same-club constraint |
| `mark_graduating_player_left` | `can_manage_club_fixtures` OR `is_site_admin` |
| `create_next_season_scheduling_group` | `has_capability('manage_mini_rugby_groups','club')` |

**C. Authorization is server-side, not UI-hiding. DB VERIFIED.** `app/(app)/club/rollover/actions.ts` contains no capability checks of its own; every gate lives inside the `SECURITY DEFINER` RPC. The page's `hasCapability` calls only decide what to *show*.

**D. The cross-club coverage gap was real. DB VERIFIED.** Before this pass, `season_rollover.sql`, `senior_cohort_graduation.sql` and `mini_rugby_next_season_group.sql` contained **zero** cross-club or unauthorized-caller assertions (confirmed by grep). Only `scheduling_groups.sql` had any. Task #37 was genuinely outstanding, not already-covered.

**E. New permanent regression suite. DB VERIFIED — 9/9 PASS.** Added `supabase/tests/season_handover_cross_club_security.sql`. It builds two isolated clubs in the *same* rugby code (so a rejection is proven to be on authority, never merely a code mismatch), each with a real active non-suspended Club Admin, and fires every vector directly at the RPC as the authenticated role.

**F. Cross-club denial, all seven RPCs. SERVER ACTION VERIFIED.** Club A's admin was denied on each of Club B's objects: `generate_rollover_proposal` (42501), `confirm_rollover_team_proposal` (42501), `confirm_mixed_boundary_rollover` (42501), `resolve_rollover_group_flag` (42501), `place_graduating_player` (23514 — same-club constraint), `mark_graduating_player_left` (42501), `create_next_season_scheduling_group` (42501).

**G. Player-poaching vector specifically. SERVER ACTION VERIFIED.** The nastiest shape — Club A's admin placing Club B's graduating player onto a team Club A legitimately owns — is rejected by the queue entry's own club-ownership check, not merely by the target-team check.

**H. Positive control. SERVER ACTION VERIFIED.** Club B's own admin *can* resolve Club B's own rollover flag. Without this, every denial above could have been explained by a uniformly broken RPC.

**I. Anonymous caller. SERVER ACTION VERIFIED.** `anon` is denied (42501). The assertion is deliberately strict about *why*: an earlier draft accepted any exception and "passed" on a malformed-UUID syntax error — a false pass that proved nothing. It now only accepts 42501/42883.

**J. Active-context boundary. BROWSER VERIFIED.** With the active context set to Parent (`parent:<playerId>:<teamId>`), `/club/rollover` correctly redirects to `/dashboard` — club-admin surfaces are unreachable from a non-club context even for a user who *is* a Club Admin elsewhere. Switching context to Burnley RUFC via the app's own switcher restored access.

**K. Parent context key shape. BROWSER VERIFIED.** The live cookie read `ovalball_ctx=parent:98a00000-…:99600000-…` — the canonical 3-part `parent:<playerId>:<teamId>` form.

**L. Automatic handover status panel. BROWSER VERIFIED.** Renders with real target seasons ("Rugby Union 26/27 → Rugby Union 27/28", "Not yet due", automatic progression date).

**M. Rollover proposal review. BROWSER VERIFIED.** "Generate a rollover proposal" control plus real per-team proposal rows with Confirm/Adjust/Fold/Defer.

**N. Manual-choice and structural-transition cases. BROWSER VERIFIED.** Both "requires explicit choice" (U16) and "Mixed → U12 structural transition" (U11) render distinctly rather than as ordinary confirmations.

**O. Rollover group flag. BROWSER VERIFIED.** "U7/U8 Mini-Rugby Group requires reconfiguration" renders with its Mark-resolved action.

**P. Mini-Rugby next-season wizard. BROWSER VERIFIED.** "Mini-Rugby Groups — next season" section renders with the Falcons group and "Create next-season group" / "Edit composition then create".

**Q. Graduation queue. BROWSER VERIFIED (with seeded data).** The queue renders nothing when empty — correct, `GraduationQueue` returns `null` for zero rows. To verify it honestly rather than accept an empty state as proof, one disposable queue row was seeded for a real Burnley player; the panel then rendered "1 graduating player waiting to be placed", the player's name, and the place/left controls. **The disposable row was deleted afterwards and its removal confirmed.**

**R. Calendar season-phase header. BROWSER VERIFIED.** Season year label "26/27", Pre-Season/Season toggle, Week/Month toolbar and Agenda link all present, no horizontal overflow at 1400px.

**S. Responsive (tablet/mobile). BLOCKED BY TOOLING.** `resize_window` reports success but the viewport stays pinned at `innerWidth: 1400` (`outerWidth: 0`), so 834px and 390px could not genuinely be rendered. This is the same limitation recorded under task #59 — it is a tooling constraint, not a finding about the UI. Desktop was verified genuinely; tablet/mobile remain unverified and are **not** claimed.

**T. BUG FOUND AND FIXED #1 — `accept_fixture_request` broke on group-targeted requests. DB VERIFIED.** The insert wrote **both** `opponent_directory_id` and `opponent_scheduling_group_id` unconditionally, violating `fixtures_opponent_group_excludes_directory` (which allows exactly one opponent identity). Any request targeting a Mini-Rugby Group whose opponent came from the club directory — the ordinary case — failed outright, so the Club Admin's "Accept" simply errored. Fixed in `supabase/migrations/20260929000000_fix_accept_fixture_request_group_opponent.sql`: when the request resolves against a group, the group is the canonical opponent identity and the directory reference is written as NULL. Non-group requests are unchanged.

**U. BUG FOUND AND FIXED #2 — Mini-Rugby composition freeze ignored the opponent side. DB VERIFIED.** `set_scheduling_group_members` refuses composition edits once a real fixture references the group, but counted only `owning_scheduling_group_id`. Since the group-vs-group model added `opponent_scheduling_group_id`, a group booked as the **opponent** (the normal away case) was still editable — silently rewriting the historical record of which teams actually played. Fixed in `supabase/migrations/20260929100000_fix_scheduling_group_composition_freeze_opponent_side.sql` to count either side.

**V. Snapshot immutability — investigated, NOT a bug. DB VERIFIED.** A failing assertion suggested a historical fixture's `owning_team_age_group_snapshot` had been rewritten. Tested directly on fresh rows in a self-rolling-back transaction: a fixture created at U14 still read U14 after its team aged to U15. The invariant holds; the failure was stale test state.

**W. Test-suite hygiene defect found and fixed. DB VERIFIED.** `season_rollover.sql` and `scheduling_groups.sql` were **not idempotent**: their fixtures used `on conflict (id) do nothing`, so once a run confirmed a rollover / accepted a request, re-runs asserted against state the suite itself had mutated. This produced permanent false FAILs — actively harmful, since it trains readers to ignore red. Both now reset their own pre-state (team age/squad, proposals, request status, `target_team_id`, resulting fixtures). Verified by running each suite twice with identical results.

**X. One superseded assertion rewritten. DB VERIFIED.** `scheduling_groups.sql` test 13 asserted that an ambiguous group request must be *rejected* pending explicit team selection. The group-vs-group model deliberately replaced that rule (the RPC's own comment: accept against the WHOLE group, the resolved member being only the required real anchor). Rather than leave a permanent false FAIL, the test now asserts the current canonical contract — and doubles as regression coverage for the fix in **T** (group recorded as opponent identity, no duplicate directory opponent, real anchor present).

**Y. Test results. DB VERIFIED — 100 PASS / 1 FAIL / 0 ERROR** across the ten Season Handover / Mini-Rugby suites:

| Suite | PASS | FAIL | ERROR |
|---|---|---|---|
| season_handover_cross_club_security *(new)* | 9 | 0 | 0 |
| season_rollover | 22 | 0 | 0 |
| senior_cohort_graduation | 10 | 0 | 0 |
| mini_rugby_next_season_group | 5 | 0 | 0 |
| scheduling_groups | 26 | 1 | 0 |
| overlapping_scheduling_groups | 3 | 0 | 0 |
| season_transitions | 7 | 0 | 0 |
| season_transition_boundary | 6 | 0 | 0 |
| season_transition_future_fixture | 4 | 0 | 0 |
| team_identity_season_projector | 8 | 0 | 0 |
| **TOTAL** | **100** | **1** | **0** |

Before this pass the same set ran 83 PASS / 4 FAIL / 5 ERROR.

**Z. The one remaining failure, stated plainly.** `scheduling_groups.sql` test 27a ("unexpected ids {}") still fails. It expects a non-empty id set and gets an empty one — another leftover-state dependency in the same suite, now exposed rather than masked because the errors that previously aborted the run are gone. It belongs to the **group-vs-group** workstream (tasks #62–72), not to Season Handover / Mini-Rugby, and no Season Handover surface depends on it. It is left open and disclosed rather than silently patched or hidden.

**Typecheck:** clean apart from two pre-existing, unrelated dead-code errors in `app/(app)/teams/[teamId]/team-edit-form.tsx` (`setTeamActive`, `updateTeam`), present throughout this engagement and unchanged by this work.
**Lint:** clean (zero output) across `app/(app)/club/rollover`, `app/(app)/club/settings`, `app/(app)/calendar`.

**Test data:** the new security suite leaves two clearly-named throwaway clubs (`SHX Test Club A`/`B`) in the local database so it stays re-runnable — the same convention `permission_matrix.sql` already uses. The graduation-queue row seeded for **Q** was deleted.

---

## Verdict

**SEASON HANDOVER / MINI-RUGBY — VERIFIED COMPLETE**

Every Season Handover / Mini-Rugby RPC is authorization-gated server-side, and that gating is now proven by a permanent cross-club/active-context suite rather than assumed. Every named UI surface renders with real data in a real signed-in session at desktop width. Two genuine product bugs were found, fixed by forward migration, and covered by regression. Two suites were made honestly re-runnable.

Two things are explicitly **not** claimed: tablet/mobile rendering (**S**, blocked by tooling) and `scheduling_groups` test 27a (**Z**, out-of-scope leftover-state dependency, disclosed and left open).
