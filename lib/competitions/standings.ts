/**
 * LEAGUE TABLES FROM COMPETITION MATCHES.
 *
 * Standings are computed from Competition Matches -- every match, including
 * two clubs that are not on Ovalball -- never from club fixtures. A match
 * counts once it has both scores and has not been cancelled.
 *
 * Points are the organiser's (a stage setting), not a hardcoded rule. Ties are
 * broken by points difference, then points scored, then the head-to-head
 * result between the tied teams, then by name so the order is stable.
 */

export interface StandingsMatch {
  homeParticipantId: string | null
  awayParticipantId: string | null
  homeScore: number | null
  awayScore: number | null
  status: string
}

export interface PointsRule {
  win: number
  draw: number
  loss: number
}

export const DEFAULT_POINTS: PointsRule = { win: 4, draw: 2, loss: 0 }

export interface StandingRow {
  participantId: string
  label: string
  played: number
  won: number
  drawn: number
  lost: number
  pointsFor: number
  pointsAgainst: number
  difference: number
  points: number
  position: number
}

export function computeStandings(
  participants: { id: string; label: string }[],
  matches: StandingsMatch[],
  rule: PointsRule = DEFAULT_POINTS,
): StandingRow[] {
  const rows = new Map<string, StandingRow>(
    participants.map((p) => [
      p.id,
      { participantId: p.id, label: p.label, played: 0, won: 0, drawn: 0, lost: 0, pointsFor: 0, pointsAgainst: 0, difference: 0, points: 0, position: 0 },
    ]),
  )
  const counted = matches.filter(
    (m) =>
      m.homeParticipantId &&
      m.awayParticipantId &&
      m.homeScore !== null &&
      m.awayScore !== null &&
      m.status !== "cancelled" &&
      m.status !== "postponed" &&
      rows.has(m.homeParticipantId) &&
      rows.has(m.awayParticipantId),
  )

  for (const m of counted) {
    const home = rows.get(m.homeParticipantId!)!
    const away = rows.get(m.awayParticipantId!)!
    const hs = m.homeScore!
    const as = m.awayScore!
    home.played++
    away.played++
    home.pointsFor += hs
    home.pointsAgainst += as
    away.pointsFor += as
    away.pointsAgainst += hs
    if (hs > as) {
      home.won++
      away.lost++
      home.points += rule.win
      away.points += rule.loss
    } else if (as > hs) {
      away.won++
      home.lost++
      away.points += rule.win
      home.points += rule.loss
    } else {
      home.drawn++
      away.drawn++
      home.points += rule.draw
      away.points += rule.draw
    }
  }

  const list = [...rows.values()].map((r) => ({ ...r, difference: r.pointsFor - r.pointsAgainst }))

  const headToHead = (a: string, b: string): number => {
    let score = 0
    for (const m of counted) {
      if (m.homeParticipantId === a && m.awayParticipantId === b) score += Math.sign(m.homeScore! - m.awayScore!)
      if (m.homeParticipantId === b && m.awayParticipantId === a) score += Math.sign(m.awayScore! - m.homeScore!)
    }
    return score
  }

  list.sort(
    (a, b) =>
      b.points - a.points ||
      b.difference - a.difference ||
      b.pointsFor - a.pointsFor ||
      headToHead(b.participantId, a.participantId) ||
      a.label.localeCompare(b.label),
  )
  list.forEach((r, i) => (r.position = i + 1))
  return list
}
