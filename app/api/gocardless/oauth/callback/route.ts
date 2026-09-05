import { NextResponse, type NextRequest } from "next/server"

import { exchangeGoCardlessOAuthCode } from "@/lib/payments/gocardless/oauth"
import { assertGoCardlessEnvironmentSafe } from "@/lib/payments/gocardless/env"
import { syncGoCardlessVerificationStatus } from "@/lib/payments/gocardless/verification"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const STATE_COOKIE = "gc_oauth_state"
const CLUB_COOKIE = "gc_oauth_club_id"

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
 */
export async function GET(request: NextRequest) {
  const settingsUrl = new URL("/club/settings/subscriptions", request.url)

  const code = request.nextUrl.searchParams.get("code")
  const returnedState = request.nextUrl.searchParams.get("state")
  const gcError = request.nextUrl.searchParams.get("error")

  const cookieState = request.cookies.get(STATE_COOKIE)?.value
  const cookieClubId = request.cookies.get(CLUB_COOKIE)?.value

  const clearCookies = (response: NextResponse) => {
    response.cookies.delete(STATE_COOKIE)
    response.cookies.delete(CLUB_COOKIE)
    return response
  }

  if (gcError) {
    settingsUrl.searchParams.set("gc_error", `GoCardless declined the connection: ${gcError}`)
    return clearCookies(NextResponse.redirect(settingsUrl))
  }

  if (!code || !returnedState || !cookieState || !cookieClubId || returnedState !== cookieState) {
    settingsUrl.searchParams.set("gc_error", "The GoCardless connection request could not be verified. Please try connecting again.")
    return clearCookies(NextResponse.redirect(settingsUrl))
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return clearCookies(NextResponse.redirect(new URL("/login", request.url)))
  }

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
    if (error) throw new Error(error.message)

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
    const message = error instanceof Error ? error.message : "Unknown error."
    settingsUrl.searchParams.set("gc_error", `Could not complete the GoCardless connection: ${message}`)
    return clearCookies(NextResponse.redirect(settingsUrl))
  }
}
