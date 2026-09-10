"use server"

import { revalidatePath } from "next/cache"

import { getSessionContext } from "@/lib/app-context/session-context"
import {
  getGeocodingStatusSummary,
  runClubDirectoryGeocodingBackfill,
  runVenueGeocodingBackfill,
  type GeocodingBackfillSummary,
  type GeocodingStatusSummary,
} from "@/lib/geocoding/backfill"
import { createClient } from "@/lib/supabase/server"

async function requireSiteAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: "Not signed in." }
  const ctx = await getSessionContext(supabase, user)
  if (!ctx.isSiteAdmin) return { ok: false as const, error: "Site Admin only." }
  return { ok: true as const, supabase }
}

export async function getClubDirectoryGeocodingSummary(): Promise<GeocodingStatusSummary | null> {
  const auth = await requireSiteAdmin()
  if (!auth.ok) return null
  return getGeocodingStatusSummary(auth.supabase)
}

export type GeocodingBackfillResult = { ok: true; summary: GeocodingBackfillSummary } | { ok: false; error: string }

export async function runGeocodingBackfillAction(): Promise<GeocodingBackfillResult> {
  const auth = await requireSiteAdmin()
  if (!auth.ok) return { ok: false, error: auth.error }

  const summary = await runClubDirectoryGeocodingBackfill(auth.supabase)
  if (summary.errored) return { ok: false, error: summary.errored }

  // Venues are geocoded in the same pass, from the same provider, against
  // their own canonical postcode. They were left out originally and their
  // coordinates were hand-entered instead, which is how the Match Centre came
  // to pin a fixture on Burnley FC's ground for a match at Burnley RUFC.
  // A venue failure does not fail the club run: the two are independent
  // populations, and reporting the club result is still useful.
  const venueSummary = await runVenueGeocodingBackfill(auth.supabase)

  revalidatePath("/admin/clubs")
  revalidatePath("/partner-clubs")
  return {
    ok: true,
    summary: {
      markedNoPostcode: summary.markedNoPostcode + venueSummary.markedNoPostcode,
      geocoded: summary.geocoded + venueSummary.geocoded,
      failed: summary.failed + venueSummary.failed,
      errored: venueSummary.errored,
    },
  }
}
