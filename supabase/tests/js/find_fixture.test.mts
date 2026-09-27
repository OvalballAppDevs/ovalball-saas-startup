import { test } from "node:test"
import assert from "node:assert/strict"

import {
  applyFindFixtureNetworkFilter,
  applyFindFixturePartnerFilter,
  buildFindFixtureCandidates,
  buildFindFixtureMatches,
  buildClubMarkerFeatureCollection,
  canSearchFindFixtureCriteria,
  dedupeFindFixtureDates,
  findFixtureAvailabilitySummaryLabel,
  findFixtureClubWeekLabel,
  findFixtureDateClause,
  findFixtureMatchingCopy,
  findFixtureResultCountLabel,
  findFixtureWeekLabel,
  gameWeekRange,
  withinGameWeek,
  gameWeekRangesForDates,
  groupBatchCandidateTeamsByClub,
  groupCandidateTeamsByClub,
  matchedTeamCountLabel,
  nextWeekdayDates,
  otherWeekCommitmentsForOpponent,
  sortFindFixtureCandidates,
  sortFindFixtureMatches,
  summariseFindFixtureClubAvailability,
  summariseFindFixtureClubWeek,
  summariseFindFixtureTeamWeek,
  toggleSelection,
  toSortSummary,
  type ClubMapMarker,
  type FindFixtureCandidate,
  type FindFixtureCandidateMatch,
} from "../../../packages/contracts/src/clubhouse"

/**
 * CLUBHOUSE PROGRAMME SECTION 6 -- FIND A FIXTURE: pure client-side logic pinned directly. The
 * canonical compatibility RULE (rugby code, category, age-fixture-band) lives entirely server-side in
 * `internal.identities_can_play_fixture` and is proven by `supabase/tests/find_fixture_candidates.sql`
 * (a crafted-call/cross-club authority suite, mirroring `clubhouse_team_partnership_read.sql`'s own
 * pattern) -- these assertions cover the NEW arithmetic this section adds on top: grouping, own-club
 * exclusion, directory-only separation, and factual (never opaque) ranking.
 */

function marker(overrides: Partial<ClubMapMarker> = {}): ClubMapMarker {
  return {
    directoryId: "dir-1",
    clubId: "club-1",
    name: "Preston Grasshoppers",
    rugbyCode: "union",
    town: "Preston",
    county: "Lancashire",
    postcode: "PR2 1AB",
    latitude: 53.77,
    longitude: -2.7,
    hasLocation: true,
    locationPrecision: "postcode",
    logoUrl: null,
    slug: "preston-grasshoppers",
    isOwnClub: false,
    networkState: "on_ovalball",
    partnershipStatus: "none",
    partnershipId: null,
    ...overrides,
  }
}

function candidate(overrides: Partial<FindFixtureCandidate> = {}): FindFixtureCandidate {
  return { ...marker(), compatibleTeams: [{ teamId: "team-1", displayName: "Under 12 Boys", ageGroup: "U12", gender: "MALE" }], ...overrides }
}

// ---------------------------------------------------------------------------------------------
// groupCandidateTeamsByClub
// ---------------------------------------------------------------------------------------------

test("groupCandidateTeamsByClub groups multiple compatible teams at the same club under one entry -- Burnley is not returned five times", () => {
  const rows = [
    { team_id: "t1", club_id: "club-a", display_name: "Under 12 Boys", age_group: "U12", gender: "MALE" },
    { team_id: "t2", club_id: "club-a", display_name: "Under 12 Girls", age_group: "U12", gender: "FEMALE" },
    { team_id: "t3", club_id: "club-b", display_name: "Under 12 Boys", age_group: "U12", gender: "MALE" },
  ]
  const grouped = groupCandidateTeamsByClub(rows)
  assert.equal(grouped.size, 2)
  assert.equal(grouped.get("club-a")?.length, 2)
  assert.equal(grouped.get("club-b")?.length, 1)
})

test("groupCandidateTeamsByClub's per-team shape is exactly the four-field CompatibleTeam projection -- no roster leakage here either", () => {
  const rows = [{ team_id: "t1", club_id: "club-a", display_name: "Under 12 Boys", age_group: "U12", gender: "MALE" }]
  const team = groupCandidateTeamsByClub(rows).get("club-a")?.[0]
  assert.deepEqual(Object.keys(team!).sort(), ["ageGroup", "displayName", "gender", "teamId"])
})

// ---------------------------------------------------------------------------------------------
// buildFindFixtureCandidates
// ---------------------------------------------------------------------------------------------

test("buildFindFixtureCandidates: a compatible team at another Ovalball club becomes an actionable candidate", () => {
  const markers = [marker({ clubId: "club-a", name: "Burnley RUFC" })]
  const rows = [{ team_id: "t1", club_id: "club-a", display_name: "Under 12 Boys", age_group: "U12", gender: "MALE" }]
  const result = buildFindFixtureCandidates(markers, rows, "union")
  assert.equal(result.actionable.length, 1)
  assert.equal(result.actionable[0]!.compatibleTeams.length, 1)
})

test("buildFindFixtureCandidates: the searching club's own marker is never an actionable candidate, even if (hypothetically) the RPC returned it", () => {
  const markers = [marker({ clubId: "club-own", isOwnClub: true })]
  const rows = [{ team_id: "t1", club_id: "club-own", display_name: "Under 12 Boys", age_group: "U12", gender: "MALE" }]
  const result = buildFindFixtureCandidates(markers, rows, "union")
  assert.equal(result.actionable.length, 0)
})

test("buildFindFixtureCandidates: a directory-only club (no clubId) is never actionable, whatever rows exist", () => {
  const markers = [marker({ clubId: null, networkState: "not_on_ovalball" })]
  const result = buildFindFixtureCandidates(markers, [], "union")
  assert.equal(result.actionable.length, 0)
})

test("buildFindFixtureCandidates: an Ovalball club with NO compatible team row is excluded from actionable, not shown with an empty team list", () => {
  const markers = [marker({ clubId: "club-a" })]
  const result = buildFindFixtureCandidates(markers, [], "union")
  assert.equal(result.actionable.length, 0)
})

test("buildFindFixtureCandidates: directory-only results are the SAME rugby code as the searching team, and never mixed with actionable results", () => {
  const markers = [
    marker({ clubId: null, name: "Truro RFC", networkState: "not_on_ovalball", rugbyCode: "union" }),
    marker({ clubId: null, name: "Some League Club", networkState: "not_on_ovalball", rugbyCode: "league" }),
    marker({ clubId: "club-a", name: "Burnley RUFC" }),
  ]
  const rows = [{ team_id: "t1", club_id: "club-a", display_name: "Under 12 Boys", age_group: "U12", gender: "MALE" }]
  const result = buildFindFixtureCandidates(markers, rows, "union")
  assert.equal(result.directoryOnly.length, 1)
  assert.equal(result.directoryOnly[0]!.name, "Truro RFC")
  assert.ok(!result.actionable.some((c) => c.networkState === "not_on_ovalball"), "actionable never contains a directory-only club")
})

test("buildFindFixtureCandidates: an unrecorded searching-team rugby code yields NO directory-only list -- never treated as 'any code matches', which would risk mixing Union and League", () => {
  const markers = [marker({ clubId: null, networkState: "not_on_ovalball", rugbyCode: "league" })]
  const result = buildFindFixtureCandidates(markers, [], null)
  assert.equal(result.directoryOnly.length, 0)
})

test("buildFindFixtureCandidates: partnership status is carried through untouched -- an active partner is still shown as one", () => {
  const markers = [marker({ clubId: "club-a", partnershipStatus: "active", partnershipId: "p1" })]
  const rows = [{ team_id: "t1", club_id: "club-a", display_name: "Under 12 Boys", age_group: "U12", gender: "MALE" }]
  const result = buildFindFixtureCandidates(markers, rows, "union")
  assert.equal(result.actionable[0]!.partnershipStatus, "active")
})

test("buildFindFixtureCandidates: UNKNOWN partnership status is never turned into 'none' or 'active' by grouping", () => {
  const markers = [marker({ clubId: "club-a", partnershipStatus: "unknown" })]
  const rows = [{ team_id: "t1", club_id: "club-a", display_name: "Under 12 Boys", age_group: "U12", gender: "MALE" }]
  const result = buildFindFixtureCandidates(markers, rows, "union")
  assert.equal(result.actionable[0]!.partnershipStatus, "unknown")
})

// ---------------------------------------------------------------------------------------------
// sortFindFixtureCandidates -- never an opaque score
// ---------------------------------------------------------------------------------------------

test("sortFindFixtureCandidates 'club_name' is plain alphabetical", () => {
  const candidates = [candidate({ name: "Zebra RFC" }), candidate({ name: "Alpha RFC" })]
  const sorted = sortFindFixtureCandidates(candidates, "club_name", null)
  assert.deepEqual(sorted.map((c) => c.name), ["Alpha RFC", "Zebra RFC"])
})

test("sortFindFixtureCandidates 'partners_first' puts active partners before everyone else, alphabetical within each group", () => {
  const candidates = [
    candidate({ name: "Zebra RFC", partnershipStatus: "none" }),
    candidate({ name: "Alpha RFC", partnershipStatus: "active" }),
    candidate({ name: "Burnley RFC", partnershipStatus: "pending_outgoing" }),
  ]
  const sorted = sortFindFixtureCandidates(candidates, "partners_first", null)
  assert.deepEqual(sorted.map((c) => c.name), ["Alpha RFC", "Burnley RFC", "Zebra RFC"])
})

test("sortFindFixtureCandidates 'nearest' orders by factual distance from the given origin, closest first", () => {
  const origin = marker({ latitude: 53.0, longitude: -2.0 })
  const near = candidate({ name: "Near RFC", latitude: 53.01, longitude: -2.0 })
  const far = candidate({ name: "Far RFC", latitude: 54.0, longitude: -2.0 })
  const sorted = sortFindFixtureCandidates([far, near], "nearest", origin)
  assert.deepEqual(sorted.map((c) => c.name), ["Near RFC", "Far RFC"])
})

test("sortFindFixtureCandidates 'nearest' with no factual origin degrades to alphabetical, never a fabricated distance order", () => {
  const candidates = [candidate({ name: "Zebra RFC" }), candidate({ name: "Alpha RFC" })]
  const sorted = sortFindFixtureCandidates(candidates, "nearest", null)
  assert.deepEqual(sorted.map((c) => c.name), ["Alpha RFC", "Zebra RFC"])
})

test("sortFindFixtureCandidates 'nearest': a candidate with unknown distance always sorts after every candidate with a known one, never implying it is nearby", () => {
  const origin = marker({ latitude: 53.0, longitude: -2.0 })
  const known = candidate({ name: "Known RFC", latitude: 53.01, longitude: -2.0, hasLocation: true })
  const unknown = candidate({ name: "Aardvark RFC", latitude: null, longitude: null, hasLocation: false })
  const sorted = sortFindFixtureCandidates([unknown, known], "nearest", origin)
  assert.deepEqual(sorted.map((c) => c.name), ["Known RFC", "Aardvark RFC"])
})

// ---------------------------------------------------------------------------------------------
// applyFindFixturePartnerFilter
// ---------------------------------------------------------------------------------------------

test("applyFindFixturePartnerFilter 'partners' keeps only ACTIVE partnerships, matching applyClubhouseFilter unchanged", () => {
  const candidates = [candidate({ partnershipStatus: "active" }), candidate({ partnershipStatus: "pending_incoming" }), candidate({ partnershipStatus: "none" })]
  const filtered = applyFindFixturePartnerFilter(candidates, "partners")
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0]!.partnershipStatus, "active")
})

test("applyFindFixturePartnerFilter 'all' is a no-op", () => {
  const candidates = [candidate({ partnershipStatus: "active" }), candidate({ partnershipStatus: "none" })]
  assert.equal(applyFindFixturePartnerFilter(candidates, "all").length, 2)
})

// ---------------------------------------------------------------------------------------------
// applyFindFixtureNetworkFilter -- FF-3's four real network filter chips (visual-lock Job 1)
// ---------------------------------------------------------------------------------------------

function networkFixture() {
  return {
    actionable: [
      candidate({ name: "Partner RFC", partnershipStatus: "active" }),
      candidate({ name: "None RFC", partnershipStatus: "none" }),
      candidate({ name: "Pending Out RFC", partnershipStatus: "pending_outgoing" }),
      candidate({ name: "Pending In RFC", partnershipStatus: "pending_incoming" }),
      candidate({ name: "Unknown RFC", partnershipStatus: "unknown" }),
    ],
    directoryOnly: [marker({ clubId: null, name: "Not On Ovalball RFC", networkState: "not_on_ovalball" })],
  }
}

test("applyFindFixtureNetworkFilter 'all' keeps every actionable candidate AND every directory-only club -- the full legitimate population", () => {
  const result = applyFindFixtureNetworkFilter(networkFixture(), "all")
  assert.equal(result.actionable.length, 5)
  assert.equal(result.directoryOnly.length, 1)
})

test("applyFindFixtureNetworkFilter 'partners' keeps only an ACTIVE partnership, and drops directory-only entirely", () => {
  const result = applyFindFixtureNetworkFilter(networkFixture(), "partners")
  assert.deepEqual(result.actionable.map((c) => c.name), ["Partner RFC"])
  assert.equal(result.directoryOnly.length, 0)
})

test("applyFindFixtureNetworkFilter 'not_yet_partnered' keeps none/pending_outgoing/pending_incoming/unknown -- UNKNOWN is never silently dropped or treated as already partnered", () => {
  const result = applyFindFixtureNetworkFilter(networkFixture(), "not_yet_partnered")
  assert.deepEqual(
    result.actionable.map((c) => c.name).sort(),
    ["None RFC", "Pending In RFC", "Pending Out RFC", "Unknown RFC"].sort()
  )
  assert.ok(result.actionable.some((c) => c.partnershipStatus === "unknown"), "unknown partnership status survives this filter, never collapsed into 'none'")
  assert.equal(result.directoryOnly.length, 0)
})

test("applyFindFixtureNetworkFilter 'not_on_ovalball' returns ONLY the existing directory-only population, never fabricating one from actionable candidates", () => {
  const result = applyFindFixtureNetworkFilter(networkFixture(), "not_on_ovalball")
  assert.equal(result.actionable.length, 0)
  assert.deepEqual(result.directoryOnly.map((m) => m.name), ["Not On Ovalball RFC"])
})

test("applyFindFixtureNetworkFilter never mutates the arrays it was given", () => {
  const fixture = networkFixture()
  const before = { actionable: fixture.actionable.length, directoryOnly: fixture.directoryOnly.length }
  applyFindFixtureNetworkFilter(fixture, "partners")
  assert.equal(fixture.actionable.length, before.actionable)
  assert.equal(fixture.directoryOnly.length, before.directoryOnly)
})

// ---------------------------------------------------------------------------------------------
// MAP AND LIST SHARE ONE POPULATION -- a FindFixtureCandidate is a ClubMapMarker, so the EXISTING
// marker feature-collection builder (Section 2) works on candidates unchanged, never a second map.
// ---------------------------------------------------------------------------------------------

test("a FindFixtureCandidate list feeds the existing shared map marker builder directly, with no second map/marker implementation", () => {
  const candidates = [candidate({ hasLocation: true }), candidate({ hasLocation: false, latitude: null, longitude: null })]
  const collection = buildClubMarkerFeatureCollection(candidates)
  assert.equal(collection.features.length, 1, "only the located candidate becomes a map feature, same rule as the main Clubhouse map")
})

// ---------------------------------------------------------------------------------------------
// nextWeekdayDates -- a plain, unambiguous calculation, never a rugby-schedule inference.
// ---------------------------------------------------------------------------------------------

test("nextWeekdayDates: from a Wednesday, the next 3 Saturdays are the following Saturday plus two more weeks", () => {
  // 2026-10-07 is a Wednesday.
  assert.deepEqual(nextWeekdayDates("2026-10-07", 6, 3), ["2026-10-10", "2026-10-17", "2026-10-24"])
})

test("nextWeekdayDates: FROM a Saturday itself, the next Saturday is seven days later, never the same day", () => {
  // 2026-10-10 is itself a Saturday.
  assert.deepEqual(nextWeekdayDates("2026-10-10", 6, 1), ["2026-10-17"])
})

test("nextWeekdayDates: capped at 6, whatever count is requested", () => {
  assert.equal(nextWeekdayDates("2026-10-07", 6, 20).length, 6)
})

test("nextWeekdayDates: Sunday (isoWeekday 7) is computed correctly too, not just Saturday", () => {
  // 2026-10-07 is a Wednesday; the next Sunday is 2026-10-11.
  assert.deepEqual(nextWeekdayDates("2026-10-07", 7, 1), ["2026-10-11"])
})

// ---------------------------------------------------------------------------------------------
// FF-1 (Find a Fixture Home, mock-up reconciliation): the shared search-session model's own pure
// logic -- multi-team/multi-date selection, and the CTA's own validation rule.
// ---------------------------------------------------------------------------------------------

test("toggleSelection: adds a value not yet present, and removes it if it already is -- one team can be selected, then another, then the first deselected", () => {
  let ids: string[] = []
  ids = toggleSelection(ids, "team-1")
  assert.deepEqual(ids, ["team-1"], "one team can be selected")
  ids = toggleSelection(ids, "team-2")
  assert.deepEqual(ids, ["team-1", "team-2"], "multiple teams can be selected")
  ids = toggleSelection(ids, "team-1")
  assert.deepEqual(ids, ["team-2"], "team deselection works, leaving the other selected team intact")
})

test("dedupeFindFixtureDates: sorted, deduplicated, and capped at 6 -- the exact bound find_fixture_candidate_availability enforces server-side", () => {
  assert.deepEqual(dedupeFindFixtureDates(["2026-10-17", "2026-10-10", "2026-10-10"]), ["2026-10-10", "2026-10-17"], "multiple selected dates persist, deduplicated and sorted")
  const many = ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]
  assert.equal(dedupeFindFixtureDates(many).length, 6, "never more than 6 dates, whatever was selected")
})

test("canSearchFindFixtureCriteria: the CTA cannot proceed without at least one selected date AND at least one selected team", () => {
  assert.equal(canSearchFindFixtureCriteria({ teamIds: [], dates: [] }), false, "neither a team nor a date selected")
  assert.equal(canSearchFindFixtureCriteria({ teamIds: ["team-1"], dates: [] }), false, "the CTA cannot proceed without a date, even with a real team selected")
  assert.equal(canSearchFindFixtureCriteria({ teamIds: [], dates: ["2026-10-10"] }), false, "the CTA cannot proceed without a team, even with a real date selected")
  assert.equal(canSearchFindFixtureCriteria({ teamIds: ["team-1"], dates: ["2026-10-10"] }), true, "valid criteria (>=1 team, >=1 date) hands off correctly")
  assert.equal(canSearchFindFixtureCriteria({ teamIds: ["team-1", "team-2"], dates: ["2026-10-10"] }), true, "multiple selected teams still hand off correctly")
})

// ---------------------------------------------------------------------------------------------
// FF-1.1/FF-2: the real multi-team batched read model's own client-side arithmetic. The canonical
// compatibility/authority/no-widening rule for the batched RPCs themselves lives entirely server-side
// and is proven by `supabase/tests/find_fixture_candidates_batch.sql` -- these assertions cover the
// grouping and aggregation this module adds on top: per-club "N/M teams matched", never a per-team
// duplicate, and never a fabricated match for a team that found nothing.
// ---------------------------------------------------------------------------------------------

type BatchRow = { my_team_id: string; team_id: string; club_id: string; display_name: string; age_group: string | null; gender: string | null }

test("groupBatchCandidateTeamsByClub: one club with two of the caller's selected teams matched gets both teams recorded, deduplicated compatible-team list", () => {
  const rows: BatchRow[] = [
    { my_team_id: "my-u12", team_id: "opp-u12", club_id: "club-a", display_name: "Under 12 Boys", age_group: "U12", gender: "MALE" },
    { my_team_id: "my-u16", team_id: "opp-u16", club_id: "club-a", display_name: "Under 16 Boys", age_group: "U16", gender: "MALE" },
  ]
  const grouped = groupBatchCandidateTeamsByClub(rows)
  const clubA = grouped.get("club-a")!
  assert.equal(clubA.compatibleTeams.length, 2, "both compatible opposition teams are present, not collapsed into one")
  assert.deepEqual([...clubA.matchedTeamIds].sort(), ["my-u12", "my-u16"], "both of the caller's own selected teams are recorded as matched at this club")
})

test("groupBatchCandidateTeamsByClub: a club matched by only ONE of the caller's selected teams records only that one, never the unmatched team", () => {
  const rows: BatchRow[] = [{ my_team_id: "my-u12", team_id: "opp-u12", club_id: "club-a", display_name: "Under 12 Boys", age_group: "U12", gender: "MALE" }]
  const grouped = groupBatchCandidateTeamsByClub(rows)
  assert.deepEqual([...grouped.get("club-a")!.matchedTeamIds], ["my-u12"], "only the team that actually matched is recorded -- never the other selected team the RPC never returned a row for")
})

test("buildFindFixtureMatches: matchedTeamIds preserves the caller's own selection order, and 'N/M matched' is the real subset, not a count invented from row totals", () => {
  const markers = [marker({ clubId: "club-a", isOwnClub: false })]
  const rows: BatchRow[] = [
    { my_team_id: "my-u16", team_id: "opp-u16", club_id: "club-a", display_name: "Under 16 Boys", age_group: "U16", gender: "MALE" },
    { my_team_id: "my-u12", team_id: "opp-u12", club_id: "club-a", display_name: "Under 12 Boys", age_group: "U12", gender: "MALE" },
  ]
  const result = buildFindFixtureMatches(markers, rows, "union", ["my-u12", "my-u16", "my-u10"])
  const clubA = result.actionable[0]!
  assert.deepEqual(clubA.matchedTeamIds, ["my-u12", "my-u16"], "matched teams are in the CALLER's own selection order, not the RPC's row order, and never include the unmatched my-u10")
  assert.equal(matchedTeamCountLabel(clubA, 3), "2/3 matched", "the real matched-count label, computed from the actual subset")
})

test("buildFindFixtureMatches: the searching club is always excluded, even from the batched multi-team form", () => {
  const markers = [marker({ clubId: "own-club", isOwnClub: true })]
  const rows: BatchRow[] = [{ my_team_id: "my-u12", team_id: "opp-u12", club_id: "own-club", display_name: "Under 12 Boys", age_group: "U12", gender: "MALE" }]
  const result = buildFindFixtureMatches(markers, rows, "union", ["my-u12"])
  assert.equal(result.actionable.length, 0)
})

test("findFixtureDateClause: one date names it directly, several are described as 'across N possible dates' -- never implying only an all-dates match is possible", () => {
  assert.equal(findFixtureDateClause(1, "Sat 26 Sep 2026"), "on Sat 26 Sep 2026")
  assert.equal(findFixtureDateClause(3, ""), "across 3 possible dates")
})

test("findFixtureMatchingCopy: one selected team is named directly; several are described as 'your N selected teams', never claiming only full matches will be returned", () => {
  assert.equal(
    findFixtureMatchingCopy(1, "Men's 1st Team", "on Sat 26 Sep 2026"),
    "We're finding clubs with compatible opposition for Men's 1st Team on Sat 26 Sep 2026."
  )
  assert.equal(
    findFixtureMatchingCopy(3, null, "across 2 possible dates"),
    "We're finding clubs with compatible teams for your 3 selected teams across 2 possible dates."
  )
})

// ---------------------------------------------------------------------------------------------
// FF-3 visual-lock pass: result-count grammar, per-club availability aggregation, and the three named
// sort modes. The canonical busy/request_pending/absent-means-no-known-clash RULE lives entirely
// server-side (Section 7); these assertions cover the arithmetic this screen adds on top -- rolling
// per-(my_team_id, date) rows up into one honest per-club summary, and never upgrading a coarsened
// no_known_clash into a confirmed "Available".
// ---------------------------------------------------------------------------------------------

function candidateMatch(overrides: Partial<FindFixtureCandidateMatch> = {}): FindFixtureCandidateMatch {
  return { ...candidate(), matchedTeamIds: ["my-1"], ...overrides }
}

test("findFixtureResultCountLabel: 0/1/N grammar", () => {
  assert.equal(findFixtureResultCountLabel(0), "0 clubs")
  assert.equal(findFixtureResultCountLabel(1), "1 club")
  assert.equal(findFixtureResultCountLabel(12), "12 clubs")
})

test("summariseFindFixtureClubAvailability: a matched team with NO availability row for the date reads no_known_clash, never a fabricated status", () => {
  const c = candidateMatch({ partnershipStatus: "active", matchedTeamIds: ["my-1"] })
  const summary = summariseFindFixtureClubAvailability(c, 3, "2026-10-10", [])
  assert.deepEqual(summary, { matchedCount: 1, totalSelected: 3, noKnownClashCount: 1, busyCount: 0, tentativeCount: 0, unknownCount: 0 })
})

test("summariseFindFixtureClubAvailability: busy remains busy, request_pending remains tentative, per matched team", () => {
  const c = candidateMatch({ partnershipStatus: "active", matchedTeamIds: ["my-1", "my-2"] })
  const summary = summariseFindFixtureClubAvailability(c, 2, "2026-10-10", [
    { my_team_id: "my-1", opponent_team_id: "team-1", the_date: "2026-10-10", status: "busy" },
    { my_team_id: "my-2", opponent_team_id: "team-1", the_date: "2026-10-10", status: "request_pending" },
  ])
  assert.equal(summary.busyCount, 1)
  assert.equal(summary.tentativeCount, 1)
  assert.equal(summary.noKnownClashCount, 0)
})

test("summariseFindFixtureClubAvailability: a non-partner club is UNKNOWN on every matched team, even if a (hypothetical) row would say busy -- it is never even consulted", () => {
  const c = candidateMatch({ partnershipStatus: "none", matchedTeamIds: ["my-1"] })
  const summary = summariseFindFixtureClubAvailability(c, 1, "2026-10-10", [{ my_team_id: "my-1", opponent_team_id: "team-1", the_date: "2026-10-10", status: "busy" }])
  assert.deepEqual(summary, { matchedCount: 1, totalSelected: 1, noKnownClashCount: 0, busyCount: 0, tentativeCount: 0, unknownCount: 1 })
})

test("findFixtureAvailabilitySummaryLabel: all clear reads 'N/N no known clash', never the bare word 'Available'", () => {
  const label = findFixtureAvailabilitySummaryLabel({ matchedCount: 3, totalSelected: 3, noKnownClashCount: 3, busyCount: 0, tentativeCount: 0, unknownCount: 0 })
  assert.equal(label, "3/3 no known clash")
  assert.ok(!label.includes("Available"), "a coarsened no_known_clash must never be presented as a confirmed 'Available'")
})

test("findFixtureAvailabilitySummaryLabel: all busy reads 'Busy'; a non-partner club reads 'Availability unknown'", () => {
  assert.equal(findFixtureAvailabilitySummaryLabel({ matchedCount: 2, totalSelected: 2, noKnownClashCount: 0, busyCount: 2, tentativeCount: 0, unknownCount: 0 }), "Busy")
  assert.equal(findFixtureAvailabilitySummaryLabel({ matchedCount: 2, totalSelected: 2, noKnownClashCount: 0, busyCount: 0, tentativeCount: 0, unknownCount: 2 }), "Availability unknown")
})

test("findFixtureAvailabilitySummaryLabel: mixed coverage is described honestly, part by part", () => {
  const label = findFixtureAvailabilitySummaryLabel({ matchedCount: 3, totalSelected: 3, noKnownClashCount: 2, busyCount: 1, tentativeCount: 0, unknownCount: 0 })
  assert.equal(label, "2 clear · 1 busy")
})

test("sortFindFixtureMatches 'best_match': the club matching MORE of the caller's selected teams sorts first, ahead of a nearer club with fewer matches", () => {
  const near = candidateMatch({ clubId: "club-near", name: "Near Club", latitude: 53.7, longitude: -2.7, hasLocation: true, matchedTeamIds: ["my-1"] })
  const far = candidateMatch({ clubId: "club-far", name: "Far Club", latitude: 54.5, longitude: -3.5, hasLocation: true, matchedTeamIds: ["my-1", "my-2"] })
  const origin = { latitude: 53.77, longitude: -2.7 }
  const summaries = new Map([
    ["club-near", toSortSummary({ matchedCount: 1, noKnownClashCount: 1 })],
    ["club-far", toSortSummary({ matchedCount: 2, noKnownClashCount: 2 })],
  ])
  const sorted = sortFindFixtureMatches([near, far], "best_match", origin, summaries)
  assert.deepEqual(sorted.map((c) => c.clubId), ["club-far", "club-near"])
})

test("sortFindFixtureMatches 'most_clear': ranked by clear-availability coverage alone", () => {
  const a = candidateMatch({ clubId: "club-a", name: "A" })
  const b = candidateMatch({ clubId: "club-b", name: "B" })
  const summaries = new Map([
    ["club-a", toSortSummary({ matchedCount: 1, noKnownClashCount: 0 })],
    ["club-b", toSortSummary({ matchedCount: 1, noKnownClashCount: 1 })],
  ])
  const sorted = sortFindFixtureMatches([a, b], "most_clear", null, summaries)
  assert.deepEqual(sorted.map((c) => c.clubId), ["club-b", "club-a"])
})

test("sortFindFixtureMatches 'nearest': delegates to the same distance rule every other Clubhouse sort uses -- unknown distance always sorts last", () => {
  const known = candidateMatch({ clubId: "club-known", name: "Known", latitude: 53.8, longitude: -2.8, hasLocation: true })
  const unknown = candidateMatch({ clubId: "club-unknown", name: "Unknown", hasLocation: false, latitude: null, longitude: null })
  const origin = { latitude: 53.77, longitude: -2.7 }
  const sorted = sortFindFixtureMatches([unknown, known], "nearest", origin, new Map())
  assert.deepEqual(sorted.map((c) => c.clubId), ["club-known", "club-unknown"])
})

// ---------------------------------------------------------------------------------------------
// GAME WEEK (visual-lock Section A5-A13): Monday-Sunday boundaries, per-team and per-club week-aware
// summaries. The canonical busy/cancelled/source-narrowing RULE lives entirely server-side and is
// proven by supabase/tests/find_fixture_game_week.sql -- these assertions cover the arithmetic this
// module adds on top: rolling a game-week row set into an honest per-team and per-club picture.
// ---------------------------------------------------------------------------------------------

test("gameWeekRange: a selected Sunday's game week is the PRECEDING Monday through that same Sunday -- never Sunday-to-Saturday", () => {
  assert.deepEqual(gameWeekRange("2026-10-11"), { start: "2026-10-05", end: "2026-10-11" })
})

test("gameWeekRange: a selected Friday is in the SAME game week as the Sunday that follows it", () => {
  const friday = gameWeekRange("2026-10-09")
  const sunday = gameWeekRange("2026-10-11")
  assert.deepEqual(friday, sunday)
})

test("gameWeekRange: a selected Monday's own game week starts on itself", () => {
  assert.deepEqual(gameWeekRange("2026-10-05"), { start: "2026-10-05", end: "2026-10-11" })
})

// The TEST DATE this whole UAT world is built around: Saturday 2026-10-17, whose own game week runs
// Monday 2026-10-12 through Sunday 2026-10-18.
test("withinGameWeek: the day before the week's own Monday is OUTSIDE", () => {
  assert.equal(withinGameWeek("2026-10-11", "2026-10-17"), false)
})

test("withinGameWeek: the week's own Monday is INSIDE", () => {
  assert.equal(withinGameWeek("2026-10-12", "2026-10-17"), true)
})

test("withinGameWeek: a Friday inside the week is INSIDE", () => {
  assert.equal(withinGameWeek("2026-10-16", "2026-10-17"), true)
})

test("withinGameWeek: the requested Saturday itself is INSIDE", () => {
  assert.equal(withinGameWeek("2026-10-17", "2026-10-17"), true)
})

test("withinGameWeek: the week's own Sunday is INSIDE", () => {
  assert.equal(withinGameWeek("2026-10-18", "2026-10-17"), true)
})

test("withinGameWeek: the FOLLOWING Monday is OUTSIDE again -- never leaks into the next week", () => {
  assert.equal(withinGameWeek("2026-10-19", "2026-10-17"), false)
})

test("gameWeekRangesForDates: two dates in the same week collapse to one range; two dates in different weeks give two, sorted", () => {
  assert.equal(gameWeekRangesForDates(["2026-10-09", "2026-10-11"]).length, 1)
  const ranges = gameWeekRangesForDates(["2026-10-11", "2026-10-05"])
  assert.equal(ranges.length, 1)
  const spanning = gameWeekRangesForDates(["2026-10-11", "2026-10-19"])
  assert.equal(spanning.length, 2)
  assert.ok(spanning[0]!.start < spanning[1]!.start)
})

test("summariseFindFixtureTeamWeek: a real commitment elsewhere in the week is surfaced, excluding the requested date itself", () => {
  const weekRows = [
    { my_team_id: "my-1", opponent_team_id: "opp-1", commitment_date: "2026-10-16" },
    { my_team_id: "my-1", opponent_team_id: "opp-1", commitment_date: "2026-10-17" }, // the requested date -- excluded here, it is `dateState`'s own job
  ]
  const summary = summariseFindFixtureTeamWeek("no_known_clash", "2026-10-17", "my-1", "opp-1", weekRows)
  assert.deepEqual(summary.otherWeekCommitments, ["2026-10-16"])
})

test("findFixtureWeekLabel: busy on the exact date wins outright; a clear exact date with a real week commitment reads 'Busy this week' with the raw date; otherwise falls through to the plain exact-date label", () => {
  assert.deepEqual(findFixtureWeekLabel({ dateState: "busy", otherWeekCommitments: [] }), { primary: "Busy", detail: null })
  assert.deepEqual(findFixtureWeekLabel({ dateState: "no_known_clash", otherWeekCommitments: ["2026-10-16"] }), { primary: "Busy this week", detail: "2026-10-16" })
  assert.deepEqual(findFixtureWeekLabel({ dateState: "tentative", otherWeekCommitments: [] }), { primary: "Tentative", detail: null })
  assert.deepEqual(findFixtureWeekLabel({ dateState: "unknown", otherWeekCommitments: [] }), { primary: "Availability unknown", detail: null })
  assert.deepEqual(findFixtureWeekLabel({ dateState: "no_known_clash", otherWeekCommitments: [] }), { primary: "No known clash", detail: null })
})

test("summariseFindFixtureClubWeek: a matched team clear on the exact date but with a real commitment elsewhere in the week is NOT counted as clear", () => {
  const c = candidateMatch({ partnershipStatus: "active", matchedTeamIds: ["my-1"], compatibleTeams: [{ teamId: "opp-1", displayName: "Under 16 Boys", ageGroup: "U16", gender: "MALE" }] })
  const weekSummary = summariseFindFixtureClubWeek(c, 1, "2026-10-17", [], [{ my_team_id: "my-1", opponent_team_id: "opp-1", commitment_date: "2026-10-16" }])
  assert.equal(weekSummary.noKnownClashCount, 1, "the raw exact-date count is unaffected")
  assert.equal(weekSummary.weekBusyCount, 1, "but the week conflict is recorded separately")
})

test("findFixtureClubWeekLabel: all genuinely clear all week reads 'No known clash'; a real week commitment on an otherwise-clear team still counts as busy for the club pill", () => {
  const allClear = summariseFindFixtureClubWeek(
    candidateMatch({ partnershipStatus: "active", matchedTeamIds: ["my-1"], compatibleTeams: [{ teamId: "opp-1", displayName: "U16", ageGroup: "U16", gender: "MALE" }] }),
    1,
    "2026-10-17",
    [],
    []
  )
  assert.equal(findFixtureClubWeekLabel(allClear), "No known clash")

  const weekConflict = summariseFindFixtureClubWeek(
    candidateMatch({ partnershipStatus: "active", matchedTeamIds: ["my-1"], compatibleTeams: [{ teamId: "opp-1", displayName: "U16", ageGroup: "U16", gender: "MALE" }] }),
    1,
    "2026-10-17",
    [],
    [{ my_team_id: "my-1", opponent_team_id: "opp-1", commitment_date: "2026-10-16" }]
  )
  assert.equal(findFixtureClubWeekLabel(weekConflict), "1 busy")
})

test("findFixtureClubWeekLabel: a genuine split between a clear team and a busy team reads 'Mixed', matching Section A10's own third worked example", () => {
  const c = candidateMatch({
    partnershipStatus: "active",
    matchedTeamIds: ["my-1", "my-2"],
    compatibleTeams: [
      { teamId: "opp-1", displayName: "Men's 1st", ageGroup: null, gender: "MALE" },
      { teamId: "opp-2", displayName: "U16", ageGroup: "U16", gender: "MALE" },
    ],
  })
  const summary = summariseFindFixtureClubWeek(c, 2, "2026-10-17", [{ my_team_id: "my-1", opponent_team_id: "opp-1", the_date: "2026-10-17", status: "busy" }], [])
  assert.equal(findFixtureClubWeekLabel(summary), "Mixed")
})

test("otherWeekCommitmentsForOpponent: the Public Club Profile's Availability tab asks the same question regardless of which of the viewer's own teams matched -- matched by opponent team alone, sorted, excluding the requested date itself", () => {
  const weekRows = [
    { my_team_id: "my-1", opponent_team_id: "opp-1", commitment_date: "2026-10-17" }, // the requested date -- excluded
    { my_team_id: "my-2", opponent_team_id: "opp-1", commitment_date: "2026-10-16" }, // a DIFFERENT viewer team, same opponent -- still counts
    { my_team_id: "my-1", opponent_team_id: "opp-2", commitment_date: "2026-10-15" }, // a different opponent -- never counts for opp-1
  ]
  assert.deepEqual(otherWeekCommitmentsForOpponent("opp-1", "2026-10-17", weekRows), ["2026-10-16"])
})
