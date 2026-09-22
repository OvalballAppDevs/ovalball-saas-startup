#!/usr/bin/env node
/**
 * WHO MAY READ A LEGACY INVITATION TOKEN.
 *
 * Six legacy tables still store their invitation token in plaintext. Slice 5 cleared the token from
 * every terminal and expired row, and the READ surface had to stay while three server actions still
 * inserted a legacy invitation and read the token straight back to build the emailed link -- removing
 * the grant then would have broken invitation sending (D-S5-AUTO-6).
 *
 * THE APPLICATION LIST IS EMPTY. All of them moved to the canonical issuer, so nothing in the
 * application reads a plaintext legacy token any more, and as of Convergence Step 17 no browser role
 * holds SELECT, INSERT or UPDATE on any legacy token column at all. A new reader is a regression rather
 * than a known cost, and the failure message says so.
 *
 * THE DATABASE LIST IS NOT EMPTY, AND USED TO LOOK AS THOUGH IT WERE. Step 17 found that this script's
 * database check missed `public.send_replacement_guardian_invitation`, which does hand a plaintext legacy
 * token to its caller. The old pattern was `returning[^;]*\ytoken\y`, and that function never writes a
 * `returning ... token` clause:
 *
 *     insert into public.guardian_invitations (...) values (...)
 *     returning * into v_row;                     -- [^;]* stops at this semicolon
 *     return query select v_row.id, v_row.token;  -- the token actually leaves here
 *
 * So the check is now on what a function GIVES BACK -- its result columns -- as well as on the clause,
 * and the survivor is named in an allow-list with a reason and an owner rather than hidden by a regex
 * hole. A guard that says "none at all" while one path does is worse than no guard.
 *
 * It also checks the DATABASE, not just the application, and that is not belt-and-braces. The first
 * version of this script looked only for a module SELECTing `token` off a legacy table, and it missed
 * the Safeguarding Officer issuer completely -- that one never touched the table from TypeScript,
 * because the token came back through an RPC's return value. A function that hands a plaintext legacy
 * token to a caller is the same exposure whatever the call site looks like, so the functions are
 * where it is checked.
 */

import { execFileSync } from "node:child_process"
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

/**
 * Database functions that still hand a plaintext legacy token back to their caller.
 *
 * SHRINK-ONLY. Each entry carries why it cannot move yet and who owns moving it. An entry that stops
 * leaking must be removed, and the check below fails if one is listed but no longer qualifies -- the
 * point of the list is that it shrinks.
 */
const ALLOWED_DB_ISSUERS = new Map([
  [
    "send_replacement_guardian_invitation",
    "Identity/Auth Slice 10 + family architecture. It issues into guardian_invitations and returns the " +
      "link once. It cannot move to public.issue_invitation yet because the journey completes through " +
      "link_guardian_to_existing_player and create_player_for_guardian, BOTH of which take a " +
      "p_guardian_invitation_id -- a legacy row id -- while the canonical GUARDIAN redemption returns " +
      "ACCEPTED and links nobody. Re-pointing the issuer would break the replacement-guardian journey. " +
      "Exposure is bounded: guardian_invitations has no grant to anon or authenticated, so no API role " +
      "can read the column; only SECURITY DEFINER functions can. Recorded for the owner's ruling in " +
      "docs/product/CONVERGENCE_STEP_17_ARCHAEOLOGY.md.",
  ],
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

/**
 * Any function that still returns a legacy plaintext token to its caller. Read from the database
 * rather than from the migrations, because a later migration can replace a body without the earlier
 * file changing -- which is exactly how the canonical issuers landed.
 */
const CONTAINER = process.env.SUPABASE_DB_CONTAINER || "supabase_db_ovalball-saas-startup"
const LEGACY_TOKEN_SQL = `
  select string_agg(p.proname, ',' order by p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'internal')
     -- WORD BOUNDARIES AND NO COMMENTS. Without boundaries 'invitations' matches inside
     -- 'access_invitations', and without stripping comments it matches an English sentence -- both
     -- reported the CANONICAL issuer, which correctly returns its secret once and stores only the hash,
     -- as a legacy leak. An underscore is a word character, so \\y keeps the table names apart.
     and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~ '\\y(${LEGACY_TABLES.join("|")})\\y'
     and (
       -- the clause form
       regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~ 'returning[^;]*\\ytoken\\y'
       -- or the shape that slipped through until Step 17: the secret leaves in the RESULT COLUMNS,
       -- however the body happened to get it there
       or pg_get_function_result(p.oid) ~ '\\ytoken\\y'
     )`

let leakingFunctions = ""
try {
  leakingFunctions = execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-c", LEGACY_TOKEN_SQL],
    { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] },
  ).trim()
} catch {
  // No local database to ask. The source check above still ran; say so rather than passing silently.
  leakingFunctions = "\u0000unavailable"
}

if (leakingFunctions && leakingFunctions !== "\u0000unavailable") {
  const leaking = leakingFunctions.split(",").map((f) => f.trim()).filter(Boolean)
  for (const fn of leaking) {
    if (!ALLOWED_DB_ISSUERS.has(fn)) {
      failures.push(
        `public.${fn} hands a plaintext legacy invitation token back to its caller and is not on the ` +
          `shrink list. Issue through public.issue_invitation, which returns the secret once and stores ` +
          `only its hash -- or add it with a reason and an owner if it genuinely cannot move yet.`,
      )
    }
  }
  for (const [fn] of ALLOWED_DB_ISSUERS) {
    if (!leaking.includes(fn)) {
      failures.push(
        `public.${fn} is on the legacy-token shrink list but no longer hands one out. Remove it from ` +
          `the list -- the point of the list is that it shrinks.`,
      )
    }
  }
}

if (failures.length > 0) {
  console.error("verify-legacy-invitation-token-readers: FAIL")
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}

// THE SHRINK LIST IS PART OF THE ANSWER, so it is printed. The previous message said "nothing reads a
// plaintext legacy invitation token" while one database function handed one out, which is how the gap
// stayed invisible -- a green line that overstates its own finding is the thing being fixed here.
const appPart = found.size === 0 ? "no module reads one" : `${found.size} module(s) allow-listed`
const dbPart =
  leakingFunctions === "\u0000unavailable"
    ? "database not checked: no local stack"
    : ALLOWED_DB_ISSUERS.size === 0
      ? "no database function hands one out"
      : `${ALLOWED_DB_ISSUERS.size} database issuer(s) still do, all named with a reason and an owner`
console.log(`  ok    legacy_invitation_token_readers    ${appPart}; ${dbPart}`)
