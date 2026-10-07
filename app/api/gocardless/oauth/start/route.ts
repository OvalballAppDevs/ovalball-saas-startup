import { randomBytes } from "node:crypto"

import { NextResponse, type NextRequest } from "next/server"

import { hasCapability } from "@/lib/permissions/has-capability"
import { buildGoCardlessAuthorizeUrl } from "@/lib/payments/gocardless/oauth"
import type { ConnectNoticeCode } from "@/lib/payments/gocardless/connect-notices"
import { requireSession, sessionRefusal } from "@/lib/auth/require-session"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const STATE_COOKIE = "gc_oauth_state"
const CLUB_COOKIE = "gc_oauth_club_id"
/** The page shows CONNECT_NOTICES.terms for "terms" -- the same sentence the app's start route returns. */

/**
 * Starts the server-side OAuth2 flow. A Club Admin never sees or handles
 * a token here -- this route validates their capability, mints a
 * CSRF-safe `state` value, stashes it (and the target club) in a
 * short-lived httpOnly cookie, and redirects straight to GoCardless.
 */
export async function GET(request: NextRequest) {
  const clubId = request.nextUrl.searchParams.get("clubId")
  if (!clubId) {
    return NextResponse.json({ error: "Missing clubId." }, { status: 400 })
  }

  const supabase = await createClient()
  // SLICE 6b.2a -- D.2 layer 2 on a ROUTE HANDLER. This is a GET endpoint anybody can navigate to
  // directly with a clubId in the query string, so "the layout checked" is not available to it and
  // never was. getUser() alone answered only "is somebody signed in"; a revoked session's access
  // token stays cryptographically valid until it expires, and a suspended administrator's session
  // row may still exist. Neither should be able to start a payment-provider connection.
  const decision = await requireSession({}, supabase)
  if (!decision.ok) {
    return NextResponse.redirect(new URL(sessionRefusal(decision.reason).href, request.url))
  }

  const authorized = await hasCapability(supabase, "finance.gocardless.connect", "club", { clubId })
  if (!authorized) {
    return NextResponse.json({ error: "You are not authorised to connect GoCardless for this club." }, { status: 403 })
  }

  // TERMS FIRST (20270748000000). A club agrees how Club Memberships work, and what Ovalball's fee is, before
  // any GoCardless account is attached to it -- the same rule the app's start enforces in the database
  // (start_gocardless_connect_intent). Asked as the caller, of the one read the settings page itself uses.
  const { data: setup, error: setupError } = await supabase.rpc("membership_setup_state", { p_club_id: clubId })
  const termsAccepted = (setup as { terms?: { accepted?: boolean } } | null)?.terms?.accepted === true
  if (setupError || !termsAccepted) {
    if (setupError) console.error("[gocardless oauth] membership_setup_state failed:", setupError.code)
    const refused = new URL("/club/settings/subscriptions", request.url)
    refused.searchParams.set("gc_error", (setupError ? "terms_check" : "terms") satisfies ConnectNoticeCode)
    return NextResponse.redirect(refused)
  }

  let authorizeUrl: string
  try {
    const state = randomBytes(24).toString("hex")
    const built = buildGoCardlessAuthorizeUrl({ state, clubId })
    authorizeUrl = built.url

    const response = NextResponse.redirect(authorizeUrl)
    response.cookies.set(STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/gocardless/oauth" })
    response.cookies.set(CLUB_COOKIE, clubId, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/gocardless/oauth" })
    return response
  } catch (error) {
    // The configuration's own error names environment variables; it is logged for whoever runs the site and never
    // put in a URL, where it would reach the address bar, history and any referrer.
    console.error("[gocardless oauth] start unavailable:", error instanceof Error ? error.message : error)
    const url = new URL("/club/settings/subscriptions", request.url)
    url.searchParams.set("gc_error", "unavailable" satisfies ConnectNoticeCode)
    return NextResponse.redirect(url)
  }
}
