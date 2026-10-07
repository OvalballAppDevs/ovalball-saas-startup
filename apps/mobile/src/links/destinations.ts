import type { ActiveContextKind, AgendaItem } from "@ovalball/contracts"
import type { MatchCentreSection } from "@ovalball/contracts/match-centre/sections"

import { routeForHubDestination } from "../hub/route-table"
import { resolveIntent, type LinkIntent } from "./intents"

/**
 * WHERE AN EVENT OPENS — the single destination authority for this app.
 *
 * Home, Fixtures, the Calendar (grid, week list and week sheet), the notification
 * list and the deep-link handler all resolve here. There is no second routing rule
 * for any of them, which is the point: a boundary enforced in four places is a
 * boundary that will hold in three.
 *
 * ---------------------------------------------------------------------------
 * ONE GAME, ONE PLACE (owner brief, 2026-10-03).
 *
 *   a match, for anybody      -> the MATCH CENTRE, at `/fixtures/<id>`
 *   one section of a match    -> the same address, `?tab=<section>`
 *   training, for anybody     -> the TRAINING CENTRE
 *
 * There used to be two fixture addresses -- a participant one that could not draw
 * administration and a canonical one that decided between the Match Centre and a
 * Fixture Console -- and this module chose between them by context. That split is
 * gone: Fixture Detail and Edit Fixture are sections and sheets of the one Match
 * Centre, and every control in it is drawn from the server's per-fixture answer
 * for this viewer (`get_match_centre_viewer`, `loadFixtureAuthority`). So there is
 * nothing left here to narrow, and no context decides a fixture's address.
 *
 * THE GUARD IS NOT IN THIS FILE. A hand-typed URL, a restored navigation stack or a
 * link from outside the app does not pass through this module at all, so none of
 * the protection that matters lives here. The Match Centre asks the server what this
 * person may see and do, and the database re-checks every write.
 * ---------------------------------------------------------------------------
 *
 * `contextKind` is still accepted so the many callers do not change shape, but no
 * fixture destination depends on it any more.
 */
export function agendaIntent(item: AgendaItem, contextKind?: ActiveContextKind | null): LinkIntent {
  void contextKind
  if (item.kind === "training") return { kind: "TRAINING", sessionId: item.eventId }
  // A TOURNAMENT HAS ONE ADDRESS, whoever is looking: the Tournament Centre renders administration
  // only where the server says this viewer manages the tournament. A multi-day festival's three
  // calendar rows all carry the same `eventId` and therefore land on the same Centre.
  // ONE GAME OF A TOURNAMENT opens that game -- the one shared result screen -- not the festival.
  if (item.kind === "tournament" && item.tournamentGame) return { kind: "TOURNAMENT_RESULT", gameId: item.tournamentGame.id, tournamentId: item.eventId }
  if (item.kind === "tournament") return { kind: "TOURNAMENT", tournamentId: item.eventId }
  return { kind: "FIXTURE", fixtureId: item.eventId }
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
    case "CLUB_DAY":
      return { pathname: "/fixtures/planner/club-day/[groupId]", params: { groupId: intent.groupId } }
    // THE MATCH CENTRE -- one address for every viewer and every older fixture address. The section a
    // link is about rides as `tab`; editing as `edit`. What is drawn there is the server's answer.
    case "FIXTURE":
    case "MATCH_CENTRE":
      return matchCentreRoute(intent.fixtureId, intent.section ? { tab: intent.section } : {})
    // THE RESULT: every result notification and result job, for every viewer, and the Fixtures list's
    // Add Result shortcut -- the one Match Result, in the Result section.
    case "FIXTURE_RESULT":
    case "ADD_RESULT":
      return matchCentreRoute(intent.fixtureId, { tab: "result" })
    case "EDIT_FIXTURE":
      return matchCentreRoute(intent.fixtureId, { edit: "details" })
    case "TRAINING":
      return { pathname: "/calendar/training/[sessionId]", params: { sessionId: intent.sessionId } }
    // THE TOURNAMENT CENTRE. One address for every viewer, authority-aware like the
    // canonical fixture address: the screen asks the server what this person may see
    // and do. There is no second, organiser-only address.
    case "TOURNAMENT":
      return { pathname: "/tournaments/[tournamentId]", params: { tournamentId: intent.tournamentId } }
    // THE ONE SHARED RESULT SCREEN. A side confirming, a side contesting and the organiser settling
    // all land here; the screen resolves which of those this viewer is.
    case "DISPENSATION":
      return { pathname: "/dispensations/[id]", params: { id: intent.dispensationId } }
    case "TOURNAMENT_RESULT":
      return { pathname: "/tournaments/result/[gameId]", params: { gameId: intent.gameId, ...(intent.tournamentId ? { tournamentId: intent.tournamentId } : {}) } }
    // THE CALENDAR ON THE DAY THE LINK IS ABOUT -- a link to a date that opened on today was a link to
    // nothing ("View Calendar" from a tournament plan landed on an empty today, 20270736).
    case "CALENDAR":
      return intent.date ? { pathname: "/calendar", params: { date: intent.date } } : { pathname: "/calendar" }
    // THE EVENT CENTRE -- one address for every viewer; its section rides as `tab`.
    case "EVENT":
      return { pathname: "/calendar/event/[eventId]", params: intent.section ? { eventId: intent.eventId, tab: intent.section } : { eventId: intent.eventId } }
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
        case "age-grade":
          return { pathname: "/team/age-grade", params: { teamId: intent.teamId } }
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
    case "SCREEN":
      return intent.params ? { pathname: intent.pathname, params: intent.params } : { pathname: intent.pathname }
    case "AUTH_RECOVERY":
    case "AUTH_OAUTH":
    case "NOT_YET_SUPPORTED":
    case "UNKNOWN":
      return null
  }
}

/** The event's own route, for a screen that has a row and a context and wants to open it. */
export function routeForAgendaItem(item: AgendaItem, contextKind?: ActiveContextKind | null): Route | null {
  return routeForIntent(agendaIntent(item, contextKind))
}

/**
 * A CANONICAL HREF, RESOLVED TO A ROUTE -- the one function behind every entry point that starts
 * from an href rather than an already-typed intent: the in-app notification list, a push tap and the
 * foreground banner. A push tap and an in-app tap on the identical notification must resolve to the
 * identical destination, so they share this rather than repeating it.
 *
 * `href` is the same canonical path `notificationHref(type, data)` and the website both produce
 * (`/fixtures/<id>?tab=attendance`, `/tournaments/result/<id>`, …). It is turned into the app's own
 * scheme rather than parsed directly, because `resolveIntent` reads a custom-scheme URL's first path
 * segment as its host -- the same shape every other in-app link already goes through.
 *
 * `contextKind` is accepted for the callers' sake; no destination depends on it any more.
 */
export function routeForHref(href: string, contextKind?: ActiveContextKind | null): Route | null {
  void contextKind
  return routeForIntent(resolveIntent(`ovalball://${href.replace(/^\//, "")}`))
}

function matchCentreRoute(fixtureId: string, extra: { tab?: MatchCentreSection; edit?: "details" }): Route {
  return { pathname: "/fixtures/[fixtureId]", params: { fixtureId, ...(extra.tab && extra.tab !== "overview" ? { tab: extra.tab } : {}), ...(extra.edit ? { edit: extra.edit } : {}) } }
}
