import "server-only"

/**
 * Cloudflare Turnstile verification -- the actual anti-bot boundary.
 *
 * The rugby slider in the UI is an Ovalball interaction, not a security
 * control: pointer and touch events are trivially automated, so "the slider
 * was dragged" proves nothing. What proves something is a Turnstile token
 * that THIS server exchanges with Cloudflare, checking the response's
 * success flag and the hostname it was issued for. That exchange happens
 * here and nowhere else.
 *
 * Configuration:
 *   TURNSTILE_SECRET_KEY            server-only, never NEXT_PUBLIC_
 *   NEXT_PUBLIC_TURNSTILE_SITE_KEY  public by design (it is in the widget)
 *
 * Not configured means not enforced. That is deliberate rather than lax:
 * Ovalball already has authentication in production, and a deploy that
 * started rejecting every sign-in because a key was missing would lock real
 * users out of a working service. Enforcement switches on the moment both
 * keys exist -- and once on, it fails CLOSED: a missing, malformed,
 * expired, reused or wrong-hostname token is rejected.
 */
const VERIFY_ENDPOINT = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

export function isTurnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)
}

export type TurnstileResult =
  | { ok: true; enforced: boolean }
  | { ok: false; reason: string }

/**
 * Verify a Turnstile token server-side.
 *
 * `expectedHostname` should be the host the widget was served from. Passing
 * it lets Cloudflare's response be checked against where the token was
 * actually issued, so a token farmed on another site cannot be replayed
 * here.
 */
export async function verifyTurnstileToken(
  token: string | null | undefined,
  options: { remoteIp?: string | null; expectedHostname?: string | null } = {}
): Promise<TurnstileResult> {
  if (!isTurnstileConfigured()) {
    // Not enforced. Reported honestly so callers can log/report the
    // difference between "passed the check" and "there was no check".
    return { ok: true, enforced: false }
  }

  if (!token || typeof token !== "string" || token.length > 4096) {
    return { ok: false, reason: "missing-token" }
  }

  const body = new URLSearchParams()
  body.set("secret", process.env.TURNSTILE_SECRET_KEY as string)
  body.set("response", token)
  if (options.remoteIp) body.set("remoteip", options.remoteIp)

  let payload: { success?: boolean; hostname?: string; "error-codes"?: string[] }
  try {
    const response = await fetch(VERIFY_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      // A slow provider must not hang a sign-in attempt indefinitely.
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return { ok: false, reason: "verify-unavailable" }
    payload = await response.json()
  } catch {
    // Fail closed. If we cannot verify, we do not assume the visitor is
    // human -- the fallback is "try again", not "let it through".
    return { ok: false, reason: "verify-unavailable" }
  }

  if (!payload.success) {
    console.error("turnstile: rejected", { codes: payload["error-codes"] })
    // Cloudflare's error-codes are deliberately not surfaced to the caller's
    // user-facing message; they are useful to us, not to an attacker probing
    // which signal tripped.
    return { ok: false, reason: "rejected" }
  }

  // Hostname binding: a token issued for another site must not be spendable
  // here. Enforced in production only -- on localhost, Cloudflare's own
  // documented test keys report a fixed hostname of their own, so comparing
  // against "localhost" would reject every local sign-in and the check would
  // be silently disabled by developers rather than understood. Production is
  // where token farming actually matters, and there the comparison is real.
  const isLocalHost =
    options.expectedHostname === "localhost" || options.expectedHostname === "127.0.0.1"

  if (
    !isLocalHost &&
    options.expectedHostname &&
    payload.hostname &&
    payload.hostname !== options.expectedHostname
  ) {
    console.error("turnstile: hostname mismatch", {
      expected: options.expectedHostname,
      received: payload.hostname,
    })
    return { ok: false, reason: "hostname-mismatch" }
  }

  return { ok: true, enforced: true }
}

/** The single user-facing failure message. Never says which signal failed. */
export const TURNSTILE_FAILURE_MESSAGE =
  "We couldn't complete the security check. Please try again."
