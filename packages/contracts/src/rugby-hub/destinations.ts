/**
 * WHERE A RUGBY HUB LINK GOES — one vocabulary for both clients.
 *
 * Every Rugby Hub reader in this package returns relationships as WEB hrefs
 * (`/rugby-hub/skills/tackling`, `/rugby-hub/rules?identity=u9-union#section-SCRUM`),
 * because the website was built first and its links are its addresses. The
 * mobile app has to open exactly the same things, and it has no URL bar: it
 * has typed routes. So a link is parsed ONCE, here, into a typed destination
 * that either client can act on, and built back the other way from the same
 * table. The website keeps using the href; the app maps the destination to a
 * screen. Neither invents a second naming for a glossary term.
 *
 * WHAT THIS IS NOT. It is not authority and it is not a filter. `?identity=`
 * and `?code=` are BROWSING state -- "show me this age grade's rules" -- and
 * every destination re-derives what the viewer may see from the server when
 * it loads. `#section-X` is a scroll target and nothing more. An unrecognised
 * href becomes `{ kind: "web" }` rather than being guessed at, so a link this
 * build cannot open is reported honestly instead of landing somewhere
 * plausible and wrong.
 */

export type HubRugbyCode = "union" | "league"
export type HubCodeFilter = "all" | HubRugbyCode

export type HubDestination =
  | { kind: "home" }
  | { kind: "search"; query: string | null }
  | { kind: "game"; conceptKey: string | null }
  | { kind: "rules"; identityKey: string | null; section: string | null }
  | { kind: "officiating"; contentKey: string | null }
  | { kind: "positions"; code: HubRugbyCode | null; positionKey: string | null }
  | { kind: "glossary"; termKey: string | null }
  | { kind: "skills"; skillKey: string | null }
  | { kind: "development"; conceptKey: string | null; code: HubCodeFilter }
  | { kind: "coaching"; conceptKey: string | null; code: HubCodeFilter }
  | { kind: "story"; entryKey: string | null }
  | { kind: "competitions"; contentKey: string | null; code: HubCodeFilter }
  | { kind: "international"; teamKey: string | null; code: HubCodeFilter }
  | { kind: "clubs"; clubKey: string | null; code: HubCodeFilter }
  | { kind: "people"; personKey: string | null }
  | { kind: "parents"; guideKey: string | null }
  | { kind: "player-welfare"; code: HubRugbyCode | null; identityKey: string | null; section: string | null }
  | { kind: "safeguarding"; code: HubRugbyCode | null; identityKey: string | null; section: string | null }
  /**
   * The Safeguarding Officer contact hand-off. `club` and `assignment` are ids the
   * server already gave the viewer on the Safeguarding page; the contact screen
   * re-reads the officer through RLS and the RPC decides whether a conversation
   * may be started. `mode` says only which route the club chose for that officer.
   */
  | { kind: "safeguarding-contact"; clubId: string | null; assignmentId: string | null; mode: "OVALBALL" | "EMAIL" | null }
  /** A Rugby Hub link this vocabulary does not know. Carried, never guessed. */
  | { kind: "web"; href: string }

const HUB_ROOT = "/rugby-hub"

/** The top-level Rugby Hub sections, in the order the IA lists them. Matches `HUB_GROUPS` in ./ia. */
export const HUB_SECTION_SLUGS = [
  "game",
  "rules",
  "officiating",
  "positions",
  "glossary",
  "skills",
  "development",
  "coaching",
  "story",
  "competitions",
  "international",
  "clubs",
  "people",
  "parents",
  "player-welfare",
  "safeguarding",
] as const

export type HubSectionSlug = (typeof HUB_SECTION_SLUGS)[number]

function code(value: string | null): HubRugbyCode | null {
  return value === "union" || value === "league" ? value : null
}

function codeFilter(value: string | null): HubCodeFilter {
  return code(value) ?? "all"
}

/** `#section-SCRUM` -> `SCRUM`. Anything else is not a Hub section anchor. */
function sectionFromHash(hash: string): string | null {
  const clean = hash.startsWith("#") ? hash.slice(1) : hash
  if (!clean.startsWith("section-")) return null
  const key = clean.slice("section-".length)
  return key.length > 0 ? key : null
}

/**
 * Parse a Rugby Hub href -- relative (`/rugby-hub/...`) or absolute
 * (`https://ovalball.co.uk/rugby-hub/...`) -- into a typed destination.
 * Returns null for anything that is not a Rugby Hub link at all, so a caller
 * can tell "not ours" from "ours but unknown".
 */
export function parseHubHref(href: string): HubDestination | null {
  let pathname: string
  let search: URLSearchParams
  let hash: string
  try {
    // A relative href is resolved against a placeholder origin purely so URL can
    // split it; the origin is discarded.
    const url = new URL(href, "https://hub.invalid")
    pathname = url.pathname
    search = url.searchParams
    hash = url.hash
  } catch {
    return null
  }

  if (pathname !== HUB_ROOT && !pathname.startsWith(`${HUB_ROOT}/`)) return null

  const parts = pathname
    .slice(HUB_ROOT.length)
    .split("/")
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p)
      } catch {
        return p
      }
    })
  const [section, second, third] = parts

  if (!section) {
    const q = search.get("q")
    return q ? { kind: "search", query: q } : { kind: "home" }
  }

  switch (section) {
    case "game":
      return parts.length <= 2 ? { kind: "game", conceptKey: second ?? null } : { kind: "web", href }
    case "rules":
      return parts.length === 1 ? { kind: "rules", identityKey: search.get("identity"), section: sectionFromHash(hash) } : { kind: "web", href }
    case "officiating":
      return parts.length <= 2 ? { kind: "officiating", contentKey: second ?? null } : { kind: "web", href }
    case "positions": {
      if (parts.length === 1) return { kind: "positions", code: null, positionKey: null }
      const c = code(second ?? null)
      if (!c) return { kind: "web", href }
      if (parts.length === 2) return { kind: "positions", code: c, positionKey: null }
      if (parts.length === 3) return { kind: "positions", code: c, positionKey: third ?? null }
      return { kind: "web", href }
    }
    case "glossary":
      return parts.length <= 2 ? { kind: "glossary", termKey: second ?? null } : { kind: "web", href }
    case "skills":
      return parts.length <= 2 ? { kind: "skills", skillKey: second ?? null } : { kind: "web", href }
    case "development":
      return parts.length <= 2 ? { kind: "development", conceptKey: second ?? null, code: codeFilter(search.get("code")) } : { kind: "web", href }
    case "coaching":
      return parts.length <= 2 ? { kind: "coaching", conceptKey: second ?? null, code: codeFilter(search.get("code")) } : { kind: "web", href }
    case "story":
      return parts.length <= 2 ? { kind: "story", entryKey: second ?? null } : { kind: "web", href }
    case "competitions":
      return parts.length <= 2 ? { kind: "competitions", contentKey: second ?? null, code: codeFilter(search.get("code")) } : { kind: "web", href }
    case "international": {
      if (parts.length === 1) return { kind: "international", teamKey: null, code: codeFilter(search.get("code")) }
      if (parts.length === 3 && second === "teams" && third) return { kind: "international", teamKey: third, code: "all" }
      return { kind: "web", href }
    }
    case "clubs":
      return parts.length <= 2 ? { kind: "clubs", clubKey: second ?? null, code: codeFilter(search.get("code")) } : { kind: "web", href }
    case "people":
      return parts.length <= 2 ? { kind: "people", personKey: second ?? null } : { kind: "web", href }
    case "parents":
      return parts.length <= 2 ? { kind: "parents", guideKey: second ?? null } : { kind: "web", href }
    case "player-welfare":
      return parts.length === 1
        ? { kind: "player-welfare", code: code(search.get("code")), identityKey: search.get("identity"), section: sectionFromHash(hash) }
        : { kind: "web", href }
    case "safeguarding": {
      if (parts.length === 1) return { kind: "safeguarding", code: code(search.get("code")), identityKey: search.get("identity"), section: sectionFromHash(hash) }
      if (parts.length === 2 && second === "contact") {
        const mode = search.get("mode")
        return {
          kind: "safeguarding-contact",
          clubId: search.get("club"),
          assignmentId: search.get("assignment"),
          mode: mode === "OVALBALL" || mode === "EMAIL" ? mode : null,
        }
      }
      return { kind: "web", href }
    }
    default:
      return { kind: "web", href }
  }
}

function withQuery(path: string, params: Record<string, string | null | undefined>, section?: string | null): string {
  const query = Object.entries(params)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&")
  const anchor = section ? `#section-${section}` : ""
  return `${path}${query ? `?${query}` : ""}${anchor}`
}

function seg(key: string): string {
  return encodeURIComponent(key)
}

/**
 * The inverse: a typed destination as the canonical web href. Round-trips with
 * `parseHubHref` for every destination the vocabulary knows, which is what
 * lets the app share a link that the website opens in the same place.
 */
export function hubHrefFor(destination: HubDestination): string {
  switch (destination.kind) {
    case "home":
      return HUB_ROOT
    case "search":
      return withQuery(HUB_ROOT, { q: destination.query })
    case "game":
      return destination.conceptKey ? `${HUB_ROOT}/game/${seg(destination.conceptKey)}` : `${HUB_ROOT}/game`
    case "rules":
      return withQuery(`${HUB_ROOT}/rules`, { identity: destination.identityKey }, destination.section)
    case "officiating":
      return destination.contentKey ? `${HUB_ROOT}/officiating/${seg(destination.contentKey)}` : `${HUB_ROOT}/officiating`
    case "positions":
      if (!destination.code) return `${HUB_ROOT}/positions`
      return destination.positionKey ? `${HUB_ROOT}/positions/${destination.code}/${seg(destination.positionKey)}` : `${HUB_ROOT}/positions/${destination.code}`
    case "glossary":
      return destination.termKey ? `${HUB_ROOT}/glossary/${seg(destination.termKey)}` : `${HUB_ROOT}/glossary`
    case "skills":
      return destination.skillKey ? `${HUB_ROOT}/skills/${seg(destination.skillKey)}` : `${HUB_ROOT}/skills`
    case "development":
      return destination.conceptKey
        ? `${HUB_ROOT}/development/${seg(destination.conceptKey)}`
        : withQuery(`${HUB_ROOT}/development`, { code: destination.code === "all" ? null : destination.code })
    case "coaching":
      return destination.conceptKey ? `${HUB_ROOT}/coaching/${seg(destination.conceptKey)}` : withQuery(`${HUB_ROOT}/coaching`, { code: destination.code === "all" ? null : destination.code })
    case "story":
      return destination.entryKey ? `${HUB_ROOT}/story/${seg(destination.entryKey)}` : `${HUB_ROOT}/story`
    case "competitions":
      return destination.contentKey
        ? `${HUB_ROOT}/competitions/${seg(destination.contentKey)}`
        : withQuery(`${HUB_ROOT}/competitions`, { code: destination.code === "all" ? null : destination.code })
    case "international":
      return destination.teamKey
        ? `${HUB_ROOT}/international/teams/${seg(destination.teamKey)}`
        : withQuery(`${HUB_ROOT}/international`, { code: destination.code === "all" ? null : destination.code })
    case "clubs":
      return destination.clubKey ? `${HUB_ROOT}/clubs/${seg(destination.clubKey)}` : withQuery(`${HUB_ROOT}/clubs`, { code: destination.code === "all" ? null : destination.code })
    case "people":
      return destination.personKey ? `${HUB_ROOT}/people/${seg(destination.personKey)}` : `${HUB_ROOT}/people`
    case "parents":
      return destination.guideKey ? `${HUB_ROOT}/parents/${seg(destination.guideKey)}` : `${HUB_ROOT}/parents`
    case "player-welfare":
      return withQuery(`${HUB_ROOT}/player-welfare`, { code: destination.code, identity: destination.identityKey }, destination.section)
    case "safeguarding":
      return withQuery(`${HUB_ROOT}/safeguarding`, { code: destination.code, identity: destination.identityKey }, destination.section)
    case "safeguarding-contact":
      return withQuery(`${HUB_ROOT}/safeguarding/contact`, { club: destination.clubId, assignment: destination.assignmentId, mode: destination.mode })
    case "web":
      return destination.href
  }
}

/** The section a destination belongs to, for highlighting and for the parity map. Null for home, search and unknown links. */
export function hubSectionOf(destination: HubDestination): HubSectionSlug | null {
  switch (destination.kind) {
    case "home":
    case "search":
    case "web":
      return null
    case "safeguarding-contact":
      return "safeguarding"
    default:
      return destination.kind
  }
}
