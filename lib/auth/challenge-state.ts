/**
 * THE TURNSTILE CHALLENGE STATE, IN ONE PLACE.
 *
 * Deliberately not `server-only`: this is the client-side bookkeeping for a human-verification
 * challenge, and the login and signup forms are client components.
 *
 * WHY THIS MODULE EXISTS
 *
 * A Turnstile token is single-use. Three different screens each kept their own pair of variables for
 * one fact -- the token, and a boolean saying the visitor had cleared the challenge -- and they did
 * not agree with each other about what happens when the token is spent. One of them cleared the token
 * and left the boolean true. The submit button was gated on the boolean, so it stayed enabled, every
 * retry posted `null`, the server verified fail-closed exactly as designed, and the visitor was told
 * "We couldn't complete the security check" forever. That locked the platform owner out of their own
 * account, with a correct password, for as long as they kept trying.
 *
 * Two variables for one fact is what made that possible. This module keeps them together so a screen
 * cannot hold half of the state, and states the rule once:
 *
 *     NO VALID TOKEN  =>  NOT SUBMITTABLE
 *
 * WHAT THIS IS NOT
 *
 * It is not a security boundary and must never be treated as one. `lib/auth/turnstile.ts` verifies
 * every token with Cloudflare, server-side, and fails closed once configured. This only decides what
 * the page is allowed to TRY; the server decides what actually happens. Nothing here can grant
 * anything, and a caller that bypassed it entirely would still be refused by the server.
 */

export type ChallengeState = {
  /** The single-use Cloudflare token, or null when there is none to spend. */
  token: string | null
  /** Whether a challenge has been cleared and not yet spent. */
  passed: boolean
}

/**
 * A page that has not yet been through the challenge.
 *
 * When Turnstile is not configured -- local development, where no keys exist -- there is no challenge
 * to clear, so the page proceeds. That is the same fail-open the server applies in
 * `verifyTurnstileToken`, and it is deliberate: a missing key must not stop work on a laptop. In
 * production both keys exist and neither side fails open.
 */
export function challengeIdle(required: boolean): ChallengeState {
  return { token: null, passed: !required }
}

/** Cloudflare issued a token. Both halves move together, always. */
export function challengeVerified(token: string): ChallengeState {
  return { token, passed: true }
}

/**
 * The token has been handed to a protected request, so it is gone whatever the outcome.
 *
 * Called on failure, where it matters: the page must fall back to "not verified" and wait for a fresh
 * challenge rather than offering a button that cannot work. On success the page navigates away, so
 * this is moot there -- but it is safe to call in both places, which is the point of having one rule.
 */
export function challengeSpent(required: boolean): ChallengeState {
  return challengeIdle(required)
}

/**
 * May the page attempt a protected request?
 *
 * Both halves must agree. A `passed` flag whose token has gone is exactly the state that caused the
 * incident, and it answers false here.
 */
export function canSubmitProtected(state: ChallengeState, required: boolean): boolean {
  if (!required) return true
  return state.passed && state.token !== null
}

/** The token to send, or null when there is none. Never returns a token the page may not spend. */
export function tokenForSubmission(state: ChallengeState, required: boolean): string | null {
  if (!required) return null
  return canSubmitProtected(state, required) ? state.token : null
}
