import { isFamilyFacingContext, type ActiveContextKind, type AgendaItem } from "@ovalball/contracts"

import { routeForHubDestination } from "../hub/route-table"
import type { LinkIntent } from "./intents"

/**
 * WHERE AN EVENT OPENS — the single destination authority for this app.
 *
 * Home, Fixtures, the Calendar (grid, week list and week sheet), the notification
 * list and the deep-link handler all resolve here. There is no second routing rule
 * for any of them, which is the point: a boundary enforced in four places is a
 * boundary that will hold in three.
 *
 * ---------------------------------------------------------------------------
 * LAYER A — THE PROJECTION.
 *
 *   a match, for a parent/guardian or a player -> the PARTICIPANT address
 *   a match, for anybody else                  -> the CANONICAL address
 *   training, for anybody                      -> the TRAINING CENTRE
 *
 * The participant address (`/fixtures/<id>/match-centre`) cannot render
 * administration under any circumstances, because that route does not import it.
 *
 * The canonical address (`/fixtures/<id>`) is authority-aware: it asks
 * `get_match_centre_capabilities` for THIS viewer and THIS fixture and renders the
 * console only where `can_manage_fixture` is true. So "anybody else" is not a
 * grant -- a team manager who has not been delegated `fixture.fixture.edit` lands
 * on the Match Centre exactly as a parent does.
 *
 * WHY A CONTEXT KIND APPEARS HERE AT ALL, given that a role label is never
 * authority. It is not deciding what anybody MAY do; it is choosing which of two
 * addresses to use, and it only ever chooses the MORE restrictive one. A
 * family-facing context holds no fixture-management capability by construction --
 * `loadFixtureAuthority` returns nothing at all for one, because there is no scope
 * to ask at -- so sending it to a route that cannot draw administration removes a
 * possibility rather than granting one.
 *
 * ---------------------------------------------------------------------------
 * LAYER B — THE GUARD, which is not in this file.
 *
 * The canonical route's own gate, and then every control inside the console, and
 * then the database. A hand-typed URL, a restored navigation stack or a link from
 * outside the app does not pass through this module at all, so none of the
 * protection that matters lives here. This module makes the app ASK the right
 * question; the server decides the answer.
 * ---------------------------------------------------------------------------
 */
export function agendaIntent(item: AgendaItem, contextKind: ActiveContextKind): LinkIntent {
  if (item.kind === "training") return { kind: "TRAINING", sessionId: item.eventId }
  return isFamilyFacingContext(contextKind)
    ? { kind: "MATCH_CENTRE", fixtureId: item.eventId }
    : { kind: "FIXTURE", fixtureId: item.eventId }
}

/**
 * THE SAME NARROWING, FOR AN INTENT THAT CAME FROM OUTSIDE.
 *
 * A notification, a shared link or a push payload carries a CANONICAL href, and
 * the canonical href for every fixture notification is `/fixtures/<id>` -- which is
 * correct, and is the address the website uses too. It resolves to the deciding
 * route, which asks the server and would give a guardian the Match Centre anyway.
 *
 * This takes that one step further where the app already knows the viewer's
 * context: a family-facing context has its fixture intents narrowed to the
 * participant address BEFORE they are routed, so the two notifications a parent
 * actually receives -- an availability invitation and its reminder -- reach a route
 * that cannot draw administration rather than one that decides not to.
 *
 * It only ever narrows. A staff intent is returned untouched, and an intent for
 * anything other than a fixture is returned untouched, so nothing legitimate is
 * lost by passing everything through it.
 */
export function narrowIntentForContext(intent: LinkIntent, contextKind: ActiveContextKind | null): LinkIntent {
  if (intent.kind !== "FIXTURE") return intent
  if (!contextKind || !isFamilyFacingContext(contextKind)) return intent
  return { kind: "MATCH_CENTRE", fixtureId: intent.fixtureId }
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
    // THE CANONICAL ADDRESS. Authority-aware: it renders the console only where the
    // server says this viewer may manage this fixture, and the Match Centre
    // otherwise. The console has no address of its own.
    case "FIXTURE":
      return { pathname: "/fixtures/[fixtureId]", params: { fixtureId: intent.fixtureId } }
    // THE PARTICIPANT ADDRESS. Cannot render administration at all.
    case "MATCH_CENTRE":
      return { pathname: "/fixtures/[fixtureId]/match-centre", params: { fixtureId: intent.fixtureId } }
    case "TRAINING":
      return { pathname: "/calendar/training/[sessionId]", params: { sessionId: intent.sessionId } }
    case "CALENDAR":
      return { pathname: "/calendar" }
    // NEWS & ANNOUNCEMENTS. A story linked by the website's slugs opens the same native screen, which
    // resolves the slugs through the shared contract; nothing is decided from the address itself.
    case "NEWS":
      return { pathname: "/news" }
    case "CLUB_ARTICLE":
      return { pathname: "/news/[articleId]", params: { articleId: intent.articleId } }
    case "CLUB_ARTICLE_BY_SLUG":
      return { pathname: "/news/[articleId]", params: { articleId: "slug", clubSlug: intent.clubSlug, articleSlug: intent.articleSlug } }
    case "CLUB_ANNOUNCEMENT":
      return { pathname: "/announcements/[announcementId]", params: { announcementId: intent.announcementId } }
    // THE RUGBY HUB'S OWN TABLE decides, so a Hub screen that moves is a change in one
    // place -- and a destination the vocabulary knows but this build has no screen for
    // resolves to nothing here rather than to somewhere plausible.
    case "RUGBY_HUB":
      return routeForHubDestination(intent.destination)
    // A TEAM'S WORKSPACE. The team's Home is the Home tab in that team's context; its sections are the
    // team route group. The caller switches context first where it may (`ensureTeamContext`); the
    // route itself carries the id only so the screen can say whose team it is asking about.
    case "TEAM":
      switch (intent.section) {
        case "people":
          return { pathname: "/team/people", params: { teamId: intent.teamId } }
        case "player-requests":
          return { pathname: "/team/settings/player-requests", params: { teamId: intent.teamId } }
        case "subscriptions":
          return { pathname: "/subscriptions", params: { teamId: intent.teamId } }
        case "news":
          return { pathname: "/admin/news", params: { teamId: intent.teamId } }
        default:
          return { pathname: "/", params: { teamId: intent.teamId } }
      }
    // SAFEGUARDING (CA-M11.1): one screen, which shows each person only what the server lets them read.
    case "SAFEGUARDING":
      return { pathname: "/admin/safeguarding" }
    case "SAFEGUARDING_THREAD":
      return { pathname: "/admin/safeguarding/threads/[conversationId]", params: { conversationId: intent.conversationId } }
    // GUARDIANS & PLAYERS (CA-M11.1): the Admin Centre's own screens. Each asks the server what this
    // person may do the moment it loads; the address only says which queue was meant.
    case "CLUB_GUARDIANS":
      switch (intent.section) {
        case "link-requests":
          return { pathname: "/admin/guardians/link-requests" }
        case "join-requests":
          return { pathname: "/admin/guardians/join-requests" }
        case "moves":
          return { pathname: "/admin/guardians/moves" }
        default:
          return { pathname: "/admin/guardians" }
      }
    // A recovery code, an unbuilt destination and an unrecognised link are all
    // handled by the people who understand them, not by a route table.
    case "JOIN":
      // The secret rides in the navigation params for one screen and is never written anywhere else.
      return { pathname: "/join", params: { ...(intent.token ? { t: intent.token } : {}), ...(intent.code ? { c: intent.code } : {}) } } as Route
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
