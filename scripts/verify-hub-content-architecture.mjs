#!/usr/bin/env node
/**
 * RUGBY HUB GENERAL-KNOWLEDGE ARCHITECTURE GUARD (audit-as-code)
 *
 * Pins the invariants this migration set establishes, the same way
 * verify-email-delivery-policy.mjs pins email's own architecture:
 *
 *   1. Training Centre owns operational sessions; Rugby Hub owns knowledge
 *      ABOUT training. training_sessions must never grow a Hub-content-
 *      shaped column (title/body/summary/content_key), and no migration may
 *      insert scheduled session rows into any hub_* table.
 *   2. hub_content_items must carry the regulatory-escape-hatch CHECK
 *      constraint -- a general article must never be able to assert
 *      regulatory-sounding claims in prose and bypass regulatory_*'s
 *      provenance/conflict/publication controls.
 *   3. One applicability architecture: hub_content_applicability is the
 *      only general-knowledge applicability table, resolved via real FKs,
 *      never a second ad hoc (type, uuid) polymorphic table.
 *   4. Published-only default: every hub_* table with a `status` column
 *      must carry a public-read RLS policy scoped to status = 'PUBLISHED'.
 *   5. No role-branched Rugby Hub implementation (mirrors verify-match-
 *      centre-shared.mjs's own check) -- no parent/player/staff-specific
 *      copy of any hub_* consumer file.
 */
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(join(root, p), "utf8")
const problems = []

function findFiles(dir, exts, matches = []) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const rel = join(dir, entry.name)
    if (entry.isDirectory()) findFiles(rel, exts, matches)
    else if (exts.some((e) => entry.name.endsWith(e))) matches.push(rel)
  }
  return matches
}

const migrationFiles = findFiles("supabase/migrations", [".sql"])
const migrationSources = migrationFiles.map((f) => ({ file: f, source: read(f) }))

// ---------------------------------------------------------------------
// 1. Training Centre vs Training Knowledge boundary.
// ---------------------------------------------------------------------
for (const { file, source } of migrationSources) {
  const alterTrainingSessions = /alter table (public\.)?training_sessions\s+add column\s+(if not exists\s+)?(title|body|summary|content_key)\b/i
  const m = source.match(alterTrainingSessions)
  if (m) {
    problems.push(`${file} adds a Hub-content-shaped column ("${m[3]}") to training_sessions -- Training Centre owns operational sessions, never knowledge content. Link to a hub_content_items row instead.`)
  }
  const insertIntoHub = /insert into public\.hub_(content_items|positions|skills|glossary_terms)[\s\S]{0,300}training_session/i
  if (insertIntoHub.test(source)) {
    problems.push(`${file} appears to insert a training-session-derived row into a hub_* table -- Rugby Hub content must never be generated from, or represent, an operational scheduled session.`)
  }
}

// ---------------------------------------------------------------------
// 2. The regulatory escape-hatch CHECK must exist and stay attached to
//    hub_content_items (checked against the LATEST migration that
//    (re)defines the table, since a superseded earlier definition kept
//    for history must not trip this).
// ---------------------------------------------------------------------
let hubContentItemsDef = null
let hubContentItemsFile = null
for (const { file, source } of migrationSources) {
  const marker = "create table public.hub_content_items"
  const at = source.indexOf(marker)
  if (at === -1) continue
  const end = source.indexOf(");", at)
  hubContentItemsDef = source.slice(at, end === -1 ? undefined : end + 2)
  hubContentItemsFile = file
}
if (!hubContentItemsDef) {
  problems.push("No migration defines public.hub_content_items -- the general-knowledge content table does not exist.")
} else if (!/hub_content_items_no_regulatory_escape_hatch/.test(hubContentItemsDef)) {
  problems.push(`${hubContentItemsFile}'s definition of hub_content_items is missing the hub_content_items_no_regulatory_escape_hatch constraint -- general content could assert regulatory-sounding claims in prose without going through regulatory_*'s provenance/conflict/publication controls.`)
}

// ---------------------------------------------------------------------
// 3. One applicability architecture -- no second polymorphic applicability
//    table for general knowledge.
// ---------------------------------------------------------------------
const applicabilityTables = migrationSources.filter(({ source }) =>
  /create table public\.hub_\w*applicability/i.test(source)
)
const distinctApplicabilityTableNames = new Set(
  applicabilityTables.flatMap(({ source }) => [...source.matchAll(/create table public\.(hub_\w*applicability)/gi)].map((m) => m[1]))
)
if (distinctApplicabilityTableNames.size === 0) {
  problems.push("No hub_*applicability table found -- general-knowledge applicability architecture is missing.")
} else if (distinctApplicabilityTableNames.size > 1) {
  problems.push(`More than one general-knowledge applicability table found (${[...distinctApplicabilityTableNames].join(", ")}) -- one applicability architecture only; hub_position_age_stage is a distinct, position-specific concept and is exempt, but a second general applicability table is a duplicate.`)
}

// ---------------------------------------------------------------------
// 4. Published-only default: every hub_* table with a status column needs
//    a public-read policy scoped to status = 'PUBLISHED'.
// ---------------------------------------------------------------------
const hubTablesWithStatus = ["hub_content_items", "hub_positions", "hub_skills", "hub_glossary_terms"]
for (const table of hubTablesWithStatus) {
  const hasPolicy = migrationSources.some(({ source }) =>
    new RegExp(`create policy ${table}_public_read on public\\.${table}[\\s\\S]{0,200}status = 'PUBLISHED'`, "i").test(source)
  )
  if (!hasPolicy) {
    problems.push(`No published-only public-read RLS policy found for public.${table} -- a non-admin viewer could see draft/reviewed/superseded/archived rows.`)
  }
}

// ---------------------------------------------------------------------
// 5. No role-branched Rugby Hub implementation -- no parent/player/staff-
//    specific copy of a hub_* consumer file.
// ---------------------------------------------------------------------
const appFiles = (() => {
  try {
    return findFiles("app", [".ts", ".tsx"])
  } catch {
    return []
  }
})()
const roleBranchedHubFiles = appFiles.filter((f) =>
  /rugby-hub/i.test(f) && /\/(parent|player|staff|guardian|coach)\//i.test(f)
)
if (roleBranchedHubFiles.length > 0) {
  problems.push(`Role-named Rugby Hub route/component found: ${roleBranchedHubFiles.join(", ")} -- Rugby Hub is one shared surface; role differences are server-derived context, never a separate file tree per role.`)
}

if (problems.length > 0) {
  console.error("FAIL  hub_content_architecture")
  for (const p of problems) console.error(`        ${p}`)
  process.exit(1)
}

console.log("ok    hub_content_architecture           Training/Hub boundary, regulatory escape-hatch guard, one applicability architecture, published-only RLS, no role-branched Hub implementation")
