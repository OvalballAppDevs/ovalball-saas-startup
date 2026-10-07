import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * THE JOURNEY HAS ONE DOOR PER STEP (20270743000000; the owner's brief of 2026-10-05).
 *
 *   invite -> signup/login -> guardian/child -> club membership -> team request -> prerequisite approvals
 *   -> referral attribution -> partnership request -> reward qualification
 *
 * The server decides every outcome (supabase/tests/one_door_for_claims_and_referrals.sql, team_code_requests,
 * age_dispensation_workflow, referral_link_attribution prove what it decides). What this proves is that the
 * website and the app can reach each step only through the SAME server function, so they cannot produce
 * different business outcomes -- and that no client writes the journey's tables itself:
 *
 *   J1  no client writes a journey table directly; the one exception (a person's own request for a club the
 *       directory does not have, at signup) is named, and its review fields are the server's
 *   J2  each step is one server function, and every website and app caller reaches it through that function
 *   J3  a claim's referral link is resolved by the server, never by a client
 *   J4  the retired doors stay shut: no client inserts a claim, a join request or a partnership, and nothing
 *       calls the retired staged dispensation chain
 */

const ROOTS = ["app", "lib", "components", "packages/contracts/src", "apps/mobile/src", "apps/mobile/app"]
const read = (p: string) => readFileSync(p, "utf8")
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

function sources(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (/\.(ts|tsx|mts)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(p)
    }
  }
  for (const r of ROOTS) walk(r)
  return out
}
const SOURCES = sources()

const JOURNEY_TABLES = [
  "club_claims", "club_join_requests", "club_partnerships", "club_ovalball_invitations", "platform_referrals",
  "access_invitations", "invitation_redemptions", "player_team_memberships", "player_team_dispensation",
  "guardians", "club_memberships", "role_assignments", "players", "directory_requests",
]
/** The one direct write left, named: signup's request for a club the directory does not have. */
const ALLOWED_DIRECT_WRITES = new Set(["lib/signup/complete-signup.ts directory_requests insert"])

test("J1 no client writes a journey table directly", () => {
  const from = new RegExp(String.raw`\.from\(\s*["'](${JOURNEY_TABLES.join("|")})["']\s*\)`, "g")
  const found: string[] = []
  for (const p of SOURCES) {
    const s = code(p)
    for (const m of s.matchAll(from)) {
      const chain = s.slice(m.index! + m[0].length, m.index! + m[0].length + 260).split(/\.from\(|\n\s*\n|;\s*\n/)[0]
      const write = /\.(insert|upsert|update|delete)\(/.exec(chain)
      if (write) found.push(`${p} ${m[1]} ${write[1]}`)
    }
  }
  assert.deepEqual(found.filter((f) => !ALLOWED_DIRECT_WRITES.has(f)), [], "a client writes a journey table itself")
  assert.deepEqual(found, [...ALLOWED_DIRECT_WRITES], "the one named exception is still the only one")
  // ...and the exception's review fields are the server's.
  const migration = read("supabase/migrations/20270743000000_one_door_for_claims_requests_and_referrals.sql")
  assert.match(migration, /create trigger directory_requests_review_is_the_server_s\s+before insert on public\.directory_requests/)
})

/** Where a module reaches a step: it names the server function, or imports the shared contract function that does
 *  (from its module or the package index that re-exports it). */
function reaches(file: string, rpc: string, viaContract?: { fn: string; module: string }) {
  const s = code(file)
  return s.includes(`rpc("${rpc}"`) || (!!viaContract && new RegExp(String.raw`\b${viaContract.fn}\b`).test(s) && s.includes(viaContract.module))
}

const STEPS: { step: string; rpc: string; contract?: { file: string; fn: string; module: string }; web: string[]; app: string[] }[] = [
  {
    step: "redeem an invitation or a team code",
    rpc: "redeem_invitation",
    contract: { file: "packages/contracts/src/invitations/redeem.ts", fn: "redeemInvitation", module: "@ovalball/contracts/invitations" },
    web: ["lib/invitations/redeem.ts"],
    app: ["apps/mobile/app/join.tsx"],
  },
  {
    step: "claim a club (the Clubhouse, and signup)",
    rpc: "submit_club_claim",
    web: ["app/(app)/clubhouse/claim-actions.ts", "lib/signup/complete-signup.ts"],
    app: ["apps/mobile/src/clubhouse/claims.ts"],
  },
  {
    step: "ask to join a club at signup",
    rpc: "request_club_membership",
    web: ["lib/signup/complete-signup.ts"],
    app: [], // signup is the website's: the app sends a new person there
  },
  {
    step: "refer a club by name",
    rpc: "create_partner_invitation",
    contract: { file: "packages/contracts/src/clubhouse/actions.ts", fn: "inviteClubToOvalball", module: "@ovalball/contracts/clubhouse" },
    web: ["app/(app)/clubhouse/actions.ts"],
    app: ["apps/mobile/src/clubhouse/refer-flow.tsx"],
  },
  {
    step: "ask another club to partner",
    rpc: "request_club_partnership",
    contract: { file: "packages/contracts/src/clubhouse/actions.ts", fn: "requestPartnership", module: "@ovalball/contracts/clubhouse" },
    web: ["app/(app)/clubhouse/actions.ts"],
    app: ["apps/mobile/app/(tabs)/clubhouse/club/[directoryId].tsx"],
  },
  {
    step: "answer a partnership request",
    rpc: "respond_to_club_partnership",
    contract: { file: "packages/contracts/src/clubhouse/actions.ts", fn: "respondToPartnership", module: "@ovalball/contracts/clubhouse" },
    web: ["app/(app)/clubhouse/actions.ts"],
    app: ["apps/mobile/app/(tabs)/clubhouse/club/[directoryId].tsx"],
  },
  {
    step: "a parent confirms their child's team request",
    rpc: "confirm_team_place_request",
    contract: { file: "packages/contracts/src/team/team-code.ts", fn: "confirmChildTeamRequest", module: "@ovalball/contracts/team/team-code" },
    web: ["app/(app)/parent/team-requests/actions.ts"],
    app: ["apps/mobile/src/family/team-request.tsx"],
  },
  {
    step: "the team decides a place",
    rpc: "approve_pending_team_membership",
    contract: { file: "packages/contracts/src/team/people.ts", fn: "approveTeamPlaceRequest", module: "@ovalball/contracts/team/people" },
    web: ["app/(app)/teams/[teamId]/actions.ts"],
    app: ["apps/mobile/src/team/place-requests.tsx"],
  },
  {
    step: "the club decides a join request",
    rpc: "decide_club_join_request",
    contract: { file: "packages/contracts/src/club/people.ts", fn: "decideJoinRequest", module: "@ovalball/contracts/club/people" },
    web: ["app/(app)/people/actions.ts"],
    app: ["apps/mobile/app/(tabs)/admin/people/index.tsx"],
  },
  {
    step: "ask for, and decide, an age-grade dispensation",
    rpc: "decide_dispensation",
    contract: { file: "packages/contracts/src/team/dispensation.ts", fn: "decideDispensation", module: "@ovalball/contracts/team/dispensation" },
    web: ["app/(app)/dispensations/actions.ts"],
    app: ["apps/mobile/src/dispensation/record.tsx"],
  },
]

test("J2 each step is one server function, and every website and app caller reaches it through it", () => {
  const types = read("types/database.types.ts")
  for (const s of STEPS) {
    assert.match(types, new RegExp(String.raw`\n\s+${s.rpc}: \{`), `${s.step}: ${s.rpc} is a real server function`)
    if (s.contract) assert.ok(code(s.contract.file).includes(`rpc("${s.rpc}"`), `${s.step}: the shared contract ${s.contract.fn} names ${s.rpc}`)
    for (const f of [...s.web, ...s.app]) {
      assert.ok(reaches(f, s.rpc, s.contract), `${s.step}: ${f} reaches it through ${s.rpc}${s.contract ? ` or ${s.contract.fn}` : ""}`)
    }
  }
  // Nothing else performs these steps: every module that names one of these functions is accounted for.
  for (const s of STEPS) {
    const callers = SOURCES.filter((p) => code(p).includes(`rpc("${s.rpc}"`))
    const known = new Set([...(s.contract ? [s.contract.file] : []), ...s.web, ...s.app])
    for (const c of callers) {
      assert.ok(known.has(c) || STRAY_ALLOWED.has(`${c} ${s.rpc}`), `${s.step}: ${c} calls ${s.rpc} outside the known doors`)
    }
  }
})

/** Further callers of the same one function, each a door onto the same server answer. */
const STRAY_ALLOWED = new Set([
  "app/(app)/club/settings/guardians/actions.ts approve_pending_team_membership",
])

test("J3 a claim's referral link is resolved by the server, never by a client", () => {
  for (const f of ["lib/signup/complete-signup.ts", "app/(app)/clubhouse/claim-actions.ts"]) {
    const s = code(f)
    assert.doesNotMatch(s, /\.from\(\s*["']clubs["']\s*\)[\s\S]{0,120}\.eq\(\s*["']slug["']/, `${f} looks a referring club up itself`)
    assert.doesNotMatch(s, /referred_by_club_id/, `${f} sets a claim's referring club itself`)
  }
  assert.match(code("lib/signup/complete-signup.ts"), /p_referral_slug:/, "signup hands the link's slug to the server")
})

test("J4 the retired doors stay shut", () => {
  for (const p of SOURCES) {
    const s = code(p)
    assert.doesNotMatch(s, /rpc\(\s*["'](request_player_dispensation|decide_player_dispensation)["']/, `${p} calls the retired staged dispensation chain`)
  }
  const migration = read("supabase/migrations/20270743000000_one_door_for_claims_requests_and_referrals.sql")
  for (const t of ["club_claims", "club_partnerships", "club_join_requests"]) {
    assert.match(migration, new RegExp(String.raw`revoke insert on public\.${t} from authenticated, anon;`), `${t} takes no person's own insert`)
  }
  assert.match(migration, /create constraint trigger club_ovalball_invitation_has_its_referral[\s\S]{0,120}deferrable initially deferred/)
})
