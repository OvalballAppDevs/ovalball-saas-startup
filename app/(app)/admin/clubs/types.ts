export type SortKey = "name-asc" | "name-desc" | "updated-desc" | "created-desc" | "town-asc" | "county-asc"
export type ClaimedFilter = "all" | "claimed" | "unclaimed"
export type ActiveFilter = "all" | "active" | "inactive"
export type RugbyCodeFilter = "all" | "union" | "league"
export type VerifiedFilter = "all" | "verified" | "unverified"
export type LogoFilter = "all" | "has" | "missing"
export type ProfileFilter = "all" | "has" | "missing"
export type YesNoFilter = "all" | "only"

export const PAGE_SIZES = [25, 50, 100] as const
export type PageSize = (typeof PAGE_SIZES)[number]
export const DEFAULT_PAGE_SIZE: PageSize = 25

export interface AdminClubRow {
  directoryId: string
  name: string
  rugbyCode: string
  county: string | null
  town: string | null
  postcode: string | null
  verificationStatus: string
  directoryActive: boolean
  logoStoragePath: string | null
  slug: string | null
  clubStatus: string | null
  isActivated: boolean
  clubAdminCount: number
  activatedAt: string | null
  directoryUpdatedAt: string
  flags: {
    missingPostcode: boolean
    missingTown: boolean
    missingRugbyCode: boolean
    duplicateNormalizedKey: boolean
    duplicateExternalId: boolean
    unverified: boolean
    inactive: boolean
    missingWebsite: boolean
    missingLogo: boolean
    noPublicProfile: boolean
    pendingClaim: boolean
  }
}

export interface AdminClubQuery {
  q: string
  code: RugbyCodeFilter
  claimed: ClaimedFilter
  active: ActiveFilter
  county: string
  verified: VerifiedFilter
  logo: LogoFilter
  profile: ProfileFilter
  duplicate: YesNoFilter
  pendingClaim: YesNoFilter
  missingPostcode: YesNoFilter
  missingWebsite: YesNoFilter
  sort: SortKey
  page: number
  size: PageSize
}

const YES_NO: YesNoFilter[] = ["all", "only"]

export function parseAdminClubQuery(searchParams: Record<string, string | string[] | undefined>): AdminClubQuery {
  const get = (key: string) => {
    const v = searchParams[key]
    return Array.isArray(v) ? v[0] : v
  }
  const yesNo = (key: string): YesNoFilter => {
    const v = get(key)
    return YES_NO.includes(v as YesNoFilter) ? (v as YesNoFilter) : "all"
  }
  const size = Number(get("size"))
  return {
    q: get("q")?.trim() ?? "",
    code: (get("code") as RugbyCodeFilter) ?? "all",
    claimed: (get("claimed") as ClaimedFilter) ?? "all",
    active: (get("active") as ActiveFilter) ?? "all",
    county: get("county")?.trim() ?? "",
    verified: (get("verified") as VerifiedFilter) ?? "all",
    logo: (get("logo") as LogoFilter) ?? "all",
    profile: (get("profile") as ProfileFilter) ?? "all",
    duplicate: yesNo("duplicate"),
    pendingClaim: yesNo("pendingClaim"),
    missingPostcode: yesNo("missingPostcode"),
    missingWebsite: yesNo("missingWebsite"),
    sort: (get("sort") as SortKey) ?? "name-asc",
    page: Math.max(1, Number(get("page")) || 1),
    size: PAGE_SIZES.includes(size as PageSize) ? (size as PageSize) : DEFAULT_PAGE_SIZE,
  }
}

/** True if any filter beyond search/sort/page is set to a non-default value -- used to label the CSV export button and to show/hide the "Clear filters" action. */
export function hasActiveFilters(query: AdminClubQuery): boolean {
  return (
    query.q.length > 0 ||
    query.code !== "all" ||
    query.claimed !== "all" ||
    query.active !== "all" ||
    query.county.length > 0 ||
    query.verified !== "all" ||
    query.logo !== "all" ||
    query.profile !== "all" ||
    query.duplicate !== "all" ||
    query.pendingClaim !== "all" ||
    query.missingPostcode !== "all" ||
    query.missingWebsite !== "all"
  )
}
