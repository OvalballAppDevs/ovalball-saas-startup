import type { AllocationFixture, ClubSchedulingPolicy, PitchOption } from "./types"

/**
 * Training + Fixture shared resource-conflict layer (Section 32-38, 60,
 * 67). Deliberately a NEW, separate function rather than a change to
 * detectConflicts() in auto-allocate.ts: that function's existing
 * behaviour, type (AllocationFixture/AllocationConflict, both keyed by
 * fixtureId), and regression suite (auto-allocate.verify.ts) are untouched
 * by this file -- zero risk of regressing Pitch Allocation's existing
 * fixture-only conflict detection. This module instead computes conflicts
 * across the COMBINED occupancy of fixtures and training sessions on the
 * same pitches, reporting fixture-side and training-side conflicts
 * separately so existing fixture-card rendering needs no change.
 *
 * Training has NO setup/pack-up window (Section 27/34, a hard product
 * rule) -- its occupied window is exactly start -> start + duration,
 * never padded by policy.warmUpMinutes/packUpMinutes the way a fixture is.
 */

export interface TrainingOccupancy {
  trainingSessionId: string
  teamLabel: string
  venueId: string | null
  pitchId: string | null
  sessionDate: string
  startTime: string | null
  durationMinutes: number | null
  /** CANCELLED training never occupies a pitch (Section 85). */
  status: "PLANNED" | "CANCELLED"
  source: "MANUAL" | "AUTOMATIC_PLAN"
}

export type ResourceConflictSeverity = "hard" | "warning"

export interface TrainingConflict {
  trainingSessionId: string
  severity: ResourceConflictSeverity
  reason: string
}

export interface FixtureConflictFromTraining {
  fixtureId: string
  severity: ResourceConflictSeverity
  reason: string
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number)
  return h * 60 + m
}

interface Window {
  kind: "fixture" | "training"
  id: string
  label: string
  pitchId: string
  start: number
  end: number
}

/**
 * Considers BOTH fixture and training occupancy on every pitch at once
 * (Section 35). Fixtures keep their existing warm-up/pack-up padding;
 * training never gets any padding, matching Section 27's hard rule.
 * Cancelled training sessions and fixtures without both a pitch and a
 * kick-off time are excluded (mirroring partitionAllocation's own
 * allocated/unallocated split -- an unallocated fixture has no window to
 * conflict with anything, computed rather than stored, same as today).
 */
export function detectResourceConflicts(
  fixtures: AllocationFixture[],
  trainingSessions: TrainingOccupancy[],
  pitches: PitchOption[],
  buffers: { warmUpMinutes: number; packUpMinutes: number } = { warmUpMinutes: 0, packUpMinutes: 0 }
): { fixtureConflicts: FixtureConflictFromTraining[]; trainingConflicts: TrainingConflict[] } {
  const byPitch = new Map<string, Window[]>()

  for (const f of fixtures) {
    if (!f.pitchId || !f.kickoffTime) continue
    const list = byPitch.get(f.pitchId) ?? []
    list.push({
      kind: "fixture",
      id: f.fixtureId,
      label: `${f.homeTeamLabel} v ${f.opponentLabel}`,
      pitchId: f.pitchId,
      start: timeToMinutes(f.kickoffTime) - buffers.warmUpMinutes,
      end: timeToMinutes(f.kickoffTime) + (f.durationMinutes ?? 60) + buffers.packUpMinutes,
    })
    byPitch.set(f.pitchId, list)
  }

  for (const t of trainingSessions) {
    if (t.status === "CANCELLED" || !t.pitchId || !t.startTime || t.durationMinutes == null) continue
    const list = byPitch.get(t.pitchId) ?? []
    list.push({
      kind: "training",
      id: t.trainingSessionId,
      label: `${t.teamLabel} — Planned Training`,
      pitchId: t.pitchId,
      start: timeToMinutes(t.startTime),
      end: timeToMinutes(t.startTime) + t.durationMinutes,
    })
    byPitch.set(t.pitchId, list)
  }

  const fixtureConflicts: FixtureConflictFromTraining[] = []
  const trainingConflicts: TrainingConflict[] = []

  for (const [pitchId, list] of byPitch) {
    const pitch = pitches.find((p) => p.id === pitchId)
    const laneCount = pitch?.laneCount ?? 1
    const sorted = [...list].sort((a, b) => a.start - b.start)
    const active: Window[] = []
    for (const w of sorted) {
      for (let i = active.length - 1; i >= 0; i--) {
        if (active[i].end <= w.start) active.splice(i, 1)
      }
      active.push(w)
      if (active.length > laneCount) {
        const others = active.filter((a) => a !== w)
        // A pitch-wide double-booking is a hard conflict regardless of
        // whether the two overlapping commitments are two fixtures, two
        // training sessions, or one of each (Section 35's three examples).
        const reason = `Overlaps with ${others.map((o) => o.label).join(", ")} on the same pitch${laneCount > 1 ? ` (this pitch's capacity is ${laneCount} at once)` : ""}.`
        if (w.kind === "fixture") fixtureConflicts.push({ fixtureId: w.id, severity: "hard", reason })
        else trainingConflicts.push({ trainingSessionId: w.id, severity: "hard", reason })
      }
    }
  }

  return { fixtureConflicts, trainingConflicts }
}

/**
 * Section 36: automatic booking must never silently drop or relocate a
 * session when its preferred pitch is unavailable -- surface it as
 * needing allocation instead. Mirrors unallocatedReason()'s "always show
 * why" contract for fixtures (auto-allocate.ts).
 */
export function trainingNeedsAllocationReview(session: TrainingOccupancy, conflicts: TrainingConflict[]): boolean {
  if (session.status === "CANCELLED") return false
  if (!session.pitchId || !session.startTime) return true
  return conflicts.some((c) => c.trainingSessionId === session.trainingSessionId)
}

/** Section 33: card content -- no opponent, no home/away, no setup/pack-up wording. */
export function trainingCardTitle(teamLabel: string): string {
  return `${teamLabel} — Planned Training`
}

export function trainingOccupiedWindow(session: Pick<TrainingOccupancy, "startTime" | "durationMinutes">): { start: number; end: number } | null {
  if (!session.startTime || session.durationMinutes == null) return null
  const start = timeToMinutes(session.startTime)
  return { start, end: start + session.durationMinutes }
}

export function policyFromDefaults(policy: ClubSchedulingPolicy) {
  return { warmUpMinutes: policy.warmUpMinutes, packUpMinutes: policy.packUpMinutes }
}
