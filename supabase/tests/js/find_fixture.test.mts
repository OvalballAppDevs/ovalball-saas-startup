import { test } from "node:test"
import assert from "node:assert/strict"

import {
  applyFindFixturePartnerFilter,
  buildFindFixtureCandidates,
  buildFindFixtureMatches,
  buildClubMarkerFeatureCollection,
  canSearchFindFixtureCriteria,
  dedupeFindFixtureDates,
  findFixtureDateClause,
  findFixtureMatchingCopy,
  groupBatchCandidateTeamsByClub,
  groupCandidateTeamsByClub,
  matchedTeamCountLabel,
  nextWeekdayDates,
  sortFindFixtureCandidates,
  toggleSelection,
  type ClubMapMarker,
  type FindFixtureCandidate,
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
