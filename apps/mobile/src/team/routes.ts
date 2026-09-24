import type { TeamAttentionItem } from "@ovalball/contracts/team/attention"

import { resolveIntent } from "../links/intents"
import { routeForIntent, type Route } from "../links/destinations"

/**
 * WHERE A NEEDS ATTENTION ITEM OPENS ON THE PHONE.
 *
 * The item carries the website's canonical address, and the app's own intent resolver reads it -- the
 * same table a notification goes through -- so a fixture item lands on the fixture and a people item on
 * the team's people. Two items are steered by KIND rather than by address, because the job they name
 * has a native home the website reaches differently: an incoming fixture request is answered on the
 * team's Fixture Requests screen (the website answers it on its requests register and threads the
 * conversation separately), and an age-grade decision is a people matter here rather than the team's
 * settings page. Presentation only: every screen these reach re-checks who is asking.
 */
export function routeForAttention(item: TeamAttentionItem): Route | null {
  if (item.kind === "fixture_request") return { pathname: "/team/requests" }
  if (item.kind === "age_grade") return { pathname: "/team/people" }
  if (item.kind === "availability") return { pathname: "/team/availability/[kind]/[eventId]", params: { kind: "fixture", eventId: item.href.split("/").pop() ?? "" } }
  const intent = resolveIntent(`ovalball://${item.href.replace(/^\//, "")}`)
  return routeForIntent(intent)
}
