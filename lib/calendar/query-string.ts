/**
 * Shared calendar querystring builder. Used by both the server-rendered
 * page.tsx (for its own view/season/nav links) and the client-side
 * TeamFilterBar (which needs to build the same `/calendar?...` hrefs from
 * serializable baseParams -- a plain function closure can't cross the
 * Server->Client Component boundary, so this module, not a passed-down
 * function, is the shared contract).
 */
export function qs(params: Record<string, string | null | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v)
  return entries.length > 0 ? `?${entries.map(([k, v]) => `${k}=${v}`).join("&")}` : ""
}
