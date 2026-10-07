import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pressable, ScrollView, Text, View, type LayoutChangeEvent } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, { runOnJS, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated"

import { assignBookingLanes, fixtureOccupiedWindow, footprintLabel, laneRowCount, matchFootprintFor, physicalSizeCategoryLabel, timeToMinutes, trainingOccupiedWindow, type AllocationConflict, type AllocationFixture, type PitchAllocationBoard } from "@ovalball/contracts/pitch-allocation"

import { haptic } from "./haptics"
import { END_MINUTES, HEADER_HEIGHT, PX_PER_SLOT, START_MINUTES, TIME_AXIS_WIDTH, autoScrollVelocity, boardWidth, heightForMinutes, laneColumns, minutesToTime, minutesToY, timeMarks, timelineHeight, xToLaneColumn, yToSnappedMinutes, type BoardScale, type LaneColumn } from "./geometry"
import { CalendarDays, ChevronDown, ChevronRight, ChevronUp, Clock, LayoutGrid, Shirt, TriangleAlert, Trophy } from "../components/icons"
import { colour, radius, space, type } from "../design/tokens"

/**
 * THE PITCH ALLOCATION BOARD -- a touch-native scheduling board (CA-M11.2).
 *
 * A RESOURCE TIMETABLE: time runs down the left, pitches run across the top (the owner's orientation
 * rule -- "TIME | PITCH 1 | PITCH 2", never times across the top), and every fixture occupies its actual
 * window: the warm-up it reserves, the match itself, the pack-up after. Press and hold a match and it
 * lifts; drag it up or down its column to change its kick-off, across to another pitch to change its
 * pitch, or both at once. Tapping it opens the same move as words and pickers -- a drag is never the
 * only way. While it moves, its buffers move with it, a ghost shows the slot it would snap to, and the
 * strip at the bottom says what that would mean -- including any clash, from the same detectors the
 * website and the server use. Letting go stages the change; nothing is written until Save.
 *
 * PERFORMANCE. The finger drives shared values on the UI thread; React hears from the gesture only
 * when the snapped slot or lane changes, and only then recomputes the preview. Blocks are memoised.
 *
 * READ-ONLY. Without the manage key the gestures are simply not attached: the same board, nothing
 * to grab.
 */

export interface DragPreview {
  fixtureId: string
  pitchId: string | null
  laneIndex: number
  minutes: number
  conflict: AllocationConflict | null
}

export interface BoardProps {
  board: PitchAllocationBoard
  scale: BoardScale
  canManage: boolean
  reduceMotion: boolean
  staged: Set<string>
  todayIso: string
  dateIso: string
  onOpen: (fixture: AllocationFixture) => void
  /** Called on a drop that landed on a lane: stage (the caller decides validity presentation). */
  onDrop: (fixtureId: string, pitchId: string, minutes: number) => void
  /** Preview for the snapped position; returns the conflict, or null when clear. */
  previewFor: (fixtureId: string, pitchId: string, minutes: number) => AllocationConflict | null
  onPreview: (preview: DragPreview | null) => void
  /** The website's reason a fixture still needs a pitch. */
  reasonFor: (fixture: AllocationFixture) => string
  /**
   * EVERYTHING ELSE STILL WAITING, in the same queue: a fixture with its pitch but not its rooms, a session
   * without a pitch. Not dragged (the board moves fixtures across pitches); tapped, it opens its allocation.
   */
  otherNeeds?: QueueNeed[]
}

export interface QueueNeed {
  id: string
  title: string
  /** When, in words: "11:00" or "10:00 – 11:00". */
  when: string
  /** What is still missing: "Needs rooms", "Needs pitch". */
  needs: string
  kind: "FIXTURE" | "TRAINING"
  onPress: () => void
}

type Placed = { fixture: AllocationFixture; col: LaneColumn; start: number; playStart: number; playEnd: number; end: number; conflict: AllocationConflict | null; trainingReason: string | null }

export function PitchBoard({ board, scale, canManage, reduceMotion, staged, todayIso, dateIso, onOpen, onDrop, previewFor, onPreview, reasonFor, otherNeeds = [] }: BoardProps) {
  const px = PX_PER_SLOT[scale]
  const height = timelineHeight(scale)
  const scrollX = useSharedValue(0)
  const scrollY = useSharedValue(0)
  const hRef = useRef<Animated.ScrollView>(null)
  const vRef = useRef<Animated.ScrollView>(null)
  const timelineOrigin = useRef({ x: 0, y: 0, width: 0, height: 0 })
  // THE VIEWPORT, separate from the CONTENT: auto-scroll's "near the edge" is measured against the
  // VISIBLE window -- set synchronously from onLayout, never from a scrolled content view (measuring the
  // whole day's content, or a not-yet-measured {0,0}, is what made a drag scroll away on its own).
  const hViewportRef = useRef<View>(null)
  const vViewportRef = useRef<View>(null)
  const [preview, setPreview] = useState<DragPreview | null>(null)

  // COLUMNS: a pitch with N lanes, or N bookings stacked where only one should be, is N columns.
  const colsByPitch = useMemo(() => {
    const active = board.pitches.filter((p) => p.active)
    const laneByFixture = new Map<string, number>()
    const perPitch = active.map((pitch) => {
      const onPitch = board.fixtures.filter((f) => f.pitchId === pitch.id && f.kickoffTime)
      const lanes = assignBookingLanes(onPitch.map((f) => ({ id: f.fixtureId, startTime: f.kickoffTime!, durationMinutes: f.durationMinutes })))
      for (const [id, lane] of lanes) laneByFixture.set(id, lane)
      return { id: pitch.id, lanes: laneRowCount(pitch.laneCount, lanes), active: true }
    })
    return { cols: laneColumns(perPitch), laneByFixture, pitches: active }
  }, [board.pitches, board.fixtures])
  const cols = colsByPitch.cols
  const width = boardWidth(cols)
  const pitchById = useMemo(() => new Map(board.pitches.map((p) => [p.id, p])), [board.pitches])
  const buffers = { warmUpMinutes: board.policy.warmUpMinutes, packUpMinutes: board.policy.packUpMinutes }
  const conflictById = useMemo(() => new Map(board.conflicts.map((c) => [c.fixtureId, c])), [board.conflicts])
  const trainingReasonById = useMemo(() => new Map(board.fixtureConflictsFromTraining.map((c) => [c.fixtureId, c.reason])), [board.fixtureConflictsFromTraining])
  // A pitch's own span across the board: from its first lane's left edge to its last lane's right edge.
  const pitchSpan = useCallback((pitchId: string | null) => {
    const own = cols.filter((c) => c.pitchId === pitchId)
    if (own.length === 0) return null
    const last = own[own.length - 1]
    return { left: own[0].left, width: last.left + last.width - own[0].left }
  }, [cols])

  const placed: Placed[] = useMemo(() => {
    const out: Placed[] = []
    for (const f of board.fixtures) {
      if (!f.pitchId || !f.kickoffTime) continue
      const lane = colsByPitch.laneByFixture.get(f.fixtureId) ?? 0
      const col = cols.find((c) => c.pitchId === f.pitchId && c.laneIndex === lane) ?? cols.find((c) => c.pitchId === f.pitchId)
      const w = fixtureOccupiedWindow(f, buffers)
      if (!col || !w) continue
      out.push({ fixture: f, col, start: w.start, playStart: w.playStart, playEnd: w.playEnd, end: w.end, conflict: conflictById.get(f.fixtureId) ?? null, trainingReason: trainingReasonById.get(f.fixtureId) ?? null })
    }
    return out
  }, [board.fixtures, cols, colsByPitch.laneByFixture, conflictById, trainingReasonById, buffers.warmUpMinutes, buffers.packUpMinutes])

  const onH = useAnimatedScrollHandler({ onScroll: (e) => { scrollX.value = e.contentOffset.x } })
  const onV = useAnimatedScrollHandler({ onScroll: (e) => { scrollY.value = e.contentOffset.y } })
  // The pitch header moves with the columns; the time axis moves with the hours.
  const headerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -scrollX.value }] }))

  const measureHViewport = useCallback((e: LayoutChangeEvent) => {
    timelineOrigin.current.width = e.nativeEvent.layout.width
    hViewportRef.current?.measureInWindow((x) => { timelineOrigin.current.x = x })
  }, [])
  const measureVViewport = useCallback((e: LayoutChangeEvent) => {
    timelineOrigin.current.height = e.nativeEvent.layout.height
    vViewportRef.current?.measureInWindow((_x, y) => { timelineOrigin.current.y = y })
  }, [])
  // For an item that starts OFF the board (the unallocated tray): its finger position is converted into
  // content space via the (stable) viewport origin, since it has no content-space position of its own.
  const contentFromAbs = useCallback((absX: number, absY: number): [number, number] => {
    const o = timelineOrigin.current
    return [absX - o.x + scrollX.value, absY - o.y + scrollY.value]
  }, [scrollX, scrollY])

  // AUTO-SCROLL while a drag sits near an edge: the content moves, the finger need not.
  const autoScroll = useRef<{ timer: ReturnType<typeof setInterval> | null; vx: number; vy: number }>({ timer: null, vx: 0, vy: 0 })
  const setAutoScroll = useCallback((vx: number, vy: number) => {
    autoScroll.current.vx = vx
    autoScroll.current.vy = vy
    if ((vx !== 0 || vy !== 0) && !autoScroll.current.timer) {
      autoScroll.current.timer = setInterval(() => {
        const { vx: dx, vy: dy } = autoScroll.current
        if (dx !== 0) hRef.current?.scrollTo({ x: Math.max(0, scrollX.value + dx), animated: false })
        if (dy !== 0) vRef.current?.scrollTo({ y: Math.max(0, scrollY.value + dy), animated: false })
      }, 16)
    }
    if (vx === 0 && vy === 0 && autoScroll.current.timer) {
      clearInterval(autoScroll.current.timer)
      autoScroll.current.timer = null
    }
  }, [scrollX, scrollY])
  useEffect(() => () => { if (autoScroll.current.timer) clearInterval(autoScroll.current.timer) }, [])

  // THE PREVIEW is recomputed only when the snapped slot or column changes. `contentX`/`contentY` arrive
  // ALREADY in content space -- each caller computes them from ITS OWN known starting position plus the
  // gesture's own translation, which is exact and needs no absolute-screen measurement. `absX`/`absY`
  // are the finger's raw screen position, used only for auto-scroll.
  const lastKey = useRef<string | null>(null)
  const updatePreview = useCallback((fixtureId: string, contentX: number, contentY: number, absX: number, absY: number) => {
    const o = timelineOrigin.current
    const minutes = yToSnappedMinutes(contentY, scale)
    const col = xToLaneColumn(contentX, cols)
    const key = `${col?.pitchId ?? "-"}:${col?.laneIndex ?? 0}:${minutes}`
    setAutoScroll(autoScrollVelocity(absX - o.x, o.width), autoScrollVelocity(absY - o.y, o.height))
    if (key === lastKey.current) return
    const laneChanged = (lastKey.current?.split(":")[0] ?? null) !== (col?.pitchId ?? "-")
    lastKey.current = key
    const next: DragPreview = { fixtureId, pitchId: col?.pitchId ?? null, laneIndex: col?.laneIndex ?? 0, minutes, conflict: col ? previewFor(fixtureId, col.pitchId, minutes) : null }
    setPreview(next)
    onPreview(next)
    if (laneChanged || !next.conflict) void haptic.snap()
  }, [cols, scale, previewFor, onPreview, setAutoScroll])

  const endPreview = useCallback((fixtureId: string, dropped: boolean) => {
    setAutoScroll(0, 0)
    const last = preview && preview.fixtureId === fixtureId ? preview : null
    lastKey.current = null
    setPreview(null)
    onPreview(null)
    if (!dropped || !last || !last.pitchId) {
      if (dropped) void haptic.refuse()
      return
    }
    void haptic.staged()
    onDrop(fixtureId, last.pitchId, last.minutes)
  }, [preview, onDrop, onPreview, setAutoScroll])
  // The callbacks above are read by worklets through refs so a stale closure never drops a fixture.
  const updateRef = useRef(updatePreview); updateRef.current = updatePreview
  const endRef = useRef(endPreview); endRef.current = endPreview

  const marks = useMemo(() => timeMarks(scale), [scale])
  const nowMinutes = (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() })()
  const showNow = dateIso === todayIso && nowMinutes >= START_MINUTES && nowMinutes <= END_MINUTES

  // OPEN ON WHAT MATTERS, NOT ON 08:00. A day is 15 hours; a person opening a populated board should not
  // have to scroll past empty hours to find the first game, and one opened today defaults to "now". Fires
  // once per date shown, so it never fights a person's own scrolling.
  // Once per date AND per set of pitches shown: choosing another ground re-opens on that ground's first booking,
  // and only bookings on the pitches actually drawn count -- a tournament at the main ground must not open the
  // Second Ground's board on an empty 09:00.
  const initialisedFor = useRef<string | null>(null)
  const scopeKey = `${dateIso}|${board.pitches.map((p) => p.id).join(",")}`
  useEffect(() => {
    if (initialisedFor.current === scopeKey) return
    initialisedFor.current = scopeKey
    const shown = (id: string | null | undefined) => !!id && pitchById.has(id)
    // The first thing on any pitch shown that day -- a fixture's warm-up, a session, a tournament, an event.
    const starts = [
      ...placed.map((p) => p.start),
      ...board.trainingSessions.filter((t) => shown(t.pitchId) && t.status !== "CANCELLED").map((t) => trainingOccupiedWindow(t)?.start ?? null),
      ...board.tournaments.filter((t) => shown(t.pitchId)).map((t) => timeToMinutes(t.startTime)),
      ...board.clubEvents.filter((e) => shown(e.pitchId) && e.startsOn <= dateIso && e.endsOn >= dateIso && e.startTime && !e.isMultiDay).map((e) => timeToMinutes(e.startTime!)),
    ].filter((m): m is number => typeof m === "number" && m >= START_MINUTES)
    const earliest = starts.length > 0 ? Math.min(...starts) : null
    const target = showNow ? nowMinutes : (earliest ?? START_MINUTES)
    // A little headroom above the target, not flush against the top edge.
    const y = Math.max(0, minutesToY(target, scale) - px * 2)
    const id = setTimeout(() => vRef.current?.scrollTo({ y, animated: false }), 50)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, placed.length > 0])

  return (
    <View style={{ flex: 1 }}>
      {/* THE PITCH HEADER, frozen across the top and moving with the columns */}
      <View style={{ flexDirection: "row", height: HEADER_HEIGHT, borderBottomWidth: 1, borderBottomColor: colour.line, backgroundColor: colour.surface }}>
        <View style={{ width: TIME_AXIS_WIDTH, justifyContent: "flex-end", alignItems: "flex-end", paddingRight: 6, paddingBottom: 6, borderRightWidth: 1, borderRightColor: colour.line }}>
          <Text style={[type.caption, { fontSize: 10, color: colour.inkSubtle }]}>Time</Text>
        </View>
        <View style={{ flex: 1, overflow: "hidden" }}>
          <Animated.View style={[{ width, height: HEADER_HEIGHT }, headerStyle]}>
            {colsByPitch.pitches.map((pitch) => {
              const span = pitchSpan(pitch.id)
              if (!span) return null
              const isTarget = preview?.pitchId === pitch.id
              const events = board.clubEvents.filter((e) => e.pitchId === pitch.id)
              const metaLabel = physicalSizeCategoryLabel(pitch.physicalSizeCategory)
              return (
                <View key={pitch.id} accessible accessibilityRole="header" accessibilityLabel={`${pitch.displayName}${metaLabel ? `, ${metaLabel}` : ""}${pitch.laneCount > 1 ? `, ${pitch.laneCount} at once` : ""}${events.length ? `, reserved for ${events.map((e) => e.name).join(", ")}` : ""}`}
                  style={{ position: "absolute", left: span.left, width: span.width, top: 4, bottom: 4, justifyContent: "center", gap: 1, paddingHorizontal: 6, borderRadius: radius.sm, backgroundColor: isTarget ? colour.mint100 : "transparent" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    {/* A NEUTRAL ICON, NEVER A PHOTOGRAPH: an operational header names the pitch; its picture lives on its own page. */}
                    <LayoutGrid size={12} color={colour.forest800} />
                    <Text style={[type.caption, { color: colour.ink, fontFamily: "Inter_600SemiBold", flexShrink: 1 }]} numberOfLines={1}>{pitch.displayName}</Text>
                  </View>
                  <Text style={[type.caption, { color: colour.inkSubtle, fontSize: 10 }]} numberOfLines={1}>{[metaLabel, pitch.laneCount > 1 ? `${pitch.laneCount} at once` : null].filter(Boolean).join(" · ")}</Text>
                  {events.length > 0 && <Text style={[type.caption, { color: "#6d3b5d", fontSize: 10 }]} numberOfLines={1}>{events.map((e) => e.name).join(", ")}</Text>}
                </View>
              )
            })}
          </Animated.View>
        </View>
      </View>

      <View ref={vViewportRef} style={{ flex: 1 }} onLayout={measureVViewport}>
      <Animated.ScrollView ref={vRef} onScroll={onV} scrollEventThrottle={16} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: board.unallocated.length + otherNeeds.length > 0 ? 220 : space.md }}>
        <View style={{ flexDirection: "row" }}>
          {/* THE FROZEN TIME AXIS: 08:00, 08:15, 08:30 … down the left */}
          <View style={{ width: TIME_AXIS_WIDTH, height, borderRightWidth: 1, borderRightColor: colour.line }}>
            {marks.filter((m) => m.labelled).map((m) => (
              <Text key={m.minutes} style={[type.caption, { position: "absolute", top: Math.max(0, minutesToY(m.minutes, scale) - 7), right: 6, fontSize: m.hour ? 11 : 10, color: m.hour ? colour.ink : colour.inkSubtle, fontFamily: m.hour ? "Inter_600SemiBold" : undefined, fontVariant: ["tabular-nums"] }]}>
                {m.label}
              </Text>
            ))}
          </View>

          {/* THE PITCHES */}
          <View ref={hViewportRef} style={{ flex: 1, overflow: "hidden" }} onLayout={measureHViewport}>
          <Animated.ScrollView ref={hRef} horizontal onScroll={onH} scrollEventThrottle={16} showsHorizontalScrollIndicator={false}>
            <View style={{ width: Math.max(width, 1), height }}>
              {cols.map((col) => (
                <View key={`${col.pitchId}:${col.laneIndex}`} pointerEvents="none" style={{ position: "absolute", top: 0, height, left: col.left, width: col.width, backgroundColor: preview?.pitchId === col.pitchId && preview.laneIndex === col.laneIndex ? "rgba(50,166,101,0.10)" : colour.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line }} />
              ))}
              {/* the slot lattice, across every column */}
              {marks.map((m) => (
                <View key={m.minutes} pointerEvents="none" style={{ position: "absolute", left: 0, width, top: minutesToY(m.minutes, scale), height: 1, backgroundColor: m.hour ? "rgba(16,21,18,0.12)" : "rgba(16,21,18,0.04)" }} />
              ))}
              {/* tournament holds, as the organiser reserved them */}
              {board.tournaments.map((t) => {
                const span = pitchSpan(t.pitchId)
                if (!span) return null
                const top = minutesToY(timeToMinutes(t.startTime), scale)
                const h = heightForMinutes(timeToMinutes(t.endTime) - timeToMinutes(t.startTime), scale)
                return (
                  <View key={t.id} pointerEvents="none" accessible accessibilityLabel={`${t.tournamentName} holds ${pitchById.get(t.pitchId ?? "")?.displayName ?? "the pitch"} from ${t.startTime.slice(0, 5)} to ${t.endTime.slice(0, 5)}`} style={{ position: "absolute", left: span.left, width: span.width, top, height: h, backgroundColor: "rgba(251,191,36,0.16)", borderTopWidth: 1, borderBottomWidth: 1, borderColor: "rgba(217,119,6,0.5)", padding: 6 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Trophy size={12} color="#92400e" />
                      <Text style={[type.caption, { color: "#92400e", flexShrink: 1 }]} numberOfLines={2}>{t.tournamentName}</Text>
                    </View>
                  </View>
                )
              })}
              {/* an event's explicit pitch reservation */}
              {board.clubEvents.filter((e) => e.startsOn <= dateIso && e.endsOn >= dateIso).map((e) => {
                const span = pitchSpan(e.pitchId)
                if (!span) return null
                const from = e.startTime && !e.isMultiDay ? timeToMinutes(e.startTime) : START_MINUTES
                const until = e.endTime && !e.isMultiDay ? timeToMinutes(e.endTime) : END_MINUTES
                if (until <= from) return null
                return (
                  <View key={`${e.eventId}:${e.pitchId}`} pointerEvents="none" accessible accessibilityLabel={`${e.name} reserves ${pitchById.get(e.pitchId)?.displayName ?? "the pitch"} from ${minutesToTime(from)} to ${minutesToTime(until)}`} style={{ position: "absolute", left: span.left, width: span.width, top: minutesToY(from, scale), height: heightForMinutes(until - from, scale), backgroundColor: "rgba(124,58,237,0.10)", borderTopWidth: 1, borderBottomWidth: 1, borderColor: "rgba(124,58,237,0.45)", padding: 6 }}>
                    <Text style={[type.caption, { color: "#5b21b6" }]} numberOfLines={2}>{e.name}</Text>
                  </View>
                )
              })}
              {/* training, read-only here: its own session, the whole pitch for its time */}
              {board.trainingSessions.filter((t) => t.pitchId && t.status !== "CANCELLED").map((t) => {
                const span = pitchSpan(t.pitchId)
                const w = trainingOccupiedWindow(t)
                if (!span || !w) return null
                const reason = board.trainingConflicts.find((c) => c.trainingSessionId === t.trainingSessionId)?.reason ?? null
                return (
                  <View key={t.trainingSessionId} pointerEvents="none" accessible accessibilityLabel={`${t.teamLabel} training, ${minutesToTime(w.start)} to ${minutesToTime(w.end)}${reason ? `, ${reason}` : ""}`} style={{ position: "absolute", left: span.left + 2, width: span.width - 4, top: minutesToY(w.start, scale) + 1, height: heightForMinutes(w.end - w.start, scale) - 2, borderRadius: 6, backgroundColor: "#e8eff7", borderWidth: 1, borderColor: reason ? colour.danger : colour.messengerBlue, padding: 6 }}>
                    <Text style={[type.caption, { color: colour.messengerBlue, fontFamily: "Inter_600SemiBold" }]} numberOfLines={2}>{t.teamLabel} training</Text>
                    {heightForMinutes(w.end - w.start, scale) >= 44 && <Text style={[type.caption, { color: colour.messengerBlue, fontSize: 10 }]} numberOfLines={1}>{`${minutesToTime(w.start)} – ${minutesToTime(w.end)}`}</Text>}
                  </View>
                )
              })}
              {/* now */}
              {showNow && <View pointerEvents="none" style={{ position: "absolute", left: 0, width, top: minutesToY(nowMinutes, scale), height: 2, backgroundColor: "rgba(193,34,27,0.7)" }} />}

              {/* THE GHOST: where a dragged fixture would land, buffers included */}
              {preview && preview.pitchId && (() => {
                const f = board.fixtures.find((x) => x.fixtureId === preview.fixtureId) ?? board.unallocated.find((x) => x.fixtureId === preview.fixtureId)
                const col = cols.find((c) => c.pitchId === preview.pitchId && c.laneIndex === preview.laneIndex) ?? cols.find((c) => c.pitchId === preview.pitchId)
                if (!f || !col) return null
                const w = fixtureOccupiedWindow({ ...f, kickoffTime: minutesToTime(preview.minutes) }, buffers)
                if (!w) return null
                const bad = preview.conflict?.severity === "hard"
                return (
                  <View pointerEvents="none" style={{ position: "absolute", left: col.left + 2, width: col.width - 4, top: minutesToY(w.start, scale), height: heightForMinutes(w.end - w.start, scale), borderRadius: radius.md, borderWidth: 2, borderStyle: "dashed", borderColor: bad ? colour.danger : preview.conflict ? colour.warning : colour.pitch600, backgroundColor: bad ? "rgba(193,34,27,0.08)" : "rgba(50,166,101,0.12)" }} />
                )
              })()}

              {placed.map((p) => (
                <FixtureBlock
                  key={p.fixture.fixtureId}
                  placed={p}
                  scale={scale}
                  canManage={canManage}
                  reduceMotion={reduceMotion}
                  isStaged={staged.has(p.fixture.fixtureId)}
                  isDragging={preview?.fixtureId === p.fixture.fixtureId}
                  scrollX={scrollX}
                  scrollY={scrollY}
                  onOpen={onOpen}
                  onDragUpdate={(id, cx, cy, ax, ay) => updateRef.current(id, cx, cy, ax, ay)}
                  onDragEnd={(id, dropped) => endRef.current(id, dropped)}
                />
              ))}
            </View>
          </Animated.ScrollView>
          {cols.length === 0 && (
            <View style={{ position: "absolute", top: space.lg, left: space.md, right: space.md }}>
              <Text style={[type.small, { color: colour.inkMuted }]}>No active pitches here. Add one in Venues.</Text>
            </View>
          )}
          </View>
        </View>
      </Animated.ScrollView>
      </View>

      {board.unallocated.length + otherNeeds.length > 0 && (
        <UnallocatedTray
          fixtures={board.unallocated}
          otherNeeds={otherNeeds}
          canManage={canManage}
          reduceMotion={reduceMotion}
          onOpen={onOpen}
          onDragUpdate={(id, ax, ay) => updateRef.current(id, ...contentFromAbs(ax, ay), ax, ay)}
          onDragEnd={(id, dropped) => endRef.current(id, dropped)}
          reasonFor={reasonFor}
        />
      )}
    </View>
  )
}

/**
 * ONE FIXTURE, DRAWN AS THE WHOLE WINDOW IT RESERVES, top to bottom: warm-up, match, clearing the pitch.
 * The match is the card; the buffers are its shoulders. Press and hold lifts the whole envelope; it follows
 * the finger and settles back into place when let go (the board then redraws it where it was staged).
 */
const FixtureBlock = memo(function FixtureBlock({ placed, scale, canManage, reduceMotion, isStaged, isDragging, scrollX, scrollY, onOpen, onDragUpdate, onDragEnd }: {
  placed: Placed
  scale: BoardScale
  canManage: boolean
  reduceMotion: boolean
  isStaged: boolean
  isDragging: boolean
  scrollX: SharedValue<number>
  scrollY: SharedValue<number>
  onOpen: (fixture: AllocationFixture) => void
  /** contentX/contentY are exact content-space coordinates, computed here from this block's own known
   * position plus the gesture's own translation -- never from an absolute screen measurement. absX/absY
   * are the raw finger position, passed through only for the parent's auto-scroll edge check. */
  onDragUpdate: (fixtureId: string, contentX: number, contentY: number, absX: number, absY: number) => void
  onDragEnd: (fixtureId: string, dropped: boolean) => void
}) {
  const { fixture: f, col, start, playStart, playEnd, end } = placed
  const top = minutesToY(start, scale)
  const warmH = heightForMinutes(playStart - start, scale)
  const matchH = heightForMinutes(playEnd - playStart, scale)
  const packH = heightForMinutes(end - playEnd, scale)
  const total = warmH + matchH + packH
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const lifted = useSharedValue(0)
  const startScrollX = useSharedValue(0)
  const startScrollY = useSharedValue(0)
  const severity = placed.conflict?.severity ?? (placed.trainingReason ? "hard" : null)
  const reason = placed.conflict?.reason ?? placed.trainingReason
  // A narrow lane (a pitch taking several games at once) or a short match keeps only what fits: never clipped words.
  const narrow = col.width < 100
  const roomy = matchH >= 64 && !narrow
  const footprint = matchFootprintFor(f.requiredPitchSize).footprint
  const footprintText = footprintLabel(footprint)
  // THE MATCH'S OWN CONTENT-SPACE ANCHOR at the moment of grab: its kick-off (the top of the match) and the
  // middle of its column. Wherever inside the card you grab it, this is what moves.
  const startLeft = col.left + col.width / 2
  const startTop = top + warmH

  const pan = useMemo(() => Gesture.Pan()
    .enabled(canManage)
    .activateAfterLongPress(350)
    .onStart((e) => {
      lifted.value = reduceMotion ? 1 : withSpring(1, { damping: 18, stiffness: 220 })
      startScrollX.value = scrollX.value
      startScrollY.value = scrollY.value
      runOnJS(haptic.lift)()
      runOnJS(onDragUpdate)(f.fixtureId, startLeft, startTop, e.absoluteX, e.absoluteY)
    })
    .onUpdate((e) => {
      const dx = e.translationX + (scrollX.value - startScrollX.value)
      const dy = e.translationY + (scrollY.value - startScrollY.value)
      tx.value = dx
      ty.value = dy
      runOnJS(onDragUpdate)(f.fixtureId, startLeft + dx, startTop + dy, e.absoluteX, e.absoluteY)
    })
    .onEnd(() => {
      runOnJS(onDragEnd)(f.fixtureId, true)
    })
    .onFinalize((_e, success) => {
      if (!success) runOnJS(onDragEnd)(f.fixtureId, false)
      lifted.value = reduceMotion ? 0 : withTiming(0, { duration: 160 })
      tx.value = reduceMotion ? 0 : withTiming(0, { duration: 160 })
      ty.value = reduceMotion ? 0 : withTiming(0, { duration: 160 })
    }), [canManage, reduceMotion, f.fixtureId, startLeft, startTop, onDragUpdate, onDragEnd, lifted, tx, ty, startScrollX, startScrollY, scrollX, scrollY])

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: 1 + lifted.value * 0.03 }],
    zIndex: lifted.value > 0 ? 50 : 10,
    shadowOpacity: 0.06 + lifted.value * 0.22,
    shadowRadius: 8 + lifted.value * 12,
    elevation: 2 + lifted.value * 10,
  }))

  const a11y = `${f.homeTeamLabel} versus ${f.opponentLabel}, kick-off ${minutesToTime(playStart)}, on this pitch from ${minutesToTime(start)} to ${minutesToTime(end)} including warm-up and pack-up${isStaged ? ", staged, not yet saved" : ""}${reason ? `. ${reason}` : ""}${canManage ? ". Double tap to open, press and hold to move" : ". Double tap to open"}`

  // ONE CONNECTED CARD, not three bordered boxes: a single outer border (coloured by severity/staged state)
  // carries the whole reserved window; warm-up and clearing are tinted bands inside it.
  const cardBorderColor = severity === "hard" ? colour.danger : severity === "warning" ? colour.warning : isStaged ? colour.pitch600 : "rgba(18,61,44,0.22)"
  const cardBorderWidth = isStaged || severity ? 2 : 1
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ position: "absolute", left: col.left + 3, top, width: col.width - 6, height: total, shadowColor: "#071c14", shadowOffset: { width: 0, height: 4 }, opacity: isDragging ? 0.92 : 1 }, style]}>
        <Pressable
          accessible accessibilityRole="button" accessibilityLabel={a11y} onPress={() => onOpen(f)}
          style={{ flex: 1, borderRadius: radius.md, borderWidth: cardBorderWidth, borderColor: cardBorderColor, overflow: "hidden", backgroundColor: colour.surface }}
        >
          {warmH > 0 && (
            <View style={{ height: warmH, backgroundColor: "rgba(16,21,18,0.05)", justifyContent: "center", paddingHorizontal: 5 }}>
              {warmH >= 24 && !narrow && <Text style={[type.caption, { fontSize: 10, color: colour.inkMuted }]} numberOfLines={1}>{`Warm-up ${minutesToTime(start)}`}</Text>}
            </View>
          )}
          <View style={{ height: matchH, backgroundColor: severity === "hard" ? colour.dangerSurface : severity === "warning" ? colour.warningSurface : colour.mint100, paddingHorizontal: narrow ? 4 : 6, paddingVertical: 3, justifyContent: "center" }}>
            {roomy && (
              <Text style={[type.caption, { color: colour.forest800, fontSize: 9, letterSpacing: 0.4 }]} numberOfLines={1}>
                MATCH{footprintText ? ` · ${footprintText}` : ""}
              </Text>
            )}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              {severity && <TriangleAlert size={narrow ? 10 : 12} color={severity === "hard" ? colour.danger : colour.warning} />}
              <Text style={[type.smallMedium, { color: colour.forest950, fontSize: narrow ? 11 : 12, flexShrink: 1 }]} numberOfLines={roomy ? 2 : 1}>{f.homeTeamLabel}</Text>
            </View>
            {roomy && <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={1}>v {f.opponentLabel}</Text>}
            <Text style={[type.caption, { color: colour.forest800, fontFamily: "Inter_600SemiBold", fontSize: narrow ? 10 : 11 }]} numberOfLines={1}>
              {roomy ? `${minutesToTime(playStart)} – ${minutesToTime(playEnd)}` : minutesToTime(playStart)}{isStaged ? " · staged" : ""}
            </Text>
          </View>
          {packH > 0 && (
            <View style={{ height: packH, backgroundColor: "rgba(16,21,18,0.05)", justifyContent: "center", paddingHorizontal: 5 }}>
              {packH >= 24 && !narrow && <Text style={[type.caption, { fontSize: 10, color: colour.inkMuted }]} numberOfLines={1}>{`Clear by ${minutesToTime(end)}`}</Text>}
            </View>
          )}
        </Pressable>
      </Animated.View>
    </GestureDetector>
  )
})

/**
 * THE TRAY: fixtures that still need a pitch. Each is a draggable chip -- press and hold, drag it up
 * onto a lane, let go -- and a tappable one for the accessible Move flow.
 */
// A ROTATING, PURELY DECORATIVE PALETTE for the tray's team-shirt avatars -- not a status colour (those
// are reserved for conflict/staged/read-only meaning elsewhere on the board), just visual variety so a
// list of several unallocated fixtures is easy to tell apart at a glance, the way the reference design
// varies its jersey-icon tints.
const TRAY_TINTS = [
  { bg: "#fde7ea", fg: "#c1221b" },
  { bg: "#ece5fb", fg: "#6d3b9e" },
  { bg: "#e2f2ea", fg: "#12703f" },
  { bg: "#e6eefb", fg: "#1d4f91" },
]
function trayTint(fixtureId: string) {
  let h = 0
  for (let i = 0; i < fixtureId.length; i += 1) h = (h * 31 + fixtureId.charCodeAt(i)) >>> 0
  return TRAY_TINTS[h % TRAY_TINTS.length]
}

/**
 * THE UNALLOCATED SHEET -- a bottom sheet that floats OVER the board (never squeezes it into a sliver),
 * with its own drag handle, a collapse toggle so a Fixture Secretary can put it away once the morning's
 * placements are done, and a full-width card per fixture -- exactly what the reference design asked for.
 */
function UnallocatedTray({ fixtures, otherNeeds, canManage, reduceMotion, onOpen, onDragUpdate, onDragEnd, reasonFor }: {
  fixtures: AllocationFixture[]
  otherNeeds: QueueNeed[]
  canManage: boolean
  reduceMotion: boolean
  onOpen: (fixture: AllocationFixture) => void
  /** The finger's raw screen position; the parent converts it to content space via the viewport origin. */
  onDragUpdate: (fixtureId: string, absX: number, absY: number) => void
  onDragEnd: (fixtureId: string, dropped: boolean) => void
  reasonFor: (fixture: AllocationFixture) => string
}) {
  const [expanded, setExpanded] = useState(true)
  return (
    <View
      style={{
        position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "48%",
        backgroundColor: colour.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
        borderWidth: 1, borderColor: colour.line, borderBottomWidth: 0,
        shadowColor: "#071c14", shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 12,
      }}
    >
      <Pressable accessibilityRole="button" accessibilityLabel={expanded ? "Collapse unallocated fixtures" : "Expand unallocated fixtures"} onPress={() => setExpanded((v) => !v)} style={{ paddingTop: 10, paddingBottom: space.sm, paddingHorizontal: space.md }}>
        <View style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: colour.line, marginBottom: space.sm }} />
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text accessibilityRole="header" style={[type.smallMedium, { color: colour.ink, flex: 1, fontFamily: "Inter_600SemiBold" }]}>{`Unallocated · ${fixtures.length + otherNeeds.length}`}</Text>
          {expanded ? <ChevronDown size={18} color={colour.inkMuted} /> : <ChevronUp size={18} color={colour.inkMuted} />}
        </View>
        {expanded && <Text style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>{fixtures.length > 0 ? "Drag a fixture onto a pitch and time, or tap anything to allocate it." : "Tap anything to allocate what it still needs."}</Text>}
      </Pressable>
      {expanded && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm }}>
          {fixtures.map((f) => (
            <TrayCard key={f.fixtureId} fixture={f} tint={trayTint(f.fixtureId)} reason={reasonFor(f)} canManage={canManage} reduceMotion={reduceMotion} onOpen={onOpen} onDragUpdate={onDragUpdate} onDragEnd={onDragEnd} />
          ))}
          {otherNeeds.map((n) => (
            <Pressable key={n.id} accessibilityRole="button" accessibilityLabel={`${n.title}, ${n.when}. ${n.needs}.${canManage ? " Double tap to allocate" : ""}`} onPress={n.onPress}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 64, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.warning, backgroundColor: pressed ? colour.chalk : colour.surface, paddingHorizontal: space.sm, paddingVertical: space.sm })}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: n.kind === "TRAINING" ? "#e8eff7" : colour.warningSurface, alignItems: "center", justifyContent: "center" }}>
                {n.kind === "TRAINING" ? <Clock size={18} color={colour.messengerBlue} /> : <Shirt size={18} color={colour.warning} />}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.smallMedium, { color: colour.ink }]} numberOfLines={2}>{n.title}</Text>
                <Text style={[type.caption, { color: colour.inkSubtle }]}>{n.when}</Text>
                <Text style={[type.caption, { color: colour.warning }]}>{n.needs}</Text>
              </View>
              {canManage && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <View style={{ paddingHorizontal: space.sm, paddingVertical: 6, borderRadius: radius.md, backgroundColor: colour.chalk, borderWidth: 1, borderColor: colour.lineStrong }}>
                    <Text style={[type.caption, { color: colour.forest800, fontFamily: "Inter_600SemiBold" }]}>Allocate</Text>
                  </View>
                  <ChevronRight size={16} color={colour.inkSubtle} />
                </View>
              )}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

const TrayCard = memo(function TrayCard({ fixture: f, tint, reason, canManage, reduceMotion, onOpen, onDragUpdate, onDragEnd }: { fixture: AllocationFixture; tint: { bg: string; fg: string }; reason: string; canManage: boolean; reduceMotion: boolean; onOpen: (f: AllocationFixture) => void; onDragUpdate: (id: string, ax: number, ay: number) => void; onDragEnd: (id: string, dropped: boolean) => void }) {
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const lifted = useSharedValue(0)
  const pan = useMemo(() => Gesture.Pan()
    .enabled(canManage)
    .activateAfterLongPress(350)
    .onStart((e) => {
      lifted.value = reduceMotion ? 1 : withSpring(1, { damping: 18, stiffness: 220 })
      runOnJS(haptic.lift)()
      runOnJS(onDragUpdate)(f.fixtureId, e.absoluteX, e.absoluteY)
    })
    .onUpdate((e) => {
      tx.value = e.translationX
      ty.value = e.translationY
      runOnJS(onDragUpdate)(f.fixtureId, e.absoluteX, e.absoluteY)
    })
    .onEnd(() => { runOnJS(onDragEnd)(f.fixtureId, true) })
    .onFinalize((_e, success) => {
      if (!success) runOnJS(onDragEnd)(f.fixtureId, false)
      lifted.value = reduceMotion ? 0 : withTiming(0, { duration: 160 })
      tx.value = reduceMotion ? 0 : withTiming(0, { duration: 160 })
      ty.value = reduceMotion ? 0 : withTiming(0, { duration: 160 })
    }), [canManage, reduceMotion, f.fixtureId, onDragUpdate, onDragEnd, lifted, tx, ty])
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: 1 + lifted.value * 0.03 }], zIndex: lifted.value > 0 ? 60 : 1, shadowOpacity: 0.05 + lifted.value * 0.2, elevation: 1 + lifted.value * 8 }))
  const kickoff = f.kickoffTime ? f.kickoffTime.slice(0, 5) : null
  const durationLabel = f.durationMinutes ? `${f.durationMinutes} mins${f.durationConfidence === "unresolved" ? " (est.)" : ""}` : null
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ shadowColor: "#071c14", shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }, style]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${f.homeTeamLabel} versus ${f.opponentLabel}, needs a pitch. ${reason}${canManage ? ". Double tap to choose a pitch, press and hold to drag it onto one" : ""}`}
          onPress={() => onOpen(f)}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 64, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: pressed ? colour.chalk : colour.surface, paddingHorizontal: space.sm, paddingVertical: space.sm })}
        >
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: tint.bg, alignItems: "center", justifyContent: "center" }}>
            <Shirt size={18} color={tint.fg} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]} numberOfLines={1}>{f.homeTeamLabel}</Text>
            <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={1}>v {f.opponentLabel}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: 2 }}>
              {kickoff && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <CalendarDays size={12} color={colour.inkSubtle} />
                  <Text style={[type.caption, { color: colour.inkSubtle }]}>{kickoff}</Text>
                </View>
              )}
              {durationLabel && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <Clock size={12} color={colour.inkSubtle} />
                  <Text style={[type.caption, { color: colour.inkSubtle }]}>{durationLabel}</Text>
                </View>
              )}
            </View>
          </View>
          {canManage && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <View style={{ paddingHorizontal: space.sm, paddingVertical: 6, borderRadius: radius.md, backgroundColor: colour.chalk, borderWidth: 1, borderColor: colour.lineStrong }}>
                <Text style={[type.caption, { color: colour.forest800, fontFamily: "Inter_600SemiBold" }]}>Allocate</Text>
              </View>
              <ChevronRight size={16} color={colour.inkSubtle} />
            </View>
          )}
        </Pressable>
      </Animated.View>
    </GestureDetector>
  )
})

