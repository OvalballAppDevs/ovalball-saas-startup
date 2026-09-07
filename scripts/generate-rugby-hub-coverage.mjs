#!/usr/bin/env node
/**
 * Regenerates docs/rugby-hub/coverage-matrix.json from the LOCAL database.
 *
 * The matrix is derived, never hand-maintained. A spreadsheet detached from
 * the product is exactly how a coverage claim drifts from what Rugby Hub
 * actually resolves -- so the identity/mapping half of this file comes out of
 * regulatory_coverage_report(), and only the per-domain research judgements
 * are authored here.
 *
 *   node scripts/generate-rugby-hub-coverage.mjs
 */

import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"

const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_ovalball-saas-startup"

function query(sql) {
  const out = execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-At", "-F", "", "-c", sql], {
    encoding: "utf8",
  })
  return out
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => l.split(""))
}

/**
 * The knowledge domains Phase 4A set out to cover, and what Phase 4A actually
 * established for each. These are RESEARCH JUDGEMENTS, so they live here
 * rather than in the database -- the database records what is true of the
 * product, this records what is true of our knowledge.
 *
 * Statuses use the vocabulary the brief defined:
 *   VERIFIED_SOURCE_FOUND        -- a primary source is registered AND read.
 *   SOURCE_FOUND_NEEDS_EXTRACTION-- located, scope known, values not yet read.
 *   CONFLICT                     -- two authorities appear inconsistent.
 *   NOT_YET_RESEARCHED           -- we have not looked, or not concluded.
 *   NO_REGULATORY_EQUIVALENT     -- the body does not regulate this.
 *   COMPETITION_SPECIFIC         -- governed per competition, not nationally.
 *   NOT_APPLICABLE               -- the domain does not apply here.
 */
const DOMAIN_STATUS = {
  // Union age grades with a located Regulation 15 appendix.
  union_age_grade: {
    RULES_OF_PLAY: "SOURCE_FOUND_NEEDS_EXTRACTION",
    PLAYER_WELFARE: "SOURCE_FOUND_NEEDS_EXTRACTION",
    SAFEGUARDING: "SOURCE_FOUND_NEEDS_EXTRACTION",
    PLAYING_UP_DISPENSATION: "SOURCE_FOUND_NEEDS_EXTRACTION",
    REGISTRATION: "SOURCE_FOUND_NEEDS_EXTRACTION",
    COMPETITION_SPECIFIC: "NOT_YET_RESEARCHED",
  },
  // Union U6 -- outside Regulation 15 entirely.
  union_u6: {
    RULES_OF_PLAY: "NO_REGULATORY_EQUIVALENT",
    PLAYER_WELFARE: "NOT_YET_RESEARCHED",
    SAFEGUARDING: "SOURCE_FOUND_NEEDS_EXTRACTION",
    PLAYING_UP_DISPENSATION: "NO_REGULATORY_EQUIVALENT",
    REGISTRATION: "SOURCE_FOUND_NEEDS_EXTRACTION",
    COMPETITION_SPECIFIC: "NOT_APPLICABLE",
  },
  union_unresolved: {
    RULES_OF_PLAY: "NOT_YET_RESEARCHED",
    PLAYER_WELFARE: "NOT_YET_RESEARCHED",
    SAFEGUARDING: "SOURCE_FOUND_NEEDS_EXTRACTION",
    PLAYING_UP_DISPENSATION: "NOT_YET_RESEARCHED",
    REGISTRATION: "SOURCE_FOUND_NEEDS_EXTRACTION",
    COMPETITION_SPECIFIC: "NOT_YET_RESEARCHED",
  },
  league_primary: {
    RULES_OF_PLAY: "SOURCE_FOUND_NEEDS_EXTRACTION",
    PLAYER_WELFARE: "SOURCE_FOUND_NEEDS_EXTRACTION",
    SAFEGUARDING: "SOURCE_FOUND_NEEDS_EXTRACTION",
    PLAYING_UP_DISPENSATION: "NOT_YET_RESEARCHED",
    REGISTRATION: "SOURCE_FOUND_NEEDS_EXTRACTION",
    COMPETITION_SPECIFIC: "COMPETITION_SPECIFIC",
  },
  league_girls_u12: {
    RULES_OF_PLAY: "VERIFIED_SOURCE_FOUND",
    PLAYER_WELFARE: "SOURCE_FOUND_NEEDS_EXTRACTION",
    SAFEGUARDING: "SOURCE_FOUND_NEEDS_EXTRACTION",
    PLAYING_UP_DISPENSATION: "NOT_YET_RESEARCHED",
    REGISTRATION: "SOURCE_FOUND_NEEDS_EXTRACTION",
    COMPETITION_SPECIFIC: "COMPETITION_SPECIFIC",
  },
  league_unresolved: {
    RULES_OF_PLAY: "COMPETITION_SPECIFIC",
    PLAYER_WELFARE: "SOURCE_FOUND_NEEDS_EXTRACTION",
    SAFEGUARDING: "SOURCE_FOUND_NEEDS_EXTRACTION",
    PLAYING_UP_DISPENSATION: "NOT_YET_RESEARCHED",
    REGISTRATION: "SOURCE_FOUND_NEEDS_EXTRACTION",
    COMPETITION_SPECIFIC: "COMPETITION_SPECIFIC",
  },
}

function profileFor(row) {
  const { rugby_code, team_type_key, mapping_state, identity_key } = row
  if (rugby_code === "union") {
    if (team_type_key === "u6") return "union_u6"
    if (mapping_state === "MAPPED" && identity_key?.startsWith("RFU-U")) return "union_age_grade"
    return "union_unresolved"
  }
  if (identity_key === "RFL-GIRLS-U12") return "league_girls_u12"
  if (identity_key === "RFL-PRIMARY") return "league_primary"
  return "league_unresolved"
}

const rows = query(`
  select team_type_key, team_type_label, rugby_code, mapping_state,
         coalesce(identity_key,''), coalesce(identity_mapping_type,''),
         fact_count, published_set_count, open_conflict_count
  from public.regulatory_coverage_report()
`).map(([team_type_key, team_type_label, rugby_code, mapping_state, identity_key, identity_mapping_type, fact_count, published_set_count, open_conflict_count]) => ({
  team_type_key,
  team_type_label,
  rugby_code,
  mapping_state,
  identity_key: identity_key || null,
  identity_mapping_type: identity_mapping_type || null,
  fact_count: Number(fact_count),
  published_set_count: Number(published_set_count),
  open_conflict_count: Number(open_conflict_count),
}))

const matrix = rows.map((r) => {
  const profile = profileFor(r)
  const domains = { ...DOMAIN_STATUS[profile] }
  // An open conflict overrides the researched status: publication is blocked
  // regardless of how good the source looked.
  if (r.open_conflict_count > 0) domains.RULES_OF_PLAY = "CONFLICT"
  return { ...r, domain_profile: profile, domains }
})

const summary = {}
for (const r of matrix) {
  for (const [domain, status] of Object.entries(r.domains)) {
    summary[domain] ??= {}
    summary[domain][status] = (summary[domain][status] ?? 0) + 1
  }
}

const out = {
  $comment: [
    "Rugby Hub Phase 4A coverage matrix. GENERATED -- do not hand-edit.",
    "Regenerate with: node scripts/generate-rugby-hub-coverage.mjs",
    "",
    "The identity/mapping/fact columns are read straight out of",
    "regulatory_coverage_report(), so this file cannot claim coverage the",
    "product does not actually resolve. The per-domain statuses are research",
    "judgements authored in the generator alongside their reasoning.",
    "",
    "SOURCE_FOUND_NEEDS_EXTRACTION is the honest majority state after 4A: the",
    "governing document is located and its scope is known, but no value has",
    "been read out of it. It is NOT coverage.",
  ],
  generated_on: new Date().toISOString().slice(0, 10),
  phase: "4A",
  totals: {
    team_type_code_pairs: matrix.length,
    mapped: matrix.filter((r) => r.mapping_state === "MAPPED").length,
    research_required: matrix.filter((r) => r.mapping_state === "RESEARCH_REQUIRED").length,
    accidental_nulls: matrix.filter((r) => r.mapping_state === "UNMAPPED").length,
    facts_published_anywhere: matrix.reduce((n, r) => n + r.fact_count, 0),
  },
  domain_summary: summary,
  matrix,
}

writeFileSync("docs/rugby-hub/coverage-matrix.json", JSON.stringify(out, null, 2) + "\n")
console.log(`coverage-matrix.json: ${matrix.length} pairs, ${out.totals.mapped} mapped, ${out.totals.accidental_nulls} accidental nulls`)
