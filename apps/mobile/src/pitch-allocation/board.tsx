import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pressable, ScrollView, Text, View, type LayoutChangeEvent } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, { runOnJS, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated"

import { assignBookingLanes, fixtureOccupiedWindow, footprintLabel, laneRowCount, matchFootprintFor, physicalSizeCategoryLabel, timeToMinutes, trainingOccupiedWindow, type AllocationConflict, type AllocationFixture, type PitchAllocationBoard } from "@ovalball/contracts/pitch-allocation"

import { haptic } from "./haptics"
import { HEADER_HEIGHT, LABEL_COLUMN_WIDTH, PX_PER_SLOT, START_MINUTES, SLOT_COUNT, autoScrollVelocity, boardHeight, hourMarks, kickoffMinutes, laneRows, minutesToTime, minutesToX, timelineWidth, widthForMinutes, xToSnappedMinutes, yToLaneRow, type BoardScale, type LaneRow } from "./geometry"
import { CalendarDays, ChevronDown, ChevronRight, ChevronUp, Clock, LayoutGrid, Shirt, TriangleAlert, Trophy } from "../components/icons"
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

  // `timelineOrigin` now holds the VIEWPORT's on-screen rectangle only -- x/y are STABLE (the wrapper
  // never moves as its content scrolls, unlike the content view a first pass measured here, which is
  // WHY that pass could drift by however much the page above it had shifted since the last measurement:
  // used only for auto-scroll's "how near the edge is this finger" check, never for hit-testing, which
  // (below) is computed from each block's own known content position plus the gesture's own translation
  // and needs no absolute measurement at all.
  const measureHViewport = useCallback((e: LayoutChangeEvent) => {
    timelineOrigin.current.width = e.nativeEvent.layout.width
    hViewportRef.current?.measureInWindow((x) => { timelineOrigin.current.x = x })
  }, [])
  const measureVViewport = useCallback((e: LayoutChangeEvent) => {
    timelineOrigin.current.height = e.nativeEvent.layout.height
    vViewportRef.current?.measureInWindow((_x, y) => { timelineOrigin.current.y = y })
  }, [])
  // For an item that starts OFF the board (the unallocated tray): its finger position has to be
  // converted into content space via the (stable) viewport origin, since it has no content-space
  // position of its own to start from the way a placed FixtureBlock does.
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

  // THE PREVIEW is recomputed only when the snapped slot or lane changes. `contentX`/`contentY` arrive
  // ALREADY in content space -- each caller below computes them from ITS OWN known starting position
  // plus the gesture's own translation, which is exact and needs no absolute-screen measurement at all
  // (the "have to drag half a screen to hit the right spot" bug was exactly this kind of measurement
  // going stale). `absX`/`absY` are the finger's raw screen position, used only for auto-scroll.
  const lastKey = useRef<string | null>(null)
  const updatePreview = useCallback((fixtureId: string, contentX: number, contentY: number, absX: number, absY: number) => {
    const o = timelineOrigin.current
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
  }, [rows, scale, previewFor, onPreview, setAutoScroll])

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

  // OPEN ON WHAT MATTERS, NOT ON 08:00. A day is 15 hours; a person opening a populated board should
  // not have to scroll past several empty morning hours to find the first game, and one opened today
  // should default to "now" -- the moment a Fixture Secretary standing pitch-side actually cares about.
  // Fires once per date shown, keyed by the ref below, so it never fights a person's own scrolling.
  const initialisedForDate = useRef<string | null>(null)
  useEffect(() => {
    if (initialisedForDate.current === dateIso) return
    initialisedForDate.current = dateIso
    const earliest = placed.reduce<number | null>((min, p) => (min === null || p.start < min ? p.start : min), null)
    const target = showNow ? nowMinutes : (earliest ?? START_MINUTES)
    // A little headroom before the target, not flush against the left edge.
    const x = Math.max(0, minutesToX(target, scale) - PX_PER_SLOT[scale] * 2)
    const id = setTimeout(() => hRef.current?.scrollTo({ x, animated: false }), 50)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateIso, placed.length > 0])

  return (
    <View style={{ flex: 1 }}>
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
              const last = pitchRows[pitchRows.length - 1]
              const h = last ? last.top + last.height - top : 0
              const isTarget = preview?.pitchId === pitch.id
              const events = board.clubEvents.filter((e) => e.pitchId === pitch.id)
              const metaLabel = physicalSizeCategoryLabel(pitch.physicalSizeCategory)
              return (
                <View key={pitch.id} accessible accessibilityLabel={`${pitch.displayName}${metaLabel ? `, ${metaLabel}` : ""}${pitch.laneCount > 1 ? `, ${pitch.laneCount} at once` : ""}${events.length ? `, reserved for ${events.map((e) => e.name).join(", ")}` : ""}`} style={{ position: "absolute", top, height: h, left: 0, right: 0, flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: space.sm, paddingVertical: 10, backgroundColor: isTarget ? colour.mint100 : "transparent", borderRadius: radius.md }}>
                  {/* A NEUTRAL ICON TILE, NEVER A PHOTOGRAPH: `club_pitches` has no image column in the
                      canonical schema, and inventing one would be fabricated data on an operational
                      screen. This is the honest "elegant icon" alternative -- kept small and to the side
                      so the pitch NAME, which can genuinely run to three words, keeps the column's full
                      width to wrap into rather than sharing it with an icon. */}
                  <View style={{ width: 28, height: 28, borderRadius: radius.sm, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                    <LayoutGrid size={14} color={colour.forest800} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.caption, { color: colour.ink, fontFamily: "Inter_600SemiBold" }]}>{pitch.displayName}</Text>
                    {metaLabel && <Text style={[type.caption, { color: colour.inkSubtle, fontSize: 10 }]} numberOfLines={1}>{metaLabel}</Text>}
                    {pitch.laneCount > 1 && <Text style={[type.caption, { color: colour.inkSubtle, fontSize: 10 }]} numberOfLines={1}>{pitch.laneCount} at once</Text>}
                    {events.map((e) => (
                      <Text key={e.eventId} style={[type.caption, { color: "#6d3b5d", fontSize: 10 }]} numberOfLines={1}>{e.name}</Text>
                    ))}
                  </View>
                </View>
              )
            })}
          </View>

          {/* THE TIMELINE */}
          <View ref={hViewportRef} style={{ flex: 1, overflow: "hidden" }} onLayout={measureHViewport}>
          <Animated.ScrollView ref={hRef} horizontal onScroll={onH} scrollEventThrottle={16} showsHorizontalScrollIndicator={false}>
            <View style={{ width, height }}>
              {/* the slot lattice */}
              {Array.from({ length: SLOT_COUNT }, (_, i) => (
                <View key={i} pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, left: i * px, width: 1, backgroundColor: i % 4 === 0 ? "rgba(16,21,18,0.12)" : "rgba(16,21,18,0.04)" }} />
              ))}
              {rows.map((row) => (
                <View key={`${row.pitchId}:${row.laneIndex}`} pointerEvents="none" style={{ position: "absolute", left: 0, width, top: row.top, height: row.height, backgroundColor: preview?.pitchId === row.pitchId && preview.laneIndex === row.laneIndex ? "rgba(50,166,101,0.10)" : colour.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line }} />
              ))}
              {/* tournament holds */}
              {board.tournaments.map((t) => {
                const pitchRows = rows.filter((r) => r.pitchId === t.pitchId)
                if (pitchRows.length === 0) return null
                const left = minutesToX(timeToMinutes(t.startTime), scale)
                const w = widthForMinutes(timeToMinutes(t.endTime) - timeToMinutes(t.startTime), scale)
                const tLast = pitchRows[pitchRows.length - 1]
                return (
                  <View key={t.id} pointerEvents="none" accessible accessibilityLabel={`${t.tournamentName} holds ${pitchById.get(t.pitchId ?? "")?.displayName ?? "the pitch"} from ${t.startTime.slice(0, 5)} to ${t.endTime.slice(0, 5)}`} style={{ position: "absolute", left, width: w, top: pitchRows[0].top, height: tLast.top + tLast.height - pitchRows[0].top, backgroundColor: "rgba(251,191,36,0.16)", borderLeftWidth: 1, borderRightWidth: 1, borderColor: "rgba(217,119,6,0.5)", justifyContent: "flex-end", padding: 4 }}>
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
                  <View key={t.trainingSessionId} pointerEvents="none" accessible accessibilityLabel={`${t.teamLabel} training, ${minutesToTime(w.start)} to ${minutesToTime(w.end)}${reason ? `, ${reason}` : ""}`} style={{ position: "absolute", left: minutesToX(w.start, scale), width: widthForMinutes(w.end - w.start, scale), top: row.top + Math.max(0, row.height - 22), height: 20, borderRadius: 6, backgroundColor: "#e8eff7", borderWidth: 1, borderColor: reason ? colour.danger : colour.messengerBlue, paddingHorizontal: 6, justifyContent: "center" }}>
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
                  <View pointerEvents="none" style={{ position: "absolute", left: minutesToX(w.start, scale), width: widthForMinutes(w.end - w.start, scale), top: row.top + 2, height: row.height - 4, borderRadius: radius.md, borderWidth: 2, borderStyle: "dashed", borderColor: bad ? colour.danger : preview.conflict ? colour.warning : colour.pitch600, backgroundColor: bad ? "rgba(193,34,27,0.08)" : "rgba(50,166,101,0.12)" }} />
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
                  onDragUpdate={(id, cx, cy, ax, ay) => updateRef.current(id, cx, cy, ax, ay)}
                  onDragEnd={(id, dropped) => endRef.current(id, dropped)}
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
          onDragUpdate={(id, ax, ay) => updateRef.current(id, ...contentFromAbs(ax, ay), ax, ay)}
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
const FixtureBlock = memo(function FixtureBlock({ placed, scale, canManage, reduceMotion, isStaged, isDragging, scrollX, scrollY, warmUp, packUp, onOpen, onDragUpdate, onDragEnd }: {
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
  /** contentX/contentY are exact content-space coordinates, computed here from this block's own known
   * position plus the gesture's own translation -- never from an absolute screen measurement. absX/absY
   * are the raw finger position, passed through only for the parent's auto-scroll edge check. */
  onDragUpdate: (fixtureId: string, contentX: number, contentY: number, absX: number, absY: number) => void
  onDragEnd: (fixtureId: string, dropped: boolean) => void
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
  const severity = placed.conflict?.severity ?? (placed.trainingReason ? "hard" : null)
  const reason = placed.conflict?.reason ?? placed.trainingReason
  const roomy = matchW >= 120
  const labelRoom = warmW >= 44
  // Section 22/43: the card's own type and required footprint, in words -- never left to be inferred
  // from the presence of an opponent. `footprint` comes from the SAME canonical requiredPitchSize the
  // rest of Pitch Allocation already resolves duration and minimum pitch size from (footprint.ts).
  const footprint = matchFootprintFor(f.requiredPitchSize).footprint
  const footprintText = footprintLabel(footprint)
  // COMPACT: a pitch drawn with more than one lane -- up to three concurrent bookings, split into
  // horizontal strips sharing roughly one lane's worth of height (`laneHeightFor` in geometry.ts) --
  // gives each fixture LESS VERTICAL ROOM than a fixture alone on its pitch. Below this threshold the
  // opponent line and the shoulder captions are dropped rather than clipped or overlapping.
  const compact = row.height < 90
  // THE MATCH'S OWN CONTENT-SPACE LEFT EDGE, exactly, at the moment of grab -- not the finger's screen
  // position converted through a measured origin. Wherever inside the card you grab it, this is what
  // moves; the card's own displacement (its OWN left/top, following the gesture's translation) is the
  // whole of the maths, and cannot go stale the way a cached absolute measurement can.
  const startLeft = left + warmW
  const startTop = row.top

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

  // ONE CONNECTED CARD, not three bordered boxes: a single outer border and radius (coloured by
  // severity/staged state) carries the whole reserved window; warm-up and pack-up are tinted flanks
  // inside it, not separate cards, matching the reference design.
  const cardBorderColor = severity === "hard" ? colour.danger : severity === "warning" ? colour.warning : isStaged ? colour.pitch600 : "rgba(18,61,44,0.22)"
  const cardBorderWidth = isStaged || severity ? 2 : 1
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ position: "absolute", left, top: row.top + (compact ? 2 : 4), width: total, height: row.height - (compact ? 4 : 8), shadowColor: "#071c14", shadowOffset: { width: 0, height: 4 }, opacity: isDragging ? 0.92 : 1 }, style]}>
        <Pressable
          accessible accessibilityRole="button" accessibilityLabel={a11y} onPress={() => onOpen(f)}
          style={{ flex: 1, flexDirection: "row", borderRadius: compact ? radius.sm : radius.md, borderWidth: cardBorderWidth, borderColor: cardBorderColor, overflow: "hidden", backgroundColor: colour.surface }}
        >
          {warmW > 0 && (
            <View style={{ width: warmW, backgroundColor: "rgba(16,21,18,0.05)", justifyContent: "flex-end", padding: 3 }}>
              {labelRoom && !compact && (
                <>
                  <Text style={[type.caption, { fontSize: 10, color: colour.inkMuted }]} numberOfLines={1}>Warm-up</Text>
                  <Text style={[type.caption, { fontSize: 10, color: colour.inkSubtle, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>{minutesToTime(start)}</Text>
                </>
              )}
            </View>
          )}
          <View style={{ width: matchW, backgroundColor: severity === "hard" ? colour.dangerSurface : severity === "warning" ? colour.warningSurface : colour.mint100, paddingHorizontal: compact ? 6 : 8, paddingVertical: compact ? 2 : 5, justifyContent: "center" }}>
            {roomy && !compact && (
              <Text style={[type.caption, { color: colour.forest800, fontSize: 9, letterSpacing: 0.4 }]} numberOfLines={1}>
                MATCH{footprintText ? ` · ${footprintText}` : ""}
              </Text>
            )}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              {severity && <TriangleAlert size={compact ? 10 : 12} color={severity === "hard" ? colour.danger : colour.warning} />}
              <Text style={[type.smallMedium, { color: colour.forest950, fontSize: compact ? 11 : roomy ? 13 : 12 }]} numberOfLines={roomy && !compact ? 2 : 1}>{f.homeTeamLabel}</Text>
            </View>
            {roomy && !compact && <Text style={[type.caption, { color: colour.inkMuted }]} numberOfLines={1}>v {f.opponentLabel}</Text>}
            <Text style={[type.caption, { color: colour.forest800, fontFamily: "Inter_600SemiBold", fontSize: compact ? 10 : 12 }]} numberOfLines={1}>
              {roomy && !compact ? `${minutesToTime(playStart)} – ${minutesToTime(playEnd)}` : minutesToTime(playStart)}{isStaged ? " · staged" : ""}
            </Text>
          </View>
          {packW > 0 && (
            <View style={{ width: packW, backgroundColor: "rgba(16,21,18,0.05)", justifyContent: "flex-end", padding: 3 }}>
              {packW >= 44 && !compact && (
                <>
                  <Text style={[type.caption, { fontSize: 10, color: colour.inkMuted }]} numberOfLines={1}>Pack-up</Text>
                  <Text style={[type.caption, { fontSize: 10, color: colour.inkSubtle, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>{minutesToTime(end)}</Text>
                </>
              )}
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

