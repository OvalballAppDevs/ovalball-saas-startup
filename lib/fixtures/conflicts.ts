/**
 * THE CONFLICT ENGINE.
 *
 * Before a set of fixtures or competition matches is issued, each one is
 * checked against the others and against what is already booked:
 *
 *   RED   (resolve before issue): a team booked twice on one day, two matches
 *         on one pitch at the same time, a date outside the competition's
 *         season, an invalid participant, a team drawn against itself, a team
 *         outside the competition's age/category.
 *   AMBER (warning): the same pairing twice, two matches at one venue at the
 *         same time on different pitches, a pitch booking with no kick-off to
 *         check the time against, a home match at a ground that is not the home
 *         club's, a team playing again within two days.
 *   GREEN: nothing found.
 *
 * It DETECTS. It never cancels, replaces or moves anything; the person decides
 * what to do with a conflict (keep both, change the new one, or -- with the
 * authority to -- change the existing one).
 */

export type ConflictLevel = "green" | "amber" | "red"

export interface ConflictIssue {
  level: Exclude<ConflictLevel, "green">
  code:
    | "team_double_booked"
    | "pitch_collision"
    | "pitch_time_unknown"
    | "venue_collision"
    | "duplicate_matchup"
    | "outside_season"
    | "invalid_participant"
    | "self_match"
    | "ineligible_team"
    | "home_ground_mismatch"
    | "short_turnaround"
  message: string
  /** The other candidate or existing fixture involved, where there is one. */
  withKey?: string
}

export interface ConflictCandidate {
  key: string
  label: string
  date: string | null
  /** "HH:MM". */
  kickoff: string | null
  durationMinutes?: number
  /** Real Ovalball team ids on each side (a Mini-Rugby Group expands to its members). */
  homeTeamIds: string[]
  awayTeamIds: string[]
  /** Competition participant ids, when the candidate is a competition match. */
  homeParticipantId?: string | null
  awayParticipantId?: string | null
  /** A participant place that is still a placeholder (e.g. "Winner of SF1") is not invalid. */
  homePlaceholder?: boolean
  awayPlaceholder?: boolean
  venueId: string | null
  pitchId: string | null
  /** The club that owns the venue, and the home side's club, when known. */
  venueClubId?: string | null
  homeClubId?: string | null
  eligible?: boolean
}

export interface ExistingCommitment {
  key: string
  label: string
  date: string
  kickoff: string | null
  durationMinutes?: number
  teamIds: string[]
  venueId: string | null
  pitchId: string | null
}

export interface ConflictReport {
  key: string
  level: ConflictLevel
  issues: ConflictIssue[]
}

const DEFAULT_DURATION = 90

/**
 * Who a candidate books: its real teams, and -- for a competition -- its
 * participants, so a club that is not on Ovalball (no team id) is still one
 * side that cannot play twice on one day.
 */
function identities(c: ConflictCandidate): string[] {
  return [...c.homeTeamIds, ...c.awayTeamIds, ...[c.homeParticipantId, c.awayParticipantId].filter((id): id is string => Boolean(id)).map((id) => `participant:${id}`)]
}
const TURNAROUND_DAYS = 2

function minutes(time: string | null): number | null {
  if (!time) return null
  const m = time.match(/^(\d{1,2}):(\d{2})/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

function overlaps(aStart: number, aDur: number, bStart: number, bDur: number): boolean {
  return aStart < bStart + bDur && bStart < aStart + aDur
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 86400000
}

export function detectConflicts(
  candidates: ConflictCandidate[],
  existing: ExistingCommitment[],
  options: { season?: { start: string; end: string } | null } = {},
): ConflictReport[] {
  const reports = new Map<string, ConflictIssue[]>(candidates.map((c) => [c.key, []]))
  const add = (key: string, issue: ConflictIssue) => reports.get(key)!.push(issue)

  const commitments: { key: string; label: string; date: string; kickoff: string | null; duration: number; teamIds: string[]; venueId: string | null; pitchId: string | null; candidate: boolean }[] = [
    ...candidates
      .filter((c) => c.date)
      .map((c) => ({
        key: c.key,
        label: c.label,
        date: c.date!,
        kickoff: c.kickoff,
        duration: c.durationMinutes ?? DEFAULT_DURATION,
        teamIds: identities(c),
        venueId: c.venueId,
        pitchId: c.pitchId,
        candidate: true,
      })),
    ...existing.map((e) => ({ ...e, duration: e.durationMinutes ?? DEFAULT_DURATION, candidate: false })),
  ]

  const seenPairs = new Map<string, string>()

  for (const c of candidates) {
    // Participants.
    if (c.homeParticipantId !== undefined || c.awayParticipantId !== undefined) {
      if ((!c.homeParticipantId && !c.homePlaceholder) || (!c.awayParticipantId && !c.awayPlaceholder)) {
        add(c.key, { level: "red", code: "invalid_participant", message: `${c.label} is missing a team.` })
      }
      if (c.homeParticipantId && c.homeParticipantId === c.awayParticipantId) {
        add(c.key, { level: "red", code: "self_match", message: `${c.label} has the same team on both sides.` })
      }
      if (c.homeParticipantId && c.awayParticipantId) {
        // Ordered: the return fixture of a home-and-away schedule (venues
        // reversed) is the schedule working, not a repeat. The same home side
        // against the same opponent twice is the repeat worth a look.
        const pair = `${c.homeParticipantId}|${c.awayParticipantId}`
        const earlier = seenPairs.get(pair)
        if (earlier) add(c.key, { level: "amber", code: "duplicate_matchup", message: `${c.label} repeats a home fixture already in this draft.`, withKey: earlier })
        else seenPairs.set(pair, c.key)
      }
    }
    if (c.eligible === false) {
      add(c.key, { level: "red", code: "ineligible_team", message: `${c.label} includes a team outside this competition's age or category.` })
    }
    if (c.date && options.season && (c.date < options.season.start || c.date > options.season.end)) {
      add(c.key, { level: "red", code: "outside_season", message: `${c.label} is dated outside the competition's season.` })
    }
    if (c.venueId && c.venueClubId && c.homeClubId && c.venueClubId !== c.homeClubId) {
      add(c.key, { level: "amber", code: "home_ground_mismatch", message: `${c.label} is at a ground that is not the home club's.` })
    }
    if (!c.date) continue

    const mine = identities(c)
    const start = minutes(c.kickoff)
    const duration = c.durationMinutes ?? DEFAULT_DURATION

    for (const other of commitments) {
      if (other.key === c.key) continue
      // Report each candidate-candidate clash once per side; existing ones on the candidate.
      const sameDay = other.date === c.date
      const sharedTeam = mine.find((t) => other.teamIds.includes(t))

      if (sameDay && sharedTeam) {
        add(c.key, { level: "red", code: "team_double_booked", message: `${c.label} puts a side on the field twice that day (also ${other.label}).`, withKey: other.key })
      } else if (sharedTeam && daysBetween(other.date, c.date) > 0 && daysBetween(other.date, c.date) < TURNAROUND_DAYS) {
        add(c.key, { level: "amber", code: "short_turnaround", message: `${c.label} leaves a team less than two days after ${other.label}.`, withKey: other.key })
      }

      if (!sameDay) continue
      const otherStart = minutes(other.kickoff)
      if (c.pitchId && other.pitchId && c.pitchId === other.pitchId) {
        if (start === null || otherStart === null) {
          add(c.key, { level: "amber", code: "pitch_time_unknown", message: `${c.label} shares a pitch with ${other.label} that day, and a kick-off is missing.`, withKey: other.key })
        } else if (overlaps(start, duration, otherStart, other.duration)) {
          add(c.key, { level: "red", code: "pitch_collision", message: `${c.label} overlaps ${other.label} on the same pitch.`, withKey: other.key })
        }
      } else if (c.venueId && other.venueId && c.venueId === other.venueId && start !== null && otherStart !== null && overlaps(start, duration, otherStart, other.duration)) {
        add(c.key, { level: "amber", code: "venue_collision", message: `${c.label} is at the same ground at the same time as ${other.label}.`, withKey: other.key })
      }
    }
  }

  return candidates.map((c) => {
    const issues = reports.get(c.key)!
    const level: ConflictLevel = issues.some((i) => i.level === "red") ? "red" : issues.length > 0 ? "amber" : "green"
    return { key: c.key, level, issues }
  })
}
