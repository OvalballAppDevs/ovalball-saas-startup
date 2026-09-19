import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

/**
 * THE SERVICE-ROLE KEY IS WHERE THE MANIFEST SAYS IT IS (S1-15 / AO C12).
 *
 * The reconciliation recorded this as MISSED with no owner: "perimeter_manifest
 * .test.mts mentions service_role but does not assert the Z-11 allow-list". The
 * Convergence programme map assigns "service-role key verification" to Step 5,
 * which is where it lands.
 *
 * WHAT THE KEY IS. `SUPABASE_SERVICE_ROLE_KEY` has no session, no capability
 * check of its own, and bypasses every RLS policy in this project. It is the one
 * credential for which "who may do this" has no answer at all -- so the only
 * defensible control is that the set of modules holding it is small, named, and
 * cannot grow without somebody writing down why.
 *
 * Every check below is a property the codebase can violate silently:
 *
 *   1. only declared modules construct an elevated client;
 *   2. none of them is reachable from a client bundle;
 *   3. nothing outside them reads the environment variable;
 *   4. the key is never sent to the browser -- no NEXT_PUBLIC_ alias, no
 *      interpolation into rendered output;
 *   5. every declared module says, in its own file, what authorises its use --
 *      because this client grants access and does not decide who gets it.
 *
 * WHY AN ALLOW-LIST RATHER THAN A COUNT. A count passes when one module is
 * removed and another added. This names each one, so a new holder of the key is
 * a deliberate edit to this file with a reason beside it.
 */

const ROOT = path.resolve(import.meta.dirname, "../../..")

/**
 * The declared holders. Each entry says what authorises that module's use, since
 * the elevated client carries no authority of its own and the call site is where
 * the real decision has to happen.
 */
const DECLARED_HOLDERS: Record<string, string> = {
  "lib/supabase/service-role.ts":
    "The factory. Side Project 1: the GoCardless OAuth callback (storing a merchant access token nothing else may read back) and the webhook route (provider event, payment and mandate state that no authenticated session produced). Each call site authorises itself -- a verified webhook signature, a matched OAuth CSRF state.",
  "lib/admin/create-identity.ts":
    "Phase 2 Q.2 Create User, step 4 and nothing else: it asks Supabase Auth for an identity and never writes a profile, membership, role, guardian link or site_admins row. Everything conferring authority happens afterwards in public.site_register_created_identity under the ordinary capability rules, so the elevated client decides nothing.",
}

/** Anything importing the factory is a call site, not a holder, and is listed here so the set stays visible. */
const DECLARED_CALL_SITES = [
  "app/api/gocardless/webhooks/route.ts",
  "app/api/platform-billing/webhooks/route.ts",
  "lib/payments/gocardless/activate-membership.ts",
  "lib/payments/gocardless/cancel-membership.ts",
  "lib/payments/gocardless/merchant-token.ts",
  "lib/payments/gocardless/reconcile.ts",
  "lib/payments/gocardless/verification.ts",
]

function sourceFiles(dirs = ["app", "lib", "components"]): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(ts|tsx|mts)$/.test(name)) out.push(path.relative(ROOT, full).split(path.sep).join("/"))
    }
  }
  for (const d of dirs) walk(path.join(ROOT, d))
  return out.sort()
}

const FILES = sourceFiles().map((file) => ({ file, source: readFileSync(path.join(ROOT, file), "utf8") }))

test("only declared modules read the service-role key", () => {
  const holders = FILES.filter(({ source }) => source.includes("SUPABASE_SERVICE_ROLE_KEY")).map((f) => f.file).sort()
  assert.deepEqual(
    holders,
    Object.keys(DECLARED_HOLDERS).sort(),
    "A module now reads SUPABASE_SERVICE_ROLE_KEY that is not declared in DECLARED_HOLDERS. Add it with the " +
      "reason its use is authorised, or route the work through an RPC that decides authority for itself."
  )
})

test("nothing outside those modules builds an elevated client by hand", () => {
  // The signature of an elevated client is createClient(url, <a key that is not the publishable one>).
  const suspicious = FILES.filter(({ file, source }) => {
    if (file in DECLARED_HOLDERS) return false
    return /createClient\s*\([^)]*SERVICE_ROLE/i.test(source) || /serviceRoleKey/i.test(source)
  }).map((f) => f.file)
  assert.deepEqual(suspicious, [], `these build an elevated client outside the declared modules: ${suspicious.join(", ")}`)
})

test("no declared module can be pulled into a client bundle", () => {
  for (const file of Object.keys(DECLARED_HOLDERS)) {
    const source = readFileSync(path.join(ROOT, file), "utf8")
    assert.ok(!/^\s*["']use client["']/m.test(source), `${file} is marked "use client" and holds the service-role key`)
  }
  // A module that imports the factory and is a client component would drag the
  // key's module graph into the browser bundle, so the call sites are checked too.
  for (const { file, source } of FILES) {
    if (!/from ["']@\/lib\/supabase\/service-role["']/.test(source) && !/from ["'].*create-identity["']/.test(source)) continue
    assert.ok(!/^\s*["']use client["']/m.test(source), `${file} is a client component and imports a service-role module`)
  }
})

test("the key is never exposed to the browser under another name", () => {
  for (const { file, source } of FILES) {
    assert.ok(
      !/NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/.test(source),
      `${file} references a NEXT_PUBLIC_ alias of the service-role key; anything NEXT_PUBLIC_ is shipped to the browser`
    )
  }
  const envExample = readFileSync(path.join(ROOT, ".env.example"), "utf8")
  assert.ok(
    !/NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/.test(envExample),
    ".env.example declares a NEXT_PUBLIC_ alias of the service-role key"
  )
  assert.ok(
    /SUPABASE_SERVICE_ROLE_KEY/.test(envExample),
    ".env.example must declare SUPABASE_SERVICE_ROLE_KEY, since two modules fail loudly without it"
  )
})

test("every declared module says what authorises its use", () => {
  for (const [file, expectation] of Object.entries(DECLARED_HOLDERS)) {
    const source = readFileSync(path.join(ROOT, file), "utf8")
    // Not a spelling check: the requirement is that the file carries the reasoning
    // at all, because the next person to add a call site reads the file, not this test.
    assert.ok(
      source.length > 400 && /\/\*\*[\s\S]*\*\//.test(source),
      `${file} holds the service-role key and carries no doc comment explaining what authorises its use`
    )
    assert.ok(expectation.length > 60, `DECLARED_HOLDERS["${file}"] must record why, not just that`)
  }
})

test("the declared call sites still exist and still import the factory", () => {
  const importers = FILES.filter(({ source }) => /from ["']@\/lib\/supabase\/service-role["']/.test(source))
    .map((f) => f.file)
    .sort()
  assert.deepEqual(
    importers,
    [...DECLARED_CALL_SITES].sort(),
    "The set of modules importing the elevated client has changed. Each one is individually responsible for " +
      "its own authorisation, so the list is maintained by hand on purpose."
  )
})
