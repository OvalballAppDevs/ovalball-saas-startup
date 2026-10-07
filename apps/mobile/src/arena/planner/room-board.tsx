import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AccessibilityInfo, Pressable, ScrollView, Text, View, useWindowDimensions, type AccessibilityActionEvent } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Svg, { Defs, Path, Pattern, Rect } from "react-native-svg"
import Animated, { runOnJS, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated"

import { activityTitle, clock, teamShort, type ArenaActivity, type ArenaDay, type ArenaRoom } from "@ovalball/contracts/arena"

import { haptic } from "../../pitch-allocation/haptics"
import { PX_PER_SLOT, START_MINUTES, TIME_AXIS_WIDTH, heightForMinutes, minutesToY, timelineHeight, type BoardScale } from "../../pitch-allocation/geometry"
import { Check, DoorOpen, Dumbbell, GripVertical, Lock, Sparkles, TriangleAlert, Users } from "../../components/icons"
import { TOUCH_TARGET, colour, eventTone, radius, space, type } from "../../design/tokens"
import { BOARD_TEXT_CAP, COLUMN_HYSTERESIS, ColumnHeader, DropPill, LIFT, StateTag, TimeGrid, TimeRail, VenueBand, edgeVelocity, textWidth, useEdgeScroll, useLift } from "./board-kit"
import { changeFor, plannedParts, savedParts, type Allocatable, type PlannedChange } from "./plan"
import { roomLock, roomPart, roomUse, type Clash, type Occupancy, type RoomRole } from "./rules"
import type { DayPlanner } from "./use-day-planner"
import { boardLabel, boardOpponent } from "./words"

/**
 * THE CHANGING ROOMS BOARD -- the same day, the same plan, seen by room.
 *
 * Time runs down the left exactly as on the Pitches board; the club's changing rooms run across, grouped under
 * their venue. Every use of a room is a card that says WHO is in it and AS WHAT -- a match's home side, its
 * visitors, its officials, or a training group -- for the time they hold it, with the turnaround after it drawn
 * quietly. A room that is switched off stands in its place, hatched, saying so, so "why is there no room" is
 * answered on the board.
 *
 * WHAT STILL NEEDS A ROOM sits at the foot: a home side, the visitors, a training group that asked for one. Each
 * piece is carried onto a room, or tapped for the allocation in words. Moving a card to another room is the same.
 * It is ONE plan with the Pitches board: a room given here is there before Save, a pitch moved there brings its
 * rooms here, Auto Allocate proposes both, and the one save bar saves both. One team per room: the board refuses,
 * calmly and in place, a room somebody already holds (or is still being turned round from).
 */

/** One readable room column: a team's compact name and its times on two lines. */
const ROOM_WIDTH = 116
const ROOM_GAP = 8

type Col = { room: ArenaRoom; left: number; width: number }
type Use = { key: string; a: Allocatable; side: RoomRole; roomId: string; from: number; until: number; turn: number; locked: boolean }
type Demand = { key: string; a: Allocatable; side: RoomRole }
type Preview = { use: Demand; roomId: string | null; clash: Clash | null; low: boolean; from: number; until: number }
type Flash = { title: string; reason?: string; tone: "ok" | "refused" | "plain"; low: boolean }

const SIDE_WORD: Record<RoomRole, string> = { HOME: "Home", AWAY: "Away", OFFICIALS: "Officials", TRAINING: "Training" }
const DEMAND_WORD: Record<RoomRole, string> = { HOME: "Needs home room", AWAY: "Needs away room", OFFICIALS: "Needs officials room", TRAINING: "Room requested" }
/** The word for who a room is held for, as the board and VoiceOver say it. */
export const sideWord = (side: RoomRole) => SIDE_WORD[side]
/** What a waiting piece is waiting for. */
const demandWords = (d: Demand) => DEMAND_WORD[d.side]

export function RoomBoard({ day, planner, venueId, canManage, reduceMotion, nowMinute, scale, onOpen, onAllocate, onAuto, autoBusy }: {
  day: ArenaDay
  planner: DayPlanner
  venueId: string | null
  canManage: boolean
  reduceMotion: boolean
  nowMinute: number | null
  scale: BoardScale
  onOpen: (a: ArenaActivity) => void
  onAllocate: (a: Allocatable) => void
  onAuto: (rerun: boolean) => void
  autoBusy: boolean
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
  const dropOk = useSharedValue(0)
  const hRef = useRef<Animated.ScrollView>(null)
  const vRef = useRef<Animated.ScrollView>(null)
  const rootRef = useRef<View>(null)
  const hViewportRef = useRef<View>(null)
  const vViewportRef = useRef<View>(null)
  const trayRef = useRef<View>(null)
  const viewport = useRef({ x: 0, y: 0, width: 0, height: 0, trayTop: 0 })
  const [viewW, setViewW] = useState(0)
  const [trayH, setTrayH] = useState(0)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [blocked, setBlocked] = useState<Set<string>>(new Set())
  const [flash, setFlash] = useState<Flash | null>(null)
  const [floating, setFloating] = useState<Demand | null>(null)
  const { fontScale } = useWindowDimensions()

  // ------------------------------------------------------------------ what is where
  const activities = useMemo(() => new Map(day.activities.map((a) => [a.id, a])), [day.activities])
  const venueOrder = useMemo(() => new Map(day.venues.map((v, i) => [v.id, v.isDefault ? -1 : i])), [day.venues])
  const rooms = useMemo(() => day.rooms
    .filter((r) => !venueId || r.venueId === venueId)
    .sort((a, b) => (venueOrder.get(a.venueId) ?? 99) - (venueOrder.get(b.venueId) ?? 99) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
  [day.rooms, venueId, venueOrder])
  const roomIds = useMemo(() => new Set(rooms.map((r) => r.id)), [rooms])
  const grouped = !venueId && new Set(rooms.map((r) => r.venueId)).size > 1
  const cols = useMemo(() => {
    let left = 0
    const base: Col[] = rooms.map((room, i) => {
      const venueBreak = i > 0 && rooms[i - 1].venueId !== room.venueId
      left += i === 0 ? 0 : venueBreak ? ROOM_GAP * 2 : ROOM_GAP
      const c = { room, left, width: ROOM_WIDTH }
      left += ROOM_WIDTH
      return c
    })
    const w = left
    if (viewW <= 0 || w === 0 || w >= viewW - space.sm) return base
    const k = Math.min((viewW - space.sm) / w, 2.4)
    return base.map((c) => ({ ...c, left: c.left * k, width: c.width * k }))
  }, [rooms, viewW])
  const width = cols.length === 0 ? 0 : cols[cols.length - 1].left + cols[cols.length - 1].width
  const colById = useMemo(() => new Map(cols.map((c) => [c.room.id, c])), [cols])
  const venueBands = useMemo(() => {
    if (!grouped) return []
    const bands: { venueId: string; name: string; left: number; right: number }[] = []
    for (const c of cols) {
      const last = bands[bands.length - 1]
      if (last && last.venueId === c.room.venueId) last.right = c.left + c.width
      else bands.push({ venueId: c.room.venueId, name: day.venues.find((v) => v.id === c.room.venueId)?.name ?? "Venue", left: c.left, right: c.left + c.width })
    }
    return bands
  }, [grouped, cols, day.venues])

  // EVERY USE OF A ROOM, with the plan laid over it: who, as what, from when, until when, then turned round.
  const uses = useMemo(() => planner.draft
    .filter((o: Occupancy) => o.resourceType === "ROOM" && roomIds.has(o.resourceId) && (o.activityType === "FIXTURE" || o.activityType === "TRAINING"))
    .map((o) => {
      const a = activities.get(o.activityId) as Allocatable | undefined
      if (!a || !o.role) return null
      const side = o.role as RoomRole
      return { key: `${o.activityId}:${side}`, a, side, roomId: o.resourceId, from: o.from, until: o.until, turn: o.turnaroundUntil, locked: a.locks.includes(roomLock(side)) }
    })
    .filter((u): u is Use => !!u), [planner.draft, roomIds, activities])

  // A use's own state: staged or proposed, a clash (the server's, or the plan's own check), locked.
  const states = useMemo(() => {
    const server = new Map<string, string>()
    for (const c of day.conflicts) if (c.resourceType === "ROOM" && c.severity === "hard") for (const id of c.activityIds) if (!server.has(`${id}:${c.resourceId}`)) server.set(`${id}:${c.resourceId}`, c.message)
    const m = new Map<string, { change: PlannedChange | null; moved: boolean; clash: string | null }>()
    for (const u of uses) {
      const change = changeFor(planner.plan, u.a)
      const part = roomPart(u.side)
      const moved = !!change && part in change.set
      const clash = moved ? planner.roomClashAt(u.a, u.side, u.roomId)?.message ?? null : change ? null : server.get(`${u.a.id}:${u.roomId}`) ?? null
      m.set(u.key, { change: moved ? change : null, moved, clash })
    }
    return m
  }, [uses, day.conflicts, planner.plan, planner.roomClashAt])

  // WHAT STILL NEEDS A ROOM, at this venue (or not yet anywhere), in time order.
  const demand = useMemo(() => {
    const list: Demand[] = []
    for (const a of day.activities) {
      if (!((a.kind === "FIXTURE" && a.home) || a.kind === "TRAINING")) continue
      const v = plannedParts(planner.plan, a).venueId
      if (venueId && v && v !== venueId) continue
      for (const side of planner.roomsWanted(a)) list.push({ key: `${a.id}:${side}`, a, side })
    }
    const at = (d: Demand) => roomUse(day, planner.plan, d.a, d.side)?.from ?? 9999
    const order: Record<RoomRole, number> = { HOME: 0, TRAINING: 0, AWAY: 1, OFFICIALS: 2 }
    return list.sort((x, y) => at(x) - at(y) || order[x.side] - order[y.side])
  }, [day, venueId, planner])
  const requested = useMemo(() => day.activities.some((a) => (a.kind === "TRAINING" && a.needsRoom) || (a.kind === "FIXTURE" && a.home && !a.noChangingRooms)), [day.activities])

  // ------------------------------------------------------------------ the frozen header and scrolling
  const fs = Math.min(Math.max(fontScale, 1), BOARD_TEXT_CAP)
  const today = nowMinute !== null
  const bandH = venueBands.length === 0 ? 0 : Math.ceil((venueBands.some((b) => textWidth(b.name, 11 * fs) + space.lg > b.right - b.left) ? 30 : 20) * Math.min(fs, 1.1))
  const nameLines = rooms.some((r) => textWidth(r.name, 13 * fs) > (colById.get(r.id)?.width ?? 116) - space.lg) ? 2 : 1
  const headerH = Math.ceil(bandH + 10 + (nameLines * 16 + 14 + (today ? 15 : 0)) * fs + 6)
  const onH = useAnimatedScrollHandler({ onScroll: (e) => { scrollX.value = e.contentOffset.x } })
  const onV = useAnimatedScrollHandler({ onScroll: (e) => { scrollY.value = e.contentOffset.y } })
  const headerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -scrollX.value }] }))
  const measure = useCallback(() => {
    hViewportRef.current?.measureInWindow((x, _y, w) => { viewport.current.x = x; viewport.current.width = w })
    vViewportRef.current?.measureInWindow((_x, y, _w, h) => { viewport.current.y = y; viewport.current.height = h })
    trayRef.current?.measureInWindow((_x, y) => { viewport.current.trayTop = y })
    rootRef.current?.measureInWindow((x, y) => { rootX.value = x; rootY.value = y })
  }, [rootX, rootY])
  const evaluateRef = useRef<() => void>(() => {})
  const setAutoScroll = useEdgeScroll(hRef, vRef, scrollX, scrollY, evaluateRef)

  // Open on the first thing that needs a room, else the first room in use, else the morning.
  const openedScope = useRef<string | null>(null)
  const pending = useRef<number | null>(null)
  const scope = `${day.date}|${rooms.map((r) => r.id).join(",")}|${scale}|${viewW > 0 ? "m" : "-"}`
  useEffect(() => {
    if (openedScope.current === scope) return
    openedScope.current = scope
    const firstNeed = demand.map((d) => roomUse(day, planner.plan, d.a, d.side)?.from ?? null).find((m) => m !== null) ?? null
    const firstUse = uses.length > 0 ? Math.min(...uses.map((u) => u.from)) : null
    const at = nowMinute ?? firstNeed ?? firstUse ?? 9 * 60
    const y = Math.max(0, minutesToY(Math.max(at, START_MINUTES), scale) - px * 2)
    pending.current = y
    setTimeout(() => { vRef.current?.scrollTo({ y, animated: false }) }, 250)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as the day opens
  }, [scope])
  const onContentSize = useCallback(() => {
    if (pending.current === null) return
    vRef.current?.scrollTo({ y: pending.current, animated: false })
    pending.current = null
  }, [])

  // ------------------------------------------------------------------ moving a room use, or placing a piece
  const planRef = useRef(planner.plan); planRef.current = planner.plan
  const latest = useRef<Preview | null>(null)
  const last = useRef<string | null>(null)
  const held = useRef<{ d: Demand; absX: number; absY: number; grabDx: number } | null>(null)
  const was = useRef<string | null>(null)
  const update = useCallback((d: Demand, contentX: number, absX: number, absY: number) => {
    const o = viewport.current
    const visibleBottom = o.trayTop > o.y ? o.trayTop : o.y + o.height
    const overBoard = absX >= o.x && absX <= o.x + o.width && absY >= o.y && absY <= visibleBottom
    setAutoScroll(overBoard ? edgeVelocity(absX - o.x, o.width) : 0, 0)
    let col = overBoard ? cols.find((c, i) => contentX >= c.left && contentX < (i + 1 < cols.length ? cols[i + 1].left : c.left + c.width + ROOM_GAP)) ?? null : null
    if (col && was.current && col.room.id !== was.current) {
      const inside = contentX >= col.left + COLUMN_HYSTERESIS && contentX <= col.left + col.width - COLUMN_HYSTERESIS
      if (!inside) col = colById.get(was.current) ?? col
    }
    if (col) was.current = col.room.id
    const low = absY < o.y + (visibleBottom - o.y) / 2
    const key = `${col?.room.id ?? "-"}:${low ? "l" : "h"}`
    if (key === last.current) return
    const changed = (last.current ?? "-").split(":")[0] !== (col?.room.id ?? "-")
    last.current = key
    if (blocked.size === 0) setBlocked(new Set(rooms.filter((r) => !r.active || planner.roomClashAt(d.a, d.side, r.id) !== null).map((r) => r.id)))
    const clash = col ? (col.room.active ? planner.roomClashAt(d.a, d.side, col.room.id) : { code: "ROOM_INACTIVE", severity: "hard", message: `${col.room.name} is switched off.`, short: { title: `${col.room.name} unavailable`, reason: "Switched off" } } as Clash) : null
    const w = roomUse(day, planner.plan, d.a, d.side)
    const next: Preview = { use: d, roomId: col?.room.id ?? null, clash, low, from: w?.from ?? 0, until: w?.until ?? 0 }
    latest.current = next
    dropOk.value = col && !clash ? 1 : 0
    setPreview(next)
    if (col && changed) void (clash ? haptic.refuse() : haptic.snap())
  }, [cols, colById, rooms, planner, day, setAutoScroll, blocked.size, dropOk])
  const say = useCallback((m: string) => AccessibilityInfo.announceForAccessibility(m), [])
  const end = useCallback((d: Demand, dropped: boolean) => {
    setAutoScroll(0, 0)
    const p = latest.current && latest.current.use.key === d.key ? latest.current : null
    latest.current = null
    last.current = null
    was.current = null
    held.current = null
    setPreview(null)
    setBlocked(new Set())
    setFloating(null)
    if (!dropped || !p || !p.roomId) return
    if (p.clash) {
      void haptic.refuse()
      setFlash({ title: `Not moved. ${p.clash.short.title}`, reason: p.clash.short.reason, tone: "refused", low: p.low })
      say(`Not moved. ${p.clash.short.title}: ${p.clash.short.reason}.`)
      return
    }
    void haptic.staged()
    planner.assignRoom(d.a, d.side, p.roomId)
    const room = rooms.find((r) => r.id === p.roomId)?.name ?? "the room"
    const home = savedParts(d.a)[roomPart(d.side)] === p.roomId
    const who = `${boardLabel(d.a)} (${sideWord(d.side).toLowerCase()})`
    setFlash({ title: home ? `${who} is back in ${room}` : `${who} to ${room}`, reason: home ? undefined : "Not saved yet", tone: "ok", low: p.low })
    say(home ? `${who} is back in ${room}.` : `${who} moved to ${room}. Not saved yet.`)
  }, [planner, rooms, setAutoScroll, say])
  useEffect(() => {
    if (!flash) return
    const id = setTimeout(() => setFlash(null), 3400)
    return () => clearTimeout(id)
  }, [flash])
  const updateRef = useRef(update); updateRef.current = update
  const endRef = useRef(end); endRef.current = end
  const contentX = useCallback((absX: number) => absX - viewport.current.x + scrollX.value, [scrollX])
  evaluateRef.current = () => {
    const h = held.current
    if (h) updateRef.current(h.d, contentX(h.absX) + h.grabDx, h.absX, h.absY)
  }
  const onUseLift = useCallback((d: Demand, anchorX: number, absX: number, absY: number) => {
    measure()
    was.current = plannedParts(planRef.current, d.a)[roomPart(d.side)]
    held.current = { d, absX, absY, grabDx: anchorX - contentX(absX) }
    evaluateRef.current()
  }, [measure, contentX])
  const onUseDrag = useCallback((d: Demand, absX: number, absY: number) => {
    held.current = { d, absX, absY, grabDx: held.current?.grabDx ?? 0 }
    evaluateRef.current()
  }, [])
  const onUseEnd = useCallback((d: Demand, dropped: boolean) => endRef.current(d, dropped), [])
  const onPieceLift = useCallback((d: Demand) => {
    measure()
    was.current = null
    held.current = null
    setFloating(d)
    const w = roomUse(day, planRef.current, d.a, d.side)
    if (w) vRef.current?.scrollTo({ y: Math.max(0, minutesToY(Math.max(w.from, START_MINUTES), scale) - px * 3), animated: !reduceMotion })
  }, [measure, day, scale, px, reduceMotion])
  const onPieceDrag = useCallback((d: Demand, absX: number, absY: number) => {
    held.current = { d, absX, absY: absY - LIFT, grabDx: 0 }
    evaluateRef.current()
  }, [])
  const ghostStyle = useAnimatedStyle(() => ({
    opacity: ghostOn.value,
    transform: [{ translateX: ghostX.value - 112 }, { translateY: ghostY.value - 28 }, { scale: 0.96 + ghostOn.value * 0.04 }],
  }))

  const preferLow = preview ? preview.low : flash ? flash.low : false
  const pillAt = preferLow ? { bottom: trayH + space.sm } : { top: headerH + space.sm }
  const dirty = planner.counts.total > 0 || planner.auto.state === "proposed"

  return (
    <View ref={rootRef} style={{ flex: 1, backgroundColor: colour.surface }} onLayout={measure}>
      {/* THE ROOMS, frozen across the top, under their venue */}
      <View style={{ flexDirection: "row", height: headerH, borderBottomWidth: 1, borderBottomColor: colour.lineStrong, backgroundColor: colour.surface }}>
        <View style={{ width: TIME_AXIS_WIDTH, borderRightWidth: 1, borderRightColor: colour.line, backgroundColor: colour.chalk }} />
        <View style={{ flex: 1, overflow: "hidden" }}>
          <Animated.View style={[{ width: Math.max(width, 1), height: headerH }, headerStyle]}>
            {venueBands.map((b) => <VenueBand key={b.venueId} band={b} height={bandH} scrollX={scrollX} />)}
            {cols.map((c, i) => {
              const isTarget = preview?.roomId === c.room.id
              const dim = !!preview && blocked.has(c.room.id) && !isTarget
              const inUse = nowMinute !== null && c.room.active ? uses.some((u) => u.roomId === c.room.id && u.from <= nowMinute && nowMinute < u.turn) : null
              const meta = !c.room.active ? "Switched off" : c.room.roomType === "match_officials" ? "Officials" : c.room.roomType === "smaller" ? "Smaller room" : "Team room"
              return (
                <View key={c.room.id} accessible accessibilityRole="header" accessibilityLabel={`${c.room.name}, ${meta}${inUse === null ? "" : inUse ? ", in use now" : ", free now"}`}
                  style={{ position: "absolute", left: c.left - (i > 0 ? 4 : 0), width: c.width + (i > 0 ? 4 : 0), top: bandH, bottom: 0, paddingTop: 10, paddingHorizontal: space.sm, borderLeftWidth: i > 0 ? 1 : 0, borderLeftColor: colour.line, backgroundColor: isTarget ? (preview?.clash ? colour.warningSurface : colour.mint100) : "transparent", opacity: dim ? 0.38 : 1 }}>
                  <ColumnHeader name={c.room.name} meta={meta} now={inUse} />
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
            <View ref={hViewportRef} style={{ flex: 1, overflow: "hidden" }} onLayout={(e) => { setViewW(e.nativeEvent.layout.width); measure() }}>
              <Animated.ScrollView ref={hRef} horizontal onScroll={onH} scrollEventThrottle={16} showsHorizontalScrollIndicator={false}>
                <View style={{ width: Math.max(width + space.sm, 1), height }}>
                  <TimeGrid scale={scale} width={width + space.sm} nowMinute={nowMinute} />
                  {cols.map((c, i) => {
                    const isTarget = preview?.roomId === c.room.id
                    const dim = !!preview && blocked.has(c.room.id) && !isTarget
                    return (
                      <View key={c.room.id} pointerEvents="none" style={{ position: "absolute", top: 0, height, left: c.left - (i > 0 ? 4 : 0), width: c.width + (i > 0 ? 4 : 0), borderLeftWidth: i > 0 ? 1 : 0, borderLeftColor: colour.line, backgroundColor: isTarget ? (preview?.clash ? "rgba(253,246,231,0.9)" : "rgba(220,247,229,0.75)") : dim ? "rgba(16,21,18,0.075)" : preview ? "rgba(220,247,229,0.22)" : "transparent" }} />
                    )
                  })}
                  {/* A ROOM THAT IS SWITCHED OFF stands in its place, hatched, all day: nothing can be put in it. */}
                  {cols.filter((c) => !c.room.active).map((c) => <OffRoom key={c.room.id} col={c} height={height} />)}

                  {preview?.roomId && (() => {
                    const c = colById.get(preview.roomId)
                    if (!c) return null
                    return (
                      <View pointerEvents="none" style={{ position: "absolute", left: c.left + 3, width: c.width - 6, top: minutesToY(Math.max(preview.from, START_MINUTES), scale), height: heightForMinutes(preview.until - Math.max(preview.from, START_MINUTES), scale), borderRadius: radius.md, borderWidth: 2, borderColor: preview.clash ? colour.warning : colour.pitch600, backgroundColor: preview.clash ? "rgba(253,246,231,0.7)" : "rgba(50,166,101,0.14)", alignItems: "center", justifyContent: "center" }}>
                        <Text maxFontSizeMultiplier={BOARD_TEXT_CAP} style={[type.caption, { color: preview.clash ? colour.warning : colour.forest800, fontFamily: type.smallMedium.fontFamily, fontSize: 11 }]}>{preview.clash ? "Unavailable" : `${clock(preview.from)}–${clock(preview.until)}`}</Text>
                      </View>
                    )
                  })()}

                  {uses.map((u) => {
                    const c = colById.get(u.roomId)
                    if (!c) return null
                    return (
                      <UseCard key={u.key} use={u} col={c} scale={scale} state={states.get(u.key) ?? { change: null, moved: false, clash: null }} canManage={canManage} reduceMotion={reduceMotion}
                        dragging={preview?.use.key === u.key} scrollX={scrollX} scrollY={scrollY} dropOk={dropOk} onOpen={onOpen} onAllocate={onAllocate} onLift={onUseLift} onDrag={onUseDrag} onEnd={onUseEnd} />
                    )
                  })}
                </View>
              </Animated.ScrollView>
              {cols.length === 0 && (
                <View style={{ position: "absolute", top: space.lg, left: space.md, right: space.md }}>
                  <Text style={[type.small, { color: colour.inkMuted }]}>No changing rooms are set up at this venue. Add them in Venues.</Text>
                </View>
              )}
            </View>
          </View>
        </Animated.ScrollView>
      </View>

      {preview ? (
        preview.roomId ? (
          preview.clash
            ? <DropPill {...pillAt} tone="refused" title={preview.clash.short.title} lines={[preview.clash.short.reason]} />
            : <DropPill {...pillAt} tone="plain" title={`${colById.get(preview.roomId)?.room.name ?? "Room"} · ${clock(preview.from)}–${clock(preview.until)}`} lines={[`${boardLabel(preview.use.a)} (${sideWord(preview.use.side).toLowerCase()})`]} />
        ) : <DropPill {...pillAt} tone="plain" title="Drag onto a room, or let go here to cancel." />
      ) : flash ? <DropPill {...pillAt} tone={flash.tone} title={flash.title} lines={flash.reason ? [flash.reason] : []} /> : null}

      <View ref={trayRef} collapsable={false} onLayout={(e) => { setTrayH(e.nativeEvent.layout.height); measure() }} pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
        <DemandTray demand={demand} day={day} plan={planner.plan} requested={requested} dirty={dirty} canManage={canManage} reduceMotion={reduceMotion} autoBusy={autoBusy}
          proposing={planner.auto.state === "proposed"} floatingKey={floating?.key ?? null} rootX={rootX} rootY={rootY} ghostX={ghostX} ghostY={ghostY} ghostOn={ghostOn}
          onAuto={onAuto} onAllocate={onAllocate} onLift={onPieceLift} onDrag={onPieceDrag} onEnd={onUseEnd} />
      </View>

      <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0, width: 224 }, ghostStyle]}>
        {floating && <DemandPiece d={floating} day={day} plan={planner.plan} draggable lifted />}
      </Animated.View>
    </View>
  )
}

/** A switched-off room, hatched down its whole column, saying so. */
function OffRoom({ col: c, height }: { col: Col; height: number }) {
  const id = `off-${c.room.id.replace(/[^a-zA-Z0-9]/g, "")}`
  return (
    <View pointerEvents="none" accessible accessibilityLabel={`${c.room.name} is switched off`} style={{ position: "absolute", left: c.left + 2, width: c.width - 4, top: 0, height, backgroundColor: "rgba(16,21,18,0.035)" }}>
      <Svg key={`${Math.round(c.width)}x${Math.round(height)}`} width={Math.max(c.width - 4, 1)} height={height} style={{ position: "absolute", left: 0, top: 0 }}>
        <Defs>
          <Pattern id={id} width={12} height={12} patternUnits="userSpaceOnUse">
            <Path d="M0,12 L12,0 M-3,3 L3,-3 M9,15 L15,9" stroke="rgba(16,21,18,0.07)" strokeWidth={2} />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width={Math.max(c.width - 4, 1)} height={height} fill={`url(#${id})`} />
      </Svg>
    </View>
  )
}

/**
 * ONE USE OF A ROOM: who is in it and as what, for the time they hold it, then a quiet tail while it is turned
 * round. A match's side is forest, a training group the training blue -- the same fills as the Pitches board -- and
 * the role is a word ("Home", "Away", "Officials", "Training"), never a colour to learn.
 */
const UseCard = memo(function UseCard({ use: u, col, scale, state, canManage, reduceMotion, dragging, scrollX, scrollY, dropOk, onOpen, onAllocate, onLift, onDrag, onEnd }: {
  use: Use
  col: Col
  scale: BoardScale
  state: { change: PlannedChange | null; moved: boolean; clash: string | null }
  canManage: boolean
  reduceMotion: boolean
  dragging: boolean
  scrollX: SharedValue<number>
  scrollY: SharedValue<number>
  dropOk: SharedValue<number>
  onOpen: (a: ArenaActivity) => void
  onAllocate: (a: Allocatable) => void
  onLift: (d: Demand, anchorX: number, absX: number, absY: number) => void
  onDrag: (d: Demand, absX: number, absY: number) => void
  onEnd: (d: Demand, dropped: boolean) => void
}) {
  const top = minutesToY(Math.max(u.from, START_MINUTES), scale)
  const inH = heightForMinutes(u.until - Math.max(u.from, START_MINUTES), scale)
  const turnH = heightForMinutes(Math.max(u.turn - u.until, 0), scale)
  const d: Demand = useMemo(() => ({ key: u.key, a: u.a, side: u.side }), [u.key, u.a, u.side])
  const lift = useCallback((ax: number, ay: number) => onLift(d, col.left + col.width / 2, ax, ay), [onLift, d, col.left, col.width])
  const drag = useCallback((ax: number, ay: number) => onDrag(d, ax, ay), [onDrag, d])
  const end = useCallback((dropped: boolean) => onEnd(d, dropped), [onEnd, d])
  // A room use changes room, never time: its time is the activity's own.
  const { pan, style } = useLift(canManage, reduceMotion, true, { left: col.left, top }, scrollX, scrollY, dropOk, lift, drag, end)
  const training = u.a.kind === "TRAINING"
  const fixture = u.a.kind === "FIXTURE" ? u.a : null
  const who = training
    ? (u.a.team ? teamShort(u.a.team) : u.a.kind === "TRAINING" ? u.a.groupLabel ?? "Team" : "Team")
    : u.side === "AWAY" ? boardOpponent(fixture!.opponentName) : u.side === "OFFICIALS" ? `${teamShort(fixture!.team)} v ${boardOpponent(fixture!.opponentName)}` : teamShort(fixture!.team)
  // The role line already says "Officials": its card names the match, once.
  const sub = training || u.side === "OFFICIALS" ? null : u.side === "HOME" ? `v ${boardOpponent(fixture!.opponentName)}` : `${teamShort(fixture!.team)} v ${boardOpponent(fixture!.opponentName)}`
  const auto = state.change?.origin === "AUTO"
  const staged = state.moved
  const edge = state.clash ? { color: colour.danger, dashed: false } : staged ? { color: auto ? colour.pitch400 : colour.pitch600, dashed: true } : null
  const tone = training ? eventTone.training : null
  const ink = training ? eventTone.training.text : colour.onForest
  const soft = training ? eventTone.training.text : colour.mint300
  const narrow = col.width < 96
  const label = [
    `${sideWord(u.side)}: ${training ? `${activityTitle(u.a)}` : u.side === "HOME" ? `${fixture!.team?.displayName ?? who}, home side of ${activityTitle(u.a)}` : u.side === "AWAY" ? `${fixture!.opponentName}, away side of ${activityTitle(u.a)}` : `match officials for ${activityTitle(u.a)}`}.`,
    `${col.room.name}, ${clock(u.from)} to ${clock(u.until)}${u.turn > u.until ? `, then turned round until ${clock(u.turn)}` : ""}.`,
    u.locked ? "Locked." : null,
    staged ? (auto ? "Proposed by Ovalball, not saved yet." : "Moved, not saved yet.") : null,
    state.clash ? `Clash: ${state.clash}` : null,
  ].filter(Boolean).join(" ")
  return (
    <>
      {dragging && <View pointerEvents="none" style={{ position: "absolute", left: col.left + 3, top, width: col.width - 6, height: inH, borderRadius: radius.md, borderWidth: 1, borderColor: "rgba(18,61,44,0.25)", backgroundColor: "rgba(18,61,44,0.06)" }} />}
      {turnH > 0 && (
        <View pointerEvents="none" style={{ position: "absolute", left: col.left + 6, top: top + inH, width: col.width - 12, height: turnH, borderBottomLeftRadius: radius.sm, borderBottomRightRadius: radius.sm, backgroundColor: "rgba(16,21,18,0.045)", borderWidth: 1, borderTopWidth: 0, borderColor: "rgba(16,21,18,0.08)", justifyContent: "center", paddingHorizontal: 6 }}>
          {turnH >= 18 && !narrow && <Text maxFontSizeMultiplier={1} style={[type.caption, { fontSize: 10, lineHeight: 12, color: colour.inkSubtle }]} numberOfLines={1}>Turnaround</Text>}
        </View>
      )}
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ position: "absolute", left: col.left + 3, top, width: col.width - 6, height: Math.max(inH, 30), shadowColor: colour.forest950, shadowOffset: { width: 0, height: 4 } }, style]}>
          <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={canManage ? "Double tap for the whole allocation. Press and hold to move it to another room." : "Double tap for the whole allocation."}
            accessibilityActions={canManage ? [{ name: "activate", label: "Details" }, { name: "allocate", label: "Allocate" }] : [{ name: "activate", label: "Details" }]}
            onAccessibilityAction={(e: AccessibilityActionEvent) => { if (e.nativeEvent.actionName === "allocate") onAllocate(u.a); else onOpen(u.a) }}
            onPress={() => onOpen(u.a)}
            style={{ flex: 1, borderRadius: radius.md, overflow: "hidden", backgroundColor: tone ? tone.surface : colour.forest800, borderWidth: edge ? 2 : 0, borderColor: edge?.color ?? "transparent", borderStyle: edge?.dashed ? "dashed" : "solid", paddingLeft: training ? 9 : 7, paddingRight: 6, paddingVertical: 5, gap: 1 }}>
            {training && <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, backgroundColor: eventTone.training.accent }} />}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              {training ? <Dumbbell size={10} color={soft} /> : u.side === "OFFICIALS" ? <Users size={10} color={soft} /> : <DoorOpen size={10} color={soft} />}
              <Text maxFontSizeMultiplier={1} style={[type.caption, { color: soft, fontSize: 10, lineHeight: 12, fontFamily: type.heading.fontFamily, letterSpacing: 0.3, flex: 1 }]} numberOfLines={1}>{sideWord(u.side)}</Text>
              {state.clash && <TriangleAlert size={11} color={training ? colour.danger : "#ffb4ae"} />}
              {u.locked && <Lock size={10} color={ink} />}
            </View>
            <Text maxFontSizeMultiplier={BOARD_TEXT_CAP} style={[type.smallMedium, { color: ink, fontFamily: type.heading.fontFamily, fontSize: narrow ? 12 : 13, lineHeight: narrow ? 15 : 16 }]} numberOfLines={inH >= 70 ? 2 : 1}>{who}</Text>
            {sub && inH >= 64 && <Text maxFontSizeMultiplier={BOARD_TEXT_CAP} style={[type.caption, { color: training ? ink : "rgba(255,255,255,0.82)", fontSize: 11, lineHeight: 14 }]} numberOfLines={1}>{sub}</Text>}
            {inH >= 48 && <Text maxFontSizeMultiplier={BOARD_TEXT_CAP} style={[type.caption, { color: soft, fontSize: 11.5, lineHeight: 14, fontFamily: type.smallMedium.fontFamily, fontVariant: ["tabular-nums"] }]} numberOfLines={1}>{`${clock(u.from)}–${clock(u.until)}`}</Text>}
            {staged && inH >= 88 && <View style={{ alignSelf: "flex-start", marginTop: 2 }}><StateTag kind={auto ? "auto" : "unsaved"} /></View>}
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </>
  )
})

/** A piece of room demand: who, as what, when -- drawn in the fill of what it is (forest match, blue training). */
function DemandPiece({ d, day, plan, draggable, lifted }: { d: Demand; day: ArenaDay; plan: import("./plan").Plan; draggable: boolean; lifted?: boolean }) {
  const training = d.a.kind === "TRAINING"
  const w = roomUse(day, plan, d.a, d.side)
  const when = w ? `${clock(w.from)}–${clock(w.until)}` : "No time yet"
  const ink = training ? eventTone.training.text : colour.onForest
  const sub = training ? eventTone.training.text : colour.mint300
  return (
    <View style={{ minHeight: 50, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: draggable ? 4 : space.sm, paddingRight: space.sm, paddingVertical: 6, borderRadius: radius.md, backgroundColor: training ? eventTone.training.surface : colour.forest800, borderWidth: 1, borderColor: training ? "rgba(47,93,140,0.35)" : "rgba(145,227,172,0.35)", ...(lifted ? { shadowColor: colour.forest950, shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 14 } : null) }}>
      {draggable ? <GripVertical size={16} color={training ? "rgba(47,93,140,0.65)" : "rgba(255,255,255,0.6)"} /> : <DoorOpen size={15} color={sub} />}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text maxFontSizeMultiplier={1.3} style={[type.smallMedium, { color: ink, fontFamily: type.heading.fontFamily, fontSize: 13, lineHeight: 16 }]} numberOfLines={2}>{boardLabel(d.a)}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Text maxFontSizeMultiplier={1.3} style={[type.caption, { color: sub, fontFamily: type.smallMedium.fontFamily, fontVariant: ["tabular-nums"] }]}>{when}</Text>
          <View style={{ paddingHorizontal: 6, minHeight: 18, justifyContent: "center", borderRadius: 9, backgroundColor: colour.warningSurface }}>
            <Text maxFontSizeMultiplier={1.2} style={[type.caption, { color: colour.warning, fontSize: 11, lineHeight: 13, fontFamily: type.smallMedium.fontFamily }]} numberOfLines={1}>{demandWords(d)}</Text>
          </View>
        </View>
      </View>
    </View>
  )
}

/**
 * NEEDS A ROOM -- the room demand, attached to the foot of the board: how many, Auto Allocate as the easy way to
 * place it (rooms and pitches together, one proposal), and the pieces to place by hand. While there are unsaved
 * changes the save bar is the one action, so this folds to the pieces. With nothing waiting it is one quiet line.
 */
function DemandTray({ demand, day, plan, requested, dirty, canManage, reduceMotion, autoBusy, proposing, floatingKey, rootX, rootY, ghostX, ghostY, ghostOn, onAuto, onAllocate, onLift, onDrag, onEnd }: {
  demand: Demand[]
  day: ArenaDay
  plan: import("./plan").Plan
  requested: boolean
  dirty: boolean
  canManage: boolean
  reduceMotion: boolean
  autoBusy: boolean
  proposing: boolean
  floatingKey: string | null
  rootX: SharedValue<number>
  rootY: SharedValue<number>
  ghostX: SharedValue<number>
  ghostY: SharedValue<number>
  ghostOn: SharedValue<number>
  onAuto: (rerun: boolean) => void
  onAllocate: (a: Allocatable) => void
  onLift: (d: Demand) => void
  onDrag: (d: Demand, absX: number, absY: number) => void
  onEnd: (d: Demand, dropped: boolean) => void
}) {
  const n = demand.length
  const ground = { backgroundColor: colour.chalk, borderTopWidth: 1, borderTopColor: colour.lineStrong }
  if (n === 0) {
    if (dirty) return null
    return (
      <View style={{ ...ground, minHeight: 40, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md }}>
        {requested && <Check size={15} color={colour.pitch600} />}
        <Text maxFontSizeMultiplier={1.6} style={[type.small, { color: colour.inkMuted, flex: 1 }]}>{requested ? "Everyone who needs a room has one" : "No changing rooms needed on this day"}</Text>
      </View>
    )
  }
  const pieces = demand.map((d) => (
    <DemandPieceHandle key={d.key} d={d} day={day} plan={plan} canManage={canManage} reduceMotion={reduceMotion} lifted={floatingKey === d.key} alone={n === 1}
      rootX={rootX} rootY={rootY} ghostX={ghostX} ghostY={ghostY} ghostOn={ghostOn} onAllocate={onAllocate} onLift={onLift} onDrag={onDrag} onEnd={onEnd} />
  ))
  if (dirty) {
    if (proposing) return null
    return (
      <View style={ground}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.sm, alignItems: "center" }}>
          <View accessible accessibilityLabel={`Needs a room: ${n}`} style={{ paddingRight: 2, gap: 2 }}>
            <Text maxFontSizeMultiplier={1.4} style={[type.caption, { color: colour.ink, fontFamily: type.heading.fontFamily }]}>Needs a Room</Text>
            <Text maxFontSizeMultiplier={1.4} style={[type.caption, { color: colour.warning, fontFamily: type.smallMedium.fontFamily }]}>{`${n} waiting`}</Text>
          </View>
          {pieces}
        </ScrollView>
      </View>
    )
  }
  return (
    <View style={ground}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingLeft: space.md, paddingRight: space.sm, paddingVertical: 4 }}>
        <View accessible accessibilityLabel={`Needs a room: ${n}`} style={{ flex: 1, minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text maxFontSizeMultiplier={1.5} style={[type.smallMedium, { color: colour.ink, fontFamily: type.heading.fontFamily }]}>Needs a Room</Text>
          <View style={{ minWidth: 24, height: 22, paddingHorizontal: 7, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colour.warningSurface, borderWidth: 1, borderColor: "rgba(138,90,0,0.3)" }}>
            <Text maxFontSizeMultiplier={1.4} style={[type.caption, { color: colour.warning, fontFamily: type.heading.fontFamily, fontVariant: ["tabular-nums"] }]}>{n}</Text>
          </View>
        </View>
        {canManage && !proposing && (
          <Pressable accessibilityRole="button" accessibilityLabel="Auto Allocate" accessibilityHint="Ovalball places the day's pitches and changing rooms together, as a proposal on both boards" onPress={() => onAuto(false)} disabled={autoBusy}
            style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: colour.pitch600, opacity: pressed || autoBusy ? 0.8 : 1 })}>
            <Sparkles size={15} color={colour.forest950} />
            <Text maxFontSizeMultiplier={1.4} style={[type.smallMedium, { color: colour.forest950, fontFamily: type.heading.fontFamily }]}>{autoBusy ? "Working…" : "Auto Allocate"}</Text>
          </Pressable>
        )}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.md, paddingBottom: space.sm + 2, gap: space.sm }}>
        {pieces}
      </ScrollView>
    </View>
  )
}

const DemandPieceHandle = memo(function DemandPieceHandle({ d, day, plan, canManage, reduceMotion, lifted, alone, rootX, rootY, ghostX, ghostY, ghostOn, onAllocate, onLift, onDrag, onEnd }: {
  d: Demand
  day: ArenaDay
  plan: import("./plan").Plan
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
  onLift: (d: Demand) => void
  onDrag: (d: Demand, absX: number, absY: number) => void
  onEnd: (d: Demand, dropped: boolean) => void
}) {
  // Carried onto a room only when it has a time to hold the room for.
  const draggable = canManage && roomUse(day, plan, d.a, d.side) !== null
  const pan = useMemo(() => Gesture.Pan()
    .enabled(draggable)
    .activateAfterLongPress(350)
    .onStart((e) => {
      ghostX.value = e.absoluteX - rootX.value
      ghostY.value = e.absoluteY - rootY.value - LIFT
      ghostOn.value = reduceMotion ? 1 : withSpring(1, { damping: 18, stiffness: 240 })
      runOnJS(haptic.lift)()
      runOnJS(onLift)(d)
      runOnJS(onDrag)(d, e.absoluteX, e.absoluteY)
    })
    .onUpdate((e) => {
      ghostX.value = e.absoluteX - rootX.value
      ghostY.value = e.absoluteY - rootY.value - LIFT
      runOnJS(onDrag)(d, e.absoluteX, e.absoluteY)
    })
    .onEnd(() => { runOnJS(onEnd)(d, true) })
    .onFinalize((_e, success) => {
      if (!success) runOnJS(onEnd)(d, false)
      ghostOn.value = reduceMotion ? 0 : withTiming(0, { duration: 140 })
    }), [draggable, reduceMotion, d, onLift, onDrag, onEnd, rootX, rootY, ghostX, ghostY, ghostOn])
  const w = roomUse(day, plan, d.a, d.side)
  return (
    <GestureDetector gesture={pan}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${activityTitle(d.a)}. ${demandWords(d)}${w ? `, ${clock(w.from)} to ${clock(w.until)}` : ""}.`}
        accessibilityHint={canManage ? `Double tap to allocate.${draggable ? " Press and hold to carry it onto a room." : ""}` : undefined}
        onPress={() => onAllocate(d.a)} style={({ pressed }) => ({ width: alone ? 300 : 212, opacity: lifted ? 0.3 : pressed ? 0.85 : 1 })}>
        <DemandPiece d={d} day={day} plan={plan} draggable={draggable} />
      </Pressable>
    </GestureDetector>
  )
})

