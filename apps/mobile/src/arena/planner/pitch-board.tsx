import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AccessibilityInfo, Pressable, ScrollView, Text, View, useWindowDimensions, type AccessibilityActionEvent } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Svg, { Defs, Path, Pattern, Rect } from "react-native-svg"
import Animated, { runOnJS, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated"

import { activityLabel, activityTitle, clock, teamShort, toMinutes, type ArenaActivity, type ArenaConflict, type ArenaDay, type ArenaEvent, type ArenaFixture, type ArenaNeed, type ArenaPitch, type ArenaTournament, type ArenaTraining } from "@ovalball/contracts/arena"

import { haptic } from "../../pitch-allocation/haptics"
import { END_MINUTES, PX_PER_SLOT, START_MINUTES, TIME_AXIS_WIDTH, boardWidth, heightForMinutes, laneColumns, minutesToY, timelineHeight, xToLaneColumn, yToSnappedMinutes, type BoardScale, type LaneColumn } from "../../pitch-allocation/geometry"
import { CalendarDays, Check, ChevronDown, ChevronUp, DoorOpen, Dumbbell, GripVertical, Lock, Minimize2, Sparkles, TriangleAlert, Trophy, Users, ZoomIn, ZoomOut } from "../../components/icons"
import { TOUCH_TARGET, colour, eventTone, radius, space, type } from "../../design/tokens"
import { BOARD_TEXT_CAP, COLUMN_HYSTERESIS, ColumnHeader, DropPill, LIFT, StateTag, TIME_HYSTERESIS, TimeGrid, TimeRail, VenueBand, edgeVelocity, textWidth, useEdgeScroll, useLift } from "./board-kit"
import { changeFor, plannedParts, savedParts, type Allocatable, type Plan, type PlannedChange } from "./plan"
import { pitchUnits, readOccupancy, trainingMinutes, type Clash, type Occupancy } from "./rules"
import type { DayPlanner } from "./use-day-planner"
import { boardLabel, boardOpponent, displacements, lockedWords } from "./words"

export { boardOpponent, lockedWords }

/**
 * THE PITCHES BOARD -- the day as a sports-ground operations board.
 *
 * TIME RUNS DOWN THE LEFT, PITCHES RUN ACROSS THE TOP (the owner's orientation, agreed and kept): the hours stay
 * put on the left while the pitches scroll across, the pitch names stay put at the top while the day scrolls
 * beneath them. Every match is drawn as the whole time it holds its pitch -- a light warm-up, the solid match,
 * a light tail while the pitch is cleared -- so its shape says how long it is.
 *
 * ONE VISUAL LANGUAGE. What a thing IS is its fill: a match is forest, training the training blue, a tournament's
 * or an event's reservation a quiet hatch in its own tone. What STATE it is in is its edge and a word: a dashed
 * edge and "Unsaved" for a person's change, a dashed edge and "Auto" for Ovalball's proposal, a lock for a locked
 * allocation, a red edge for a real clash, an amber "Needs rooms" when the pitch is there but the changing rooms
 * are not. No state has a colour of its own to learn.
 *
 * TRAINING SHARES A PITCH, AND SAYS SO. Any number of groups may train on one pitch at once (the owner's rule), so
 * groups that share are drawn as ONE block -- "Training · 3 teams" with their names -- never as cards crowding a
 * column or as a clash. Tapping it opens the pitch out, one column per group, so each team can be moved on its own.
 *
 * MOVING THINGS: press and hold and it lifts above the finger, an outline keeping its place; pitches it cannot go
 * on at that time fade, the one under it lights, and a line away from the finger says what letting go would mean
 * -- or, briefly, why not. Across changes the pitch, down changes the time in 15-minute steps, each only when the
 * finger clearly means it. A time moves only where its owner allows (`activity.time`): a session's start for
 * whoever manages its training, a kick-off for whoever manages the fixture -- otherwise the card keeps its time and
 * the line says where the time is changed. Letting go stages the change in the day's plan; nothing is written
 * until Save, and Save moves a time only through its owner's own writer. Everything can be tapped instead.
 *
 * Read only without the planning permission: the same board, nothing to lift.
 */

type FixtureBlock = { kind: "FIXTURE"; a: ArenaFixture; pitchId: string; lane: number; from: number; playFrom: number; playUntil: number; until: number }
type TrainingBlock = { kind: "TRAINING"; a: ArenaTraining; pitchId: string; sub: number; subs: number; from: number; until: number }
/** Training groups sharing one pitch at overlapping times, drawn as one block until opened out. */
type TrainingGroup = { key: string; pitchId: string; from: number; until: number; sessions: TrainingBlock[] }
type HoldBlock = { kind: "TOURNAMENT" | "EVENT"; key: string; activity: ArenaTournament | ArenaEvent | null; label: string; pitchId: string; from: number; until: number; areas: number | null }
type Preview = { activity: Allocatable; pitchId: string | null; lane: number; minutes: number | null; clash: Clash | null; lines: string[]; low: boolean; timeNote: string | null }
type Target = { pitchId: string; lane: number; minutes: number | null } | null
type BlockState = { change: PlannedChange | null; clash: string | null; locks: string[]; needs: ArenaNeed[]; roomsProposed: boolean; taken: "rooms" | "pitch" | null; room: string | null; roomClash: string | null }
type Flash = { title: string; reason?: string; tone: "ok" | "refused" | "plain"; low: boolean; action?: { label: string; a: ArenaActivity } | null }
const NONE: BlockState = { change: null, clash: null, locks: [], needs: [], roomsProposed: false, taken: null, room: null, roomClash: null }
/** The narrowest an opened-out training group's column is drawn: room for "Girls U14" and its times. */
const GROUP_COLUMN = 104

/** Where an activity starts, with the plan laid over it (a fixture's kick-off, a session's start). */
const startOf = (plan: Plan, a: Allocatable) => toMinutes(plannedParts(plan, a).kickoff)
/** The words for the place a time is changed when Arena may not move it. */
const centreWord = (a: Allocatable) => (a.kind === "FIXTURE" ? "Open Fixture" : "Open Training")

export function PitchBoard({ day, planner, venueId, canManage, reduceMotion, nowMinute, scale, fullScreen, focus, onOpen, onOpenCentre, onAllocate, onAuto, autoBusy, onToggleScale, onLeaveFullScreen }: {
  day: ArenaDay
  planner: DayPlanner
  venueId: string | null
  canManage: boolean
  reduceMotion: boolean
  nowMinute: number | null
  scale: BoardScale
  onOpen: (a: ArenaActivity) => void
  /** Where an activity's own time is changed: the fixture, or the training session. */
  onOpenCentre: (a: ArenaActivity) => void
  onAllocate: (a: Allocatable) => void
  onAuto: (rerun: boolean) => void
  autoBusy: boolean
  fullScreen: boolean
  /** A change to bring into view (the save bar's "1 of 4" steps). */
  focus: { key: string; seq: number } | null
  onToggleScale: () => void
  onLeaveFullScreen: () => void
}) {
  const px = PX_PER_SLOT[scale]
  const height = timelineHeight(scale)
  const scrollX = useSharedValue(0)
  const scrollY = useSharedValue(0)
  const rootX = useSharedValue(0)
  const rootY = useSharedValue(0)
  const ghostX = useSharedValue(0)
  const ghostY = useSharedValue(0)
  const ghostOn = useSharedValue(0)
  const hRef = useRef<Animated.ScrollView>(null)
  const vRef = useRef<Animated.ScrollView>(null)
  const rootRef = useRef<View>(null)
  const hViewportRef = useRef<View>(null)
  const vViewportRef = useRef<View>(null)
  const trayRef = useRef<View>(null)
  const viewport = useRef({ x: 0, y: 0, width: 0, height: 0, trayTop: 0 })
  const [preview, setPreview] = useState<Preview | null>(null)
  const [blocked, setBlocked] = useState<Set<string>>(new Set())
  const [flash, setFlash] = useState<Flash | null>(null)
  const [floating, setFloating] = useState<Allocatable | null>(null)
  const [trayH, setTrayH] = useState(0)
  /** The pitches whose sharing training groups are opened out, one column per group. */
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const { fontScale } = useWindowDimensions()
  /** Whether letting go now would be accepted -- read by the card in the hand, so a good drop settles in place. */
  const dropOk = useSharedValue(0)

  // ------------------------------------------------------------------ what is where
  const activities = useMemo(() => new Map(day.activities.map((a) => [a.id, a])), [day.activities])
  const venueOrder = useMemo(() => new Map(day.venues.map((v, i) => [v.id, v.isDefault ? -1 : i])), [day.venues])
  const pitches = useMemo(
    () => day.pitches
      .filter((p) => p.active && (!venueId || p.venueId === venueId))
      .sort((a, b) => (venueOrder.get(a.venueId) ?? 99) - (venueOrder.get(b.venueId) ?? 99) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [day.pitches, venueId, venueOrder],
  )
  const pitchIds = useMemo(() => new Set(pitches.map((p) => p.id)), [pitches])
  const pitchById = useMemo(() => new Map(pitches.map((p) => [p.id, p])), [pitches])
  const pitchRows = useMemo(() => planner.draft.filter((r) => r.resourceType === "PITCH" && pitchIds.has(r.resourceId)), [planner.draft, pitchIds])
  // With every venue shown and more than one, the pitch names sit under their venue's name.
  const grouped = !venueId && new Set(pitches.map((p) => p.venueId)).size > 1

  // THE SAVED LAYOUT'S LANES, so moving one match never makes another jump lanes on the same pitch.
  const savedLanes = useMemo(() => {
    const m = new Map<string, number>()
    const rows = readOccupancy(day).filter((r) => r.resourceType === "PITCH" && r.activityType === "FIXTURE")
    for (const pid of new Set(rows.map((r) => r.resourceId))) {
      const ends: number[] = []
      for (const r of rows.filter((x) => x.resourceId === pid).sort((a, b) => a.from - b.from)) {
        let lane = ends.findIndex((end) => end <= r.from)
        if (lane === -1) { lane = ends.length; ends.push(r.until) } else ends[lane] = r.until
        m.set(`${pid}:${r.activityId}`, lane)
      }
    }
    return m
  }, [day])

  // THE SAVED LAYOUT'S TRAINING COLUMNS, so moving one team never shuffles the others on an opened-out pitch.
  const savedSubs = useMemo(() => {
    const m = new Map<string, number>()
    const rows = readOccupancy(day).filter((r) => r.resourceType === "PITCH" && r.activityType === "TRAINING")
    for (const pid of new Set(rows.map((r) => r.resourceId))) {
      const ends: number[] = []
      for (const r of rows.filter((x) => x.resourceId === pid).sort((a, b) => a.from - b.from || a.activityId.localeCompare(b.activityId))) {
        let sub = ends.findIndex((end) => end <= r.from)
        if (sub === -1) { sub = ends.length; ends.push(r.until) } else ends[sub] = r.until
        m.set(`${pid}:${r.activityId}`, sub)
      }
    }
    return m
  }, [day])

  const { fixtures, training, groups, holds, lanesByPitch, sharing } = useMemo(() => {
    const fx: FixtureBlock[] = []
    const tr: TrainingBlock[] = []
    const gr: TrainingGroup[] = []
    const hd: HoldBlock[] = []
    const lanes = new Map<string, number>()
    /** How many groups train at once at the busiest moment on a pitch that has sharing (0 where none share). */
    const shares = new Map<string, number>()
    for (const p of pitches) {
      const rows = pitchRows.filter((r) => r.resourceId === p.id)
      // Matches into lanes: a pitch that takes N games at once is N lanes; a pitch double-booked shows the extra
      // lane rather than hiding one match under another.
      const ends: number[] = []
      for (const r of rows.filter((x) => x.activityType === "FIXTURE").sort((a, b) => a.from - b.from)) {
        const a = activities.get(r.activityId)
        if (!a || a.kind !== "FIXTURE") continue
        const own = savedLanes.get(`${p.id}:${a.id}`)
        let lane = own !== undefined && (ends[own] === undefined || ends[own] <= r.from) ? own : ends.findIndex((end) => end <= r.from)
        if (lane === -1) lane = ends.length
        while (ends.length < lane) ends.push(-1)
        ends[lane] = r.until
        fx.push({ kind: "FIXTURE", a, pitchId: p.id, lane, from: r.from, playFrom: r.playFrom, playUntil: r.playUntil, until: r.until })
      }
      lanes.set(p.id, Math.max(1, p.lanes, ends.length))
      // TRAINING: sessions whose times overlap form a cluster; one alone is a card, two or more sharing are a group.
      const sessions = rows.filter((x) => x.activityType === "TRAINING").sort((a, b) => a.from - b.from || a.activityId.localeCompare(b.activityId))
      let cluster: Occupancy[] = []
      let clusterEnd = -1
      const flush = () => {
        if (cluster.length === 0) return
        const subEnds: number[] = []
        const placed: TrainingBlock[] = []
        for (const r of cluster) {
          const a = activities.get(r.activityId)
          if (a?.kind !== "TRAINING") continue
          // Its own column from the saved layout when that column is free then, otherwise the first free one.
          const own = savedSubs.get(`${p.id}:${a.id}`)
          let sub = own !== undefined && (subEnds[own] === undefined || subEnds[own] <= r.from) ? own : subEnds.findIndex((end) => end <= r.from)
          if (sub === -1) sub = subEnds.length
          while (subEnds.length < sub) subEnds.push(-1)
          subEnds[sub] = r.until
          placed.push({ kind: "TRAINING", a, pitchId: p.id, sub, subs: 1, from: r.from, until: r.until })
        }
        const subs = Math.max(1, subEnds.length)
        for (const b of placed) b.subs = subs
        if (placed.length >= 2) {
          shares.set(p.id, Math.max(shares.get(p.id) ?? 0, subs))
          gr.push({ key: `${p.id}:${placed[0].a.id}`, pitchId: p.id, from: Math.min(...placed.map((b) => b.from)), until: Math.max(...placed.map((b) => b.until)), sessions: placed })
        }
        tr.push(...placed)
        cluster = []
        clusterEnd = -1
      }
      for (const r of sessions) {
        if (cluster.length > 0 && r.from >= clusterEnd) flush()
        cluster.push(r)
        clusterEnd = Math.max(clusterEnd, r.until)
      }
      flush()
      for (const r of rows.filter((x) => x.activityType === "TOURNAMENT" || x.activityType === "EVENT")) {
        const activity = r.activityType === "TOURNAMENT"
          ? (activities.get(r.parentId ?? "") as ArenaTournament | undefined) ?? null
          : (activities.get(r.activityId) as ArenaEvent | undefined) ?? null
        hd.push({ kind: r.activityType as "TOURNAMENT" | "EVENT", key: `${r.activityId}:${p.id}`, activity, label: r.label, pitchId: p.id, from: r.from, until: r.until, areas: r.areas })
      }
    }
    return { fixtures: fx, training: tr, groups: gr, holds: hd, lanesByPitch: lanes, sharing: shares }
  }, [pitches, pitchRows, activities, savedLanes, savedSubs])
  /** Whether a session is drawn on its own: alone on its pitch then, or its pitch opened out. */
  const inGroup = useMemo(() => {
    const m = new Set<string>()
    for (const g of groups) if (!opened.has(g.pitchId)) for (const b of g.sessions) m.add(b.a.id)
    return m
  }, [groups, opened])

  // A venue with few pitches fills the board rather than leaving it empty beside them; many pitches scroll across.
  // A pitch whose sharing training is opened out is widened to one readable column per group.
  const [viewW, setViewW] = useState(0)
  const cols = useMemo(() => {
    let base = laneColumns(pitches.map((p) => ({ id: p.id, lanes: lanesByPitch.get(p.id) ?? 1, active: true })))
    for (const pid of opened) {
      const n = sharing.get(pid) ?? 0
      if (n < 2) continue
      const own = base.filter((c) => c.pitchId === pid)
      if (own.length === 0) continue
      const span = own[own.length - 1].left + own[own.length - 1].width - own[0].left
      const want = n * GROUP_COLUMN
      if (want <= span) continue
      const k = want / span
      const extra = want - span
      const start = own[0].left
      base = base.map((c) => c.pitchId === pid
        ? { ...c, left: start + (c.left - start) * k, width: c.width * k }
        : c.left > start ? { ...c, left: c.left + extra } : c)
    }
    const w = boardWidth(base)
    if (viewW <= 0 || w === 0 || w >= viewW - space.sm) return base
    const k = Math.min((viewW - space.sm) / w, 2.4)
    return base.map((c) => ({ ...c, left: c.left * k, width: c.width * k }))
  }, [pitches, lanesByPitch, viewW, opened, sharing])
  const width = boardWidth(cols)
  const spans = useMemo(() => {
    const m = new Map<string, { left: number; width: number }>()
    for (const p of pitches) {
      const own = cols.filter((c) => c.pitchId === p.id)
      if (own.length === 0) continue
      const last = own[own.length - 1]
      m.set(p.id, { left: own[0].left, width: last.left + last.width - own[0].left })
    }
    return m
  }, [pitches, cols])
  const venueBands = useMemo(() => {
    if (!grouped) return []
    const bands: { venueId: string; name: string; left: number; right: number }[] = []
    for (const p of pitches) {
      const s = spans.get(p.id)
      if (!s) continue
      const last = bands[bands.length - 1]
      if (last && last.venueId === p.venueId) last.right = s.left + s.width
      else bands.push({ venueId: p.venueId, name: day.venues.find((v) => v.id === p.venueId)?.name ?? "Venue", left: s.left, right: s.left + s.width })
    }
    return bands
  }, [grouped, pitches, spans, day.venues])

  // THE HEADER IS AS TALL AS ITS LONGEST NAME NEEDS, and no taller.
  const today = nowMinute !== null
  const fs = Math.min(Math.max(fontScale, 1), BOARD_TEXT_CAP)
  const bandH = venueBands.length === 0 ? 0 : Math.ceil((venueBands.some((b) => textWidth(b.name, 11 * fs) + space.lg > b.right - b.left) ? 30 : 20) * Math.min(fs, 1.1))
  const nameLines = pitches.some((p) => textWidth(p.name, 13 * fs) > (spans.get(p.id)?.width ?? 120) - space.lg) ? 2 : 1
  const openedHere = pitches.some((p) => opened.has(p.id) && (sharing.get(p.id) ?? 0) >= 2)
  const headerH = Math.ceil(bandH + 10 + (nameLines * 16 + 14 + (today ? 15 : 0) + (openedHere ? 30 : 0)) * fs + 6)

  // A block's own state -- staged or proposed, locked, a clash, still missing something -- computed once per
  // change to the plan, so a drag re-renders the one block it moves rather than the whole board.
  const states = useMemo(() => {
    const taken = new Map(displacements(planner.plan).map((d) => [d.id, d.loses]))
    const serverClash = new Map<string, string>()
    for (const c of day.conflicts) if (c.severity === "hard" && c.resourceType === "PITCH") for (const id of c.activityIds) if (!serverClash.has(id)) serverClash.set(id, c.message)
    // A session's room clash is said on its room, here as on the Changing Rooms board.
    const roomClashOf = new Map<string, string>()
    for (const c of day.conflicts) if (c.severity === "hard" && c.resourceType === "ROOM") for (const id of c.activityIds) if (!roomClashOf.has(id)) roomClashOf.set(id, c.message)
    const m = new Map<string, BlockState>()
    for (const a of day.activities) {
      if (a.kind !== "FIXTURE" && a.kind !== "TRAINING") continue
      const change = changeFor(planner.plan, a)
      const parts = plannedParts(planner.plan, a)
      const clash = change
        ? parts.pitchId ? planner.clashAt(a, parts.pitchId, toMinutes(parts.kickoff))?.message ?? null : null
        : serverClash.get(a.id) ?? null
      const roomsProposed = !!change && ("homeRoomId" in change.set || "awayRoomId" in change.set) && (!!parts.homeRoomId || !!parts.awayRoomId)
      const room = a.kind === "TRAINING" && parts.homeRoomId ? day.rooms.find((r) => r.id === parts.homeRoomId)?.name ?? null : null
      const roomMoved = !!change && "homeRoomId" in change.set
      const roomClash = a.kind === "TRAINING" && parts.homeRoomId
        ? roomMoved ? planner.roomClashAt(a, "TRAINING", parts.homeRoomId)?.message ?? null : change ? null : roomClashOf.get(a.id) ?? null
        : null
      m.set(a.id, { change, clash, locks: a.locks, needs: planner.needsOf(a), roomsProposed, taken: taken.get(a.id) ?? null, room, roomClash })
    }
    return m
  }, [day.activities, day.conflicts, day.rooms, planner.plan, planner.clashAt, planner.needsOf, planner.roomClashAt])

  // ------------------------------------------------------------------ scrolling and where the board is
  const onH = useAnimatedScrollHandler({ onScroll: (e) => { scrollX.value = e.contentOffset.x } })
  const onV = useAnimatedScrollHandler({ onScroll: (e) => { scrollY.value = e.contentOffset.y } })
  const headerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -scrollX.value }] }))
  const measure = useCallback(() => {
    hViewportRef.current?.measureInWindow((x, _y, w) => { viewport.current.x = x; viewport.current.width = w })
    vViewportRef.current?.measureInWindow((_x, y, _w, h) => { viewport.current.y = y; viewport.current.height = h })
    trayRef.current?.measureInWindow((_x, y) => { viewport.current.trayTop = y })
    rootRef.current?.measureInWindow((x, y) => { rootX.value = x; rootY.value = y })
  }, [rootX, rootY])
  const contentFromAbs = useCallback((absX: number, absY: number): [number, number] => {
    const o = viewport.current
    return [absX - o.x + scrollX.value, absY - o.y + scrollY.value]
  }, [scrollX, scrollY])
  const evaluateRef = useRef<() => void>(() => {})
  const setAutoScroll = useEdgeScroll(hRef, vRef, scrollX, scrollY, evaluateRef)

  // Open on what matters: now when it is today; otherwise the first thing that needs attention, so the problem is on
  // the screen; otherwise the first thing on the pitches shown. Held until the board has its height, so the scroll is
  // never clamped to the top of an empty view.
  const firstProblem = useMemo(() => {
    const items = day.activities
      .filter((a): a is Allocatable => (a.kind === "FIXTURE" && a.home) || a.kind === "TRAINING")
      .filter((a) => planner.needsOf(a).length > 0 || states.get(a.id)?.clash)
      .map((a) => ({ at: toMinutes(a.kind === "FIXTURE" ? a.kickoff : a.start), pitchId: plannedParts(planner.plan, a).pitchId }))
      .filter((x): x is { at: number; pitchId: string | null } => x.at !== null)
      .sort((x, y) => x.at - y.at)
    return items[0] ?? null
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as the day opens
  }, [day])
  const openedScope = useRef<string | null>(null)
  const pendingScroll = useRef<number | null>(null)
  const scope = `${day.date}|${pitches.map((p) => p.id).join(",")}|${scale}|${viewW > 0 ? "measured" : "-"}`
  useEffect(() => {
    if (openedScope.current === scope) return
    openedScope.current = scope
    const items = [...fixtures.map((f) => ({ at: f.from, pitchId: f.pitchId })), ...training.map((t) => ({ at: t.from, pitchId: t.pitchId })), ...holds.map((h) => ({ at: h.from, pitchId: h.pitchId }))].filter((i) => i.at >= START_MINUTES)
    const earliest = items.length > 0 ? items.reduce((m, i) => (i.at < m.at ? i : m)) : null
    const problem = firstProblem && firstProblem.pitchId && spans.has(firstProblem.pitchId) ? { at: Math.max(firstProblem.at - day.policy.warmUp, START_MINUTES), pitchId: firstProblem.pitchId } : firstProblem ? { at: Math.max(firstProblem.at - day.policy.warmUp, START_MINUTES), pitchId: earliest?.pitchId ?? "" } : null
    const first = problem ?? earliest
    const target = nowMinute ?? first?.at ?? 9 * 60
    const y = Math.max(0, minutesToY(target, scale) - px * 2)
    pendingScroll.current = y
    // Across too, when what it opens on is out of sight: a problem's pitch, or a quiet day's one session.
    const inSight = items.some((i) => (spans.get(i.pitchId)?.left ?? Infinity) < viewW - 60)
    const span = nowMinute === null && first ? spans.get(first.pitchId) : undefined
    const away = !!span && viewW > 0 && (problem ? span.left + Math.min(span.width, 120) > viewW : !inSight)
    const x = away && span ? Math.max(0, span.left - space.sm) : 0
    // Not cancelled by a re-render: the day read again a moment after opening must not lose the first scroll.
    setTimeout(() => {
      vRef.current?.scrollTo({ y, animated: false })
      hRef.current?.scrollTo({ x, animated: false })
    }, 250)
  }, [scope, fixtures, training, holds, nowMinute, scale, px, spans, viewW, firstProblem, day.policy.warmUp])
  // OVALBALL'S PROPOSAL, BROUGHT INTO VIEW: when Auto Allocate lays its plan on the board, the board goes to the
  // first thing it changed, so what it did is on the screen rather than somewhere off to the side.
  const shownProposal = useRef<unknown>(null)
  useEffect(() => {
    const proposal = planner.auto.state === "proposed" ? planner.auto.preview : null
    if (!proposal || shownProposal.current === proposal) return
    shownProposal.current = proposal
    const placed = Array.from(planner.plan.values())
      .filter((c) => c.origin === "AUTO")
      .map((c) => {
        const a = activities.get(c.id) as Allocatable | undefined
        if (!a) return null
        const parts = plannedParts(planner.plan, a)
        const at = toMinutes(parts.kickoff)
        return at !== null && parts.pitchId && spans.has(parts.pitchId) ? { at, pitchId: parts.pitchId } : null
      })
      .filter((x): x is { at: number; pitchId: string } => !!x)
      .sort((x, y) => x.at - y.at)
    const first = placed[0]
    if (!first) return
    const span = spans.get(first.pitchId)!
    vRef.current?.scrollTo({ y: Math.max(0, minutesToY(first.at, scale) - px * 4), animated: !reduceMotion })
    hRef.current?.scrollTo({ x: Math.max(0, span.left - space.sm), animated: !reduceMotion })
  }, [planner.auto, planner.plan, activities, spans, scale, px, reduceMotion])
  useEffect(() => {
    if (!focus) return
    const c = planner.plan.get(focus.key)
    const a = c ? (activities.get(c.id) as Allocatable | undefined) : undefined
    if (!a) return
    const parts = plannedParts(planner.plan, a)
    const at = toMinutes(parts.kickoff)
    const span = parts.pitchId ? spans.get(parts.pitchId) : undefined
    if (at !== null) vRef.current?.scrollTo({ y: Math.max(0, minutesToY(at, scale) - px * 4), animated: !reduceMotion })
    if (span) hRef.current?.scrollTo({ x: Math.max(0, span.left - space.sm), animated: !reduceMotion })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- each request once
  }, [focus])
  const onContentSize = useCallback(() => {
    if (pendingScroll.current === null) return
    vRef.current?.scrollTo({ y: pendingScroll.current, animated: false })
    pendingScroll.current = null
  }, [])

  // ------------------------------------------------------------------ dragging
  const target = useRef<Target>(null)
  const last = useRef<string | null>(null)
  const latest = useRef<Preview | null>(null)
  const update = useCallback((activity: Allocatable, contentX: number, contentY: number, absX: number, absY: number, fixedMinutes: number | null, liftAbsY: number) => {
    const o = viewport.current
    // Only the board itself takes a drop: over Unallocated, or off the side, letting go cancels.
    const visibleBottom = o.trayTop > o.y ? o.trayTop : o.y + o.height
    const overBoard = absX >= o.x && absX <= o.x + o.width && absY >= o.y && absY <= visibleBottom
    const movesTime = activity.time.editable && fixedMinutes === null
    setAutoScroll(overBoard ? edgeVelocity(absX - o.x, o.width) : 0, overBoard && movesTime ? edgeVelocity(absY - o.y, visibleBottom - o.y) : 0)

    // DELIBERATE MOVEMENT: the drop keeps its pitch until the finger is clearly inside another, and its time
    // until the finger is clearly more than a slot away -- so a sideways drag never nudges the time and a
    // vertical one never slips onto the next pitch.
    const was = target.current
    let col = overBoard ? xToLaneColumn(contentX, cols) : null
    if (col && was && (col.pitchId !== was.pitchId || col.laneIndex !== was.lane)) {
      const inside = contentX >= col.left + COLUMN_HYSTERESIS && contentX <= col.left + col.width - COLUMN_HYSTERESIS
      if (!inside) col = cols.find((c) => c.pitchId === was.pitchId && c.laneIndex === was.lane) ?? col
    }
    const planned = startOf(planner.plan, activity)
    let minutes = movesTime ? yToSnappedMinutes(contentY, scale) : fixedMinutes ?? planned
    if (minutes !== null && movesTime && was?.minutes != null && minutes !== was.minutes
      && Math.abs(contentY - minutesToY(was.minutes, scale)) < px * (0.5 + TIME_HYSTERESIS)) minutes = was.minutes
    if (minutes !== null && minutes < START_MINUTES) minutes = START_MINUTES
    if (col) target.current = { pitchId: col.pitchId, lane: col.laneIndex, minutes }
    // A time this person may not move stays put -- and when the finger plainly asks for another time, the line
    // says where it is changed.
    const timeNote = !activity.time.editable && fixedMinutes === null && Math.abs(absY - liftAbsY) > px * 1.5 ? activity.time.reason : null

    // The line that says what letting go would mean sits where the finger is not.
    const low = absY < o.y + (visibleBottom - o.y) / 2
    const key = `${col?.pitchId ?? "-"}:${col?.laneIndex ?? 0}:${minutes ?? "t"}:${low ? "l" : "h"}:${timeNote ? "n" : ""}`
    if (key === last.current) return
    const [prevPitch, , prevMinutes] = (last.current ?? "-:0:x:h:").split(":")
    const minuteChanged = prevMinutes !== String(minutes ?? "t")
    const pitchChanged = prevPitch !== (col?.pitchId ?? "-")
    last.current = key
    if (minuteChanged || blocked.size === 0) setBlocked(new Set(pitches.filter((p) => planner.clashAt(activity, p.id, minutes) !== null).map((p) => p.id)))
    const clash = col ? planner.clashAt(activity, col.pitchId, minutes) : null
    const lines: string[] = []
    if (col && !clash && minutes !== null) {
      const pitch = pitchById.get(col.pitchId)
      if (activity.kind === "FIXTURE") {
        lines.push(`${pitch?.name ?? "Pitch"} · kick-off ${clock(minutes)}`)
        lines.push(`Warm-up ${clock(minutes - day.policy.warmUp)} · clear by ${clock(minutes + activity.playMinutes + day.policy.packUp)}`)
      } else {
        lines.push(`${pitch?.name ?? "Pitch"} · ${clock(minutes)}–${clock(minutes + trainingMinutes(activity))}`)
      }
      const notes = planner.placement(activity, col.pitchId, activity.time.editable ? minutes : undefined).notes
      if (notes.length > 0) lines.push(notes[0])
    }
    const next: Preview = { activity, pitchId: col?.pitchId ?? null, lane: col?.laneIndex ?? 0, minutes, clash, lines, low, timeNote }
    latest.current = next
    dropOk.value = col && !clash ? 1 : 0
    setPreview(next)
    if (col && (pitchChanged || minuteChanged)) void (clash ? haptic.refuse() : haptic.snap())
  }, [cols, scale, px, pitches, planner, pitchById, day.policy, setAutoScroll, blocked.size, dropOk])

  const say = useCallback((message: string) => AccessibilityInfo.announceForAccessibility(message), [])
  const end = useCallback((activity: Allocatable, dropped: boolean) => {
    setAutoScroll(0, 0)
    const p = latest.current && latest.current.activity.id === activity.id ? latest.current : null
    last.current = null
    latest.current = null
    target.current = null
    held.current = null
    setPreview(null)
    setBlocked(new Set())
    setFloating(null)
    if (!dropped || !p || !p.pitchId) return
    if (p.clash) {
      // NEVER SILENTLY ACCEPTED -- and never alarming: it goes back where it was, and says why, briefly.
      void haptic.refuse()
      setFlash({ title: `Not moved. ${p.clash.short.title}`, reason: p.clash.short.reason, tone: "refused", low: p.low })
      say(`Not moved. ${p.clash.short.title}: ${p.clash.short.reason}.`)
      return
    }
    const saved = savedParts(activity)
    const planned = plannedParts(planner.plan, activity)
    if (p.timeNote && p.pitchId === planned.pitchId) {
      // Asked for another time it may not have here: it stays, and the line says where the time is changed.
      void haptic.refuse()
      setFlash({ title: p.timeNote, reason: undefined, tone: "plain", low: p.low, action: { label: centreWord(activity), a: activity } })
      say(`${p.timeNote}`)
      return
    }
    void haptic.staged()
    planner.place(activity, p.pitchId, activity.time.editable && p.minutes !== null ? p.minutes : undefined)
    // Put back exactly where it is saved, the change drops out of the plan -- and is said to.
    const home = saved.pitchId === p.pitchId && toMinutes(saved.kickoff) === p.minutes
    const where = `${pitchById.get(p.pitchId)?.name ?? "the pitch"}${p.minutes !== null ? ` at ${clock(p.minutes)}` : ""}`
    const title = home ? `${boardLabel(activity)} is back where it was` : `${boardLabel(activity)} to ${where}`
    setFlash({ title, reason: home ? where : "Not saved yet", tone: "ok", low: p.low })
    say(home ? `${title}: ${where}.` : `${boardLabel(activity)} moved to ${where}. Not saved yet.`)
  }, [planner, pitchById, setAutoScroll, say])
  useEffect(() => {
    if (!flash) return
    const id = setTimeout(() => setFlash(null), flash.action ? 5200 : 3400)
    return () => clearTimeout(id)
  }, [flash])

  const updateRef = useRef(update); updateRef.current = update
  const endRef = useRef(end); endRef.current = end
  const planRef = useRef(planner.plan); planRef.current = planner.plan
  // WHAT IS IN THE HAND, AND WHERE THE FINGER IS -- worked out from the finger's place on the screen and the board's
  // scroll, so a card held still at an edge goes where the board has carried it. A card taken from the board keeps
  // the point the finger first pressed (its start line); one from Unallocated keeps its time.
  const grab = useRef({ dx: 0, dy: 0 })
  const held = useRef<{ a: Allocatable; absX: number; absY: number; liftY: number; from: "board" | "queue" } | null>(null)
  const evaluate = useCallback(() => {
    const h = held.current
    if (!h) return
    if (h.from === "board") {
      const [cx, cy] = contentFromAbs(h.absX, h.absY)
      updateRef.current(h.a, cx + grab.current.dx, cy + grab.current.dy, h.absX, h.absY, null, h.liftY)
    } else {
      const [cx, cy] = contentFromAbs(h.absX, h.absY - LIFT)
      updateRef.current(h.a, cx, cy, h.absX, h.absY, startOf(planRef.current, h.a), h.liftY)
    }
  }, [contentFromAbs])
  evaluateRef.current = evaluate
  const onBlockLift = useCallback((a: Allocatable, anchorX: number, anchorY: number, absX: number, absY: number) => {
    measure()
    const parts = plannedParts(planRef.current, a)
    const col = cols.find((c) => c.pitchId === parts.pitchId) ?? null
    target.current = col ? { pitchId: col.pitchId, lane: col.laneIndex, minutes: toMinutes(parts.kickoff) } : null
    const [cx, cy] = contentFromAbs(absX, absY)
    grab.current = { dx: anchorX - cx, dy: anchorY - cy }
    held.current = { a, absX, absY, liftY: absY, from: "board" }
    evaluate()
  }, [measure, cols, contentFromAbs, evaluate])
  const onBlockDrag = useCallback((a: Allocatable, absX: number, absY: number) => {
    held.current = { a, absX, absY, liftY: held.current?.liftY ?? absY, from: "board" }
    evaluateRef.current()
  }, [])
  const onBlockEnd = useCallback((a: Allocatable, dropped: boolean) => endRef.current(a, dropped), [])
  const onQueueDrag = useCallback((a: Allocatable, ax: number, ay: number) => {
    held.current = { a, absX: ax, absY: ay, liftY: held.current?.liftY ?? ay, from: "queue" }
    evaluateRef.current()
  }, [])
  const onQueueLift = useCallback((a: Allocatable) => {
    measure()
    target.current = null
    held.current = null
    setFloating(a)
    // Waiting work keeps its time: bring that time into view, so the pitch to drop it on is in sight.
    const at = startOf(planRef.current, a)
    if (at !== null) vRef.current?.scrollTo({ y: Math.max(0, minutesToY(at, scale) - px * 3), animated: !reduceMotion })
  }, [measure, scale, px, reduceMotion])
  const ghostStyle = useAnimatedStyle(() => ({
    opacity: ghostOn.value,
    transform: [{ translateX: ghostX.value - 112 }, { translateY: ghostY.value - 28 }, { scale: 0.96 + ghostOn.value * 0.04 }],
  }))

  const showNow = nowMinute !== null && nowMinute >= START_MINUTES && nowMinute <= END_MINUTES
  const toggleGroup = useCallback((pitchId: string) => {
    void haptic.snap()
    setOpened((was) => {
      const next = new Set(was)
      if (next.has(pitchId)) next.delete(pitchId)
      else next.add(pitchId)
      return next
    })
  }, [])

  // Waiting: everything at the chosen venue (or not yet anywhere) still missing something.
  const waiting = useMemo(() => {
    const list = day.activities.filter((a): a is Allocatable => (a.kind === "FIXTURE" && a.home) || a.kind === "TRAINING")
      .filter((a) => {
        const v = plannedParts(planner.plan, a).venueId
        return !venueId || !v || v === venueId
      })
      .map((a) => ({ a, needs: planner.needsOf(a) }))
      .filter((x) => x.needs.length > 0)
    const at = (a: Allocatable) => toMinutes(a.kind === "FIXTURE" ? a.kickoff : a.start) ?? 9999
    return list.sort((x, y) => at(x.a) - at(y.a))
  }, [day.activities, venueId, planner.plan, planner.needsOf])
  // The day's clashes at this venue -- less any the plan has already moved out of.
  const clashes = useMemo(() => day.conflicts.filter((c) => c.severity === "hard"
    && (!venueId || pitchIds.has(c.resourceId) || day.rooms.some((r) => r.id === c.resourceId && r.venueId === venueId))
    && !c.activityIds.some((id) => planner.plan.has(`FIXTURE:${id}`) || planner.plan.has(`TRAINING:${id}`))), [day.conflicts, day.rooms, venueId, pitchIds, planner.plan])
  // How much is on here: a quiet day says so in a few words rather than looking empty.
  const onHere = useMemo(() => day.activities.filter((a) => a.kind !== "FIXTURE" || a.home).filter((a) => {
    if (a.kind === "TOURNAMENT") return a.reservations.some((r) => pitchIds.has(r.pitchId))
    if (a.kind === "EVENT") return a.pitchIds.some((id) => pitchIds.has(id)) || (!venueId || a.venueId === venueId)
    const v = plannedParts(planner.plan, a as Allocatable).venueId
    return !venueId || !v || v === venueId
  }).length, [day.activities, pitchIds, venueId, planner.plan])
  const allocatableHere = useMemo(() => day.activities.some((a) => ((a.kind === "FIXTURE" && a.home) || a.kind === "TRAINING") && (!venueId || a.venueId === venueId)), [day.activities, venueId])

  const preferLow = preview ? preview.low : flash ? flash.low : false
  const refusing = !!preview?.clash
  const pillAt = preferLow ? { bottom: trayH + space.sm } : { top: headerH + space.sm }

  return (
    <View ref={rootRef} style={{ flex: 1, backgroundColor: colour.surface }} onLayout={measure}>
      {/* THE PITCH NAMES, frozen across the top */}
      <View style={{ flexDirection: "row", height: headerH, borderBottomWidth: 1, borderBottomColor: colour.lineStrong, backgroundColor: colour.surface }}>
        <View style={{ width: TIME_AXIS_WIDTH, borderRightWidth: 1, borderRightColor: colour.line, backgroundColor: colour.chalk, alignItems: "center", justifyContent: "flex-end", paddingBottom: 2 }}>
          {fullScreen ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Leave full screen" onPress={onLeaveFullScreen}
              style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", borderRadius: TOUCH_TARGET / 2, backgroundColor: pressed ? colour.line : "transparent" })}>
              <Minimize2 size={18} color={colour.forest800} />
            </Pressable>
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel={scale === "comfortable" ? "Show more of the day" : "Show times larger"} accessibilityHint="Changes how much of the day fits on the screen; the times do not change" onPress={onToggleScale}
              style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", borderRadius: TOUCH_TARGET / 2, backgroundColor: pressed ? colour.line : "transparent" })}>
              {scale === "comfortable" ? <ZoomOut size={18} color={colour.forest800} /> : <ZoomIn size={18} color={colour.forest800} />}
            </Pressable>
          )}
        </View>
        <View style={{ flex: 1, overflow: "hidden" }}>
          <Animated.View style={[{ width: Math.max(width, 1), height: headerH }, headerStyle]}>
            {venueBands.map((b) => <VenueBand key={b.venueId} band={b} height={bandH} scrollX={scrollX} />)}
            {pitches.map((p, i) => {
              const s = spans.get(p.id)
              if (!s) return null
              const isTarget = preview?.pitchId === p.id
              const dim = !!preview && blocked.has(p.id) && !isTarget
              const lanes = Math.max(1, p.lanes)
              const shared = sharing.get(p.id) ?? 0
              const isOpen = opened.has(p.id) && shared >= 2
              const meta = isOpen ? `${shared} teams training` : [sizeWord(p), lanes > 1 ? `${lanes} games at once` : null].filter(Boolean).join(" · ")
              const inUse = showNow ? pitchRows.some((r) => r.resourceId === p.id && r.from <= nowMinute! && nowMinute! < r.until) : null
              return (
                <View key={p.id} accessible={!isOpen} accessibilityRole="header" accessibilityLabel={`${p.name}, ${sizeWord(p)}${lanes > 1 ? `, takes ${lanes} games at once` : ""}${inUse === null ? "" : inUse ? ", in use now" : ", free now"}`}
                  style={{ position: "absolute", left: s.left - (i > 0 ? 4 : 0), width: s.width + (i > 0 ? 4 : 0), top: bandH, bottom: 0, paddingTop: 10, paddingHorizontal: space.sm, borderLeftWidth: i > 0 ? 1 : 0, borderLeftColor: colour.line, backgroundColor: isTarget ? (refusing ? colour.warningSurface : colour.mint100) : "transparent", opacity: dim ? 0.38 : 1 }}>
                  <ColumnHeader name={p.name} meta={meta} now={inUse}>
                    {isOpen && (
                      <Pressable accessibilityRole="button" accessibilityLabel={`Show the training on ${p.name} as one block`} onPress={() => toggleGroup(p.id)} hitSlop={8}
                        style={({ pressed }) => ({ alignSelf: "flex-start", marginTop: 4, minHeight: 26, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radius.pill, backgroundColor: pressed ? colour.line : eventTone.training.surface, borderWidth: 1, borderColor: "rgba(47,93,140,0.35)" })}>
                        <Users size={12} color={eventTone.training.text} />
                        <Text maxFontSizeMultiplier={BOARD_TEXT_CAP} style={[type.caption, { color: eventTone.training.text, fontFamily: type.heading.fontFamily, fontSize: 11, lineHeight: 14 }]}>Group Again</Text>
                      </Pressable>
                    )}
                  </ColumnHeader>
                </View>
              )
            })}
          </Animated.View>
        </View>
      </View>

      <View ref={vViewportRef} style={{ flex: 1 }} onLayout={measure}>
        <Animated.ScrollView ref={vRef} onScroll={onV} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: Math.max(trayH, 60) + space.xl }} onContentSizeChange={onContentSize}>
          <View style={{ flexDirection: "row" }}>
            <TimeRail scale={scale} height={height} nowMinute={nowMinute} />

            {/* THE PITCHES */}
            <View ref={hViewportRef} style={{ flex: 1, overflow: "hidden" }} onLayout={(e) => { setViewW(e.nativeEvent.layout.width); measure() }}>
              <Animated.ScrollView ref={hRef} horizontal onScroll={onH} scrollEventThrottle={16} showsHorizontalScrollIndicator={false}>
                <View style={{ width: Math.max(width + space.sm, 1), height }}>
                  <TimeGrid scale={scale} width={width + space.sm} nowMinute={null} />
                  {/* Each pitch a column, its games-at-once lanes inside it; what a drag can and cannot use, said in place. */}
                  {pitches.map((p, i) => {
                    const s = spans.get(p.id)
                    if (!s) return null
                    const isTarget = preview?.pitchId === p.id
                    const dim = !!preview && blocked.has(p.id) && !isTarget
                    return (
                      <View key={p.id} pointerEvents="none" style={{ position: "absolute", top: 0, height, left: s.left - (i > 0 ? 4 : 0), width: s.width + (i > 0 ? 4 : 0), borderLeftWidth: i > 0 ? 1 : 0, borderLeftColor: colour.line, backgroundColor: isTarget ? (refusing ? "rgba(253,246,231,0.9)" : "rgba(220,247,229,0.75)") : dim ? "rgba(16,21,18,0.075)" : preview ? "rgba(220,247,229,0.22)" : "transparent" }} />
                    )
                  })}
                  {cols.filter((c) => c.laneIndex > 0).map((c) => (
                    <View key={`${c.pitchId}:${c.laneIndex}`} pointerEvents="none" style={{ position: "absolute", top: 0, height, left: c.left - 2, width: 1, backgroundColor: "rgba(16,21,18,0.04)" }} />
                  ))}

                  {holds.map((h) => {
                    const s = spans.get(h.pitchId)
                    if (!s) return null
                    return <Hold key={h.key} hold={h} left={s.left} width={s.width} scale={scale} onOpen={onOpen} />
                  })}
                  {groups.filter((g) => !opened.has(g.pitchId)).map((g) => {
                    const s = spans.get(g.pitchId)
                    if (!s) return null
                    return <TrainingGroupCard key={g.key} group={g} left={s.left + 2} width={s.width - 4} scale={scale} states={states} pitchName={pitchById.get(g.pitchId)?.name ?? "this pitch"} onToggle={toggleGroup} />
                  })}
                  {training.filter((t) => !inGroup.has(t.a.id)).map((t) => {
                    const s = spans.get(t.pitchId)
                    if (!s) return null
                    const w = (s.width - 4) / t.subs
                    return (
                      <TrainingCard key={t.a.id} block={t} left={s.left + 2 + w * t.sub} width={w} scale={scale} state={states.get(t.a.id) ?? NONE} canManage={canManage}
                        liveMinutes={preview?.activity.id === t.a.id ? preview.minutes : null}
                        reduceMotion={reduceMotion} dragging={preview?.activity.id === t.a.id} scrollX={scrollX} scrollY={scrollY} dropOk={dropOk} onOpen={onOpen} onAllocate={onAllocate} onRemove={planner.removeFromPitch} onLift={onBlockLift} onDrag={onBlockDrag} onEnd={onBlockEnd} />
                    )
                  })}
                  {showNow && <View pointerEvents="none" style={{ position: "absolute", left: 0, width, top: minutesToY(nowMinute!, scale), height: 2, backgroundColor: colour.pitch600, opacity: 0.9 }} />}

                  {/* THE GHOST: where letting go would put it, warm-up and clearing included */}
                  {preview?.pitchId && preview.minutes !== null && (() => {
                    const col = cols.find((c) => c.pitchId === preview.pitchId && c.laneIndex === preview.lane) ?? cols.find((c) => c.pitchId === preview.pitchId)
                    if (!col) return null
                    const a = preview.activity
                    const from = a.kind === "FIXTURE" ? preview.minutes - day.policy.warmUp : preview.minutes
                    const until = a.kind === "FIXTURE" ? preview.minutes + a.playMinutes + day.policy.packUp : preview.minutes + trainingMinutes(a)
                    const span = a.kind === "TRAINING" ? spans.get(col.pitchId) : null
                    // A session's ghost: its own column where its pitch is opened out, otherwise the whole pitch.
                    const own = a.kind === "TRAINING" && opened.has(col.pitchId) ? training.find((t) => t.a.id === a.id && t.pitchId === col.pitchId) : undefined
                    const s = span && own ? { left: span.left + 2 + ((span.width - 4) / own.subs) * own.sub, width: (span.width - 4) / own.subs + 2 } : span
                    return (
                      <View pointerEvents="none" style={{ position: "absolute", left: (s?.left ?? col.left) + 3, width: (s?.width ?? col.width) - 6, top: minutesToY(Math.max(from, START_MINUTES), scale), height: heightForMinutes(until - Math.max(from, START_MINUTES), scale), borderRadius: radius.md, borderWidth: 2, borderColor: preview.clash ? colour.warning : colour.pitch600, backgroundColor: preview.clash ? "rgba(253,246,231,0.7)" : "rgba(50,166,101,0.14)", alignItems: "center", justifyContent: "center" }}>
                        {preview.clash
                          ? <Text maxFontSizeMultiplier={BOARD_TEXT_CAP} style={[type.caption, { color: colour.warning, fontFamily: type.smallMedium.fontFamily, fontSize: 11 }]}>Unavailable</Text>
                          : <Text maxFontSizeMultiplier={BOARD_TEXT_CAP} style={[type.caption, { color: colour.forest800, fontFamily: type.heading.fontFamily, fontSize: 12, fontVariant: ["tabular-nums"] }]}>{`${clock(a.kind === "FIXTURE" ? preview.minutes : from)}–${clock(a.kind === "FIXTURE" ? preview.minutes + a.playMinutes : until)}`}</Text>}
                      </View>
                    )
                  })()}

                  {fixtures.map((f) => {
                    const col = cols.find((c) => c.pitchId === f.pitchId && c.laneIndex === f.lane) ?? cols.find((c) => c.pitchId === f.pitchId)
                    if (!col) return null
                    return (
                      <MatchCard key={f.a.id} block={f} col={col} scale={scale} state={states.get(f.a.id) ?? NONE} canManage={canManage} reduceMotion={reduceMotion}
                        liveMinutes={preview?.activity.id === f.a.id ? preview.minutes : null}
                        dragging={preview?.activity.id === f.a.id} scrollX={scrollX} scrollY={scrollY} dropOk={dropOk} onOpen={onOpen} onAllocate={onAllocate} onRemove={planner.removeFromPitch} onLift={onBlockLift} onDrag={onBlockDrag} onEnd={onBlockEnd} />
                    )
                  })}
                </View>
              </Animated.ScrollView>
              {cols.length === 0 && (
                <View style={{ position: "absolute", top: space.lg, left: space.md, right: space.md }}>
                  <Text style={[type.small, { color: colour.inkMuted }]}>No pitches are switched on at this venue. Add them, or switch them on, in Venues.</Text>
                </View>
              )}
            </View>
          </View>
        </Animated.ScrollView>
      </View>

      {/* WHAT LETTING GO WOULD MEAN -- calm, short, and away from the finger */}
      {preview ? (
        preview.pitchId ? (
          preview.clash
            ? <DropPill {...pillAt} tone="refused" title={preview.clash.short.title} lines={[preview.clash.short.reason]} />
            : <DropPill {...pillAt} tone="plain" title={preview.lines[0] ?? ""} lines={[...preview.lines.slice(1), ...(preview.timeNote ? [preview.timeNote] : [])]} />
        ) : <DropPill {...pillAt} tone="plain" title="Drag onto a pitch, or let go here to cancel." />
      ) : flash ? (
        <DropPill {...pillAt} tone={flash.tone} title={flash.title} lines={flash.reason ? [flash.reason] : []}
          action={flash.action ? { label: flash.action.label, onPress: () => { const a = flash.action!.a; setFlash(null); onOpenCentre(a) } } : null} />
      ) : null}

      <View ref={trayRef} collapsable={false} onLayout={(e) => { setTrayH(e.nativeEvent.layout.height); measure() }} pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
        <Tray
          dirty={planner.counts.total > 0 || planner.auto.state === "proposed"}
          pitchName={(id) => (id ? day.pitches.find((p) => p.id === id)?.name ?? null : null)}
          plan={planner.plan}
          waiting={waiting}
          clashes={clashes}
          day={day}
          onHere={onHere}
          canRerun={canManage && allocatableHere}
          canManage={canManage}
          reduceMotion={reduceMotion}
          autoBusy={autoBusy}
          proposing={planner.auto.state === "proposed"}
          floatingId={floating?.id ?? null}
          rootX={rootX}
          rootY={rootY}
          ghostX={ghostX}
          ghostY={ghostY}
          ghostOn={ghostOn}
          onAuto={onAuto}
          onAllocate={onAllocate}
          onOpen={onOpen}
          onLift={onQueueLift}
          onDrag={onQueueDrag}
          onEnd={onBlockEnd}
        />
      </View>

      {/* THE PIECE IN THE HAND, when it comes up from Unallocated: drawn over everything, just above the finger */}
      <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0, width: 224 }, ghostStyle]}>
        {floating && <Piece a={floating} needs={[]} draggable pitchName={null} lifted />}
      </Animated.View>
    </View>
  )
}

function sizeWord(p: ArenaPitch): string {
  if (p.size === "full") return "Full size"
  if (p.size === "three_quarter") return "¾ size"
  if (p.size === "half") return "Half size"
  return pitchUnits(p) >= 4 ? "Custom, full" : "Custom size"
}

/** VoiceOver's own way to do what a drag does: open the details, allocate in words, or take it off its pitch. */
function blockActions(canManage: boolean) {
  return canManage
    ? [{ name: "activate", label: "Details" }, { name: "allocate", label: "Allocate" }, { name: "remove", label: "Remove from Pitch" }]
    : [{ name: "activate", label: "Details" }]
}

/** ONE MATCH: a light warm-up, the solid match, a light tail while the pitch is cleared -- one card. */
const MatchCard = memo(function MatchCard({ block: b, col, scale, state, canManage, reduceMotion, liveMinutes, dragging, scrollX, scrollY, dropOk, onOpen, onAllocate, onRemove, onLift, onDrag, onEnd }: {
  block: FixtureBlock
  /** While it is in the hand: the kick-off letting go would give it, said on the card as it moves. */
  liveMinutes: number | null
  col: LaneColumn
  scale: BoardScale
  state: BlockState
  canManage: boolean
  reduceMotion: boolean
  dragging: boolean
  scrollX: SharedValue<number>
  scrollY: SharedValue<number>
  dropOk: SharedValue<number>
  onOpen: (a: ArenaActivity) => void
  onAllocate: (a: Allocatable) => void
  onRemove: (a: Allocatable) => void
  onLift: (a: Allocatable, anchorX: number, anchorY: number, absX: number, absY: number) => void
  onDrag: (a: Allocatable, absX: number, absY: number) => void
  onEnd: (a: Allocatable, dropped: boolean) => void
}) {
  const top = minutesToY(Math.max(b.from, START_MINUTES), scale)
  const warmH = heightForMinutes(b.playFrom - Math.max(b.from, START_MINUTES), scale)
  const matchH = heightForMinutes(b.playUntil - b.playFrom, scale)
  const clearH = heightForMinutes(b.until - b.playUntil, scale)
  const narrow = col.width < 88
  const roomy = matchH >= 56 && !narrow
  // A narrow lane still names the opponent when the block is tall enough to give it two lines.
  const opponentLines = roomy ? 1 : narrow && matchH >= 84 ? 2 : 0
  const lift = useCallback((ax: number, ay: number) => onLift(b.a, col.left + col.width / 2, top + warmH, ax, ay), [onLift, b.a, col.left, col.width, top, warmH])
  const drag = useCallback((ax: number, ay: number) => onDrag(b.a, ax, ay), [onDrag, b.a])
  const end = useCallback((dropped: boolean) => onEnd(b.a, dropped), [onEnd, b.a])
  // A kick-off this person may not move keeps its time: the card still changes pitch.
  const { pan, style } = useLift(canManage, reduceMotion, !b.a.time.editable, { left: col.left, top }, scrollX, scrollY, dropOk, lift, drag, end)
  const auto = state.change?.origin === "AUTO"
  const staged = !!state.change
  const needsRooms = state.needs.includes("ROOMS")
  const tag = state.taken ?? (auto ? "auto" : "unsaved")
  const edge = state.clash ? { width: 2, color: colour.danger, dashed: false } : staged ? { width: 2, color: auto ? colour.pitch400 : colour.pitch600, dashed: true } : null
  // Shorter words in a narrow lane, so the chip never clips: "No rooms" / "New rooms".
  const status = needsRooms ? (col.width < 116 ? "No rooms" : "Needs rooms") : state.roomsProposed ? (col.width < 116 ? "New rooms" : "Rooms proposed") : null
  const label = [
    `${activityLabel(b.a)}. Kick-off ${clock(b.playFrom)}; pitch held ${clock(b.from)} to ${clock(b.until)} for warm-up and clearing.`,
    state.locks.length > 0 ? `Locked: ${lockedWords(state.locks)}.` : null,
    status ? `${status}.` : null,
    staged ? (auto ? "Proposed by Ovalball, not saved yet." : "Moved, not saved yet.") : null,
    state.clash ? `Clash: ${state.clash}` : null,
    b.a.time.editable ? null : b.a.time.reason,
  ].filter(Boolean).join(" ")
  const height = warmH + matchH + clearH
  return (
    <>
      {/* Where it was, while it is in the hand. */}
      {dragging && <View pointerEvents="none" style={{ position: "absolute", left: col.left + 3, top, width: col.width - 6, height, borderRadius: radius.md, borderWidth: 1, borderColor: "rgba(18,61,44,0.25)", backgroundColor: "rgba(18,61,44,0.06)" }} />}
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ position: "absolute", left: col.left + 3, top, width: col.width - 6, height, shadowColor: colour.forest950, shadowOffset: { width: 0, height: 4 } }, style]}>
          <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={canManage ? `Double tap for details. Press and hold to move it${b.a.time.editable ? "" : " to another pitch"}. Swipe up or down for more actions.` : "Double tap for details."}
            accessibilityActions={blockActions(canManage)}
            onAccessibilityAction={(e: AccessibilityActionEvent) => { const n = e.nativeEvent.actionName; if (n === "allocate") onAllocate(b.a); else if (n === "remove") onRemove(b.a); else onOpen(b.a) }}
            onPress={() => onOpen(b.a)}
            style={{ flex: 1, borderRadius: radius.md, overflow: "hidden", borderWidth: edge?.width ?? 0, borderColor: edge?.color ?? "transparent", borderStyle: edge?.dashed ? "dashed" : "solid", backgroundColor: colour.mint100 }}>
            {warmH > 0 && (
              <View style={{ height: warmH - (edge ? 2 : 0), flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 6, paddingBottom: 2 }}>
                {/* A change's own word takes the warm-up's place, so the two never crowd a narrow lane. */}
                {staged && warmH >= 18 ? <StateTag kind={tag} compact={col.width < 132} />
                  : warmH >= 26 && !narrow ? <Text maxFontSizeMultiplier={1} style={[type.caption, { fontSize: 10, lineHeight: 12, color: "rgba(18,61,44,0.7)" }]} numberOfLines={1}>Warm-up</Text> : <View />}
              </View>
            )}
            <View style={{ height: matchH, backgroundColor: colour.forest800, paddingHorizontal: narrow ? 5 : 8, paddingVertical: 5, justifyContent: "center", gap: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 4 }}>
                <Text maxFontSizeMultiplier={BOARD_TEXT_CAP} style={[type.smallMedium, { color: colour.onForest, fontSize: narrow ? 12 : 13, lineHeight: narrow ? 15 : 16, flex: 1, fontFamily: type.heading.fontFamily }]} numberOfLines={roomy ? 2 : 1}>{teamShort(b.a.team)}</Text>
                {state.clash && <TriangleAlert size={12} color="#ffb4ae" />}
                {state.locks.length > 0 && <Lock size={12} color="rgba(255,255,255,0.9)" />}
              </View>
              {opponentLines > 0 && <Text maxFontSizeMultiplier={BOARD_TEXT_CAP} style={[type.caption, { color: "rgba(255,255,255,0.82)", fontSize: 11, lineHeight: 14 }]} numberOfLines={opponentLines}>{`v ${boardOpponent(b.a.opponentName)}`}</Text>}
              <Text maxFontSizeMultiplier={BOARD_TEXT_CAP} style={[type.caption, { color: colour.mint300, fontSize: 12, lineHeight: 15, fontFamily: type.smallMedium.fontFamily, fontVariant: ["tabular-nums"] }]} numberOfLines={1}>{clock(liveMinutes ?? b.playFrom)}</Text>
              {status && matchH >= 52 && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start", maxWidth: "100%", marginTop: 3, paddingHorizontal: col.width < 140 ? 5 : 6, height: 18, borderRadius: 9, backgroundColor: needsRooms ? colour.warningSurface : "transparent", borderWidth: needsRooms ? 0 : 1, borderColor: colour.mint300 }}>
                  {col.width >= 140 && (needsRooms ? <DoorOpen size={10} color={colour.warning} /> : <Sparkles size={10} color={colour.mint300} />)}
                  <Text maxFontSizeMultiplier={1} style={[type.caption, { color: needsRooms ? colour.warning : colour.mint300, fontSize: 10, lineHeight: 12, fontFamily: type.smallMedium.fontFamily }]}>{status}</Text>
                </View>
              )}
            </View>
            {clearH > 0 && (
              <View style={{ height: clearH - (edge ? 2 : 0), justifyContent: "flex-start", paddingHorizontal: 6, paddingTop: 2 }}>
                {clearH >= 26 && !narrow && <Text maxFontSizeMultiplier={1} style={[type.caption, { fontSize: 10, lineHeight: 12, color: "rgba(18,61,44,0.7)" }]} numberOfLines={1}>Clear</Text>}
              </View>
            )}
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </>
  )
})

/**
 * ONE SESSION, in the training tone. Across changes its pitch; down changes its start when its time is this
 * person's to move (the Training Centre's authority, said by the server). A session that asked for a changing room
 * says which one it has -- or, in amber, that it still needs one.
 */
const TrainingCard = memo(function TrainingCard({ block: b, left, width, scale, state, canManage, reduceMotion, liveMinutes, dragging, scrollX, scrollY, dropOk, onOpen, onAllocate, onRemove, onLift, onDrag, onEnd }: {
  block: TrainingBlock
  /** While it is in the hand: the start letting go would give it, said on the card as it moves. */
  liveMinutes: number | null
  left: number
  width: number
  scale: BoardScale
  state: BlockState
  canManage: boolean
  reduceMotion: boolean
  dragging: boolean
  scrollX: SharedValue<number>
  scrollY: SharedValue<number>
  dropOk: SharedValue<number>
  onOpen: (a: ArenaActivity) => void
  onAllocate: (a: Allocatable) => void
  onRemove: (a: Allocatable) => void
  onLift: (a: Allocatable, anchorX: number, anchorY: number, absX: number, absY: number) => void
  onDrag: (a: Allocatable, absX: number, absY: number) => void
  onEnd: (a: Allocatable, dropped: boolean) => void
}) {
  const top = minutesToY(b.from, scale)
  const h = heightForMinutes(b.until - b.from, scale)
  const lift = useCallback((ax: number, ay: number) => onLift(b.a, left + width / 2, top, ax, ay), [onLift, b.a, left, width, top])
  const drag = useCallback((ax: number, ay: number) => onDrag(b.a, ax, ay), [onDrag, b.a])
  const end = useCallback((dropped: boolean) => onEnd(b.a, dropped), [onEnd, b.a])
  const { pan, style } = useLift(canManage, reduceMotion, !b.a.time.editable, { left, top }, scrollX, scrollY, dropOk, lift, drag, end)
  const auto = state.change?.origin === "AUTO"
  const staged = !!state.change
  const tone = eventTone.training
  const needsRoom = state.needs.includes("ROOMS")
  // A room's name, short enough for a narrow card ("Changing Room 3" is "Room 3" here; the sheet says it in full).
  const roomLine = state.room ? state.room.replace(/^Changing Room\b/i, "Room") : needsRoom ? "Needs room" : null
  const label = [
    `${activityLabel(b.a)}, ${clock(b.from)} to ${clock(b.until)}.`,
    state.room ? `Changing room: ${state.room}.` : needsRoom ? "Needs a changing room." : null,
    state.roomClash ? `Room clash: ${state.roomClash}` : null,
    state.locks.length > 0 ? `Locked: ${lockedWords(state.locks)}.` : null,
    staged ? (auto ? "Proposed by Ovalball, not saved yet." : "Moved, not saved yet.") : null,
    state.clash ? `Clash: ${state.clash}` : null,
  ].filter(Boolean).join(" ")
  return (
    <>
      {dragging && <View pointerEvents="none" style={{ position: "absolute", left: left + 1, top: top + 1, width: width - 2, height: h - 2, borderRadius: radius.md, borderWidth: 1, borderColor: "rgba(47,93,140,0.3)", backgroundColor: "rgba(47,93,140,0.05)" }} />}
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ position: "absolute", left: left + 1, top: top + 1, width: width - 2, height: h - 2, shadowColor: colour.forest950, shadowOffset: { width: 0, height: 4 } }, style]}>
          <Pressable accessibilityRole="button" accessibilityLabel={label}
            accessibilityHint={canManage ? `Double tap for details. Press and hold to move it to another pitch${b.a.time.editable ? " or time" : ""}. Swipe up or down for more actions.` : "Double tap for details."}
            accessibilityActions={blockActions(canManage)}
            onAccessibilityAction={(e: AccessibilityActionEvent) => { const n = e.nativeEvent.actionName; if (n === "allocate") onAllocate(b.a); else if (n === "remove") onRemove(b.a); else onOpen(b.a) }}
            onPress={() => onOpen(b.a)}
            style={{ flex: 1, borderRadius: radius.md, overflow: "hidden", backgroundColor: tone.surface, borderWidth: state.clash || staged ? 2 : 0, borderColor: state.clash ? colour.danger : auto ? colour.pitch400 : colour.pitch600, borderStyle: staged && !state.clash ? "dashed" : "solid", paddingLeft: 9, paddingRight: 6, paddingVertical: 5, gap: 2 }}>
            {/* The training accent as its own layer: iOS draws a dashed outline only when every side is the same. */}
            <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: tone.accent }} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Dumbbell size={11} color={tone.text} />
              <Text maxFontSizeMultiplier={BOARD_TEXT_CAP} style={[type.caption, { color: tone.text, fontFamily: type.heading.fontFamily, flex: 1, fontSize: 12, lineHeight: 15 }]} numberOfLines={2}>{activityLabel(b.a)}</Text>
              {state.locks.length > 0 && <Lock size={10} color={tone.text} />}
            </View>
            {h >= 40 && <Text maxFontSizeMultiplier={BOARD_TEXT_CAP} style={[type.caption, { color: tone.text, fontSize: 11, lineHeight: 14, fontVariant: ["tabular-nums"], fontFamily: liveMinutes !== null && liveMinutes !== b.from ? type.heading.fontFamily : undefined }]} numberOfLines={1}>{liveMinutes !== null ? `${clock(liveMinutes)}–${clock(liveMinutes + (b.until - b.from))}` : `${clock(b.from)}–${clock(b.until)}`}</Text>}
            {roomLine && h >= 58 && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start", maxWidth: "100%", paddingHorizontal: 5, minHeight: 18, borderRadius: 9, borderWidth: state.roomClash ? 1 : 0, borderColor: colour.danger, backgroundColor: state.roomClash ? colour.dangerSurface : needsRoom ? colour.warningSurface : "rgba(255,255,255,0.7)" }}>
                {state.roomClash ? <TriangleAlert size={10} color={colour.danger} /> : <DoorOpen size={10} color={needsRoom ? colour.warning : tone.text} />}
                <Text maxFontSizeMultiplier={BOARD_TEXT_CAP} style={[type.caption, { color: state.roomClash ? colour.danger : needsRoom ? colour.warning : tone.text, fontSize: 10.5, lineHeight: 13, fontFamily: type.smallMedium.fontFamily, flexShrink: 1 }]} numberOfLines={1}>{roomLine}</Text>
              </View>
            )}
            {staged && h >= 76 && <View style={{ alignSelf: "flex-start", marginTop: 2 }}><StateTag kind={state.taken ?? (auto ? "auto" : "unsaved")} /></View>}
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </>
  )
})

/**
 * TRAINING GROUPS SHARING A PITCH, AS ONE BLOCK: how many share it, when, and who -- in the training tone, with
 * the edge of a second card behind it so "several" reads before a word is read. Sharing is allowed without limit,
 * so this is never drawn as a clash; only a real clash gets the red edge. Tap (or press and hold) to open the pitch
 * out, one column per group, so each team can be moved on its own.
 */
const TrainingGroupCard = memo(function TrainingGroupCard({ group: g, left, width, scale, states, pitchName, onToggle }: {
  group: TrainingGroup
  left: number
  width: number
  scale: BoardScale
  states: Map<string, BlockState>
  pitchName: string
  onToggle: (pitchId: string) => void
}) {
  const top = minutesToY(Math.max(g.from, START_MINUTES), scale)
  const h = heightForMinutes(g.until - Math.max(g.from, START_MINUTES), scale)
  const tone = eventTone.training
  const n = g.sessions.length
  const sameTime = g.sessions.every((s) => s.from === g.sessions[0].from && s.until === g.sessions[0].until)
  const names = g.sessions.map((s) => (s.a.team ? teamShort(s.a.team) : s.a.groupLabel ?? "Team"))
  const st = g.sessions.map((s) => states.get(s.a.id) ?? NONE)
  const clash = st.some((x) => !!x.clash)
  const staged = st.filter((x) => !!x.change)
  const needRoom = st.filter((x) => x.needs.includes("ROOMS")).length
  const locked = st.some((x) => x.locks.length > 0)
  const longPress = useMemo(() => Gesture.LongPress().minDuration(350).onStart(() => { runOnJS(onToggle)(g.pitchId) }), [onToggle, g.pitchId])
  const spoken = [
    `Training, ${clock(g.from)} to ${clock(g.until)}. ${n} teams share ${pitchName}: ${g.sessions.map((s) => s.a.team?.displayName ?? s.a.groupLabel ?? "Team").join(", ")}.`,
    needRoom > 0 ? `${needRoom} ${needRoom === 1 ? "needs" : "need"} a changing room.` : null,
    staged.length > 0 ? `${staged.length} not saved yet.` : null,
    clash ? "One of them clashes." : null,
  ].filter(Boolean).join(" ")
  return (
    <GestureDetector gesture={longPress}>
      <Pressable accessibilityRole="button" accessibilityLabel={spoken} accessibilityHint="Double tap to show each team, to move one on its own" onPress={() => onToggle(g.pitchId)}
        style={{ position: "absolute", left, top: top + 1, width, height: h - 2 }}>
        {/* The edge of another card behind: more than one is here, on purpose. */}
        <View pointerEvents="none" style={{ position: "absolute", left: 4, right: -2, top: -1, bottom: 3, borderRadius: radius.md, backgroundColor: "#d5e2f0", borderWidth: 1, borderColor: "rgba(47,93,140,0.25)" }} />
        <View style={{ flex: 1, marginRight: 3, marginTop: 2, borderRadius: radius.md, overflow: "hidden", backgroundColor: tone.surface, borderWidth: clash || staged.length > 0 ? 2 : 1, borderColor: clash ? colour.danger : staged.length > 0 ? colour.pitch600 : "rgba(47,93,140,0.35)", borderStyle: staged.length > 0 && !clash ? "dashed" : "solid", paddingLeft: 9, paddingRight: 6, paddingVertical: 5, gap: 2 }}>
          <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: tone.accent }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Users size={12} color={tone.text} />
            <Text maxFontSizeMultiplier={BOARD_TEXT_CAP} style={[type.caption, { color: tone.text, fontFamily: type.heading.fontFamily, flex: 1, fontSize: 12, lineHeight: 15 }]} numberOfLines={1}>{`Training · ${n} teams`}</Text>
            {clash && <TriangleAlert size={11} color={colour.danger} />}
            {locked && <Lock size={10} color={tone.text} />}
          </View>
          <Text maxFontSizeMultiplier={BOARD_TEXT_CAP} style={[type.caption, { color: tone.text, fontSize: 11, lineHeight: 14, fontVariant: ["tabular-nums"] }]} numberOfLines={1}>{sameTime ? `${clock(g.from)}–${clock(g.until)}` : `From ${clock(g.from)} to ${clock(g.until)}`}</Text>
          {h >= 56 && <Text maxFontSizeMultiplier={BOARD_TEXT_CAP} style={[type.caption, { color: tone.text, fontSize: 11, lineHeight: 14, fontFamily: type.smallMedium.fontFamily }]} numberOfLines={h >= 90 ? 3 : 1}>{names.join(" · ")}</Text>}
          {h >= 76 && (needRoom > 0 || staged.length > 0) && (
            <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap", marginTop: 1 }}>
              {needRoom > 0 && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 5, minHeight: 18, borderRadius: 9, backgroundColor: colour.warningSurface }}>
                  <DoorOpen size={10} color={colour.warning} />
                  <Text maxFontSizeMultiplier={BOARD_TEXT_CAP} style={[type.caption, { color: colour.warning, fontSize: 10.5, lineHeight: 13, fontFamily: type.smallMedium.fontFamily }]}>{`${needRoom} ${needRoom === 1 ? "needs" : "need"} a room`}</Text>
                </View>
              )}
              {staged.length > 0 && <StateTag kind={staged.every((x) => x.change?.origin === "AUTO") ? "auto" : "unsaved"} />}
            </View>
          )}
        </View>
      </Pressable>
    </GestureDetector>
  )
})

/** A TOURNAMENT'S OR AN EVENT'S RESERVATION: hatched across the whole pitch -- held, not played on by a booking --
 * in its own tone, with the word "Reserved" and its hours. A tournament's own games are its plan's, not drawn here. */
const Hold = memo(function Hold({ hold: h, left, width, scale, onOpen }: { hold: HoldBlock; left: number; width: number; scale: BoardScale; onOpen: (a: ArenaActivity) => void }) {
  const top = minutesToY(Math.max(h.from, START_MINUTES), scale)
  const height = heightForMinutes(h.until - Math.max(h.from, START_MINUTES), scale)
  const tournament = h.kind === "TOURNAMENT"
  const tone = tournament
    ? { surface: "#f3f7f4", hatch: "rgba(18,61,44,0.075)", border: "rgba(18,61,44,0.3)", text: colour.forest800 }
    : { surface: "#f6f2fd", hatch: "rgba(116,72,201,0.075)", border: "rgba(116,72,201,0.35)", text: eventTone.event.text }
  const Icon = tournament ? Trophy : CalendarDays
  const games = tournament && h.areas !== null && h.areas > 1 ? `${h.areas} games at once` : null
  const id = `hatch-${h.key.replace(/[^a-zA-Z0-9]/g, "")}`
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${h.label}, ${tournament ? "tournament" : "event"}. Pitch reserved ${clock(h.from)} to ${clock(h.until)}${games ? `, ${games}` : ""}.`} accessibilityHint="Double tap for details" onPress={() => h.activity && onOpen(h.activity)}
      style={{ position: "absolute", left: left + 2, width: width - 4, top, height, borderRadius: radius.md, backgroundColor: tone.surface, borderWidth: 1, borderColor: tone.border, overflow: "hidden" }}>
      <Svg key={`${Math.round(width)}x${Math.round(height)}`} width={Math.max(width - 6, 1)} height={Math.max(height - 2, 1)} style={{ position: "absolute", left: 0, top: 0 }} pointerEvents="none">
        <Defs>
          <Pattern id={id} width={10} height={10} patternUnits="userSpaceOnUse">
            <Path d="M0,10 L10,0 M-2.5,2.5 L2.5,-2.5 M7.5,12.5 L12.5,7.5" stroke={tone.hatch} strokeWidth={2.5} />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width={Math.max(width - 6, 1)} height={Math.max(height - 2, 1)} fill={`url(#${id})`} />
      </Svg>
      <View style={{ paddingHorizontal: 8, paddingVertical: 6, gap: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Icon size={12} color={tone.text} />
          <Text maxFontSizeMultiplier={BOARD_TEXT_CAP} style={[type.caption, { color: tone.text, fontFamily: type.heading.fontFamily, flex: 1, fontSize: 12, lineHeight: 15 }]} numberOfLines={2}>{h.label}</Text>
        </View>
        <Text maxFontSizeMultiplier={BOARD_TEXT_CAP} style={[type.caption, { color: tone.text, fontSize: 11, lineHeight: 14, fontVariant: ["tabular-nums"] }]} numberOfLines={2}>{`Reserved ${clock(h.from)}–${clock(h.until)}`}</Text>
        {games && height >= 60 && <Text maxFontSizeMultiplier={BOARD_TEXT_CAP} style={[type.caption, { color: tone.text, fontSize: 11, lineHeight: 14 }]} numberOfLines={2}>{games}</Text>}
      </View>
    </Pressable>
  )
})

/** What something waiting still needs, in a few words: "Needs pitch + rooms" (a session's one room: "room"). */
function needWords(needs: readonly ArenaNeed[], kind: Allocatable["kind"] = "FIXTURE"): string {
  const words = needs.map((n) => (n === "PITCH" ? "pitch" : n === "ROOMS" ? (kind === "TRAINING" ? "room" : "rooms") : n === "KICKOFF" ? "kick-off" : n === "VENUE" ? "venue" : "time"))
  const shown = words.filter((w) => w !== "venue" || !words.includes("pitch"))
  return shown.length > 0 ? `Needs ${shown.join(" + ")}` : ""
}

/**
 * A PIECE OF WORK WAITING FOR ITS PLACE -- drawn as what it will be on the board (a match is forest, a session the
 * training blue). One still needing a pitch has the grip it is carried by; one already on a pitch and waiting only
 * for its changing rooms says which pitch, and is tapped rather than dragged.
 */
function Piece({ a, needs, draggable, pitchName, lifted }: { a: Allocatable; needs: readonly ArenaNeed[]; draggable: boolean; pitchName: string | null; lifted?: boolean }) {
  const fixture = a.kind === "FIXTURE"
  const ink = fixture ? colour.onForest : eventTone.training.text
  const sub = fixture ? colour.mint300 : eventTone.training.text
  const title = boardLabel(a)
  const when = fixture ? (a.kickoff ?? "No kick-off") : `${a.start ?? ""}–${a.end ?? ""}`
  const need = needWords(needs, a.kind)
  return (
    <View style={{ minHeight: 50, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: draggable ? 4 : space.sm, paddingRight: space.sm, paddingVertical: 6, borderRadius: radius.md, backgroundColor: fixture ? colour.forest800 : eventTone.training.surface, borderWidth: 1, borderColor: fixture ? "rgba(145,227,172,0.35)" : "rgba(47,93,140,0.35)", ...(lifted ? { shadowColor: colour.forest950, shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 14 } : null) }}>
      {draggable ? <GripVertical size={16} color={fixture ? "rgba(255,255,255,0.6)" : "rgba(47,93,140,0.65)"} /> : <DoorOpen size={15} color={sub} />}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text maxFontSizeMultiplier={1.3} style={[type.smallMedium, { color: ink, fontFamily: type.heading.fontFamily, fontSize: 13, lineHeight: 16 }]} numberOfLines={2}>{title}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Text maxFontSizeMultiplier={1.3} style={[type.caption, { color: sub, fontFamily: type.smallMedium.fontFamily, fontVariant: ["tabular-nums"] }]}>{!draggable && pitchName ? `${pitchName} · ${when}` : when}</Text>
          {!!need && (
            <View style={{ paddingHorizontal: 6, minHeight: 18, justifyContent: "center", borderRadius: 9, backgroundColor: colour.warningSurface }}>
              <Text maxFontSizeMultiplier={1.2} style={[type.caption, { color: colour.warning, fontSize: 11, lineHeight: 13, fontFamily: type.smallMedium.fontFamily }]} numberOfLines={1}>{need}</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  )
}

/**
 * UNALLOCATED -- work waiting to be placed, attached to the foot of the board it belongs on: how much, Ovalball's
 * Auto Allocate as the easy way to place it, and the pieces themselves to place by hand. While there are unsaved
 * changes the save bar below is the one action, so this folds to the pieces alone. When nothing is waiting it
 * shrinks to one quiet line.
 */
function Tray({ dirty, pitchName, plan, waiting, clashes, day, onHere, canRerun, canManage, reduceMotion, autoBusy, proposing, floatingId, rootX, rootY, ghostX, ghostY, ghostOn, onAuto, onAllocate, onOpen, onLift, onDrag, onEnd }: {
  dirty: boolean
  pitchName: (id: string | null) => string | null
  plan: Plan
  waiting: { a: Allocatable; needs: ArenaNeed[] }[]
  clashes: ArenaConflict[]
  day: ArenaDay
  onHere: number
  canRerun: boolean
  canManage: boolean
  reduceMotion: boolean
  autoBusy: boolean
  proposing: boolean
  floatingId: string | null
  rootX: SharedValue<number>
  rootY: SharedValue<number>
  ghostX: SharedValue<number>
  ghostY: SharedValue<number>
  ghostOn: SharedValue<number>
  onAuto: (rerun: boolean) => void
  onAllocate: (a: Allocatable) => void
  onOpen: (a: ArenaActivity) => void
  onLift: (a: Allocatable) => void
  onDrag: (a: Allocatable, ax: number, ay: number) => void
  onEnd: (a: Allocatable, dropped: boolean) => void
}) {
  const [open, setOpen] = useState(true)
  // While Ovalball's proposal is on the board, the board needs the room: the pieces fold away (one tap brings them back).
  useEffect(() => { setOpen(!proposing) }, [proposing])
  const n = waiting.length
  const ground = { backgroundColor: colour.chalk, borderTopWidth: 1, borderTopColor: colour.lineStrong }
  // Pieces still needing a pitch first (they are carried onto the board), then those waiting only for rooms.
  const ordered = [...waiting].sort((x, y) => Number(!x.needs.includes("PITCH")) - Number(!y.needs.includes("PITCH")))
  const pieces = (
    <>
      {ordered.map(({ a, needs }) => (
        <WaitingPiece key={`${a.kind}-${a.id}`} a={a} needs={needs} pitchName={pitchName(plannedParts(plan, a).pitchId)} canManage={canManage} reduceMotion={reduceMotion} lifted={floatingId === a.id} alone={waiting.length + clashes.length === 1}
          rootX={rootX} rootY={rootY} ghostX={ghostX} ghostY={ghostY} ghostOn={ghostOn} onAllocate={onAllocate} onLift={onLift} onDrag={onDrag} onEnd={onEnd} />
      ))}
      {clashes.map((c) => {
        const a = day.activities.find((x) => c.activityIds.includes(x.id))
        return (
          <Pressable key={c.key} accessibilityRole="button" accessibilityLabel={`Clash. ${c.message}`} accessibilityHint="Opens what clashes" onPress={() => a && onOpen(a)}
            style={({ pressed }) => ({ width: 232, minHeight: 50, flexDirection: "row", gap: space.sm, alignItems: "center", paddingHorizontal: space.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: colour.danger, backgroundColor: pressed ? colour.surface : colour.dangerSurface })}>
            <TriangleAlert size={15} color={colour.danger} />
            <Text maxFontSizeMultiplier={1.3} style={[type.caption, { color: colour.danger, flex: 1, fontFamily: type.smallMedium.fontFamily }]} numberOfLines={3}>{c.message}</Text>
          </Pressable>
        )
      })}
    </>
  )
  if (n === 0 && clashes.length === 0) {
    if (dirty) return null
    // RESOLVED: one quiet line -- and on a quiet day, that it is a quiet day.
    const quiet = onHere <= 2
    const words = onHere === 0 ? "Nothing planned on this day" : quiet ? "All allocated · Nothing else planned" : "All allocated"
    return (
      <View style={{ ...ground, minHeight: 40, flexDirection: "row", alignItems: "center", gap: space.sm, paddingLeft: space.md, paddingRight: space.xs }}>
        {onHere > 0 && <Check size={15} color={colour.pitch600} />}
        <Text maxFontSizeMultiplier={1.6} style={[type.small, { color: colour.inkMuted, flex: 1 }]}>{words}</Text>
        {canRerun && !proposing && !quiet && (
          <Pressable accessibilityRole="button" accessibilityLabel="Re-run Auto Allocation" accessibilityHint="Ovalball works the day out again from availability and team preferences, as a proposal on the board" onPress={() => onAuto(true)} disabled={autoBusy}
            style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: space.sm, opacity: pressed || autoBusy ? 0.6 : 1 })}>
            <Sparkles size={13} color={colour.pitch600} />
            <Text maxFontSizeMultiplier={1.5} style={[type.small, { color: colour.forest800, fontFamily: type.smallMedium.fontFamily }]}>Re-run Auto Allocation</Text>
          </Pressable>
        )}
      </View>
    )
  }
  const spoken = [n > 0 ? `${n} ${n === 1 ? "activity needs" : "activities need"} allocating` : null, clashes.length > 0 ? `${clashes.length} ${clashes.length === 1 ? "clash" : "clashes"}` : null].filter(Boolean).join(", ")
  if (dirty) {
    // THE SAVE BAR IS THE ONE ACTION NOW: the pieces stay to hand, labelled, without a second primary beside them.
    if (proposing && !open) return null
    return (
      <View style={ground}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.sm, alignItems: "center" }}>
          <View accessible accessibilityLabel={`Unallocated. ${spoken}`} style={{ paddingRight: 2, gap: 2 }}>
            <Text maxFontSizeMultiplier={1.4} style={[type.caption, { color: colour.ink, fontFamily: type.heading.fontFamily }]}>Unallocated</Text>
            <Text maxFontSizeMultiplier={1.4} style={[type.caption, { color: colour.warning, fontFamily: type.smallMedium.fontFamily }]}>{`${n + clashes.length} waiting`}</Text>
          </View>
          {pieces}
        </ScrollView>
      </View>
    )
  }
  return (
    <View style={ground}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingLeft: space.md, paddingRight: space.sm, paddingVertical: 4 }}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`Unallocated. ${spoken}. ${open ? "Hide" : "Show"} the pieces`} onPress={() => setOpen((v) => !v)}
          style={{ flex: 1, minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text maxFontSizeMultiplier={1.5} style={[type.smallMedium, { color: colour.ink, fontFamily: type.heading.fontFamily }]}>Unallocated</Text>
          {n > 0 && (
            <View style={{ minWidth: 24, height: 22, paddingHorizontal: 7, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colour.warningSurface, borderWidth: 1, borderColor: "rgba(138,90,0,0.3)" }}>
              <Text maxFontSizeMultiplier={1.4} style={[type.caption, { color: colour.warning, fontFamily: type.heading.fontFamily, fontVariant: ["tabular-nums"] }]}>{n}</Text>
            </View>
          )}
          {clashes.length > 0 && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, height: 22, paddingHorizontal: 7, borderRadius: 11, backgroundColor: colour.dangerSurface }}>
              <TriangleAlert size={11} color={colour.danger} />
              <Text maxFontSizeMultiplier={1.4} style={[type.caption, { color: colour.danger, fontFamily: type.smallMedium.fontFamily }]}>{`${clashes.length} ${clashes.length === 1 ? "clash" : "clashes"}`}</Text>
            </View>
          )}
          {open ? <ChevronDown size={16} color={colour.inkSubtle} /> : <ChevronUp size={16} color={colour.inkSubtle} />}
        </Pressable>
        {/* THE EASY BUTTON: Ovalball places it from availability and the teams' preferences. Moving it by hand is the override. */}
        {canManage && n > 0 && !proposing && (
          <Pressable accessibilityRole="button" accessibilityLabel="Auto Allocate" accessibilityHint="Ovalball places what is waiting, from availability and the teams' preferences, as a proposal on the board" onPress={() => onAuto(false)} disabled={autoBusy}
            style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: colour.pitch600, opacity: pressed || autoBusy ? 0.8 : 1 })}>
            <Sparkles size={15} color={colour.forest950} />
            <Text maxFontSizeMultiplier={1.4} style={[type.smallMedium, { color: colour.forest950, fontFamily: type.heading.fontFamily }]}>{autoBusy ? "Working…" : "Auto Allocate"}</Text>
          </Pressable>
        )}
      </View>
      {open && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.md, paddingBottom: space.sm + 2, gap: space.sm }}>
          {pieces}
        </ScrollView>
      )}
    </View>
  )
}

const WaitingPiece = memo(function WaitingPiece({ a, needs, pitchName, canManage, reduceMotion, lifted, alone, rootX, rootY, ghostX, ghostY, ghostOn, onAllocate, onLift, onDrag, onEnd }: {
  a: Allocatable
  needs: ArenaNeed[]
  pitchName: string | null
  canManage: boolean
  reduceMotion: boolean
  lifted: boolean
  alone: boolean
  rootX: SharedValue<number>
  rootY: SharedValue<number>
  ghostX: SharedValue<number>
  ghostY: SharedValue<number>
  ghostOn: SharedValue<number>
  onAllocate: (a: Allocatable) => void
  onLift: (a: Allocatable) => void
  onDrag: (a: Allocatable, ax: number, ay: number) => void
  onEnd: (a: Allocatable, dropped: boolean) => void
}) {
  // Only something waiting for a PITCH is carried onto the board; one that has its pitch and needs only rooms is
  // tapped, for the rooms.
  const draggable = canManage && needs.includes("PITCH") && (a.kind === "TRAINING" ? !!a.start : true)
  const pan = useMemo(() => Gesture.Pan()
    .enabled(draggable)
    .activateAfterLongPress(350)
    .onStart((e) => {
      ghostX.value = e.absoluteX - rootX.value
      ghostY.value = e.absoluteY - rootY.value - LIFT
      ghostOn.value = reduceMotion ? 1 : withSpring(1, { damping: 18, stiffness: 240 })
      runOnJS(haptic.lift)()
      runOnJS(onLift)(a)
      runOnJS(onDrag)(a, e.absoluteX, e.absoluteY)
    })
    .onUpdate((e) => {
      ghostX.value = e.absoluteX - rootX.value
      ghostY.value = e.absoluteY - rootY.value - LIFT
      runOnJS(onDrag)(a, e.absoluteX, e.absoluteY)
    })
    .onEnd(() => { runOnJS(onEnd)(a, true) })
    .onFinalize((_e, success) => {
      if (!success) runOnJS(onEnd)(a, false)
      ghostOn.value = reduceMotion ? 0 : withTiming(0, { duration: 140 })
    }), [draggable, reduceMotion, a, onLift, onDrag, onEnd, rootX, rootY, ghostX, ghostY, ghostOn])
  const when = a.kind === "FIXTURE" ? (a.kickoff ? `kick-off ${a.kickoff}` : "no kick-off yet") : `${a.start ?? ""} to ${a.end ?? ""}`
  return (
    <GestureDetector gesture={pan}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${activityTitle(a)}, ${!draggable && pitchName ? `${pitchName}, ` : ""}${when}. ${needWords(needs, a.kind)}.`}
        accessibilityHint={canManage ? `Double tap to allocate.${draggable ? " Press and hold to carry it onto a pitch." : ""}` : undefined}
        onPress={() => onAllocate(a)} style={({ pressed }) => ({ width: alone ? 300 : 212, opacity: lifted ? 0.3 : pressed ? 0.85 : 1 })}>
        <Piece a={a} needs={needs} draggable={draggable} pitchName={pitchName} />
      </Pressable>
    </GestureDetector>
  )
})
