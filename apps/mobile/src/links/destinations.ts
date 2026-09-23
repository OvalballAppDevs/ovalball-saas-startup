import { isFamilyFacingContext, type ActiveContextKind, type AgendaItem } from "@ovalball/contracts"

import type { LinkIntent } from "./intents"

/**
 * WHERE AN EVENT OPENS — decided once, for every surface.
 *
 * Home, Fixtures, Calendar, a notification and an incoming deep link were each
 * pushing their own path. They agreed about training only by not offering it, and
 * they disagreed about a fixture: every list sent everybody to
 * `/fixtures/<id>`, which on this client is the FIXTURE CONTROL screen -- kick-off
 * changes, venue and pitch, cancellation, opposition contacts. A parent tapping
 * their child's match landed in fixture administration, where every control is
 * refused but the page is still plainly not the one they wanted.
 *
 * So the mapping is a function of the EVENT and the CONTEXT, and nothing else:
 *
 *   a match, for a parent/guardian or a player -> MATCH CENTRE
 *   a match, for staff                         -> the fixture screen, where administration lives
 *   training, for anybody                      -> TRAINING CENTRE
 *
 * THIS IS NOT AN AUTHORITY. Every one of these screens re-reads its event through
 * the canonical readers and RLS, and refuses what the viewer may not have; a
 * destination decides which QUESTION is being asked, never who may ask it. Sending
 * a parent to the Match Centre is right because it is their surface, not because
 * the other one would have leaked.
 */
export function agendaIntent(item: AgendaItem, contextKind: ActiveContextKind): LinkIntent {
  if (item.kind === "training") return { kind: "TRAINING", sessionId: item.eventId }
  return isFamilyFacingContext(contextKind)
    ? { kind: "MATCH_CENTRE", fixtureId: item.eventId }
    : { kind: "FIXTURE", fixtureId: item.eventId }
}

/** An expo-router target: the typed route and its parameters, never a hand-built string. */
export type Route = { pathname: string; params?: Record<string, string> }

/**
 * An intent as a route.
 *
 * Kept beside `agendaIntent` so that "what does this mean" and "where does that
 * live" are one table. A path typed into a screen is a path that stops matching
 * the day a route moves, and nothing warns.
 */
export function routeForIntent(intent: LinkIntent): Route | null {
  switch (intent.kind) {
    case "MESSAGES":
      return { pathname: "/messages" }
    case "MESSAGE_THREAD":
      return {
        pathname: "/messages/[kind]/[id]",
        params: { kind: intent.conversationKind, id: intent.conversationId },
      }
    case "FIXTURES":
      return { pathname: "/fixtures" }
    case "FIXTURE":
      return { pathname: "/fixtures/[fixtureId]", params: { fixtureId: intent.fixtureId } }
    case "MATCH_CENTRE":
      return { pathname: "/fixtures/[fixtureId]/match-centre", params: { fixtureId: intent.fixtureId } }
    case "TRAINING":
      return { pathname: "/calendar/training/[sessionId]", params: { sessionId: intent.sessionId } }
    case "CALENDAR":
      return { pathname: "/calendar" }
    // A recovery code, an unbuilt destination and an unrecognised link are all
    // handled by the people who understand them, not by a route table.
    case "AUTH_RECOVERY":
    case "NOT_YET_SUPPORTED":
    case "UNKNOWN":
      return null
  }
}

/** The event's own route, for a screen that has a row and a context and wants to open it. */
export function routeForAgendaItem(item: AgendaItem, contextKind: ActiveContextKind): Route | null {
  return routeForIntent(agendaIntent(item, contextKind))
}
