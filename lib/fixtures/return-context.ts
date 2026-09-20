/**
 * WHERE "BACK" GOES FROM A FIXTURE, AND WHY IT IS NOT A URL.
 *
 * Match Centre is reached from several places -- the Fixture Control Centre
 * with a season's worth of filters applied, the Calendar on a particular week,
 * a team page, a notification, a bookmark. Until now it answered all of them
 * the same way: a literal `<Link href="/fixtures">`. A fixture secretary who
 * had filtered to "Under 12 Boys, away, no result recorded" and opened one
 * fixture came back to an unfiltered list and had to rebuild the view by hand.
 *
 * The obvious fix -- carry the previous URL in a query parameter -- is how open
 * redirects get written. `lib/auth/safe-next.ts` already guards that class for
 * authentication, and this could have called it. It deliberately does not, for
 * one reason: `safeNextPath` answers "is this somewhere on Ovalball", which is
 * the right question after signing in and the wrong question here. A fixture's
 * back link has a small, knowable set of legitimate destinations, so this module
 * answers the narrower question -- "is this one of the surfaces a fixture is
 * actually opened from" -- and an unrecognised target is not sanitised, it is
 * discarded. There is no reachable value of `from` that leaves the application,
 * names an arbitrary internal route, or carries a parameter the destination
 * does not already understand.
 *
 * So what travels is not a URL. It is a surface, plus the subset of that
 * surface's OWN query parameters which it already parses. Everything else --
 * a foreign origin, a scheme, an unknown path, an unknown parameter, a control
 * character, an over-long value, a fragment -- is dropped, and the fixture falls
 * back to `/fixtures`, which every viewer can reach.
 */

/** The parameters the Fixture Control Centre itself parses (`parseAdminFixtureQuery`). */
const CONTROL_CENTRE_PARAMS = [
  "q",
  "date",
  "status",
  "code",
  "source",
  "resultStatus",
  "competition",
  "season",
  "team",
  "ha",
  "sort",
  "page",
  "size",
  "from_date",
  "to_date",
  "gameType",
] as const

/** The parameters Calendar itself parses (`app/(app)/calendar/page.tsx`). */
const CALENDAR_PARAMS = ["week", "month", "team", "view", "season", "phase", "status", "ha", "kind", "venue", "attendance"] as const

export interface ReturnSurface {
  /** The exact pathname. Never a prefix -- a prefix match is how `/admin/fixtures` becomes `/admin/fixtures-evil`. */
  path: string
  /** What the link says. A destination is named, never just "Back". */
  label: string
  params: readonly string[]
}

/**
 * Every surface a fixture may be returned to. Adding one is a deliberate act,
 * which is the point: the list is the security boundary, not a pattern.
 */
export const RETURN_SURFACES: readonly ReturnSurface[] = [
  { path: "/fixtures/management", label: "Fixture Control Centre", params: CONTROL_CENTRE_PARAMS },
  { path: "/admin/fixtures", label: "Fixture Control Centre", params: CONTROL_CENTRE_PARAMS },
  { path: "/calendar", label: "Calendar", params: CALENDAR_PARAMS },
  { path: "/calendar/agenda", label: "Agenda", params: CALENDAR_PARAMS },
  { path: "/fixtures", label: "Fixtures", params: [] },
]

/** Where a fixture goes back to when nothing legitimate was carried. Reachable by every viewer. */
export const DEFAULT_RETURN: { href: string; label: string } = { href: "/fixtures", label: "Fixtures" }

/** C0 controls plus DEL. Never legitimate in a path or a filter value. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/

/** Long enough for any real filter value (a uuid is 36); short enough that the parameter cannot become a payload. */
const MAX_VALUE_LENGTH = 64

/** A whole `from` value that cannot be a useful destination is not worth carrying. */
const MAX_RETURN_LENGTH = 512

const SENTINEL_ORIGIN = "https://ovalball.invalid"

/**
 * Build the value to carry, from the surface the person is actually on.
 *
 * Returns null when there is nothing worth carrying -- an unrecognised surface,
 * or the default destination with no filters, where a parameter would only make
 * the URL longer without changing where Back goes.
 */
export function buildFixtureReturn(pathname: string, search: URLSearchParams | string | null | undefined): string | null {
  const surface = RETURN_SURFACES.find((s) => s.path === pathname)
  if (!surface) return null

  const params = typeof search === "string" ? new URLSearchParams(search) : (search ?? new URLSearchParams())
  const kept = new URLSearchParams()
  for (const key of surface.params) {
    // getAll, because Calendar's `status` is genuinely repeatable.
    for (const value of params.getAll(key)) {
      if (!value || value.length > MAX_VALUE_LENGTH || CONTROL_CHARACTERS.test(value)) continue
      kept.append(key, value)
    }
  }

  const query = kept.toString()
  if (surface.path === DEFAULT_RETURN.href && !query) return null
  const value = query ? `${surface.path}?${query}` : surface.path
  return value.length > MAX_RETURN_LENGTH ? surface.path : value
}

/**
 * Resolve a carried value back into a link.
 *
 * Never throws and never returns anything outside RETURN_SURFACES. A malformed,
 * foreign, unknown or stale value resolves to DEFAULT_RETURN, which is the same
 * answer as no value at all -- a person who followed a link from somewhere that
 * no longer exists should land somewhere that does, not on an error.
 */
export function resolveFixtureReturn(raw: string | string[] | null | undefined): { href: string; label: string } {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value || typeof value !== "string") return DEFAULT_RETURN
  if (value.length > MAX_RETURN_LENGTH) return DEFAULT_RETURN
  if (CONTROL_CHARACTERS.test(value)) return DEFAULT_RETURN
  // A rooted path can still be a network-path reference ("//host"), or use a
  // backslash that some parsers normalise into one, so URL decides rather than
  // the leading slash. Anything that resolves away from the sentinel origin is
  // by definition not one of ours.
  if (!value.startsWith("/")) return DEFAULT_RETURN

  let url: URL
  try {
    url = new URL(value, SENTINEL_ORIGIN)
  } catch {
    return DEFAULT_RETURN
  }
  if (url.origin !== SENTINEL_ORIGIN) return DEFAULT_RETURN
  // A fragment is never part of a fixture's return context, and carrying one
  // would be the only part of the value this module could not reason about.
  if (url.hash) return DEFAULT_RETURN

  const surface = RETURN_SURFACES.find((s) => s.path === url.pathname)
  if (!surface) return DEFAULT_RETURN

  // Rebuild rather than pass through: an unknown parameter is dropped, not
  // trusted, so the destination only ever receives parameters it already parses.
  const kept = new URLSearchParams()
  for (const key of surface.params) {
    for (const v of url.searchParams.getAll(key)) {
      if (!v || v.length > MAX_VALUE_LENGTH || CONTROL_CHARACTERS.test(v)) continue
      kept.append(key, v)
    }
  }
  const query = kept.toString()
  return { href: query ? `${surface.path}?${query}` : surface.path, label: surface.label }
}

/** The query-parameter name. One constant so a producer and a consumer cannot disagree about it. */
export const FIXTURE_RETURN_PARAM = "from"

/** Append the carried value to a Match Centre link, when there is one to carry. */
export function fixtureHrefWithReturn(fixtureId: string, from: string | null): string {
  const base = `/fixtures/${fixtureId}`
  return from ? `${base}?${FIXTURE_RETURN_PARAM}=${encodeURIComponent(from)}` : base
}

/**
 * The fixture RECORD, with the view carried only when there is a view to
 * carry.
 *
 * The record page already knows which Control Centre this viewer belongs to --
 * Site Admin's global one only while they are operating as Site Admin -- so a
 * bare surface name adds nothing and lengthens every row's URL. What it cannot
 * know is the FILTERS somebody had applied, so those are worth carrying and
 * nothing else is.
 */
export function fixtureRecordHref(fixtureId: string, from: string | null): string {
  const base = `/admin/fixtures/${fixtureId}`
  return from && from.includes("?") ? `${base}?${FIXTURE_RETURN_PARAM}=${encodeURIComponent(from)}` : base
}
