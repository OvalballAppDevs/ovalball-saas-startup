import type { SessionContext } from "@/lib/app-context/session-context"

export type SupportAccessLevel = "manage" | "view" | "none"

/**
 * Mirrors internal.site_admin_support_level(uuid) in
 * 20260901120000_support_tickets.sql exactly -- kept here only for
 * presentation (an accurate "you don't have Support access" message, and
 * hiding manage-only controls). RLS and the RPCs enforce the real
 * boundary regardless of what this returns.
 */
export function supportAccessLevel(ctx: SessionContext): SupportAccessLevel {
  if (ctx.siteAdminRole === "full" || ctx.siteAdminRole === "user_access") return "manage"
  if (ctx.siteAdminRole === "read_only") return "view"
  return "none"
}
