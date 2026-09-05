"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { toPublicSubmissionError } from "@/lib/errors/public-error"

import { requireSiteAdmin } from "../require-site-admin"
import { buildAdminClubQuery } from "./query"
import type { AdminClubQuery } from "./types"

export type ActionResult = { ok: true } | { ok: false; error: string }

/** Mirrors scripts/ingestion/extract_club_directory.py's normalize_key exactly (lowercase, strip punctuation, collapse whitespace) -- a light-touch lookup key only, kept consistent with how the imported dataset's own dedup key is computed. */
function normalizeClubName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

export interface DuplicateCandidate {
  directoryId: string
  name: string
  town: string | null
  county: string | null
  postcode: string | null
  rugbyCode: string
  isActivated: boolean
}

/**
 * Step 1 of Add Club -- run before creation, never automatically. Matches
 * on normalized name OR postcode, scoped to the same rugby code (a Union
 * and League club sharing a name/ground are legitimately distinct
 * entities, not a duplicate). Never merges anything; the caller decides
 * whether to open an existing candidate or create anyway.
 */
export async function searchPossibleDuplicates(
  name: string,
  postcode: string,
  rugbyCode: "union" | "league"
): Promise<DuplicateCandidate[]> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase)
  if (!auth.ok) return []

  const normalized = normalizeClubName(name)
  if (normalized.length === 0) return []
  const trimmedPostcode = postcode.trim()

  const orParts = [`normalized_key.eq.${normalized}`]
  if (trimmedPostcode.length > 0) {
    orParts.push(`postcode.ilike.${trimmedPostcode.replace(/[%_]/g, (c) => `\\${c}`)}`)
  }

  const { data } = await supabase
    .from("admin_club_overview")
    .select("directory_id, name, town, county, postcode, rugby_code, is_activated")
    .eq("rugby_code", rugbyCode)
    .or(orParts.join(","))
    .limit(10)

  return (data ?? []).map((row) => ({
    directoryId: row.directory_id ?? "",
    name: row.name ?? "",
    town: row.town,
    county: row.county,
    postcode: row.postcode,
    rugbyCode: row.rugby_code ?? rugbyCode,
    isActivated: row.is_activated ?? false,
  }))
}

export interface CreateClubInput {
  name: string
  rugbyCode: "union" | "league"
  country: string
  nation: "England" | "Scotland" | "Wales" | "Northern Ireland"
  region: string
  county: string
  town: string
  postcode: string
  website: string
  officialEmail: string
  active: boolean
  verificationStatus: string
  notes: string
}

export type CreateClubResult = { ok: true; directoryId: string } | { ok: false; error: string }

/**
 * Site Admin manual canonical creation. Writes straight to club_directory
 * (club_directory_write_admin RLS: is_site_admin() only) -- the same table
 * the ingestion pipeline and every other write path uses, never a shadow
 * record. source = 'site_admin_manual' is a real, honest provenance value
 * (not a fabricated governing-body source); external_id and source_url
 * stay null rather than inventing values that don't exist.
 */
export async function createCanonicalClub(input: CreateClubInput): Promise<CreateClubResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'club_data'])
  if (!auth.ok) return { ok: false, error: auth.error }

  const name = input.name.trim()
  if (!name) return { ok: false, error: "Club name is required." }

  const { data, error } = await supabase
    .from("club_directory")
    .insert({
      name,
      rugby_code: input.rugbyCode,
      country: input.country.trim() || "United Kingdom",
      nation: input.nation,
      region: input.region.trim() || null,
      county: input.county.trim() || null,
      town: input.town.trim() || null,
      postcode: input.postcode.trim() || null,
      website: input.website.trim() || null,
      official_email: input.officialEmail.trim() || null,
      active: input.active,
      verification_status: input.verificationStatus.trim() || "unverified",
      notes: input.notes.trim() || null,
      source: "site_admin_manual",
      source_url: null,
      external_id: null,
      normalized_key: normalizeClubName(name),
      created_by: auth.user.id,
      updated_by: auth.user.id,
    })
    .select("id")
    .single()

  if (error || !data) {
    console.error("createCanonicalClub failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }

  revalidatePath("/admin/clubs")
  return { ok: true, directoryId: data.id }
}

export interface QuickEditInput {
  directoryId: string
  field: "name" | "town" | "county" | "postcode" | "website" | "active" | "verification_status"
  value: string | boolean
}

/**
 * The inline grid's single-field save -- a deliberately narrow allowlist
 * (see the `field` union above), separate from the full DirectoryForm's
 * updateDirectoryFields so a stray click in the table can never touch
 * address/notes/provenance. Same RLS boundary either way.
 */
export async function quickEditClub(input: QuickEditInput): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'club_data'])
  if (!auth.ok) return { ok: false, error: auth.error }

  if (input.field === "name" && typeof input.value === "string" && !input.value.trim()) {
    return { ok: false, error: "Club name is required." }
  }

  const trimmedOrNull = typeof input.value === "string" ? input.value.trim() || null : null

  let query = supabase.from("club_directory").update({})
  switch (input.field) {
    case "active":
      query = supabase.from("club_directory").update({ active: Boolean(input.value) })
      break
    case "name":
      query = supabase.from("club_directory").update({ name: (input.value as string).trim() })
      break
    case "town":
      query = supabase.from("club_directory").update({ town: trimmedOrNull })
      break
    case "county":
      query = supabase.from("club_directory").update({ county: trimmedOrNull })
      break
    case "postcode":
      query = supabase.from("club_directory").update({ postcode: trimmedOrNull })
      break
    case "website":
      query = supabase.from("club_directory").update({ website: trimmedOrNull })
      break
    case "verification_status":
      query = supabase.from("club_directory").update({ verification_status: trimmedOrNull ?? "unverified" })
      break
  }

  const { error } = await query.eq("id", input.directoryId)

  if (error) {
    console.error("quickEditClub failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath("/admin/clubs")
  revalidatePath(`/admin/clubs/${input.directoryId}`)
  return { ok: true }
}

export type ExportCsvResult = { ok: true; csv: string; filename: string } | { ok: false; error: string }

/**
 * The only fields that ever leave this function -- an explicit allowlist,
 * not "select * and hope nothing sensitive is in the view". No personal
 * data is even reachable from admin_club_overview (it joins club_directory
 * + clubs + a COUNT of club_memberships, never a claimant/member row), but
 * the allowlist stays deliberate rather than relying on that alone.
 */
const CSV_COLUMNS = [
  "directory_id",
  "club_name",
  "rugby_code",
  "town",
  "county",
  "region",
  "postcode",
  "country",
  "website",
  "official_email",
  "active",
  "verification_status",
  "activated",
  "club_slug",
  "updated_at",
] as const

export async function exportClubsCsv(query: AdminClubQuery): Promise<ExportCsvResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase)
  if (!auth.ok) return { ok: false, error: auth.error }

  // No .range() -- exports every matching row, not just the current page.
  const { data, error } = await buildAdminClubQuery(supabase, query)
  if (error || !data) return { ok: false, error: "Couldn't generate the export. Please try again." }

  const lines = [CSV_COLUMNS.join(",")]
  for (const row of data) {
    lines.push(
      [
        row.directory_id ?? "",
        row.name ?? "",
        row.rugby_code ?? "",
        row.town ?? "",
        row.county ?? "",
        row.region ?? "",
        row.postcode ?? "",
        row.country ?? "",
        row.directory_website ?? "",
        row.official_email ?? "",
        String(row.directory_active ?? false),
        row.verification_status ?? "",
        String(row.is_activated ?? false),
        row.slug ?? "",
        row.directory_updated_at ?? "",
      ]
        .map(csvEscape)
        .join(",")
    )
  }
  const csv = lines.join("\r\n") + "\r\n"

  const timestamp = new Date().toISOString().slice(0, 10)
  return { ok: true, csv, filename: `ovalball-clubs-${timestamp}.csv` }
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
