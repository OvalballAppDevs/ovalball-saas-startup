import type { TeamAttentionItem } from "@ovalball/contracts/team/attention"
import { teamAttentionItems } from "@ovalball/contracts/attention"

import { routeForAttentionItem } from "../attention/routes"
import type { Route } from "../links/destinations"

/**
 * CA-M7's team attention route, kept as a thin bridge onto the shared attention route table (CA-M8) so
 * a caller that still holds a `TeamAttentionItem` lands exactly where the shared model would send it.
 * The team is read from the item's own canonical href where the caller does not say.
 */
export function routeForAttention(item: TeamAttentionItem, teamId?: string, clubId: string | null = null): Route | null {
  const fromHref = item.href.match(/^\/teams\/([^/]+)/)?.[1] ?? ""
  const [shared] = teamAttentionItems({ teamId: teamId ?? fromHref, attention: [item], upcoming: [] }, clubId)
  return shared ? routeForAttentionItem(shared, "team") : null
}
