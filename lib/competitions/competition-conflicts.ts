/**
 * THE CONFLICT CHECK FOR A COMPETITION'S MATCHES.
 *
 * Turns every Competition Match still to be played into a conflict
 * candidate and runs the one conflict engine (lib/fixtures/conflicts.ts)
 * against the participating teams' other fixtures. GREEN is ready, AMBER is
 * worth a look before issuing, RED must be resolved first. Nothing is ever
 * cancelled or moved to make a conflict go away.
 */

import { detectConflicts, type ConflictCandidate, type ConflictReport } from "@/lib/fixtures/conflicts"

import { participantLabel, type CompetitionWorkspace } from "./workspace-types"

export function competitionConflicts(ws: CompetitionWorkspace): ConflictReport[] {
  const byId = new Map(ws.participants.map((p) => [p.id, p]))
  const venueClub = new Map(ws.venues.map((v) => [v.id, v.clubId]))
  const candidates: ConflictCandidate[] = ws.matches
    // A cancelled match is not happening, and a completed one has happened: neither can be changed to resolve anything.
    .filter((m) => m.status !== "cancelled" && m.status !== "completed")
    .map((m) => {
      const home = m.homeParticipantId ? byId.get(m.homeParticipantId) : undefined
      const away = m.awayParticipantId ? byId.get(m.awayParticipantId) : undefined
      return {
        key: m.id,
        label: `${participantLabel(home)} v ${participantLabel(away)}`,
        date: m.matchDate,
        kickoff: m.kickoffTime,
        homeTeamIds: home?.teamId ? [home.teamId] : [],
        awayTeamIds: away?.teamId ? [away.teamId] : [],
        homeParticipantId: m.homeParticipantId,
        awayParticipantId: m.awayParticipantId,
        homePlaceholder: !m.homeParticipantId && Boolean(m.homeSource),
        awayPlaceholder: !m.awayParticipantId && Boolean(m.awaySource),
        venueId: m.venueId,
        pitchId: m.pitchId,
        venueClubId: m.venueId ? (venueClub.get(m.venueId) ?? null) : null,
        homeClubId: home?.clubId ?? null,
        // A competition for one age and category: an Ovalball team of another is not eligible.
        eligible: ws.canonicalTeamTypeId ? [home, away].every((p) => !p?.teamId || !p.teamTypeId || p.teamTypeId === ws.canonicalTeamTypeId) : undefined,
      }
    })
  const season = ws.season ? { start: ws.season.preSeasonStartsOn ?? ws.season.startsOn, end: ws.season.endsOn } : null
  return detectConflicts(candidates, ws.commitments, { season })
}
