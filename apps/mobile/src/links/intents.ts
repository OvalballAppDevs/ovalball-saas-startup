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

export type LinkIntent =
  | { kind: "AUTH_RECOVERY"; code: string }
  /** A link Ovalball issued but this build does not handle yet -- named so it can be reported honestly. */
  | { kind: "NOT_YET_SUPPORTED"; path: string }
  | { kind: "UNKNOWN" }

/**
 * The paths Ovalball already issues links for, which this build cannot yet complete. Listed rather
 * than guessed so that "we know what this is and it is not built" can be told apart from "this is not
 * one of ours" -- two different things to say to somebody who just tapped a link.
 */
const PLANNED = ["/join", "/invitation", "/fixtures", "/messages", "/notifications", "/subscriptions", "/rugby-hub"]

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

  if (PLANNED.some((planned) => path === planned || path.startsWith(`${planned}/`))) {
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
