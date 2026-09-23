import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

/**
 * WHAT A TEAM IS ASKED TO DEAL WITH.
 *
 * Needs Attention is where exceptional work belongs -- that is the product rule that keeps Fixture
 * Requests and Player Requests out of primary navigation. It only holds if the panel actually shows the
 * work, and one item in it did not: the incoming fixture request count asked for
 * `status = 'pending'`, which is not a value `fixture_requests.status` can hold. The domain is
 * draft/sent/accepted/declined/counter_proposed/cancelled/expired, so the filter matched nothing, no
 * error was raised, and a team was simply never told a request had arrived.
 *
 * THE LESSON IS THE SHAPE, NOT THE TYPO. A string literal compared against a checked column is a claim
 * about that column's domain, and nothing in TypeScript or PostgREST checks it. So this reads the
 * CHECK constraint out of the migration that owns the column and asserts that every status literal the
 * reader uses is in it -- which is the only way this class of defect becomes loud.
 */

const read = (p: string) => readFileSync(p, "utf8")

/**
 * WHERE THE DESTINATION MAP LIVES NOW.
 *
 * It moved into `packages/contracts` so the app resolves notifications through
 * the same table the website does, leaving a re-export behind on the web side.
 * Reading the shim would find nothing and pass nothing, so the candidates are
 * tried in order and a missing map is loud rather than silent.
 */
function destinationMap(): string {
  const candidates = [
    "packages/contracts/src/notifications/destinations.ts",
    "lib/notifications/destinations.ts",
  ]
  for (const candidate of candidates) {
    let body: string
    try {
      body = read(candidate)
    } catch {
      continue
    }
    if (/notificationHref/.test(body)) return body
  }
  assert.fail(`no notification destination map found in ${candidates.join(" or ")}`)
}

/** The domain, from the migration that owns the column rather than from a copy of it here. */
function fixtureRequestStatuses(): string[] {
  const migration = read("supabase/migrations/20260831092000_fixture_requests.sql")
  const check = /status[\s\S]+?not[\s\S]+?null[^,]*?check\s*\(\s*status\s+in\s*\(([^)]*)\)/i.exec(migration)
  assert.ok(check, "could not find the fixture_requests.status domain in its own migration")
  return [...check![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}

test("the status domain is readable from the migration that owns it", () => {
  const statuses = fixtureRequestStatuses()
  assert.ok(statuses.includes("sent"), `sent is missing from [${statuses.join(", ")}]`)
  assert.ok(!statuses.includes("pending"), "'pending' is a real status after all -- this suite's premise is wrong")
})

test("every fixture-request status the team's panel filters on is a real status", () => {
  const source = read("lib/teams/team-overview.ts")
  const statuses = fixtureRequestStatuses()
  // Scoped to the fixture_requests query itself. The file reads several tables and `active` is a real
  // status on another of them, so a file-wide sweep would have to exempt values rather than check them.
  const queries = [...source.matchAll(/\.from\("fixture_requests"\)([\s\S]*?)(?=\.from\("|$)/g)].map((m) => m[1])
  assert.ok(queries.length > 0, "the team panel no longer reads fixture_requests -- check this suite")
  const all = queries.flatMap((q) => [
    ...[...q.matchAll(/\.eq\("status",\s*"([^"]+)"\)/g)].map((m) => m[1]),
    ...[...q.matchAll(/\.in\("status",\s*\[([^\]]*)\]\)/g)].flatMap((m) =>
      [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
    ),
  ])
  assert.ok(all.length > 0, "the team panel no longer filters fixture requests by status -- check this suite")
  for (const s of all) {
    assert.ok(statuses.includes(s), `the team panel filters on status "${s}", which the column cannot hold`)
  }
})

test("a single incoming request leads to that request, not to the register", () => {
  // Section 18: a notification, and Needs Attention, must land on the exact request where accepting and
  // declining happen -- never a generic negotiation list when a precise destination is resolvable. Both
  // routes into this job now resolve the same way.
  const source = read("lib/teams/team-overview.ts")
  assert.match(source, /\/messages\/request\/\$\{/, "a single incoming request does not deep-link to itself")
  const destinations = destinationMap()
  assert.match(
    destinations,
    /\/messages\/request\/\$\{requestId\}/,
    "the notification for the same event resolves somewhere else"
  )
})

test("a request this team SENT is not something this team must answer", () => {
  const source = read("lib/teams/team-overview.ts")
  assert.match(source, /\.eq\("target_team_id", teamId\)/, "the panel counts requests in both directions")
  assert.ok(
    !/requesting_team_id[\s\S]*attention|attention[\s\S]*requesting_team_id/.test(source.slice(0, source.indexOf("availability"))),
    "a request this team sent was put in its own Needs Attention"
  )
})
