import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

/**
 * A TOURNAMENT RESULT, THROUGH ITS WHOLE LIFE.
 *
 *     no result  --a side submits-->  awaiting confirmation  --the other side agrees-->  CONFIRMED
 *                                                            --the other side differs-->  CONTESTED
 *                                                                                          |
 *                                                               the organiser settles it ---+--> CONFIRMED
 *
 *     against a side that is not on Ovalball  --a side submits-->  RECORDED
 *     CONFIRMED  --a side proposes a change-->  change pending  --the organiser settles it-->  CONFIRMED
 *
 * A thin typed wrapper over `get_tournament_results_overview`, `get_tournament_game_result` and the two
 * write RPCs. NOTHING IS DECIDED HERE. One call -- `submitTournamentGameResult` -- submits, confirms,
 * contests and proposes a change: which of those it is depends on the state of the game and on who
 * submitted last, and the SERVER decides that from its own row rather than from an intent a client
 * sends. The helpers below read the state back so a screen can label its own button correctly; they
 * never change what the call does.
 *
 * WHO SEES WHAT IS NOT A RENDERING DECISION. The overview returns every game to the organiser, only
 * their own games to a participating side, and NOTHING -- not an empty list -- to anybody else. A
 * client is never sent an unsettled score it is then trusted not to draw.
 */

export type TournamentResultStatus =
  | "none"
  | "awaiting_confirmation"
  | "final"
  | "disputed"
  | "amendment_pending"
  /** One side's record of a game the opposition is not on Ovalball to answer. Counts in the table. */
  | "external_recorded"

export type ResultsFilter =
  | "all"
  | "needs_attention"
  | "awaiting_confirmation"
  | "contested"
  | "confirmed"

export type ResultsViewerRole = "host" | "side"

/** Who the viewer is on ONE game. A host club with a side in the game is genuinely both. */
export type GameViewerRole = "host" | "side" | "host_and_side"

export interface ResultSide {
  participantId: string
  clubName: string
  /** The canonical team name. Never invented for this screen. */
  label: string
  /** A storage path, resolved to a URL by the caller through the canonical club-logo helper. */
  crestPath: string | null
  isHost: boolean
  /** False for a side that exists only because an organiser typed its name. */
  onOvalball: boolean
}

export interface ResultsGame {
  id: string
  date: string
  startTime: string | null
  round: number | null
  /**
   * WHAT THIS GAME IS CALLED when the competition is a knockout -- "Quarter Final", "Final",
   * "Third-Place Play-Off". Null on a round robin, which names its games by table and round. Written by
   * the bracket's own naming authority so the draw and the result never disagree.
   */
  roundName: string | null
  /** What the game is in its competition, named by the server: "Table A · Round 2", "Quarter Final",
   * "Tri-Fixture · Game 2". Absent only on an older server. */
  stageLabel?: string | null
  /** Whether its result moves a table -- the competition's own answer, not the format's. */
  countsToTable?: boolean
  tableId: string | null
  tableName: string | null
  pitchName: string | null
  status: string
  resultStatus: TournamentResultStatus
  sideA: ResultSide
  sideB: ResultSide
  sideAScore: number | null
  sideBScore: number | null
  submittedAt: string | null
  submittedBySideId: string | null
  submittedBySideName: string | null
  confirmedAt: string | null
  resolvedAt: string | null
  resolutionReason: string | null
  /** Computed per viewer by the server: the organiser chases and settles, a side answers. */
  needsAttention: boolean
  /** True where one of the two sides is one the viewer can record results for. */
  isMine: boolean
  kickedOff: boolean
}

export interface ResultsCounts {
  all: number
  needsAttention: number
  awaitingConfirmation: number
  contested: number
  confirmed: number
}

export interface TournamentResultsOverview {
  tournamentId: string
  tournamentName: string
  ageGroup: string
  viewerRole: ResultsViewerRole
  /** True where the server narrowed the list to the viewer's own games. Stated, not inferred. */
  sideFilterApplied: boolean
  viewerSideIds: string[]
  submissionEnabled: boolean
  resultsVisibility: ResultsVisibility
  filter: ResultsFilter
  /** Counts over every game the viewer is entitled to, never over the filtered slice. */
  counts: ResultsCounts
  games: ResultsGame[]
}

export type ResultSubmissionKind =
  | "initial"
  | "confirmation"
  | "dispute"
  | "amendment_proposal"
  | "host_resolution"
  | "external_recorded"

export interface ResultSubmission {
  id: string
  kind: ResultSubmissionKind
  sideAScore: number
  sideBScore: number
  note: string | null
  at: string
  bySideId: string | null
  /** The CLUB that said it. A contest is between two clubs, and both their teams are "Under 12 Boys". */
  bySideName: string | null
  /** The team, as context beside the club -- a club may have brought two sides. */
  bySideTeam: string | null
  /** The organiser's own rows carry no side. Named, rather than left as a null to interpret. */
  byHost: boolean
  byViewer: boolean
}

export interface TournamentGameResult {
  id: string
  tournamentId: string
  tournamentName: string
  ageGroup: string
  date: string
  startTime: string | null
  durationMinutes: number | null
  round: number | null
  /**
   * WHAT THIS GAME IS CALLED when the competition is a knockout -- "Quarter Final", "Final",
   * "Third-Place Play-Off". Null on a round robin, which names its games by table and round. Written by
   * the bracket's own naming authority so the draw and the result never disagree.
   */
  roundName: string | null
  /** What the game is in its competition, named by the server: "Table A · Round 2", "Quarter Final",
   * "Tri-Fixture · Game 2". Absent only on an older server. */
  stageLabel?: string | null
  /** Whether its result moves a table -- the competition's own answer, not the format's. */
  countsToTable?: boolean
  tableId: string | null
  tableName: string | null
  pitchName: string | null
  status: string
  resultStatus: TournamentResultStatus
  sideA: ResultSide
  sideB: ResultSide
  sideAScore: number | null
  sideBScore: number | null
  viewerRole: GameViewerRole
  viewerSideId: string | null
  viewerIsSideA: boolean
  submittedAt: string | null
  submittedBySideId: string | null
  confirmedAt: string | null
  resolvedAt: string | null
  resolutionReason: string | null
  kickedOff: boolean
  can: { submit: boolean; resolve: boolean }
  /** Every claim anybody made, oldest first, attributed. A contest IS two rows. */
  submissions: ResultSubmission[]
}

export type ResultsVisibility = "public" | "participants"

export async function readTournamentResultsOverview(
  supabase: SupabaseClient<Database>,
  tournamentId: string,
  ageGroup: string,
  filter: ResultsFilter = "all"
): Promise<TournamentResultsOverview | null> {
  const { data, error } = await supabase.rpc("get_tournament_results_overview", {
    p_tournament_id: tournamentId,
    p_age_group: ageGroup,
    p_filter: filter,
  })
  if (error) throw error
  return (data as unknown as TournamentResultsOverview | null) ?? null
}

export async function readTournamentGameResult(
  supabase: SupabaseClient<Database>,
  gameId: string
): Promise<TournamentGameResult | null> {
  const { data, error } = await supabase.rpc("get_tournament_game_result", { p_game_id: gameId })
  if (error) throw error
  return (data as unknown as TournamentGameResult | null) ?? null
}

/**
 * ONE SIDE RECORDS WHAT IT THINKS THE SCORE WAS.
 *
 * The scores are always SIDE A's and SIDE B'S, in the game's own orientation -- never "ours" and
 * "theirs". A screen that lets a guardian or a coach enter their own score first must map it back
 * before calling this, because the same game is submitted by both sides and only one orientation is
 * the game's.
 */
export async function submitTournamentGameResult(
  supabase: SupabaseClient<Database>,
  gameId: string,
  sideAScore: number,
  sideBScore: number,
  note?: string | null
): Promise<{ status: TournamentResultStatus }> {
  const { data, error } = await supabase.rpc("submit_tournament_game_result", {
    p_game_id: gameId,
    p_side_a_score: sideAScore,
    p_side_b_score: sideBScore,
    p_note: note?.trim() ? note : undefined,
  })
  if (error) throw error
  return data as unknown as { status: TournamentResultStatus }
}

/** The organiser sets the canonical score -- settling a contest, or recording a game for sides that are not on Ovalball. */
export async function resolveTournamentGameResult(
  supabase: SupabaseClient<Database>,
  gameId: string,
  sideAScore: number,
  sideBScore: number,
  reason?: string | null
): Promise<{ status: TournamentResultStatus }> {
  const { data, error } = await supabase.rpc("resolve_tournament_game_result", {
    p_game_id: gameId,
    p_side_a_score: sideAScore,
    p_side_b_score: sideBScore,
    p_reason: reason?.trim() ? reason : undefined,
  })
  if (error) throw error
  return data as unknown as { status: TournamentResultStatus }
}

export async function setTournamentResultsSettings(
  supabase: SupabaseClient<Database>,
  tournamentId: string,
  submissionEnabled: boolean,
  resultsVisibility: ResultsVisibility
): Promise<void> {
  const { error } = await supabase.rpc("set_tournament_results_settings", {
    p_tournament_id: tournamentId,
    p_submission_enabled: submissionEnabled,
    p_results_visibility: resultsVisibility,
  })
  if (error) throw error
}

/** The organiser deliberately clears a plan's results so it can be re-planned. The audit trail is kept. */
export async function clearTournamentPlanResults(
  supabase: SupabaseClient<Database>,
  planId: string,
  reason: string
): Promise<number> {
  const { data, error } = await supabase.rpc("clear_tournament_plan_results", {
    p_plan_id: planId,
    p_reason: reason,
  })
  if (error) throw error
  return (data as unknown as number) ?? 0
}

/* ---- reading the state back, so a screen can label itself ------------------------------------------ */

/**
 * WHAT THE SAME CALL IS ABOUT TO DO, from the state of the game and who the viewer is.
 *
 * `submit` covers four different human actions, and a button that says the wrong one of them is a
 * button people press by mistake. This is the one place that maps state to intent, so the Submit
 * screen, the Confirm screen and the host's own form cannot describe the same call differently.
 */
export type ResultAction =
  | "submit"
  | "resubmit"
  | "confirm_or_contest"
  | "propose_change"
  | "resolve"
  | "none"

export function resultAction(game: TournamentGameResult): ResultAction {
  if (!game.kickedOff) return "none"
  if (game.status === "CANCELLED") return "none"

  // THE ORGANISER'S OWN JOB COMES FIRST where there is a disagreement to settle -- including when they
  // also have a side in the game, because settling it is the authority they hold over it.
  if (game.resultStatus === "disputed" || game.resultStatus === "amendment_pending") {
    return game.can.resolve ? "resolve" : "none"
  }

  if (game.can.submit) {
    if (game.resultStatus === "none") return "submit"
    if (game.resultStatus === "awaiting_confirmation") {
      // Their own score waiting with the opposition: they may correct it, not agree with it.
      return game.submittedBySideId === game.viewerSideId ? "resubmit" : "confirm_or_contest"
    }
    if (game.resultStatus === "final" || game.resultStatus === "external_recorded") {
      return "propose_change"
    }
  }

  if (game.can.resolve) return "resolve"
  return "none"
}

export function resultActionLabel(action: ResultAction): string {
  switch (action) {
    case "submit":
      return "Submit Result"
    case "resubmit":
      return "Change Your Score"
    case "confirm_or_contest":
      return "Confirm or Contest"
    case "propose_change":
      return "Propose a Change"
    case "resolve":
      return "Set Final Score"
    case "none":
      return "No Action"
  }
}

/** The status, as a person reads it. Sentence case: this is a status, not a destination. */
export function resultStatusLabel(status: TournamentResultStatus): string {
  switch (status) {
    case "none":
      return "No result"
    case "awaiting_confirmation":
      return "Awaiting confirmation"
    case "final":
      return "Confirmed"
    case "disputed":
      return "Contested"
    case "amendment_pending":
      return "Change proposed"
    case "external_recorded":
      return "Recorded"
  }
}

/**
 * WHY A SCORE IS NOT YET A RESULT, said to the person looking at it.
 *
 * Written from the VIEWER's position, because "awaiting confirmation" means two different things
 * depending on which side of it you are on, and a club that has already done its part should not be
 * told it still has something to do.
 */
export function resultStatusExplanation(game: TournamentGameResult): string {
  // WHAT A SETTLED SCORE ACTUALLY DOES here. In a round robin it moves a table; in a knockout it sends
  // one side through and the other home, and telling a cup's parents their score "counts towards the
  // table" describes a table that does not exist.
  // AND WHERE THERE IS NEITHER -- a Tri-Fixture the organiser never made a competition -- it is simply
  // the score, and saying it moves a table describes a table that does not exist.
  const outcome = game.roundName ? "decides who goes through" : game.countsToTable === false ? "becomes the final score" : "counts towards the table"
  const outcomeCap = game.roundName ? "It decides who goes through" : game.countsToTable === false ? "It becomes the final score" : "It counts towards the table"
  switch (game.resultStatus) {
    case "none":
      return game.kickedOff
        ? "No result has been recorded yet."
        : "This game has not kicked off yet."
    case "awaiting_confirmation":
      if (game.submittedBySideId && game.submittedBySideId === game.viewerSideId) {
        return `Your score is with the other side. ${outcomeCap} once they agree.`
      }
      return "The other side has submitted a score. Confirm it, or say what you think it was."
    case "final":
      return game.resolvedAt
        ? `The organiser settled this score. ${outcomeCap}.`
        : `Both sides agree this score, so it ${outcome}.`
    case "disputed":
      return `The two sides gave different scores. The organiser will settle it, and nothing ${outcome} until they do.`
    case "amendment_pending":
      return "A side has proposed a different score. The agreed one still counts until the organiser decides."
    case "external_recorded":
      return `This side is not on Ovalball, so there was no confirmation to wait for. The score ${outcome}.`
  }
}

/** Does a result in this state count towards the table. */
export function countsTowardsTable(status: TournamentResultStatus): boolean {
  return status === "final" || status === "external_recorded"
}

export const RESULTS_FILTERS: { key: ResultsFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needs_attention", label: "Needs Attention" },
  { key: "awaiting_confirmation", label: "Awaiting Confirmation" },
  { key: "contested", label: "Contested" },
  // BOTH WORDS, because the filter holds both and only one of them means two clubs agreed. A tab
  // labelled "Confirmed" that also returns one side's unanswerable record is telling the organiser
  // something that is not true of every row behind it.
  { key: "confirmed", label: "Confirmed/Recorded" },
]

/**
 * HOW A RESULT STATE IS COLOURED, decided once so every surface agrees.
 *
 * `final` and `external_recorded` both count towards the table, and they are DELIBERATELY NOT the same
 * tone. One is two clubs agreeing; the other is one club's record of a game the opposition was never
 * on Ovalball to answer. Giving them the same green would quietly claim an agreement that never
 * happened -- so a recorded result reads as settled-but-unconfirmed, and the word beside it says
 * "Recorded" rather than "Confirmed".
 */
export type ResultTone = "positive" | "settled" | "caution" | "neutral"

export function resultStatusTone(status: TournamentResultStatus): ResultTone {
  switch (status) {
    case "final":
      return "positive"
    case "external_recorded":
      return "settled"
    case "disputed":
    case "amendment_pending":
      return "caution"
    case "awaiting_confirmation":
    case "none":
      return "neutral"
  }
}

export function resultsFilterCount(counts: ResultsCounts, filter: ResultsFilter): number {
  switch (filter) {
    case "all":
      return counts.all
    case "needs_attention":
      return counts.needsAttention
    case "awaiting_confirmation":
      return counts.awaitingConfirmation
    case "contested":
      return counts.contested
    case "confirmed":
      return counts.confirmed
  }
}

/**
 * THE TWO CLAIMS IN A CONTEST, in the order they were made.
 *
 * A contest is the original submission and the one that disagreed with it -- and the organiser settling
 * it needs both, with whatever each side said about them. Later disputes on the same game are appended
 * rather than replacing anything, so this returns every claim and lets the screen show the latest from
 * each side.
 */
export function contestedClaims(game: TournamentGameResult): ResultSubmission[] {
  return game.submissions.filter(
    (s) => s.kind === "initial" || s.kind === "dispute" || s.kind === "amendment_proposal"
  )
}

/** The latest claim each side made, newest last. */
export function latestClaimPerSide(game: TournamentGameResult): ResultSubmission[] {
  const bySide = new Map<string, ResultSubmission>()
  for (const s of contestedClaims(game)) {
    if (!s.bySideId) continue
    bySide.set(s.bySideId, s)
  }
  return [...bySide.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}
