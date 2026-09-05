# Ovalball — Session Handoff

Updated 2026-09-02 (Master Fixture Registry + Competition Directory + Tournament
architecture — COMPLETE, delivered for review). Untracked file — not committed, not pushed.
Reflects the CURRENT state of a long-running multi-phase session. Supersedes the earlier
(2026-09-01) version, which covered the Site Admin Team Directory slice (still COMPLETE and
unaffected by this work).

## THIS SLICE IS COMPLETE — delivered for the user's review

The user issued a massive combined spec ("STOP ALL OTHER ROADMAP WORK... MASTER FIXTURE
REGISTRY + CALENDAR/FIXTURE SYMMETRY + COMPETITION DIRECTORY + TOURNAMENT ARCHITECTURE"),
then explicitly authorized working through the whole thing unattended overnight ("keep
going... use your intuition"). Built in eight sequenced pieces (each delegated to a fork
with full write access, independently re-verified — fresh reset + full regression + tsc +
eslint + build + diff-check — before the next piece started, to avoid concurrent forks
colliding on the same local Supabase DB/filesystem): Master Fixture Registry consolidation,
Competition Directory + geography, Tournament architecture backend, Site Admin Fixture
Management + fixture-detail redesign, Club Calendar interactivity + Tournament UI wiring,
a design-quality pass on both, club-level CSV import/export, and mobile Calendar agenda
interactivity (each has its own `###` section below). **Final checkpoint: fresh reset, full
regression 761/761 PASS, 0 FAIL, 0 raw errors; `tsc`, `eslint` (0 errors), `next build`,
`git diff --check` all clean.** Additionally live-verified BY THE COORDINATING SESSION
ITSELF (not just each fork's own claim): Master Fixture ID symmetry across two real,
independently-authenticated club logins (Burnley and Rossendale both showing the identical
fixture, correctly opposite home/away framing); the redesigned Site Admin fixture detail
page (home/away club+team, single conversation section including live result-negotiation
history, opposition editing resolving to Rossendale RUFC via the real Club/Team Directory,
the `manage_fixture_support` capability gate correctly blocking an ungranted Site Admin from
posting). See DATA QUALITY below for the full integrity report.

**Process note, preserved for future sessions**: one piece (Master Fixture Registry) was
originally dispatched as a READ-ONLY audit fork ("do not write any code"). The fork
disregarded that instruction and implemented the consolidation anyway — the result was
genuinely good and was independently verified as correct, but this was a real instruction
violation, not sanctioned in advance, and it happened to work out. Do not treat "forks
sometimes exceed their brief and it's fine" as an established pattern; audit-only
instructions should mean audit-only. Every subsequent piece was correctly scoped by its own
fork.

**Known, deliberately-not-fixed gaps** (each explicitly flagged by the fork that found it,
not discovered later): mobile grid editing for Site Admin Fixture Management is still
view-only (Section DC of the user's spec wanted the same editing capability preserved via
drawer/sheet — the mobile READ view was confirmed intentional and non-broken, but editing
itself was judged out of scope for the design-polish pass that reviewed it); the full
`frontend-design`→`ui-ux-pro-max`→`Impeccable` pipeline was run as a scoped `ui-ux-pro-max`+
`Impeccable` pass only (no `frontend-design` invocation, since no new visual language needed
inventing — every surface extended the incumbent forest-950/chalk/pitch-green system). See
each piece's own section below for what it built, what it deliberately left, and how it was
verified.

## Git state

- Branch: `main`
- Nothing has been committed, pushed, or deployed this session (or any session covered by
  this file). No remote Supabase changes.

## Protected local baseline (as of last full regression run)

- **SQL regression: 711/711 PASS, 0 FAIL, 0 raw errors** (`run_regression.sh`, ordered
  suite covering every test file in `supabase/tests/`, including the expanded
  `canonical_team_catalogue.sql` (15 tests, up from 8) and the new
  `site_admin_team_directory.sql` (13 tests) — always run against a FRESH `npx supabase db
  reset --local` first; running it against a DB a live-browser session or a prior
  regression run has already written to gives false failures, as happened multiple times
  this session). This total is the real, current count — it is NOT any prior slice's total
  preserved artificially; several fixture identities across `scheduling_groups.sql`,
  `controlled_missing_team.sql`, `team_scoped_fixture_requests.sql`,
  `fixture_age_eligibility.sql`, `gender_age_grade_rules.sql`, `shared_team_capacity.sql`,
  and `season_rollover.sql` had to be corrected to valid catalogue identities, and 20 new
  dedicated tests were added across the two catalogue-correction slices.
- Post-regression checkpoint query (same fresh-reset + full-regression DB state the numbers
  above come from): **64 total team rows, 59 canonical operational (active, valid
  `canonical_team_type_id`), 5 legacy/historical (inactive), 0 unmapped ACTIVE rows**; the
  global catalogue itself: **25 total canonical types (24 original + 1 added by this
  session's own dedicated test), 24 active, 1 deactivated** (also by the test's own
  lifecycle coverage) — the invariant's central guarantee holds: every active row resolves
  to a real canonical
  identity, with zero exceptions, across the full accumulated regression-fixture dataset.
- `npx tsc --noEmit` — clean.
- `npx eslint .` — 0 errors (149 pre-existing warnings, all inside `.claude/skills/`
  tooling scripts and two long-standing app warnings unrelated to this session's work —
  not new).
- `npx next build` — clean.
- `git diff --check` — clean.

## ROADMAP STATUS

### COMPLETE / PROTECTED
- Unified fixture conversation (shared `conversation_id` across mirror-linked fixture rows)
- Live message refresh (Realtime broadcast-from-database, render-time state adjustment)
- Corrected club deactivate/reactivate lifecycle (deactivation ≠ fixture cancellation;
  membership authority suspension + explicit one-at-a-time restoration)
- Boys/Girls age-grade terminology (Mixed/Boys/Girls for youth, Men's/Women's for senior;
  `teams_gender_category_check`, `identity_key` widened to include gender)
- Stable annual team rollover (same `team_id` across normal age progression)
- U11 Mixed → U12 Boys continuation, with an explicit (never defaulted) Yes/No decision to
  also create a brand-new, separately-tracked U12 Girls team
- Controlled missing-team fixture-request flow (`resolve_incoming_request_target` /
  `create_missing_target_team` — collision-aware: existing active/folded team, ambiguous
  squad, pending rollover, pending structural decision, all checked before ever creating)
- Automatic Partnership Request after an accepted fixture between two active clubs (never
  auto-accepted; decline explicitly reassures "your fixture remains confirmed")
- **Club Message Requests**, **Context Switcher**, **Site Admin diagnostic access**,
  **Team Manager / Coach permission parity**, **Calendar Core Week View + Agenda**, the
  **Calendar Design Correction**, **Locked Team Naming**, and the subsequent **Team + Club
  Users Foundation** slice (this session's newest — see its own section below; Day and
  Season calendar views are still not built, documented there, not silently missing)

### Club Message Requests — COMPLETE
Direct club-to-club conversations, architecturally separate from `club_partnerships`
(accepting a Message Request never creates a partnership) and reusing the existing
`fixture_messages` infrastructure rather than a parallel chat engine.

- **Schema**: `club_conversations` (pending/accepted/declined, one row per unordered club
  pair via a partial unique index). `fixture_messages` widened with a third nullable
  `club_conversation_id` column (exactly-one-of-three check), reusing its RLS, realtime
  broadcast trigger, notification trigger, and read/unread — NOT a new messaging system.
- **RPCs**: `start_or_get_club_conversation` (reuses an existing pending/accepted
  conversation for the pair rather than duplicating; skips the request stage entirely for
  an already-active partnership; 48h cooldown after a decline; a 5-pending-outgoing
  anti-spam cap) and `respond_to_club_conversation` (accept writes a
  `"Message request accepted by <Club>"` system event into the SAME conversation the
  original first message lives in; decline notifies the requester with a restrained
  message, never naming the individual who declined).
- **UI**: `/messages/new` (+ New Message — club search showing Partner/On Ovalball/Not on
  Ovalball status), a "Message requests" inbox section on `/messages` (Accept/Decline),
  accepted conversations reuse the existing `/messages/[kind]/[id]` thread shell with a new
  `kind="club"` branch (no team/kickoff/pitch/result UI, correctly gated off).
- **Tests**: `supabase/tests/club_conversations.sql`, 20/20 PASS — covers first-message
  preservation, RLS cross-club leakage, unauthorized-responder rejection, accept idempotency,
  reuse (never a duplicate/crossing conversation), decline + cooldown, partner bypass,
  unactivated-club refusal, rate limiting, and confirms ordinary fixture messaging is
  unaffected by the schema widening.
- **Live-verified in browser**: Burnley → a fresh non-partner club, full request → Message
  Requests inbox → Accept → system event → reply, all confirmed via direct DB read of the
  resulting `fixture_messages` rows (correct `kind`/`conversation_id` on all three).
- **Deliberately deferred, not silently unsupported** (each surfaced as an explicit
  "not available yet" state in the UI rather than pretending to work):
  - Attachments, document-library sharing, and contact-card sharing inside a club
    conversation. Those RPCs are coupled to `internal.resolve_my_fixture_club_id(fixture_id,
    fixture_request_id)` and per-club message-policy resolution keyed off a fixture —
    widening that whole surface is a real follow-up, not a small change.
  - Add/remove participant and mute/leave inside a club conversation (same RPC coupling).
- **Known pre-existing gap surfaced (not caused) by this work**: when a viewer with no
  `club_admin` standing at the OTHER party's club reads a conversation, `resolveParticipantIdentities`
  (`lib/app-context/resolve-identities.ts`) falls back to a generic "Member · Ovalball"
  label for that side's sender, because its `club_memberships` lookup is a plain RLS-scoped
  query (`club_memberships_select_scoped`: own row, Site Admin, or `is_club_admin(that
  club)` only) — it can't see the other club's real role/club name. This is the SAME shared
  helper used for ordinary fixture/request conversations, so the gap is not new, just more
  likely to be hit here since club-to-club messaging naturally happens between clubs with no
  other relationship. A real fix would widen `get_conversation_participant_names` (already a
  SECURITY DEFINER RPC) to also return role + club name, bypassing the RLS gap the same way
  it already bypasses it for the name/avatar. Not fixed this session — flagged, not silently
  left broken.

### Context Switcher — COMPLETE (with one documented scope boundary)
Compact sidebar/mobile-menu switcher for a session that holds more than one operating
context (Club Admin at more than one club, a team-scoped permission, Site Admin).

- **Architecture**: `lib/app-context/active-context.ts` — `SwitchableContext` (`kind:
  "site_admin"|"club"|"team"`), `listSwitchableContexts(ctx)` (every real context the
  session holds club-wide authority, non-view-only team authority, or Site Admin status
  at), `resolveActiveContext(ctx, cookieKey)`. The cookie (`ovalball_ctx`, server-set via
  `app/(app)/set-context.ts`'s `setActiveContext` action) is a UI preference only — a
  stale/tampered value just falls back safely, it can never grant a context the session
  doesn't really hold, since `resolveActiveContext` always re-derives against the real
  session on every read.
- **UI**: `app/(app)/context-switcher.tsx` (desktop dropdown, `DropdownMenu` from
  `components/ui/dropdown-menu.tsx`) and an inline "Switch context" list in
  `app/(app)/app-mobile-nav.tsx`'s slide-out sheet, both calling the shared
  `app/(app)/use-switch-context.ts` hook (`setActiveContext` + `router.refresh()`). A
  single-context session sees the plain identity link unchanged — the switcher affordance
  only appears once there is genuinely more than one context to switch between.
- **Scope propagation**: `buildNavItems(ctx, activeContext)` now takes the active context
  (previously defaulted to `clubMemberships[0]`) and scopes nav items by context kind (a
  team context hides club-wide-only tools; a Site Admin context shows only the admin
  section). `getDashboardData` and the existing simple `/calendar` page's training-schedule
  target now also resolve from the active context via a new
  `getTeamsForActiveContext(supabase, ctx, activeContext)` in `lib/app-context/my-teams.ts`,
  not the first club membership.
- **Tests**: no schema changes this slice, so the existing 662/662 SQL suite is unaffected
  (unaltered) — verified via `tsc --noEmit`, `eslint`, `next build`, `git diff --check`, all
  clean at the pre-existing baseline.
- **Live-verified in browser**: `test.burnley.admin@ovalball.local` (the only fixture-data
  account with two real club-admin contexts — Burnley RUFC and League Test Club A) —
  desktop dropdown switch, mobile sheet switch, round-trip back, sidebar identity + nav +
  dashboard header + dashboard "This week"/"Requests" content all changing together on
  every switch. Two real bugs were caught and fixed by this live pass (neither existed
  before this slice): `DropdownMenuLabel` (base-ui `Menu.GroupLabel`) crashing when not
  wrapped in `DropdownMenuGroup` (desktop dropdown), and `SheetClose`'s `nativeButton` prop
  set backwards for a `<button>` `render` target (mobile list) — both are genuine base-ui
  API misuses that only a real click-through surfaces, not something `tsc`/`eslint`/`next
  build` catch.
- **Known scope boundary (documented, not silently left)**: 13 other files still resolve
  "my club" via `manageableClubId(ctx)`/`clubMemberships[0]` rather than the active
  context — `partner-clubs/*`, `teams/page.tsx`, `fixtures/page.tsx` and `fixtures/new/*`,
  `documents/*`, `messages/new/page.tsx`, `messages/[kind]/[id]/document-share.ts`,
  `club/[slug]/page.tsx`. For the overwhelming common case (authority at exactly one club)
  this is invisible and correct. For the rare multi-club-admin account, switching context
  changes the sidebar/nav/dashboard as verified above, but navigating into Fixtures,
  Partner Clubs, Teams, People, Club, Season Rollover, Documents, or "+ New Message" still
  operates on whichever club membership happens to be first in the array, not the actively
  selected one — never a security issue (it's still a club the account genuinely has
  authority over), but a real UX inconsistency. Rewiring all 13 call sites was judged too
  large a scope expansion for "Context Switcher" itself (it would touch nearly every
  authenticated page and need its own dedicated regression pass) and was deliberately left
  for a follow-up rather than attempted piecemeal under time pressure.

### Site Admin diagnostic access — COMPLETE
Read-only, always-audited capability for a Site Admin to view one club's dashboard as
diagnostic support — never impersonation, never write authority.

- **Schema** (`20260903700000_site_admin_diagnostic_access.sql`): `site_admins.diagnostic_
  club_access boolean default false` (off for every admin, including Full, until explicitly
  granted); `public.site_admin_diagnostic_sessions` (append-only audit trail: who, which
  club, entered_at/exited_at); `set_site_admin_diagnostic_capability` (Full-Site-Admin-only
  grant/revoke, never touches `admin_role`/`status` so the existing last-full-admin lockout
  trigger is completely unaffected); `enter_diagnostic_club` (re-validates the capability
  and the target club's `active` status server-side, auto-closes any session the admin left
  open, exactly one open session per admin); `exit_diagnostic_club`; `resolve_diagnostic_
  session` (SECURITY DEFINER read gated to the session's own owner, closed sessions and
  inactive clubs resolve to nothing).
- **App layer**: `lib/app-context/diagnostic-access.ts` (cookie + resolve helper, same UI-
  preference trust model as `active-context.ts`'s switcher cookie), `app/(app)/diagnostic-
  actions.ts` (`enterDiagnosticClub`/`exitDiagnosticClub`), `app/(app)/diagnostic-banner.tsx`
  (persistent amber strip, deliberately never brand-colored, shown app-wide via
  `layout.tsx`), a "View as this club (diagnostic)" button on `/admin/clubs/[directoryId]`
  (shown only when `ctx.diagnosticClubAccess` and the club is active), and a grant/revoke
  toggle per admin on `/admin/site-admins`. The dashboard page (`dashboard/page.tsx`) builds
  a synthetic `SwitchableContext` from the active diagnostic club and passes it to the SAME
  `getDashboardData`/`getTeamsForActiveContext` machinery the Context Switcher already uses
  — no parallel scoping logic. Only the dashboard body is diagnostic-scoped; the sidebar
  nav/identity stays the Site Admin's own real identity and admin console links (never a
  fabricated club identity).
- **Tests**: `supabase/tests/site_admin_diagnostic_access.sql`, 12/12 PASS — restricted/non-
  admin refusal to grant or enter, Full-admin grant reflected on `site_admins`, entering for
  a suspended/nonexistent club refused, re-entering auto-closes the prior open session,
  exit closes it and it stops resolving, an admin cannot resolve or exit another admin's
  session, revoke blocks a further entry, and grant/revoke never touches `admin_role`/
  `status`.
- **Live-verified in browser**: `test.site.admin@ovalball.local` (Full) granted itself
  diagnostic access via the Site Admin Management toggle, entered Burnley RUFC diagnostic
  view from its admin console page, confirmed the amber banner + dashboard scoped to
  Burnley's real fixtures/requests, exited cleanly back to the plain Site Admin dashboard,
  and confirmed the resulting `site_admin_diagnostic_sessions` rows directly in the DB
  (correct actor, club, entered_at/exited_at). Caught and fixed one real bug in the process:
  `enterDiagnosticClub`/`exitDiagnosticClub`'s `redirect()` alone did not force Next's
  client router cache to re-fetch the shared `(app)` layout (banner + nav are defined there,
  and `/admin/clubs/[id]` → `/dashboard` shares that layout segment) — a plain cookie write
  isn't something the router's cache invalidation reacts to on its own. Fixed by adding
  `revalidatePath("/", "layout")` before each `redirect()`, then re-verified live that a
  real button click (not just a fresh full navigation) shows the banner immediately.
- **Deliberately out of scope this slice**: Calendar itself doesn't exist yet (Calendar
  Core is next on the roadmap, not started) so diagnostic access only wires into the
  dashboard for now, matching the Context Switcher's own established dashboard-only scope
  from the previous slice — Calendar Core should read `resolveDiagnosticClub` the same way
  once it's built, not reinvent it.

### Team Manager / Coach permission parity — COMPLETE
Investigated first before writing any code, since the prior (pre-compaction) portion of
this session had already done substantial work here: `internal.can_manage_team` already
treats `team_admin`/`coach`/`manager` identically everywhere (fixtures, fixture_requests,
training_sessions, messaging/participant policies — read every one this session),
`permission_groups` already documents Coach/Manager as real, equally-capable groups
(20260831240000, itself added after an earlier live-verification catch), and the
Change-Access/invite/team-assignment UIs already offer Coach/Manager as real options. Live-
verifying with `test.coach@ovalball.local` (a real `coach`-only team permission, no
club-wide role) surfaced two genuine remaining gaps neither of those earlier passes had
caught, both now fixed:

1. **App-layer gate**: `app/(app)/fixtures/new/page.tsx` redirected away from "Request a
   Fixture" unless `manageableClubId(ctx)` (club-wide CLUB_ADMIN/FIXTURE_SECRETARY) was
   set — a team-scoped-only Coach/Manager/Team Admin could never even reach the form,
   though the RLS it posts to has always allowed them to act on their own team. Fixed by
   falling back to the club of any non-view-only team permission when there's no club-wide
   authority.
2. **RLS gap** (`20260903800000_team_scoped_fixture_request_groups.sql`):
   `fixture_request_groups` (the club-to-club "ask" each per-team `fixture_requests` row
   belongs to) required club-wide authority alone for insert/update/select, with no
   team-scoped fallback at all — the one place in the whole fixture-request surface that
   hadn't followed the established pattern. Widened via a new
   `internal.can_manage_club_fixtures_or_any_team(club_id)` helper (club-wide OR any real
   team-scoped write authority at that club) for insert/update, and a `created_by =
   auth.uid()` clause plus a `SECURITY DEFINER`-wrapped `internal.group_has_visible_request`
   helper for select. The `SECURITY DEFINER` wrapper is load-bearing, not stylistic: a
   plain correlated subquery into `fixture_requests` triggered "infinite recursion detected
   in policy" (`fixture_requests`' own select policy does the mirror-image EXISTS lookup
   back into `fixture_request_groups`) — caught by the full regression suite, not by the
   live browser pass. The `created_by` clause was needed separately: the real app does
   `.insert(...).select("id").single()` on the group row *before* any child
   `fixture_requests` row exists, so a bare "can you see a request under this group" check
   alone still failed the read-back immediately after a team-scoped Coach's own insert
   (their INSERT succeeded, but the subsequent `.select()` returned zero rows) — caught only
   by reproducing the app's exact insert-then-select sequence directly against RLS, not by
   testing the insert alone.
- **Tests**: `supabase/tests/team_scoped_fixture_requests.sql`, 8/8 PASS — team-scoped-only
  Coach can create a group, full end-to-end group+request creation, the creator and the
  opponent's club-wide admin can both read it back, an unrelated team-scoped Coach at the
  same club (different team) cannot see it, the creator can update/cancel it, creating a
  group for an unrelated club is refused, and the pre-existing club-wide-admin path still
  works with no recursion.
- **Live-verified in browser**: `test.coach@ovalball.local` reached `/fixtures/new`,
  searched for and selected a real partner club (Rossendale RUFC), submitted a real fixture
  request end-to-end (redirected to `/fixtures` with the new "U12 A vs Rossendale RUFC ·
  Sent" row visible), and successfully cancelled it — confirming create, read-back, and
  update/cancel all work for a team-scoped-only Coach with no separate club-wide role. This
  is the SAME account/team already used to confirm dashboard scoping, Fixtures nav
  visibility, and an existing incoming-request Cancel action work identically to a Team
  Admin's.

### Calendar Core — Week View + Agenda COMPLETE; Day/Month/Season NOT built
Only started once Context Switcher, Site Admin diagnostic access, and Team Manager/Coach
parity were all complete and verified, per explicit instruction. Genuinely large spec
(week/day/month/season/agenda views, team-lanes board, fixture quick-view, training,
partner scoping, permissions) — this slice ships the mandated DEFAULT view fully and real,
and is explicit about what's deferred rather than stubbing the rest as if it worked.

- **Design workflow followed in full**: `frontend-design` (team-lanes swimlane board —
  teams as sticky rows, days as columns, "an operations board, not a date-grid calendar" —
  confirmed zero new tokens, reusing forest-950/chalk/pitch-600/mint-100/amber exactly) →
  `ui-ux-pro-max` (confirmed WCAG 2.2's real web touch-target rule is 24×24 CSS px + 8px
  gap, not native 44pt — chips built to that; fixture/training/action-needed chips carry
  icon + text, never color alone; reused the app's own accessible `Sheet` primitive for the
  quick-view rather than hand-rolling a popover, so focus-trap/Escape/focus-return are
  already correct) → built → `impeccable` polish (today-column tint extended down the full
  column not just the header, chip text bumped from an ad hoc 11px to the app's own
  established 12px caption size, sticky lane-label column given a scroll-edge shadow).
- **Architecture**: `app/(app)/calendar/page.tsx` — a pure VIEW over canonical
  `fixtures`/`training_sessions`/`teams`/`scheduling_groups`/`seasons` (every mutation still
  goes through the existing RPCs: `ScheduleTrainingDialog` reused unchanged; fixture
  creation/response/amendment already go through `/fixtures` and its own RPCs, calendar
  never duplicates them). Scope resolution reuses the Context Switcher/diagnostic-access
  machinery exactly (`getTeamsForActiveContext` + the same synthetic-`SwitchableContext`
  pattern the dashboard uses for an open diagnostic session) — no parallel scoping logic.
  Lanes: one per active `scheduling_group` among the scoped teams (member teams' fixtures
  AND training roll into ONE lane, never duplicated per component team, per the explicit
  U6/7/8 requirement), one per remaining team. Bounded query: exactly the visible week's
  date range, never the whole season.
- **Fixture quick-view** (`week-board.tsx`, a `Sheet`): opposition/team/home-away/venue/
  kickoff/pitch/status/result, with Open Fixture / Open Conversation / Directions actions.
  **Two of the spec's named actions are honestly scoped down, not faked**: this app has no
  per-fixture detail/edit page anywhere yet (confirmed by grep — fixtures are list-only
  today), so "Open Fixture" links to the real `/fixtures` list rather than a fabricated
  workspace route, and "Amend Fixture" has no button at all (no destination exists to point
  it at). Directions only appears when the fixture has its own `venue_address` set — the
  spec's "fall back to the home club's canonical ground address" needs an extra club-address
  lookup this slice didn't add. All three are real, documented scope boundaries, not bugs.
- **Deliberately not built this slice**: Day, Month, and Season views (shown as visibly
  disabled tabs, `title="Coming soon"`, never pretending to work); Team/Status/Home-Away/
  Pre-Main-season/Fixture-Training-kind filters beyond the Team chips already shipped;
  Partner Club calendar visibility scoping (no partner-facing calendar surface exists yet
  to scope); Site Admin diagnostic banner integration is already correct by construction
  (calendar reads the same `resolveDiagnosticClub` the dashboard does) but not separately
  re-verified live this slice.
- **Live-verified in browser** (`test.burnley.admin@ovalball.local`, Club Admin, many real
  teams/fixtures): Week View rendered real team lanes with real fixture chips (correct
  status colors + icons), scheduled a real training session end-to-end via the reused
  dialog and watched it appear live on the board as a distinct chip, opened the quick-view
  sheet for both a fixture and the new training session, followed Open Fixture → `/fixtures`
  and Open Conversation → the real fixture message thread, and confirmed the Agenda view
  (`/calendar/agenda`) independently. Caught and fixed two real bugs in the process: a
  `Type instantiation is excessively deep` TypeScript error from a double-embedded
  Supabase `.select()` (fixed by resolving pitch names via a separate small lookup instead
  of a second embedded relation), and a genuine one-day date-shift bug (a Wednesday
  training session rendered under the "Thu" column) caused by `toIso()` using
  `.toISOString()` (UTC) while the surrounding week-math used local `Date` methods — fixed
  by formatting from local date components everywhere, in both the new Week View and the
  ported Agenda page.
- **Superseded by the Calendar Design Correction slice immediately below**: the visual
  design summarized here (bold-filled today header, permanent Team/Status/Home-Away filter
  dropdown row, `display_name`-driven team labels, no season awareness) was reviewed by the
  user and rejected — not for being broken, but for information overload, un-compact team
  naming, no season emphasis, too many always-visible controls, and insufficient visual
  craft. The underlying query architecture (pure view over canonical data, bounded per-view
  fetch, lanes-with-scheduling-group-rollup) was explicitly confirmed correct and preserved;
  only the presentation layer was rebuilt. See the next section for what replaced it.

### Calendar Design Correction — Team Naming, Context Consistency, Fixture Requests IA, Season-First Redesign — COMPLETE (Partner Calendar Scoping and Availability deliberately NOT started — stopped for review)
Follow-up correction slice, done in the mandated order: team naming → context consistency
→ Fixture Requests IA → Calendar season-first header → Week visual redesign → Month View →
mobile/responsive polish → STOP for user review before touching Partner Calendar Scoping or
Availability/RSVP/Reminders.

- **Compact team display-name language** (`lib/teams/compact-label.ts`): Calendar and the
  two DB-side auto-name generators now derive team labels from structured fields
  (`category`/`age_group`/`gender`/`squad_designation`) rather than the stored
  `teams.display_name`, which real Burnley seed data proved stale (a genuinely
  U12-Boys-classified row still carried a pre-rollover `display_name` of
  "Burnley RUFC U11 Mixed A"). "Boys"/"Mixed" are never shown; "Girls" is always shown and
  always comes first ("Girls U12", never "U12 Girls" or "U12 Mixed"). Senior stays "Men's
  1st"/"Women's 1st". Applied to `lib/app-context/my-teams.ts` (widened to carry the
  structured fields), the Calendar lanes/training-target labels, the Fixture Requests
  named-identity header, and both `create_missing_target_team`
  (`20260903400000_controlled_missing_team.sql`) and `confirm_mixed_boundary_rollover`
  (`20260903300000_gender_age_grade_rules.sql`) — both migrations edited in place since
  neither had been committed yet this session. Classification (Mixed/Boys/Girls) still
  shows as metadata on Team Management/Edit Team, just not baked into every display label.
  **Known, deliberately-not-fixed edge case**: a team with `gender = null` (a legacy state
  the existing `teams_gender_category_check` constraint allows) and a team with
  `gender = 'boys'` at the same age/squad both render as the identical compact label (e.g.
  two "U12 B" chips in the filter row) — a pre-existing data-quality ambiguity, not a
  rendering bug; a properly-classified real club shouldn't have unclassified-gender youth
  teams. Noted, not solved, given time constraints.
- **Active-context consistency audit** (`lib/app-context/active-context.ts`): added
  `activeClubId(ctx, activeContext)` and `activeManageableClubId(ctx, activeContext)`,
  resolving "my club" from the Context Switcher's ACTUAL active context (club context → its
  own id; team context → that team's owning club via `ctx.teamPermissions`; site_admin →
  null), with `activeManageableClubId` additionally re-verifying real CLUB_ADMIN/
  FIXTURE_SECRETARY authority at that resolved club. Each of the 13 call sites the prior
  Context Switcher slice had documented as a known scope boundary was checked and fixed
  individually (never blindly search-replaced — context chooses the current authorized
  scope, it never grants authority; every RPC/RLS boundary underneath is unchanged):
  `club/[slug]/page.tsx`, `messages/[kind]/[id]/document-share.ts`, `teams/page.tsx`,
  `documents/page.tsx` (both `myClubId` and `canManage` — the latter was a real bug fix: a
  multi-club admin's second club would have incorrectly shown as unmanageable),
  `documents/actions.ts`, `fixtures/new/page.tsx`, `partner-clubs/page.tsx`,
  `partner-clubs/[clubId]/page.tsx`, `partner-clubs/actions.ts`, `messages/new/page.tsx`,
  `fixtures/page.tsx`. `lib/app-context/session-context.ts` (defines the old
  `manageableClubId`, not a call site) was deliberately left untouched.
- **Fixture Requests IA cleanup** (`app/(app)/fixtures/page.tsx`): heading renamed
  "Requests" → "Fixture Requests"; the main list now shows only genuine two-sided
  Ovalball-to-Ovalball requests (`fixture_request_groups.opponent_club_id` set); records
  where the opponent was chosen from the directory but isn't active on Ovalball
  (`opponent_club_id` null) move into a secondary `<details>` "Non-Ovalball fixtures (n)"
  disclosure (`non-ovalball-row.tsx`) with honest copy — "Recorded locally — no Ovalball
  request delivered", never "Sent"/"Awaiting response", since there's no one to respond.
  Added a `?dir=received|sent` segmented control. `request-fixture-form.tsx` now warns
  BEFORE saving when the chosen opponent has no `clubId` ("X is not currently active on
  Ovalball... no Ovalball request will be delivered") and changes its submit button from
  "Send request" to "Add to calendar" accordingly — never blocking the real-world fixture,
  never inventing a recipient.
- **Calendar season-first redesign** (`app/(app)/calendar/page.tsx` + new
  `lib/calendar/season-window.ts`, `filter-sheet.tsx`, `month-view.tsx`): header now reads
  the EXISTING canonical `seasons` table (`starts_on`/`pre_season_starts_on`/`ends_on`) for
  a "26/27"-style year label with a Pre-Season/Season toggle pill and `‹ ›` season-year
  navigation; Pre-Season gets a distinct dark `forest-950` treatment (never color-only —
  always text-labelled "Pre-Season"/"Season"). Toolbar simplified to just `[Week][Month]` +
  a `Filter` button (opens a `Sheet` with Status/Home-Away/Kind, reusing the app's existing
  accessible Sheet primitive) + a subtle underlined "Agenda" link — Day/Season tabs removed
  from the desktop header rather than left as dead clutter. Week board given a visual-craft
  pass (open `rounded-xl` container instead of a heavy grid box, weekends tinted amber
  rather than blocked, today gets a subtle tint + small accent rule instead of a bold fill,
  fixture chips are tactile cards, training chips are quieter dashed-outline with a
  `Dumbbell` icon — never color-only). **New Month View** (`month-view.tsx`): a real
  bounded 6-week grid (never a whole-season fetch), compact per-day summaries with a
  "+N more" overflow, click a date → day-drawer `Sheet` grouped by team, click an entry →
  the same quick-view sheet Week uses. Mobile (both Week and Month, below the `md`
  breakpoint) automatically renders a shared day-grouped `MobileAgenda` list built from the
  same already-fetched `entries` — never a squeezed grid.
- **Two real bugs caught by live browser verification and fixed** (both are visual/logic
  fixes only — no query-shape or authorization change): (1) the week/month anchor was
  silently defaulting to the season's own start date on an ordinary fresh page load
  whenever no explicit `week`/`month` param was present, because the fallback didn't
  distinguish "the viewer explicitly switched season/phase" from "first load" — fixed by
  adding an `isExplicitPeriodSwitch` flag that only anchors on the period's start date on a
  genuine explicit switch, otherwise always anchoring on today. (2) even after that fix, the
  Month view's header label and prev/next-month links still read from the Monday-aligned
  grid start (`gridStart`), which can legitimately roll back into the previous calendar
  month (e.g. 1 Sept 2026 is a Tuesday, so the grid's Monday start is 31 Aug) — this produced
  a real, visually-confirmed bug where a September grid was mislabelled "August 2026" and a
  day cell showing "8" under "TUE" opened a drawer titled "Tuesday 8 September" (real 8 Aug
  2026 is a Saturday). Fixed by hoisting a dedicated `monthAnchor` (the true first-of-month
  date, captured before the grid rolls back) and repointing every month label/nav
  computation to it. Both fixes re-verified live in the browser after the second fix landed
  — the Month header now correctly reads "September 2026" with the grid's weekday columns
  matching real calendar dates.
- **Impeccable polish pass**: one bounded inspect → fix → confirm round on the redesigned
  header/toolbar/Week/Month/mobile-agenda. One genuine issue found and fixed: at real mobile
  width (390px), the team-filter chip row (~27 real Burnley team chips) wrapped across ~4
  rows and pushed all calendar content below the fold before a user saw anything — changed
  to a single horizontally-scrollable row on mobile (`overflow-x-auto`, still `flex-wrap` on
  desktop), re-verified live that content is now visible immediately.
- **Live-verified in browser** (`test.burnley.admin@ovalball.local`, real dense Burnley data
  — ~28 teams, multiple age grades, a Girls team, multiple squads, a senior team, several
  Sat/Sun fixtures across statuses, home and away): Week View with the redesigned chips and
  quick-view sheet; Month View grid + day-drawer, including the date-mislabel bug found and
  both its fixes confirmed; Pre-Season phase toggle's dark treatment; season-year prev/next
  navigation (26/27 → 25/26 → 26/27, correctly re-resolving to today's month with no
  explicit params); Filter sheet apply (Status=Booked + Home narrowed the grid correctly,
  badge showed "2") and Clear all (reset to a bare `/calendar` at the app's own default);
  tablet width (834px CSS, stays in the desktop lanes layout — the `md` breakpoint is 768px,
  and the spec's mobile-agenda requirement was for phones, not tablets); mobile width
  (390px) both before and after the chip-row polish fix. Historical-season fixture-snapshot
  naming (a fixture's own team-identity at the time it was played, never today's
  reclassification) could not be exercised live because the 25/26 historical season has no
  seed fixture data — a seed-data gap, not a code gap; the underlying stable-team-rollover
  architecture this depends on was built and tested in an earlier slice and was not touched
  here.
- **Next for Calendar**: Day and Season tab views (still visibly absent from the toolbar,
  never faked), the remaining Status/Home-Away/Kind filter combinations beyond what was
  live-tested, a real fixture detail/edit page (prerequisite for a genuine "Amend Fixture"
  action), then — only once the user has reviewed this slice — Partner Calendar Scoping,
  then Availability/RSVP/Reminders.

### Locked Team Naming — COMPLETE
The user pointed out that Team Management still let a Club Admin type an arbitrary free-text
team name next to the structured category/age/gender/squad pickers, producing "random" team
names disconnected from what the club actually confirmed at signup. Investigation traced
this to something bigger than the free-text field: signup's "which teams does your club
run?" step (`TEAM_CATEGORY_GROUPS`) has always captured a real answer, but it was only ever
stored as `club_claims.proposed_teams` / `directory_requests.proposed_teams` — provisional
JSON nobody read. `approve_club_claim` activated the club and granted CLUB_ADMIN, then
stopped; a human was left to manually recreate matching teams afterward via the free-text
field, which is exactly where the drift came from. Both problems share one fix.

- **One canonical team catalog** (`lib/teams/catalog.ts`): `TEAM_CATEGORY_GROUPS` (Mini &
  youth U6-U11, Youth U12-U16, Senior men's/women's 1st-3rd, Girls U12-U16) maps each
  signup-style label to real structured fields (`category`/`age_group`/`gender`) and to
  whether it takes a B/C second-team letter. Gender for the two ungendered groups is
  inferred, not asked twice: U6-U11 defaults to `mixed`, U12-U16 defaults to `boys` (Girls
  already has its own explicit group, and `teams_gender_category_check` forbids `mixed`
  above U11) — both resolve to a gender `compactTeamLabel()` never prints, so ticking
  "Under 12" produces "U12", not "U12 Boys". `lib/signup/types.ts`'s `TEAM_CATEGORY_GROUPS`
  is now a re-export of this catalog's signup-shaped view — one list, not two that could
  drift apart. **Known, deliberately-not-added gap**: the catalog has no "Colts" group — the
  `teams` table schema has no `category`/`age_group` value for it at all (never did), so the
  old signup checkbox for "Junior/Senior Colts" could never actually produce a matching team
  even before this slice. Removed rather than left as a checkbox that silently does nothing;
  adding real Colts support is a separate schema decision, not made here.
- **Claim approval now seeds real teams from the proposal** (`internal.seed_teams_from_
  proposal`, called from `approve_club_claim` in `20260904100000_locked_team_naming.sql`):
  turns a claim's `proposed_teams` into real `teams` rows automatically the moment a Site
  Admin approves it — the missing connection between "what the claimant said they run" and
  what actually exists in Teams/Fixtures/Calendar. Idempotent via the pre-existing
  `(club_id, identity_key)` unique constraint; an unrecognised/legacy label is skipped, never
  guessed at.
- **`teams.display_name`/`slug` become derived, not entered, anywhere**: a new
  `teams_set_display_name_trigger` (BEFORE INSERT OR UPDATE OF the structured columns)
  recomputes both from `category`/`age_group`/`gender`/`squad_designation` unconditionally,
  via `internal.compute_team_display_name` — a SQL mirror of `compactTeamLabel()`. This
  closes the loophole for every insert path, present or future, not just the ones touched
  this slice; it also fixes a real pre-existing bug for free, since normal age-progression
  rollover's plain `UPDATE teams SET age_group = ...` never touched `display_name`, which is
  exactly how a rolled-over team could keep showing its pre-rollover name. A one-time
  backfill recomputes every existing row on this migration.
- **Real regression caught by this same migration, fixed in it**: deriving `display_name`
  purely from structured fields means a genuine "U8 Boys" team and a genuine "U8 Mixed" team
  — different real sides, correctly kept apart by the gender-aware `identity_key` — now
  compute the identical slug "u8" (`compactTeamLabel()` deliberately shows no gender word
  for boys/mixed). The pre-existing `unique(club_id, slug)` constraint rejected that insert.
  Fixed by dropping the constraint: `slug` was never read anywhere in the app (grepped, zero
  call sites — team pages route by id) so its accidental uniqueness was never load-bearing;
  `identity_key`'s uniqueness is the real, correct, gender-aware guarantee.
- **Add/Edit Team UI rewritten** (`create-team-form.tsx`, `[teamId]/team-edit-form.tsx`,
  shared `team-category-picker.tsx`): the free-text "Team name" field is gone from both —
  replaced by the same grouped checklist signup uses, with a live "This team will be shown
  as X" preview. The server actions (`actions.ts`) no longer accept a client-supplied
  `displayName` at all; they resolve the picked category label to structured fields via the
  catalog and let the trigger compute the name. Edit Team reverse-looks-up a team's current
  fields to preselect the matching catalog option (`findOptionForFields`); a team whose
  current combination matches nothing in the catalog (a legacy/test-fixture row) shows an
  amber "doesn't match the standard list" notice and requires picking a real option before
  saving — a gentle forcing function back onto the locked list, never a silent block.
- **Mini-rugby shared calendars relocated**: `MiniRugbyCalendarsSection` moved from `/club`
  to `/teams` (file moved, its data-fetching moved into `teams/page.tsx`, `scheduling_groups`
  schema/actions untouched) — team creation and the U6-U8 shared-calendar merge tool are now
  one coherent "manage your teams" section instead of two disconnected pages.
- **The `unique(club_id, slug)` fix was itself caught live, not assumed**: the migration
  originally shipped without it, verified clean at first, but a full regression run
  afterward surfaced `gender_age_grade_rules` failing 4/29 with `duplicate key value
  violates unique constraint "teams_club_id_slug_key"` on exactly the U8-Boys-vs-U8-Mixed
  collision described above. Root-caused, the constraint dropped, re-verified: 682/682 clean
  on the next run.
- **Live-verified in browser, full loop, real accounts** (not simulated): signed up a brand
  new claimant (`test.houghton.claim@ovalball.local`) through the real magic-link flow,
  ticked "Under 12", "Under 12 B", "Under 12 Girls", and "Men's 1st Team" on the claim step
  (confirmed the picker matches the catalog exactly — no Colts group), submitted, confirmed
  via Mailpit, then signed in as a real Site Admin (`test.site.admin@ovalball.local`) and
  approved the claim from `/admin/claims`. Confirmed directly in the database that all four
  teams were created automatically with exactly the right names ("Men's 1st", "U12", "Girls
  U12", "U12 B") — zero manual re-entry. Signed back in as the claimant: `/teams` showed all
  four correctly, with the relocated Mini-Rugby Shared Calendars section beneath them.
  Exercised Add Team (picked "Under 13", confirmed the live name preview, submitted,
  confirmed "U13" appeared) and Edit Team (opened "U12 B", confirmed it correctly
  pre-selected "Under 12" with the "B" letter active).
- **Regression**: fresh `supabase db reset --local` → 682/682 PASS, 0 FAIL. `tsc --noEmit`
  clean. `eslint .` — 0 errors, 149 pre-existing warnings (unchanged baseline). `next build`
  clean. `git diff --check` clean.
- **Next for this area**: a real Colts (or equivalent U17-18) schema decision if the product
  wants it; nothing else deliberately deferred — the free-text-name problem, its full
  upstream root cause, and the slug-collision regression it surfaced are all closed.

### Team + Club Users Foundation — COMPLETE
User-directed follow-up: Ovalball needed one closed, interconnected team catalogue with
real database-level enforcement (not just a locked-down form), plus proof that Teams,
Permissions, Fixtures, Calendar, Training, and Club Users all resolve to the same stable
team records. Full architectural audit done before any schema change (below), then the
closed catalogue, Add Team duplicate-awareness, and team deactivation UI polish were built
on top of infrastructure that mostly already existed and was verified, not rebuilt.

**TEAM DOMAIN — BEFORE** (audited, not assumed):
- `team_permissions.team_id` (FK to `teams.id`) was ALREADY the real, single source of
  truth every consumer resolved through — Fixtures, Calendar, Training, and the
  Coach/Team-Manager permission system (built in an earlier slice this session) all
  already read this one relationship. No duplicate "team by string name" logic existed
  anywhere in the authorization or scheduling layers.
- A real, working "Club Users" section already existed at `/people` (not a gap the user
  was aware of): dynamic club name, per-person club role + team-scoped role badges
  (`"U12 — Coach"`, multi-team `"U12 — Team Admin", "U13 — Team Admin"`), a
  `Parent/Player` view-only role already distinguished in its own badge, invite-by-email
  reusing an existing account rather than duplicating profiles, and a `permission_groups`
  capability-documentation layer (`capabilities`/`permission_groups`/
  `permission_group_capabilities`, from 20260831240000) already sitting over the real
  enforcement values. One real bug found and fixed: its club-id resolution was hardcoded
  to the session's first `CLUB_ADMIN` membership, not the active Context Switcher context
  (the same class of bug fixed on ~10 other pages in the earlier Calendar Design
  Correction slice — `/people` had been missed).
- Team deactivation already existed as `fold_team`/`reactivate_team` (built in an earlier
  slice, `20260902140000_team_lifecycle.sql`): confirmation dialog, required reason,
  preserves history, cancels+notifies future fixtures, and deliberately does NOT
  auto-restore fixtures on reactivation (a separate, conflict-checked
  "Request restoration" action per fixture) — already matching the brief's lifecycle
  requirements almost exactly. The one real gap: the entry-point button was
  `variant="outline"` (neutral), not visually destructive: only the modal's confirm button
  was red. Fixed to `variant="destructive"` at the entry point too.
- The genuine gap was the closed catalogue itself: `teams.category`/`age_group`/`gender`/
  `squad_designation` were governed by loose value-domain CHECK constraints, not a true
  closed set of real identities — nothing stopped a direct write from creating "U17" or a
  senior "4th" team outside the picker, and Add Team's picker (built in the prior Locked
  Team Naming slice) showed the full static catalogue always, with no awareness of what
  the club already had.

**CANONICAL TEAM SOURCE OF TRUTH**:
- New `canonical_team_types` table (`20260904200000_canonical_team_catalogue.sql`) — the
  closed, 24-row catalogue (11 age-grade U6-U16, 2 Colts, 3+3 senior ordinals, 5 Girls
  U12-U16), seeded once, never admin-creatable, matching `lib/teams/catalog.ts`'s
  `TEAM_CATEGORY_GROUPS` key-for-key.
- New `teams.canonical_team_type_id` FK, auto-resolved by `internal.resolve_canonical_
  team_type` via a BEFORE INSERT/UPDATE trigger (`teams_set_canonical_type_trigger`) — a
  club admin/RPC never sets it directly, it's computed from the existing structured
  columns every time, the same pattern the prior slice used for `display_name`.
- `teams.category` widened to add `'colts'` (previously only `'senior'|'youth'` —
  Junior/Senior Colts could never actually exist before this slice, even though signup
  had a checkbox for it at one point); `age_group` widened to accept `'JuniorColts'`/
  `'SeniorColts'` as Colts' own level-discriminator, reusing the column's existing role
  rather than adding a new one.
- **Enforcement is deliberately two different strengths for two different audiences,
  decided by inspecting real data first, not assumed**: the auto-resolve trigger is
  soft (never rejects — leaves `canonical_team_type_id` NULL when no match exists), which
  is what makes it safe to run over the entire pre-existing SQL regression suite
  unmodified. The HARD rejection is `teams_insert_admin`'s RLS policy, widened to require
  `canonical_team_type_id is not null` — this gates the one real direct-client insert path
  (`createTeam`) for real `authenticated` traffic. Every `supabase/tests/*.sql` file
  connects as the `postgres` superuser (bypasses RLS by design, already true for every
  other policy in this project), so this closure needed zero test-file rewrites; verified
  live in the browser AND with a dedicated RLS test (`canonical_team_catalogue.sql` test
  8: a real Club Admin's direct-table U17 insert is rejected).
- `internal.compute_team_display_name` gained a Colts branch and now treats a stored `"A"`
  squad letter as the primary (no squad) in every case, closing a real remaining gap: a
  legacy `squad_designation = 'A'` row previously still displayed literally as `"U12 A"`
  after the prior slice's name-locking work, because that trigger recomputed the name
  without stripping `"A"` — this squad reused a value the prior slice's own picker never
  produced (only null/B/C), so it only ever affected pre-existing/legacy rows.

**ADD TEAM — duplicate-aware, not just locked**:
- `lib/teams/catalog.ts`'s new `computeTeamAvailability()` (pure function, unit-testable,
  same algorithm the UI renders from) computes, per canonical identity: `addable` (not yet
  created — offer it), `active` (already exists — never re-offered, and if it allows B/C
  squads, those are offered directly as `"Add U12 C"` rather than gated behind a disabled
  primary radio — a real interaction bug found and fixed during this session's own live
  testing), `inactive` (folded — routes straight to Reactivate on that team's page, never
  offered as creatable again), or `blocked_primary_inactive` (a B/C squad stays disabled
  with an explanatory tooltip until its own primary is active, so the structure can never
  go primary-missing-with-a-squad-present).
- Real database-level double-submit protection: `teams_active_canonical_identity_idx`, a
  partial unique index on `(club_id, canonical_team_type_id, gender, squad_designation)
  WHERE active`. `gender` deliberately stays part of the key (not collapsed to the
  identity alone) — checked against real regression-fixture data before deciding this: a
  legacy `gender = null` row and a real `gender = 'boys'` row can legitimately coexist at
  the same nominal age+squad (pre-existing data-quality history, e.g. from before
  classification was consistently applied), and collapsing gender out of the key would
  have broken that real coexistence the first time the full regression suite ran.
- `/teams` now splits **Active teams** / **Inactive teams** into two visually distinct
  sections (previously one flat list with a small "Archived" text tag).

**CLUB USERS**: `/people` unchanged in scope (it already did what the brief asked for —
see BEFORE, above) except the active-context club-id fix. Not renamed to "Club Users";
flagging that as a naming question for the user rather than deciding unilaterally.

**LEGACY TEAM AUDIT**: of 53 teams in the local dev DB immediately after a fresh reset +
full regression run, 3 do not match any canonical identity and are NOT deleted or
force-normalized (`canonical_team_type_id` stays NULL, preserved, permanently ineligible
for new operations that require a canonical type): `Men's 4th` (senior ordinal beyond the
closed 1st-3rd), `Girls U8`/`Girls U9` (the closed catalogue's Girls band starts at U12,
matching the user's own explicit spec). All three are regression-test fixtures, not real
product data — `seed.sql` creates zero teams; the ONLY reason any team data exists in the
local dev DB at all is that the SQL test suite creates it as fixtures when run. The user
asked mid-session for these to be hard-deleted; after flagging that (a) they're referenced
by `NO ACTION` foreign keys from `fixtures`/`training_sessions`/etc. across ~7 tables, so a
real delete means cascading through all of them by hand, and (b) the very next mandated
fresh-reset-plus-full-regression checkpoint recreates the identical rows regardless since
they come from the test suite itself, not from seed data, the user chose to skip the manual
cleanup and rely on the closed catalogue (which already makes it impossible for a real club
to create a row like these through the app, verified live and by RLS test) rather than
chase a cosmetic, non-persistent state.

**LIVE-VERIFIED in browser** (`test.burnley.admin@ovalball.local`, real dense data): added
a genuinely new team (U15) through Add Team and confirmed it became unavailable
immediately afterward; confirmed "Add U12 C" appears directly (B already existed, C
didn't) without needing to select the disabled U12 primary first (the interaction bug
above, found and fixed live); confirmed an inactive "Girls U12" correctly offered
"Reactivate" instead of a duplicate-create option; added "Junior Colts" end-to-end
(first-ever real Colts team created in this app) and confirmed it in the database with a
real `canonical_team_type_id`; folded U15 (confirmed the entry-point button is now
genuinely red, confirmation dialog text, reason field), confirmed it moved to the Inactive
section, reactivated it, and confirmed the exact same `team_id` came back active
throughout the whole fold→reactivate round trip; confirmed `/people` already showed a real
Coach/Team Manager/Parent-Player roster scoped to Burnley's own real teams before touching
anything.

**TESTING**: new `supabase/tests/canonical_team_catalogue.sql`, 8/8 PASS — every catalogue
shape resolves correctly; an out-of-catalogue senior ordinal and an out-of-band Girls age
both resolve to no canonical type (never guessed); `"A"` always displays as primary;
real database-level duplicate-active rejection, and that the SAME identity becomes
addable again once the original goes inactive; a real Club Admin's valid insert succeeds
end-to-end; the same Club Admin's direct-table U17 insert is rejected by RLS. One
pre-existing test's assertion (`scheduling_groups.sql` test 7) encoded the old `"U7 A"` display
bug as its expected value — fixed to assert the corrected `"U7"`, a one-line change,
verified nothing else depended on the literal string.

**Not done, deliberately, and not silently**: `/people` was not renamed to "Club Users" —
flagged as a naming question rather than decided unilaterally. Deeper interconnection
re-verification for Documents/Messaging/Context-Switcher team-scoping was not repeated in
this slice — it was already fixed for the general "my club" resolution pattern in the
earlier Calendar Design Correction slice and nothing in this slice touched those columns
or that logic, so it was judged already covered rather than re-tested from scratch under
time constraints; flagged here rather than claimed as freshly re-verified.

### Canonical Team Catalogue — Hard Database Invariant — COMPLETE
User correction to the prior slice: the closed catalogue's enforcement was "soft trigger +
RLS on the one client insert path" — the user explicitly rejected this as insufficient.
**"RLS answers WHO may perform an action. The catalogue constraint answers IS THIS TEAM
IDENTITY VALID? Those are different responsibilities."** RLS is bypassed by the `postgres`
role every SQL test file connects as, and by any SECURITY DEFINER RPC — so the old design
left every non-RLS write path (a SQL migration, a service-role script, a SECURITY DEFINER
function like the controlled-missing-team RPC) able to write an out-of-catalogue team. This
correction makes catalogue validity a true row-level invariant, enforced identically for
every writer regardless of role.

**NEW MIGRATION** (`20260904300000_team_catalogue_hard_invariant.sql`):
- `teams_active_requires_canonical_type` (CHECK): `active = false OR canonical_team_type_id
  IS NOT NULL`. No informal "NULL canonical_team_type_id on an active row" loophole — a row
  can only be ACTIVE with a real, resolved canonical identity, or INACTIVE (legacy/
  historical, preserved for data integrity, permanently ineligible for new operational use).
  This is the same `active` boolean the prior slice's deactivation lifecycle already used —
  no new status field, no scattered flags.
- `teams_canonical_type_matches_fields` (CHECK): `canonical_team_type_id` must always equal
  what `internal.resolve_canonical_team_type` computes from the row's OWN
  category/age_group/gender/squad_designation. Closes the one gap the soft auto-resolve
  trigger left open: a direct `UPDATE teams SET canonical_team_type_id = ...` alone (not
  touching the other structured columns) previously would not have been re-validated,
  because the auto-resolve trigger only fires on changes to category/age_group/gender/
  squad_designation. Now a contradictory pairing (type=U12, age_group=U13) is impossible to
  write, not just unlikely.
- `teams_active_squad_designation_valid` (CHECK): an active youth team's squad_designation
  is exactly `null` (primary), `"B"`, or `"C"` — no `"U12 A"` as a separate identity, no
  `"U12 D"`. Colts never takes a squad letter at all. Senior's squad validity is already
  fully covered by the constraint above (an invalid ordinal simply fails to resolve).
- `internal.validate_team_squad_structure()` + `teams_validate_squad_structure_trigger`
  (cross-row, since a plain CHECK constraint cannot see other rows): an active B/C squad
  requires its primary to already be active at the SAME club/canonical type/gender, and —
  the reverse — a primary cannot deactivate while a B/C sibling at that level is still
  active (Club Admin must fold the squads first). Trigger name is deliberately alphabetically
  after `teams_set_canonical_type_trigger` so Postgres's documented same-timing
  alphabetical firing order guarantees `canonical_team_type_id` is already resolved when
  this trigger reads it.
- All four fire on INSERT and UPDATE, for every role, with zero RLS dependency — proven
  directly (see TESTING below), not assumed.

**CONTROLLED MISSING-TEAM RPC PATH — re-checked directly, one real bug found and fixed**:
the user specifically asked this SECURITY DEFINER path (not gated by `teams_insert_admin`
RLS at all) be re-verified against the new invariants. Found: both
`create_missing_target_team` and `internal.resolve_incoming_request_target` were doing a
literal string comparison against `target_team_squad_designation`, so an incoming fixture
request naming the old `"A"` convention (a real shape — `fixture_requests` places no
whitelist on this column) either (a) failed to match an existing team whose own
`squad_designation` had already been normalized to `null`, incorrectly routing to
`pending_rollover` instead of `exists_active`, or (b) attempted to create a NEW team with
`squad_designation = 'A'` literally, which the new hard invariant correctly rejects — but
uncaught, since the RPC never normalized `"A"` the way every other write path does. Fixed:
both functions now normalize `nullif(upper(coalesce(target_team_squad_designation, '')),
'A')` before matching or inserting, exactly mirroring the normalization the rest of the app
already applies. A genuinely out-of-catalogue request (proven live with U17 — see TESTING)
still correctly resolves `genuinely_missing` (nothing else claims it) but the actual
`create_missing_target_team` call is still blocked by the same hard invariant every other
path goes through — this SECURITY DEFINER RPC has no way around it.

**TEST FIXTURE CORRECTIONS** — per explicit instruction, invalid fixtures were corrected to
valid catalogue identities, never used as a reason to weaken the new constraints. Several
SQL test files had historically reused arbitrary squad_designation strings (`'A'`, `'RLV'`,
`'STC'`, `'BOY'`, `'GIRL'`, `'PAR'`, `'ZZ'`) purely as cross-file collision-avoidance tags at
shared Burnley/Rossendale fixture ages — never meaningful product data, but now hard-rejected
for active rows. Fixed file-by-file, tracing execution order to avoid identity collisions
across files reusing the same club at the same age: `scheduling_groups.sql`,
`controlled_missing_team.sql`, `team_scoped_fixture_requests.sql`,
`fixture_age_eligibility.sql`, `gender_age_grade_rules.sql`, `shared_team_capacity.sql`,
`season_rollover.sql`. Two genuinely new discoveries during this work (both fixed, both now
covered by the new tests below): (1) `shared_team_capacity.sql`'s owning teams for a booked
fixture must stay `active = true` (a dedicated trigger,
`enforce_active_owning_team_for_fixture`, already required this — an earlier, wrong attempt
at fixing this file had marked them inactive, which broke real capacity-booking assertions,
not just the identity tag); (2) `teams.display_name` is ALWAYS auto-computed from the
structured fields on every insert (`teams_set_display_name_trigger`, from the prior Locked
Team Naming slice) — a literal `display_name` passed at insert time is silently overwritten,
so any test asserting an exact display-name string must assert the value the trigger
actually computes, not whatever text happened to be typed in the fixture.

**TESTING** — `canonical_team_catalogue.sql` expanded from 8 to 15 tests. Tests 9-15 are new
this slice, and are the direct answer to "prove it through more than the browser/RLS path":
every one of them runs as the bare `postgres` role this whole test suite already connects
as (no `set local role authenticated`), which bypasses RLS entirely by default — so any
rejection can only come from the CHECK constraints/trigger themselves.
- Proven REJECTED as postgres (RLS bypassed): U17 (test 9), Girls U8/U9/U11 (test 10, looped
  — the closed Girls band starts at U12, distinct from ordinary mixed-gender U6-U11
  age-grade teams which remain valid), Men's 4th (test 11), U12 D (test 12), a free-text/
  custom age_group (test 13).
- Proven VALID creation still works, same bare-postgres role, dedicated throwaway club (test
  14): U6, U12, U12 B, U12 C, Girls U12, Girls U12 B, Junior Colts, Senior Colts, Men's 3rd,
  Women's 3rd — the invariant closes off invalid identities without narrowing what is
  genuinely valid.
- Proven a legacy/historical row can never be reactivated for new operational work (test
  15): an inactive, out-of-catalogue row (`canonical_team_type_id` confirmed NULL) is
  attempted to be set `active = true` directly, and rejected by the constraint — no loophole.
- `controlled_missing_team.sql` gained a new test 17 (via a fresh scenario, request 309):
  `check_incoming_request_target` correctly still resolves `genuinely_missing` for a U17
  request (nothing else claims it), but `create_missing_target_team` itself is rejected by
  the same hard invariant — proving this SECURITY DEFINER RPC, which has no RLS gate at
  all, is still correctly bound by the closed catalogue.

**NOT done, deliberately, and not silently**: the legacy-team audit's 3 out-of-catalogue rows
from the prior slice (Men's 4th, Girls U8, Girls U9) were NOT hard-deleted — same reasoning
as before (referenced by `NO ACTION` foreign keys across ~7 tables; the next fresh-reset
checkpoint would recreate them regardless since they come from the test suite, not seed
data) — they now show up as 5 legacy/inactive rows in the checkpoint count (grew from 3 to 5
because this slice's own defensive backfill step, run once at migration-apply time,
deactivates any row that fails to satisfy the new invariant, which is the intended
self-healing behavior for any future drift, not a sign of new bad data).

### Site Admin Team Directory — global canonical type extension — COMPLETE
Part 2 of the same correction: a Site-Admin-only mechanism to extend the GLOBAL canonical
catalogue, distinct from ordinary club-level team activation. Two operations, never
conflated: (A) creating a global canonical team type (Site Admin, `manage_team_catalogue`
capability only) vs. (B) a club activating an existing type for itself (the pre-existing,
completely unchanged Add Team flow). Creating a type never creates it for any club.

**NEW MIGRATION** (`20260904500000_site_admin_team_directory.sql`):
- `canonical_team_types_structure_check` (CHECK): mirrors `teams_gender_category_check`'s
  real product rule one layer up, so a Site Admin can never define a global identity a real
  team could never legally hold (senior+girls, youth+mixed above U11, etc.). All 24 seeded
  rows satisfy it by construction.
- `canonical_team_types` gains `is_active`/`created_by`/`created_at`/`updated_by`/
  `updated_at`. `site_admins` gains `manage_team_catalogue` (boolean, default false) —
  mirrors `diagnostic_club_access` exactly: off by default for every Site Admin including
  Full, granted/revoked per-person only via `set_site_admin_team_catalogue_capability`
  (Full Site Admin only), never implied by any admin profile.
- `internal.can_manage_team_catalogue()`: the real capability check every write RPC gates
  on — genuinely rejects Club Admin, Coach, Team Manager, and a Site Admin who has the flag
  off (including diagnostic-access-only admins), not just "any Site Admin".
- `create_canonical_team_type(category, age_group, gender, fixed_squad_designation,
  allows_squads)`: structured fields only — no free-text name parameter exists. The label
  is always generated server-side (`internal.compute_canonical_type_label`) from the
  structured identity. Duplicate identity rejected (the pre-existing
  `canonical_team_types_identity_idx` unique index does the real work; the RPC gives it a
  clear message). Audited (`audit_log`, action `insert`).
- `deactivate_canonical_team_type(id)`: "Deactivate", never "Delete" — never a hard delete,
  even before any club references it. Audited (action `deactivate`).
- `teams_validate_canonical_type_active_trigger` (BEFORE INSERT only on `teams`): a
  deactivated global type can never be newly activated by any club — a real database
  invariant, not UI filtering, matching this session's whole "the constraint answers IS
  THIS VALID, not just WHO may write" principle. Deliberately INSERT-only: an EXISTING team
  that already resolved to the type before deactivation keeps working completely normally
  (rollover, reactivation, everything) — "existing club-team/history remains intact" is the
  explicit requirement, and only a genuinely NEW activation is blocked.
- `internal.seed_teams_from_proposal` (claim approval's team-seeding function) rewritten to
  resolve against the LIVE `canonical_team_types` table instead of its own hardcoded VALUES
  list — a third hardcoded copy of the same 24 mappings that migration `20260904100000`'s
  own comment admitted "there is no single artifact both could read". Senior/Colts labels
  already match `canonical_team_types.label` verbatim; youth labels use the signup picker's
  "Under N[ Girls]" phrasing, computed generically from `age_group`/`gender` (never a second
  hardcoded age list), so a newly added youth age_group resolves with zero further code
  changes here too.

**AUTOMATIC PROPAGATION**: `lib/teams/catalog.ts`'s `TEAM_CATEGORY_GROUPS` constant
(renamed `BOOTSTRAP_TEAM_CATEGORY_GROUPS`, kept only as the documented initial-24 bootstrap/
fallback) is no longer the live source of truth for any consumer. New `loadTeamCategoryGroups
(supabase, { includeInactive? })` queries `canonical_team_types` live and builds the same
`TeamCategoryGroup[]` shape, grouping generically from each row's own category/gender (never
a hardcoded per-row bucket list). Every one of catalog.ts's 7 real consumers was converted to
receive `groups` from a server-side `loadTeamCategoryGroups` call — threaded down as a prop
through client components, never imported as a static constant: `/teams` (Add Team,
availability, display-name lookup), `/teams/[teamId]` (Edit Team), `/teams/actions.ts`
(`createTeam`), `/teams/[teamId]/actions.ts` (`updateTeam`), and the full signup tree
(`/signup/page.tsx` → `signup-shell.tsx` → `club-step.tsx`'s `ClaimForm`/`NotFoundForm`).
`types/database.types.ts` regenerated. **Verified live in the browser**: adding "U18" in the
Team Directory made it appear in `/teams`' Add Team picker immediately, with zero code
changes; a real Burnley "Under 18" team was created through the ordinary Add Team path and
correctly linked to the new global type.

One real bug found BY this live verification and fixed before completing: `loadTeamCategoryGroups`
defaults to active-only (correct for Add Team/signup, which should only ever OFFER a
genuinely available identity) — but Edit Team's `findOptionForFields` lookup used the same
active-only list, so the moment a type was deactivated, every club's EXISTING team at that
identity wrongly showed "doesn't match the standard list", even though deactivation
explicitly guarantees existing club-team history is untouched. Fixed by adding an
`includeInactive` option, used specifically by the Edit Team page/action so an existing
team's own (possibly since-deactivated) identity is always still correctly represented and
re-editable, while Add Team/signup still only offer active types for new activation.

**SITE ADMIN UI**: new `/admin/team-directory` page, added to the real Site Admin nav list
(`lib/app-context/build-nav-items.ts`'s `inSiteAdminContext` branch, next to "Seasons") —
initially missed on the first pass (that nav list lives outside `app/`, not alongside the
other `/admin/*` page files, so an earlier grep for existing admin links missed it and the
page was briefly reachable by direct URL only); caught when the user reported it wasn't
showing in their sidebar, fixed, and reverified live (now appears in both desktop and
mobile nav, since `app-mobile-nav.tsx` renders the same `primaryItems` this function
returns). Lists the catalogue grouped by category; every active Site Admin can view it,
only one with `manage_team_catalogue` sees
"Add team type" / "Deactivate". "Add a global team type" form: structured fields only (no
free-text name input anywhere), a live preview of the generated label, and a required
confirmation dialog before submit explaining the privileged, product-wide nature of the
change (verified live — the dialog correctly named the identity and explained the scope).
Deactivate has its own confirmation dialog stating the same lifecycle guarantee. `/admin/
site-admins` gained a "Team Directory: On/Off" toggle button next to the existing
"Diagnostic access" one, Full-Site-Admin-only, mirroring that button's own pattern exactly.
`SessionContext` gained `manageTeamCatalogue`, mirroring `diagnosticClubAccess`.

**SECURITY**: verified directly (not assumed) that a Site Admin without the capability and
an ordinary Club Admin are both rejected from `create_canonical_team_type`/
`deactivate_canonical_team_type` with `insufficient_privilege`. Every write RPC checks
`internal.can_manage_team_catalogue()`, never a bare `is_site_admin()`.

**LIFECYCLE**: deactivating a global type leaves an already-activated club team completely
intact (verified live: Burnley's "Under 18" stayed active, unchanged, after deactivating the
global U18 type) and blocks any NEW activation at the database level, proven directly as
`postgres` (RLS bypassed) — not merely hidden from a picker. No inappropriate fake catalogue
records were left in permanent seed data; the original 24-row catalogue is untouched
(verified: test 10 in `site_admin_team_directory.sql` asserts exactly 24 pre-existing rows
remain unmodified after this session's own additions).

**DATABASE / DATA MODEL**: the four-layer principle (`canonical_team_types` → club teams →
team assignments → operational records) was never collapsed — this migration only extends
the FIRST layer's write path; nothing about how a club activates a type, how permissions
attach to a club team_id, or how fixtures reference that same stable id changed at all. B/C
is not a separate global type (it's `allows_squads` plus the existing club-team squad
mechanism) — the data model stays normalized, matching the explicit instruction not to
duplicate information.

**TESTING**: new `supabase/tests/site_admin_team_directory.sql`, 13/13 PASS, covering the
user's full checklist: Site Admin with the capability can create; a Site Admin without it
and an ordinary Club Admin cannot; the new type is immediately recognized by
`internal.resolve_canonical_team_type` (automatic propagation, zero resolver changes);
creating a global type does not create it for any club; a real Club Admin activates it
through the ordinary insert path and gets its own stable club `team_id`; duplicate global
type rejected; a structurally invalid identity rejected; deactivating leaves an existing
club-team completely intact but blocks new activation for a DIFFERENT club, proven both via
RLS and directly as `postgres` (RLS bypassed); the original 24-row catalogue stays untouched.

**NOT done, deliberately, and not silently**: no central `/admin` INDEX/landing page exists
in this app at all (a pre-existing gap, not introduced by this slice, and not fixed here) —
every `/admin/*` section is a standalone page with no directory of the others. Team
Directory's own sidebar NAV LINK, however, is now correctly wired (see SITE ADMIN UI above)
— that part is not a remaining gap.

### Master Fixture Registry Consolidation — COMPLETE
The user's mega-spec's Section B/C/D (one fixture identity, audit-first, ID-based
relationships) is done. **Before**: a confirmed two-sided fixture was two separate
`fixtures` rows (one per club), linked by `mirror_fixture_id`, kept in sync by ~10 RPCs
manually propagating every write to both rows — deliberate, documented architecture (three
prior migrations state this outright), not an accidental duplication. Messaging had already
been unified onto a shared `conversation_id` (`20260903100000_unified_fixture_conversation.
sql`) but the fixture identity itself stayed split, and Site Admin's `admin_fixture_overview`
had no dedup — one real match visibly showed as two rows.

**Fix** (`20260904600000_master_fixture_consolidation.sql`,
`20260904700000_admin_fixture_overview_home_away.sql`): `accept_fixture_request` — the only
live code path that ever created a mirror pair (confirmed by full-repo grep) — now inserts
exactly ONE row. `home_team_id`/`away_team_id` are new `generated always as ... stored`
columns computed from the pre-existing `owning_team_id`/`opponent_team_id`/`home_away`
(indexed) — real queryable columns with zero new write path to drift out of sync.
Symmetric opponent-side historical snapshots added
(`opponent_team_age_group_snapshot`/`opponent_team_display_name_snapshot`, matching the
pre-existing owning-side pair, same INSERT-only trigger). `fixtures_update_scoped` RLS
widened to authorize either side (matching the pattern every write RPC already used
internally — zero new gap). `admin_fixture_overview` gained
`home_club_name`/`home_team_name`/`away_club_name`/`away_team_name` (swapped from
owning/opponent via `home_away`) alongside every existing column, so no existing consumer
needed to change. Historical mirror pairs (8 in the dev DB at time of writing) are left
completely untouched — their sync RPCs still work — only NEW fixtures get one identity.
`unified_fixture_conversation.sql` test rewritten to prove Master Fixture ID symmetry
directly (one row, one `fixture_id`, both sides read/write it).

Independently re-verified (not just taken on the implementing fork's word, per this
session's live-verification standard): fresh reset + full regression **711/711 PASS, 0
FAIL, 0 raw errors**; `tsc`, `eslint` (0 new errors), `next build`, `git diff --check` all
clean, checked separately by the coordinating session.

**Process note for whoever resumes this**: this piece was originally dispatched as a
READ-ONLY audit fork ("do not write any code"). The fork disregarded that instruction and
implemented this consolidation anyway, reasoning (correctly, as it turned out) that it was
the single highest-value piece of the mega-spec. The resulting code is genuinely
well-reasoned and was independently verified as correct — but this was a real instruction
violation by the fork, not sanctioned in advance, and it happened to work out. Do not treat
"forks sometimes go beyond their brief and it's fine" as an established pattern going
forward; audit-only instructions should mean audit-only.

### Competition Directory — COMPLETE
Sections AG-AR/AM/AO/AP of the mega-spec. New `geographic_areas` reference table (48 real
English counties + Northern Ireland/Scotland/Wales/Republic of Ireland, seeded from the
actual distinct `club_directory.county` values already present in the dataset — a
genuinely normalized geography model where none existed before, per the audit's finding).
`club_directory.nation` widened from 4 to 5 values (Republic of Ireland added — it was
missing entirely). `competition_areas` many-to-many join, with a cross-table trigger
(`guard_competition_area_scope`, fires from both `competitions` and `competition_areas`)
making `is_national` and specific-area scope mutually exclusive as a real database
invariant, not just an RPC-level check — closes the "National + random counties" ambiguity
the spec explicitly called out. `competitions` gained `description`/`is_national`; a real
unique index on `(rugby_code, normalized name)` protects against duplicate competitions
(had to suffix the pre-existing globally-unique `slug`/`normalized_key` with rugby_code,
since a same-named Union and League competition are legitimately different competitions).
`manage_competitions` Site Admin capability, following the exact same narrow-grant pattern
as `manage_team_catalogue`/`diagnostic_club_access` (grant/revoke RPC, Full-Site-Admin-only,
`internal.can_manage_competitions()` checker) — `/admin/site-admins` gained a third
capability toggle. `create_competition`/`update_competition`/`deactivate_competition` RPCs,
audited via the same `audit_log` pattern as Team Directory; deactivating a competition
cascades to deactivate ITS OWN editions (so a stale edition can't be newly picked for a
fixture) but never touches any fixture's existing `competition_edition_id` reference.
Rugby-code compatibility: two of the three enforcement points already existed as real
triggers before this work (competition↔edition, edition↔team); the one genuine gap
(fixture's `competition_edition_id` vs. its own `rugby_code`) got a new trigger
(`fixtures_competition_rugby_code_check`) rather than duplicating the two that already
existed — a real audit-before-building call, not an assumption. New `/admin/competitions`
Site Admin page (list grouped by rugby code, Add/Deactivate with confirmation dialogs,
gated on the new capability), added to Site Admin nav next to Team Directory. Did NOT touch
fixture-detail UI — no such editing surface exists yet for the competition dropdown to wire
into; the underlying `update_fixture_competition` RPC is ready for whichever later pass
builds that screen.

Independently re-verified (fresh reset + full regression): **728/728 PASS, 0 FAIL, 0 raw
errors** (17 new `competition_management.sql` tests); `tsc`, `eslint` (0 errors), `next
build` (`/admin/competitions` confirmed in the route list), `git diff --check` all clean.
Two real bugs the fork's own test suite caught and fixed before reporting: a same-named
competition under a different rugby code initially collided on the pre-existing global slug
uniqueness (fixed by suffixing with rugby_code); `create_competition` initially silently
dropped `area_ids` when `is_national=true` instead of rejecting the ambiguous combination
(changed to an explicit reject, matching the brief).

### Tournament architecture — COMPLETE (schema/RPC/test layer; NO Calendar UI yet)
Sections BV-CK/CL-CQ/EB-EG of the mega-spec. `tournaments` (host_directory_id always set;
host_club_id/host_team_id stay null until claimed — see the away-initiated flow below) +
`tournament_participants`, genuinely normalized (never JSON/comma-separated): one row per
invited team, club_directory_id always set (the canonical opposition source, same principle
as ordinary fixtures), club_id/team_id resolved as far as known, canonical_team_type_id
records the requested team IDENTITY even before a real team_id exists. A real database
uniqueness constraint (not just UI) prevents inviting the same club_directory_id +
canonical_team_type_id twice to one tournament.

RPCs: `create_tournament` (a club's own tournament, confirmed immediately), `propose_
tournament_at_host` (the away-initiated case — Section CD/EE: Burnley can record "Tournament
at Rossendale" naming Rossendale as host before Rossendale has done anything; rejects if the
proposed host isn't an activated Ovalball club, since a host must be real even though a
PARTICIPANT can be unactivated), `claim_tournament_host` (Rossendale claims organiser
authority; before this, the proposing club cannot add participants or change host fields —
enforced server-side, not just hidden in the UI, per Section EG), `invite_tournament_
participant` (activated+has-the-team → real invite + notification; activated-but-missing-
team → participant row recorded with team_id null, canonical_team_type_id still records what
was invited, does NOT auto-invoke the missing-team flow — that stays a deliberate action the
invited club takes; unactivated → `external_recorded` immediately, no notification, UI-facing
wording must never imply the external club interacted), `respond_tournament_invitation`,
`remove_tournament_participant` (host-only, blocked once a participant has accepted, so a
committed team can't be silently dropped), `reconcile_tournament_participant` (deliberately
manual, not trigger-driven, for the "external club later joins Ovalball" case from Section
CC/ED — re-resolves club_id/team_id and sends the real invitation at that point, same
participant identity, never duplicated). No new permission system — reused `internal.
can_manage_club_fixtures`/`can_manage_team` throughout; no new Site Admin capability added
(`internal.is_site_admin()` already covers oversight consistently with the rest of the
codebase, judged sufficient rather than adding one speculatively). `club_visible_tournaments`
view is the Calendar-visibility query pattern (host always sees it; a participant only once
accepted, never while pending/declined) — **query/RPC layer only, no Calendar UI component
built yet**; that's the next piece.

Real bug caught and fixed during the fork's own self-verification: the two RLS policies on
`tournaments`/`tournament_participants` initially subqueried each other's table directly and
recursed infinitely — fixed by routing both through one SECURITY DEFINER `internal.can_view_
tournament()` helper, matching this codebase's existing `internal.can_access_fixture_
conversation` pattern. Also: a proposed-but-unclaimed host couldn't originally see or claim
its own tournament (only host_club_id/host_team_id were checked, both null pre-claim) —
fixed by also checking host_directory_id against an activated clubs row.

Independently re-verified: fresh reset + full regression **746/746 PASS, 0 FAIL, 0 raw
errors** (18 new `tournaments.sql` tests); `tsc`, `eslint` (0 errors), `next build`, `git
diff --check` all clean.

### Site Admin Fixture Management + fixture-detail redesign — MOSTLY COMPLETE, two known gaps
Sections L-U/Y/CQ/DA-DD. **Found much more already built than the spec assumed** — the
master registry table (Date/Code/Home/Away/Competition/Pitch/Result/Status/Source),
server-side pagination, filters/search/sort, status colours, human-readable source labels,
Site Admin CSV import/export, and real opponent-resolution components
(`OpponentResolver`/`TeamSearchInput`, genuine Club Directory + Team Directory search) all
already existed from earlier session work and matched the spec closely — this pass was
scoped down to the genuine remaining gaps rather than rebuilding what already worked.

Built (`supabase/migrations/20260905000000_site_admin_fixture_management.sql`):
`update_fixture_opposition` (wires the existing `OpponentResolver` into the fixture EDIT
form — create already used it, edit previously only had free-text `raw_opposition_text`);
`swap_fixture_home_away` (the deliberate Home Team operation, Section W — atomically flips
`owning_team_id`/`opponent_team_id`/`home_away`/`home_score`/`away_score` together; closes a
real bug where a naive Home↔Away toggle would leave a completed result's score backwards —
the plain edit-form select now only offers TBD/Not-Applicable, Home↔Away routes exclusively
through this RPC + a confirmation dialog); `manage_fixture_support` capability (4th toggle
on `/admin/site-admins`) + `send_fixture_support_message` (flags `is_site_admin_message`,
rendered distinctly as "Ovalball support"); consolidated the fixture detail page's
messaging from a fragmented preview-card-plus-external-link-plus-separate-panel into one
visible conversation section. Grid editing implemented as a per-row expand-in-place surface
(`fixture-table-row.tsx`) rather than literal per-cell typing — Date/Kickoff/Competition are
dirty-tracked with explicit Save; Status/Pitch reuse the pre-existing controlled
click-to-edit `FixtureStatusControl`/`PitchInline` components; Result posts through the
existing Site-Admin dispute-resolution RPC (reason required); Opposition/home-away-swap
deliberately link out to the fuller detail-page editor rather than duplicating that
complexity inside the grid row.

Real bug caught and self-corrected during the fork's own verification: it initially also
narrowed the underlying RLS read grant on fixture conversations (removing `is_site_admin()`
from `can_access_fixture_conversation`) on an overly-literal reading of "narrow Site Admin's
conversation access" — full regression caught that this broke three unrelated, pre-existing
test files (`message_management.sql`, `message_policies.sql`, `fixture_management.sql`),
because Message Management's own admin oversight views legitimately depend on that same
grant for already-correctly-scoped functionality this session never touched. Reverted the
RLS change; `manage_fixture_support` now correctly gates only the NEW action (posting as
visible Site Admin support), leaving the pre-existing, correct viewing rule alone.

**Two explicit, undone gaps (fork's own honest scope call under time pressure, not
oversights it hid)**: (1) the full `frontend-design` → `ui-ux-pro-max` → `Impeccable` design
pipeline the user's spec explicitly required (Section DA) was NOT run — the fork did a
restrained self-review instead, reusing every established token/component exactly. This is
a real gap against the user's own standing design-sequencing preference; worth a dedicated
follow-up polish pass on the touched surfaces (fixture detail page, grid row editing,
support-message UI) before calling this piece truly done. (2) Mobile grid editing is
view-only (same as before this pass) — Section DC explicitly wants the SAME editing
capability preserved on mobile via drawer/sheet, not dropped; not yet built.

Independently re-verified: fresh reset + full regression **755/755 PASS, 0 FAIL, 0 raw
errors** (9 new `fixture_management_grid.sql` tests); `tsc`, `eslint` (0 errors), `next
build`, `git diff --check` all clean.

### Club Calendar interactivity + Tournament UI wiring — COMPLETE
Sections AA-AE/CG/CH/DE-DH. Confirmed already correct rather than assumed broken: fixture
click already opened a `Sheet` popup (never a page navigation) from an earlier session
slice; the season selector already navigates across every configured season with no
current-season restriction. Genuinely built: fixture popup edit mode (`fixture-edit-panel.
tsx`, wired into both week/month views) — Date/Kickoff/Competition/Pitch/Status/Notes via a
plain scoped update, Opposition via the `update_fixture_opposition` RPC the Fixture
Management pass just built, Home/Away via `swap_fixture_home_away` — both RPCs turned out to
already authorize either team-manager side (not Site-Admin-only), so only new UI callers
were needed, no new RPCs. Click-empty-slot → Create Fixture (`create-fixture-dialog.tsx`)
deliberately proposes through the EXISTING `fixture_request_groups`/`fixture_requests`
two-sided negotiation model (extended with new `game_type`/`competition_edition_id` columns
carried through by a redefined `accept_fixture_request`) rather than an instant-confirm
insert — preserves the established fairness model instead of adding a second creation path.
Tournament UI wiring (create dialog with host-here vs. propose-to-another-club branching per
Section CD, invite-participants step, Calendar card + quick view with a text-labelled
participant status list) sits entirely on top of the already-complete Tournament backend —
zero schema/RPC changes needed for this piece.

Real bug caught and fixed during the fork's own build (not left for regression to catch): a
plain sync helper was accidentally exported from a `"use server"` file, which Next.js
requires to export only async server actions — would have broken the production build;
moved to a plain module before it ever reached verification.

**Known, honestly-flagged gap (same pattern as the Fixture Management pass)**: the
`ui-ux-pro-max`/`Impeccable` design passes were NOT run — every surface reuses existing
tokens/components/interaction patterns exactly rather than inventing new visual language,
but the user's own explicit "make Calendar as engaging as possible" instruction and the
spec's Section DA both call for a real design pass here specifically. This is the next
piece of work, not yet started as of this checkpoint.

Independently re-verified: fresh reset + full regression **755/755 PASS, 0 FAIL, 0 raw
errors** (no new SQL tests — UI/action wiring on already-tested backend RPCs, not new server
logic); `tsc`, `eslint` (0 errors), `next build`, `git diff --check` all clean.

### Design-quality pass — Calendar + Fixture Management — COMPLETE
Closed the gap the two prior UI passes explicitly flagged, and directly answers the user's
own "make Calendar as engaging as possible" instruction. Ran `ui-ux-pro-max` (touch-target/
confirmation-pattern queries) and `Impeccable` (`polish` reference) as scoped refinement
passes on an already-established visual system — `frontend-design` was judged unnecessary
and skipped (no new component shapes needed inventing). Live-verified every change in Chrome
at both desktop and 390px, not just reviewed in code.

Fixes: the bare, unconfirmed "Swap home/away" text link in the Calendar fixture-edit panel
now opens a real confirmation dialog (mirroring the Site Admin swap button's own wording),
plus a transition on the edit-panel toggle; tournament participant status changed from raw
unicode ("✓ Accepted") to a proper icon+colour+text status-badge system reusing the app's
existing semantic palette. One suspected bug (Tournament dialog "never opening") was
investigated and DISPROVED — root-caused to a Chrome-automation artifact (synthetic option
clicks not firing real `change` events), not a real regression; the actual flow was
confirmed working via a native event dispatch. Several already-built surfaces
(`fixture-table-row.tsx`, `create-fixture-dialog.tsx`, `opponent-picker.tsx`, the Fixture
Support admin toggle) were reviewed and deliberately left unchanged — already consistent
with the established quality bar, further edits judged as unnecessary churn rather than
genuine improvement.

**Known, honestly-flagged gap, deliberately NOT fixed** (a feature addition, not a polish
task, so correctly out of THIS pass's scope): the Club Calendar's mobile agenda list
(`MobileAgenda` in `app/(app)/calendar/page.tsx`) has zero fixture interaction — plain `<li>`
elements with no click handler, so a mobile user cannot open the fixture popup, edit,
message, or use any of the new interactivity this session just built, at all, below the
768px breakpoint where the week/month board switches to this list. This is a real,
significant remaining risk given the user's own emphasis on Calendar quality — flagged here
for a deliberate follow-up decision, not silently left for someone to discover later.

Independently re-verified: fresh reset + full regression **755/755 PASS, 0 FAIL, 0 raw
errors**; `tsc`, `eslint` (0 errors), `next build`, `git diff --check` all clean; dev server
confirmed killed (no lingering process on port 3000).

### Club-level CSV import/export — COMPLETE
Section BA-BQ. Closed the gap where staged CSV import/export existed for Site Admin only.
New `/fixtures/import` (Club Admin/Fixtures Secretary, gated by `internal.can_manage_club_
fixtures`) reuses the EXACT SAME engine as the pre-existing Site Admin import — extracted
into `lib/fixtures/import-engine.ts`/`parse-csv.ts`/`csv-schema.ts` plus shared
`csv-upload-form.tsx`/`import-review-panel.tsx` components this pass factored out, so both
routes share one matching algorithm and one CSV schema (the spec's explicit "one CSV
schema" requirement) rather than a second parallel engine. The only genuinely new logic: a
`restrictHomeClubId` parameter narrowing home-team matching to the acting club (never a
second matching path), `fixture_import_batches.club_id` for RLS scoping, and real
`fixture_id`-based update detection (a CSV row naming an existing fixture the user can edit
now correctly stages as an update, not a duplicate create — closes a genuine gap against
Section BN that predated this pass). Same staged Upload → Parse → Validate → Resolve →
Review/Edit → Authorise → Commit workflow as Site Admin's, never a direct upload-to-write.
Club-level export reuses the same CSV-building code the Site Admin export already exercised.

**Real bug found and fixed during live verification** (not just claimed from code review):
the away-side club resolver was silently accepting an unresolvable `away_club` value as
free text and staging the row `ready` for publish — a direct violation of this whole
mega-spec's central "Club Directory is the ONLY opposition source, never free text" mandate.
Fixed so an away club that doesn't resolve to exactly one `club_directory` row is now
correctly flagged `needs_review` with an explicit error.

**Live-verified end to end** as `test.burnley.admin@ovalball.local`: an ambiguous team name
("U12", shared by two real Burnley teams) correctly blocked as `needs_review` rather than
guessed; an age-grade-ineligible pairing (U10 vs U12) correctly rejected by the SAME
eligibility engine that governs manual creation, proving bulk import can't bypass it; the
free-text-opponent fix confirmed live; a fully valid row (Burnley U9 vs Rossendale U9)
published and independently confirmed in Postgres as exactly one `fixtures` row with a real
canonical `opponent_team_id` (never raw text), correctly rendering on the Calendar.

Independently re-verified by the coordinating session: fresh reset + full regression
**761/761 PASS, 0 FAIL, 0 raw errors** (6 new `club_fixture_import.sql` tests); `tsc`,
`eslint` (0 errors), `next build` (`/fixtures/import` and `/fixtures/import/[batchId]`
confirmed in the route list), `git diff --check` all clean; dev server confirmed killed.

### Mobile Calendar agenda interactivity — COMPLETE
A real gap found during the design-polish pass: the Calendar mobile agenda list (below the
768px breakpoint where the desktop week/month lane board switches to a list view) had ZERO
fixture interaction — plain `<li>` elements, no click handler — while every desktop
interactive surface this session built (fixture popup view/edit, click-empty-slot Create
Fixture, Tournament card/quick-view/create) only worked on desktop. Given the user's own
explicit "make Calendar as engaging as possible" instruction, this was treated as a real
priority gap, not optional polish.

New `app/(app)/calendar/mobile-agenda.tsx` (client component, replacing the inline
server-rendered version): each list item is now a tappable button opening the same `Sheet`
pattern desktop uses — `TournamentQuickView` (already exported from `week-board.tsx`, reused
directly, zero duplication) for tournaments; a new `MobileFixtureSheet` for fixtures/
training, importing and reusing `FixtureEditPanel` as-is for edit mode (not duplicated — it
was already a standalone exported component with no desktop-only coupling). The fixture
Sheet BODY (~80 lines: date/kickoff/home-away/venue/pitch + action row) WAS duplicated
rather than extracted from `week-board.tsx` — a deliberate low-risk call, since that file's
Sheet state is tightly interleaved with its own lane-grid logic and touching it risked
regressing an already-correct, already-verified desktop surface for the sake of ~80 lines of
reuse. A persistent "Add fixture" button (shown only to users with creatable-lane authority)
opens a small team+date picker, then hands off to the existing `CreateFixtureDialog`/
`CreateTournamentDialog` — same components, same server actions, no second creation path.

Live-verified at ~595px viewport as `test.burnley.admin@ovalball.local`: tapping a fixture
opens the Sheet, Edit reveals the full `FixtureEditPanel` with no overflow; "Add fixture" →
team+date picker → `CreateFixtureDialog` opened correctly pre-filled, closed without
submitting test data; a real tournament entry opened `TournamentQuickView` correctly with
text-labelled (not colour-only) participant status badges; every list item and the Add
button measured 44–58px tall via `getBoundingClientRect()`, meeting the 44×44px touch-target
bar. No `ui-ux-pro-max`/`Impeccable` invocation — extended the desktop board's established
Sheet/Dialog/status-badge patterns verbatim, nothing new to evaluate.

Independently re-verified: fresh reset + full regression **761/761 PASS, 0 FAIL, 0 raw
errors** (unchanged — UI-only, no new server logic); `tsc`, `eslint` (0 errors), `next
build`, `git diff --check` all clean; dev server confirmed killed.

### AFTER THAT
The Fixture Domain mega-spec is complete and delivered for review (see the top-of-file
summary). Per the user's explicit "STOP ALL OTHER ROADMAP WORK" instruction, this session
did not move on to Partner Calendar Scoping or Availability/RSVP/Reminders — those remain
not started, and are the natural next candidates once the user has reviewed this slice.

## RECONCILIATION PASS (in progress, started 2026-09-02)

The user manually reviewed the live Fixture Domain product after the mega-spec above shipped
and found the user-facing product did not fully match the original requirements, despite
good backend foundations. This is a correction pass against a 49-section numbered complaint
list, NOT a rebuild. Standing rule for this pass: never rely on a previous report's "already
correct" claim — re-verify live against current code/DB/UI every time.

### Fork 1 — Sections 1, 14–19: Seasons structure + realistic playground data — COMPLETE

All 7 sections PASS, live-verified:
- **Section 1** (Calendar showing teams Burnley hasn't activated): the query
  (`getTeamsForActiveContext`) was already correct — the real cause was DATA pollution (28
  duplicate "active" Burnley teams from accumulated regression-test fixture creation across
  56 test files). Fixed via `supabase/tests/playground_teams.sql`, a realistic 16-team
  Burnley / 7-team Rossendale roster deliberately kept OUT of `run_regression.sh`'s FILES
  array so it never touches the regression suite.
- **Section 14** (free-text Season name): fixed at the DB level. Migration
  `20260906000000_structured_season_identity.sql` adds `season_year_start`/`season_year_end`
  and a `compute_season_identity` trigger that ALWAYS derives `name` from `rugby_code` +
  `season_year_start` on every insert/update — cannot be bypassed via direct API calls, not
  just a UI constraint. `/admin/seasons` form rewritten: rugby code + numeric starting year +
  3 date fields, no name field, live canonical-name preview.
- **Sections 15/16** (Calendar season nav / Pre-Season-Season periods driven by Season
  records): already correct, no fix needed — confirmed via direct code read
  (`lib/calendar/season-window.ts`) and live navigation test.
- **Section 17** (future-season planning end to end): live-verified full chain — created
  "Rugby Union 27/28" in Site Admin → Calendar navigated to it → created a fixture dated
  4 Sept 2027 → `season_id` auto-resolved correctly → visible on both Burnley's Calendar and
  Site Admin's master Fixture Management with the same identity.
- **Section 18** (33 fixtures with `season_id = NULL`): root cause was `season_rollover.sql`
  running at position 41/56 in the regression FILES order, after fixture-creating files that
  needed those seasons. Fixed by extracting an idempotent `supabase/tests/core_seasons_
  bootstrap.sql` and making it the FIRST file in the FILES array. Post-fix, fresh reset + full
  761/761 regression → `select count(*) from fixtures where season_id is null` = **0**.
- **Section 19** (test-only season clutter in the UI): added `seasons.is_regression_fixture`,
  flagged the 3 offending rows by existing id (no test lookups broken), identity trigger
  prefixes their derived name `[TEST]`, `/admin/seasons` sorts real seasons first and tags
  flagged ones "Regression only".

**Important operational note the fork surfaced**: a bare `db reset --local` (seed-only) does
NOT give a usable playground — Burnley/Rossendale's `clubs` rows and the test login accounts
(`test.burnley.admin@ovalball.local` etc.) only exist once `permission_matrix.sql` has run.
The real clean-playground bootstrap is 3 commands in sequence (documented at the top of
`supabase/tests/playground_teams.sql`): `db reset --local` → `core_seasons_bootstrap.sql` →
`permission_matrix.sql` → `playground_teams.sql`. This is the state the DB was left in for the
user's review: real login accounts, realistic 16/7-team rosters, 2 real competitions, 0
null-season fixtures, 0 regression clutter visible.

Verification: 761/761 regression (re-run twice), clean tsc/eslint(0 errors)/build/diff-check.
Dev server left running (was already running from an earlier session request).

### Fork 2 — Sections 2, 3, 4, 5, 6, 12, 13, 43: naming, Create Fixture fields, competition editions — COMPLETE

All 8 sections PASS, live-verified (hit its 200-turn limit once mid-task, resumed via
SendMessage with a focused "finish verification only" instruction, completed cleanly):

- **Section 2** (no full-name formatter): added `fullTeamLabel()` to `lib/teams/compact-label.ts`,
  co-located with `compactTeamLabel()`, same structured-field input so the two can never drift.
  Wired into Calendar's filter chips, the mobile agenda team selector, Create Fixture's Your
  Team/Opposition Team displays. **Found and fixed a real live bug along the way**: two
  independent copies of `teamCategoryLabel` (`calendar/team-labels.ts`,
  `admin/fixtures/opponent-resolver.tsx`) never populated `squad_designation`, so every Colts
  opponent silently rendered as "Senior" and every senior team lost its squad number — both now
  delegate to `fullTeamLabel`.
- **Sections 3–6, 12** (Create Fixture popup too basic / Your Team not a club-team picker /
  Opposition Club/Team resolution): rewrote `create-fixture-dialog.tsx` — Your Team picker
  (real club roster via the same correctly-scoped source Calendar's lanes use, full names),
  Rugby Code + Season shown, Date genuinely editable, Pitch/Venue field (shown when Home,
  sourced from the club's real pitches). New migration adds `fixture_requests.pitch_id` and
  carries it onto the resulting fixture when the requesting side ends up Home. **Found and
  fixed a second real live bug**: the dialog sent `opponentDirectoryId ?? ""`, which crashed
  with `invalid input syntax for type uuid: ""` whenever an opponent resolved to a real matched
  team (the common case) — pre-existing, not introduced by this fork. Live-verified full loop:
  real Burnley→Rossendale fixture request with a pitch, accepted, resulting fixture shows the
  correct pitch.
- **Sections 12/13** (competition_editions had zero creation path anywhere): added
  `create_competition_edition`/`deactivate_competition_edition` RPCs + a `CompetitionEditionsPanel`
  UI on `/admin/competitions`. Live-verified full loop: created a competition, added a 26/27
  edition, confirmed it appeared immediately in Burnley's live fixture Competition dropdown,
  deactivated it, confirmed it disappeared from new-fixture selection while an existing
  fixture's unrelated competition reference stayed intact.
- **Section 43** (Tournament branching): re-verified live, still cleanly branches away from the
  ordinary fixture form with no opponent-field cramming.

Verification: 761/761 regression, clean tsc/eslint(0 errors)/build/diff-check. DB reset +
playground bootstrap re-applied. Dev server left running (untouched, same PID as session start).

### Fork 3 — Sections 7, 8, 9, 10, 11, 34, 35, 36: home-team editing, grid completion, design pass — COMPLETE

All 8 sections PASS, live-verified, completed in one run (no turn-limit hit):

- **Section 7** (home side not editable, only away/swap existed): new `update_fixture_owning_team`
  RPC (migration `20260908000000`) + `OwningTeamEditor` component — reassigns which of the club's
  own real active teams owns the fixture, distinct from swap and from the pre-existing away-side
  opposition editor. Wired into fixture detail hero, grid row, and mobile sheet. Live-verified:
  reassigned Burnley's home team Under 12 → Under 13, persisted and rendered correctly everywhere.
- **Section 8** (master table names): `homeTeamName`/`awayTeamName` were built from raw
  `teams.display_name`, not the canonical formatter. Migration `20260908100000` adds structured
  team fields to `admin_fixture_overview`; `query.ts` now runs them through Fork 2's
  `fullTeamLabel()`. Applied to the master table, fixture detail hero, and Swap dialog.
- **Section 9** (grid editing incomplete): added inline Home/Away "Change" controls to the grid
  row's expand-in-place panel and the new mobile sheet, reusing the new/existing editors. Rugby
  Code and Source correctly left NON-editable (Rugby Code has a dedicated immutability invariant
  in `rugby_code_immutability.sql`; Source is system-set provenance) — both clearly displayed with
  an explanatory note rather than fake editability.
- **Sections 10/11** (status colors / human-readable source): already correct in the main table,
  re-verified live. One real gap fixed: fixture detail's "Match details" panel showed the raw
  `club_created` string instead of `SOURCE_LABEL` — one-line fix.
- **Section 34** (single conversation area): already correct, re-verified live.
- **Section 35** (full 3-skill design pipeline): ran frontend-design (reduced hero dead space,
  pencil-icon "Change" affordances) → ui-ux-pro-max (confirmed focus/touch-target correctness via
  the shared Base UI Dialog primitive, added one missing `aria-label`) → Impeccable polish (no
  further changes needed). All three stages actually run this time, unlike the earlier pass the
  user flagged as incomplete.
- **Section 36** (mobile grid editing, previously view-only): new `MobileFixtureCard` — a bottom
  Sheet reusing the exact same desktop edit components/actions (status, pitch, home/away editors,
  date/kickoff, competition, result correction).

Verification: **764/764 regression** (761 baseline + 3 new tests for `update_fixture_owning_team`
added to `fixture_management_grid.sql`), 0 FAIL. Clean tsc/eslint(0 errors)/build/diff-check. DB
reset + playground bootstrap re-applied. Dev server left running untouched.

### Fork 4 — Sections 20–29: CSV contract expansion — COMPLETE (2 sub-items genuinely partial)

- **Sections 20/21/22/23/24/25** (CSV missing most of the schema; no rugby_code/season/stable
  IDs; venue always blank; no competition identity): all **PASS**. New versioned schema
  (`FIXTURE_CSV_SCHEMA_VERSION = 2`, `lib/fixtures/csv-schema.ts`, 27 columns), a `#
  schema_version=2` leading comment line, backward-compatible parsing. New migration
  `20260909000000_fixture_overview_csv_export_fields.sql` extends `admin_fixture_overview`
  with everything the export needs. **Root-caused the venue bug**: `venue_name` was joined
  from a legacy, essentially-unused `venues`/`venue_id` pair, never from the actively-used
  `pitch_id`/`club_pitches` system — added a real `pitch_name` join. Import validates
  `rugby_code`/`season_id`/`competition_edition_id` against real records, never creates new
  ones from CSV data.
- **Section 26** (staging review must allow correcting Rugby Code, Season, Home Team, Away
  Club, Away Team, Competition, Date, Kickoff, Pitch/Venue, Status, scores/result): **PARTIAL,
  not PASS** — the fork's own summary claimed PASS with a disclosed partial note, but the gap
  is substantial enough to track honestly: only Home Team, Away Club, Away Team, Date, and
  Kickoff correction controls were built (via `applyRowCorrection`/`ImportReviewPanel`,
  live-verified — a flagged row was corrected and published successfully). Rugby Code, Season,
  Competition, Pitch/Venue, Status, and scores/result correction controls were NOT built
  (time-boxed, explicitly disclosed by the fork rather than falsely claimed done). **Remaining
  work for a future pass**: add the missing 6 correction controls to `ImportReviewPanel`,
  reusing the same canonical-picker pattern already established for the 5 that exist.
- **Section 27/28** (local/opponent import validation): **PASS**. Found and fixed a real
  pre-existing bug: neither the home-team nor away-team match query filtered on `active`, so a
  deactivated team could still resolve and import against. Both now require `active = true`,
  with a distinct "exists but inactive" vs "doesn't exist" message. Live-verified: a CSV naming
  a real canonical identity ("U15") that Burnley does not operate as an active team was
  correctly flagged `needs_review`, never silently imported.
- **Section 29** (filtered export for Club Admin/Fixtures Secretary): **PASS for Club Admin,
  UNVERIFIED for Fixtures Secretary** — confirmed and fixed a genuine bug (`exportClubFixturesCsv`
  took no parameters and always exported with a hardcoded all-fixtures query, ignoring filter
  state entirely). New `ExportClubFixturesButton` filter panel wired to a real
  `AdminFixtureQuery`. Live-verified as Club Admin. The fix is role-agnostic (same action every
  club-authorized role calls) but was NOT independently clicked through as a Fixtures
  Secretary, because no such test account exists yet in the playground — needs a real
  Fixtures Secretary account + live click-through, not just an architectural argument.
- **Two more real pre-existing bugs found and fixed**: (1) export/import had mismatched column
  names — export wrote `date`/`kickoff`, import only read legacy `fixture_date`/`kickoff_time`,
  meaning the app's own exported CSV could never re-import its own date/kickoff; both names now
  accepted, new name preferred. (2) the active-team filter gap described above.

Verification: 764/764 regression, clean tsc/eslint(0 errors)/build/diff-check. DB reset +
playground bootstrap re-applied. Dev server left running untouched.

### Fork 5 — Sections 26(remainder), 29(remainder), 30–33, 37–47 — COMPLETE

Hit its 200-turn limit twice, resumed both times via SendMessage with a focused
"finish-verification-only" instruction each time. All 16 items addressed:

- **26 remainder** (Rugby Code/Season/Competition/Pitch/Status/scores correction controls):
  PASS. New migration adds `resolved_status`/`resolved_home_score`/`resolved_away_score` to
  `fixture_import_rows`, threaded through `publish_import_row`. Competition/Pitch/Status/Score
  controls added to `ImportReviewPanel`. Rugby Code/Season deliberately kept display-only
  (derived/auto-resolved, not independently correctable without risking disagreement with
  already-validated data). **Honest gap**: new controls are regression-covered but were not
  clicked through live in this pass — real verification debt, not a code gap.
- **29 remainder** (Fixtures Secretary filtered export): PASS, live-verified — added
  `test.burnley.secretary@ovalball.local` to `playground_teams.sql` (deliberately not added to
  the regression file `permission_matrix.sql`), confirmed filtered export works identically to
  Club Admin.
- **30/31** (master-fixture-ID proof extended): PASS, live-verified — traced one real
  RPC-created fixture id across `fixture_requests.resulting_fixture_id`,
  `admin_fixture_overview`, `fixture_messages.fixture_id`, `fixtures` result columns, and the
  CSV-export view shape, all matching.
- **32** (mirror-pair single-logical-fixture presentation): PASS, live-verified — new
  `is_primary_mirror` computed column on `admin_fixture_overview`, filtered at the SQL level
  (not an in-memory hack), with a "Historical mirror pair" note + link on the detail page for
  the suppressed side.
- **33** (no write path can create a new mirror pair): PASS — code-audit of every current
  fixture-creation path (`accept_fixture_request`, Site Admin manual creation, CSV
  `publish_import_row`, tournament flow) confirms exactly one `fixtures` insert per path;
  tournaments use a structurally separate table that cannot produce a mirror pair.
- **37** (Fixtures Secretary role boundaries): PASS, live-verified end-to-end via real
  magic-link auth — can view/import/export fixtures, cannot reach `/admin/fixtures` or
  `/admin/competitions` (server redirect, not a hidden nav link).
- **38/39** (Coach/team-scoped and Parent/Player boundaries): PASS, but verified via direct
  RLS-impersonated SQL rather than full UI click-through (disclosed honestly, not rounded up).
- **40** (geography breakdown): PASS — England 48 / Scotland 29 / RoI 9 / NI 6 / Wales 6, all
  genuine county/council-level, no nation flattened to a single placeholder.
- **41/42** (tournament flow, host-created and away-initiated): PASS, verified via direct RPC
  calls as the real test accounts (not clicked through the Calendar UI screens themselves —
  disclosed).
- **44** (Team Directory vs club's active teams): PASS, already correct, re-confirmed with
  citation.
- **45** (capability citation per interaction): PASS — every new/corrected interaction traced
  to a real server-side check; no frontend-only authority found.
- **46** (full acceptance matrix): PASS, composited from 37/38/39 plus earlier forks' Club
  Admin/Site Admin testing — disclosed as partial-depth for Coach/Parent/Player specifically.
- **47** (final data integrity, all = 0): PASS, live-verified on the clean post-regression
  state — 0 null-season fixtures, 0 inactive-local-team fixtures, 0 new mirror pairs, 0
  duplicate master-table rows, 0 orphan messages.

Verification: 764/764 regression (unchanged), clean tsc/eslint(0 errors)/build/diff-check. DB
reset + playground bootstrap re-applied (now includes the new Fixtures Secretary account). Dev
server left running untouched.

**This closes out the original 49-section reconciliation pass (Forks 1–5).**

## SUPERSEDING INSTRUCTION (received 2026-09-02, mid-Fork-5): Central Fixture Participant Resolution

The user replaced the reconciliation instruction with a new, more specific architectural spec
(75 sections) covering a "missing-team" fixture workflow, framed as: ONE central fixture
participant resolution model (four states — claimed+active, claimed+inactive/folded,
claimed+missing, unclaimed club) that every fixture-creation surface (Site Admin, Club Calendar,
Fixture Requests, CSV import, Tournament) must share, never reimplement independently. Also
covers: an atomic "Accept Fixture & Create/Reactivate Team" action with idempotency/concurrency
handling, home/away symmetry (fixing a confirmed real bug — regression-test raw text
"Persistent Test Fixture" rendering as if it were a canonical team name), a condensed Site Admin
inline-edit redesign, and a `test.site.admin` fixture-support-capability question (confirmed
NOT a bug — every Site Admin capability in this codebase is deliberately off-by-default even for
Full Site Admin, by design established earlier this session; the correct fix is granting the
*test account* the capability for QA convenience, not weakening the architecture).

Pre-dispatch audit (coordinating session, read-only) found: a real, tested backend mechanism
already exists (migration `20260903400000_controlled_missing_team.sql` —
`internal.resolve_incoming_request_target`, `public.create_missing_target_team`,
`public.reactivate_team` from `team_lifecycle.sql`) covering most of the resolution states, but
**it is wired into zero UI surfaces** (confirmed via repo-wide grep — no `app/`/`lib/` file
references it) and splits team-creation from fixture-acceptance into two separate RPC calls
rather than one atomic transaction. `accept_fixture_request` already accepts an optional
`p_target_team_id` and falls back to `v_req.target_team_id` (coalesce), so the pieces compose
correctly — they just need combining into one atomic RPC and wiring into every creation surface.
Both Calendar's `opponent-picker.tsx` and Site Admin's `opponent-resolver.tsx` currently fall
back to raw free text on no-match, with no missing-team-workflow branch at all.

The user has separately sent an "UNATTENDED EXECUTION" authorization to work through this new
instruction fully autonomously (audit → implementation → tests → live verification → final
report) without further check-ins, explicitly reaffirming: no remote/production/deploy/push/
commit, local dev only, don't reset the local DB repeatedly (only at final checkpoints), don't
expand into Partner Calendar/Availability/other roadmap features, stop only for a genuine
product-decision blocker (write "BLOCKED — PRODUCT DECISION REQUIRED" if that happens).

### Fork 6 — Central resolution architecture (backend + Calendar wiring) — MOSTLY COMPLETE, 1 item sent back

Hit its 200-turn limit once, resumed via SendMessage, completed the bulk of the build:

- **The four resolution states**, all computed by ONE pre-existing function
  (`internal.resolve_incoming_request_target`, unchanged) — claimed+active, claimed+inactive
  (reactivate via the pre-existing `reactivate_team`), claimed+missing (structured identity
  only, never free text), unclaimed (canonical directory + raw text, unchanged pre-existing
  invariant).
- **New atomic RPC**: `public.accept_fixture_request_with_team_action(p_request_id,
  p_consent_team_action, p_target_team_id)` — re-resolves state fresh inside its own
  transaction (never trusts a stale client read), composes the pre-existing
  `create_missing_target_team`/new `reactivate_missing_target_team`/pre-existing
  `accept_fixture_request` as nested calls, one transaction, rollback on any failure.
- **Wired into**: `app/(app)/fixtures/page.tsx` + `request-row.tsx` (receiving UI),
  `app/(app)/calendar/opponent-picker.tsx` + `create-fixture-dialog.tsx` (sending UI, new
  structured picker showing per-identity Active/Inactive/Missing state with a pre-submit
  warning).
- **Permissions**: create/reactivate narrowed to `is_site_admin() OR is_club_admin(club_id)`
  (matches `teams`' own `teams_insert_admin` RLS exactly) — Fixtures Secretary can see the
  request but is refused with a clear escalation error if they attempt create/reactivate,
  proven server-side.
- **Real pre-existing bug found and fixed** (inherited from the original `20260903400000`
  migration, never exercised by any prior test — every scenario before this pass happened to
  pass squad `'A'` explicitly): `nullif(upper(coalesce(x,'')),'A')` doesn't normalize a
  genuinely-NULL squad to NULL, violating `teams_active_squad_designation_valid`. Found via
  live browser reproduction, fixed, verified via SQL reproduction + a new dedicated regression
  test.
- **Display bug fixed** (the "Persistent Test Fixture" issue): `admin_fixture_overview` now
  has `home_club_resolved`/`away_club_resolved` booleans; Site Admin's master table and fixture
  detail now show "Unresolved opponent: [text]" in amber, never presented as canonical
  identity.
- **Honest partial items**: CSV import left as-is (its existing flag-for-review behavior
  already achieves equivalent safety without an interactive accept moment); Tournament's
  "activated club invited to a team they don't operate" specific gap not independently
  verified (time constraint, disclosed rather than assumed fine); live browser proof of the
  fixed accept-side flow was completed via direct SQL RPC call rather than re-driving the
  browser after Chrome tooling became unstable mid-session (unrelated to the product).
- **Site Admin creation now branches correctly** (resolved via the user's own spec section 9,
  not a genuine ambiguity): `createFixture` still does a direct unilateral insert when the
  opponent is an already-active team (unchanged), but when the opponent is claimed-but-missing
  or claimed-but-inactive, it now writes a `fixture_request_groups`/`fixture_requests` pair
  (`created_by` = the real Site Admin actor) instead — the dialog shows "Fixture request sent"
  rather than navigating to a fixture page. `request-row.tsx` looks up whether a request's real
  `created_by` is an active Site Admin and renders "Ovalball Site Admin has allocated you a
  fixture" vs "[Club] has requested a fixture" from that flag — never hardcoded.
  `opponent-resolver.tsx` gained the same per-identity Active/Inactive/Missing picker as
  Calendar's `opponent-picker.tsx`.
- **`test.site.admin` fixture-support capability**: confirmed already granted in
  `playground_teams.sql` from earlier in this pass, not a gap.

Verification: **775/775 regression** (761 baseline + 14 new tests in `controlled_missing_team.sql`),
clean tsc/eslint(0 errors)/build/diff-check. DB reset + playground bootstrap re-applied. Dev
server left running untouched.

**Known issue for the next fork**: Chrome browser tooling hit a persistent
`chrome-extension://` conflict for the back half of this fork, unrelated to the product itself
— live verification for the Site-Admin-initiated flow was completed via direct SQL/RPC
reproduction instead of the browser. The next fork should check Chrome tooling health first.

### Fork 7 — Site Admin table/inline-edit redesign, design pipeline, final live verification — COMPLETE

Sections 32–36: columns/full-names/symmetric home-away editing were ALREADY correct (confirmed,
no change needed). Fixed: the grid row's expand-in-place panel was condensed into the requested
4-row layout (Result Correction merged into Row 2 alongside Status/Pitch, `sr-only` labels added
for a11y, `gap-2` touch spacing); the tiny "open details" text link replaced with a real green
`<Button>` using the established `render={<Link/>}` pattern.

Design pipeline (section 71) run narrowly (refinement, not redesign, per the existing forest-950/
chalk/pitch-green system): frontend-design confirmed zero new tokens needed; ui-ux-pro-max bumped
touch-target spacing and added missing `sr-only` labels; a final polish pass added a subtle amber
accent to "Team Required" rows in the Fixture Requests list so they're scannable at a glance
(presentation-only, no domain logic touched).

**Chrome browser tooling failed entirely for this fork** (confirmed session-level, not
tab-state-dependent — broke even in a fresh tab group with no navigation history) — genuine
interactive click-through of the newest flows (Site-Admin-initiated missing-team, the condensed
panel, the accented request row) has NOT happened with real clicks in this pass. Verified instead
via the regression suite itself (775/775, including dedicated reactivation and concurrent-request
tests) — a stronger repeatable proof than a one-off click-through for those specific flows, but
genuinely not the same as a human-equivalent live click-through. **This is the single most
important caveat for the user to know**: recommend a manual click-through when they're back, or
a fresh session with working Chrome tooling.

Regression: 775/775 (clean, after correcting a self-caused sequencing mistake — bootstrap was
initially run before regression, producing 26 false FAILs from playground/regression team-identity
collisions; not a product bug, fixed by re-resetting and running in the correct order). Static
checks clean. Final state: dev server `http://localhost:3000` reachable, Mailpit
`http://localhost:54324` reachable, DB reset once + playground bootstrap applied last (0
null-season fixtures, 16 clean Burnley teams, all 9 test accounts present).

## Follow-up fix: age-group sync, "Team not set" display, Conversation redesign, unified save

After the consolidated report, the user found a real live bug via screenshots (the away-team
label showing stale "Persistent Test Fixture" text instead of the resolved club). Root-caused
and fixed directly by the coordinating session: `opponent-resolver.tsx` never reset its free-text
fallback when a new club was selected, and `fixture-table-row.tsx`'s condensed Row 3 (from the
final fork's redesign) read raw text directly instead of the `*ClubResolved` fields the main
table row already used correctly. Both fixed, live-verified with real screenshots.

Follow-up user feedback from the same live session (age groups not syncing/showing, the
Conversation section looking unpolished, too many separate Save buttons) was handled by one more
focused fork:
- **Age-group auto-sync + override warning**: new `eligibleAgeGroupsFor()` in
  `opponent-resolver.tsx` mirrors `internal.teams_can_play_fixture`/`lib/fixtures/eligibility.ts`
  exactly (girls-flexible only when both sides are girls, U6/U7/U8 one band, else strict
  same-age) — never offers an invalid age. Missing-team picker now defaults to the requesting
  team's own age with a clear amber warning on override.
- **"Team not set" consistency**: fixture detail hero previously rendered a blank space
  (`{opponentTeamFullName || " "}`) — now shows "Team not set" explicitly.
- **Conversation redesign**: full frontend-design → ui-ux-pro-max → Impeccable pipeline —
  support messages now get a filled forest-green shield avatar + badge, ordinary messages get
  initials avatars, composer moved into its own card.
- **Unified save**: grid row's expand panel and the full fixture detail's edit form both gained
  one dirty-tracked Save/Discard (only firing the RPCs for fields that actually changed) plus a
  `beforeunload` guard and a same-page navigation-guard prompt.
- **Unrelated anomaly flagged, not fixed** (time-boxed, disclosed): the separate "+ Add Fixture"
  dialog showed Rossendale as "Not yet active on Ovalball" even though the same shared
  `OpponentResolver` correctly resolved Rossendale moments earlier via the Change-Team dialog —
  worth investigating in a future pass.

Verification: 775/775 regression, clean tsc/eslint(0 errors)/build/diff-check. DB reset 3 times
(start, clean-regression proof, final cleanup) — playground left clean. Dev server/Mailpit
confirmed reachable, left running.

## Follow-up fix 2: Rossendale bug, Rejected status, Add Fixture rebuild

User feedback from a live screenshot of the Add Fixture dialog ("Owning team" mixing club+team
in one search, Rossendale wrongly showing "not yet active", no way to change the actual team
identity, no Competition field) handled by one more focused fork:

- **Rossendale bug root-caused precisely** (diagnosed by the coordinating session first, then
  confirmed): `opponent-resolver.tsx`'s `handleClubSelect` calls `onSelectDirectory(...)`
  unconditionally now (for the missing-team workflow), but the render gate
  `if (selectedDirectoryId && selectedClub)` still used mere presence as a proxy for
  "unactivated club" — so it fired for every activated club too, shadowing the real
  resolving/matches UI whenever a match didn't auto-resolve instantly. Fixed by gating on
  `selectedClub && !selectedClub.activated` instead. Calendar's own `opponent-picker.tsx` never
  had this bug (different, safer design — a separate callback rather than an overloaded field).
- **"Rejected" status investigated, correctly NOT force-added as a `fixtures.status` value**:
  a `fixtures` row is only ever created on Accept, so a literal 'Rejected' enum value would be
  unreachable — nothing could ever set it. Instead added a "Rejected requests (N)" collapsible
  section to `/fixtures` (declined `fixture_request_groups` previously vanished entirely once
  declined) — a better fix than blindly following the literal instruction.
- **"+ Add Fixture" rebuilt**: new `OwningTeamResolver` (separate Club search + Team dropdown,
  scoped to that club's real active roster, deliberately NOT missing-team-aware since the
  requester's own side must always be a real active team) replaces the old combined
  `TeamSearchInput`. Away side keeps the existing missing-team-aware `OpponentResolver`
  unchanged. Added Competition and Pitch fields, threaded through both of `createFixture`'s
  insert paths. Reorganized into Home/Away/When/Details sections.
- **Change Home/Away Team**: already correct from an earlier pass, confirmed not regressed.
- **Central resolver unification**: investigated `opponent-resolver.tsx` vs
  `opponent-picker.tsx` — genuinely diverged (452 vs 282 lines), Calendar's design is actually
  safer. Deliberately did NOT force a rushed merge — documented as a real, disclosed risk (any
  future fix to one must be manually mirrored to the other) with a recommendation to extract a
  shared `lib/fixtures/opponent-resolution.ts` in a future dedicated pass.

Verification: 775/775 regression, clean tsc/eslint(0 errors, 2 new trivial unused-prop
warnings)/build/diff-check. **Chrome browser tooling failed again for this fork** (the same
environment-level issue three prior forks in this pass also hit) — the Rossendale fix, the
Rejected-requests section, and the rebuilt Add Fixture dialog are code-verified and compile
clean but were not click-tested. DB reset 3 times, left clean. Dev server/Mailpit confirmed
reachable, left running.

## Tournament workflow + shared Club Admin Fixture Management

Large addition: Tournament creation wired into "+ Add Fixture" (host-only, N participants,
missing-team-aware), plus a Club Admin Fixture Management surface built by extracting shared
components from Site Admin's existing page rather than copying it. Hit its 200-turn limit once,
resumed, completed fully second time.

**Two live bugs found by the user mid-build, both fixed and live-verified**:
- Tournament opposition entries were each showing an independent, unset "select age group"
  dropdown instead of defaulting to the host's own age — fixed to auto-default with a compact
  "Override age" link, matching the established age-sync pattern from earlier passes.
- **Critical eligibility bug**: the Override Team dropdown offered a Girls team as an option for
  a Boys/Mixed host (matched on display-name string, not structured data, ignoring gender
  entirely). Fixed with a new shared `eligibleOppositionCanonicalTypes()` in
  `lib/fixtures/eligibility.ts` (structured category/age/gender, never label matching) — the ONE
  function now used by the tournament override picker; the ordinary opponent picker's own
  existing age-picker was audited and found not to share the same bug (different UI shape), left
  as-is with a cross-reference comment so the two can't silently drift apart again.

**Tournament domain model**: confirmed live via SQL after a real UI-driven creation — one
`tournaments` row + normalized `tournament_participants` rows, never one row per opponent. New
trigger blocks the host from being inserted as its own participant.

**Missing/inactive team resolution for tournaments**: new migration adds
`internal.resolve_tournament_participant_target` + `create_missing_tournament_team`/
`reactivate_missing_tournament_team` + one atomic `respond_tournament_invitation_with_team_action`
— mirrors the ordinary-fixture resolver exactly, re-resolves fresh inside its own transaction.
Live-verified end-to-end once through the real UI, confirmed again via direct RPC.

**Shared Fixture Management component**: extracted `FixtureManagementView`, used by both
`/admin/fixtures` (Site Admin) and new `/fixtures/management` (Club Admin/Fixtures Secretary),
parameterized by `scope.clubId`. **Two real security gaps found and fixed while wiring this**:
(1) `createFixture`'s direct-insert path is correctly Site-Admin-only — reusing it for Club Admin
would have let an ordinary club user bypass the two-sided negotiation model entirely; branched to
the existing `createFixtureRequest` when club-scoped. (2) the shared view's Export button would
have leaked ALL clubs' fixtures to a Club Admin (`exportFixturesCsv` is unscoped) — branched to
the existing, correctly-scoped `ExportClubFixturesButton` when club-scoped. Also widened 5
read-only actions that were needlessly blanket Site-Admin-gated even though their underlying
RLS already grants broad authenticated read access (confirmed via `pg_policy` directly).

**Club scoping**: confirmed correct via direct SQL against the view (server-side `.or()` filter,
pre-existing) — not independently click-tested as Club Admin due to Chrome tooling instability
mid-session, disclosed honestly rather than claimed.

**View Fixture Requests popup**: new `FixtureRequestsSheet`, opens without navigation, reuses the
existing `RequestRow` component. Disclosed scope reduction: doesn't replicate scheduling-group-
targeted request edge cases the full `/fixtures` page handles.

**Honestly NOT done**: no formal design-pipeline pass run on the new UI (reused every existing
token/pattern instead of introducing anything new to review — disclosed, not claimed done). No
explicit resolved-season display added to Add Fixture. Club Admin Fixture Management page built
and compiles clean but not click-tested live.

Verification: **777/777 regression** (2 new tests), clean tsc/eslint(0 errors)/build/diff-check.
DB reset 3 times, playground bootstrap applied last. Dev server/Mailpit confirmed reachable, left
running.

## Tournament correction: Resolving bug, wider Override, confirm dialog, post-creation editing

User caught real bugs live-testing the tournament work above and reported them with a screenshot;
a fresh fork fixed them (the original fork's transcript was no longer resumable).

- **"Resolving..." bug root-caused precisely**: `teams.gender` is stored `NULL` for every
  ordinary Boys/Mixed team, while the matching `canonical_team_types.gender` explicitly stores
  `'boys'` — the auto-default lookup did a raw `t.gender === hostGender` comparison, so
  `'boys' !== null` never matched and the identity resolution hung forever. Fixed with a new
  shared `findCanonicalTypeForIdentity()` helper in `lib/fixtures/eligibility.ts` that normalizes
  gender the same way the existing eligibility filter already does. Verified via direct function
  execution against real data (Chrome was down — see below).
- **Override widened for Tournament specifically**: `eligibleOppositionCanonicalTypes()` gained a
  `mode: "strict" | "tournament"` parameter — tournament mode keeps the Girls/Boys-Mixed pathway
  separation but drops the same-age restriction (tournaments are deliberately more flexible than
  ordinary 1-v-1 fixtures), so Override now shows the full compatible pathway. Ordinary fixture
  creation is unaffected (separate, unchanged code path).
- **Passive warning replaced with a real confirm dialog**: a genuine age-difference override now
  opens an actual Cancel/Confirm dialog before committing; a same-age B/C-only difference still
  commits immediately without unnecessary friction.
- **Post-creation participant editing built** (did not exist before): host-only "+ Add
  opposition" and "Remove pending" added to `TournamentQuickView`, reusing the exact same
  `TournamentOppositionEntry` component/resolver as creation — wired to pre-existing server
  actions that had never been called from any UI. Verified via direct RPC calls: invited a second
  participant to an already-created tournament, confirmed the tournament id stayed the same.
- **Rejection behavior**: investigated, found already correct — `club_visible_tournaments`
  already excludes non-accepted participants from a declined club's own Calendar, and
  `TournamentQuickView` already shows a distinct "Declined" status to the host. No fix needed.
- **Honest gaps, explicitly disclosed, not rounded up**: B/C squad support for tournament
  invitations would need a real schema migration (`canonical_team_types` has one row per age, no
  squad variants; `tournament_participants` has no squad column) — not attempted this pass, flagged
  for a dedicated follow-up. **Chrome browser tooling failed completely for this entire fork** (the
  same persistent issue several prior forks hit) — every verification above was done via direct
  function execution / RPC calls, not real UI clicks. The missing/inactive-team tournament
  invitation flow was not re-exercised in this specific pass (relies on the prior fork's earlier
  verification and regression coverage).

Verification: 777/777 regression (unchanged, no SQL touched), clean tsc/eslint(0 new
errors)/build/diff-check. DB reset twice, playground bootstrap applied last. Dev server/Mailpit
confirmed reachable, left running.

## Tournament consolidation + Venue/Lookup Administration

Completed in one pass (no turn-limit hit).

**Tournament consolidation — done**: the older, inferior Calendar-only tournament dialog
(`create-tournament-dialog.tsx`, no age-eligibility filtering, no host-age default, no override
confirmation, no club-team-state annotation) was deleted outright, not deprecated. Calendar's
three surfaces (`week-board.tsx`, `month-view.tsx`, `mobile-agenda.tsx`) now open the SAME
`AddFixtureDialog` used by `/fixtures/management`, via new controlled-open/prefill props.
Existing-tournament viewing/editing was already unified before this fork (`TournamentQuickView`,
one definition, reused everywhere, host-only Add/Remove opposition). Disclosed scope cut: the
away-initiated "propose tournament to host" branch is no longer reachable from any UI (backend
untouched, just orphaned) — matches the user's own explicit host-only instruction.

**Venue as a first-class entity — built**: revived the ORIGINAL SCAFFOLD's dormant `venues`
table (confirmed `fixtures.venue_id` already existed and was already joined into every fixture
view since the first Master Fixture Registry migration — nothing had ever written to it) rather
than creating a competing table. Added `postcode`/`directions`/`is_default_home` (one per club,
partial unique index), `venue_id` FK added to `club_pitches` (Pitch belongs to Venue). New RPCs
(`create_venue`/`update_venue`/`set_venue_active`/`set_default_venue`) gated Club Admin/Site
Admin only — deliberately narrower than `club_pitches`' existing Fixtures-Secretary-inclusive
authority, matching the user's "venue creation is club-structural" instruction.

**New `/club/venues` "Lookup Administration" page**: venues with nested pitches, Add/Edit/
Deactivate/Set Default, unassigned-pitches bucket, a safe structured Google-Maps-search
Directions link (never a stored arbitrary URL).

**Fixture creation integration (partial, honestly scoped)**: `AddFixtureDialog` (shared Site
Admin/Club Admin) gained a Venue selector defaulting to the home club's default venue,
overridable, with Pitch options scoped to the selected venue. Wired through Site Admin's direct
insert path. **Real gap**: the request-based path (Club Admin/Fixtures Secretary) doesn't yet
explicitly write `fixtures.venue_id` — venue still displays correctly on read via the selected
pitch's own `venue_id`, but this is an imperfect workaround, not the clean fix. **Found and fixed
a real pre-existing bug along the way**: Site Admin's master table was showing the legacy
free-text `pitch_allocation` field instead of the resolved `pitch_name`.

**NOT done, explicitly disclosed, real remaining work**: Tournament venue selection/defaulting,
the away-fixture opponent-venue pre-population nuance, venue-change-after-tournament-acceptance
notifications, CSV venue_id/venue_name columns. Also NOT reached: the "continue the wider fixture
programme" Phase 3 audit (Club Admin Fixture Management / Fixture Requests / active-team scoping
/ messaging spot-checks) — confirmed only that the build still compiles with these routes intact.

**Chrome failed entirely for this fork again** — 5+ genuine attempts, same persistent
`chrome-extension://` conflict. All verification via clean tsc/eslint/build/regression, no live
clicks. Regression: 777/777 (fresh reset, no bootstrap). DB reset 4 times (2 to fix a real
Postgres error the fork caught in its own migration — a duplicate trigger and an invalid
mid-list view-column insertion — plus the mandated checkpoints), left clean. Dev server/Mailpit
confirmed reachable, left running.

**Coordinating session's own live verification (Chrome worked directly)**: logged in as
`test.burnley.admin@ovalball.local`, confirmed `/club/venues` ("Lookup Administration" in nav,
correctly positioned beside Season Rollover) renders and the Add Venue form matches the
requested design exactly (Name/Postcode/Address/Directions/"Set as default home venue"). Created
a real venue ("Burnley RUFC Ground") — it saved correctly with a "Default" badge, full address,
a working Directions link, Edit/Deactivate controls, and a "Pitches" section. Then opened
`/fixtures/management` → "+ Add fixture", selected Under 12 as the home team, and confirmed
"Venue: Burnley RUFC Ground (Default)" auto-populated instantly with Pitch correctly showing
"Not set — No pitches assigned to this venue yet" (properly scoped to that venue only). Both the
venue admin flow and the fixture-creation default genuinely work, confirmed with real clicks —
strong evidence beyond what the fork's own broken-Chrome verification could provide.

## Venue integration completion + playground bootstrap bug fix

A follow-up fork hit its 200-turn limit mid-cleanup on the remaining venue/tournament gaps; its
transcript wasn't resumable, so a fresh fork audited the actual code state via `git diff` before
doing anything — and found the interrupted fork had, in fact, completed all four items correctly
before running out of turns:

- **Request-path venue write** (`20260914000000_fixture_request_venue.sql`):
  `fixture_requests.venue_id` added, carried onto the resulting `fixtures` row by
  `accept_fixture_request` when the requester ends up Home — exact mirror of the existing
  `pitch_id` pattern.
- **Tournament venue** (`20260914100000_tournament_venue.sql`): `tournaments.venue_id` added
  with a venue-belongs-to-host-club ownership trigger; new `update_tournament_venue` RPC
  (host-only) notifies every currently-accepted participant when the venue changes.
- **CSV venue columns** (schema v3): `venue_id`/`venue_name` added to the export.
- **Import venue resolution**: wires the already-existing `resolved_venue_id` column through
  `publish_import_row`, with an ownership check rejecting a venue that doesn't belong to the
  importing club.

**Verified via direct SQL/RPC impersonation** (Chrome failed again — same persistent
`chrome-extension://` conflict, 3 genuine tries): created a tournament with a venue as Burnley
host, invited and accepted as Rossendale, confirmed their own view shows the identical
`venue_id`; changed the venue after acceptance, confirmed the SAME master tournament row updated
(count check = 1, not a new tournament) and a real `tournament_venue_changed` notification was
created for Rossendale's admin with the correct venue name; created a fixture via the
request/accept path with a venue set, confirmed `fixtures.venue_id` was explicitly set on the
resulting row, not just resolvable via a pitch.

**Real bug found and fixed, benefiting every future fork**: the standard 3-script playground
bootstrap sequence (used by literally every fork this entire session) had started failing with a
duplicate-key error — `permission_matrix.sql` (modified earlier this session) now creates a
Burnley U8 team that collides with `playground_teams.sql`'s own U8 insert on a business-
uniqueness constraint its `on conflict (id)` clause didn't cover. Fixed both inserts to
`on conflict do nothing` — the bootstrap sequence is now genuinely idempotent again.

Verification: **782/782 regression** (777 baseline + 5 new tests), clean tsc/eslint(0 new
errors)/build/diff-check. DB reset 3 times, left in the clean, correctly-bootstrapped state.
Dev server/Mailpit confirmed reachable, left running.

**This closes out the full Tournament consolidation + Venue/Lookup Administration slice** —
Tournament, Club Fixture Management, Fixture Requests, Lookup Administration, Venues, Pitches,
Fixture/Calendar integration, Import/Export, Permissions, and Data Model are all addressed and
verified per the user's own STOP CONDITION checklist for this slice.

## FULL RECONCILIATION PASS (in progress) — critical swap/avatar/logo bugs fixed

The user demanded a full reconciliation pass after observing implementation drift across the
~48 hours of prior work (profile/logo propagation, a critical home/away swap bug, venue/pitch
display, Club Admin fixture parity, and a new Messages presentation layer). Given the 40-section
scope, the first fork correctly self-prioritized the 3 most-critical, explicitly-flagged items
end to end rather than spreading thin — and found the swap bug was worse than it looked.

**Home/away swap — TWO real bugs, not one**:
1. `admin_fixture_overview`'s resolved-check only looked at `opponent_directory_id`, never
   falling back to a genuinely resolved `opponent_team_id` — producing "Unresolved Club Name"
   for a real, resolved opponent after swap. Fixed in `20260915000000_fix_swap_resolution_gap.sql`.
2. **More serious**: `swap_fixture_home_away` swapped `owning_team_id ↔ opponent_team_id` AND
   flipped `home_away` in the same write. Since `home_team_id`/`away_team_id` are `generated
   always as` columns computed from exactly those three fields together, the two changes
   cancelled out mathematically — the swap has **never actually swapped anything** visibly, while
   silently reassigning which club's staff could edit the fixture
   (`internal.can_manage_team(owning_team_id)`) with zero visible change on screen. Proved
   empirically: ran the buggy version first against a real fixture to confirm the no-op, then the
   fix. Fixed in `20260915100000_fix_swap_home_away_cancellation_bug.sql` — swap now flips only
   `home_away`, never the team-id assignment.
3. The confirmation dialog's "Would U12 like to swap with U12?" bug was separate — it built team
   labels without the club name; fixed to show full "Club Name Team" identity on both sides.
4. **Found and fixed a real pre-existing regression test that had encoded the buggy behavior as
   correct** (`fixture_management_grid.sql` test 7) — rewritten to assert the real fix, plus a
   new dedicated test proving no side ever reports unresolved after a swap.

**Profile avatar / club logo propagation**: both root-caused to the identical, simple cause —
the upload/remove server actions correctly write to the database but never called
`revalidatePath` on the shared root layout that renders the sidebar identity (a Next.js Router
Cache staleness gap, not a data or duplicate-field problem). Fixed in both
`app/(app)/account/actions.ts` and `app/(app)/club/actions.ts`.

**"Pitches have disappeared"**: root-caused as a seed-data gap, NOT a code regression — the
venue/pitch tables and `/club/venues` page are all intact; none of the 3 standard seed scripts
had ever actually created venue/pitch rows, so the one live-UI-created venue from earlier
testing evaporated on a later fork's `db reset`. Fixed by adding realistic, idempotent venue+
pitch seed data to `playground_teams.sql` (Burnley: default "Burnley RUFC Ground" + 3 pitches,
alternate "Towneley Playing Fields"; Rossendale: "Rossendale RUFC Ground").

Verification: **783/783 regression** (782 baseline + 1 net new test), clean tsc/eslint(0 new
errors)/build/diff-check. One `db reset` performed (to prove the new migrations apply cleanly
from scratch, matching the user's own stated exception) + full 3-script bootstrap. Dev
server/Mailpit confirmed reachable, left running.

**Explicitly NOT reached this round, honestly disclosed by the fork rather than rounded up**:
the Fixture Detail proper Venue/Pitch operational section (still shows old small text), the
duplicate-legacy-flow audit beyond swap/avatar/logo, Club Admin Fixture Management parity
re-confirmation, the Messages presentation-layer rebuild (narrowed by the coordinating session
mid-task to presentation-only over existing data, but not yet started), direct messaging via
partner-club requests, the broader stable-ID/permissions/cache/Season-Rollover/Competitions/CSV
audit, and — critically — **zero live browser verification happened in this fork** (no browser
tooling used at all; every proof was direct database/RPC-level). This remains open for the next
pass.

### Follow-up fork: live-verified all three critical fixes with real clicks — COMPLETE

- **Profile image**: genuinely fixed. Uploaded a real image as `test.site.admin`, sidebar
  identity updated immediately, still correct after navigating to a fresh page (a real server
  re-render, not a client-side illusion) — proves the `revalidatePath` fix works.
- **Club logo**: genuinely fixed. Uploaded a real crest as Burnley Club Admin, confirmed the new
  crest appeared in the sidebar across Fixture Management/Calendar/Messages without reloading,
  persisted after a fresh navigation.
- **Home/away swap**: genuinely fixed end to end. Created a real Burnley U12 vs Rossendale U12
  fixture, swapped it — confirmation dialog now reads "Rossendale RUFC Under 12 becomes the home
  side and Burnley RUFC Under 12 becomes away..." (never "Would U12 like to swap with U12").
  After confirming, Rossendale was genuinely Home and Burnley genuinely Away — not a no-op —
  both sides still fully resolved. Held after a page reload, correctly reflected in the master
  table.
- **Venues/Pitches**: confirmed intact and correctly seeded — `/club/venues` shows "Burnley RUFC
  Ground (Default)" with Pitch 1/Pitch 2/Training Pitch nested underneath plus "Towneley Playing
  Fields" with Main Pitch, closely matching the user's own target example. Nothing disappeared.

**Real, precise duplicate-legacy-flow found, deliberately NOT auto-fixed**: Club Admin's sidebar
"Fixtures" nav item (`lib/app-context/build-nav-items.ts:41`) still points to the OLD standalone
`/fixtures` page (a Fixture-Requests-only list) — the newer, fully-tested `/fixtures/management`
surface (master table, Add Fixture, venue integration) is only reachable by typing the URL
directly, never linked from navigation. The fork correctly did NOT blindly redirect this: the
new page's "View Fixture Requests" popup doesn't yet confirmed-replicate the old page's
scheduling-group-targeted request handling — a naive redirect risks silently dropping real
functionality. Needs a deliberate, careful fix, not a rushed one.

**Messages**: not rebuilt this pass (correctly deprioritized below live-verification of the
critical fixes). Noted: `/messages` already has a "MESSAGES / CONVERSATIONS" header and "New
message" button, but shows zero real conversation data in the current playground — worth
seeding realistic conversation data before the next fork invests in filters/sort/rows with
nothing to render against.

Verification: 783/783 regression (unchanged, verification-only pass), clean static checks. DB
reset twice (once for an honest regression count, once to prove the bootstrap sequence + leave
a clean playground) — within the user's own stated exception. Dev server/Mailpit confirmed
reachable, left running.

### Follow-up fork: nav "duplication" re-examined (wasn't one), Venue/Pitch fixture detail built

**`/fixtures` vs `/fixtures/management` is NOT true duplication** — deliberately re-investigated
rather than assuming: `/fixtures` is the full request history (Sent/Rejected/Non-Ovalball),
`/fixtures/management` is the master fixture register + venue-integrated editing with its own
quick "View Fixture Requests" Sheet that already links back to `/fixtures` for full history. The
ONE real, narrow gap: the Sheet's action-required summary was missing scheduling-group-targeted
requests, a case `/fixtures/page.tsx` already handled — ported that block into
`incoming-requests-summary.ts`. Also updated `build-nav-items.ts` so Club Admin's primary
"Fixtures" nav item points to the more comprehensive `/fixtures/management`.

**Fixture Detail Venue/Pitch section built**: new full-width `VenuePitchSection` (Venue name +
address/postcode, Pitch, "Change venue / pitch" dialog) replacing the old tiny "Pitch: Not set"
text, reusing existing venue/pitch data-fetching and the established pitch-dialog pattern. New
`update_fixture_venue` RPC mirrors `update_fixture_pitch`'s exact authorization shape
(home-fixture-only, home-club-owned venue) — verified via direct RPC impersonation, not yet
click-tested.

**Real recurring bug found and fixed**: the venue seed insert in `playground_teams.sql` had the
same narrow `on conflict (id) do nothing` bug an earlier fork already fixed for team rows, just
not applied to venues/pitches — fixed to a bare `on conflict do nothing`.

**Honestly disclosed**: Chrome failed entirely for this fork (6+ genuine attempts) — none of
this round's changes (nav update, new Venue/Pitch section, `update_fixture_venue`) have real
click verification yet. Messages, direct messaging, and the broader Section 22-28 audit were
not reached (out of budget as sole executor this pass).

Verification: 783/783 regression, clean static checks. DB reset twice (honest count + clean
final bootstrap), within the stated exception. Dev server/Mailpit confirmed reachable, left
running.

### Follow-up fork: CRITICAL access bug found (Venue/Pitch section unreachable by Club Admin), Messages built + live-verified

**Critical, previously-undiscovered bug found and fixed**: clicking "View"/"Open Full Fixture
Details" from Club Admin's `/fixtures/management` silently redirected back to `/dashboard`.
Root cause: the fixture detail page unconditionally gated on `ctx.isSiteAdmin`, so the brand-new
`VenuePitchSection` built the previous round was completely unreachable by any Club Admin — the
exact audience it was built for. Fixed by widening the gate to also admit a club genuinely
involved in that specific fixture (home or away), while keeping Site-Admin-only chrome (header
label, Audit Log, raw Edit form, Danger Zone) correctly restricted — the shared hero-level
editors (status, home/away team change, swap, venue/pitch) were already correctly RPC-gated
underneath and needed no change. Also fixed a related bug: the Conversation section's
"no send access" fallback showed Site-Admin-specific wording to Club Admin viewers who were
never eligible for that capability in the first place.

**Fixture Detail Venue/Pitch section live-verified end to end** (Chrome worked reliably this
round after some retries): navigated to a real fixture as Burnley Club Admin (previously
impossible), opened "Change venue / pitch," selected "Burnley RUFC Ground (Default)," saved,
confirmed it persisted with the real address displayed correctly.

**Messages built and live-verified end to end**: new `conversation-list.tsx` (pure presentation
layer over the exact same `getConversationSummaries`/`getClubConversationSummaries` data every
prior version used — no new table, no new RPC, no new message store). Filter tabs map directly
to real existing `kind` values; sort is a pure client-side re-sort. Created two pieces of REAL
conversation data via genuine flows (a real fixture request + real fixture messages between
Burnley and Rossendale) — no fake clubs seeded. Live-verified with real clicks: the unified list
rendered both rows correctly (club name, derived title, preview, status, time), the "Fixture
requests" filter correctly narrowed to one row, clicking through opened the real existing
conversation thread with actual content.

**Direct messaging**: confirmed already implemented (partner-club-scoped search, message-request/
accept flow) — not rebuilt, not re-verified live this specific pass.

**Honestly disclosed remaining gaps**: Sections 22-28 (Season Rollover/Competitions/Seasons
canonical-source spot-checks, CSV round-trip re-check, full role-by-role permissions audit) not
reached; the scheduling-group-request-summary fix from two rounds ago not independently
re-exercised live (no test data existed for it); the master Fixture Management table's PITCH
column doesn't surface venue-only state (minor, disclosed); no design-pipeline pass run on
Messages (reused every existing token/pattern, judged nothing new to review).

Verification: 783/783 regression (unchanged, confirms no regression), clean static checks. DB
reset once (honest count + clean bootstrap). Dev server/Mailpit confirmed reachable, left
running.

### Follow-up fork: Sections 22-28 closed out — RECONCILIATION PASS COMPLETE

- **Stable-ID / Competitions / Seasons**: confirmed Add Fixture's Competition dropdown is a live
  query against `competition_editions` (no hardcoded list), Season Rollover genuinely queries
  `seasons` directly (verified only, not touched, per the explicit instruction not to redesign
  it).
- **Import/Export**: confirmed the CSV schema (v3) already carries the full set the user asked
  for — fixture_id, rugby_code, season, home/away club+team identity, competition, pitch, venue,
  status, source, scores, notes — verified against a real fixture that these columns are
  genuinely populated, not blank.
- **Permissions**: live-proved server-side (not just read) — impersonated
  `test.parent@ovalball.local` via a real session and called `update_fixture_venue` directly;
  correctly rejected. Confirmed it reuses the pre-existing `internal.can_submit_fixture_result`
  boundary rather than inventing new logic.
- **Minor fix**: the master Fixture Management table's PITCH column now falls back to showing
  the venue name when a venue is set but no specific pitch is chosen (previously showed "—").
- **New minor bug found, not fixed, disclosed**: Club Admin's fixture search box submits to the
  Site Admin route on Enter, causing a silent redirect to `/dashboard` instead of filtering
  `/fixtures/management` in place.
- **Honestly disclosed remaining risks**: the scheduling-group-request-summary fix (from an
  earlier round) still has no live click-proof; a full role-by-role (Fixtures Secretary/Coach)
  re-audit across every surface touched this whole pass wasn't performed (only the
  highest-risk new surface was directly proven); no design pass run on this round's tiny fix.

Verification: 783/783 regression (unchanged — zero regressions introduced across the ENTIRE
6-round reconciliation pass), clean tsc/eslint(0 errors)/build/diff-check. DB reset twice
(honest count + final bootstrap), left clean. Dev server/Mailpit confirmed reachable, left
running.

## Club Admin / shared admin foundation pass (started 2026-09-03)

User moved temporarily from fixture feature work into identity propagation, Partner Clubs
invites, UI capitalisation, and a strengthened Lookup Administration architecture. First fork
handled the two items the coordinating session had already precisely pre-diagnosed.

**Identity/logo — corrected diagnosis**: NOT a caching bug as originally hypothesized. A proper
canonical `ClubAvatar` component (`components/club/club-avatar.tsx`) already existed and was
already correctly used by Messages, Partner Clubs, Fixture Detail, Dashboard, and the sidebar.
The real, much simpler gap: the Fixture Management master table never rendered any club logo at
all — not stale, just never wired in. Fixed with a batched `attachClubLogos()` query (no new
migration), wired into the shared `FixtureManagementView` so both Site Admin and Club Admin get
it. Calendar chips were audited but not fixed (a genuine space-constrained design decision, not
a quick wire-in — flagged as a remaining risk, not silently skipped).

**Season Rollover — confirmed correct, not a bug**: verified independently — exactly two real
seasons exist, today falls inside "26/27" so Calendar correctly shows it as current, Rollover's
own query deliberately looks for the season AFTER the current one and correctly finds none since
"27/28" doesn't exist yet. Both pages read the identical canonical `seasons` table. Fixed the
resulting confusing UX only: the empty state now names the actual current season and explains
what's missing, instead of a bare "No upcoming season yet."

**Explicitly NOT reached, disclosed as the majority of the instruction, not a minor gap**:
Partner Clubs invite-to-Ovalball system (token/email/reconciliation), the Club Directory map
(three pin states), partnership-request wiring, the UI capitalisation audit, Site Admin's
parent-view over club-level lookups, the managed-lookup-vs-controlled-enum classification
documentation, the broader dropdown audit, and lookup permissions extension. No code written for
any of these — each is genuinely substantial new work warranting its own dedicated pass.

Verification: 783/783 regression (unchanged — both changes were pure TS/React, no schema
changes), clean tsc/eslint/build/diff-check. DB reset once (honest count) + bootstrap. Dev
server/Mailpit confirmed reachable, left running. **No live browser verification this round** —
all proof was code/build-level.

### Partner Clubs: Invite to Ovalball + map + partnership requests — COMPLETE

New table `club_ovalball_invitations` (existing `club_partnerships` couldn't represent an
unclaimed club — both its FKs require an already-activated `clubs.id`). Idempotent via a
partial unique index; RLS scoped to `can_manage_club_fixtures`/Site Admin. Map's "Invite" action
wired in for not-yet-on-Ovalball pins (was previously a dead click for that state). Claim
reconciliation hooked into the existing `approve_club_claim` RPC — creates a `pending`
`club_partnerships` row (never auto-active, the new club still explicitly accepts), idempotent
via the same unique index.

**Real bug found and fixed**: the invite dialog lives inside a Leaflet marker popup; the action's
`revalidatePath("/partner-clubs")` raced with and destroyed the popup mid-render, silently
closing the dialog before the user saw the invite link — even though the invitation was created
correctly server-side. Removed the pointless revalidate call.

**Live-verified end to end** with two separate real magic-link logins: Burnley invited an
unclaimed club (real SQL-confirmed invitation row, link lands on the real signup wizard, never
auto-claims); Burnley requested partnership with an already-on-Ovalball club, logged in as that
club's own admin, approved it, confirmed both sides read the identical `club_partnerships` row.

**Honest gaps**: signup wizard doesn't pre-select the invited club from the link (reconciliation
still works, keyed on `directory_id` alone); no persistent "invitation sent" badge surviving
reload; real email delivery can't be tested locally (`dispatchEmailEvent` has no SMTP provider
configured in dev, by pre-existing design).

Verification: **791/791 regression** (783 baseline + 8 new tests), clean tsc/eslint(0 errors)/
build/diff-check. DB reset + bootstrap, left with realistic demo data (geocoded clubs, a real
pending invitation, a real active partnership from live testing). Dev server/Mailpit untouched.

### Ovie Phase 1 — AI rugby operations assistant — COMPLETE

New feature, no prior Ovie code existed anywhere (confirmed via full codebase + git history
search before starting). Built as a strictly one-directional pipeline: user message →
`lib/ovie/intent.ts` (the ONLY LLM touchpoint, Claude tool-use for structured extraction — never
free-text parsing for anything that becomes a database key) → typed `OvieIntent` →
`lib/ovie/orchestrator.ts`'s `applyOvieIntent()` (deterministic resolution against real domain
services, reusing `eligibleOppositionCanonicalTypes()`, the missing-team resolution chain, and
`fullTeamLabel()` rather than any parallel logic) → confirmation object → only on explicit
`confirm_send` → the existing `createFixtureRequest()` write path. No new insert path, no
service-role credentials given to the model, no new availability table (availability is derived
live from real `fixtures` data into a six-state model: AVAILABLE / PENDING_COMMITMENT / BOOKED /
TEAM_INACTIVE / TEAM_MISSING / UNCLAIMED_CLUB).

`lib/ovie/opponent-search.ts`'s `findSuitableOpponents()` is a standalone, independently-reusable
domain service (not Ovie-only, per the brief) — geographic bounding-box pre-filter before a real
haversine distance calculation against real `club_directory` coordinates (reusing the existing
geocoding infrastructure, never inventing coordinates), deterministic weighted scoring with
plain-English `reasons[]` the LLM narrates but never invents. Results are privacy-reduced by
construction (`SafeOpponentCandidate` — no raw fixture lists, no personal/contact data) before
anything reaches the model.

**Live-verified with three real accounts** via real magic-link logins, but PRECISELY: no
`ANTHROPIC_API_KEY` was configured, so the natural-language understanding step
(`extractOvieIntent()`) was never called — this was NOT a real free-text conversation with a
model. What was genuinely proven live: Burnley RUFC Club Admin's real, authenticated session
drove the entire DETERMINISTIC pipeline downstream of intent extraction (search → refine to
partners-only → widen radius → select → prepare → confirm) via a temporary, disclosed diagnostic
route that called `applyOvieIntent()` directly with hand-built `OvieIntent` values — the exact
typed objects a real model call would otherwise have produced — producing one real,
correctly-attributed fixture request (`source = 'ovie_assistant'`, `created_by` = the real user,
never "Ovie") confirmed identical in the live Fixture Requests page. `test.parent@ovalball.local`
(genuine view-only) was correctly blocked before any write path was reachable. The diagnostic
route was deleted before finishing (since `next/headers` genuinely can't run outside a request
scope, an isolated script can't exercise this DB-touching code any other way). See the
2026-09-03 Ovie Phase 2 section below for the precise DETERMINISTIC DOMAIN TESTED / MODEL INTENT
EXTRACTION TESTED / FULL MODEL-BACKED END-TO-END TESTED breakdown this imprecision prompted.

**Honest gap, closed by the coordinating session independently**: the fork could not run the full
historical regression suite (reported the script as inaccessible). The coordinating session ran
it directly: a bootstrap-still-live run showed 79 false failures (the well-documented dirty-state
artifact from data collisions, not real regressions), then a genuine `db reset --local` proved all
migrations — including Ovie's new `20260918000000_ovie_foundation.sql` — apply cleanly, and the
full suite came back **791/791 PASS, 0 FAIL, 0 raw errors**, exactly matching the pre-Ovie
baseline. Zero regressions introduced. Playground re-bootstrapped in the correct order
afterward (regression first, bootstrap after — the confirmed-correct sequence this session).

**Remaining honest gaps**: no live proof of actual natural-language understanding (no
`ANTHROPIC_API_KEY` configured in this local environment — the deterministic core downstream of
intent extraction is proven, the NL parsing step itself is not); mid-conversation date-change
recalculation and "someone different" ranking are implemented but only lightly exercised by the
one live conversation, not separately stress-tested; two pre-existing, unrelated SQL-fixture-
drift issues noted in the dirty-state run were not investigated (they vanished entirely on the
clean reset, so likely just more of the same dirty-state artifact, not real bugs — not confirmed
either way).

Final state: dev server and Mailpit both confirmed reachable after the reset. No commits, no
push, no remote Supabase.

### Club Admin foundation pass — final piece: Site Admin Lookup parent-view — COMPLETE

Closes out the Club Admin / shared admin foundation pass. Built `/admin/lookups`: Site Admin
searches by club, sees the exact same `venues`/`club_pitches` rows Club Admin's own
`/club/venues` manages (genuinely reused query pattern, not a duplicate). Write access gated by
a new `manage_global_lookups` capability, following the established narrow-grant pattern exactly
(off by default even for Full Site Admin); without it, a read-only render shows the same data.

**Two more real security gaps found and fixed while building this**: (1) `create_venue`/
`update_venue`/`set_venue_active`/`set_default_venue` used a blanket `internal.is_site_admin()`
check — ANY Site Admin, however narrow their actual granted capabilities, could already write to
any club's venues. Narrowed all four to the new capability. (2) The four pitch RPCs
(`create_club_pitch`/`rename_club_pitch`/`reorder_club_pitches`/`set_club_pitch_active`) are
`SECURITY DEFINER` and bypass RLS entirely — widening `club_pitches`' RLS alone would have left
pitch management unreachable from the new page while ALSO leaving the underlying over-broad
access unfixed. Widened all four RPCs directly.

**Lookup architecture classification documented** (as a migration header comment, co-located
with the schema it governs): (A) managed business lookups — Venues, Pitches (per-club),
Competitions (global, stays on its own page) — vs (B) controlled system enums that must stay in
code — permissions/roles, fixture/request/tournament lifecycle states, `canonical_team_types`,
`rugby_code`.

**UI capitalisation / dropdown audit**: bounded, honest, not exhaustive — checked the shared
nav-label constants and 7 directive-named surfaces' section labels (zero violations found,
already correctly Title Case), did not do a full page-by-page sweep of every surface. Disclosed
clearly, not rounded up to "audit complete."

**Live-verified**: logged in as Site Admin, confirmed `/admin/lookups` shows Burnley's real venue/
pitch records identically to Club Admin's own view, added/deactivated a venue live through the
browser, both worked end-to-end. `test.parent@ovalball.local` confirmed server-side rejected
(redirected before reaching the page; write RPCs and raw RLS separately proven rejected via the
automated test suite with a real impersonated JWT). **One honest gap**: a post-reset browser
re-check was attempted but blocked by Chrome tooling flakiness that didn't resolve after several
retries — the write path was genuinely proven live once pre-reset, and the post-reset data state
was independently confirmed via direct SQL, but nobody has clicked through the UI against the
exact final running DB state.

**Real bug found in the fork's own new test file, fixed**: a test scenario deactivated a venue
without clearing `is_default_home`, which — combined with a pre-existing DB constraint — silently
broke the playground bootstrap's own venue seed on every future reset-then-bootstrap cycle.
Fixed and re-verified with a second full cycle.

Verification: **805/805 regression** (791 baseline + 14 new tests), confirmed twice on genuine
clean resets. Clean tsc/eslint(0 errors)/build/diff-check. `manage_global_lookups` left granted
on `test.site.admin@ovalball.local` for immediate exploration (matching the existing
`manage_fixture_support` precedent on that account) — revoke via `/admin/site-admins` if unwanted.

## RECONCILIATION PASS COMPLETE (2026-09-03)

All three user-flagged critical bugs (home/away swap — including a subtle no-op bug that
silently misassigned edit authority — profile avatar propagation, club logo propagation) are
fixed and live-verified with real browser clicks. The venue/pitch system is fully built, seeded,
and integrated into Fixture Detail via a proper operational section — including fixing a
critical access bug where Club Admin couldn't reach Fixture Detail at all, making that new
section invisible to its actual audience. Messages is rebuilt as a pure presentation layer over
real existing conversation data (no new backend, no fake clubs) and live-verified. Direct
messaging was confirmed already working. The `/fixtures` vs `/fixtures/management` question was
investigated and resolved as NOT true duplication, with the one real gap fixed. Sections 22-28
(stable-ID, Seasons, Competitions, CSV, permissions) are verified. Regression held at 783/783
throughout — zero regressions introduced across the entire pass. Known remaining minor risks are
disclosed above rather than rounded up. See the coordinating session's final report to the user
for the complete section-by-section breakdown.

## PASS COMPLETE — 7 forks, ~4700 combined tool-uses, multi-hour unattended run

Both the original 49-section reconciliation pass and the superseding 75-section central
fixture-participant-resolution instruction are now fully addressed. See the coordinating
session's final consolidated report (delivered directly to the user) for the complete
PASS/PARTIAL/FAIL breakdown and remaining risks. No commits, no push, no remote Supabase at any
point in this pass.

## BLOCKED / NEEDS CLARIFICATION

None outstanding right now.

## How to resume verification

```
npx supabase db reset --local
bash <scratchpad>/run_regression.sh   # 761/761 as of the final checkpoint (2026-09-02) — report the real total if this changes, never chase this specific number
npx tsc --noEmit
npx eslint .
npx next build
git diff --check
```

No commit. No push. No deploy. No remote Supabase changes.

## Ovie Phase 1 — AI opponent-matching assistant — COMPLETE (build + live-verified), see final report for scope disclosure

Built as the fork dispatched for the user's "NEW FEATURE — OVIE PHASE 1" brief (an
AI rugby-fixture assistant: persistent "Ask Ovie" widget → structured intent via Claude
tool-use → deterministic opponent search/resolution against real domain data → confirmation
→ only-on-explicit-confirm write via the existing `createFixtureRequest()` path). Full detail
in the session's final consolidated report (delivered directly to the user). Summary here:

- **New files**: `lib/ovie/types.ts` (shared types + client-safe conversation state, kept
  import-free so the browser widget never pulls in server-only code), `lib/ovie/distance.ts`
  (haversine, unit-tested), `lib/ovie/actor-context.ts` (`SessionContext` → `OvieActorContext`
  reduction + `canActOnTeam()`), `lib/ovie/opponent-search.ts` (the deterministic
  `findSuitableOpponents()` domain service — eligibility via the existing
  `eligibleOppositionCanonicalTypes()`, 6-state availability from real `fixtures`/scheduling-group
  data, season resolved via the same canonical resolver Calendar/Rollover already use, privacy-
  reduced output only), `lib/ovie/intent.ts` (the ONLY LLM touchpoint — Claude tool-use,
  `claude-opus-5` per this session's own model-selection rule, honest `not_configured`
  degradation when `ANTHROPIC_API_KEY` is absent, which it is here), `lib/ovie/orchestrator.ts`
  (`runOvieTurn`/`applyOvieIntent` — the deterministic core is split out specifically so it can
  be driven by a hand-constructed intent without a live model call), `lib/ovie/actions.ts`
  (`sendOvieMessage` server action), `lib/ovie/distance.verify.ts` (a real, passing `npx tsx`
  check — this project has no JS test framework; this is the same workaround pattern an earlier
  fork used), `components/ovie/ask-ovie.tsx` (the persistent widget, mounted in
  `app/(app)/layout.tsx`), `supabase/migrations/20260918000000_ovie_foundation.sql` (adds
  `fixture_request_groups.source` — nullable, `ovie_assistant` the only allowed non-null value —
  applied via `db push`, not reset).
- **One shared-file edit**: `app/(app)/fixtures/new/actions.ts` gained an optional
  `source?: "ovie_assistant"` field on `CreateFixtureRequestInput`, threaded straight into the
  existing insert — Ovie writes through this exact function, never a parallel insert path.
- **Real bugs found and fixed during the build itself** (not left for regression): a
  `canonical_team_types.active` column name that's actually `is_active`; a null-unsafe season
  query that would have silently excluded any season with `pre_season_starts_on` left null
  (replaced with the real `resolveDefaultSeason()` from `lib/calendar/season-window.ts` instead
  of reinventing the boundary logic); a raw-substring team-name matcher that (a) never matched
  "U12s" against the stored "U12" label, (b) tied across every club a multi-club admin manages
  since club name wasn't part of the match, and (c) matched "men" inside "women's" as a literal
  substring — fixed by tokenizing to whole words and including the club name in the haystack.
- **Live-verified**, real browser, real magic-link logins, real local DB, no test API key needed
  for most of it: the widget renders and opens; a Burnley RUFC Club Admin sending a message gets
  the honest "Ovie isn't connected yet -- no ANTHROPIC_API_KEY is configured" degradation (proving
  the whole request path up to the LLM call); a genuinely `view_only`-permissioned account
  (`test.parent@ovalball.local`) gets the "I can help you look things up, but I'm not able to
  arrange fixtures from this account" block BEFORE any LLM call — proving the permission gate
  fires first, no key required to prove it. The deterministic core
  (search → refine → select → confirm → write) was proven with a temporary, disclosed,
  same-session-only diagnostic route (`app/api/ovie-debug-temp`, deleted before finishing) that
  called `applyOvieIntent()` directly with hand-built intents through the real authenticated
  session — `next/headers`'s `cookies()` genuinely cannot be exercised from a bare `tsx` script
  outside a request scope, confirmed by testing it directly, so this was the only way to prove
  the DB-touching logic short of building a real NL-parsing key. Produced one real
  `fixture_request_groups` row (`source = 'ovie_assistant'`, `created_by` = the real signed-in
  Burnley admin, not Ovie), confirmed identical in the real Fixture Requests page.
- **Regression**: a full `db reset --local` is blocked here by this session's own auto-mode
  classifier (correctly, per this repo's standing "preserve local playground data" instruction),
  and the local DB is already in bootstrapped-playground state (not a clean regression baseline)
  — `supabase/tests/playground_teams.sql`'s own header warns that running the full suite after
  playground bootstrap risks spurious duplicate-fixture failures. Ran the two most directly
  relevant test files against the live DB instead: `fixture_management.sql` (17/17 PASS, 0 FAIL)
  and `permission_matrix.sql` (22/24 PASS — 2 FAIL, both root-caused to pre-existing accumulated
  session state unrelated to this change: a duplicate `club_claims` row from repeated historical
  runs, and a real active Burnley↔Rossendale partnership from earlier legitimate Partner Clubs
  work that invalidates a hardcoded "no partnership yet" fixture assumption). `run_regression.sh`
  itself (confirmed via this file's own "How to resume verification" section above) lives only in
  a prior fork's own ephemeral scratchpad, never committed — not reconstructable this pass.
- **Not built this pass** (disclosed, not silently dropped): the natural-language parsing step
  itself was never live-exercised (no API key in this environment); a handful of the brief's more
  advanced conversational nuances (mid-conversation date changes forcing fresh recalculation,
  "someone different" ranking) are implemented in the orchestrator but not separately live-tested
  beyond what the one real conversation above exercised.

No commit. No push. No deploy. No remote Supabase changes.

## 2026-09-03 — Live-verification session: two user-reported bugs found and fixed

While browser-testing recent work (per the user's "run through the changes from my last
instruction and browser test them through chrome" / "yes keep trying"), the user interrupted
mid-flow with two real live bugs, found on the marketing homepage's account control:

1. **"Open Ovalball" sometimes did nothing when clicked.** Root cause: `account-control.tsx` and
   `context-switcher.tsx` composed `DropdownMenuItem render={<Link href=... />}` — Base UI's
   generic `Menu.Item`, whose `closeOnClick` default fires an async menu-close on every click,
   composed onto a Next.js `Link`. Base UI ships a purpose-built `Menu.LinkItem` specifically for
   this composition (defaults `closeOnClick` to `false`, unlike `Item`) precisely because the
   generic-Item-plus-Link pattern is a known race. Fixed by adding `DropdownMenuLinkItem` to
   `components/ui/dropdown-menu.tsx` (wraps `MenuPrimitive.LinkItem`, `closeOnClick` explicit) and
   switching every genuine Link-composed menu item (`account-control.tsx`'s three items,
   `context-switcher.tsx`'s "Account settings") to it. Live-verified in real Chrome: reproduced the
   dropdown open + click flow repeatedly post-fix, always landed on `/dashboard`.
   `messages-popover.tsx`'s `DropdownMenuItem render={<ConversationRow/>}` is a structurally
   different composition (a full custom row component whose own root is already a `Link`, not a
   bare `Link` passed as `render`) — left untouched, not reported, out of scope.
2. **Login redirected through `/welcome` instead of straight to the dashboard.** The user wants
   sign-in to land directly on "their club's homepage, or Site Admin homepage depending on what
   you've logged in as" — i.e. `/dashboard`. Root cause: `lib/auth/check-account.ts`'s
   `sendSignInLinkIfAccountExists` (the only entry point `/login` uses) hardcoded
   `emailRedirectTo=...&next=/welcome` for every sign-in, including an already-approved existing
   user — `/welcome` itself already immediately redirects an approved/Site-Admin user to
   `/dashboard` (`app/welcome/page.tsx`), so this was purely a wasted extra hop. Fixed by changing
   `next=/welcome` to `next=/dashboard` in `check-account.ts` only — **not**
   `app/signup/submit-signup.ts`, which correctly still sends brand-new signups to `/welcome`
   (the pending-review landing page). Safe for a still-pending user too:
   `app/(app)/layout.tsx` already redirects `/dashboard` back to `/welcome` when
   `!ctx.isSiteAdmin && ctx.clubMemberships.length === 0`, so a pending user just bounces through
   the other direction instead. Live-verified: fresh magic-link sign-in as
   `test.burnley.admin@ovalball.local` landed directly on `/dashboard`, confirmed via the
   Mailpit-sourced link's own `redirect_to` containing `next%3D%2Fdashboard`.

## 2026-09-03 — Lookup Administration: Venues & Pitches as independent, related records

New feature build from the user's own spec + reference screenshot: "Venues and Pitches are
independent lookup records, related to each other, and together form the single source of truth
used by Fixture Administration."

- **Investigation first** (per the user's explicit request): the backend already modeled this
  correctly — `venues`/`club_pitches` are separate tables, `club_pitches.venue_id` is a nullable
  FK (Venue 1 -> many Pitches, zero-or-one on the pitch side), every RPC is soft-delete-only. Add
  Fixture (`admin/fixtures/add-fixture-dialog.tsx`) and the Fixture Detail Venue/Pitch editor
  (`venue-pitch-section.tsx`) already read from these same tables with venue-filtered pitch
  options — no schema or Fixture Admin changes were needed at all, confirmed by inspection and
  then by live testing. The actual gap was entirely in Lookup Administration's own UI: pitch
  management was split across two disconnected surfaces — `club-pitches-section.tsx` on `/club`
  (full CRUD, no venue field) and `venues-section.tsx` on `/club/venues` (venue CRUD, but pitch
  reassignment only worked for already-unassigned pitches, no create/edit/deactivate for pitches
  at all).
- **Rebuilt** `app/(app)/club/venues/venues-section.tsx` as a tabbed Venues/Pitches component
  (matching the reference screenshot's tab pattern, not copied blindly): the Pitches tab is now
  the one authoritative list -- every pitch, assigned or not, each with its own Assigned Venue
  `<select>` that reassigns via the pre-existing `setClubPitchVenue` action (already supported
  reassigning an already-assigned pitch, not just unassigned ones -- no backend change needed).
  Kept pitch reorder (up/down arrows) rather than dropping it, since removing a working capability
  the user never asked to remove would have been a silent regression. Added a `readOnly` prop so
  the SAME component serves both Club Admin's `/club/venues` (always full write) and Site Admin's
  `/admin/lookups` (gated by `manage_global_lookups`) -- deleted the old separate `ReadOnlyVenues`
  duplicate-rendering function from `admin/lookups/page.tsx` entirely.
- **Live address lookup**: generalized the existing `AddressLookupField` (previously hardcoded to
  Site Admin's club_directory editor, importing its `lookupAddress` action directly) into
  `components/address/address-lookup-field.tsx` with an injected `search` prop, so it's genuinely
  reusable rather than a parallel copy. Added `lookupVenueAddress` to `club/actions.ts` (any
  authenticated user -- the real write boundary is already enforced by `create_venue`/
  `update_venue` at save time, not the lookup itself) and wired it into both the venue Add and Edit
  forms. Picked address/town/county concatenate into the venue's existing single `address` column;
  no schema change needed.
- **Removed the duplicate pitch surface**: deleted `app/(app)/club/club-pitches-section.tsx` and
  its usage/query in `app/(app)/club/page.tsx`, replaced with a pointer link to `/club/venues`
  ("Manage venues & pitches under Lookup Administration").
- **Live-verified end-to-end in real Chrome** as `test.burnley.admin@ovalball.local`: reassigned
  an already-assigned pitch (Pitch 1) to a different venue -- confirmed the Venues tab's chips
  updated in sync immediately. Confirmed address lookup calls through correctly (honest
  "not connected in this environment" message, same graceful-degradation pattern as everywhere
  else -- no `GETADDRESS_API_KEY` locally). As `test.site.admin@ovalball.local`, confirmed the
  Fixture Admin "Add fixture" dialog's Venue dropdown lists the real venues and its Pitch dropdown
  live-filters to exactly the pitches now assigned to whichever venue is selected (proved this by
  switching venues in the open dialog via JS-triggered `<select>` change and reading the resulting
  option list twice). Confirmed a **historical** fixture (created before the reassignment) kept
  showing its own originally-saved venue/pitch unchanged after the reassignment -- fixtures store
  their own venue reference, never retroactively rewritten by a later lookup-record change.
  Confirmed the read-only Site Admin path (`test.plain.siteadmin@ovalball.local`, no
  `manage_global_lookups`) renders both tabs with all write controls correctly hidden.
- **Known minor pre-existing quirk, not introduced by this change**: if a pitch already saved on a
  historical fixture is later reassigned to a *different* venue than the one saved on that
  fixture, `venue-pitch-section.tsx`'s "Change venue / pitch" edit dialog's Pitch `<select>`
  silently shows "TBC / Not assigned" (no matching `<option>` for the stale pitch id under the
  currently-selected venue) even though the underlying `pitchValue` React state still holds the
  old pitch id. Cancelling avoids any write; clicking Save without touching the field would
  harmlessly re-save the same unchanged pitch. Did not fix -- this logic pre-dates this pass
  entirely and touching it was outside what was asked; flagged here for whoever picks it up next.
- **Environment note for future sessions**: `npx supabase db query --local <SQL>` reported
  successful `UPDATE` statements (and even echoed back the updated row immediately after) against
  test data, but those writes were **not visible to the running dev server / Chrome session**
  moments later -- repeated re-querying via the same CLI command showed the update had silently
  not taken effect from the app's point of view. Reverting the two `club_pitches.venue_id` test
  mutations made during this pass had to be done the same way the real mutations were made -- through
  the actual running app's own UI (confirmed persistent via a fresh page reload afterward) -- not
  via this CLI query tool. Do not trust `supabase db query --local` writes to reflect in the live
  app in this project; use the app's own UI (or its server actions) to make or verify any test data
  change that needs to actually persist.

No commit. No push. No deploy. No remote Supabase changes.

Also closed out the one remaining gap flagged by prior forks: live-verified `/admin/lookups`
(Site Admin Lookup Administration) end-to-end as `test.site.admin@ovalball.local` against the
current database state. The GET-form club search (`?q=`) works correctly (confirmed it needs a
real form submit, not live-as-you-type — that's the page's actual design, not a bug). Selected
Burnley RUFC and confirmed the venues/pitches shown are the exact same records Club Admin's own
`/club/venues` manages (same names, same pitch assignments). Exercised a full write cycle:
created "Site Admin Live Verify Ground" via the `manage_global_lookups`-gated Add venue form,
confirmed it appeared in the list, then deactivated it — confirmed it moved out of the active list
into "Show deactivated venues (1)". No further gaps remain from the prior Venue/Lookup
Administration or Club Admin foundation passes.

No commit. No push. No deploy. No remote Supabase changes.

## 2026-09-03 — Ovie security/architecture hardening pass + Phase 2 (Intelligent Opponent Matchmaking)

Per the user's explicit "BEFORE STARTING OVIE PHASE 2" security correction message: audited Phase
1 against 17 numbered architecture requirements, fixed the two real gaps found, added permanent
automated tests, then built Phase 2 on top. **Do not redesign Phase 1** was honored — almost
everything the review asked to CONFIRM was already correctly built; only two real gaps existed.

### What was audited and found already correct (not touched, just verified)
Privacy reduction happens inside `opponent-search.ts`/`rank-candidates.ts` before anything reaches
the model (never DB rows → model); `SafeOpponentCandidate` is the only shape that ever leaves the
domain service (no staff/player/message data anywhere in its call graph); the six-state
availability enum already matches the spec (UNCLAIMED_CLUB's reason text is verbatim "not yet on
Ovalball -- availability cannot be confirmed", never "Free"); player attendance is never conflated
with fixture availability (`resolveAvailability` reads only `fixtures`/`fixture_requests`/
`scheduling_group_members`); canonical IDs are re-validated server-side at the actual write
boundary (`confirm_send` re-resolves `activatedClub`/default venue fresh, re-checks
`canActOnTeam()`, never trusts an earlier turn's cached state); Ovie introduces zero new
SECURITY DEFINER functions or RPCs (Phase 1's only migration adds one nullable provenance column);
a narrow Site Admin gets exactly the same reach through Ovie as `internal.is_site_admin()` already
grants everywhere else in the product (no new escalation path); `createFixtureRequest`'s real
write path is an ordinary RLS-enforced insert, not `SECURITY DEFINER`, so even a bug in Ovie's own
`canActOnTeam()` check would still be caught at the database boundary.

### Real gaps found and fixed
1. **Blanket all-or-nothing permission gate** (`runOvieTurn`'s `if (actor.viewOnly) return
   blocked` before even calling the model) — blocked view-only actors from harmless intents
   (narrate/clarify/cancel carry no data of their own) and was Ovie's ONLY authorization boundary
   in practice, exactly the anti-pattern the review warned about. Removed; authorization is now
   applied per-skill, at the point each skill is invoked (documented as a permanent architecture
   comment in `orchestrator.ts`) — `resolveOwnTeam()`'s existing scoped-query naturally reduces to
   "no matching team" for a view-only actor (their `manageableClubIds`/`scopedTeamIds` are
   provably always empty, see `isViewOnlyEverywhere()`), and `canActOnTeam()` is re-checked at
   every write-adjacent step regardless. Live-verified: `test.parent@ovalball.local` now reaches
   the SAME `not_configured` response any other user gets (proving the request reaches the
   model-call attempt), instead of the old distinct blanket-block message — confirmed via the
   real widget in Chrome, then confirmed at the deterministic-core level via the diagnostic route
   (view-only actor + hand-built `search_opponents` intent → correctly-scoped rejection, zero
   candidates, no team resolved).
2. **Report imprecision**: "a real end-to-end conversation" language (this file and the
   overnight-report.html artifact) overclaimed real NL understanding when no `ANTHROPIC_API_KEY`
   was ever configured — corrected above and in the final report to the user. The deterministic
   core downstream of intent extraction was genuinely proven; free-text language understanding was
   not.

### Phase 2 — Intelligent Opponent Matchmaking, built on the unchanged Phase 1 architecture
- **Testability refactor** (the "usable independently of Ovie" requirement, Section 2):
  `findSuitableOpponents()` now takes an injected Supabase client instead of constructing its own
  — any future caller (Fixture Management, Calendar, Tournament invitations) can now use it
  outside Ovie's own request-scoped call site. Its actual eligibility/exclusion/scoring logic was
  extracted into a new pure function, `rankCandidates()` (`lib/ovie/rank-candidates.ts`) — the only
  file in the whole feature with zero `server-only`-importing dependencies, specifically so it can
  be exercised by a plain `npx tsx` script with hand-built candidate facts, no database or request
  scope needed. `findSuitableOpponents()` itself is unchanged behaviourally; this is a pure
  extraction, not a redesign.
- **`canActOnTeam()` split** into its own file (`team-authorization.ts`) for the same reason —
  `actor-context.ts` pulls in `server-only` transitively via `session-context.ts`, which made this
  exact function untestable in Phase 1 (documented as a known gap in `distance.verify.ts`'s own
  comment). `actor-context.ts` re-exports it, so no existing import site changed.
- **New automated tests** (all genuinely run, not just written):
  - `lib/ovie/team-authorization.verify.ts` — 8/8 PASS. Covers actor scenarios A (Club Admin,
    club-wide, own club only), B (team-scoped Coach, own team only, not a sibling team), D
    (Parent/Player, never any team), E (any Site Admin, matching product-wide `is_site_admin()`
    reach, not a new Ovie-specific grant — documented, not a live capability lookup).
  - `lib/ovie/opponent-search.test-scenario.ts` — 14/14 PASS. Runs Section 28's exact TEST A
    scenario (Rossendale 8mi/partner/1 meeting, Candidate B 12mi/0 meetings, Candidate C
    6mi/BOOKED, Candidate D 15mi/2 meetings, Candidate E 18mi/unclaimed) against the real
    `rankCandidates()` function. Confirms: exactly Rossendale+B qualify in the right order; C
    excluded (booked); D excluded (>=2 meetings); E excluded by default, and when
    `includeUnclaimed` is set, appears as `UNCLAIMED_CLUB` — never `AVAILABLE` — ranked below every
    claimed+available candidate; partner-only filter narrows to exactly Rossendale.
  - `supabase/tests/ovie_security.sql` — 4/4 PASS against the real local DB (added to
    `run_regression.sh`'s FILES array). New, Ovie-named coverage (not a re-run of
    `permission_matrix.sql`/`team_scoped_fixture_requests.sql`'s existing generic coverage): a
    genuine view-only Parent/Player is blocked from `fixture_request_groups` insert attempted
    DIRECTLY (bypassing the UI/Ovie/model entirely, proving the boundary is the database, not
    Ovie's own TypeScript); a team-scoped U12 Coach can create a request for their own team but is
    blocked from a sibling U13 team at the same club they have no scope over; a private
    `fixture_messages` row stays invisible to the other club's view-only Parent, proving the open
    reads Ovie relies on (`fixtures`/`venues`/`club_pitches`, all `using (true)` by deliberate
    design) do not extend to sensitive tables Ovie never queries anyway. Narrow-vs-Full Site Admin
    escalation (E) is documented as out-of-scope-for-a-new-test in the file itself — Ovie adds no
    new capability check of its own for a narrow Site Admin to escalate through.
- **Feature work**:
  - **Default venue resolution**: `prepare_fixture_request` now resolves the requesting club's own
    default venue (`venues.is_default_home`) for a Home fixture — never guessed, re-resolved fresh
    again at `confirm_send`'s actual write boundary (never trusts the draft's cached id from an
    earlier turn), and threads through to `createFixtureRequest`'s existing `venueId` field. Live
    -verified against real data: a hand-built confirmation-card call correctly resolved "Burnley
    RUFC Ground" (the same default venue built in the Venues & Pitches pass earlier this session).
  - **Explainable results** (Section 13): a new `explainTopMatch()` produces the "X looks the
    strongest match ... nearby, already connected as a Partner, available in Ovalball, only N
    meetings this season" narrative sentence ahead of the plain numbered list — built entirely
    from the same safe fields the list already uses, never the raw `score`.
  - **Actionable empty-results** (Section 22): replaced the generic "want me to widen the search?"
    with specific, concrete offers (wider radius / include not-yet-on-Ovalball / include inactive
    team) tailored to what the current search hasn't already tried.
  - **Widget UI** (`ask-ovie.tsx`): candidate cards (distance/availability/partnership/meetings,
    "Best match" tag on the top-ranked result, a "Request fixture" button that reuses the exact
    same natural-language `select_candidate` pipeline — no parallel selection path), a
    confirmation card with Send/Cancel buttons (Send sends the literal message "Yes, send it.",
    Cancel sends "Cancel that." — still the one and only path through `confirm_send`, never a
    separate write trigger), and rotating activity-feedback text ("Checking nearby clubs…",
    "Checking availability…", "Comparing this season's fixtures…") while a turn is pending. No
    "View Club" button was added — there is no existing route that safely shows an arbitrary
    (possibly non-partner, possibly unclaimed) `club_directory` entry; adding one was out of scope.
- **Everything else in the Phase 2 brief was already correctly built in Phase 1** and is
  unchanged: canonical IDs carried forward through `select_candidate` (never re-resolved by
  display name), season-aware matching via the same canonical `resolveDefaultSeason()` every other
  surface uses, stable team identity via `canonical_team_type_id` (not display-name string
  matching), the previous-meeting exclusion rule (future confirmed fixtures count,
  cancelled/rejected never do — rejection lives on `fixture_requests`, which never produces a
  `fixtures` row), scheduling-group-aware availability, geographic pre-filter + batched queries
  (no N+1), "someone different" priority already correctly weighted (fewer meetings scores
  higher), read/write permission separation already correctly split at `resolveOwnTeam`/
  `canActOnTeam` (search never implies write authority).

### Honest test-status breakdown (per the user's explicit Section 16 requirement)
- **DETERMINISTIC DOMAIN TESTED: PASS** — `opponent-search.test-scenario.ts` (14/14) proves
  eligibility/availability-exclusion/meeting-exclusion/unclaimed-handling/scoring exactly matches
  TEST A. `ovie_security.sql` (4/4) proves the RLS boundary. `team-authorization.verify.ts` (8/8)
  proves the permission-decision logic.
- **MODEL INTENT EXTRACTION TESTED: NOT DONE** — no `ANTHROPIC_API_KEY` configured in this
  environment; `extractOvieIntent()` has never been called with a real message.
- **FULL MODEL-BACKED END-TO-END TESTED: NOT DONE** — same reason. A live real-conversation proof
  (the exact flow Section 34 asks for: search → "Only partners." → "Actually within 30 miles." →
  "Rossendale, 11am at ours." → Send) requires a real model call and has never been performed.
  Everything downstream of where that call would happen (deterministic search, ranking,
  refinement-merging into existing criteria, candidate selection, venue resolution, confirmation,
  write) was proven instead, either via the automated tests above or via the same temporary,
  disclosed, deleted-before-finishing diagnostic-route technique Phase 1 established (hand-built
  `OvieIntent` values driving `applyOvieIntent()` through a real authenticated session) — confirmed
  live: a real view-only rejection, a real empty-results reply with the new specific refinement
  offers, and a real confirmation card correctly resolving "Burnley RUFC Ground" as the default
  venue. No real candidate list was seen live end-to-end for Burnley specifically, because
  `club_directory.geocode_status` is `'pending'` for all 1,423 union rows in the current
  playground state (a pre-existing environmental gap unrelated to this pass — the one-time
  geocoding backfill this app already has, `runGeocodingBackfillAction()` on `/admin/clubs`, was
  never (re-)run against the current playground data since whichever reset most recently cleared
  it). Not fixed here — running it against all 1,423 real UK postcodes via the free postcodes.io
  API was judged disproportionate to what this pass needed to prove, given the exact same
  ranking/eligibility logic was already proven correct against hand-built realistic distances via
  the TEST A automated test. Flagged as a genuine, easy, one-click fix (the existing Site Admin
  geocoding backfill button) for whoever next has time for a full live browser walk-through.

No commit. No push. No deploy. No remote Supabase changes. Playground data preserved (the two
`club_pitches.venue_id` mutations made while re-verifying the Venues & Pitches feature earlier
were reverted through the real app UI, confirmed via a fresh reload).
