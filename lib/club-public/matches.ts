/**
 * Shaping canonical match data for a club's public page.
 *
 * Pure functions only -- no queries -- so the selection rules can be tested
 * without a database. The rows come from the canonical sources and nowhere
 * else (see load-club-home.ts):
 *
 *   upcoming   public_club_fixtures, the one anonymous fixture projection
 *   results    competition_matches (the canonical competition record, public
 *              under its own RLS) and, for a signed-in viewer, the fixtures
 *              their own fixture policy already admits
 *
 * Nothing here copies a fixture or a result into another table.
 */

export type VenueRole = "Home" | "Away" | null

export interface CompetitionRef {
  name: string
  slug: string | null
}

export interface ClubUpcomingMatch {
  id: string
  date: string
  time: string | null
  teamId: string
  teamLabel: string
  opposition: string
  venueRole: VenueRole
  competition: CompetitionRef | null
  /** Match Centre, only when this viewer's fixture policy admits them. */
  matchCentreHref: string | null
}

export type Outcome = "WON" | "LOST" | "DRAWN"

export interface ClubResult {
  key: string
  date: string
  teamId: string | null
  teamLabel: string
  opposition: string
  clubScore: number
  oppositionScore: number
  outcome: Outcome
  venueRole: VenueRole
  competition: CompetitionRef | null
  href: string | null
  source: "competition" | "fixture"
}

export function venueRole(homeAway: string | null | undefined): VenueRole {
  return homeAway === "Home" ? "Home" : homeAway === "Away" ? "Away" : null
}

export function outcomeOf(clubScore: number, oppositionScore: number): Outcome {
  return clubScore > oppositionScore ? "WON" : clubScore < oppositionScore ? "LOST" : "DRAWN"
}

/** Words, not colours: a result is always readable without seeing its accent. */
export const OUTCOME_WORD: Record<Outcome, string> = { WON: "Won", LOST: "Lost", DRAWN: "Drawn" }

/** Soonest first, today onward, at most `limit`. Undated rows never appear. */
export function selectUpcoming<T extends { date: string; time: string | null }>(rows: T[], todayIso: string, limit: number): T[] {
  return rows
    .filter((r) => r.date >= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "99").localeCompare(b.time ?? "99"))
    .slice(0, limit)
}

// ----------------------------------------------------------------------------
// Competition results
// ----------------------------------------------------------------------------

export interface CompetitionParticipantRow {
  id: string
  editionId: string
  clubId: string | null
  teamId: string | null
  /** Already in display form: club name plus team label for an opponent, team label for our side. */
  label: string
}

export interface CompetitionMatchRow {
  id: string
  editionId: string
  homeParticipantId: string | null
  awayParticipantId: string | null
  date: string | null
  status: string
  homeScore: number | null
  awayScore: number | null
}

/**
 * A completed competition match, seen from this club's side. Returns null
 * when the match is not a finished result for this club, so a caller can map
 * and filter in one pass.
 */
export function competitionResultForClub(
  match: CompetitionMatchRow,
  clubId: string,
  participants: Map<string, CompetitionParticipantRow>,
  competitions: Map<string, CompetitionRef>
): ClubResult | null {
  if (match.status !== "completed" || match.homeScore === null || match.awayScore === null || !match.date) return null
  const home = match.homeParticipantId ? participants.get(match.homeParticipantId) : undefined
  const away = match.awayParticipantId ? participants.get(match.awayParticipantId) : undefined
  const clubIsHome = home?.clubId === clubId
  const clubIsAway = away?.clubId === clubId
  if (!clubIsHome && !clubIsAway) return null

  const ours = clubIsHome ? home! : away!
  const theirs = clubIsHome ? away : home
  const clubScore = clubIsHome ? match.homeScore : match.awayScore
  const oppositionScore = clubIsHome ? match.awayScore : match.homeScore
  const competition = competitions.get(match.editionId) ?? null

  return {
    key: resultKey(match.editionId, ours.teamId, match.date),
    date: match.date,
    teamId: ours.teamId,
    teamLabel: ours.label,
    opposition: theirs?.label ?? "Opposition to be confirmed",
    clubScore,
    oppositionScore,
    outcome: outcomeOf(clubScore, oppositionScore),
    venueRole: clubIsHome ? "Home" : "Away",
    competition,
    href: competition?.slug ? `/competitions/${competition.slug}?view=results` : null,
    source: "competition",
  }
}

// ----------------------------------------------------------------------------
// Fixture results (signed-in viewers only)
// ----------------------------------------------------------------------------

export interface FixtureResultRow {
  id: string
  date: string
  homeAway: string | null
  opposition: string
  teamId: string
  teamLabel: string
  /** fixtures.home_score is the OWNING team's score, whichever side it played. */
  owningScore: number
  opponentScore: number
  editionId: string | null
  competition: CompetitionRef | null
}

export function fixtureResult(row: FixtureResultRow): ClubResult {
  return {
    key: row.editionId ? resultKey(row.editionId, row.teamId, row.date) : `fixture:${row.id}`,
    date: row.date,
    teamId: row.teamId,
    teamLabel: row.teamLabel,
    opposition: row.opposition,
    clubScore: row.owningScore,
    oppositionScore: row.opponentScore,
    outcome: outcomeOf(row.owningScore, row.opponentScore),
    venueRole: venueRole(row.homeAway),
    competition: row.competition,
    href: `/fixtures/${row.id}`,
    source: "fixture",
  }
}

function resultKey(editionId: string, teamId: string | null, date: string): string {
  return `competition:${editionId}:${teamId ?? "external"}:${date}`
}

/**
 * One list of results, newest first. A competition match that a viewer can
 * also see as their club's fixture is the same game: it appears once, as the
 * fixture (which can open Match Centre), keeping the competition's name.
 */
export function mergeResults(competition: ClubResult[], fixtures: ClubResult[], limit: number): ClubResult[] {
  const byKey = new Map<string, ClubResult>()
  for (const r of competition) byKey.set(r.key, r)
  for (const r of fixtures) {
    const existing = byKey.get(r.key)
    byKey.set(r.key, existing ? { ...r, competition: r.competition ?? existing.competition } : r)
  }
  return [...byKey.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit)
}
