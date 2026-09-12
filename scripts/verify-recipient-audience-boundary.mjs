#!/usr/bin/env node
/**
 * ONE CANONICAL SAFEGUARDING ELIGIBILITY PREDICATE.
 *
 * The question "who may legitimately be contacted for this player?" has
 * exactly one answer in this codebase: internal.player_contact_eligibility.
 * Notifications, Email and any future channel consume it and may only NARROW
 * what it returns. None of them may decide eligibility for themselves.
 *
 * WHY THIS GUARD GREW TEETH.
 *
 * Its first version checked that the age-and-consent PREDICATE appeared in
 * only the files allowed to declare it. That caught a second copy of the rule
 * -- and was completely blind to the actual defect the Main/SP4 merge
 * surfaced, because the dangerous code had no age predicate at all:
 *
 *   internal.notify_training_participants
 *     -- "Adult self-managed players (own linked account)"
 *     select p.user_id from public.players p where p.user_id is not null
 *
 * A twelve-year-old with a login was a direct recipient of club training
 * communication. The comment said "adult"; the code said "has a login". So
 * the guard now also checks the shape that has no predicate: a recipient
 * resolution that reaches a PLAYER'S OWN user_id without asking the canonical
 * primitive first.
 *
 * IT READS FINAL STATE, NOT HISTORY.
 *
 * Old migrations are never rewritten, so the offending text still exists in
 * the file that first shipped it. Migrations apply in filename order, so the
 * LAST definition of a function is the one the database ends up with. This
 * guard reconstructs that final definition per function and judges only that
 * -- exactly what a fresh `supabase db reset` would produce.
 */
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { execSync } from "node:child_process"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const problems = []

const CANONICAL = "internal.player_contact_eligibility"

// ---------------------------------------------------------------------------
// 0. Reconstruct the FINAL definition of every SQL function.
// ---------------------------------------------------------------------------
const migrationDir = join(root, "supabase/migrations")
const migrationFiles = readdirSync(migrationDir).filter((f) => f.endsWith(".sql")).sort()

/** name -> { file, body } for the last migration that defines it. */
const finalDefinitions = new Map()

for (const file of migrationFiles) {
  const source = readFileSync(join(migrationDir, file), "utf8")
  // `create [or replace] function <schema>.<name>(` ... up to the closing
  // `$$;` of its body. Dollar-quoted bodies are the only form this repo uses.
  // CREATEs and DROPs are walked in SOURCE ORDER, not in two passes. A
  // migration that drops a function and immediately recreates it with a wider
  // return type is a normal thing to do -- the return type cannot be changed
  // in place -- and a two-pass reading would let the DROP retire the CREATE
  // that follows it, concluding the canonical predicate no longer exists.
  const statementRe =
    /(create\s+(?:or\s+replace\s+)?function|drop\s+function(?:\s+if\s+exists)?)\s+([a-z_]+\.[a-z_0-9]+)\s*\(/gi
  let match
  while ((match = statementRe.exec(source)) !== null) {
    const name = match[2].toLowerCase()

    if (/^drop/i.test(match[1])) {
      finalDefinitions.delete(name)
      continue
    }

    const rest = source.slice(match.index)
    // The body ends at whichever comes FIRST: the `$$;` that closes it, or the
    // next `create function` in the file. Without the second bound a function
    // whose body this parser cannot see the end of silently swallows its
    // neighbours, and the guard then blames the wrong function -- which is how
    // a guard gets switched off.
    const dollarEnd = rest.indexOf("$$;")
    const nextCreate = rest.slice(1).search(/create\s+(?:or\s+replace\s+)?function\s+[a-z_]+\.[a-z_0-9]+\s*\(/i)
    const bounds = [dollarEnd === -1 ? Infinity : dollarEnd + 3, nextCreate === -1 ? Infinity : nextCreate + 1]
    const end = Math.min(...bounds)
    finalDefinitions.set(name, { file, body: end === Infinity ? rest : rest.slice(0, end) })
  }

}

// ---------------------------------------------------------------------------
// 1. No direct player-email shortcut anywhere in application code.
// ---------------------------------------------------------------------------
const emailShortcutGrep = execSync(
  `grep -rniE "from\\('players'\\)[^;]*select[^;]*email|players\\.email" app lib supabase/migrations 2>/dev/null || true`,
  { cwd: root, encoding: "utf8" }
)
for (const line of emailShortcutGrep.split("\n").filter(Boolean)) {
  const [, content = ""] = line.split(/:(.*)/s)
  const codePart = content.split(/--|\/\//)[0]
  if (/players\.email|from\('players'\)/i.test(codePart)) {
    problems.push(`Direct player-email shortcut found: ${line.trim().slice(0, 160)}`)
  }
}

// ---------------------------------------------------------------------------
// 2. The canonical primitive exists, and is the ONLY thing declaring the rule.
// ---------------------------------------------------------------------------
if (!finalDefinitions.has(CANONICAL)) {
  problems.push(`${CANONICAL} is not defined by any migration. It is the one answer to "who may legitimately be contacted?".`)
}

const AGE_PREDICATE = /player_effective_age\s*\([^)]*\)\s*>=\s*18/i
const CONSENT_PREDICATE = /guardian_permission_effective\s*\([^)]*['"]direct_coach_communication['"]/i
for (const [name, { file, body }] of finalDefinitions) {
  if (name === CANONICAL) continue
  if (AGE_PREDICATE.test(body) || CONSENT_PREDICATE.test(body)) {
    problems.push(
      `${name} (final definition in ${file}) declares its own age/consent eligibility rule. ` +
        `There is one safeguarding predicate: call ${CANONICAL}.`
    )
  }
}

// ---------------------------------------------------------------------------
// 3. The retired duplicates must not come back.
// ---------------------------------------------------------------------------
for (const retired of ["internal.notifiable_users_for_players", "internal.player_notification_recipients"]) {
  if (finalDefinitions.has(retired)) {
    problems.push(
      `${retired} has been reintroduced (${finalDefinitions.get(retired).file}). It was consolidated into ${CANONICAL}; ` +
        `two recipient functions means two places a safeguarding change can land in one of.`
    )
  }
}

// ---------------------------------------------------------------------------
// 4. NOBODY REACHES A PLAYER'S OWN ACCOUNT WITHOUT ASKING FIRST.
// ---------------------------------------------------------------------------
// The shape with no predicate at all -- the one that shipped. A function that
// resolves recipients (inserts notifications, or returns a recipient/audience
// set) and takes a user_id off the players table must obtain it from the
// canonical primitive.
// Deliberately narrow: a function that WRITES a notification, or whose name
// says it resolves an audience. A guardian-administration function that
// happens to return a user_id column is not a recipient resolver, and
// flagging it would train people to ignore this guard.
const RESOLVES_RECIPIENTS = /insert\s+into\s+public\.notifications/i
const NAMED_AS_RESOLVER = /(recipient|audience|notifiable|notify_)/i
const TAKES_PLAYER_ACCOUNT = /\bplayers\b[\s\S]{0,400}?\buser_id\s+is\s+not\s+null/i
for (const [name, { file, body }] of finalDefinitions) {
  if (name === CANONICAL) continue
  if (!RESOLVES_RECIPIENTS.test(body) && !NAMED_AS_RESOLVER.test(name)) continue
  if (!TAKES_PLAYER_ACCOUNT.test(body)) continue
  if (body.includes(CANONICAL)) continue
  problems.push(
    `${name} (final definition in ${file}) resolves recipients and reads a player's own user_id directly. ` +
      `"Has a login" is not "may be contacted": route it through ${CANONICAL}.`
  )
}

// ---------------------------------------------------------------------------
// 5. CHANNELS CONSUME ELIGIBILITY -- THEY DO NOT RE-DECIDE IT.
// ---------------------------------------------------------------------------
// An Email or Messenger path that grows its own guardian fallback is the same
// duplication wearing a channel's clothes.
//
// CHANNEL CODE ONLY. Guardian ADMINISTRATION -- Club Settings, Your Children,
// the account page -- legitimately reads guardian relationships; that is the
// product managing who a guardian is, not a channel deciding who may be
// written to. The boundary this protects is the one between eligibility and
// delivery.
//
// Read in Node rather than shelled out to grep: the pattern has to match all
// three JavaScript quote characters, and a backtick inside a shell string is
// a command substitution waiting to happen.
function walkFiles(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

const CHANNEL_DIRS = ["lib/email", "lib/messenger", "lib/notifications"]
const GUARDIAN_RESOLUTION = /from\((['"`])guardians\1\)|guardian_user_id/i
for (const dir of CHANNEL_DIRS) {
  for (const file of walkFiles(join(root, dir))) {
    const lines = readFileSync(file, "utf8").split("\n")
    lines.forEach((line, i) => {
      const codePart = line.split("//")[0]
      if (!GUARDIAN_RESOLUTION.test(codePart)) return
      problems.push(
        `${file.slice(root.length + 1)}:${i + 1} resolves guardians in channel code. Eligibility is decided once, ` +
          `server-side, by ${CANONICAL}; a channel may narrow the result (preferences, suppression, template context) ` +
          `but never widen or re-derive it.`
      )
    })
  }
}

if (problems.length > 0) {
  console.error("FAIL  recipient/audience boundary")
  for (const problem of problems) console.error(`        ${problem}`)
  process.exit(1)
}

console.log(
  `ok    recipient_audience_boundary        one eligibility predicate (${CANONICAL}), no player-email shortcut, no channel re-derivation`
)
