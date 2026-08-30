import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/supabase/env"
import type { Database } from "@/types/database.types"

/**
 * Server-side Supabase client for Server Components, Server Actions, and
 * Route Handlers. Create a new instance per request — never share/cache one.
 *
 * `setAll` can only actually write cookies from a Server Action or Route
 * Handler; calls made from a Server Component are a no-op by design (Next.js
 * disallows mutating cookies during rendering). Session refresh in that case
 * is handled by proxy.ts instead.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // Called from a Server Component — proxy.ts refreshes the session instead.
        }
      },
    },
  })
}
