import type { SupabaseClient } from "@supabase/supabase-js"
import { NextResponse, type NextRequest } from "next/server"

import { exchangeGoCardlessOAuthCode } from "@/lib/payments/gocardless/oauth"
import { assertGoCardlessEnvironmentSafe } from "@/lib/payments/gocardless/env"
import { syncGoCardlessVerificationStatus } from "@/lib/payments/gocardless/verification"
import { requireSession, sessionRefusal } from "@/lib/auth/require-session"
import { createClient } from "@/lib/supabase/server"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import { CONNECT_NOTICES, type ConnectNoticeCode } from "@/lib/payments/gocardless/connect-notices"

export const dynamic = "force-dynamic"

const STATE_COOKIE = "gc_oauth_state"
const CLUB_COOKIE = "gc_oauth_club_id"
/** Set by app/api/gocardless/oauth/app/begin when the journey started in the Ovalball app (20270750000000). */
const APP_STATE_COOKIE = "gc_oauth_app_state"
/** Every cookie of both journeys is set on this path, and must be removed on it. */
const OAUTH_COOKIE_PATH = "/api/gocardless/oauth"

/**
 * The server-side half of the OAuth2 exchange. GoCardless redirects the
 * browser here with a short-lived `code` -- this route exchanges it for
 * an access token over a direct server-to-GoCardless request (never
 * exposed to the browser), then calls store_gocardless_connection() using
 * the SAME authenticated user session that started the flow (its own
 * SECURITY DEFINER capability check is the real authorization boundary --
 * this route's CSRF-state check exists to prevent a cross-site request
 * from completing an unrelated user's OAuth flow, not to substitute for
 * that boundary).
 *
 * TWO JOURNEYS END HERE. A connection started on the website (above) and one started in the Ovalball
 * app (20270750000000), which arrives in a browser with no Ovalball session and carries the app's state
 * cookie instead. That one is finished by `completeAppReturn` below and never reaches the website's
 * branch; the website's branch is unchanged.
 */
export async function GET(request: NextRequest) {
  const appState = request.cookies.get(APP_STATE_COOKIE)?.value
  if (appState && !isWebFlowReturn(request)) return completeAppReturn(request, appState)

  const settingsUrl = new URL("/club/settings/subscriptions", request.url)

  const code = request.nextUrl.searchParams.get("code")
  const returnedState = request.nextUrl.searchParams.get("state")
  const gcError = request.nextUrl.searchParams.get("error")

  const cookieState = request.cookies.get(STATE_COOKIE)?.value
  const cookieClubId = request.cookies.get(CLUB_COOKIE)?.value

  // Removed on the path the start route set them on. `delete(name)` alone writes `Path=/`, which is a
  // different cookie as far as the browser is concerned, so these used to survive every return for ten minutes.
  const clearCookies = (response: NextResponse) => {
    response.cookies.delete({ name: STATE_COOKIE, path: OAUTH_COOKIE_PATH })
    response.cookies.delete({ name: CLUB_COOKIE, path: OAUTH_COOKIE_PATH })
    return response
  }

  // GoCardless's own error code is for a developer, never for the person: "access_denied" is somebody pressing
  // Cancel on GoCardless's page, and anything else is GoCardless not finishing. Nothing was connected either way.
  if (gcError) {
    if (gcError !== "access_denied") console.error("[gocardless oauth] callback error from GoCardless:", gcError.slice(0, 80))
    settingsUrl.searchParams.set("gc_error", (gcError === "access_denied" ? "cancelled" : "declined") satisfies ConnectNoticeCode)
    return clearCookies(NextResponse.redirect(settingsUrl))
  }

  if (!code || !returnedState || !cookieState || !cookieClubId || returnedState !== cookieState) {
    settingsUrl.searchParams.set("gc_error", "unverified" satisfies ConnectNoticeCode)
    return clearCookies(NextResponse.redirect(settingsUrl))
  }

  const supabase = await createClient()
  // D.2 layer 2. The state/cookie pair above proves this browser started the flow; it says nothing
  // about whether the Ovalball account is still usable by the time the provider sends them back.
  // Suspension, disablement or a session revocation can all happen during the round trip.
  const decision = await requireSession({}, supabase)
  if (!decision.ok) {
    return clearCookies(NextResponse.redirect(new URL(sessionRefusal(decision.reason).href, request.url)))
  }

  // A refusal the person can act on, said in this route's own words (never the database's).
  let refusal: string | null = null
  try {
    const environment = assertGoCardlessEnvironmentSafe()
    const token = await exchangeGoCardlessOAuthCode(code)

    const { error } = await supabase.rpc("store_gocardless_connection", {
      p_club_id: cookieClubId,
      p_environment: environment,
      p_gc_organisation_id: token.organisation_id ?? "",
      p_access_token: token.access_token,
      p_scope: token.scope,
    })
    // Not a rethrow of the raw message: it is a Postgres exception, and the catch below used to
    // interpolate it straight into a query parameter -- so internal function and column names
    // reached the browser, the address bar, browser history and any referrer.
    if (error) {
      console.error("[gocardless oauth] store_gocardless_connection refused:", error.code ?? error.message)
      // 55000: the club still has live Direct Debits on the GoCardless account it was connected to, and this
      // is a different account or environment (20270749000000). Retrying cannot help, so the person is told.
      if (error.code === "55000") refusal = SWITCH_REFUSED
      throw new Error("STORE_FAILED")
    }

    // Best-effort immediate sync against the real GoCardless Creditors
    // API. This never fails the connection itself -- the connection is
    // real and already stored; verification status is a follow-up read
    // that fails soft to "unknown" (its own internal fail-safe) if
    // GoCardless is unreachable or returns something unexpected. A future
    // webhook (creditors/creditor_updated) re-runs this same sync, so a
    // missed immediate read here is not permanent.
    try {
      await syncGoCardlessVerificationStatus({ clubId: cookieClubId, environment, accessToken: token.access_token })
    } catch (syncError) {
      console.error("[gocardless oauth] Post-connect verification sync failed:", syncError instanceof Error ? syncError.message : syncError)
    }

    settingsUrl.searchParams.set("gc_connected", "1")
    return clearCookies(NextResponse.redirect(settingsUrl))
  } catch (error) {
    // The detail is logged, never shown. A person cannot act on a Postgres error string, and putting
    // one in a URL publishes it further than the page.
    console.error("[gocardless oauth] connection failed:", error instanceof Error ? error.message : error)
    settingsUrl.searchParams.set("gc_error", refusal === SWITCH_REFUSED ? "switch_refused" : ("failed" satisfies ConnectNoticeCode))
    return clearCookies(NextResponse.redirect(settingsUrl))
  }
}

/** One sentence for this refusal on the website and in the app (app/api/gocardless/oauth/app/finish). */
const SWITCH_REFUSED = CONNECT_NOTICES.switch_refused

// =====================================================================================================
// THE APP'S RETURN (20270750000000).
//
// The browser here is the phone's authentication session. It has no Ovalball session, so nothing in it
// may decide anything about a person or a club -- and nothing does. Three things hold:
//
//   1. GoCardless's state must be THIS browser's state. GoCardless's own reference says the state "can be
//      tampered with by the user, so do not trust implicitly"; what is trusted is the httpOnly cookie the
//      begin route set, and the returned state must equal it. A code arriving with somebody else's state --
//      a GoCardless link forwarded, or replayed into another browser -- attaches to nothing.
//   2. The code goes into the intent the cookie names, and no further. It is never put in a URL, a
//      cookie or a page. The browser is sent into the app with the intent's id and a one-time RETURN
//      HANDOFF, minted here and kept by the database only as its hash. The app must present both, with
//      the starter's own token, to claim the code (claim_gocardless_connect_code) -- so the result of a
//      begin link forwarded to somebody else is handed to THEIR device, and the sender can never claim it.
//   3. The browser is sent only to the intent's return address, which the database accepted only in the
//      Ovalball app's own schemes -- so this cannot be used to send anybody to a website.
// =====================================================================================================

/** The website's own journey has its own state cookie; when that is the state that came back, it is the website's. */
function isWebFlowReturn(request: NextRequest): boolean {
  const returnedState = request.nextUrl.searchParams.get("state")
  const webState = request.cookies.get(STATE_COOKIE)?.value
  return Boolean(returnedState && webState && returnedState === webState)
}

async function completeAppReturn(request: NextRequest, appState: string): Promise<NextResponse> {
  const returnedState = request.nextUrl.searchParams.get("state")
  const code = request.nextUrl.searchParams.get("code")
  const gcError = request.nextUrl.searchParams.get("error")

  // A refusal from GoCardless that does not repeat the state can only close the cookie's own intent, so
  // it is allowed to; a code is never accepted without the exact state.
  const stateMatches = returnedState === appState || (Boolean(gcError) && !returnedState)
  if (!stateMatches) return forgetAppState(request, appPage(400, APP_NOT_VERIFIED))

  const service = createServiceRoleClient() as unknown as SupabaseClient

  if (gcError || !code) {
    // `access_denied` is the person declining on GoCardless's own page: a choice, not a fault.
    const reason = gcError === "access_denied" ? "provider_declined" : gcError ? "provider_error" : "no_code"
    const { data, error } = await service
      .rpc("fail_gocardless_connect_intent", { p_state: appState, p_reason: reason })
      .maybeSingle<{ intent_id: string; return_url: string }>()
    if (error) console.error("[gocardless app connect] closing the intent failed:", error.code)
    const back = data ? backToApp(data.return_url, data.intent_id, "error", null) : null
    return forgetAppState(request, back ? NextResponse.redirect(back) : appPage(400, APP_NOT_VERIFIED))
  }

  const { data, error } = await service
    .rpc("attach_gocardless_connect_code", { p_state: appState, p_code: code })
    .maybeSingle<{ outcome: string; intent_id: string | null; return_url: string | null; handoff: string | null }>()
  if (error) console.error("[gocardless app connect] attaching the code failed:", error.code)
  const attached = data?.outcome === "attached" && Boolean(data.handoff)
  const back =
    data?.intent_id && data.return_url
      ? backToApp(data.return_url, data.intent_id, attached ? "returned" : "error", attached ? data.handoff : null)
      : null
  return forgetAppState(request, back ? NextResponse.redirect(back) : appPage(400, APP_NOT_VERIFIED))
}

const APP_NOT_VERIFIED = "The GoCardless connection request could not be verified. Go back to the Ovalball app and try connecting again."

/**
 * The intent's own return address with the intent, the result and (on success) the return handoff added --
 * and only ever an address in the Ovalball app. The database refuses anything else when the intent is
 * created; this refuses it again, because an open redirect is not a thing to rely on one check for.
 */
function backToApp(returnUrl: string, intentId: string, result: "returned" | "error", handoff: string | null): string | null {
  if (!/^(ovalball|ovalball-dev|ovalball-staging|exp|exps):\/\//i.test(returnUrl)) return null
  try {
    const url = new URL(returnUrl)
    url.searchParams.set("intent", intentId)
    url.searchParams.set("result", result)
    if (handoff) url.searchParams.set("handoff", handoff)
    return url.toString()
  } catch {
    return null
  }
}

/** Removed with its own path: a cookie set on /api/gocardless/oauth is not removed by one on /. */
function forgetAppState(request: NextRequest, response: NextResponse): NextResponse {
  response.cookies.set(APP_STATE_COOKIE, "", {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: OAUTH_COOKIE_PATH,
    expires: new Date(0),
  })
  response.headers.set("Cache-Control", "no-store")
  response.headers.set("Referrer-Policy", "no-referrer")
  return response
}

/** A fixed sentence on a page with nothing else on it. */
function appPage(status: number, sentence: string): NextResponse {
  const html =
    `<!doctype html><html lang="en-GB"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">` +
    `<title>Connect GoCardless</title></head><body><main><h1>Connect GoCardless</h1><p>${sentence}</p></main></body></html>`
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'", "X-Content-Type-Options": "nosniff" },
  })
}
