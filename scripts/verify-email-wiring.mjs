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
const contracts = recordKeys(read("lib/email/contracts.ts"), "EMAIL_TEMPLATE_CONTRACTS")
const declaredWired = arrayEntries(read("lib/email/wiring.ts"), "WIRED_EVENT_KEYS")

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
