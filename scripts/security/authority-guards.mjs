/**
 * Phase 2 AA.5 server-action standard, checked structurally (Identity/Auth Slice 4).
 *
 *   roleLiteralViolations()  authority is a capability question answered by the database, so authority helper
 *                            literals (CLUB_ADMIN, team_admin, isSiteAdmin, siteAdminRole ===) may not appear
 *                            outside lib/auth/**. Existing uses are a shrink list: a file may only lose them,
 *                            and a file not on the list may not gain one. The list reaches zero at Slice 10.
 *
 *   migratedDomainUiViolations()  once a Slice 4 domain has moved (AA.3: "... server actions + UI capability reads"),
 *                            its interface files carry no legacy authority at all -- not even presentation: no role
 *                            literal, no Site Admin flag, and no session guardian list (the session context's
 *                            guardianRelationships, a team-place product, not the family decision). Resolving
 *                            WHICH club a page is about from the session is not authority and stays. They read
 *                            canonical capability answers, the same ones their server actions refuse with. Not a
 *                            shrink list: zero, per migrated domain.
 *
 *   clientTableWriteViolations()  a browser-session client writes a table only where the perimeter manifest
 *                            lists that write for the authenticated role. Everything else goes through an RPC.
 *                            Writes made through the service-role client are server-only and are governed by
 *                            the service-role module list, not by this check.
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

export const ROOT = path.resolve(import.meta.dirname, "..", "..")
const SOURCE_DIRS = ["app", "lib", "components"]

function sourceFiles() {
  const out = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue
      const full = path.join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else if (/\.(ts|tsx|mts|mjs|js)$/.test(name)) out.push(path.relative(ROOT, full).split(path.sep).join("/"))
    }
  }
  for (const d of SOURCE_DIRS) walk(path.join(ROOT, d))
  return out.sort()
}

const ROLE_LITERAL = /\bCLUB_ADMIN\b|\bteam_admin\b|\bisSiteAdmin\b|siteAdminRole\s*===/g

export function roleLiteralCounts() {
  const counts = {}
  for (const file of sourceFiles()) {
    if (file.startsWith("lib/auth/")) continue
    const n = (readFileSync(path.join(ROOT, file), "utf8").match(ROLE_LITERAL) ?? []).length
    if (n > 0) counts[file] = n
  }
  return counts
}

export function roleLiteralViolations() {
  const baseline = JSON.parse(readFileSync(path.join(ROOT, "supabase/security/role-literal-baseline.json"), "utf8")).files
  const actual = roleLiteralCounts()
  const problems = []
  for (const [file, n] of Object.entries(actual)) {
    const allowed = baseline[file] ?? 0
    if (n > allowed) problems.push(`${file}: ${n} authority role literal(s), shrink list allows ${allowed}`)
  }
  const shrunk = Object.entries(baseline).filter(([file, n]) => (actual[file] ?? 0) < n).map(([file, n]) => `${file}: ${actual[file] ?? 0} (list ${n})`)
  return { problems, shrunk }
}

const WRITE_CHAIN = /(\b[A-Za-z_$][\w$]*)\s*\.from\(\s*["'`]([a-z_]+)["'`]\s*\)\s*\.(insert|update|upsert|delete)\s*\(/g

function serviceClientNames(source) {
  const names = new Set()
  for (const m of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:await\s+)?createServiceRoleClient\s*\(/g)) names.add(m[1])
  return names
}

export function clientTableWrites() {
  const writes = []
  for (const file of sourceFiles()) {
    const source = readFileSync(path.join(ROOT, file), "utf8")
    if (!source.includes(".from(")) continue
    const service = serviceClientNames(source)
    for (const m of source.matchAll(WRITE_CHAIN)) {
      const [, receiver, table, op] = m
      if (service.has(receiver)) continue
      const line = source.slice(0, m.index).split("\n").length
      writes.push({ file, line, table, op })
    }
  }
  return writes
}

export function clientTableWriteViolations() {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, "supabase/security/perimeter-manifest.json"), "utf8"))
  const granted = (table, op) => {
    const entry = manifest.tables?.[table]?.authenticated
    const value = entry?.[op]
    return value !== undefined && value !== null && value !== "none"
  }
  const problems = []
  for (const w of clientTableWrites()) {
    const ops = w.op === "upsert" ? ["insert", "update"] : [w.op]
    const missing = ops.filter((op) => !granted(w.table, op))
    if (missing.length) problems.push(`${w.file}:${w.line} writes ${w.table} (${w.op}) but the manifest grants no authenticated ${missing.join("/")}`)
  }
  return problems
}

// Slice 4 domains whose interface has moved to canonical capability reads (AA.3). A later sub-slice adds its own
// entry when it lands. Paths are prefixes of repository-relative source paths.
export const MIGRATED_DOMAIN_UI = {
  "4a family and players": [
    "app/(app)/parent/children/",
    "app/(app)/parent/players/[playerId]/access/",
    "app/(app)/parent/players/[playerId]/details/",
    "app/(app)/guardian-requests/",
    "app/(app)/club/settings/guardians/",
    "app/(app)/admin/users/[userId]/family-actions.ts",
    "app/(app)/admin/users/[userId]/family-relationships-panel.tsx",
    "lib/players/",
  ],
}

const LEGACY_UI_AUTHORITY = /\bCLUB_ADMIN\b|\bteam_admin\b|\bisSiteAdmin\b|\bsiteAdminRole\b|\bguardianRelationships\b|\bhasGuardianRelationship\b|\bisClubAdmin\b/g

function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
}

export function migratedDomainUiFiles() {
  const out = {}
  const files = sourceFiles()
  for (const [domain, prefixes] of Object.entries(MIGRATED_DOMAIN_UI)) {
    out[domain] = files.filter((file) => prefixes.some((prefix) => file === prefix || file.startsWith(prefix)))
  }
  return out
}

/** The legacy authority tokens in a piece of source, comments excluded. */
export function legacyUiAuthorityHits(source) {
  return [...new Set(withoutComments(source).match(LEGACY_UI_AUTHORITY) ?? [])]
}

export function migratedDomainUiViolations() {
  const problems = []
  for (const [domain, files] of Object.entries(migratedDomainUiFiles())) {
    for (const file of files) {
      const hits = legacyUiAuthorityHits(readFileSync(path.join(ROOT, file), "utf8"))
      if (hits.length) problems.push(`${file} (${domain}): legacy authority in a migrated interface: ${hits.join(", ")}`)
    }
  }
  return problems
}
