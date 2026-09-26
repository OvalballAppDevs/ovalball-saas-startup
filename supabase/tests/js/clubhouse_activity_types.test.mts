import { test } from "node:test"
import assert from "node:assert/strict"

import { CLUBHOUSE_NOTIFICATION_TYPES } from "../../../packages/contracts/src/notifications/feed"

/**
 * CLUBHOUSE PROGRAMME SECTION 11: `CLUBHOUSE_NOTIFICATION_TYPES` is the ONE list behind both
 * Clubhouse Home's "Recent Activity" teaser and the Notifications screen's "Clubhouse" filter
 * (`apps/mobile/app/(tabs)/notifications/index.tsx`). Pinned here so a future edit to either
 * consumer cannot silently diverge from the other, and so the boundary itself -- genuinely
 * network-relevant activity, never a global "every club's activity" feed -- stays checkable.
 */
test("CLUBHOUSE_NOTIFICATION_TYPES contains exactly the network-relevant types, and nothing else", () => {
  assert.deepEqual(
    [...CLUBHOUSE_NOTIFICATION_TYPES].sort(),
    [
      "calendar_share_approved",
      "calendar_share_declined",
      "club_claim_approved",
      "fixture_opportunity_cancelled",
      "fixture_opportunity_filled",
      "fixture_opportunity_response_declined",
      "fixture_opportunity_response_received",
      "fixture_request_accepted",
      "fixture_request_countered",
      "fixture_request_declined",
      "fixture_request_received",
      "partner_request_received",
    ].sort()
  )
})

test("CLUBHOUSE_NOTIFICATION_TYPES never includes a type about a single team's own operational business", () => {
  for (const unrelated of ["training_availability_responded", "fixture_availability_responded", "player_call_up_decided", "season_handover_applied"]) {
    assert.equal(CLUBHOUSE_NOTIFICATION_TYPES.has(unrelated), false)
  }
})
