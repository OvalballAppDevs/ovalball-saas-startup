import { test } from "node:test"
import assert from "node:assert/strict"

import { orderClubTeamsForDisplay, pickCurrentSeason, type CanonicalSeason } from "./data.ts"

/**
 * PINS the presentation order the product owner corrected Training Planning Home to (Training
 * Planning brief, page-1 follow-up): senior teams first, then every age grade oldest-to-youngest --
 * never database/API insertion order, never alphabetical. `orderClubTeamsForDisplay` is the pure
 * merge step of `loadOrderedClubTeams`, which both Training Planning Home and the Create Plan wizard's
 * team selector call -- one canonical order, proven once here rather than per screen. The ordering
 * itself is `sortTeamsInRugbyAgeOrder`'s own job and is already pinned in
 * `supabase/tests/js/club_teams_ordering.test.mts`; this test exists to catch a *Training-Planning-side*
 * regression -- e.g. a future edit that re-sorts by display_name after merging in cover photos, or
 * drops the sort call entirely -- not to re-prove the sorter itself.
 */
function team(overrides: Partial<{ id: string; displayName: string; category: "senior" | "youth" | "colts"; ageGroup: string | null; active: boolean }> = {}) {
  return {
    id: overrides.id ?? "id",
    displayName: overrides.displayName ?? "Team",
    fullLabel: overrides.displayName ?? "Team",
    compactLabel: overrides.displayName ?? "Team",
    category: overrides.category ?? "youth",
    ageGroup: overrides.ageGroup ?? "U12",
    gender: null,
    squadDesignation: null,
    rugbyCode: "union" as const,
    canonicalTeamTypeId: null,
    canonicalKey: null,
    alias: null,
    active: overrides.active ?? true,
    foldedAt: null,
    foldReason: null,
  }
}

test("orderClubTeamsForDisplay: Burnley-shaped roster reads Men's 1st Team first, then descending age grades", () => {
  const teams = [
    team({ id: "u10", displayName: "Under 10 Mixed", category: "youth", ageGroup: "U10" }),
    team({ id: "u12", displayName: "Under 12 Boys", category: "youth", ageGroup: "U12" }),
    team({ id: "w1", displayName: "Women's 1st Team", category: "senior", ageGroup: null }),
    team({ id: "m1", displayName: "Men's 1st Team", category: "senior", ageGroup: null }),
    team({ id: "m2", displayName: "Men's 2nd Team", category: "senior", ageGroup: null }),
  ]
  const ordered = orderClubTeamsForDisplay(teams, [])
  assert.deepEqual(
    ordered.map((t) => t.displayName),
    ["Men's 1st Team", "Men's 2nd Team", "Women's 1st Team", "Under 12 Boys", "Under 10 Mixed"]
  )
})

test("orderClubTeamsForDisplay: an inactive team is excluded entirely, not just sorted last", () => {
  const teams = [team({ id: "active", displayName: "Under 12 Boys", active: true }), team({ id: "gone", displayName: "Folded Under 14 Boys", active: false })]
  const ordered = orderClubTeamsForDisplay(teams, [])
  assert.deepEqual(
    ordered.map((t) => t.teamId),
    ["active"]
  )
})

test("orderClubTeamsForDisplay: cover photo fields merge in by id without disturbing the order", () => {
  const teams = [
    team({ id: "m1", displayName: "Men's 1st Team", category: "senior" }),
    team({ id: "u12", displayName: "Under 12 Boys", category: "youth", ageGroup: "U12" }),
  ]
  const covers = [
    { id: "u12", cover_image_path: "clubs/1/teams/u12/photo.jpg", cover_stock_key: null },
    { id: "m1", cover_image_path: null, cover_stock_key: "rugby-team-scrum-01" },
  ]
  const ordered = orderClubTeamsForDisplay(teams, covers)
  assert.deepEqual(
    ordered.map((t) => t.teamId),
    ["m1", "u12"],
    "order is unaffected by cover-row order"
  )
  assert.equal(ordered[0].coverStockKey, "rugby-team-scrum-01")
  assert.equal(ordered[1].coverImagePath, "clubs/1/teams/u12/photo.jpg")
})

/**
 * PINS canonical-season selection (Page 2 correction pass): the row whose own `starts_on`/`ends_on`
 * range contains today, never the most recent row, never a hardcoded season. `pickCurrentSeason` is
 * the pure decision `loadSeasonsForClub` makes after reading every real season row for the club's
 * rugby code -- proven here against made-up rows so the *decision* is pinned without a live database;
 * `loadSeasonsForClub` itself is a thin query wrapper around this and `readClubTeams`-style Supabase
 * calls, not re-tested here.
 */
function season(overrides: Partial<CanonicalSeason> = {}): CanonicalSeason {
  return { id: "id", name: "Season", startsOn: "2026-09-01", endsOn: "2027-05-31", preSeasonStartsOn: null, ...overrides }
}

test("pickCurrentSeason: picks the season whose range contains today, not the most recently created row", () => {
  const seasons = [
    season({ id: "27-28", name: "Rugby Union 27/28", startsOn: "2027-09-01", endsOn: "2028-05-31" }),
    season({ id: "26-27", name: "Rugby Union 26/27", startsOn: "2026-09-01", endsOn: "2027-05-31" }),
  ]
  const current = pickCurrentSeason(seasons, "2026-09-29")
  assert.equal(current?.id, "26-27", "today falls inside 26/27, not the newer 27/28 row that appears first in the list")
})

test("pickCurrentSeason: proves the result changes with the input rows, never a hardcoded season -- same today, different roster", () => {
  const rosterA = [season({ id: "a", startsOn: "2026-09-01", endsOn: "2027-05-31" })]
  const rosterB = [season({ id: "b", startsOn: "2025-09-01", endsOn: "2026-05-31" }), season({ id: "c", startsOn: "2026-06-01", endsOn: "2027-05-31" })]
  assert.equal(pickCurrentSeason(rosterA, "2026-09-29")?.id, "a")
  assert.equal(pickCurrentSeason(rosterB, "2026-09-29")?.id, "c", "a differently-dated roster for the same today picks a different season -- the decision is derived from the data, not a fixed answer")
})

test("pickCurrentSeason: no season contains today returns null rather than guessing the nearest one", () => {
  const seasons = [season({ id: "future", startsOn: "2030-09-01", endsOn: "2031-05-31" })]
  assert.equal(pickCurrentSeason(seasons, "2026-09-29"), null)
})
