import {
  detectConflicts,
  detectResourceConflicts,
  detectTournamentConflicts,
  fixtureOccupiedWindow,
  occupantsFromFixtures,
  occupantsFromSpans,
  partitionAllocation,
  timeToMinutes,
  trainingOccupiedWindow,
  unallocatedReason,
  type AllocationConflict,
  type AllocationFixture,
  type PitchAllocationBoard,
  type PitchOption,
} from "@ovalball/contracts/pitch-allocation"

/**
 * THE PHONE'S VIEW OF THE BOARD -- presentation only (CA-M11.1).
 *
 * The website draws pitches as rows and time as columns. A phone draws each pitch as a card and the
 * day as a list inside it, in time order. Everything here is arrangement: the rows, the windows, the
 * conflicts and the "unallocated" answer all come from the shared package, from the same functions the
 * website's board and the server's read model call. A staged change (a Move not yet saved) is laid over
 * the board here, exactly as the website's `pendingChanges` is, so the badges are honest before Save.
 */

export interface PendingChange {
  pitchId: string | null
  kickoffTime: string | null
}

export function applyPending(board: PitchAllocationBoard, pending: Map<string, PendingChange>): PitchAllocationBoard {
  if (pending.size === 0) return board
  const all = [...board.fixtures, ...board.unallocated].map((f) => {
    const change = pending.get(f.fixtureId)
    if (!change) return f
    return { ...f, pitchId: change.pitchId ?? f.pitchId, kickoffTime: change.kickoffTime ?? f.kickoffTime }
  })
  const { allocated, unallocated } = partitionAllocation(all)
  const buffers = { warmUpMinutes: board.policy.warmUpMinutes, packUpMinutes: board.policy.packUpMinutes }
  const conflicts = detectConflicts(allocated, board.pitches, buffers)
  const { fixtureConflicts: fixtureConflictsFromTraining, trainingConflicts } = detectResourceConflicts(allocated, board.trainingSessions, board.pitches, buffers)
  const { tournamentConflicts, fixtureConflicts: fromTournament } = detectTournamentConflicts(
    board.tournaments.map((t) => ({ id: t.id, tournamentId: t.tournamentId, tournamentName: t.tournamentName, pitchId: t.pitchId, startTime: t.startTime, endTime: t.endTime })),
    [
      ...occupantsFromFixtures(allocated, buffers),
      ...occupantsFromSpans(
        "training",
        board.trainingSessions.filter((t) => t.status !== "CANCELLED").map((t) => ({ id: t.trainingSessionId, label: `${t.teamLabel} — Planned Training`, pitchId: t.pitchId, startTime: t.startTime, durationMinutes: t.durationMinutes }))
      ),
      ...occupantsFromSpans("event", board.clubEvents.map((e) => ({ id: e.eventId, label: e.name, pitchId: e.pitchId, startTime: e.startTime, endTime: e.endTime }))),
    ]
  )
  for (const c of fromTournament) if (!conflicts.some((x) => x.fixtureId === c.fixtureId)) conflicts.push(c)
  return { ...board, fixtures: allocated, unallocated, conflicts, trainingConflicts, fixtureConflictsFromTraining, tournamentConflicts }
}

export type PitchItem =
  | { kind: "fixture"; start: number; end: number; playStart: number; playEnd: number; fixture: AllocationFixture; conflict: AllocationConflict | null; trainingConflict: string | null }
  | { kind: "training"; start: number; end: number; id: string; label: string; conflict: string | null }
  | { kind: "event"; start: number | null; end: number | null; id: string; label: string; isMultiDay: boolean }
  | { kind: "tournament"; start: number; end: number; id: string; label: string; teamLabels: string[]; conflict: string | null }

export interface PitchCard {
  pitch: PitchOption
  items: PitchItem[]
  hardCount: number
  warningCount: number
}

export interface VenueGroup {
  venueId: string | null
  pitches: PitchCard[]
}

/** Every pitch (active first, inactive last) as a card of the day's occupancy in time order. */
export function pitchCards(board: PitchAllocationBoard): PitchCard[] {
  const conflictByFixture = new Map(board.conflicts.map((c) => [c.fixtureId, c]))
  const trainingConflictByFixture = new Map(board.fixtureConflictsFromTraining.map((c) => [c.fixtureId, c.reason]))
  const trainingConflictById = new Map(board.trainingConflicts.map((c) => [c.trainingSessionId, c.reason]))
  const tournamentConflictById = new Map(board.tournamentConflicts.map((c) => [c.reservationId, c.reason]))
  const buffers = { warmUpMinutes: board.policy.warmUpMinutes, packUpMinutes: board.policy.packUpMinutes }
  return board.pitches.map((pitch) => {
    const items: PitchItem[] = []
    for (const f of board.fixtures) {
      if (f.pitchId !== pitch.id) continue
      const w = fixtureOccupiedWindow(f, buffers)
      if (!w) continue
      items.push({ kind: "fixture", start: w.start, end: w.end, playStart: w.playStart, playEnd: w.playEnd, fixture: f, conflict: conflictByFixture.get(f.fixtureId) ?? null, trainingConflict: trainingConflictByFixture.get(f.fixtureId) ?? null })
    }
    for (const t of board.trainingSessions) {
      if (t.pitchId !== pitch.id || t.status === "CANCELLED") continue
      const w = trainingOccupiedWindow(t)
      if (!w) continue
      items.push({ kind: "training", start: w.start, end: w.end, id: t.trainingSessionId, label: t.teamLabel, conflict: trainingConflictById.get(t.trainingSessionId) ?? null })
    }
    for (const e of board.clubEvents) {
      if (e.pitchId !== pitch.id) continue
      items.push({ kind: "event", start: e.startTime ? timeToMinutes(e.startTime) : null, end: e.endTime ? timeToMinutes(e.endTime) : null, id: e.eventId, label: e.name, isMultiDay: e.isMultiDay })
    }
    for (const t of board.tournaments) {
      if (t.pitchId !== pitch.id) continue
      items.push({ kind: "tournament", start: timeToMinutes(t.startTime), end: timeToMinutes(t.endTime), id: t.id, label: t.tournamentName, teamLabels: t.teamLabels, conflict: tournamentConflictById.get(t.id) ?? null })
    }
    items.sort((a, b) => (a.start ?? -1) - (b.start ?? -1))
    const hardCount = items.filter((i) => (i.kind === "fixture" && (i.conflict?.severity === "hard" || i.trainingConflict)) || (i.kind !== "fixture" && i.kind !== "event" && i.conflict)).length
    const warningCount = items.filter((i) => i.kind === "fixture" && i.conflict?.severity === "warning").length
    return { pitch, items, hardCount, warningCount }
  })
}

/** Cards grouped by ground. The website lists every pitch in one grid; a phone chooses a ground first. */
export function groupByVenue(cards: PitchCard[]): VenueGroup[] {
  const groups = new Map<string | null, PitchCard[]>()
  for (const card of cards) {
    const list = groups.get(card.pitch.venueId) ?? []
    list.push(card)
    groups.set(card.pitch.venueId, list)
  }
  return Array.from(groups.entries()).map(([venueId, pitches]) => ({ venueId, pitches }))
}

export function minutesToTime(m: number): string {
  const hh = Math.floor(m / 60).toString().padStart(2, "0")
  const mm = (m % 60).toString().padStart(2, "0")
  return `${hh}:${mm}`
}

export function timeLabel(hhmm: string | null): string {
  return hhmm ? hhmm.slice(0, 5) : "—"
}

export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

/** The reason a fixture sits in the tray, in the website's words. */
export function trayReason(fixture: AllocationFixture, pitches: PitchOption[]): string {
  return unallocatedReason(fixture, pitches)
}

export interface Summary {
  total: number
  allocated: number
  needsAttention: number
  activePitches: number
}

export function summarise(board: PitchAllocationBoard): Summary {
  const flagged = new Set([...board.conflicts.map((c) => c.fixtureId), ...board.fixtureConflictsFromTraining.map((c) => c.fixtureId)])
  return {
    total: board.fixtures.length + board.unallocated.length,
    allocated: board.fixtures.length,
    needsAttention: board.unallocated.length + flagged.size,
    activePitches: board.pitches.filter((p) => p.active).length,
  }
}

/**
 * What placing this fixture on this pitch at this time would clash with, computed the way the website's
 * live badges are: the shared detectors over the draft board with the change applied.
 */
export function previewPlacement(board: PitchAllocationBoard, pending: Map<string, PendingChange>, fixtureId: string, pitchId: string, kickoffTime: string): AllocationConflict | null {
  const next = new Map(pending)
  next.set(fixtureId, { pitchId, kickoffTime })
  const draft = applyPending(board, next)
  return draft.conflicts.find((c) => c.fixtureId === fixtureId) ?? draft.fixtureConflictsFromTraining.map((c) => ({ fixtureId: c.fixtureId, severity: c.severity, reason: c.reason })).find((c) => c.fixtureId === fixtureId) ?? null
}

export function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

export function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
