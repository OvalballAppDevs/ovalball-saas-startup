import type { GuardianTeamContext, PlayerTeamContext, SessionContext } from "./session-context"
import { listSwitchableContexts, resolveActiveContext } from "./active-context-rules"

/**
 * Run with `npx tsx lib/app-context/active-context.verify.ts`. Permanent
 * regression coverage for the Side Project 1 integration's active-context
 * change (Section 17): a Guardian's "parent" context is now keyed by
 * playerId + teamId, not teamId alone, so two children on the same team
 * resolve to two distinct, independently-switchable contexts.
 */

let pass = 0
let fail = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : ` -- got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`)
  if (ok) pass++
  else fail++
}

function guardianRel(overrides: Partial<GuardianTeamContext>): GuardianTeamContext {
  return {
    playerId: "player-a",
    playerFirstName: "Child",
    playerSurname: "One",
    ageState: "minor",
    teamId: "team-1",
    teamDisplayName: "Under 9",
    clubId: "club-1",
    clubName: "Test Club",
    ...overrides,
  }
}

function baseCtx(overrides: Partial<SessionContext>): SessionContext {
  return {
    user: { id: "user-1" } as SessionContext["user"],
    firstName: "Test",
    isSiteAdmin: false,
    siteAdminRole: null,
    diagnosticClubAccess: false,
    manageTeamCatalogue: false,
    manageCompetitions: false,
    manageFixtureSupport: false,
    manageGlobalLookups: false,
    clubMemberships: [],
    teamPermissions: [],
    guardianRelationships: [],
    linkedPlayerTeams: [],
    ...overrides,
  }
}

// ===== Parent with one child =====
{
  const ctx = baseCtx({ guardianRelationships: [guardianRel({})] })
  const contexts = listSwitchableContexts(ctx)
  check("one child -> exactly one parent context", contexts.filter((c) => c.kind === "parent").length, 1)
  check("one child -> key carries both playerId and teamId", contexts[0]?.key, "parent:player-a:team-1")
  check("one child -> playerId field is populated", contexts[0]?.playerId, "player-a")
}

// ===== Parent with two children on the SAME team (the exact bug Section 17 exists to prevent) =====
{
  const ctx = baseCtx({
    guardianRelationships: [guardianRel({ playerId: "player-a", playerFirstName: "Alex" }), guardianRel({ playerId: "player-b", playerFirstName: "Bailey" })],
  })
  const contexts = listSwitchableContexts(ctx).filter((c) => c.kind === "parent")
  check("two children, same team -> two distinct parent contexts (not collapsed into one)", contexts.length, 2)
  check("two children, same team -> keys are distinct", new Set(contexts.map((c) => c.key)).size, 2)
  check("two children, same team -> both keys still resolve back to the same team id", contexts.every((c) => c.id === "team-1"), true)
  // Regression: an earlier draft of this change made `label` itself carry
  // the child's name ("Alex — Under 9"), which silently leaked into every
  // OTHER consumer that reuses `label` as a plain club/team display name
  // (dashboard-data.ts's page header, build-nav-items.ts's nav club name)
  // -- found before shipping by auditing every consumer of active-context,
  // not just the switcher itself. `label` must stay the plain team name;
  // only `switcherLabel` (read exclusively by the switcher's own dropdown)
  // may name the specific child.
  check("two children, same team -> `label` stays the plain team name for every non-switcher consumer", contexts.every((c) => c.label === "Under 9"), true)
  check(
    "two children, same team -> `switcherLabel` is the one place the child's name appears, so the dropdown can tell them apart",
    contexts.map((c) => c.switcherLabel).sort(),
    ["Alex — Under 9", "Bailey — Under 9"]
  )
  check(
    "two children, same team -> resolveActiveContext(cookie for child A) returns exactly child A, not child B",
    resolveActiveContext(ctx, "parent:player-a:team-1").playerId,
    "player-a"
  )
  check("two children, same team -> resolveActiveContext(cookie for child B) returns exactly child B", resolveActiveContext(ctx, "parent:player-b:team-1").playerId, "player-b")
}

// ===== Parent with children on different teams =====
{
  const ctx = baseCtx({
    guardianRelationships: [guardianRel({ playerId: "player-a", teamId: "team-1" }), guardianRel({ playerId: "player-b", teamId: "team-2", clubId: "club-2" })],
  })
  const contexts = listSwitchableContexts(ctx).filter((c) => c.kind === "parent")
  check("children on different teams -> two distinct contexts with distinct team ids", contexts.map((c) => c.id).sort(), ["team-1", "team-2"])
  check("children on different teams -> each carries its own club id (no cross-club bleed)", contexts.find((c) => c.playerId === "player-b")?.clubId, "club-2")
}

// ===== Legacy view_only fallback (no Guardian relationship) keeps its original 2-part key =====
{
  const ctx = baseCtx({
    teamPermissions: [{ teamId: "team-9", teamDisplayName: "Legacy Team", clubId: "club-9", clubName: "Legacy Club", permission: "view_only" }],
  })
  const contexts = listSwitchableContexts(ctx).filter((c) => c.kind === "parent")
  check("legacy view_only fallback (no Guardian relationship) keeps the 2-part key", contexts[0]?.key, "parent:team-9")
  check("legacy view_only fallback has no playerId to derive", contexts[0]?.playerId, null)
}

// ===== A Guardian relationship for the same team supersedes the legacy fallback, never both =====
{
  const ctx = baseCtx({
    guardianRelationships: [guardianRel({ teamId: "team-9", clubId: "club-9" })],
    teamPermissions: [{ teamId: "team-9", teamDisplayName: "Legacy Team", clubId: "club-9", clubName: "Legacy Club", permission: "view_only" }],
  })
  const contexts = listSwitchableContexts(ctx).filter((c) => c.kind === "parent")
  check("a real Guardian relationship supersedes the legacy fallback for the same team -- never both", contexts.length, 1)
  check("the surviving context is the canonical Guardian-sourced one", contexts[0]?.key, "parent:player-a:team-9")
}

// ===== Invalid / tampered / stale cookie value never grants a context the session doesn't actually have =====
{
  const ctx = baseCtx({ guardianRelationships: [guardianRel({})], clubMemberships: [{ clubId: "club-1", clubName: "Test Club", clubSlug: "test-club", clubLogoUrl: null, role: "CLUB_ADMIN" }] })
  const tampered = resolveActiveContext(ctx, "parent:some-other-players-id:some-other-team")
  check("a tampered/nonexistent cookie key never resolves to the tampered value -- falls back to a real context this session actually has", tampered.kind === "club" || tampered.kind === "parent", true)
  check("a tampered cookie's playerId never leaks through", tampered.playerId, tampered.kind === "parent" ? "player-a" : null)
}

// ===== Player context also carries playerId (a Player's own single linked identity) =====
{
  const playerCtx: PlayerTeamContext = { playerId: "player-self", teamId: "team-5", teamDisplayName: "Senior Colts", clubId: "club-5", clubName: "Test Club", ageState: "adult" }
  const ctx = baseCtx({ linkedPlayerTeams: [playerCtx] })
  const contexts = listSwitchableContexts(ctx).filter((c) => c.kind === "player")
  check("player context carries its own playerId", contexts[0]?.playerId, "player-self")
}

console.log(`\n${pass} PASS, ${fail} FAIL`)
if (fail > 0) process.exit(1)
