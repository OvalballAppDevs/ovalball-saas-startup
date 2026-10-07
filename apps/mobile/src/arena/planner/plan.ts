import { activityTitle, type ArenaChange, type ArenaFixture, type ArenaTraining } from "@ovalball/contracts/arena"

/**
 * THE PLAN -- every change somebody is making to the day, held on the phone until Save, as one thing.
 *
 * Arena Planning used to have three ways to change an allocation and three ways for them to land: a drag on
 * the Pitches board was staged, the Allocate sheet saved at once, and Auto Allocate applied its own proposal.
 * Now a drag, the Allocate sheet and an Auto Allocate proposal all stage into THIS plan, and Save sends the
 * whole plan to the server as one transaction (`apply_arena_allocation`) -- which checks it with the one set
 * of rules and refuses it whole, in its own words, if anything is wrong. Nothing here decides validity.
 *
 * A change holds only the parts it alters (venue, pitch, rooms, and its time) and, for each,
 * what the part was when it was read -- so a plan made before somebody else's change is refused rather than
 * applied over it. Each change says whose decision it is: Auto Allocate's proposal stays AUTO (a re-run may
 * recalculate it, a lock still binds it), and the moment a person alters it, it is theirs.
 */

export type PlanOrigin = "MANUAL" | "AUTO"
export type Allocatable = ArenaFixture | ArenaTraining
export type PlanKind = Allocatable["kind"]

/**
 * The parts of an allocation a plan can set. A training session has a venue, a pitch, ONE changing room (its
 * team's own, so `homeRoomId`) and a start time; whether a time may move at all is the server's to say
 * (`activity.time`), and Save moves it only through the time's own writer.
 */
export interface PlanParts {
  venueId?: string | null
  pitchId?: string | null
  homeRoomId?: string | null
  awayRoomId?: string | null
  officialsRoomId?: string | null
  /** When it starts, "HH:MM": a fixture's kick-off, a training session's start. */
  kickoff?: string | null
}
export type PartKey = keyof PlanParts
const FIXTURE_PARTS: PartKey[] = ["venueId", "pitchId", "homeRoomId", "awayRoomId", "officialsRoomId", "kickoff"]
const TRAINING_PARTS: PartKey[] = ["venueId", "pitchId", "homeRoomId", "kickoff"]

export interface PlannedChange {
  key: string
  kind: PlanKind
  id: string
  /** The activity, as the plan names it in a list ("Women's 1st Team v Sedgley Park"). */
  label: string
  set: PlanParts
  /** What each part in `set` was when the plan read it. */
  expected: PlanParts
  origin: PlanOrigin
  /** Why it is where it is -- Auto Allocate's explanation, or what a move did to the rooms. */
  notes: string[]
}

export type Plan = ReadonlyMap<string, PlannedChange>
export const EMPTY_PLAN: Plan = new Map()

export const planKey = (kind: PlanKind, id: string): string => `${kind}:${id}`

/** Where an activity is, part by part, as the server last said. */
export function savedParts(a: Allocatable): Required<PlanParts> {
  if (a.kind === "FIXTURE") {
    return { venueId: a.venueId, pitchId: a.pitchId, homeRoomId: a.homeRoomId, awayRoomId: a.awayRoomId, officialsRoomId: a.officialsRoomId, kickoff: a.kickoff }
  }
  return { venueId: a.venueId, pitchId: a.pitchId, homeRoomId: a.roomId, awayRoomId: null, officialsRoomId: null, kickoff: a.start }
}

const same = (x: string | null | undefined, y: string | null | undefined) => (x ?? null) === (y ?? null)

/**
 * STAGE parts of one activity's allocation. Parts set back to what is saved drop out, and a change left with
 * nothing in it is no change at all. A person touching Auto Allocate's proposal makes it theirs.
 */
export function stage(plan: Plan, a: Allocatable, parts: PlanParts, origin: PlanOrigin, notes: string[] = []): Plan {
  const key = planKey(a.kind, a.id)
  const allowed = a.kind === "FIXTURE" ? FIXTURE_PARTS : TRAINING_PARTS
  const saved = savedParts(a)
  const prev = plan.get(key)
  const set: PlanParts = { ...(prev?.set ?? {}) }
  for (const k of allowed) if (k in parts) set[k] = parts[k] ?? null
  for (const k of Object.keys(set) as PartKey[]) if (same(set[k], saved[k])) delete set[k]
  const next = new Map(plan)
  if (Object.keys(set).length === 0) {
    next.delete(key)
    return next
  }
  const expected: PlanParts = {}
  for (const k of Object.keys(set) as PartKey[]) expected[k] = saved[k] ?? null
  const nextOrigin: PlanOrigin = origin === "MANUAL" || prev?.origin === "MANUAL" ? "MANUAL" : "AUTO"
  next.set(key, { key, kind: a.kind, id: a.id, label: activityTitle(a), set, expected, origin: nextOrigin, notes: notes.length > 0 ? notes : prev?.notes ?? [] })
  return next
}

export function unstage(plan: Plan, key: string): Plan {
  if (!plan.has(key)) return plan
  const next = new Map(plan)
  next.delete(key)
  return next
}

/** The plan without Auto Allocate's untouched proposals -- what Discard on a proposal leaves. */
export function withoutAuto(plan: Plan): Plan {
  return new Map(Array.from(plan.entries()).filter(([, c]) => c.origin !== "AUTO"))
}

/** An activity's allocation with the plan laid over it. */
export function plannedParts(plan: Plan, a: Allocatable): Required<PlanParts> {
  const saved = savedParts(a)
  const change = plan.get(planKey(a.kind, a.id))
  if (!change) return saved
  return { ...saved, ...change.set } as Required<PlanParts>
}

export function changeFor(plan: Plan, a: Pick<Allocatable, "kind" | "id">): PlannedChange | null {
  return plan.get(planKey(a.kind, a.id)) ?? null
}

/** The plan as the server takes it: every change, each saying what it expects and whose decision it is. */
export function toArenaChanges(plan: Plan): ArenaChange[] {
  return Array.from(plan.values()).map((c) => ({ kind: c.kind, id: c.id, expected: { ...c.expected }, set: { ...c.set }, source: c.origin }))
}

export function planCounts(plan: Plan): { total: number; manual: number; auto: number } {
  let auto = 0
  for (const c of plan.values()) if (c.origin === "AUTO") auto += 1
  return { total: plan.size, manual: plan.size - auto, auto }
}
