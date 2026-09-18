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
  // session-decision.ts, not require-session.ts: the refusal destinations moved there when the pure
  // decision was split out so it could be unit-tested. The full runner caught this the moment the
  // split landed, which is the entire argument for wiring these gates into it rather than running
  // them by hand.
  const src = readFileSync("lib/auth/session-decision.ts", "utf8")
  const destinations = [...src.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1])
  assert.ok(destinations.length >= 4, "every refusal reason must name a destination")
  for (const d of destinations) {
    assert.ok(
      !d.startsWith("/dashboard") && !d.startsWith("/account/security"),
      `${d} is inside the (app) group, so refusing to it would re-enter the layout that refused`,
    )
  }
})

// ---------------------------------------------------------------------------
// ROUTE HANDLERS. A route handler is the purest form of the direct-invocation
// problem: it is a URL. Nothing renders first, no layout runs, and anybody can
// curl it. The two GoCardless OAuth handlers previously carried getUser() and
// nothing else, which answers only "is somebody signed in" -- not whether the
// session is live or the account still usable.
// ---------------------------------------------------------------------------

/** Handlers that act for a signed-in person and therefore need the full boundary. */
const PROTECTED_HANDLERS = [
  "app/api/gocardless/oauth/start/route.ts",
  "app/api/gocardless/oauth/callback/route.ts",
]

/**
 * Handlers that must work with NO Ovalball session, each for a stated reason. This is an explicit
 * list, not a pattern: a generic escape hatch would let the next unguarded handler hide inside it.
 */
const PRE_SESSION_HANDLERS: Record<string, string> = {
  "app/auth/callback/route.ts":
    "it is the endpoint that CREATES the session; requiring one would be circular",
  "app/api/gocardless/webhooks/route.ts":
    "authenticated by HMAC signature from GoCardless; no browser and no session exist",
  "app/api/platform-billing/webhooks/route.ts":
    "same, for Ovalball's own billing events",
  "app/email-assets/[asset]/route.ts":
    "fetched by mail clients with no cookies; serves brand assets only",
  "app/email-assets/club-crest/[clubId]/route.ts": "same, a club crest",
  "app/email-assets/directory-crest/[directoryId]/route.ts": "same, a directory crest",
}

test("S6-9 every protected route handler carries the session boundary itself", () => {
  const missing = PROTECTED_HANDLERS.filter((f) => !/requireSession\s*\(/.test(code(f)))
  assert.deepEqual(missing, [], "a route handler is a URL; it cannot rely on a layout having run")
})

test("S6-9 the pre-session handler exceptions are exactly the declared ones", () => {
  const handlers = walk("app").filter((f) => f.endsWith("/route.ts"))
  const unaccounted = handlers.filter(
    (f) => !PROTECTED_HANDLERS.includes(f) && !(f in PRE_SESSION_HANDLERS),
  )
  assert.deepEqual(
    unaccounted,
    [],
    "a new route handler must be classified: protected (and gated) or pre-session (and justified)",
  )
})

test("S6-9 protected handlers do not merely check identity and stop there", () => {
  for (const f of PROTECTED_HANDLERS) {
    const src = code(f)
    assert.doesNotMatch(
      src,
      /data:\s*\{\s*user\s*\}[\s\S]{0,140}getUser\(\)[\s\S]{0,140}if \(!user\)/,
      `${f}: the bare getUser-or-redirect guard answers only "is somebody signed in"`,
    )
  }
})

// ---------------------------------------------------------------------------
// RAW DATABASE ERRORS. Found twice in this slice -- cancelRecovery returned
// error.message to the browser, and the GoCardless callback interpolated one
// into a URL query parameter, which publishes it to the address bar, browser
// history and any referrer. A Postgres exception names internal functions and
// columns and a person cannot act on it.
// ---------------------------------------------------------------------------

const AUTH_SURFACES = [
  "app/(app)/account/security/recovery-actions.ts",
  "app/(app)/account/security/actions.ts",
  "app/account/reset-password/actions.ts",
  "app/forgot-password/actions.ts",
  "app/login/actions.ts",
  "app/auth/oauth-actions.ts",
  "app/api/gocardless/oauth/callback/route.ts",
]

test("S6-9 no auth surface hands a raw database message back to the browser", () => {
  const offenders: string[] = []
  for (const f of AUTH_SURFACES) {
    // NOT `code(f)` here: this guard needs the comments, because the one legitimate exception is
    // declared in one. Not every `error.message` is a leak -- a GoTrue refusal ("Password should be
    // at least 12 characters") names nothing internal and is exactly what the person must read,
    // whereas a Postgres exception names functions and columns and helps only an attacker.
    // The difference cannot be inferred from the expression, so it is declared: a PROVIDER_MESSAGE
    // marker within the preceding few lines, or a `code === "42501"` branch for an RPC's own
    // deliberate authorisation message. Everything else must be logged and normalised.
    const raw = readFileSync(f, "utf8").split("\n")
    raw.forEach((line, i) => {
      if (!/error\.message/.test(line)) return
      // A comment explaining the rule is not a breach of it. This guard reads the file raw because
      // it must see the PROVIDER_MESSAGE marker, so it has to skip prose itself.
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
      if (/console\.(error|warn|log)/.test(line)) return
      const preceding = raw.slice(Math.max(0, i - 5), i).join("\n")
      if (/PROVIDER_MESSAGE/.test(preceding)) return
      if (/code === "42501"/.test(line) || /code === "42501"/.test(preceding)) return
      offenders.push(`${f}:${i + 1}: ${line.trim().slice(0, 80)}`)
    })
  }
  assert.deepEqual(
    offenders,
    [],
    "log the detail server-side and return something a person can act on, or declare why the " +
      "provider's own message is safe with a PROVIDER_MESSAGE comment",
  )
})
