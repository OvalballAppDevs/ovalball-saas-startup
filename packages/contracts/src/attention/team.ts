import type { TeamAttentionItem } from "../team/attention"
import type { TeamOverview } from "../team/overview"
import { attentionItem, type AttentionItem, type AttentionSourceType } from "./model"

/**
 * THE TEAM WORKSPACE'S ATTENTION, in the shared shape.
 *
 * `projectTeamAttention` (CA-M7) stays the rule -- capability-aware, canonical hrefs, urgent within
 * three days -- and this is a translation of its rows, not a second opinion. If the team rule changes,
 * this changes with it, and a test pins that the two lists are the same length with the same keys.
 */
const SOURCE: Record<TeamAttentionItem["kind"], AttentionSourceType> = {
  availability: "fixture_availability",
  fixture_incomplete: "fixture_incomplete",
  kickoff_proposal: "kickoff_proposal",
  result_confirmation: "result_confirmation",
  fixture_request: "fixture_request",
  join_request: "team_place_request",
  call_up: "call_up",
  subscription: "team_subscription",
  age_grade: "age_grade",
  tournament_result: "tournament_result",
}

const ONE_RECORD = /^\/(?:fixtures|messages\/request|tournaments\/result)\/([0-9a-f-]{36})(?:\/result)?$/i

function sourceIdFor(item: TeamAttentionItem, teamId: string): string {
  // A row about one record carries that record's id in its canonical href; a count row is the team's.
  return item.href.match(ONE_RECORD)?.[1] ?? teamId
}

export function teamAttentionItems(overview: Pick<TeamOverview, "teamId" | "attention" | "upcoming">, clubId: string | null): AttentionItem[] {
  const dueByFixture = new Map(overview.upcoming.map((i) => [i.eventId, i.date] as const))
  return overview.attention.map((item) => {
    const sourceId = sourceIdFor(item, overview.teamId)
    return attentionItem({
      sourceType: SOURCE[item.kind],
      sourceId,
      context: { kind: "team", clubId, teamId: overview.teamId, playerId: null },
      priority: item.urgent ? "urgent" : "needs_action",
      title: item.label,
      summary: item.detail,
      // `item.href` is used as-is: it already addresses /teams/<id>/people, /player-requests,
      // /subscriptions directly for join_request/call_up/subscription (team/attention.ts), and a
      // prior Destination-typed round-trip here never actually rewrote any of them -- every one of
      // these shapes was already recognised as native, so the "override" it appeared to apply was
      // unreachable. Kept as the plain href that was genuinely driving navigation.
      href: item.href,
      createdAt: null,
      dueAt: dueByFixture.get(sourceId) ?? null,
      count: item.count,
      capability: item.capability,
    })
  })
}
