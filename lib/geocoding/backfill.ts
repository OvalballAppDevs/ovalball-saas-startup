import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import { bulkLookupPostcodes } from "./postcodes-io"

export interface GeocodingBackfillSummary {
  markedNoPostcode: number
  geocoded: number
  failed: number
  errored: string | null
}

/**
 * Cached, batch geocoding -- never called per-request from the map. Only
 * touches club_directory rows still `geocode_status = 'pending'`, so
 * re-running this is always safe and cheap: a club that already resolved
 * (or already failed, or never had a postcode) is left untouched until
 * something about its own record changes (see the trigger in the
 * migration that resets a row back to 'pending' when its postcode edits).
 * The caller's own Supabase client carries its own session, so the
 * `club_directory_update_admin` RLS policy (Site Admin only) is the real
 * authorization boundary here -- this function has no elevated access of
 * its own.
 */
export async function runClubDirectoryGeocodingBackfill(
  supabase: SupabaseClient<Database>
): Promise<GeocodingBackfillSummary> {
  // count-only (head: true) has no PostgREST row cap, unlike a plain
  // select -- club_directory has 1,300+ rows needing this update, well
  // past the default 1000-row response limit, so counting via a returned
  // array here would silently under-report even though the UPDATE itself
  // (a single server-side statement) always affects every matching row.
  const { count: markedNoPostcode, error: noPostcodeError } = await supabase
    .from("club_directory")
    .update({ geocode_status: "no_postcode" }, { count: "exact" })
    .eq("geocode_status", "pending")
    .is("postcode", null)

  if (noPostcodeError) {
    return { markedNoPostcode: 0, geocoded: 0, failed: 0, errored: noPostcodeError.message }
  }

  // Paginated rather than one unbounded select -- club_directory will
  // keep growing past PostgREST's default 1000-row response cap as more
  // postcodes get added, and silently geocoding only the first page
  // would be worse than the summary miscount above: rows would sit at
  // 'pending' indefinitely with no visible sign anything was skipped.
  const pendingRows: { id: string; postcode: string }[] = []
  let pendingError: { message: string } | null = null
  const PAGE_SIZE = 1000
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("club_directory")
      .select("id, postcode")
      .eq("geocode_status", "pending")
      .not("postcode", "is", null)
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    if (error) {
      pendingError = error
      break
    }
    if (!data || data.length === 0) break
    pendingRows.push(...(data as { id: string; postcode: string }[]))
    if (data.length < PAGE_SIZE) break
  }

  if (pendingError) {
    return { markedNoPostcode: markedNoPostcode ?? 0, geocoded: 0, failed: 0, errored: pendingError.message }
  }
  if (!pendingRows || pendingRows.length === 0) {
    return { markedNoPostcode: markedNoPostcode ?? 0, geocoded: 0, failed: 0, errored: null }
  }

  let coordinatesByPostcode: Map<string, { latitude: number; longitude: number }>
  try {
    coordinatesByPostcode = await bulkLookupPostcodes(pendingRows.map((r) => r.postcode as string))
  } catch (e) {
    return {
      markedNoPostcode: markedNoPostcode ?? 0,
      geocoded: 0,
      failed: 0,
      errored: e instanceof Error ? e.message : "Geocoding provider request failed.",
    }
  }

  let geocoded = 0
  let failed = 0
  const now = new Date().toISOString()

  for (const row of pendingRows) {
    const coords = coordinatesByPostcode.get((row.postcode as string).trim())
    if (coords) {
      const { error } = await supabase
        .from("club_directory")
        .update({
          latitude: coords.latitude,
          longitude: coords.longitude,
          geocoded_at: now,
          geocode_status: "success",
          geocode_source: "postcodes.io",
        })
        .eq("id", row.id)
      if (!error) geocoded++
      else failed++
    } else {
      const { error } = await supabase
        .from("club_directory")
        .update({ geocoded_at: now, geocode_status: "failed", geocode_source: "postcodes.io" })
        .eq("id", row.id)
      if (!error) failed++
    }
  }

  return { markedNoPostcode: markedNoPostcode ?? 0, geocoded, failed, errored: null }
}

export interface GeocodingStatusSummary {
  pending: number
  success: number
  noPostcode: number
  failed: number
}

/**
 * Four count-only (head: true) queries rather than one select-and-tally --
 * club_directory has 1,300+ active rows, past PostgREST's default 1000-row
 * response cap, so pulling every row client-side to count in JS would
 * silently under-report exactly like the bug fixed above in the backfill
 * itself.
 */
export async function getGeocodingStatusSummary(supabase: SupabaseClient<Database>): Promise<GeocodingStatusSummary> {
  const countFor = async (status: string) => {
    const { count } = await supabase
      .from("club_directory")
      .select("id", { count: "exact", head: true })
      .eq("active", true)
      .eq("geocode_status", status)
    return count ?? 0
  }
  const [pending, success, noPostcode, failed] = await Promise.all([
    countFor("pending"),
    countFor("success"),
    countFor("no_postcode"),
    countFor("failed"),
  ])
  return { pending, success, noPostcode, failed }
}
