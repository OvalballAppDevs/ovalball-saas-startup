"use server"

import { revalidatePath } from "next/cache"

import { requireEditionOrganiser, resolveOrganiserScope } from "@/lib/competitions/organiser-scope"
import type { CompetitionFormat, DraftMatchInput, KnockoutSettings, LeagueSettings } from "@/lib/competitions/workspace-types"
import { loadClubCatalogue, type ClubCatalogueEntry } from "@/lib/fixtures/club-catalogue"
import { fullTeamLabel } from "@/lib/teams/compact-label"
import { createClient } from "@/lib/supabase/server"

/**
 * THE COMPETITION CREATOR'S WRITES.
 *
 * Every write is a canonical RPC over Competition Match records, which
 * enforces organiser authority itself (internal.require_edition_organiser).
 * These actions add the active-context half (lib/competitions/organiser-scope.ts)
 * and say what happened in a sentence. Nothing here writes a fixture: issuing
 * projects matches into club fixtures through the one sync service, and only
 * for Ovalball clubs, who are asked to confirm.
 */

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

function refresh(editionId: string) {
  revalidatePath(`/fixtures/competitions/${editionId}`, "layout")
  revalidatePath("/fixtures/competitions")
}

function message(error: { message: string } | null, fallback: string): string {
  return error?.message?.trim() || fallback
}

// ---------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------

export interface CompetitionDetailsInput {
  name: string
  /** Required to create: never assumed, because Union and League catalogues are isolated. */
  rugbyCode: "union" | "league" | null
  /** Optional at creation: the code's current canonical season when not chosen. */
  seasonId?: string | null
  canonicalTeamTypeId: string | null
  format: CompetitionFormat | null
  teamCount: number | null
  organiserName: string | null
}

export async function createCompetitionFromDetails(input: CompetitionDetailsInput): Promise<Result<{ editionId: string | null; notice: string | null }>> {
  const scope = await resolveOrganiserScope()
  if (!scope) return { ok: false, error: "Competitions are organised by Site Admin or a club's fixture administrators." }
  const name = input.name.trim()
  if (!name) return { ok: false, error: "Give the competition a name." }
  if (input.rugbyCode !== "union" && input.rugbyCode !== "league") return { ok: false, error: "Choose Union or League." }
  const rugbyCode = input.rugbyCode
  if (input.teamCount !== null && (input.teamCount < 2 || input.teamCount > 128)) return { ok: false, error: "A competition has between 2 and 128 teams." }

  let created: { competition_id: string; edition_id: string | null; needs_attention: string | null } | undefined
  if (scope.siteAdmin) {
    const { data, error } = await scope.supabase.rpc("quick_create_competition", { p_name: name, p_rugby_code: rugbyCode, p_season_id: (input.seasonId ?? undefined) as string })
    if (error) return { ok: false, error: message(error, "The competition could not be created.") }
    created = data?.[0]
  } else {
    if (scope.clubRugbyCode && scope.clubRugbyCode !== rugbyCode) return { ok: false, error: "A club organises competitions in its own rugby code." }
    const { data, error } = await scope.supabase.rpc("create_club_competition", { p_name: name, p_rugby_code: rugbyCode, p_organiser_club_id: scope.clubId!, p_season_id: (input.seasonId ?? undefined) as string })
    if (error) return { ok: false, error: message(error, "The competition could not be created.") }
    created = data?.[0]
  }
  if (!created) return { ok: false, error: "The competition could not be created." }

  const { error: metaError } = await scope.supabase.rpc("update_competition_metadata", {
    p_competition_id: created.competition_id,
    p_canonical_team_type_id: input.canonicalTeamTypeId as string,
    p_format: input.format ?? "",
    p_organiser_name: input.organiserName ?? "",
    p_team_count: input.teamCount as number,
  })
  if (metaError) return { ok: false, error: message(metaError, "The competition was created, but its details could not be saved.") }
  revalidatePath("/fixtures/competitions")
  revalidatePath("/admin/competitions")
  return { ok: true, editionId: created.edition_id, notice: created.needs_attention }
}

export async function saveCompetitionDetails(editionId: string, input: Omit<CompetitionDetailsInput, "name" | "rugbyCode">): Promise<Result> {
  const auth = await requireEditionOrganiser(editionId)
  if (!auth.ok) return auth
  const { error } = await auth.scope.supabase.rpc("update_competition_metadata", {
    p_competition_id: auth.competitionId,
    p_canonical_team_type_id: input.canonicalTeamTypeId as string,
    p_format: input.format ?? "",
    p_organiser_name: input.organiserName ?? "",
    p_team_count: input.teamCount as number,
  })
  if (error) return { ok: false, error: message(error, "The details could not be saved.") }
  refresh(editionId)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

export async function competitionClubCatalogue(editionId: string): Promise<ClubCatalogueEntry[]> {
  const auth = await requireEditionOrganiser(editionId)
  if (!auth.ok) return []
  const { data: edition } = await auth.scope.supabase.from("competition_editions").select("rugby_code").eq("id", editionId).maybeSingle()
  if (!edition) return []
  return loadClubCatalogue(auth.scope.supabase, edition.rugby_code)
}

export interface CompetitionTeamOption {
  id: string
  label: string
  canonicalTeamTypeId: string | null
}

/** An Ovalball club's teams in the competition's code -- real teams, or none. */
export async function competitionClubTeams(editionId: string, clubId: string): Promise<CompetitionTeamOption[]> {
  const auth = await requireEditionOrganiser(editionId)
  if (!auth.ok) return []
  const { data: edition } = await auth.scope.supabase.from("competition_editions").select("rugby_code").eq("id", editionId).maybeSingle()
  const { data } = await auth.scope.supabase
    .from("teams")
    .select("id, rugby_code, category, age_group, gender, squad_designation, canonical_team_type_id")
    .eq("club_id", clubId)
    .eq("rugby_code", edition?.rugby_code ?? "union")
    .eq("active", true)
    .order("category")
    .order("age_group")
  return (data ?? []).map((t) => ({
    id: t.id,
    label: fullTeamLabel({ category: t.category, ageGroup: t.age_group, gender: t.gender, squadDesignation: t.squad_designation, rugbyCode: t.rugby_code }),
    canonicalTeamTypeId: t.canonical_team_type_id,
  }))
}

export interface ParticipantEntry {
  id: string | null
  slot: number
  clubDirectoryId: string
  clubId: string | null
  teamId: string | null
  seed: number | null
}

export async function saveParticipants(editionId: string, entries: ParticipantEntry[]): Promise<Result> {
  const auth = await requireEditionOrganiser(editionId)
  if (!auth.ok) return auth
  const { error } = await auth.scope.supabase.rpc("save_competition_participants", {
    p_edition_id: editionId,
    p_entries: entries.map((e) => ({
      id: e.id ?? "",
      slot: e.slot,
      club_directory_id: e.clubDirectoryId,
      club_id: e.clubId ?? "",
      team_id: e.teamId ?? "",
      seed: e.seed ?? "",
    })),
  })
  if (error) return { ok: false, error: message(error, "The participants could not be saved.") }
  refresh(editionId)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Stages, groups, rounds and draft matches
// ---------------------------------------------------------------------------

export async function saveStage(
  editionId: string,
  input: { stageId: string | null; kind: "league" | "knockout"; name: string; sortOrder: number; settings: LeagueSettings & KnockoutSettings; groups: { name: string; members: string[] }[] | null },
): Promise<Result<{ stageId: string }>> {
  const auth = await requireEditionOrganiser(editionId)
  if (!auth.ok) return auth
  const { data, error } = await auth.scope.supabase.rpc("save_competition_stage", {
    p_edition_id: editionId,
    p_stage_id: input.stageId as string,
    p_kind: input.kind,
    p_name: input.name,
    p_sort_order: input.sortOrder,
    p_settings: input.settings as never,
    p_groups: input.groups as never,
  })
  if (error || !data) return { ok: false, error: message(error, "The stage could not be saved.") }
  refresh(editionId)
  return { ok: true, stageId: data as string }
}

/** Replaces a stage's draft matches -- all of them, one group's, or one round's. Issued matches are never touched. */
export async function replaceDraftMatches(
  editionId: string,
  stageId: string,
  matches: DraftMatchInput[],
  scope: { groupId?: string | null; roundNumber?: number | null } = {},
  rounds?: { roundNumber: number; name: string | null; roundDate: string | null }[],
): Promise<Result<{ removed: number; added: number; keptIssued: number }>> {
  const auth = await requireEditionOrganiser(editionId)
  if (!auth.ok) return auth
  const supabase = auth.scope.supabase
  if (rounds) {
    const { error } = await supabase.rpc("save_competition_rounds", {
      p_stage_id: stageId,
      p_rounds: rounds.map((r) => ({ round_number: r.roundNumber, name: r.name ?? "", round_date: r.roundDate ?? "" })) as never,
    })
    if (error) return { ok: false, error: message(error, "The rounds could not be saved.") }
  }
  const { data, error } = await supabase.rpc("replace_competition_draft_matches", {
    p_stage_id: stageId,
    p_matches: matches.map((m) => ({
      id: m.id ?? "",
      group_id: m.groupId ?? "",
      round_number: m.roundNumber ?? "",
      bracket_slot: m.bracketSlot ?? "",
      home_participant_id: m.homeParticipantId ?? "",
      away_participant_id: m.awayParticipantId ?? "",
      home_source: m.homeSource ?? null,
      away_source: m.awaySource ?? null,
      match_date: m.matchDate ?? "",
      kickoff_time: m.kickoffTime ?? "",
      venue_id: m.venueId ?? "",
      venue_text: m.venueText ?? "",
      pitch_id: m.pitchId ?? "",
    })) as never,
    p_group_id: (scope.groupId ?? undefined) as string,
    p_round_number: (scope.roundNumber ?? undefined) as number,
  })
  if (error) return { ok: false, error: message(error, "The draft fixtures could not be saved.") }
  refresh(editionId)
  const counts = (data ?? {}) as { removed?: number; added?: number; kept_issued?: number }
  return { ok: true, removed: counts.removed ?? 0, added: counts.added ?? 0, keptIssued: counts.kept_issued ?? 0 }
}

export interface MatchPatch {
  match_date?: string | null
  kickoff_time?: string | null
  venue_id?: string | null
  venue_text?: string | null
  pitch_id?: string | null
  home_participant_id?: string | null
  away_participant_id?: string | null
  round_number?: number | null
  notes?: string | null
  is_public?: boolean
}

export async function updateMatch(editionId: string, matchId: string, patch: MatchPatch): Promise<Result> {
  const auth = await requireEditionOrganiser(editionId)
  if (!auth.ok) return auth
  const body = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === null ? "" : v]))
  const { error } = await auth.scope.supabase.rpc("update_competition_match", { p_match_id: matchId, p_patch: body as never })
  if (error) return { ok: false, error: message(error, "The match could not be saved.") }
  refresh(editionId)
  return { ok: true }
}

/** Several match changes as one: a swap between two matches, or every knockout place filled from the tables. All or nothing. */
export async function updateMatches(editionId: string, patches: { id: string; patch: MatchPatch }[]): Promise<Result<{ changed: number }>> {
  const auth = await requireEditionOrganiser(editionId)
  if (!auth.ok) return auth
  if (patches.length === 0) return { ok: true, changed: 0 }
  const body = patches.map(({ id, patch }) => ({ id, patch: Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === null ? "" : v])) }))
  const { data, error } = await auth.scope.supabase.rpc("update_competition_matches", { p_edition_id: editionId, p_patches: body as never })
  if (error) return { ok: false, error: message(error, "The matches could not be saved.") }
  refresh(editionId)
  return { ok: true, changed: (data as number | null) ?? patches.length }
}

export async function deleteDraftMatch(editionId: string, matchId: string): Promise<Result> {
  const auth = await requireEditionOrganiser(editionId)
  if (!auth.ok) return auth
  const { error } = await auth.scope.supabase.rpc("delete_competition_draft_match", { p_match_id: matchId })
  if (error) return { ok: false, error: message(error, "The match could not be removed.") }
  refresh(editionId)
  return { ok: true }
}

export async function recordResult(editionId: string, matchId: string, home: number, away: number, winnerId: string | null): Promise<Result> {
  const auth = await requireEditionOrganiser(editionId)
  if (!auth.ok) return auth
  const { error } = await auth.scope.supabase.rpc("record_competition_match_result", {
    p_match_id: matchId,
    p_home_score: home,
    p_away_score: away,
    p_winner_participant_id: (winnerId ?? undefined) as string,
  })
  if (error) return { ok: false, error: message(error, "The result could not be recorded.") }
  refresh(editionId)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Issue and lifecycle
// ---------------------------------------------------------------------------

export async function issueMatches(editionId: string, matchIds: string[] | null): Promise<Result<{ summary: Record<string, number> }>> {
  const auth = await requireEditionOrganiser(editionId)
  if (!auth.ok) return auth
  const { data, error } = await auth.scope.supabase.rpc("issue_competition_matches", { p_edition_id: editionId, p_match_ids: (matchIds ?? undefined) as string[] })
  if (error) return { ok: false, error: message(error, "The fixtures could not be issued.") }
  refresh(editionId)
  return { ok: true, summary: (data ?? {}) as Record<string, number> }
}

export async function cancelMatch(editionId: string, matchId: string, status: "cancelled" | "postponed", reason: string): Promise<Result> {
  const auth = await requireEditionOrganiser(editionId)
  if (!auth.ok) return auth
  const { error } = await auth.scope.supabase.rpc("cancel_competition_match", { p_match_id: matchId, p_status: status, p_reason: reason })
  if (error) return { ok: false, error: message(error, "The match could not be changed.") }
  refresh(editionId)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// A club answering a competition match (the requests inbox)
// ---------------------------------------------------------------------------

export async function respondToCompetitionMatch(input: {
  verificationId: string
  response: "confirmed" | "change_requested" | "declined"
  message: string | null
  proposedDate: string | null
  proposedKickoff: string | null
  proposedVenueId?: string | null
  proposedPitchId?: string | null
}): Promise<Result> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sign in to answer this request." }
  if (input.response !== "confirmed" && !input.message?.trim()) return { ok: false, error: "Say what needs to change, so the organiser can act on it." }
  const { error } = await supabase.rpc("respond_competition_match", {
    p_verification_id: input.verificationId,
    p_response: input.response,
    p_message: (input.message ?? undefined) as string,
    p_proposed_date: (input.proposedDate ?? undefined) as string,
    p_proposed_kickoff_time: (input.proposedKickoff ?? undefined) as string,
    p_proposed_venue_id: (input.proposedVenueId ?? undefined) as string,
    p_proposed_pitch_id: (input.proposedPitchId ?? undefined) as string,
  })
  if (error) return { ok: false, error: message(error, "Your answer could not be saved.") }
  revalidatePath("/fixtures/competitions/requests")
  return { ok: true }
}
