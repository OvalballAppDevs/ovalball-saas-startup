import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

/**
 * ONE TOURNAMENT, AS SOMEBODY GOING TO IT SEES IT.
 *
 * A thin typed wrapper over `get_tournament_participant_centre`. Nothing is decided here: the server
 * resolves who the viewer is connected to, which competitions that gives them, and -- importantly --
 * reduces every other club's attendance to a single ATTENDING number before the payload is built. A
 * client that filtered instead would already have been sent the thing it was hiding.
 *
 * ONE TOURNAMENT, SEVERAL COMPETITION CONTEXTS. A club with a U12 and a U16 side at one festival gets
 * two contexts over one tournament record: same id, same cover, same dates, same attendance answer per
 * player. A context is a lens, never a second tournament.
 */

export interface ParticipantSide {
  participantId: string
  teamId: string | null
  clubName: string
  /** A storage path, resolved to a URL by the caller through the canonical club-logo helper. */
  crestPath: string | null
  /** The canonical team name, or a recorded club's competition and alias. Never invented here. */
  label: string
  isHost: boolean
  /** True where this side is one the viewer is part of. */
  isMine: boolean
  /** False for a club that exists only because an organiser typed its name. */
  onOvalball: boolean
}

export interface ParticipantAttendanceRow {
  participantId: string
  clubName: string
  crestPath: string | null
  label: string
  isMine: boolean
  /**
   * HOW MANY ARE COMING. The one attendance fact that crosses a club boundary, because it is what the
   * day is organised around. Null for a side with no Ovalball team behind it -- there is nobody to
   * ask, which is not the same as nobody answering.
   */
  attending: number | null
  /**
   * The rest of the breakdown, and NULL for every side the viewer is not part of. The server decides
   * this; it is not a rendering choice, and these fields are absent from the payload rather than
   * present and unused.
   */
  unsure: number | null
  cannotAttend: number | null
  awaiting: number | null
}

export interface ParticipantGameSide {
  participantId: string
  clubName: string
  label: string
  crestPath: string | null
  score: number | null
  isMine: boolean
}

export interface ParticipantGame {
  id: string
  gameDate: string
  startTime: string | null
  durationMinutes: number | null
  pitchName: string | null
  status: string
  /**
   * WHERE THIS GAME SITS IN THE COMPETITION.
   *
   * The organiser arranges a round robin as table then round, and a parent reading only kick-off times
   * is reading half the programme: which table their side is in, and who else is in it, is the part
   * that says what the weekend is. Null for a game added by hand, which belongs to no table and no
   * round -- and is left without one rather than given a plausible place.
   */
  tableName: string | null
  round: number | null
  /**
   * WHAT A KNOCKOUT CALLS THIS GAME -- "Quarter Final", "Final", "Third-Place Play-Off". Null on a
   * round robin, which is placed by table and round instead. Written by the bracket's own naming
   * authority so the draw, the Agenda and the result never call one game two different things.
   */
  roundName: string | null
  /** What the game is in its competition, named by the server: "Table A · Round 2", "Quarter Final",
   * "Tri-Fixture · Game 2". Absent only on an older server. */
  stageLabel?: string | null
  /** Whether its result moves a table -- the competition's own answer, not the format's. */
  countsToTable?: boolean
  sideA: ParticipantGameSide
  sideB: ParticipantGameSide
}

/**
 * A PLACE IN THE DRAW THAT HAS BEEN SCHEDULED BUT IS NOT YET A GAME.
 *
 * The organiser books the semi-final for three o'clock before anybody has qualified for it, and that
 * is precisely what a family planning their Sunday needs to know. It is a read projection of the
 * published plan: there is no `tournament_game` behind it, deliberately, because a game has two real
 * sides and manufacturing one would put a fixture against nobody into Results and into every count of
 * what was played. Once both sides resolve, the server materialises the canonical game and the pairing
 * stops being returned here.
 */
export interface ParticipantPairing {
  pairingId: string
  gameDate: string
  startTime: string | null
  pitchName: string | null
  roundName: string | null
  /** What the game is in its competition, named by the server: "Table A · Round 2", "Quarter Final",
   * "Tri-Fixture · Game 2". Absent only on an older server. */
  stageLabel?: string | null
  /** Whether its result moves a table -- the competition's own answer, not the format's. */
  countsToTable?: boolean
  /** The sentence the draw prints for an unfilled place: "Winner QF1", "Loser SF2". Never a club. */
  sideALabel: string | null
  sideBLabel: string | null
}

export interface ParticipantContext {
  /** The competition -- "U12". Contexts never mix: a U12 field is who the U12s are playing. */
  ageGroup: string
  sides: ParticipantSide[]
  attendance: ParticipantAttendanceRow[]
  /**
   * WHETHER THIS COMPETITION KEEPS A TABLE. The Tables tab follows this rather than the format, so a
   * Tri-Fixture the organiser never made a competition does not get a tab that can only be empty --
   * the same rule that keeps a knockout from getting one.
   */
  keepsStandings: boolean
  /** The published programme, straight from what planning writes. Empty means nothing is published. */
  games: ParticipantGame[]
  /**
   * A KNOCKOUT'S SCHEDULED PLACES THAT HAVE NOT YET BECOME GAMES. Always empty for a round robin,
   * whose games all exist from the moment it is generated. Read-only, and never a second game list:
   * a pairing leaves this array the instant its real game exists.
   */
  pairings: ParticipantPairing[]
  /** A Swiss round's bye: the side that sits out, awarded a win (20270725). Absent for other formats. */
  byes?: { round: number; participantId: string; clubName: string }[]
  /**
   * THE DAYS THIS COMPETITION PLAYS, once its plan is published -- which is not the same as the days
   * the TOURNAMENT runs. A festival spanning Friday to Sunday whose U12 competition plays Friday and
   * Sunday has two days here and three there, and the Agenda must count the ones its own games fall
   * on, because the Calendar already does. Empty until a plan is published.
   */
  competitionDays: string[]
  /**
   * WHETHER THIS VIEWER COULD RECORD A RESULT for one of this competition's sides -- resolved by the
   * same `fixture.result.record` capability the submit path itself enforces. It decides whether the
   * Results tab is offered at all: most people here are parents and players, and an action list that
   * could only ever say "nothing for you" is a worse screen than no tab.
   */
  canRecordResults: boolean
}

export interface ParticipantPlayer {
  playerId: string
  firstName: string
  /** True where the player IS the viewer. Decides whether the question says "you" or their name. */
  isSelf: boolean
  teamId: string
  ageGroup: string
  status: "ATTENDING" | "CANNOT_ATTEND" | "UNSURE" | null
  /**
   * Whether the canonical authority would accept an answer from this viewer for this player. Decides
   * whether a CONTROL is drawn; the write refuses independently whether or not one was.
   */
  canRespond: boolean
}

export interface TournamentParticipantCentre {
  id: string
  name: string
  /**
   * HOW RESULTS ARE RUN -- deliberately not the tournament's own visibility. A club may list a festival
   * publicly and still keep its scores inside it, so these are two settings rather than one.
   */
  resultsSubmissionEnabled: boolean
  resultsVisibility: "public" | "participants"
  startsOn: string
  endsOn: string | null
  kickoffTime: string | null
  endsAt: string | null
  format: string
  swissRounds: number | null
  visibility: "public" | "private"
  status: string
  cancelled: boolean
  coverImagePath: string | null
  coverStockKey: string | null
  notes: string | null
  venueName: string | null
  venueAddress: string | null
  hostClubName: string | null
  hostCrestPath: string | null
  /** "Ovalball, Lancashire" -- where the host club is, as the directory records it. */
  hostTown: string | null
  /**
   * Whether this viewer manages the tournament. The client sends them to the MANAGEMENT surface that
   * already exists rather than drawing a second organiser dashboard behind this one.
   */
  canManage: boolean
  contexts: ParticipantContext[]
  myPlayers: ParticipantPlayer[]
}

/** Null where the tournament does not exist OR the viewer may not see it -- deliberately the same answer. */
export async function readTournamentParticipantCentre(
  supabase: SupabaseClient<Database>,
  tournamentId: string
): Promise<TournamentParticipantCentre | null> {
  const { data, error } = await supabase.rpc("get_tournament_participant_centre", { p_tournament_id: tournamentId })
  if (error) throw error
  if (!data) return null
  return data as unknown as TournamentParticipantCentre
}

/**
 * WHICH CONTEXT TO OPEN ON.
 *
 * The one the viewer arrived through, when the Calendar row told us which competition it was about;
 * otherwise their first. A club administrator with U12 and U16 sides opening the festival from the
 * U16 calendar row should land on U16, because that is the row they tapped.
 */
export function initialContext(
  contexts: ParticipantContext[],
  preferredAgeGroup?: string | null
): ParticipantContext | null {
  if (contexts.length === 0) return null
  const preferred = preferredAgeGroup ? contexts.find((c) => c.ageGroup === preferredAgeGroup) : null
  return preferred ?? contexts[0]!
}

/** Everything in the published programme, in the order it happens, grouped by the day it is on. */
export function gamesByDay(games: ParticipantGame[]): { date: string; games: ParticipantGame[] }[] {
  const days = new Map<string, ParticipantGame[]>()
  for (const g of games) {
    const list = days.get(g.gameDate)
    if (list) list.push(g)
    else days.set(g.gameDate, [g])
  }
  return Array.from(days.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, list]) => ({ date, games: list }))
}

/**
 * WHICH DAYS THE TOURNAMENT RUNS, as ISO dates.
 *
 * The days come from the TOURNAMENT, not from the plan: a festival that runs Saturday and Sunday has
 * two days whether or not Sunday's games have been published, and an agenda that numbered its days
 * from the games it happened to have would renumber itself as the organiser worked.
 */
/**
 * ONE DAY'S PROGRAMME, GROUPED THE WAY THE ORGANISER BUILT IT: table, then round.
 *
 * A game with no table is a hand-made fixture at the tournament rather than part of the competition,
 * and it keeps its own group at the end rather than being filed under somebody's table.
 */
export interface AgendaTableGroup {
  tableName: string | null
  rounds: { round: number | null; games: ParticipantGame[] }[]
}

export function agendaTables(games: ParticipantGame[]): AgendaTableGroup[] {
  const tables: AgendaTableGroup[] = []
  for (const game of games) {
    const name = game.tableName ?? null
    let table = tables.find((t) => t.tableName === name)
    if (!table) {
      table = { tableName: name, rounds: [] }
      tables.push(table)
    }
    const round = game.round ?? null
    let bucket = table.rounds.find((r) => r.round === round)
    if (!bucket) {
      bucket = { round, games: [] }
      table.rounds.push(bucket)
    }
    bucket.games.push(game)
  }
  // Tables in the order the server sent them; a table nobody named sorts last.
  tables.sort((a, b) => (a.tableName === null ? 1 : b.tableName === null ? -1 : 0))
  for (const t of tables) t.rounds.sort((a, b) => (a.round ?? 0) - (b.round ?? 0))
  return tables
}

/**
 * ONE DAY'S PROGRAMME WHEN THE COMPETITION IS A KNOCKOUT: grouped by the round's own name.
 *
 * A knockout has no tables and its round numbers are not what anybody says out loud -- the games on a
 * Saturday are the Quarter Finals, not Round 1. So the grouping that a round robin takes from the
 * organiser's tables comes here from the bracket's naming authority instead. The day grouping above it
 * and the game row below it are the same ones a round robin uses; only this middle heading differs,
 * because only this is genuinely different about the sport.
 *
 * Groups keep the order the server sent, which is the order the rounds are played in.
 */
export interface AgendaRoundGroup {
  roundName: string | null
  /** What the game is in its competition, named by the server: "Table A · Round 2", "Quarter Final",
   * "Tri-Fixture · Game 2". Absent only on an older server. */
  stageLabel?: string | null
  /** Whether its result moves a table -- the competition's own answer, not the format's. */
  countsToTable?: boolean
  games: ParticipantGame[]
}

export function agendaRoundGroups(games: ParticipantGame[]): AgendaRoundGroup[] {
  const groups: AgendaRoundGroup[] = []
  for (const game of games) {
    const name = game.roundName ?? null
    let group = groups.find((g) => g.roundName === name)
    if (!group) {
      group = { roundName: name, games: [] }
      groups.push(group)
    }
    group.games.push(game)
  }
  return groups
}

/** Whether this competition's published programme is a draw rather than a set of tables. */
export function agendaIsKnockout(games: ParticipantGame[], pairings: ParticipantPairing[]): boolean {
  return games.some((g) => g.roundName !== null) || pairings.length > 0
}

/**
 * THE DAYS THE AGENDA COUNTS.
 *
 * The competition's own days once a plan is published, the tournament's whole span until then. Those
 * are different things on a festival that skips a day, and counting the wrong one is how the Calendar
 * came to say "Day 2 of 2" about a date the Agenda called "Day 3".
 */
export function agendaDays(competitionDays: string[], startsOn: string, endsOn: string | null): string[] {
  return competitionDays.length > 0 ? [...competitionDays].sort() : tournamentDays(startsOn, endsOn)
}

export function tournamentDays(startsOn: string, endsOn: string | null): string[] {
  const out: string[] = []
  const end = Date.parse(`${endsOn ?? startsOn}T00:00:00Z`)
  let cursor = Date.parse(`${startsOn}T00:00:00Z`)
  if (Number.isNaN(cursor) || Number.isNaN(end) || end < cursor) return [startsOn]
  while (cursor <= end) {
    out.push(new Date(cursor).toISOString().slice(0, 10))
    cursor += 86_400_000
  }
  return out
}
