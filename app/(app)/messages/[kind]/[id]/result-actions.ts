"use server"

import { revalidatePath } from "next/cache"

import { requireActiveFixtureAuthority } from "@/lib/fixtures/require-active-fixture-authority"
import { callUpdateFixtureSchedule } from "@/lib/fixtures/update-fixture-schedule"
import { createClient } from "@/lib/supabase/server"

export type ResultActionResult = { ok: true } | { ok: false; error: string }

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
 * submit_fixture_result is the real authorization/state-machine boundary
 * (participant check, kickoff-passed check, dispute/amendment logic) --
 * this forwards the call after the active-context guard above (see
 * lib/fixtures/require-active-fixture-authority.ts for why that guard is
 * necessary in addition to the RPC's own check).
 */
export async function submitFixtureResultAction(fixtureId: string, homeScore: number, awayScore: number): Promise<ResultActionResult> {
  const auth = await requireAuth(fixtureId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const { error } = await auth.supabase.rpc("submit_fixture_result", {
    p_fixture_id: fixtureId,
    p_home_score: homeScore,
    p_away_score: awayScore,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/messages/fixture/${fixtureId}`)
  revalidatePath("/messages")
  return { ok: true }
}

/**
 * Exactly one of pitchId (a real club_pitches row -- the normal path) or
 * pitchText (TBC/legacy free text) should be set; the RPC itself validates
 * that a pitchId can only be a HOME fixture's own home-club pitch.
 */
export async function updateFixturePitchAction(
  fixtureId: string,
  selection: { pitchId: string } | { pitchText: string | null }
): Promise<ResultActionResult> {
  const auth = await requireAuth(fixtureId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const result = await callUpdateFixtureSchedule(
    auth.supabase,
    fixtureId,
    "pitchId" in selection ? { pitchId: selection.pitchId } : { pitchText: selection.pitchText },
    "FIXTURE_MANAGEMENT"
  )
  if (!result.ok) return { ok: false, error: result.error }

  revalidatePath(`/messages/fixture/${fixtureId}`)
  revalidatePath(`/admin/fixtures/${fixtureId}`)
  revalidatePath("/admin/fixtures")
  revalidatePath("/calendar/pitch-allocation")
  return { ok: true }
}

/**
 * update_fixture_kickoff is the real state-machine boundary (direct edit
 * when there's no real opponent to agree with, a proposed amendment
 * requiring the other club's acceptance otherwise) -- this forwards the
 * call after the same active-context guard.
 */
export async function updateFixtureKickoffAction(fixtureId: string, kickoffDate: string, kickoffTime: string | null): Promise<ResultActionResult> {
  const auth = await requireAuth(fixtureId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const result = await callUpdateFixtureSchedule(auth.supabase, fixtureId, { kickoffDate, kickoffTime }, "FIXTURE_MANAGEMENT")
  if (!result.ok) return { ok: false, error: result.error }

  revalidatePath(`/messages/fixture/${fixtureId}`)
  revalidatePath(`/admin/fixtures/${fixtureId}`)
  revalidatePath("/admin/fixtures")
  revalidatePath("/calendar")
  revalidatePath("/calendar/pitch-allocation")
  return { ok: true }
}

export async function rejectFixtureKickoffChangeAction(fixtureId: string): Promise<ResultActionResult> {
  const auth = await requireAuth(fixtureId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const { error } = await auth.supabase.rpc("reject_fixture_kickoff_change", { p_fixture_id: fixtureId })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/messages/fixture/${fixtureId}`)
  revalidatePath(`/admin/fixtures/${fixtureId}`)
  return { ok: true }
}

export async function updateFixtureCompetitionAction(fixtureId: string, competitionEditionId: string | null): Promise<ResultActionResult> {
  const auth = await requireAuth(fixtureId)
  if (!auth.ok) return { ok: false, error: auth.error }
  const { error } = await auth.supabase.rpc("update_fixture_competition", {
    p_fixture_id: fixtureId,
    // Declared nullable uuid in SQL -- the generated type doesn't capture that.
    p_competition_edition_id: competitionEditionId as unknown as string,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/messages/fixture/${fixtureId}`)
  revalidatePath(`/admin/fixtures/${fixtureId}`)
  revalidatePath("/admin/fixtures")
  return { ok: true }
}
