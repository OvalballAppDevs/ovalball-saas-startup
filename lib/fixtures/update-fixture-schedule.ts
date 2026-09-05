import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

export type UpdateFixtureScheduleResult = { ok: true; kickoffProposed: boolean } | { ok: false; error: string }

/**
 * Sections 9-10: the ONE call site every fixture-scheduling mutation goes
 * through now -- Pitch Allocation's own allocateFixture() and every
 * Fixture Management/Messages action below all resolve down to this same
 * function, which calls the single atomic update_fixture_schedule() RPC
 * instead of the three separate update_fixture_venue/pitch/kickoff calls
 * each caller used to make sequentially. `changes` fields left `undefined`
 * are passed through as the fixture's CURRENT value (a no-op for that
 * field inside the RPC's own diff) -- only fields the caller actually
 * intends to change need to be supplied.
 */
export async function callUpdateFixtureSchedule(
  supabase: SupabaseClient<Database>,
  fixtureId: string,
  changes: {
    kickoffDate?: string
    kickoffTime?: string | null
    venueId?: string | null
    pitchId?: string | null
    pitchText?: string | null
  },
  source: string
): Promise<UpdateFixtureScheduleResult> {
  const { data: fixture } = await supabase
    .from("fixtures")
    .select("kickoff_date, kickoff_time, venue_id, pitch_id, pitch_allocation")
    .eq("id", fixtureId)
    .maybeSingle()
  if (!fixture) return { ok: false, error: "Fixture not found." }

  const pitchIdProvided = changes.pitchId !== undefined
  const pitchTextProvided = changes.pitchText !== undefined
  // pitchId and pitchText are mutually exclusive selections (mirrors
  // update_fixture_pitch's own "exactly one of the two" contract): giving
  // pitchText means "no real pitch, use this free text instead", so it
  // must clear pitch_id, not merely leave it alone. Only when NEITHER is
  // provided does pitch stay untouched, forwarding both current values so
  // a kickoff-only or venue-only call doesn't blank out an existing
  // TBC/free-text pitch_allocation via the RPC's own pitch-changed diff.
  const pitchTouched = pitchIdProvided || pitchTextProvided
  const { data: result, error } = await supabase
    .rpc("update_fixture_schedule", {
      p_fixture_id: fixtureId,
      p_kickoff_date: changes.kickoffDate ?? fixture.kickoff_date,
      p_kickoff_time: (changes.kickoffTime !== undefined ? changes.kickoffTime : fixture.kickoff_time) ?? undefined,
      p_venue_id: (changes.venueId !== undefined ? changes.venueId : fixture.venue_id) ?? undefined,
      p_pitch_id: pitchTouched ? (pitchIdProvided ? (changes.pitchId ?? undefined) : undefined) : (fixture.pitch_id ?? undefined),
      p_pitch_text: pitchTouched ? (pitchIdProvided ? undefined : (changes.pitchText ?? undefined)) : (fixture.pitch_allocation ?? undefined),
      p_source: source,
    })
    .maybeSingle()
  if (error) return { ok: false, error: error.message }

  const kickoffProposed = Boolean(result?.kickoff_proposed)
  return { ok: true, kickoffProposed }
}
