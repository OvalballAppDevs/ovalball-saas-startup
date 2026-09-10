#!/usr/bin/env node
/**
 * EMAIL CATALOGUE DRIFT GUARD
 *
 * Three lists have to agree, and nothing at runtime notices when they stop:
 *
 *   1. the catalogue      lib/email/catalogue.ts   -- what an event IS
 *   2. the contract       lib/email/contracts.ts   -- its editable copy
 *   3. the wiring         lib/email/wiring.ts      -- whether anything sends it
 *
 * The failure this exists to catch is quiet and specific. Somebody adds an
 * email event, wires it up, and forgets the contract -- so Email Configuration
 * simply does not list it, and a Site Admin who goes looking for the wording
 * of an email a club just received finds nothing and concludes Ovalball did
 * not send it. Or the reverse: an event is unwired during a refactor and the
 * catalogue still advertises it as live, so somebody spends an afternoon
 * rewording a message with no trigger.
 *
 * Deliberately a script and not a lint rule. It reads three specific exports
 * and compares three sets; it has no opinion about anybody's English.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(join(root, p), "utf8")

/** Keys of a top-level `const NAME: ... = { key: {...} }` record. */
function recordKeys(source, name) {
  const start = source.indexOf(`const ${name}`)
  if (start === -1) throw new Error(`${name} not found`)
  const open = source.indexOf("{", start)
  let depth = 0
  const keys = []
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === "{") depth += 1
    else if (ch === "}") {
      depth -= 1
      if (depth === 0) break
    } else if (depth === 1 && /[a-z]/.test(ch)) {
      const match = /^([a-z_][a-z0-9_]*)\s*:/.exec(source.slice(i))
      if (match) {
        keys.push(match[1])
        i += match[0].length - 1
      }
    }
  }
  return keys
}

/** Entries of a top-level `const NAME: ... = [ "a", "b" ]` array. */
function arrayEntries(source, name) {
  const start = source.indexOf(`const ${name}`)
  if (start === -1) throw new Error(`${name} not found`)
  // Anchored on the assignment, not the first bracket: the declaration's own
  // type annotation (`readonly EmailEventKey[]`) contains a bracket pair that
  // would otherwise be parsed as an empty list -- and an empty list here reads
  // as "nothing is wired", which is a very loud way to be quietly wrong.
  const open = source.indexOf("[", source.indexOf("=", start))
  const close = source.indexOf("]", open)
  return [...source.slice(open, close).matchAll(/"([a-z_][a-z0-9_]*)"/g)].map((m) => m[1])
}

const catalogue = recordKeys(read("lib/email/catalogue.ts"), "EMAIL_EVENTS")
const contractsSource = read("lib/email/contracts.ts")
const contracts = recordKeys(contractsSource, "EMAIL_TEMPLATE_CONTRACTS")
const declaredWired = arrayEntries(read("lib/email/wiring.ts"), "WIRED_EVENT_KEYS")
const templatesSource = read("lib/email/templates.ts")

// The real call sites. sendEmailEvent is the one entry point, so an eventKey
// passed to it is the only way an email leaves Ovalball.
const callSites = new Set()
const { execSync } = await import("node:child_process")
const grepped = execSync(
  `grep -rhoE 'eventKey: "[a-z_]+"' app lib || true`,
  { cwd: root, encoding: "utf8" }
)
for (const line of grepped.split("\n")) {
  const m = /eventKey: "([a-z_]+)"/.exec(line)
  if (m) callSites.add(m[1])
}

const problems = []
const missing = (label, from, inSet) => {
  for (const key of from) {
    if (!inSet.includes(key)) problems.push(label(key))
  }
}

missing((k) => `"${k}" is catalogued but has no editable contract, so Email Configuration would not list it.`, catalogue, contracts)
missing((k) => `"${k}" has a contract but is not in the catalogue, so nothing knows who it is for.`, contracts, catalogue)
missing((k) => `"${k}" is declared wired but nothing calls sendEmailEvent with it.`, declaredWired, [...callSites])
missing((k) => `"${k}" is sent by the product but is not declared in WIRED_EVENT_KEYS.`, [...callSites], declaredWired)

/**
 * A contract that OFFERS a variable its own renderer never actually supplies
 * is worse than one that offers too little: a Site Admin types {{a_typo}},
 * saves it, and every future send of that email silently renders a gap where
 * the value should be -- because unknownVariables() only rejects a name the
 * CONTRACT doesn't allow, and this one is (wrongly) allowed.
 *
 * Checked by parsing VARIABLE_MAPS in lib/email/templates.ts rather than
 * importing it, matching the rest of this script -- a text check that reads
 * every contract and every map is worth more here than a type-safe one that
 * would need a TypeScript compile step this script does not otherwise pay
 * for.
 */
function variableNamesFor(key) {
  const contractBlock = (() => {
    const start = contractsSource.indexOf(`  ${key}: {`)
    if (start === -1) return ""
    let depth = 0
    for (let i = contractsSource.indexOf("{", start); i < contractsSource.length; i += 1) {
      if (contractsSource[i] === "{") depth += 1
      else if (contractsSource[i] === "}") {
        depth -= 1
        if (depth === 0) return contractsSource.slice(start, i + 1)
      }
    }
    return ""
  })()
  const variablesStart = contractBlock.indexOf("variables:")
  if (variablesStart === -1) return []
  const arrayStart = contractBlock.indexOf("[", variablesStart)
  const arrayEnd = contractBlock.indexOf("]", arrayStart)
  const variablesBlock = contractBlock.slice(arrayStart, arrayEnd)
  // `variables:` is a plain array of catalogue keys -- "club_name", not an
  // inline { name: "club_name", ... } object (that metadata moved to the ONE
  // catalogue, lib/email/dynamic-data/catalogue.ts).
  return [...variablesBlock.matchAll(/"([a-z_][a-z0-9_]*)"/g)].map((m) => m[1])
}

/**
 * A VARIABLE_MAPS entry is an arrow function returning an object literal,
 * and that object may legitimately span many lines (match_cancelled's does)
 * -- so this finds the entry's start by key, then reads forward by brace
 * depth to its end, exactly like contractBlock above, rather than assuming
 * one line holds the whole thing.
 */
function producedNamesFor(key) {
  const marker = new RegExp(`^\\s*${key}:\\s*\\(`, "m")
  const startMatch = marker.exec(templatesSource)
  if (!startMatch) return null // No VARIABLE_MAPS entry at all -- a separate, louder failure below.

  // Every entry returns an object literal wrapped in its own parens --
  // `(d) => ({...})` or `() => ({...})` -- so the paren to track depth from
  // is the one right after "=>", not the arrow function's own parameter
  // list opening paren matched by `marker` above.
  const arrowAt = templatesSource.indexOf("=>", startMatch.index)
  const parenOpen = templatesSource.indexOf("(", arrowAt)
  const braceOpen = templatesSource.indexOf("{", parenOpen)
  // The map entry ends at its own trailing "})," or "}),\n" -- found by
  // tracking paren depth from that opening "(".
  let depth = 0
  let end = templatesSource.length
  for (let i = parenOpen; i < templatesSource.length; i += 1) {
    if (templatesSource[i] === "(") depth += 1
    else if (templatesSource[i] === ")") {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const entryBlock = templatesSource.slice(braceOpen, end)
  return [...entryBlock.matchAll(/\{?\s*([a-z_][a-z0-9_]*)\s*:/g)]
    .map((m) => m[1])
    .filter((name) => name !== key) // The map's own key at the start of the line is not a produced variable.
}

for (const key of catalogue) {
  const produced = producedNamesFor(key)
  if (produced === null) {
    problems.push(`"${key}" is catalogued but VARIABLE_MAPS in lib/email/templates.ts has no entry for it.`)
    continue
  }
  for (const declared of variableNamesFor(key)) {
    if (!produced.includes(declared)) {
      problems.push(
        `"${key}" contracts {{${declared}}} but its renderer's VARIABLE_MAPS entry never produces "${declared}" -- a published email using it would render a gap.`
      )
    }
  }
}

/**
 * TRANSACTIONAL PRODUCT CODE MUST NOT REACH THE PROVIDER DIRECTLY.
 *
 * sendEmailEvent (lib/email/send.ts) is the one path from a domain action to
 * an outbound message: it is where recipient resolution, policy, idempotency
 * and the registry's resolved copy all happen. A call site that imports the
 * provider or the ZeptoMail/mailpit wiring directly skips every one of those,
 * which is exactly the shape that produced the safeguarding open-relay bug
 * this whole foundation exists to prevent.
 */
const bypassGrep = execSync(
  `grep -rlE 'selectEmailProvider|zeptoMailProvider|mailpitProvider|api\\.zeptomail\\.com' app lib supabase/tests || true`,
  { cwd: root, encoding: "utf8" }
)
const ALLOWED_PROVIDER_FILES = new Set(["lib/email/provider.ts", "lib/email/send.ts"])
for (const file of bypassGrep.split("\n").filter(Boolean)) {
  if (ALLOWED_PROVIDER_FILES.has(file) || file.startsWith("supabase/tests/")) continue
  problems.push(`"${file}" reaches the email provider directly -- every send must go through sendEmailEvent().`)
}

if (problems.length > 0) {
  console.error("FAIL  email catalogue drift")
  for (const problem of problems) console.error(`        ${problem}`)
  process.exit(1)
}

const unwired = catalogue.filter((k) => !declaredWired.includes(k))
console.log(
  `ok    email catalogue                    ${catalogue.length} events, ${declaredWired.length} wired` +
    (unwired.length > 0 ? ` (${unwired.join(", ")} not yet sent by anything)` : "")
)
