import { test } from "node:test"
import assert from "node:assert/strict"

import {
  ATTENDANCE_HORIZON_DAYS,
  applyAgendaFilters,
  countOutstandingResponses,
  daysBetween,
  dedupeAgendaEvents,
  groupAgendaByMonth,
  outstandingResponseEvents,
  resolveDateWindow,
  venueOptions,
  type AgendaEvent,
  type AgendaFilters,
} from "@/lib/parent/agenda-model"

/**
 * The rules a Guardian actually acts on: what "3 attendance responses
 * needed" counts, what a filter does, and how two children sharing one
 * fixture are kept distinct.
 *
 * The metric is derived on every read rather than stored, so these tests
 * are the only thing standing between a parent and a confidently wrong
 * number on the front of their agenda.
 */

const TODAY = "2026-09-07"

function ev(over: Partial<AgendaEvent> & { eventId: string; playerId: string; date: string }): AgendaEvent {
  return {
    key: `${over.kind ?? "fixture"}:${over.eventId}:${over.playerId}`,
    kind: "fixture",
    childName: "Pippa Testfamily",
    childFirstName: "Pippa",
    teamId: "team-u9",
    teamName: "Under 9",
    clubName: "Burnley RUFC",
    time: "10:30",
    title: "Burnley RUFC v Rossendale RUFC",
    venue: "Holden Road",
    status: "Confirmed",
    attendance: null,
    href: null,
    ...over,
  }
}

test("date arithmetic is date-only, so a kickoff never shifts across a timezone", () => {
  assert.equal(daysBetween("2026-09-07", "2026-09-21"), 14)
  assert.equal(daysBetween("2026-09-07", "2026-09-07"), 0)
  assert.equal(daysBetween("2026-09-07", "2026-09-06"), -1)
  // Across a DST boundary in Europe/London (clocks go back 2026-10-25).
  assert.equal(daysBetween("2026-10-24", "2026-10-26"), 2)
  // Across a year boundary.
  assert.equal(daysBetween("2026-12-31", "2027-01-01"), 1)
})

test("one child never appears twice for the same event", () => {
  // A fixture matched through both owning and opponent team -- what happens
  // when two of the same club's teams play each other.
  const events = [
    ev({ eventId: "fix-1", playerId: "p1", date: "2026-09-12" }),
    ev({ eventId: "fix-1", playerId: "p1", date: "2026-09-12" }),
  ]
  assert.equal(dedupeAgendaEvents(events).length, 1)
})

test("two siblings at the same fixture are two rows, not one", () => {
  // They answer separately, so collapsing them would lose one child's
  // response entirely.
  const events = [
    ev({ eventId: "fix-1", playerId: "pippa", date: "2026-09-12" }),
    ev({ eventId: "fix-1", playerId: "jaxon", date: "2026-09-12", childName: "Jaxon Testfamily" }),
  ]
  assert.equal(dedupeAgendaEvents(events).length, 2)
})

test("the outstanding count is exactly: unanswered, upcoming, within 14 days", () => {
  const events = [
    ev({ eventId: "a", playerId: "p1", date: "2026-09-08" }), // tomorrow, unanswered -> counts
    ev({ eventId: "b", playerId: "p1", date: "2026-09-21" }), // day 14, unanswered -> counts (inclusive)
    ev({ eventId: "c", playerId: "p1", date: "2026-09-22" }), // day 15 -> outside the horizon
    ev({ eventId: "d", playerId: "p1", date: "2026-09-06" }), // yesterday -> cannot be acted on
    ev({ eventId: "e", playerId: "p1", date: "2026-09-10", attendance: "ATTENDING" }),
    ev({ eventId: "f", playerId: "p1", date: "2026-09-10", attendance: "CANNOT_ATTEND" }),
    ev({ eventId: "g", playerId: "p1", date: "2026-09-10", attendance: "UNSURE" }),
  ]
  assert.equal(countOutstandingResponses(events, TODAY), 2)
  assert.equal(ATTENDANCE_HORIZON_DAYS, 14)
})

test("Unsure is a real answer, not an outstanding one", () => {
  // A parent who said "not sure yet" has responded. Counting them as
  // outstanding would nag someone who already did the thing we asked.
  const events = [ev({ eventId: "a", playerId: "p1", date: "2026-09-10", attendance: "UNSURE" })]
  assert.equal(countOutstandingResponses(events, TODAY), 0)
})

test("a cancelled fixture is never an outstanding response", () => {
  const events = [ev({ eventId: "a", playerId: "p1", date: "2026-09-10", status: "Cancelled" })]
  assert.equal(countOutstandingResponses(events, TODAY), 0)
})

test("training counts toward the same metric as fixtures", () => {
  const events = [
    ev({ eventId: "t1", playerId: "p1", date: "2026-09-09", kind: "training", status: null }),
    ev({ eventId: "f1", playerId: "p1", date: "2026-09-09" }),
  ]
  assert.equal(countOutstandingResponses(events, TODAY), 2)
})

test("All Children aggregates across linked players without double counting one of them", () => {
  const events = [
    ev({ eventId: "fix-1", playerId: "pippa", date: "2026-09-12" }),
    ev({ eventId: "fix-1", playerId: "pippa", date: "2026-09-12" }), // duplicate row for ONE child
    ev({ eventId: "fix-1", playerId: "jaxon", date: "2026-09-12" }), // sibling, same fixture
  ]
  // Two children owe an answer for this one physical fixture: 2, not 3.
  assert.equal(countOutstandingResponses(events, TODAY), 2)
})

test("the outstanding card can hand the agenda exactly what it counted", () => {
  const events = [
    ev({ eventId: "a", playerId: "p1", date: "2026-09-08" }),
    ev({ eventId: "b", playerId: "p1", date: "2026-09-10", attendance: "ATTENDING" }),
  ]
  const needed = outstandingResponseEvents(events, TODAY)
  const filtered = applyAgendaFilters(events, { ...baseFilters, attendance: "needs_response" }, TODAY)
  assert.deepEqual(
    filtered.map((e) => e.key),
    needed.map((e) => e.key),
    "the Needs response filter and the card's own count disagree"
  )
})

const baseFilters: AgendaFilters = {
  playerIds: [],
  teamIds: [],
  kind: "all",
  attendance: "all",
  venue: null,
  dateRange: "all",
}

test("filtering by child shows only that child", () => {
  const events = [
    ev({ eventId: "a", playerId: "pippa", date: "2026-09-12" }),
    ev({ eventId: "a", playerId: "jaxon", date: "2026-09-12" }),
  ]
  const out = applyAgendaFilters(events, { ...baseFilters, playerIds: ["pippa"] }, TODAY)
  assert.equal(out.length, 1)
  assert.equal(out[0].playerId, "pippa")
})

test("two children's different answers are never collapsed into one family status", () => {
  const events = [
    ev({ eventId: "fix-1", playerId: "pippa", date: "2026-09-12", attendance: "ATTENDING" }),
    ev({ eventId: "fix-1", playerId: "jaxon", date: "2026-09-12", attendance: "CANNOT_ATTEND" }),
  ]
  const attending = applyAgendaFilters(events, { ...baseFilters, attendance: "ATTENDING" }, TODAY)
  const cannot = applyAgendaFilters(events, { ...baseFilters, attendance: "CANNOT_ATTEND" }, TODAY)
  assert.deepEqual(attending.map((e) => e.playerId), ["pippa"])
  assert.deepEqual(cannot.map((e) => e.playerId), ["jaxon"])
})

test("event type, venue and team filters each narrow correctly", () => {
  const events = [
    ev({ eventId: "f1", playerId: "p1", date: "2026-09-12", venue: "Holden Road" }),
    ev({ eventId: "t1", playerId: "p1", date: "2026-09-13", kind: "training", venue: "Barden Lane", teamId: "team-u12" }),
  ]
  assert.deepEqual(applyAgendaFilters(events, { ...baseFilters, kind: "training" }, TODAY).map((e) => e.eventId), ["t1"])
  assert.deepEqual(applyAgendaFilters(events, { ...baseFilters, kind: "fixture" }, TODAY).map((e) => e.eventId), ["f1"])
  assert.deepEqual(applyAgendaFilters(events, { ...baseFilters, venue: "Barden Lane" }, TODAY).map((e) => e.eventId), ["t1"])
  assert.deepEqual(applyAgendaFilters(events, { ...baseFilters, teamIds: ["team-u12"] }, TODAY).map((e) => e.eventId), ["t1"])
})

test("date ranges resolve to real inclusive windows", () => {
  assert.equal(resolveDateWindow("all", TODAY, null), null)
  assert.deepEqual(resolveDateWindow("this_month", TODAY, null), { startIso: "2026-09-01", endIso: "2026-09-30" })
  assert.deepEqual(resolveDateWindow("next_14_days", TODAY, null), { startIso: "2026-09-07", endIso: "2026-09-21" })
  assert.deepEqual(resolveDateWindow("next_30_days", TODAY, null), { startIso: "2026-09-07", endIso: "2026-10-07" })
  // February, to prove month-end is computed rather than assumed to be 30.
  assert.deepEqual(resolveDateWindow("this_month", "2028-02-10", null), { startIso: "2028-02-01", endIso: "2028-02-29" })
})

test("Season with no configured season shows everything rather than an empty page", () => {
  const events = [ev({ eventId: "a", playerId: "p1", date: "2026-09-12" })]
  assert.equal(applyAgendaFilters(events, { ...baseFilters, dateRange: "season" }, TODAY, null).length, 1)
  assert.equal(
    applyAgendaFilters(events, { ...baseFilters, dateRange: "season" }, TODAY, { startIso: "2026-08-01", endIso: "2027-06-30" }).length,
    1
  )
  assert.equal(
    applyAgendaFilters(events, { ...baseFilters, dateRange: "season" }, TODAY, { startIso: "2027-08-01", endIso: "2028-06-30" }).length,
    0
  )
})

test("months are grouped with their year and ordered chronologically", () => {
  const events = [
    ev({ eventId: "c", playerId: "p1", date: "2027-01-10" }),
    ev({ eventId: "a", playerId: "p1", date: "2026-09-20" }),
    ev({ eventId: "b", playerId: "p1", date: "2026-09-12" }),
  ]
  const months = groupAgendaByMonth(events)
  assert.deepEqual(months.map((m) => m.label), ["September 2026", "January 2027"])
  // Two different Septembers must never share a heading.
  assert.deepEqual(months[0].events.map((e) => e.eventId), ["b", "a"])
})

test("within a month, events sort by date then time", () => {
  const events = [
    ev({ eventId: "late", playerId: "p1", date: "2026-09-12", time: "14:00" }),
    ev({ eventId: "early", playerId: "p1", date: "2026-09-12", time: "09:00" }),
  ]
  assert.deepEqual(groupAgendaByMonth(events)[0].events.map((e) => e.eventId), ["early", "late"])
})

test("venue options come from the data, so no filter offers an empty result", () => {
  const events = [
    ev({ eventId: "a", playerId: "p1", date: "2026-09-12", venue: "Holden Road" }),
    ev({ eventId: "b", playerId: "p1", date: "2026-09-13", venue: null }),
    ev({ eventId: "c", playerId: "p1", date: "2026-09-14", venue: "Barden Lane" }),
  ]
  assert.deepEqual(venueOptions(events), ["Barden Lane", "Holden Road"])
})
