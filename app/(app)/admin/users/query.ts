import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import type { AdminUserQuery, AdminUserRow, MembershipSummary, PendingRequestSummary } from "./types"

/**
 * SLICE 7e (AB.3). This used to build the search itself:
 *
 *   q.or(`first_name.ilike.%${escaped}%,surname.ilike.%${escaped}%,...`)
 *
 * -- a filter EXPRESSION assembled in application code out of a typed value and
 * handed to PostgREST as a string, with the escaping done here. It read a
 * security_invoker view so it was not a hole, but it meant the one screen that
 * can see every account on the platform answered "who can be searched, and by
 * what" in TypeScript. The brief named an RPC for it (AB.3) and Slice 7 never
 * wrote one; `public.site_search_users` is that RPC, and this is now a thin
 * call to it.
 *
 * The list page and the CSV export still share one path, for the same reason
 * they always did: "export exactly what's currently filtered" is only true if
 * both ask the same question.
 */

/** One page of results, plus the total the same query saw. */
export interface AdminUserPage {
  rows: AdminUserRow[]
  total: number
  error: boolean
}

type SearchRow = Database["public"]["Functions"]["site_search_users"]["Returns"][number]

export async function searchAdminUsers(
  supabase: SupabaseClient<Database>,
  query: AdminUserQuery,
  page: number,
  size: number
): Promise<AdminUserPage> {
  const { data, error } = await supabase.rpc("site_search_users", {
    p_query: query.q,
    p_access: query.access,
    p_status: query.status,
    p_sort: query.sort,
    p_limit: size,
    p_offset: (page - 1) * size,
  })

  if (error) {
    console.error("site_search_users failed:", error)
    return { rows: [], total: 0, error: true }
  }

  const rows = (data ?? []) as SearchRow[]
  return {
    rows: rows.map(mapSearchRow),
    // total_count is carried on every row and is identical across the page;
    // an empty page legitimately means zero.
    total: rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0,
    error: false,
  }
}

/**
 * The export wants everything the current filter matches, not one page. The RPC
 * caps a single call at 100 rows on purpose, so this walks the pages rather than
 * asking for an unbounded result set -- and stops at a declared ceiling instead
 * of looping for as long as the platform is large, returning `truncated` so the
 * caller can say so out loud rather than hand over a short file that looks
 * complete.
 */
const EXPORT_PAGE = 100
const EXPORT_CEILING = 10_000

export async function searchAllAdminUsers(
  supabase: SupabaseClient<Database>,
  query: AdminUserQuery
): Promise<{ rows: AdminUserRow[]; truncated: boolean; error: boolean }> {
  const rows: AdminUserRow[] = []
  for (let page = 1; rows.length < EXPORT_CEILING; page += 1) {
    const result = await searchAdminUsers(supabase, query, page, EXPORT_PAGE)
    if (result.error) return { rows, truncated: false, error: true }
    rows.push(...result.rows)
    if (result.rows.length < EXPORT_PAGE || rows.length >= result.total) {
      return { rows, truncated: false, error: false }
    }
  }
  return { rows, truncated: true, error: false }
}

/**
 * Same honesty-over-force-unwrap reasoning as admin/clubs/query.ts's
 * mapAdminClubRow: the generated Row type marks every column nullable even
 * though most are logically always populated.
 */
function mapSearchRow(row: SearchRow): AdminUserRow {
  return mapAdminUserRow({
    user_id: row.user_id,
    first_name: row.first_name,
    surname: row.surname,
    email: row.email,
    user_created_at: row.user_created_at,
    is_site_admin: row.is_site_admin,
    memberships: row.memberships,
    pending_requests: row.pending_requests,
    club_names: row.club_names,
    team_names: row.team_names,
    has_active_membership: row.has_active_membership,
    has_club_admin: row.has_club_admin,
    has_fixtures_admin: row.has_fixtures_admin,
    has_team_admin: row.has_team_admin,
    has_pending_request: row.has_pending_request,
    account_state: row.account_state,
    // The view carries two columns this RPC deliberately does not return:
    // `account_status` is the two-valued compatibility column account_state
    // replaced, and `highest_role` is a sort key nothing displays.
    account_status: null,
    highest_role: null,
  })
}

export function mapAdminUserRow(row: Database["public"]["Views"]["admin_user_overview"]["Row"]): AdminUserRow {
  return {
    userId: row.user_id ?? "",
    name: [row.first_name, row.surname].filter(Boolean).join(" ") || "(no name on file)",
    email: row.email ?? "",
    isSiteAdmin: row.is_site_admin ?? false,
    createdAt: row.user_created_at ?? new Date(0).toISOString(),
    clubNames: row.club_names,
    teamNames: row.team_names,
    hasActiveMembership: row.has_active_membership ?? false,
    hasClubAdmin: row.has_club_admin ?? false,
    hasFixturesAdmin: row.has_fixtures_admin ?? false,
    hasTeamAdmin: row.has_team_admin ?? false,
    hasPendingRequest: row.has_pending_request ?? false,
    // From the canonical account_state, not the compatibility account_status:
    // a disabled account reports "active" in the older column, and Users &
    // Access can now disable an account, so it has to be able to show one.
    accountStatus:
      row.account_state === "SUSPENDED" ? "suspended" : row.account_state === "DISABLED" ? "disabled" : "active",
    // Open requests to join are listed as pending requests; a membership card
    // is a membership that was granted, whether still active or now history.
    memberships: ((row.memberships as unknown as MembershipSummary[]) ?? []).filter((m) => m.status === "active" || m.status === "revoked"),
    pendingRequests: (row.pending_requests as unknown as PendingRequestSummary[]) ?? [],
  }
}
