"use server"

import { revalidatePath } from "next/cache"

import { getSessionContext } from "@/lib/app-context/session-context"
import { getGeocodingStatusSummary, runClubDirectoryGeocodingBackfill, type GeocodingBackfillSummary, type GeocodingStatusSummary } from "@/lib/geocoding/backfill"
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

  revalidatePath("/admin/clubs")
  revalidatePath("/partner-clubs")
  return { ok: true, summary }
}
