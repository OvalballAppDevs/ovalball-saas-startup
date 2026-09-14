import { test } from "node:test"
import assert from "node:assert/strict"

import { generateLeague, leagueBalance, leagueFeasibility } from "@/lib/competitions/league"
import { distanceAllocation, groupSizes, groupTravel, randomAllocation, swapEntrants, validateAllocation, type GroupEntrant } from "@/lib/competitions/groups"
import { bracketSize, buildBracket, qualifierPairings, roundOneEntrants, sameGroupRematches, seedOrder } from "@/lib/competitions/knockout"
import { computeStandings } from "@/lib/competitions/standings"
import { moveRound, roundDates } from "@/lib/competitions/rounds"
import { detectConflicts } from "@/lib/fixtures/conflicts"
import { suggestOppositionTeam, type MatchableTeam } from "@/lib/fixtures/opposition-match"
import { applyDefaultableChange, defaultVenue, type DefaultableState } from "@/lib/fixtures/venue-defaults"

/**
 * COMPETITION ENGINE -- the arithmetic a competition organiser trusts without
 * checking: every team plays the right number of matches, nobody is left out
 * of a draw, closer clubs are grouped together, a table ranks correctly, and a
 * conflict is found rather than guessed at.
 */

const ids = (n: number, prefix = "t") => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`)

// ---------------------------------------------------------------------------
// LEAGUE
// ---------------------------------------------------------------------------

test("single round robin: everyone meets everyone once, no self fixtures, venues within one", () => {
  for (const n of [2, 3, 4, 7, 8, 9]) {
    const teams = ids(n)
    const { rounds } = generateLeague(teams, { kind: "single" })
    const b = leagueBalance(teams, rounds)
    assert.equal(b.selfFixtures, 0)
    assert.equal(b.duplicatePairings, 0, `n=${n}`)
    for (const t of teams) {
      assert.equal(b.played.get(t), n - 1, `n=${n} ${t}`)
      const home = b.home.get(t)!
      assert.ok(Math.abs(home - (n - 1) / 2) <= 1, `n=${n} ${t} home=${home}`)
    }
  }
})

test("home and away: every pairing twice with venues reversed", () => {
  const teams = ids(8)
  const { rounds } = generateLeague(teams, { kind: "double" })
  const b = leagueBalance(teams, rounds)
  for (const t of teams) {
    assert.equal(b.played.get(t), 14)
    assert.equal(b.home.get(t), 7)
  }
  assert.equal(rounds.length, 14)
})

test("8 teams, 4 matches each: exactly four, no repeated pairing, perfect home balance", () => {
  const teams = ids(8)
  const { feasibility, rounds } = generateLeague(teams, { kind: "custom", perTeam: 4 })
  assert.ok(feasibility.ok)
  const b = leagueBalance(teams, rounds)
  assert.equal(b.duplicatePairings, 0)
  assert.equal(b.selfFixtures, 0)
  for (const t of teams) {
    assert.equal(b.played.get(t), 4)
    assert.equal(b.home.get(t), 2)
  }
})

test("custom counts for odd and even groups, including more than one meeting", () => {
  for (const [n, m] of [[7, 4], [8, 3], [8, 5], [8, 10], [6, 7]] as const) {
    const teams = ids(n)
    const { feasibility, rounds } = generateLeague(teams, { kind: "custom", perTeam: m })
    assert.ok(feasibility.ok, `n=${n} m=${m}`)
    const b = leagueBalance(teams, rounds)
    for (const t of teams) assert.equal(b.played.get(t), m, `n=${n} m=${m} ${t}`)
    for (const r of rounds) {
      const busy = r.matches.flatMap((p) => [p.home, p.away])
      assert.equal(new Set(busy).size, busy.length, "nobody plays twice in a round")
    }
  }
})

test("an impossible request is refused with a reason, never quietly altered", () => {
  const odd = leagueFeasibility(7, { kind: "custom", perTeam: 3 })
  assert.equal(odd.ok, false)
  assert.match(odd.reason!, /cannot each play exactly 3/)
  assert.deepEqual(generateLeague(ids(7), { kind: "custom", perTeam: 3 }).rounds, [])
  assert.equal(leagueFeasibility(4, { kind: "custom", perTeam: 7 }).ok, false)
})

// ---------------------------------------------------------------------------
// GROUPS
// ---------------------------------------------------------------------------

test("32 into 4 groups is 8 each; 30 into 4 is 8, 8, 7, 7", () => {
  assert.deepEqual(groupSizes(32, 4), [8, 8, 8, 8])
  assert.deepEqual(groupSizes(30, 4), [8, 8, 7, 7])
})

test("a random draw is reproducible from its seed and places everybody once", () => {
  const entrants: GroupEntrant[] = ids(32).map((id) => ({ id, lat: null, lng: null }))
  const a = randomAllocation(entrants, 4, 42)
  const b = randomAllocation(entrants, 4, 42)
  assert.deepEqual(a, b)
  assert.ok(validateAllocation(a.groups, entrants.map((e) => e.id)).ok)
  assert.notDeepEqual(randomAllocation(entrants, 4, 43).groups, a.groups)
})

test("By Distance keeps four real clusters together and respects group sizes", () => {
  // Four towns, eight clubs each, a few miles apart within a town and far apart between towns.
  const towns = [
    { lat: 53.76, lng: -2.7 }, // Preston
    { lat: 51.45, lng: -2.59 }, // Bristol
    { lat: 52.49, lng: 1.29 }, // Norwich
    { lat: 54.97, lng: -1.61 }, // Newcastle
  ]
  const entrants: GroupEntrant[] = towns.flatMap((town, ti) =>
    Array.from({ length: 8 }, (_, i) => ({ id: `town${ti}-${i}`, lat: town.lat + (i % 3) * 0.02, lng: town.lng + (i % 4) * 0.02 })),
  )
  // Shuffle the input order so the algorithm cannot lean on it.
  const shuffled = [...entrants].reverse()
  const { groups, unlocated } = distanceAllocation(shuffled, 4)
  assert.deepEqual(unlocated, [])
  assert.deepEqual(groups.map((g) => g.length), [8, 8, 8, 8])
  for (const g of groups) {
    const town = g[0].split("-")[0]
    assert.ok(g.every((id) => id.startsWith(town)), `group mixes towns: ${g.join(",")}`)
  }
  const random = randomAllocation(entrants, 4, 7)
  assert.ok(groupTravel(groups, entrants) < groupTravel(random.groups, entrants))
  // Deterministic.
  assert.deepEqual(distanceAllocation(shuffled, 4), distanceAllocation(shuffled, 4))
})

test("By Distance never invents coordinates: unlocated entrants are placed and named", () => {
  const entrants: GroupEntrant[] = [
    ...ids(6).map((id, i) => ({ id, lat: 53 + i * 0.01, lng: -2 })),
    { id: "nowhere1", lat: null, lng: null },
    { id: "nowhere2", lat: null, lng: null },
  ]
  const { groups, unlocated } = distanceAllocation(entrants, 2)
  assert.deepEqual(unlocated.sort(), ["nowhere1", "nowhere2"])
  assert.deepEqual(groups.map((g) => g.length), [4, 4])
  assert.ok(validateAllocation(groups, entrants.map((e) => e.id)).ok)
})

test("swapping two entrants between groups is a one-step edit", () => {
  const swapped = swapEntrants([["a", "b"], ["c", "d"]], "b", "c")
  assert.deepEqual(swapped, [["a", "c"], ["b", "d"]])
})

// ---------------------------------------------------------------------------
// KNOCKOUT
// ---------------------------------------------------------------------------

test("seed order keeps the top two seeds apart until the final", () => {
  assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6])
})

test("a 12-team draw gets 4 byes for the top seeds and discards nobody", () => {
  const entrants = ids(12).map((id, i) => ({ id, seed: i + 1 }))
  const bracket = buildBracket(entrants, { seeding: "seeded" })
  assert.equal(bracket.size, 16)
  assert.equal(bracket.byes, 4)
  assert.deepEqual(roundOneEntrants(bracket).sort(), entrants.map((e) => e.id).sort())
  const byeMatches = bracket.matches.filter((m) => m.round === 1 && m.isBye)
  const byeTeams = byeMatches.flatMap((m) => [m.home, m.away]).filter((s) => s.kind === "entrant").map((s) => (s as { id: string }).id)
  assert.deepEqual(byeTeams.sort(), ["t01", "t02", "t03", "t04"])
  assert.equal(bracket.matches.filter((m) => m.round === bracket.rounds).length, 1)
})

test("two legs double every tie except the final, and a third-place playoff takes the semi-final losers", () => {
  const bracket = buildBracket(ids(8).map((id) => ({ id })), { seeding: "manual", legs: 2, thirdPlace: true })
  assert.equal(bracket.matches.filter((m) => m.round === 1).length, 8)
  assert.equal(bracket.matches.filter((m) => m.round === 3 && !m.isThirdPlace).length, 1)
  const third = bracket.matches.find((m) => m.isThirdPlace)!
  assert.equal(third.home.kind, "loser_of")
  assert.equal(bracketSize(5), 8)
})

test("league into knockout: group winners meet runners-up from other groups", () => {
  const pairs = qualifierPairings(4, 2, { mode: "winners_seeded" })
  assert.equal(pairs.length, 4)
  assert.equal(sameGroupRematches(pairs), 0)
  assert.ok(pairs.every((p) => p.home.position === 1 && p.away.position === 2))
})

// ---------------------------------------------------------------------------
// STANDINGS
// ---------------------------------------------------------------------------

test("a table counts every competition match -- including two clubs not on Ovalball", () => {
  const participants = [
    { id: "oval-a", label: "Alpha" },
    { id: "ext-c", label: "Charlie" },
    { id: "ext-d", label: "Delta" },
  ]
  const table = computeStandings(participants, [
    { homeParticipantId: "ext-c", awayParticipantId: "ext-d", homeScore: 20, awayScore: 10, status: "completed" },
    { homeParticipantId: "oval-a", awayParticipantId: "ext-c", homeScore: 5, awayScore: 5, status: "completed" },
    { homeParticipantId: "oval-a", awayParticipantId: "ext-d", homeScore: 30, awayScore: 0, status: "completed" },
    { homeParticipantId: "ext-d", awayParticipantId: "oval-a", homeScore: null, awayScore: null, status: "scheduled" },
    { homeParticipantId: "ext-c", awayParticipantId: "oval-a", homeScore: 99, awayScore: 0, status: "cancelled" },
  ])
  assert.deepEqual(table.map((r) => r.participantId), ["oval-a", "ext-c", "ext-d"])
  const charlie = table.find((r) => r.participantId === "ext-c")!
  assert.deepEqual([charlie.played, charlie.won, charlie.drawn, charlie.points], [2, 1, 1, 6])
})

test("level on points: difference, then points scored, then head to head", () => {
  const p = [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
  ]
  const table = computeStandings(p, [
    { homeParticipantId: "a", awayParticipantId: "b", homeScore: 10, awayScore: 5, status: "completed" },
    { homeParticipantId: "b", awayParticipantId: "a", homeScore: 10, awayScore: 5, status: "completed" },
  ])
  // Same points, difference, scored -> head to head is level too -> name.
  assert.deepEqual(table.map((r) => r.participantId), ["a", "b"])
})

// ---------------------------------------------------------------------------
// ROUNDS
// ---------------------------------------------------------------------------

test("weekly round dates cross a clock change without slipping a day; one round moves alone", () => {
  const dates = roundDates(4, { kind: "weekly", start: "2027-03-21", everyDays: 7 })
  assert.deepEqual(dates, ["2027-03-21", "2027-03-28", "2027-04-04", "2027-04-11"])
  assert.deepEqual(moveRound(dates, 1, "2027-03-29"), ["2027-03-21", "2027-03-29", "2027-04-04", "2027-04-11"])
  assert.deepEqual(roundDates(2, { kind: "none" }), [null, null])
})

// ---------------------------------------------------------------------------
// CONFLICTS
// ---------------------------------------------------------------------------

test("conflicts are classified, never resolved", () => {
  const reports = detectConflicts(
    [
      { key: "m1", label: "Alpha v Bravo", date: "2027-01-09", kickoff: "10:00", homeTeamIds: ["A"], awayTeamIds: ["B"], homeParticipantId: "pa", awayParticipantId: "pb", venueId: "v1", pitchId: "p1" },
      { key: "m2", label: "Alpha v Charlie", date: "2027-01-09", kickoff: "13:00", homeTeamIds: ["A"], awayTeamIds: [], homeParticipantId: "pa", awayParticipantId: "pc", venueId: "v1", pitchId: "p2" },
      { key: "m3", label: "Delta v Echo", date: "2027-01-09", kickoff: "10:30", homeTeamIds: ["D"], awayTeamIds: ["E"], homeParticipantId: "pd", awayParticipantId: "pe", venueId: "v1", pitchId: "p1" },
      { key: "m4", label: "Bravo v Alpha", date: "2027-01-16", kickoff: "10:00", homeTeamIds: ["B"], awayTeamIds: ["A"], homeParticipantId: "pb", awayParticipantId: "pa", venueId: null, pitchId: null },
      { key: "m5", label: "Foxtrot v Golf", date: "2027-12-01", kickoff: null, homeTeamIds: [], awayTeamIds: [], homeParticipantId: "pf", awayParticipantId: null, venueId: null, pitchId: null },
      { key: "m6", label: "Hotel v India", date: "2027-01-23", kickoff: "10:00", homeTeamIds: ["H"], awayTeamIds: ["I"], homeParticipantId: "ph", awayParticipantId: "pi", venueId: null, pitchId: null },
      { key: "m7", label: "Alpha v Bravo", date: "2027-02-06", kickoff: "10:00", homeTeamIds: ["A"], awayTeamIds: ["B"], homeParticipantId: "pa", awayParticipantId: "pb", venueId: null, pitchId: null },
    ],
    [{ key: "existing-1", label: "Hotel v Juliet (booked)", date: "2027-01-22", kickoff: "19:00", teamIds: ["H"], venueId: null, pitchId: null }],
    { season: { start: "2026-09-01", end: "2027-06-30" } },
  )
  const by = Object.fromEntries(reports.map((r) => [r.key, r]))
  assert.equal(by.m1.level, "red")
  assert.ok(by.m1.issues.some((i) => i.code === "team_double_booked"))
  assert.ok(by.m1.issues.some((i) => i.code === "pitch_collision" && i.withKey === "m3"))
  assert.equal(by.m3.level, "red")
  // The return fixture (venues reversed) is a home-and-away schedule, not a repeat...
  assert.ok(!by.m4.issues.some((i) => i.code === "duplicate_matchup"))
  // ...the same home side against the same opponent again is.
  assert.ok(by.m7.issues.some((i) => i.code === "duplicate_matchup" && i.withKey === "m1"))
  assert.equal(by.m7.level, "amber")
  assert.ok(by.m5.issues.some((i) => i.code === "outside_season"))
  assert.ok(by.m5.issues.some((i) => i.code === "invalid_participant"))
  assert.ok(by.m6.issues.some((i) => i.code === "short_turnaround"))
  assert.equal(by.m6.level, "amber")
})

// ---------------------------------------------------------------------------
// OPPOSITION MATCHING AND VENUE DEFAULTS
// ---------------------------------------------------------------------------

const team = (id: string, ageGroup: string | null, gender: string | null, squad: string | null = null, category = "youth"): MatchableTeam => ({
  id,
  label: id,
  rugbyCode: "union",
  category,
  ageGroup,
  gender,
  squadDesignation: squad,
})

test("Under 12 Boys v Preston: Preston's Under 12 Boys is preselected, ineligible teams are never offered", () => {
  const ours = team("our-u12", "U12", "boys")
  const preston = [team("pre-u13", "U13", "boys"), team("pre-u12", "U12", "boys"), team("pre-u12-girls", "U12", "girls"), team("pre-u12b", "U12", "boys", "B")]
  const s = suggestOppositionTeam(ours, preston)
  assert.equal(s.preselect?.id, "pre-u12")
  assert.deepEqual(s.ranked.map((r) => r.team.id), ["pre-u12", "pre-u12b"])
})

test("two equally good matches are ranked and NOT preselected; no match is an honest empty answer", () => {
  const ours = team("our-u12b", "U12", "boys", "C")
  const s = suggestOppositionTeam(ours, [team("x-u12", "U12", "boys"), team("x-u12b", "U12", "boys", "B")])
  assert.equal(s.preselect, null)
  assert.equal(s.ranked.length, 2)
  assert.deepEqual(suggestOppositionTeam(ours, [team("x-senior", null, "mens", null, "senior")]).ranked, [])
})

test("away defaults to their ground and its only pitch; home to ours; external uses the Directory ground; never invented", () => {
  const ours = { venues: [{ id: "ov1", name: "Our Ground", isDefaultHome: true, active: true }, { id: "ov2", name: "Annex", isDefaultHome: false, active: true }], pitches: [{ id: "op1", name: "1", venueId: "ov1", active: true }, { id: "op2", name: "2", venueId: "ov1", active: true }] }
  const preston = { venues: [{ id: "pv", name: "Preston Ground", isDefaultHome: true, active: true }], pitches: [{ id: "pp", name: "Main", venueId: "pv", active: true }] }
  assert.deepEqual(defaultVenue("Away", ours, preston), { venueId: "pv", venueText: null, pitchId: "pp", source: "their_default" })
  assert.deepEqual(defaultVenue("Home", ours, preston), { venueId: "ov1", venueText: null, pitchId: null, source: "our_default" })
  assert.deepEqual(defaultVenue("Away", ours, { venues: [], pitches: [], directoryHomeGround: "Lightfoot Green" }), { venueId: null, venueText: "Lightfoot Green", pitchId: null, source: "directory" })
  assert.equal(defaultVenue("Away", ours, { venues: [], pitches: [], directoryHomeGround: null }).source, "none")
})

test("the override rule: a person's choice survives re-renders and clears only on a material change", () => {
  let s: DefaultableState = { homeAway: "Away", oppositionClubKey: "preston", oppositionTeamId: null, venueId: null, venueText: null, pitchId: null, touched: { oppositionTeam: false, venue: false, pitch: false } }
  s = applyDefaultableChange(s, { kind: "venue", id: "pv", byUser: false })
  s = applyDefaultableChange(s, { kind: "venue", id: "neutral", byUser: true })
  s = applyDefaultableChange(s, { kind: "venue", id: "pv", byUser: false })
  assert.equal(s.venueId, "neutral", "a default must not replace the person's choice")
  s = applyDefaultableChange(s, { kind: "oppositionTeam", id: "pre-u12b", byUser: true })
  s = applyDefaultableChange(s, { kind: "oppositionTeam", id: "pre-u12", byUser: false })
  assert.equal(s.oppositionTeamId, "pre-u12b")
  s = applyDefaultableChange(s, { kind: "oppositionClub", key: "fylde" })
  assert.deepEqual([s.oppositionTeamId, s.venueId, s.touched.venue], [null, null, false], "a different club clears their team and their ground")
  s = applyDefaultableChange(s, { kind: "venue", id: "fv", byUser: true })
  s = applyDefaultableChange(s, { kind: "pitch", id: "fp", byUser: true })
  s = applyDefaultableChange(s, { kind: "homeAway", value: "Home" })
  assert.deepEqual([s.venueId, s.pitchId], [null, null], "flipping Home/Away clears the other club's ground")
})

// ---------------------------------------------------------------------------
// DRAFTS -- what the Creator actually saves
// ---------------------------------------------------------------------------

import { groupLetter, knockoutDraftMatches, leagueDraftMatches, tieLabel } from "@/lib/competitions/drafts"

test("league drafts: every group's round r shares round r's date; venue is the home side's ground", () => {
  const groups = [
    { id: "gA", name: "Group A", members: ids(4, "a") },
    { id: "gB", name: "Group B", members: ids(3, "b") },
  ]
  const { matches, rounds, warnings } = leagueDraftMatches(groups, { kind: "single" }, {
    firstDate: "2027-09-04",
    everyDays: 7,
    kickoff: "10:30",
    venueFor: (home) => ({ venueId: null, venueText: `${home} ground` }),
  })
  assert.deepEqual(warnings, [])
  assert.equal(matches.filter((m) => m.groupId === "gA").length, 6)
  assert.equal(matches.filter((m) => m.groupId === "gB").length, 3)
  assert.equal(rounds.length, 3)
  assert.deepEqual(rounds.map((r) => r.roundDate), ["2027-09-04", "2027-09-11", "2027-09-18"])
  for (const m of matches) {
    assert.equal(m.matchDate, rounds[(m.roundNumber ?? 1) - 1].roundDate)
    assert.equal(m.venueText, `${m.homeParticipantId} ground`)
    assert.equal(m.kickoffTime, "10:30")
  }
})

test("league drafts: an impossible request for one group is said, and that group gets no matches", () => {
  const groups = [
    { id: "gA", name: "Group A", members: ids(5, "a") },
    { id: "gB", name: "Group B", members: ids(4, "b") },
  ]
  const { matches, warnings } = leagueDraftMatches(groups, { kind: "custom", perTeam: 3 }, { firstDate: null, everyDays: 7, kickoff: null, venueFor: () => ({ venueId: null, venueText: null }) })
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /^Group A:/)
  assert.ok(matches.every((m) => m.groupId === "gB"))
})

test("knockout drafts: byes are never matches, their entrant is placed straight into the next tie", () => {
  let n = 0
  const entrants = ids(6).map((id, i) => ({ id, seed: i + 1 }))
  const bracket = buildBracket(entrants, { seeding: "seeded" })
  const draft = knockoutDraftMatches(bracket, {
    legs: 1,
    place: (id) => ({ participantId: id }),
    groupName: (g) => `Group ${groupLetter(g)}`,
    firstDate: "2028-01-08",
    everyDays: 14,
    kickoff: "11:00",
    finalVenueText: "Edgeley Park",
    venueFor: () => ({ venueId: null, venueText: "Home ground" }),
    newId: () => `m${++n}`,
  })
  assert.equal(draft.matches.length, bracket.matches.length - bracket.byes)
  const semis = draft.matches.filter((m) => m.roundNumber === 2)
  // Seeds 1 and 2 had byes: they are real participants in the semi-finals, not "winner of" placeholders.
  const semiParticipants = semis.flatMap((m) => [m.homeParticipantId, m.awayParticipantId]).filter(Boolean)
  assert.ok(semiParticipants.includes("t01") && semiParticipants.includes("t02"))
  const final = draft.matches.find((m) => m.roundNumber === 3)!
  assert.equal(final.venueText, "Edgeley Park")
  assert.ok(final.homeSource?.winner_of && draft.matches.some((m) => m.id === final.homeSource!.winner_of))
  assert.deepEqual(draft.rounds.map((r) => r.roundDate), ["2028-01-08", "2028-01-22", "2028-02-05"])
  assert.equal(draft.rounds[2].name, "Final")
})

test("knockout drafts: two legs decide on the second leg, and a qualifier is a named place", () => {
  let n = 0
  const pairs = qualifierPairings(2, 2, { mode: "winners_seeded" })
  const entrants = pairs.flatMap((p) => [p.home, p.away]).map((q) => ({ id: `q:${q.groupIndex}:${q.position}` }))
  const bracket = buildBracket(entrants, { seeding: "manual", legs: 2 })
  const draft = knockoutDraftMatches(bracket, {
    legs: 2,
    place: (id) => {
      const [, g, p] = id.split(":")
      return { qualifier: { group_index: Number(g), position: Number(p) } }
    },
    groupName: (g) => `Group ${groupLetter(g)}`,
    firstDate: "2028-03-04",
    everyDays: 7,
    kickoff: null,
    finalVenueText: null,
    venueFor: () => ({ venueId: null, venueText: null }),
    newId: () => `k${++n}`,
  })
  const first = draft.matches.find((m) => m.roundNumber === 1 && m.bracketSlot === 1)!
  assert.equal(first.homeSource?.label, "Group A 1st")
  assert.equal(first.awaySource?.label, "Group B 2nd")
  const final = draft.matches.find((m) => m.roundNumber === 2)!
  const leg2 = draft.matches.filter((m) => m.roundNumber === 1 && m.bracketSlot === 1)[1]
  assert.equal(final.homeSource?.winner_of, leg2.id)
  assert.equal(final.homeSource?.label, "Winner of Semi-Final 1")
  // Semi-final legs a week apart, final the week after.
  assert.deepEqual(draft.matches.filter((m) => m.roundNumber === 1).map((m) => m.matchDate).sort(), ["2028-03-04", "2028-03-04", "2028-03-11", "2028-03-11"])
  assert.equal(final.matchDate, "2028-03-18")
  assert.equal(tieLabel(1, 5, 7), "Round of 32 Match 7")
  assert.equal(tieLabel(2, 5, 3), "Round of 16 Match 3")
  assert.equal(groupLetter(27), "AB")
})

test("league: beyond a single round robin, every extra match is a genuine return fixture -- venues reversed", () => {
  for (const [n, m] of [[4, 4], [4, 5], [6, 7], [8, 10], [5, 6]]) {
    const teams = ids(n)
    const { feasibility, rounds } = generateLeague(teams, { kind: "custom", perTeam: m })
    if (!feasibility.ok) continue
    const seen = new Set<string>()
    for (const r of rounds) for (const p of r.matches) {
      const key = `${p.home}>${p.away}`
      assert.ok(!seen.has(key), `n=${n} m=${m}: ${key} is at home twice`)
      seen.add(key)
    }
  }
})

test("conflicts: a club not on Ovalball (no team id) is still double-booked by its participant", () => {
  const reports = detectConflicts(
    [
      { key: "x1", label: "Fylde v Blackburn", date: "2026-10-03", kickoff: "10:30", homeTeamIds: [], awayTeamIds: [], homeParticipantId: "fylde", awayParticipantId: "blackburn", venueId: null, pitchId: null },
      { key: "x2", label: "Fylde v Orrell", date: "2026-10-03", kickoff: "14:00", homeTeamIds: [], awayTeamIds: [], homeParticipantId: "fylde", awayParticipantId: "orrell", venueId: null, pitchId: null },
      { key: "x3", label: "Sale v Orrell", date: "2026-10-10", kickoff: "14:00", homeTeamIds: [], awayTeamIds: [], homeParticipantId: "sale", awayParticipantId: "orrell", venueId: null, pitchId: null },
    ],
    [],
  )
  const by = Object.fromEntries(reports.map((r) => [r.key, r]))
  assert.equal(by.x1.level, "red")
  assert.ok(by.x2.issues.some((i) => i.code === "team_double_booked"))
  assert.equal(by.x3.level, "green")
})

// ---------------------------------------------------------------------------
// KNOCKOUT OPTIONS (conformance: home allocation, byes, qualifiers, final venue)
// ---------------------------------------------------------------------------
import { bracketSameGroupTies, seededQualifiers } from "@/lib/competitions/knockout"
import { planReplacement, scheduleWarnings, type EditableMatch } from "@/lib/competitions/match-edits"

const firstRoundTies = (b: ReturnType<typeof buildBracket>) => b.matches.filter((m) => m.round === 1 && m.leg === 1)
const entrantId = (s: { kind: string }) => (s.kind === "entrant" ? (s as unknown as { id: string }).id : null)

test("a manual draw of 6 never makes a tie of two byes, and shows who has them", () => {
  const b = buildBracket(ids(6).map((id) => ({ id })), { seeding: "manual" })
  const ties = firstRoundTies(b)
  assert.equal(ties.length, 4)
  assert.ok(ties.every((t) => t.home.kind !== "bye" || t.away.kind !== "bye"))
  assert.deepEqual(roundOneEntrants(b).sort(), ids(6).sort())
  assert.deepEqual(ties.filter((t) => t.isBye).map((t) => entrantId(t.home)), ["t05", "t06"])
})

test("top 2 of 3 groups: byes go to group winners, and no first-round tie is between one group's teams", () => {
  const q = seededQualifiers(3, 2)
  const b = buildBracket(q, { seeding: "seeded", avoidSameGroup: true })
  assert.equal(b.byes, 2)
  const byeTeams = firstRoundTies(b).filter((t) => t.isBye).map((t) => entrantId(t.home) ?? entrantId(t.away))
  assert.deepEqual(byeTeams.sort(), ["q:0:1", "q:1:1"])
  assert.equal(bracketSameGroupTies(b, (id) => Number(id.split(":")[1])), 0)
})

test("top 4 of 2 groups and top 1 of 4 groups draw without same-group ties", () => {
  const four = buildBracket(seededQualifiers(2, 4), { seeding: "seeded", avoidSameGroup: true })
  assert.equal(bracketSameGroupTies(four, (id) => Number(id.split(":")[1])), 0)
  const winners = buildBracket(seededQualifiers(4, 1), { seeding: "seeded", avoidSameGroup: true })
  assert.equal(firstRoundTies(winners).length, 2)
  // Group winners from different groups, by construction.
  assert.equal(bracketSameGroupTies(winners, (id) => Number(id.split(":")[1])), 0)
})

test("home allocation: the higher seed hosts; random is repeatable by draw number; first drawn is untouched", () => {
  const entrants = ids(8).map((id, i) => ({ id, seed: i + 1 }))
  const seeded = buildBracket(entrants, { seeding: "random", seedNumber: 3, homeAllocation: "seeded" })
  const seedOf = (id: string | null) => entrants.find((e) => e.id === id)!.seed
  assert.ok(firstRoundTies(seeded).every((t) => seedOf(entrantId(t.home)) < seedOf(entrantId(t.away))))
  const r1 = firstRoundTies(buildBracket(entrants, { seeding: "seeded", seedNumber: 5, homeAllocation: "random" })).map((t) => entrantId(t.home))
  const r2 = firstRoundTies(buildBracket(entrants, { seeding: "seeded", seedNumber: 5, homeAllocation: "random" })).map((t) => entrantId(t.home))
  assert.deepEqual(r1, r2)
  const drawn = firstRoundTies(buildBracket(entrants, { seeding: "seeded", homeAllocation: "first_drawn" })).map((t) => entrantId(t.home))
  assert.deepEqual(drawn, ["t01", "t04", "t02", "t03"])
})

test("final venue: a neutral ground, the home side's ground, or decided later; neutral allocation leaves ties unset", () => {
  const b = buildBracket(ids(4).map((id, i) => ({ id, seed: i + 1 })), { seeding: "seeded" })
  const base = { legs: 1 as const, place: (id: string) => ({ participantId: id }), groupName: (g: number) => `Group ${groupLetter(g)}`, firstDate: null, everyDays: 7, kickoff: null, venueFor: () => ({ venueId: null, venueText: "Their Ground" }), newId: (() => { let n = 0; return () => `v${++n}` })() }
  const finalOf = (d: ReturnType<typeof knockoutDraftMatches>) => d.matches.find((m) => m.roundNumber === 2)!
  assert.equal(finalOf(knockoutDraftMatches(b, { ...base, finalVenueText: "Edgeley Park", finalVenueMode: "neutral" })).venueText, "Edgeley Park")
  assert.equal(finalOf(knockoutDraftMatches(b, { ...base, finalVenueText: null, finalVenueMode: "later" })).venueText, null)
  const neutral = knockoutDraftMatches(b, { ...base, finalVenueText: null, finalVenueMode: "home", neutralVenues: true })
  assert.ok(neutral.matches.every((m) => m.venueText === null && m.venueId === null))
  const semis = knockoutDraftMatches(b, { ...base, finalVenueText: null, finalVenueMode: "home" }).matches.filter((m) => m.roundNumber === 1)
  assert.ok(semis.every((m) => m.venueText === "Their Ground"))
})

// ---------------------------------------------------------------------------
// MATCH EDITS: replace a team, swap between matches, warnings
// ---------------------------------------------------------------------------
const em = (id: string, round: number, home: string, away: string, over: Partial<EditableMatch> = {}): EditableMatch => ({
  id, stageId: "s", groupId: "g", roundNumber: round, homeParticipantId: home, awayParticipantId: away, venueId: null, venueText: `${home} Ground`, status: "draft", ...over,
})
const groundOf = (id: string) => ({ venueId: null, venueText: `${id} Ground` })

test("replacing a team who is not playing that round changes one place, and the ground follows a new home team", () => {
  const a = em("A", 1, "t1", "t2")
  const plan = planReplacement(a, "home", "t5", [a, em("B", 1, "t3", "t4")], groundOf)
  assert.equal(plan.kind, "replace")
  assert.deepEqual(plan.kind === "replace" && plan.changes, [{ id: "A", patch: { home_participant_id: "t5", venue_id: null, venue_text: "t5 Ground", pitch_id: null } }])
})

test("choosing a team who already plays that round swaps the two teams between the matches, in one change", () => {
  const a = em("A", 1, "t1", "t2")
  const b = em("B", 1, "t3", "t4")
  const plan = planReplacement(a, "away", "t4", [a, b], groundOf)
  assert.equal(plan.kind, "swap")
  assert.deepEqual(plan.kind === "swap" && plan.changes, [
    { id: "A", patch: { away_participant_id: "t4" } },
    { id: "B", patch: { away_participant_id: "t2" } },
  ])
})

test("a ground chosen by hand is kept when the home team changes; issued matches and self-matches are refused", () => {
  const a = em("A", 1, "t1", "t2", { venueText: "Neutral Park" })
  const plan = planReplacement(a, "home", "t5", [a], groundOf)
  assert.deepEqual(plan.kind === "replace" && plan.changes[0].patch, { home_participant_id: "t5" })
  assert.equal(planReplacement(em("I", 1, "t1", "t2", { status: "scheduled" }), "home", "t5", [], groundOf).kind, "refused")
  assert.equal(planReplacement(a, "home", "t2", [a], groundOf).kind, "refused")
})

test("hand edits that break the schedule are said: a team with too many matches, a pairing repeated", () => {
  const group = { name: "Group A", members: ["t1", "t2", "t3", "t4"] }
  const ok = [em("1", 1, "t1", "t2"), em("2", 1, "t3", "t4"), em("3", 2, "t1", "t3"), em("4", 2, "t2", "t4"), em("5", 3, "t1", "t4"), em("6", 3, "t2", "t3")]
  assert.deepEqual(scheduleWarnings(group, ok, { kind: "single" }, (id) => id), [])
  const broken = [...ok.slice(0, 5), em("6", 3, "t1", "t2")]
  const w = scheduleWarnings(group, broken, { kind: "single" }, (id) => id)
  assert.equal(w.length, 2)
  assert.match(w[0], /each team should play 3, but t1 plays 4, t3 plays 2/)
  assert.match(w[1], /t1 and t2 meet 2 times/)
})

import { publicRoundOptions } from "@/lib/competitions/public-filters"

test("the public Round filter names league and knockout rounds apart", () => {
  const matches = [
    { kind: "league", round: 1 }, { kind: "league", round: 2 }, { kind: "league", round: 1 },
    { kind: "knockout", round: 1 }, { kind: "knockout", round: 2 }, { kind: "knockout", round: 3 }, { kind: "knockout", round: 4 },
  ]
  assert.deepEqual(publicRoundOptions(matches, 4, null), [
    ["league-1", "League, Round 1"], ["league-2", "League, Round 2"],
    ["knockout-1", "Knockout, Round of 16"], ["knockout-2", "Knockout, Quarter-Finals"], ["knockout-3", "Knockout, Semi-Finals"], ["knockout-4", "Knockout, Final"],
  ])
  assert.deepEqual(publicRoundOptions(matches, 4, "league").map((o) => o[0]), ["league-1", "league-2"])
})
