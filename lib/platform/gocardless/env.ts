import "server-only"

/**
 * Credentials and gates for **Ovalball's own** GoCardless merchant — the
 * account Pipaxon collects club subscriptions into.
 *
 * This is a different merchant, a different credential and a different
 * webhook endpoint from `lib/payments/gocardless/env.ts`, which holds the
 * partner-app credentials Ovalball uses to connect to *each club's* own
 * merchant so the club can charge its members. Sharing either credential
 * between the two would mean one domain could move the other's money.
 *
 * Three gates have to be open before a single penny can be collected from
 * a club:
 *
 *   1. `GOCARDLESS_ENV` / `GOCARDLESS_PRODUCTION_GO_LIVE_CONFIRMED` — the
 *      existing two-variable production gate, shared with Domain A.
 *   2. `OVALBALL_SAAS_BILLING_ENABLED` — this domain's own switch, so a
 *      working Domain A configuration can never start Ovalball billing.
 *   3. The platform access token and webhook secret actually being set.
 *
 * None of these is set in this repository, in `.env.example`, or in any
 * deployed environment.
 */

export function getPlatformGoCardlessAccessToken(): string {
  const value = process.env.GOCARDLESS_PLATFORM_ACCESS_TOKEN
  if (!value) {
    throw new Error(
      "Missing required environment variable: GOCARDLESS_PLATFORM_ACCESS_TOKEN. " +
        "This is Ovalball's own merchant token, and is never a club's connected token."
    )
  }
  return value
}

export function getPlatformGoCardlessWebhookSecret(): string {
  const value = process.env.GOCARDLESS_PLATFORM_WEBHOOK_SECRET
  if (!value) {
    throw new Error(
      "Missing required environment variable: GOCARDLESS_PLATFORM_WEBHOOK_SECRET. " +
        "This is the signing secret for Ovalball's own billing webhook endpoint, not the club-merchant one."
    )
  }
  return value
}

/** True only when both this domain's own credentials are present. */
export function isPlatformBillingConfigured(): boolean {
  return Boolean(
    process.env.GOCARDLESS_PLATFORM_ACCESS_TOKEN && process.env.GOCARDLESS_PLATFORM_WEBHOOK_SECRET
  )
}

/**
 * The Domain B switch. Deliberately separate from `GOCARDLESS_ENV`: a club
 * charging its own members and Ovalball charging that club are different
 * decisions, made at different times, by different people.
 */
export function isPlatformBillingEnabled(): boolean {
  return process.env.OVALBALL_SAAS_BILLING_ENABLED === "true"
}

/**
 * Throws unless every gate is open. Call before constructing any request
 * that could create a mandate, a subscription or a collection against a
 * club.
 */
export function assertPlatformBillingPermitted(): void {
  if (!isPlatformBillingEnabled()) {
    throw new Error(
      "Ovalball SaaS billing is disabled. Set OVALBALL_SAAS_BILLING_ENABLED=true only after the go-live checklist is complete. Refusing to proceed."
    )
  }
  if (!isPlatformBillingConfigured()) {
    throw new Error(
      "Ovalball SaaS billing is enabled but its own GoCardless credentials are not set. Refusing to proceed."
    )
  }
}
