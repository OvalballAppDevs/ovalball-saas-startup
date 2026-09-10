import { test } from "node:test"
import assert from "node:assert/strict"

import {
  applyAgendaFilters,
  defaultFilterState,
  filterQuery,
  groupByMonth,
  hasActiveFilters,
  needsResponse,
  oppositionOptions,
  parseFilterState,
} from "@/lib/agenda/filters"
import { filterAffordances, resolveAgendaScope } from "@/lib/agenda/scope"
import {
  nextAnchor,
  parseAnchor,
  previousAnchor,
  resolveWindow,
  shiftMonths,
  startOfWeek,
  UPCOMING_HORIZON_DAYS,
} from "@/lib/agenda/window"
import type { AgendaItem } from "@/lib/agenda/load"
import type { SessionContext } from "@/lib/app-context/session-context"
import type { SwitchableContext } from "@/lib/app-context/active-context"

/**
 * FIXTURES / AGENDA -- the rules that decide whose rugby a person sees.
 *
 * These are pure-function tests on purpose. The authority in this feature is
 * not "a check rejected the request" -- it is that the scope resolver takes no
 * search parameters and the filter is array-in/array-out, so a widening
 * request has nowhere to be expressed. That property is provable here, without
 * a database, and it is the property most worth pinning: an RLS test proves
 * the last line of defence held, and this proves the request never got made.
 */

const TODAY = "2026-09-08" // a Tuesday

function ctx(over: Partial<SessionContext> = {}): SessionContext {
  return {
    user: { id: "u1" } as SessionContext["user"],
    firstName: "Test",
    isSiteAdmin: false,
    siteAdminRole: null,
    diagnosticClubAccess: false,
    manageTeamCatalogue: false,
    manageCompetitions: false,
    manageFixtureSupport: false,
    manageGlobalLookups: false,
    manageSystem: false,
    viewCommercial: false,
    clubMemberships: [],
    teamPermissions: [],
    guardianRelationships: [],
    linkedPlayerTeams: [],
    hasGuardianRelationship: false,
    ...over,
  } as SessionContext
}

function context(over: Partial<SwitchableContext>): SwitchableContext {
  return {
    key: "k",
    kind: "club",
    id: null,
    playerId: null,
    label: "L",
    switcherLabel: "L",
    roleLabel: "R",
    logoUrl: null,
    clubId: null,
    ...over,
  } as SwitchableContext
}

const guardian = (playerId: string, teamId: string, first: string) => ({
  playerId,
  teamId,
  clubId: "club-a",
  clubName: "Club A",
  teamDisplayName: "U12 Boys",
  playerFirstName: first,
  playerSurname: "Test",
  avatarStoragePath: null,
})

// =====================================================================
// A. THE SCOPE RESOLVER TAKES NO REQUEST INPUT
// =====================================================================

test("resolveAgendaScope's signature admits no search parameters at all", () => {
  // Two arguments: the proved session, and which context is active. There is
  // no third place a URL could enter. This is the structural guarantee the
  // whole feature rests on, so it is asserted rather than assumed.
  assert.equal(resolveAgendaScope.length, 2)
})

test("a guardian with two children gets both, and only their own", () => {
  const c = ctx({
    guardianRelationships: [guardian("p1", "t1", "Harry"), guardian("p2", "t2", "Emily")] as SessionContext["guardianRelationships"],
  })
  const scope = resolveAgendaScope(c, context({ kind: "family", key: "family" }))
  assert.equal(scope.kind, "family")
  assert.deepEqual(
    scope.kind === "family" ? scope.children.map((x) => x.playerId).sort() : [],
    ["p1", "p2"]
  )
})

test("selecting one child never pulls in a sibling", () => {
  const c = ctx({
    guardianRelationships: [guardian("p1", "t1", "Harry"), guardian("p2", "t2", "Emily")] as SessionContext["guardianRelationships"],
  })
  const scope = resolveAgendaScope(c, context({ kind: "parent", id: "t1", playerId: "p1" }))
  assert.equal(scope.kind, "family")
  assert.deepEqual(scope.kind === "family" ? scope.children.map((x) => x.playerId) : [], ["p1"])
})

test("a guardian cannot reach a child they do not guardian, however the context is crafted", () => {
  const c = ctx({ guardianRelationships: [guardian("p1", "t1", "Harry")] as SessionContext["guardianRelationships"] })
  // A hand-made context naming somebody else's player and team.
  const scope = resolveAgendaScope(c, context({ kind: "parent", id: "t-someone-else", playerId: "p-someone-else" }))
  assert.equal(scope.kind, "none", "an unproved relationship resolves to no agenda, not to that child's")
})

test("team staff get their own team, and view_only is NOT a staff assignment", () => {
  const staff = ctx({
    teamPermissions: [{ teamId: "t1", teamDisplayName: "U12", clubId: "club-a", clubName: "Club A", permission: "coach" }] as SessionContext["teamPermissions"],
  })
  const scope = resolveAgendaScope(staff, context({ kind: "team", id: "t1", clubId: "club-a" }))
  assert.deepEqual(scope.kind === "teams" ? scope.teamIds : null, ["t1"])

  const parentish = ctx({
    teamPermissions: [{ teamId: "t1", teamDisplayName: "U12", clubId: "club-a", clubName: "Club A", permission: "view_only" }] as SessionContext["teamPermissions"],
  })
  assert.equal(
    resolveAgendaScope(parentish, context({ kind: "team", id: "t1", clubId: "club-a" })).kind,
    "none",
    "view_only is the legacy parent permission and confers no staff view of a squad"
  )
})

test("team staff cannot widen to another team by switching context to it", () => {
  const staff = ctx({
    teamPermissions: [{ teamId: "t1", teamDisplayName: "U12", clubId: "club-a", clubName: "Club A", permission: "coach" }] as SessionContext["teamPermissions"],
  })
  const scope = resolveAgendaScope(staff, context({ kind: "team", id: "t-other", clubId: "club-a" }))
  assert.equal(scope.kind, "none")
})

test("a club admin gets their club, and cannot reach a club they do not administer", () => {
  const admin = ctx({
    clubMemberships: [{ clubId: "club-a", clubName: "Club A", clubSlug: "a", clubLogoUrl: null, role: "CLUB_ADMIN" }] as SessionContext["clubMemberships"],
  })
  const mine = resolveAgendaScope(admin, context({ kind: "club", id: "club-a" }))
  assert.equal(mine.kind === "club" ? mine.clubId : null, "club-a")

  const theirs = resolveAgendaScope(admin, context({ kind: "club", id: "club-b" }))
  assert.equal(theirs.kind, "none", "club-wide authority is per club, never session-wide")
})

test("an ordinary club member gets only the teams they are assigned to at that club", () => {
  const member = ctx({
    clubMemberships: [{ clubId: "club-a", clubName: "Club A", clubSlug: "a", clubLogoUrl: null, role: "CLUB_MEMBER" }] as SessionContext["clubMemberships"],
    teamPermissions: [{ teamId: "t1", teamDisplayName: "U12", clubId: "club-a", clubName: "Club A", permission: "coach" }] as SessionContext["teamPermissions"],
  })
  const scope = resolveAgendaScope(member, context({ kind: "club", id: "club-a" }))
  assert.equal(scope.kind, "teams", "membership alone is not club-wide fixture authority")
  assert.deepEqual(scope.kind === "teams" ? scope.teamIds : null, ["t1"])
})

test("platform scope requires a real Site Admin, not a site_admin-shaped context", () => {
  assert.equal(resolveAgendaScope(ctx({ isSiteAdmin: true }), context({ kind: "site_admin" })).kind, "platform")
  assert.equal(
    resolveAgendaScope(ctx({ isSiteAdmin: false }), context({ kind: "site_admin" })).kind,
    "none",
    "a forged site_admin context on a non-admin session grants nothing"
  )
})

// =====================================================================
// B. FILTERS NARROW, STRUCTURALLY
// =====================================================================

function item(over: Partial<AgendaItem>): AgendaItem {
  return {
    key: "k",
    kind: "fixture",
    eventId: "f1",
    date: "2026-09-12",
    time: "14:30",
    meetTime: null,
    us: { directoryId: "d-us", clubName: "Us", teamName: "U12 Boys", crestUrl: null, kit: null },
    them: { directoryId: "d-them", clubName: "Rossendale", teamName: null, crestUrl: null, kit: null },
    homeAway: "Home",
    venue: null,
    pitch: null,
    status: null,
    result: null,
    playerId: null,
    childFirstName: null,
    childAvatarUrl: null,
    attendance: null,
    teamId: "t1",
    clubId: "club-a",
    href: "/fixtures/f1",
    ...over,
  }
}

test("applyAgendaFilters can only ever return a SUBSET of what it was given", () => {
  const authorised = [item({ key: "a" }), item({ key: "b", homeAway: "Away" }), item({ key: "c", kind: "training", them: null, homeAway: null })]
  const keys = new Set(authorised.map((i) => i.key))

  // Every representable filter combination, checked for the same property.
  for (const homeAway of ["all", "Home", "Away"] as const) {
    for (const includeTraining of [true, false]) {
      for (const opposition of [null, "d-them", "d-nonexistent"]) {
        for (const teamId of [null, "t1", "t-elsewhere"]) {
          const out = applyAgendaFilters(authorised, {
            ...defaultFilterState(TODAY),
            homeAway,
            includeTraining,
            opposition,
            teamId,
          })
          assert.ok(out.length <= authorised.length)
          for (const row of out) assert.ok(keys.has(row.key), "a filter produced a row that was not in the authorised set")
        }
      }
    }
  }
})

test("a filter naming another club's team returns nothing rather than that team's rugby", () => {
  const authorised = [item({ key: "a", teamId: "t1" })]
  const out = applyAgendaFilters(authorised, { ...defaultFilterState(TODAY), teamId: "t-another-club" })
  assert.equal(out.length, 0)
})

test("opposition is matched on the canonical directory id, never on a name", () => {
  const rows = [item({ key: "a" }), item({ key: "b", them: { directoryId: "d-other", clubName: "Rossendale", teamName: null, crestUrl: null, kit: null } })]
  // Two clubs sharing a display name are still two clubs.
  const out = applyAgendaFilters(rows, { ...defaultFilterState(TODAY), opposition: "d-them" })
  assert.deepEqual(out.map((r) => r.key), ["a"])
})

test("opposition options only ever offer values present in the authorised rows", () => {
  const rows = [item({ key: "a" }), item({ key: "b", kind: "training", them: null })]
  assert.deepEqual(oppositionOptions(rows), [{ id: "d-them", name: "Rossendale" }])
})

test("training has no home/away and no opposition, so those filters exclude it rather than guessing", () => {
  const rows = [item({ key: "t", kind: "training", them: null, homeAway: null })]
  assert.equal(applyAgendaFilters(rows, { ...defaultFilterState(TODAY), homeAway: "Home" }).length, 0)
  assert.equal(applyAgendaFilters(rows, { ...defaultFilterState(TODAY), opposition: "d-them" }).length, 0)
})

// =====================================================================
// C. THE DATE MODEL
// =====================================================================

test("the default view is today onwards, never the start of the season", () => {
  const w = resolveWindow("upcoming", TODAY, TODAY, "upcoming")
  assert.equal(w.startIso, TODAY, "an agenda that opens on finished matches is the thing this default exists to prevent")
  assert.equal(w.order, "asc")
})

test("the default window is bounded, so no scope ever asks for everything", () => {
  const w = resolveWindow("upcoming", TODAY, TODAY, "upcoming")
  const days = (Date.parse(w.endIso) - Date.parse(w.startIso)) / 86_400_000
  assert.equal(days, UPCOMING_HORIZON_DAYS)
})

test("looking back ends yesterday and reads newest first", () => {
  const w = resolveWindow("upcoming", TODAY, TODAY, "past")
  assert.equal(w.endIso, "2026-09-07", "today's rugby belongs to the forward view -- it has not happened yet")
  assert.equal(w.order, "desc")
})

test("a rugby week starts on Monday, so a Saturday match and the week's training stay together", () => {
  assert.equal(startOfWeek("2026-09-12"), "2026-09-07", "Saturday belongs to the week that prepared for it")
  assert.equal(startOfWeek("2026-09-13"), "2026-09-07", "a Sunday morning match belongs to that same week, not the next")
  assert.equal(startOfWeek("2026-09-07"), "2026-09-07")
})

test("month and year windows are exact", () => {
  const m = resolveWindow("month", "2026-09-20", TODAY)
  assert.equal(m.startIso, "2026-09-01")
  assert.equal(m.endIso, "2026-09-30")
  assert.equal(m.label, "September 2026")

  const y = resolveWindow("year", "2026-05-05", TODAY)
  assert.equal(y.startIso, "2026-01-01")
  assert.equal(y.endIso, "2026-12-31")
})

test("stepping months clamps rather than skipping", () => {
  // 31 March back one month is February, not March again.
  assert.equal(shiftMonths("2026-03-31", -1), "2026-02-28")
  assert.equal(shiftMonths("2028-03-31", -1), "2028-02-29", "and it knows about leap years")
})

test("previous and next are exact inverses", () => {
  for (const mode of ["week", "month", "year"] as const) {
    assert.equal(previousAnchor(mode, nextAnchor(mode, "2026-09-15")), "2026-09-15")
  }
})

test("a hostile anchor moves the window and nothing else", () => {
  // Every one of these falls back to today rather than producing an Invalid
  // Date, an unbounded range, or a crash.
  for (const bad of ["", "not-a-date", "2026-13-01", "2026-02-30", "0001-01-01", "9999-12-31", "2026-09-08'; drop table fixtures;--"]) {
    assert.equal(parseAnchor(bad, TODAY), TODAY, `anchor ${JSON.stringify(bad)} should fall back to today`)
  }
  assert.equal(parseAnchor("2026-11-04", TODAY), "2026-11-04", "a legitimate anchor is honoured")
})

// =====================================================================
// D. URL STATE
// =====================================================================

test("query parameters cannot introduce a scope -- they only ever describe filters", () => {
  const hostile = {
    club: "club-i-do-not-belong-to",
    team: "t-not-mine",
    child: "p-not-mine",
    scope: "platform",
    isSiteAdmin: "true",
    role: "CLUB_ADMIN",
  }
  const state = parseFilterState(hostile, TODAY, parseAnchor)
  // The forged authority-shaped keys are simply not part of the state.
  assert.equal("scope" in state, false)
  assert.equal("isSiteAdmin" in state, false)
  assert.equal("role" in state, false)
  // The id-shaped ones survive as FILTERS, which can only narrow -- proven
  // above by the subset property.
  assert.equal(state.clubId, "club-i-do-not-belong-to")
  assert.deepEqual(applyAgendaFilters([item({ clubId: "club-a" })], state), [])
})

test("a default agenda URL carries no query string at all", () => {
  assert.equal(filterQuery(defaultFilterState(TODAY), TODAY), "/agenda")
})

test("filter state round-trips through the URL", () => {
  const state = { ...defaultFilterState(TODAY), mode: "month" as const, anchor: "2026-11-01", opposition: "d-1", homeAway: "Away" as const, includeTraining: false }
  const url = filterQuery(state, TODAY)
  const sp = Object.fromEntries(new URLSearchParams(url.split("?")[1]))
  const back = parseFilterState(sp, TODAY, parseAnchor)
  assert.equal(back.mode, "month")
  assert.equal(back.anchor, "2026-11-01")
  assert.equal(back.opposition, "d-1")
  assert.equal(back.homeAway, "Away")
  assert.equal(back.includeTraining, false)
})

// =====================================================================
// E. PRESENTATION
// =====================================================================

test("month grouping preserves the loader's order, so a backwards look stays newest-first", () => {
  const rows = [item({ key: "a", date: "2026-09-20" }), item({ key: "b", date: "2026-09-05" }), item({ key: "c", date: "2026-08-30" })]
  const groups = groupByMonth(rows)
  assert.deepEqual(groups.map((g) => g.key), ["2026-09", "2026-08"])
  assert.deepEqual(groups[0].items.map((i) => i.key), ["a", "b"], "re-sorting here would silently undo a descending window")
})

test("a filter is only offered where the viewer has more than one of the thing", () => {
  const oneChild = filterAffordances({ kind: "family", children: [] }, 1)
  assert.equal(oneChild.child, false, "a child filter for one child is noise")
  assert.equal(filterAffordances({ kind: "family", children: [] }, 2).child, true)

  assert.equal(filterAffordances({ kind: "platform" }, 0).club, true, "a club filter is essential at platform scope")
  assert.equal(filterAffordances({ kind: "family", children: [] }, 1).club, false)

  assert.equal(filterAffordances({ kind: "club", clubId: "c", clubName: "C" }, 0).team, true)
  assert.equal(
    filterAffordances({ kind: "teams", teamIds: ["t1"], clubId: "c" }, 0).team,
    false,
    "one team needs no team filter"
  )

  assert.equal(filterAffordances({ kind: "family", children: [] }, 1).attendance, true)
  assert.equal(
    filterAffordances({ kind: "club", clubId: "c", clubName: "C" }, 0).attendance,
    false,
    "a coach is not being asked whether they can attend"
  )
})

// =====================================================================
// F. JUMP TO A DATE, AND THE CALENDAR VIEW
// =====================================================================

test("picking a date resolves to that single day, not the week around it", () => {
  const w = resolveWindow("day", "2026-09-12", TODAY)
  assert.equal(w.startIso, "2026-09-12")
  assert.equal(w.endIso, "2026-09-12", "a day window is one day -- somebody who asked for the 12th wants the 12th")
  assert.equal(w.label, "Saturday 12 September")
})

test("stepping from a chosen day moves one day at a time", () => {
  assert.equal(nextAnchor("day", "2026-09-12"), "2026-09-13")
  assert.equal(previousAnchor("day", "2026-09-12"), "2026-09-11")
  assert.equal(previousAnchor("day", nextAnchor("day", "2026-09-30")), "2026-09-30", "and across a month boundary")
})

test("a hostile date jump is still only a date", () => {
  // The picker writes ?mode=day&on=<value>; the value goes through the same
  // parseAnchor as every other anchor, so nothing new is reachable.
  const state = parseFilterState({ mode: "day", on: "not-a-date" }, TODAY, parseAnchor)
  assert.equal(state.mode, "day")
  assert.equal(state.anchor, TODAY)
})

test("Week / Month / Year narrow the range -- they never switch the page into a second calendar", () => {
  // The product decision: Ovalball has ONE calendar, /calendar. Fixtures /
  // Agenda stays chronological, and its range controls are navigation over
  // that list. A `view` concept reappearing here would be a second month grid
  // over the same fixtures, drifting apart from the first.
  const state = parseFilterState({ mode: "month", view: "calendar" }, TODAY, parseAnchor)
  assert.equal("view" in state, false, "the agenda has no view mode; a reintroduced one belongs in /calendar")
  assert.equal(state.mode, "month", "the range control still works")

  const url = filterQuery({ ...defaultFilterState(TODAY), mode: "month", anchor: "2026-11-01" }, TODAY)
  assert.equal(url.includes("view="), false, "and nothing about a view reaches the URL")
})

// =====================================================================
// G. THE ATTENDANCE FILTER, AND THE WAY BACK OUT OF IT
// =====================================================================

test("needs-a-response is unanswered, not past, and inside the horizon", () => {
  const soon = "2026-09-12" // 4 days out
  assert.equal(needsResponse(item({ date: soon, attendance: null }), TODAY), true)
  assert.equal(needsResponse(item({ date: soon, attendance: "ATTENDING" }), TODAY), false, "an answer is an answer")
  assert.equal(needsResponse(item({ date: soon, attendance: "UNSURE" }), TODAY), false, "unsure is a decision, not a gap")
  assert.equal(needsResponse(item({ date: "2026-09-01", attendance: null }), TODAY), false, "nobody owes an answer on last Tuesday")
  assert.equal(needsResponse(item({ date: "2026-09-22", attendance: null }), TODAY), true, "the 14th day is inside")
  assert.equal(needsResponse(item({ date: "2026-09-23", attendance: null }), TODAY), false, "the 15th is not")
})

test("the filter narrows -- it never reaches past what it was handed", () => {
  const authorised = [
    item({ key: "owed", date: "2026-09-12", attendance: null }),
    item({ key: "answered", date: "2026-09-12", attendance: "ATTENDING" }),
    item({ key: "far", date: "2026-10-30", attendance: null }),
  ]
  const on = { ...defaultFilterState(TODAY), needsResponse: true }
  const out = applyAgendaFilters(authorised, on, TODAY)
  assert.deepEqual(out.map((i) => i.key), ["owed"])
  assert.equal(out.every((i) => authorised.includes(i)), true, "every row came from the authorised array")
})

test("the count the callout shows and the list it opens are the same number", () => {
  // They diverged once, because the count used one horizon and the filter
  // another. A parent acting on "2 responses needed" must not land on three.
  const authorised = [
    item({ key: "a", date: "2026-09-10", attendance: null }),
    item({ key: "b", date: "2026-09-20", attendance: null }),
    item({ key: "c", date: "2026-09-20", attendance: "CANNOT_ATTEND" }),
    item({ key: "d", date: "2026-11-01", attendance: null }),
  ]
  const counted = authorised.filter((i) => needsResponse(i, TODAY)).length
  const listed = applyAgendaFilters(authorised, { ...defaultFilterState(TODAY), needsResponse: true }, TODAY).length
  assert.equal(counted, 2)
  assert.equal(listed, counted)
})

test("clearing attendance keeps every other choice the person made", () => {
  // The reported defect: tapping the callout filtered the agenda with no
  // obvious way back, and the only escape reset more than it should have.
  const viewing = {
    ...defaultFilterState(TODAY),
    mode: "month" as const,
    anchor: "2026-09-01",
    playerId: "ava",
    includeTraining: true,
  }
  const filtered = { ...viewing, needsResponse: true }
  assert.equal(filterQuery(filtered, TODAY).includes("needs=1"), true)

  const cleared = { ...filtered, needsResponse: false }
  assert.deepEqual(cleared, viewing, "September / Ava / training-on comes back exactly as it was")
  const url = filterQuery(cleared, TODAY)
  assert.equal(url.includes("needs="), false)
  assert.equal(url.includes("mode=month"), true, "the month survives")
  assert.equal(url.includes("child=ava"), true, "the child survives")
})

test("the attendance filter counts as a filter, and survives a round trip", () => {
  const on = { ...defaultFilterState(TODAY), needsResponse: true }
  assert.equal(hasActiveFilters(on), true, "otherwise the page says nothing is filtering it while something is")
  assert.equal(hasActiveFilters(defaultFilterState(TODAY)), false)

  // Back/Forward safety: the URL is the whole state, so returning to a
  // filtered entry reproduces it and returning to an unfiltered one does not.
  const parsed = parseFilterState({ needs: "1" }, TODAY, parseAnchor)
  assert.equal(parsed.needsResponse, true)
  assert.equal(parseFilterState({}, TODAY, parseAnchor).needsResponse, false)
  assert.equal(parseFilterState({ needs: "yes" }, TODAY, parseAnchor).needsResponse, false, "only the value we write turns it on")
})

test("a coach has no attendance to owe, so the filter can only ever empty their agenda", () => {
  // Structural, not a permission check: the loader leaves `attendance` null
  // outside a personal scope, and the page only computes the set when
  // isPersonalScope is true. Were it ever applied to a coach's rows it could
  // still only remove them.
  assert.equal(filterAffordances({ kind: "club", clubId: "c", clubName: "C" }, 0).attendance, false)
  const squad = [item({ key: "x", attendance: null, date: "2026-09-12" })]
  const out = applyAgendaFilters(squad, { ...defaultFilterState(TODAY), needsResponse: true }, TODAY)
  assert.equal(out.length <= squad.length, true, "narrowing only, in every scope")
})
