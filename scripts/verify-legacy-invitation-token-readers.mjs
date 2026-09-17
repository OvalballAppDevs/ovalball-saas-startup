#!/usr/bin/env node
/**
 * WHO MAY READ A LEGACY INVITATION TOKEN.
 *
 * Six legacy tables still store their invitation token in plaintext. Slice 5 cleared the token from
 * every terminal and expired row, and the READ surface had to stay while three server actions still
 * inserted a legacy invitation and read the token straight back to build the emailed link -- removing
 * the grant then would have broken invitation sending (D-S5-AUTO-6).
 *
 * THE LIST IS NOW EMPTY. All three moved to the canonical issuer, so nothing in the application reads
 * a plaintext legacy token any more, and the column grant itself has been revoked. What this script
 * guards has therefore changed from "only these three" to "none at all": a new reader is now a
 * regression rather than a known cost, and the failure message says so.
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = process.cwd()
const LEGACY_TABLES = [
  "invitations",
  "guardian_invitations",
  "player_account_invitations",
  "site_admin_invitations",
  "club_safeguarding_officer_invitations",
  "club_ovalball_invitations",
]

/**
 * Empty, and meant to stay empty. It is kept rather than deleted because an allow-list that exists
 * and is empty is a much clearer statement than a check with no list at all -- and because if some
 * future migration genuinely needs a legacy token for a while, this is where that debt gets written
 * down with a reason and a name on it.
 */
const ALLOWED = new Map([])

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
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const failures = []
const found = new Set()

for (const file of walk(join(ROOT, "app")).concat(walk(join(ROOT, "lib")), walk(join(ROOT, "components")))) {
  const rel = relative(ROOT, file)
  const source = readFileSync(file, "utf8")
  const touchesLegacy = LEGACY_TABLES.some((t) => source.includes(`"${t}"`) || source.includes(`'${t}'`))
  if (!touchesLegacy) continue
  // Reading the column, by select list or by property access on the returned row.
  const readsToken = /\.select\([^)]*\btoken\b[^)]*\)/.test(source) || /\binvitation\??\.token\b/.test(source)
  if (!readsToken) continue
  found.add(rel)
  if (!ALLOWED.has(rel)) {
    failures.push(
      `${rel} reads a legacy invitation token. Nothing does that any more -- the six legacy tables ` +
        `store their secret in plaintext, and the column grant has been revoked, so this cannot work ` +
        `at runtime either. Use the canonical issuer, public.issue_invitation.`,
    )
  }
}

for (const [rel] of ALLOWED) {
  if (!found.has(rel)) {
    failures.push(
      `${rel} is allow-listed as a legacy token reader but no longer reads one. Remove it from the ` +
        `list -- the point of the list is that it shrinks.`,
    )
  }
}

if (failures.length > 0) {
  console.error("verify-legacy-invitation-token-readers: FAIL")
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}

console.log(
  found.size === 0
    ? "  ok    legacy_invitation_token_readers    nothing reads a plaintext legacy invitation token"
    : `  ok    legacy_invitation_token_readers    ${found.size} module(s) may read one, all allow-listed`,
)
