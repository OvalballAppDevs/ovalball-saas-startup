"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type TournamentFixtureResult = { ok: true; tournamentId: string } | { ok: false; error: string }

/**
 * Section 1-13/19-20 of the Tournament instruction: creates ONE master
 * tournament event (create_tournament) then invites every opposition entry
 * (invite_tournament_participant, one call each) -- never one fixtures row
 * per opponent. Each entry's canonical_team_type_id is resolved server-side
 * from whichever the client collected (a direct catalogue pick, or the
 * age/gender/squad missing-team picker's structured fields) via the SAME
 * resolve_canonical_team_type_id bridge, so both paths land on one real
 * closed-catalogue identity, never an invented one.
 */
export async function createTournamentWithOppositionAction(input: {
  hostTeamId: string
  eventDate: string
  kickoffTime: string | null
  pitchId: string | null
  venueId: string | null
  competitionEditionId: string | null
  notes: string | null
  opposition: Array<
    | { kind: "club_and_type"; clubDirectoryId: string; canonicalTeamTypeId: string }
    | { kind: "club_and_identity"; clubDirectoryId: string; ageGroup: string; gender: "boys" | "girls"; squadDesignation: string | null }
  >
}): Promise<TournamentFixtureResult> {
  const supabase = await createClient()

  const { data: tournamentId, error: createError } = await supabase.rpc("create_tournament", {
    p_host_team_id: input.hostTeamId,
    p_event_date: input.eventDate,
    p_kickoff_time: input.kickoffTime ?? undefined,
    p_pitch_id: input.pitchId ?? undefined,
    p_competition_edition_id: input.competitionEditionId ?? undefined,
    p_notes: input.notes ?? undefined,
    p_venue_id: input.venueId ?? undefined,
  })
  if (createError || !tournamentId) return { ok: false, error: createError?.message ?? "Could not create the tournament." }

  const errors: string[] = []
  for (const entry of input.opposition) {
    let canonicalTeamTypeId = entry.kind === "club_and_type" ? entry.canonicalTeamTypeId : null
    if (entry.kind === "club_and_identity") {
      const { data } = await supabase.rpc("resolve_canonical_team_type_id", {
        p_age_group: entry.ageGroup,
        p_gender: entry.gender,
        p_squad_designation: entry.squadDesignation ?? undefined,
      })
      canonicalTeamTypeId = data as string | null
    }
    if (!canonicalTeamTypeId) {
      errors.push("One opposition entry did not resolve to a real Team Directory identity and was skipped.")
      continue
    }
    const { error: inviteError } = await supabase.rpc("invite_tournament_participant", {
      p_tournament_id: tournamentId,
      p_club_directory_id: entry.clubDirectoryId,
      p_canonical_team_type_id: canonicalTeamTypeId,
    })
    if (inviteError) errors.push(inviteError.message)
  }

  revalidatePath("/admin/fixtures")
  revalidatePath("/fixtures")
  revalidatePath("/calendar")

  if (errors.length > 0) {
    return { ok: false, error: `Tournament created, but ${errors.length} invitation(s) failed: ${errors.join(" ")}` }
  }
  return { ok: true, tournamentId: tournamentId as string }
}

export interface ClubTeamTypeState {
  canonicalTeamTypeId: string
  state: "active" | "inactive" | "not_operated"
}

/**
 * Section 2/8/18: annotates each canonical Team Directory identity with
 * this specific club's real operational state, so the opposition picker
 * can show "Under 13 -- Not currently operated" rather than a flat list
 * with no state at all. Read-only, never creates/changes anything.
 */
export async function getClubTeamTypeStates(clubId: string): Promise<ClubTeamTypeState[]> {
  const supabase = await createClient()
  const { data } = await supabase.from("teams").select("canonical_team_type_id, active").eq("club_id", clubId).not("canonical_team_type_id", "is", null)
  return (data ?? []).map((t) => ({ canonicalTeamTypeId: t.canonical_team_type_id as string, state: t.active ? ("active" as const) : ("inactive" as const) }))
}
