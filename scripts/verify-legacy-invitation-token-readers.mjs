#!/usr/bin/env node
/**
 * WHO MAY READ A LEGACY INVITATION TOKEN.
 *
 * Six legacy tables still store their invitation token in plaintext. Slice 5 cleared the token from
 * every terminal and expired row, but the READ surface has to stay until the application moves to the
 * canonical issuer: three server actions insert a legacy invitation and read the token straight back
 * to build the emailed link, and removing the grant breaks invitation sending (D-S5-AUTO-6).
 *
 * A temporary surface that nobody is watching becomes a permanent one. This pins exactly which
 * modules may read a legacy token, so the exposure cannot spread while it waits to be retired, and so
 * that the list shrinking to zero is a visible event rather than something nobody notices.
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

/** Each entry is a module that legitimately needs a legacy token today, and why. */
const ALLOWED = new Map([
  ["app/(app)/people/actions.ts", "Club staff invitation: reads the token back to build the emailed link."],
  ["app/(app)/admin/site-admins/actions.ts", "Site Admin invitation: same, for the site-admin link."],
  ["app/(app)/parent/children/actions.ts", "Player account invitation: same, for the guardian's link."],
])

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
      `${rel} reads a legacy invitation token. That surface is retiring: move this to the canonical ` +
        `issuer (public.issue_invitation), or add it to the allow-list in this script with a reason.`,
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
  `  ok    legacy_invitation_token_readers    ${found.size} module(s) may read a plaintext legacy token, all allow-listed`,
)
