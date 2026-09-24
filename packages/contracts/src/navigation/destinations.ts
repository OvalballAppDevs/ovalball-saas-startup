import { notificationHref } from "../notifications/destinations"

/**
 * WHERE A THING LIVES -- one typed vocabulary for both clients (CA-M8).
 *
 * A notification, an attention item and a deep link all have to say where they open. Before this,
 * each said it as a string: the website's canonical href. That is still the truth -- the website's
 * addresses are the platform's addresses -- but a string cannot be exhaustively matched, and a screen
 * that switches on `href.startsWith("/fixtures/")` is a second router that drifts from the first.
 *
 * So a destination is a TYPED value here, with two conversions:
 *
 *   destinationHref(d)        the canonical web address (what the website renders as a link, and
 *                             what the app hands to its own resolver, `resolveIntent`, which is
 *                             the ONE native deep-link resolver and stays in the app)
 *   destinationForHref(href)  the typed value for a canonical href, for anything that arrives as a
 *                             string -- a notification's `notificationHref`, a shared link
 *
 * Nothing here decides what a person MAY see. Every destination re-checks authority when it loads.
 */
export type TeamSection = "home" | "people" | "player-requests" | "subscriptions" | "news"
export type ConversationKind = "direct" | "fixture" | "request" | "club"

export type Destination =
  | { kind: "fixture"; fixtureId: string }
  | { kind: "training"; sessionId: string }
  | { kind: "fixtures" }
  | { kind: "calendar" }
  | { kind: "conversation"; conversationKind: ConversationKind; conversationId: string }
  | { kind: "messages" }
  | { kind: "team"; teamId: string; section: TeamSection }
  | { kind: "club_announcement"; announcementId: string }
  | { kind: "club_article"; articleId: string }
  | { kind: "news" }
  | { kind: "notifications" }
  /** The club's queue of players asking to join: the website's /club/join-requests, native since CA-M11.1. */
  | { kind: "club_player_join_requests" }
  /** A canonical web page the app has no native screen for. The honest hand-off, never a guess. */
  | { kind: "web"; href: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TEAM_SECTIONS: readonly TeamSection[] = ["people", "player-requests", "subscriptions", "news"]
const CONVERSATION_KINDS: readonly ConversationKind[] = ["direct", "fixture", "request", "club"]

/** The canonical web address of a destination. */
export function destinationHref(d: Destination): string {
  switch (d.kind) {
    case "fixture":
      return `/fixtures/${d.fixtureId}`
    case "training":
      return `/training/${d.sessionId}`
    case "fixtures":
      return "/fixtures"
    case "calendar":
      return "/calendar"
    case "conversation":
      return `/messages/${d.conversationKind}/${d.conversationId}`
    case "messages":
      return "/messages"
    case "team":
      return d.section === "home" ? `/teams/${d.teamId}` : `/teams/${d.teamId}/${d.section}`
    case "club_announcement":
      return `/announcements/${d.announcementId}`
    case "club_article":
      return `/news/${d.articleId}`
    case "news":
      return "/news"
    case "notifications":
      return "/notifications"
    case "club_player_join_requests":
      return "/club/join-requests"
    case "web":
      return d.href
  }
}

/**
 * The typed value for a canonical href. Anything not recognised is a `web` destination -- the
 * address is kept exactly, so an unfamiliar page opens on the website rather than somewhere plausible.
 */
export function destinationForHref(href: string): Destination {
  const path = href.split(/[?#]/)[0] ?? ""
  const parts = path.split("/").filter(Boolean)
  const [head, id, section] = parts

  if (head === "fixtures" && parts.length === 1) return { kind: "fixtures" }
  if (head === "fixtures" && id && UUID.test(id) && (parts.length === 2 || section === "match-centre")) return { kind: "fixture", fixtureId: id }
  if (head === "training" && id && UUID.test(id) && parts.length === 2) return { kind: "training", sessionId: id }
  if ((head === "calendar" || head === "agenda") && parts.length === 1) return { kind: "calendar" }
  if (head === "messages" && parts.length === 1) return { kind: "messages" }
  if (head === "messages" && id && section && parts.length === 3 && (CONVERSATION_KINDS as readonly string[]).includes(id) && UUID.test(section)) {
    return { kind: "conversation", conversationKind: id as ConversationKind, conversationId: section }
  }
  if (head === "teams" && id && UUID.test(id) && parts.length <= 3) {
    const chosen = section && (TEAM_SECTIONS as readonly string[]).includes(section) ? (section as TeamSection) : "home"
    if (parts.length === 2 || chosen !== "home") return { kind: "team", teamId: id, section: chosen }
  }
  if (head === "announcements" && id && UUID.test(id) && parts.length === 2) return { kind: "club_announcement", announcementId: id }
  if (head === "news" && parts.length === 1) return { kind: "news" }
  if (head === "news" && id && UUID.test(id) && parts.length === 2) return { kind: "club_article", articleId: id }
  if (head === "notifications" && parts.length === 1) return { kind: "notifications" }
  if (head === "club" && id === "join-requests" && parts.length === 2) return { kind: "club_player_join_requests" }
  return { kind: "web", href }
}

/** Where a notification opens, typed: the shared map's answer, read through the vocabulary. */
export function notificationDestination(type: string, data: Record<string, unknown>): Destination {
  return destinationForHref(notificationHref(type, data))
}
