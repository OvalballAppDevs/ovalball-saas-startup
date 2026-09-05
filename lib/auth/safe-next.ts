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
export const DEFAULT_NEXT_PATH = "/"

const SENTINEL_ORIGIN = "https://ovalball.invalid"

/** C0 controls plus DEL -- never legitimate in a redirect target. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/

export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/")) return DEFAULT_NEXT_PATH
  if (CONTROL_CHARACTERS.test(next)) return DEFAULT_NEXT_PATH

  // A rooted path can still be a network-path reference ("//host") or use a
  // backslash some parsers normalise to one, so let URL decide rather than
  // trusting the leading slash.
  try {
    const url = new URL(next, SENTINEL_ORIGIN)
    if (url.origin !== SENTINEL_ORIGIN) return DEFAULT_NEXT_PATH
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return DEFAULT_NEXT_PATH
  }
}
