import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import type { TournamentCentreContext, TournamentGame } from "@/lib/tournaments/view-model"

export type {
  CombinedScheduleRow,
  TournamentCentreContext,
  TournamentEntry,
  TournamentGame,
  TournamentInvitation,
  TournamentOpponent,
  TournamentPitchReservation,
} from "@/lib/tournaments/view-model"
export { combinedSchedule, formatTournamentDateRange } from "@/lib/tournaments/view-model"

/**
 * TOURNAMENT CENTRE'S ONE SERVER-DERIVED VIEW MODEL.
 *
 * ONE SHARED ROLE-AWARE SURFACE. The role is resolved here and arrives as
 * capability flags on the payload -- `canManageTournament` for the occasion,
 * `canManageEntry` per attending team. Components read those flags; they never
 * work authority out for themselves, and there is no Parent, Player, Team
 * Admin or Club Admin Tournament Centre. A redesign therefore reaches every
 * viewer, because they all consume the same components.
 *
 * ONE ROUND TRIP. public.get_tournament_centre returns the whole occasion --
 * entries, each entry's own opponents, each entry's own games, and the pitch
 * reservations -- as one document. No query per opponent, game, pitch or team.
 *
 * PRIVACY IS FILTERED BEFORE RENDER. The RPC returns null for a tournament the
 * viewer may not see, so an unauthorised page never receives the payload to
 * hide in React.
 */

function publicLogoUrl(supabase: SupabaseClient<Database>, path: string | null | undefined): string | null {
  return path ? supabase.storage.from("club-logos").getPublicUrl(path).data.publicUrl : null
}

/**
 * A club's own uploaded crest wins over the Club Directory's seed crest --
 * the same single rule lib/app-context/club-logo.ts states for every other
 * surface, applied here to the raw paths the RPC returns rather than
 * re-derived into a second answer.
 */
function crest(supabase: SupabaseClient<Database>, row: { clubLogoPath?: string | null; directoryLogoPath?: string | null }): string | null {
  return publicLogoUrl(supabase, row.clubLogoPath ?? row.directoryLogoPath ?? null)
}

export async function getTournamentCentre(
  supabase: SupabaseClient<Database>,
  tournamentId: string
): Promise<TournamentCentreContext | null> {
  const { data, error } = await supabase.rpc("get_tournament_centre", { p_tournament_id: tournamentId })
  if (error || !data) return null
  const raw = data as Record<string, unknown>

  const entries = ((raw.entries as Record<string, unknown>[]) ?? []).map((e) => ({
    id: e.id as string,
    teamId: e.teamId as string,
    clubId: e.clubId as string,
    teamName: e.teamName as string,
    ageGroup: (e.ageGroup as string | null) ?? null,
    clubName: e.clubName as string,
    logoUrl: crest(supabase, e as { clubLogoPath?: string | null; directoryLogoPath?: string | null }),
    canManageEntry: Boolean(e.canManageEntry),
    isMine: Boolean(e.isMine),
    opponents: ((e.opponents as Record<string, unknown>[]) ?? []).map((o) => ({
      id: o.id as string,
      participantId: o.participantId as string,
      clubName: o.clubName as string,
      logoUrl: crest(supabase, o as { clubLogoPath?: string | null; directoryLogoPath?: string | null }),
      teamTypeLabel: o.teamTypeLabel as string,
      status: o.status as string,
    })),
    games: ((e.games as Record<string, unknown>[]) ?? []).map((g) => ({
      id: g.id as string,
      opponentId: g.opponentId as string,
      opponentClubName: g.opponentClubName as string,
      gameDate: g.gameDate as string,
      startTime: (g.startTime as string | null) ?? null,
      durationMinutes: (g.durationMinutes as number | null) ?? null,
      pitchId: (g.pitchId as string | null) ?? null,
      pitchName: (g.pitchName as string | null) ?? null,
      status: (g.status as TournamentGame["status"]) ?? "SCHEDULED",
      ourScore: (g.ourScore as number | null) ?? null,
      opponentScore: (g.opponentScore as number | null) ?? null,
    })),
  }))

  const startsOn = raw.startsOn as string
  const endsOn = raw.endsOn as string

  return {
    id: raw.id as string,
    name: raw.name as string,
    rugbyCode: raw.rugbyCode as "union" | "league",
    startsOn,
    endsOn,
    isMultiDay: endsOn > startsOn,
    status: raw.status as string,
    cancelled: Boolean(raw.cancelledAt),
    cancellationReason: (raw.cancellationReason as string | null) ?? null,
    notes: (raw.notes as string | null) ?? null,
    venueNotes: (raw.venueNotes as string | null) ?? null,
    seasonName: (raw.seasonName as string | null) ?? null,
    hostName: (raw.hostName as string | null) ?? null,
    hostClubId: (raw.hostClubId as string | null) ?? null,
    venue: (raw.venue as TournamentCentreContext["venue"]) ?? null,
    canManageTournament: Boolean(raw.canManageTournament),
    invitations: ((raw.invitations as Record<string, unknown>[]) ?? []).map((i) => ({
      participantId: i.participantId as string,
      clubName: i.clubName as string,
      teamTypeLabel: i.teamTypeLabel as string,
      status: i.status as string,
    })),
    entries,
    pitches: ((raw.pitches as Record<string, unknown>[]) ?? []).map((p) => ({
      id: p.id as string,
      pitchId: p.pitchId as string,
      pitchName: p.pitchName as string,
      reservedOn: p.reservedOn as string,
      startTime: p.startTime as string,
      endTime: p.endTime as string,
    })),
  }
}

