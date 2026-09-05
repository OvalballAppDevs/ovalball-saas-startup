"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type TournamentActionResult = { ok: true; id?: string } | { ok: false; error: string }

/** Thin wrappers around the tournament RPCs (20260904900000_tournament_architecture.sql) -- all authorization/eligibility/uniqueness enforcement lives in those RPCs, never here. */

export async function createTournamentAction(input: {
  hostTeamId: string
  eventDate: string
  kickoffTime: string | null
  pitchId: string | null
  competitionEditionId: string | null
  venueNotes: string | null
  notes: string | null
}): Promise<TournamentActionResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_tournament", {
    p_host_team_id: input.hostTeamId,
    p_event_date: input.eventDate,
    p_kickoff_time: input.kickoffTime ?? undefined,
    p_pitch_id: input.pitchId ?? undefined,
    p_competition_edition_id: input.competitionEditionId ?? undefined,
    p_venue_notes: input.venueNotes ?? undefined,
    p_notes: input.notes ?? undefined,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/calendar")
  revalidatePath("/calendar/agenda")
  return { ok: true, id: data as string }
}

export async function proposeTournamentAtHostAction(input: {
  proposedHostDirectoryId: string
  proposingTeamId: string
  eventDate: string
  kickoffTime: string | null
  notes: string | null
}): Promise<TournamentActionResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("propose_tournament_at_host", {
    p_proposed_host_directory_id: input.proposedHostDirectoryId,
    p_proposing_team_id: input.proposingTeamId,
    p_event_date: input.eventDate,
    p_kickoff_time: input.kickoffTime ?? undefined,
    p_notes: input.notes ?? undefined,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/calendar")
  revalidatePath("/calendar/agenda")
  return { ok: true, id: data as string }
}

export async function claimTournamentHostAction(tournamentId: string, hostTeamId: string): Promise<TournamentActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("claim_tournament_host", { p_tournament_id: tournamentId, p_host_team_id: hostTeamId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/calendar")
  revalidatePath("/calendar/agenda")
  return { ok: true }
}

export async function inviteTournamentParticipantAction(input: {
  tournamentId: string
  clubDirectoryId: string
  canonicalTeamTypeId: string
}): Promise<TournamentActionResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("invite_tournament_participant", {
    p_tournament_id: input.tournamentId,
    p_club_directory_id: input.clubDirectoryId,
    p_canonical_team_type_id: input.canonicalTeamTypeId,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/calendar")
  revalidatePath("/calendar/agenda")
  return { ok: true, id: data as string }
}

export async function respondTournamentInvitationAction(participantId: string, accept: boolean): Promise<TournamentActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("respond_tournament_invitation", { p_participant_id: participantId, p_accept: accept })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/calendar")
  revalidatePath("/calendar/agenda")
  return { ok: true }
}

export async function removeTournamentParticipantAction(participantId: string): Promise<TournamentActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("remove_tournament_participant", { p_participant_id: participantId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/calendar")
  revalidatePath("/calendar/agenda")
  return { ok: true }
}

/**
 * Host-only venue change (Venue instruction, Section 29): same master
 * tournament row, never a new tournament -- update_tournament_venue
 * itself notifies every currently-accepted participant. Never let the
 * host silently reassign it to another club's venue -- the RPC re-checks
 * venue ownership server-side regardless of what this action passes.
 */
export async function updateTournamentVenueAction(tournamentId: string, venueId: string | null): Promise<TournamentActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("update_tournament_venue", { p_tournament_id: tournamentId, p_venue_id: venueId ?? undefined })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/calendar")
  revalidatePath("/calendar/agenda")
  return { ok: true }
}

export interface ClubDirectoryOption {
  directoryId: string
  name: string
  town: string | null
  activated: boolean
  clubId: string | null
}

/** Same public.club_directory search every other opponent picker in this app uses (see app/(app)/fixtures/new/search-opponents.ts). */
export async function searchClubsForTournament(query: string): Promise<ClubDirectoryOption[]> {
  if (query.trim().length < 2) return []
  const supabase = await createClient()
  const { data } = await supabase.from("club_directory").select("id, name, town, clubs(id)").eq("active", true).ilike("name", `%${query.trim()}%`).limit(8)
  return (data ?? []).map((d) => ({ directoryId: d.id, name: d.name, town: d.town, activated: Boolean(d.clubs?.id), clubId: d.clubs?.id ?? null }))
}

export interface CanonicalTeamTypeOption {
  id: string
  label: string
  category: string
  ageGroup: string | null
  gender: string | null
}

/**
 * The Team Directory as an invite-time picker -- only ACTIVE global types,
 * matching every other catalogue-driven selector's rule (loadTeamCategoryGroups's
 * default). Carries category/ageGroup/gender (not just id/label) so a
 * caller can apply the SHARED age/gender eligibility filter
 * (lib/fixtures/eligibility.ts's eligibleOppositionTypes) against real
 * structured fields -- never a fragile "label starts with Girls" string
 * match, which cannot correctly express "a Boys/Mixed host must never be
 * offered a Girls identity at any age."
 */
export async function loadTournamentTeamTypeOptions(): Promise<CanonicalTeamTypeOption[]> {
  const supabase = await createClient()
  const { data } = await supabase.from("canonical_team_types").select("id, label, category, age_group, gender, sort_order").eq("is_active", true).order("sort_order")
  return (data ?? []).map((t) => ({ id: t.id, label: t.label, category: t.category, ageGroup: t.age_group, gender: t.gender }))
}
