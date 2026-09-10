/**
 * WHAT A NOTIFICATION LOOKS LIKE, WHEREVER IT IS SHOWN.
 *
 * The bell panel and the Notifications page are one activity inbox in two
 * sizes -- recent-and-actionable in the header, history in the page -- so they
 * share this vocabulary and the row component that draws it. There is one
 * renderer, one set of context marks, one grouping rule. A notification cannot
 * read one way in the panel and another way on the page.
 *
 * Client-safe on purpose: lib/app-context/notifications.ts is server-only,
 * and a shape that cannot cross that line cannot be shared with the components
 * that draw it.
 *
 * EVERY MARK BELOW IS A REAL EVENT FAMILY. Nothing here invents a category to
 * give the UI another icon: the families are the ones the notification
 * registry already files types under, and the destinations are the canonical
 * ones supabase/tests/js/notification_destinations.test.mts asserts.
 */

/**
 * The sporting context a notification belongs to. Six, not a rainbow: this is
 * what a person needs to tell a fixture from a training session at a glance,
 * and one more would start costing more than it explains.
 */
export type ActivityContext =
  | "fixture"
  | "training"
  | "tournament"
  | "club"
  | "request"
  | "support"

export interface ActivityItem {
  id: string
  type: string
  title: string
  body: string
  href: string
  createdAt: string
  readAt: string | null
  context: ActivityContext
}

/**
 * A type's context, decided by what the type IS rather than by a stored
 * column. Prefix matching over the registry's own naming, with the handful of
 * genuine exceptions named explicitly -- so registering a new
 * `fixture_*` type puts it in the right family on the day it ships, without
 * anybody remembering to add it here.
 */
export function activityContext(type: string): ActivityContext {
  if (type.startsWith("training_")) return "training"
  if (type.startsWith("tournament_") || type === "team_created_from_tournament_invitation") return "tournament"
  if (type === "support_ticket_update") return "support"
  if (
    type.startsWith("fixture_request_") ||
    type === "team_created_from_fixture_request" ||
    type === "partner_request_received" ||
    type.startsWith("calendar_share_") ||
    type.endsWith("_request_submitted") ||
    type === "player_information_requested" ||
    type === "player_eligibility_approval_required" ||
    type.startsWith("safeguarding_dispensation_") ||
    type.startsWith("fixture_call_up_")
  ) {
    return "request"
  }
  if (type.startsWith("fixture_")) return "fixture"
  return "club"
}

/**
 * Chronological grouping, four buckets. Not twelve category tabs: a person
 * opening their activity wants to know what is new, and after that roughly how
 * long ago the rest was. Categories are what the filter is for.
 */
export type ActivityGroup = "New" | "Earlier Today" | "Yesterday" | "Earlier"

export function activityGroup(item: ActivityItem, now: Date = new Date()): ActivityGroup {
  const created = new Date(item.createdAt)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfCreated = new Date(created.getFullYear(), created.getMonth(), created.getDate()).getTime()
  // "New" is what has not been read, whenever it arrived -- an unread item
  // from Tuesday is still the thing that needs attention, and burying it under
  // "Earlier" because time passed is how a notification gets missed.
  if (!item.readAt) return "New"
  const dayDiff = Math.round((startOfToday - startOfCreated) / 86400000)
  if (dayDiff <= 0) return "Earlier Today"
  if (dayDiff === 1) return "Yesterday"
  return "Earlier"
}

export const ACTIVITY_GROUP_ORDER: ActivityGroup[] = ["New", "Earlier Today", "Yesterday", "Earlier"]

export function groupActivity(items: ActivityItem[], now: Date = new Date()): Array<{ group: ActivityGroup; items: ActivityItem[] }> {
  const buckets = new Map<ActivityGroup, ActivityItem[]>()
  for (const item of items) {
    const group = activityGroup(item, now)
    const existing = buckets.get(group)
    if (existing) existing.push(item)
    else buckets.set(group, [item])
  }
  return ACTIVITY_GROUP_ORDER.filter((g) => buckets.has(g)).map((group) => ({ group, items: buckets.get(group)! }))
}

/**
 * Broad filters only, and only where the registry maps cleanly onto them.
 * Four, over six contexts: Matches folds in the requests that are about a
 * game, because a person looking for "the fixture thing" does not first decide
 * whether it was a change or a request.
 */
export type ActivityFilter = "all" | "matches" | "training" | "club"

export const ACTIVITY_FILTERS: Array<{ value: ActivityFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "matches", label: "Matches" },
  { value: "training", label: "Training" },
  { value: "club", label: "Club" },
]

export function matchesFilter(item: ActivityItem, filter: ActivityFilter): boolean {
  if (filter === "all") return true
  if (filter === "training") return item.context === "training"
  if (filter === "matches") return item.context === "fixture" || item.context === "tournament" || item.context === "request"
  return item.context === "club" || item.context === "support"
}

/**
 * Activity time. Short, because it sits at the end of a row that is being
 * scanned -- and never "0m", which reads as broken.
 */
export function activityTime(iso: string, now: Date = new Date()): string {
  const created = new Date(iso)
  if (Number.isNaN(created.getTime())) return ""
  const mins = Math.round((now.getTime() - created.getTime()) / 60000)
  if (mins < 1) return "now"
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d`
  return created.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}
