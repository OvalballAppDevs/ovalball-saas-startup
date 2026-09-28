/**
 * P3 — A PARTICIPANT NEVER ARRIVES AT ADMINISTRATION.
 *
 * The defect this suite exists for: `/fixtures/<id>` is the canonical address for
 * one physical fixture on BOTH clients -- it is what the website routes to, what
 * `notificationHref` emits for every fixture notification, what a shared link
 * carries and what expo-router restores after the app is killed -- and on this
 * client it had become the FIXTURE CONSOLE. So every canonical way into a fixture
 * put a parent in fixture administration. Fixing one list's `onPress` could never
 * have been enough, because the address itself was the defect.
 *
 * TWO LAYERS ARE ASSERTED HERE, and they are independent on purpose.
 *
 *   LAYER A, the projection: a participant is sent to an address that CANNOT draw
 *   administration, whichever entry point they came from.
 *
 *   LAYER B, the guard: the canonical address decides from the server's own
 *   per-fixture `can_manage_fixture`, and the console has no address of its own --
 *   so a typed URL, a restored stack or a link from outside cannot reach it.
 *
 * Layer B's server half is proved in SQL and in the RED run, not here. What is
 * proved here is the structure: that there is exactly one deciding route, that it
 * asks the server, and that no route file imports administration except that one.
 */

import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

import type { AgendaItem } from "@ovalball/contracts"

import {
  agendaIntent,
  narrowIntentForContext,
  routeForAgendaItem,
  routeForIntent,
} from "../../../apps/mobile/src/links/destinations"
import { resolveIntent } from "../../../apps/mobile/src/links/intents"

const APP = "apps/mobile/app/(tabs)"
const PARTICIPANT_ROUTE = "/fixtures/[fixtureId]/match-centre"
const CANONICAL_ROUTE = "/fixtures/[fixtureId]"
const TRAINING_ROUTE = "/calendar/training/[sessionId]"

const PARTICIPANTS = ["parent", "family", "player"] as const
const STAFF = ["team", "club", "site_admin", "governing"] as const

function fixture(overrides: Partial<AgendaItem> = {}): AgendaItem {
  return {
    key: "fx", kind: "fixture", eventId: "fx-1", date: "2026-10-03", time: "10:30", meetTime: null,
    us: { directoryId: null, clubName: "Ovalball UAT RUFC", teamName: "Under 12 Boys", compactName: "U12", rugbyCode: "union", crestUrl: null, kit: null },
    them: { directoryId: null, clubName: "Ashton Under Lyne RUFC", teamName: "Under 12 Boys", compactName: "U12", rugbyCode: "union", crestUrl: null, kit: null },
    homeAway: "Away", venue: null, pitch: null, status: "Booked", result: null,
    playerId: "p-1", childFirstName: "Pippa", attendance: null,
    teamId: "team-u12", clubId: "club-1", href: null,
    ...overrides,
  } as AgendaItem
}

const training = () =>
  fixture({ key: "ts", kind: "training", eventId: "ts-1", them: null, homeAway: null, status: null })

// ------------------------------------------------- LAYER A: every entry point

test("a parent's match goes to the participant address, from every in-app list", () => {
  // Home, Fixtures, the Calendar (grid, week list and week sheet), Needs Attention,
  // Next Up and This Week all call this one function -- asserted structurally below.
  for (const kind of PARTICIPANTS) {
    assert.deepEqual(routeForAgendaItem(fixture(), kind), {
      pathname: PARTICIPANT_ROUTE,
      params: { fixtureId: "fx-1" },
    })
  }
})

test("a parent's training goes to the Training Centre", () => {
  for (const kind of PARTICIPANTS) {
    assert.deepEqual(routeForAgendaItem(training(), kind), {
      pathname: TRAINING_ROUTE,
      params: { sessionId: "ts-1" },
    })
  }
})

test("a notification about a fixture is narrowed before it is routed", () => {
  // `notificationHref` emits `/fixtures/<id>` for fixture_attendance_invitation and
  // its reminder -- the two a parent actually receives. Unnarrowed that is the
  // deciding address; narrowed it is the address that cannot draw administration.
  const intent = resolveIntent("ovalball://fixtures/fx-1")
  assert.deepEqual(intent, { kind: "FIXTURE", fixtureId: "fx-1" })
  for (const kind of PARTICIPANTS) {
    assert.deepEqual(routeForIntent(narrowIntentForContext(intent, kind)), {
      pathname: PARTICIPANT_ROUTE,
      params: { fixtureId: "fx-1" },
    })
  }
})

test("a deep link to a fixture is narrowed the same way", () => {
  for (const url of [
    "ovalball://fixtures/fx-1",
    "exp://192.168.1.5:8081/--/fixtures/fx-1",
    "https://ovalball.co.uk/fixtures/fx-1",
  ]) {
    const narrowed = narrowIntentForContext(resolveIntent(url), "parent")
    assert.deepEqual(routeForIntent(narrowed), { pathname: PARTICIPANT_ROUTE, params: { fixtureId: "fx-1" } })
  }
})

test("an explicit participant link stays participant for everybody", () => {
  const intent = resolveIntent("ovalball://fixtures/fx-1/match-centre")
  assert.deepEqual(intent, { kind: "MATCH_CENTRE", fixtureId: "fx-1" })
  for (const kind of [...PARTICIPANTS, ...STAFF]) {
    assert.deepEqual(routeForIntent(narrowIntentForContext(intent, kind)), {
      pathname: PARTICIPANT_ROUTE,
      params: { fixtureId: "fx-1" },
    })
  }
})

test("narrowing only ever narrows, and touches nothing that is not a fixture", () => {
  for (const intent of [
    { kind: "TRAINING", sessionId: "ts-1" },
    { kind: "MESSAGES" },
    { kind: "MESSAGE_THREAD", conversationId: "c-1", conversationKind: "direct" },
    { kind: "CALENDAR", date: null },
    { kind: "MATCH_CENTRE", fixtureId: "fx-1" },
  ] as const) {
    for (const kind of [...PARTICIPANTS, ...STAFF, null]) {
      assert.deepEqual(narrowIntentForContext(intent, kind), intent)
    }
  }
})

test("a fixture intent with no resolved context is left to the deciding address", () => {
  // A link can arrive before the context has loaded. Holding it would risk dropping
  // it; routing it is safe because the canonical address asks the server itself.
  assert.deepEqual(narrowIntentForContext({ kind: "FIXTURE", fixtureId: "fx-1" }, null), {
    kind: "FIXTURE",
    fixtureId: "fx-1",
  })
})

// ------------------------------------------------------------ staff behaviour

test("staff are sent to the canonical address, which asks rather than assumes", () => {
  // NOT a grant. A team manager who has not been delegated `fixture.fixture.edit`
  // lands on the Match Centre exactly as a parent does, because the route asks
  // `get_match_centre_capabilities` for this viewer and this fixture.
  for (const kind of STAFF) {
    assert.deepEqual(routeForAgendaItem(fixture(), kind), {
      pathname: CANONICAL_ROUTE,
      params: { fixtureId: "fx-1" },
    })
  }
})

test("staff training goes to the same one Training Centre", () => {
  for (const kind of STAFF) {
    assert.deepEqual(routeForAgendaItem(training(), kind), {
      pathname: TRAINING_ROUTE,
      params: { sessionId: "ts-1" },
    })
  }
})

test("no participant event resolves to any bulk or administrative fixture surface", () => {
  const forbidden = ["/fixtures/new", "/fixtures/planner", "/fixtures/import", "/fixtures/competitions", "/admin"]
  for (const kind of PARTICIPANTS) {
    for (const item of [fixture(), training()]) {
      const route = routeForAgendaItem(item, kind)
      assert.ok(route, "a participant event resolved nowhere at all")
      for (const path of forbidden) {
        assert.ok(!route!.pathname.startsWith(path), `${kind} reached ${route!.pathname}`)
      }
    }
  }
})

test("the intent and the route are one table", () => {
  assert.deepEqual(routeForIntent(agendaIntent(fixture(), "parent")), {
    pathname: PARTICIPANT_ROUTE,
    params: { fixtureId: "fx-1" },
  })
  assert.deepEqual(routeForIntent(agendaIntent(fixture(), "team")), {
    pathname: CANONICAL_ROUTE,
    params: { fixtureId: "fx-1" },
  })
})

// ---------------------------------------------------- LAYER B: the structure

/** Every file under the tab router, so a new route cannot quietly escape these rules. */
function routeFiles(dir = APP, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) routeFiles(full, acc)
    else if (entry.endsWith(".tsx")) acc.push(full)
  }
  return acc
}

test("Fixture Detail has no route of its own outside the canonical gate; Edit Fixture is its own explicit address", () => {
  // OWNER DECISION (physical review correction pass): the former all-in-one console split into Fixture
  // Detail (read/overview) and Edit Fixture (the mutation form, its own destination). The same
  // protection applies to Fixture Detail as applied to the console it replaced: there is no URL for it
  // outside the one canonical gate. Edit Fixture, by contrast, IS meant to be its own pushable address
  // (reached from Fixture Detail's own "Edit Fixture" button), so it is exempted from this specific
  // check and asserted instead by the routing table / EDIT_FIXTURE intent tests.
  const detailImporters = routeFiles().filter((f) => /fixture-detail-screen/.test(readFileSync(f, "utf8")))
  assert.deepEqual(
    detailImporters,
    [`${APP}/fixtures/[fixtureId]/index.tsx`],
    "a route other than the canonical fixture address can draw Fixture Detail"
  )
  const editImporters = routeFiles().filter((f) => /edit-fixture-screen/.test(readFileSync(f, "utf8")))
  assert.deepEqual(editImporters, [`${APP}/fixtures/[fixtureId]/edit.tsx`], "Edit Fixture has exactly its own route")
})

test("the canonical fixture address decides from the server, not from a role", () => {
  const gate = readFileSync(`${APP}/fixtures/[fixtureId]/index.tsx`, "utf8")
  assert.match(gate, /loadFixtureSurface/, "the canonical address no longer resolves a surface")
  const surface = readFileSync("apps/mobile/src/fixtures/surface.ts", "utf8")
  assert.match(surface, /get_match_centre_capabilities/, "the surface is decided without asking the server")
  assert.match(surface, /can_manage_fixture/, "the decision is not the canonical per-fixture capability")
  // AND IT FAILS TOWARDS THE PARTICIPANT: an error, an absent row and a false all
  // give the surface with fewer powers.
  assert.match(surface, /if \(error \|\| !data\) return "participant"/)
  for (const wrong of [/active\.kind/, /isFamilyFacingContext/, /role/i]) {
    assert.ok(!wrong.test(surface), `the surface decision consults ${wrong} instead of the capability`)
  }
})

test("the participant route cannot draw administration, because it does not import it", () => {
  const route = readFileSync(`${APP}/fixtures/[fixtureId]/match-centre.tsx`, "utf8")
  assert.match(route, /from "\.\.\/\.\.\/\.\.\/\.\.\/src\/fixtures\/match-centre"/)
  assert.ok(!/fixture-console/.test(route), "the participant route imports the console")
  assert.ok(!/mutations/.test(route), "the participant route imports fixture mutations")
})

test("no screen builds a fixture or training path by hand any more", () => {
  // Five did before P3, and they disagreed. A hand-built path is a routing rule
  // that lives outside the one table and stops matching the day a route moves.
  const offenders: string[] = []
  for (const file of [...routeFiles(), ...sourceFiles("apps/mobile/src")]) {
    if (file.endsWith("links/destinations.ts")) continue
    const body = readFileSync(file, "utf8")
    // Only real code, not prose in a comment.
    for (const line of body.split("\n")) {
      if (/^\s*[*/]/.test(line)) continue
      if (/router\.(push|replace)\(\s*[`"']\/(fixtures|calendar\/training)\//.test(line)) offenders.push(`${file}: ${line.trim()}`)
      if (/pathname:\s*"\/fixtures\/\[fixtureId\]/.test(line)) offenders.push(`${file}: ${line.trim()}`)
      if (/pathname:\s*"\/calendar\/training\//.test(line)) offenders.push(`${file}: ${line.trim()}`)
    }
  }
  assert.deepEqual(offenders, [], "a fixture or training destination is decided outside the one table")
})

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, acc)
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) acc.push(full)
  }
  return acc
}

// ------------------------------------------- the Training Centre's own boundary

test("every editable field in the Training Centre is gated on the server's own answer", () => {
  const screen = readFileSync(`${APP}/calendar/training/[sessionId].tsx`, "utf8")
  // `canManage` comes from `get_training_session_card`, which runs
  // `internal.can_manage_training`. Not a role name, not the context kind.
  assert.match(screen, /canEdit = Boolean\(session\?\.canManage\)/)
  /*
    CANCELLING IS THE ONE THAT CANNOT BE UNDONE, so it is gated twice and, since P4,
    not even mounted without the first gate. The whole administrative half lives in
    `TrainingOperations`, which is rendered inside `{session.canManage && (...)}`,
    and the cancel control inside that on `!cancelled`.
  */
  assert.match(screen, /\{session\.canManage && \(/, "the administrative half is not gated on the server's answer")
  const gate = screen.indexOf("{session.canManage && (")
  assert.ok(screen.indexOf("<CancelSessionButton") > gate, "the cancel control is mounted outside the gate")
  assert.ok(screen.indexOf("<TrainingOperations") > gate, "the edit sheets are mounted outside the gate")
  assert.match(screen, /!cancelled && <CancelSessionButton/, "a cancelled session can still be cancelled")
  // And a row that is not editable draws no press target and no chevron at all,
  // rather than a control that fails after being tapped.
  assert.match(screen, /if \(!editable \|\| !onPress\) return content/)
})

test("the Training Centre has one implementation, with no participant copy", () => {
  const training = routeFiles().filter((f) => /calendar\/training/.test(f))
  assert.equal(training.length, 1, `training has ${training.length} routes: ${training.join(", ")}`)
  assert.ok(!/participant|parent|staff/i.test(training[0]), "a role-named training route exists")
})

// -------------------------------------------------- the Calendar is read-only

test("the Calendar creates, edits and deletes nothing", () => {
  const calendar = readFileSync(`${APP}/calendar/index.tsx`, "utf8")
  for (const forbidden of [
    /cancelFixture/, /updateKickoff/, /updateVenue/, /updatePitch/, /updateDetails/, /updateMeetTime/,
    /cancelTrainingSession/, /overrideTrainingSession/, /createFixture/,
  ]) {
    assert.ok(!forbidden.test(calendar), `the Calendar imports ${forbidden}`)
  }
  // And it routes every event through the one table rather than its own rule.
  assert.match(calendar, /routeForAgendaItem/)
  const handlers = calendar.match(/onPress=\{\(\) => openEvent\(item\)\}/g) ?? []
  assert.ok(handlers.length >= 1, "the Calendar's rows no longer route through openEvent")
})

test("the Calendar's every way into an event is the same one function", () => {
  const calendar = readFileSync(`${APP}/calendar/index.tsx`, "utf8")
  /*
    EVERY WAY IN GOES THROUGH `openEvent`, whichever view it is: the day sheet's
    cards, the season list and the week sheet. What matters is not how many there
    are -- P4 added the month grid and its sheet -- but that no OTHER routing rule
    survives beside them. Before P3 there were copies, and they disagreed.
  */
  assert.ok((calendar.match(/openEvent\(item\)/g) ?? []).length >= 2, "the calendar's rows no longer route through openEvent")
  assert.equal(
    (calendar.match(/routeForAgendaItem\(/g) ?? []).length,
    1,
    "the calendar resolves a destination in more than one place"
  )
  assert.ok(!/router\.push\(\s*[`"']\/(fixtures|calendar\/training)/.test(calendar), "a second routing rule survives in the Calendar")
  assert.ok(!/item\.kind === "fixture"\s*\n?\s*\?\s*router\./.test(calendar), "a second routing rule survives in the Calendar")
})

// ----------------------------------------- the family filter names the child

test("a family scope is offered no team or age-grade selector", () => {
  const sheet = readFileSync("apps/mobile/src/components/agenda-filter.tsx", "utf8")
  assert.match(sheet, /\{!familyScope && teams\.length > 1 && \(/, "the team chips are not withheld from a family")
  // Both screens derive it from the context and pass it in; the Calendar reads the
  // same value it uses to decide whether to offer a season at all.
  assert.match(readFileSync(`${APP}/fixtures/index.tsx`, "utf8"), /familyScope=\{active !== null && isFamilyFacingContext\(active\.kind\)\}/)
  const calendar = readFileSync(`${APP}/calendar/index.tsx`, "utf8")
  assert.match(calendar, /const family = active !== null && isFamilyFacingContext\(active\.kind\)/)
  assert.match(calendar, /familyScope=\{family\}/)
})

// ------------------------------------------------------------- the way back

test("a participant screen's Back goes to its own surface, never to whichever navigator can pop", () => {
  // Measured on the web build before the fix: Home → Training Centre → Back gave
  // "/" (the TABS navigator answered GO_BACK) and the Calendar tab then opened on
  // the parked Training Centre with no way out -- the owner's report exactly.
  // `initialRouteName` on the nested stack did not mount the agenda beneath a
  // cross-tab push, so Back asks the STACK whether anything is beneath, and
  // otherwise dismisses to the surface's index, which replaces the parked screen.
  const back = readFileSync("apps/mobile/src/links/back.ts", "utf8")
  assert.match(back, /const state = navigation\.getState\(\)\s*\n\s*if \(state && state\.index > 0\) \{\s*\n\s*router\.back\(\)/)
  assert.match(back, /router\.dismissTo\(surface\)/)
  assert.ok(!/router\.canGoBack\(\)/.test(back), "canGoBack() is the router's answer, and the router lets the tabs pop")
  for (const [file, surface] of [
    ["apps/mobile/app/(tabs)/calendar/training/[sessionId].tsx", "/calendar"],
    ["apps/mobile/src/fixtures/match-centre.tsx", "/fixtures"],
    ["apps/mobile/src/fixtures/fixture-detail-screen.tsx", "/fixtures"],
  ] as const) {
    const source = readFileSync(file, "utf8")
    assert.ok(!/=> router\.back\(\)/.test(source), `${file} still calls back() with nowhere to go`)
    assert.ok(source.includes(`useBackToSurface("${surface}")`), `${file} does not go back to ${surface}`)
  }
  // The nested stacks still name their initial route -- harmless, and right for a true deep link.
  for (const layout of ["apps/mobile/app/(tabs)/calendar/_layout.tsx", "apps/mobile/app/(tabs)/fixtures/_layout.tsx"]) {
    assert.match(readFileSync(layout, "utf8"), /initialRouteName: "index"/)
  }
})
