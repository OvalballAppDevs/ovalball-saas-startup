/**
 * TOURNAMENT CENTRE'S SHAPES AND ITS PURE HELPERS.
 *
 * Deliberately NOT in lib/app-context/tournament-centre-data.ts, which is
 * `server-only`: the Tournament Centre components are client components, and a
 * client component importing a server-only module is a build error rather than
 * a runtime surprise. Types alone would erase, but combinedSchedule and
 * formatTournamentDateRange are real functions the browser runs.
 *
 * Nothing here reads or decides anything. The payload is built server-side by
 * public.get_tournament_centre and shaped by getTournamentCentre; this file
 * only describes what arrives and rearranges it for display.
 */

export interface TournamentOpponent {
  id: string
  participantId: string
  clubName: string
  logoUrl: string | null
  teamTypeLabel: string
  status: string
}

export interface TournamentGame {
  id: string
  opponentId: string
  opponentClubName: string
  gameDate: string
  startTime: string | null
  durationMinutes: number | null
  pitchId: string | null
  pitchName: string | null
  status: "SCHEDULED" | "CANCELLED" | "PLAYED"
  ourScore: number | null
  opponentScore: number | null
}

export interface TournamentEntry {
  id: string
  teamId: string
  clubId: string
  teamName: string
  ageGroup: string | null
  clubName: string
  logoUrl: string | null
  canManageEntry: boolean
  /** Whether this team is the viewer's own -- a team they manage, or one their child or they themselves play in. Presentation only: it chooses the tab that opens first, and hides nothing. */
  isMine: boolean
  opponents: TournamentOpponent[]
  games: TournamentGame[]
}

export interface TournamentInvitation {
  participantId: string
  clubName: string
  teamTypeLabel: string
  status: string
}

export interface TournamentPitchReservation {
  id: string
  pitchId: string
  pitchName: string
  reservedOn: string
  startTime: string
  endTime: string
}

export interface TournamentCentreContext {
  id: string
  name: string
  rugbyCode: "union" | "league"
  startsOn: string
  endsOn: string
  isMultiDay: boolean
  status: string
  cancelled: boolean
  cancellationReason: string | null
  notes: string | null
  venueNotes: string | null
  seasonName: string | null
  hostName: string | null
  hostClubId: string | null
  venue: { id: string; name: string; address: string | null; postcode: string | null } | null
  canManageTournament: boolean
  /** Pending invitations at this tournament that THIS viewer is entitled to answer. */
  invitations: TournamentInvitation[]
  entries: TournamentEntry[]
  pitches: TournamentPitchReservation[]
}

/** "7 November 2026", or "12-14 September 2026" for a multi-day occasion. */
export function formatTournamentDateRange(startsOn: string, endsOn: string): string {
  const start = new Date(`${startsOn}T00:00:00`)
  const end = new Date(`${endsOn}T00:00:00`)
  const day = (d: Date) => d.getDate()
  const month = (d: Date) => d.toLocaleDateString("en-GB", { month: "long" })
  const year = (d: Date) => d.getFullYear()
  if (startsOn === endsOn) return `${day(start)} ${month(start)} ${year(start)}`
  if (month(start) === month(end) && year(start) === year(end)) return `${day(start)}-${day(end)} ${month(start)} ${year(start)}`
  if (year(start) === year(end)) return `${day(start)} ${month(start)} - ${day(end)} ${month(end)} ${year(start)}`
  return `${day(start)} ${month(start)} ${year(start)} - ${day(end)} ${month(end)} ${year(end)}`
}

/**
 * Every game at the occasion, in time order, tagged with the team playing it.
 * This is the club-wide view a Club Admin needs -- "which of our teams is on
 * which pitch at 11:20" -- derived from the SAME entries the team views read,
 * never from a second query with its own idea of the day.
 */
export interface CombinedScheduleRow extends TournamentGame {
  entryId: string
  teamName: string
}

export function combinedSchedule(entries: TournamentEntry[]): CombinedScheduleRow[] {
  return entries
    .flatMap((e) => e.games.map((g) => ({ ...g, entryId: e.id, teamName: e.teamName })))
    .sort((a, b) => {
      if (a.gameDate !== b.gameDate) return a.gameDate < b.gameDate ? -1 : 1
      const at = a.startTime ?? "99:99"
      const bt = b.startTime ?? "99:99"
      if (at !== bt) return at < bt ? -1 : 1
      return a.teamName.localeCompare(b.teamName)
    })
}
