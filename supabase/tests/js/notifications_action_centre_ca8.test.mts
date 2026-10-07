import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import {
  PRIORITY_LABEL,
  attentionId,
  attentionItem,
  countNeedingAction,
  groupAttention,
  sortAttention,
  type AttentionItem,
} from "../../../packages/contracts/src/attention/model"
import { teamAttentionItems } from "../../../packages/contracts/src/attention/team"
import { familyAttentionItems } from "../../../packages/contracts/src/attention/family"
import { CLUB_ATTENTION_KEYS } from "../../../packages/contracts/src/attention/club"
import { projectTeamAttention, type TeamAttentionInput } from "../../../packages/contracts/src/team/attention"
import { noTeamAuthority, type TeamAuthority } from "../../../packages/contracts/src/team/authority"
import {
  ASKING_TYPES,
  attentionStillOpen,
  attentionVerdict,
  notificationAttentionId,
  notificationAudience,
  notificationContextHint,
  notificationPriority,
  verdictWording,
} from "../../../packages/contracts/src/notifications/feed"
import { notificationHref } from "../../../packages/contracts/src/notifications/destinations"
import { resolveIntent } from "../../../apps/mobile/src/links/intents"
import { routeForIntent } from "../../../apps/mobile/src/links/destinations"
import { routeForAttentionItem } from "../../../apps/mobile/src/attention/routes"
import type { ParentAttention } from "../../../packages/contracts/src/parent/home"
import type { AgendaItem } from "../../../packages/contracts/src/agenda/load"

/**
 * CA-M8 -- NOTIFICATIONS, INBOX & ACTION CENTRE: the shared model, the pairing, the routing, and the
 * structural promises the phone makes (one domain, one resolver, no fake state).
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
const T1 = "11111111-1111-1111-1111-111111111111"
const F1 = "22222222-2222-2222-2222-222222222222"
const F2 = "33333333-3333-3333-3333-333333333333"
const C1 = "44444444-4444-4444-4444-444444444444"
const P1 = "55555555-5555-5555-5555-555555555555"
const S1 = "66666666-6666-6666-6666-666666666666"

const allow = (keys: (keyof TeamAuthority)[]): TeamAuthority => {
  const a = noTeamAuthority()
  for (const k of keys) a[k] = true
  return a
}
const teamInput = (extra: Partial<TeamAttentionInput> = {}): TeamAttentionInput => ({
  teamId: T1,
  todayIso: "2026-09-24",
  authority: allow(["attendanceView", "fixtureEdit", "requestRespond", "resultRecord", "rosterManage", "callupRequest", "subscriptionView"]),
  nextFixture: { fixtureId: F1, dateIso: "2026-09-26", kickoffTime: "10:30", homeAway: "Home", venueKnown: true, status: "Booked" },
  availability: { squad: 20, awaiting: 5 },
  incompleteFixtures: [],
  kickoffProposals: [{ fixtureId: F2, dateIso: "2026-10-10" }],
  resultConfirmations: [],
  incomingRequests: [{ requestId: C1 }],
  pendingJoinRequests: 2,
  callUpsAwaiting: 1,
  subscriptionsNeedingAttention: 1,
  ageGradeAttention: 0,
  ...extra,
})

const item = (over: Partial<Parameters<typeof attentionItem>[0]> = {}): AttentionItem =>
  attentionItem({
    sourceType: "fixture_availability",
    sourceId: F1,
    context: { kind: "team", clubId: C1, teamId: T1, playerId: null },
    priority: "needs_action",
    title: "5 still to answer",
    summary: null,
    href: `/fixtures/${F1}`,
    createdAt: null,
    dueAt: "2026-09-26",
    count: 5,
    capability: "team.attendance.view",
    ...over,
  })

// ------------------------------------------------------------------ the model

test("an attention item is always open, has a stable id and a canonical href, and never a resolved flag", () => {
  const a = item()
  assert.equal(a.state, "open")
  assert.equal(a.id, `fixture_availability:${F1}`)
  assert.equal(a.href, `/fixtures/${F1}`)
  assert.equal(attentionId("fixture_availability", F1, P1), `fixture_availability:${F1}:${P1}`)
  assert.ok(!("resolved" in a) && !("done" in a) && !("dismissed" in a), "resolution is the domain's, never a field")
})

test("priority is deterministic and the sort is priority, then the nearest due day, then the id", () => {
  const list = [
    item({ sourceId: "b", priority: "for_information", dueAt: null }),
    item({ sourceId: "a", priority: "needs_action", dueAt: "2026-10-01" }),
    item({ sourceId: "c", priority: "urgent", dueAt: "2026-09-30" }),
    item({ sourceId: "d", priority: "needs_action", dueAt: "2026-09-25" }),
    item({ sourceId: "e", priority: "needs_action", dueAt: null }),
  ]
  const once = sortAttention(list).map((i) => i.sourceId)
  const again = sortAttention([...list].reverse()).map((i) => i.sourceId)
  assert.deepEqual(once, ["c", "d", "a", "e", "b"])
  assert.deepEqual(again, once, "the read order never decides the shown order")
  assert.deepEqual(groupAttention(list).map((b) => [b.label, b.items.length]), [[PRIORITY_LABEL.urgent, 1], [PRIORITY_LABEL.needs_action, 3], [PRIORITY_LABEL.for_information, 1]])
  assert.equal(countNeedingAction(list), 4)
})

// ------------------------------------------------------------------ convergence with CA-M7

test("the team projection is CA-M7's rule read through the shared shape: same rows, same words, same urgency", () => {
  const team = projectTeamAttention(teamInput())
  const shared = teamAttentionItems({ teamId: T1, attention: team, upcoming: [] }, C1)
  assert.equal(shared.length, team.length)
  assert.deepEqual(shared.map((s) => s.title), team.map((t) => t.label))
  assert.deepEqual(shared.map((s) => s.priority === "urgent"), team.map((t) => t.urgent))
  assert.ok(shared.every((s) => s.context.kind === "team" && s.context.teamId === T1 && s.context.clubId === C1))
  assert.ok(shared.every((s) => s.priority !== "for_information"), "every team attention row is a job, never mere news")
  const availability = shared.find((s) => s.sourceType === "fixture_availability")!
  assert.equal(availability.sourceId, F1, "a row about one fixture carries that fixture as its source")
  assert.equal(availability.href, `/fixtures/${F1}`)
  const proposal = shared.find((s) => s.sourceType === "kickoff_proposal")!
  assert.equal(proposal.sourceId, F2)
  const places = shared.find((s) => s.sourceType === "team_place_request")!
  assert.equal(places.href, `/teams/${T1}/people`)
})

test("a capability the viewer lacks removes the row from the shared projection, exactly as it does from the team's", () => {
  const withheld = projectTeamAttention(teamInput({ authority: allow(["fixtureEdit"]) }))
  const shared = teamAttentionItems({ teamId: T1, attention: withheld, upcoming: [] }, C1)
  assert.ok(!shared.some((s) => s.sourceType === "fixture_availability"))
  assert.ok(!shared.some((s) => s.sourceType === "fixture_request"))
  assert.ok(shared.some((s) => s.sourceType === "kickoff_proposal"))
})

// ------------------------------------------------------------------ a family

const agenda = (over: Partial<AgendaItem> = {}): AgendaItem =>
  ({
    key: `fixture:${F1}:${P1}`,
    kind: "fixture",
    eventId: F1,
    date: "2026-09-26",
    time: "10:30",
    meetTime: null,
    us: { clubName: "Home", teamName: "Under 12 Boys", rugbyCode: "union", crestUrl: null, kit: null },
    them: null,
    homeAway: "Home",
    venue: null,
    pitch: null,
    status: "Booked",
    gameType: null,
    result: null,
    playerId: P1,
    teamId: T1,
    ...over,
  }) as unknown as AgendaItem

test("a family's attention is one row per child per unanswered event, plus a membership that needs the family", () => {
  const attention: ParentAttention[] = [
    { key: `availability:fixture:${F1}:${P1}`, kind: "availability", label: "Can Cara make it?", detail: "v Preston", playerId: P1, item: agenda(), urgent: true },
    { key: `availability:training:${S1}:${P1}`, kind: "availability", label: "Can Cara make training?", detail: "18:00", playerId: P1, item: agenda({ kind: "training", eventId: S1, date: "2026-10-05" }), urgent: false },
  ]
  const items = familyAttentionItems(
    attention,
    [
      { playerId: P1, playerName: "Cara", clubId: C1, programmeName: "Membership", attention: "failed" } as never,
      { playerId: "other", playerName: "Ava", clubId: C1, programmeName: "Membership", attention: "none" } as never,
    ],
    { kind: "parent", clubId: C1 }
  )
  assert.deepEqual(items.map((i) => i.id), [`fixture_availability:${F1}:${P1}`, `training_availability:${S1}:${P1}`, `family_subscription:${P1}`])
  assert.deepEqual(items.map((i) => i.priority), ["urgent", "needs_action", "urgent"])
  // An attendance question opens the Match Centre's Attendance section (consolidation, 2026-10-03).
  assert.equal(items[0].href, `/fixtures/${F1}?tab=attendance`)
  assert.equal(items[1].href, `/training/${S1}`)
  assert.equal(items[2].href, `/parent/players/${P1}/subscription`)
  assert.ok(items.every((i) => i.context.kind === "parent"), "a family row is a family row")
  assert.ok(!items.some((i) => i.title.includes("Ava")), "a membership in order is not attention")
})

// ------------------------------------------------------------------ navigation

test("a notification's href is the shared map's answer, and every destination the app opens goes through the one resolver", () => {
  // There used to be a second, typed `Destination` vocabulary alongside this plain string
  // (packages/contracts/src/navigation/destinations.ts, notificationDestination/destinationHref/
  // destinationForHref). It was retired: nothing on either platform actually navigated through it --
  // `routeForAttentionItem` and the Notifications screen always read `.href` -- so it was a second
  // source of truth that could only ever drift from the one real resolver, never correct it.
  // Since the Match Centre consolidation (2026-10-03) the href names the section it is about.
  const href = notificationHref("fixture_availability_responded", { fixture_id: F1, player_id: P1, team_id: T1 })
  assert.equal(href, `/fixtures/${F1}?tab=attendance`)
  // The same href, through the app's resolver, lands on the one Match Centre at that section.
  const route = routeForIntent(resolveIntent(`ovalball://${href.slice(1)}`))!
  assert.deepEqual(route, { pathname: "/fixtures/[fixtureId]", params: { fixtureId: F1, tab: "attendance" } })
  // A team row opens the team's own screen; a family row opens the same one Match Centre everybody does.
  const team = item()
  assert.equal(routeForAttentionItem(team, "team")!.pathname, "/team/availability/[kind]/[eventId]")
  const family = item({ context: { kind: "parent", clubId: C1, teamId: T1, playerId: P1 }, playerKey: P1 })
  assert.equal(routeForAttentionItem(family, "parent")!.pathname, "/fixtures/[fixtureId]")
  // A partner request opens the native Partnerships screen (notification correctness pass: it used to
  // open the website even though the screen exists). A genuinely web-only address still has no route.
  const partner = item({ sourceType: "partner_request", sourceId: C1, context: { kind: "club", clubId: C1, teamId: null, playerId: null }, href: "/clubhouse" })
  assert.equal(routeForAttentionItem(partner, "club")!.pathname, "/clubhouse/partnerships")
  const web = item({ sourceType: "partner_request", sourceId: C1, context: { kind: "club", clubId: C1, teamId: null, playerId: null }, href: "/admin/claims" })
  assert.equal(routeForAttentionItem(web, "club"), null)
  // Players asking to join open the native Guardians & Players queue (CA-M11.1), through the one resolver.
  const playerJoins = item({ sourceType: "player_join_request", sourceId: C1, context: { kind: "club", clubId: C1, teamId: null, playerId: null }, href: "/club/join-requests" })
  assert.equal(routeForAttentionItem(playerJoins, "club")!.pathname, "/admin/guardians/join-requests")
  // The club's own queue opens the native Admin Centre.
  const joins = item({ sourceType: "club_join_request", sourceId: C1, context: { kind: "club", clubId: C1, teamId: null, playerId: null }, href: "/people" })
  assert.equal(routeForAttentionItem(joins, "club")!.pathname, "/admin/people")
})

// ------------------------------------------------------------------ READ IS NOT RESOLVED, at the client

test("a notification is paired with the job it is about by canonical record, and 'still open' is only ever the projection's answer", () => {
  const open = [item()]
  assert.equal(notificationAttentionId("fixture_attendance_invitation", { fixture_id: F1 }), `fixture_availability:${F1}`)
  assert.equal(notificationAttentionId("fixture_availability_responded", { fixture_id: F1, player_id: P1 }), `fixture_availability:${F1}`)
  assert.equal(notificationAttentionId("fixture_kickoff_changed", { fixture_id: F1 }), null, "news pairs with nothing")
  assert.equal(attentionStillOpen("fixture_attendance_invitation", { fixture_id: F1 }, open), true)
  assert.equal(attentionStillOpen("fixture_attendance_invitation", { fixture_id: F2 }, open), false)
  assert.equal(attentionStillOpen("fixture_kickoff_changed", { fixture_id: F1 }, open), null)
  // A family row is per child: the invitation about the fixture pairs with any child's open row.
  const perChild = [item({ context: { kind: "parent", clubId: C1, teamId: T1, playerId: P1 }, playerKey: P1 })]
  assert.equal(attentionStillOpen("fixture_attendance_invitation", { fixture_id: F1 }, perChild), true)
  // Reading is not resolving: the same projection after a read mutation gives the same answer.
  assert.equal(attentionStillOpen("fixture_attendance_invitation", { fixture_id: F1 }, open), true)

  // Phase E of the notifications programme: a failed-payment notification used to pair with nothing
  // (its payload carried obligation_id, not the player_id the family money row is keyed by) and so
  // could never be confirmed done once the family fixed their payment details. The producer
  // (apply_payment_status_transition, 20270712000000) now carries player_id too.
  assert.equal(notificationAttentionId("gocardless_payment_failed", { obligation_id: "ob-1", player_id: P1 }), `family_subscription:${P1}`)
  assert.equal(notificationAttentionId("gocardless_payment_failed", { obligation_id: "ob-1" }), null, "no player_id, no guessing")
  const familyMoney = [item({ sourceType: "family_subscription", sourceId: P1, context: { kind: "parent", clubId: C1, teamId: null, playerId: P1 } })]
  assert.equal(attentionStillOpen("gocardless_payment_failed", { player_id: P1 }, familyMoney), true)
  assert.equal(attentionStillOpen("gocardless_payment_failed", { player_id: P1 }, []), false, "the family fixed it: the row is gone, so the notification is done")
})

test("the verdict is silent outside the context whose job it is, and silent where the app cannot see", () => {
  const staffOpen = { items: [item()], coverage: "native" as const }
  assert.equal(attentionVerdict("fixture_availability_responded", { fixture_id: F1 }, staffOpen, false), "open")
  assert.equal(attentionVerdict("fixture_availability_responded", { fixture_id: F2 }, staffOpen, false), "unknown", "a team's projection holds the next fixture's register only: absence proves nothing")
  assert.equal(attentionVerdict("fixture_request_received", { fixture_request_id: F2 }, staffOpen, false), "done", "a request the projection could hold and does not is dealt with")
  assert.deepEqual(verdictWording("fixture_attendance_invitation"), { open: "Still needs your answer", done: "Answered" })
  assert.equal(verdictWording("fixture_availability_responded").open, "Answers still coming in")
  assert.equal(attentionVerdict("fixture_availability_responded", { fixture_id: F1 }, staffOpen, true), "unknown", "a staff ask judged in a family context says nothing")
  assert.equal(attentionVerdict("fixture_attendance_invitation", { fixture_id: F1 }, staffOpen, false), "unknown", "a family ask judged in a staff context says nothing")
  assert.equal(attentionVerdict("fixture_attendance_invitation", { fixture_id: F1 }, { items: [], coverage: "native" }, true), "done")
  assert.equal(attentionVerdict("fixture_attendance_invitation", { fixture_id: F1 }, { items: [], coverage: "web" }, true), "unknown", "a web desk's queue is never judged empty by the phone")
  assert.equal(attentionVerdict("fixture_attendance_invitation", { fixture_id: F1 }, null, true), "unknown")
  assert.equal(notificationAudience("fixture_attendance_invitation"), "family")
  assert.equal(notificationAudience("fixture_request_received"), "staff")
  assert.equal(notificationAudience("fixture_kickoff_changed"), "either")
})

test("priority from a type is deterministic, cancellations and failed money are urgent, and asks need action", () => {
  assert.equal(notificationPriority("fixture_cancelled"), "urgent")
  assert.equal(notificationPriority("gocardless_payment_failed"), "urgent")
  assert.equal(notificationPriority("fixture_request_received"), "needs_action")
  assert.equal(notificationPriority("fixture_availability_responded"), "for_information")
  assert.equal(notificationPriority("something_unregistered"), "for_information")
  for (const t of ASKING_TYPES) assert.notEqual(notificationPriority(t), "for_information", t)
  assert.deepEqual(notificationContextHint({ team_id: T1, club_id: C1, player_id: P1, fixture_id: F1 }), { teamId: T1, clubId: C1, playerId: P1 })
  assert.deepEqual(notificationContextHint({ team_id: 42 }), { teamId: null, clubId: null, playerId: null }, "an id that is not a string is not an id")
})

// ------------------------------------------------------------------ structural promises

test("the phone has no notification store, no action-item table and no read state of its own", () => {
  const files = [...walk(join(MOBILE, "src")), ...walk(join(MOBILE, "app"))].filter((f) => /\.tsx?$/.test(f))
  for (const f of files) {
    const src = code(f)
    assert.doesNotMatch(src, /mobile_notifications|mobile_action_items|action_items|attention_items/, `${f} reaches for a second store`)
    // Messenger's own read path (CA-M5) settles a conversation's message notifications under RLS and is
    // deliberately untouched by CA-M8; everything else goes through the canonical read mutation.
    if (f.endsWith("src/messages/conversation.ts")) continue
    assert.doesNotMatch(src, /from\("notifications"\)\s*\.\s*(update|insert|delete)/, `${f} writes the notifications table directly`)
    assert.doesNotMatch(src, /AsyncStorage[^\n]*(read_at|readAt|unread)/, `${f} keeps read state on the device`)
    assert.doesNotMatch(src, /resolved\s*[:=]\s*true/, `${f} marks something resolved`)
  }
  const contracts = walk("packages/contracts/src").filter((f) => /\.ts$/.test(f))
  for (const f of contracts) {
    assert.doesNotMatch(code(f), /from\("notifications"\)\s*\.\s*(update|insert|delete)/, `${f} bypasses the read mutation`)
  }
})

test("the Notifications screen reads the paged feed, marks read through the canonical operations, and switches context only into a held team", () => {
  const screen = code(join(MOBILE, "app/(tabs)/notifications/index.tsx"))
  assert.match(screen, /readNotificationPage\(/, "the feed is the shared paged reader")
  assert.match(screen, /markNotificationRead\(supabase/, "read goes through the canonical operation")
  assert.match(screen, /markNotificationUnread\(supabase/, "unread is a real operation")
  assert.match(screen, /markAllNotificationsRead\(supabase/, "mark-all is the bell's own")
  // routeForHref (src/links/destinations.ts) wraps resolveIntent + routeForIntent in one call -- the same function the push tap handler (src/notifications/push.ts)
  // now shares, so a push tap and an in-app tap resolve identically. Checking for it here, rather
  // than for resolveIntent directly, is what "one resolver" now means.
  // OPENING lives in one shared navigator (src/notifications/open.ts) that the Centre and the bell's
  // quick view both use, so the two surfaces cannot route the same row differently.
  const navigator = code(join(MOBILE, "src/notifications/open.ts"))
  assert.match(screen, /useNotificationNavigator\(\)/, "the Centre opens through the shared navigator")
  assert.match(navigator, /routeForHref\(/, "one resolver")
  // There is nothing left to narrow: every fixture opens the one Match Centre (consolidation,
  // 2026-10-03), and routeForHref -- shared with the push tap handler -- is resolveIntent + routeForIntent.
  assert.match(code(join(MOBILE, "src/links/destinations.ts")), /return routeForIntent\(resolveIntent\(/, "one resolver, shared with push")
  assert.match(navigator, /teamContextKeyFor\(hint\.teamId, contexts, active\)/, "a link selects a held context through the canonical rule")
  assert.doesNotMatch(navigator, /select\(`team:\$\{/, "and never builds a context key from a link")
  assert.match(screen, /attentionVerdict\(/, "still-open comes from the projection")
  assert.match(screen, /useAttention\(\)/, "the same projection Home reads")
  assert.match(screen, /coverage === "native"/, "the Needs Action filter is offered only where the projection can say")
  // DELETE (owner product decision, notifications UX pass) is the server's dismissal with an Undo --
  // never a phone-local hide, and never a resolution of the job the notification was about.
  assert.match(screen, /dismissNotification\(supabase/, "delete is the canonical server operation")
  assert.match(screen, /restoreNotification\(supabase/, "and undo is its canonical reverse")
  assert.doesNotMatch(screen, /resolve|complete_attention|answer.*on delete/i, "deleting never resolves the job")
  assert.match(screen, /You're all caught up/, "the caught-up state")
  assert.match(screen, /No new notifications/, "the nothing-new state")
})

test("Home and the Team workspace read the one projection and the sign-out forgets it", () => {
  assert.match(code(join(MOBILE, "app/(tabs)/index.tsx")), /<HomeAttention \/>/)
  assert.match(code(join(MOBILE, "src/attention/home-attention.tsx")), /useAttention\(\)/)
  const teamHome = code(join(MOBILE, "src/team/home.tsx"))
  assert.match(teamHome, /teamAttentionItems\(overview/, "the Team Home draws its rows through the shared model")
  assert.match(teamHome, /routeForAttentionItem\(/, "and opens them through the shared route table")
  // CA-M11 moved the sign-out list to one place; More still leaves through it.
  const more = code(join(MOBILE, "app/(tabs)/more.tsx"))
  assert.match(more, /leaveSession\(signOut\)/, "More does not sign out through the one list")
  const leave = code(join(MOBILE, "src/auth/leave.ts"))
  assert.match(leave, /forgetAttentionCache\(\)/, "sign-out forgets what needed the previous person")
  const hook = code(join(MOBILE, "src/attention/use-attention.ts"))
  assert.match(hook, /setRead\(null\)\s*\n\s*void load\(false\)/, "the previous context's answer is cleared before the next is asked for")
  const cache = code(join(MOBILE, "src/attention/cache.ts"))
  assert.doesNotMatch(cache, /AsyncStorage|SecureStore/, "the attention cache never touches disk")
})

test("the badge is the canonical unread count and the action count is a separate word", () => {
  const screen = code(join(MOBILE, "app/(tabs)/notifications/index.tsx"))
  assert.match(screen, /unread\.notifications/, "the header figure is the one canonical read")
  assert.match(screen, /countNeedingAction\(/, "the action figure is the projection's")
  assert.doesNotMatch(screen, /unread\.notifications\s*\+|\+\s*actionCount/, "the two are never added")
  const projection = code(join(MOBILE, "src/context/header-projection.ts"))
  assert.doesNotMatch(projection, /attention|action/i, "the header badge knows nothing about action counts")
})

test("preferences are native only because every switch controls something real, push included now that it is (M7)", () => {
  // Phase I split the old single giant-cards screen into a compact Overview (read-only rows) and a
  // per-category Detail screen (the real switches) -- app/(tabs)/notifications/preferences.tsx no
  // longer exists.
  const overview = code(join(MOBILE, "app/(tabs)/notifications/preferences/index.tsx"))
  assert.match(overview, /readNotificationPreferences\(supabase/, "the overview rows are the canonical settings")
  assert.doesNotMatch(overview, /<Switch/, "the overview is read-only -- it names delivery methods, it does not control them")

  const detail = code(join(MOBILE, "app/(tabs)/notifications/preferences/[topicKey].tsx"))
  assert.match(detail, /setNotificationPreference\(supabase/, "the topic-level write is the canonical operation")
  assert.match(detail, /readNotificationPreferences\(supabase/, "the topic-level rows are the canonical settings")
  // Push stopped being pretended-away in M7: a real device-token pipeline exists
  // (supabase/tests/push_notifications.sql), so the switch controls something real now.
  assert.match(detail, /pushEnabled/, "a real push switch exists")
  assert.match(detail, /topic\.mandatory \?/, "a mandatory topic has no switch")

  // Phase D/I: event-level granularity ("Notify me about"), honestly shown only for a topic the
  // server actually has events built for (today: Tournaments) -- never a row of switches controlling
  // nothing.
  assert.match(detail, /readNotificationEventPreferences\(supabase/, "the event-level rows are the canonical settings")
  assert.match(detail, /setNotificationEventPreference\(supabase/, "the event-level write is the canonical operation")
  assert.match(detail, /hasType/, "an event with no type behind it yet is not shown as if it were controllable")

  const contract = code("packages/contracts/src/notifications/preferences.ts")
  assert.match(contract, /p_push_enabled/, "the contract writes the channel that now exists")
  assert.match(contract, /set_notification_event_preference/, "the contract writes the event-level channel too")
})

test("the club projection asks one authority probe and only reads behind a held capability", () => {
  const club = code("packages/contracts/src/attention/club.ts")
  assert.equal((club.match(/rpc\("my_capabilities"/g) ?? []).length, 1)
  for (const key of Object.values(CLUB_ATTENTION_KEYS)) assert.match(club, new RegExp(`may\\(CLUB_ATTENTION_KEYS\\.\\w+\\)`), key)
  assert.doesNotMatch(club, /guardian_link|safeguarding_/, "no guardian-link or safeguarding queue is projected on the phone")
  // A DISPENSATION WAITING FOR A DECISION IS A JOB (notification closure, instruction 2: it reaches Action
  // Required, opens the decision and clears). INTENDED CHANGE (the one dispensation workflow, 20270742000000):
  // it used to be a nameless stage behind fixture.dispensation.approve_club. The owner's brief names the
  // child -- "Dispensation requested for <child>" -- for the Safeguarding Officer and the Club Admin alike.
  // What keeps that safe is WHO is shown it: the job comes only from the server's
  // dispensation_decisions_waiting, which returns only records this person may decide (never the person who
  // asked, never the child's family), so nobody reads a child's name here who could not open the record.
  const start = club.indexOf('sourceType: "dispensation"')
  const stage = club.slice(start, club.indexOf("capability:", start))
  assert.match(club, /readDispensationsWaiting\(/, "the job comes from the server's own list of decisions waiting")
  assert.match(stage, /title: dispensationWaitingTitle\(d\)/, "named as the brief names it")
  assert.match(stage, /href: `\/dispensations\/\$\{d\.id\}`/, "and it opens the record itself")
  assert.doesNotMatch(club, /from\("player_team_dispensation"\)/, "no client reads the dispensation table to find the job")
})

test("push (M7) is real, registered through the canonical RPCs, and taps go through the one resolver, not a second routing table", () => {
  const pkg = JSON.parse(read(join(MOBILE, "package.json")))
  assert.ok("expo-notifications" in (pkg.dependencies ?? {}), "the real push dependency is present")
  const push = code(join(MOBILE, "src/notifications/push.ts"))
  assert.match(push, /register_push_device_token/, "registration goes through the governed RPC")
  assert.match(push, /unregister_push_device_token/, "sign-out unregisters through the governed RPC")
  assert.doesNotMatch(push, /from\("push_device_tokens"\)\s*\.\s*(insert|update|delete)/, "no direct write to the token table")
  // A tap -- foreground or backgrounded -- resolves through routeForHref, the same function the
  // in-app notification list uses (src/links/destinations.ts): one resolver, not a push-specific one.
  assert.match(push, /routeForHref\(/, "push tap routing reuses the shared resolver")
  assert.doesNotMatch(push, /case "fixture"|case "tournament"|switch\s*\(.*\.type\)/, "no second type-to-route switch lives in the push module")
})
