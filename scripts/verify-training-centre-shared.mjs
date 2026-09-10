#!/usr/bin/env node
/**
 * TRAINING CENTRE IS ONE SHARED ROLE-AWARE SURFACE.
 *
 * The same permanent invariant Match Centre carries, applied to the training
 * session: every viewer -- parent, guardian, adult player, a 16-17 player
 * where permitted, coach, team admin, club admin, site admin -- meets the SAME
 * Training Centre. Roles and capabilities filter the data and the actions;
 * they never produce a different design or a second implementation.
 *
 * The failure is gradual and plausible: somebody needs one small change for
 * coaches, copies the page into `staff/`, edits four lines and ships. Nothing
 * breaks that day. What breaks is the next redesign, which lands on one copy
 * and silently leaves the other behind.
 *
 * STRUCTURE, NOT PIXELS. No visual snapshots -- they are brittle, they fail
 * for reasons nobody cares about, and they get switched off. What is checked
 * is that there is one training route, one set of Training Centre components,
 * no role-named copy of any of them, and no branch that picks a whole Training
 * Centre by role.
 *
 * It also checks the two things that make this surface CANONICAL rather than
 * merely single: that the page is addressed by the session's own id, and that
 * the Agenda links to it with that same id.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = process.cwd()
const failures = []

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".next" || e.name === ".git") continue
    const full = join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (/\.(tsx|ts)$/.test(e.name)) out.push(full)
  }
  return out
}

const files = walk(join(ROOT, "app"))
  .concat(walk(join(ROOT, "components")), walk(join(ROOT, "lib")))
  .filter((f) => existsSync(f))

const rel = (f) => relative(ROOT, f)

// ---------------------------------------------------------------------------
// 1. ONE TRAINING SESSION ROUTE
// ---------------------------------------------------------------------------
//
// A wrapper route for navigation is fine, but it must converge on the
// canonical page rather than carry its own. Two substantial page.tsx files
// under a [sessionId] segment is the copy this guard is looking for.

const sessionPages = files.filter((f) => /\[sessionId\][/\\]page\.tsx$/.test(f))
const substantial = sessionPages.filter((f) => {
  const src = readFileSync(f, "utf8")
  // A thin wrapper re-exports or renders the canonical page. A real second
  // implementation builds the hero itself.
  return /TrainingCentreHero|training-centre\/hero/.test(src)
})

if (substantial.length === 0) {
  failures.push("No Training Centre route was found at all, which is not something this guard can be right about.")
} else if (substantial.length > 1) {
  failures.push(
    `Training Centre is implemented more than once:\n    ${substantial.map(rel).join("\n    ")}\n  One physical training session is one canonical route.`
  )
}

const canonical = substantial[0] ?? null

// ---------------------------------------------------------------------------
// 2. ONE SET OF COMPONENTS
// ---------------------------------------------------------------------------

const componentDirs = new Set(
  files.filter((f) => /components[/\\]training[/\\]training-centre[/\\]/.test(f)).map((f) => rel(f).split(/[/\\]/).slice(0, 3).join("/"))
)
if (componentDirs.size > 1) {
  failures.push(`Training Centre components live in more than one place:\n    ${[...componentDirs].join("\n    ")}`)
}

// ---------------------------------------------------------------------------
// 3. NO ROLE-NAMED COPY
// ---------------------------------------------------------------------------
//
// Blunt on purpose, and it will flag these names even inside a comment -- so
// prose that needs to discuss them describes them instead of spelling them
// out. A guard that can be talked around is not a guard.

const ROLE_PREFIXED =
  /\b(Parent|Player|Staff|Club|Guardian|Coach|Admin)(TrainingCentre|TrainingHero|TrainingAttendancePanel|WhosTraining|TrainingConditions)\b/
for (const f of files) {
  const m = readFileSync(f, "utf8").match(ROLE_PREFIXED)
  if (m) failures.push(`${rel(f)} defines or references "${m[0]}". Training Centre is one surface; capability filters it.`)
}

// ---------------------------------------------------------------------------
// 4. NO WHOLE-SURFACE ROLE BRANCH
// ---------------------------------------------------------------------------
//
// Filtering DATA by capability is the whole design. Choosing a different
// Training Centre by role name is the thing being prevented.

if (canonical) {
  const src = readFileSync(canonical, "utf8")
  const branch = src.match(/if\s*\(\s*\w*[Rr]ole\s*===?\s*["'][A-Z_]+["']\s*\)\s*(return|\{[^}]*return\s*<)/)
  if (branch) {
    failures.push(`${rel(canonical)} branches on a role name to choose what to render. Capability filters data and actions, never the surface.`)
  }

  // The sections that make it Training Centre rather than a summary card. If
  // one is removed the guard should be updated deliberately, not silently.
  const required = ["training-centre/hero", "training-centre/attendance-panel", "training-centre/whos-training", "match-conditions"]
  const missing = required.filter((c) => !src.includes(c))
  if (missing.length > 0) {
    failures.push(`${rel(canonical)} no longer renders: ${missing.join(", ")}. If that is deliberate, update this guard in the same change.`)
  }

  // ONE VENUE/WEATHER SECTION, SHARED WITH MATCHDAY. Importing the Match
  // Centre component is the point -- a training-flavoured copy of it would
  // drift the first time the map or an unavailable forecast got a fix.
  if (!/match-centre\/match-conditions/.test(src)) {
    failures.push(`${rel(canonical)} does not use the shared match-conditions section. Where and what-it-will-be-like is one component for both surfaces.`)
  }
}

// ---------------------------------------------------------------------------
// 5. THE CANONICAL ID IS THE IDENTITY
// ---------------------------------------------------------------------------
//
// The Agenda must link to Training Centre by the session's own id -- never by
// team, date, venue or the recurrence that generated the occurrence.

const agendaLoad = join(ROOT, "lib/agenda/load.ts")
if (existsSync(agendaLoad)) {
  const src = readFileSync(agendaLoad, "utf8")
  if (!/href:\s*`\/training\/\$\{t\.id\}`/.test(src)) {
    failures.push(
      "lib/agenda/load.ts no longer links training to /training/${t.id}. Agenda, Scheduler and Training Centre must address one session by one id."
    )
  }
  if (/\/training\/\$\{[^}]*(team|plan|schedule|date|venue)/i.test(src)) {
    failures.push("lib/agenda/load.ts appears to address Training Centre by something other than the session id.")
  }
}

// ---------------------------------------------------------------------------
// 6. ONE AVAILABILITY CONTROL
// ---------------------------------------------------------------------------
//
// Matchday and training ask the same question. They must ask it with the same
// control, or the two will drift the first time one gets a better focus ring.

const shared = join(ROOT, "components/shared/availability-choice.tsx")
if (!existsSync(shared)) {
  failures.push("components/shared/availability-choice.tsx is missing. Both attendance panels render it.")
} else {
  const consumers = files.filter((f) => /availability-choice/.test(readFileSync(f, "utf8")) && !f.endsWith("availability-choice.tsx"))
  const usesMatch = consumers.some((f) => /match-centre/.test(rel(f)))
  const usesTraining = consumers.some((f) => /training-centre/.test(rel(f)))
  if (!usesMatch || !usesTraining) {
    failures.push(
      `The shared availability control is not rendered by both surfaces (matchday: ${usesMatch}, training: ${usesTraining}). Two copies of these three buttons will drift.`
    )
  }
}

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error("Training Centre shared-surface check FAILED:\n")
  for (const f of failures) console.error(`  - ${f}\n`)
  process.exit(1)
}

console.log(`Training Centre shared-surface check passed (${sessionPages.length} training route${sessionPages.length === 1 ? "" : "s"}, one implementation).`)
