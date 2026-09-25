# Section 4 — Club Profile / Club Card

## PURPOSE

Deepen the ONE shared Clubhouse club-detail read model (`packages/contracts/src/clubhouse/club-detail.ts`)
so opening a club feels like opening that club in the Ovalball network, not a name and a status pill.
Every field added is real, canonical and already-derived elsewhere — no fabricated compatible-team
counts, no invented facilities, no "Message Club" placeholder (Section 10's job).

## HEAD VERIFICATION

The directive's stated expected HEAD was `58e97ef`. Actual HEAD at the start of this section's work was
`0cd7346` — one commit ahead (`fix(clubhouse): two real bugs found on a live device — header hidden,
test fixtures visible`), a live-device fix that landed between the directive being written and this
section starting. Reported honestly rather than silently working from the wrong baseline.

## BEFORE STATE

`ClubDetail` (`club-detail.ts`, built in Clubhouse V1) already carried `directoryId, clubId, name,
rugbyCode, town, county, networkState, partnershipStatus, partnershipId, logoUrl, slug,
compatibleTeamCount, fixturesTogetherThisSeason, actions` — a real read model, but a shallow one:
compatibility was a bare number, there was no location beyond town/county text, no canonical website, and
nothing carried the `locationPrecision` concept Section 3 had already added to `ClubMapMarker`.

## CANONICAL READ MODEL

`ClubDetail` now also carries `postcode, latitude, longitude, hasLocation, locationPrecision` (passed
through unchanged from the marker — never re-derived, so the sheet and the map can never disagree about
where a club is) and `website: string | null`, plus `compatibleTeams: CompatibleTeam[] | null` in place of
a bare count. `CompatibleTeam` is `{ teamId, displayName, ageGroup, gender }` — exactly the four fields
`compatible_opponent_teams` returns, renamed to the contract's own casing.

Two new pure functions were extracted so this is checkable without a live database, matching the pattern
`resolveClubLocation`/`deriveClubNetworkActions` already established:

- `resolveClubWebsite(directory, club)` — the same precedence `resolveClubLogoPathFrom` already
  establishes for crests: an activated club's own entered website wins over the directory's; a blank
  string is treated as absent, never inferred from the club's name.
- `mapCompatibleTeams(rows)` — the exact four-field projection of the RPC's rows, pinned so "no player
  roster leakage" is a real, checkable assertion rather than an implicit hope.

`compatible_opponent_teams`'s own return shape (`team_id, display_name, age_group, gender`) lacks
`category`/`squadDesignation`/`rugbyCode`, so it cannot be re-run through `fullTeamLabel`/`compactTeamLabel`
(`packages/contracts/src/teams/compact-label.ts`). The RPC's own `display_name` is used as-is. Redesigning
the RPC's shape is explicitly out of scope for this section — Section 17's ledger note already earmarks
`compatible_opponent_teams` for future generalisation.

## PROFILE STATES

Unchanged from V1's already-correct handling, now with richer content per state:

- **Directory-only (unclaimed)**: `clubId` null. Never offered Find a Fixture, Compare Calendars or any
  partner action (`isOtherClub` requires a real `clubId` — unchanged, already tested). Gets location,
  website and crest if the directory has them; never a compatible-team list or fixture history, because
  those concepts do not exist for a club with no Ovalball teams.
- **On Ovalball**: full read model — compatible teams (if the viewer has a team context), fixtures
  together this season, website, location.
- **Partner (active)**: adds Compare Calendars, matching `get_partner_team_availability`'s own
  server-side "no active calendar-sharing agreement" refusal.
- **Partnership pending/unknown**: exact single-transition action only (cancel outgoing / respond
  incoming) — unchanged, already tested; `"unknown"` can never render a partner action (already tested,
  re-confirmed this section).
- **Own club**: `isOtherClub` false, so every partner/fixture action is false — unchanged, already
  tested.

## NATIVE UX

`apps/mobile/app/(tabs)/clubhouse/index.tsx`'s `ClubSheet`:

- The compatible-team stat became a real list — a wrapped row of team-name chips, shown only when
  `compatibleTeams` is non-empty, styled to match the existing filter-chip visual language rather than
  introducing a new component.
- Fixtures-together keeps its existing numeric `Stat`.
- A new "About" section renders the club's website as a tappable link (`Linking.openURL`), shown only
  when `website` is non-null.
- Location-precision wording (the "Approximate location" pill) and distance were already correct from
  Section 3 and were not touched.

## WEB UX

The web Clubhouse surfaces (`app/(app)/clubhouse/page.tsx`, `club-map-card.tsx`,
`partner-club-card.tsx`) are dense list/map cards, deliberately unchanged this section — they already
share the one `MapClub`/`ClubMapMarker` read model via `map-data.ts`, and a dense card does not need the
deepened detail fields any more than the native list row does.

**Not built this section: a canonical, `directoryId`-keyed full-profile web route.** The existing
`app/(app)/clubhouse/[clubId]/page.tsx` is the Compare Calendars / Availability page specifically — it is
activated-club-only (keyed on `clubId`, not `directoryId`) and cannot represent a directory-only,
unclaimed club at all. A genuine full profile page, especially the directory-only case, has no existing
reference design anywhere in the product, and the standing rule from a prior session is to confirm layout
direction for a substantial new view with the product owner before building it, rather than freehand a
design for a page they will see for the first time already built. Flagged as **NOT DONE** below and in
the acceptance checklist, not silently skipped.

## LOCATION

Passed through from the marker unchanged — `hasLocation`, `latitude`, `longitude`, `locationPrecision`.
No second location computation; `readClubDetail` never calls `resolveClubLocation` itself, it trusts the
marker it was given.

## CRESTS

Unchanged — `clubLogoFromDirectoryAndClub`/`resolveClubLogoPathFrom` already established the
club-over-directory precedence this section's `resolveClubWebsite` deliberately mirrors.

## ABOUT

Website only. Rugby code and town/county were already surfaced in the sheet header before this section;
not duplicated into a second "About" block.

## TEAMS / COMPATIBILITY

`compatibleTeams: CompatibleTeam[] | null` — only populated for an on-Ovalball club with a real viewer
team context (`marker.clubId && viewerTeamId`), via the same `compatible_opponent_teams` RPC Find a
Fixture calls. `null`, not `[]`, when the concept does not apply (no viewer team context) — `[]` means
"asked, found none," which is a different, true statement from "not applicable here."

## FIXTURE HISTORY

`fixturesTogetherThisSeason` unchanged from V1 — canonical `fixtures` rows only, scoped to the current
season and the two clubs' own teams, `Cancelled` excluded. Not generalised to prior seasons this section
(Section 17's job, per the ledger's own existing note).

## FACILITIES

Not built. Section 3's forensic audit already found 0 of 1,396 directory rows carry a crest and no
canonical structured facility data exists anywhere in the schema — there is nothing real to surface, and
inventing a "Facilities" section would mean fabricating content CLAUDE.md and this programme's own rules
both prohibit.

## ACTIONS

`deriveClubNetworkActions` is unchanged this section — its logic was already correct and already fully
tested (own-club, parent/player, team-context, UNKNOWN-status cases). No new action was added; "Message
Club" remains deliberately absent, reserved for Section 10.

## AUTHORITY

`readCapabilities` (`my_capabilities`, club-scoped) is unchanged. The new `website` and `compatibleTeams`
reads carry no new authority surface: `club_directory`/`clubs.website` are already publicly-selectable
columns via existing RLS, and `compatible_opponent_teams` is the same RPC Find a Fixture already calls
under the same caller.

## PRIVACY

`mapCompatibleTeams`'s four-field shape is now directly pinned by a permanent test asserting the mapped
object's key set is exactly `ageGroup, displayName, gender, teamId` — no roster, no player, no squad
list. No new sensitive field is returned by `readClubDetail` anywhere.

## PERFORMANCE

One additional read (`readClubWebsite`) added to `readClubDetail`'s existing `Promise.all`, fired only
once a marker is selected (unchanged fetch-on-open behaviour) — not bundled into the map/list payload.

## TESTS

4 new assertions in `supabase/tests/js/clubhouse.test.mts` (33 total in the file, up from 29):
`mapCompatibleTeams`'s four-field projection (including the empty-array case), and `resolveClubWebsite`'s
precedence (club over directory, directory fallback, both-null, blank-string-is-absent). All pure,
DB-free. The bulk of the directive's ~25 named scenarios (own-club-cannot-partner-with-self,
parent/player actions false, UNKNOWN-cannot-partner, directory-only-cannot-Compare-Calendars, team-staff
capability projection, etc.) were already covered by Section 2/V1's existing `deriveClubNetworkActions`
tests, re-run and re-confirmed passing this section, not re-written.

## PROOF

- `npx tsc --noEmit` (web) — clean.
- `npx tsc --noEmit` (`apps/mobile`) — clean (this section's edit is what made it clean; the interrupted
  mid-edit state before this session resumed would not have compiled).
- Full SQL+TS regression (`scratchpad/run-sql-ts-suites.sh`): 215 SQL + 121 TS suites, 7,335 assertions
  passed, `clubhouse` suite 33/33. Failures unchanged from the pre-existing 14-suite baseline
  (`announcement_replies, authority_helper_retirement, backfill_verification,
  capability_catalogue_integrity, club_admin_authority_matrix, club_misc_authority_matrix,
  competition_authority_matrix, fixture_meet_time, fixture_opposition_contacts, session_boundary,
  mobile_foundation, parent_home_experience, participant_routing, perimeter_manifest`) — none of which
  this section's files touch.
- `npm run build` — Next.js production build succeeds.
- **Device/browser visual proof: NOT DONE this turn.** No physical iPhone or browser session was
  available in this environment. The native sheet change (compatible-team chips, About/website link) has
  not been seen rendered on a real device or simulator. Stated plainly rather than implied.

## DEFERRED

- The canonical `directoryId`-keyed full-profile web route (see WEB UX) — needs a reference design from
  the product owner before being built, per the standing "confirm layout before building a substantial
  new view" rule.
- Deep links / "View Club" still point at the public marketing page (`/clubs/[slug]` on web,
  `${webUrl}/clubs/${slug}` on native) rather than an in-app canonical profile — inherits from the same
  gap above; there is no in-app full profile yet to deep-link to.
- Facilities content (no canonical data exists — see FACILITIES).
- Prior-season fixture history (Section 17's job).
- Device/browser visual verification (see PROOF).
- The Cardiff Rugby / Cardiff Rugby Football Club duplicate candidate from Section 3 remains unresolved
  — untouched by this section, as expected.

## SECTION 5 HANDOFF

Section 5 (Partners) inherits: the deepened `ClubDetail` read model (location, website, compatible-team
list); the still-open team-context partnership read-model gap the ledger's Section 5 row already
describes (UNKNOWN must never be interpreted as NOT_PARTNERED anywhere it does this — unchanged,
preserved); and the deferred full-profile web route, which Section 5 does not need to build but should
not assume exists when wiring any new partner-facing navigation.
