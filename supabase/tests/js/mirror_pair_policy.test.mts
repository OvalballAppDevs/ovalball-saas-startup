import { test } from "node:test"
import assert from "node:assert/strict"

import { dedupeMirrorPairs, isPrimaryMirror } from "@/lib/fixtures/mirror-pair"

/**
 * ONE REAL MATCH MUST APPEAR ONCE -- AND MUST NOT DISAPPEAR.
 *
 * A confirmed two-sided fixture is two rows, one owned by each club. The
 * integrity audit found two different dedupe expressions across the codebase
 * and could not exercise either, because local data contains no mirror pair at
 * all. These are the synthetic pairs it lacked: created here, in the test
 * suite, rather than written into the playground database merely to make an
 * assertion possible.
 *
 * The two rules are not duplicates of each other. Each is correct for one
 * query shape and wrong for the other, and the failure they guard against is
 * different in each direction:
 *
 *   isPrimaryMirror     wrong where one half can arrive alone -> the fixture
 *                       VANISHES from the viewer's own diary
 *   dedupeMirrorPairs   used everywhere is merely slightly more work
 *
 * So the asymmetry matters, and the test that matters most is the third one.
 */

// Ids chosen so "Burnley's row" is deliberately the HIGHER one. That is the
// case the strict rule gets wrong, and picking ids where it accidentally works
// would prove nothing.
const BURNLEY = { id: "ffff0000-0000-4000-8000-000000000002", mirror_fixture_id: "aaaa0000-0000-4000-8000-000000000001" }
const ROSSENDALE = { id: "aaaa0000-0000-4000-8000-000000000001", mirror_fixture_id: "ffff0000-0000-4000-8000-000000000002" }
const UNMIRRORED = { id: "cccc0000-0000-4000-8000-000000000003", mirror_fixture_id: null }

test("a fixture with no mirror is always kept, by both rules", () => {
  assert.equal(isPrimaryMirror(UNMIRRORED), true)
  assert.deepEqual(dedupeMirrorPairs([UNMIRRORED]), [UNMIRRORED])
})

test("when both halves are in scope, exactly one survives -- and both rules pick the same one", () => {
  const both = [BURNLEY, ROSSENDALE]
  const deduped = dedupeMirrorPairs(both)
  assert.equal(deduped.length, 1, "one real match is one activity")
  assert.equal(deduped[0].id, ROSSENDALE.id, "the lower id wins, deterministically")
  // The database's own is_primary_mirror column must agree, or Fixture
  // Management and the Agenda would disagree about which row is primary.
  assert.deepEqual(both.filter(isPrimaryMirror).map((f) => f.id), [ROSSENDALE.id])
})

test("when only the HIGHER half is in scope it is kept -- this is the one that used to vanish", () => {
  // A Burnley parent's Agenda scopes to Burnley's teams, so only Burnley's row
  // comes back. Under the strict lower-id rule this fixture would be filtered
  // out of their own child's diary entirely.
  const scoped = [BURNLEY]
  assert.deepEqual(dedupeMirrorPairs(scoped), [BURNLEY], "the viewer keeps their own side of the match")
  assert.equal(isPrimaryMirror(BURNLEY), false, "and the strict rule would indeed have dropped it -- which is why the two rules exist")
})

test("when only the LOWER half is in scope it is also kept", () => {
  assert.deepEqual(dedupeMirrorPairs([ROSSENDALE]), [ROSSENDALE])
})

test("dedupe returns a genuine subset -- it never invents or reorders", () => {
  const rows = [UNMIRRORED, BURNLEY, ROSSENDALE]
  const out = dedupeMirrorPairs(rows)
  assert.equal(out.every((r) => rows.includes(r)), true, "every row came from the input")
  assert.equal(out.length <= rows.length, true)
  // Order preserved among survivors: UNMIRRORED was first and stays first.
  assert.equal(out[0].id, UNMIRRORED.id)
})

test("the navigation identity is the row itself, never its mirror", () => {
  // The canonical destination is the viewer's OWN side: Burnley's row carries
  // Burnley's meet time, pitch and conversation. A rule that redirected a
  // Burnley parent to Rossendale's row would be deterministic and wrong.
  for (const row of dedupeMirrorPairs([BURNLEY])) {
    assert.notEqual(row.id, row.mirror_fixture_id)
    assert.equal(`/fixtures/${row.id}`, `/fixtures/${BURNLEY.id}`)
  }
})

test("a dangling mirror link does not delete the fixture", () => {
  // Backfill left unmatched pairs unlinked rather than guessing, and a row can
  // point at a mirror that is archived or otherwise absent. It must still show.
  const dangling = { id: "dddd0000-0000-4000-8000-000000000004", mirror_fixture_id: "eeee0000-0000-4000-8000-000000000009" }
  assert.deepEqual(dedupeMirrorPairs([dangling]), [dangling])
})
