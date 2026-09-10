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

/**
 * The same backfill, for venues.
 *
 * WHY VENUES NEEDED THIS. A venue's latitude/longitude were bare, typeable
 * columns with no provenance and nothing relating them to the address on the
 * same row. UAT found the consequence: the Match Centre's map pinned Turf Moor
 * -- Burnley FC -- for a fixture at a venue whose address reads "Belvedere
 * Road, Burnley, BB10 2LS", which is the RUGBY club, three kilometres away.
 * The map was faithful; the row was wrong, and nothing had ever compared the
 * two.
 *
 * So a venue's coordinates now come from ONE place: postcodes.io, applied to
 * that venue's own canonical postcode, through the same module club_directory
 * uses. There is no second provider and no path by which a coordinate can be
 * invented -- a pin can only ever be where the address says it is. A venue
 * with no postcode is marked no_postcode and simply has no pin; the Match
 * Centre renders its address and Directions regardless, so what is lost is the
 * map, not the way there.
 *
 * Deliberately a separate function rather than a generic one parameterised by
 * table name: PostgREST's typed client resolves column names per table, and a
 * string-keyed generic version would give up exactly the type checking that
 * makes a wrong column name a compile error rather than a silent no-op.
 */
export async function runVenueGeocodingBackfill(
  supabase: SupabaseClient<Database>
): Promise<GeocodingBackfillSummary> {
  const { count: markedNoPostcode, error: noPostcodeError } = await supabase
    .from("venues")
    .update({ geocode_status: "no_postcode" }, { count: "exact" })
    .eq("geocode_status", "pending")
    .is("postcode", null)

  if (noPostcodeError) {
    return { markedNoPostcode: 0, geocoded: 0, failed: 0, errored: noPostcodeError.message }
  }

  const pendingRows: { id: string; postcode: string }[] = []
  const PAGE_SIZE = 1000
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("venues")
      .select("id, postcode")
      .eq("geocode_status", "pending")
      .not("postcode", "is", null)
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    if (error) {
      return { markedNoPostcode: markedNoPostcode ?? 0, geocoded: 0, failed: 0, errored: error.message }
    }
    if (!data || data.length === 0) break
    pendingRows.push(...(data as { id: string; postcode: string }[]))
    if (data.length < PAGE_SIZE) break
  }

  if (pendingRows.length === 0) {
    return { markedNoPostcode: markedNoPostcode ?? 0, geocoded: 0, failed: 0, errored: null }
  }

  let coordinatesByPostcode: Map<string, { latitude: number; longitude: number }>
  try {
    coordinatesByPostcode = await bulkLookupPostcodes(pendingRows.map((r) => r.postcode))
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
    const coords = coordinatesByPostcode.get(row.postcode.trim())
    if (coords) {
      const { error } = await supabase
        .from("venues")
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
      // The postcode did not resolve. The OLD coordinates are deliberately
      // left in place but the status says 'failed', so the Match Centre
      // withholds the map rather than pinning numbers nothing stands behind.
      const { error } = await supabase
        .from("venues")
        .update({ geocoded_at: now, geocode_status: "failed", geocode_source: "postcodes.io" })
        .eq("id", row.id)
      if (!error) failed++
    }
  }

  return { markedNoPostcode: markedNoPostcode ?? 0, geocoded, failed, errored: null }
}

/**
 * Geocode ONE venue, immediately, from its own canonical postcode.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE BACKFILL. The backfill is a Site Admin
 * button. Relying on it alone meant a club could add a venue on Tuesday and
 * have no map on it until somebody at Ovalball happened to press that button
 * -- and because a missing pin is silent, nobody would know to. Coordinates
 * are derived at the moment the postcode is known instead, which is when a
 * club saves the venue.
 *
 * The backfill stays, and stays useful: it is what catches a venue whose
 * geocode failed because the provider was down at save time, and it is how the
 * existing estate was corrected.
 *
 * NEVER THROWS, AND NEVER BLOCKS THE SAVE. Saving a venue is the club's
 * action; a geocoding provider being slow or down is not a reason to refuse
 * it. A failure leaves the row 'pending' (so the backfill retries it) or
 * 'failed', and the Match Centre simply shows the address and Directions with
 * no map, which is a complete answer on its own.
 */
export async function geocodeVenueFromPostcode(
  supabase: SupabaseClient<Database>,
  venueId: string
): Promise<void> {
  try {
    const { data: venue } = await supabase.from("venues").select("id, postcode, geocode_status").eq("id", venueId).maybeSingle()
    if (!venue) return

    const postcode = venue.postcode?.trim()
    if (!postcode) {
      await supabase.from("venues").update({ geocode_status: "no_postcode", geocoded_at: new Date().toISOString() }).eq("id", venueId)
      return
    }
    // Already resolved for this postcode -- the trigger resets the row to
    // 'pending' whenever the postcode actually changes, so 'success' here
    // means these coordinates belong to this postcode.
    if (venue.geocode_status === "success") return

    const coords = await bulkLookupPostcodes([postcode])
    const hit = coords.get(postcode)
    const now = new Date().toISOString()
    if (hit) {
      await supabase
        .from("venues")
        .update({
          latitude: hit.latitude,
          longitude: hit.longitude,
          geocoded_at: now,
          geocode_status: "success",
          geocode_source: "postcodes.io",
        })
        .eq("id", venueId)
    } else {
      await supabase.from("venues").update({ geocoded_at: now, geocode_status: "failed", geocode_source: "postcodes.io" }).eq("id", venueId)
    }
  } catch {
    // Deliberately swallowed. The venue is saved either way, the row stays
    // 'pending', and the backfill will pick it up.
  }
}
