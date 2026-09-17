#!/usr/bin/env node
/**
 * ONE CALLER FOR INVITATION REDEMPTION.
 *
 * `redeem_invitation` refuses by returning, not by raising (D-S5-AUTO-2), because a raised exception
 * rolled back the attempt record and silently defeated the rate limits and the probe events.
 *
 * That makes the caller contract security-critical in a way that does not look dangerous at the call
 * site: the RPC call SUCCEEDS on a refusal, so a caller that ignores the result, or treats an
 * unrecognised outcome as success, grants a membership or a role the database refused.
 *
 * Rather than trying to prove that property about arbitrary call sites, there is one chokepoint --
 * lib/invitations/redeem.ts -- and this fails the build if anything else names the RPC.
 *
 * Structure, not behaviour. Behaviour is proved by supabase/tests/invitation_authority_matrix.sql.
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = process.cwd()
const CHOKEPOINT = "lib/invitations/redeem.ts"
const SEARCH_ROOTS = ["app", "lib", "components"]
const failures = []

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) out.push(full)
  }
  return out
}

const files = SEARCH_ROOTS.flatMap((r) => walk(join(ROOT, r)))

for (const file of files) {
  const rel = relative(ROOT, file)
  const source = readFileSync(file, "utf8")
  if (!source.includes("redeem_invitation")) continue
  if (rel === CHOKEPOINT) continue
  failures.push(
    `${rel} names redeem_invitation directly. Import redeemInvitation from ${CHOKEPOINT} instead: ` +
      `redemption refuses by returning, so a direct caller that ignores the outcome grants authority ` +
      `the database refused.`,
  )
}

const chokepoint = (() => {
  try {
    return readFileSync(join(ROOT, CHOKEPOINT), "utf8")
  } catch {
    failures.push(`${CHOKEPOINT} is missing -- the single redemption caller must exist.`)
    return ""
  }
})()

if (chokepoint) {
  if (!chokepoint.includes("SUCCESSFUL_REDEMPTION_OUTCOMES")) {
    failures.push(`${CHOKEPOINT}: the recognised success outcomes must be named explicitly.`)
  }
  // The fail-closed default is the point: anything not recognised must not be treated as success.
  if (!/ok:\s*false/.test(chokepoint)) {
    failures.push(`${CHOKEPOINT}: there must be a fail-closed return for an unrecognised outcome.`)
  }
  if (!chokepoint.includes("GENERIC_REFUSAL")) {
    failures.push(`${CHOKEPOINT}: refusals must share one generic message, or they become an enumeration oracle.`)
  }
  // The specific mistake this whole file exists to prevent.
  const successList = chokepoint.match(/SUCCESSFUL_REDEMPTION_OUTCOMES\s*=\s*\[([\s\S]*?)\]/)
  if (successList && /REFUSED/.test(successList[1])) {
    failures.push(`${CHOKEPOINT}: REFUSED is listed as a successful outcome. That is the failure this contract exists to prevent.`)
  }
  if (successList && !/MEMBERSHIP_ACTIVE/.test(successList[1])) {
    failures.push(`${CHOKEPOINT}: the success list no longer recognises MEMBERSHIP_ACTIVE, so real redemptions would fail closed.`)
  }
}

const callers = files.filter((f) => {
  const rel = relative(ROOT, f)
  return rel !== CHOKEPOINT && readFileSync(f, "utf8").includes("redeemInvitation")
})

if (failures.length > 0) {
  console.error("verify-redemption-callers: FAIL")
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}

console.log(
  `  ok    redemption_callers                 1 chokepoint, ${callers.length} consumer(s), fail-closed on any unrecognised outcome`,
)
