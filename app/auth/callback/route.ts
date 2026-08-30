import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

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
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const next = safeNextPath(searchParams.get("next"))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // No dedicated error page yet (Phase 1 has no auth UI) — surface the
  // failure via a query param on the home page instead.
  return NextResponse.redirect(`${origin}/?error=auth`)
}
