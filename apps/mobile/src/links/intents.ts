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

import { parseMatchCentreSection, type MatchCentreSection } from "@ovalball/contracts/match-centre/sections"
import { parseHubHref, type HubDestination } from "@ovalball/contracts/rugby-hub/destinations"

export type LinkIntent =
  | { kind: "AUTH_RECOVERY"; code: string }
  /**
   * CA-M11.3 -- a social-provider (or any future passwordless) round trip returning to
   * `/auth/callback`, the sibling of `/auth/recovery` above and named to match the website's own
   * callback route. `code` is the PKCE code to exchange; `error` carries a provider's own refusal
   * (declined consent, provider outage) or an explicit cancellation, read from the SAME query shape
   * Supabase's `signInWithOAuth` redirect uses on either outcome. The two are never the same intent:
   * a recovery produces the `recovering` session status and lands on Set Password; this produces an
   * ordinary session and is classified exactly like a password sign-in (`SessionProvider.classify`),
   * so an account requiring a second factor still meets it, and a held invitation or team code still
   * resumes -- both already keyed off session STATUS and module-level held state, not off how the
   * session came to exist.
   */
  | { kind: "AUTH_OAUTH"; code: string | null; error: string | null }
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
  /** A Season Planner club day, sent or received (20270761000000). */
  | { kind: "CLUB_DAY"; groupId: string }
  /**
   * Open one fixture -- which is its Match Centre, for everybody (owner brief, 2026-10-03).
   *
   * THE ID IS NOT A PERMISSION, exactly as for a conversation. The Match Centre reads the fixture
   * through RLS; one this person may not see returns nothing and the screen says it is unavailable.
   *
   * `section` is the Match Centre section the link is about -- `?tab=attendance` on an attendance
   * invitation, `?tab=rewards` on a vote opening -- so a notification lands on the exact thing it is
   * about. Absent means Overview.
   */
  | { kind: "FIXTURE"; fixtureId: string; section?: MatchCentreSection }
  /**
   * `/fixtures/<id>/match-centre`, the former participant address. Kept as a kind so a link that
   * already exists still resolves; it is the same one Match Centre as `FIXTURE`.
   */
  | { kind: "MATCH_CENTRE"; fixtureId: string; section?: MatchCentreSection }
  /**
   * ADD RESULT -- the Fixtures list's shortcut from a past match straight to entering its score. It
   * opens the Match Centre's Result section, where the one Match Result lives.
   */
  | { kind: "ADD_RESULT"; fixtureId: string }
  /** ONE FIXTURE'S RESULT: the Match Centre's Result section. Every result notification and job. */
  | { kind: "FIXTURE_RESULT"; fixtureId: string }
  /**
   * EDIT FIXTURE -- editing is contextual in the Match Centre now. `/fixtures/<id>/edit` resolves here
   * and opens it with the match details editor showing; the editor itself appears only where
   * `fixture.fixture.edit` is held.
   */
  | { kind: "EDIT_FIXTURE"; fixtureId: string }
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
   * ONE TOURNAMENT -- the Tournament Centre, at the website's own address.
   *
   * ONE ADDRESS FOR EVERY VIEWER, exactly as a fixture has one. A parent whose
   * child is playing, a coach whose side is entered and the club running the day
   * all open `/tournaments/<id>`; the screen asks the server what this person may
   * see and do, and renders accordingly. There is deliberately no participant
   * address and no organiser address, because two addresses become two
   * implementations and then two designs.
   *
   * THE ID IS NOT A PERMISSION. A tournament this person cannot see returns
   * nothing and the screen says it is unavailable.
   */
  | { kind: "TOURNAMENT"; tournamentId: string }
  /**
   * AN EVENT -- `/events/<id>[?tab=<section>]`, the same address the website uses, opening the one Event
   * Centre. The id is not a permission: an event this person may not see returns nothing.
   */
  | { kind: "EVENT"; eventId: string; section: string | null }
  /**
   * ONE TOURNAMENT GAME'S RESULT -- `/tournaments/result/<gameId>`, the address every result
   * notification lands on, because each of them says a human has something to do about ONE score.
   * The game id is not a permission: the screen returns nothing to anybody who is neither one of
   * the two sides nor the organiser. `tournamentId`, when the link knows it, is where that screen sends
   * a family instead -- the tournament's Agenda, which lists the game for them -- never a dead end.
   */
  | { kind: "TOURNAMENT_RESULT"; gameId: string; tournamentId?: string }
  /**
   * ONE DISPENSATION -- `/dispensations/<id>`, the record every dispensation notification opens
   * (20270742000000). The screen asks the server what this person may read and do; the id grants nothing.
   */
  | { kind: "DISPENSATION"; dispensationId: string }
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
  | { kind: "TEAM"; teamId: string; section: "home" | "people" | "player-requests" | "subscriptions" | "news" | "age-grade" }
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
  /**
   * A WEBSITE ADDRESS WHOSE NATIVE SCREEN IS ONE FIXED PLACE (notification correctness pass). These
   * carried notifications for years and resolved to nothing natively, so a tap opened the website and a
   * push tap opened nothing at all. `WEB_ADDRESS_TO_SCREEN` below is the whole table -- the same
   * addresses, mapped once, here in the one resolver.
   */
  | { kind: "SCREEN"; pathname: string; params?: Record<string, string> }
  | { kind: "UNKNOWN" }

/**
 * The paths Ovalball already issues links for, which this build cannot yet complete. Listed rather
 * than guessed so that "we know what this is and it is not built" can be told apart from "this is not
 * one of ours" -- two different things to say to somebody who just tapped a link.
 */
const PLANNED = ["/invitation", "/notifications", "/subscriptions"]

/**
 * Website addresses that notifications carry and that have one native home. Prefix matches (a support
 * ticket id, a request id in the query) land on the same screen; the screen re-reads what is there.
 */
const WEB_ADDRESS_TO_SCREEN: { path: string; prefix: boolean; pathname: string; param?: [query: string, name: string] }[] = [
  { path: "/clubhouse/opportunities", prefix: false, pathname: "/clubhouse/opportunities", param: ["highlight", "highlight"] },
  { path: "/clubhouse/partnerships", prefix: false, pathname: "/clubhouse/partnerships" },
  // Every "/clubhouse" the platform emits is about partner clubs (partner requests, calendar sharing,
  // the finance page's partner-clubs link), whose native home is Partnerships.
  { path: "/clubhouse", prefix: false, pathname: "/clubhouse/partnerships" },
  { path: "/people", prefix: false, pathname: "/admin/people" },
  { path: "/parent/children", prefix: false, pathname: "/family" },
  // A parent's answer to their child's own team request (20270741000000): the request rides as `request`.
  { path: "/parent/team-requests", prefix: false, pathname: "/family/team-request", param: ["request", "membershipId"] },
  { path: "/account/security", prefix: false, pathname: "/security" },
  { path: "/club/rollover", prefix: true, pathname: "/admin/rollover" },
  { path: "/club/training", prefix: true, pathname: "/admin/training-planning" },
  { path: "/support", prefix: true, pathname: "/support" },
  { path: "/club/settings/ovalball-billing", prefix: false, pathname: "/admin/subscriptions/ovalball-billing" },
  // Club Memberships (20270752000000: "GoCardless account verified"): the hub decides setup or settings.
  { path: "/club/settings/subscriptions", prefix: false, pathname: "/admin/subscriptions" },
  // The club's dispensations (20270742000000): the register the server fills for whoever may read it.
  { path: "/dispensations", prefix: false, pathname: "/admin/safeguarding/dispensations" },
  // An older notification may still carry the address that never existed on the website.
  { path: "/club/settings/ovalball-plan", prefix: false, pathname: "/admin/subscriptions/ovalball-billing" },
]

/** The invitation path. Named here beside the resolver so a test can see "/join" is owned, not planned. */
export const JOIN_PATH = "/join"

/** The app's own schemes (development, staging, production), the only non-web origins a scanned invitation may carry. */
export const APP_SCHEMES = ["ovalball", "ovalball-dev", "ovalball-staging"] as const

/** A calendar anchor is a civil date and nothing else. Anything other shape is ignored rather than guessed at. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** A record id. A query value that is not one is ignored rather than routed. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

  // CA-M11.3: the cold-start fallback for a social sign-in whose warm round trip (the button's own
  // `openAuthSessionAsync` promise) never got the chance to resolve because the app was killed while
  // the provider's UI was in front of the person. Neither field is required to be present together --
  // an outright cancel/provider-error has neither, a genuine callback has exactly one.
  if (path === "/auth/callback") {
    const code = parsed.searchParams.get("code")
    const error = parsed.searchParams.get("error") ?? parsed.searchParams.get("error_description")
    return { kind: "AUTH_OAUTH", code, error }
  }

  // AN INVITATION: the link an email carries, or the code a person types. Only the exact path: a
  // sub-path is nothing this build issues, and is left unrecognised rather than guessed at.
  if (path === JOIN_PATH) {
    const token = parsed.searchParams.get("t")?.trim() || null
    const code = parsed.searchParams.get("c")?.trim() || null
    return { kind: "JOIN", token, code }
  }

  // MESSAGES: /messages, and /messages/<kind>/<id> for one conversation.
  //
  // AN ANNOUNCEMENT THREAD IS ITS OWN DESTINATION, matched BEFORE the generic kind check below --
  // otherwise "announcement" fails THREAD_KINDS and falls into that branch's own catch-all, which
  // silently opens the inbox instead (the bug this guard fixes). It genuinely is not one of
  // THREAD_KINDS: a recipient who cannot reply still needs to read it, which is why the website
  // gives it a dedicated screen (app/(app)/messages/announcement/[id]/) rather than reusing the
  // generic conversation UI. No native screen exists for it yet, so this falls through to the
  // website -- a known, named gap rather than a wrong guess.
  if (path === "/messages/announcement" || path.startsWith("/messages/announcement/")) {
    return { kind: "NOT_YET_SUPPORTED", path }
  }
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
    // A messages link this build cannot open -- a support thread, a shape that has changed -- lands
    // in the inbox rather than nowhere. Somebody who tapped a message link should end up looking at
    // their messages.
    return { kind: "MESSAGES" }
  }

  // FIXTURES: /fixtures, /fixtures/<id>[?tab=<section>], and the older section addresses.
  //
  // The web addresses a fixture at /fixtures/<id> and its Match Centre at the same id, so these are
  // the SAME paths rather than a mobile invention -- a link shared from a browser resolves here.
  // `?tab=` names the Match Centre section; the website ignores it and lands on its own page.
  //
  // COMPETITION MATCH ADMINISTRATION (/fixtures/competitions/...) IS NOT A FIXTURE, matched first
  // for the same reason the announcement guard above runs first: the generic matcher below splits
  // on "/" and reads the FIRST segment as a fixture id regardless of what it actually is, so
  // "/fixtures/competitions/requests" used to produce `{kind: "FIXTURE", fixtureId:
  // "competitions"}` -- an attempt to open a fixture that cannot exist. This administration lives
  // only on the website today; recognising the shape explicitly sends it there instead.
  if (path === "/fixtures/competitions" || path.startsWith("/fixtures/competitions/")) {
    return { kind: "NOT_YET_SUPPORTED", path }
  }
  if (path === "/fixtures") return { kind: "FIXTURES" }
  // A CLUB DAY, matched before the generic fixture shape (which would read "club-day" as a fixture id).
  if (path.startsWith("/fixtures/club-day/")) {
    const groupId = path.slice("/fixtures/club-day/".length).split("/").filter(Boolean)[0]
    return groupId ? { kind: "CLUB_DAY", groupId } : { kind: "FIXTURES" }
  }
  if (path.startsWith("/fixtures/")) {
    const parts = path.slice("/fixtures/".length).split("/").filter(Boolean)
    const [fixtureId, part] = parts
    if (!fixtureId) return { kind: "FIXTURES" }
    const tab = parsed.searchParams.get("tab")
    const section = tab ? parseMatchCentreSection(tab) : undefined
    if (parts.length === 1) return section ? { kind: "FIXTURE", fixtureId, section } : { kind: "FIXTURE", fixtureId }
    if (parts.length === 2 && (part === "match-centre" || part === "matchcentre")) {
      return section ? { kind: "MATCH_CENTRE", fixtureId, section } : { kind: "MATCH_CENTRE", fixtureId }
    }
    if (parts.length === 2 && part === "result") return { kind: "FIXTURE_RESULT", fixtureId }
    // The website's editing address: the Match Centre with its details editor, which is drawn only for
    // somebody the server says may edit -- anybody else simply sees the match.
    if (parts.length === 2 && part === "edit") return { kind: "EDIT_FIXTURE", fixtureId }
    // A part of a fixture this build has no address for -- the team sheet -- opens the Match
    // Centre itself, which is where all of them live.
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

  // CLUB MEMBERSHIPS (Club Memberships Part 2): the website's /club/finance pages, each at its native home -- the
  // overview, Members and one member, Reminders, a month's Payments, and one membership's record. Only these shapes:
  // anything else under the address is left to the rules below rather than guessed at.
  const memberships = clubMembershipsScreen(path, parsed.searchParams)
  if (memberships) return memberships

  // A TEAM: /teams/<id> and its sections, the same addresses the website uses.
  if (path.startsWith("/teams/")) {
    const parts = path.slice("/teams/".length).split("/").filter(Boolean)
    const [teamId, section] = parts
    if (teamId) {
      const known = ["people", "player-requests", "subscriptions", "news", "age-grade"] as const
      const chosen = (known as readonly string[]).includes(section ?? "") ? (section as (typeof known)[number]) : "home"
      return { kind: "TEAM", teamId, section: chosen }
    }
  }

  // A DISPENSATION: /dispensations/<id>, the record itself. The bare register address lands on the
  // officer's register, which the server fills for the officer, the Club Admins and the Fixtures Secretary.
  if (path.startsWith("/dispensations/")) {
    const dispensationId = path.slice("/dispensations/".length).split("/").filter(Boolean)[0]
    if (dispensationId) return { kind: "DISPENSATION", dispensationId }
  }

  // A TOURNAMENT: /tournaments/<id>, the same address the website uses. A section
  // beneath it that this build has no screen for opens the tournament itself,
  // which is where all of them live -- the same rule a fixture's sections follow.
  // A GAME'S RESULT, matched BEFORE the tournament itself -- otherwise "result" is read as a
  // tournament id and every result notification opens a tournament that does not exist.
  if (path.startsWith("/tournaments/result/")) {
    const gameId = path.slice("/tournaments/result/".length).split("/").filter(Boolean)[0]
    if (gameId) return { kind: "TOURNAMENT_RESULT", gameId }
  }

  if (path.startsWith("/tournaments/")) {
    const tournamentId = path.slice("/tournaments/".length).split("/").filter(Boolean)[0]
    if (tournamentId) return { kind: "TOURNAMENT", tournamentId }
  }

  // AN EVENT: /events/<id>, its section as ?tab=.
  if (path.startsWith("/events/")) {
    const eventId = path.slice("/events/".length).split("/").filter(Boolean)[0]
    if (eventId) return { kind: "EVENT", eventId, section: parsed.searchParams.get("tab") }
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

  // ONE TRAINING PLAN: Training Management with a plan named opens that plan, not the list of them.
  const plan = path === "/club/training" ? parsed.searchParams.get("plan")?.trim() : null
  if (plan && UUID.test(plan)) return { kind: "SCREEN", pathname: "/admin/training-planning/plan/[planId]", params: { planId: plan } }

  const screen = WEB_ADDRESS_TO_SCREEN.find((s) => path === s.path || (s.prefix && path.startsWith(`${s.path}/`)))
  if (screen) {
    const value = screen.param ? parsed.searchParams.get(screen.param[0]) : null
    return value && screen.param ? { kind: "SCREEN", pathname: screen.pathname, params: { [screen.param[1]]: value } } : { kind: "SCREEN", pathname: screen.pathname }
  }

  return { kind: "UNKNOWN" }
}

/** A billing month as the website writes it in `?month=`: the first of a month. */
const BILLING_MONTH = /^\d{4}-\d{2}-01$/

/**
 * `/club/finance[...]` -- the website's Club Memberships -- as the native screen for each. The ids say where to go;
 * every screen asks the server what this person may see. A `?club=` naming the club only chooses: it is not read here.
 */
function clubMembershipsScreen(path: string, query: URLSearchParams): LinkIntent | null {
  if (path !== "/club/finance" && !path.startsWith("/club/finance/")) return null
  const parts = path.slice("/club/finance".length).split("/").filter(Boolean)
  const month = query.get("month")
  const monthParams = month && BILLING_MONTH.test(month) ? { month } : null
  if (parts.length === 0) {
    // The old finance page carried its month: that month's payments are what the link was about.
    return monthParams ? { kind: "SCREEN", pathname: "/admin/subscriptions/payments", params: monthParams } : { kind: "SCREEN", pathname: "/admin/subscriptions" }
  }
  const [first, second] = parts
  if (first === "members" && parts.length === 1) return { kind: "SCREEN", pathname: "/admin/subscriptions/members" }
  if (first === "members" && parts.length === 2 && second && UUID.test(second)) return { kind: "SCREEN", pathname: "/admin/subscriptions/member/[playerId]", params: { playerId: second } }
  if (first === "reminders" && parts.length === 1) return { kind: "SCREEN", pathname: "/admin/subscriptions/reminders" }
  if (first === "payments" && parts.length === 1) return monthParams ? { kind: "SCREEN", pathname: "/admin/subscriptions/payments", params: monthParams } : { kind: "SCREEN", pathname: "/admin/subscriptions/payments" }
  if (first && parts.length === 1 && UUID.test(first)) return { kind: "SCREEN", pathname: "/admin/subscriptions/membership/[payerSubscriptionId]", params: { payerSubscriptionId: first } }
  return null
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
