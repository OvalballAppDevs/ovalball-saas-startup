import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { buildNavItems, buildClubSections, buildSiteAdminSections } from "@/lib/app-context/build-nav-items"
import type { SessionContext } from "@/lib/app-context/session-context"
import type { SwitchableContext } from "@/lib/app-context/active-context-rules"
import type { ClubSettingsNavCapabilities } from "@/app/(app)/club/settings/resolve-nav-capabilities"

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
  ({ key: "club:c-1", kind: "club", id: "c-1", playerId: null, label, switcherLabel: label, roleLabel: "Club Admin", logoUrl: null, clubId: "c-1" }) as SwitchableContext
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
  assert.match(layout, /buildNavItems\(ctx, activeContext, clubNavCapabilities\)/)
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

test("a team manager reaches their own team without typing a URL", () => {
  const ctx = session({ teamPermissions: [{ teamId: "t-1", teamDisplayName: "Under 12 Boys", permission: "manager", clubId: "c-1", clubName: "Burnley RUFC" } as never] })
  assert.ok(hrefs(buildNavItems(ctx, teamCtx("t-1"), null)).includes("/teams/t-1"))
})

test("and only ever the team they are operating as", () => {
  const ctx = session({
    teamPermissions: [
      { teamId: "t-1", teamDisplayName: "Under 12 Boys", permission: "manager", clubId: "c-1", clubName: "B" } as never,
      { teamId: "t-2", teamDisplayName: "Under 14 Boys", permission: "coach", clubId: "c-1", clubName: "B" } as never,
    ],
  })
  const list = hrefs(buildNavItems(ctx, teamCtx("t-1"), null))
  assert.ok(list.includes("/teams/t-1"))
  assert.ok(!list.includes("/teams/t-2"), "a team the person is not operating as appeared in navigation")
  assert.ok(!list.includes("/teams/t-9"), "an unauthorised team appeared in navigation")
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
