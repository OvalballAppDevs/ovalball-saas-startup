import { test } from "node:test"
import assert from "node:assert/strict"

import {
  buildRequestFixturePairings,
  buildSentRequestSummary,
  candidateWeekStatusLabel,
  existingFixtureRequestFor,
  pairViewerTeamForOpponent,
  type ExistingFixtureRequestLike,
} from "../../../packages/contracts/src/clubhouse/request-fixture-pairings"

/**
 * REGRESSION PIN (owner correction pass, Section 16): the Request Fixtures composer used to silently
 * collapse a multi-team compatible list down to just its first entry, because the profile screen's own
 * handoff read only `compatibleTeams[0]` rather than the whole array. `buildRequestFixturePairings` is
 * now the ONE function both the Availability tab and the composer call -- this suite proves it against
 * the owner's own three-team worked example: Men's 1st clear, Women's 1st blocked by a same-week
 * fixture, Under 16 Boys blocked by an already-outstanding request. All three must survive.
 */

function ourTeam(overrides: Partial<{ id: string; displayName: string; category: "senior" | "youth" | "colts"; ageGroup: string | null; gender: string | null }> = {}) {
  return { id: "my-mens", displayName: "Men's 1st Team", category: "senior" as const, ageGroup: null, gender: "mens", ...overrides }
}

function opponent(overrides: Partial<{ teamId: string; displayName: string; ageGroup: string | null; gender: string | null }> = {}) {
  return { teamId: "opp-mens", displayName: "Men's 1st", ageGroup: null, gender: "mens", ...overrides }
}

const OUR_TEAMS = [
  ourTeam({ id: "my-mens", displayName: "Men's 1st Team", category: "senior", ageGroup: null, gender: "mens" }),
  ourTeam({ id: "my-womens", displayName: "Women's 1st Team", category: "senior", ageGroup: null, gender: "womens" }),
  ourTeam({ id: "my-u16", displayName: "Under 16 Boys", category: "youth", ageGroup: "U16", gender: "boys" }),
]

const OPPONENTS = [
  opponent({ teamId: "opp-mens", displayName: "Men's 1st", ageGroup: null, gender: "mens" }),
  opponent({ teamId: "opp-womens", displayName: "Women's 1st", ageGroup: null, gender: "womens" }),
  opponent({ teamId: "opp-u16", displayName: "Under 16 Boys", ageGroup: "U16", gender: "boys" }),
]

test("pairViewerTeamForOpponent: an age-graded opponent pairs on age group and gender, a senior opponent pairs on gender alone", () => {
  assert.equal(pairViewerTeamForOpponent(OPPONENTS[0]!, OUR_TEAMS)?.id, "my-mens")
  assert.equal(pairViewerTeamForOpponent(OPPONENTS[1]!, OUR_TEAMS)?.id, "my-womens")
  assert.equal(pairViewerTeamForOpponent(OPPONENTS[2]!, OUR_TEAMS)?.id, "my-u16")
})

test("existingFixtureRequestFor: only a live 'sent'/'counter_proposed' request against the exact team and club counts, never a declined or withdrawn one", () => {
  const requests: { outgoing: ExistingFixtureRequestLike[]; incoming: ExistingFixtureRequestLike[] } = {
    outgoing: [{ ourTeamId: "my-u16", otherClub: "Ovalball UAT North RFC", status: "sent", direction: "outgoing" }],
    incoming: [{ ourTeamId: "my-mens", otherClub: "Ovalball UAT North RFC", status: "declined", direction: "incoming" }],
  }
  assert.equal(existingFixtureRequestFor("my-u16", "Ovalball UAT North RFC", requests)?.status, "sent")
  assert.equal(existingFixtureRequestFor("my-mens", "Ovalball UAT North RFC", requests), null)
})

test("buildRequestFixturePairings: the owner's own three-team worked example -- Men's 1st clear, Women's 1st blocked by a same-week fixture, Under 16 Boys blocked by a pending request -- ALL THREE survive, never collapsed to just the first", () => {
  const availabilityContext = {
    date: "2026-10-17",
    availability: [],
    // Women's 1st has a real commitment elsewhere in the same Monday-Sunday game week (Friday 16th).
    weekRows: [{ my_team_id: "my-womens", opponent_team_id: "opp-womens", commitment_date: "2026-10-16" }],
  }
  const existingRequests: { outgoing: ExistingFixtureRequestLike[]; incoming: ExistingFixtureRequestLike[] } = {
    outgoing: [{ ourTeamId: "my-u16", otherClub: "Ovalball UAT North RFC", status: "sent", direction: "outgoing" }],
    incoming: [],
  }

  const pairings = buildRequestFixturePairings({
    compatibleTeams: OPPONENTS,
    availabilityContext,
    viewerTeams: OUR_TEAMS,
    existingRequests,
    clubName: "Ovalball UAT North RFC",
    partnershipStatus: "active",
  })

  assert.equal(pairings.length, 3, "the composer must never collapse the array to just the first pairing")
  assert.deepEqual(
    pairings.map((p) => p.myTeamLabel).sort(),
    ["Men's 1st Team", "Under 16 Boys", "Women's 1st Team"].sort()
  )

  const mens = pairings.find((p) => p.myTeamId === "my-mens")!
  const womens = pairings.find((p) => p.myTeamId === "my-womens")!
  const u16 = pairings.find((p) => p.myTeamId === "my-u16")!

  assert.equal(mens.status, "clear", "Men's 1st has no known clash and no outstanding request -- selectable")
  assert.equal(womens.status, "busy", "Women's 1st has a real commitment elsewhere in the same game week -- disabled, with a truthful reason")
  assert.equal(womens.detail, "Fixture booked this week")
  assert.equal(u16.status, "pending", "Under 16 Boys already has a live outstanding request -- disabled, never offered a duplicate Send action")
  assert.equal(u16.detail, "Request pending")
})

test("buildRequestFixturePairings: a non-partner club's compatible team reads 'unknown', never fabricated as clear or busy", () => {
  const pairings = buildRequestFixturePairings({
    compatibleTeams: [OPPONENTS[0]!],
    availabilityContext: { date: "2026-10-17", availability: [], weekRows: [] },
    viewerTeams: OUR_TEAMS,
    existingRequests: null,
    clubName: "Ovalball UAT East RFC",
    partnershipStatus: "none",
  })
  assert.equal(pairings[0]!.status, "unknown")
})

test("buildRequestFixturePairings: an opponent with no genuinely paired viewer team is silently excluded, never shown with a fabricated 'Your team'", () => {
  const orphanOpponent = opponent({ teamId: "opp-u12", displayName: "Under 12 Girls", ageGroup: "U12", gender: "girls" })
  const pairings = buildRequestFixturePairings({
    compatibleTeams: [orphanOpponent],
    availabilityContext: { date: "2026-10-17", availability: [], weekRows: [] },
    viewerTeams: OUR_TEAMS,
    existingRequests: null,
    clubName: "Ovalball UAT North RFC",
    partnershipStatus: "active",
  })
  assert.equal(pairings.length, 0)
})

test("candidateWeekStatusLabel: an exact-date busy row wins outright, matching the shared game-week rule find-fixture.ts already pins", () => {
  const label = candidateWeekStatusLabel("opp-mens", { date: "2026-10-17", availability: [{ my_team_id: "my-mens", opponent_team_id: "opp-mens", the_date: "2026-10-17", status: "busy" }], weekRows: [] }, "active")
  assert.equal(label.primary, "Busy")
})

test("buildSentRequestSummary: 19-10 -- the confirmation summary contains ONLY the requests the server actually returned, never every originally-selected pairing", () => {
  const selectedPairings = [
    { myTeamId: "my-mens", myTeamLabel: "Men's 1st Team", myTeamCategory: "Senior Men", opponentTeamId: "opp-mens", opponentTeamLabel: "Men's 1st" },
    { myTeamId: "my-womens", myTeamLabel: "Women's 1st Team", myTeamCategory: "Senior Women", opponentTeamId: "opp-womens", opponentTeamLabel: "Women's 1st" },
    { myTeamId: "my-u16", myTeamLabel: "Under 16 Boys", myTeamCategory: "Age Grade", opponentTeamId: "opp-u16", opponentTeamLabel: "Under 16 Boys" },
  ]
  // Only two of the three actually landed as server rows -- a genuine partial-batch scenario, however
  // rare (the real insert is one statement, but the summary must still be truthful if it ever happened).
  const serverRequests = [
    { id: "req-1", requestingTeamId: "my-mens" },
    { id: "req-2", requestingTeamId: "my-u16" },
  ]
  const summary = buildSentRequestSummary(selectedPairings, serverRequests)
  assert.equal(summary.length, 2, "never the three originally selected -- only what the server confirmed")
  assert.deepEqual(
    summary.map((s) => s.myTeamLabel),
    ["Men's 1st Team", "Under 16 Boys"]
  )
})

test("buildSentRequestSummary: an empty server result yields an empty summary, never a fabricated one", () => {
  assert.deepEqual(buildSentRequestSummary([{ myTeamId: "my-mens", myTeamLabel: "Men's 1st Team", myTeamCategory: "Senior Men", opponentTeamLabel: "Men's 1st" }], []), [])
})
