import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import type { AdminUserQuery, AdminUserRow, MembershipSummary, PendingRequestSummary } from "./types"

/**
 * Shared by the list page and the CSV export action, mirroring
 * admin/clubs/query.ts's own reasoning: "export exactly what's currently
 * filtered" only holds if both read the identical query. Queries
 * admin_user_overview (security_invoker), so this is exactly as
 * permissive as profiles/club_memberships' own RLS -- nothing here is a
 * second authorization mechanism.
 */
export function buildAdminUserQuery(supabase: SupabaseClient<Database>, query: AdminUserQuery) {
  let q = supabase.from("admin_user_overview").select("*", { count: "exact" })

  if (query.q.length >= 2) {
    const escaped = query.q.replace(/[%_]/g, (c) => `\\${c}`)
    q = q.or(
      `first_name.ilike.%${escaped}%,surname.ilike.%${escaped}%,email.ilike.%${escaped}%,club_names.ilike.%${escaped}%,team_names.ilike.%${escaped}%`
    )
  }

  switch (query.access) {
    case "site_admin":
      q = q.eq("is_site_admin", true)
      break
    case "club_admin":
      q = q.eq("has_club_admin", true)
      break
    case "fixtures_admin":
      q = q.eq("has_fixtures_admin", true)
      break
    case "team_admin":
      q = q.eq("has_team_admin", true)
      break
    case "view_only":
      q = q.eq("has_active_membership", true).eq("has_club_admin", false).eq("has_fixtures_admin", false).eq("has_team_admin", false)
      break
    case "no_access":
      q = q.eq("has_active_membership", false).eq("is_site_admin", false)
      break
  }

  switch (query.status) {
    case "active":
      q = q.eq("has_active_membership", true)
      break
    case "pending":
      q = q.eq("has_pending_request", true)
      break
    case "no_access":
      q = q.eq("has_active_membership", false).eq("has_pending_request", false).eq("is_site_admin", false)
      break
    case "suspended":
      q = q.eq("account_status", "suspended")
      break
  }

  switch (query.sort) {
    case "name-desc":
      q = q.order("first_name", { ascending: false }).order("surname", { ascending: false })
      break
    case "newest":
      q = q.order("user_created_at", { ascending: false })
      break
    case "oldest":
      q = q.order("user_created_at", { ascending: true })
      break
    case "club":
      q = q.order("club_names", { ascending: true, nullsFirst: false })
      break
    case "name-asc":
    default:
      q = q.order("first_name", { ascending: true }).order("surname", { ascending: true })
      break
  }

  return q
}

/**
 * Same honesty-over-force-unwrap reasoning as admin/clubs/query.ts's
 * mapAdminClubRow: a view's generated Row type marks every column
 * nullable even though most are logically always populated.
 */
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
    accountStatus: (row.account_status as "active" | "suspended") ?? "active",
    memberships: (row.memberships as unknown as MembershipSummary[]) ?? [],
    pendingRequests: (row.pending_requests as unknown as PendingRequestSummary[]) ?? [],
  }
}
