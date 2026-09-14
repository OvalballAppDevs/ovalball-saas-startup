/**
 * SMALL CORRECTIONS TO A DRAWN COMPETITION.
 *
 * An organiser who notices one wrong team should change one team, not rebuild
 * the round. This module turns "put Team C at home in this match" into the
 * exact match changes to save:
 *
 *  - REPLACE. The chosen team is not playing elsewhere in that round: the one
 *    place changes.
 *  - SWAP. The chosen team already plays another draft match in the same stage
 *    and round: the two teams change places, so nobody plays twice that round
 *    and nobody is left without a match. Both changes are saved together.
 *
 * When the home team changes, the ground follows the new home team -- unless
 * the ground had been chosen by hand (it was not the old home team's usual
 * ground), in which case it is kept. Issued matches are never planned here:
 * their teams were confirmed with the clubs.
 *
 * scheduleWarnings says, in plain words, when hand edits have left a group
 * off the schedule the organiser asked for. It warns; it never blocks or
 * silently "fixes" the draw.
 *
 * Pure and deterministic, so it is tested rather than trusted.
 */

import type { VenueChoice } from "./drafts"

export interface EditableMatch {
  id: string
  stageId: string
  groupId: string | null
  roundNumber: number | null
  homeParticipantId: string | null
  awayParticipantId: string | null
  venueId: string | null
  venueText: string | null
  status: string
}

export interface MatchChange {
  id: string
  patch: {
    home_participant_id?: string | null
    away_participant_id?: string | null
    venue_id?: string | null
    venue_text?: string | null
    pitch_id?: string | null
  }
}

export type ReplacementPlan =
  | { kind: "replace"; changes: MatchChange[] }
  | { kind: "swap"; withMatchId: string; changes: MatchChange[] }
  | { kind: "refused"; reason: string }

type Side = "home" | "away"
const key = (side: Side) => (side === "home" ? "home_participant_id" : "away_participant_id") as "home_participant_id" | "away_participant_id"
const at = (m: EditableMatch, side: Side) => (side === "home" ? m.homeParticipantId : m.awayParticipantId)

function sameVenue(m: { venueId: string | null; venueText: string | null }, v: VenueChoice) {
  return (m.venueId ?? null) === (v.venueId ?? null) && (m.venueText ?? null) === (v.venueText ?? null)
}

/** The ground a match should have after its home team becomes `newHome`, or undefined to leave it as it is. */
function groundFor(m: EditableMatch, oldHome: string | null, newHome: string | null, venueFor: (id: string) => VenueChoice): Pick<MatchChange["patch"], "venue_id" | "venue_text" | "pitch_id"> {
  if (!newHome || newHome === oldHome) return {}
  const unset = !m.venueId && !m.venueText
  const followedOldHome = oldHome ? sameVenue(m, venueFor(oldHome)) : false
  if (!unset && !followedOldHome) return {}
  const next = venueFor(newHome)
  return { venue_id: next.venueId, venue_text: next.venueText, pitch_id: null }
}

export function planReplacement(match: EditableMatch, side: Side, participantId: string, all: EditableMatch[], venueFor: (homeParticipantId: string) => VenueChoice): ReplacementPlan {
  if (match.status !== "draft") return { kind: "refused", reason: "This match has been issued, so its teams stay as they are." }
  const current = at(match, side)
  if (current === participantId) return { kind: "replace", changes: [] }
  const other = at(match, side === "home" ? "away" : "home")
  if (other === participantId) return { kind: "refused", reason: "A team cannot play itself. Use Swap Home and Away to turn the match round." }

  const elsewhere = all.find(
    (m) =>
      m.id !== match.id &&
      m.stageId === match.stageId &&
      m.roundNumber !== null &&
      m.roundNumber === match.roundNumber &&
      (m.homeParticipantId === participantId || m.awayParticipantId === participantId),
  )

  const first: MatchChange = { id: match.id, patch: { [key(side)]: participantId } }
  if (side === "home") Object.assign(first.patch, groundFor(match, current, participantId, venueFor))

  if (!elsewhere) return { kind: "replace", changes: [first] }
  if (elsewhere.status !== "draft") return { kind: "refused", reason: "That team's other match this round has been issued, so it cannot be moved here." }

  const theirSide: Side = elsewhere.homeParticipantId === participantId ? "home" : "away"
  if (current && at(elsewhere, theirSide === "home" ? "away" : "home") === current) {
    return { kind: "refused", reason: "Those two teams already play each other this round." }
  }
  const second: MatchChange = { id: elsewhere.id, patch: { [key(theirSide)]: current } }
  if (theirSide === "home") Object.assign(second.patch, groundFor(elsewhere, participantId, current, venueFor))
  return { kind: "swap", withMatchId: elsewhere.id, changes: [first, second] }
}

export type ScheduleMode = { kind: "single" } | { kind: "double" } | { kind: "custom"; perTeam: number }

/**
 * Where a group's matches no longer add up to what was asked for. Returns one
 * sentence per problem, naming teams by the label function.
 */
export function scheduleWarnings(
  group: { name: string; members: string[] },
  matches: Pick<EditableMatch, "homeParticipantId" | "awayParticipantId" | "status">[],
  mode: ScheduleMode,
  label: (participantId: string) => string,
): string[] {
  const n = group.members.length
  const expected = mode.kind === "single" ? n - 1 : mode.kind === "double" ? 2 * (n - 1) : mode.perTeam
  const live = matches.filter((m) => m.status !== "cancelled" && m.homeParticipantId && m.awayParticipantId)
  const played = new Map(group.members.map((id) => [id, 0]))
  const pairs = new Map<string, number>()
  for (const m of live) {
    const h = m.homeParticipantId!
    const a = m.awayParticipantId!
    played.set(h, (played.get(h) ?? 0) + 1)
    played.set(a, (played.get(a) ?? 0) + 1)
    const pair = [h, a].sort().join("|")
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1)
  }

  const out: string[] = []
  const off = group.members.filter((id) => (played.get(id) ?? 0) !== expected)
  if (off.length > 0) {
    out.push(`${group.name}: each team should play ${expected}, but ${off.map((id) => `${label(id)} plays ${played.get(id) ?? 0}`).join(", ")}.`)
  }
  const allowed = mode.kind === "single" ? 1 : 2
  for (const [pair, count] of pairs) {
    if (count > allowed) {
      const [a, b] = pair.split("|")
      out.push(`${group.name}: ${label(a)} and ${label(b)} meet ${count} times.`)
    }
  }
  if (mode.kind === "double") {
    for (const [pair, count] of pairs) {
      if (count !== 2) continue
      const [a, b] = pair.split("|")
      const legs = live.filter((m) => [m.homeParticipantId, m.awayParticipantId].sort().join("|") === pair)
      if (legs[0].homeParticipantId === legs[1].homeParticipantId) out.push(`${group.name}: ${label(a)} and ${label(b)} play both matches at the same ground.`)
    }
  }
  return out
}
