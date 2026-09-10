#!/usr/bin/env node
/**
 * PITCH ALLOCATION IS ONE SHARED SCHEDULING SURFACE.
 *
 * The permanent rule: roles and capabilities filter ACTIONS. They do not
 * create different views, different occupancy calculations or separate
 * implementations. The same physical fixture occupies the same pitch for the
 * same minutes for every authorised viewer.
 *
 * WHY THIS GUARD EXISTS, SPECIFICALLY.
 *
 * The occupancy interval -- kickoff minus warm-up, through kick-off plus
 * duration plus pack-up -- had been written out longhand in FOUR places: the
 * auto-allocator's placement loop, its own detectConflicts, the resource
 * conflict detector, and again in pixels inside the board component. All four
 * agreed on the day they were written, which is the dangerous kind of
 * duplication: it diverges later, quietly, when one is changed and three are
 * not. A board that DRAWS a pack-up the conflict detector does not TEST is
 * worse than no pack-up at all, because it looks correct.
 *
 * So this checks four structural properties:
 *
 *   1. One route and one board component -- no role-named copies.
 *   2. No whole-surface role branch.
 *   3. Every occupancy calculation goes through lib/pitch-allocation/occupancy.
 *   4. Warm-up and pack-up durations are never hardcoded where the canonical
 *      club_scheduling_policy setting exists.
 *
 * STRUCTURE, NOT PIXELS. No visual snapshots -- they are brittle, fail for
 * reasons nobody cares about, and get switched off.
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

const appFiles = walk(join(ROOT, "app"))
const libFiles = walk(join(ROOT, "lib/pitch-allocation"))

// ---------------------------------------------------------------
// 1. ONE ROUTE, ONE BOARD.
// ---------------------------------------------------------------
// EVERY route under a pitch-allocation directory, at any depth -- so a copy
// tucked into `pitch-allocation/club-admin/page.tsx` is counted rather than
// slipping past a pattern that only matched the exact top-level path.
//
// club/settings/pitch-allocation is the settings FORM: a different surface
// with a different job, deliberately not counted here.
const routes = appFiles.filter((f) => /pitch-allocation\/.*page\.tsx$/.test(f) && !/settings\//.test(f))
if (routes.length === 0) {
  failures.push("No Pitch Allocation route found.")
} else if (routes.length > 1) {
  failures.push(`Pitch Allocation must have ONE route; found ${routes.length}:\n  ${routes.map((r) => relative(ROOT, r)).join("\n  ")}`)
}

// A role word ANYWHERE in a pitch-allocation path, before or after -- both
// `club-admin-board.tsx` and `pitch-allocation/club-admin/page.tsx` are the
// same mistake.
const ROLE_WORDS = /(^|[/_-])(parent|guardian|player|staff|coach|club-admin|team-admin|site-admin|admin)([/_.-]|$)/i
for (const f of [...appFiles, ...libFiles]) {
  const rel = relative(ROOT, f)
  if (/settings\//.test(rel)) continue
  if (/pitch-allocation/i.test(rel) && ROLE_WORDS.test(rel)) {
    failures.push(`Role-named Pitch Allocation implementation: ${rel}. Context changes scope, data and actions -- never the implementation.`)
  }
}

// ---------------------------------------------------------------
// 2. NO WHOLE-SURFACE ROLE BRANCH.
// ---------------------------------------------------------------
for (const f of [...routes, ...appFiles.filter((x) => /pitch-allocation/.test(x))]) {
  const src = readFileSync(f, "utf8")
  const branch = /return\s*<\s*(Parent|Player|Staff|Coach|Admin|Club|Site|Team)[A-Za-z]*(PitchAllocation|Board)/.exec(src)
  if (branch) {
    failures.push(`${relative(ROOT, f)} returns a role-specific Pitch Allocation (${branch[1]}...). There is one board.`)
  }
}

// ---------------------------------------------------------------
// 3. ONE OCCUPANCY CALCULATION.
//
// The signature of the duplicated arithmetic is a warm-up subtraction or a
// pack-up addition appearing anywhere OTHER than the canonical primitive.
// ---------------------------------------------------------------
const OCCUPANCY_MODULE = join(ROOT, "lib/pitch-allocation/occupancy.ts")
if (!existsSync(OCCUPANCY_MODULE)) {
  failures.push("lib/pitch-allocation/occupancy.ts is missing -- it is the one place the occupied window is calculated.")
} else {
  const DUPLICATE = /[-+]\s*(?:\w+\.)*(warmUpMinutes|packUpMinutes)\b/
  const candidates = [...libFiles, ...appFiles.filter((f) => /pitch-allocation|calendar/.test(f))]
  for (const f of candidates) {
    const rel = relative(ROOT, f)
    if (rel.endsWith("lib/pitch-allocation/occupancy.ts")) continue
    if (rel.endsWith(".verify.ts")) continue
    const src = readFileSync(f, "utf8")
    for (const [i, line] of src.split("\n").entries()) {
      if (line.trim().startsWith("*") || line.trim().startsWith("//")) continue
      if (DUPLICATE.test(line)) {
        failures.push(
          `${rel}:${i + 1} recomputes the occupied window from warm-up/pack-up directly. Import fixtureOccupiedWindow from lib/pitch-allocation/occupancy instead, so the board, the conflict detector and the allocator cannot disagree.`
        )
      }
    }
  }
}

// ---------------------------------------------------------------
// 4. DURATIONS COME FROM THE CANONICAL SETTING, NEVER A LITERAL.
//
// public.club_scheduling_policy.warm_up_minutes / pack_up_minutes are the
// source of truth, configured under Club Settings. A number written into the
// code is a second setting nobody can change.
// ---------------------------------------------------------------
const HARDCODED = /(warmUpMinutes|packUpMinutes)\s*[:=]\s*([1-9]\d*)/
for (const f of [...libFiles, ...appFiles.filter((x) => /pitch-allocation/.test(x))]) {
  const rel = relative(ROOT, f)
  if (rel.endsWith(".verify.ts")) continue // fixtures deliberately pin numbers
  const src = readFileSync(f, "utf8")
  for (const [i, line] of src.split("\n").entries()) {
    if (line.trim().startsWith("*") || line.trim().startsWith("//")) continue
    const hit = HARDCODED.exec(line)
    if (hit) {
      failures.push(
        `${rel}:${i + 1} hardcodes ${hit[1]} = ${hit[2]}. These come from public.club_scheduling_policy, configured in Club Settings -- a literal here is a second setting nobody can change.`
      )
    }
  }
}

if (failures.length > 0) {
  console.error("  FAIL  pitch_allocation_shared")
  for (const f of failures) console.error(`        ${f}`)
  process.exit(1)
}

console.log("Pitch Allocation shared-surface check passed (1 route, one board, one occupancy primitive, no hardcoded durations).")
