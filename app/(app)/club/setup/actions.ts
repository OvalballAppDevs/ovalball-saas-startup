"use server"

import { revalidatePath } from "next/cache"

import { activeManageableClubId, ACTIVE_CONTEXT_COOKIE, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"

export type SetupResult = { ok: true; message?: string } | { ok: false; error: string }

/**
 * Every setup action resolves the club from the SESSION's active context,
 * never from a client-supplied id.
 *
 * This is what makes cross-club mutation structurally impossible rather than
 * merely checked: there is no parameter for "which club", so a caller cannot
 * name one they do not operate as. The database re-checks
 * `club.edit_profile` on top of this regardless -- a server action is a
 * public endpoint, and this resolution is a convenience, not the boundary.
 */
async function resolveSetupClub() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: "You must be signed in." }

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const clubId = activeManageableClubId(ctx, activeContext)
  if (!clubId) return { ok: false as const, error: "You don't have club administration authority here." }

  return { ok: true as const, supabase, clubId }
}

/** Maps a database refusal onto a sentence, keeping the server's own wording. */
function toError(error: { code?: string; message: string }, fallback: string): SetupResult {
  if (error.code === "42501") {
    return { ok: false, error: "Only a Club Admin can complete club setup." }
  }
  // P0001 messages here are deliberately written for the reader (the
  // completion RPC lists exactly what is still missing), so they are shown.
  if (error.code === "P0001") return { ok: false, error: error.message }
  console.error(`${fallback}:`, error.message)
  return { ok: false, error: fallback }
}

export async function advanceSetup(step: number): Promise<SetupResult> {
  const r = await resolveSetupClub()
  if (!r.ok) return r

  const { error } = await r.supabase.rpc("advance_club_setup", { p_club_id: r.clubId, p_step: step })
  if (error) return toError(error, "Your progress could not be saved.")
  return { ok: true }
}

export async function confirmTeams(): Promise<SetupResult> {
  const r = await resolveSetupClub()
  if (!r.ok) return r

  const { error } = await r.supabase.rpc("confirm_club_teams", { p_club_id: r.clubId })
  if (error) return toError(error, "The team list could not be confirmed.")

  revalidatePath("/club/setup")
  return { ok: true }
}

/**
 * Finishes activation. The RPC re-validates every requirement from canonical
 * data before it will move the lifecycle, so a stale step number or a
 * requirement that disappeared between steps fails here with a sentence
 * naming what is missing rather than activating a club that is not ready.
 */
export async function completeSetup(): Promise<SetupResult> {
  const r = await resolveSetupClub()
  if (!r.ok) return r

  const { data, error } = await r.supabase.rpc("complete_club_setup", { p_club_id: r.clubId })
  if (error) return toError(error, "Club setup could not be completed.")

  revalidatePath("/club/setup")
  revalidatePath("/dashboard")
  return { ok: true, message: data === "already_complete" ? "Already complete." : undefined }
}

/**
 * Creates a venue and its pitches in one step, so a Club Admin never has to
 * leave setup to find a separate pitch screen.
 *
 * Each canonical operation is the same RPC Club Settings uses -- create the
 * venue, set its structured address, add the pitches, mark it default. No
 * onboarding-specific venue path exists.
 */
export async function createVenueWithPitches(input: {
  name: string
  line1: string
  line2: string
  town: string
  county: string
  postcode: string
  country: string
  latitude: number | null
  longitude: number | null
  providerRef: string | null
  pitchNames: string[]
  makeDefault: boolean
}): Promise<SetupResult> {
  const r = await resolveSetupClub()
  if (!r.ok) return r

  const name = input.name.trim()
  if (!name) return { ok: false, error: "Give the venue a name." }
  if (!input.postcode.trim()) return { ok: false, error: "A postcode is required." }
  if (!input.line1.trim() && !input.town.trim()) {
    return { ok: false, error: "Enter at least the first line of the address, or the town." }
  }

  const pitches = input.pitchNames.map((p) => p.trim()).filter(Boolean)
  if (input.makeDefault && pitches.length === 0) {
    return { ok: false, error: "Your home venue needs at least one pitch." }
  }

  // The canonical creator. `p_address` is its legacy display line -- left
  // empty here because set_venue_address regenerates it from the structured
  // parts on the very next call, and writing a hand-built string first
  // would just be a value with a two-line lifetime.
  const { data: venueId, error: venueError } = await r.supabase.rpc("create_venue", {
    p_club_id: r.clubId,
    p_name: name,
    p_address: "",
    p_postcode: input.postcode.trim(),
    p_directions: "",
    p_set_default: input.makeDefault,
  })
  if (venueError || !venueId) {
    return toError(venueError ?? { message: "no id" }, "The venue could not be created.")
  }

  const { error: addressError } = await r.supabase.rpc("set_venue_address", {
    p_venue_id: venueId,
    p_line1: input.line1,
    p_line2: input.line2,
    p_town: input.town,
    p_county: input.county,
    p_postcode: input.postcode,
    p_country: input.country || "United Kingdom",
    p_latitude: input.latitude ?? undefined,
    p_longitude: input.longitude ?? undefined,
    p_provider_ref: input.providerRef ?? undefined,
  })
  if (addressError) return toError(addressError, "The venue address could not be saved.")

  // Attached to the venue that was just created. The attachment is the
  // point: training plan and session validation both reject a pitch whose
  // venue_id does not match the chosen venue, so a detached pitch is a
  // pitch that cannot be trained on.
  for (const pitchName of pitches) {
    const { error: pitchError } = await r.supabase.rpc("create_club_pitch", {
      p_club_id: r.clubId,
      p_display_name: pitchName,
      p_venue_id: venueId,
    })
    if (pitchError) return toError(pitchError, `The pitch "${pitchName}" could not be created.`)
  }

  revalidatePath("/club/setup")
  revalidatePath("/club/venues")
  return { ok: true }
}

/**
 * Removes a team during setup.
 *
 * The server decides what "remove" means: a team with no reference anywhere
 * is deleted, anything with history is folded through the canonical
 * lifecycle. Onboarding is never a route to cascade-delete fixtures,
 * memberships or attendance.
 */
export async function removeSetupTeam(teamId: string): Promise<SetupResult> {
  const r = await resolveSetupClub()
  if (!r.ok) return r

  const { data, error } = await r.supabase.rpc("remove_setup_team", { p_team_id: teamId })
  if (error) return toError(error, "The team could not be removed.")

  revalidatePath("/club/setup")
  return {
    ok: true,
    message:
      data === "folded"
        ? "That team already has history, so it has been retired rather than deleted."
        : undefined,
  }
}
