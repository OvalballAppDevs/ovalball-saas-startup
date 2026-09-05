// GoCardless environment gating (Side Project 1 integration). Every value
// here is read from process.env -- none is hardcoded, and none defaults
// to a live/production value.
//
// The structural go-live gate: calling code must call
// assertGoCardlessEnvironmentSafe() before constructing any request that
// would create real mandates, subscriptions, or payments. That function
// throws unless GOCARDLESS_ENV === "sandbox" OR the explicit, separate
// GOCARDLESS_PRODUCTION_GO_LIVE_CONFIRMED === "true" flag is ALSO set.
// This project's own .env.local never sets that second flag -- so even if
// GOCARDLESS_ENV were accidentally set to "production", the app refuses
// to place a live call. Production only becomes reachable once a human
// deliberately sets BOTH variables -- not a silent default, an
// intentional two-variable act.

export type GoCardlessEnvironment = "sandbox" | "production"

export function getGoCardlessEnvironment(): GoCardlessEnvironment {
  const raw = process.env.GOCARDLESS_ENV
  return raw === "production" ? "production" : "sandbox"
}

export function isGoCardlessProductionGoLiveConfirmed(): boolean {
  return process.env.GOCARDLESS_PRODUCTION_GO_LIVE_CONFIRMED === "true"
}

/** Throws unless this call is genuinely permitted to run against production. */
export function assertGoCardlessEnvironmentSafe(): GoCardlessEnvironment {
  const env = getGoCardlessEnvironment()
  if (env === "production" && !isGoCardlessProductionGoLiveConfirmed()) {
    throw new Error(
      'GOCARDLESS_ENV=production but GOCARDLESS_PRODUCTION_GO_LIVE_CONFIRMED is not set to "true". ' +
        "Production GoCardless calls are hard-disabled until the full go-live checklist is complete and a human deliberately sets this second flag. Refusing to proceed."
    )
  }
  return env
}

export function getGoCardlessApiBaseUrl(environment: GoCardlessEnvironment): string {
  return environment === "production" ? "https://api.gocardless.com" : "https://api-sandbox.gocardless.com"
}

export function getGoCardlessConnectBaseUrl(environment: GoCardlessEnvironment): string {
  return environment === "production" ? "https://connect.gocardless.com" : "https://connect-sandbox.gocardless.com"
}

export function getGoCardlessClientId(): string {
  const value = process.env.GOCARDLESS_CLIENT_ID
  if (!value) {
    throw new Error("Missing required environment variable: GOCARDLESS_CLIENT_ID. Set this to the Ovalball partner app's sandbox client ID.")
  }
  return value
}

export function getGoCardlessClientSecret(): string {
  const value = process.env.GOCARDLESS_CLIENT_SECRET
  if (!value) {
    throw new Error("Missing required environment variable: GOCARDLESS_CLIENT_SECRET. Set this to the Ovalball partner app's sandbox client secret.")
  }
  return value
}

export function getGoCardlessWebhookSecret(): string {
  const value = process.env.GOCARDLESS_WEBHOOK_SECRET
  if (!value) {
    throw new Error("Missing required environment variable: GOCARDLESS_WEBHOOK_SECRET. Set this to the sandbox webhook endpoint's signing secret.")
  }
  return value
}

/**
 * Adapted from Side Project 1's own GOCARDLESS-only NEXT_PUBLIC_APP_URL --
 * reuses Main's existing NEXT_PUBLIC_SITE_URL convention instead (already
 * used by every other absolute-link builder in this codebase, e.g.
 * lib/auth/check-account.ts, lib/signup/complete-signup.ts) rather than
 * introducing a second, redundant "app URL" variable.
 */
export function getAppBaseUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
}

/**
 * The OAuth redirect_uri hard gate (release-packaging addition).
 *
 * getAppBaseUrl() falls back to http://localhost:3000 so local development
 * works with no configuration. That fallback must never survive into a
 * production GoCardless deployment: a production OAuth flow built on a
 * localhost redirect_uri would either be rejected by GoCardless or, worse,
 * point a real merchant authorization at a non-production origin.
 *
 * This throws unless the base URL is a real HTTPS origin whenever the
 * GoCardless environment is production. Sandbox/local is unaffected, so
 * `http://localhost:3000` keeps working exactly as before for development.
 */
export function assertGoCardlessRedirectOriginSafe(): string {
  const baseUrl = getAppBaseUrl()
  if (getGoCardlessEnvironment() !== "production") return baseUrl

  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error("GOCARDLESS_ENV=production but NEXT_PUBLIC_SITE_URL is not a valid absolute URL. Refusing to build a production OAuth redirect_uri.")
  }

  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1" || parsed.hostname.endsWith(".local")
  if (isLocal || parsed.protocol !== "https:") {
    throw new Error(
      "GOCARDLESS_ENV=production requires NEXT_PUBLIC_SITE_URL to be the real production HTTPS origin. " +
        "Refusing to build a production GoCardless OAuth redirect_uri from a non-HTTPS or localhost origin."
    )
  }
  return baseUrl
}
