import type { HubDestination } from "@ovalball/contracts/rugby-hub/destinations"

import type { Route } from "../links/destinations"

/**
 * WHERE A RUGBY HUB DESTINATION LIVES IN THIS APP.
 *
 * Every Hub reader hands back WEB hrefs, because the website's links are the
 * canonical addresses of Hub content. `parseHubHref` (shared, in contracts)
 * turns one into a typed destination; this table turns the destination into an
 * expo-router route. Nothing else in the app maps a Hub path to a screen, so a
 * route that moves is a change in one place.
 *
 * The web address and the app route deliberately look alike -- `/rugby-hub/game/x`
 * on the web is `/hub/game/x` here -- because the same person uses both, and a
 * link a coach shares from the browser should land on the same article in the
 * app. `?identity=`, `?code=` and `#section-` become params: BROWSING state,
 * never authority. Every screen re-asks the server what this viewer may see.
 *
 * PURE ON PURPOSE. This file imports nothing from React Native so the link
 * resolver and its tests can load it under plain Node.
 */
export function routeForHubDestination(d: HubDestination): Route | null {
  switch (d.kind) {
    case "home":
      return { pathname: "/hub" }
    case "search":
      return { pathname: "/hub/search", params: d.query ? { q: d.query } : undefined }
    case "game":
      return d.conceptKey ? { pathname: "/hub/game/[conceptKey]", params: { conceptKey: d.conceptKey } } : { pathname: "/hub/game" }
    case "rules":
      return { pathname: "/hub/rules", params: compact({ identity: d.identityKey, section: d.section }) }
    case "officiating":
      return d.contentKey ? { pathname: "/hub/officiating/[contentKey]", params: { contentKey: d.contentKey } } : { pathname: "/hub/officiating" }
    case "positions":
      if (d.code && d.positionKey) return { pathname: "/hub/positions/[code]/[positionKey]", params: { code: d.code, positionKey: d.positionKey } }
      return { pathname: "/hub/positions", params: compact({ code: d.code }) }
    case "glossary":
      return d.termKey ? { pathname: "/hub/glossary/[termKey]", params: { termKey: d.termKey } } : { pathname: "/hub/glossary" }
    case "skills":
      return d.skillKey ? { pathname: "/hub/skills/[skillKey]", params: { skillKey: d.skillKey } } : { pathname: "/hub/skills" }
    case "development":
      return d.conceptKey ? { pathname: "/hub/development/[conceptKey]", params: { conceptKey: d.conceptKey } } : { pathname: "/hub/development", params: filter(d.code) }
    case "coaching":
      return d.conceptKey ? { pathname: "/hub/coaching/[conceptKey]", params: { conceptKey: d.conceptKey } } : { pathname: "/hub/coaching", params: filter(d.code) }
    case "story":
      return d.entryKey ? { pathname: "/hub/story/[entryKey]", params: { entryKey: d.entryKey } } : { pathname: "/hub/story" }
    case "competitions":
      return d.contentKey ? { pathname: "/hub/competitions/[contentKey]", params: { contentKey: d.contentKey } } : { pathname: "/hub/competitions", params: filter(d.code) }
    case "international":
      return d.teamKey ? { pathname: "/hub/international/teams/[teamKey]", params: { teamKey: d.teamKey } } : { pathname: "/hub/international", params: filter(d.code) }
    case "clubs":
      return d.clubKey ? { pathname: "/hub/clubs/[clubKey]", params: { clubKey: d.clubKey } } : { pathname: "/hub/clubs", params: filter(d.code) }
    case "people":
      return d.personKey ? { pathname: "/hub/people/[personKey]", params: { personKey: d.personKey } } : { pathname: "/hub/people" }
    case "parents":
      return d.guideKey ? { pathname: "/hub/parents/[guideKey]", params: { guideKey: d.guideKey } } : { pathname: "/hub/parents" }
    case "player-welfare":
      return { pathname: "/hub/player-welfare", params: compact({ code: d.code, identity: d.identityKey, section: d.section }) }
    case "safeguarding":
      return { pathname: "/hub/safeguarding", params: compact({ code: d.code, identity: d.identityKey, section: d.section }) }
    case "safeguarding-contact":
      return { pathname: "/hub/safeguarding/contact", params: compact({ club: d.clubId, assignment: d.assignmentId, mode: d.mode }) }
    case "web":
      return null
  }
}

function filter(code: "all" | "union" | "league"): Record<string, string> | undefined {
  return code === "all" ? undefined : { code }
}

function compact(params: Record<string, string | null | undefined>): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) if (v) out[k] = v
  return Object.keys(out).length ? out : undefined
}
