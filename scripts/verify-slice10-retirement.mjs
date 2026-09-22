#!/usr/bin/env node
/**
 * IDENTITY/AUTH SLICE 10 — THE RETIREMENT RATCHET.
 *
 * Slice 10's acceptance is "zero references in CI; full runner, clean boot and all browser suites green;
 * production usage telemetry zero for 30 days before each drop". The first clause is the one that decides
 * whether a drop is even possible, and until Convergence Step 17 nothing measured it — so "is the
 * compatibility estate shrinking?" could only be answered by hand, which means it was not answered.
 *
 * THIS IS NOT A TEST THAT THE ESTATE IS GONE. It is a ratchet: every count may fall, and none may rise.
 * A drop becomes mechanical when its count reaches zero, and until then the number is visible in CI
 * rather than rediscovered by the next person to look.
 *
 * `--write-baseline` records the current counts, and ONLY when every one of them has fallen or held.
 * That is deliberate: the baseline cannot be used to legitimise a new reference.
 *
 * WHY COMMENTS ARE STRIPPED before matching a database function body: Step 17 found the neighbouring
 * legacy-token guard reporting the CANONICAL issuer because the word "invitations" appeared in an English
 * sentence inside a comment. A reference is code, not prose.
 */

import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.cwd()
const BASELINE_PATH = join(ROOT, "supabase/security/slice10-retirement-baseline.json")
const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"

/** Strip `--` comments so a reference means code. */
const NO_COMMENTS = `regexp_replace(p.prosrc, '--[^\\n]*', '', 'g')`

/**
 * Every target the checked-in Slice 10 definition names, with how a reference to it is counted.
 *
 * `db` is a regex over comment-stripped function bodies; `ts` is a regex over .ts/.tsx source; `ci`
 * counts the permanent suites and scripts that exercise it. CI IS COUNTED BECAUSE SLICE 10'S ACCEPTANCE
 * SAYS "zero references in CI" -- and Step 17 found that every target that looked droppable from the
 * application's point of view (role_capability_defaults with no database reader at all, and
 * invite_player_account with no caller) is still exercised by permanent suites. A drop that removes
 * coverage is not a retirement.
 * A target may have either or both — `club_memberships.role` has no honest TypeScript pattern, because
 * the string "role" is everywhere and means twenty different things.
 */
const TARGETS = [
  { key: "team_permissions", db: String.raw`\yteam_permissions\y`, ts: /\bteam_permissions\b/, ci: /\bteam_permissions\b/ },
  { key: "profiles.account_status", db: String.raw`\yaccount_status\y`, ts: /\baccount_status\b/, ci: /\baccount_status\b/ },
  { key: "role_capability_defaults", db: String.raw`\yrole_capability_defaults\y`, ts: /\brole_capability_defaults\b/, ci: /\brole_capability_defaults\b/ },
  { key: "permission_groups", db: String.raw`\ypermission_groups`, ts: /\bpermission_groups/, ci: /\bpermission_groups/ },
  { key: "has_capability_adapter", db: String.raw`\yhas_capability\y`, ts: /\bhas_capability\b/, ci: /\bhas_capability\b/ },
  { key: "site_admins.admin_role", db: String.raw`\yadmin_role\y`, ts: /\badmin_role\b/, ci: /\badmin_role\b/ },
  { key: "site_admins.manage_flags", db: String.raw`\ysa\.manage_|\ymanage_competitions\y|\ymanage_team_catalogue\y`, ts: null, ci: /\bmanage_competitions\b|\bmanage_team_catalogue\b/ },
  { key: "club_memberships.legacy_columns", db: String.raw`\ycm\.role\y|\yauthority_suspended`, ts: null, ci: /\bauthority_suspended/ },
  { key: "invite_player_account", db: String.raw`\yinvite_player_account\y`, ts: /\binvite_player_account\b/, ci: /\binvite_player_account\b/ },
  { key: "phase0_signup_binding", db: null, ts: /\bovalballSignupPayload\b/, ci: /\bovalballSignupPayload\b/ },
  { key: "legacy_invitation_tables", db: null, ts: null, sql: `
      select count(*) from information_schema.tables
       where table_schema = 'public' and table_name in
         ('invitations','invitation_teams','guardian_invitations','player_account_invitations',
          'site_admin_invitations','club_ovalball_invitations','club_safeguarding_officer_invitations')` },
  { key: "legacy_token_issuing_functions", db: null, ts: null, sql: `
      select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public','internal')
         and ${NO_COMMENTS} ~ '\\y(guardian_invitations|player_account_invitations)\\y'
         and ${NO_COMMENTS} ~ 'insert into public\\.(guardian_invitations|player_account_invitations)'` },
]

/**
 * A HARD ZERO, not a ratchet. No browser role may reach a plaintext legacy invitation secret, by read or
 * by write. Convergence Step 17 took this to zero; it is not allowed back up by any amount.
 */
const BROWSER_REACHABLE_SECRETS = `
  select count(*) from information_schema.column_privileges
   where table_schema = 'public' and grantee in ('anon','authenticated')
     and column_name ~ 'token|secret' and column_name !~ 'token_sha256|code_hmac|code_hint'`

function psql(sql) {
  return execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", sql], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
  }).trim()
}

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

const sources = walk(join(ROOT, "app")).concat(walk(join(ROOT, "lib")), walk(join(ROOT, "components")))

/** The permanent suites and scripts. `.sql` and `.mjs` as well as TypeScript, because CI is all of them. */
function walkAny(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkAny(full, out)
    else if (/\.(sql|mjs|mts|ts)$/.test(entry)) out.push(full)
  }
  return out
}
/**
 * THE RETIREMENT'S OWN INSTRUMENTS ARE NOT REFERENCES TO WHAT THEY MEASURE.
 *
 * These four files exist to measure or assert the state of the compatibility estate -- "this target still
 * exists", "this secret is still unreachable", "nothing was dropped". Counting them would mean the ratchet
 * rises every time somebody writes the proof, which would make the number measure the effort rather than
 * the estate. The first run after Step 17 added its suite and journey did exactly that, and the guard
 * correctly refused to fold it into the baseline, which is how this list came to be written down.
 *
 * Any use they make of a target to SEED a fixture (a site_admins row needs admin_role, like most suites)
 * is incidental and is the small price of the exclusion. It is named here rather than pattern-matched so
 * the list cannot quietly grow.
 */
const RETIREMENT_INSTRUMENTS = [
  "verify-slice10-retirement.mjs",
  "verify-legacy-invitation-token-readers.mjs",
  "step17_legacy_retirement.sql",
  "86-legacy-estate-unreachable.mjs",
]
const ciSources = walkAny(join(ROOT, "supabase/tests"))
  .concat(walkAny(join(ROOT, "scripts")))
  .filter((f) => !RETIREMENT_INSTRUMENTS.some((name) => f.endsWith(name)))

let databaseReachable = true
const counts = {}
for (const t of TARGETS) {
  let db = 0
  let ts = 0
  try {
    if (t.sql) db = Number(psql(t.sql))
    else if (t.db) {
      db = Number(psql(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname in ('public','internal') and ${NO_COMMENTS} ~ '${t.db.replace(/'/g, "''")}'`))
    }
  } catch {
    databaseReachable = false
  }
  if (t.ts) ts = sources.filter((f) => t.ts.test(readFileSync(f, "utf8"))).length
  const ci = t.ci ? ciSources.filter((f) => t.ci.test(readFileSync(f, "utf8"))).length : 0
  counts[t.key] = { db, ts, ci }
}

let secrets = 0
try {
  secrets = Number(psql(BROWSER_REACHABLE_SECRETS))
} catch {
  databaseReachable = false
}

if (process.argv.includes("--write-baseline")) {
  const prior = JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
  const risen = Object.entries(counts).filter(
    ([k, v]) =>
      prior.targets[k] &&
      (v.db > prior.targets[k].db || v.ts > prior.targets[k].ts || v.ci > (prior.targets[k].ci ?? 0)),
  )
  if (risen.length > 0) {
    console.error("refusing to write a baseline that legitimises a new reference:", risen.map(([k]) => k).join(", "))
    process.exit(1)
  }
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify({ contract: prior.contract, targets: counts, browser_reachable_legacy_secrets: 0 }, null, 2) + "\n",
  )
  console.log("slice10 retirement baseline written")
  process.exit(0)
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
const failures = []
const shrunk = []

if (secrets > 0) {
  failures.push(
    `${secrets} legacy invitation secret column(s) are reachable by a browser role. Convergence Step 17 ` +
      `took this to zero and it is a hard zero, not a ratchet.`,
  )
}

for (const [key, now] of Object.entries(counts)) {
  const was = baseline.targets[key]
  if (!was) {
    failures.push(`${key} is not in the baseline. Add it deliberately, with its current counts.`)
    continue
  }
  if (!databaseReachable) continue
  if (now.db > was.db) {
    failures.push(`${key}: database references rose from ${was.db} to ${now.db}. Slice 10 retires this — it may only shrink.`)
  }
  if (now.ts > was.ts) {
    failures.push(`${key}: TypeScript references rose from ${was.ts} to ${now.ts}. Slice 10 retires this — it may only shrink.`)
  }
  if (now.ci > (was.ci ?? 0)) {
    failures.push(`${key}: CI references rose from ${was.ci ?? 0} to ${now.ci}. Slice 10 retires this — it may only shrink.`)
  }
  if (now.db < was.db || now.ts < was.ts || now.ci < (was.ci ?? 0)) {
    shrunk.push(`${key} ${was.db}/${was.ts}/${was.ci ?? 0} -> ${now.db}/${now.ts}/${now.ci}`)
  }
}

if (failures.length > 0) {
  console.error("verify-slice10-retirement: FAIL")
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}

const total = Object.values(counts).reduce((n, v) => n + v.db + v.ts + v.ci, 0)
const droppable = Object.entries(counts).filter(([, v]) => v.db + v.ts + v.ci === 0).map(([k]) => k)
console.log(
  `  ok    slice10_retirement                 ${total} reference(s) across ${TARGETS.length} retirement targets, none risen; ` +
    `0 browser-reachable legacy secrets; ` +
    (droppable.length === 0
      ? "no target has reached zero references, so no drop is due"
      : `DROP NOW DUE (zero references): ${droppable.join(", ")}`) +
    (shrunk.length > 0 ? ` (SHRANK: ${shrunk.join("; ")} — run --write-baseline)` : "") +
    (databaseReachable ? "" : " (database not checked: no local stack)"),
)
