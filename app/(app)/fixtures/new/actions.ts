"use server"

import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

export type CreateRequestResult = { ok: true } | { ok: false; error: string }

export interface TeamRequestInput {
  teamId: string
  venuePreference: "home" | "away" | "either"
  preferredKickoffTime: string | null
  note: string | null
  /**
   * Set only when this request already names a specific opposing team --
   * e.g. arrived from a partner club's "view availability" screen for that
   * team. Left null for the normal flow, where the responding side
   * resolves target_team_id themselves on accept (see
   * accept_fixture_request).
   */
  targetTeamId?: string | null
}

export interface CreateFixtureRequestInput {
  requestingClubId: string
  opponentDirectoryId: string
  opponentClubId: string | null
  rawOpponentText: string
  proposedDate: string
  notes: string | null
  teams: TeamRequestInput[]
}

/**
 * Creates one fixture_request_groups row and one fixture_requests row per
 * selected team -- never one record standing in for a multi-team batch
 * (each team stays independently trackable/answerable, see the migration
 * comment). RLS (fixture_request_groups_insert_scoped /
 * fixture_requests_insert_scoped) is the real authorization boundary; this
 * action does not check permissions itself.
 */
export async function createFixtureRequest(input: CreateFixtureRequestInput): Promise<CreateRequestResult> {
  if (input.teams.length === 0) {
    return { ok: false, error: "Select at least one team." }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in." }

  const { data: group, error: groupError } = await supabase
    .from("fixture_request_groups")
    .insert({
      requesting_club_id: input.requestingClubId,
      opponent_directory_id: input.opponentDirectoryId,
      opponent_club_id: input.opponentClubId,
      raw_opponent_text: input.rawOpponentText,
      proposed_date: input.proposedDate,
      notes: input.notes,
      created_by: user.id,
    })
    .select("id")
    .single()

  if (groupError || !group) {
    return { ok: false, error: groupError?.message ?? "Could not create the request." }
  }

  const { error: requestsError } = await supabase.from("fixture_requests").insert(
    input.teams.map((t) => ({
      group_id: group.id,
      requesting_team_id: t.teamId,
      target_team_id: t.targetTeamId ?? null,
      venue_preference: t.venuePreference,
      preferred_kickoff_time: t.preferredKickoffTime,
      note: t.note,
      status: "sent" as const,
      created_by: user.id,
    }))
  )

  if (requestsError) {
    return { ok: false, error: requestsError.message }
  }

  redirect("/fixtures")
}
