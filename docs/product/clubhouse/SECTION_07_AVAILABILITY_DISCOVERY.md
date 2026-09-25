# Section 7 — Find Clubs Free on Certain Days / Availability Discovery

## PURPOSE

Answer "who has a viable date?" on top of Section 6's "who could we play?" — for up to six chosen
dates, tell a team which compatible PARTNER clubs are genuinely free, genuinely busy, or genuinely
unknown, without ever fabricating a positive "available" claim for anyone but the team's own calendar.
Close the real, previously-shipped defect this creates the occasion to find: `team_scheduling_availability`
(CA-M11.4) returned `'available'` for a partner's day whenever nothing matched, which is exactly the
"EMPTY CALENDAR != AVAILABLE" claim the directive names as the one thing this section must never do.
Also close the Section 5 team-context gap for this same function, and consolidate the old Compare
Calendars route into this one canonical discovery surface.

## HEAD VERIFICATION

Expected `9251684`. Actual HEAD at the start of this section matched exactly.

## BEFORE STATE

`team_scheduling_availability(p_viewer_team_id, p_target_team_id, p_from, p_to)` (CA-M11.4,
`20270552000000_when_can_these_two_teams_play.sql`) already existed and already backed the real
`/fixtures/new` composer (`packages/contracts/src/fixtures/availability.ts`, `AvailabilityPanel` on web,
`availability-calendar.tsx` on native). It returns one row per day via `generate_series`, with a
5-state model: `available|fixture|training|club_event|request_pending`. Its own authority check was
`internal.can_manage_team(p_viewer_team_id) OR internal.can_manage_club_fixtures(v_viewer_club_id)` —
ONLY the caller's own side, with **zero relationship check to `p_target_team_id`**. `get_partner_team_availability`
(older, fixtures-only, club-scope-only, partners-only) backed the old `/clubhouse/[clubId]` Compare
Calendars page and rendered every non-fixture day as "Available — click to request."

## SOURCE AUDIT

Read `team_scheduling_availability`'s full body before touching it, rather than assuming its shape from
the composer's own rendering. Two findings, both genuine and both closed here:

1. **Authority gap**: any team manager could call it naming ANY other team as `p_target_team_id` and get
   that team's full day-by-day fixture/training/club_event/pending-request detail back — no partnership,
   no compatibility, no relationship of any kind required. `find_fixture_candidates.sql`'s own X-series
   proved a crafted cross-club call is refused for the batched Section 6 function; this same discipline
   was never applied here.
2. **Semantic defect**: the `else 'available'` branch applied unconditionally, including for the
   non-viewer (opponent) side. `partnerLabel()` on both clients rendered `status === "available"` as the
   literal word "Available" for a day about which the function had learned nothing at all. This is
   the exact shipped instance of the defect this section exists to prevent — found while writing this
   section's own SQL test (`C4`), not by inspection.

`get_partner_team_availability` was re-audited rather than assumed safe to leave alone: its declared
consumer in the perimeter manifest (`app/(app)/partner-clubs/[clubId]/actions.ts`) had already stopped
existing — stale drift unrelated to this section, fixed alongside (see MANIFEST below) rather than left
to mislead the next reader.

## AVAILABILITY SEMANTICS

The directive's own rule, enforced literally: **EMPTY CALENDAR != AVAILABLE. NO EVENT != AVAILABLE. NO
KNOWN CLASH != CONFIRMED FREE.** No invented "confirmed available" state exists anywhere in the domain —
a team can truthfully say "we are available" only about **itself** (`OWN2` in `availability_discovery.sql`
proves this is still allowed for the caller's own side). For any other team, absence of a known clash is
reported as exactly that: `no_known_clash`, never `available`. The full server vocabulary is now
`available | no_known_clash | busy | request_pending`, with `fixture | training | club_event` retained
only for the caller's own side (unchanged) and coarsened to `busy` for a cross-team read so the specific
kind of commitment is never leaked to an opponent (privacy rule, below). The client-facing discovery
vocabulary (`find-fixture-availability.ts`) is `no_known_clash | busy | tentative | unknown` — `tentative`
distinguishes a pending fixture request from a firm commitment; `unknown` is reserved for a candidate
that is compatible but not a confirmed partner, where the server is never even asked.

## AUTHORITY

Both functions authorise the caller's OWN side exactly as before — own-team behaviour is unchanged, not
rewritten, so nothing that already worked for the composer regresses. What is new is the CROSS-TEAM gate:
a non-own target team is only ever read if (a) `internal.identities_can_play_fixture` says the two teams'
identities are compatible, AND (b) an `active` `club_partnerships` row exists between their two clubs.
This mirrors `get_partner_team_availability`'s existing "partners only" precedent deliberately, rather
than broadening to "every compatible club" — Section 6 already shows every compatible club regardless of
partnership; Section 7 only ever discloses a CALENDAR to an actual partner. `find_fixture_candidate_availability`
authorises identically to Section 6's `find_fixture_candidate_teams` (same `internal.can('fixture.request.create'|
'fixture.fixture.create', 'team', ...)` check, same textual shape, deliberately) and only ever returns
rows for candidates that pass both the compatibility and partnership gates — confirmed by `X1`/`X2`/`B2`/`B3`.

## TEAM-CONTEXT GAP

Closes CLEANLY for the composer path: `team_scheduling_availability`'s authority check was never
club-scope-only to begin with (`can_manage_team` already covers a team-context caller), so no separate
Section-5-style RPC was needed here. What Section 7 does close is the *matrix's own* team-context read —
`readClubhouseMarkers`'s `partnershipStatus` (Section 5's `get_team_club_partnerships` path) is the thing
`buildFindFixtureAvailability` gates on, and that was already fixed in Section 5. A genuine, SEPARATE
defect was found and fixed in `map-read-model.ts` while live-proving this section (see LIVE PROOF): a
team-context viewer with `viewerClubId = null` fell through `buildPartnershipIndex`/`resolvePartnershipStatus`'s
`if (!viewerClubId ...) return "unknown"` guard regardless of whether Section 5's team-partnership read
had already supplied real, trusted rows — closed by treating `holdsPartnerAuthority` as the trust signal
throughout, rather than re-testing `viewerClubId` a second time downstream of the check that already
decided it. See MANIFEST/DEFERRED for scope of this fix.

## PARTNERSHIP PRIVACY

Never widened. A non-partner compatible club is `unknown` on every date, unconditionally — the server
is not even called for it (`buildFindFixtureAvailability` filters by `partnershipStatus === "active"`
before ever building the request). Live-proved directly: before any partnership existed between Ovalball
UAT RUFC and Preston Grasshoppers RFC, the matrix read "Unknown" on all three chosen dates for both of
Preston's compatible teams — correct, not a bug (see LIVE PROOF).

## BLOCKING RULES

### FIXTURES

`fixtures` where `status <> 'Cancelled'`. Own side: exposed by category (`fixture`). Cross side: coarsened
to `busy`.

### COMPETITION MATCHES

New blocking source, closing a genuine timing gap: `internal.project_competition_match` only creates a
`fixtures` row once `verification_state NOT IN ('awaiting','change_requested','declined')` AND
`status NOT IN ('draft','cancelled','postponed','change_requested')` AND `match_date IS NOT NULL` — so a
real, dated, issued competition commitment with `verification_state = 'awaiting'` has **no** Fixture row
yet. `competition_matches` (status not in cancelled/draft/postponed) is now queried directly, excluding
any match `competition_match_fixtures` already links to an existing Fixture (avoids double-counting once
the match IS projected). Proved live by SQL (`SETUP`, `C5`, `B7`): a match in exactly this awaiting state
is detected as `busy` with no Fixture row present.

### TRAINING

`training_sessions` where `status <> 'CANCELLED'`, filtered by `session_date` — not `occurrence_date`,
which is `NULL` for every manually-created session in the local database (`source = 'MANUAL'`), confirmed
empirically rather than assumed. Own side: `training`. Cross side: `busy`. Live-proved via the real
in-app "Schedule Training" flow (see LIVE PROOF), not only by SQL.

### EVENTS

`club_events`, club-wide or scoped to the target team via `club_event_teams`. Own side: `club_event`.
Cross side: `busy`.

### PENDING REQUESTS

`fixture_requests` where `status IN ('sent','counter_proposed')`, date = `coalesce(countered_date,
proposed_date)`. Never coarsened to `busy` — stays `request_pending` on both sides, distinct from a firm
commitment, matching the composer's own existing distinction.

## DATE MODEL

Day-level only, 1–6 dates per search, exactly the directive's range — `find_fixture_candidate_availability`
refuses 0 dates (`A2`) and more than 6 (`A3`) server-side, never trusting a client-side cap alone. Time
windows are explicitly deferred (Section 8/9's job, per the directive).

## MULTI-DATE UX

Both clients replace the old single-date field with a chip list (`dedupeDates`, capped and sorted, max
6) plus quick-date helpers built on `nextWeekdayDates(fromIso, isoWeekday, count)` — "Next Saturday",
"Next 3 Saturdays", "Next 4 Sundays" on web; the same three on native. Dates fetch availability in one
batched round trip (`getFindFixtureAvailability`/`readFindFixtureCandidateAvailability`), fired only once
`teamId && dates.length > 0`, entirely separate from the marker/candidate fetch so changing dates never
re-fetches the network population.

## CANONICAL READ MODEL

`packages/contracts/src/clubhouse/find-fixture-availability.ts`: `buildFindFixtureAvailability(candidates,
dates, rows)` is pure — it never calls the network itself, is exhaustively unit-tested
(`find_fixture_availability.test.mts`), and is the ONLY place that decides `unknown` vs. a real state.
`readFindFixtureCandidateAvailability` is the one I/O entry point, consumed identically by both clients
via `@ovalball/contracts/clubhouse`, mirroring Section 6's own established pattern exactly.

## NATIVE UX

`find-fixture.tsx`: date chips with quick-date buttons; `CandidateCard` renders one state chip per date,
per compatible team; only `state !== "busy"` is selectable, so a genuinely blocked date can be seen but
not chosen. `selectCandidate` carries an optional `chosenDate` through to the composer handoff.

## WEB UX

`find-fixture-client.tsx`: the same chip/quick-date UX; List mode renders a real HTML `<table>`
(`AvailabilityMatrix`, sticky first column, one row per compatible team, one column per date) once any
date is chosen, replacing the plain card list for that view; Map mode's popup gained the same
date-awareness. `sort=most_clear_dates` ranks candidates by `countNoKnownClashDates`.

## COMPARE CALENDAR CONSOLIDATION

`app/(app)/clubhouse/[clubId]/page.tsx` is now a pure redirect into `/clubhouse/find-fixture` with the
opponent preselected via `opponentDirectoryId`/`opponentClubId` — never a second scheduling surface.
"Both teams preselected" was never possible honestly (the old route never captured the CALLER's own
team), so Find a Fixture's existing team-selection step is where that question is now asked, once, the
same way every other Clubhouse entry point already asks it. The dead files it exclusively used
(`app/(app)/clubhouse/[clubId]/actions.ts`, `partner-availability.tsx`) were deleted — confirmed orphaned
by grep before removal, no other consumer existed.

## MAP INTEGRATION

Reuses Section 6's map/list population and popup unchanged; the popup gained date-awareness only when
dates are chosen, never a second marker source.

## PRIVACY

The specific kind of commitment (fixture vs. training vs. club event vs. which opponent) is never
disclosed cross-team — only `busy`/`request_pending`/`no_known_clash`. This is enforced in the SQL
itself (the coarsening `case` branches), not left to client-side hiding, and proved live: a genuine
training session created for Preston's Under 12 Boys showed as `busy` — never "training", never a time,
never a location.

## SAFEGUARDING

No participant-level or player-level detail is ever returned by either function — both operate at
team/date granularity only, unchanged from the composer's own existing scope.

## PERFORMANCE

`find_fixture_candidate_availability` is one batched call per team/date-set selection, scanning
compatible+partnered candidates server-side rather than one round trip per candidate — the same shape
Section 6 established for `find_fixture_candidate_teams`.

## TESTS

- `supabase/tests/availability_discovery.sql` (22 assertions, `CANONICAL_GATE`): own-team unchanged
  (`OWN1`/`OWN2`), incompatible/non-partner refusal (`X1`/`X2`), all five blocking-source categories
  correctly coarsened or preserved (`C1`–`C5`), the batched search's partner-only/compatible-only
  boundary and all five sources again at batch scope (`B1`–`B7`), authority (`A1`/`A1b`/`A2`/`A3`), and
  the exact minimal return shape (`P1`).
- `supabase/tests/team_scheduling_availability.sql` (existing CA-M11.4 suite, corrected in place, 15
  assertions): the pre-existing test itself asserted the vulnerable behaviour as correct (its own comment
  said the cross-club read was "the whole point"); rewritten to add a real partnership, a non-partnered
  compatible Club C, own-team proof (`OWN1`/`OWN2`), and refusal proof (`X1`/`X2`), with `C1`–`C5`'s
  expected statuses corrected from the old `available`/silent-pass to `busy`/`no_known_clash`.
- `supabase/tests/js/find_fixture_availability.test.mts` (9 assertions): `buildFindFixtureAvailability`
  purity, the non-partner-never-consulted guarantee, one row per compatible team, date ordering;
  `countNoKnownClashDates`.
- `supabase/tests/js/fixture_availability_ca11_4.test.mts` (existing, corrected): every `partner:
  "available"` good-option fixture changed to `partner: "no_known_clash"`; new assertions for the
  `busy`/`no_known_clash` label mapping.
- `supabase/tests/js/find_fixture.test.mts` (+4 assertions, now 22): `nextWeekdayDates`.

All six files run clean, directly verified this session (87 assertions total across the six, zero
failures) — see GATE STATUS below for why they were verified directly rather than solely through the
single wrapper script.

## LIVE PROOF

Live, Playwright, real UAT identities, the persistent review world — genuinely run, not simulated.

- **Unknown state, proved first**: before any partnership existed, `uat.coach@ovalball.test` chose
  "Under 12 Boys" and the next 3 Saturdays; the matrix showed "Unknown" on all three dates for both of
  Preston Grasshoppers RFC's compatible teams. Confirmed this was NOT a partnership that Section 6 had
  quietly left behind — `club_partnerships` genuinely had zero active rows involving either club; Preston
  was only ever a rugby-*compatible* candidate, never a partner. "Unknown" was the correct answer.
- **A genuine partnership was created and later fully reverted** to complete the positive-state proof
  (explicit product-owner approval obtained first, since this mutates the shared review database): sent
  a real partnership request as `uat.coach@ovalball.test`, approved it as `uat.preston.admin@ovalball.test`
  (a persona already seeded for exactly this purpose) — "My Partner Clubs" then showed the pairing on
  both sides.
- **No-known-clash state**: with the partnership active and no calendar entries, the matrix correctly
  showed "No known clash" on all three dates for both Preston teams.
- **Busy state**: scheduled a real training session for Preston's Under 12 Boys on the first of the three
  Saturdays via the actual "Schedule Training" UI. The matrix immediately showed "Busy" on exactly that
  date for Under 12 Boys — and, critically, "No known clash" on the *other two* dates, and "No known
  clash" on *all three* dates for Under 12 Girls, proving the coarsened state is scoped to the specific
  team and date, never leaked club-wide or date-wide.
- **Full revert, confirmed**: cancelled the training session via the real "Cancel This Training Session"
  flow (Ovalball's own soft-cancel, not a hard delete — matches how the product itself records
  cancellations); revoked the partnership via the real "Revoke" control. Re-ran the matrix: "Unknown" on
  all three dates for both teams again, byte-for-byte the same as before any of this began. `uat.coach`'s
  own Clubhouse view confirmed "No partner clubs yet" afterward.
- **Content-standard defect found and fixed live**: the new "When (up to 6 dates, optional)" label on
  both clients violated the project's own Title Case rule for form labels; caught by
  `verify-content-standard.mjs`, confirmed against the canonical `toTitleCase` authority
  (`"When (Up to 6 Dates, Optional)"`), fixed on both clients.
- **Genuine team-context marker defect found and fixed live** (see TEAM-CONTEXT GAP): `readClubhouseMarkers`
  passed the raw (null) `viewerClubId` straight into `buildPartnershipIndex`/`resolvePartnershipStatus`
  even when `holdsPartnerAuthority` was already true via Section 5's team-partnership path, so a
  team-context viewer's markers could never carry a trusted partnership status regardless of Section 5's
  own fix — confirmed as a REAL, currently-shipped gap (both functions' own null-safety is itself
  correct and directly pinned by `clubhouse.test.mts`; the bug was that the caller never resolved and
  supplied a real identity). Fixed with a new `resolveTeamClubId` lookup (`teams.club_id`, a plain
  identity read, never an authority decision) feeding an `effectiveClubId` used throughout. Re-proved
  live end to end: created the same test partnership again, signed in as
  `uat.team.manager@ovalball.test` (team-scoped, no `club.partners.manage`), and confirmed "PARTNER
  CLUBS" now genuinely lists Preston Grasshoppers RFC, and the availability matrix for that same
  team-context session correctly showed "No known clash" — both were unconditionally "unknown"/empty
  before the fix. `clubhouse.test.mts` (33 assertions) reruns clean; typecheck clean on both clients.
- **A genuine duplicate-submission defect was found during this same live-proof cleanup**: the one
  "Schedule Training" submission for Preston's Under 12 Boys on 26 September created **two** separate
  `training_sessions` rows (confirmed at the database level), not one. The first cancellation only
  reached one of the two, leaving a stray `PLANNED` row that the matrix correctly still read as "Busy"
  on a later re-check — the availability logic was right; the review-world cleanup was incomplete. Found
  by noticing the matrix disagreed with an assumption, not by inspecting the calendar UI first. Both
  rows are now `CANCELLED`; the review world is confirmed clean (see REVIEW WORLD). Root cause (a form
  double-submit versus a genuine server-side idempotency gap in the training-session creation path) was
  **not** investigated further — out of Section 7's own scope, and documented as a risk rather than
  fixed here (see GATE STATUS/DEFERRED pattern: this section fixes what it caused and what it directly
  found blocking its own proof, not every adjacent surface it happens to touch while proving itself).

## GATE STATUS — READ BEFORE TRUSTING ANY FUTURE "FULL GATE" CLAIM FOR THIS OR ANY OTHER SECTION

`./scripts/run-platform-tests.sh` (the canonical, unsplit gate) currently **cannot complete end-to-end**,
for reasons entirely unrelated to Section 7:

1. `scripts/verify-slice10-retirement.mjs` hard-exits the whole script on failure. Its baseline
   (`supabase/security/slice10-retirement-baseline.json`) was frozen at commit `2289672`, **104 commits
   before Section 4 of this programme even began**. Every one of Sections 1–6, plus a large amount of
   unrelated mobile/messaging/teams work, landed on top of that frozen baseline without it ever being
   re-recorded. Confirmed this is not Section 7's doing: my own changes add exactly one new file
   referencing `team_permissions` (the same test-persona pattern Sections 5/6 already use) and zero new
   database function-body references to any of the five flagged targets.
2. `scripts/verify-fixture-console-scope.mjs` also hard-exits the script on failure. It checks
   `apps/mobile/app/(tabs)/fixtures/[fixtureId]/index.tsx` and `fixture-hero.tsx` — files this section
   never touched (`git diff --stat` against both is empty).
3. Bypassing both hard-exits and running the SQL+JS suite loop directly (the exact loop
   `run-platform-tests.sh` itself runs, unmodified) surfaces further **pre-existing** failures unrelated
   to this section's own tables/functions: `announcement_replies`, `backfill_verification`,
   `capability_catalogue_integrity`, `fixture_meet_time`, `fixture_opposition_contacts`, `session_boundary`
   (zero references to anything Section 7 touches), plus `authority_helper_retirement`,
   `club_admin_authority_matrix`, `club_misc_authority_matrix`, `competition_authority_matrix` — all four
   of the last group failing on the SAME root cause, traced precisely: `team_scheduling_availability`'s
   own-team authority check already called the legacy `can_manage_team`/`can_manage_club_fixtures`
   helpers before this section touched it (`20270552000000`, commit `eaa1bb8`, CA-M11.4), and that commit
   landed **after** the retirement ratchet's ceiling-setting commit (`d0acaab`) — meaning CA-M11.4 already
   violated the ratchet the moment it shipped, well before this section existed. This section's
   `CREATE OR REPLACE` preserves that exact call, as directed ("own-team behaviour completely
   unchanged"); it does not add a new one.
4. `supabase/tests/js/perimeter_manifest.test.mts` runs clean of the above and reports its own
   already-known baseline exactly: 10 passed, 2 failed (`every consumer... exists and calls the
   function`, `signed-in EXECUTE never exceeds the manifest`) — the same two pre-existing, unrelated
   failures noted in Sections 5 and 6, unchanged by this section's manifest edits.

**Section 7's own scope was verified directly and completely**: all six of its new/modified suites (87
assertions), full TypeScript typecheck on both web and mobile (clean), and the full live-proof sequence
above. What could NOT be produced, for any section, is a single unsplit green run of the whole canonical
gate — that capability is currently broken by accumulated debt spanning at least three unrelated prior
slices. This is a programme-level finding, not a Section 7 defect, and is being surfaced here rather than
silently worked around.

## REVIEW WORLD

Real, temporary mutations this section, explicitly approved by the product owner before the first was
made: a partnership between Ovalball UAT RUFC and Preston Grasshoppers RFC (created and revoked TWICE —
once to prove the availability states, once more to prove the team-context marker fix), and a training
session on Preston's Under 12 Boys calendar. All created and reverted through the real in-app flows
(request/approve/revoke, schedule/cancel), never by direct database mutation. Both revoked-partnership
rows and both cancelled-training-session rows remain as audit history rather than hard deletes — this is
how the product itself records these actions, not residue this section left behind.

**The cleanup was not clean on the first pass, and that is recorded rather than smoothed over**: one
"Schedule Training" submission created two rows; only one was cancelled at first, leaving a genuine
stray `PLANNED` commitment that the availability matrix correctly reported as `busy` on a later check.
Caught by the matrix disagreeing with what should have been a clean state, traced to the database, and
fully corrected — both rows confirmed `CANCELLED`, matrix confirmed `Unknown` again (the pre-partnership
state) from both club-context and team-context sessions, "No partner clubs yet"/"Build your rugby
network" confirmed on both clubs' own Clubhouse views. No seed/fixture file was touched. All other live
verification this section was read-only navigation.

## MIGRATIONS

One applied: `supabase/migrations/20270558000000_a_team_knows_only_that_a_day_is_busy.sql` — corrects
`team_scheduling_availability` and adds `find_fixture_candidate_availability`. Applied via the
owner-approved snapshot/move-aside/apply/restore procedure (checksummed the parked
`20270554000000_looking_for_opposition.sql` before and after; confirmed byte-identical and still absent
from `supabase_migrations.schema_migrations`). The parked migration remains untouched, unapplied,
uncommitted, exactly as every prior section left it.

## DEFERRED

- Native live-device proof — no physical device/simulator available this session, same constraint as
  every prior section.
- Root cause of the duplicate `training_sessions` row created by one "Schedule Training" submission
  (found and worked around during this section's own review-world cleanup, not investigated further) —
  is it a form double-submit or a genuine server-side idempotency gap in the training-session creation
  path? Documented as a risk for whichever section owns Training/Calendar, not fixed here.
- The pre-existing, unrelated gate failures catalogued under GATE STATUS — explicitly left unfixed,
  per the standing rule that a defect outside the current section's scope is documented, not silently
  repaired inside someone else's section.
- Time-window granularity within a day — explicitly the directive's own Section 8/9 boundary.

## SECTION 8 HANDOFF

Section 8 (Arrange a Fixture) can build directly on `find_fixture_candidate_availability`'s per-date,
per-team `busy | request_pending` rows and the client-facing `no_known_clash | busy | tentative |
unknown` vocabulary — no further availability primitive should be needed. The composer handoff
(`selectCandidate(candidate, targetTeamId, chosenDate)`) already carries a chosen, non-busy date through
to `/fixtures/new`; Section 8 owns turning that into an actual request. The GATE STATUS section above
should be read before Section 8 begins, since none of those failures are Section 7's to fix and they
will still be present.
