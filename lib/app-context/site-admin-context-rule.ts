import type { ActiveContextKind } from "./active-context"

/**
 * The Site Admin route-family guard's pure decision rule -- deliberately
 * its own tiny, dependency-free module (no "server-only", no cookies(),
 * no Supabase client) so it has permanent, standalone-runnable regression
 * coverage (site-admin-context-rule.verify.ts) independent of the
 * DB/cookie-dependent wrapper that calls it (require-active-site-admin.ts).
 *
 * An account can genuinely hold real Site Admin authority
 * (ctx.isSiteAdmin) while its ACTIVE operating context is something else
 * entirely -- Club Admin, Team Admin, Coach, Parent, Player. This is the
 * one rule every /admin/* page and every Site-Admin-only server action
 * applies: BOTH the account holds the authority AND the account has
 * actively switched INTO that context.
 */
export function isActiveSiteAdminContext(ctx: { isSiteAdmin: boolean }, activeContext: { kind: ActiveContextKind }): boolean {
  return ctx.isSiteAdmin && activeContext.kind === "site_admin"
}
