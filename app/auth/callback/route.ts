import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { completeSignupIfNeeded } from "@/lib/signup/complete-signup"

// A same-origin relative path only — rejects absolute/protocol-relative
// URLs and userinfo tricks (e.g. "@evil.com") that could turn this into an
// open redirect.
function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("@")) {
    return "/"
  }
  return next
}

// Exchanges the `code` param from a Supabase Auth redirect (OAuth, magic
// link, etc.) for a session, then redirects into the app.
//
// After a successful exchange, completeSignupIfNeeded runs the one-time
// signup-completion insert sequence (profiles/club_claims/
// club_join_requests/directory_requests/terms_acceptances) if -- and only
// if -- this user doesn't have a profile yet and does have a pending
// signup payload in their user_metadata (see submit-signup.ts). Every
// other auth entry (an existing user's ordinary magic-link sign-in) finds
// completeSignupIfNeeded a no-op and just proceeds to `next` as before.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const next = safeNextPath(searchParams.get("next"))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        const result = await completeSignupIfNeeded(supabase, user)
        if (result.error) {
          // The user is authenticated (has a real, valid session) even
          // though completion failed -- never sign them out over this.
          // /welcome re-attempts completion on next load (still a no-op if
          // it already partially succeeded, since the profile-existence
          // check short-circuits), so this is recoverable rather than a
          // dead end.
          console.error("signup completion failed:", result.error)
        }
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Every failure here -- missing code, expired link, already-used link,
  // invalid/tampered token -- gets the same honest, actionable landing:
  // back on /login, which already has the one field that fixes all of
  // them (request a fresh link), rather than a bare, unexplained redirect
  // to the marketing homepage or a raw Supabase error string. GoTrue's
  // exact error code isn't surfaced -- "expired" vs "already used" vs
  // "invalid" all have the identical fix, so distinguishing them would add
  // detail without adding a different next step for the user to take.
  return NextResponse.redirect(`${origin}/login?error=link`)
}
