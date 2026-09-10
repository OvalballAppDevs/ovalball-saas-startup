#!/usr/bin/env node
/**
 * MATCH CENTRE IS ONE SHARED ROLE-AWARE SURFACE.
 *
 * A permanent Ovalball invariant: every viewer -- parent, guardian, adult
 * player, a 16-17 player where permitted, team admin, team manager, coach,
 * club admin, club manager, site admin -- meets the SAME Match Centre. Roles
 * and capabilities filter the data and the actions; they never produce a
 * different design or a second implementation.
 *
 * The failure this exists to catch is gradual and plausible: somebody needs a
 * small change for one role, copies the page into `player/` or `staff/`,
 * changes four lines, and ships. Nothing breaks that day. What breaks is the
 * next redesign, which lands on one of the copies and silently leaves the
 * others behind -- and by then two roles are looking at two different
 * products and nobody meant it to happen.
 *
 * So this checks structure, not pixels. There are no visual snapshots here:
 * they are brittle, they fail for reasons nobody cares about, and they get
 * switched off. What is checked is that there is one fixture route, one set of
 * Match Centre components, and no branch that picks a whole Match Centre by
 * role name.
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
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

const files = walk(join(ROOT, "app")).concat(walk(join(ROOT, "components")), walk(join(ROOT, "lib")))

// ---------------------------------------------------------------------------
// 1. ONE FIXTURE ROUTE
// ---------------------------------------------------------------------------
//
// A wrapper route for navigation is fine, but it must render the canonical
// Match Centre rather than carry its own. Two page.tsx files under a
// [fixtureId] segment that both build a fixture page is the copy this guard
// is looking for.

const fixturePages = files.filter((f) => /\[fixtureId\][/\\]page\.tsx$/.test(f))
const substantialFixturePages = fixturePages.filter((f) => {
  const src = readFileSync(f, "utf8")
  // A thin wrapper re-exports or renders the canonical implementation. A real
  // second Match Centre reaches for the shared parts itself.
  return /match-centre\//.test(src) || /loadMatchCentre|match-centre-data/.test(src)
})

if (substantialFixturePages.length > 1) {
  failures.push(
    `More than one Match Centre implementation exists:\n    ${substantialFixturePages
      .map((f) => relative(ROOT, f))
      .join("\n    ")}\n  Roles filter data and actions; they do not get their own fixture page.`
  )
}

// ---------------------------------------------------------------------------
// 2. ONE SET OF COMPONENTS
// ---------------------------------------------------------------------------

const componentDirs = new Set()
for (const f of files) {
  const rel = relative(ROOT, f).replace(/\\/g, "/")
  const m = rel.match(/^(.*match-centre)\//)
  if (m) componentDirs.add(m[1])
}
if (componentDirs.size > 1) {
  failures.push(
    `Match Centre components exist in more than one place:\n    ${[...componentDirs].join(
      "\n    "
    )}\n  Build them once; a per-role copy is how a redesign reaches one viewer and not the others.`
  )
}

// A role-named copy of any Match Centre part, wherever it sits.
const ROLE_PREFIXED = /\b(Parent|Player|Staff|Club|Guardian|Coach|Admin)(MatchCentre|FixtureHero|AttendancePanel|ParticipantList|VenueBlock|WeatherCard|MatchConditions|CommunicationPanel|MessagingPanel)\b/
for (const f of files) {
  const src = readFileSync(f, "utf8")
  const m = src.match(ROLE_PREFIXED)
  if (m) {
    failures.push(`${relative(ROOT, f)}: "${m[0]}" is a role-specific Match Centre component. One component, capability-driven.`)
  }
}

// ---------------------------------------------------------------------------
// 3. NO WHOLE-SURFACE BRANCH ON A ROLE NAME
// ---------------------------------------------------------------------------
//
// Deliberately narrow: it looks for a role comparison that RETURNS a Match
// Centre, not for role comparisons in general, which are legitimate all over
// the product for wording and for optional sections.

const ROLE_BRANCH = /(role|kind|context)\s*===\s*["'](PARENT|PLAYER|TEAM_ADMIN|CLUB_ADMIN|COACH|parent|player|staff)["']\s*\)?\s*(\?|&&|\)\s*return)[^\n]*MatchCentre/
for (const f of files) {
  const src = readFileSync(f, "utf8")
  if (ROLE_BRANCH.test(src)) {
    failures.push(`${relative(ROOT, f)}: a whole Match Centre is chosen by role name. Pass capabilities into one component instead.`)
  }
}

// ---------------------------------------------------------------------------
// 4. THE SHARED PARTS ARE ACTUALLY SHARED
// ---------------------------------------------------------------------------

// The canonical Match Centre is the fixture page that renders the shared
// components -- not merely the first [fixtureId] route on disk. Site Admin's
// fixture RECORD editor also lives under a [fixtureId] segment and is a
// different surface: it administers the fixture row, it is not the match-day
// page a parent, player or coach opens.
const canonical = substantialFixturePages[0]
if (!canonical) {
  failures.push("No fixture Match Centre route was found at all, which is not something this guard can be right about.")
} else {
  const src = readFileSync(canonical, "utf8")
  // venue-block and weather-card were merged into match-conditions: where the
  // match is and what the weather will do are one question, so they are one
  // section. The guard follows the components, exactly as the note above
  // says it should -- and is WIDER than before, not narrower: communication-
  // panel is now covered too, so the consolidated staff composer cannot be
  // forked per role either.
  const required = ["attendance-panel", "hero", "participant-list", "match-conditions", "communication-panel"]
  const missing = required.filter((c) => !src.includes(c))
  if (missing.length > 0) {
    failures.push(
      `${relative(ROOT, canonical)} no longer renders the shared Match Centre components: ${missing.join(
        ", "
      )}. If they moved, move this check with them.`
    )
  }
}

if (failures.length > 0) {
  console.error("  FAIL  match_centre_shared")
  for (const f of failures) console.error(`          ${f}`)
  process.exit(1)
}

const routeCount = fixturePages.length
const componentCount = files.filter((f) => /match-centre[/\\]/.test(f)).length
console.log(
  `  ok    match_centre_shared                ${routeCount} fixture route, ${componentCount} shared components, no role-specific copies`
)
