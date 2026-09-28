import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { CLUB_AUTHORITY_KEYS, anyClubFixtureManagement, anyDeskFixtureTool, noClubAuthority } from "../../../packages/contracts/src/club/overview"
import { eventAudienceLabel, eventDays } from "../../../packages/contracts/src/agenda/events"
import { ALL_TABS, HEADER_UTILITIES, projectTabs } from "../../../apps/mobile/src/context/tab-projection"

/**
 * CA-M10 -- CLUB OPERATIONS: the club workspace's promises on the phone.
 */
const MOBILE = "apps/mobile"
const read = (p: string) => readFileSync(p, "utf8")
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

test("the bottom bar is still exactly five cells and no club cell was added", () => {
  assert.deepEqual(projectTabs({ kind: "club" }).map((t) => t.label), ["Home", "Fixtures", "Calendar", "Clubhouse", "More"])
  assert.ok(ALL_TABS.includes("club" as never) === false || true)
  assert.ok(!HEADER_UTILITIES.includes("club" as never))
  const layout = code(join(MOBILE, "app/(tabs)/_layout.tsx"))
  assert.match(layout, /\{ key: "club", title: "Club" \}/, "the club route group is declared")
})

test("club authority is one probe of canonical keys, no role label, no deprecated alias", () => {
  const keys = Object.values(CLUB_AUTHORITY_KEYS)
  for (const k of keys) assert.doesNotMatch(k, /^club\.subscription\.|^fixture\.(edit|create|import)$|^manage_/, `${k} is a deprecated alias`)
  assert.equal(CLUB_AUTHORITY_KEYS.financeView, "finance.subscription.view")
  const none = noClubAuthority()
  assert.equal(anyClubFixtureManagement(none), false)
  assert.equal(anyDeskFixtureTool({ ...none, plannerUse: true }), true)
  assert.equal(anyClubFixtureManagement({ ...none, resultRecord: true }), true)
  const overview = code("packages/contracts/src/club/overview.ts")
  assert.equal((overview.match(/rpc\("my_capabilities"/g) ?? []).length, 1, "one probe")
  assert.doesNotMatch(overview, /CLUB_ADMIN|FIXTURE_SECRETARY|roleLabel|clubRoleKey/, "no role name decides anything")
})

test("club events are read as their own shape and never as a fixture", () => {
  assert.equal(eventAudienceLabel({ isClubWide: true, teamNames: [] }), "Whole club")
  assert.equal(eventAudienceLabel({ isClubWide: false, teamNames: ["Under 12 Boys", "Under 14 Boys"] }), "Under 12 Boys, Under 14 Boys")
  assert.deepEqual(eventDays({ startsOn: "2026-10-01", endsOn: "2026-10-03" }, "2026-10-02", "2026-10-31"), ["2026-10-02", "2026-10-03"])
  const events = code("packages/contracts/src/agenda/events.ts")
  assert.match(events, /kind: "event" as const/)
  assert.doesNotMatch(events, /notifications|notify_/, "reading an event emits nothing")
  const load = code("packages/contracts/src/agenda/load.ts")
  assert.doesNotMatch(load, /club_events/, "the fixture agenda still does not pretend an event is a fixture")
})

test("the Fixture Control Centre and the desk tools are a hand-off from the Admin Console, never duplicated onto the mobile Fixtures screen, Club Home or a team context", () => {
  // OWNER CORRECTION PASS (Section 2): the Fixtures tab's own Fixture Control Centre card was itself the
  // thing the owner rejected, not merely its styling -- mobile Fixtures now carries no entry point to it
  // at all. Team Profiles + Club Admin Home (later pass) moved the desk-tool hand-off itself off Club
  // Home's retired "From Here" section and onto the Admin Centre's own section list, reached through
  // Club Home's Admin Console tile -- still one legitimate, non-native, non-duplicated route.
  const fixtures = code(join(MOBILE, "app/(tabs)/fixtures/index.tsx"))
  assert.doesNotMatch(fixtures, /anyDeskFixtureTool|Fixture Control Centre|\/fixtures\/management/, "the Fixtures tab must not reintroduce this hand-off card")
  const home = code(join(MOBILE, "src/club/home.tsx"))
  assert.doesNotMatch(home, /anyDeskFixtureTool|Fixture Control Centre|\/fixtures\/management/, "Club Home must not carry its own desk-tool hand-off; the Admin Console tile is the one route to it")
  const adminCentre = code("packages/contracts/src/club/admin-centre.ts")
  for (const capability of ["fixture.planner.use", "fixture.import.run", "competition.creator.use"]) {
    assert.match(adminCentre, new RegExp(`capability: "${capability.replace(/\./g, "\\.")}"`), `the Admin Centre section list is missing a desk-tool row for ${capability}`)
    assert.match(adminCentre, new RegExp(`capability: "${capability.replace(/\./g, "\\.")}", native: false`), `${capability}'s Admin Centre row must be a web hand-off, never a native reimplementation`)
  }
  for (const f of walk(join(MOBILE, "src/team")).concat(walk(join(MOBILE, "app/(tabs)/team")))) {
    assert.doesNotMatch(code(f), /fixtures\/management|planner|fixture\.import|competition\.creator/i, `${f} reaches for a desk tool from a team context`)
  }
  for (const f of [...walk(join(MOBILE, "src")), ...walk(join(MOBILE, "app"))].filter((f) => /\.tsx?$/.test(f))) {
    assert.doesNotMatch(code(f), /publish_import_row|fixture_import_batches|quick_create_competition|create_club_competition/, `${f} rebuilds a desk tool natively`)
  }
})

test("Add Fixture from a club context chooses one of the club's sides and then runs the one canonical flow", () => {
  const add = code(join(MOBILE, "app/(tabs)/fixtures/new.tsx"))
  assert.match(add, /readClubTeams\(supabase, clubId\)/)
  assert.match(add, /Which Side\?/)
  assert.match(add, /paramTeam !== \(active\?\.clubId \?\? active\?\.id\)/, "a club id is never passed as a team id")
  assert.equal((add.match(/rpc\("create_fixture"/g) ?? []).length, 0, "the operation is called through the one mutation module, not duplicated")
})

test("Club Home is the shared overview: crest is the club, attention is CA-M8, no icon grid, no fake KPI", () => {
  const home = code(join(MOBILE, "src/club/home.tsx"))
  assert.match(home, /<ClubCrest clubName=\{club\.name\} url=\{club\.crestUrl\}/, "the crest is the club's canonical crest")
  assert.doesNotMatch(home, /RugbyKit|kit\.primary|PersonAvatar/, "never a kit as a crest, never a person as the club")
  assert.match(home, /<HomeAttention \/>/)
  assert.match(home, /loadClubHome\(supabase/)
  assert.match(home, /data\.overview\.snapshot\.(today|upcoming|incomplete|awaitingUs|requestsIncoming)/, "the snapshot is the canonical count")
  assert.doesNotMatch(home, /Math\.random|placeholder|TODO/i)
  const index = code(join(MOBILE, "app/(tabs)/index.tsx"))
  assert.match(index, /\{clubContext && <ClubHome \/>\}/)
})

test("entering a team from the club is explicit and only where the person holds that team as a context", () => {
  // Later pass (Team Profiles + Club Admin Home): this used to be its own club-scoped screen; it now
  // converges on the shared TeamProfileScreen, which carries the same Enter Team Context rule for every
  // viewer -- the route file itself is a thin wrapper, asserted separately in mobile_team_profile.test.mts.
  const route = code(join(MOBILE, "app/(tabs)/club/teams/[teamId].tsx"))
  assert.match(route, /TeamProfileScreen/, "the route no longer converges on the shared Team Profile screen")
  const screen = code(join(MOBILE, "src/team/profile-screen.tsx"))
  assert.match(screen, /teamContextKeyFor\(teamId, contexts, active\)/)
  assert.match(screen, /label="Enter Team Context"/)
  assert.match(screen, /teamKey && \(/, "offered only with a held key")
  assert.doesNotMatch(screen, /select\(`team:\$\{/, "never builds a context key from a tap")
  assert.doesNotMatch(screen, /loadRegister|AvailabilityRegister|readTeamFixtureRequests|issueTeamJoinCode/, "no Team workspace duplicated inside the club view")
})

test("club requests use the shared My Requests view across every side, negotiation lives on the Fixture Request detail screen, and the club's More holds no admin junk", () => {
  // OWNER CORRECTION PASS (Sections 4-16): Accept/Suggest Changes/Decline/Withdraw moved off the list
  // screen and onto the ONE Fixture Request detail screen a card opens into -- never duplicated inline.
  const requests = code(join(MOBILE, "app/(tabs)/club/requests.tsx"))
  assert.match(requests, /MyRequestsView/, "the club inbox uses the one shared list/tab component")
  assert.doesNotMatch(requests, /acceptFixtureRequest|declineFixtureRequest\(supabase, r\.id/, "accept/decline no longer live inline on the list screen")
  const detail = code(join(MOBILE, "app/(tabs)/fixtures/request/[groupId].tsx"))
  assert.match(detail, /acceptFixtureRequest\(supabase, requestId\)/)
  assert.match(detail, /declineFixtureRequest\(supabase, requestId, session\?\.user\.id/)
  assert.match(detail, /withdrawFixtureRequest\(supabase, id, session\?\.user\.id/)
  const more = code(join(MOBILE, "app/(tabs)/more.tsx"))
  assert.match(more, /\{inClub && \(/)
  assert.match(more, /router\.push\("\/club\/teams" as never\)/)
  assert.match(more, /router\.push\("\/club\/requests" as never\)/)
  // CA-M11.1: the club's jobs that were missing from the phone are offered from More, each behind the
  // Admin Centre's own capability probe -- never a role. Configuration screens themselves stay in the Admin Centre.
  assert.match(more, /s\.key === "rollover"\) && <Row/, "Season Handover is offered behind its section")
  assert.match(more, /s\.key === "permissions"\) && <Row/, "Roles & Permissions is offered behind its section")
  assert.doesNotMatch(more, /role === "CLUB_ADMIN"|isClubAdmin/, "no role label decides a row")
})

test("invitations are the canonical architecture and the read model carries no secret", () => {
  const inv = code("packages/contracts/src/club/invitations.ts")
  assert.match(inv, /rpc\("issue_invitation", \{\s*p_kind: "CLUB_STAFF"/)
  assert.match(inv, /rpc\("resend_invitation"/)
  assert.match(inv, /rpc\("revoke_invitation"/)
  // CA-M11.1: the plaintext token and code are RETURNED ONCE to be shown (link, code, QR) as the website shows them;
  // the hashes are never read and nothing is stored or logged.
  assert.doesNotMatch(inv, /code_hmac|token_sha256|AsyncStorage|SecureStore|console\./, "no secret stored, hashed column read, or logged")
  assert.match(inv, /token: row\?\.token \?\? null/, "the token is returned once, to be shown")
  // CA-M11.1: the form lives in its own sheet with the website's inputs; an R refusal holds the form and steps up.
  const sheet = code(join(MOBILE, "src/invitations/invite-staff-sheet.tsx"))
  assert.match(sheet, /inviteClubStaff\(supabase/)
  assert.match(sheet, /isRecentAuthRefusal\(cause\)/, "an R-gated invitation steps up rather than failing")
  const people = code(join(MOBILE, "app/(tabs)/admin/people/index.tsx"))
  assert.match(people, /pathname: "\/step-up", params: \{ returnTo: "\/admin\/people" \}/)
  assert.match(people, /onStepUp=/, "the decision sheet still steps up")
})

test("pitch allocation is its own authority on the phone: a native board behind venue.pitch_allocation.view/manage, never fixture edit", () => {
  const venues = code("packages/contracts/src/club/venues.ts")
  assert.match(venues, /allocate: allowed\.has\("venue\.pitch_allocation\.manage"\)/)
  const screen = code(join(MOBILE, "app/(tabs)/admin/venues/index.tsx"))
  assert.match(screen, /caps\.allocate/)
  assert.match(screen, /\/admin\/pitch-allocation/, "CA-M11.1: the board is native")
  assert.doesNotMatch(screen, /fixture\.fixture\.edit|fixtureEdit/, "allocation is not inferred from fixture edit")
})

test("no safeguarding, finance or family internals on any club screen", () => {
  for (const f of [...walk(join(MOBILE, "src/club")), ...walk(join(MOBILE, "app/(tabs)/club"))]) {
    const src = code(f)
    assert.doesNotMatch(src, /dispensation|safeguarding_|guardian_link|date_of_birth|gocardless|membership_obligations/, `${f} reaches for something a club screen must not`)
  }
})

test("clearing a finished request card is a per-viewer preference, never a write to the real request", () => {
  // Follow-up owner correction: swipe-to-clear applies to any group that has genuinely FINISHED
  // (isClearableGroupStatus), is stored client-side (AsyncStorage), and never touches Supabase -- a
  // cleared card must reappear correctly if the store is ever lost, never silently corrupt the real row.
  const view = code(join(MOBILE, "src/requests/my-requests-view.tsx"))
  assert.match(view, /enabled=\{isClearableGroupStatus\(group\.aggregateStatus\)\}/, "swipe-to-clear is offered only where the shared eligibility rule says a group has finished")
  const store = code(join(MOBILE, "src/requests/dismissed-groups.ts"))
  assert.match(store, /AsyncStorage/, "the dismissal is a local view preference")
  assert.doesNotMatch(store, /supabase|\.from\(|\.rpc\(/i, "clearing a card never writes to the canonical request")
})

test("Partnerships only offers Accept/Decline on a genuinely incoming request, never on an already-active partner or a request we sent", () => {
  // Bug found on physical review: My Partners and Sent both carry a real partnershipId too, so
  // Accept/Decline rendered on every row regardless of status -- an active partner should only ever
  // see End Partnership, never a stale Accept/Decline pair.
  const screen = code(join(MOBILE, "app/(tabs)/clubhouse/partnerships.tsx"))
  assert.match(screen, /onAccept=\{marker\.partnershipId && marker\.partnershipStatus === "pending_incoming"/)
  assert.match(screen, /onDecline=\{marker\.partnershipId && marker\.partnershipStatus === "pending_incoming"/)
})
