import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import type { AdminClubQuery, AdminClubRow } from "./types"

/**
 * Shared by the list page and the CSV export action so the two can never
 * drift -- "export exactly what's currently filtered" (the brief's own
 * requirement) only holds if both read paths build the identical query.
 * Queries admin_club_overview (20260831200000), a security_invoker view,
 * so this is exactly as permissive as club_directory/clubs' own RLS --
 * nothing here is a second authorization mechanism.
 */
export function buildAdminClubQuery(
  supabase: SupabaseClient<Database>,
  query: AdminClubQuery
) {
  let q = supabase.from("admin_club_overview").select("*", { count: "exact" })

  if (query.q.length >= 2) {
    const escaped = query.q.replace(/[%_]/g, (c) => `\\${c}`)
    q = q.or(
      `name.ilike.%${escaped}%,town.ilike.%${escaped}%,county.ilike.%${escaped}%,postcode.ilike.%${escaped}%`
    )
  }
  if (query.code !== "all") {
    q = q.eq("rugby_code", query.code)
  }
  if (query.claimed === "claimed") {
    q = q.eq("is_activated", true)
  } else if (query.claimed === "unclaimed") {
    q = q.eq("is_activated", false)
  }
  if (query.active === "active") {
    q = q.eq("directory_active", true)
  } else if (query.active === "inactive") {
    q = q.eq("directory_active", false)
  }
  if (query.county.length > 0) {
    q = q.ilike("county", query.county)
  }
  if (query.verified === "verified") {
    q = q.eq("flag_unverified", false)
  } else if (query.verified === "unverified") {
    q = q.eq("flag_unverified", true)
  }
  if (query.logo === "has") {
    q = q.eq("flag_missing_logo", false)
  } else if (query.logo === "missing") {
    q = q.eq("flag_missing_logo", true)
  }
  if (query.profile === "has") {
    q = q.eq("flag_no_public_profile", false)
  } else if (query.profile === "missing") {
    q = q.eq("flag_no_public_profile", true)
  }
  if (query.duplicate === "only") {
    q = q.or("flag_duplicate_normalized_key.eq.true,flag_duplicate_external_id.eq.true")
  }
  if (query.pendingClaim === "only") {
    q = q.eq("flag_pending_claim", true)
  }
  if (query.missingPostcode === "only") {
    q = q.eq("flag_missing_postcode", true)
  }
  if (query.missingWebsite === "only") {
    q = q.eq("flag_missing_website", true)
  }

  switch (query.sort) {
    case "name-desc":
      q = q.order("name", { ascending: false })
      break
    case "updated-desc":
      q = q.order("directory_updated_at", { ascending: false })
      break
    case "created-desc":
      q = q.order("directory_created_at", { ascending: false })
      break
    case "town-asc":
      q = q.order("town", { ascending: true, nullsFirst: false })
      break
    case "county-asc":
      q = q.order("county", { ascending: true, nullsFirst: false })
      break
    case "name-asc":
    default:
      q = q.order("name", { ascending: true })
      break
  }

  return q
}

/**
 * The view's generated Row type marks every column nullable (Postgres
 * views don't carry NOT NULL through from their base tables), even for
 * columns like directory_id/name/rugby_code that are logically always
 * populated -- they come straight from club_directory's own NOT NULL
 * columns. Coalescing here (rather than a blanket non-null assertion) is
 * the honest version of that same guarantee: if one of these is ever
 * actually null, the fallback is visibly wrong in the UI instead of a
 * silent runtime crash.
 */
export function mapAdminClubRow(row: Database["public"]["Views"]["admin_club_overview"]["Row"]): AdminClubRow {
  return {
    directoryId: row.directory_id ?? "",
    name: row.name ?? "(unnamed)",
    rugbyCode: row.rugby_code ?? "union",
    county: row.county,
    town: row.town,
    postcode: row.postcode,
    verificationStatus: row.verification_status ?? "",
    directoryActive: row.directory_active ?? false,
    logoStoragePath: row.logo_storage_path ?? row.directory_logo_storage_path,
    slug: row.slug,
    clubStatus: row.club_status,
    isActivated: row.is_activated ?? false,
    clubAdminCount: row.club_admin_count ?? 0,
    activatedAt: row.activated_at,
    directoryUpdatedAt: row.directory_updated_at ?? new Date(0).toISOString(),
    flags: {
      missingPostcode: row.flag_missing_postcode ?? false,
      missingTown: row.flag_missing_town ?? false,
      missingRugbyCode: row.flag_missing_rugby_code ?? false,
      duplicateNormalizedKey: row.flag_duplicate_normalized_key ?? false,
      duplicateExternalId: row.flag_duplicate_external_id ?? false,
      unverified: row.flag_unverified ?? false,
      inactive: row.flag_inactive ?? false,
      missingWebsite: row.flag_missing_website ?? false,
      missingLogo: row.flag_missing_logo ?? false,
      noPublicProfile: row.flag_no_public_profile ?? false,
      pendingClaim: row.flag_pending_claim ?? false,
    },
  }
}
