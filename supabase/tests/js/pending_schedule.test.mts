import { test } from "node:test"
import assert from "node:assert/strict"

import { mergeScheduleWithPendingRequests, pendingScheduleItemsForTeam } from "../../../packages/contracts/src/agenda/pending-schedule"
import type { TeamFixtureRequest } from "../../../packages/contracts/src/team/requests"
import type { AgendaItem, AgendaSide } from "../../../packages/contracts/src/agenda/load"

/**
 * PERMANENT REGRESSION PINS (owner correction pass, Section 19): the pure logic behind "a pending
 * fixture request appears in the schedule projection, an accepted one no longer does, a countered one
 * moves to its new date, a multi-team batch yields independent pending items."
 */

function us(): AgendaSide {
  return { directoryId: "dir-us", clubName: "Ovalball UAT RUFC", teamName: "Men's 1st Team", compactName: "Men's 1st", rugbyCode: "union", crestUrl: null, kit: null }
}

function request(overrides: Partial<TeamFixtureRequest> = {}): TeamFixtureRequest {
  return {
    id: "req-1",
    direction: "outgoing",
    status: "sent",
    proposedDate: "2026-09-26",
    preferredKickoffTime: null,
    venuePreference: "home",
    otherClub: "Ovalball UAT North RFC",
    otherTeam: "Men's 1st Team",
    gameType: "Friendly",
    note: null,
    createdAt: "2026-09-20T10:00:00Z",
    decidedAt: null,
    canNegotiate: true,
    isMyTurn: false,
    updatedAt: "2026-09-20T10:00:00Z",
    counteredDate: null,
    counteredKickoffTime: null,
    counteredVenuePreference: null,
    counterNote: null,
    ...overrides,
  }
}

test("pendingScheduleItemsForTeam: 1 -- a 'sent' outgoing request appears in the schedule projection", () => {
  const items = pendingScheduleItemsForTeam([request({ status: "sent", direction: "outgoing" })], "my-team", us())
  assert.equal(items.length, 1)
  assert.equal(items[0]!.kind, "fixture_request")
  assert.equal(items[0]!.status, "Awaiting response")
})

test("pendingScheduleItemsForTeam: 2 -- a 'sent' incoming request appears too, with the recipient's own status wording", () => {
  const items = pendingScheduleItemsForTeam([request({ status: "sent", direction: "incoming" })], "my-team", us())
  assert.equal(items.length, 1)
  assert.equal(items[0]!.status, "Response required")
})

test("pendingScheduleItemsForTeam: 3 -- an accepted request emits NO pending projection at all", () => {
  const items = pendingScheduleItemsForTeam([request({ status: "accepted" as TeamFixtureRequest["status"] })], "my-team", us())
  assert.equal(items.length, 0)
})

test("pendingScheduleItemsForTeam: 6 -- a declined request is absent from the schedule", () => {
  const items = pendingScheduleItemsForTeam([request({ status: "declined" as TeamFixtureRequest["status"] })], "my-team", us())
  assert.equal(items.length, 0)
})

test("pendingScheduleItemsForTeam: 7 -- a withdrawn (cancelled) request is absent from the schedule", () => {
  const items = pendingScheduleItemsForTeam([request({ status: "cancelled" as TeamFixtureRequest["status"] })], "my-team", us())
  assert.equal(items.length, 0)
})

test("pendingScheduleItemsForTeam: 8 -- a countered request uses the CURRENT standing proposal, never the original ask", () => {
  const items = pendingScheduleItemsForTeam(
    [
      request({
        status: "counter_proposed",
        proposedDate: "2026-09-26",
        counteredDate: "2026-10-03",
        venuePreference: "home",
        counteredVenuePreference: "away",
      }),
    ],
    "my-team",
    us()
  )
  assert.equal(items[0]!.date, "2026-10-03", "the countered date wins, not the original proposedDate")
  assert.equal(items[0]!.homeAway, "Away", "the countered venue preference wins too")
})

test("pendingScheduleItemsForTeam: 9 -- a multi-team batch yields independent pending items, one per request", () => {
  const items = pendingScheduleItemsForTeam(
    [
      request({ id: "req-mens", otherTeam: "Men's 1st Team" }),
      request({ id: "req-womens", otherTeam: "Women's 1st Team" }),
      request({ id: "req-u16", otherTeam: "Under 16 Boys" }),
    ],
    "my-team",
    us()
  )
  assert.equal(items.length, 3)
  assert.deepEqual(
    items.map((i) => i.requestId),
    ["req-mens", "req-womens", "req-u16"]
  )
})

test("mergeScheduleWithPendingRequests: 5/11 -- a real booked fixture on the same team/date/opponent suppresses the pending duplicate defensively, and pending items keep href null (never Match Centre)", () => {
  const bookedFixture: AgendaItem = {
    key: "fixture-1",
    kind: "fixture",
    eventId: "fx-1",
    date: "2026-09-26",
    time: "14:00",
    meetTime: null,
    us: us(),
    them: { directoryId: "dir-north", clubName: "Ovalball UAT North RFC", teamName: "Men's 1st Team", compactName: "Men's 1st", rugbyCode: "union", crestUrl: null, kit: null },
    homeAway: "Home",
    venue: null,
    pitch: null,
    status: "Booked",
    gameType: "Friendly",
    result: null,
    playerId: null,
    childFirstName: null,
    attendance: null,
    teamId: "my-team",
    clubId: "club-us",
    href: "/fixtures/fx-1",
  }
  const pending = pendingScheduleItemsForTeam([request({ status: "sent" })], "my-team", us())
  const merged = mergeScheduleWithPendingRequests([bookedFixture], pending)
  assert.equal(merged.length, 1, "the pending duplicate for the same team/date/opponent is suppressed -- no Pending+Booked pair")
  assert.equal(merged[0]!.kind, "fixture")

  const unrelatedPending = pendingScheduleItemsForTeam([request({ status: "sent", otherClub: "Ovalball UAT South RFC" })], "my-team", us())
  const mergedTwo = mergeScheduleWithPendingRequests([bookedFixture], unrelatedPending)
  assert.equal(mergedTwo.length, 2, "an unrelated pending request is never suppressed by an unrelated booked fixture")
  const pendingRow = mergedTwo.find((i) => i.kind === "fixture_request")!
  assert.equal(pendingRow.href, null, "a pending row's href is always null -- the caller never routes it to Match Centre")
})

test("mergeScheduleWithPendingRequests: 10 -- sorts booked and pending items together by date", () => {
  const later: AgendaItem = {
    key: "fixture-later",
    kind: "fixture",
    eventId: "fx-later",
    date: "2026-10-10",
    time: null,
    meetTime: null,
    us: us(),
    them: { directoryId: null, clubName: "Ovalball UAT West RFC", teamName: null, compactName: null, rugbyCode: null, crestUrl: null, kit: null },
    homeAway: "Home",
    venue: null,
    pitch: null,
    status: "Booked",
    gameType: null,
    result: null,
    playerId: null,
    childFirstName: null,
    attendance: null,
    teamId: "my-team",
    clubId: null,
    href: "/fixtures/fx-later",
  }
  const earlierPending = pendingScheduleItemsForTeam([request({ proposedDate: "2026-09-26" })], "my-team", us())
  const merged = mergeScheduleWithPendingRequests([later], earlierPending)
  assert.deepEqual(
    merged.map((i) => i.date),
    ["2026-09-26", "2026-10-10"]
  )
})
