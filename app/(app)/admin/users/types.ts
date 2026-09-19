import { PAGE_SIZES, DEFAULT_PAGE_SIZE, type PageSize } from "../pagination-constants"

export { PAGE_SIZES, DEFAULT_PAGE_SIZE }
export type { PageSize }

export type SortKey = "name-asc" | "name-desc" | "newest" | "oldest" | "club"
/**
 * The runtime list is the source and the type is derived from it, rather than the
 * two being written out separately and kept in step by hand. `site_search_users`
 * refuses a filter value it does not recognise, so the list that validates a URL
 * parameter and the list the type permits have to be the same list -- and the
 * authority guard is right that a second copy of these strings in this file is a
 * copy waiting to disagree with the first.
 */
export const ACCESS_FILTERS = ["all", "site_admin", "club_admin", "fixtures_admin", "team_admin", "view_only", "no_access"] as const
export type AccessFilter = (typeof ACCESS_FILTERS)[number]

export const STATUS_FILTERS = ["all", "active", "pending", "no_access", "suspended"] as const
export type StatusFilter = (typeof STATUS_FILTERS)[number]

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
  /**
   * The canonical account state. `account_status` is the two-valued compatibility
   * column that predates it and cannot say "disabled"; this derives from
   * profiles.account_state, which Slice 7 made settable from Users & Access.
   */
  accountStatus: "active" | "suspended" | "disabled"
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

export const SORT_KEYS: readonly SortKey[] = ["name-asc", "name-desc", "newest", "oldest", "club"]

/**
 * SLICE 7e. These three used to be a bare cast of whatever was in the URL --
 * `(get("access") as AccessFilter) ?? "all"` -- which typechecked and then let
 * an unrecognised value fall through every `switch` arm, silently applying no
 * filter at all. A person who mistyped a bookmarked URL got the whole platform
 * back and no indication that their filter had been ignored. `site_search_users`
 * now REFUSES a value it does not recognise, so the mapping has to be a real
 * one: anything unknown becomes the documented default rather than a cast.
 */
function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

export function parseAdminUserQuery(searchParams: Record<string, string | string[] | undefined>): AdminUserQuery {
  const get = (key: string) => {
    const v = searchParams[key]
    return Array.isArray(v) ? v[0] : v
  }
  const size = Number(get("size"))
  return {
    q: get("q")?.trim() ?? "",
    access: oneOf(get("access"), ACCESS_FILTERS, "all"),
    status: oneOf(get("status"), STATUS_FILTERS, "all"),
    sort: oneOf(get("sort"), SORT_KEYS, "name-asc"),
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
