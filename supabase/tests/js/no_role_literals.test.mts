import { test } from "node:test"
import assert from "node:assert/strict"

import { roleLiteralCounts, roleLiteralViolations } from "../../../scripts/security/authority-guards.mjs"

/**
 * Phase 2 AJ.2 no_role_literals: authority is a capability question the database answers, so the literals
 * that used to stand for authority (CLUB_ADMIN, team_admin, isSiteAdmin, siteAdminRole ===) may not spread.
 * Existing uses are a shrink list that reaches zero at Slice 10.
 */
test("no file gains an authority role literal beyond the shrink list", () => {
  const { problems } = roleLiteralViolations()
  assert.deepEqual(problems, [])
})

test("lib/auth is the only exempt home, and the scan sees real source", () => {
  const counts = roleLiteralCounts() as Record<string, number>
  assert.ok(Object.keys(counts).every((file) => !file.startsWith("lib/auth/")))
  assert.ok(Object.keys(counts).length > 0, "the scan found no literals at all, so it is not reading the tree")
})

test("the family and player server actions migrated in Slice 4a carry no role literal", () => {
  const counts = roleLiteralCounts() as Record<string, number>
  const familyActions = [
    "app/(app)/parent/children/actions.ts",
    "app/(app)/parent/players/[playerId]/access/actions.ts",
    "app/(app)/parent/players/[playerId]/details/actions.ts",
    "app/(app)/guardian-requests/actions.ts",
    "app/(app)/club/settings/guardians/actions.ts",
  ]
  assert.deepEqual(familyActions.filter((file) => (counts[file] ?? 0) > 0), [])
})
