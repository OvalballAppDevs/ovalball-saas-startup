/**
 * P3 -- A PARTICIPANT NEVER ARRIVES AT ADMINISTRATION. Rewritten for the Match Centre consolidation
 * (owner brief, 2026-10-03).
 *
 * The original defect: `/fixtures/<id>` is the canonical address for one physical fixture on BOTH
 * clients -- what the website routes to, what every fixture notification carries, what a shared link
 * holds and what expo-router restores -- and it had become a FIXTURE CONSOLE, so every way into a
 * fixture put a parent in fixture administration. P3 fixed it with two addresses: a participant one
 * that could not draw administration, and a canonical one that asked the server and chose between the
 * Match Centre and the console.
 *
 * THE CONSOLIDATION REMOVES THE SECOND SURFACE INSTEAD. There is one Match Centre for every viewer at
 * the canonical address; Fixture Detail and Edit Fixture are sections and sheets inside it; each
 * control is drawn from the server's per-fixture answer for this viewer, and every write is re-checked
 * by the database. So the protection this suite pins is now:
 *
 *   LAYER A, the projection: every entry point -- a list, a notification, a deep link, an older
 *   address -- reaches the one Match Centre, at the section it names, and nothing administrative.
 *
 *   LAYER B, the structure: the canonical address draws only the Match Centre; the console, Fixture
 *   Detail and Edit Fixture no longer exist; every older address is a redirect through the one route
 *   table; and the Match Centre's management controls are gated on the server's answer.
 *
 * Layer B's server half -- that a parent cannot move a kick-off whatever the client draws -- is proved
 * in SQL (match_centre_consolidation.sql and the fixture suites), not here.
 */

import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

import type { AgendaItem } from "@ovalball/contracts"

import { agendaIntent, routeForAgendaItem, routeForHref, routeForIntent } from "../../../apps/mobile/src/links/destinations"
import { resolveIntent } from "../../../apps/mobile/src/links/intents"

const APP = "apps/mobile/app/(tabs)"
const MATCH_CENTRE = "/fixtures/[fixtureId]"
const TRAINING_ROUTE = "/calendar/training/[sessionId]"
const MC_DIR = "apps/mobile/src/fixtures/match-centre"

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

test("everybody's match goes to the one Match Centre, from every in-app list", () => {
  // Home, Fixtures, the Calendar (grid, week list and week sheet), Needs Attention, Next Up and This
  // Week all call this one function -- asserted structurally below.
  for (const kind of [...PARTICIPANTS, ...STAFF]) {
    assert.deepEqual(routeForAgendaItem(fixture(), kind), { pathname: MATCH_CENTRE, params: { fixtureId: "fx-1" } })
  }
})

test("everybody's training goes to the Training Centre", () => {
  for (const kind of [...PARTICIPANTS, ...STAFF]) {
    assert.deepEqual(routeForAgendaItem(training(), kind), { pathname: TRAINING_ROUTE, params: { sessionId: "ts-1" } })
  }
})

test("a notification lands on the exact section it is about", () => {
  const cases: Array<[string, Record<string, string>]> = [
    ["/fixtures/fx-1", { fixtureId: "fx-1" }],
    ["/fixtures/fx-1?tab=attendance", { fixtureId: "fx-1", tab: "attendance" }],
    ["/fixtures/fx-1?tab=arena", { fixtureId: "fx-1", tab: "arena" }],
    ["/fixtures/fx-1?tab=changing-room", { fixtureId: "fx-1", tab: "changing-room" }],
    ["/fixtures/fx-1?tab=rewards", { fixtureId: "fx-1", tab: "rewards" }],
    ["/fixtures/fx-1?tab=overview", { fixtureId: "fx-1" }],
    // An unrecognised section is Overview, never a dead end.
    ["/fixtures/fx-1?tab=nonsense", { fixtureId: "fx-1" }],
    ["/fixtures/fx-1/result", { fixtureId: "fx-1", tab: "result" }],
  ]
  for (const [href, params] of cases) {
    for (const kind of [...PARTICIPANTS, ...STAFF, null]) {
      assert.deepEqual(routeForHref(href, kind), { pathname: MATCH_CENTRE, params }, `${href} in a ${kind ?? "no"} context`)
    }
  }
})

test("a deep link to a fixture, from any client, reaches the same Match Centre", () => {
  for (const url of [
    "ovalball://fixtures/fx-1",
    "exp://192.168.1.5:8081/--/fixtures/fx-1",
    "https://ovalball.co.uk/fixtures/fx-1",
    "ovalball://fixtures/fx-1/match-centre",
    "https://ovalball.co.uk/fixtures/fx-1/match-centre",
  ]) {
    assert.deepEqual(routeForIntent(resolveIntent(url)), { pathname: MATCH_CENTRE, params: { fixtureId: "fx-1" } }, url)
  }
  assert.deepEqual(routeForIntent(resolveIntent("https://ovalball.co.uk/fixtures/fx-1/edit")), {
    pathname: MATCH_CENTRE,
    params: { fixtureId: "fx-1", edit: "details" },
  })
  assert.deepEqual(routeForIntent(resolveIntent("https://ovalball.co.uk/fixtures/fx-1?tab=attendance")), {
    pathname: MATCH_CENTRE,
    params: { fixtureId: "fx-1", tab: "attendance" },
  })
})

test("every older fixture destination converges on the Match Centre, never a surface of its own", () => {
  assert.deepEqual(routeForIntent({ kind: "MATCH_CENTRE", fixtureId: "fx-1" }), { pathname: MATCH_CENTRE, params: { fixtureId: "fx-1" } })
  assert.deepEqual(routeForIntent({ kind: "FIXTURE_RESULT", fixtureId: "fx-1" }), { pathname: MATCH_CENTRE, params: { fixtureId: "fx-1", tab: "result" } })
  assert.deepEqual(routeForIntent({ kind: "ADD_RESULT", fixtureId: "fx-1" }), { pathname: MATCH_CENTRE, params: { fixtureId: "fx-1", tab: "result" } })
  // Editing is a sheet inside the Match Centre, drawn only where the server says this viewer may edit.
  assert.deepEqual(routeForIntent({ kind: "EDIT_FIXTURE", fixtureId: "fx-1" }), { pathname: MATCH_CENTRE, params: { fixtureId: "fx-1", edit: "details" } })
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

test("the intent and the route are one table, and no context chooses a fixture's address", () => {
  for (const kind of [...PARTICIPANTS, ...STAFF]) {
    assert.deepEqual(agendaIntent(fixture(), kind), { kind: "FIXTURE", fixtureId: "fx-1" })
  }
  const table = readFileSync("apps/mobile/src/links/destinations.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
  assert.doesNotMatch(table, /isFamilyFacingContext|narrowIntentForContext/, "a context is choosing between fixture surfaces again")
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

test("the retired fixture surfaces are gone, not just unrouted", () => {
  for (const retired of [
    "apps/mobile/src/fixtures/fixture-detail-screen.tsx",
    "apps/mobile/src/fixtures/edit-fixture-screen.tsx",
    "apps/mobile/src/fixtures/surface.ts",
    "apps/mobile/src/fixtures/match-centre.tsx",
    "apps/mobile/src/components/fixture-hero.tsx",
  ]) {
    assert.ok(!existsSync(retired), `${retired} still exists`)
  }
  for (const file of [...routeFiles(), ...sourceFiles("apps/mobile/src")]) {
    const body = readFileSync(file, "utf8")
    assert.doesNotMatch(body, /fixture-detail-screen|edit-fixture-screen|fixtures\/surface"|fixture-console/, `${file} imports a retired fixture surface`)
  }
})

test("the canonical fixture address draws the one Match Centre and nothing else", () => {
  const route = readFileSync(`${APP}/fixtures/[fixtureId]/index.tsx`, "utf8")
  assert.match(route, /import \{ MatchCentre \} from "\.\.\/\.\.\/\.\.\/\.\.\/src\/fixtures\/match-centre"/)
  assert.match(route, /export default MatchCentre/)
  const imports = route.match(/^import .*$/gm) ?? []
  assert.equal(imports.length, 1, `the canonical address imports more than the Match Centre: ${imports.join(" | ")}`)
})

test("every older fixture address is a redirect through the one route table", () => {
  for (const [file, kind] of [
    ["match-centre", "MATCH_CENTRE"],
    ["result", "FIXTURE_RESULT"],
    ["add-result", "ADD_RESULT"],
    ["edit", "EDIT_FIXTURE"],
  ] as const) {
    const source = readFileSync(`${APP}/fixtures/[fixtureId]/${file}.tsx`, "utf8")
    assert.match(source, /<Redirect href=\{routeForIntent\(\{ kind: "/, `${file} does not redirect through the route table`)
    assert.ok(source.includes(`kind: "${kind}"`), `${file} does not resolve as ${kind}`)
    assert.doesNotMatch(source, /src\/fixtures|supabase|mutations|<View|<Text/, `${file} draws something of its own`)
  }
})

test("the Match Centre's management controls are drawn from the server's answer, never a role", () => {
  const screen = readFileSync(`${MC_DIR}/index.tsx`, "utf8")
  // `canManageFixture` is `get_match_centre_viewer`'s answer for this viewer and this fixture; the
  // edit and cancel capabilities are the canonical resolver's (`loadFixtureAuthority`).
  assert.match(readFileSync("apps/mobile/src/match-centre/load.ts", "utf8"), /get_match_centre_viewer/)
  assert.match(screen, /const canEdit = Boolean\(view\?\.canManageFixture && authority\?\.edit\)/)
  assert.match(screen, /const canCancel = Boolean\(view\?\.canManageFixture && authority\?\.cancel\)/)
  for (const file of readdirSync(MC_DIR).filter((f) => f.endsWith(".tsx"))) {
    const source = readFileSync(join(MC_DIR, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
    // The ACTIVE context's kind may never pick what is drawn. (The Result section does read the
    // person's contexts to know which club is theirs -- identity, lifted verbatim from the canonical
    // Match Result -- and the server still decides every result action.)
    for (const wrong of [/isFamilyFacingContext/, /role === "/, /active\??\.kind ===/, /kind === "parent"/, /kind === "guardian"/]) {
      assert.ok(!wrong.test(source), `${file} decides by ${wrong} instead of the server's answer`)
    }
  }
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
      // A fixture ADDRESS is built by hand when the id goes into the path (a template or a literal id); a named
      // screen of a flow under /fixtures (Season Planner steps, Add Fixture) is a screen, not a fixture, and is
      // pushed by name exactly as the object form below already allows. Training paths are always addresses.
      if (/router\.(push|replace)\(\s*`\/fixtures\/\$\{/.test(line)) offenders.push(`${file}: ${line.trim()}`)
      if (/router\.(push|replace)\(\s*[`"']\/fixtures\/[0-9a-f]{8}-/.test(line)) offenders.push(`${file}: ${line.trim()}`)
      if (/router\.(push|replace)\(\s*[`"']\/calendar\/training\//.test(line)) offenders.push(`${file}: ${line.trim()}`)
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
  // `!cancelled` must stand between the gate and the control. Additional conjuncts are allowed
  // because they can only narrow it -- the screen now also requires `canEditSchedule` -- but removing
  // `!cancelled` still fails here, which is the invariant this line exists for.
  assert.match(screen, /!cancelled &&[^<]*<CancelSessionButton/, "a cancelled session can still be cancelled")
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
  // ONE BACK RULE (M2): useBackToSurface is the canonical origin helper with the surface as its landing, so an
  // opener's returnTo is honoured too -- and the guarantees below are the origin helper's.
  const back = readFileSync("apps/mobile/src/links/back.ts", "utf8")
  assert.match(back, /return useOriginBack\(surface\)/, "the surface Back is not the one origin helper")
  const origin = readFileSync("apps/mobile/src/links/origin.ts", "utf8")
  assert.match(origin, /const state = navigation\.getState\(\)\s*\n\s*const beneath = !!state && state\.index > 0/, "Back no longer asks the STACK what is beneath")
  assert.match(origin, /if \(beneath\) \{\s*\n\s*router\.back\(\)/)
  // At the root of its own surface's stack, Back DISMISSES to the surface, which replaces the parked screen;
  // only a fallback in another tab is navigated to.
  assert.match(origin, /const ownSurface = fallback !== "\/" && \(pathname === fallback \|\| pathname\.startsWith\(`\$\{fallback\}\/`\)\)\s*\n\s*if \(ownSurface\) \{\s*\n\s*router\.dismissTo\(fallback/, "a parked screen is left beneath its surface")
  for (const source of [back, origin]) assert.ok(!/router\.canGoBack\(\)/.test(source), "canGoBack() is the router's answer, and the router lets the tabs pop")
  for (const [file, surface] of [
    ["apps/mobile/app/(tabs)/calendar/training/[sessionId].tsx", "/calendar"],
    ["apps/mobile/src/fixtures/match-centre/index.tsx", "/fixtures"],
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
