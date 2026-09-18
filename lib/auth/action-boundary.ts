import "server-only"

import type { SupabaseClient, User } from "@supabase/supabase-js"

import { requireSession, sessionRefusal, type RequireSessionOptions } from "@/lib/auth/require-session"
import type { Database } from "@/types/database.types"

/**
 * THE SERVER ACTION BOUNDARY (Phase 2 D.2, enforcement layer 2).
 *
 * Phase 2 says `requireSession` is "used by the `(app)` layout, every Server Action and every route
 * handler". The layout is one call. Server Actions are the interesting case, because **a Server Action
 * is a POST endpoint**: it can be invoked directly, with no layout having rendered, by anybody who
 * knows its id. Relying on the layout having run first is relying on the attacker taking the scenic
 * route.
 *
 * Before this, the protected auth actions began with `getUser()` and `if (!user) return "Sign in to
 * continue."`. That answers ONE of the four questions this boundary must answer:
 *
 *   identity        -- getUser(), verified against the auth server, not the cookie
 *   session liveness-- is the session row still there, or was it revoked
 *   account state   -- is this account usable, or suspended/disabled
 *   assurance       -- is the second factor where this operation needs it
 *
 * WHAT THIS DELIBERATELY DOES NOT DO is capability. Capability is the database's answer, resolved by
 * `internal.can()` and `has_site_capability()` against live grants. Re-deciding it here would create a
 * second authority that drifts from the first, and Phase 2 is explicit that the database is the one
 * that counts. This boundary refuses EARLY and says something useful; the database refuses FINALLY.
 * Deleting this file would make Ovalball rude, not insecure -- and that is the design.
 */
export type ActionGate =
  | { ok: true; userId: string; user: User }
  | { ok: false; error: string; href: string }

export async function guardAction(
  options: RequireSessionOptions = {},
  client?: SupabaseClient<Database>,
): Promise<ActionGate> {
  const decision = await requireSession(options, client)
  if (decision.ok) return { ok: true, userId: decision.userId, user: decision.user }
  const { message, href } = sessionRefusal(decision.reason)
  return { ok: false, error: message, href }
}
