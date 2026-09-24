import type { TeamAuthority } from "./authority"

/**
 * NEEDS ATTENTION FOR A TEAM -- ONE PROJECTION OVER CANONICAL STATE (CA-M7).
 *
 * There is no task table. Every item here is DERIVED from a canonical record that already means "somebody
 * has to do something": an availability answer that has not arrived, a fixture request addressed to this
 * team and still `sent`, a kick-off change the other club proposed, a place request waiting on the roster,
 * a call-up waiting on the source team, a subscription obligation that failed, a fixture within reach that
 * still has no kick-off time or ground. When the record changes, the item goes; nothing is "completed"
 * here, and opening an item never resolves it.
 *
 * AUTHORITY-AWARE, NEVER AUTHORITY. Each kind names the capability a person needs to ACT on it, and an
 * item is only projected for somebody the server said holds that capability -- a read-only persona is
 * told what is true about the team elsewhere on the page, but is not handed a job they cannot do. The
 * server refuses the write regardless; this only decides what is worth drawing.
 *
 * DESTINATIONS ARE THE WEBSITE'S CANONICAL ADDRESSES, so a notification, the web dashboard and the phone
 * all land in the one place where the job is actually done. The app resolves them through its own intent
 * table; nothing here is a screen name.
 *
 * ORDER IS THE DOMAIN'S SENSE OF PRIORITY, not a colour: what blocks a match this week first, then what
 * is waiting on this team, then what is waiting on somebody else. `urgent` is reserved for a thing that
 * is genuinely at risk within days.
 */
export type TeamAttentionKind =
  | "availability"
  | "fixture_incomplete"
  | "kickoff_proposal"
  | "result_confirmation"
  | "fixture_request"
  | "join_request"
  | "call_up"
  | "subscription"
  | "age_grade"

export interface TeamAttentionItem {
  kind: TeamAttentionKind
  key: string
  /** What is waiting, in the product's words. */
  label: string
  /** The second line, where a count alone would not say enough. */
  detail: string | null
  /** The website's canonical address for where this is dealt with. */
  href: string
  /** How many, where a count is meaningful. */
  count: number
  urgent: boolean
  /** The canonical capability the viewer holds that makes this item theirs. */
  capability: string
}

/** How close a fixture must be for an unanswered squad to be urgent rather than merely open. */
export const ATTENTION_URGENT_WITHIN_DAYS = 3
/** How far ahead a fixture with no time or ground is somebody's problem today. */
export const ATTENTION_INCOMPLETE_WITHIN_DAYS = 14

export interface TeamAttentionInput {
  teamId: string
  todayIso: string
  authority: TeamAuthority
  /** The next fixture that is on, if any, with the two facts an incomplete-fixture check needs. */
  nextFixture: { fixtureId: string; dateIso: string; kickoffTime: string | null; homeAway: string | null; venueKnown: boolean; status: string | null } | null
  /** The squad's answers for `nextFixture`, from `fixture_availability_summary`; null where the server declined to say. */
  availability: { squad: number; awaiting: number } | null
  /** Upcoming fixtures (this team's, on) still missing a kick-off time, or a ground for a home match. */
  incompleteFixtures: { fixtureId: string; dateIso: string; missing: ("kick-off" | "ground")[] }[]
  /** Fixtures where the OTHER club proposed a kick-off change and this club has not answered. */
  kickoffProposals: { fixtureId: string; dateIso: string }[]
  /** Fixtures where a result is waiting for this club to confirm or dispute. */
  resultConfirmations: { fixtureId: string; dateIso: string }[]
  /** Requests addressed to this team and still `sent`. */
  incomingRequests: { requestId: string }[]
  /** Place requests (`player_team_memberships` pending) on this team. */
  pendingJoinRequests: number
  /** Call-ups requested FROM this team, waiting on its decision. */
  callUpsAwaiting: number
  /** From the team subscription projection, only where the viewer may see it. Null otherwise. */
  subscriptionsNeedingAttention: number | null
  /** Players whose age grade needs a club decision, from `team_age_grade_attention`. */
  ageGradeAttention: number
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T12:00:00Z`).getTime()
  const b = new Date(`${toIso}T12:00:00Z`).getTime()
  return Math.round((b - a) / 86_400_000)
}

export function projectTeamAttention(input: TeamAttentionInput): TeamAttentionItem[] {
  const { authority: a, teamId } = input
  const items: TeamAttentionItem[] = []

  // ---- What blocks a match this week ---------------------------------------------------------
  if (a.fixtureEdit) {
    for (const f of input.incompleteFixtures) {
      const days = daysBetween(input.todayIso, f.dateIso)
      if (days < 0 || days > ATTENTION_INCOMPLETE_WITHIN_DAYS) continue
      items.push({
        kind: "fixture_incomplete",
        key: `fixture-incomplete:${f.fixtureId}`,
        label: f.missing.length === 2 ? "A fixture has no kick-off time or ground yet" : f.missing[0] === "kick-off" ? "A fixture has no kick-off time yet" : "A home fixture has no ground yet",
        detail: days === 0 ? "It is today" : days === 1 ? "It is tomorrow" : `In ${days} days`,
        href: `/fixtures/${f.fixtureId}`,
        count: 1,
        urgent: days <= ATTENTION_URGENT_WITHIN_DAYS,
        capability: "fixture.fixture.edit",
      })
    }
    for (const p of input.kickoffProposals) {
      items.push({
        kind: "kickoff_proposal",
        key: `kickoff-proposal:${p.fixtureId}`,
        label: "The other club has proposed a new kick-off",
        detail: "Accept it or turn it down on the fixture",
        href: `/fixtures/${p.fixtureId}`,
        count: 1,
        urgent: daysBetween(input.todayIso, p.dateIso) <= ATTENTION_URGENT_WITHIN_DAYS,
        capability: "fixture.fixture.edit",
      })
    }
  }

  if (a.attendanceView && input.nextFixture && input.availability && input.availability.awaiting > 0) {
    const n = input.availability.awaiting
    const days = daysBetween(input.todayIso, input.nextFixture.dateIso)
    items.push({
      kind: "availability",
      key: `availability:${input.nextFixture.fixtureId}`,
      label: `${n} ${plural(n, "player has", "players have")} not said whether they can play`,
      detail: days === 0 ? "The match is today" : days === 1 ? "The match is tomorrow" : `The match is in ${days} days`,
      href: `/fixtures/${input.nextFixture.fixtureId}`,
      count: n,
      urgent: days <= ATTENTION_URGENT_WITHIN_DAYS,
      capability: "team.attendance.view",
    })
  }

  if (a.resultRecord) {
    for (const r of input.resultConfirmations) {
      items.push({
        kind: "result_confirmation",
        key: `result:${r.fixtureId}`,
        label: "A result is waiting for your club to confirm",
        detail: null,
        href: `/fixtures/${r.fixtureId}`,
        count: 1,
        urgent: false,
        capability: "fixture.result.record",
      })
    }
  }

  // ---- What is waiting on this team --------------------------------------------------------
  if (a.requestRespond && input.incomingRequests.length > 0) {
    const n = input.incomingRequests.length
    items.push({
      kind: "fixture_request",
      key: "fixture-requests",
      label: n === 1 ? "A fixture request is waiting for your answer" : `${n} fixture requests are waiting for your answer`,
      detail: null,
      // One request goes to that request; several is a list, and the register is the honest answer to a list.
      href: n === 1 ? `/messages/request/${input.incomingRequests[0].requestId}` : "/fixtures",
      count: n,
      urgent: false,
      capability: "fixture.request.respond",
    })
  }

  if (a.rosterManage && input.pendingJoinRequests > 0) {
    const n = input.pendingJoinRequests
    items.push({
      kind: "join_request",
      key: "join-requests",
      label: n === 1 ? "Somebody is waiting to join the team" : `${n} people are waiting to join the team`,
      detail: "Approve or decline under People",
      href: `/teams/${teamId}/people`,
      count: n,
      urgent: false,
      capability: "team.roster.manage",
    })
  }

  if (a.callupRequest && input.callUpsAwaiting > 0) {
    const n = input.callUpsAwaiting
    items.push({
      kind: "call_up",
      key: "call-ups",
      label: n === 1 ? "A player request is waiting for your decision" : `${n} player requests are waiting for your decision`,
      detail: "Another team has asked for one of your players",
      href: `/teams/${teamId}/player-requests`,
      count: n,
      urgent: false,
      capability: "fixture.callup.request",
    })
  }

  // ---- Money and eligibility ---------------------------------------------------------------
  if (a.subscriptionView && (input.subscriptionsNeedingAttention ?? 0) > 0) {
    const n = input.subscriptionsNeedingAttention ?? 0
    items.push({
      kind: "subscription",
      key: "subscriptions",
      label: n === 1 ? "A player's subscription needs following up" : `${n} players' subscriptions need following up`,
      detail: "Not set up, or a payment failed",
      href: `/teams/${teamId}/subscriptions`,
      count: n,
      urgent: false,
      capability: "finance.subscription.view",
    })
  }

  if (a.rosterManage && input.ageGradeAttention > 0) {
    const n = input.ageGradeAttention
    items.push({
      kind: "age_grade",
      key: "age-grade",
      label: n === 1 ? "A player's age grade needs a club decision" : `${n} players' age grades need a club decision`,
      detail: "Playing up or down needs the club's approval",
      href: `/teams/${teamId}`,
      count: n,
      urgent: false,
      capability: "team.roster.manage",
    })
  }

  // Urgent first, then the domain order above. A stable sort keeps ties where the domain put them.
  return items
    .map((item, index) => ({ item, index }))
    .sort((x, y) => Number(y.item.urgent) - Number(x.item.urgent) || x.index - y.index)
    .map(({ item }) => item)
}
