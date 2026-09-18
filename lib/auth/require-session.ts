import "server-only"

import type { SupabaseClient, User } from "@supabase/supabase-js"

import {
  decideSession,
  sessionRefusal,
  type RequireSessionOptions,
  type SessionAssurance,
  type SessionRefusalReason,
} from "@/lib/auth/session-decision"
import { createClient } from "@/lib/supabase/server"
import type { Database } from "@/types/database.types"

/**
 * THE SERVER SIDE OF THE SESSION GATE.
 *
 * The database already refuses: `internal.session_ok()` is folded into `internal.can()`, into
 * `has_site_capability()`, and into a RESTRICTIVE policy on every non-public table. This function does
 * not replace any of that and must never be mistaken for it. It exists so a page or a Server Action can
 * refuse EARLY and say something useful, instead of letting a person fill in a form and then meeting a
 * bare database error.
 *
 * So: this is UX and defence in depth, never the boundary. If this file were deleted the product would
 * become rude, not insecure.
 *
 * It reads the VERIFIED user (`getUser`, which re-validates with the auth server) rather than the
 * session the browser hands over, and it reads the assurance from the same place the database does.
 */

export type SessionDecision =
  | { ok: true; userId: string; user: User; aal: "aal1" | "aal2"; group: string }
  | { ok: false; reason: SessionRefusalReason }

/**
 * `client` lets a caller that already has a request-scoped Supabase client hand it over. This is not
 * a micro-optimisation: `createClient()` is deliberately one instance per request and `getUser()`
 * re-validates against the auth server, so a boundary that made its own client would add a second
 * network round trip to every page load for an answer the caller already has. The decision carries
 * the verified `user` back for the same reason -- so nothing downstream calls `getUser()` again.
 */
export async function requireSession(
  options: RequireSessionOptions = {},
  client?: SupabaseClient<Database>,
): Promise<SessionDecision> {
  const supabase = client ?? (await createClient())

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: "SIGN_IN_REQUIRED" }

  // The database is the authority on all three of these, and is asked rather than re-implemented here.
  // Re-deriving "is this account usable" in TypeScript would be a second answer to a question that
  // already has one, and the two would drift.
  const { data, error } = await supabase.rpc("my_session_assurance")
  if (error || !data) return { ok: false, reason: "ACCOUNT_UNAVAILABLE" }

  const decided = decideSession(data as SessionAssurance, options)
  if (!decided.ok) return decided
  return { ok: true, userId: user.id, user, aal: decided.aal, group: decided.group }
}

// Re-exported so every existing caller keeps one import, and so the rule and the plumbing stay
// reachable from the same place even though they now live in different files.
export { decideSession, sessionRefusal }
export type { RequireSessionOptions, SessionAssurance, SessionRefusalReason }
