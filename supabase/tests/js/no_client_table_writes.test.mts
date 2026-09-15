import { test } from "node:test"
import assert from "node:assert/strict"

import { clientTableWriteViolations, clientTableWrites } from "../../../scripts/security/authority-guards.mjs"

const FAMILY_TABLES = new Set([
  "players", "guardians", "guardian_link_requests", "guardian_player_permissions",
  "player_account_invitations", "player_duplicate_reviews", "guardian_invitations",
])

/**
 * Phase 2 AJ.2 no_client_table_writes (Z-5, AA.5): mutations call RPCs; a browser-session client writes a
 * table only where the perimeter manifest's client_write lists that write.
 */
test("every browser-session table write is listed in the perimeter manifest", () => {
  assert.deepEqual(clientTableWriteViolations(), [])
})

test("the scan sees the application's writes", () => {
  assert.ok((clientTableWrites() as unknown[]).length > 0, "no client writes found, so the scan is not reading the tree")
})

test("no family or player table is written by a browser-session client (Slice 4a)", () => {
  const writes = (clientTableWrites() as { file: string; line: number; table: string }[]).filter((w) => FAMILY_TABLES.has(w.table))
  assert.deepEqual(writes.map((w) => `${w.file}:${w.line} ${w.table}`), [])
})
