import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { attentionVerdict, newestFirst, notificationAttentionId, verdictsNewestAskOnly, ASKING_TYPES } from "../../../../packages/contracts/src/notifications/feed"
import { attentionItem } from "../../../../packages/contracts/src/attention/model"
import { teamAttentionItems } from "../../../../packages/contracts/src/attention/team"
import { projectTeamAttention } from "../../../../packages/contracts/src/team/attention"
import { noTeamAuthority } from "../../../../packages/contracts/src/team/authority"
import { notificationHref } from "../../../../packages/contracts/src/notifications/destinations"
import { fixtureResultMode, type FixtureResultState } from "../../../../packages/contracts/src/fixtures/result-actions"
import { resultsWaitingOn, ageGradeNeedingTeam } from "../../../../packages/contracts/src/team/overview"
import { resolveIntent } from "../links/intents"
import { routeForIntent } from "../links/destinations"

/**
 * THE NOTIFICATION LIFECYCLE, PINNED (owner's correctness pass, 2026-10-02).
 *
 * Every rule here was found broken on the Simulator with real UAT data before it was fixed: a result
 * notification that opened fixture editing, an age-grade job that could never clear, a quick view that
 * re-sorted by unread, and a dozen addresses that opened the website when a native screen existed.
 */
const SRC = join(import.meta.dirname, "..")
const code = (path: string) => readFileSync(join(SRC, path), "utf8")
const F = "11111111-1111-4111-8111-111111111111"

// ---------------------------------------------------------------- ordering

test("every list is newest first; read and action state never move a row", () => {
  const rows = [
    { id: "a", createdAt: "2026-10-02T09:00:00Z", readAt: null, action: true },
    { id: "b", createdAt: "2026-10-02T10:00:00Z", readAt: "2026-10-02T10:05:00Z", action: false },
    { id: "c", createdAt: "2026-10-02T08:00:00Z", readAt: null, action: false },
    { id: "d", createdAt: "2026-10-02T11:00:00Z", readAt: "2026-10-02T11:01:00Z", action: true },
    { id: "e", createdAt: "2026-10-02T10:00:00Z", readAt: null, action: false },
  ]
  assert.deepEqual(newestFirst(rows).map((r) => r.id), ["d", "e", "b", "a", "c"], "strictly by time, id breaks a tie")
  const unread = newestFirst(rows.filter((r) => r.readAt === null))
  assert.deepEqual(unread.map((r) => r.id), ["e", "a", "c"], "the Unread view filters; it does not re-rank")
  const action = newestFirst(rows.filter((r) => r.action))
  assert.deepEqual(action.map((r) => r.id), ["d", "a"], "the Action Required view filters; it does not re-rank")
})

test("the bell's quick view orders with the shared rule and never by unread or action state", () => {
  const quick = code("components/notification-quick-view.tsx")
  assert.match(quick, /newestFirst\(/, "the shared newest-first rule")
  assert.doesNotMatch(quick, /rank\(|byPriority|=== "open" \? 0/, "no re-ranking by state")
})

test("only the newest ask about one job is highlighted; a superseded ask keeps its place as history", () => {
  const rows = [
    { id: "old", type: "fixture_result_amendment_proposed", data: { fixture_id: F }, createdAt: "2026-10-02T15:36:00Z" },
    { id: "new", type: "fixture_result_amendment_proposed", data: { fixture_id: F }, createdAt: "2026-10-02T15:45:00Z" },
    { id: "other", type: "fixture_attendance_invitation", data: { fixture_id: F }, createdAt: "2026-10-02T15:40:00Z" },
  ]
  const verdicts = verdictsNewestAskOnly(rows, () => "open")
  assert.equal(verdicts.get("new"), "open", "the live ask")
  assert.equal(verdicts.get("old"), "unknown", "the superseded ask is history, not action required")
  assert.equal(verdicts.get("other"), "open", "a different job is untouched")
})

// ---------------------------------------------------------------- result confirmation

const base: FixtureResultState = {
  status: "awaiting_confirmation",
  homeScore: 12,
  awayScore: 10,
  submittedByClubId: "club-them",
  amendmentHomeScore: null,
  amendmentAwayScore: null,
  amendmentByClubId: null,
  resolvedBySiteAdmin: false,
  cancelled: false,
  kickoffPassed: true,
}
const officer = { myClubIds: new Set(["club-us"]), canRecord: true, isParticipant: true }

test("a result offers exactly the actions this viewer may take, for every state", () => {
  assert.equal(fixtureResultMode(base, officer), "confirm", "the other club submitted: confirm or dispute")
  assert.equal(fixtureResultMode({ ...base, submittedByClubId: "club-us" }, officer), "awaiting_other_side", "we submitted: wait, may revise")
  assert.equal(fixtureResultMode({ ...base, status: "disputed" }, officer), "disputed")
  assert.equal(fixtureResultMode({ ...base, status: "amendment_pending", amendmentByClubId: "club-them" }, officer), "confirm_amendment")
  assert.equal(fixtureResultMode({ ...base, status: "amendment_pending", amendmentByClubId: "club-us" }, officer), "amendment_awaiting_other_side")
  assert.equal(fixtureResultMode({ ...base, status: "final" }, officer), "final")
  assert.equal(fixtureResultMode({ ...base, status: "none", homeScore: null, awayScore: null }, officer), "enter")
  assert.equal(fixtureResultMode({ ...base, status: "none", kickoffPassed: false }, officer), "not_started")
  assert.equal(fixtureResultMode({ ...base, cancelled: true }, officer), "cancelled")
  assert.equal(fixtureResultMode(base, { ...officer, canRecord: false }), "read_only", "no result authority: read only")
  assert.equal(fixtureResultMode(base, { ...officer, isParticipant: false }), "read_only", "not a side in the game: read only")
})

test("a result job is live state: waiting on us until it is final, never because a notification was read", () => {
  const rows = [
    { id: "f1", kickoff_date: "2026-10-01", result_status: "awaiting_confirmation", result_submitted_by_club_id: "them", result_amendment_proposed_by_club_id: null },
    { id: "f2", kickoff_date: "2026-10-01", result_status: "awaiting_confirmation", result_submitted_by_club_id: "us", result_amendment_proposed_by_club_id: null },
    { id: "f3", kickoff_date: "2026-10-01", result_status: "disputed", result_submitted_by_club_id: "us", result_amendment_proposed_by_club_id: null },
    { id: "f4", kickoff_date: "2026-10-01", result_status: "amendment_pending", result_submitted_by_club_id: "us", result_amendment_proposed_by_club_id: "them" },
    { id: "f5", kickoff_date: "2026-10-01", result_status: "amendment_pending", result_submitted_by_club_id: "them", result_amendment_proposed_by_club_id: "us" },
    { id: "f6", kickoff_date: "2026-10-01", result_status: "final", result_submitted_by_club_id: "them", result_amendment_proposed_by_club_id: null },
  ]
  assert.deepEqual(
    resultsWaitingOn("us", rows).map((r) => `${r.fixtureId}:${r.state}`),
    ["f1:awaiting", "f3:disputed", "f4:amendment"],
    "the other club's submission, any dispute, the other club's proposed change -- and nothing final"
  )
  for (const type of ["fixture_result_awaiting_confirmation", "fixture_result_amendment_proposed", "fixture_result_disputed"]) {
    assert.ok(ASKING_TYPES.has(type), `${type} asks`)
    assert.equal(notificationAttentionId(type, { fixture_id: F }), `result_confirmation:${F}`, `${type} pairs with the live result job`)
  }
})

test("a result notification and a result job both open the result, never fixture editing", () => {
  for (const type of ["fixture_result_awaiting_confirmation", "fixture_result_disputed", "fixture_result_amendment_proposed", "fixture_result_final"]) {
    const href = notificationHref(type, { fixture_id: F })
    assert.equal(href, `/fixtures/${F}/result`, type)
    for (const context of ["team", "club", "guardian", "player", null] as const) {
      // The one Match Centre's Result section (consolidation, 2026-10-03), whatever the context.
      void context
      const route = routeForIntent(resolveIntent(`ovalball://${href.slice(1)}`))
      assert.deepEqual(route, { pathname: "/fixtures/[fixtureId]", params: { fixtureId: F, tab: "result" } }, `${type} in a ${context ?? "no"} context`)
    }
  }
  const team = code("../../../packages/contracts/src/team/attention.ts")
  assert.match(team, /href: `\/fixtures\/\$\{r\.fixtureId\}\/result`/, "the team's result job opens the result")
  const club = code("../../../packages/contracts/src/attention/club.ts")
  assert.match(club, /href: `\/fixtures\/\$\{f\.fixtureId\}\/result`/, "the club's result job opens the result")
  // The Match Result was lifted, unchanged, into the Match Centre's Result section (2026-10-03).
  const screen = code("fixtures/match-centre/result-section.tsx")
  assert.match(screen, /supabase\.rpc\("submit_fixture_result"/, "the result screen uses the one state machine")
  assert.match(screen, /fixtureResultMode\(/, "and the one shared rule for which actions to offer")
  assert.doesNotMatch(screen, /EDIT_FIXTURE|\/edit"/, "and never routes to fixture editing")
})

// ---------------------------------------------------------------- age grade

test("an age-grade job is the team's only while the team can act, so asking the club clears it", () => {
  assert.equal(ageGradeNeedingTeam([{ status: "OUTSIDE_AGE_GRADE" }, { status: "AGE_EVIDENCE_REQUIRED" }]), 2)
  assert.equal(ageGradeNeedingTeam([{ status: "DISPENSATION_PENDING" }]), 0, "requested: the club's decision now")
  assert.equal(ageGradeNeedingTeam([{ status: "DISPENSATION_APPROVED" }, { status: "SEASON_NOT_ESTABLISHED" }]), 0)
  const team = code("../../../packages/contracts/src/team/attention.ts")
  assert.match(team, /href: `\/teams\/\$\{teamId\}\/age-grade`/, "the job opens the age-grade list, not Team Home")
  assert.deepEqual(routeForIntent(resolveIntent("ovalball://teams/t1/age-grade")), { pathname: "/team/age-grade", params: { teamId: "t1" } })
  const routes = code("attention/routes.ts")
  assert.match(routes, /case "age_grade":\s*\n\s*return \{ pathname: "\/team\/age-grade" \}/, "the attention row opens the same screen")
  const screen = code("../app/(tabs)/team/age-grade.tsx")
  // The one dispensation workflow (20270742000000): the team asks, with a reason, through the shared contract,
  // and never decides -- the retired staged operations appear nowhere on the screen.
  assert.match(screen, /requestDispensation\(supabase, \{ playerId: row\.playerId, teamId, reason \}\)/, "the team's move is the canonical request")
  assert.doesNotMatch(screen, /request_player_dispensation|decide_player_dispensation|decideDispensation/, "and the team decides nothing")
  assert.doesNotMatch(screen, /dismissNotification|dismiss_notification/, "and nothing clears a job by dismissing its notification")
})

// ---------------------------------------------------------------- exact destinations

test("addresses with a native home open it, never the website", () => {
  const cases: Array<[string, string]> = [
    ["/clubhouse", "/clubhouse/partnerships"],
    ["/clubhouse/opportunities?highlight=o1", "/clubhouse/opportunities"],
    ["/people", "/admin/people"],
    ["/people?request=r1", "/admin/people"],
    ["/parent/children", "/family"],
    ["/account/security", "/security"],
    ["/club/rollover", "/admin/rollover"],
    ["/club/training", "/admin/training-planning"],
    ["/support/t1", "/support"],
    ["/club/settings/ovalball-plan", "/admin/subscriptions/ovalball-billing"],
  ]
  for (const [href, pathname] of cases) {
    assert.equal(routeForIntent(resolveIntent(`ovalball://${href.slice(1)}`))?.pathname, pathname, href)
  }
  assert.equal(notificationHref("fixture_request_accepted", { fixture_id: F, fixture_request_id: "r" }), `/fixtures/${F}`, "an accepted request opens its fixture")
})

test("a tap in a list, on the banner and on a push all reach the one resolver and mark the row read", () => {
  const open = code("notifications/open.ts")
  assert.match(open, /routeForHref\(/)
  assert.match(code("../app/(tabs)/notifications/index.tsx"), /useNotificationNavigator\(\)/, "the Centre")
  assert.match(code("components/notification-quick-view.tsx"), /useNotificationNavigator\(\)/, "the bell")
  const push = code("notifications/push.ts")
  assert.match(push, /routeForHref\(/, "push and banner")
  assert.match(push, /markNotificationRead\(supabase, data\.notificationId\)/, "a push or banner tap reads that exact row")
  assert.match(code("components/notification-quick-view.tsx"), /markNotificationRead\(supabase, item\.id\)/, "a bell tap reads it")
})

test("the bell opens a quick view over the current screen; View All opens the Centre", () => {
  const header = code("components/header-utilities.tsx")
  assert.match(header, /utility\.key === "notifications" \? openQuickView/, "the bell opens the quick view")
  const quick = code("components/notification-quick-view.tsx")
  assert.match(quick, /router\.push\("\/notifications" as never\)/, "View All Notifications opens the Centre")
  assert.match(quick, /readNotificationPage\(/, "the same canonical feed as the Centre")
  assert.match(quick, /dismissNotification\(supabase/, "delete is the server's dismissal")
  assert.match(quick, /restoreNotification\(supabase/, "and undo its exact reverse")
})

test("several banners arriving together show one at a time, newest first, never a stack", () => {
  const banner = code("components/foreground-banner.tsx")
  assert.match(banner, /const showing = queue\[queue\.length - 1\]/, "the newest is the one shown")
  assert.doesNotMatch(banner, /queue\.map\(/, "never every queued banner at once")
  assert.match(banner, /\+\{waiting\} more/, "the rest are counted, not hidden")
})

// ---------------------------------------------------------------- tournaments, age grade, read/dismiss

const G = "22222222-2222-4222-8222-222222222222"
const TEAM = "33333333-3333-4333-8333-333333333333"
const job = (sourceType: string, sourceId: string, ctx: "team" | "club" = "team") =>
  attentionItem({ sourceType: sourceType as never, sourceId, context: { kind: ctx, clubId: "c", teamId: ctx === "team" ? TEAM : null, playerId: null }, priority: "needs_action", title: "t", summary: null, href: "/x", createdAt: null, dueAt: null, count: 1, capability: null })

test("a tournament result asks like a fixture result: paired to the live game job, open until settled, then history", () => {
  for (const type of ["tournament_result_awaiting_confirmation", "tournament_result_contested"]) {
    assert.ok(ASKING_TYPES.has(type), `${type} asks`)
    assert.equal(notificationAttentionId(type, { tournament_game_id: G }), `tournament_result:${G}`)
    assert.equal(notificationHref(type, { tournament_id: "t", tournament_game_id: G }), `/tournaments/result/${G}`, "opens the exact game")
  }
  const open = { items: [job("tournament_result", G)], coverage: "native" as const }
  const settled = { items: [], coverage: "native" as const }
  assert.equal(attentionVerdict("tournament_result_awaiting_confirmation", { tournament_game_id: G }, open, false), "open")
  assert.equal(attentionVerdict("tournament_result_awaiting_confirmation", { tournament_game_id: G }, settled, false), "done", "a stale ask is history once the game is settled")
})

test("the team's own projection carries tournament confirmations, and only for who may act -- and never a dispensation decision", () => {
  // The team confirmation stage was retired by the one dispensation workflow (20270742000000): a team's staff
  // ask for a dispensation and never decide one, so no team projection ever offers a dispensation decision.
  const a = { ...noTeamAuthority(), resultRecord: true, dispensationRequest: true, rosterManage: true }
  const base = { teamId: TEAM, todayIso: "2026-10-02", nextFixture: null, availability: null, incompleteFixtures: [], kickoffProposals: [], resultConfirmations: [], incomingRequests: [], pendingJoinRequests: 0, callUpsAwaiting: 0, subscriptionsNeedingAttention: null, ageGradeAttention: 0 }
  const items = projectTeamAttention({ ...base, authority: a, tournamentResultConfirmations: [{ gameId: G, dateIso: "2026-10-02" }] })
  assert.deepEqual(items.map((i) => i.kind).sort(), ["tournament_result"])
  assert.equal(items.find((i) => i.kind === "tournament_result")!.href, `/tournaments/result/${G}`)
  assert.ok(!("dispensationApprove" in noTeamAuthority()), "the team holds no dispensation approval key at all")
  const shared = teamAttentionItems({ teamId: TEAM, attention: items, upcoming: [] }, "c")
  assert.ok(shared.some((i) => i.id === `tournament_result:${G}`), "the shared shape keys it by the game, so the notification pairs to it")
  assert.deepEqual(projectTeamAttention({ ...base, authority: noTeamAuthority(), tournamentResultConfirmations: [{ gameId: G, dateIso: "x" }] }), [], "nobody without the authority is given the job")
  assert.deepEqual(projectTeamAttention({ ...base, authority: a, tournamentResultConfirmations: [] }), [], "and the job is gone when the state is")
})

test("reading or deleting a notification never resolves its job; only the record does", () => {
  const data = { fixture_id: F }
  const open = { items: [job("result_confirmation", F)], coverage: "native" as const }
  // The verdict reads the projection and nothing else -- there is no read or dismissed input to it.
  assert.equal(attentionVerdict("fixture_result_awaiting_confirmation", data, open, false), "open", "read or dismissed, still open while the record is")
  assert.equal(attentionVerdict.length, 4, "the verdict takes no read or dismissal state")
  const quick = code("components/notification-quick-view.tsx")
  assert.doesNotMatch(quick, /readAt[^\n]*attentionVerdict|dismiss[^\n]*invalidateAttention/, "neither reading nor deleting touches the projection's answer")
})

test("the club's projection carries contested tournament results for the organiser, and each dispensation waiting for this person's decision", () => {
  const club = code("../../../packages/contracts/src/attention/club.ts")
  assert.match(club, /"disputed", "amendment_pending"/, "contested and amended games are the organiser's")
  assert.match(club, /sourceType: "tournament_result"/)
  // The one dispensation workflow (20270742000000): one decision by the officer or a Club Admin, so the job is
  // whatever the server says waits for THIS person -- never the requester's own, never their own child's.
  assert.match(club, /readDispensationsWaiting\(/, "the server says which dispensations wait for this person")
  assert.match(club, /href: `\/dispensations\/\$\{d\.id\}`/, "each opens its own record, where it is decided")
  assert.deepEqual(routeForIntent(resolveIntent("ovalball://dispensations/d1")), { pathname: "/dispensations/[id]", params: { id: "d1" } }, "and the phone opens that record natively")
})

test("opening the bell re-asks the counts and the live jobs with the rows, so a notification that arrived while the app was open is counted", () => {
  const quick = code("components/notification-quick-view.tsx")
  const load = quick.slice(quick.indexOf("const load = useCallback"), quick.indexOf("useEffect(() => {\n    if (!visible) return"))
  assert.match(load, /readNotificationPage\(supabase, \{ limit: 12 \}\)/, "the rows")
  assert.match(load, /refreshUnread\(\)/, "the unread count, from the server, at the same moment")
  assert.match(load, /refreshAttention\(\)/, "and Action Required, from the projection, at the same moment")
})

test("the Match Result re-reads on every arrival, so a later notification tap never shows a stale state or notice", () => {
  const screen = code("fixtures/match-centre/result-section.tsx")
  assert.match(screen, /useFocusEffect\(\s*useCallback\(\(\) => \{\s*setDone\(null\)/, "the last action's notice is cleared on arrival")
  assert.match(screen, /useFocusEffect\([\s\S]*?void load\(\)/, "and the result is read again, as it is now")
})

test("a training plan notification opens that plan, not the list of plans", () => {
  const plan = "46f10de9-8e98-4a66-bb1d-a2185e088a33"
  const href = notificationHref("training_plan_schedule_changed", { training_plan_id: plan })
  assert.equal(href, `/club/training?plan=${plan}`)
  assert.deepEqual(routeForIntent(resolveIntent(`ovalball://${href.slice(1)}`)), { pathname: "/admin/training-planning/plan/[planId]", params: { planId: plan } })
  assert.deepEqual(routeForIntent(resolveIntent("ovalball://club/training")), { pathname: "/admin/training-planning" }, "with no plan named, Training Management")
  assert.deepEqual(routeForIntent(resolveIntent("ovalball://club/training?plan=not-an-id")), { pathname: "/admin/training-planning" }, "a value that is not an id is ignored, not routed")
})

test("a push tap and an in-app tap fall back the same way: the website's page for that exact object, never nothing", () => {
  const push = code("notifications/push.ts")
  const inApp = code("notifications/open.ts")
  const fallback = /Linking\.openURL\(`\$\{webUrl\}\$\{(item\.)?href\}`\)/
  assert.match(inApp, fallback, "the bell and the Centre hand an address with no native screen to the website")
  assert.match(push, fallback, "and so does a push tap, foreground or background")
  assert.doesNotMatch(push, /if \(route\) router\.push\(route as never\)\n\s*\}/, "no tap path ends silently when there is no native route")
})
