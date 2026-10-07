import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
  boardState,
  clubDayState,
  clubDaySummaryWords,
  playingDayCategory,
  returnPairings,
  venueForSide,
  type ClubDayDetail,
  bulkVenues,
  canSelect,
  clubDayRollups,
  existingReturnDates,
  mondayOfWeek,
  otherDaysThisWeek,
  reverseItems,
  seasonWeeks,
  summariseWeek,
  teamDayState,
  weekCommencingLabel,
  type BoardRow,
  type PlannerCommitment,
  type PlannerTeam,
} from "@/packages/contracts/src/fixtures/season-planner"

const OPP = "opp-club"
function team(partial: Partial<PlannerTeam> = {}): PlannerTeam {
  return { teamId: "t1", displayName: "Under 13 Boys", category: "youth", ageGroup: "U13", gender: "boys", compatible: [{ teamId: "o1", displayName: "Under 13 Boys" }], week: [], withOpponent: [], preferredDay: 7, preferredDaySource: "club", ...partial }
}
function c(partial: Partial<PlannerCommitment>): PlannerCommitment {
  return { date: "2027-11-07", kind: "fixture", status: "Booked", refId: "r", groupId: null, opponent: "Solihull RFC", opponentClubId: "other", homeAway: "Home", ...partial }
}
function row(partial: Partial<BoardRow>): BoardRow {
  return { teamId: "t1", teamName: "Under 13 Boys", date: "2027-11-07", kind: "fixture", status: "Booked", refId: "r", groupId: null, opponent: "Burnley Under 13 Boys", opponentClubId: OPP, opponentClubName: "Burnley", homeAway: "Home", planned: false, ...partial }
}

describe("SP-A the season as rugby weeks", () => {
  it("SP-A1 Monday-commencing weeks with the playing day inside, none before today or outside the season", () => {
    const weeks = seasonWeeks("2027-09-01", "2027-10-10", 7, "2027-09-06")
    assert.deepEqual(weeks.map((w) => [w.weekStart, w.matchDate]), [
      ["2027-09-06", "2027-09-12"],
      ["2027-09-13", "2027-09-19"],
      ["2027-09-20", "2027-09-26"],
      ["2027-09-27", "2027-10-03"],
      ["2027-10-04", "2027-10-10"],
    ])
  })
  it("SP-A2 a Saturday club plans Saturdays; the week is still Monday-commencing", () => {
    const weeks = seasonWeeks("2027-11-01", "2027-11-14", 6, "2027-10-01")
    assert.deepEqual(weeks.map((w) => w.matchDate), ["2027-11-06", "2027-11-13"])
    assert.equal(mondayOfWeek("2027-11-07"), "2027-11-01")
    assert.equal(weekCommencingLabel("2027-11-01"), "W/C 1 Nov")
  })
})

describe("SP-B what a team's day already holds", () => {
  it("SP-B1 nothing in the way and a compatible side: ready", () => {
    assert.equal(teamDayState(team(), "2027-11-07", OPP).kind, "ready")
  })
  it("SP-B2 no compatible side: no_match, never selectable", () => {
    const s = teamDayState(team({ compatible: [] }), "2027-11-07", OPP)
    assert.equal(s.kind, "no_match")
    assert.equal(canSelect(s), false)
  })
  it("SP-B3 a fixture that day blocks (a team plays once a day), before anything else", () => {
    const s = teamDayState(team({ compatible: [], week: [c({})] }), "2027-11-07", OPP)
    assert.equal(s.kind, "playing")
    assert.equal(canSelect(s), false)
  })
  it("SP-B4 a competition match that day blocks", () => {
    assert.equal(teamDayState(team({ week: [c({ kind: "competition", status: "scheduled" })] }), "2027-11-07", OPP).kind, "competition")
  })
  it("SP-B5 an open request with THIS opponent that day: already arranged (ours) or theirs to reply to", () => {
    assert.equal(teamDayState(team({ week: [c({ kind: "request_out", status: "sent", opponentClubId: OPP })] }), "2027-11-07", OPP).kind, "already_with_opponent")
    assert.equal(teamDayState(team({ week: [c({ kind: "request_in", status: "sent", opponentClubId: OPP })] }), "2027-11-07", OPP).kind, "incoming_from_opponent")
  })
  it("SP-B6 a pending request with ANOTHER club that day: selectable only deliberately", () => {
    const s = teamDayState(team({ week: [c({ kind: "request_out", status: "sent", opponentClubId: "warwick" })] }), "2027-11-07", OPP)
    assert.equal(s.kind, "pending_elsewhere")
    assert.equal(canSelect(s), true)
  })
  it("SP-B7 a fixture on another day that week is a note, not a block", () => {
    const t = team({ week: [c({ date: "2027-11-06" })] })
    assert.equal(teamDayState(t, "2027-11-07", OPP).kind, "ready")
    assert.equal(otherDaysThisWeek(t, "2027-11-07").length, 1)
  })
})

describe("SP-C Home/Away and the reverse leg", () => {
  it("SP-C1 alternate starts at Home; all Home; all Away", () => {
    assert.deepEqual(bulkVenues(["a", "b", "c"], "alternate"), { a: "home", b: "away", c: "home" })
    assert.deepEqual(bulkVenues(["a", "b"], "home"), { a: "home", b: "home" })
    assert.deepEqual(bulkVenues(["a"], "away"), { a: "away" })
  })
  it("SP-C2 the reverse inverts only what was in the first day -- nothing is invented", () => {
    const first = [
      { requestingTeamId: "u9", targetTeamId: "o9", venue: "home" as const },
      { requestingTeamId: "u10", targetTeamId: "o10", venue: "away" as const },
      { requestingTeamId: "u12", targetTeamId: "o12", venue: "home" as const },
    ]
    assert.deepEqual(reverseItems(first).map((i) => [i.requestingTeamId, i.targetTeamId, i.venue]), [
      ["u9", "o9", "away"],
      ["u10", "o10", "home"],
      ["u12", "o12", "away"],
    ])
  })
  it("SP-C3 a return already exists when a live meeting with them sits on another date; a declined one does not count", () => {
    const t = team({ withOpponent: [c({ date: "2027-11-07", opponentClubId: OPP }), c({ date: "2028-02-06", kind: "request_out", status: "declined", opponentClubId: OPP })] })
    assert.deepEqual(existingReturnDates([t], "2027-11-07"), [])
    const t2 = team({ withOpponent: [c({ date: "2028-02-06", kind: "request_out", status: "sent", opponentClubId: OPP })] })
    assert.deepEqual(existingReturnDates([t2], "2027-11-07"), ["2028-02-06"])
  })
})

describe("SP-D the board speaks only the canonical states", () => {
  it("SP-D1 states", () => {
    assert.equal(boardState({ kind: "fixture", status: "Booked" }), "confirmed")
    assert.equal(boardState({ kind: "fixture", status: "Completed" }), "completed")
    assert.equal(boardState({ kind: "request_out", status: "sent" }), "pending")
    assert.equal(boardState({ kind: "request_out", status: "counter_proposed" }), "countered")
    assert.equal(boardState({ kind: "request_out", status: "declined" }), "declined")
    assert.equal(boardState({ kind: "request_in", status: "sent" }), "incoming")
    assert.equal(boardState({ kind: "competition", status: "scheduled" }), "competition")
  })
  it("SP-D2 a week's counts: a declined request frees the slot and needs attention", () => {
    const rows = [row({}), row({ teamId: "t2", kind: "request_out", status: "sent" }), row({ teamId: "t3", kind: "request_out", status: "declined" })]
    assert.deepEqual(summariseWeek(rows, "2027-11-01", ["t1", "t2", "t3", "t4"]), { weekStart: "2027-11-01", confirmed: 1, pending: 1, incoming: 0, needsAttention: 1, unfilled: 2 })
  })
  it("SP-D3 a planned club day reads as one, whatever each request became", () => {
    const rows = [
      row({ planned: true, groupId: "g" }),
      row({ planned: true, groupId: "g", teamId: "t2", kind: "request_out", status: "counter_proposed" }),
      row({ planned: true, groupId: "g", teamId: "t3", kind: "request_out", status: "declined" }),
      row({ planned: false, groupId: "x", teamId: "t4", kind: "request_out", status: "sent" }),
    ]
    assert.deepEqual(clubDayRollups(rows), [{ groupId: "g", opponent: "Burnley", date: "2027-11-07", confirmed: 1, pending: 0, countered: 1, declined: 1 }])
  })
})

describe("SP-E a club day answered as one", () => {
  const sum = (p: Partial<{ total: number; accepted: number; declined: number; pending: number; countered: number; withdrawn: number }>) => ({ total: 6, accepted: 0, declined: 0, pending: 0, countered: 0, withdrawn: 0, ...p })
  it("SP-E1 the club day's state comes from its fixtures' canonical states", () => {
    assert.equal(clubDayState(sum({ accepted: 6 })), "confirmed")
    assert.equal(clubDayState(sum({ accepted: 3, declined: 1, pending: 2 })), "partly_confirmed")
    assert.equal(clubDayState(sum({ pending: 6 })), "awaiting")
    assert.equal(clubDayState(sum({ accepted: 4, countered: 1, pending: 1 })), "needs_attention")
    assert.equal(clubDayState(sum({ declined: 6 })), "declined")
    assert.equal(clubDayState(sum({ withdrawn: 6 })), "withdrawn")
  })
  it("SP-E2 the summary in words never claims what did not happen", () => {
    assert.equal(clubDaySummaryWords(sum({ accepted: 3, declined: 1, pending: 1, countered: 1 })), "3 accepted · 1 declined · 2 awaiting decision")
    assert.equal(clubDaySummaryWords(sum({})), "Nothing answered yet")
  })
  it("SP-E3 the receiving club reads Home/Away from its own side", () => {
    assert.equal(venueForSide("home", "sent"), "Home")
    assert.equal(venueForSide("home", "received"), "Away")
    assert.equal(venueForSide("either", "received"), "TBC")
  })
  it("SP-E4 the return inverts every pairing, keeps a declined one (labelled) and drops a withdrawn one by default", () => {
    const f = (requestingTeamId: string, venue: string, status: string) => ({ requestId: requestingTeamId, status, requestingTeamId, requestingTeam: requestingTeamId, requestingAgeGroup: null, targetTeamId: `o-${requestingTeamId}`, targetTeam: "x", venue, kickoff: null, date: "2027-11-07", countered: false, counteredByRequester: false, note: null, counterNote: null, responseNote: null, resultingFixtureId: null })
    const detail = { groupId: "g", side: "sent", date: "2027-11-07", reverseOfGroupId: null, returnGroupIds: [], requestingClub: { id: "a", name: "A", logoPath: null }, opponentClub: { id: "b", name: "B", logoPath: null },
      fixtures: [f("u9", "home", "accepted"), f("u10", "away", "declined"), f("u11", "home", "cancelled")] } as unknown as ClubDayDetail
    assert.deepEqual(returnPairings(detail).map((p) => [p.requestingTeamId, p.venue, p.previousStatus, p.include]), [
      ["u9", "away", "accepted", true],
      ["u10", "home", "declined", true],
      ["u11", "away", "cancelled", false],
    ])
  })
  it("SP-E5 a team's kind for its playing day comes from its own category and gender", () => {
    assert.equal(playingDayCategory("senior", "mens"), "senior_mens")
    assert.equal(playingDayCategory("senior", "womens"), "senior_womens")
    assert.equal(playingDayCategory("colts", "mens"), "colts")
    assert.equal(playingDayCategory("youth", "girls"), "age_grade")
  })
})
