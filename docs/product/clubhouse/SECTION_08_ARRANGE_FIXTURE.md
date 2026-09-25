# Section 8 — Arrange a Fixture

## PURPOSE

Turn Clubhouse discovery intent (Section 6/7's "who could we play, and when") into a real fixture
request, through one canonical composer, without inventing a second request domain. Converge the
discovery path and the "I already know who I want to ask" direct path onto the same screen, and close
two genuine authority/duplicate gaps found auditing the domain before touching it.

## HEAD VERIFICATION

Expected `26392ef`. Actual HEAD at the start of this section matched exactly.

## BEFORE STATE / CANONICAL REQUEST DOMAIN

No single canonical creation RPC exists. Two mechanisms coexist:

- **Mechanism A** — direct, RLS-authorised table inserts (`fixture_request_groups` then one
  `fixture_requests` row per own-team) — what `/fixtures/new`'s `request-fixture-form.tsx` /
  `actions.ts` already used, and what mobile's `apps/mobile/app/(tabs)/fixtures/new.tsx` /
  `src/agenda/mutations.ts` already used. This is the mechanism Section 8 builds on; no new RPC was
  created, per the directive's own "do not create another request RPC merely because Clubhouse needs a
  better screen."
- **Mechanism B** — the canonical `create_fixture` RPC (`fixture.fixture.create`-gated), which
  internally performs the SAME two inserts when it detects an active Ovalball opponent, or a direct
  `fixtures` insert otherwise. Used by Add Fixture / Calendar's dialog. Left alone — it already routes
  through mechanism A for the Ovalball-opponent case, so nothing needed converging there.

`fixture_requests` already carries far more canonical shape than either UI exposed: `venue_preference`
(`home|away|either` — Section 8's "Either"), `pitch_id`/`venue_id` (home-side proposal, dormant, still
left dormant this section — genuinely optional per the directive, not worth the added surface for a
first pass), `proposed_ground`/`proposed_pitch` (away-side, dormant), counter-proposal fields
(CA-M11.5, untouched — Section 9's), and `fixture_request_groups.game_type` (proposed once per group,
carried onto the fixture on accept) — modelled but **never surfaced** by either request-composer UI
before this section.

`meet_time` is confirmed **fixture-only** (`update_fixture_meet_time` operates on `fixtures.id`, gated
post-acceptance) — correctly not added to the request composer, per the directive's own instruction.

Full forensic detail (RLS policy text, notification-trigger role-string targeting, decline/cancel being
plain RLS-gated updates with no dedicated function, the counter-proposal signature) is preserved in the
session's own audit record; the load-bearing findings are captured above and in AUTHORITY below.

## ENTRY POINTS

All six of the directive's listed entry points were already, or are now, one canonical composer at
`/fixtures/new` (web) / `apps/mobile/app/(tabs)/fixtures/new.tsx` (native):

1. **Clubhouse → Find a Fixture** (Section 6): `find-fixture-client.tsx`'s `selectCandidate` already
   pushed here with `teamId/opponentDirectoryId/opponentClubId/targetTeamId/venuePreference`.
2. **Clubhouse → availability date** (Section 7): the same handoff, `+date` when a specific date was
   chosen (including an `unknown`-state date — proven live, see LIVE PROOF).
3. **Club Profile → Find/Arrange Fixture**: same route, via the per-club "Find a Fixture" link
   established in Section 4/6.
4. **Partner Club → Arrange Fixture**: the old Compare Calendars route (Section 7) already redirects
   into Clubhouse discovery, which ends here.
5. **Team Fixtures → Request a Fixture**: already pointed at `/fixtures/new` on both clients (Section 6
   deliberately left it there — "I already know who I'm asking" is a legitimate direct path). Proven
   live this section: team-context lands with the team pre-selected, no team-selection step.
6. **Team Fixtures → Add Fixture** (request-semantics branch): Calendar's `create-fixture-dialog.tsx`
   and mobile's `new.tsx` already call the SAME `createFixtureRequest` action/mutation this section
   improved (compatibility/duplicate refusal, `gameType`) — improved "for free," no UI rebuild needed.

No new route was created; no entry point needed rewiring to a different destination — the convergence
this section does is at the ACTION/mutation and UX-completeness level, not at routing.

## INTENT MODEL

`packages/contracts/src/fixtures/arrange-fixture.ts` — deliberately small, and NOT a parsing/I-O layer
(both clients' existing server-side re-resolution, already correct, was left untouched — see SERVER
REVALIDATION). It holds only the shared DISPLAY semantics the directive calls out as needing to be
identical on both clients:

- `describeArrangeFixtureHost(venuePreference, ourClubName, opponentClubName)` — the one home/away → "who
  hosts" translation, producing a complete sentence ("Burnley RUFC will host.") or, for `either`, a
  genuine open question, never a guessed side.
- `arrangeFixtureAvailabilityLabel` / `buildArrangeFixtureSummary` — the one pre-send summary
  projection, carrying Section 7's own vocabulary (`no_known_clash|busy|tentative|unknown`) through
  unchanged, never softened to "Available."

Fields (`ownTeamId`, `oppositionClubId`, `oppositionTeamId`, `preferredDate`, `kickoffTime`, `homeAway`,
`venueId`, `classification`, `note`) already exist as `TeamRequestInput`/`CreateFixtureRequestInput`
(web) and `NewFixtureRequest` (mobile, now with `gameType` added) — no unsupported business field was
invented.

## PREPOPULATION

Proven live end to end: a Section 7 `Unknown`-state date, selected from Clubhouse discovery, arrives at
the composer with the team, opponent, target team, venue preference (`either`) and date already
populated — no re-selection required (see LIVE PROOF). This was already `page.tsx`'s existing behaviour;
Section 8 did not need to change it, only prove it.

## OUR TEAM / OPPOSITION / COMPATIBILITY

Unchanged and already correct: `page.tsx` only ever honours `teamId` against the viewer's own
`myTeams` list; `targetTeamId` is only honoured once re-resolved against the opponent club's real teams.
Compatibility is enforced **at the database**, not merely suggested by the UI:
`internal.enforce_fixture_request_age_eligibility` (existing, pre-Section-8) refuses an
age/code/category-incompatible pair at INSERT time regardless of what the client believed — genuine
server revalidation, not a client-side assumption carried through from Section 6/7.

## DATE / AVAILABILITY CONTEXT

`AvailabilityPanel` (already updated for Section 7's vocabulary) continues to show
`no_known_clash|busy` language, never a fabricated `Available`. One honest, pre-existing rough edge
observed live and left alone (out of this section's scope — the panel predates Section 8): calling it
for a compatible-but-not-yet-partnered opponent surfaces a generic "Couldn't load scheduling
availability" (the underlying RPC correctly refuses to disclose a non-partner's calendar, but
`readTeamAvailability` throws the raw Supabase error object rather than an `Error`, so the panel's
`instanceof Error` check falls through to its generic fallback text). Documented as a DEFERRED item, not
fixed here.

## HOME / AWAY / EITHER

`venue_preference` (`home|away|either`) already represents "Either" natively — no faked value was
needed. `describeArrangeFixtureHost` is the one shared translation now used by the web review step
("Ovalball UAT RUFC will host." / "Burnley RUFC will host."). Proven live, cross-club: the SAME request,
`Home` from the requester's side, reads correctly as `Away` on the recipient's own Fixture Requests list
— unambiguous from both perspectives, never a perspective-confused label.

## VENUE / PITCH BOUNDARY

No pitch selector was added. `pitch_id`/`venue_id` (home-side) and `proposed_ground`/`proposed_pitch`
(away-side) remain dormant, exactly as found — a genuine future enhancement, not something this section
needed to ship, and precisely the kind of addition the directive says to "treat suspiciously." Nothing
here reads or writes `venue.pitch_allocation.manage`; the independence is proved in TESTS.

## CLASSIFICATION

Added to both composer UIs, using the existing canonical taxonomy exclusively (`FIXTURE_TYPE_OPTIONS` /
`GAME_TYPE_OPTIONS` — the `fixtures.game_type` check constraint, already the one shared list both clients
already imported for OTHER surfaces). No new option was invented. Web: a "Not set" default alongside
Friendly/League/Cup/Other. Mobile: the field, previously gated to the non-request branch only, is now
shown on the request branch too (defaulting to "Friendly," matching the existing default-display
convention for an unset value everywhere else in the domain).

## NOTE

Unchanged — the existing `note`/`preferred_kickoff_time` fields already carry a bounded, request-specific
coordination note (not Section 10 messaging); no new note surface was added.

## SUMMARY

Web's review step now states the host explicitly ("Ovalball UAT RUFC will host.") and the chosen fixture
type, before Send — proven live (see LIVE PROOF), making an error (wrong home/away, wrong type) visible
before the mutation, per the directive's own requirement.

## MUTATION

Two closed gaps, one new migration (`20270559000000_a_group_needs_the_same_authority_as_its_rows.sql`):

1. **`fixture_request_groups_insert_scoped`** (RLS) was still reading the legacy
   `fixture.fixture.edit`-based `can_manage_club_fixtures_or_any_team`, while the per-team
   `fixture_requests_insert_scoped` policy already correctly asked `fixture.request.create`. Corrected
   to the same capability, same club-wide-or-any-active-team shape. Blast radius before the fix was
   bounded (the row policy already refused the actual request), but it was a genuine, provable "does
   capability X imply capability Y" violation of exactly the independence this section is required to
   pin.
2. **Duplicate-pending-request refusal**, new: a `BEFORE INSERT` trigger on `fixture_requests` refuses a
   second simultaneously-pending (`sent`/`counter_proposed`) request between the same team pair **for
   the same date** — scoped to the well-defined case (both `requesting_team_id` and `target_team_id`
   known), matching the age-eligibility trigger's own scoping precedent. Deliberately date-scoped, not
   pair-scoped: `fixture_management_authority.sql`'s own pre-existing FA-H5/FA-H7c legitimately raises
   two requests between the same pair on different dates, found running the existing suite against this
   migration — real, sanctioned product behaviour this section must not break.

**A genuine, direct conflict was found and resolved with the product owner rather than decided
unilaterally**: `fixture_management_authority.sql`'s FA-I8 explicitly asserted the OPPOSITE of the
directive's duplicate-refusal requirement — that replaying the same request twice should succeed twice,
proving only that no fixture is silently created. Owner decision: keep the server-side duplicate
refusal; FA-I8 rewritten to expect the second call refused as a duplicate, still proving no fixture (and
now, no second silent request either) is ever created by a replay.

## NOTIFICATIONS / DUPLICATES / READ != RESOLVED

Reused entirely — the existing `notify_fixture_request_recipients` trigger and the accept/decline
pathway are untouched. No Clubhouse-specific notification was added. Decline remains a plain
capability-gated update, unchanged; reading a request notification was already, and remains, distinct
from resolving it (accept/decline/counter).

## STALE STATE / DIRECTORY-ONLY / EXTERNAL OPPOSITION

Unchanged and already correct: a directory-only (not-on-Ovalball) opponent's review step already showed
"This fixture will be added to your calendar, but no Ovalball request will be delivered," and the
composer's own button already read "Add to calendar" rather than "Send request" for that case — the
external-opposition/request distinction the directive requires was already explicit, not something
Section 8 needed to build.

## WEB UX / NATIVE UX

Web: added the Fixture Type field, the host-language sentence in review, and a genuine in-page
"Request Sent" confirmation (View Requests / Back to Clubhouse / View Calendar) replacing a bare redirect
to `/fixtures`. Native: enabled Fixture Type on the request branch, added an equivalent "Request Sent"
confirmation screen with the same three actions (routed via the existing `/club/requests` vs
`/team/requests` context split already established elsewhere in the app). Full visual redesign of either
composer into the newer "hero" mock-up aesthetic was judged out of scope for this pass — see DEFERRED.

## AUTHORITY / SAFEGUARDING / SECURITY

`fixture.request.create`'s independence from `fixture.fixture.create`, `fixture.fixture.edit`,
`fixture.result.record` and `venue.pitch_allocation.manage` is now proved directly, at both the group and
the row (`arrange_fixture_authority.sql`, AF-I1–I8) — none of the four, held alone, ever substitutes for
it. Team-scope binds to the requesting team (crafted cross-team calls already refused, per
`fixture_management_authority.sql`'s own pre-existing FA-L block); club-scope covers any of the club's
own active teams, never another club's. No parent/player path reaches this composer (`page.tsx`'s
existing family-facing redirect, unchanged). No roster or participant detail is exposed anywhere in this
flow.

**A real, subtle authority-testing pitfall was found and is recorded as a lesson in the new suite's own
comments**: granting a genuine 'coach' `team_permissions` role to an independence-test persona (needed
to keep a TEAM-scope override matched at all — `internal.capability_decision` ignores a team-scope grant
to someone with no active `role_assignments` row for that team) ALSO grants `fixture.request.create` by
default role bundle, silently defeating the very independence being tested. Resolved by granting the
other four "independence" capabilities at CLUB scope instead, which needs no team role.

## TESTS

- `supabase/tests/arrange_fixture_authority.sql` (15 assertions, `CANONICAL_GATE`, new): the group-policy
  fix (`AF-G1-3`), all eight independence proofs at group and row (`AF-I1-8`), and the full
  duplicate-refusal lifecycle — refused same pair/same date (`AF-D1`), unaffected different pair
  (`AF-D2`), freed again once resolved (`AF-D3`).
- `supabase/tests/fixture_management_authority.sql` (existing, corrected): FA-I8 rewritten per the owner
  decision above; full suite reruns clean (100 assertions, 0 failed, 0 errors — previously would have
  aborted the whole transaction on the first duplicate collision).
- `supabase/tests/js/arrange_fixture.test.mts` (7 assertions, new): `describeArrangeFixtureHost`'s
  home/away/either translation, `arrangeFixtureAvailabilityLabel`'s vocabulary, `buildArrangeFixtureSummary`'s
  projection.
- Full typecheck clean on both web and mobile.

## LIVE PROOF

Live, Playwright, real UAT identities (`uat.coach@ovalball.test`, `uat.preston.admin@ovalball.test`,
`uat.team.manager@ovalball.test`), the persistent review world — genuinely run, not simulated.

- **Flow A, discovery → composer**: Clubhouse → Find a Fixture → Under 12 Boys → Next Saturday →
  clicked Preston Grasshoppers RFC's `Unknown`-state cell (proving UNKNOWN never blocks a request) →
  landed on `/fixtures/new` with team, opponent, target team, date and venue preference (`either`) all
  genuinely pre-populated (verified the actual checkbox/radio DOM state, not just the URL).
- **Fixture Type + host language**: set Fixture Type to Friendly, set Home/Away to Home, reviewed —
  the review step correctly read "Ovalball UAT RUFC will host." and "Friendly."
- **Send + confirmation**: sent the request; the composer showed "REQUEST SENT... Preston Grasshoppers
  RFC has been asked to play... Preston Grasshoppers RFC will confirm, decline or propose a change" with
  all three next-step actions, never implying the fixture was confirmed.
- **Cross-club visibility + home/away correctness**: signed in as `uat.preston.admin@ovalball.test`;
  their Fixture Requests showed "Under 12 Boys v Under 12 Boys, Ovalball UAT RUFC · Sat 26 Sept · Away" —
  correctly inverted for their own perspective.
- **Duplicate refusal, live**: attempted to send the identical request again; the review step showed
  "There is already a pending fixture request between these two teams for this date." cleanly, no crash,
  no orphan state.
- **Direct path (Flow B)**: signed in as `uat.team.manager@ovalball.test` (team context); Team Fixtures
  → "Request a Fixture" landed on the identical composer with "Under 12 Boys" already the only,
  pre-selected team — no team-selection step, proving the direct path and the discovery path are
  genuinely the same screen.
- **Native**: no physical device/simulator available this session, same constraint as every prior
  section — typecheck-clean confirmation only.

## REVIEW WORLD

The one test request (Ovalball UAT RUFC → Preston Grasshoppers RFC, Under 12 Boys, 26 Sept 2026) was
declined via Preston's own canonical "Decline" action. Confirmed clean afterward: the request row remains
only as `declined` audit history (the product's own append-only pattern, not a residue); zero fixtures
were created by this section's testing (a pre-existing, unrelated fixture on the same date for a
different opponent, "Abercynon Rugby Football Club," was found and confirmed to predate this session's
work); zero pitch allocations; zero lingering test capability overrides; no test session left signed in.

## HISTORICAL GATE DEBT STATUS

Reused the exact SQL+JS suite loop `run-platform-tests.sh` itself runs (bypassing the same two
unrelated, pre-existing structural check failures Section 7 already documented in full —
`verify-slice10-retirement`'s frozen baseline, `verify-fixture-console-scope` on untouched mobile files).
Full sweep: 7428 SQL assertions passed, 21 failed, all 21 independently confirmed unrelated to this
section:

- The 10 SQL suites and 1 JS file (`perimeter_manifest`) Section 7 already catalogued as pre-existing,
  unchanged.
- Three NEW-to-this-catalogue JS files (`mobile_foundation`, `parent_home_experience`,
  `participant_routing`) — confirmed by direct inspection to fail on files this section never touched
  (`apps/mobile/app/(tabs)/admin/pitch-allocation/index.tsx`, `src/team/home.tsx`,
  `src/admin/decision-sheet.tsx`), plus `mobile_foundation`'s "picture/crest" and "raw error" checks on
  the same unrelated files.
- Five SPECIAL_PURPOSE/UNVERIFIED (non-gate) SQL files with real failures
  (`group_vs_group_acceptance`, `opponent_reconciliation`, `club_lifecycle`, `unified_fixture_conversation`,
  `controlled_missing_team`) — confirmed to depend on hardcoded fixed-UUID seed rows
  (`'00000000-0000-0000-0000-000000000002'` etc.) that do not currently exist in this local database, an
  environment/seed-data issue with no relationship to fixture-request authority. Not part of the
  canonical gate; not fixed here.

Section 8's own scope (the new suite, the one corrected pre-existing suite, the new JS test) is
completely clean. `team_permissions` CI-reference count rose by exactly 1 (this section's own new test
file, same established pattern Section 7 used) — no other Slice 10 ratchet number moved.

## MIGRATIONS

One applied: `supabase/migrations/20270559000000_a_group_needs_the_same_authority_as_its_rows.sql`.
Applied via the owner-approved snapshot/move-aside/apply/restore procedure; edited in place and
reapplied directly twice during this session (date-scoping fix) before the final commit, per the
established Section 7 precedent for a not-yet-committed migration. The parked
`20270554000000_looking_for_opposition.sql` remains untouched, unapplied, uncommitted, byte-identical.

## DEFERRED

- Full visual redesign of the composer into the richer "hero" mock-up aesthetic (team-vs-team identity
  block, larger touch targets, native date/time pickers styled to match) — this pass added the missing
  functional pieces (classification, confirmation, host language) to the EXISTING layout rather than
  rebuilding it; visual polish is now explicitly the subject of the follow-up UI/UX brief.
- `AvailabilityPanel`'s generic "Couldn't load scheduling availability" message for a non-partner target
  — genuinely pre-existing (Section 7-era code), not fixed here.
- Home-side venue/pitch proposal (`venue_id`/`pitch_id`) and away-side proposed-ground text — dormant,
  real, deliberately left unsurfaced this pass.
- Native live-device proof — no physical device/simulator available this session.
- Cross-request (A requests B while B independently requests A) merge/detection — explicitly the
  directive's own instruction to document rather than invent; no such mechanism exists anywhere in the
  domain today.

## SECTION 9 HANDOFF

Section 9 (Fixture Negotiation) inherits a composer that creates a clean, singular, duplicate-free
request per team pair per date, with `pitch_id`/`venue_id`/`proposed_ground`/`proposed_pitch` still
dormant and available for a negotiation UI to surface if it chooses. The counter-proposal domain
(`counter_fixture_request`, `last_proposed_by_team_id`) is completely untouched. The new duplicate
trigger only fires on INSERT, never on UPDATE, so Section 9's negotiation UPDATEs (accept/counter/decline)
are entirely unaffected by anything this section added.
