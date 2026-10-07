import { useCallback, useEffect, useMemo, useState } from "react"

import {
  applyArenaAllocation,
  clock,
  previewArenaAllocation,
  toMinutes,
  readArenaPreferences,
  type AllocationPreview,
  type ArenaDay,
  type ArenaFixture,
  type ArenaPreferences,
  type PreferencePurpose,
} from "@ovalball/contracts/arena"

import { supabase } from "../../auth/supabase"
import { friendlyAction, logDetail } from "../../errors/translate"
import { EMPTY_PLAN, planCounts, plannedParts, stage, toArenaChanges, unstage, withoutAuto, type Allocatable, type Plan, type PlanParts } from "./plan"
import {
  draftOccupancy,
  fixtureRoomWindow,
  pitchClash,
  plannedNeeds,
  recommendRooms,
  recommendTrainingRoom,
  roomClash,
  roomDemand,
  roomFit,
  roomPart,
  trainingRoomWindow,
  type Clash,
  type RoomRole,
} from "./rules"

export type AutoState =
  | { state: "idle" }
  | { state: "calculating" }
  | { state: "proposed"; preview: AllocationPreview }
  | { state: "failed"; message: string }

/**
 * THE DAY'S PLAN, FOR EVERY VIEW OF THE DAY -- the Pitches board, the Changing Rooms board, the List and the
 * Allocate sheet all read and change the same plan through this one hook, so a change made in one is there in
 * the others before Save, and Save is one transaction whichever view it is pressed in.
 */
export function useDayPlanner({ clubId, day, onSaved, sample }: {
  clubId: string | null
  day: ArenaDay | null
  onSaved: (message: string) => void | Promise<void>
  /** DEVELOPMENT ONLY: a day made up in memory (`stress-day.ts`). Auto Allocate shows its fixed sample and Save refuses. */
  sample?: { preview: (day: ArenaDay) => AllocationPreview } | null
}) {
  const [plan, setPlan] = useState<Plan>(EMPTY_PLAN)
  const [prefs, setPrefs] = useState<ArenaPreferences | null>(null)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [auto, setAuto] = useState<AutoState>({ state: "idle" })

  // Another day is another plan: the screen asks before leaving one with anything in it.
  const date = day?.date ?? null
  useEffect(() => {
    setPlan(EMPTY_PLAN)
    setAuto({ state: "idle" })
    setProblem(null)
  }, [date])

  // The club's and each team's ranked preferences: what a room recommendation tries first.
  useEffect(() => {
    if (!clubId) return
    let alive = true
    readArenaPreferences(supabase, clubId).then((p) => { if (alive) setPrefs(p) }).catch(() => { if (alive) setPrefs(null) })
    return () => { alive = false }
  }, [clubId])

  const draft = useMemo(() => (day ? draftOccupancy(day, plan) : []), [day, plan])
  const counts = planCounts(plan)

  const preferred = useCallback((teamId: string | null, purpose: PreferencePurpose): string[] => {
    if (!prefs) return []
    const own = teamId ? prefs.teams.find((t) => t.team.id === teamId)?.preferences[purpose] : undefined
    return own && own.length > 0 ? own : prefs.clubDefault[purpose] ?? []
  }, [prefs])

  /** Where an activity would go, and with it everything that must follow: a home fixture takes its changing
   * rooms with it, and a training session that asked for a room takes its room -- kept where they are still at
   * the venue and still free at the (new) time, otherwise the best free ones. */
  const placement = useCallback((a: Allocatable, pitchId: string | null, kickoff?: number): { parts: PlanParts; notes: string[] } => {
    if (!day) return { parts: {}, notes: [] }
    const pitch = pitchId ? day.pitches.find((p) => p.id === pitchId) ?? null : null
    const current = plannedParts(plan, a)
    if (a.kind === "TRAINING") {
      const parts: PlanParts = { pitchId, ...(pitch ? { venueId: pitch.venueId } : {}), ...(kickoff !== undefined ? { kickoff: clock(kickoff) } : {}) }
      const venueId = pitch?.venueId ?? current.venueId
      if (!a.needsRoom || !venueId) return { parts, notes: [] }
      const start = kickoff ?? toMinutes(current.kickoff)
      const use = trainingRoomWindow(a, start, day.policy)
      const kept = current.homeRoomId && use && day.rooms.find((r) => r.id === current.homeRoomId)?.venueId === venueId
        && roomClash(day, draft, a.id, current.homeRoomId, use) === null
      if (kept) return { parts, notes: [] }
      const rec = recommendTrainingRoom(day, draft, a, venueId, start, preferred(a.team?.id ?? null, "HOME_ROOM"))
      parts.homeRoomId = rec.roomId
      return { parts, notes: rec.note ? [rec.roomId ? `Changing room: ${rec.note}.` : `Changing room: ${rec.note}`] : [] }
    }
    const ko = kickoff ?? (current.kickoff ? Number(current.kickoff.slice(0, 2)) * 60 + Number(current.kickoff.slice(3, 5)) : null)
    const parts: PlanParts = { pitchId, ...(kickoff !== undefined ? { kickoff: clock(kickoff) } : {}) }
    if (!pitch || ko === null || !a.home) return { parts, notes: [] }
    const venue = day.venues.find((v) => v.id === pitch.venueId)
    parts.venueId = pitch.venueId
    const meet = a.meetTime ? Number(a.meetTime.slice(0, 2)) * 60 + Number(a.meetTime.slice(3, 5)) : null
    const stillGood = (roomId: string | null, role: "HOME" | "AWAY") => {
      if (!roomId) return false
      const room = day.rooms.find((r) => r.id === roomId)
      return !!room && room.venueId === pitch.venueId && roomClash(day, draft, a.id, roomId, fixtureRoomWindow(ko, a.playMinutes, meet, role, day.policy)) === null
    }
    const notes: string[] = []
    const movedVenue = current.venueId !== null && current.venueId !== pitch.venueId
    if (stillGood(current.homeRoomId, "HOME") && (stillGood(current.awayRoomId, "AWAY") || !current.awayRoomId)) {
      // The rooms it has still work: leave them alone.
    } else {
      const rec = recommendRooms(day, draft, a as ArenaFixture, pitch.venueId, ko, { home: preferred(a.team?.id ?? null, "HOME_ROOM"), away: preferred(a.team?.id ?? null, "AWAY_ROOM") })
      parts.homeRoomId = rec.homeRoomId
      parts.awayRoomId = rec.awayRoomId
      if (rec.note) notes.push(movedVenue ? `Moved to ${venue?.name ?? "another venue"}, so its changing rooms move too: ${rec.note}.` : `Changing rooms: ${rec.note}.`)
    }
    // An officials room at another venue does not follow the match there.
    if (current.officialsRoomId && day.rooms.find((r) => r.id === current.officialsRoomId)?.venueId !== pitch.venueId) parts.officialsRoomId = null
    return { parts, notes }
  }, [day, plan, draft, preferred])

  /** A person moves an activity onto a pitch (and, for a fixture, a kick-off). Rooms follow. */
  const place = useCallback((a: Allocatable, pitchId: string, kickoff?: number) => {
    const { parts, notes } = placement(a, pitchId, kickoff)
    setPlan((p) => stage(p, a, parts, "MANUAL", notes))
    setProblem(null)
  }, [placement])

  /** A person sets parts directly (the Allocate sheet). */
  const setParts = useCallback((a: Allocatable, parts: PlanParts, notes: string[] = []) => {
    setPlan((p) => stage(p, a, parts, "MANUAL", notes))
    setProblem(null)
  }, [])

  /** Take an activity off its pitch (its rooms stay; the server keeps them until it is re-allocated). */
  const removeFromPitch = useCallback((a: Allocatable) => {
    setPlan((p) => stage(p, a, { pitchId: null }, "MANUAL"))
  }, [])

  const undo = useCallback((key: string) => setPlan((p) => unstage(p, key)), [])
  const discard = useCallback(() => { setPlan(EMPTY_PLAN); setAuto({ state: "idle" }); setProblem(null) }, [])
  const discardAuto = useCallback(() => { setPlan((p) => withoutAuto(p)); setAuto({ state: "idle" }) }, [])

  /** Would this activity fit there, by the server's rules over the plan so far? (A session at its planned start.) */
  const clashAt = useCallback((a: Allocatable, pitchId: string, kickoff: number | null): Clash | null => {
    if (!day) return null
    const at = kickoff ?? (a.kind === "TRAINING" ? toMinutes(plannedParts(plan, a).kickoff) : null)
    return pitchClash(day, draft, a, pitchId, at)
  }, [day, draft, plan])
  const needsOf = useCallback((a: Allocatable) => (day ? plannedNeeds(day, plan, a) : a.needs), [day, plan])

  /** The rooms an activity is still waiting for (the Changing Rooms demand), with the plan laid over it. */
  const roomsWanted = useCallback((a: Allocatable): RoomRole[] => (day ? roomDemand(day, plan, a) : []), [day, plan])
  /** Would this room do for this activity in this role, by the server's rules over the plan so far? */
  const roomClashAt = useCallback((a: Allocatable, role: RoomRole, roomId: string): Clash | null => (day ? roomFit(day, draft, plan, a, role, roomId) : null), [day, draft, plan])
  /** A person gives an activity a room for a role (or takes it away): staged, one plan, like every move. */
  const assignRoom = useCallback((a: Allocatable, role: RoomRole, roomId: string | null) => {
    setPlan((p) => stage(p, a, { [roomPart(role)]: roomId }, "MANUAL"))
    setProblem(null)
  }, [])

  /**
   * AUTO ALLOCATE, AS A PROPOSAL ON THE BOARD: the server works out the day (preferences, availability, sizes,
   * warm-up and clearing, reservations, locks) and its proposal is laid into the plan as Ovalball's changes --
   * shown on the board, explained, and only ever applied by Save.
   */
  const runAuto = useCallback(async (venueId: string | null, rerun = false) => {
    if (!clubId || !day) return
    setAuto({ state: "calculating" })
    try {
      const preview = sample ? sample.preview(day) : await previewArenaAllocation(supabase, clubId, day.date, { venueId, rerun })
      setPlan((current) => {
        let next = withoutAuto(current)
        for (const item of preview.items) {
          if (item.changes.length === 0) continue
          const a = day.activities.find((x) => x.id === item.id && x.kind === item.kind) as Allocatable | undefined
          if (!a || next.has(`${a.kind}:${a.id}`)) continue
          next = stage(next, a, { ...item.proposed }, "AUTO", item.explanation)
        }
        return next
      })
      setAuto({ state: "proposed", preview })
    } catch (cause) {
      const failure = friendlyAction(cause, "calculate", "the allocation")
      logDetail("arena auto", failure)
      setAuto({ state: "failed", message: failure.message })
    }
  }, [clubId, day, sample])

  /** SAVE: the whole plan, one transaction, every change checked again by the server's rules. */
  const save = useCallback(async (): Promise<boolean> => {
    if (!clubId || !day || plan.size === 0) return true
    if (sample) {
      setProblem("This is sample data for testing the board, so nothing can be saved.")
      return false
    }
    setSaving(true)
    setProblem(null)
    try {
      const result = await applyArenaAllocation(supabase, clubId, day.date, toArenaChanges(plan), "MANUAL")
      const n = plan.size
      const allAuto = planCounts(plan).auto === n
      const proposed = result.kickoffProposed?.length ?? 0
      // The day is read again BEFORE the plan is cleared, so a saved move never jumps back for a moment. The words
      // follow the button: Apply Plan is "Plan applied", Save is "saved".
      try {
        await onSaved(`${allAuto ? "Plan applied: " : ""}${n} ${n === 1 ? "change" : "changes"} saved.${proposed > 0 ? ` ${proposed} kick-off ${proposed === 1 ? "time" : "times"} sent to the other club to agree.` : ""}`)
      } catch {
        // Saved all the same: the screen reads the day again when it next can.
      } finally {
        setPlan(EMPTY_PLAN)
        setAuto({ state: "idle" })
      }
      return true
    } catch (cause) {
      // Nothing was saved -- the plan is one transaction -- and every change stays staged.
      const failure = friendlyAction(cause, "save", "these changes")
      logDetail("arena save", failure)
      setProblem(failure.message)
      return false
    } finally {
      setSaving(false)
    }
  }, [clubId, day, plan, onSaved, sample])

  return { plan, draft, counts, saving, problem, auto, place, setParts, removeFromPitch, undo, discard, discardAuto, runAuto, save, clashAt, needsOf, placement, preferred, roomsWanted, roomClashAt, assignRoom }
}

export type DayPlanner = ReturnType<typeof useDayPlanner>
