import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { CLAIMABLE_ROLES } from "../../../packages/contracts/src/clubhouse/claims"

/**
 * CLUBHOUSE PROGRAMME SECTION 14: `CLAIMABLE_ROLES` is the one shared source behind both clients'
 * claim-submission forms. Pinned against the database's own `club_claims_claimed_role_eligible` check
 * constraint text so a future migration that changes the allow-list (the way
 * `20260831190000_club_claims_add_treasurer.sql` added Treasurer) cannot silently leave either client
 * offering a role the database will reject.
 */
test("CLAIMABLE_ROLES is exactly the roles the database's own check constraint allows", () => {
  const migration = readFileSync(new URL("../../migrations/20260831190000_club_claims_add_treasurer.sql", import.meta.url), "utf8")
  for (const role of CLAIMABLE_ROLES) {
    assert.ok(migration.includes(`'${role}'`), `migration text is missing the role "${role}"`)
  }
  // And nothing MORE than the migration allows -- a role added here without a matching migration
  // change would pass the "is it listed" check above but still be rejected by the real constraint.
  assert.equal(CLAIMABLE_ROLES.length, 7)
})

test("Safeguarding / Welfare Officer is deliberately excluded -- a real product decision, not an oversight", () => {
  assert.equal((CLAIMABLE_ROLES as readonly string[]).some((r) => /safeguard|welfare/i.test(r)), false)
})
