import type { ActiveContextKind } from "../active-context-rules"
import { destinationHref, type Destination } from "../navigation/destinations"

/**
 * ATTENTION -- what still needs this person, in this context (CA-M8).
 *
 * THIS IS NOT A TABLE. There is no task store, no `resolved` flag and no row that has to be closed.
 * An attention item is a PROJECTION of canonical domain state -- a fixture with no answer, a request
 * still `sent`, a place request still pending -- and it disappears when the domain says the job is
 * done, and only then. Reading a notification about it changes nothing here; answering it does.
 *
 * ONE SHAPE FOR EVERY CONTEXT. CA-M7's team projection, the parent projection and the club's queues
 * each produced their own row type; this is the one they are all read through, so the Notifications
 * screen, Home and the Team workspace draw the same thing from the same words.
 *
 * DETERMINISTIC PRIORITY. `urgent`, `needs_action` and `for_information` are derived from domain
 * facts (how close the event is, whether an answer is owed) -- never assigned by a screen.
 */
export type AttentionPriority = "urgent" | "needs_action" | "for_information"

export type AttentionSourceType =
  | "fixture_availability"
  | "training_availability"
  | "fixture_incomplete"
  | "kickoff_proposal"
  | "result_confirmation"
  | "fixture_request"
  | "team_place_request"
  | "club_join_request"
  | "player_join_request"
  | "partner_request"
  | "call_up"
  | "team_subscription"
  | "family_subscription"
  | "age_grade"

export interface AttentionContext {
  kind: ActiveContextKind
  clubId: string | null
  teamId: string | null
  playerId: string | null
}

export interface AttentionItem {
  /** Stable across reads: `${sourceType}:${sourceId}` plus the player where one item is per child. */
  id: string
  sourceType: AttentionSourceType
  /** The canonical record's identity -- a fixture, a session, a request, a team. */
  sourceId: string
  context: AttentionContext
  priority: AttentionPriority
  /** What is waiting, in the product's words. */
  title: string
  /** The line that makes it identifiable without opening it. */
  summary: string | null
  destination: Destination
  /** The canonical web address of `destination`, for a renderer that wants a string. */
  href: string
  /** When the underlying record was created, where the domain says. */
  createdAt: string | null
  /** The day the thing happens or is due (YYYY-MM-DD), where there is one. */
  dueAt: string | null
  /** Always open: a resolved job is not projected at all. */
  state: "open"
  /** How many canonical records this row stands for, where a count is meaningful. */
  count: number
  /** The canonical capability that makes this the viewer's job, where the projection knows it. */
  capability: string | null
}

const PRIORITY_RANK: Record<AttentionPriority, number> = { urgent: 0, needs_action: 1, for_information: 2 }

export const PRIORITY_LABEL: Record<AttentionPriority, string> = {
  urgent: "Urgent",
  needs_action: "Needs Action",
  for_information: "For Information",
}

/** The one order: priority, then the nearest due day, then the stable id. Never the read order. */
export function sortAttention(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => {
    const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    if (p !== 0) return p
    if (a.dueAt !== b.dueAt) {
      if (a.dueAt === null) return 1
      if (b.dueAt === null) return -1
      return a.dueAt < b.dueAt ? -1 : 1
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/** Presentation only: the sorted list cut into its priority bands, empty bands omitted. */
export function groupAttention(items: AttentionItem[]): { priority: AttentionPriority; label: string; items: AttentionItem[] }[] {
  const sorted = sortAttention(items)
  return (["urgent", "needs_action", "for_information"] as const)
    .map((priority) => ({ priority, label: PRIORITY_LABEL[priority], items: sorted.filter((i) => i.priority === priority) }))
    .filter((band) => band.items.length > 0)
}

export function attentionId(sourceType: AttentionSourceType, sourceId: string, playerId?: string | null): string {
  return playerId ? `${sourceType}:${sourceId}:${playerId}` : `${sourceType}:${sourceId}`
}

/** Build one item with the derived fields filled in, so no caller hand-writes `href` or `state`. */
export function attentionItem(input: Omit<AttentionItem, "id" | "href" | "state"> & { playerKey?: string | null }): AttentionItem {
  const { playerKey, ...rest } = input
  return {
    ...rest,
    id: attentionId(rest.sourceType, rest.sourceId, playerKey ?? null),
    href: destinationHref(rest.destination),
    state: "open",
  }
}

/** How many of the projected items still owe an answer -- the figure a screen labels "need action". */
export function countNeedingAction(items: AttentionItem[]): number {
  return items.filter((i) => i.priority !== "for_information").length
}
