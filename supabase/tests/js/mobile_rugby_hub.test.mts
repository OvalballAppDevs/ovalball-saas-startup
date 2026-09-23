import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { HUB_GROUPS, HUB_START_HERE } from "../../../packages/contracts/src/rugby-hub/ia"
import { HUB_SECTION_SLUGS, hubHrefFor, hubSectionOf, parseHubHref, type HubDestination } from "../../../packages/contracts/src/rugby-hub/destinations"
import { PARENT_AUTHORITY_LINKS } from "../../../packages/contracts/src/rugby-hub/parents-types"
import { routeForHubDestination } from "../../../apps/mobile/src/hub/route-table"
import { resolveIntent } from "../../../apps/mobile/src/links/intents"
import { routeForIntent } from "../../../apps/mobile/src/links/destinations"

/**
 * THE RUGBY HUB IS ONE PRODUCT ON TWO CLIENTS.
 *
 * What this suite pins: the website's Hub addresses and the app's Hub screens
 * describe the same things (a link shared from a browser opens the same
 * article in the app, and the other way round); the app's IA is IMPORTED from
 * the shared package rather than copied; every screen reads through the
 * shared readers with the app's own authenticated client; and none of the
 * things the directive forbade -- a WebView, a hard-coded article, a
 * mobile-only law, a role-named screen, a service-role key -- has crept in.
 */

const MOBILE = "apps/mobile"
const HUB_ROUTES = join(MOBILE, "app/(tabs)/hub")
const HUB_SRC = join(MOBILE, "src/hub")

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}
const read = (path: string) => readFileSync(path, "utf8")
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const hubFiles = [...walk(HUB_ROUTES), ...walk(HUB_SRC)].filter((f) => /\.tsx?$/.test(f))

// ------------------------------------------------------------------ the shared vocabulary

test("every web Hub href the IA lists parses to a typed destination and round-trips", () => {
  const hrefs = [...HUB_GROUPS.flatMap((g) => g.items.map((i) => i.href)), ...HUB_START_HERE.map((s) => s.href), ...PARENT_AUTHORITY_LINKS.map((l) => l.href), "/rugby-hub"]
  for (const href of hrefs) {
    const destination = parseHubHref(href)
    assert.ok(destination, `${href} did not parse`)
    assert.notEqual(destination.kind, "web", `${href} is not in the vocabulary`)
    assert.equal(hubHrefFor(destination), href, `${href} does not round-trip`)
  }
})

test("the canonical detail, browse and anchor shapes round-trip exactly", () => {
  const cases: [string, HubDestination][] = [
    ["/rugby-hub/game/how-a-game-flows", { kind: "game", conceptKey: "how-a-game-flows" }],
    ["/rugby-hub/glossary/knock-on", { kind: "glossary", termKey: "knock-on" }],
    ["/rugby-hub/officiating/advantage", { kind: "officiating", contentKey: "advantage" }],
    ["/rugby-hub/positions/union/fly-half", { kind: "positions", code: "union", positionKey: "fly-half" }],
    ["/rugby-hub/positions/league", { kind: "positions", code: "league", positionKey: null }],
    ["/rugby-hub/skills/tackling-technique", { kind: "skills", skillKey: "tackling-technique" }],
    ["/rugby-hub/development?code=league", { kind: "development", conceptKey: null, code: "league" }],
    ["/rugby-hub/coaching/planning-a-simple-session", { kind: "coaching", conceptKey: "planning-a-simple-session", code: "all" }],
    ["/rugby-hub/story/FOLK-FOOTBALL", { kind: "story", entryKey: "FOLK-FOOTBALL" }],
    ["/rugby-hub/competitions/premiership-rugby", { kind: "competitions", contentKey: "premiership-rugby", code: "all" }],
    ["/rugby-hub/international/teams/england-mens", { kind: "international", teamKey: "england-mens", code: "all" }],
    ["/rugby-hub/international?code=union", { kind: "international", teamKey: null, code: "union" }],
    ["/rugby-hub/clubs/leicester-tigers", { kind: "clubs", clubKey: "leicester-tigers", code: "all" }],
    ["/rugby-hub/people/kevin-sinfield", { kind: "people", personKey: "kevin-sinfield" }],
    ["/rugby-hub/parents/what-a-new-player-needs", { kind: "parents", guideKey: "what-a-new-player-needs" }],
    ["/rugby-hub/rules?identity=u9-union#section-SCRUM", { kind: "rules", identityKey: "u9-union", section: "SCRUM" }],
    ["/rugby-hub/safeguarding?code=union&identity=u12-union", { kind: "safeguarding", code: "union", identityKey: "u12-union", section: null }],
    ["/rugby-hub/player-welfare?code=league#section-CONCUSSION", { kind: "player-welfare", code: "league", identityKey: null, section: "CONCUSSION" }],
    ["/rugby-hub/safeguarding/contact?club=c1&assignment=a1&mode=OVALBALL", { kind: "safeguarding-contact", clubId: "c1", assignmentId: "a1", mode: "OVALBALL" }],
    ["/rugby-hub?q=scrum", { kind: "search", query: "scrum" }],
  ]
  for (const [href, expected] of cases) {
    assert.deepEqual(parseHubHref(href), expected, `parse ${href}`)
    assert.equal(hubHrefFor(expected), href, `build ${href}`)
  }
})

test("what is not a Hub link is said to be not a Hub link, and what is unknown is not guessed", () => {
  assert.equal(parseHubHref("/fixtures/abc"), null)
  assert.equal(parseHubHref("/rugby-hubs/anything"), null)
  assert.deepEqual(parseHubHref("/rugby-hub/positions/cricket"), { kind: "web", href: "/rugby-hub/positions/cricket" })
  assert.deepEqual(parseHubHref("/rugby-hub/volunteers"), { kind: "web", href: "/rugby-hub/volunteers" })
  assert.deepEqual(parseHubHref("https://ovalball.co.uk/rugby-hub/skills/tackling"), { kind: "skills", skillKey: "tackling" })
  // Only the `section-` fragment shape is a section; anything else is ignored rather than trusted.
  assert.equal(parseHubHref("/rugby-hub/rules#access_token=x")?.kind === "rules" ? (parseHubHref("/rugby-hub/rules#access_token=x") as { section: string | null }).section : "wrong", null)
})

test("every section in the vocabulary is a destination the IA actually lists", () => {
  const listed = new Set(HUB_GROUPS.flatMap((g) => g.items.map((i) => i.href.replace("/rugby-hub/", ""))))
  for (const slug of HUB_SECTION_SLUGS) assert.ok(listed.has(slug), `${slug} is in the vocabulary but not in the IA`)
  assert.equal(listed.size, HUB_SECTION_SLUGS.length, "the IA lists a section the vocabulary does not know")
  assert.equal(hubSectionOf({ kind: "safeguarding-contact", clubId: null, assignmentId: null, mode: null }), "safeguarding")
})

// ------------------------------------------------------------------ the app's route table

/** A route file exists for an expo-router pathname: `/hub/game/[conceptKey]` -> `app/(tabs)/hub/game/[conceptKey].tsx`. */
function routeFileExists(pathname: string): boolean {
  const rel = pathname.replace(/^\/hub\/?/, "")
  const base = join(HUB_ROUTES, rel)
  return existsSync(`${base}.tsx`) || existsSync(join(base, "index.tsx"))
}

test("every destination in the vocabulary has a native screen, and no destination leaves the app", () => {
  const samples: HubDestination[] = [
    { kind: "home" },
    { kind: "search", query: "scrum" },
    { kind: "game", conceptKey: null },
    { kind: "game", conceptKey: "x" },
    { kind: "rules", identityKey: "u9-union", section: "SCRUM" },
    { kind: "officiating", contentKey: null },
    { kind: "officiating", contentKey: "x" },
    { kind: "positions", code: null, positionKey: null },
    { kind: "positions", code: "union", positionKey: null },
    { kind: "positions", code: "union", positionKey: "x" },
    { kind: "glossary", termKey: null },
    { kind: "glossary", termKey: "x" },
    { kind: "skills", skillKey: null },
    { kind: "skills", skillKey: "x" },
    { kind: "development", conceptKey: null, code: "league" },
    { kind: "development", conceptKey: "x", code: "all" },
    { kind: "coaching", conceptKey: null, code: "all" },
    { kind: "coaching", conceptKey: "x", code: "all" },
    { kind: "story", entryKey: null },
    { kind: "story", entryKey: "x" },
    { kind: "competitions", contentKey: null, code: "union" },
    { kind: "competitions", contentKey: "x", code: "all" },
    { kind: "international", teamKey: null, code: "all" },
    { kind: "international", teamKey: "x", code: "all" },
    { kind: "clubs", clubKey: null, code: "all" },
    { kind: "clubs", clubKey: "x", code: "all" },
    { kind: "people", personKey: null },
    { kind: "people", personKey: "x" },
    { kind: "parents", guideKey: null },
    { kind: "parents", guideKey: "x" },
    { kind: "player-welfare", code: "union", identityKey: null, section: null },
    { kind: "safeguarding", code: null, identityKey: null, section: "REPORTING" },
    { kind: "safeguarding-contact", clubId: "c", assignmentId: "a", mode: "EMAIL" },
  ]
  for (const d of samples) {
    const route = routeForHubDestination(d)
    assert.ok(route, `${d.kind} has no route`)
    assert.ok(routeFileExists(route.pathname), `${route.pathname} has no screen file`)
  }
  // The one destination without a screen is the one the vocabulary does not know -- and it is null, never a guess.
  assert.equal(routeForHubDestination({ kind: "web", href: "/rugby-hub/volunteers" }), null)
})

test("browsing state travels as params and never as authority", () => {
  assert.deepEqual(routeForHubDestination({ kind: "rules", identityKey: "u9-union", section: "SCRUM" }), { pathname: "/hub/rules", params: { identity: "u9-union", section: "SCRUM" } })
  assert.deepEqual(routeForHubDestination({ kind: "safeguarding", code: "union", identityKey: null, section: null }), { pathname: "/hub/safeguarding", params: { code: "union" } })
  assert.deepEqual(routeForHubDestination({ kind: "development", conceptKey: null, code: "all" }), { pathname: "/hub/development", params: undefined })
  for (const file of hubFiles) {
    const src = code(file)
    assert.ok(!/service_role|SERVICE_ROLE/.test(src), `${file} mentions the service role`)
    assert.ok(!/from "react-native-webview"|<WebView/.test(src), `${file} embeds a WebView`)
    assert.ok(!/role === "PARENT"|role === "COACH"|kind === "parent" \? </.test(src), `${file} branches a whole surface on a role`)
  }
})

// ------------------------------------------------------------------ deep links

test("a Rugby Hub link from the website resolves to the same article in the app", () => {
  const hub = resolveIntent("https://ovalball.co.uk/rugby-hub/glossary/knock-on")
  assert.equal(hub.kind, "RUGBY_HUB")
  assert.deepEqual(routeForIntent(hub), { pathname: "/hub/glossary/[termKey]", params: { termKey: "knock-on" } })
  const scheme = resolveIntent("ovalball://rugby-hub/positions/league/hooker")
  assert.deepEqual(routeForIntent(scheme), { pathname: "/hub/positions/[code]/[positionKey]", params: { code: "league", positionKey: "hooker" } })
  const landing = resolveIntent("exp://192.168.1.5:8081/--/rugby-hub")
  assert.deepEqual(routeForIntent(landing), { pathname: "/hub" })
  const unknown = resolveIntent("https://ovalball.co.uk/rugby-hub/volunteers")
  assert.equal(unknown.kind, "RUGBY_HUB")
  assert.equal(routeForIntent(unknown), null, "an unknown Hub link must resolve to nothing rather than somewhere plausible")
  // It is no longer "not yet supported": the placeholder is gone.
  assert.notEqual(resolveIntent("ovalball://rugby-hub").kind, "NOT_YET_SUPPORTED")
})

// ------------------------------------------------------------------ one Hub, imported

test("the app's Hub IA is the shared IA, not a copy", () => {
  const landing = code(join(HUB_ROUTES, "index.tsx"))
  assert.match(landing, /from "@ovalball\/contracts\/rugby-hub\/ia"/, "the landing does not import the shared IA")
  assert.ok(!/label: "Learn the Game"|href: "\/rugby-hub\/glossary"/.test(landing), "the landing hard-codes a destination")
  // The website still reaches the same modules through its original paths, and each is a re-export.
  const shims = readdirSync("lib/app-context").filter((f) => /^(rugby-hub-|game-knowledge|glossary|officiating|teams-competitions|international|clubs|people|development|coaching|parents|position-explorer|skills-explorer|heritage)/.test(f))
  assert.equal(shims.length, 29, `expected the 29 moved Hub modules under lib/app-context, found ${shims.length}`)
  for (const shim of shims) {
    const src = code(join("lib/app-context", shim))
    assert.match(src, /export \* from "@ovalball\/contracts\/rugby-hub\//, `${shim} is not a re-export of the shared package`)
    assert.ok(!/^(export )?(async )?function |^export const \w+ = /m.test(src), `${shim} has grown an implementation of its own`)
  }
  const nav = code("components/rugby-hub/nav/hub-nav-groups.ts")
  assert.match(nav, /export \* from "@ovalball\/contracts\/rugby-hub\/ia"/)
})

test("every Hub screen reads through a shared reader with the app's own client, and holds no article text", () => {
  const readers = /@ovalball\/contracts\/rugby-hub\//
  const screens = walk(HUB_ROUTES).filter((f) => f.endsWith(".tsx") && !f.endsWith("_layout.tsx"))
  for (const screen of screens) {
    const src = code(screen)
    const viaHooks = /from "[./]+\/src\/hub\/bundles"/.test(src)
    assert.ok(readers.test(src) || viaHooks, `${screen} reads nothing shared`)
    assert.ok(!/createClient\(/.test(src), `${screen} creates its own client`)
    assert.ok(!/\.from\("hub_content_items"\)/.test(src), `${screen} queries a content table directly instead of through the shared reader`)
  }
  // The one direct table read in the Hub is the officer's registered contact, through RLS, on the contact screen -- as on the web.
  const contact = code(join(HUB_ROUTES, "safeguarding/contact.tsx"))
  assert.match(contact, /start_or_get_safeguarding_officer_conversation/)
  assert.ok(!/\/messages\//.test(contact), "the contact screen must not invent a thread route the inbox does not know")
  const bundles = code(join(HUB_SRC, "bundles.ts"))
  for (const reader of ["getGameKnowledgeBundle", "getGlossaryBundle", "getOfficiatingBundle", "getCompetitionBundle", "getInternationalBundle", "getClubsBundle", "getPeopleBundle", "getDevelopmentBundle", "getCoachingBundle", "getParentsBundle", "getHeritageTimeline", "getPositionExplorerBundle", "getSkillsExplorerBundle"]) {
    assert.match(bundles, new RegExp(reader), `${reader} is not the reader the app uses`)
  }
})

test("the Hub cache is memory only and is emptied on sign-out", () => {
  const cache = code(join(HUB_SRC, "cache.ts"))
  assert.ok(!/AsyncStorage|FileSystem|SQLite/.test(cache), "the Hub cache persists content to the device")
  const more = code(join(MOBILE, "app/(tabs)/more.tsx"))
  assert.match(more, /forgetHubCache\(\)/)
  assert.match(more, /forgetHubTeamPreference\(\)/)
  assert.match(more, /forgetRecentSearches\(\)/)
})

test("the tab bar is unchanged: Rugby Hub is still the fourth everyday cell", () => {
  const projection = code(join(MOBILE, "src/context/tab-projection.ts"))
  assert.match(projection, /\{ key: "hub", label: "Rugby Hub" \}/)
  assert.ok(existsSync(join(HUB_ROUTES, "_layout.tsx")) && !existsSync(join(MOBILE, "app/(tabs)/hub.tsx")), "the placeholder tab file must be gone and the Hub must be a stack")
  assert.match(code(join(HUB_ROUTES, "_layout.tsx")), /initialRouteName: "index"/)
})
