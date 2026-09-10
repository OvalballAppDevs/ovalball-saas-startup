#!/usr/bin/env node
/**
 * EVENT CENTRE IS ONE SHARED ROLE-AWARE SURFACE.
 *
 * The same permanent invariant Match Centre and Training Centre carry, applied
 * to the club event: every viewer -- parent, guardian, adult player, coach,
 * team admin, club admin, site admin -- meets the SAME Event Centre. Roles and
 * capabilities filter the data and the actions; they never produce a different
 * design or a second implementation.
 *
 * The failure is gradual and plausible: somebody needs one small change for
 * club admins, copies the page into `admin/`, edits four lines and ships.
 * Nothing breaks that day. What breaks is the next redesign, which lands on
 * one copy and silently leaves the other behind.
 *
 * STRUCTURE, NOT PIXELS. What is checked is that there is one event route, one
 * set of Event Centre components, no role-named copy of any of them, and no
 * branch that picks a whole Event Centre by role.
 *
 * It also checks the two things that make this surface CANONICAL rather than
 * merely single: that the page is addressed by the EVENT's own id, and that a
 * multi-day event is never modelled as one row per day -- the property the
 * whole span projection rests on.
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

// ---------------------------------------------------------------
// 1. ONE ROUTE, ADDRESSED BY THE EVENT'S OWN ID.
// ---------------------------------------------------------------
const routes = walk(join(ROOT, "app")).filter((f) => /\/events\/\[[^/]+\]\/page\.tsx$/.test(f))
if (routes.length === 0) {
  failures.push("No Event Centre route found. Expected app/(app)/events/[eventId]/page.tsx.")
} else if (routes.length > 1) {
  failures.push(`Event Centre must have ONE route; found ${routes.length}:\n  ${routes.map((r) => relative(ROOT, r)).join("\n  ")}`)
} else if (!/\[eventId\]/.test(routes[0])) {
  failures.push(`Event Centre must be addressed by the event's own id, not by ${relative(ROOT, routes[0])}.`)
}

// ---------------------------------------------------------------
// 2. ONE SET OF COMPONENTS, WITH NO ROLE-NAMED COPIES.
// ---------------------------------------------------------------
const COMPONENT_DIR = join(ROOT, "components/events/event-centre")
if (!existsSync(COMPONENT_DIR)) {
  failures.push("components/events/event-centre/ is missing -- Event Centre's shared components live there.")
} else {
  const files = walk(COMPONENT_DIR).map((f) => relative(ROOT, f))
  const ROLE_WORDS = /(^|[/_-])(parent|guardian|player|staff|coach|admin|club|site)([/_.-]|$)/i
  for (const f of files) {
    const base = f.split("/").slice(3).join("/")
    if (ROLE_WORDS.test(base)) {
      failures.push(`Role-named Event Centre component: ${f}. Roles filter data and actions, never the design.`)
    }
  }
}

// ---------------------------------------------------------------
// 3. NO WHOLE-SURFACE ROLE BRANCH.
//
// A capability flag deciding whether a SECTION has anything to show is the
// intended shape. Returning a different Event Centre for a role is not.
// ---------------------------------------------------------------
for (const file of [...routes, ...(existsSync(COMPONENT_DIR) ? walk(COMPONENT_DIR) : [])]) {
  const src = readFileSync(file, "utf8")
  const branch = /return\s*<\s*(Parent|Player|Staff|Coach|Admin|Club|Guardian)[A-Za-z]*EventCentre/.exec(src)
  if (branch) {
    failures.push(`${relative(ROOT, file)} returns a role-specific Event Centre (${branch[1]}...). There is one Event Centre.`)
  }
}

// ---------------------------------------------------------------
// 4. ONE ROW PER EVENT, NOT ONE PER DAY.
//
// The span projection, the single attendance response, the single edit and the
// single cancel all rest on this. A migration introducing a per-day event row
// would break every one of them at once, quietly.
// ---------------------------------------------------------------
const migrations = existsSync(join(ROOT, "supabase/migrations"))
  ? readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql"))
  : []
const eventTableMigration = migrations.find((f) => readFileSync(join(ROOT, "supabase/migrations", f), "utf8").includes("create table if not exists public.club_events"))
if (!eventTableMigration) {
  failures.push("public.club_events is not created by any migration.")
} else {
  const sql = readFileSync(join(ROOT, "supabase/migrations", eventTableMigration), "utf8")
  if (!/starts_on\s+date\s+not null/.test(sql) || !/ends_on\s+date\s+not null/.test(sql)) {
    failures.push("club_events must carry BOTH starts_on and ends_on: the span is the row, never a row per day.")
  }
  if (!/ends_on\s*>=\s*starts_on/.test(sql)) {
    failures.push("club_events must constrain ends_on >= starts_on.")
  }
}

if (failures.length > 0) {
  console.error("  FAIL  event_centre_shared")
  for (const f of failures) console.error(`        ${f}`)
  process.exit(1)
}

console.log("Event Centre shared-surface check passed (1 event route, one implementation, one row per event).")
