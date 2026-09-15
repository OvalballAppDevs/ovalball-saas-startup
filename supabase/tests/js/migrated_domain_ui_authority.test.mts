import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

import { ROOT, legacyUiAuthorityHits, migratedDomainUiFiles, migratedDomainUiViolations } from "../../../scripts/security/authority-guards.mjs"

/**
 * MIGRATED DOMAIN INTERFACES (Identity/Auth Slice 4a; Phase 2 AA.1 "UI renders from my_capabilities()", AA.3 "UI
 * capability reads" in each domain's banked unit, AA.5 banned authority literals).
 *
 * A form a page hides is presentation; the server action and the RPC behind it decide. The risk is drift: a page
 * gating on the session's guardian list or a Site Admin flag answers a DIFFERENT question from the database (the
 * session list only holds children with a team place, so a guardian of an unplaced child was not offered the gender
 * form the database allows), and the next developer copies the page's check into the action. These tests keep the
 * migrated interfaces on the canonical answer, and tie each page to the exact answer its action refuses with.
 */
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8")

test("no migrated domain interface carries legacy authority (role literals, Site Admin flags, session guardian lists)", () => {
  assert.deepEqual(migratedDomainUiViolations(), [])
})

test("the scan covers the 4a pages and actions it is meant to guard", () => {
  const files = (migratedDomainUiFiles() as Record<string, string[]>)["4a family and players"]
  for (const file of [
    "app/(app)/parent/players/[playerId]/access/page.tsx",
    "app/(app)/parent/players/[playerId]/access/actions.ts",
    "app/(app)/parent/players/[playerId]/details/page.tsx",
    "app/(app)/parent/players/[playerId]/details/actions.ts",
    "app/(app)/guardian-requests/actions.ts",
    "app/(app)/club/settings/guardians/actions.ts",
  ]) {
    assert.ok(files.includes(file), `${file} is not scanned`)
  }
})

test("the guard recognises the checks it bans, and ignores them in comments", () => {
  assert.deepEqual(legacyUiAuthorityHits("const canEdit = ctx.guardianRelationships.some((g) => g.playerId === id)"), ["guardianRelationships"])
  assert.deepEqual(legacyUiAuthorityHits("const isGuardian = mine || ctx.isSiteAdmin"), ["isSiteAdmin"])
  assert.deepEqual(legacyUiAuthorityHits('const may = ctx.siteAdminRole === "full"'), ["siteAdminRole"])
  assert.deepEqual(legacyUiAuthorityHits("// once decided from ctx.isSiteAdmin\n/* guardianRelationships */ const x = 1"), [])
})

test("Player Details offers the gender form on exactly the answer setPlayerGender refuses with", () => {
  const page = read("app/(app)/parent/players/[playerId]/details/page.tsx")
  const action = read("app/(app)/parent/players/[playerId]/details/actions.ts")
  assert.match(page, /mayRecordPlayerGender\(supabase, player\.id\)/)
  assert.match(action, /const allowed = await requireMayRecordPlayerGender\(supabase, playerId\)\s*\n\s*if \(!allowed\.ok\) return allowed/)
  assert.ok(action.indexOf("requireMayRecordPlayerGender(") < action.indexOf('.rpc("set_player_playing_pathway"'), "the early refusal must come before the RPC")
})

test("Player Access offers the consent switches on exactly the answer setPlayerPermission refuses with", () => {
  const page = read("app/(app)/parent/players/[playerId]/access/page.tsx")
  const action = read("app/(app)/parent/players/[playerId]/access/actions.ts")
  assert.match(page, /hasPlayerCapability\(supabase, "family\.permission\.manage", playerId\)/)
  assert.match(action, /const allowed = await requirePlayerCapability\(supabase, "family\.permission\.manage", playerId\)\s*\n\s*if \(!allowed\.ok\) return allowed/)
  assert.ok(action.indexOf("requirePlayerCapability(") < action.indexOf('.rpc("set_guardian_player_permission"'), "the early refusal must come before the RPC")
})
