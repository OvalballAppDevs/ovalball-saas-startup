import { createClient as createSupabaseClient } from "@supabase/supabase-js"

import { getSupabaseUrl } from "@/lib/supabase/env"
import type { Database } from "@/types/database.types"

/**
 * Elevated, RLS-bypassing client for the small set of server-only
 * integration points that genuinely need it (Side Project 1 integration):
 * the GoCardless OAuth callback route (storing a merchant access token
 * nothing else may ever read back) and the GoCardless webhook route
 * handler (writing provider event/payment/mandate state that no
 * authenticated user session produced). Never import this from a Server
 * Action reachable by an ordinary authenticated request, a Server
 * Component, or anything a client bundle could ever pull in -- it has no
 * session, no capability check of its own, and bypasses every RLS policy
 * in this project.
 *
 * Every call site using this client is individually responsible for its
 * own authorization (e.g. "this webhook's signature verified" or "this
 * OAuth callback's CSRF state matched") -- this client grants access, it
 * does not decide who gets it.
 */
export function createServiceRoleClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error("Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY. Required for GoCardless OAuth/webhook server routes -- see .env.example.")
  }
  return createSupabaseClient<Database>(getSupabaseUrl(), key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
