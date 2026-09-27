import type { FixtureRequestStatus, TeamFixtureRequest } from "./requests"

/**
 * FIXTURE REQUEST GROUPS (owner correction pass, Section 17): several `fixture_requests` rows sharing
 * one `group_id` were sent or received together as ONE ask -- one club offering several of its teams
 * against the matching teams at another club -- and belong on ONE inbox card, never N unrelated ones.
 * This is the shared read model behind My Requests, the request-count badge and the Fixture Request
 * detail screen; nothing here talks to Supabase, so it works identically over a single team's rows
 * (`readTeamFixtureRequests`) or a whole club's (`readClubFixtureRequests`).
 */
export type FixtureRequestGroupDirection = "sent" | "received"

/**
 * TRUTHFUL AGGREGATE VOCABULARY, never a naive "first request wins". Three accepted and one declined is
 * "Partially confirmed", not "Accepted" -- the owner's own example of what NOT to do.
 */
export type FixtureRequestGroupAggregateStatus = "pending" | "under_discussion" | "partially_confirmed" | "confirmed" | "declined" | "withdrawn" | "expired"

export interface FixtureRequestGroupSummary<T extends TeamFixtureRequest = TeamFixtureRequest> {
  groupId: string
  direction: FixtureRequestGroupDirection
  otherClub: string
  otherClubCrestUrl: string | null
  /** Every child request in the group, each still its own independently-trackable team pairing. */
  requests: T[]
  teamCount: number
  /** The one date every request in the group currently stands on (a countered date wins over the
   * original proposal) -- null when the group has never had a date proposed, or when its child requests
   * genuinely disagree, in which case `hasMixedDates` is the truthful thing to show instead. */
  proposedDate: string | null
  hasMixedDates: boolean
  aggregateStatus: FixtureRequestGroupAggregateStatus
  /** READ != RESOLVED (Section 18): true only when at least one child request is genuinely this
   * viewer's turn to answer -- never derived from a notification's read/unread flag. */
  requiresAction: boolean
  /** True only for a group WE sent, with at least one child request still open (`sent`/`counter_proposed`)
   * -- the requesting side may withdraw an unresolved ask at any time, independent of whether the other
   * side has already answered some of the other teams in the same batch. */
  canWithdraw: boolean
  withdrawableRequestIds: string[]
  resultingFixtureIds: string[]
  createdAt: string
  updatedAt: string
}

function computeAggregateStatus(requests: TeamFixtureRequest[]): FixtureRequestGroupAggregateStatus {
  const n = requests.length
  const count = (s: TeamFixtureRequest["status"]) => requests.filter((r) => r.status === s).length
  const accepted = count("accepted")
  if (accepted === n) return "confirmed"
  if (accepted > 0) return "partially_confirmed"
  const open = count("sent") + count("counter_proposed")
  if (open === n) return count("counter_proposed") > 0 ? "under_discussion" : "pending"
  // Some child requests are still open while others have already resolved without an accept: the
  // negotiation as a whole is still live, so this reads as ongoing discussion rather than any one
  // terminal word.
  if (open > 0) return "under_discussion"
  if (count("declined") > 0) return "declined"
  if (count("cancelled") === n) return "withdrawn"
  if (count("expired") === n) return "expired"
  // A genuine mix of cancelled and expired with nothing accepted or declined: closest truthful default,
  // since the group did not survive to a fixture either way.
  return "declined"
}

export function buildFixtureRequestGroupSummaries<T extends TeamFixtureRequest>(requests: T[]): FixtureRequestGroupSummary<T>[] {
  const byGroup = new Map<string, T[]>()
  for (const r of requests) {
    // A draft was never sent -- it belongs to nobody's inbox yet.
    if (r.status === "draft") continue
    byGroup.set(r.groupId, [...(byGroup.get(r.groupId) ?? []), r])
  }
  return Array.from(byGroup.entries())
    .map(([groupId, groupRequests]): FixtureRequestGroupSummary<T> => {
      const first = groupRequests[0]!
      const dates = new Set(groupRequests.map((r) => r.counteredDate ?? r.proposedDate).filter((d): d is string => d !== null))
      const withdrawableRequestIds = groupRequests.filter((r) => r.status === "sent" || r.status === "counter_proposed").map((r) => r.id)
      const direction: FixtureRequestGroupDirection = first.direction === "outgoing" ? "sent" : "received"
      return {
        groupId,
        direction,
        otherClub: first.otherClub,
        otherClubCrestUrl: first.otherClubCrestUrl,
        requests: [...groupRequests].sort((a, b) => (a.otherTeam ?? "").localeCompare(b.otherTeam ?? "")),
        teamCount: groupRequests.length,
        proposedDate: dates.size === 1 ? [...dates][0]! : null,
        hasMixedDates: dates.size > 1,
        aggregateStatus: computeAggregateStatus(groupRequests),
        requiresAction: groupRequests.some((r) => r.isMyTurn),
        canWithdraw: direction === "sent" && withdrawableRequestIds.length > 0,
        withdrawableRequestIds,
        resultingFixtureIds: groupRequests.map((r) => r.resultingFixtureId).filter((id): id is string => id !== null),
        createdAt: groupRequests.reduce((min, r) => (r.createdAt < min ? r.createdAt : min), first.createdAt),
        updatedAt: groupRequests.reduce((max, r) => (r.updatedAt > max ? r.updatedAt : max), first.updatedAt),
      }
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/**
 * THE FIXTURE REQUESTS BADGE (Sections 3/18): unresolved work, never a raw historical count. An accepted,
 * declined, withdrawn or expired group needs nothing further from anyone; a notification's read state is
 * never consulted here, because reading a request is not the same as it being resolved.
 */
export function countFixtureRequestGroupsRequiringAction(groups: FixtureRequestGroupSummary[]): number {
  return groups.filter((g) => g.requiresAction).length
}

/**
 * SWIPE TO CLEAR A CARD (owner correction pass, follow-up): once a group has genuinely FINISHED --
 * confirmed, declined, withdrawn or expired -- there is nothing further to do about it, and the viewer
 * may clear it from their own list. `pending`, `under_discussion` and `partially_confirmed` are never
 * clearable: each still has a leg that is open or still needs an answer, so hiding it would bury real
 * outstanding work rather than tidy up settled history.
 */
export function isClearableGroupStatus(status: FixtureRequestGroupAggregateStatus): boolean {
  return status === "confirmed" || status === "declined" || status === "withdrawn" || status === "expired"
}

export function fixtureRequestGroupStatusLabel(group: Pick<FixtureRequestGroupSummary, "aggregateStatus" | "requiresAction" | "direction">): {
  label: string
  tone: "positive" | "caution" | "negative" | "neutral"
} {
  switch (group.aggregateStatus) {
    case "confirmed":
      return { label: "Confirmed", tone: "positive" }
    case "partially_confirmed":
      return { label: "Partially confirmed", tone: "caution" }
    case "declined":
      return { label: "Declined", tone: "negative" }
    case "withdrawn":
      return { label: "Withdrawn", tone: "neutral" }
    case "expired":
      return { label: "Expired", tone: "neutral" }
    case "under_discussion":
      return { label: "Under discussion", tone: "caution" }
    case "pending":
      return group.requiresAction ? { label: "Response required", tone: "caution" } : { label: "Pending", tone: "caution" }
  }
}

/**
 * ONE STATUS VOCABULARY FOR A SINGLE CHILD REQUEST, shared by My Requests' team rows, the Fixture
 * Request detail screen and the club/team inboxes -- replacing three near-duplicate status maps that
 * had already drifted (one of them called a decline "neutral" rather than the restrained red/pink the
 * content standard asks for everywhere else this vocabulary appears).
 */
export function fixtureRequestStatusLabel(status: FixtureRequestStatus, isMyTurn = false): { label: string; tone: "positive" | "caution" | "negative" | "neutral" } {
  switch (status) {
    case "draft":
      return { label: "Draft", tone: "neutral" }
    case "sent":
      return isMyTurn ? { label: "Response required", tone: "caution" } : { label: "Waiting for an answer", tone: "caution" }
    case "accepted":
      return { label: "Accepted", tone: "positive" }
    case "declined":
      return { label: "Declined", tone: "negative" }
    case "counter_proposed":
      return isMyTurn ? { label: "Change proposed", tone: "caution" } : { label: "Waiting for an answer", tone: "caution" }
    case "cancelled":
      return { label: "Withdrawn", tone: "neutral" }
    case "expired":
      return { label: "Expired", tone: "neutral" }
  }
}

/**
 * "Sent 2h ago" (Section 5): relative wording for a card's own real `createdAt`, never a fabricated
 * time. Beyond a month, an exact day-and-month reads more truthfully than a vague "N months ago".
 */
export function relativeTimeAgo(iso: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso))
}
