import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/supabase/env"
import type { Database } from "@/types/database.types"

/**
 * Refreshes the Supabase auth session on every matched request and writes
 * any updated cookies back onto the response. Called from proxy.ts (the
 * Next.js 16 replacement for middleware.ts) — this is the only place session
 * refresh happens, since Server Components cannot write cookies themselves.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

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
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser() forces revalidation against the auth server (unlike getSession(),
  // which only reads the local cookie), which is what actually triggers a refresh.
  await supabase.auth.getUser()

  return response
}
