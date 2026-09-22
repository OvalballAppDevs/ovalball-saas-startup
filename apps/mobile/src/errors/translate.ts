/**
 * WHAT A PERSON IS TOLD WHEN SOMETHING FAILS.
 *
 * `PGRST116`, `JWT expired` and a raised plpgsql message are diagnostics. They belong in a developer's
 * console, and putting them on a phone screen tells a parent at a touchline something that is both
 * frightening and useless. Every failure a person can see passes through here first.
 *
 * TWO RULES. It never invents a cause it does not know -- an unrecognised failure says the honest
 * generic thing rather than guessing. And it never leaks the original text, because a database error
 * can name a table, a column or a constraint, and those are not a person's business.
 *
 * The developer still gets the original: `detail` is returned alongside and logged in development
 * only, so a report of "Couldn't load your teams" is still traceable.
 */

export interface FriendlyError {
  /** What the person reads. Sentence case, UK English, says what to do next where there is something to do. */
  message: string
  /** The original, for a development console. Never rendered. */
  detail: string | null
  /** True when trying again is genuinely likely to help. */
  retryable: boolean
}

const OFFLINE = /network request failed|fetch failed|timeout|Failed to fetch|NetworkError/i
const EXPIRED = /jwt expired|invalid claim|token is expired|refresh_token_not_found|session_not_found/i
const CREDENTIALS = /invalid login credentials|invalid_credentials|email not confirmed/i
const MFA = /invalid totp|invalid code|mfa_verification_failed/i
const RATE_LIMIT = /rate limit|too many requests|over_request_rate_limit/i
const FORBIDDEN = /permission denied|42501|not authorised|not authorized|row-level security/i

export function friendly(error: unknown, subject = "that"): FriendlyError {
  const detail = messageOf(error)
  const text = detail ?? ""

  if (OFFLINE.test(text)) {
    return { message: "No connection. Check your signal and try again.", detail, retryable: true }
  }
  if (CREDENTIALS.test(text)) {
    // Deliberately undifferentiated, exactly as the website's own login is: telling somebody the
    // address exists but the password is wrong tells an attacker the same thing.
    return { message: "Email or password is incorrect.", detail, retryable: false }
  }
  if (MFA.test(text)) {
    return { message: "That code was not accepted. Codes change every 30 seconds — try the current one.", detail, retryable: false }
  }
  if (RATE_LIMIT.test(text)) {
    return { message: "Too many attempts. Wait a minute and try again.", detail, retryable: true }
  }
  if (EXPIRED.test(text)) {
    return { message: "Your session has ended. Sign in again.", detail, retryable: false }
  }
  if (FORBIDDEN.test(text)) {
    return { message: `You do not have access to ${subject}.`, detail, retryable: false }
  }
  return { message: `Couldn't load ${subject}. Try again.`, detail, retryable: true }
}

function messageOf(error: unknown): string | null {
  if (!error) return null
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  if (typeof error === "object" && "message" in error) return String((error as { message: unknown }).message)
  return null
}

/**
 * Development-only logging, so a friendly message is still traceable without ever reaching a screen.
 *
 * `__DEV__` is a React Native global and this module is deliberately portable -- its rules are unit
 * tested from Node, where that global does not exist. Guarded rather than assumed, so the module can
 * be imported anywhere without carrying a platform with it.
 */
declare const __DEV__: boolean | undefined

export function logDetail(where: string, error: FriendlyError): void {
  if (typeof __DEV__ !== "undefined" && __DEV__ && error.detail) {
    // eslint-disable-next-line no-console
    console.warn(`[ovalball] ${where}: ${error.detail}`)
  }
}
