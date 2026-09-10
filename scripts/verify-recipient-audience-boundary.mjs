#!/usr/bin/env node
/**
 * RECIPIENT + AUDIENCE ENGINE STRUCTURAL GUARD.
 *
 * Deterministic, grep-based -- like verify-email-wiring.mjs, this has no
 * opinion about anybody's English, it checks a small number of specific,
 * dangerous shapes:
 *
 *   1. No direct "select player email" shortcut anywhere in application code.
 *      A playing-group audience must always go through the safeguarding-aware
 *      resolver; a raw players.email read is exactly the bug this engine
 *      exists to make impossible.
 *
 *   2. The guardian/self age-and-consent PREDICATE
 *      (player_effective_age(...) >= 18, guardian_permission_effective(...))
 *      exists in exactly the files that are allowed to define it. A third
 *      copy appearing anywhere else is the "three subtly different
 *      safeguarding implementations" failure this engine's own design
 *      document was written to prevent.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { execSync } from "node:child_process"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const problems = []

// ---------------------------------------------------------------------------
// 1. No direct player-email shortcut.
// ---------------------------------------------------------------------------
const emailShortcutGrep = execSync(
  `grep -rniE "from\\('players'\\)[^;]*select[^;]*email|players\\.email" app lib supabase/migrations 2>/dev/null || true`,
  { cwd: root, encoding: "utf8" }
)
for (const line of emailShortcutGrep.split("\n").filter(Boolean)) {
  // A comment line -- SQL "--" or a JS/TS "//" -- discussing the prohibited
  // shape (as this very engine's own migration and docs do) is not the
  // shape itself. Only a line with no comment marker before the match is
  // real code.
  const [, content = ""] = line.split(/:(.*)/s)
  const codePart = content.split(/--|\/\//)[0]
  if (/players\.email|from\('players'\)/i.test(codePart)) {
    problems.push(`Direct player-email shortcut found: ${line.trim().slice(0, 160)}`)
  }
}

// ---------------------------------------------------------------------------
// 2. The guardian/self age-and-consent predicate exists only where declared.
// ---------------------------------------------------------------------------
const ALLOWED_PREDICATE_FILES = new Set([
  "supabase/migrations/20261103000000_fixture_communications.sql",
  "supabase/migrations/20270126000000_recipient_audience_engine.sql",
])
const predicateGrep = execSync(
  `grep -rl "player_effective_age" supabase/migrations 2>/dev/null || true`,
  { cwd: root, encoding: "utf8" }
)
for (const file of predicateGrep.split("\n").filter(Boolean)) {
  const source = readFileSync(join(root, file), "utf8")
  // Only flag a file that pairs player_effective_age with an explicit >= 18
  // eligibility check -- the function's OWN definition (internal.player_
  // effective_age's create statement) legitimately mentions itself once and
  // is not a second implementation of the audience rule.
  if (/player_effective_age\([^)]*\)\s*>=\s*18/.test(source) && !ALLOWED_PREDICATE_FILES.has(file)) {
    problems.push(
      `"${file}" declares its own copy of the 18+/consent eligibility predicate. Reuse internal.player_notification_recipients (or the canonical functions it calls) instead of a second implementation.`
    )
  }
}

if (problems.length > 0) {
  console.error("FAIL  recipient/audience boundary")
  for (const problem of problems) console.error(`        ${problem}`)
  process.exit(1)
}

console.log("ok    recipient_audience_boundary        no player-email shortcut, one eligibility predicate")
