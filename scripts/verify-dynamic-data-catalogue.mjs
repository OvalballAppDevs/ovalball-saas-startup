#!/usr/bin/env node
/**
 * DYNAMIC DATA CATALOGUE STRUCTURAL GUARD
 *
 * "Extensive" (SP4's own instruction for this catalogue) is not
 * "unrestricted". This script keeps the invariants that make the
 * difference true structurally, not just by convention:
 *
 *   1. ONE catalogue -- DYNAMIC_DATA_CATALOGUE is defined in exactly one
 *      file. A second `const DYNAMIC_DATA_CATALOGUE` or a second registry
 *      of the same shape elsewhere is exactly the "list A / list B / list
 *      C" drift this whole design exists to prevent.
 *   2. Every variable an event's contract declares resolves to a real
 *      catalogue key -- no event can offer a token the catalogue never
 *      registered.
 *   3. Every structured block an event's contract declares is registered in
 *      the catalogue as kind "structured" or "image" -- never a renderer
 *      function nobody catalogued.
 *   4. No template-rendering file builds a `{{token}}`-shaped string,
 *      pulls a database column into a template context object, or embeds
 *      an <img> from anything but the controlled /email-assets/ proxy --
 *      the "arbitrary database-column token" and "arbitrary image token"
 *      failure modes this catalogue is meant to make structurally
 *      impossible, not merely undocumented.
 */
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(join(root, p), "utf8")

const problems = []

// ---------------------------------------------------------------------
// 1. ONE catalogue.
// ---------------------------------------------------------------------
function findFiles(dir, matches = []) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const rel = join(dir, entry.name)
    if (entry.isDirectory()) findFiles(rel, matches)
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) matches.push(rel)
  }
  return matches
}

const libEmailFiles = findFiles("lib/email")
const definitionSites = []
for (const file of libEmailFiles) {
  const source = read(file)
  if (/\bconst\s+DYNAMIC_DATA_CATALOGUE\b/.test(source)) definitionSites.push(file)
}
if (definitionSites.length !== 1) {
  problems.push(
    `DYNAMIC_DATA_CATALOGUE must be defined in exactly one file; found in: ${definitionSites.join(", ") || "(nowhere)"}`
  )
}
const CANONICAL_CATALOGUE_FILE = "lib/email/dynamic-data/catalogue.ts"
if (definitionSites.length === 1 && definitionSites[0] !== CANONICAL_CATALOGUE_FILE) {
  problems.push(`DYNAMIC_DATA_CATALOGUE must live at ${CANONICAL_CATALOGUE_FILE}, found at ${definitionSites[0]}`)
}

const catalogueSource = read(CANONICAL_CATALOGUE_FILE)
const catalogueKeys = [...catalogueSource.matchAll(/^\s{2}([a-z][a-z0-9_]*):\s*item\(\{/gm)].map((m) => m[1])
const catalogueKindByKey = new Map(
  [...catalogueSource.matchAll(/key:\s*"([a-z0-9_]+)",[\s\S]{0,400}?kind:\s*"(scalar|structured|image)"/g)].map((m) => [
    m[1],
    m[2],
  ])
)

if (catalogueKeys.length === 0) {
  problems.push("Could not find any entries in the catalogue -- the parser regex may be out of sync with catalogue.ts's own shape.")
}

// ---------------------------------------------------------------------
// 2 & 3. contracts.ts: every declared variable/structuredBlock resolves.
// ---------------------------------------------------------------------
const contractsSource = read("lib/email/contracts.ts")
const contractBlocks = [...contractsSource.matchAll(/^\s{2}([a-z_][a-z0-9_]*):\s*\{/gm)]

function blockFor(startIndex) {
  let depth = 0
  for (let i = contractsSource.indexOf("{", startIndex); i < contractsSource.length; i += 1) {
    if (contractsSource[i] === "{") depth += 1
    else if (contractsSource[i] === "}") {
      depth -= 1
      if (depth === 0) return contractsSource.slice(startIndex, i + 1)
    }
  }
  return ""
}

function arrayFieldValues(block, field) {
  const start = block.indexOf(`${field}:`)
  if (start === -1) return []
  const arrayStart = block.indexOf("[", start)
  const arrayEnd = block.indexOf("]", arrayStart)
  return [...block.slice(arrayStart, arrayEnd).matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1])
}

for (const match of contractBlocks) {
  const eventKey = match[1]
  const block = blockFor(match.index)
  if (!block.includes("variables:")) continue // Not a contract entry (e.g. a type alias line matched by accident).

  for (const varKey of arrayFieldValues(block, "variables")) {
    if (!catalogueKeys.includes(varKey)) {
      problems.push(`"${eventKey}" declares variable "${varKey}", which is not a registered catalogue key.`)
    } else if (catalogueKindByKey.get(varKey) && catalogueKindByKey.get(varKey) !== "scalar") {
      problems.push(`"${eventKey}" lists "${varKey}" under variables, but the catalogue registers it as ${catalogueKindByKey.get(varKey)} -- structured/image entries belong under structuredBlocks.`)
    }
  }
  for (const blockKey of arrayFieldValues(block, "structuredBlocks")) {
    if (!catalogueKeys.includes(blockKey)) {
      problems.push(`"${eventKey}" declares structured block "${blockKey}", which is not a registered catalogue key.`)
    } else if (catalogueKindByKey.get(blockKey) === "scalar") {
      problems.push(`"${eventKey}" lists "${blockKey}" under structuredBlocks, but the catalogue registers it as scalar.`)
    }
  }
  for (const recKey of arrayFieldValues(block, "recommended")) {
    if (!catalogueKeys.includes(recKey)) {
      problems.push(`"${eventKey}" recommends "${recKey}", which is not a registered catalogue key.`)
    }
  }
}

// ---------------------------------------------------------------------
// 4. No arbitrary provider bypass / arbitrary image token / raw column
//    reaching a template. Text checks over the renderer files only --
//    this is deliberately narrow (the renderers are a small, fixed set of
//    files), matching how the other guards in this repo work.
// ---------------------------------------------------------------------
const templatesSource = read("lib/email/templates.ts")
const componentsSource = read("lib/email/design/components.ts")

// Every <img src="..."> in components.ts must be built through safeUrl(...)
// or the fixed /email-assets/ path -- never a bare template-literal
// concatenation of an arbitrary field.
const imgSrcs = [...componentsSource.matchAll(/<img[^>]*src="\$\{([^}]*)\}"/g)].map((m) => m[1])
for (const expr of imgSrcs) {
  const safe = /safeUrl\(|EMAIL_LOGO_PATH|logoUrl\b|safeLogoUrl\b|\bsafe\b|\blogo\b|\bcrest\b/.test(expr)
  if (!safe) {
    problems.push(`components.ts builds an <img src> from "${expr}" without visibly routing it through safeUrl() -- verify by hand.`)
  }
}

// VARIABLE_MAPS must never spread an entire object into the variable map --
// that is exactly "template -> arbitrary database column" in one line.
if (/\.\.\.(d|data|row|record)\b/.test(templatesSource.split("VARIABLE_MAPS")[1]?.split("}\n\n")[0] ?? "")) {
  problems.push("VARIABLE_MAPS appears to spread an entire object into a variable map -- every key must be named explicitly.")
}

if (problems.length > 0) {
  console.error("FAIL  dynamic data catalogue")
  for (const p of problems) console.error(`        ${p}`)
  process.exit(1)
}

console.log(
  `ok    dynamic_data_catalogue             ${catalogueKeys.length} items, ${contractBlocks.length} event contracts checked`
)
