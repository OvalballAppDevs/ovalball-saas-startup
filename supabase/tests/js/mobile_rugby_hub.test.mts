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
  // CA-M11 moved the sign-out list to one place; More leaves through it and the list empties the Hub.
  const more = code(join(MOBILE, "app/(tabs)/more.tsx"))
  assert.match(more, /leaveSession\(signOut\)/)
  const leave = code(join(MOBILE, "src/auth/leave.ts"))
  assert.match(leave, /forgetHubCache\(\)/)
  assert.match(leave, /forgetHubTeamPreference\(\)/)
  assert.match(leave, /forgetRecentSearches\(\)/)
})

test("Rugby Hub's route survives Clubhouse V1 taking its bar cell: still a declared, addressable stack, reachable from More", () => {
  // Clubhouse V1 (owner product decision) supersedes the earlier "Rugby Hub is the fourth cell"
  // arrangement -- Clubhouse holds it now (see mobile_tab_projection.test.mts). What must NOT have
  // happened is Rugby Hub's route disappearing: only its bar cell moved.
  const projection = code(join(MOBILE, "src/context/tab-projection.ts"))
  assert.match(projection, /\{ key: "clubhouse", label: "Clubhouse" \}/, "Clubhouse did not take the fourth cell")
  assert.match(projection, /"hub"/, "the hub route key was removed from the declared tab set rather than just losing its cell")
  assert.ok(existsSync(join(HUB_ROUTES, "_layout.tsx")) && !existsSync(join(MOBILE, "app/(tabs)/hub.tsx")), "the placeholder tab file must be gone and the Hub must be a stack")
  assert.match(code(join(HUB_ROUTES, "_layout.tsx")), /initialRouteName: "index"/)
  // And it must be reachable some other way now that it has no cell -- More is that way (Section 50:
  // do not delete Rugby Hub content).
  const more = code(join(MOBILE, "app/(tabs)/more.tsx"))
  assert.match(more, /label="Rugby Hub"/, "Rugby Hub lost its bar cell without gaining a row in More")
})

// ------------------------------------------------------------------ RH-M0.1: whose rugby, and what varies

import { resolveHubTeam, hubTeamPreferenceKey } from "../../../apps/mobile/src/hub/team-resolution"
import { positionsCacheKey, skillsCacheKey, UNIVERSAL_BUNDLES } from "../../../apps/mobile/src/hub/cache-keys"

const OPTIONS = [
  { teamId: "t-u8", clubId: "c1", teamDisplayName: "Under 8 Mixed", clubName: "UAT RUFC", childName: "Ben Whitaker" },
  { teamId: "t-u12", clubId: "c1", teamDisplayName: "Under 12 Boys", clubName: "UAT RUFC", childName: "Ava Whitaker" },
  { teamId: "t-u16", clubId: "c2", teamDisplayName: "Under 16 Boys", clubName: "Other RFC" },
]

test("the selected context leads: a parent standing in a child's context gets that child's team", () => {
  assert.deepEqual(resolveHubTeam(OPTIONS, { kind: "parent", id: "t-u12" }, null), { teamId: "t-u12", source: "context" })
  assert.deepEqual(resolveHubTeam(OPTIONS, { kind: "parent", id: "t-u8" }, null), { teamId: "t-u8", source: "context" })
  assert.deepEqual(resolveHubTeam(OPTIONS, { kind: "player", id: "t-u16" }, null), { teamId: "t-u16", source: "context" })
  assert.deepEqual(resolveHubTeam(OPTIONS, { kind: "team", id: "t-u16" }, null), { teamId: "t-u16", source: "context" })
})

test("a coach of several sides gets the side they are standing in, never an arbitrary first", () => {
  assert.equal(resolveHubTeam(OPTIONS, { kind: "team", id: "t-u12" }, null).teamId, "t-u12")
  assert.equal(resolveHubTeam(OPTIONS, { kind: "team", id: "t-u16" }, null).teamId, "t-u16")
})

test("a club context gets the first of THAT club's teams, and says it was not the viewer's own choice", () => {
  assert.deepEqual(resolveHubTeam(OPTIONS, { kind: "club", id: "c2" }, null), { teamId: "t-u16", source: "context" })
  // All Children, or a context that is not a team at all: the website's fallback, named as such.
  assert.deepEqual(resolveHubTeam(OPTIONS, { kind: "family", id: null }, null), { teamId: "t-u8", source: "first" })
  assert.deepEqual(resolveHubTeam([], { kind: "parent", id: "t-u8" }, null), { teamId: null, source: "none" })
})

test("a choice remembered inside the Hub wins only while it is a real option, and is keyed per context so it cannot outlive a context switch", () => {
  assert.deepEqual(resolveHubTeam(OPTIONS, { kind: "parent", id: "t-u12" }, "t-u8"), { teamId: "t-u8", source: "remembered" })
  // A remembered id that is no longer one of the viewer's teams falls through to the context.
  assert.deepEqual(resolveHubTeam(OPTIONS, { kind: "parent", id: "t-u12" }, "t-gone"), { teamId: "t-u12", source: "context" })
  assert.notEqual(hubTeamPreferenceKey("parent:ava:t-u12"), hubTeamPreferenceKey("parent:ben:t-u8"))
  // The provider reads the preference under the ACTIVE context's key: the defect the owner saw was one global key.
  const provider = code(join(HUB_SRC, "identity.tsx"))
  assert.match(provider, /hubTeamPreferenceKey\(activeKey\)/)
  assert.ok(!/"ovalball\.rugby-hub\.team"\)/.test(provider), "a single global team preference is back")
})

test("no Hub file reads an age grade out of a team's name", () => {
  for (const file of hubFiles) {
    const src = code(file)
    // Code shapes only -- `includes("U12")`, `.match(/U(\d+)/)`, `/Under (\d+)/` -- never prose that happens to say "Under 9".
    assert.ok(!/includes\("U\d|\.match\(\/U|\.test\(\/U|\/Under \\?d|\/\^?U\\d/.test(src), `${file} parses an age grade from a name`)
  }
  const contracts = code("packages/contracts/src/rugby-hub/rugby-hub-data.ts")
  assert.ok(!/includes\("U\d|\.match\(\/U|\/Under \\?d/.test(contracts), "the shared resolver parses an age grade from a name")
})

test("the cache key names every dimension the canonical answer varies on", () => {
  assert.notEqual(positionsCacheKey("union", "id-u8"), positionsCacheKey("union", "id-u12"))
  assert.notEqual(positionsCacheKey("union", "id-u8"), positionsCacheKey("league", "id-u8"))
  assert.notEqual(skillsCacheKey("id-u8"), skillsCacheKey("id-u12"))
  assert.notEqual(skillsCacheKey("id-u8"), skillsCacheKey(null))
  // The universal bundles are universal on the WEB: their shared readers take no identity at all.
  const readerFor: Record<string, string> = { game: "game-knowledge-data", glossary: "glossary-data", officiating: "officiating-data", competitions: "teams-competitions-data", international: "international-data", clubs: "clubs-data", people: "people-data", development: "development-data", coaching: "coaching-data", parents: "parents-data", story: "heritage-data" }
  for (const bundle of UNIVERSAL_BUNDLES) {
    const src = code(`packages/contracts/src/rugby-hub/${readerFor[bundle]}.ts`)
    const signature = src.match(/export async function get\w+\(([^)]*)\)/)?.[1] ?? ""
    assert.ok(!/identity|teamId/i.test(signature), `${bundle}'s shared reader takes an identity (${signature}) -- it is not universal and must be keyed`)
  }
  // The identity-aware readers do, and the app passes it.
  assert.match(code("packages/contracts/src/rugby-hub/position-explorer-data.ts"), /regulatoryIdentityId: string \| null/)
  assert.match(code("packages/contracts/src/rugby-hub/skills-explorer-data.ts"), /regulatoryIdentityId: string \| null/)
})

test("the contextual screens drop the previous team's rows the moment the team changes", () => {
  for (const screen of ["rules.tsx", "player-welfare.tsx", "safeguarding/index.tsx"]) {
    const src = code(join(HUB_ROUTES, screen))
    assert.match(src, /const scope = `/, `${screen} has no scope`)
    assert.match(src, /useEffect\(\(\) => \{\s*(setResult|setContent)\(null\)/, `${screen} does not reset on a scope change`)
    assert.match(src, /<HubContextLine /, `${screen} does not say whose rugby it is answering for`)
  }
  assert.match(code(join(HUB_ROUTES, "skills/index.tsx")), /<HubContextLine /)
  // And universal screens carry no such line.
  for (const screen of ["glossary/index.tsx", "story/index.tsx", "people/index.tsx", "game/index.tsx"]) {
    assert.ok(!/HubContextLine/.test(code(join(HUB_ROUTES, screen))), `${screen} labels universal content with a team`)
  }
})

// ------------------------------------------------------------------ RH-M0.2: the Rules of Play reach the platform

import { encodeHubTeamCookie, rememberedHubTeamFromCookie, resolveHubTeam as resolveSharedHubTeam } from "../../../packages/contracts/src/rugby-hub/team-choice"
import { groupRulesOfPlay, presentPitch, presentRuleOfPlay, RULES_OF_PLAY_CATEGORIES, rulesOfPlayCategoryLabel } from "../../../packages/contracts/src/rugby-hub/rugby-hub-format"
import type { RulesOfPlayRow } from "../../../packages/contracts/src/rugby-hub/rugby-hub-data"

const WEB_RULES_PAGE = "app/(app)/rugby-hub/rules/page.tsx"
const MOBILE_RULES_SCREEN = join(HUB_ROUTES, "rules.tsx")
const WEB_HUB_DIR = "app/(app)/rugby-hub"

test("the rule for whose Rugby Hub this is lives in the shared package and the app imports it from there", () => {
  const shim = read(join(HUB_SRC, "team-resolution.ts"))
  assert.match(shim, /from "@ovalball\/contracts\/rugby-hub\/team-choice"/)
  assert.doesNotMatch(code(join(HUB_SRC, "team-resolution.ts")), /export function/, "the app must not carry its own copy of the rule")
  const web = read(join(WEB_HUB_DIR, "active-team.ts"))
  assert.match(web, /from "@ovalball\/contracts\/rugby-hub\/team-choice"/)
  assert.match(web, /resolveActiveContext\(/, "the website resolves the Hub team from the app-wide selected context")
})

test("the website's remembered Hub choice is bound to the context it was made in", () => {
  const value = encodeHubTeamCookie("parent:ava:t-u12", "t-u12")
  assert.equal(rememberedHubTeamFromCookie(value, "parent:ava:t-u12"), "t-u12")
  assert.equal(rememberedHubTeamFromCookie(value, "parent:ben:t-u8"), null, "a choice made while viewing Ava is never applied while viewing Ben")
  assert.equal(rememberedHubTeamFromCookie("t-u12", "parent:ava:t-u12"), null, "the old bare-team-id cookie is not honoured across contexts")
  assert.equal(rememberedHubTeamFromCookie(undefined, "parent:ava:t-u12"), null)
  // a club context resolves to the club's own team, whichever field carries the club
  const options = [
    { teamId: "t-a", clubId: "c1", teamDisplayName: "Under 8 Mixed", clubName: "A" },
    { teamId: "t-b", clubId: "c2", teamDisplayName: "Under 12 Boys", clubName: "B" },
  ]
  assert.deepEqual(resolveSharedHubTeam(options, { kind: "club", id: "c2", clubId: "c2" }, null), { teamId: "t-b", source: "context" })
  assert.deepEqual(resolveSharedHubTeam(options, { kind: "club", id: "c2:CLUB_ADMIN", clubId: "c2" }, null), { teamId: "t-b", source: "context" })
})

test("every Rugby Hub page on the website resolves the team through the one context-aware helper", () => {
  const pages = walk(WEB_HUB_DIR).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith("active-team.ts") && !f.endsWith("constants.ts"))
  const resolvers = pages.filter((f) => /resolveHubTeamForRequest\(/.test(code(f)))
  assert.ok(resolvers.length >= 11, `expected the layout, the search action and every team-aware page to use it; found ${resolvers.length}`)
  for (const f of pages) {
    assert.doesNotMatch(code(f), /resolveActiveRugbyHubTeamId|store\.get\(RUGBY_HUB_TEAM_COOKIE\)/, `${f} still resolves the team its own way`)
  }
  assert.doesNotMatch(code("packages/contracts/src/rugby-hub/rugby-hub-data.ts"), /export async function resolveActiveRugbyHubTeamId/, "the cookie-only resolver is retired, not left for somebody to find first")
})

test("both clients render the Rules of Play from the same shared readers and the same category list", () => {
  for (const f of [WEB_RULES_PAGE, MOBILE_RULES_SCREEN]) {
    const src = code(f)
    for (const name of ["getRulesOfPlayBundle", "getRulesOfPlayBundleByIdentity", "groupRulesOfPlay", "presentRuleOfPlay", "presentPitch"]) {
      assert.match(src, new RegExp(`\\b${name}\\b`), `${f} must use ${name} from the shared package`)
    }
    assert.match(src, /General Laws/, `${f} names the General Laws layer`)
    assert.match(src, /Rules of Play for /, `${f} names whose Rules of Play these are`)
  }
  const contractsData = read("packages/contracts/src/rugby-hub/rugby-hub-data.ts")
  assert.match(contractsData, /rpc\("get_rugby_hub_rules_of_play"/)
  assert.match(contractsData, /rpc\("get_rugby_hub_rules_of_play_by_identity"/)
})

test("no client carries its own rules list, and no client names an age grade to decide anything", () => {
  for (const f of [WEB_RULES_PAGE, MOBILE_RULES_SCREEN, join(HUB_SRC, "identity.tsx"), "packages/contracts/src/rugby-hub/rugby-hub-format.ts", "packages/contracts/src/rugby-hub/team-choice.ts"]) {
    const src = code(f)
    assert.doesNotMatch(src, /\b(U6|U7|U8|U9|U1[0-9])\b/, `${f} must not hard-code an age grade`)
    assert.doesNotMatch(src, /RFU-|RFL-/, `${f} must not hard-code a regulatory identity`)
    assert.doesNotMatch(src, /Maximum \d+-a-side|Ball size \d|metres long/, `${f} must not carry rule text of its own`)
  }
})

test("the Rules-of-Play categories are the register's own, in one order, with one label each", () => {
  const keys = RULES_OF_PLAY_CATEGORIES.map((c) => c.key)
  assert.equal(new Set(keys).size, keys.length)
  assert.ok(keys.includes("PLAYER_COUNT") && keys.includes("PITCH") && keys.includes("BALL_SIZE") && keys.includes("MATCH_DURATION") && keys.includes("CONTACT_RULE"))
  assert.equal(rulesOfPlayCategoryLabel("PLAYER_COUNT"), "Players")
  assert.equal(rulesOfPlayCategoryLabel("SOMETHING_NEW"), "Something New", "an unknown category still reads as words rather than a key")

  const row = (over: Partial<RulesOfPlayRow>): RulesOfPlayRow =>
    ({
      fact_id: "f", fact_key: "k", fact_type: "PLAYER_COUNT", section_key: "PLAYER_COUNT", display_title: null, value_type: "INTEGER",
      value_integer: null, value_decimal: null, value_boolean: null, value_duration_minutes: null, value_distance_metres: null, value_range_min: null, value_range_max: null,
      value_enum: null, value_text: null, value_unit: null, obligation_level: "MANDATORY", body: null, effective_from: null,
      primary_source_key: "SRC", primary_source_locator: null, applies_to_count: 1, identity_key: "X", identity_label: "X", identity_rugby_code: "union",
      ...over,
    }) as RulesOfPlayRow

  const rows = [
    row({ fact_id: "a", fact_type: "SUBSTITUTION", section_key: "SUBSTITUTION", value_type: "TEXT", value_text: "Rolling substitutions.", body: "Coaches stay off the pitch." }),
    row({ fact_id: "b", fact_type: "PITCH_WIDTH", section_key: "PITCH", value_type: "DISTANCE", value_distance_metres: 22, body: "Maximum width." }),
    row({ fact_id: "c", fact_type: "PLAYER_COUNT", value_integer: 6, body: "Teams must be equal." }),
    row({ fact_id: "d", fact_type: "PITCH_LENGTH", section_key: "PITCH", value_type: "DISTANCE", value_distance_metres: 45, body: "Maximum length." }),
    row({ fact_id: "e", fact_type: "MATCH_DURATION", section_key: "MATCH_DURATION", value_type: "DURATION", value_duration_minutes: 10, body: "Two halves." }),
  ]
  const groups = groupRulesOfPlay(rows)
  assert.deepEqual(groups.map((g) => g.key), ["PLAYER_COUNT", "PITCH", "MATCH_DURATION", "SUBSTITUTION"], "canonical order, whatever order the rows arrived in")
  assert.equal(groups[1].rows.length, 2)

  assert.deepEqual(presentRuleOfPlay(rows[2]), { title: "Players", headline: "6", body: "Teams must be equal." })
  assert.deepEqual(presentRuleOfPlay(rows[0]), { title: "Substitutions", headline: null, body: "Rolling substitutions. Coaches stay off the pitch." }, "a rule stated in words is the body, not a headline")
  assert.equal(presentRuleOfPlay(rows[4]).headline, "10 minutes", "the unit is the register's; 'per half' is never appended by a client")
  const pitch = presentPitch(groups[1].rows)
  assert.equal(pitch.headline, "Length: 45 metres · Width: 22 metres")
  assert.equal(pitch.rest.length, 0)
})

test("a Rules search result lands on a section that exists: the search context asks for the viewer's identity", () => {
  const search = code("packages/contracts/src/rugby-hub/rugby-hub-search.ts")
  assert.match(search, /p_viewer_identity_id: viewerRegulatoryIdentityId/)
  assert.match(search, /RULES_OF_PLAY_LABELS/, "a Rules-of-Play category is a titled destination, not a bare key")
})
