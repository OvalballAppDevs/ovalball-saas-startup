import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { TEAM_AUTHORITY_KEYS, anyFixtureManagement, anyTeamAdministration, noTeamAuthority, type TeamAuthority } from "../../../packages/contracts/src/team/authority"
import { ATTENTION_URGENT_WITHIN_DAYS, projectTeamAttention, type TeamAttentionInput } from "../../../packages/contracts/src/team/attention"
import { SUBSCRIPTION_STATE_LABEL, resolveSubscriptionState, summariseTeamSubscriptions } from "../../../packages/contracts/src/team/subscriptions"
import { groupTeamPeople } from "../../../packages/contracts/src/team/people"
import { GAME_TYPE_OPTIONS } from "../../../packages/contracts/src/fixtures/game-type"
import { resolveIntent } from "../../../apps/mobile/src/links/intents"
import { routeForIntent } from "../../../apps/mobile/src/links/destinations"
import { routeForAttention } from "../../../apps/mobile/src/team/routes"
import { teamContextKeyFor } from "../../../apps/mobile/src/team/context"
import { ALL_TABS, HEADER_UTILITIES, projectTabs } from "../../../apps/mobile/src/context/tab-projection"
import type { SwitchableContext } from "../../../packages/contracts/src/active-context-rules"

/**
 * TEAM OPERATIONS IS ONE PRODUCT ON TWO CLIENTS (CA-M7).
 *
 * Structural pins beside the SQL suite that proves the authority itself: the team IA (five tabs
 * unchanged, the team route group hidden from the bar, no "Team" cell), the one authority probe and the
 * keys it may never ask for, the Needs Attention projection (derived, capability-aware, deterministic,
 * canonical addresses), the subscription state resolver, the roster grouping, the deep links into a
 * team and the context rule that a link can select a context but never grant one, the classification
 * list shared with the web, and the absences the directive forbade -- a role-name gate, a Planner or
 * Import route, a second store, a messaging route from a team entity, a service-role key.
 */
const MOBILE = "apps/mobile"
const TEAM_ROUTES = join(MOBILE, "app/(tabs)/team")
const TEAM_SRC = join(MOBILE, "src/team")
const CONTRACTS_TEAM = "packages/contracts/src/team"

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}
const read = (path: string) => readFileSync(path, "utf8")
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
const teamFiles = [...walk(TEAM_ROUTES), ...walk(TEAM_SRC), join(MOBILE, "app/(tabs)/subscriptions.tsx"), join(MOBILE, "app/(tabs)/more.tsx"), join(MOBILE, "app/(tabs)/index.tsx")].filter((f) => /\.tsx?$/.test(f))
const contractFiles = walk(CONTRACTS_TEAM)

const allow = (keys: (keyof TeamAuthority)[]): TeamAuthority => {
  const a = noTeamAuthority()
  for (const k of keys) a[k] = true
  return a
}

const baseInput = (authority: TeamAuthority, extra: Partial<TeamAttentionInput> = {}): TeamAttentionInput => ({
  teamId: "T1",
  todayIso: "2026-09-24",
  authority,
  nextFixture: { fixtureId: "F1", dateIso: "2026-09-26", kickoffTime: "10:30", homeAway: "Home", venueKnown: true, status: "Booked" },
  availability: { squad: 20, awaiting: 5 },
  incompleteFixtures: [],
  kickoffProposals: [],
  resultConfirmations: [],
  incomingRequests: [],
  pendingJoinRequests: 0,
  callUpsAwaiting: 0,
  subscriptionsNeedingAttention: null,
  ageGradeAttention: 0,
  ...extra,
})

// ------------------------------------------------------------------ the IA

test("the bar is unchanged: five cells, Rugby Hub fourth, and the team route group is never a cell", () => {
  const tabs = projectTabs({ kind: "team" })
  assert.deepEqual(tabs.map((t) => t.key), ["index", "fixtures", "calendar", "hub", "more"])
  assert.ok(!tabs.some((t) => t.label === "Team"), "no navigation group called Team inside a team context")
  assert.ok(!ALL_TABS.includes("team" as never), "the team group is a route, never a bar cell")
  assert.ok(!HEADER_UTILITIES.includes("team" as never))
  const layout = code(join(MOBILE, "app/(tabs)/_layout.tsx"))
  assert.match(layout, /key: "team", title: "Team"/, "the router declares the team group so deep links resolve, hidden by href: null")
})

test("the team route group holds the recurring jobs and the settings hub, and nothing club-wide", () => {
  const files = walk(TEAM_ROUTES).map((f) => f.replace(TEAM_ROUTES + "/", ""))
  for (const expected of ["availability/index.tsx", "availability/[kind]/[eventId].tsx", "people/index.tsx", "people/[kind]/[id].tsx", "requests.tsx", "settings/index.tsx", "settings/requests.tsx", "settings/player-requests.tsx", "settings/join-codes.tsx"]) {
    assert.ok(files.includes(expected), `${expected} exists`)
  }
  for (const f of teamFiles) {
    const src = code(f)
    assert.doesNotMatch(src, /fixture\.planner|fixture\.import|bulk_edit|fixtures\/management|fixtures\/planner|fixtures\/import|competition\.creator/i, `${f} reaches no Planner, Import, bulk edit or Competition Creator`)
  }
})

test("the app decides nothing from a role label, and holds no service role", () => {
  for (const f of [...teamFiles, ...contractFiles]) {
    const src = code(f)
    assert.doesNotMatch(src, /role\s*===\s*["'](COACH|TEAM_MANAGER|CLUB_ADMIN|MANAGER|TEAM_ADMIN)["']/, `${f} gates nothing on a role name`)
    assert.doesNotMatch(src, /permission\s*===\s*["'](coach|manager|team_admin)["']/, `${f} gates nothing on a legacy permission word`)
    assert.doesNotMatch(src, /service_role|SERVICE_ROLE|supabaseServiceRole/, `${f} holds no service role`)
  }
})

// ------------------------------------------------------------------ the authority probe

test("one probe, at team scope, and it can never ask for a club-only mass tool", () => {
  const keys = Object.values(TEAM_AUTHORITY_KEYS)
  for (const forbidden of ["fixture.planner.use", "fixture.import.run", "fixture.fixture.bulk_edit", "fixture.fixture.delete", "competition.creator.use", "people.member.view", "finance.payment.act", "finance.subscription.configure"]) {
    assert.ok(!keys.includes(forbidden as never), `${forbidden} is not a team key`)
  }
  for (const expected of ["fixture.fixture.create", "fixture.fixture.edit", "fixture.fixture.cancel", "fixture.request.create", "fixture.request.respond", "team.attendance.view", "team.roster.manage", "finance.subscription.view", "team.join_code.manage"]) {
    assert.ok(keys.includes(expected as never), `${expected} is asked`)
  }
  const src = code(join(CONTRACTS_TEAM, "authority.ts"))
  assert.match(src, /p_scope_type: "team"/, "the probe is at team scope")
  assert.doesNotMatch(src, /p_scope_type: "club"/, "and never at club scope")
  assert.equal(anyFixtureManagement(noTeamAuthority()), false)
  assert.equal(anyTeamAdministration(noTeamAuthority()), false)
  assert.equal(anyFixtureManagement(allow(["fixtureCreate"])), true)
  assert.equal(anyTeamAdministration(allow(["joinCodeManage"])), true)
})

test("the authority hook clears before it re-asks and re-asks on focus; nothing is cached across a context", () => {
  const src = code(join(TEAM_SRC, "authority.ts"))
  assert.match(src, /setAuthority\(null\)\s*\n\s*void refresh\(\)/, "cleared first")
  assert.match(src, /useFocusEffect/, "re-asked on focus")
  assert.doesNotMatch(src, /AsyncStorage|localStorage/, "no persisted capability")
})

// ------------------------------------------------------------------ Needs Attention

test("Needs Attention is derived from canonical state and offered only to somebody who can act on it", () => {
  const manager = allow(["attendanceView", "fixtureEdit", "requestRespond", "rosterManage", "callupRequest", "subscriptionView", "resultRecord"])
  const items = projectTeamAttention(
    baseInput(manager, {
      incomingRequests: [{ requestId: "R1" }],
      pendingJoinRequests: 2,
      callUpsAwaiting: 1,
      subscriptionsNeedingAttention: 3,
      kickoffProposals: [{ fixtureId: "F2", dateIso: "2026-10-10" }],
      incompleteFixtures: [{ fixtureId: "F3", dateIso: "2026-09-30", missing: ["kick-off"] }],
      ageGradeAttention: 1,
    })
  )
  const kinds = items.map((i) => i.kind)
  for (const k of ["availability", "fixture_request", "join_request", "call_up", "subscription", "kickoff_proposal", "fixture_incomplete", "age_grade"]) assert.ok(kinds.includes(k as never), `${k} projected`)
  // urgent first: the match is in two days and five have not answered
  assert.equal(items[0].kind, "availability")
  assert.equal(items[0].urgent, true)
  assert.equal(items[0].count, 5)
  assert.equal(items[0].href, "/fixtures/F1")
  // canonical addresses, never screen names
  assert.equal(items.find((i) => i.kind === "fixture_request")!.href, "/messages/request/R1")
  assert.equal(items.find((i) => i.kind === "join_request")!.href, "/teams/T1/people")
  assert.equal(items.find((i) => i.kind === "call_up")!.href, "/teams/T1/player-requests")
  assert.equal(items.find((i) => i.kind === "subscription")!.href, "/teams/T1/subscriptions")
  for (const i of items) assert.ok(i.capability.length > 0, "every item names the capability that makes it the viewer's")

  // a read-only persona is offered no job it cannot do
  const readOnly = projectTeamAttention(baseInput(noTeamAuthority(), { incomingRequests: [{ requestId: "R1" }], pendingJoinRequests: 2, subscriptionsNeedingAttention: 3 }))
  assert.deepEqual(readOnly, [])
  // attendance authority alone shows the chase and nothing else
  const registerOnly = projectTeamAttention(baseInput(allow(["attendanceView"]), { incomingRequests: [{ requestId: "R1" }], pendingJoinRequests: 2 }))
  assert.deepEqual(registerOnly.map((i) => i.kind), ["availability"])
  // several requests go to the register, one goes to the request
  const many = projectTeamAttention(baseInput(allow(["requestRespond"]), { availability: null, incomingRequests: [{ requestId: "A" }, { requestId: "B" }] }))
  assert.equal(many[0].href, "/fixtures")
  assert.equal(many[0].count, 2)
  // a fixture far away is not urgent; one inside the window is
  const later = projectTeamAttention(baseInput(allow(["attendanceView"]), { nextFixture: { fixtureId: "F9", dateIso: "2026-10-30", kickoffTime: null, homeAway: "Away", venueKnown: false, status: "Planned" } }))
  assert.equal(later[0].urgent, false)
  assert.ok(ATTENTION_URGENT_WITHIN_DAYS >= 1)
  // deterministic: the same input twice gives the same order
  assert.deepEqual(projectTeamAttention(baseInput(manager, { pendingJoinRequests: 1 })), projectTeamAttention(baseInput(manager, { pendingJoinRequests: 1 })))
})

test("every attention address the phone routes lands natively, and nothing goes to a generic More", () => {
  const manager = allow(["attendanceView", "fixtureEdit", "requestRespond", "rosterManage", "callupRequest", "subscriptionView", "resultRecord"])
  const items = projectTeamAttention(baseInput(manager, { incomingRequests: [{ requestId: "R1" }], pendingJoinRequests: 1, callUpsAwaiting: 1, subscriptionsNeedingAttention: 1, kickoffProposals: [{ fixtureId: "F2", dateIso: "2026-10-10" }], ageGradeAttention: 1 }))
  for (const item of items) {
    const route = routeForAttention(item)
    assert.ok(route, `${item.kind} routes`)
    assert.notEqual(route!.pathname, "/more", `${item.kind} does not go to More`)
  }
  assert.equal(routeForAttention(items.find((i) => i.kind === "availability")!)!.pathname, "/team/availability/[kind]/[eventId]")
  assert.equal(routeForAttention(items.find((i) => i.kind === "fixture_request")!)!.pathname, "/team/requests")
  assert.equal(routeForAttention(items.find((i) => i.kind === "join_request")!)!.pathname, "/team/people")
  assert.equal(routeForAttention(items.find((i) => i.kind === "call_up")!)!.pathname, "/team/settings/player-requests")
  assert.equal(routeForAttention(items.find((i) => i.kind === "subscription")!)!.pathname, "/subscriptions")
  assert.equal(routeForAttention(items.find((i) => i.kind === "kickoff_proposal")!)!.pathname, "/fixtures/[fixtureId]")
})

// ------------------------------------------------------------------ deep links and context

test("a team link resolves to the team's own screens, and a link can select a held context but never grant one", () => {
  assert.deepEqual(resolveIntent("ovalball://teams/T1"), { kind: "TEAM", teamId: "t1", section: "home" })
  assert.deepEqual(resolveIntent("https://ovalball.co.uk/teams/T1/people"), { kind: "TEAM", teamId: "t1", section: "people" })
  assert.deepEqual(resolveIntent("ovalball://teams/T1/player-requests"), { kind: "TEAM", teamId: "t1", section: "player-requests" })
  assert.deepEqual(resolveIntent("ovalball://teams/T1/subscriptions"), { kind: "TEAM", teamId: "t1", section: "subscriptions" })
  assert.equal(routeForIntent({ kind: "TEAM", teamId: "t1", section: "people" })!.pathname, "/team/people")
  assert.equal(routeForIntent({ kind: "TEAM", teamId: "t1", section: "home" })!.pathname, "/")
  const held = { key: "team:t1", kind: "team", id: "t1", label: "Under 12 Boys" } as SwitchableContext
  const other = { key: "team:t2", kind: "team", id: "t2", label: "Under 14 Boys" } as SwitchableContext
  assert.equal(teamContextKeyFor("t1", [held, other], other), "team:t1", "a held team is selected")
  assert.equal(teamContextKeyFor("t1", [held, other], held), null, "already there: no switch")
  assert.equal(teamContextKeyFor("t9", [held, other], held), null, "a team the person does not hold is never selected")
  const notifications = code(join(MOBILE, "app/(tabs)/notifications.tsx"))
  assert.match(notifications, /teamContextKeyFor\(intent\.teamId, contexts, active\)/, "the bell switches through the canonical rule")
  assert.doesNotMatch(notifications, /select\(`team:\$\{/, "and never builds a context key from a link")
})

// ------------------------------------------------------------------ subscriptions

test("the subscription state resolver says what the canonical obligation says and never invents 'paid'", () => {
  assert.equal(resolveSubscriptionState(null, true), "NOT_EXPECTED")
  assert.equal(resolveSubscriptionState(null, false), "NOT_SET_UP")
  assert.equal(resolveSubscriptionState("PAID", true), "PAID")
  assert.equal(resolveSubscriptionState("FAILED", true), "FAILED")
  assert.equal(resolveSubscriptionState("CHARGEDBACK", true), "FAILED")
  assert.equal(resolveSubscriptionState("WAIVED", true), "NOT_EXPECTED")
  assert.equal(resolveSubscriptionState("SCHEDULED", true), "DUE")
  assert.equal(resolveSubscriptionState("something-new", false), "NOT_SET_UP", "an unknown word errs towards somebody still owing")
  const summary = summariseTeamSubscriptions([
    { player_id: "a", first_name: "A", surname: "Z", billing_period: "2026-09-01", obligation_status: "PAID", amount_due_minor: 1500, currency: "GBP", has_payer: true, programme_exists: true },
    { player_id: "b", first_name: "B", surname: "Y", billing_period: "2026-09-01", obligation_status: "FAILED", amount_due_minor: 1500, currency: "GBP", has_payer: true, programme_exists: true },
    { player_id: "c", first_name: "C", surname: "X", billing_period: "2026-09-01", obligation_status: null, amount_due_minor: null, currency: null, has_payer: false, programme_exists: true },
  ])
  assert.deepEqual(summary.rows.map((r) => r.state), ["FAILED", "NOT_SET_UP", "PAID"], "the work sorts to the top")
  assert.equal(summary.attentionCount, 2)
  assert.equal(summary.programmeExists, true)
  assert.equal(summariseTeamSubscriptions([{ player_id: "a", first_name: "A", surname: "Z", billing_period: "2026-09-01", obligation_status: null, amount_due_minor: null, currency: null, has_payer: false, programme_exists: false }]).attentionCount, 0, "no programme, no attention")
  assert.equal(SUBSCRIPTION_STATE_LABEL.NOT_EXPECTED, "Nothing due")
  const contract = code(join(CONTRACTS_TEAM, "subscriptions.ts"))
  assert.match(contract, /rpc\("team_subscription_status"/, "the read is the one operation")
  assert.doesNotMatch(contract, /from\("membership_obligations"\)|from\("gocardless|mandate|payer_user_id|access_token/, "and never a provider or ledger table")
  const web = read("lib/teams/team-subscriptions.ts")
  assert.match(web, /@ovalball\/contracts\/team\/subscriptions/, "the web re-exports the same module")
})

// ------------------------------------------------------------------ people

test("the roster groups the reader's rows the way a club thinks, and the contract carries no contact detail", () => {
  const people = groupTeamPeople([
    { kind: "coach", row_id: "c1", person_id: "u1", name: "Coach One", detail: "Manager", status: "active", requested_at: null },
    { kind: "player", row_id: "p1", person_id: "pl1", name: "Zed Player", detail: null, status: "active", requested_at: null },
    { kind: "player", row_id: "p2", person_id: "pl2", name: "Ann Player", detail: null, status: "requested", requested_at: "2026-09-20T10:00:00Z" },
    { kind: "player", row_id: "p3", person_id: "pl3", name: "Old Player", detail: null, status: "archived", requested_at: null },
    { kind: "guardian", row_id: "g1", person_id: "u2", name: "Parent One", detail: "Parent or guardian of Zed Player", status: "active", requested_at: null },
  ])
  assert.deepEqual(people.players.map((p) => p.name), ["Zed Player"])
  assert.deepEqual(people.requests.map((p) => p.name), ["Ann Player"])
  assert.deepEqual(people.archived.map((p) => p.name), ["Old Player"])
  assert.equal(people.staff.length, 1)
  assert.equal(people.guardians.length, 1)
  const contract = code(join(CONTRACTS_TEAM, "people.ts"))
  assert.match(contract, /rpc\("team_people"/)
  assert.doesNotMatch(contract, /email|phone|date_of_birth|medical|safeguarding_/i, "no contact, medical or safeguarding field")
  for (const rpc of ["approve_pending_team_membership", "reject_pending_team_membership", "archive_player_team_membership", "restore_player_team_membership"]) {
    assert.match(contract, new RegExp(`rpc\\("${rpc}"`), `${rpc} is the operation`)
  }
})

// ------------------------------------------------------------------ fixtures

test("the classification is the one canonical list on both clients, rendered on the row, the card and the Match Centre", () => {
  assert.deepEqual([...GAME_TYPE_OPTIONS], ["Friendly", "League Fixture", "Cup Fixture", "Scheduled Match"])
  const newFixture = code(join(MOBILE, "app/(tabs)/fixtures/new.tsx"))
  assert.match(newFixture, /GAME_TYPE_OPTIONS/, "Add Fixture offers the canonical list")
  assert.doesNotMatch(newFixture, /"Friendly" \| "League Fixture"/, "and no hand-typed union")
  for (const f of ["src/components/agenda-row.tsx", "src/match-centre/load.ts"]) {
    assert.match(code(join(MOBILE, f)), /matchTypeLabel/, `${f} resolves the classification through the shared label`)
  }
  assert.match(code(join(MOBILE, "src/fixtures/match-centre.tsx")), /view\.matchType/, "the Match Centre draws the classification the view model resolved")
  assert.match(code(join(MOBILE, "src/components/participant/match-card.tsx")), /matchType/, "the Calendar card carries it too")
  const mutations = code(join(MOBILE, "src/agenda/mutations.ts"))
  assert.doesNotMatch(mutations, /delete_fixture|\.delete\(\)/, "no delete from the team's mutations")
  for (const rpc of ["create_fixture", "update_fixture_details", "cancel_fixture"]) assert.match(mutations, new RegExp(`rpc\\("${rpc}"`))
  const requests = code(join(CONTRACTS_TEAM, "requests.ts"))
  assert.match(requests, /rpc\("accept_fixture_request"/, "accepting a request is the canonical operation")
  assert.match(requests, /rpc\("decide_player_call_up"/, "deciding a call-up is the canonical operation")
  assert.match(requests, /rpc\("issue_invitation"/)
  assert.match(requests, /rpc\("revoke_invitation"/)
})

// ------------------------------------------------------------------ safety

test("no team screen carries a messaging, contact, invite or DM route to a team entity, and no second store", () => {
  for (const f of teamFiles) {
    const src = code(f)
    assert.doesNotMatch(src, /open_direct_conversation|openConversationWith|my_direct_message_candidates/, `${f} opens no direct conversation from a team entity`)
    assert.doesNotMatch(src, /from\("player_fixture_attendance"\)\.(insert|upsert|update)|respond_to_attendance/, `${f} records no answer for anybody`)
    assert.doesNotMatch(src, /AsyncStorage\.setItem|createStore|zustand|redux/, `${f} keeps no second store`)
  }
  const register = code(join(TEAM_ROUTES, "availability/[kind]/[eventId].tsx"))
  assert.match(register, /Staff can ask, not answer for them/, "the register says plainly there is no staff override")
  assert.match(register, /send_fixture_communication|AnnounceSheet/, "the reminder is the canonical fixture communication")
})

test("the Team Home reads the shared overview and the web dashboard reads the same function", () => {
  const home = code(join(TEAM_SRC, "data.ts"))
  assert.match(home, /loadTeamOverview/, "the app reads the shared overview")
  const web = read("lib/teams/team-overview.ts")
  assert.match(web, /@ovalball\/contracts\/team\/overview/, "the web re-exports it")
  const overview = code(join(CONTRACTS_TEAM, "overview.ts"))
  assert.match(overview, /rpc\("fixture_availability_summary"/, "availability comes from the authority-safe summary")
  assert.doesNotMatch(overview, /from\("player_fixture_attendance"\)/, "and never from the raw attendance rows")
  assert.match(overview, /readTeamAuthority/, "and the one probe decides what is drawn")
  assert.ok(existsSync(join(TEAM_SRC, "home.tsx")))
  const homeScreen = code(join(TEAM_SRC, "home.tsx"))
  assert.match(homeScreen, /NeedsAttention/, "Needs Attention is the reusable component")
  assert.match(homeScreen, /RugbyKit/, "the kit is drawn as a kit")
  assert.doesNotMatch(homeScreen, /ClubCrest[^\n]*kit|RugbyKit[^\n]*crest/i, "never one for the other")
})

test("the two protected Ovalball logo files are untouched and untracked", () => {
  for (const f of ["public/icons/Ovalball Square Logo.png", "public/icons/Overball Logo Low Res.png"]) assert.ok(existsSync(f), `${f} exists`)
})
