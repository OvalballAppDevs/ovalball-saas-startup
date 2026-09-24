/**
 * WHAT A LINK INTO OVALBALL MEANS.
 *
 * WHY A RESOLVER AND NOT A STRING COMPARISON. Password recovery is the first link that has to come
 * back into the app, and it will not be the last: an invitation, a join request, a fixture, a Match
 * Centre, a notification, a subscription and a Rugby Hub article all become links eventually. Written
 * as one `if (url.includes("recovery"))` in a layout, each of those arrives as another branch in the
 * same place, and the sixth one is where somebody forgets that a link is a REQUEST rather than a
 * grant.
 *
 * So a link is parsed into a typed intent, once, here. What the app then DOES about an intent is the
 * router's business, and whether the person may do it is the server's -- every intent below resolves
 * to a destination that re-checks authority when it loads. `AUTH_RECOVERY` is the only one that
 * carries authority at all, and even then the authority is GoTrue's: the code is exchanged with the
 * auth server, which decides whether it is valid, unexpired and unused.
 *
 * WHAT IS DELIBERATELY NOT HERE. Any intent whose destination does not exist yet. An intent that
 * resolves to nothing is worse than an unrecognised link, because it looks handled.
 */

import { parseHubHref, type HubDestination } from "@ovalball/contracts/rugby-hub/destinations"

export type LinkIntent =
  | { kind: "AUTH_RECOVERY"; code: string }
  /** Open the inbox. What is in it is the server's answer, as always. */
  | { kind: "MESSAGES" }
  /**
   * Open one conversation.
   *
   * THE ID IS NOT A PERMISSION. It is carried so the app knows where to go; whether it may be opened
   * is decided when the screen reads it, by RLS and by the canonical readers. A conversation this
   * person is not in resolves to nothing and the screen says the conversation is unavailable -- which
   * is also what a deleted one does, deliberately, because the difference is not this app's to reveal.
   *
   * This is the route a message PUSH NOTIFICATION will use when M7 adds one: a notification becomes an
   * intent, and the intent is already handled, so nothing about authority changes when push arrives.
   */
  | { kind: "MESSAGE_THREAD"; conversationId: string; conversationKind: "direct" | "fixture" | "request" | "club" }
  /** Open the fixture list for whatever context the person is in. */
  | { kind: "FIXTURES" }
  /**
   * Open one fixture.
   *
   * THE ID IS NOT A PERMISSION, exactly as for a conversation. The detail screen reads the fixture
   * through RLS; one this person may not see returns nothing and the screen says it is unavailable.
   *
   * This is the route a fixture NOTIFICATION will use when M7 adds push -- a kick-off change, a
   * cancellation, an availability chase. The destination exists now precisely so that adding push is
   * about delivery rather than about inventing where a tap should land.
   */
  | { kind: "FIXTURE"; fixtureId: string }
  /** The Match Centre for one fixture. A foundation route today; the same address when M6 fills it. */
  | { kind: "MATCH_CENTRE"; fixtureId: string }
  /** Open the calendar, optionally anchored on a day a notification was about. */
  | { kind: "CALENDAR"; date: string | null }
  /**
   * One training session's own destination.
   *
   * The web addresses it at /training/<id> and so does this, so a link shared from a browser -- or a
   * notification about a session being moved -- resolves to the same place. The id says WHERE to go;
   * the Training Centre reads it through the canonical card RPC and says the session is unavailable if
   * it is not this person's.
   */
  | { kind: "TRAINING"; sessionId: string }
  /**
   * A Rugby Hub destination -- an article, a law, a position, a glossary term, the
   * landing itself. The web address IS the app address: `parseHubHref` (shared, in
   * contracts) reads the canonical `/rugby-hub/...` path, its `?identity=` / `?code=`
   * browsing state and its `#section-` anchor into one typed destination, and the
   * Hub's own route table decides the screen. Nothing in the destination is
   * authority: every Hub screen re-derives what this viewer may see from the server.
   */
  | { kind: "RUGBY_HUB"; destination: HubDestination }
  /**
   * NEWS & ANNOUNCEMENTS (CA-M5). `/news` opens the list; `/news/<id>` a story by id;
   * `/announcements/<id>` a notice. The website addresses a published story by the club's slug and
   * the article's slug (`/club/<clubSlug>/news/<articleSlug>`) and that resolves natively too. None of
   * this is authority: every read goes through the shared contract and row-level security, and a story
   * this person may not read comes back as "no longer available".
   */
  | { kind: "NEWS" }
  | { kind: "CLUB_ARTICLE"; articleId: string }
  | { kind: "CLUB_ARTICLE_BY_SLUG"; clubSlug: string; articleSlug: string }
  | { kind: "CLUB_ANNOUNCEMENT"; announcementId: string }
  /**
   * A TEAM'S OWN WORKSPACE (CA-M7). The website addresses a team at `/teams/<id>` and its people,
   * player requests and subscriptions beneath it; Needs Attention items and notifications carry those
   * addresses. Natively they land on the Team Home and its screens -- in THAT team's context, which the
   * app switches to only where the person already holds it (`ensureTeamContext`). The id says which
   * team; whether the person may see it is decided again by every read the screen makes.
   */
  | { kind: "TEAM"; teamId: string; section: "home" | "people" | "player-requests" | "subscriptions" | "news" }
  /**
   * SAFEGUARDING (CA-M11.1). The website addresses the club's safeguarding page at
   * `/club/settings/safeguarding` and a safeguarding conversation beneath it, and the officer-facing
   * notifications carry those addresses with nothing but ids in their payloads. Natively they land on
   * the safeguarding screen, which shows each person only what the server lets them read.
   */
  | { kind: "SAFEGUARDING" }
  | { kind: "SAFEGUARDING_THREAD"; conversationId: string }
  /**
   * An invitation: `/join?t=<token>` from an email, `/join?c=<code>` from a typed code, or bare `/join`
   * for the code-entry screen. The secret is carried in the intent for the length of one journey and
   * is never persisted -- see `src/onboarding/join-secret.ts`.
   */
  | { kind: "JOIN"; token: string | null; code: string | null }
  /**
   * GUARDIANS & PLAYERS (CA-M11.1). The website's own addresses for the club's player and guardian
   * administration -- /club/settings/guardians, /guardian-requests, /club/join-requests and
   * /club/player-moves -- land on the Admin Centre's native screens. Nothing in the address is
   * authority: each screen asks `my_capabilities` and every decision is refused again by the server.
   */
  | { kind: "CLUB_GUARDIANS"; section: "overview" | "link-requests" | "join-requests" | "moves" }
  /** A link Ovalball issued but this build does not handle yet -- named so it can be reported honestly. */
  | { kind: "NOT_YET_SUPPORTED"; path: string }
  | { kind: "UNKNOWN" }

/**
 * The paths Ovalball already issues links for, which this build cannot yet complete. Listed rather
 * than guessed so that "we know what this is and it is not built" can be told apart from "this is not
 * one of ours" -- two different things to say to somebody who just tapped a link.
 */
const PLANNED = ["/invitation", "/notifications", "/subscriptions"]

/** The invitation path. Named here beside the resolver so a test can see "/join" is owned, not planned. */
export const JOIN_PATH = "/join"

/** The app's own schemes (development, staging, production), the only non-web origins a scanned invitation may carry. */
export const APP_SCHEMES = ["ovalball", "ovalball-dev", "ovalball-staging"] as const

/** A calendar anchor is a civil date and nothing else. Anything other shape is ignored rather than guessed at. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** The conversation kinds this build can open. Anything else falls back to the inbox rather than guessing. */
const THREAD_KINDS = ["direct", "fixture", "request", "club"] as const

/**
 * Parse an incoming URL into an intent.
 *
 * Handles the three shapes a native app actually receives:
 *   ovalball://auth/recovery?code=...        a standalone build's own scheme
 *   exp://192.168.1.5:8081/--/auth/recovery?code=...   Expo Go, with its /-- separator
 *   https://ovalball.co.uk/auth/recovery?code=...      a universal link, once one exists
 *
 * The code is read from the QUERY, which is where the PKCE flow puts it. The implicit flow's
 * `#access_token=` fragment is deliberately not read: a fragment is not sent to a server but it is
 * still a live credential sitting in a URL, and PKCE exists so that it does not have to be.
 */
export function resolveIntent(url: string | null | undefined): LinkIntent {
  if (!url) return { kind: "UNKNOWN" }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { kind: "UNKNOWN" }
  }

  // TWO SHAPES, AND THE FIRST ONE IS A TRAP.
  //
  // `new URL("ovalball://auth/recovery")` puts `auth` in HOST and leaves `/recovery` as the pathname,
  // because a custom scheme with no authority still parses as though it had one. Reading `pathname`
  // alone therefore misses every link in the app's own scheme -- which is the shape that matters most,
  // since it is what a development and a production build actually receive.
  //
  // Expo Go is the other shape: `exp://host:port/--/<path>`, where the app's own path is everything
  // after the separator and the host is the developer's machine.
  const raw = parsed.pathname ?? ""
  const separator = raw.indexOf("/--/")
  const path =
    separator >= 0
      ? normalise(raw.slice(separator + 3))
      : isHttp(parsed.protocol)
        ? normalise(raw)
        : normalise(`${parsed.hostname}${raw}`)

  if (path === "/auth/recovery") {
    const code = parsed.searchParams.get("code")
    // A recovery link with no code is not a recovery -- it is a malformed or truncated link, and
    // treating it as one would take somebody to a Set Password screen that cannot possibly work.
    if (!code) return { kind: "NOT_YET_SUPPORTED", path }
    return { kind: "AUTH_RECOVERY", code }
  }

  // AN INVITATION: the link an email carries, or the code a person types. Only the exact path: a
  // sub-path is nothing this build issues, and is left unrecognised rather than guessed at.
  if (path === JOIN_PATH) {
    const token = parsed.searchParams.get("t")?.trim() || null
    const code = parsed.searchParams.get("c")?.trim() || null
    return { kind: "JOIN", token, code }
  }

  // MESSAGES: /messages, and /messages/<kind>/<id> for one conversation.
  if (path === "/messages") return { kind: "MESSAGES" }
  if (path.startsWith("/messages/")) {
    const parts = path.slice("/messages/".length).split("/").filter(Boolean)
    const [conversationKind, conversationId] = parts
    if (
      parts.length === 2 &&
      conversationId &&
      (THREAD_KINDS as readonly string[]).includes(conversationKind)
    ) {
      return {
        kind: "MESSAGE_THREAD",
        conversationId,
        conversationKind: conversationKind as (typeof THREAD_KINDS)[number],
      }
    }
    // A messages link this build cannot open -- a support thread, an announcement, a shape that has
    // changed -- lands in the inbox rather than nowhere. Somebody who tapped a message link should
    // end up looking at their messages.
    return { kind: "MESSAGES" }
  }

  // FIXTURES: /fixtures, /fixtures/<id>, and /fixtures/<id>/match-centre.
  //
  // The web addresses a fixture at /fixtures/<id> and its Match Centre at the same id, so these are
  // the SAME paths rather than a mobile invention -- a link shared from a browser resolves here.
  if (path === "/fixtures") return { kind: "FIXTURES" }
  if (path.startsWith("/fixtures/")) {
    const parts = path.slice("/fixtures/".length).split("/").filter(Boolean)
    const [fixtureId, section] = parts
    if (!fixtureId) return { kind: "FIXTURES" }
    if (parts.length === 1) return { kind: "FIXTURE", fixtureId }
    if (parts.length === 2 && (section === "match-centre" || section === "matchcentre")) {
      return { kind: "MATCH_CENTRE", fixtureId }
    }
    // A section of a fixture this build does not have a screen for -- the result, the team sheet --
    // opens the fixture itself, which is where all of them live.
    return { kind: "FIXTURE", fixtureId }
  }

  // NEWS & ANNOUNCEMENTS: the app's own list and items, and the website's public story address.
  if (path === "/news") return { kind: "NEWS" }
  if (path.startsWith("/news/")) {
    const articleId = path.slice("/news/".length).split("/").filter(Boolean)[0]
    return articleId ? { kind: "CLUB_ARTICLE", articleId } : { kind: "NEWS" }
  }
  if (path.startsWith("/announcements/")) {
    const announcementId = path.slice("/announcements/".length).split("/").filter(Boolean)[0]
    return announcementId ? { kind: "CLUB_ANNOUNCEMENT", announcementId } : { kind: "NEWS" }
  }
  // SAFEGUARDING (CA-M11.1): the website's club safeguarding page and a conversation beneath it --
  // the addresses the officer-facing notifications carry. Only these two exact shapes; anything
  // else under /club/settings stays unrecognised rather than guessed at.
  if (path === "/club/settings/safeguarding") return { kind: "SAFEGUARDING" }
  if (path.startsWith("/club/settings/safeguarding/messages/")) {
    const conversationId = path.slice("/club/settings/safeguarding/messages/".length).split("/").filter(Boolean)[0]
    return conversationId ? { kind: "SAFEGUARDING_THREAD", conversationId } : { kind: "SAFEGUARDING" }
  }
  if (path.startsWith("/club/")) {
    const parts = path.slice("/club/".length).split("/").filter(Boolean)
    if (parts.length === 3 && parts[1] === "news") return { kind: "CLUB_ARTICLE_BY_SLUG", clubSlug: parts[0], articleSlug: parts[2] }
    // The club's player and guardian administration, at the website's own addresses.
    if (parts.length === 2 && parts[0] === "settings" && parts[1] === "guardians") return { kind: "CLUB_GUARDIANS", section: "overview" }
    if (parts.length === 1 && parts[0] === "join-requests") return { kind: "CLUB_GUARDIANS", section: "join-requests" }
    if (parts.length === 1 && parts[0] === "player-moves") return { kind: "CLUB_GUARDIANS", section: "moves" }
  }
  if (path === "/guardian-requests") return { kind: "CLUB_GUARDIANS", section: "link-requests" }

  // A TEAM: /teams/<id> and its sections, the same addresses the website uses.
  if (path.startsWith("/teams/")) {
    const parts = path.slice("/teams/".length).split("/").filter(Boolean)
    const [teamId, section] = parts
    if (teamId) {
      const known = ["people", "player-requests", "subscriptions", "news"] as const
      const chosen = (known as readonly string[]).includes(section ?? "") ? (section as (typeof known)[number]) : "home"
      return { kind: "TEAM", teamId, section: chosen }
    }
  }

  // TRAINING: /training/<id>, the same address the website uses.
  if (path.startsWith("/training/")) {
    const sessionId = path.slice("/training/".length).split("/").filter(Boolean)[0]
    if (sessionId) return { kind: "TRAINING", sessionId }
  }

  // CALENDAR: /calendar, optionally ?date=YYYY-MM-DD so a notification can open the day it was about.
  if (path === "/calendar" || path === "/agenda") {
    const date = parsed.searchParams.get("date")
    return { kind: "CALENDAR", date: date && ISO_DATE.test(date) ? date : null }
  }

  // RUGBY HUB: the canonical web addresses, parsed by the shared vocabulary. The query
  // and the `#section-` anchor are taken from the ORIGINAL url rather than the
  // lower-cased path, because an identity key is case-sensitive data, not a route.
  //
  // THE ONE FRAGMENT THIS RESOLVER PASSES ON. A Hub anchor is a scroll target -- which
  // card on the Rules page to land on -- and the shared parser accepts only the
  // `section-` shape; the recovery branch above still reads nothing but the PKCE code.
  if (path === "/rugby-hub" || path.startsWith("/rugby-hub/")) {
    const anchor = url.includes("#") ? url.slice(url.indexOf("#")) : ""
    const destination = parseHubHref(`${path}${parsed.search}${anchor}`)
    if (destination) return { kind: "RUGBY_HUB", destination }
  }

  if (PLANNED.some((planned) => path === planned || path.startsWith(`${planned}/`)) || path.startsWith(`${JOIN_PATH}/`)) {
    return { kind: "NOT_YET_SUPPORTED", path }
  }

  return { kind: "UNKNOWN" }
}

/** http and https carry their path in `pathname`; a custom scheme spreads it over host and pathname. */
function isHttp(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:"
}

/** A trailing slash and an empty path are the same place; `/Auth/Recovery` is the same link. */
function normalise(path: string): string {
  const lower = path.toLowerCase()
  const trimmed = lower.endsWith("/") && lower.length > 1 ? lower.slice(0, -1) : lower
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`
}

/** The app path a recovery link should come back to. Used to BUILD the link and to parse it. */
export const RECOVERY_PATH = "/auth/recovery"
