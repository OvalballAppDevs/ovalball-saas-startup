/**
 * WHAT A RETURN FROM CONNECTING GOCARDLESS SAYS ON THE WEBSITE -- by code, never by text in the address.
 *
 * The OAuth routes send the person back to Club Settings › Subscriptions & Payments with `gc_error=<code>`. The
 * page turns the code into one of these fixed sentences. It used to carry the sentence itself in the address and
 * show whatever arrived there, so anybody could send a Club Admin a real Ovalball link that displayed words of their
 * choosing in the page's own error style ("…call this number…"). An unknown code shows the general failure, never
 * the code.
 */
export const CONNECT_NOTICES = {
  /** GoCardless's page: the person pressed Cancel ("access_denied"). */
  cancelled: "The connection was cancelled on GoCardless's page, so nothing was connected. Connect again when you're ready.",
  /** GoCardless's page reported anything else. */
  declined: "GoCardless couldn't finish connecting the club's account, so nothing was connected. Please try again.",
  /** The state or club cookie did not match: a stale, replayed or forwarded return. */
  unverified: "The GoCardless connection request could not be verified. Please try connecting again.",
  /** Ovalball's terms for Club Memberships come first (the same sentence the app's start route returns). */
  terms: "Agree to Ovalball's terms for Club Memberships before connecting GoCardless.",
  /** The terms could not be checked. */
  terms_check: "Could not check this club's Club Memberships terms. Please try again.",
  /** The GoCardless configuration is unavailable on this server. */
  unavailable: "GoCardless cannot be reached from Ovalball right now. Please try again later.",
  /** The token exchange or the store failed. */
  failed: "Could not complete the GoCardless connection. Please try connecting again.",
  /** A club with live Direct Debits tried to switch to a different GoCardless account (20270749000000, 55000). */
  switch_refused: "This club still has live Direct Debits on its current GoCardless account, so it can't switch to a different one. Contact Ovalball support.",
} as const

export type ConnectNoticeCode = keyof typeof CONNECT_NOTICES

/** The sentence for a code from the address; null when there is none, the general failure for anything unknown. */
export function connectNoticeText(code: string | null | undefined): string | null {
  if (!code) return null
  return Object.prototype.hasOwnProperty.call(CONNECT_NOTICES, code) ? CONNECT_NOTICES[code as ConnectNoticeCode] : CONNECT_NOTICES.failed
}
