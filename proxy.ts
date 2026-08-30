import type { NextRequest } from "next/server"

import { updateSession } from "@/lib/supabase/middleware"

// Next.js 16 renamed middleware.ts to proxy.ts — the exported function must
// be named `proxy`, not `middleware`, or it is silently ignored.
export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
