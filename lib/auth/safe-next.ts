/**
 * The one place a post-authentication redirect target is validated.
 *
 * Previously this lived inline in app/auth/callback/route.ts. OAuth adds a
 * second place a `next` value is handled -- the client passes one into
 * signInWithOAuth's redirectTo -- and two copies of an open-redirect guard
 * is exactly how one of them drifts. Both now call this.
 *
 * Resolved against a sentinel origin rather than pattern-matched: anything
 * that resolves away from that origin is, by definition, not same-origin,
 * which catches the whole family at once rather than one string trick at a
 * time -- "https://evil.com", "//evil.com", "/\\evil.com",
 * "https://user@evil.com", and scheme payloads like "javascript:alert(1)".
 * The query and hash are preserved, so a legitimate target keeps working.
 */
/**
 * WHERE A SUCCESSFULLY AUTHENTICATED PERSON BELONGS.
 *
 * `/dashboard` is Ovalball's canonical authenticated entry point -- the place
 * every in-app guard already sends somebody who may not be where they are -- and
 * it resolves context through the existing `(app)` layout. Naming it once here,
 * in the file that already owns the post-authentication destination decision,
 * keeps authentication out of the business of routing by role: there is no
 * parallel role table, because context resolution decides what the dashboard
 * shows.
 */
export const AUTHENTICATED_HOME = "/dashboard"

/**
 * THE DEFAULT USED TO BE THE PUBLIC HOMEPAGE, AND THAT WAS THE PRODUCTION BUG.
 *
 * `DEFAULT_NEXT_PATH` was `"/"`. Every caller that reached the fallback -- a
 * missing `next`, an unsafe one, a malformed one -- sent a person who had just
 * proved who they are to the marketing site. The reported symptom was Google
 * sign-in: `/login` rendered the social buttons without a `next` at all, so the
 * OAuth start encoded `next=%2F` into its own callback URL and the callback
 * faithfully delivered the newly authenticated user to the front page.
 *
 * Rejecting an attack had the same ending. An attempted open redirect was
 * correctly refused and then dropped on the homepage rather than the
 * application, which reads as a broken login rather than a blocked one.
 */
export const DEFAULT_NEXT_PATH = AUTHENTICATED_HOME

const SENTINEL_ORIGIN = "https://ovalball.invalid"

/** C0 controls plus DEL -- never legitimate in a redirect target. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/

/**
 * Paths that are never a post-authentication destination, however they arrive.
 *
 * The public homepage and the authentication surfaces themselves are same-origin
 * and would pass every check above, which is exactly how somebody lands back at
 * `/login` after signing in, or on the marketing page they started from. A
 * returning `next` that names one of these is stale rather than malicious, and
 * the honest answer to a stale destination is the application.
 */
const NOT_A_DESTINATION = new Set(["/", "/login", "/signup", "/auth/callback", "/logout"])

export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/")) return DEFAULT_NEXT_PATH
  if (CONTROL_CHARACTERS.test(next)) return DEFAULT_NEXT_PATH

  // A rooted path can still be a network-path reference ("//host") or use a
  // backslash some parsers normalise to one, so let URL decide rather than
  // trusting the leading slash.
  try {
    const url = new URL(next, SENTINEL_ORIGIN)
    if (url.origin !== SENTINEL_ORIGIN) return DEFAULT_NEXT_PATH
    if (NOT_A_DESTINATION.has(url.pathname)) return DEFAULT_NEXT_PATH
    // `new URL` does not reject an invalid percent-escape -- it carries "/%%%"
    // straight through -- so a malformed destination survived a guard whose job
    // is to reject malformed destinations. Harmless in itself, since it is
    // same-origin and would simply 404, but "invalid input is passed on" is not
    // a property to leave in a redirect validator.
    decodeURIComponent(url.pathname + url.search + url.hash)
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return DEFAULT_NEXT_PATH
  }
}
