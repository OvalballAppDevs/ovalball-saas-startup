// =====================================================================
// A NUMBERED BROWSER SUITE CANNOT SILENTLY EXIST OUTSIDE THE GATE
//
// Convergence Step 7 found twenty-seven permanent fixture-operations browser
// suites that were not in the release runner. Twelve of them were failing.
// Nothing reported that, because nothing ran them -- every browser claim in
// that part of the programme rested on somebody having run a script by hand at
// some point and remembered the result.
//
// The obvious fix is "remember to add it to the runner too". That is the fix
// that already failed twenty-seven times, because it asks a person to keep two
// lists in step from memory. So there is one list -- BROWSER_SUITES in
// scripts/run-platform-tests.sh -- and this check makes anything outside it a
// DECLARATION rather than an omission.
//
// It also holds the canonical way a suite reaches axe-core, for the same
// reason: one suite was once written with an absolute path into the generated
// job directory it happened to be produced in. That directory no longer
// exists, so the accessibility check it performed silently stopped happening
// and the suite went on passing. A path that is correct only on the machine
// that wrote it is not a dependency.
// =====================================================================

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const bvDir = path.join(here, "browser-verification")
const runner = path.join(here, "run-platform-tests.sh")
const registryPath = path.join(bvDir, "suite-registry.json")

const failures = []
const notes = []

// ---------------------------------------------------------------------
// The one list, read from the runner itself rather than copied.
// ---------------------------------------------------------------------
const runnerText = fs.readFileSync(runner, "utf8")
const block = /^BROWSER_SUITES=\(\n([\s\S]*?)^\)/m.exec(runnerText)
if (!block) {
  failures.push("run-platform-tests.sh no longer declares BROWSER_SUITES=( ... ) -- this check cannot see what the gate runs")
}
const listed = new Set(
  (block?.[1] ?? "")
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter((l) => /^[0-9]/.test(l)),
)

const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"))
const exempt = registry.exempt ?? {}

// A NUMBERED file is the shape this programme uses for a permanent suite.
// Helpers (harness.mjs, fixture-world.mjs, resource.mjs) are not suites and
// are deliberately not counted.
const onDisk = fs
  .readdirSync(bvDir)
  .filter((f) => /^[0-9]+-.*\.mjs$/.test(f))
  .map((f) => f.replace(/\.mjs$/, ""))
  .sort()

for (const suite of onDisk) {
  if (listed.has(suite)) continue
  const reason = exempt[suite]
  if (!reason) {
    failures.push(
      `${suite} is a permanent browser suite that neither runs in the release gate nor is declared in ` +
        `scripts/browser-verification/suite-registry.json. Add it to BROWSER_SUITES, or declare it there with the reason.`,
    )
  } else if (reason.trim().length < 40) {
    failures.push(`${suite} is declared exempt, but "${reason}" does not say enough for the next reader to act on it`)
  }
}

for (const suite of listed) {
  if (!onDisk.includes(suite)) {
    failures.push(`${suite} is in BROWSER_SUITES but scripts/browser-verification/${suite}.mjs does not exist`)
  }
  if (exempt[suite]) {
    failures.push(`${suite} is both run by the gate and declared exempt from it -- the declaration is stale`)
  }
}

for (const suite of Object.keys(exempt)) {
  if (!onDisk.includes(suite)) {
    failures.push(`${suite} is declared in suite-registry.json but no such suite exists -- the declaration outlived the file`)
  }
}

// ---------------------------------------------------------------------
// ONE WAY TO REACH AXE, AND NO ABSOLUTE PATHS ANYWHERE.
// ---------------------------------------------------------------------
for (const file of fs.readdirSync(bvDir).filter((f) => f.endsWith(".mjs"))) {
  const full = path.join(bvDir, file)
  const text = fs.readFileSync(full, "utf8")
  const lines = text.split("\n")
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "")
    if (/axe(-core)?[/.]?.*axe\.min\.js/.test(code) && file !== "harness.mjs") {
      failures.push(`${file}:${i + 1} resolves axe-core itself -- import { axeSource } from "./harness.mjs" instead`)
    }
    // An absolute path anywhere in a suite is a path that is true on one
    // machine. The job-directory shape is the one that has actually bitten.
    const abs = /(["'`])(\/(?:Users|home|private\/tmp|tmp)\/[^"'`\n]+)\1/.exec(code)
    if (abs) {
      failures.push(`${file}:${i + 1} hard-codes the absolute path ${abs[2]} -- resolve it relative to import.meta.url`)
    }
  })
}

notes.push(`${listed.size} suites run in the release gate`)
notes.push(`${Object.keys(exempt).length} declared exempt`)
notes.push(`${onDisk.length} numbered suites on disk`)

if (failures.length > 0) {
  console.log("FAIL  browser suite registry")
  for (const f of failures) console.log(`        ${f}`)
  process.exit(1)
}

console.log(`PASS  browser suite registry — ${notes.join(", ")}`)
