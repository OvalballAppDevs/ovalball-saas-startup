import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * SLICE 6b.2 -- PROVING D.2's LAYER 2 IS ACTUALLY PRESENT, NOT MERELY AVAILABLE.
 *
 * The reconciliation recorded S6-9 as MISSED with the exact words "exists with zero callers". A
 * function nobody calls is not an enforcement layer, and the failure mode this guard exists to
 * prevent is the opposite one: somebody deletes a call and nothing goes red, because the database
 * still refuses and the product still *works*.
 *
 * WHAT THIS IS AND IS NOT. This is a code-shape invariant: every Slice-6 protected Server Action
 * reaches the boundary, and the AAL-elevation exemption is used only where circularity requires it.
 * It is NOT proof that the boundary decides correctly -- that is supabase/tests/session_boundary.sql,
 * which drives the decision against a real database through live, revoked, suspended, disabled and
 * no-session states.
 */

function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e.startsWith(".")) continue
    const full = join(dir, e)
    if (statSync(full).isDirectory()) walk(full, acc)
    else if (/\.ts$/.test(e)) acc.push(full)
  }
  return acc
}

/**
 * The Slice-6 protected surfaces: authenticated auth/account/security actions. Public-by-design
 * surfaces are listed separately and deliberately, because adding requireSession to a
 * recovery-request endpoint to satisfy a count would break the anonymous flow Phase 2 requires.
 */
const PROTECTED = [
  "app/(app)/account/actions.ts",
  "app/(app)/account/security/actions.ts",
  "app/(app)/account/security/recovery-actions.ts",
  "app/security/enrol/actions.ts",
  "app/security/verify/actions.ts",
  "app/signup/complete-authenticated-signup.ts",
]

const PUBLIC_BY_DESIGN = [
  "app/login/actions.ts",
  "app/signup/submit-signup.ts",
  "app/auth/oauth-actions.ts",
  "app/forgot-password/actions.ts",
]

/** Only these may stand the assurance gate down, and only because enforcing it there is circular. */
const MAY_ELEVATE = ["app/security/enrol/actions.ts", "app/security/verify/actions.ts"]

test("S6-9 every Slice-6 protected Server Action reaches the session boundary", () => {
  const missing = PROTECTED.filter((f) => !/guardAction\s*\(/.test(code(f)))
  assert.deepEqual(missing, [], "a protected action that does not call guardAction has no layer 2")
})

test("S6-9 the (app) layout asks the canonical question, not just 'is anybody signed in'", () => {
  const layout = code("app/(app)/layout.tsx")
  assert.match(layout, /requireSession\s*\(/)
  assert.doesNotMatch(
    layout,
    /data:\s*\{\s*user\s*\}[\s\S]{0,120}getUser\(\)[\s\S]{0,120}if \(!user\)[\s\S]{0,60}redirect\("\/login"\)/,
    "the bare getUser-or-/login guard must not come back beside the boundary",
  )
})

test("S6-9 public-by-design auth surfaces are NOT gated, so anonymous flows still work", () => {
  const wrongly = PUBLIC_BY_DESIGN.filter((f) => /guardAction\s*\(/.test(code(f)))
  assert.deepEqual(
    wrongly,
    [],
    "sign-in, signup, OAuth start and the reset request are reached by people with no session. " +
      "Gating them would be an import-count win and a product outage.",
  )
})

test("S6-9 the AAL-elevation exemption is used only where enforcing it would be circular", () => {
  const offenders: string[] = []
  for (const f of walk("app")) {
    if (!/allowAalElevation/.test(code(f))) continue
    if (!MAY_ELEVATE.includes(f)) offenders.push(f)
  }
  assert.deepEqual(
    offenders,
    [],
    "allowAalElevation stands the assurance gate down. It is correct only on the pages that exist to " +
      "reach AAL2; anywhere else it is a hole.",
  )
})

test("S6-9 the boundary never re-decides capability, which is the database's answer", () => {
  const boundary = code("lib/auth/action-boundary.ts") + code("lib/auth/require-session.ts")
  assert.doesNotMatch(
    boundary,
    /has_site_capability|my_capabilities|internal\.can\(/,
    "capability resolution belongs to the database; a second copy here would drift from the first",
  )
})

test("S6-9 no refusal destination re-enters the group it refuses from (no redirect loop)", () => {
  const src = readFileSync("lib/auth/require-session.ts", "utf8")
  const destinations = [...src.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1])
  assert.ok(destinations.length >= 4, "every refusal reason must name a destination")
  for (const d of destinations) {
    assert.ok(
      !d.startsWith("/dashboard") && !d.startsWith("/account/security"),
      `${d} is inside the (app) group, so refusing to it would re-enter the layout that refused`,
    )
  }
})
