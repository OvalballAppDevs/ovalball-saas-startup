import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pressable, ScrollView, Text, View, type LayoutChangeEvent } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, { runOnJS, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated"

import { assignBookingLanes, fixtureOccupiedWindow, laneRowCount, timeToMinutes, trainingOccupiedWindow, type AllocationConflict, type AllocationFixture, type PitchAllocationBoard } from "@ovalball/contracts/pitch-allocation"

import { haptic } from "./haptics"
import { HEADER_HEIGHT, LABEL_COLUMN_WIDTH, LANE_GAP, LANE_HEIGHT, PX_PER_SLOT, START_MINUTES, SLOT_COUNT, autoScrollVelocity, boardHeight, hourMarks, kickoffMinutes, laneRows, minutesToTime, minutesToX, timelineWidth, widthForMinutes, xToSnappedMinutes, yToLaneRow, type BoardScale, type LaneRow } from "./geometry"
import { CalendarDays, ChevronDown, ChevronRight, ChevronUp, Clock, Shirt, TriangleAlert, Trophy } from "../components/icons"
import { colour, radius, space, type } from "../design/tokens"

/**
 * THE PITCH ALLOCATION BOARD -- a touch-native scheduling board (CA-M11.2).
 *
 * Pitches are lanes down the screen, time runs across it, and every fixture occupies its actual
 * window: the warm-up it reserves, the match itself, the pack-up after. Press and hold a match and it
 * lifts; drag it along a lane to change its kick-off, across lanes to change its pitch, or both at
 * once. While it moves, its buffers move with it, a ghost shows the slot it would snap to, and the
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
}

type Placed = { fixture: AllocationFixture; row: LaneRow; start: number; playStart: number; playEnd: number; end: number; conflict: AllocationConflict | null; trainingReason: string | null }

export function PitchBoard({ board, scale, canManage, reduceMotion, staged, todayIso, dateIso, onOpen, onDrop, previewFor, onPreview, reasonFor }: BoardProps) {
  const px = PX_PER_SLOT[scale]
  const width = timelineWidth(scale)
  const scrollX = useSharedValue(0)
  const scrollY = useSharedValue(0)
  const hRef = useRef<Animated.ScrollView>(null)
  const vRef = useRef<Animated.ScrollView>(null)
  const timelineOrigin = useRef({ x: 0, y: 0, width: 0, height: 0 })
  const timelineRef = useRef<View>(null)
  // THE VIEWPORT, separate from the CONTENT: `timelineOrigin`'s width/height (below) used to come from
  // measuring the full scrollable content view -- which on a device is either the whole day's width
  // (thousands of pixels, so "near the edge" almost never matched) or, worse, still {0,0} if that
  // measurement had not resolved yet, and autoScrollVelocity degenerates for extent<=0 into "always
  // scroll at full speed" (fixed in geometry.ts, but the ROOT cause is measuring the wrong rectangle).
  // These two are the actual VISIBLE window -- set synchronously from onLayout, never from a scrolled
  // content view -- and are what auto-scroll edge-detection is measured against.
  const hViewportRef = useRef<View>(null)
  const vViewportRef = useRef<View>(null)
  const [preview, setPreview] = useState<DragPreview | null>(null)

  // ROWS: a pitch with N lanes, or N bookings stacked where only one should be, is N rows.
  const rowsByPitch = useMemo(() => {
    const active = board.pitches.filter((p) => p.active)
    const laneByFixture = new Map<string, number>()
    const perPitch = active.map((pitch) => {
      const onPitch = board.fixtures.filter((f) => f.pitchId === pitch.id && f.kickoffTime)
      const lanes = assignBookingLanes(onPitch.map((f) => ({ id: f.fixtureId, startTime: f.kickoffTime!, durationMinutes: f.durationMinutes })))
      for (const [id, lane] of lanes) laneByFixture.set(id, lane)
      return { id: pitch.id, lanes: laneRowCount(pitch.laneCount, lanes), active: true }
    })
    return { rows: laneRows(perPitch), laneByFixture, pitches: active }
  }, [board.pitches, board.fixtures])
  const rows = rowsByPitch.rows
  const height = boardHeight(rows)
  const pitchById = useMemo(() => new Map(board.pitches.map((p) => [p.id, p])), [board.pitches])
  const buffers = { warmUpMinutes: board.policy.warmUpMinutes, packUpMinutes: board.policy.packUpMinutes }
  const conflictById = useMemo(() => new Map(board.conflicts.map((c) => [c.fixtureId, c])), [board.conflicts])
  const trainingReasonById = useMemo(() => new Map(board.fixtureConflictsFromTraining.map((c) => [c.fixtureId, c.reason])), [board.fixtureConflictsFromTraining])

  const placed: Placed[] = useMemo(() => {
    const out: Placed[] = []
    for (const f of board.fixtures) {
      if (!f.pitchId || !f.kickoffTime) continue
      const lane = rowsByPitch.laneByFixture.get(f.fixtureId) ?? 0
      const row = rows.find((r) => r.pitchId === f.pitchId && r.laneIndex === lane) ?? rows.find((r) => r.pitchId === f.pitchId)
      const w = fixtureOccupiedWindow(f, buffers)
      if (!row || !w) continue
      out.push({ fixture: f, row, start: w.start, playStart: w.playStart, playEnd: w.playEnd, end: w.end, conflict: conflictById.get(f.fixtureId) ?? null, trainingReason: trainingReasonById.get(f.fixtureId) ?? null })
    }
    return out
  }, [board.fixtures, rows, rowsByPitch.laneByFixture, conflictById, trainingReasonById, buffers.warmUpMinutes, buffers.packUpMinutes])

  const onH = useAnimatedScrollHandler({ onScroll: (e) => { scrollX.value = e.contentOffset.x } })
  const onV = useAnimatedScrollHandler({ onScroll: (e) => { scrollY.value = e.contentOffset.y } })
  const headerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -scrollX.value }] }))

  const measureTimeline = useCallback(() => {
    // x/y only: WHERE the content's origin sits on screen right now (moves as the user scrolls) --
    // width/height for the auto-scroll extent come from the viewport measurements below instead.
    timelineRef.current?.measureInWindow((x, y) => { timelineOrigin.current.x = x; timelineOrigin.current.y = y })
  }, [])
  const measureHViewport = useCallback((e: LayoutChangeEvent) => { timelineOrigin.current.width = e.nativeEvent.layout.width }, [])
  const measureVViewport = useCallback((e: LayoutChangeEvent) => { timelineOrigin.current.height = e.nativeEvent.layout.height }, [])

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

  // THE PREVIEW is recomputed only when the snapped slot or lane changes.
  const lastKey = useRef<string | null>(null)
  const updatePreview = useCallback((fixtureId: string, absX: number, absY: number, grabOffsetX: number) => {
    const o = timelineOrigin.current
    const contentX = absX - o.x + scrollX.value - grabOffsetX
    const contentY = absY - o.y + scrollY.value
    const minutes = xToSnappedMinutes(contentX, scale)
    const row = yToLaneRow(contentY, rows)
    const key = `${row?.pitchId ?? "-"}:${row?.laneIndex ?? 0}:${minutes}`
    setAutoScroll(autoScrollVelocity(absX - o.x, o.width), autoScrollVelocity(absY - o.y, o.height))
    if (key === lastKey.current) return
    const laneChanged = (lastKey.current?.split(":")[0] ?? null) !== (row?.pitchId ?? "-")
    lastKey.current = key
    const next: DragPreview = { fixtureId, pitchId: row?.pitchId ?? null, laneIndex: row?.laneIndex ?? 0, minutes, conflict: row ? previewFor(fixtureId, row.pitchId, minutes) : null }
    setPreview(next)
    onPreview(next)
    if (laneChanged || !next.conflict) void haptic.snap()
  }, [rows, scale, previewFor, onPreview, setAutoScroll, scrollX, scrollY])

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
  const previewRef = useRef(preview); previewRef.current = preview

  const marks = useMemo(() => hourMarks(), [])
  const nowMinutes = (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() })()
  const showNow = dateIso === todayIso && nowMinutes >= START_MINUTES && nowMinutes <= 23 * 60

  return (
    <View style={{ flex: 1 }} onLayout={measureTimeline}>
      {/* THE HOUR HEADER, frozen at the top and moving with the timeline */}
      <View style={{ flexDirection: "row", height: HEADER_HEIGHT, borderBottomWidth: 1, borderBottomColor: colour.line }}>
        <View style={{ width: LABEL_COLUMN_WIDTH }} />
        <View style={{ flex: 1, overflow: "hidden" }}>
          <Animated.View style={[{ width, height: HEADER_HEIGHT }, headerStyle]}>
            {marks.map((mark) => (
              <Text key={mark.minutes} style={[type.caption, { position: "absolute", left: minutesToX(mark.minutes, scale) + 4, top: 6, color: colour.inkMuted }]}>
                {mark.label}
              </Text>
            ))}
          </Animated.View>
        </View>
      </View>

      <View ref={vViewportRef} style={{ flex: 1 }} onLayout={measureVViewport}>
      <Animated.ScrollView ref={vRef} onScroll={onV} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space.md }}>
        <View style={{ flexDirection: "row" }}>
          {/* THE FROZEN PITCH COLUMN */}
          <View style={{ width: LABEL_COLUMN_WIDTH, height, borderRightWidth: 1, borderRightColor: colour.line }}>
            {rowsByPitch.pitches.map((pitch) => {
              const pitchRows = rows.filter((r) => r.pitchId === pitch.id)
              const top = pitchRows[0]?.top ?? 0
              const h = pitchRows.length * (LANE_HEIGHT + LANE_GAP) - LANE_GAP
              const isTarget = preview?.pitchId === pitch.id
              const events = board.clubEvents.filter((e) => e.pitchId === pitch.id)
              return (
                <View key={pitch.id} accessible accessibilityLabel={`${pitch.displayName}${pitch.laneCount > 1 ? `, ${pitch.laneCount} at once` : ""}${events.length ? `, reserved for ${events.map((e) => e.name).join(", ")}` : ""}`} style={{ position: "absolute", top, height: h, left: 0, right: 0, justifyContent: "center", paddingHorizontal: space.sm, backgroundColor: isTarget ? colour.mint100 : "transparent", borderRadius: radius.md }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]} numberOfLines={2}>{pitch.displayName}</Text>
                  {pitch.laneCount > 1 && <Text style={[type.caption, { color: colour.inkSubtle }]}>{pitch.laneCount} at once</Text>}
                  {events.map((e) => (
                    <Text key={e.eventId} style={[type.caption, { color: "#6d3b5d" }]} numberOfLines={1}>{e.name}</Text>
                  ))}
                </View>
              )
            })}
          </View>

          {/* THE TIMELINE */}
          <View ref={hViewportRef} style={{ flex: 1, overflow: "hidden" }} onLayout={(e) => { measureHViewport(e); measureTimeline() }}>
          <Animated.ScrollView ref={hRef} horizontal onScroll={onH} scrollEventThrottle={16} showsHorizontalScrollIndicator={false} onContentSizeChange={measureTimeline}>
            <View ref={timelineRef} style={{ width, height }} onLayout={measureTimeline}>
              {/* the slot lattice */}
              {Array.from({ length: SLOT_COUNT }, (_, i) => (
                <View key={i} pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, left: i * px, width: 1, backgroundColor: i % 4 === 0 ? "rgba(16,21,18,0.12)" : "rgba(16,21,18,0.04)" }} />
              ))}
              {rows.map((row) => (
                <View key={`${row.pitchId}:${row.laneIndex}`} pointerEvents="none" style={{ position: "absolute", left: 0, width, top: row.top, height: LANE_HEIGHT, backgroundColor: preview?.pitchId === row.pitchId && preview.laneIndex === row.laneIndex ? "rgba(50,166,101,0.10)" : colour.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line }} />
              ))}
              {/* tournament holds */}
              {board.tournaments.map((t) => {
                const pitchRows = rows.filter((r) => r.pitchId === t.pitchId)
                if (pitchRows.length === 0) return null
                const left = minutesToX(timeToMinutes(t.startTime), scale)
                const w = widthForMinutes(timeToMinutes(t.endTime) - timeToMinutes(t.startTime), scale)
                return (
                  <View key={t.id} pointerEvents="none" accessible accessibilityLabel={`${t.tournamentName} holds ${pitchById.get(t.pitchId ?? "")?.displayName ?? "the pitch"} from ${t.startTime.slice(0, 5)} to ${t.endTime.slice(0, 5)}`} style={{ position: "absolute", left, width: w, top: pitchRows[0].top, height: pitchRows.length * (LANE_HEIGHT + LANE_GAP) - LANE_GAP, backgroundColor: "rgba(251,191,36,0.16)", borderLeftWidth: 1, borderRightWidth: 1, borderColor: "rgba(217,119,6,0.5)", justifyContent: "flex-end", padding: 4 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Trophy size={12} color="#92400e" />
                      <Text style={[type.caption, { color: "#92400e" }]} numberOfLines={1}>{t.tournamentName}</Text>
                    </View>
                  </View>
                )
              })}
              {/* training, read-only, along the foot of its lane */}
              {board.trainingSessions.filter((t) => t.pitchId && t.status !== "CANCELLED").map((t) => {
                const row = rows.find((r) => r.pitchId === t.pitchId)
                const w = trainingOccupiedWindow(t)
                if (!row || !w) return null
                const reason = board.trainingConflicts.find((c) => c.trainingSessionId === t.trainingSessionId)?.reason ?? null
                return (
                  <View key={t.trainingSessionId} pointerEvents="none" accessible accessibilityLabel={`${t.teamLabel} training, ${minutesToTime(w.start)} to ${minutesToTime(w.end)}${reason ? `, ${reason}` : ""}`} style={{ position: "absolute", left: minutesToX(w.start, scale), width: widthForMinutes(w.end - w.start, scale), top: row.top + LANE_HEIGHT - 22, height: 20, borderRadius: 6, backgroundColor: "#e8eff7", borderWidth: 1, borderColor: reason ? colour.danger : colour.messengerBlue, paddingHorizontal: 6, justifyContent: "center" }}>
                    <Text style={[type.caption, { color: colour.messengerBlue }]} numberOfLines={1}>{t.teamLabel} training</Text>
                  </View>
                )
              })}
              {/* now */}
              {showNow && <View pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, left: minutesToX(nowMinutes, scale), width: 2, backgroundColor: "rgba(193,34,27,0.7)" }} />}

              {/* THE GHOST: where a dragged fixture would land, buffers included */}
              {preview && preview.pitchId && (() => {
                const f = board.fixtures.find((x) => x.fixtureId === preview.fixtureId) ?? board.unallocated.find((x) => x.fixtureId === preview.fixtureId)
                const row = rows.find((r) => r.pitchId === preview.pitchId && r.laneIndex === preview.laneIndex) ?? rows.find((r) => r.pitchId === preview.pitchId)
                if (!f || !row) return null
                const w = fixtureOccupiedWindow({ ...f, kickoffTime: minutesToTime(preview.minutes) }, buffers)
                if (!w) return null
                const bad = preview.conflict?.severity === "hard"
                return (
                  <View pointerEvents="none" style={{ position: "absolute", left: minutesToX(w.start, scale), width: widthForMinutes(w.end - w.start, scale), top: row.top + 2, height: LANE_HEIGHT - 4, borderRadius: radius.md, borderWidth: 2, borderStyle: "dashed", borderColor: bad ? colour.danger : preview.conflict ? colour.warning : colour.pitch600, backgroundColor: bad ? "rgba(193,34,27,0.08)" : "rgba(50,166,101,0.12)" }} />
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
                  warmUp={board.policy.warmUpMinutes}
                  packUp={board.policy.packUpMinutes}
                  onOpen={onOpen}
                  onDragUpdate={(id, ax, ay, gx) => updateRef.current(id, ax, ay, gx)}
                  onDragEnd={(id, dropped) => endRef.current(id, dropped)}
                  timelineOrigin={timelineOrigin}
                />
              ))}
              {rows.length === 0 && (
                <View style={{ padding: space.lg }}>
                  <Text style={[type.small, { color: colour.inkMuted }]}>No active pitches. Add one under Grounds & Pitches.</Text>
                </View>
              )}
            </View>
          </Animated.ScrollView>
          </View>
        </View>
      </Animated.ScrollView>
      </View>

      {board.unallocated.length > 0 && (
        <UnallocatedTray
          fixtures={board.unallocated}
          canManage={canManage}
          reduceMotion={reduceMotion}
          onOpen={onOpen}
          onDragUpdate={(id, ax, ay, gx) => updateRef.current(id, ax, ay, gx)}
          onDragEnd={(id, dropped) => endRef.current(id, dropped)}
          reasonFor={reasonFor}
        />
      )}
    </View>
  )
}

/**
 * ONE FIXTURE, DRAWN AS THE WHOLE WINDOW IT RESERVES: warm-up, match, pack-up. The match is the card;
 * the buffers are its shoulders. Press and hold lifts the whole envelope; it follows the finger and
 * settles back into place when let go (the board then redraws it where it was staged).
 */
const FixtureBlock = memo(function FixtureBlock({ placed, scale, canManage, reduceMotion, isStaged, isDragging, scrollX, scrollY, warmUp, packUp, onOpen, onDragUpdate, onDragEnd, timelineOrigin }: {
  placed: Placed
  scale: BoardScale
  canManage: boolean
  reduceMotion: boolean
  isStaged: boolean
  isDragging: boolean
  scrollX: SharedValue<number>
  scrollY: SharedValue<number>
  warmUp: number
  packUp: number
  onOpen: (fixture: AllocationFixture) => void
  onDragUpdate: (fixtureId: string, absX: number, absY: number, grabOffsetX: number) => void
  onDragEnd: (fixtureId: string, dropped: boolean) => void
  timelineOrigin: React.MutableRefObject<{ x: number; y: number; width: number; height: number }>
}) {
  const { fixture: f, row, start, playStart, playEnd, end } = placed
  const left = minutesToX(start, scale)
  const warmW = widthForMinutes(playStart - start, scale)
  const matchW = widthForMinutes(playEnd - playStart, scale)
  const packW = widthForMinutes(end - playEnd, scale)
  const total = warmW + matchW + packW
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const lifted = useSharedValue(0)
  const startScrollX = useSharedValue(0)
  const startScrollY = useSharedValue(0)
  const grabOffsetX = useSharedValue(0)
  const severity = placed.conflict?.severity ?? (placed.trainingReason ? "hard" : null)
  const reason = placed.conflict?.reason ?? placed.trainingReason
  const roomy = matchW >= 120
  const labelRoom = warmW >= 44

  const pan = useMemo(() => Gesture.Pan()
    .enabled(canManage)
    .activateAfterLongPress(350)
    .onStart((e) => {
      lifted.value = reduceMotion ? 1 : withSpring(1, { damping: 18, stiffness: 220 })
      startScrollX.value = scrollX.value
      startScrollY.value = scrollY.value
      // where the finger grabbed, relative to the MATCH's left edge, so the kick-off snaps to where the card is, not the finger.
      const matchLeftAbs = timelineOrigin.current.x + left + warmW - scrollX.value
      grabOffsetX.value = e.absoluteX - matchLeftAbs
      runOnJS(haptic.lift)()
      runOnJS(onDragUpdate)(f.fixtureId, e.absoluteX, e.absoluteY, grabOffsetX.value)
    })
    .onUpdate((e) => {
      tx.value = e.translationX + (scrollX.value - startScrollX.value)
      ty.value = e.translationY + (scrollY.value - startScrollY.value)
      runOnJS(onDragUpdate)(f.fixtureId, e.absoluteX, e.absoluteY, grabOffsetX.value)
    })
    .onEnd(() => {
      runOnJS(onDragEnd)(f.fixtureId, true)
    })
    .onFinalize((_e, success) => {
      if (!success) runOnJS(onDragEnd)(f.fixtureId, false)
      lifted.value = reduceMotion ? 0 : withTiming(0, { duration: 160 })
      tx.value = reduceMotion ? 0 : withTiming(0, { duration: 160 })
      ty.value = reduceMotion ? 0 : withTiming(0, { duration: 160 })
    }), [canManage, reduceMotion, f.fixtureId, left, warmW, onDragUpdate, onDragEnd, lifted, tx, ty, startScrollX, startScrollY, grabOffsetX, scrollX, scrollY, timelineOrigin])

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: 1 + lifted.value * 0.03 }],
    zIndex: lifted.value > 0 ? 50 : 10,
    shadowOpacity: 0.06 + lifted.value * 0.22,
    shadowRadius: 8 + lifted.value * 12,
    elevation: 2 + lifted.value * 10,
  }))

  const a11y = `${f.homeTeamLabel} versus ${f.opponentLabel}, kick-off ${minutesToTime(playStart)}, on this pitch from ${minutesToTime(start)} to ${minutesToTime(end)} including warm-up and pack-up${isStaged ? ", staged, not yet saved" : ""}${reason ? `. ${reason}` : ""}${canManage ? ". Double tap to open, press and hold to move" : ". Double tap to open"}`

  // ONE CONNECTED CARD, not three bordered boxes: a single outer border and radius (coloured by
  // severity/staged state) carries the whole reserved window; warm-up and pack-up are tinted flanks
  // inside it, not separate cards, matching the reference design.
  const cardBorderColor = severity === "hard" ? colour.danger : severity === "warning" ? colour.warning : isStaged ? colour.pitch600 : "rgba(18,61,44,0.22)"
  const cardBorderWidth = isStaged || severity ? 2 : 1
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ position: "absolute", left, top: row.top + 4, width: total, height: LANE_HEIGHT - 8, shadowColor: "#071c14", shadowOffset: { width: 0, height: 4 }, opacity: isDragging ? 0.92 : 1 }, style]}>
        <Pressable
          accessible accessibilityRole="button" accessibilityLabel={a11y} onPress={() => onOpen(f)}
          style={{ flex: 1, flexDirection: "row", borderRadius: radius.md, borderWidth: cardBorderWidth, borderColor: cardBorderColor, overflow: "hidden", backgroundColor: colour.surface }}
        >
          {warmW > 0 && (
            <View style={{ width: warmW, backgroundColor: "rgba(16,21,18,0.05)", justifyContent: "flex-end", padding: 3 }}>
              {labelRoom && <Text style={[type.caption, { fontSize: 10, color: colour.inkMuted }]} numberOfLines={1}>Warm-up</Text>}
            </View>
          )}
          <View style={{ width: matchW, backgroundColor: severity === "hard" ? colour.dangerSurface : severity === "warning" ? colour.warningSurface : colour.mint100, paddingHorizontal: 8, paddingVertical: 5, justifyContent: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              {severity && <TriangleAlert size={12} color={severity === "hard" ? colour.danger : colour.warning} />}
              <Text style={[type.smallMedium, { color: colour.forest950, fontSize: roomy ? 13 : 12 }]} numberOfLines={roomy ? 2 : 1}>{f.homeTeamLabel}</Text>
            </View>
            {roomy && <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={1}>v {f.opponentLabel}</Text>}
            <Text style={[type.caption, { color: colour.forest800, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>{minutesToTime(playStart)}{isStaged ? " · staged" : ""}</Text>
          </View>
          {packW > 0 && (
            <View style={{ width: packW, backgroundColor: "rgba(16,21,18,0.05)", justifyContent: "flex-end", padding: 3 }}>
              {packW >= 44 && <Text style={[type.caption, { fontSize: 10, color: colour.inkMuted }]} numberOfLines={1}>Pack-up</Text>}
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
function UnallocatedTray({ fixtures, canManage, reduceMotion, onOpen, onDragUpdate, onDragEnd, reasonFor }: {
  fixtures: AllocationFixture[]
  canManage: boolean
  reduceMotion: boolean
  onOpen: (fixture: AllocationFixture) => void
  onDragUpdate: (fixtureId: string, absX: number, absY: number, grabOffsetX: number) => void
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
          <Text style={[type.smallMedium, { color: colour.ink, flex: 1, fontFamily: "Inter_600SemiBold" }]}>Unallocated Fixtures ({fixtures.length})</Text>
          {expanded ? <ChevronDown size={18} color={colour.inkMuted} /> : <ChevronUp size={18} color={colour.inkMuted} />}
        </View>
        {expanded && <Text style={[type.caption, { color: colour.inkMuted, marginTop: 2 }]}>Drag a fixture onto a pitch and time, or tap to allocate.</Text>}
      </Pressable>
      {expanded && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.md, paddingBottom: space.md, gap: space.sm }}>
          {fixtures.map((f) => (
            <TrayCard key={f.fixtureId} fixture={f} tint={trayTint(f.fixtureId)} reason={reasonFor(f)} canManage={canManage} reduceMotion={reduceMotion} onOpen={onOpen} onDragUpdate={onDragUpdate} onDragEnd={onDragEnd} />
          ))}
        </ScrollView>
      )}
    </View>
  )
}

const TrayCard = memo(function TrayCard({ fixture: f, tint, reason, canManage, reduceMotion, onOpen, onDragUpdate, onDragEnd }: { fixture: AllocationFixture; tint: { bg: string; fg: string }; reason: string; canManage: boolean; reduceMotion: boolean; onOpen: (f: AllocationFixture) => void; onDragUpdate: (id: string, ax: number, ay: number, gx: number) => void; onDragEnd: (id: string, dropped: boolean) => void }) {
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const lifted = useSharedValue(0)
  const pan = useMemo(() => Gesture.Pan()
    .enabled(canManage)
    .activateAfterLongPress(350)
    .onStart((e) => {
      lifted.value = reduceMotion ? 1 : withSpring(1, { damping: 18, stiffness: 220 })
      runOnJS(haptic.lift)()
      runOnJS(onDragUpdate)(f.fixtureId, e.absoluteX, e.absoluteY, 0)
    })
    .onUpdate((e) => {
      tx.value = e.translationX
      ty.value = e.translationY
      runOnJS(onDragUpdate)(f.fixtureId, e.absoluteX, e.absoluteY, 0)
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

