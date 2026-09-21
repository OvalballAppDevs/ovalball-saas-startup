import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

/**
 * CONVERGENCE STEP 16 — THE CLUB'S OWN SIDE OF A COMPETITION.
 *
 * Steps 14–15 built the organiser's half. A club taking part could see individual match requests at
 * Competition Requests and had nowhere that answered the obvious question: WHICH COMPETITIONS ARE WE
 * IN, in which season, with which teams, run by whom, and what is outstanding?
 *
 * THIS IS A READ, AND THAT IS THE ARCHITECTURE, NOT A SHORTCUT. `competition_participants.status` is
 * `('entered','withdrawn')` and only the organiser writes it — there is deliberately no club-side
 * consent to *entry*, and tournaments (`respond_tournament_invitation`) are the contrast that proves it
 * is deliberate. The club's canonical act is answering each MATCH, which
 * `respond_competition_match` already does. So nothing here mutates, and no entry-status vocabulary was
 * invented to make the page look symmetrical.
 */

export type OrganiserKind = "BODY" | "CLUB" | "EXTERNAL" | "OVALBALL"

export interface ClubCompetitionEntry {
  competitionId: string
  competitionName: string
  competitionSlug: string
  editionId: string
  seasonName: string
  rugbyCode: string
  format: string | null
  organiserKind: OrganiserKind
  organiserLabel: string
  /** Set when a governing body organises it, so the club can be told which organisation. */
  organiserBodyId: string | null
  enteredTeams: string[]
  enteredCount: number
  awaitingResponse: number
  confirmed: number
  declined: number
  played: number
  totalMatches: number
}

export async function loadClubCompetitionEntries(
  supabase: SupabaseClient<Database>,
  clubId: string
): Promise<ClubCompetitionEntry[]> {
  const { data, error } = await supabase.rpc("club_competition_entries", { p_club_id: clubId })
  if (error || !data) return []
  return data.map((r) => ({
    competitionId: r.competition_id,
    competitionName: r.competition_name,
    competitionSlug: r.competition_slug,
    editionId: r.edition_id,
    seasonName: r.season_name,
    rugbyCode: r.rugby_code,
    format: r.format,
    organiserKind: r.organiser_kind as OrganiserKind,
    organiserLabel: r.organiser_label,
    organiserBodyId: r.organiser_body_id,
    enteredTeams: r.entered_teams ?? [],
    enteredCount: r.entered_count,
    awaitingResponse: r.awaiting_response,
    confirmed: r.confirmed,
    declined: r.declined,
    played: r.played,
    totalMatches: r.total_matches,
  }))
}

/** How the organiser reads to the club taking part — "who runs this", in one phrase. */
export function organiserSentence(e: ClubCompetitionEntry): string {
  switch (e.organiserKind) {
    case "BODY":
      return `Run by ${e.organiserLabel}`
    case "CLUB":
      return `Run by ${e.organiserLabel}`
    case "EXTERNAL":
      return `Run by ${e.organiserLabel}, who are not on Ovalball`
    default:
      return "Run by Ovalball"
  }
}

/**
 * What this club has to DO about a competition, or nothing.
 *
 * Only the states the canonical verification rows actually produce — there is no invented "pending
 * entry", because entry is not a thing a club answers.
 */
export function clubActionSentence(e: ClubCompetitionEntry): string | null {
  if (e.awaitingResponse > 0) {
    return `${e.awaitingResponse} ${e.awaitingResponse === 1 ? "match needs" : "matches need"} your answer`
  }
  if (e.declined > 0) {
    return `${e.declined} ${e.declined === 1 ? "match was" : "matches were"} declined`
  }
  return null
}
