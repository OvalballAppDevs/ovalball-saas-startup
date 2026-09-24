import type { TeamAttentionItem } from "../team/attention"
import type { TeamOverview } from "../team/overview"
import { destinationForHref, type Destination } from "../navigation/destinations"
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
}

const ONE_RECORD = /^\/(?:fixtures|messages\/request)\/([0-9a-f-]{36})$/i

function sourceIdFor(item: TeamAttentionItem, teamId: string): string {
  // A row about one record carries that record's id in its canonical href; a count row is the team's.
  return item.href.match(ONE_RECORD)?.[1] ?? teamId
}

function destinationFor(item: TeamAttentionItem, teamId: string): Destination {
  const parsed = destinationForHref(item.href)
  if (parsed.kind !== "web") return parsed
  // The team's own sections are reached as the team destination, so the app opens them natively.
  if (item.kind === "join_request" || item.kind === "age_grade") return { kind: "team", teamId, section: "people" }
  if (item.kind === "call_up") return { kind: "team", teamId, section: "player-requests" }
  if (item.kind === "subscription") return { kind: "team", teamId, section: "subscriptions" }
  return parsed
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
      destination: destinationFor(item, overview.teamId),
      createdAt: null,
      dueAt: dueByFixture.get(sourceId) ?? null,
      count: item.count,
      capability: item.capability,
    })
  })
}
