import type { NextRequest } from "next/server"

import { updateSession } from "@/lib/supabase/middleware"

// Next.js 16 renamed middleware.ts to proxy.ts — the exported function must
// be named `proxy`, not `middleware`, or it is silently ignored.
export async function proxy(request: NextRequest) {
  const response = await updateSession(request)

  // The authenticated layout needs the current path to decide whether a club
  // still in first-run setup should be gated, and Server Components cannot
  // read it. Setting it here keeps the allowlist (/club/setup, /account,
  // /support) in one place and makes a redirect loop impossible: the layout
  // never redirects to a path it is also gating.
  response.headers.set("x-ovalball-pathname", request.nextUrl.pathname)
  return response
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
