import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { buildNavItems, buildClubSections, buildSiteAdminSections } from "@/lib/app-context/build-nav-items"
import type { SessionContext } from "@/lib/app-context/session-context"
import type { SwitchableContext } from "@/lib/app-context/active-context-rules"
import type { ClubSettingsNavCapabilities } from "@/app/(app)/club/settings/resolve-nav-capabilities"
import { navActiveMatcher, resolveActiveHref } from "@/lib/app-context/active-nav"

/**
 * STEP 1 — CANONICAL NAVIGATION.
 *
 * Step 0's one confirmed regression was a hub that decided for itself which destinations a Club Admin
 * may see, and hid two finished features from somebody who held their capabilities. These assertions
 * hold the architecture that replaced it: one destination catalogue, one capability decision, two
 * presentations. Navigation is never the boundary -- every route re-checks server-side -- so what is
 * pinned here is that the SAME decision reaches both surfaces, not that hiding protects anything.
 */

const read = (p: string) => readFileSync(p, "utf8")
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

function session(over: Partial<SessionContext> = {}): SessionContext {
  return {
    firstName: "Test", isSiteAdmin: false, siteCapabilities: [],
    clubMemberships: [], teamPermissions: [], guardianRelationships: [], linkedPlayerTeams: [],
    ...over,
  } as unknown as SessionContext
}
const clubCtx = (label = "Burnley RUFC"): SwitchableContext =>
  // `clubRoleKey` is what the navigation gates on now -- it compared the printed
  // roleLabel, which worked and would have broken silently the first time
  // somebody reworded the label.
  ({ key: "club:c-1:CLUB_ADMIN", kind: "club", id: "c-1", playerId: null, label, switcherLabel: label, roleLabel: "Club Admin", clubRoleKey: "CLUB_ADMIN", logoUrl: null, clubId: "c-1" }) as SwitchableContext
const teamCtx = (id = "t-1"): SwitchableContext =>
  ({ key: `team:${id}`, kind: "team", id, playerId: null, label: "Under 12 Boys", switcherLabel: "Under 12 Boys", roleLabel: "Team Manager", logoUrl: null, clubId: "c-1" }) as SwitchableContext
const clubAdminSession = () => session({
  clubMemberships: [{ clubId: "c-1", clubName: "Burnley RUFC", role: "CLUB_ADMIN", clubLogoUrl: null, clubSlug: "b" } as never],
})
const caps = (over: Partial<ClubSettingsNavCapabilities> = {}): ClubSettingsNavCapabilities =>
  ({
    canProfile: true, canPitchesManage: false, canTeams: true, canVenues: true, canRollover: true,
    canFixtureEdit: true, canPitchAllocation: true, canFixtureCallups: false, canPlayerDispensations: false,
    canPlayerMoves: true, canGuardians: true, canSafeguarding: true, canPermissions: true,
    canSubscriptionConfigure: false, canSubscriptionViewFinance: false, canSubscriptions: false,
    canPlatformBillingView: false, canOvalballBilling: false, canNews: true,
    ...over,
  }) as ClubSettingsNavCapabilities

const hrefs = (r: { primary: { href: string }[] }) => r.primary.map((i) => i.href)

// ---------------------------------------------------------------- the drift

test("the Club Settings hub consumes the canonical resolver and derives nothing itself", () => {
  const hub = code("app/(app)/club/settings/page.tsx")
  assert.match(hub, /resolveClubSettingsNavCapabilities\(supabase, clubId\)/)
  assert.ok(
    !/hasCapability\(/.test(hub),
    "the settings hub asks its own capability questions again -- this is the Step 0 regression returning",
  )
})

test("navigation and the hub read the same resolution", () => {
  const layout = code("app/(app)/layout.tsx")
  assert.match(layout, /resolveClubSettingsNavCapabilities\(supabase, navClubId\)/)
  assert.match(layout, /buildNavItems\(ctx, activeContext, clubNavCapabilities(?:, teamFinance(?:, teamClubhouseAccess)?)?\)/)
})

// ---------------------------------------------------------------- capability-driven destinations

test("a Club Admin holding people.capability.manage is offered Permissions", () => {
  const nav = buildNavItems(clubAdminSession(), clubCtx(), caps())
  assert.ok(hrefs(nav).includes("/club/permissions"))
})

test("and one who does not hold it is not", () => {
  const nav = buildNavItems(clubAdminSession(), clubCtx(), caps({ canPermissions: false }))
  assert.ok(!hrefs(nav).includes("/club/permissions"))
})

test("the Safeguarding Officer destination follows the nomination capability", () => {
  assert.ok(hrefs(buildNavItems(clubAdminSession(), clubCtx(), caps())).includes("/club/settings/safeguarding"))
  assert.ok(!hrefs(buildNavItems(clubAdminSession(), clubCtx(), caps({ canSafeguarding: false }))).includes("/club/settings/safeguarding"))
})

test("with no canonical decisions at all, no capability-gated destination appears", () => {
  // The null case is a session with no club -- it must fail closed, not open.
  const nav = buildNavItems(clubAdminSession(), clubCtx(), null)
  for (const gated of ["/club/permissions", "/club/settings/safeguarding", "/club/settings/guardians", "/teams"]) {
    assert.ok(!hrefs(nav).includes(gated), `${gated} appeared with no capability decision`)
  }
})

// ---------------------------------------------------------------- Clubhouse Programme Section 1

test("Clubhouse is a first-class destination: ungrouped and top-level, never buried inside a collapsible section", () => {
  const { primary } = buildNavItems(clubAdminSession(), clubCtx(), caps(), false)
  const { top, sections } = buildClubSections(primary, null)
  assert.ok(
    top.some((i) => i.href === "/clubhouse"),
    "Clubhouse is not in the ungrouped top tier"
  )
  for (const section of sections) {
    assert.ok(
      !section.items.some((i) => i.href === "/clubhouse"),
      `Clubhouse is buried inside the "${section.label}" collapsible section as well as being in top`
    )
  }
})

// ---------------------------------------------------------------- the orphans

test("the orphaned club join requests page is reachable from navigation", () => {
  assert.ok(hrefs(buildNavItems(clubAdminSession(), clubCtx(), caps())).includes("/club/join-requests"))
})

test("the orphaned Site Admin safeguarding page is reachable from navigation", () => {
  const nav = buildNavItems(session({ isSiteAdmin: true, siteCapabilities: ["site.users.view"] }),
    { key: "site_admin", kind: "site_admin", id: null, playerId: null, label: "Ovalball", switcherLabel: "Ovalball", roleLabel: "Site Admin", logoUrl: null, clubId: null } as SwitchableContext)
  assert.ok(hrefs(nav).includes("/admin/safeguarding"))
})

// ---------------------------------------------------------------- team

test("a team manager reaches their own team's product without typing a URL", () => {
  // THE INVARIANT, NOT THE MECHANISM. Step 0 found a Team Manager could reach their own team only by
  // typing its URL, and that must stay fixed. What changed is HOW: the team is no longer an item in a
  // navigation group called "Team" inside a workspace that already IS that team. It is the workspace's
  // identity, its operational home is Overview, its people and subscriptions are their own
  // destinations, and its infrequent administration is behind the context gear
  // (resolveContextSettingsLink -> /teams/<id>).
  //
  // So this asserts that the team's own product is reachable, which is what the finding was about.
  const ctx = session({ teamPermissions: [{ teamId: "t-1", teamDisplayName: "Under 12 Boys", permission: "manager", clubId: "c-1", clubName: "Burnley RUFC" } as never] })
  const list = hrefs(buildNavItems(ctx, teamCtx("t-1"), null))
  assert.ok(list.includes("/dashboard"), "the team's own overview is not reachable")
  assert.ok(list.includes("/teams/t-1/people"), "the team's people are not reachable")
})

test("and only ever the team they are operating as", () => {
  const ctx = session({
    teamPermissions: [
      { teamId: "t-1", teamDisplayName: "Under 12 Boys", permission: "manager", clubId: "c-1", clubName: "B" } as never,
      { teamId: "t-2", teamDisplayName: "Under 14 Boys", permission: "coach", clubId: "c-1", clubName: "B" } as never,
    ],
  })
  const list = hrefs(buildNavItems(ctx, teamCtx("t-1"), null))
  assert.ok(list.some((h) => h.startsWith("/teams/t-1")))
  assert.ok(!list.some((h) => h.startsWith("/teams/t-2")), "a team the person is not operating as appeared in navigation")
  assert.ok(!list.some((h) => h.startsWith("/teams/t-9")), "an unauthorised team appeared in navigation")
})

test("and the generic Team group is gone -- the workspace is the team", () => {
  // Owner decision: a navigation category called "Team" inside a team context is a layer that only
  // costs a click. Nothing may name the team as a destination to click into from within itself.
  const ctx = session({ teamPermissions: [{ teamId: "t-1", teamDisplayName: "Under 12 Boys", permission: "manager", clubId: "c-1", clubName: "B" } as never] })
  const list = hrefs(buildNavItems(ctx, teamCtx("t-1"), null))
  assert.ok(!list.includes("/teams/t-1"), "navigation still links into the team you are already in")
  // And occasional administration does not hold a permanent slot.
  assert.ok(!list.includes("/teams/t-1/player-requests"), "Player Requests is back in ordinary navigation")
})

test("no two navigation sections share a key -- a Club Admin operating in a team context", () => {
  // THE EXACT CASE THAT BROKE. A Club Admin holds club fixture authority, so in a TEAM context both
  // the team's own Fixtures group and CLUB_SECTIONS' "rugby" group found items. Two sections came back
  // with the same key, which React reports as unsupported -- a section can be duplicated or dropped --
  // and which also gives two disclosure buttons one aria-controls target.
  //
  // Only this combination reproduces it: a team manager has no club fixture authority and so never saw
  // it, which is why it survived a suite, a build and a browser pass and surfaced in the owner's console.
  const ctx = session({
    clubMemberships: [{ clubId: "c-1", clubName: "Burnley RUFC", role: "CLUB_ADMIN", clubLogoUrl: null, clubSlug: "b" } as never],
    teamPermissions: [{ teamId: "t-1", teamDisplayName: "Under 12 Boys", permission: "coach", clubId: "c-1", clubName: "Burnley RUFC" } as never],
  })
  const { primary } = buildNavItems(ctx, teamCtx("t-1"), caps(), true)
  const { sections } = buildClubSections(primary, "t-1")
  const keys = sections.map((s) => s.key)
  assert.equal(new Set(keys).size, keys.length, `duplicate section key in [${keys.join(", ")}]`)
})

test("no group label or destination appears twice in a team sidebar", () => {
  // THE VISIBLE HALF of the duplicate-key defect, and the half an owner actually sees: the sidebar
  // rendered "Fixtures & Calendar" twice, each carrying Fixtures and Calendar, because groupNavItems
  // added an item to every group whose spec named its href. Keys being unique would not have fixed
  // this -- a label check is what catches it.
  const ctx = session({
    clubMemberships: [{ clubId: "c-1", clubName: "Burnley RUFC", role: "CLUB_ADMIN", clubLogoUrl: null, clubSlug: "b" } as never],
    teamPermissions: [{ teamId: "t-1", teamDisplayName: "Under 12 Boys", permission: "coach", clubId: "c-1", clubName: "Burnley RUFC" } as never],
  })
  const { primary } = buildNavItems(ctx, teamCtx("t-1"), caps(), true)
  const { sections } = buildClubSections(primary, "t-1")

  const labels = sections.map((s) => s.label)
  assert.equal(new Set(labels).size, labels.length, `a group label appears twice: [${labels.join(", ")}]`)

  const destinations = sections.flatMap((s) => s.items.map((i) => i.href))
  assert.equal(
    new Set(destinations).size,
    destinations.length,
    `a destination appears in more than one group: [${destinations.join(", ")}]`
  )
})

test("club-wide fixture administration does not follow a Club Admin into a team", () => {
  // A Club Admin holds club fixture authority everywhere, so standing in Under 12 Boys used to offer
  // the club's Fixture Control Centre and the inter-club Fixture Requests register -- a console for
  // every team at the club, shown because of who they are rather than where they are standing.
  // Context decides the product; capability decides the actions within it.
  const ctx = session({
    clubMemberships: [{ clubId: "c-1", clubName: "Burnley RUFC", role: "CLUB_ADMIN", clubLogoUrl: null, clubSlug: "b" } as never],
    teamPermissions: [{ teamId: "t-1", teamDisplayName: "Under 12 Boys", permission: "coach", clubId: "c-1", clubName: "Burnley RUFC" } as never],
  })
  const inTeam = hrefs(buildNavItems(ctx, teamCtx("t-1"), caps(), true))
  assert.ok(!inTeam.includes("/fixtures/management"), "the club's Fixture Control Centre followed them into a team")
  assert.ok(!inTeam.includes("/fixtures"), "the inter-club request register followed them into a team")
  assert.ok(inTeam.includes("/agenda"), "Fixtures must still be the team's fixture overview")

  // And it is still there where it belongs.
  const inClub = hrefs(buildNavItems(ctx, clubCtx(), caps(), false))
  assert.ok(inClub.includes("/fixtures/management"), "club context lost the Fixture Control Centre")
  assert.ok(inClub.includes("/fixtures"), "club context lost the Fixture Requests register")
})

test("subscriptions appear only where the bounded team capability is held", () => {
  const ctx = session({ teamPermissions: [{ teamId: "t-1", teamDisplayName: "Under 12 Boys", permission: "manager", clubId: "c-1", clubName: "B" } as never] })
  const without = hrefs(buildNavItems(ctx, teamCtx("t-1"), null, false))
  const withIt = hrefs(buildNavItems(ctx, teamCtx("t-1"), null, true))
  assert.ok(!without.includes("/teams/t-1/subscriptions"), "team finance appeared without the capability")
  assert.ok(withIt.includes("/teams/t-1/subscriptions"), "team finance did not appear with the capability")
})

test("Clubhouse Programme Section 2: a team-scoped Coach/Team Manager gets a first-class Clubhouse entry, gated on team-scope fixture authority, not on club-wide hasClubFixtureAuthority", () => {
  const ctx = session({ teamPermissions: [{ teamId: "t-1", teamDisplayName: "Under 12 Boys", permission: "manager", clubId: "c-1", clubName: "B" } as never] })
  // No club-wide CLUB_ADMIN/FIXTURE_SECRETARY membership anywhere in this session -- canManageClub
  // FixturesAnywhere is false. Clubhouse must appear anyway, because teamClubhouseAccess is true.
  const without = buildNavItems(ctx, teamCtx("t-1"), null, false, false)
  const withIt = buildNavItems(ctx, teamCtx("t-1"), null, false, true)
  assert.ok(!hrefs(without).includes("/clubhouse"), "Clubhouse appeared without team-scope fixture authority")
  assert.ok(hrefs(withIt).includes("/clubhouse"), "Clubhouse did not appear with team-scope fixture authority")
  // And it gets the same first-class, ungrouped top-tier treatment a club context gets -- never buried
  // inside a team-context group either.
  const { top, sections } = buildClubSections(withIt.primary, "t-1")
  assert.ok(top.some((i) => i.href === "/clubhouse"), "Clubhouse is not in the team context's top tier")
  for (const section of sections) {
    assert.ok(!section.items.some((i) => i.href === "/clubhouse"), `Clubhouse is buried inside "${section.label}" as well as being in top`)
  }
})

test("a club member with no team relationship is offered no team destination", () => {
  const list = hrefs(buildNavItems(session(), clubCtx(), null))
  assert.ok(!list.some((h) => /^\/teams\//.test(h)))
})

// ---------------------------------------------------------------- grouping

test("desktop and mobile are grouped from the same structure", () => {
  const layout = code("app/(app)/layout.tsx")
  const built = layout.slice(layout.indexOf("const { top: navTop, sections: navSections }"))
  assert.match(built, /buildSiteAdminSections|buildClubSections/)
  const nav = code("app/(app)/app-nav.tsx")
  const mobile = code("app/(app)/app-mobile-nav.tsx")
  for (const [name, src] of [["desktop", nav], ["mobile", mobile]] as const) {
    assert.match(src, /<NavSections/, `${name} does not render the shared sections component`)
    assert.ok(!/SECTIONS\s*=|buildSiteAdminSections|buildClubSections/.test(src), `${name} builds its own taxonomy`)
  }
})

test("maintenance is grouped, never prime navigation", () => {
  const { top, sections } = buildClubSections([
    { href: "/dashboard", label: "Dashboard" },
    { href: "/people", label: "Overview" },
    { href: "/club/calendar/deleted-events", label: "Deleted Calendar Events" },
    { href: "/club/settings", label: "Club Settings" },
  ])
  assert.deepEqual(top.map((i) => i.href), ["/dashboard"], "something other than the landing page is top-level")
  const bin = sections.find((s) => s.items.some((i) => i.href === "/club/calendar/deleted-events"))
  assert.equal(bin?.label, "Club Management", "the recycle bin is not inside club management")
})

test("Site Admin platform maintenance is not a job group", () => {
  const { sections } = buildSiteAdminSections([
    { href: "/dashboard", label: "Dashboard" },
    { href: "/admin/users", label: "User Management" },
    { href: "/admin/system-health", label: "System Health" },
  ])
  assert.equal(sections.find((s) => s.items.some((i) => i.href === "/admin/users"))?.label, "Users & Permissions")
  assert.equal(sections.find((s) => s.items.some((i) => i.href === "/admin/system-health"))?.label, "Platform & Maintenance")
})

test("nothing a person may see is ever dropped by grouping", () => {
  const items = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/people", label: "Overview" },
    { href: "/some/unmapped/route", label: "Unmapped" },
  ]
  const { top, sections } = buildClubSections(items)
  const rendered = [...top, ...sections.flatMap((s) => s.items)].map((i) => i.href)
  for (const i of items) assert.ok(rendered.includes(i.href), `${i.href} vanished when navigation was grouped`)
})

// ---------------------------------------------------------------- the family contexts

test("player and guardian navigation gains no administration", () => {
  for (const kind of ["player", "family", "parent"] as const) {
    const ctx = session({ clubMemberships: [{ clubId: "c-1", clubName: "B", role: "CLUB_ADMIN", clubLogoUrl: null, clubSlug: "b" } as never] })
    const nav = buildNavItems(ctx, { key: kind, kind, id: null, playerId: null, label: "All Children", switcherLabel: "All Children", roleLabel: "Parent/Guardian", logoUrl: null, clubId: null } as SwitchableContext, caps())
    for (const admin of ["/people", "/club/permissions", "/club/join-requests", "/club/settings", "/teams"]) {
      assert.ok(!hrefs(nav).includes(admin), `${kind} navigation offers ${admin}`)
    }
  }
})

test("navigation is presentation: it reads no authority of its own", () => {
  const src = code("lib/app-context/build-nav-items.ts")
  for (const forbidden of ["supabase", "createClient", "rpc(", "hasCapability("]) {
    assert.ok(!src.includes(forbidden), `build-nav-items reaches for ${forbidden} -- it must be handed decisions, never make them`)
  }
})

// ---------------------------------------------------------------- active state

test("the page you are on is the row that lights up, and it is the only one", () => {
  // THE DEFECT, DEMONSTRATED ON THE REAL CLUB NAVIGATION rather than an invented list. Every renderer
  // decided per row with `pathname === href || pathname.startsWith(href + "/")`, which is a prefix
  // test, not a matcher: where destinations nest it answers true for the ancestor as well as the page.
  const ctx = clubAdminSession()
  const { primary } = buildNavItems(ctx, clubCtx(), caps(), false)
  const { top, sections } = buildClubSections(primary, null)
  const all = [...top.map((i) => i.href), ...sections.flatMap((s) => s.items.map((i) => i.href))]

  const oldPredicate = (pathname: string, href: string) =>
    pathname === href || pathname.startsWith(`${href}/`)

  // These are shipped club destinations that nest inside another shipped club destination, so the
  // pairs exist in the product and not only in this test.
  for (const pathname of ["/fixtures/management", "/club/settings/guardians", "/club/settings/safeguarding"]) {
    assert.ok(all.includes(pathname), `${pathname} is not a club destination any more -- retire this case`)
    const lit = all.filter((h) => oldPredicate(pathname, h))
    assert.ok(lit.length > 1, `the old predicate no longer over-matches on ${pathname}, so it lit [${lit.join(", ")}]`)
    assert.deepEqual(
      all.filter((h) => navActiveMatcher(pathname, all)(h)),
      [pathname],
      `more or fewer than one row is active on ${pathname}`
    )
  }
})

test("a deeper route nobody names still lights its nearest ancestor", () => {
  // The one thing the prefix test got right, kept: reading one message is being in Messages, and a
  // fixture's Match Centre is being in Fixtures. Losing this would leave the sidebar blank on the
  // pages people spend the most time on.
  const all = ["/dashboard", "/agenda", "/messages", "/club/settings", "/club/settings/guardians"]
  assert.equal(resolveActiveHref("/messages/abc-123", all), "/messages")
  assert.equal(resolveActiveHref("/club/settings/guardians/xyz", all), "/club/settings/guardians")
  assert.equal(resolveActiveHref("/club/settings/branding", all), "/club/settings")
  assert.equal(resolveActiveHref("/rugby-hub", all), null, "an unnamed top-level route lit something")
  // A prefix that is not a path segment is not a match.
  assert.equal(resolveActiveHref("/agenda-archive", all), null)
})

test("every navigation renderer resolves active state through the one resolver", () => {
  // Four renderers -- desktop sidebar, its grouped sections, the mobile drawer, the bottom bar -- and
  // the defect was in all four because each carried its own copy of the predicate. A fifth copy would
  // reintroduce it silently, so the copies are what is banned, not just their behaviour.
  for (const path of [
    "app/(app)/app-nav.tsx",
    "app/(app)/nav-sections.tsx",
    "app/(app)/app-mobile-nav.tsx",
  ]) {
    const src = code(path)
    assert.ok(
      /navActiveMatcher|resolveActiveHref/.test(src),
      `${path} does not use the canonical active-state resolver`
    )
    assert.ok(
      !/pathname\.startsWith\(`\$\{[^}]*href\}\/`\)/.test(src),
      `${path} still decides active state with its own prefix test`
    )
  }
})
