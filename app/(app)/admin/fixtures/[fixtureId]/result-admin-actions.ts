"use server"

import { revalidatePath } from "next/cache"

import { requireActiveFixtureAuthority } from "@/lib/fixtures/require-active-fixture-authority"
import { callUpdateFixtureSchedule } from "@/lib/fixtures/update-fixture-schedule"
import { createClient } from "@/lib/supabase/server"

export type ResultAdminActionResult = { ok: true } | { ok: false; error: string }

async function requireAuth(fixtureId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: "Not signed in.", supabase: null }
  const auth = await requireActiveFixtureAuthority(supabase, user, fixtureId)
  if (!auth.ok) return { ok: false as const, error: auth.error, supabase: null }
  return { ok: true as const, error: undefined, supabase }
}

/**
 * resolve_fixture_result_dispute is the real authorization boundary (Full
 * Site Admin or Fixture Ops only, reason required) -- this forwards the
 * call after the same active-context guard every other action in this
 * pair of files now shares (lib/fixtures/require-active-fixture-authority.ts).
 */
export async function resolveFixtureResultDisputeAction(
  fixtureId: string,
  homeScore: number,
  awayScore: number,
  reason: string
): Promise<ResultAdminActionResult> {
  const auth = await requireAuth(fixtureId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const { error } = await auth.supabase.rpc("resolve_fixture_result_dispute", {
    p_fixture_id: fixtureId,
    p_home_score: homeScore,
    p_away_score: awayScore,
    p_reason: reason,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/admin/fixtures/${fixtureId}`)
  revalidatePath(`/messages/fixture/${fixtureId}`)
  revalidatePath("/admin/fixtures")
  return { ok: true }
}

/**
 * Reconciliation pass Section 6: the Fixture Detail Venue/Pitch section's
 * venue half -- update_fixture_venue is the real authorization boundary
 * (home-fixture-only, home-club-owned venue), this forwards the call
 * after the active-context guard.
 */
export async function updateFixtureVenueAction(fixtureId: string, venueId: string | null): Promise<ResultAdminActionResult> {
  const auth = await requireAuth(fixtureId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const result = await callUpdateFixtureSchedule(auth.supabase, fixtureId, { venueId }, "FIXTURE_MANAGEMENT")
  if (!result.ok) return { ok: false, error: result.error }

  revalidatePath(`/admin/fixtures/${fixtureId}`)
  revalidatePath(`/messages/fixture/${fixtureId}`)
  revalidatePath("/admin/fixtures")
  revalidatePath("/calendar/pitch-allocation")
  return { ok: true }
}

/**
 * Exactly one of pitchId (a real club_pitches row -- the normal path) or
 * pitchText (TBC/legacy free text -- see update_fixture_pitch's own
 * comment) should be set; the RPC itself validates that a pitchId can
 * only be a HOME fixture's own home-club pitch.
 */
export async function updateFixturePitchAction(
  fixtureId: string,
  selection: { pitchId: string } | { pitchText: string | null }
): Promise<ResultAdminActionResult> {
  const auth = await requireAuth(fixtureId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const result = await callUpdateFixtureSchedule(
    auth.supabase,
    fixtureId,
    "pitchId" in selection ? { pitchId: selection.pitchId } : { pitchText: selection.pitchText },
    "FIXTURE_MANAGEMENT"
  )
  if (!result.ok) return { ok: false, error: result.error }

  revalidatePath(`/admin/fixtures/${fixtureId}`)
  revalidatePath(`/messages/fixture/${fixtureId}`)
  revalidatePath("/admin/fixtures")
  revalidatePath("/calendar/pitch-allocation")
  return { ok: true }
}
