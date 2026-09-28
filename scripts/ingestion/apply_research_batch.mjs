#!/usr/bin/env node
// Overnight Directory Enrichment — applies real, source-cited research results into the
// EXISTING Online Directory Verification pipeline (club_directory_research_proposals /
// directory_verification_runs), via the exact same record_directory_verification_result
// RPC a configured researchClub() provider would call. Never writes club_directory
// fields directly, never accepts a proposal -- that stays a human, one-at-a-time review
// action through app/(app)/admin/clubs/data-quality (proposal-review.tsx's own explicit
// "never bulk accept" rule).
//
// Usage: node scripts/ingestion/apply_research_batch.mjs <run_id> <result-file.json> [more files...]
//
// Each result file is the JSON array a research pass produced, one object per club:
//   { directory_id, name, identity_confidence, identity_notes, proposals: [...], logo_candidate }
//
// A club with identity_confidence !== "confirmed" is recorded as outcome "no_result" (its
// identity_notes preserved as detail) and produces NO proposals and NO logo candidate --
// ambiguous identity is never silently resolved by this script.
//
// A logo_candidate is written directly to club_directory.logo_candidate_url/_source/
// _evidence/_found_at -- this is NOT a proposal (it never touches logo_storage_path, the
// applied crest) and is not gated behind accept/reject, matching the migration's own
// stated reasoning: a candidate is evidence for a human to look at and upload themselves
// through the existing LogoManager tool.

import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"

const [runId, ...files] = process.argv.slice(2)
if (!runId || files.length === 0) {
  console.error("Usage: node apply_research_batch.mjs <run_id> <result-file.json> [more files...]")
  process.exit(1)
}

const FIELD_TO_COLUMN = {
  name: "name",
  website: "website",
  home_ground: "home_ground",
  address: "address",
  postcode: "postcode",
  county: "county",
  town: "town",
  bio: "bio",
  primary_colour: "primary_colour",
  secondary_colour: "secondary_colour",
  official_email: "official_email",
  constituent_body: "constituent_body",
  notes: "notes",
}

function fetchCurrentValues(directoryIds) {
  const idList = directoryIds.map((id) => `'${id}'`).join(",")
  const out = execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-Aqt", "-F", ""],
    {
      input: `select id, website, home_ground, address, postcode, county, town, bio, primary_colour, secondary_colour, official_email, constituent_body, notes from public.club_directory where id in (${idList});`,
      encoding: "utf8",
    }
  )
  const map = {}
  for (const line of out.trim().split("\n")) {
    if (!line) continue
    const [id, website, home_ground, address, postcode, county, town, bio, primary_colour, secondary_colour, official_email, constituent_body, notes] =
      line.split("")
    map[id] = { website, home_ground, address, postcode, county, town, bio, primary_colour, secondary_colour, official_email, constituent_body, notes }
  }
  return map
}

function sqlLit(value) {
  if (value === null || value === undefined) return "NULL"
  return "'" + String(value).replace(/'/g, "''") + "'"
}

function proposalRow(p, currentValue) {
  return `ROW(${sqlLit(p.field)}, ${sqlLit(currentValue ?? null)}, ${sqlLit(p.proposed_value)}, ${sqlLit(p.source)}, ${sqlLit(p.source_url ?? null)}, ${sqlLit(p.confidence)})::directory_verification_proposal_input`
}

let totalConfirmed = 0
let totalAmbiguous = 0
let totalProposals = 0
let totalLogoCandidates = 0
const statements = []

const allClubs = files.flatMap((file) => JSON.parse(readFileSync(file, "utf8")))
const currentValues = fetchCurrentValues(allClubs.map((c) => c.directory_id).filter(Boolean))

for (const file of files) {
  const clubs = JSON.parse(readFileSync(file, "utf8"))
  for (const club of clubs) {
    if (!club.directory_id) continue

    if (club.identity_confidence !== "confirmed") {
      totalAmbiguous++
      statements.push(
        `select public.record_directory_verification_result(${sqlLit(runId)}::uuid, ${sqlLit(club.directory_id)}::uuid, 'no_result', ${sqlLit(
          "Identity not confirmed (" + club.identity_confidence + "): " + (club.identity_notes || "")
        )});`
      )
      continue
    }
    totalConfirmed++

    const proposals = (club.proposals || []).filter((p) => p.field && p.proposed_value && p.source && p.confidence)
    totalProposals += proposals.length

    if (proposals.length === 0) {
      statements.push(
        `select public.record_directory_verification_result(${sqlLit(runId)}::uuid, ${sqlLit(club.directory_id)}::uuid, 'no_result', ${sqlLit(
          "Identity confirmed but no verifiable new/better fields found."
        )});`
      )
    } else {
      const row = currentValues[club.directory_id] || {}
      const rows = proposals.map((p) => proposalRow(p, row[FIELD_TO_COLUMN[p.field]] || null)).join(", ")
      statements.push(
        `select public.record_directory_verification_result(${sqlLit(runId)}::uuid, ${sqlLit(
          club.directory_id
        )}::uuid, 'proposal_created', NULL, ARRAY[${rows}]::directory_verification_proposal_input[]);`
      )
    }

    if (club.logo_candidate && club.logo_candidate.url) {
      totalLogoCandidates++
      statements.push(
        `update public.club_directory set logo_candidate_url = ${sqlLit(club.logo_candidate.url)}, logo_candidate_source = ${sqlLit(
          club.logo_candidate.source ?? null
        )}, logo_candidate_evidence = ${sqlLit(club.logo_candidate.evidence ?? null)}, logo_candidate_found_at = now() where id = ${sqlLit(
          club.directory_id
        )}::uuid and logo_storage_path is null;`
      )
    }
  }
}

const sql =
  "set request.jwt.claims = '" +
  JSON.stringify({ sub: "483a2f3b-4fff-403e-bdc9-c6f6a0c8b63a", role: "authenticated" }).replace(/'/g, "''") +
  "';\nset role authenticated;\n" +
  statements.join("\n") +
  "\n"

execFileSync("docker", ["exec", "-i", "supabase_db_ovalball-saas-startup", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], {
  input: sql,
  stdio: ["pipe", "inherit", "inherit"],
})

console.log(
  `\nApplied: ${totalConfirmed} confirmed clubs, ${totalAmbiguous} flagged ambiguous/not-found, ${totalProposals} field proposals staged, ${totalLogoCandidates} logo candidates recorded.`
)
