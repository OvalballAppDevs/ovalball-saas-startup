import "server-only"

import { cookies } from "next/headers"
import type { SupabaseClient, User } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import { ACTIVE_CONTEXT_COOKIE, resolveActiveContext } from "./active-context"
import { getSessionContext, type SessionContext } from "./session-context"
import { isActiveSiteAdminContext } from "./site-admin-context-rule"

export { isActiveSiteAdminContext }

/**
 * The Site Admin route-family guard (Master Architecture Pass addendum,
 * "Site Admin authority leaks into Club Admin context"). An account can
 * genuinely hold real Site Admin authority (ctx.isSiteAdmin) while its
 * ACTIVE operating context is something else entirely -- Club Admin, Team
 * Admin, Coach, Parent, Player. "Active context is a lens, not authority"
 * (security-safeguarding-standard.md) has applied to club/team scoping
 * throughout this codebase since the Master Architecture Pass, but was
 * never extended to the Site Admin boundary itself: every /admin/* page
 * and every Site-Admin-only server action checked only ctx.isSiteAdmin
 * (account-held authority), never whether the account had actually
 * switched INTO that context. This is the one place both halves are
 * checked together.
 *
 * Note on what this can and cannot enforce: RLS's internal.is_site_admin()
 * has no way to see "active context" at all -- it is a Next.js cookie,
 * never written to the database or the JWT, so this specific rule cannot
 * be expressed as a database-level invariant the way cross-club/cross-team
 * scoping can be. This function is therefore the actual enforcement
 * boundary for this rule -- called from every /admin/* page's own guard
 * AND from requireSiteAdmin() (used by the majority of Site-Admin-only
 * server actions) AND, directly, by the handful of admin actions that
 * relied on RLS alone before this pass (RLS remains correct for "does
 * this account really hold Site Admin authority at all", just not for
 * this newer, session-cookie-scoped rule on top of it).
 *
 * A tampered client cookie claiming `site_admin:...` cannot escalate
 * privilege -- resolveActiveContext() only ever returns a context the
 * session's own real ctx.isSiteAdmin/clubMemberships/teamPermissions
 * already contains, silently falling back otherwise (see active-context.ts).
 * This function can only ever narrow when real Site Admin authority is
 * exercisable, never widen it.
 */
export async function requireActiveSiteAdmin(
  supabase: SupabaseClient<Database>,
  user: User
): Promise<{ ok: true; ctx: SessionContext } | { ok: false }> {
  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  if (!isActiveSiteAdminContext(ctx, activeContext)) return { ok: false }

  return { ok: true, ctx }
}
