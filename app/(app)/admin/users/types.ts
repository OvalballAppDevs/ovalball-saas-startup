import { PAGE_SIZES, DEFAULT_PAGE_SIZE, type PageSize } from "../pagination-constants"

export { PAGE_SIZES, DEFAULT_PAGE_SIZE }
export type { PageSize }

export type SortKey = "name-asc" | "name-desc" | "newest" | "oldest" | "club"
export type AccessFilter = "all" | "site_admin" | "club_admin" | "fixtures_admin" | "team_admin" | "view_only" | "no_access"
export type StatusFilter = "all" | "active" | "pending" | "no_access" | "suspended"

export interface TeamRole {
  teamId: string
  teamName: string
  permission: string
}

export interface MembershipSummary {
  membershipId: string
  clubId: string
  directoryId: string
  clubName: string
  role: "BASIC_USER" | "CLUB_ADMIN" | "FIXTURE_SECRETARY"
  clubRoleTitle: string | null
  status: "active" | "revoked"
  teamRoles: TeamRole[]
}

export interface PendingRequestSummary {
  type: "claim" | "join_request"
  clubName: string
  role: string
  status: string
  createdAt: string
}

export interface AdminUserRow {
  userId: string
  name: string
  email: string
  isSiteAdmin: boolean
  createdAt: string
  clubNames: string | null
  teamNames: string | null
  hasActiveMembership: boolean
  hasClubAdmin: boolean
  hasFixturesAdmin: boolean
  hasTeamAdmin: boolean
  hasPendingRequest: boolean
  accountStatus: "active" | "suspended"
  memberships: MembershipSummary[]
  pendingRequests: PendingRequestSummary[]
}

export interface AdminUserQuery {
  q: string
  access: AccessFilter
  status: StatusFilter
  sort: SortKey
  page: number
  size: PageSize
}

export function parseAdminUserQuery(searchParams: Record<string, string | string[] | undefined>): AdminUserQuery {
  const get = (key: string) => {
    const v = searchParams[key]
    return Array.isArray(v) ? v[0] : v
  }
  const size = Number(get("size"))
  return {
    q: get("q")?.trim() ?? "",
    access: (get("access") as AccessFilter) ?? "all",
    status: (get("status") as StatusFilter) ?? "all",
    sort: (get("sort") as SortKey) ?? "name-asc",
    page: Math.max(1, Number(get("page")) || 1),
    size: PAGE_SIZES.includes(size as PageSize) ? (size as PageSize) : DEFAULT_PAGE_SIZE,
  }
}

/** Highest-precedence access label for a user, matching the brief's access-profile taxonomy. Presentation only, derived from existing role/permission data -- never a stored value. */
export function accessLabel(row: Pick<AdminUserRow, "isSiteAdmin" | "hasClubAdmin" | "hasFixturesAdmin" | "hasTeamAdmin" | "hasActiveMembership">): string {
  if (row.isSiteAdmin) return "Site Admin"
  if (row.hasClubAdmin) return "Club Admin"
  if (row.hasFixturesAdmin) return "Fixtures Admin"
  if (row.hasTeamAdmin) return "Team Admin"
  if (row.hasActiveMembership) return "View only"
  return "No club access"
}
