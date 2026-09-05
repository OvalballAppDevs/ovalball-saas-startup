import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import { AUTH_SESSION_VERSION } from "@/lib/auth/session-version"
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/supabase/env"
import { applyRememberPreference, parseRememberCookie, REMEMBER_COOKIE_NAME } from "@/lib/supabase/remember"
import type { Database } from "@/types/database.types"

/**
 * Refreshes the Supabase auth session on every matched request and writes
 * any updated cookies back onto the response. Called from proxy.ts (the
 * Next.js 16 replacement for middleware.ts) — this is the only place session
 * refresh happens, since Server Components cannot write cookies themselves.
 *
 * Also the one place that enforces AUTH_SESSION_VERSION: after getUser()
 * confirms a real session, a lower recorded version forces a fresh
 * sign-in (see lib/auth/session-version.ts for why this is separate from
 * the application release version and never fires on an ordinary deploy).
 *
 * And the one place that enforces account suspension against an already-
 * active session: profiles.account_status is checked on every request, not
 * just at sign-in, so a Site Admin suspending someone takes effect on that
 * person's very next request -- no read-only grace period, no waiting for
 * the session to naturally expire. Deliberately a per-user check here
 * rather than a global AUTH_SESSION_VERSION bump, which would force
 * everyone to re-authenticate over one person's suspension.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })
  const remember = parseRememberCookie(request.cookies.get(REMEMBER_COOKIE_NAME)?.value)

  const supabase = createServerClient<Database>(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, applyRememberPreference(options, remember))
          )
        },
      },
    }
  )

  // getUser() forces revalidation against the auth server (unlike getSession(),
  // which only reads the local cookie), which is what actually triggers a refresh.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    const { data: profileRow } = await supabase
      .from("profiles")
      .select("account_status")
      .eq("id", user.id)
      .maybeSingle()

    // No profile row yet (mid-signup, or a site-admin-only account with no
    // club) is not itself a suspension -- mirrors internal.is_account_active()'s
    // own coalesce-to-true semantics, so this stays consistent with what
    // every RLS write path already treats as "not suspended."
    if (profileRow?.account_status === "suspended") {
      await supabase.auth.signOut()
      const url = request.nextUrl.clone()
      url.pathname = "/login"
      url.search = "?reason=suspended"
      const redirectResponse = NextResponse.redirect(url)
      response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie))
      return redirectResponse
    }

    const { data: versionRow } = await supabase
      .from("user_session_versions")
      .select("version")
      .eq("user_id", user.id)
      .maybeSingle()

    if (versionRow && versionRow.version < AUTH_SESSION_VERSION) {
      await supabase.auth.signOut()
      const url = request.nextUrl.clone()
      url.pathname = "/login"
      url.search = "?reason=updated"
      const redirectResponse = NextResponse.redirect(url)
      // signOut()'s own setAll call above already reassigned `response` to
      // carry the cookie-clearing instructions -- a bare
      // NextResponse.redirect() here would otherwise ship with no Set-Cookie
      // headers at all, leaving the old (now server-revoked but
      // browser-side still present) auth cookies sitting in the browser.
      response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie))
      return redirectResponse
    }

    if (!versionRow) {
      // Existing session from before this mechanism shipped -- treated as
      // compatible (an ordinary deploy must never force a re-login), and
      // opportunistically backfilled so future requests have something to
      // compare against.
      await supabase.rpc("record_session_version", { p_version: AUTH_SESSION_VERSION })
    }
  }

  // /support is one canonical URL for both audiences: a logged-out visitor
  // gets the public anonymous ticket form, an authenticated one gets the
  // real Support Centre (app/(app)/support) -- two separate page.tsx files
  // at two separate paths (Next.js won't allow two pages resolving to the
  // same URL), joined here by a transparent rewrite so the address bar
  // never changes and there is only one link to remember anywhere in the
  // product.
  if (!user && request.nextUrl.pathname === "/support") {
    const url = request.nextUrl.clone()
    url.pathname = "/public-support"
    const rewriteResponse = NextResponse.rewrite(url)
    response.cookies.getAll().forEach((cookie) => rewriteResponse.cookies.set(cookie))
    return rewriteResponse
  }

  return response
}
