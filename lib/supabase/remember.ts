import "server-only"

import type { cookies as nextCookies } from "next/headers"

import { REMEMBER_COOKIE_NAME, parseRememberCookie } from "./remember-constants"

export { REMEMBER_COOKIE_NAME, parseRememberCookie }

const DEFAULT_MAX_AGE_SECONDS = 400 * 24 * 60 * 60 // matches @supabase/ssr's own DEFAULT_COOKIE_OPTIONS.maxAge

/**
 * Why a cookie override is necessary at all: @supabase/ssr's own
 * `cookieOptions.maxAge` passed to createServerClient is NOT respected
 * for cookies it writes -- applyServerStorage() (inside @supabase/ssr's
 * cookies.js) unconditionally rebuilds every SET cookie's options as
 * `{ ...DEFAULT_COOKIE_OPTIONS, ...cookieOptions, maxAge: DEFAULT_COOKIE_OPTIONS.maxAge }`,
 * with that trailing `maxAge` overwriting whatever cookieOptions.maxAge
 * we passed in. Verified by reading the installed 0.12.5 source directly
 * -- this is not documented anywhere. The one place we DO have full
 * control is our own `setAll` callback (createServerClient/
 * createBrowserClient always defer the actual cookie write to it), so
 * every setAll in this app rewrites `options.maxAge` itself, here, after
 * the library hands it the (already-wrong) options object.
 */

/**
 * Applied inside every Supabase cookie setAll callback in this app.
 * Leaves deletions (maxAge === 0, how sign-out clears cookies) untouched;
 * for a real SET, drops `maxAge` entirely when the user chose not to be
 * remembered, so the browser treats it as an ordinary session cookie
 * (cleared when the browser closes) instead of @supabase/ssr's hardcoded
 * 400-day default.
 */
export function applyRememberPreference<T extends { maxAge?: number }>(options: T, remember: boolean): T {
  if (options.maxAge === 0) return options
  if (remember) return options
  const { maxAge: _drop, ...rest } = options
  return rest as T
}

/**
 * Toggling "Keep me signed in" in Profile must affect the CURRENT
 * session immediately, not just future sign-ins -- so this re-sets every
 * already-present Supabase auth cookie (name prefix "sb-", Supabase's own
 * convention) with the new maxAge policy. The browser only ever sends
 * back `name=value` on requests, never the original Set-Cookie
 * attributes, so this reconstructs them from the same
 * path/sameSite/httpOnly this app's clients already use everywhere
 * (matching @supabase/ssr's own DEFAULT_COOKIE_OPTIONS) -- only maxAge
 * actually changes.
 */
export async function reissueAuthCookiesWithRememberPreference(
  cookieStore: Awaited<ReturnType<typeof nextCookies>>,
  remember: boolean
) {
  const authCookies = cookieStore.getAll().filter((c) => c.name.startsWith("sb-"))
  for (const { name, value } of authCookies) {
    cookieStore.set(name, value, {
      path: "/",
      sameSite: "lax",
      httpOnly: false,
      ...(remember ? { maxAge: DEFAULT_MAX_AGE_SECONDS } : {}),
    })
  }
}
