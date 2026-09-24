/**
 * HOW LONG A PITCH IS ACTUALLY OCCUPIED.
 *
 * THE ONE ANSWER. A fixture does not occupy a pitch from kick-off to the final
 * whistle -- it occupies it from the moment the teams walk out to warm up
 * until the last flag is carried off. Everything that asks "is this pitch
 * free" has to ask the same question the same way, or the board draws one
 * window, the conflict detector tests a second, and the auto-allocator books
 * a third.
 *
 * That is exactly what had happened. The interval
 *
 *     kickoff - warmUp  ...  kickoff + duration + packUp
 *
 * was written out longhand in FOUR places: the auto-allocator's placement
 * loop, its own detectConflicts, detectResourceConflicts in
 * training-conflicts.ts, and again in pixels inside the board component. All
 * four agreed at the time, which is the dangerous kind of duplication -- it
 * only diverges later, quietly, when one of them is changed.
 *
 * So the arithmetic lives here once. Every consumer imports it, including the
 * renderer: the bands drawn on screen are positioned from the SAME numbers the
 * conflict detector tests, so what a person sees reserved is what the system
 * treats as reserved.
 *
 * WHAT THIS IS NOT. It is not a settings source. The buffers are passed in,
 * having come from public.club_scheduling_policy via the board's own read --
 * this module holds no defaults of its own precisely so it cannot become a
 * second place where warm-up is decided.
 *
 * TRAINING, EVENTS AND TOURNAMENTS ARE DELIBERATELY NOT PADDED. A training
 * session occupies its own recorded start-to-finish (see
 * trainingOccupiedWindow), a club event occupies its own recorded span, and a
 * tournament reservation already states the real period for which the pitch is
 * unavailable -- a festival holding Pitch 1 from 09:30 to 14:00 has its own
 * warm-up and clear-down inside that period, and adding a fixture's match-day
 * buffers on top would reserve time nobody asked for and would make the board
 * disagree with the organiser who typed the times.
 */

/** Minutes past midnight. Null start times are the caller's problem, not this module's. */
export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number)
  return h * 60 + m
}

export interface OccupancyBuffers {
  warmUpMinutes: number
  packUpMinutes: number
}

/**
 * The three phases of one fixture reservation, in minutes past midnight.
 *
 * ONE reservation, three phases -- never three bookings. `start` and `end` are
 * the full reserved interval; `playStart`/`playEnd` mark the rugby inside it.
 * A caller that wants "is the pitch free" uses start/end; a caller drawing the
 * timeline uses all four.
 */
export interface FixtureOccupancy {
  /** Warm-up begins: the pitch stops being free here. */
  start: number
  playStart: number
  playEnd: number
  /** Pack-up ends: the pitch is free again here. */
  end: number
  warmUpMinutes: number
  packUpMinutes: number
  playMinutes: number
}

/** The default match length when a fixture carries none, matching the rest of this domain. */
const FALLBACK_PLAY_MINUTES = 60

export function fixtureOccupiedWindow(
  fixture: { kickoffTime: string | null; durationMinutes?: number | null },
  buffers: OccupancyBuffers
): FixtureOccupancy | null {
  if (!fixture.kickoffTime) return null

  // Negative buffers would run the reservation backwards through itself, and a
  // misconfigured setting must not be able to produce a window that reports a
  // pitch as free during its own match.
  const warmUpMinutes = Math.max(0, buffers.warmUpMinutes)
  const packUpMinutes = Math.max(0, buffers.packUpMinutes)
  const playMinutes = fixture.durationMinutes ?? FALLBACK_PLAY_MINUTES

  const playStart = timeToMinutes(fixture.kickoffTime)
  const playEnd = playStart + playMinutes

  return {
    start: playStart - warmUpMinutes,
    playStart,
    playEnd,
    end: playEnd + packUpMinutes,
    warmUpMinutes,
    packUpMinutes,
    playMinutes,
  }
}

/**
 * Do two reserved intervals overlap?
 *
 * Half-open on purpose: a pack-up that ends at 12:20 does not conflict with a
 * warm-up that begins at 12:20 -- the pitch is genuinely handed over on the
 * boundary. Anything strictly inside does conflict, which is the case the
 * brief calls out: a fixture at 12:05 is NOT free just because the previous
 * match's play ended at 12:00.
 */
export function occupancyOverlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && a.end > b.start
}

/**
 * One tournament's hold on one pitch, in the same minutes-past-midnight terms
 * as everything else on the board, so a tournament and a fixture are compared
 * by the same arithmetic rather than by two similar-looking ones.
 *
 * `tournamentId` is carried through deliberately -- see siblingReservations.
 */
export interface TournamentOccupancy {
  reservationId: string
  tournamentId: string
  tournamentName: string
  pitchId: string
  start: number
  end: number
}

export function tournamentOccupiedWindow(reservation: {
  id: string
  tournamentId: string
  tournamentName: string
  pitchId: string
  startTime: string
  endTime: string
}): TournamentOccupancy {
  return {
    reservationId: reservation.id,
    tournamentId: reservation.tournamentId,
    tournamentName: reservation.tournamentName,
    pitchId: reservation.pitchId,
    start: timeToMinutes(reservation.startTime),
    end: timeToMinutes(reservation.endTime),
  }
}

/**
 * TWO RESERVATIONS OF THE SAME TOURNAMENT ARE NOT A CONFLICT.
 *
 * A festival genuinely runs on three pitches at once, and its Pitch 1 and
 * Pitch 2 holds genuinely overlap from 09:30 to 14:00. Reporting that as the
 * tournament conflicting with itself would make the board cry wolf on the one
 * day of the season it matters most.
 *
 * THE EXCEPTION IS EXACTLY THIS AND NOTHING WIDER. It is decided by stable
 * parent identity -- the same `tournament_id` -- never by "it is a tournament,
 * so skip it". A tournament reservation against an unrelated fixture, training
 * session, club event or a DIFFERENT tournament conflicts completely normally,
 * which is what the second half of this predicate protects.
 */
export function siblingReservations(
  a: { tournamentId: string | null },
  b: { tournamentId: string | null }
): boolean {
  return a.tournamentId !== null && b.tournamentId !== null && a.tournamentId === b.tournamentId
}
