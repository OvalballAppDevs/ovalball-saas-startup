/**
 * P2 — THE THREE QUESTIONS PARENT HOME ANSWERS.
 *
 * What needs me, what is next, what is on this week. Every rule below is a
 * PRODUCT decision, which is why it lives in `packages/contracts` rather than in
 * a screen: a phone that decided any of them a second way would eventually tell a
 * parent something the website disagrees with.
 *
 * Nothing here authorises anything. Every function under test is array in, array
 * out over rows the canonical family scope already returned, so a case that
 * "leaks" would have to be a row the server handed over -- and that is the
 * agenda's own coverage, not this suite's.
 */

import assert from "node:assert/strict"
import { test } from "node:test"

import {
  ATTENDANCE_HORIZON_DAYS,
  FAMILY_HORIZON_DAYS,
  URGENT_WITHIN_DAYS,
  attendanceAttention,
  dayLabel,
  eventDescription,
  groupByDay,
  needsAttendanceResponse,
  narrowToChild,
  nextEvent,
  projectParentHome,
  sortAgenda,
} from "@ovalball/contracts"
import type { AgendaItem } from "@ovalball/contracts"

import { agendaIntent, routeForAgendaItem, routeForIntent } from "../../../apps/mobile/src/links/destinations"

const TODAY = "2026-10-01" // a Thursday
const MONDAY = "2026-09-28"
const SUNDAY = "2026-10-04"

function event(overrides: Partial<AgendaItem> & { key: string; date: string }): AgendaItem {
  return {
    kind: "fixture",
    eventId: overrides.eventId ?? overrides.key,
    time: "10:30",
    meetTime: null,
    us: { directoryId: null, clubName: "Ovalball UAT RUFC", teamName: "Under 12 Boys", compactName: "U12", crestUrl: null, kit: null },
    them: { directoryId: null, clubName: "Ashton Under Lyne RUFC", teamName: "Under 12 Boys", compactName: "U12", crestUrl: null, kit: null },
    homeAway: "Away",
    venue: "Ashton Under Lyne RUFC",
    pitch: null,
    status: "Booked",
    result: null,
    playerId: "p-1",
    childFirstName: "Pippa",
    attendance: null,
    teamId: "team-u12",
    clubId: "club-1",
    href: null,
    ...overrides,
  } as AgendaItem
}

// -------------------------------------------------------------- what is next

test("the next thing is the soonest one that is actually happening", () => {
  const items = [
    event({ key: "sunday", date: "2026-10-04" }),
    event({ key: "saturday", date: "2026-10-03" }),
  ]
  assert.equal(nextEvent(items, TODAY)?.key, "saturday")
})

test("a cancelled match does not take the headline, but is not deleted either", () => {
  const items = [
    event({ key: "off", date: "2026-10-03", status: "Cancelled" }),
    event({ key: "on", date: "2026-10-04" }),
  ]
  // It is the reason somebody does NOT drive to a ground on Saturday, so it stays
  // on the week's list -- it simply is not what anybody is getting ready for.
  assert.equal(nextEvent(items, TODAY)?.key, "on")
  assert.equal(groupByDay(items, TODAY).flatMap((d) => d.items).length, 2)
})

test("today still counts — a match this afternoon is the next thing this morning", () => {
  assert.equal(nextEvent([event({ key: "today", date: TODAY })], TODAY)?.key, "today")
})

test("yesterday's match is not next", () => {
  assert.equal(nextEvent([event({ key: "gone", date: "2026-09-30" })], TODAY), null)
})

test("nothing upcoming is an ordinary answer, not a failure", () => {
  assert.equal(nextEvent([], TODAY), null)
})

test("training can be the next thing, not only a match", () => {
  const items = [
    event({ key: "match", date: "2026-10-04" }),
    event({ key: "session", date: "2026-10-01", kind: "training", them: null, homeAway: null, status: null, time: "18:00" }),
  ]
  assert.equal(nextEvent(items, TODAY)?.key, "session")
})

// ------------------------------------------------------------- what needs me

test("an unanswered match inside the fortnight needs an answer", () => {
  const attention = attendanceAttention([event({ key: "a", date: "2026-10-04" })], TODAY)
  assert.equal(attention.length, 1)
  assert.equal(attention[0].kind, "availability")
})

test("the question names the child, in the words the Match Centre uses", () => {
  const [item] = attendanceAttention([event({ key: "a", date: "2026-10-04" })], TODAY)
  assert.equal(item.label, "Can Pippa make it?")
  const [session] = attendanceAttention(
    [event({ key: "t", date: "2026-10-02", kind: "training", them: null })],
    TODAY
  )
  assert.equal(session.label, "Can Pippa make training?")
})

test("an adult player is asked about themselves", () => {
  const [item] = attendanceAttention([event({ key: "a", date: "2026-10-04" })], TODAY, { viewerIsThePlayer: true })
  assert.equal(item.label, "Can you make it?")
})

test("an answer given is not a job, and Unsure is an answer", () => {
  for (const answer of ["ATTENDING", "CANNOT_ATTEND", "UNSURE"] as const) {
    assert.deepEqual(
      attendanceAttention([event({ key: "a", date: "2026-10-04", attendance: answer })], TODAY),
      [],
      `${answer} is being chased as though nobody had replied`
    )
  }
})

test("a cancelled match is never chased for an answer", () => {
  assert.deepEqual(attendanceAttention([event({ key: "a", date: "2026-10-04", status: "Cancelled" })], TODAY), [])
})

test("last week's unanswered match is not attention — nobody can act on it", () => {
  assert.deepEqual(attendanceAttention([event({ key: "a", date: "2026-09-20" })], TODAY), [])
})

test("beyond the fortnight it is real rugby but not this fortnight's job", () => {
  const inside = `2026-10-${String(1 + ATTENDANCE_HORIZON_DAYS).padStart(2, "0")}`
  assert.equal(attendanceAttention([event({ key: "edge", date: inside })], TODAY).length, 1)
  const outside = "2026-10-20"
  assert.deepEqual(attendanceAttention([event({ key: "far", date: outside })], TODAY), [])
})

test("close enough to be today's job is marked urgent, not hidden", () => {
  const soon = attendanceAttention([event({ key: "soon", date: "2026-10-03" })], TODAY)[0]
  const later = attendanceAttention([event({ key: "later", date: "2026-10-12" })], TODAY)[0]
  assert.equal(soon.urgent, true)
  assert.equal(later.urgent, false)
  assert.equal(URGENT_WITHIN_DAYS, 3)
})

test("each outstanding answer is its own actionable row, naming its own child", () => {
  const attention = attendanceAttention(
    [
      event({ key: "pippa", date: "2026-10-03", playerId: "p-1", childFirstName: "Pippa" }),
      event({ key: "george", date: "2026-10-04", playerId: "p-2", childFirstName: "George" }),
    ],
    TODAY
  )
  assert.deepEqual(attention.map((a) => a.playerId), ["p-1", "p-2"])
  assert.deepEqual(attention.map((a) => a.label), ["Can Pippa make it?", "Can George make it?"])
  // Every row opens the event itself, never a list to go hunting in.
  assert.ok(attention.every((a) => a.item !== null))
})

test("the attention rule is the very same one the website counts with", () => {
  // Not a similar rule: the identical function. If this stops being true the two
  // clients can show a parent different numbers for the same weekend.
  const item = event({ key: "a", date: "2026-10-04" })
  assert.equal(needsAttendanceResponse(item, TODAY), true)
  assert.equal(attendanceAttention([item], TODAY).length, 1)
})

test("a guardian link request is NOT parent attention — it is club safeguarding authority", () => {
  /*
    It looks like a parent's job and it is not one.
    `internal.can_decide_guardian_link_request` requires
    `family.relationship.approve` at the CLUB, so the queue belongs to a Club Admin
    or a Safeguarding Officer -- and it explicitly excludes both the requester and
    the subject. Surfacing it on Parent Home would put a club safeguarding queue
    inside a parent's context, and for somebody holding both hats it would do so
    while they were wearing the wrong one.

    The structural guarantee is that the projection has no input for it at all:
    availability is the only kind it can produce.
  */
  const home = projectParentHome([event({ key: "a", date: "2026-10-04" })], {
    todayIso: TODAY,
    weekStartIso: MONDAY,
    weekEndIso: SUNDAY,
  })
  assert.deepEqual(new Set(home.attention.map((a) => a.kind)), new Set(["availability"]))
})

test("attention has exactly one canonical kind, so a new row needs a new domain state", () => {
  const home = projectParentHome([event({ key: "a", date: "2026-10-04" })], {
    todayIso: TODAY,
    weekStartIso: MONDAY,
    weekEndIso: SUNDAY,
  })
  assert.ok(home.attention.every((a) => a.kind === "availability"))
  // And every one of them opens the event it is about, never a list.
  assert.ok(home.attention.every((a) => a.item !== null))
})

test("unread messages and notifications are not attention", () => {
  // The whole panel is built from agenda rows and a guardian-request count. There
  // is no input for an unread figure, which is the structural reason a count can
  // never appear here: read is not resolved, and a badge already says it.
  const home = projectParentHome([], { todayIso: TODAY, weekStartIso: MONDAY, weekEndIso: SUNDAY })
  assert.deepEqual(home.attention, [])
})

// ------------------------------------------------------------ what is on now

test("this week is the canonical Monday-to-Sunday rugby week", () => {
  const items = [
    event({ key: "tue-gone", date: "2026-09-29" }),
    event({ key: "thu", date: "2026-10-01" }),
    event({ key: "sat", date: "2026-10-03" }),
    event({ key: "next-tue", date: "2026-10-06" }),
  ]
  const home = projectParentHome(items, { todayIso: TODAY, weekStartIso: MONDAY, weekEndIso: SUNDAY })
  assert.deepEqual(home.week.flatMap((d) => d.items).map((i) => i.key), ["thu", "sat"])
})

test("the week never looks backwards, even inside its own window", () => {
  const home = projectParentHome([event({ key: "monday", date: MONDAY })], {
    todayIso: TODAY,
    weekStartIso: MONDAY,
    weekEndIso: SUNDAY,
  })
  assert.deepEqual(home.week, [])
})

test("days people are deciding about are named, the rest carry their weekday", () => {
  assert.equal(dayLabel(TODAY, TODAY), "Today")
  assert.equal(dayLabel("2026-10-02", TODAY), "Tomorrow")
  assert.equal(dayLabel("2026-10-03", TODAY), "Saturday")
  assert.equal(dayLabel("2026-10-04", TODAY), "Sunday")
  // Beyond the week a bare weekday is ambiguous, so it carries the date.
  assert.equal(dayLabel("2026-10-13", TODAY), "Tuesday 13 Oct")
})

test("a day with nothing in it is not a heading", () => {
  const days = groupByDay([event({ key: "sat", date: "2026-10-03" })], TODAY)
  assert.deepEqual(days.map((d) => d.label), ["Saturday"])
})

test("within a day it is by time, then by child, so siblings never swap places", () => {
  const items = [
    event({ key: "later", date: "2026-10-03", time: "14:00" }),
    event({ key: "b", date: "2026-10-03", time: "10:30", childFirstName: "Zoe", playerId: "p-3" }),
    event({ key: "a", date: "2026-10-03", time: "10:30", childFirstName: "Alice", playerId: "p-4" }),
  ]
  assert.deepEqual(sortAgenda(items).map((i) => i.key), ["a", "b", "later"])
})

test("an event with no time yet sorts after the ones that have one", () => {
  const items = [event({ key: "tbc", date: "2026-10-03", time: null }), event({ key: "set", date: "2026-10-03", time: "10:30" })]
  assert.deepEqual(sortAgenda(items).map((i) => i.key), ["set", "tbc"])
})

test("Next Up is flagged where it repeats inside the week, so it is not read twice", () => {
  const home = projectParentHome([event({ key: "sat", date: "2026-10-03" })], {
    todayIso: TODAY,
    weekStartIso: MONDAY,
    weekEndIso: SUNDAY,
  })
  assert.equal(home.next?.key, "sat")
  assert.equal(home.nextIsInWeek, true)
})

test("a next event beyond this week does not claim to be in it", () => {
  const home = projectParentHome([event({ key: "far", date: "2026-11-14" })], {
    todayIso: TODAY,
    weekStartIso: MONDAY,
    weekEndIso: SUNDAY,
  })
  assert.equal(home.next?.key, "far", "a match seven weeks out is still the next one")
  assert.equal(home.nextIsInWeek, false)
  assert.deepEqual(home.week, [])
})

test("a row is described by participant facts and nothing operational", () => {
  const match = eventDescription(event({ key: "a", date: "2026-10-03" }))
  assert.equal(match, "v Ashton Under Lyne RUFC Under 12 Boys · Away · 10:30")
  const training = eventDescription(
    event({ key: "t", date: "2026-10-01", kind: "training", them: null, homeAway: null, time: "18:00", venue: "Prairie Playing Fields" })
  )
  // Training has no opposition and is never given a fake one.
  assert.equal(training, "18:00 · Prairie Playing Fields")
})

test("the family read horizon is the same four months the website reads", () => {
  assert.equal(FAMILY_HORIZON_DAYS, 120)
})

// -------------------------------------------------------- which child

const PIPPA = event({ key: "pippa-sat", date: "2026-10-03", playerId: "p-1", childFirstName: "Pippa" })
const GEORGE = event({ key: "george-sun", date: "2026-10-04", playerId: "p-2", childFirstName: "George" })
const STAFF_ROW = event({ key: "team-row", date: "2026-10-03", playerId: null, childFirstName: null })

test("one child sees their own rugby, and no aggregation happens to them", () => {
  const home = projectParentHome(narrowToChild([PIPPA], null), {
    todayIso: TODAY,
    weekStartIso: MONDAY,
    weekEndIso: SUNDAY,
  })
  assert.equal(home.next?.key, "pippa-sat")
  assert.equal(home.attention.length, 1)
})

test("All aggregates every child, in one chronological order", () => {
  const home = projectParentHome(narrowToChild([GEORGE, PIPPA], null), {
    todayIso: TODAY,
    weekStartIso: MONDAY,
    weekEndIso: SUNDAY,
  })
  assert.deepEqual(home.week.flatMap((d) => d.items).map((i) => i.key), ["pippa-sat", "george-sun"])
  assert.deepEqual(home.attention.map((a) => a.playerId), ["p-1", "p-2"])
})

test("every row in the aggregated view says which child it is about", () => {
  // The rule the product forbids breaking: a parent must not have to work the
  // child out from an age grade. Each row carries the canonical player id, which
  // is what the screen resolves the name and the picture from.
  for (const item of narrowToChild([PIPPA, GEORGE], null)) {
    assert.ok(item.playerId, `${item.key} belongs to no child`)
  }
})

test("filtering to one child removes the other, and nothing else", () => {
  assert.deepEqual(narrowToChild([PIPPA, GEORGE, STAFF_ROW], "p-1").map((i) => i.key), ["pippa-sat"])
  assert.deepEqual(narrowToChild([PIPPA, GEORGE, STAFF_ROW], "p-2").map((i) => i.key), ["george-sun"])
})

test("one child's attention never appears under the other's name", () => {
  const pippa = projectParentHome(narrowToChild([PIPPA, GEORGE], "p-1"), {
    todayIso: TODAY,
    weekStartIso: MONDAY,
    weekEndIso: SUNDAY,
  })
  assert.deepEqual(pippa.attention.map((a) => a.label), ["Can Pippa make it?"])
  const george = projectParentHome(narrowToChild([PIPPA, GEORGE], "p-2"), {
    todayIso: TODAY,
    weekStartIso: MONDAY,
    weekEndIso: SUNDAY,
  })
  assert.deepEqual(george.attention.map((a) => a.label), ["Can George make it?"])
})

test("an id belonging to nobody empties the screen rather than widening it", () => {
  // Belt and braces behind FamilyProjection's normalisation: even if a stray id
  // reached this far, subtraction cannot add a row the read never returned.
  assert.deepEqual(narrowToChild([PIPPA, GEORGE], "p-99"), [])
  const home = projectParentHome(narrowToChild([PIPPA, GEORGE], "p-99"), {
    todayIso: TODAY,
    weekStartIso: MONDAY,
    weekEndIso: SUNDAY,
  })
  assert.equal(home.next, null)
  assert.deepEqual(home.attention, [])
  assert.deepEqual(home.week, [])
})

test("narrowing cannot reach a row the read did not contain", () => {
  const narrowed = narrowToChild([PIPPA, GEORGE], "p-1")
  assert.ok(narrowed.every((item) => [PIPPA, GEORGE].includes(item)))
  assert.ok(narrowed.length <= 2)
})

// --------------------------------------------------- where an event opens

test("a parent's match opens the Match Centre, never fixture administration", () => {
  for (const kind of ["parent", "family", "player"] as const) {
    const route = routeForAgendaItem(event({ key: "a", date: "2026-10-03", eventId: "fx-1" }), kind)
    assert.deepEqual(route, { pathname: "/fixtures/[fixtureId]/match-centre", params: { fixtureId: "fx-1" } })
  }
})

test("staff keep the fixture screen, where administration lives", () => {
  for (const kind of ["team", "club", "site_admin"] as const) {
    const route = routeForAgendaItem(event({ key: "a", date: "2026-10-03", eventId: "fx-1" }), kind)
    assert.deepEqual(route, { pathname: "/fixtures/[fixtureId]", params: { fixtureId: "fx-1" } })
  }
})

test("training opens the Training Centre for everybody", () => {
  for (const kind of ["parent", "family", "player", "team", "club"] as const) {
    const route = routeForAgendaItem(
      event({ key: "t", date: "2026-10-01", kind: "training", eventId: "ts-1", them: null }),
      kind
    )
    assert.deepEqual(route, { pathname: "/calendar/training/[sessionId]", params: { sessionId: "ts-1" } })
  }
})

test("no participant event ever resolves to the planner, the importer or a new fixture", () => {
  const forbidden = ["/fixtures/new", "/fixtures/planner", "/fixtures/import", "/fixtures/competitions", "/admin"]
  for (const kind of ["parent", "family", "player"] as const) {
    for (const item of [
      event({ key: "a", date: "2026-10-03" }),
      event({ key: "t", date: "2026-10-01", kind: "training", them: null }),
    ]) {
      const route = routeForAgendaItem(item, kind)
      assert.ok(route, "a participant event resolved nowhere at all")
      for (const path of forbidden) {
        assert.ok(!route!.pathname.startsWith(path), `${kind} reached ${route!.pathname}`)
      }
    }
  }
})

test("the intent and the route are one table — no screen holds a second copy", () => {
  const intent = agendaIntent(event({ key: "a", date: "2026-10-03", eventId: "fx-9" }), "parent")
  assert.deepEqual(intent, { kind: "MATCH_CENTRE", fixtureId: "fx-9" })
  assert.deepEqual(routeForIntent(intent), {
    pathname: "/fixtures/[fixtureId]/match-centre",
    params: { fixtureId: "fx-9" },
  })
})

test("a link this build cannot complete resolves to no route rather than a guess", () => {
  assert.equal(routeForIntent({ kind: "NOT_YET_SUPPORTED", path: "/subscriptions" }), null)
  assert.equal(routeForIntent({ kind: "UNKNOWN" }), null)
})
