import type { ActiveContextKind } from "@ovalball/contracts"
import type { AttentionItem } from "@ovalball/contracts/attention"

import { resolveIntent } from "../links/intents"
import { narrowIntentForContext, routeForIntent, type Route } from "../links/destinations"

/**
 * WHERE AN ATTENTION ITEM OPENS, natively.
 *
 * The item carries a typed destination and its canonical web href. Everything that has a screen in the
 * app goes through the ONE resolver (`resolveIntent` -> `routeForIntent`), narrowed for a family
 * context exactly as a notification is. The team's own screens -- the register, the requests list,
 * the people list -- are the team workspace's routes, chosen by what the item IS, so a coach lands on
 * the register rather than on the fixture page that also happens to be canonical.
 *
 * Null means "no native screen": the caller opens the canonical web page instead of nothing.
 */
export function routeForAttentionItem(item: AttentionItem, contextKind: ActiveContextKind | null): Route | null {
  if (item.context.kind === "team") {
    switch (item.sourceType) {
      case "fixture_availability":
        return { pathname: "/team/availability/[kind]/[eventId]", params: { kind: "fixture", eventId: item.sourceId } }
      case "training_availability":
        return { pathname: "/team/availability/[kind]/[eventId]", params: { kind: "training", eventId: item.sourceId } }
      case "fixture_request":
        return { pathname: "/team/requests" }
      case "team_place_request":
      case "age_grade":
        return { pathname: "/team/people" }
      case "call_up":
        return { pathname: "/team/settings/player-requests" }
      case "team_subscription":
        return { pathname: "/subscriptions" }
      default:
        break
    }
  }
  if (item.context.kind === "club" && item.sourceType === "club_join_request") {
    return { pathname: "/admin/people" }
  }
  const intent = narrowIntentForContext(resolveIntent(`ovalball://${item.href.replace(/^\//, "")}`), contextKind)
  return routeForIntent(intent)
}
