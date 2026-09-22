#!/usr/bin/env node
/**
 * EVERY POST-AUTHENTICATION REDIRECT TARGET GOES THROUGH ONE VALIDATOR.
 *
 * `lib/auth/safe-next.ts` is that validator, and its own header says why this script exists:
 *
 *   "two copies of an open-redirect guard is exactly how one of them drifts. Both now call this."
 *
 * There were three consumers, not two. `app/security/verify/verify-flow.tsx` read `next` straight off
 * the query string into `window.location.assign`, so a person who had just passed their second factor
 * could be sent to another origin. Slice 5 had already fixed the identical hole on the password path.
 *
 * A comment cannot stop a fourth consumer appearing. This can.
 *
 * THE RULE: if a file reads a redirect target out of a URL -- a `next`, a `redirect`, a `returnTo`,
 * a `continue` -- and hands it to a navigation sink, it must import `safeNextPath`. Reading one and
 * only ever comparing or displaying it is fine; navigating to it is not.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = process.cwd()
const SEARCH_DIRS = ["app", "lib", "components"]

/** The names a redirect target travels under in this codebase, plus the obvious neighbours. */
const TARGET_PARAM = /\b(?:searchParams|params|query|url\.searchParams|qs)\s*(?:\.get\(\s*|\[\s*)['"`](next|redirect|redirectTo|returnTo|return_to|continue|callbackUrl)['"`]/
/** Where a value becomes navigation. `redirect()` is Next's server redirect; the others are the DOM. */
const NAVIGATION_SINK = /\b(?:window\.location\.(?:assign|replace|href\s*=)|location\.(?:assign|replace)|redirect\s*\(|router\.(?:push|replace)\s*\()/

const VALIDATOR = "safeNextPath"

/**
 * Files allowed to name a redirect target without the validator, each for a stated reason.
 * This list may shrink. It may not grow without a reason written beside the entry.
 */
const ALLOWED = new Map([
  [
    "lib/auth/safe-next.ts",
    "is the validator",
  ],
  [
    "app/legal/cookies/page.tsx",
    "names the cookie in prose for the cookie policy; navigates nowhere",
  ],
])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|mts)$/.test(entry)) out.push(full)
  }
  return out
}

const offenders = []
let inspected = 0
let guarded = 0

for (const dir of SEARCH_DIRS) {
  let files
  try {
    files = walk(join(ROOT, dir))
  } catch {
    continue
  }
  for (const file of files) {
    const rel = relative(ROOT, file)
    if (ALLOWED.has(rel)) continue

    // Strip comments before matching: this script's own subject matter appears in prose all over the
    // entrance surfaces, and a guard that matches commentary reports its own documentation.
    const raw = readFileSync(file, "utf8")
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")

    if (!TARGET_PARAM.test(source)) continue
    inspected += 1
    if (!NAVIGATION_SINK.test(source)) continue
    if (source.includes(VALIDATOR)) {
      guarded += 1
      continue
    }
    const line = source.split("\n").findIndex((l) => TARGET_PARAM.test(l)) + 1
    offenders.push(`${rel}:${line}`)
  }
}

if (offenders.length > 0) {
  console.error(
    `FAIL  redirect_targets  ${offenders.length} file(s) navigate to a redirect target read from a URL without ${VALIDATOR}:`,
  )
  for (const o of offenders) console.error(`          ${o}`)
  console.error(`          Import { ${VALIDATOR} } from "@/lib/auth/safe-next" and pass the value through it.`)
  process.exit(1)
}

// A zero here would mean the patterns stopped matching the codebase rather than that the codebase is
// clean, which is the way a guard like this dies quietly.
if (guarded === 0) {
  console.error(
    `FAIL  redirect_targets  found ${inspected} file(s) naming a redirect target but none passing through ${VALIDATOR} -- the guard has stopped recognising this codebase`,
  )
  process.exit(1)
}

console.log(`  ok    redirect_targets                   ${guarded} navigating consumer(s), all through ${VALIDATOR}`)
