import { test } from "node:test"
import assert from "node:assert/strict"

import {
  buildFixtureRequestGroupSummaries,
  countFixtureRequestGroupsRequiringAction,
  fixtureRequestGroupStatusLabel,
  isClearableGroupStatus,
  relativeTimeAgo,
} from "../../../packages/contracts/src/team/request-groups"
import type { TeamFixtureRequest } from "../../../packages/contracts/src/team/requests"

/**
 * PERMANENT REGRESSION PINS (owner correction pass, Section 17/18, and the follow-up Withdraw request):
 * the group-summary read model behind My Requests, the Fixture Requests badge and the Fixture Request
 * detail screen. The owner's own worked example -- three requests in one batch, two accepted and one
 * still pending -- must never collapse to "Accepted".
 */
function req(overrides: Partial<TeamFixtureRequest> = {}): TeamFixtureRequest {
  return {
    id: `req-${Math.random()}`,
    direction: "outgoing",
    status: "sent",
    proposedDate: "2026-10-17",
    preferredKickoffTime: null,
    venuePreference: "home",
    otherClub: "Ovalball UAT North RFC",
    otherTeam: "Men's 1st",
    gameType: "Friendly",
    note: null,
    createdAt: "2026-09-20T10:00:00Z",
    decidedAt: null,
    canNegotiate: true,
    isMyTurn: false,
    updatedAt: "2026-09-20T10:00:00Z",
    counteredDate: null,
    counteredKickoffTime: null,
    counteredVenuePreference: null,
    counterNote: null,
    groupId: "group-1",
    resultingFixtureId: null,
    otherClubCrestUrl: null,
    ...overrides,
  }
}

test("buildFixtureRequestGroupSummaries: rows sharing a group_id become ONE card, never N unrelated ones", () => {
  const groups = buildFixtureRequestGroupSummaries([
    req({ id: "a", groupId: "group-1", otherTeam: "Men's 1st" }),
    req({ id: "b", groupId: "group-1", otherTeam: "Women's 1st" }),
    req({ id: "c", groupId: "group-2", otherTeam: "Under 16 Boys" }),
  ])
  assert.equal(groups.length, 2)
  const g1 = groups.find((g) => g.groupId === "group-1")!
  assert.equal(g1.teamCount, 2)
})

test("aggregateStatus: the owner's own example -- 2 accepted, 1 pending -- is 'partially_confirmed', never naively 'confirmed'", () => {
  const [group] = buildFixtureRequestGroupSummaries([
    req({ id: "a", status: "accepted" }),
    req({ id: "b", status: "accepted" }),
    req({ id: "c", status: "sent" }),
  ])
  assert.equal(group!.aggregateStatus, "partially_confirmed")
})

test("aggregateStatus: all accepted is 'confirmed'", () => {
  const [group] = buildFixtureRequestGroupSummaries([req({ id: "a", status: "accepted" }), req({ id: "b", status: "accepted" })])
  assert.equal(group!.aggregateStatus, "confirmed")
})

test("aggregateStatus: all freshly sent is 'pending'; any live counter-proposal makes it 'under_discussion'", () => {
  const [allSent] = buildFixtureRequestGroupSummaries([req({ id: "a", status: "sent" }), req({ id: "b", status: "sent" })])
  assert.equal(allSent!.aggregateStatus, "pending")

  const [countered] = buildFixtureRequestGroupSummaries([req({ id: "a", status: "sent" }), req({ id: "b", status: "counter_proposed" })])
  assert.equal(countered!.aggregateStatus, "under_discussion")
})

test("aggregateStatus: some still open and none accepted -- live discussion, never a premature terminal label", () => {
  const [group] = buildFixtureRequestGroupSummaries([req({ id: "a", status: "declined" }), req({ id: "b", status: "sent" })])
  assert.equal(group!.aggregateStatus, "under_discussion")
})

test("aggregateStatus: terminal states with nothing accepted or open -- declined wins over a mixed cancelled/expired reading, and all-cancelled reads as withdrawn", () => {
  assert.equal(buildFixtureRequestGroupSummaries([req({ id: "a", status: "declined" }), req({ id: "b", status: "cancelled" })])[0]!.aggregateStatus, "declined")
  assert.equal(buildFixtureRequestGroupSummaries([req({ id: "a", status: "cancelled" }), req({ id: "b", status: "cancelled" })])[0]!.aggregateStatus, "withdrawn")
  assert.equal(buildFixtureRequestGroupSummaries([req({ id: "a", status: "expired" }), req({ id: "b", status: "expired" })])[0]!.aggregateStatus, "expired")
})

test("proposedDate: a uniform date across every child request is reported; a genuine disagreement reports mixed rather than picking one arbitrarily", () => {
  const [same] = buildFixtureRequestGroupSummaries([req({ id: "a", proposedDate: "2026-10-17" }), req({ id: "b", proposedDate: "2026-10-17" })])
  assert.equal(same!.proposedDate, "2026-10-17")
  assert.equal(same!.hasMixedDates, false)

  const [mixed] = buildFixtureRequestGroupSummaries([req({ id: "a", proposedDate: "2026-10-17" }), req({ id: "b", proposedDate: "2026-10-24" })])
  assert.equal(mixed!.proposedDate, null)
  assert.equal(mixed!.hasMixedDates, true)
})

test("proposedDate: a countered date is the standing proposal, overriding the original ask", () => {
  const [group] = buildFixtureRequestGroupSummaries([req({ id: "a", proposedDate: "2026-10-17", counteredDate: "2026-10-24", status: "counter_proposed" })])
  assert.equal(group!.proposedDate, "2026-10-24")
})

test("requiresAction: READ != RESOLVED -- driven only by isMyTurn, never a notification read flag, and excludes every terminal group", () => {
  const needsAnswer = buildFixtureRequestGroupSummaries([req({ id: "a", status: "sent", isMyTurn: true })])[0]!
  assert.equal(needsAnswer.requiresAction, true)

  const waitingOnThem = buildFixtureRequestGroupSummaries([req({ id: "a", status: "sent", isMyTurn: false })])[0]!
  assert.equal(waitingOnThem.requiresAction, false)

  const accepted = buildFixtureRequestGroupSummaries([req({ id: "a", status: "accepted", isMyTurn: false })])[0]!
  assert.equal(accepted.requiresAction, false)
})

test("countFixtureRequestGroupsRequiringAction: counts groups needing attention, never terminal historical ones", () => {
  const groups = buildFixtureRequestGroupSummaries([
    req({ id: "a", groupId: "g1", status: "sent", isMyTurn: true }),
    req({ id: "b", groupId: "g2", status: "accepted" }),
    req({ id: "c", groupId: "g3", status: "declined" }),
    req({ id: "d", groupId: "g4", status: "sent", isMyTurn: false }),
  ])
  assert.equal(countFixtureRequestGroupsRequiringAction(groups), 1)
})

test("canWithdraw: only a group WE sent, with something still open, may be withdrawn -- never an incoming request, never an already-resolved group", () => {
  const oursOpen = buildFixtureRequestGroupSummaries([req({ id: "a", direction: "outgoing", status: "sent" })])[0]!
  assert.equal(oursOpen.canWithdraw, true)
  assert.deepEqual(oursOpen.withdrawableRequestIds, ["a"])

  const theirsOpen = buildFixtureRequestGroupSummaries([req({ id: "a", direction: "incoming", status: "sent" })])[0]!
  assert.equal(theirsOpen.canWithdraw, false)

  const oursAccepted = buildFixtureRequestGroupSummaries([req({ id: "a", direction: "outgoing", status: "accepted" })])[0]!
  assert.equal(oursAccepted.canWithdraw, false)
})

test("canWithdraw: a partially-answered batch we sent can still withdraw exactly the requests still open, not the ones already decided", () => {
  const group = buildFixtureRequestGroupSummaries([
    req({ id: "a", direction: "outgoing", status: "accepted" }),
    req({ id: "b", direction: "outgoing", status: "sent" }),
  ])[0]!
  assert.equal(group.canWithdraw, true)
  assert.deepEqual(group.withdrawableRequestIds, ["b"])
})

test("fixtureRequestGroupStatusLabel: a pending group awaiting our own answer reads 'Response required', not a generic 'Pending'", () => {
  assert.equal(fixtureRequestGroupStatusLabel({ aggregateStatus: "pending", requiresAction: true, direction: "received" }).label, "Response required")
  assert.equal(fixtureRequestGroupStatusLabel({ aggregateStatus: "pending", requiresAction: false, direction: "sent" }).label, "Pending")
  assert.equal(fixtureRequestGroupStatusLabel({ aggregateStatus: "declined", requiresAction: false, direction: "sent" }).tone, "negative")
})

test("isClearableGroupStatus: a genuinely finished group (Confirmed, Declined, Withdrawn, Expired) is clearable; anything with real outstanding work is not", () => {
  assert.equal(isClearableGroupStatus("confirmed"), true)
  assert.equal(isClearableGroupStatus("declined"), true)
  assert.equal(isClearableGroupStatus("withdrawn"), true)
  assert.equal(isClearableGroupStatus("expired"), true)
  assert.equal(isClearableGroupStatus("pending"), false)
  assert.equal(isClearableGroupStatus("under_discussion"), false)
  assert.equal(isClearableGroupStatus("partially_confirmed"), false, "a leg is still open -- never clearable merely because another leg was accepted")
})

test("relativeTimeAgo: never a fabricated time -- always derived from the real timestamp against 'now'", () => {
  const now = new Date("2026-09-27T12:00:00Z")
  assert.equal(relativeTimeAgo("2026-09-27T11:55:00Z", now), "5m ago")
  assert.equal(relativeTimeAgo("2026-09-27T10:00:00Z", now), "2h ago")
  assert.equal(relativeTimeAgo("2026-09-25T12:00:00Z", now), "2d ago")
  assert.equal(relativeTimeAgo("2026-09-10T12:00:00Z", now), "2w ago")
})
