#!/usr/bin/env node
/**
 * TOURNAMENT CENTRE IS ONE SHARED ROLE-AWARE SURFACE, AND ONE CANONICAL MODEL.
 *
 * The same permanent invariant Match Centre, Training Centre and Event Centre
 * carry: every viewer -- parent, guardian, player, team manager, club admin,
 * site admin -- meets the SAME Tournament Centre. Roles and capabilities filter
 * the data and the actions; they never produce a different design or a second
 * implementation.
 *
 * Tournament Centre carries four more invariants of its own, because a
 * tournament is the first surface in the product where one occasion belongs to
 * SEVERAL of our teams at once:
 *
 *   - ONE canonical tournament model. A tournament is never modelled as a
 *     club_event, and never as one fixtures row per festival game.
 *   - OPPONENTS BELONG TO A TEAM'S PARTICIPATION. A game references the
 *     entry's own opponent, never a flat list on the parent.
 *   - MUTATIONS ARE SERVER-AUTHORISED. The client never decides who may
 *     change what; it calls RPCs that re-check.
 *   - THE SAME-TOURNAMENT OVERLAP EXCEPTION STAYS SCOPED. It is decided by
 *     stable parent identity, never by "it is a tournament, so skip it", and
 *     it never turns into a second Pitch Allocation board.
 *
 * STRUCTURE, NOT PIXELS.
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
    else if (/\.(tsx|ts|mjs|sql)$/.test(e.name)) out.push(full)
  }
  return out
}

const appFiles = walk(join(ROOT, "app"))
const libFiles = walk(join(ROOT, "lib"))
const componentFiles = walk(join(ROOT, "components"))

// ---------------------------------------------------------------
// 1. ONE ROUTE, ADDRESSED BY THE TOURNAMENT'S OWN ID.
// ---------------------------------------------------------------
const routes = appFiles.filter((f) => /\/tournaments\/\[[^/]+\]\/page\.tsx$/.test(f))
if (routes.length === 0) {
  failures.push("No Tournament Centre route found. Expected app/(app)/tournaments/[tournamentId]/page.tsx.")
} else if (routes.length > 1) {
  failures.push(`Tournament Centre must have ONE route; found ${routes.length}:\n  ${routes.map((r) => relative(ROOT, r)).join("\n  ")}`)
} else if (!/\[tournamentId\]/.test(routes[0])) {
  failures.push(`Tournament Centre must be addressed by the tournament's own id, not by ${relative(ROOT, routes[0])}.`)
}

// ---------------------------------------------------------------
// 2. NO ROLE-NAMED COPY OF THE SURFACE.
// ---------------------------------------------------------------
const ROLE_WORDS = /^(parent|player|guardian|coach|staff|team-admin|teamadmin|club-admin|clubadmin|site-admin|siteadmin|admin)/i
// The canonical surfaces, named for what they DO rather than for who may use
// them. Anything else under a tournament path that is named for a ROLE is the
// copy this guard exists to catch.
const ALLOWED = /(management-bar|manage-view|tournament-details-form|tournament-centre-view|opposition|schedule|pitches-panel|hero|view-model|actions|page|edit|new)\.(tsx|ts)$/
// Scoped to the Tournament Centre surface itself. Site Admin's own fixture
// tooling lives under app/(app)/admin/ and legitimately mentions tournaments;
// it is a different surface with a different job, not a role-copy of this one.
const SURFACE = /^(app\/\(app\)\/tournaments\/|components\/tournaments\/)/
for (const f of [...appFiles, ...componentFiles]) {
  const rel = relative(ROOT, f)
  if (!SURFACE.test(rel)) continue
  for (const segment of rel.split("/")) {
    const name = segment.replace(/\.(tsx|ts)$/, "")
    if (ROLE_WORDS.test(name) && !ALLOWED.test(segment)) {
      failures.push(`Role-named Tournament Centre file or directory: ${rel} (segment "${segment}"). Tournament Centre is one shared surface; roles filter data, never files.`)
      break
    }
  }
}

// A page under the tournament route family that is NOT one of the canonical
// ones is a second implementation, however it is named.
const CANONICAL_PAGES = [
  "app/(app)/tournaments/[tournamentId]/page.tsx",
  "app/(app)/tournaments/[tournamentId]/edit/page.tsx",
  "app/(app)/tournaments/new/page.tsx",
]
for (const f of appFiles) {
  const rel = relative(ROOT, f)
  if (!/\/tournaments\//.test(rel) || !/\/page\.tsx$/.test(rel)) continue
  if (!CANONICAL_PAGES.includes(rel)) {
    failures.push(`Extra Tournament route: ${rel}. One tournament is one canonical route plus its create and manage pages.`)
  }
}

// ---------------------------------------------------------------
// 3. NO WHOLE-SURFACE ROLE BRANCH.
// ---------------------------------------------------------------
// The failure this catches is `if (role === "PARENT") return <ParentTournamentCentre />`.
for (const f of [...appFiles, ...componentFiles]) {
  if (!/tournament/i.test(relative(ROOT, f))) continue
  const src = readFileSync(f, "utf8")
  if (/return\s+<\s*(Parent|Player|Guardian|Coach|Staff|Admin)[A-Za-z]*Tournament/.test(src)) {
    failures.push(`${relative(ROOT, f)} returns a role-specific Tournament Centre. The surface is shared; the payload is filtered.`)
  }
}

// ---------------------------------------------------------------
// 4. A TOURNAMENT IS NOT A CLUB EVENT.
// ---------------------------------------------------------------
// Modelling a tournament by writing club_events rows would give it Event
// Centre's semantics and lose every rugby-specific one.
for (const f of [...appFiles, ...libFiles]) {
  const rel = relative(ROOT, f)
  if (!/tournament/i.test(rel)) continue
  const src = readFileSync(f, "utf8")
  if (/\bclub_events\b/.test(src) || /save_club_event/.test(src)) {
    failures.push(`${rel} touches club_events. A tournament has its own model; Event Centre is for social and club occasions.`)
  }
}

// ---------------------------------------------------------------
// 5. A TOURNAMENT GAME IS NOT A FIXTURE.
// ---------------------------------------------------------------
// Creating a fixtures row per festival game would mint a conversation, enter
// mirror-fixture pairing, and open a two-club result workflow per 20 minutes
// of rugby.
const writeSurfaces = [
  join(ROOT, "app/(app)/tournaments/actions.ts"),
  join(ROOT, "lib/app-context/tournament-centre-data.ts"),
  join(ROOT, "lib/tournaments/view-model.ts"),
]
for (const f of writeSurfaces) {
  if (!existsSync(f)) continue
  const src = readFileSync(f, "utf8")
  if (/from\(["']fixtures["']\)|insert into public\.fixtures/.test(src)) {
    failures.push(`${relative(ROOT, f)} writes fixtures. Tournament games are their own records -- see the tournament_games comment.`)
  }
}

// ---------------------------------------------------------------
// 6. OPPONENTS BELONG TO A TEAM'S PARTICIPATION.
// ---------------------------------------------------------------
// The schema is what actually enforces this; the guard checks the schema still
// says so, because a later migration relaxing it would silently reintroduce
// "every one of our teams plays everyone".
const migrations = walk(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql"))
const migrationSrc = migrations.map((f) => readFileSync(f, "utf8")).join("\n")
if (!/create table if not exists public\.tournament_entry_opponents/.test(migrationSrc)) {
  failures.push("public.tournament_entry_opponents is not created by any migration. Opponents must belong to a team's participation.")
}
if (!/opponent_id\s+uuid not null references public\.tournament_entry_opponents/.test(migrationSrc)) {
  failures.push("tournament_games.opponent_id must reference tournament_entry_opponents, so a game is always against that team's own opponent.")
}
if (!/create table if not exists public\.tournament_team_entries/.test(migrationSrc)) {
  failures.push("public.tournament_team_entries is not created by any migration. One occasion must be able to carry several of our teams.")
}

// ---------------------------------------------------------------
// 7. WRITES GO THROUGH SERVER-AUTHORISED RPCS.
// ---------------------------------------------------------------
// No INSERT/UPDATE/DELETE policy on the tournament tables, and no client-side
// table write. Authority is decided in the database, once.
if (/create policy [a-z_]+ on public\.tournament_(team_entries|entry_opponents|games|pitches)\s*\n?\s*for (insert|update|delete)/i.test(migrationSrc)) {
  failures.push("A tournament table has a write policy. Every mutation must go through the SECURITY DEFINER RPCs, which hold the authority split.")
}
for (const f of [...appFiles, ...componentFiles]) {
  const rel = relative(ROOT, f)
  if (!/tournament/i.test(rel)) continue
  const src = readFileSync(f, "utf8")
  if (/\.from\(["']tournament_(team_entries|entry_opponents|games|pitches)["']\)\s*\.\s*(insert|update|upsert|delete)/.test(src)) {
    failures.push(`${rel} writes a tournament table directly. Use the canonical RPC, which re-checks authority.`)
  }
}

// ---------------------------------------------------------------
// 8. THE SAME-TOURNAMENT OVERLAP EXCEPTION STAYS SCOPED.
// ---------------------------------------------------------------
const conflictFile = join(ROOT, "lib/pitch-allocation/tournament-conflicts.ts")
if (!existsSync(conflictFile)) {
  failures.push("lib/pitch-allocation/tournament-conflicts.ts is missing -- the sibling-overlap exception has no home.")
} else {
  const src = readFileSync(conflictFile, "utf8")
  if (!/siblingReservations/.test(src)) {
    failures.push("tournament-conflicts.ts no longer uses siblingReservations. The exception must be decided by stable parent identity.")
  }
  // THE DANGEROUS SHORTCUT: waving a reservation through because of its KIND.
  // The file legitimately WRITES `kind: "tournament"` when it builds occupants;
  // what it must never do is TEST it, because "is a tournament" is not the same
  // question as "is the same tournament".
  if (/kind\s*===\s*["']tournament["']/.test(src)) {
    failures.push("tournament-conflicts.ts tests `kind === \"tournament\"`. The overlap exception is same-PARENT only, never kind-based.")
  }
}
const occupancy = readFileSync(join(ROOT, "lib/pitch-allocation/occupancy.ts"), "utf8")
if (!/tournamentId !== null && b\.tournamentId !== null/.test(occupancy)) {
  failures.push("occupancy.ts's siblingReservations no longer requires BOTH sides to be tournaments -- a non-tournament could be waved through.")
}

// ---------------------------------------------------------------
// 9. ONE PITCH ALLOCATION BOARD.
// ---------------------------------------------------------------
const boards = appFiles.filter((f) => /pitch-allocation-board\.tsx$/.test(f))
if (boards.length > 1) {
  failures.push(`There must be ONE Pitch Allocation board; found ${boards.length}. A tournament renders on the shared board, never on its own.`)
}
for (const f of appFiles) {
  const rel = relative(ROOT, f)
  if (/tournament/i.test(rel) && /pitch-allocation/i.test(rel)) {
    failures.push(`${rel} looks like a tournament-specific Pitch Allocation surface. One scheduling surface.`)
  }
}

// ---------------------------------------------------------------
// 10. THE CALENDAR OPENS TOURNAMENT CENTRE.
// ---------------------------------------------------------------
const weekBoard = join(ROOT, "app/(app)/calendar/week-board.tsx")
if (existsSync(weekBoard)) {
  const src = readFileSync(weekBoard, "utf8")
  if (!/tournamentCentreHref/.test(src)) {
    failures.push("week-board.tsx no longer exposes tournamentCentreHref. A tournament on the Calendar must open Tournament Centre.")
  }
}

if (failures.length > 0) {
  console.error("Tournament Centre shared-surface check FAILED:\n")
  for (const f of failures) console.error(`  - ${f}\n`)
  process.exit(1)
}
console.log("Tournament Centre shared-surface check passed (1 route, one model, one board, opponents per team, server-authorised writes, scoped overlap exception).")
