/**
 * P4 — THE FAMILY CALENDAR, AND THE TRAINING CENTRE'S OWN BOUNDARY.
 *
 * WHAT A PARENT'S CALENDAR IS: a read-only answer to "what rugby is happening
 * across my family". Not a way to administer any of it. Two things are asserted
 * here -- the DATA (whose events, on which days, in what state) and the
 * STRUCTURE (that the screen cannot create, edit, move or cancel anything, and
 * that the Training Centre's administrative half is not even mounted without the
 * server's own answer).
 *
 * The authority half is proved in SQL, in `participant_route_authority.sql`, and
 * in the RED run. UI absence is never offered here as proof of authority.
 */

import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

import {
  ATTENDANCE_STATE_WORDS,
  attendanceConfirmation,
  dayLabel,
  groupByDay,
  narrowToChild,
  WEEKDAY_INITIALS,
  marksByDay,
  monthCells,
  monthLabel,
  monthWeeks,
  needsAttendanceResponse,
  nextDayWithSomething,
  projectFamily,
  memberFor,
  sortAgenda,
  type AgendaItem,
} from "@ovalball/contracts"

import { applyFilter, NO_FILTER } from "../../../apps/mobile/src/agenda/filter"
import { routeForAgendaItem } from "../../../apps/mobile/src/links/destinations"

const TODAY = "2026-10-01" // a Thursday

function item(overrides: Partial<AgendaItem> & { key: string; date: string }): AgendaItem {
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

const training = (overrides: Partial<AgendaItem> & { key: string; date: string }) =>
  item({ kind: "training", them: null, homeAway: null, status: null, venue: "Prairie Playing Fields", ...overrides })

// -------------------------------------------------------- whose rugby it is

const CHILDREN = [
  { playerId: "p-1", firstName: "Pippa", surname: "Krzysik", fullName: "Pippa Krzysik", teamId: "team-u12", teamName: "Under 12 Girls", clubId: "club-1", clubName: "Ovalball UAT RUFC", avatarStoragePath: "players/pippa.jpg" },
  { playerId: "p-2", firstName: "George", surname: "Krzysik", fullName: "George Krzysik", teamId: "team-u10", teamName: "Under 10 Boys", clubId: "club-1", clubName: "Ovalball UAT RUFC", avatarStoragePath: null },
]
const FAMILY = projectFamily(CHILDREN, new Map([["players/pippa.jpg", "https://signed.example/pippa"]]))
const ONE_CHILD = projectFamily([CHILDREN[0]], new Map())

test("one child needs no chooser, and the calendar is simply theirs", () => {
  assert.equal(ONE_CHILD.hasChoice, false)
  const rows = [item({ key: "a", date: "2026-10-03" }), training({ key: "b", date: "2026-10-01", time: "18:00" })]
  assert.equal(narrowToChild(rows, null).length, 2)
})

test("All aggregates every child's rugby into one chronology", () => {
  const rows = [
    item({ key: "george", date: "2026-10-03", time: "09:30", playerId: "p-2", childFirstName: "George", teamId: "team-u10" }),
    training({ key: "pippa", date: "2026-10-01", time: "18:00", playerId: "p-1", childFirstName: "Pippa" }),
  ]
  assert.deepEqual(sortAgenda(narrowToChild(rows, null)).map((r) => r.key), ["pippa", "george"])
})

test("choosing one child removes the other and nothing else", () => {
  const rows = [
    item({ key: "pippa", date: "2026-10-03", playerId: "p-1" }),
    item({ key: "george", date: "2026-10-04", playerId: "p-2", childFirstName: "George" }),
  ]
  assert.deepEqual(narrowToChild(rows, "p-1").map((r) => r.key), ["pippa"])
  assert.deepEqual(narrowToChild(rows, "p-2").map((r) => r.key), ["george"])
  // The Calendar narrows the SAME way, through the shared agenda filter.
  assert.deepEqual(applyFilter(rows, { ...NO_FILTER, playerId: "p-1" }).map((r) => r.key), ["pippa"])
})

test("an id belonging to nobody cannot widen the calendar", () => {
  const rows = [item({ key: "pippa", date: "2026-10-03", playerId: "p-1" })]
  assert.deepEqual(narrowToChild(rows, "p-99"), [])
  assert.deepEqual(applyFilter(rows, { ...NO_FILTER, playerId: "p-99" }), [])
  assert.equal(memberFor(FAMILY, "p-99"), null, "an unknown id must draw no identity at all")
})

// -------------------------------------------------- the real family collision

test("two children on the same evening stay two events", () => {
  // Pippa trains at six, George plays at half past. This is the ordinary Tuesday
  // a family calendar exists for, and merging them would be the worst thing it
  // could do.
  const rows = [
    training({ key: "pippa-training", date: TODAY, time: "18:00", playerId: "p-1", childFirstName: "Pippa" }),
    item({ key: "george-match", date: TODAY, time: "18:30", playerId: "p-2", childFirstName: "George", teamId: "team-u10" }),
  ]
  const days = groupByDay(rows, TODAY)
  assert.equal(days.length, 1, "one day")
  assert.equal(days[0].label, "Today")
  assert.equal(days[0].items.length, 2, "two events, not one")
  assert.deepEqual(days[0].items.map((r) => r.key), ["pippa-training", "george-match"])
})

test("events at the identical minute are still two events, ordered by child", () => {
  const rows = [
    item({ key: "george", date: TODAY, time: "18:00", playerId: "p-2", childFirstName: "George" }),
    training({ key: "pippa", date: TODAY, time: "18:00", playerId: "p-1", childFirstName: "Pippa" }),
  ]
  const [day] = groupByDay(rows, TODAY)
  assert.equal(day.items.length, 2)
  assert.deepEqual(day.items.map((r) => r.childFirstName), ["George", "Pippa"])
})

test("each event resolves its own child's identity, and one cannot bleed into the other", () => {
  const rows = [
    training({ key: "pippa", date: TODAY, time: "18:00", playerId: "p-1", teamId: "team-u12" }),
    item({ key: "george", date: TODAY, time: "18:30", playerId: "p-2", teamId: "team-u10" }),
  ]
  const marks = rows.map((r) => memberFor(FAMILY, r.playerId))
  assert.deepEqual(marks.map((m) => m?.shortLabel), ["Pippa", "George"])
  // Pippa has a photograph and George does not. If a row reached for the family's
  // first member rather than its own, both would show the same face.
  assert.equal(marks[0]?.avatarUrl, "https://signed.example/pippa")
  assert.equal(marks[1]?.avatarUrl, null)
  assert.equal(marks[1]?.initials, "GK")
  // And each row keeps its OWN side, so a crest cannot cross either.
  assert.deepEqual(rows.map((r) => r.teamId), ["team-u12", "team-u10"])
})

// ------------------------------------------------------------ dates and state

test("today, tomorrow and the rest of the week read as a parent would say them", () => {
  assert.equal(dayLabel(TODAY, TODAY), "Today")
  assert.equal(dayLabel("2026-10-02", TODAY), "Tomorrow")
  assert.equal(dayLabel("2026-10-03", TODAY), "Saturday")
  assert.equal(dayLabel("2026-10-20", TODAY), "Tuesday 20 Oct", "a date three weeks out needs its date")
})

test("a day with nothing on it produces no heading", () => {
  assert.deepEqual(groupByDay([], TODAY), [])
})

test("a cancelled event stays on the calendar — it is the reason nobody travels", () => {
  const rows = [item({ key: "off", date: "2026-10-03", status: "Cancelled" })]
  assert.equal(groupByDay(rows, TODAY)[0].items.length, 1)
  assert.equal(rows[0].status, "Cancelled", "the canonical status, not a derived one")
})

test("a cancelled event is never marked as waiting for an answer", () => {
  assert.equal(needsAttendanceResponse(item({ key: "off", date: "2026-10-03", status: "Cancelled" }), TODAY), false)
})

test("an outstanding answer is marked with the canonical Awaiting word, not a new one", () => {
  assert.equal(needsAttendanceResponse(item({ key: "a", date: "2026-10-03" }), TODAY), true)
  assert.equal(ATTENDANCE_STATE_WORDS.AWAITING, "Awaiting")
  // And an answered event is described by its own canonical word.
  assert.equal(ATTENDANCE_STATE_WORDS.ATTENDING, "Attending")
  assert.equal(needsAttendanceResponse(item({ key: "a", date: "2026-10-03", attendance: "UNSURE" }), TODAY), false)
})

test("a past event is not shown as waiting, however unanswered it is", () => {
  assert.equal(needsAttendanceResponse(item({ key: "gone", date: "2026-09-20" }), TODAY), false)
})

// ------------------------------------------------------- where an event opens

test("a parent's calendar match opens Match Centre and a session opens Training Centre", () => {
  for (const kind of ["parent", "family", "player"] as const) {
    assert.deepEqual(routeForAgendaItem(item({ key: "m", date: TODAY, eventId: "fx-1" }), kind), {
      pathname: "/fixtures/[fixtureId]/match-centre",
      params: { fixtureId: "fx-1" },
    })
    assert.deepEqual(routeForAgendaItem(training({ key: "t", date: TODAY, eventId: "ts-1" }), kind), {
      pathname: "/calendar/training/[sessionId]",
      params: { sessionId: "ts-1" },
    })
  }
})

// ------------------------------------------------- the calendar cannot edit

const CALENDAR = "apps/mobile/app/(tabs)/calendar/index.tsx"
const TRAINING_SCREEN = "apps/mobile/app/(tabs)/calendar/training/[sessionId].tsx"

test("the Calendar imports nothing that could change an event", () => {
  const src = readFileSync(CALENDAR, "utf8")
  for (const forbidden of [
    "cancelFixture", "updateKickoff", "updateVenue", "updatePitch", "updateDetails", "updateMeetTime",
    "cancelTrainingSession", "overrideTrainingSession", "createFixture", "respondToAttendance",
    "field-sheet", "fixture-console", "training-operations",
  ]) {
    assert.ok(!src.includes(forbidden), `the Calendar reaches for ${forbidden}`)
  }
})

test("the Calendar offers no create, and no device calendar", () => {
  const src = readFileSync(CALENDAR, "utf8")
  for (const forbidden of ["/fixtures/new", "expo-calendar", "Calendar.requestCalendarPermissions", "addEventAsync"]) {
    assert.ok(!src.includes(forbidden), `the Calendar reaches for ${forbidden}`)
  }
})

test("nothing in the app writes to the device's own calendar yet", () => {
  // A separate native capability with its own permission prompt and its own product
  // decision. P4 is the Ovalball in-app calendar.
  for (const file of sourceFiles("apps/mobile/src").concat(sourceFiles("apps/mobile/app"))) {
    const src = readFileSync(file, "utf8")
    assert.ok(!/expo-calendar|requestCalendarPermissions|addEventAsync/.test(src), `${file} reaches for the device calendar`)
  }
})

// ------------------------------- the Training Centre's administrative half

test("the Training Centre's administrative half is a component nothing else mounts", () => {
  const importers = sourceFiles("apps/mobile/src")
    .concat(sourceFiles("apps/mobile/app"))
    .filter((f) => !f.endsWith("training-operations.tsx") && /training-operations/.test(readFileSync(f, "utf8")))
  assert.deepEqual(importers, [TRAINING_SCREEN], "something other than the Training Centre can mount training administration")
})

test("and it is mounted only on the server's own can_manage", () => {
  const src = readFileSync(TRAINING_SCREEN, "utf8")
  // The mount itself is the gate, not a condition inside the sheets.
  assert.match(src, /\{session\.canManage && \(/, "the operations block is not gated on the server's answer")
  const gateIndex = src.indexOf("{session.canManage && (")
  assert.ok(gateIndex > 0)
  assert.ok(src.indexOf("<TrainingOperations") > gateIndex, "the sheets are mounted outside the gate")
  assert.ok(src.indexOf("<CancelSessionButton") > gateIndex, "the cancel control is mounted outside the gate")
})

test("the participant screen imports no mutation and no edit sheet", () => {
  const src = readFileSync(TRAINING_SCREEN, "utf8")
  for (const forbidden of ["overrideTrainingSession", "cancelTrainingSession", "field-sheet", "loadVenueOptions", "loadPitchOptions"]) {
    assert.ok(!src.includes(forbidden), `the Training Centre still reaches for ${forbidden} directly`)
  }
})

test("the grounds and pitches are read only by the half that offers the choice", () => {
  // They exist to fill an edit control. Reading them for a parent was a request
  // whose answer had nowhere to go, and a read a participant never makes cannot leak.
  const ops = readFileSync("apps/mobile/src/training/training-operations.tsx", "utf8")
  assert.match(ops, /loadVenueOptions/)
  assert.match(ops, /loadPitchOptions/)
})

test("every editable field is still gated on the server's answer, and draws nothing without it", () => {
  const src = readFileSync(TRAINING_SCREEN, "utf8")
  assert.match(src, /canEdit = Boolean\(session\?\.canManage\)/)
  const shared = readFileSync(TRAINING_SCREEN, "utf8")
  assert.match(shared, /if \(!editable \|\| !onPress\) return content/, "a non-editable row still draws a press target")
})

test("the register is asked for only where the server already said so", () => {
  const src = readFileSync(TRAINING_SCREEN, "utf8")
  assert.match(src, /loaded\.canViewRegister \? loadTrainingRegister/)
})

// --------------------------------------------------- the confirmation sentence

test("a confirmation says what is true of the child, not that a record was written", () => {
  assert.equal(
    attendanceConfirmation({
      status: "ATTENDING",
      subjectFirstName: "Pippa",
      kind: "training",
      whenLabel: "Saturday 18 October",
      venueName: "Prairie Playing Fields",
    }),
    "Pippa can attend training on Saturday 18 October at Prairie Playing Fields."
  )
})

test("an adult answering for themselves is addressed as themselves", () => {
  assert.equal(
    attendanceConfirmation({ status: "CANNOT_ATTEND", subjectFirstName: null, kind: "fixture", whenLabel: "Sunday 19 October" }),
    "You cannot attend the match on Sunday 19 October."
  )
})

test("Unsure reads as a recorded answer rather than a missing one", () => {
  assert.equal(
    attendanceConfirmation({ status: "UNSURE", subjectFirstName: "George", kind: "training", whenLabel: "Tuesday 14 October" }),
    "George might attend training on Tuesday 14 October."
  )
})

test("a confirmation never claims anybody has been notified", () => {
  for (const status of ["ATTENDING", "CANNOT_ATTEND", "UNSURE"] as const) {
    const sentence = attendanceConfirmation({ status, subjectFirstName: "Pippa", kind: "training", whenLabel: "Saturday 18 October" })
    for (const word of [/notif/i, /told/i, /coach/i, /sent/i, /alerted/i, /saved/i]) {
      assert.ok(!word.test(sentence), `the confirmation implies ${word}: "${sentence}"`)
    }
  }
})

// ----------------------------------------------- the communication offer

test("the Training Centre's communication offer is the canonical chooser, with no directory", () => {
  const src = readFileSync(TRAINING_SCREEN, "utf8")
  // Exactly the Match Centre's shape: the canonical recipient list decides whether
  // the offer is real, and the offer is a route to the chooser rather than a list.
  assert.match(src, /loadRecipients\(supabase\)/)
  assert.match(src, /canReachSomebody/)
  assert.match(src, /router\.push\("\/messages\/new"\)/)
  for (const forbidden of ["fixture_opposition_contacts", "loadOppositionContacts", "openConversationWith", "participants"]) {
    assert.ok(!src.includes(forbidden), `the Training Centre reaches for ${forbidden}`)
  }
})

test("training has no opposition concept for one to arise from", () => {
  const t = training({ key: "t", date: TODAY })
  assert.equal(t.them, null, "a session was given an opponent")
  assert.equal(t.homeAway, null, "a session was given a home or away")
})

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, acc)
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) acc.push(full)
  }
  return acc
}

// ------------------------------------------------------ the month grid itself

test("a month is always six rows, so the sheet below never jumps", () => {
  for (const anchor of ["2026-02-01", "2026-10-15", "2027-01-31", "2028-02-29"]) {
    const weeks = monthWeeks(anchor)
    assert.equal(weeks.length, 6, `${anchor} drew ${weeks.length} rows`)
    assert.ok(weeks.every((w) => w.length === 7))
  }
})

test("the grid starts on Monday, as every other Ovalball week does", () => {
  assert.deepEqual(WEEKDAY_INITIALS, ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"])
  // 1 October 2026 is a Thursday, so the grid opens on Monday 28 September.
  assert.equal(monthCells("2026-10-01")[0].iso, "2026-09-28")
})

test("the days either side belong to their own months and are marked as such", () => {
  const cells = monthCells("2026-10-01")
  assert.equal(cells[0].inMonth, false, "28 September is not October")
  assert.equal(cells.find((c) => c.iso === "2026-10-01")?.inMonth, true)
  assert.equal(cells.find((c) => c.iso === "2026-10-31")?.inMonth, true)
  assert.equal(cells[cells.length - 1].inMonth, false)
})

test("every square is a real date, and they run without a gap", () => {
  const cells = monthCells("2026-10-01")
  assert.equal(cells.length, 42)
  for (let i = 1; i < cells.length; i += 1) {
    const before = new Date(`${cells[i - 1].iso}T12:00:00Z`).getTime()
    const now = new Date(`${cells[i].iso}T12:00:00Z`).getTime()
    assert.equal(now - before, 86_400_000, `a gap before ${cells[i].iso}`)
  }
})

test("the month is named in full, so October 2026 is never October 2027", () => {
  assert.equal(monthLabel("2026-10-15"), "October 2026")
  assert.equal(monthLabel("2027-01-01"), "January 2027")
})

test("a day carries one dot for rugby played and one for rugby trained, never one per event", () => {
  const marks = marksByDay([
    item({ key: "a", date: "2026-10-03" }),
    item({ key: "b", date: "2026-10-03" }),
    item({ key: "c", date: "2026-10-03" }),
    training({ key: "d", date: "2026-10-03" }),
  ])
  assert.deepEqual(marks.get("2026-10-03"), { fixture: true, training: true, cancelled: false })
  assert.equal(marks.size, 1)
})

test("a day with something cancelled says so, and the dot is hollow rather than merely a colour", () => {
  const marks = marksByDay([item({ key: "off", date: "2026-10-03", status: "Cancelled" })])
  assert.equal(marks.get("2026-10-03")?.cancelled, true)
  const panel = readFileSync("apps/mobile/src/components/calendar/month-grid.tsx", "utf8")
  // A HOLLOW DOT, not merely a different colour: the difference has to survive
  // greyscale, sunlight and a screenshot.
  assert.match(panel, /borderWidth: marks\?\.cancelled \? 1 : 0/, "a cancelled day is distinguished by colour alone")
  assert.match(panel, /backgroundColor: marks\?\.cancelled\s*\n?\s*\? "transparent"/)
  // And the spoken label carries the fact rather than describing the decoration.
  assert.match(panel, /marks\?\.cancelled \? "something cancelled" : null/)
})

test("a day with nothing on it carries no dot", () => {
  assert.equal(marksByDay([]).get("2026-10-03"), undefined)
})

test("the dots follow the family filter, so a filtered-out day stops advertising itself", () => {
  const rows = [item({ key: "pippa", date: "2026-10-03", playerId: "p-1" })]
  assert.equal(marksByDay(narrowToChild(rows, "p-2")).size, 0)
  assert.equal(marksByDay(narrowToChild(rows, "p-1")).size, 1)
})

test("a quiet day points at the next one that has something", () => {
  const dates = new Set(["2026-10-03", "2026-10-11", "2026-09-20"])
  assert.equal(nextDayWithSomething(dates, "2026-10-01"), "2026-10-03")
  assert.equal(nextDayWithSomething(dates, "2026-10-04"), "2026-10-11")
  assert.equal(nextDayWithSomething(dates, "2026-10-12"), null, "nothing left is an honest answer")
  // It never looks backwards: a past day is not where the rugby is.
  assert.equal(nextDayWithSomething(dates, "2026-09-25"), "2026-10-03")
})

test("the calendar reads exactly the grid it draws, in one bounded query", () => {
  const src = readFileSync(CALENDAR, "utf8")
  assert.match(src, /const grid = monthCells\(anchor\)/)
  assert.match(src, /start: grid\[0\]\.iso, end: grid\[grid\.length - 1\]\.iso/)
  // No request per day and none per child: one scope, one window, one read.
  assert.ok(!/for \(const (day|child)/.test(src), "the calendar loops a query")
  assert.equal((src.match(/readAgenda\(/g) ?? []).length, 2, "more reads than the month and the season")
})

// ------------------------------------------------- the approved visual shape

/**
 * THE COMPOSITION IS PART OF THE PRODUCT, so it is asserted like one.
 *
 * What these lock is the STRUCTURE the owner approved -- one forest surface from
 * the status bar to the sheet, a chalk sheet rising over it, and no stack of white
 * controls in between. They cannot check that it is beautiful; they can check that
 * the specific things that made it look like an administration tool have not come
 * back.
 */

test("the calendar is one forest surface, not a white header over a green panel", () => {
  const src = readFileSync(CALENDAR, "utf8")
  assert.match(src, /backgroundColor: surface\.forest/, "the screen's ground is not the shared forest token")
  // The header stands ON that ground, with no white card and no rule under it.
  assert.match(src, /<AppHeader onOpenContexts=\{[^}]+\} tone="forest" bottomRule=\{false\} \/>/)
  // And the family chips stand on it too, rather than as white pills.
  assert.match(src, /<ChildFilter [^>]*tone="forest"/)
})

test("nothing invents a second green", () => {
  // One forest, from the tokens. A header that is nearly the calendar's colour is
  // how a screen ends up looking like three panels that do not quite line up.
  for (const file of [
    CALENDAR,
    "apps/mobile/src/components/calendar/calendar-chrome.tsx",
    "apps/mobile/src/components/calendar/month-grid.tsx",
    "apps/mobile/src/components/calendar/event-sheet.tsx",
    "apps/mobile/src/components/participant/event-hero.tsx",
  ]) {
    const src = readFileSync(file, "utf8")
    const literals = src.match(/#[0-9a-fA-F]{6}/g) ?? []
    assert.deepEqual(literals, [], `${file} hard-codes a colour instead of using a token`)
  }
})

test("the old stack of white controls is gone from the calendar's top", () => {
  const src = readFileSync(CALENDAR, "utf8")
  // A season bar and a Pre/Main bar used to live permanently above the grid.
  assert.ok(!/function SeasonBar/.test(src), "the permanent season bar is back")
  // They are a sheet now, opened from a chip.
  assert.match(src, /<SeasonSheet/)
  assert.match(src, /setSeasonOpen\(true\)/)
})

test("a family is not offered the season or its phase at all", () => {
  const src = readFileSync(CALENDAR, "utf8")
  // "Pre-season or main season" is a distinction a club draws for its own
  // planning. A guardian checking Saturday has no use for it.
  assert.match(src, /const offerSeason = !family && seasons\.length > 1/)
  assert.match(src, /offerSeason \? \(/, "the season chip is not gated on that")
})

test("Month and List read the same rows, and Season is not a peer for a family", () => {
  const src = readFileSync(CALENDAR, "utf8")
  assert.match(src, /key: "month" as const/)
  assert.match(src, /key: "list" as const/)
  assert.match(src, /\.\.\.\(offerSeason \? \[\{ key: "season" as const/, "Season is offered to a family")
  // One read feeds every mode: two readAgenda calls, the month grid and the season.
  assert.equal((src.match(/readAgenda\(/g) ?? []).length, 2)
})

test("the chalk sheet rises over the forest, with a handle and a date", () => {
  const sheet = readFileSync("apps/mobile/src/components/calendar/event-sheet.tsx", "utf8")
  assert.match(sheet, /borderTopLeftRadius: 26/)
  assert.match(sheet, /borderTopRightRadius: 26/)
  assert.match(sheet, /marginTop: -12/, "the sheet is butted against the calendar rather than lifted over it")
  assert.match(sheet, /width: 38, height: 4/, "the grab handle is missing")
  assert.match(sheet, /count === 1 \? "1 event" : `\$\{count\} events`/)
})

/** Prose explaining why something is absent must not be mistaken for the thing. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n")
}

test("an event card is informational and navigational, never administrative", () => {
  const card = code("apps/mobile/src/components/calendar/event-sheet.tsx")
  for (const forbidden of ["Edit", "Manage", "Cancel", "Fixture Details", "mutations", "field-sheet"]) {
    assert.ok(!card.includes(forbidden), `the event card offers ${forbidden}`)
  }
  // The whole card goes somewhere, and it says so.
  assert.match(card, /accessibilityRole="button"/)
  assert.match(card, /accessibilityHint="Opens the details"/)
})

test("the card leads with the time and the time to be there", () => {
  const card = readFileSync("apps/mobile/src/components/calendar/event-sheet.tsx", "utf8")
  assert.match(card, /item\.meetTime/, "meet time is not shown where the club has set one")
  assert.match(card, /kickoffLabel\(item\.time\)/, "the time is not the canonical kick-off label")
})

test("the child's identity on a card comes from the projection and nowhere else", () => {
  const card = readFileSync("apps/mobile/src/components/calendar/event-sheet.tsx", "utf8")
  assert.match(card, /memberFor\(family, item\.playerId\)/)
  assert.match(card, /<ChildMark member=\{child\}/)
  // No local reconstruction of a name, an initial or an avatar.
  assert.ok(!/initials|avatar_/i.test(card.replace(/ChildMark|memberFor/g, "")), "a card rebuilds an identity itself")
})

test("the Training Centre is a participant experience, not a form", () => {
  const src = readFileSync(TRAINING_SCREEN, "utf8")
  assert.match(src, /<EventHero/)
  assert.match(src, /<ParticipantSheet>/)
  assert.match(src, /surfaceName="Training Centre"/)
  // The answer is the first thing on the sheet, because it is what a parent came for.
  const availability = src.indexOf("<AvailabilityChoice")
  const actions = src.indexOf("<ParticipantActionCard")
  assert.ok(availability > 0 && actions > availability, "the action cards come before the answer")
  assert.match(src, /ground="light"/, "the shared control is not drawn for the chalk sheet")
})

test("the Training Centre invents no arrival time, because training has none", () => {
  // The reference shows "Arrive from 17:45". `meet_time` is a FIXTURE column;
  // `training_sessions` has no such field, no RPC for one and no product concept
  // of one. A time no coach set is worse than no time.
  const src = code(TRAINING_SCREEN)
  assert.ok(!/Arrive from/.test(src), "an arrival time is shown for training")
  assert.ok(!/meetTime/.test(src), "training reaches for a meet time it does not have")
})

test("no stock photograph stands in for a club's own rugby", () => {
  const hero = readFileSync("apps/mobile/src/components/participant/event-hero.tsx", "utf8")
  for (const forbidden of ["unsplash", "ImageBackground", "require(", "https://images"]) {
    assert.ok(!hero.includes(forbidden), `the hero reaches for ${forbidden}`)
  }
})

test("the availability control is the shared one, on either ground", () => {
  const control = readFileSync("apps/mobile/src/components/availability-choice.tsx", "utf8")
  // One control, one vocabulary, one order -- only the ink changes.
  assert.match(control, /ANSWER_ON_LIGHT/)
  assert.match(control, /AVAILABILITY_ANSWER_ORDER/)
  assert.match(control, /ATTENDANCE_ANSWER_WORDS\[status\]/)
  // Selection is never colour alone: an icon, the words, and the accessible state.
  assert.match(control, /accessibilityState=\{\{ selected: chosen/)
  assert.match(control, /<Icon size=\{16\}/)
})

test("the participant action cards carry no administrative variant", () => {
  const cards = code("apps/mobile/src/components/participant/event-hero.tsx")
  for (const forbidden of ["Edit", "Manage", "Cancel", "Delete", "Attendees"]) {
    assert.ok(!cards.includes(forbidden), `a participant action card offers ${forbidden}`)
  }
})
