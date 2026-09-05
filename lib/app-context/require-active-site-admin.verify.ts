import { isActiveSiteAdminContext } from "./site-admin-context-rule"

/**
 * Run with `npx tsx lib/app-context/require-active-site-admin.verify.ts`.
 * Permanent regression coverage for the Site Admin route-family guard
 * addendum -- "an account can genuinely hold Site Admin authority while
 * its ACTIVE context is something else entirely, and every /admin/*
 * route must respect that" (the exact bug reproduced live against
 * test.burnley.admin, a real Site Admin who is also Burnley's Club
 * Admin). isActiveSiteAdminContext() is deliberately dependency-free (no
 * "server-only", no cookies(), no Supabase client) precisely so this file
 * can run standalone -- active-context.ts's real resolveActiveContext()
 * carries a "server-only" import and cannot be loaded outside Next's own
 * build, so the scenarios below hand-construct the exact SwitchableContext
 * shapes resolveActiveContext() is documented to produce for each case
 * (see that file's own doc comments), rather than re-deriving them.
 */

let pass = 0
let fail = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : ` -- got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`)
  if (ok) pass++
  else fail++
}

const siteAdminAccount = { isSiteAdmin: true }
const noSiteAdminAccount = { isSiteAdmin: false }

check(
  "Real Site Admin authority + active context = site_admin -> route allowed",
  isActiveSiteAdminContext(siteAdminAccount, { kind: "site_admin" }),
  true
)

check(
  "Real Site Admin authority + active context = club (the exact reported bug: test.burnley.admin viewing Burnley) -> DENIED despite real authority",
  isActiveSiteAdminContext(siteAdminAccount, { kind: "club" }),
  false
)

check("Real Site Admin authority + active context = team -> denied", isActiveSiteAdminContext(siteAdminAccount, { kind: "team" }), false)
check("Real Site Admin authority + active context = parent -> denied", isActiveSiteAdminContext(siteAdminAccount, { kind: "parent" }), false)
check("Real Site Admin authority + active context = player -> denied", isActiveSiteAdminContext(siteAdminAccount, { kind: "player" }), false)

check(
  "NO real Site Admin authority + active context = site_admin (a resolver that somehow still produced this, or a stale/corrupt SessionContext) -> STILL denied, never escalates",
  isActiveSiteAdminContext(noSiteAdminAccount, { kind: "site_admin" }),
  false
)

check("NO real Site Admin authority + active context = club -> denied (ordinary case)", isActiveSiteAdminContext(noSiteAdminAccount, { kind: "club" }), false)

console.log(`\n${pass} PASS, ${fail} FAIL`)
if (fail > 0) process.exit(1)
