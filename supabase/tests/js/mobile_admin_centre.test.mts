import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { ADMIN_CENTRE_SECTIONS } from "../../../packages/contracts/src/club/admin-centre"
import { CLUB_CONTACT_ROLES, clubProfileErrorMessage, clubProfileFieldsDiffer, EMPTY_CLUB_PROFILE_FIELDS } from "../../../packages/contracts/src/club/profile"
import { REASON_REQUIRED_OPERATIONS, REASON_REQUIRED_RPCS } from "../../../packages/contracts/src/required-reasons"

/**
 * THE ADMIN CENTRE IS THE SAME PRODUCT ON A SECOND CLIENT (CA-M1).
 *
 * Structural pins, beside the SQL suite that proves the domain operations
 * themselves: both clients write the Club Profile through the domain
 * operations and never the tables; the app decides nothing from a role
 * label; every section is gated by a canonical capability the website gates
 * the same job on; no admin mutation is queued for later; the required-reasons
 * list is one list; and the error rule is one rule.
 */

const MOBILE = "apps/mobile"
const ADMIN_ROUTES = join(MOBILE, "app/(tabs)/admin")
const ADMIN_SRC = join(MOBILE, "src/admin")
const CONTRACTS_CLUB = "packages/contracts/src/club"

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}
const read = (path: string) => readFileSync(path, "utf8")
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
const adminFiles = [...walk(ADMIN_ROUTES), ...walk(ADMIN_SRC)].filter((f) => /\.tsx?$/.test(f))

test("both clients change the Club Profile through the domain operations, never the tables", () => {
  const contracts = code(join(CONTRACTS_CLUB, "profile.ts"))
  for (const rpc of ["update_club_profile", "save_club_contact", "delete_club_contact"]) {
    assert.match(contracts, new RegExp(`rpc\\("${rpc}"`), `the shared wrapper calls ${rpc}`)
  }
  assert.doesNotMatch(contracts, /from\("clubs"\)\s*\.\s*(update|insert|delete|upsert)/, "the shared module never writes clubs directly")
  assert.doesNotMatch(contracts, /from\("club_contacts"\)\s*\.\s*(update|insert|delete|upsert)/, "the shared module never writes club_contacts directly")

  const webActions = code("app/(app)/club/actions.ts")
  assert.match(webActions, /from "@ovalball\/contracts\/club\/profile"/)
  assert.doesNotMatch(webActions, /from\("clubs"\)\s*\.update\(\{\s*bio/, "the website's profile save no longer writes clubs directly")
  assert.doesNotMatch(webActions, /from\("club_contacts"\)/, "the website's contact actions no longer touch club_contacts directly")

  for (const f of adminFiles) {
    const src = code(f)
    assert.doesNotMatch(src, /\.from\("(clubs|club_contacts)"\)\s*\.\s*(update|insert|delete|upsert)/, `${f} must not write the tables`)
    assert.doesNotMatch(src, /rpc\("(update_club_profile|save_club_contact|delete_club_contact)"/, `${f} must go through the shared wrapper, not call the operation itself`)
  }
})

test("the app decides nothing from a role label", () => {
  for (const f of [...adminFiles, join(MOBILE, "app/(tabs)/more.tsx")]) {
    const src = code(f)
    assert.doesNotMatch(src, /role\s*===?\s*["'](CLUB_ADMIN|Club Admin|club_admin)["']/i, `${f} branches on a role label`)
    assert.doesNotMatch(src, /\bisClubAdmin\b|\bclubRoleKey\s*===?/, `${f} derives authority from a role`)
  }
  const access = code(join(ADMIN_SRC, "access.ts"))
  assert.match(access, /readAdminCentreAccess|my_capabilities/, "visibility comes from the server's capability read")
})

test("every Admin Centre section is gated by one canonical capability the website gates the same job on", () => {
  const webNav = code("app/(app)/club/settings/resolve-nav-capabilities.ts")
  const keys = new Set(ADMIN_CENTRE_SECTIONS.map((s) => s.key))
  assert.equal(keys.size, ADMIN_CENTRE_SECTIONS.length, "section keys are unique")
  for (const s of ADMIN_CENTRE_SECTIONS) {
    assert.match(webNav, new RegExp(`"${s.capability.replace(/\./g, "\\.")}"`), `${s.key} is gated on ${s.capability}, which the website also gates on`)
    assert.ok(s.webPath.startsWith("/"), `${s.key} names a web destination`)
    assert.match(s.label, /^[A-Z]/, `${s.key} label is Title Case`)
  }
  assert.ok(ADMIN_CENTRE_SECTIONS.some((s) => s.native && s.key === "club-profile"), "Club Profile is native in CA-M1")
})

test("no admin mutation is queued, cached as authority, or kept in a mobile-only store", () => {
  for (const f of adminFiles) {
    const src = code(f)
    assert.doesNotMatch(src, /AsyncStorage|SecureStore|mobile_club_settings|queue|retryLater|pendingWrites/i, `${f} keeps no local store of admin state`)
  }
  const screen = code(join(ADMIN_ROUTES, "club-profile.tsx"))
  assert.match(screen, /useFocusEffect/, "the screen re-reads when it comes back into focus")
  assert.match(screen, /readClubProfile\(/, "the screen reads the canonical profile")
  assert.match(screen, /canEditClubProfile\(|readAdminCentreAccess\(/, "the screen asks the server whether it may edit")
})

test("the shared field rules behave", () => {
  assert.equal(clubProfileFieldsDiffer(EMPTY_CLUB_PROFILE_FIELDS, { ...EMPTY_CLUB_PROFILE_FIELDS, bio: "  " }), false, "whitespace alone is not a change")
  assert.equal(clubProfileFieldsDiffer(EMPTY_CLUB_PROFILE_FIELDS, { ...EMPTY_CLUB_PROFILE_FIELDS, website: "x" }), true)
  assert.deepEqual(CLUB_CONTACT_ROLES, ["fixture_secretary", "minis_secretary", "general"])
  assert.equal(clubProfileErrorMessage({ code: "42501", message: "You do not have permission to change this club's profile." }, "fallback"), "You do not have permission to change this club's profile.")
  assert.equal(clubProfileErrorMessage({ code: "22023", message: "A name is required." }, "fallback"), "A name is required.")
  assert.equal(clubProfileErrorMessage({ code: "08006", message: "connection lost: driver detail" }, "fallback"), "fallback", "a driver fault never reaches a screen verbatim")
  assert.equal(clubProfileErrorMessage(new Error("TypeError: fetch failed"), "fallback"), "fallback")
})

test("the required-reasons list is one list, and no client keeps another", () => {
  assert.equal(new Set(REASON_REQUIRED_RPCS).size, REASON_REQUIRED_RPCS.length)
  assert.equal(REASON_REQUIRED_RPCS.length, 12)
  for (const op of REASON_REQUIRED_OPERATIONS) {
    if (op.when === "conditional") assert.ok(op.condition, `${op.rpc} states its condition`)
  }
  // No second hand-written list of reason-requiring RPC names anywhere in either client. A file that
  // CALLS the operations (rpc("...")) is their caller, not a list; a list is the names as bare strings.
  const suspects = [...walk("apps/mobile/src"), ...walk("apps/mobile/app"), ...walk("lib"), ...walk("app")].filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("required-reasons"))
  for (const f of suspects) {
    const src = code(f)
    const hits = REASON_REQUIRED_RPCS.filter((rpc) => new RegExp(`(?<!rpc\\()["'\`]${rpc}["'\`]`).test(src))
    assert.ok(hits.length < 6, `${f} names ${hits.length} reason-requiring operations as bare strings -- a second list`)
  }
})
