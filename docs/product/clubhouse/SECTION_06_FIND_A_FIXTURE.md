# Section 6 — Find a Fixture

## PURPOSE

Build the "We Need a Game" discovery workflow: pick a team, say when/home-away/how far, and see real,
canonically-compatible Ovalball opposition — never a generic search, never a raw request form, never an
opaque match score. Answers only "who could we play?" (Section 7 owns "who is actually free," Section
8/9 own the negotiation composer itself).

## HEAD VERIFICATION

Expected `ef2818f`. Actual HEAD at the start of this section matched exactly.

## BEFORE STATE

**Clubhouse's own "Find a Fixture" button already existed (Section 4/5)** but was a bare deep-link
straight into `/fixtures/new` — no discovery, no compatibility browsing, just the raw composer's own
name-search step. There was no way to ask "which clubs could we actually play" across the network; a
user had to already know who they wanted to ask.

**`/fixtures/new` (web) and `apps/mobile/app/(tabs)/fixtures/new.tsx` (native)** are the one canonical
request composer, unchanged in their core mutation path this section. Both already accept a
pre-resolved opponent via query/route params (web: `opponentClubId`/`opponentDirectoryId`/
`targetTeamId`/`date`; native: only `teamId`, no opponent prefill at all before this section). Both
call the same underlying tables (`fixture_request_groups`/`fixture_requests`) — web through a `"use
server"` action, native through its own thin insert wrapper (`src/agenda/mutations.ts`) for the same
tables under the same RLS, a legitimate, pre-existing duplication forced by the React Native/Next.js
Server Action boundary, not something this section needed to fix.

**`compatible_opponent_teams(p_team_id, p_opponent_club_id)`** already existed and already enforces the
canonical rule (`internal.identities_can_play_fixture`) once a specific opponent club is chosen — reused
unchanged by the composer's own opponent-resolution step. What did not exist was a BATCHED form: asking
"which teams across the WHOLE network are compatible with ours" required one RPC call per candidate
club, which does not scale past the six clubs on Ovalball today.

**Compatibility rule audited directly** (`internal.identities_can_play_fixture`): rugby code and
category must match exactly; for non-youth, gender must match or be null either side; for youth,
girls-vs-girls is always compatible, otherwise `internal.age_fixture_band` must match (U6/U7/U8 form one
tag-rugby band, every other age group is its own strict band). A `null` rugby code on either side is
never judged (treated as compatible) — a deliberate, pre-existing behaviour for records predating the
canonical directory, kept unchanged.

**Directory coverage (Section 3's own finding, re-confirmed)**: 1,396 `club_directory` rows, 100% Rugby
Union, 0% Rugby League. A directory-only (unclaimed) club has no `teams` rows at all — structurally
impossible to be an actionable Find-a-Fixture candidate, and Union/League isolation was never at risk of
crossing because there is no League data in the directory to cross into.

## ENTRY POINTS

- **Clubhouse main CTA** (native: a full-width button above the search card; web: the page-header
  button) — both updated to open Find a Fixture instead of the raw composer.
- **Selected Clubhouse club** — `ClubMapCard` (web) and the Section 4 Club Sheet (native) both gained a
  "Find a Fixture" action that opens Find a Fixture with that club preselected/filtered (live-verified,
  see PROOF).
- **Team context** — the active team is used directly, never re-asked.
- Team Fixtures' own existing "Request a Fixture" button (`app/(app)/fixtures/page.tsx`) was
  deliberately left pointed at the raw composer — a legitimate "I already know who I'm asking" path,
  distinct from discovery; not rewired this section (see DEFERRED).

## AUTHORITY

Read-only discovery is open to any club/team staff context; family-facing contexts (`parent`/`player`)
are redirected away before any team/club resolution happens (`isFamilyFacingContext`, the exact boundary
`/fixtures/new` already draws — reused, not re-invented). Progressing into an actual request still needs
real fixture authority, enforced in three independent places: `find_fixture_candidate_teams` itself
(server-side, per team), the eventual `/fixtures/new` composer's own resolution, and
`fixture_requests_insert_scoped`/`fixture_request_groups_insert_scoped` RLS on the mutation itself. This
screen never creates or mutates a fixture.

## TEAM SELECTION

Club context: `readClubTeams` (native) / `getTeamsForActiveContext` (web) — the SAME helper the existing
composer already uses. Exactly one active team → no selection screen. More than one → a plain,
accessible list (native: pressable rows; web: buttons), naming each team by its canonical
`fullTeamLabel`/`fullLabel`, never a raw `display_name`. Team context: the active team is used directly,
its rugby code resolved via `teamRugbyCode` (native, reused from the existing composer's own helper) or
`MyTeam.rugbyCode` (web, already present on the shared type).

## COMPATIBILITY

**One new RPC, `find_fixture_candidate_teams(p_team_id)`** (migration `20270557000000`) — the batched
form of `compatible_opponent_teams`, kept textually parallel to it deliberately (same authority check,
same `internal.identities_can_play_fixture` call, same active/not-folded/not-archived exclusion). Never
a second compatibility rule, never string-matched age-grade text. Authorises on team-scoped
`fixture.request.create`/`fixture.fixture.create`, exactly like the existing per-club RPC.

## RUGBY CODE

Enforced entirely server-side by the shared `internal.identities_can_play_fixture` predicate — proven
live this section: a synthetic League U12 team at the same nominal age grade as a Union U12 searching
team was correctly excluded (`supabase/tests/find_fixture_candidates.sql`, assertion C3). Directory-only
"Other Rugby Clubs" results are filtered to the searching team's own `rugbyCode` client-side
(`buildFindFixtureCandidates`) — and to NO results at all when the searching team's own code is
unrecorded, never "any code matches."

## DATE

A single preferred date only (`FindFixtureCriteria.date`), never a multi-date range — Section 7's job.
Native uses the existing shared `DateField` component (`src/components/form.tsx`, already used by the
composer); web uses a plain `<input type="date">` paired with the composer's own existing
human-readable confirmation pattern — neither a raw ISO text field nor a new date-picker implementation.
The date is never used to filter results (Section 6 has no availability data — see AVAILABILITY
BOUNDARY); it travels through to the `/fixtures/new` handoff untouched, live-verified (see PROOF).

## HOME/AWAY/EITHER

Collected (native: `ChoiceField`; web: a small segmented control) using the exact composer vocabulary
(`"home" | "away" | "either"`) — never a separate enum needing translation. Never used to filter
candidates (no venue data exists to judge a club's own preference against); carried through to the
`/fixtures/new` handoff, which now accepts it via a new `initialVenuePreference` prop
(`RequestFixtureForm`) and pre-selects that team's own venue preference radio — a small, additive,
backward-compatible change (the prop defaults to `null`, every existing caller unaffected).

## DISTANCE

Reuses Section 2's `applyClubhouseDistanceFilter`/`findDistanceOrigin` unchanged — the same 10/25/50/100/
Any chips, the same factual-origin-only rule (the viewer's own club must have a real, valid geocoded
location or every distance band except "Any" is a no-op, never a fabricated filter).

## UNKNOWN LOCATION BEHAVIOUR

Unchanged from Section 2: `applyClubhouseDistanceFilter` never drops a candidate with no known location
— it only ever narrows a factual "within N miles" claim, never manufactures one. A compatible club with
no coordinates is still shown at "Any" distance.

## PARTNER ENRICHMENT

Partnership status is carried straight through from the existing marker (now truthful for a team-context
viewer too, Section 5's own closure) — never re-derived. A "Partners Only" toggle
(`applyFindFixturePartnerFilter`, reusing `applyClubhouseFilter`'s own `"partners"` case unchanged) lets
a user narrow to partners; the default is every compatible club, partner or not — never a closed network.

## DIRECTORY-ONLY BEHAVIOUR

A directory-only club with the same rugby code as the searching team is shown in a separate "Other Rugby
Clubs" section — never mixed indistinguishably with actionable Ovalball results, and never offered a
"Select" action (there is no team to select; it has none). Each gets an "Invite to Ovalball" action,
reusing the existing `inviteClubToOvalball` action/dialog (web: the existing `InviteClubDialog`; native:
a small self-contained inline form calling the same shared action — no second invitation store).

**Capped at 20, with an honest count, when the distance filter is "Any"** — a genuine issue found live
this section: Section 3's own audit already recorded ~1,390 directory-only clubs, all one rugby code, so
an unfiltered "Other Rugby Clubs" list would have buried the actionable results under well over a
thousand Invite cards by default. Live-verified: "Showing 20 of 1390 — set a distance to narrow this
down." Never silently truncated — the real total is always stated.

## CANDIDATE MODEL

`FindFixtureCandidate = ClubMapMarker & { compatibleTeams: CompatibleTeam[] }`
(`packages/contracts/src/clubhouse/find-fixture.ts`) — a club is the unit, carrying every compatible
team at that club (never five separate Burnley rows). `groupCandidateTeamsByClub` groups the RPC's flat
rows by club; `buildFindFixtureCandidates` decides actionable vs directory-only. Both pure, both directly
tested (18 assertions, `supabase/tests/js/find_fixture.test.mts`).

## MAP

Reuses the EXISTING Clubhouse map component on both clients — never a second map. Native: the same
Expo-Go-guarded `ClubhouseMap`/`native-map.tsx` wrapper pattern, deliberately duplicated (not
refactored) into `find-fixture.tsx` rather than touching the twice-broken-and-fixed original in
`index.tsx`, since this screen could not be live-device-tested this section (see DEFERRED). Web: the
existing `ClubMap` (Leaflet) component, extended with one small additive prop (`renderPopup`) so Find a
Fixture's own candidate popup (compatible-team chips, not partnership actions) renders instead of
`ClubMapCard`'s — optional, defaults to the existing behaviour, the Partners page is unaffected.
`FindFixtureCandidate` is structurally a `ClubMapMarker`, so `buildClubMarkerFeatureCollection` (native)
and `ClubMap`'s own marker rendering (web) both accept candidate arrays directly, no conversion needed.

## LIST

Native and web each render their own candidate card (crest, name, location, `NetworkPill`/
`ClubStatusPill` — both pre-existing, reused unchanged — and one chip per compatible team, tappable).
Same population as the map, by construction (both read from the same `filteredActionable` array).

## RESULT SORT

Three factual orderings only — `nearest`, `partners_first`, `club_name` — no score, no "best match."
`nearest` degrades to alphabetical without a factual origin, and a candidate with unknown distance always
sorts after every candidate with a known one (never implying proximity) — both pinned directly
(`sortFindFixtureCandidates` tests).

## AVAILABILITY BOUNDARY

**No "Available" claim is made anywhere in this section.** Compatibility is the only claim shown.
`get_partner_team_availability`'s own authority gap (club-scope `fixture.fixture.view`, never widened to
team scope — Section 5's own documented, deliberately-unfixed finding) was re-confirmed this section and
still not touched; Section 7 owns it, because it is directly tied to building real availability
semantics, not just avoiding a client-side authority mismatch. Nothing in this section reads or displays
any calendar/availability data.

## REQUEST HANDOFF

Selecting a candidate team navigates to `/fixtures/new` with ids only in the query string
(`teamId`, `opponentDirectoryId`, `opponentClubId`, `targetTeamId`, `date`, `venuePreference`) — never a
name, crest or town, and the composer re-resolves the opponent itself from `opponentDirectoryId` (web:
already did this; native: a new resolution effect added this section, mirroring web's own trust
boundary exactly — never trusting a name/crest that travelled through the route). `initialTeamId`
(`RequestFixtureForm`, new, additive) is only honoured when it names one of the viewer's own real
teams — never trusted blindly from a query string. **No fixture or request is created by this section's
own code anywhere** — confirmed by reading every mutation path touched: `find_fixture_candidate_teams`
is `STABLE`, `readFindFixtureCandidates`/`buildFindFixtureCandidates` are pure or read-only, and
`selectCandidate` on both clients does nothing but `router.push`.

## NATIVE UX

`apps/mobile/app/(tabs)/clubhouse/find-fixture.tsx` — team selection, `DateField`/`ChoiceField`/
`DistanceChips` (the last two extracted from the main Clubhouse screen into a new shared
`src/clubhouse/components.tsx`, alongside `ClubCrest`/`NetworkPill`, so both screens stay visually
identical rather than drifting), Map/List toggle, sort chips, results, directory-only section. The
existing composer (`fixtures/new.tsx`) gained prefill support for `opponentDirectoryId`/`opponentClubId`/
`targetTeamId`/`date`/`venuePreference` — previously accepted only `teamId`.

## WEB UX

`app/(app)/clubhouse/find-fixture/{page,find-fixture-client,actions}.tsx` — a criteria rail alongside a
large map/list results panel, desktop space used properly rather than a stretched mobile layout. One
server action (`getFindFixtureData`) fetches per team selection; every criterion after that (distance,
sort, partner toggle) is a pure, instant client-side recombination of the same unfiltered data — exactly
the pattern `partner-clubs-explorer.tsx` already uses for its own search/filter, never a server round
trip per criterion change.

## PRIVACY

`find_fixture_candidate_teams` returns exactly five columns (`team_id, club_id, display_name, age_group,
gender` plus the `p_team_id` argument) — asserted directly against `pg_proc.proargnames`, not inferred
from a sample row. No roster, no player, no DOB, no calendar, no staff contact, no finance, no
safeguarding data anywhere in this section's own queries.

## SAFEGUARDING

Parents and players never reach this screen — `isFamilyFacingContext` redirects them to `/agenda` (web)
before any team/club resolution; native has no equivalent entry point rendered for those contexts at
all (Clubhouse's own nav is club/team-staff only, unchanged).

## PERFORMANCE

Exactly two round trips per team selection, on both clients, regardless of network size: the existing
shared marker population and the new batched RPC — never one call per candidate club. Verified this
scales past today's six clubs by design (the RPC scans `teams` directly with a function predicate, no
per-club loop) rather than by data volume, since the local database has only 15 real team rows today.

## TESTS

- `supabase/tests/find_fixture_candidates.sql` (8 assertions, `CANONICAL_GATE`): compatible team
  included, incompatible age band excluded, incompatible rugby code excluded (Union/League isolation
  holds at the same nominal age grade), folded team excluded, own club always excluded, refused with no
  fixture authority at all, refused on a crafted cross-club call naming another club's team, minimal
  five-column payload.
- `supabase/tests/js/find_fixture.test.mts` (18 assertions): grouping, own-club/no-club exclusion,
  directory-only separation (including the unrecorded-rugby-code-yields-no-list case), partnership
  status carried through untouched (including UNKNOWN), all three sorts plus the no-origin and
  unknown-distance-last cases, the partner filter, and the Map/List shared-population invariant.

## PROOF

Live, Playwright, both real UAT identities, the automated test club/world (Ovalball UAT RUFC) —
**genuinely run, not simulated**, and found two real issues this session then fixed (see below):

- Club-context (`uat.coach@ovalball.test`): main CTA link points at `/clubhouse/find-fixture`; team
  selection step shown with real teams; picking "Under 12 Boys" returns "1 compatible club" — Preston
  Grasshoppers RFC, with compatible team chips "Under 12 Boys" AND "Under 12 Girls" (the girls-always-
  compatible special case rendering correctly).
- Team-context (`uat.team.manager@ovalball.test`): reaches the page directly, no redirect, team already
  preselected, no "which team" prompt, results render immediately.
- Selected-club entry: the per-club "Find a Fixture" link on the map/list card correctly preselects and
  filters results to exactly that one club ("Clear club selection" control present, count reflects the
  single-club filter).
- Full handoff: selecting a compatible team navigates to `/fixtures/new` with the opponent already
  resolved (no search step), the searching team pre-checked, and the chosen date carried through exactly.
- Directory-only cap: confirmed live — "Showing 20 of 1390 — set a distance to narrow this down."

**Two real defects found and fixed via this live proof, not by code review**:
1. The directory-only "Other Rugby Clubs" list had no cap — would have shown ~1,390 Invite cards by
   default. Fixed with a client-side cap (20) and an honest truncation count, on both clients.
2. (Investigation only, no product change needed) An early test script produced false failures from
   ambiguous element selectors and a regex that never matched the real button labels — corrected in the
   test scripts themselves, not the product; recorded here so the distinction between a real defect and
   a test-script mistake is explicit.

## REVIEW WORLD

Every live check was read-only navigation plus client-side interaction; no fixture request was ever
submitted (every proof stopped at the pre-filled `/fixtures/new` composer, never clicking Send Request),
no partnership was created or changed, no capability was modified. `git status` after this section shows
no seed/fixture file touched.

## DEFERRED

- Rewiring Team Fixtures' own existing "Request a Fixture" button to route through discovery — left
  pointed at the raw composer deliberately (a legitimate "I already know who I'm asking" path); adding a
  secondary "Discover via Clubhouse" entry there was judged out of scope for this already-large section.
- Native live-device proof — no physical device/simulator available this session, same constraint as
  every prior section; the deliberately-duplicated Expo-Go map guard in `find-fixture.tsx` has not been
  seen running on a real device.
- Recent-opponent context ("Played twice this season") on result cards — would need a batched,
  per-network fixture-history query to stay N+1-free; judged not cheap enough to build this pass (the
  directive's own "where canonical fixture history makes it cheap" conditional). Section 17 owns deeper
  network memory.
- Widening `get_partner_team_availability` to team scope so Compare Calendars works for a team-context
  viewer — explicitly Section 7's, not touched.
- A full axe accessibility pass on the new screens (both reuse existing, previously-audited primitives —
  `DateField`, `ChoiceField`, `ClubAvatar`, `ClubStatusPill` — but the new layouts themselves were not
  independently re-audited).

## SECTION 7 HANDOFF

Section 7 (Who Is Actually Free) inherits: the canonical `FindFixtureCandidate`/`FindFixtureCriteria`
contract to extend rather than replace; the explicit, documented decision that NO availability claim
exists anywhere in Section 6's own UI; and the still-open `get_partner_team_availability` team-scope
authority gap, which Section 7 must resolve as part of building real availability semantics for a
team-context viewer.
