import type { AllocationFixture, PitchAllocationBoard } from "@ovalball/contracts/pitch-allocation"

import { applyPending, previewPlacement, type PendingChange } from "./model"

/**
 * STAGING -- the website's `pendingChanges` model, as pure functions (CA-M11.2).
 *
 * A drop, a proposal or the accessible Move sheet stages a change; nothing writes until Save. A staged
 * change may put a fixture on a pitch at a time, or take it OFF its pitch (`pitchId: null`), which the
 * website has no board control for and the canonical clear operation performs at save time.
 */
export type StagedChanges = Map<string, PendingChange>

export function stageMove(pending: StagedChanges, fixtureId: string, pitchId: string, kickoffTime: string): StagedChanges {
  const next = new Map(pending)
  next.set(fixtureId, { pitchId, kickoffTime })
  return next
}

export function stageRemoval(pending: StagedChanges, fixtureId: string): StagedChanges {
  const next = new Map(pending)
  next.set(fixtureId, { pitchId: null, kickoffTime: null })
  return next
}

export function unstage(pending: StagedChanges, fixtureId: string): StagedChanges {
  const next = new Map(pending)
  next.delete(fixtureId)
  return next
}

/** A staged change that puts the fixture back exactly where the saved board has it is no change at all. */
export function isNoOp(board: PitchAllocationBoard, fixtureId: string, change: PendingChange): boolean {
  const saved = board.fixtures.find((f) => f.fixtureId === fixtureId) ?? board.unallocated.find((f) => f.fixtureId === fixtureId)
  if (!saved) return false
  if (change.pitchId === null) return saved.pitchId === null
  return saved.pitchId === change.pitchId && (saved.kickoffTime ?? null) === (change.kickoffTime ?? null)
}

/** The board with the staged changes laid over it, including removals (which the shared apply does not model). */
export function draftBoard(board: PitchAllocationBoard, pending: StagedChanges): PitchAllocationBoard {
  const removals = new Set(Array.from(pending.entries()).filter(([, c]) => c.pitchId === null).map(([id]) => id))
  const moves: StagedChanges = new Map(Array.from(pending.entries()).filter(([, c]) => c.pitchId !== null))
  const applied = applyPending(board, moves)
  if (removals.size === 0) return applied
  const removed = applied.fixtures.filter((f) => removals.has(f.fixtureId)).map((f) => ({ ...f, pitchId: null }))
  return {
    ...applied,
    fixtures: applied.fixtures.filter((f) => !removals.has(f.fixtureId)),
    unallocated: [...applied.unallocated, ...removed],
    conflicts: applied.conflicts.filter((c) => !removals.has(c.fixtureId)),
  }
}

/** What placing a fixture here would clash with, using the shared detectors over the draft. */
export function placementPreview(board: PitchAllocationBoard, pending: StagedChanges, fixtureId: string, pitchId: string, kickoffTime: string) {
  // Over the DRAFT: a fixture staged off its pitch has left the lane, and one staged onto a lane is there.
  return previewPlacement(draftBoard(board, pending), new Map(), fixtureId, pitchId, kickoffTime)
}

/** The writes Save will make, in order: one canonical operation per staged fixture. */
export type SavePayloadItem = { fixtureId: string; op: "place"; pitchId: string; kickoffTime: string } | { fixtureId: string; op: "clear" }

export function savePayload(pending: StagedChanges): SavePayloadItem[] {
  return Array.from(pending.entries()).map(([fixtureId, c]) => (c.pitchId === null ? { fixtureId, op: "clear" as const } : { fixtureId, op: "place" as const, pitchId: c.pitchId, kickoffTime: c.kickoffTime ?? "" }))
}

export function fixtureById(board: PitchAllocationBoard, fixtureId: string): AllocationFixture | null {
  return board.fixtures.find((f) => f.fixtureId === fixtureId) ?? board.unallocated.find((f) => f.fixtureId === fixtureId) ?? null
}
