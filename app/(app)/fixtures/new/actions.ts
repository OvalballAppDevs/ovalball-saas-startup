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
  /**
   * Named ONLY when the opponent has no matching existing team to pick
   * (targetTeamId stays null) -- a structured identity (age group +
   * Boys/Girls + optional squad), never free text, never Mixed/Men's/
   * Women's. The recipient can later choose to create exactly this team
   * (create_missing_target_team) -- never automatic, never on arrival.
   */
  targetTeamAgeGroup?: string | null
  targetTeamGender?: "boys" | "girls" | null
  targetTeamSquadDesignation?: string | null
  /** Only meaningful when venuePreference is "home" -- see fixture_requests.pitch_id's own comment. Carried onto the resulting fixture by accept_fixture_request only when this side ends up Home. */
  pitchId?: string | null
  /** Only meaningful when venuePreference is "home" -- see fixture_requests.venue_id's own comment. Carried onto the resulting fixture by accept_fixture_request only when this side ends up Home. */
  venueId?: string | null
}

export interface CreateFixtureRequestInput {
  requestingClubId: string
  /** Null when the opponent resolved to a real matched team on an already-activated club (OpponentPicker/OpponentResolver only populate a directory id for the unactivated-club fallback path) -- never send "" for a nullable uuid column. */
  opponentDirectoryId: string | null
  opponentClubId: string | null
  rawOpponentText: string
  proposedDate: string
  notes: string | null
  teams: TeamRequestInput[]
  /** Proposed once per group, carried onto the resulting fixtures row on accept (20260905100000). Optional -- either side can still set/change it after acceptance. */
  gameType?: string | null
  competitionEditionId?: string | null
  /** The full-page /fixtures/new flow redirects to /fixtures on success; a popup caller (Calendar's empty-slot Create Fixture dialog) sets this to skip that and close itself instead. */
  skipRedirect?: boolean
  /** Provenance only -- omitted (-> null) for every ordinary caller. Set to "ovie_assistant" by lib/ovie/orchestrator.ts when Ovie drafted this request on the real signed-in user's behalf; created_by above remains the sole record of WHO acted. See fixture_request_groups.source's own column comment. */
  source?: "ovie_assistant"
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
      opponent_directory_id: input.opponentDirectoryId || null,
      opponent_club_id: input.opponentClubId,
      raw_opponent_text: input.rawOpponentText,
      proposed_date: input.proposedDate,
      notes: input.notes,
      game_type: input.gameType ?? null,
      competition_edition_id: input.competitionEditionId ?? null,
      created_by: user.id,
      source: input.source ?? null,
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
      target_team_age_group: t.targetTeamId ? null : (t.targetTeamAgeGroup ?? null),
      target_team_gender: t.targetTeamId ? null : (t.targetTeamGender ?? null),
      target_team_squad_designation: t.targetTeamId ? null : (t.targetTeamSquadDesignation ?? null),
      venue_preference: t.venuePreference,
      preferred_kickoff_time: t.preferredKickoffTime,
      pitch_id: t.venuePreference === "home" ? (t.pitchId ?? null) : null,
      venue_id: t.venuePreference === "home" ? (t.venueId ?? null) : null,
      note: t.note,
      status: "sent" as const,
      created_by: user.id,
    }))
  )

  if (requestsError) {
    return { ok: false, error: requestsError.message }
  }

  if (input.skipRedirect) {
    return { ok: true }
  }
  redirect("/fixtures")
}
