import { fixtureOccupiedWindow, occupancyOverlaps, siblingReservations, timeToMinutes, tournamentOccupiedWindow, type TournamentOccupancy } from "./occupancy"
import type { AllocationFixture } from "./types"

/**
 * A TOURNAMENT ON THE SHARED PITCH ALLOCATION BOARD.
 *
 * A separate module for the same reason training-conflicts.ts is one: the
 * existing fixture-only detectConflicts and its regression suite are left
 * exactly as they are, and this computes the additional conflicts a
 * tournament's pitch reservations create against everything else on the day.
 *
 * THE ONE EXCEPTION, AND ITS EXACT SHAPE.
 *
 * A festival legitimately holds several pitches over overlapping periods.
 * Pitch 1 09:30-14:00 and Pitch 2 09:30-14:00 belonging to the SAME occasion
 * are not a clash -- they are what a festival is. Two of that tournament's
 * reservations are therefore never reported against each other, and the test
 * for "same tournament" is the stable parent id, never the fact that both rows
 * happen to be tournaments.
 *
 * Everything else conflicts completely normally. A tournament reservation
 * against a fixture, a training session, a club event, or a DIFFERENT
 * tournament is a genuine hard conflict, because in every one of those cases
 * two unrelated things believe they have the same pitch at the same time.
 *
 * NO BUFFERS ARE ADDED TO A RESERVATION. Its recorded start and end already
 * are the period the pitch is unavailable -- see occupancy.ts. Fixtures on the
 * other side of the comparison keep their own warm-up and pack-up, because
 * those minutes are genuinely part of the fixture's hold on the pitch.
 */

export interface TournamentReservationInput {
  id: string
  tournamentId: string
  tournamentName: string
  pitchId: string
  startTime: string
  endTime: string
}

/** Anything already on the board that occupies a pitch for a stated period. */
export interface OtherOccupant {
  kind: "fixture" | "training" | "event" | "tournament"
  id: string
  label: string
  pitchId: string
  start: number
  end: number
  /** Set only for a tournament reservation; this is what makes the sibling test possible. */
  tournamentId: string | null
}

export interface TournamentConflict {
  reservationId: string
  tournamentId: string
  severity: "hard"
  reason: string
}

export interface FixtureConflictFromTournament {
  fixtureId: string
  severity: "hard"
  reason: string
}

export function occupantsFromFixtures(
  fixtures: AllocationFixture[],
  buffers: { warmUpMinutes: number; packUpMinutes: number }
): OtherOccupant[] {
  const out: OtherOccupant[] = []
  for (const f of fixtures) {
    if (!f.pitchId || !f.kickoffTime) continue
    const w = fixtureOccupiedWindow(f, buffers)
    if (!w) continue
    out.push({
      kind: "fixture",
      id: f.fixtureId,
      label: `${f.homeTeamLabel} v ${f.opponentLabel}`,
      pitchId: f.pitchId,
      start: w.start,
      end: w.end,
      tournamentId: null,
    })
  }
  return out
}

export function occupantsFromSpans(
  kind: "training" | "event",
  spans: { id: string; label: string; pitchId: string | null; startTime: string | null; endTime?: string | null; durationMinutes?: number | null }[]
): OtherOccupant[] {
  const out: OtherOccupant[] = []
  for (const s of spans) {
    if (!s.pitchId || !s.startTime) continue
    const start = timeToMinutes(s.startTime)
    const end = s.endTime ? timeToMinutes(s.endTime) : s.durationMinutes != null ? start + s.durationMinutes : null
    if (end == null) continue
    out.push({ kind, id: s.id, label: s.label, pitchId: s.pitchId, start, end, tournamentId: null })
  }
  return out
}

export function toTournamentOccupancies(reservations: TournamentReservationInput[]): TournamentOccupancy[] {
  return reservations.map(tournamentOccupiedWindow)
}

export function detectTournamentConflicts(
  reservations: TournamentReservationInput[],
  others: OtherOccupant[]
): { tournamentConflicts: TournamentConflict[]; fixtureConflicts: FixtureConflictFromTournament[] } {
  const windows = toTournamentOccupancies(reservations)
  const tournamentConflicts: TournamentConflict[] = []
  const fixtureConflicts: FixtureConflictFromTournament[] = []

  // Every reservation is also an occupant, so two DIFFERENT tournaments on the
  // same pitch clash exactly as any other pair would.
  const reservationOccupants: OtherOccupant[] = windows.map((w) => ({
    kind: "tournament",
    id: w.reservationId,
    label: w.tournamentName,
    pitchId: w.pitchId,
    start: w.start,
    end: w.end,
    tournamentId: w.tournamentId,
  }))
  const everything = [...others, ...reservationOccupants]

  for (const w of windows) {
    const clashes = everything.filter(
      (o) =>
        o.pitchId === w.pitchId &&
        o.id !== w.reservationId &&
        // THE EXCEPTION, decided by parent identity and nothing else.
        !siblingReservations({ tournamentId: w.tournamentId }, { tournamentId: o.tournamentId }) &&
        occupancyOverlaps(w, o)
    )
    if (clashes.length === 0) continue
    tournamentConflicts.push({
      reservationId: w.reservationId,
      tournamentId: w.tournamentId,
      severity: "hard",
      reason: `Overlaps with ${clashes.map((c) => c.label).join(", ")} on the same pitch.`,
    })
    for (const c of clashes) {
      if (c.kind !== "fixture") continue
      fixtureConflicts.push({
        fixtureId: c.id,
        severity: "hard",
        reason: `Overlaps with ${w.tournamentName} on the same pitch — the tournament holds it for this period.`,
      })
    }
  }

  return { tournamentConflicts, fixtureConflicts }
}
