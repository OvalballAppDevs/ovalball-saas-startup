import "server-only"

import type { SupabaseClient, User } from "@supabase/supabase-js"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import type { SiteAdminRole } from "@/lib/app-context/session-context"
import type { Database } from "@/types/database.types"

import { profileLabel as PROFILE_LABEL_FN } from "./site-admins/profiles"

/**
 * Explicit server-side authorization check inside every Club/User/
 * Permission/Fixture/Site Admin Management server action, not just the
 * page-level redirect and not just relying on RLS alone -- RLS is still
 * the actual boundary for is_site_admin() (a non-admin's write would fail
 * regardless), but for actions doing more than a single table write a
 * clear up-front rejection avoids partial work and gives a real error
 * instead of a confusing downstream RLS failure.
 *
 * Site Admin route-family guard (addendum): also requires the account's
 * ACTIVE context to be Site Admin, not merely that it holds Site Admin
 * authority somewhere -- see requireActiveSiteAdmin()'s own doc comment
 * for the full reasoning. Every one of this function's ~10 existing call
 * sites gets this fix automatically, with no change needed at the call
 * site itself.
 *
 * `allowedProfiles` narrows which Site Admin profile(s) may proceed --
 * 'full' always passes regardless of what's listed (Full Site Admin can
 * reach every section), and every write path implicitly excludes
 * 'read_only' unless it's explicitly listed too (it never is, by
 * construction of every call site in this codebase). Omitting
 * `allowedProfiles` keeps the original, simpler "any active Site Admin"
 * behavior -- used by sections that predate profile scoping and by reads
 * every profile should see.
 */
export async function requireSiteAdmin(
  supabase: SupabaseClient<Database>,
  allowedProfiles?: SiteAdminRole[]
): Promise<{ ok: true; user: User; role: SiteAdminRole } | { ok: false; error: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You must be signed in." }

  const result = await requireActiveSiteAdmin(supabase, user)
  if (!result.ok) {
    return { ok: false, error: "Site Admin access is required for this action, in an active Site Admin context." }
  }
  const { ctx } = result
  if (!ctx.siteAdminRole) {
    return { ok: false, error: "Site Admin access is required for this action, in an active Site Admin context." }
  }

  if (allowedProfiles && ctx.siteAdminRole !== "full" && !allowedProfiles.includes(ctx.siteAdminRole)) {
    const allowedLabels = ["Full Site Admin", ...allowedProfiles.map((p) => PROFILE_LABEL_FN(p))]
    return { ok: false, error: `This action requires one of: ${[...new Set(allowedLabels)].join(", ")}.` }
  }

  return { ok: true, user, role: ctx.siteAdminRole }
}
