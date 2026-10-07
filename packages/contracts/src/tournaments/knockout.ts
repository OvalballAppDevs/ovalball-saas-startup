import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

/**
 * A KNOCKOUT COMPETITION'S DRAW.
 *
 * A thin typed wrapper over the bracket read and the draw's governed writes. NOTHING IS DECIDED HERE:
 * the pairing rule, the bye arithmetic, the labels in the empty places and the progression of a winner
 * are all the database's, so a phone draws a bracket and never works one out.
 *
 * ---- THE ONE THING TO UNDERSTAND ABOUT THIS SHAPE ------------------------------------------------
 *
 * A place in a bracket is either a SIDE or a SENTENCE. Before a quarter-final is played, the semi-final
 * place above it is "Winner QF1" -- a description of what will fill it, with no participant, no club
 * and no crest. `unresolved` says which kind a place is, and a screen that drew a crest for an
 * unresolved place would be inventing a team.
 *
 * A BYE IS NOT A GAME and does not appear among them. It comes back in `byes`: the side, and the round
 * it is already through to.
 */

export type DrawMethod = "random" | "manual" | "seeded"
export type TieResolution = "none" | "golden_point" | "organiser_decision"

export interface BracketSide {
  /** Null where nobody has reached this place yet. */
  participantId: string | null
  clubName: string | null
  /** A storage path, resolved by the caller through the canonical club-logo helper. */
  crestPath: string | null
  /**
   * The canonical team name where a side is here, or the sentence that describes the place --
   * "Winner QF1", "Loser SF1", "BYE". Never a club that does not exist.
   */
  label: string | null
  isHost: boolean
  onOvalball: boolean
  score: number | null
  isWinner: boolean
  /** True where this is still a sentence rather than a side. */
  unresolved?: boolean
}

export interface BracketGame {
  pairingId: string
  position: number
  /** Null until both sides are real -- there is no game row to point at before then. */
  gameId: string | null
  date: string | null
  startTime: string | null
  pitchName: string | null
  status: string
  resultStatus: string
  winnerParticipantId: string | null
  /**
   * A settled result that produced no winner -- a level game the competition has not decided. The
   * bracket stops here, and says so rather than looking merely unfinished.
   */
  needsWinner: boolean
  sideA: BracketSide
  sideB: BracketSide
}

export interface BracketRound {
  round: number
  isThirdPlace: boolean
  /** "Quarter Finals", "Semi Finals", "Final" -- from how many rounds are left. */
  name: string
  /** "QF", "SF", "Final" -- the short form the dependency labels are built from. */
  code: string
  games: BracketGame[]
}

export interface BracketBye {
  participantId: string
  side: Omit<BracketSide, "score" | "isWinner" | "unresolved">
  advancesToRound: number
  advancesToName: string
}

export interface TournamentBracket {
  tournamentId: string
  tournamentName: string
  ageGroup: string
  planId: string | null
  publicationState: "DRAFT" | "PUBLISHED" | "SUPERSEDED" | null
  published: boolean
  canManage: boolean
  /** Whether scores may be shown, from the tournament's own result visibility. */
  showsScores: boolean
  bracketSize: number
  roundCount: number
  thirdPlacePlayoff: boolean
  rounds: BracketRound[]
  /** Sides through without a game. Deliberately not among the games: a bye is not a fixture. */
  byes: BracketBye[]
  /**
   * THE DRAW IN THE FORM `setBracketDraw` ACCEPTS -- participant ids in SEED order, which is NOT the
   * order the games appear in. The bracket's places are arranged by the seeding map (an eight-place
   * bracket plays 1v8, 4v5, 2v7, 3v6), so rearranging the draw from the games would express a swap in
   * the wrong terms and re-permute every side. Read a rearrangement from here and write it straight
   * back.
   */
  drawOrder: string[]
}

export async function readTournamentBracket(
  supabase: SupabaseClient<Database>,
  tournamentId: string,
  ageGroup: string
): Promise<TournamentBracket | null> {
  const { data, error } = await supabase.rpc("get_tournament_bracket", {
    p_tournament_id: tournamentId,
    p_age_group: ageGroup,
  })
  if (error) throw error
  return (data as unknown as TournamentBracket | null) ?? null
}

/** Redraws the WHOLE bracket. Shuffling one corner is not a random draw, it is a random corner. */
export async function randomiseBracket(supabase: SupabaseClient<Database>, planId: string): Promise<number> {
  const { data, error } = await supabase.rpc("randomise_tournament_bracket", { p_plan_id: planId })
  if (error) throw error
  return (data as unknown as number) ?? 0
}

/**
 * THE ORGANISER'S OWN ARRANGEMENT, in seed order: the first id is seed 1.
 *
 * Swapping two sides is this call with two entries exchanged -- which is why there is no separate swap
 * endpoint. One way to write a draw means one place for it to be validated, and the server refuses a
 * draw that loses a side, repeats one, or seats a club from another competition.
 */
export async function setBracketDraw(
  supabase: SupabaseClient<Database>,
  planId: string,
  sidesInSeedOrder: string[],
  method: DrawMethod = "manual"
): Promise<number> {
  const { data, error } = await supabase.rpc("set_tournament_bracket_draw", {
    p_plan_id: planId,
    p_sides: sidesInSeedOrder,
    p_draw_method: method,
  })
  if (error) throw error
  return (data as unknown as number) ?? 0
}

export async function setKnockoutSettings(
  supabase: SupabaseClient<Database>,
  planId: string,
  settings: {
    drawMethod?: DrawMethod
    extraTimeMinutes?: number | null
    tieResolution?: TieResolution
    thirdPlacePlayoff?: boolean
  }
): Promise<void> {
  const { error } = await supabase.rpc("set_tournament_knockout_settings", {
    p_plan_id: planId,
    p_draw_method: settings.drawMethod,
    p_extra_time_minutes: settings.extraTimeMinutes ?? undefined,
    p_tie_resolution: settings.tieResolution,
    p_third_place_playoff: settings.thirdPlacePlayoff,
  })
  if (error) throw error
}

/** Which of the competition's own days each round is played on. The scheduler still owns time and pitch. */
export async function setRoundDays(
  supabase: SupabaseClient<Database>,
  planId: string,
  rounds: { round: number; day: string }[]
): Promise<void> {
  const { error } = await supabase.rpc("set_tournament_round_days", {
    p_plan_id: planId,
    p_rounds: rounds as never,
  })
  if (error) throw error
}

export async function generateKnockoutFixtures(
  supabase: SupabaseClient<Database>,
  planId: string
): Promise<number> {
  const { data, error } = await supabase.rpc("generate_tournament_knockout_fixtures", { p_plan_id: planId })
  if (error) throw error
  return (data as unknown as number) ?? 0
}

/** The organiser records who went through a game the score left level. */
export async function declareGameWinner(
  supabase: SupabaseClient<Database>,
  gameId: string,
  participantId: string,
  reason: string
): Promise<void> {
  const { error } = await supabase.rpc("declare_tournament_game_winner", {
    p_game_id: gameId,
    p_participant_id: participantId,
    p_reason: reason,
  })
  if (error) throw error
}

/* ---- reading it back ------------------------------------------------------------------------------ */

/** Is this competition played as a bracket -- which is what replaces Tables with Draw. */
export function formatHasBracket(format: string | null | undefined): boolean {
  return format === "knockout"
}

/**
 * WHETHER A COMPETITION HAS A KNOCKOUT STAGE -- a Draw to read -- as opposed to whether it IS a draw.
 * A Hybrid has both: its group tables (arranged like a round robin's) and a knockout stage fed by them.
 */
export function formatHasKnockoutStage(format: string | null | undefined): boolean {
  return format === "knockout" || format === "hybrid"
}

export const TIE_RESOLUTIONS: { key: TieResolution; label: string; blurb: string }[] = [
  {
    key: "golden_point",
    label: "Golden point (first score wins)",
    blurb: "The game ends the moment a side scores, so the recorded score decides it.",
  },
  {
    key: "organiser_decision",
    label: "Organiser decides",
    blurb: "The organiser records who went through, and why. Use this for kicks at goal.",
  },
  {
    key: "none",
    label: "Not settled",
    blurb: "A drawn game has no winner and the bracket waits.",
  },
]

export function tieResolutionLabel(key: TieResolution): string {
  return TIE_RESOLUTIONS.find((t) => t.key === key)?.label ?? key
}

/*
 * HOW ONE GAME IS NAMED -- "Quarter Final", not "Quarter Finals" -- belongs to the server, which writes
 * it onto the result as `roundName` (`internal.bracket_game_name`). A client helper that stripped the
 * "s" off the column heading was a second definition of the same fact, and the two could drift.
 */

/** A place nobody has reached yet reads as its sentence; a side reads as its club. */
export function bracketSideText(side: BracketSide): string {
  if (side.unresolved) return side.label ?? "To be decided"
  return side.clubName ?? side.label ?? "To be decided"
}
