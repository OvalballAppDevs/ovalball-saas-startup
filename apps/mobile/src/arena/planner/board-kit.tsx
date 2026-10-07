import { useCallback, useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react"
import { Pressable, Text, View, useWindowDimensions } from "react-native"
import { Gesture } from "react-native-gesture-handler"
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming, type SharedValue } from "react-native-reanimated"

import { clock } from "@ovalball/contracts/arena"

import { haptic } from "../../pitch-allocation/haptics"
import { AUTO_SCROLL_EDGE, END_MINUTES, START_MINUTES, TIME_AXIS_WIDTH, autoScrollVelocity, minutesToY, timeMarks, type BoardScale } from "../../pitch-allocation/geometry"
import { Check, Sparkles, TriangleAlert } from "../../components/icons"
import { colour, familyOnForest, radius, space, type } from "../../design/tokens"

/**
 * THE PLANNING BOARDS' SHARED PARTS -- the Pitches board and the Changing Rooms board are two views of one plan,
 * so they are built from one kit: how a card lifts and follows the finger, how the board scrolls itself near an
 * edge, the hours down the left, the grid, a venue's name over its columns, the words for a state, and the calm
 * line that says what letting go would mean. A change to how moving feels is made here once and reaches both.
 */

export const LIFT = 22
/** How far past a boundary the finger must go before the drop changes column -- or, as a share of one slot, time. */
export const COLUMN_HYSTERESIS = 14
export const TIME_HYSTERESIS = 0.75
/** The board's own text stops growing here; the details a tap opens carry on to the reader's full size. */
export const BOARD_TEXT_CAP = 1.2

export const textWidth = (text: string, size: number) => text.length * size * 0.56

/**
 * HOW FAST THE BOARD SCROLLS FOR A FINGER NEAR ITS EDGE -- the shared rule, with the edge zone in proportion to the
 * board actually visible, and a little gentler: on a phone with the tray and the save bar open the board may be
 * under 300 points tall, and a fixed zone at each end would leave little of it where a card can be held still.
 */
export function edgeVelocity(position: number, extent: number): number {
  if (!(extent > 0)) return 0
  const edge = Math.min(Math.max(extent * 0.1, 22), AUTO_SCROLL_EDGE)
  const k = AUTO_SCROLL_EDGE / edge
  const far = 100000
  const v = position < extent / 2 ? autoScrollVelocity(position * k, far) : autoScrollVelocity(far - (extent - position) * k, far)
  return v * 0.35
}

/**
 * EDGE SCROLLING THAT WAITS TO BE ASKED: the finger has to rest near an edge for a moment before the board moves,
 * and then it speeds up gently -- a card carried past the edge on its way somewhere never sends the day flying.
 * What the finger is over is worked out again on every step, because the board moves under a still finger.
 */
export function useEdgeScroll(
  hRef: RefObject<Animated.ScrollView | null>,
  vRef: RefObject<Animated.ScrollView | null>,
  scrollX: SharedValue<number>,
  scrollY: SharedValue<number>,
  evaluate: RefObject<() => void>,
) {
  const auto = useRef<{ timer: ReturnType<typeof setInterval> | null; vx: number; vy: number; since: number }>({ timer: null, vx: 0, vy: 0, since: 0 })
  const setAutoScroll = useCallback((vx: number, vy: number) => {
    const moving = vx !== 0 || vy !== 0
    if (moving && auto.current.vx === 0 && auto.current.vy === 0) auto.current.since = Date.now()
    auto.current.vx = vx
    auto.current.vy = vy
    if (moving && !auto.current.timer) {
      auto.current.timer = setInterval(() => {
        const { vx: dx, vy: dy, since } = auto.current
        const ramp = Math.min(Math.max((Date.now() - since - 280) / 450, 0), 1)
        if (ramp === 0) return
        evaluate.current?.()
        if (dx !== 0) hRef.current?.scrollTo({ x: Math.max(0, scrollX.value + dx * ramp), animated: false })
        if (dy !== 0) vRef.current?.scrollTo({ y: Math.max(0, scrollY.value + dy * ramp), animated: false })
      }, 16)
    }
    if (!moving && auto.current.timer) {
      clearInterval(auto.current.timer)
      auto.current.timer = null
    }
  }, [hRef, vRef, scrollX, scrollY, evaluate])
  useEffect(() => () => { if (auto.current.timer) clearInterval(auto.current.timer) }, [])
  return setAutoScroll
}

/**
 * THE CARD IN THE HAND. It rises a little above the finger as it is picked up, follows the finger -- and the board,
 * when the board scrolls under a finger held still at its edge -- and, let go: settles where it was put when the
 * drop is accepted, or glides back to where it was when it is not. `horizontalOnly` keeps it on its own time: a
 * card whose time Arena may not move (a competition's kick-off, a session for someone without training authority)
 * still changes column, and its time stays put.
 */
export function useLift(canManage: boolean, reduceMotion: boolean, horizontalOnly: boolean, base: { left: number; top: number }, scrollX: SharedValue<number>, scrollY: SharedValue<number>, dropOk: SharedValue<number>, onLift: (absX: number, absY: number) => void, onDrag: (absX: number, absY: number) => void, onEnd: (dropped: boolean) => void) {
  const fx = useSharedValue(0)
  const fy = useSharedValue(0)
  const sx = useSharedValue(0)
  const sy = useSharedValue(0)
  const active = useSharedValue(0)
  const lifted = useSharedValue(0)
  const rx = useSharedValue(0)
  const ry = useSharedValue(0)
  const pan = useMemo(() => Gesture.Pan()
    .enabled(canManage)
    .activateAfterLongPress(350)
    .onStart((e) => {
      fx.value = 0
      fy.value = 0
      sx.value = scrollX.value
      sy.value = scrollY.value
      active.value = 1
      lifted.value = reduceMotion ? 1 : withSpring(1, { damping: 18, stiffness: 240 })
      runOnJS(haptic.lift)()
      runOnJS(onLift)(e.absoluteX, e.absoluteY)
    })
    .onUpdate((e) => {
      fx.value = e.translationX
      fy.value = horizontalOnly ? 0 : e.translationY
      runOnJS(onDrag)(e.absoluteX, e.absoluteY)
    })
    .onEnd(() => { runOnJS(onEnd)(true) })
    .onFinalize((_e, success) => {
      if (!success) runOnJS(onEnd)(false)
      const x = fx.value + (scrollX.value - sx.value)
      const y = horizontalOnly ? 0 : fy.value + (scrollY.value - sy.value) - LIFT * lifted.value
      active.value = 0
      rx.value = x
      ry.value = y
      if (success && dropOk.value === 1) {
        // Accepted: it stays where it was put until the board redraws it there (or, put back exactly where it
        // was, glides home a moment later).
        rx.value = withDelay(320, withTiming(0, { duration: 140 }))
        ry.value = withDelay(320, withTiming(0, { duration: 140 }))
      } else {
        rx.value = reduceMotion ? 0 : withTiming(0, { duration: 200 })
        ry.value = reduceMotion ? 0 : withTiming(0, { duration: 200 })
      }
      lifted.value = reduceMotion ? 0 : withTiming(0, { duration: 160 })
    }), [canManage, reduceMotion, horizontalOnly, onLift, onDrag, onEnd, fx, fy, sx, sy, active, lifted, rx, ry, scrollX, scrollY, dropOk])
  // Redrawn in its new place: the hand's offset is no longer needed.
  useEffect(() => { rx.value = 0; ry.value = 0 }, [base.left, base.top, rx, ry])
  const style = useAnimatedStyle(() => {
    const dragging = active.value === 1
    return {
      transform: [
        { translateX: dragging ? fx.value + (scrollX.value - sx.value) : rx.value },
        { translateY: dragging ? (horizontalOnly ? 0 : fy.value + (scrollY.value - sy.value)) - (horizontalOnly ? 0 : LIFT * lifted.value) : ry.value },
        { scale: 1 + lifted.value * 0.05 },
      ],
      zIndex: dragging || lifted.value > 0 ? 50 : 10,
      shadowOpacity: 0.05 + lifted.value * 0.28,
      shadowRadius: 3 + lifted.value * 16,
      elevation: 1 + lifted.value * 12,
    }
  })
  return { pan, style }
}

/** A venue's name over its columns, held at the left edge while its columns are scrolled under it; a long name over
 * a single column wraps onto a second line rather than being cut short. */
export function VenueBand({ band: b, height, scrollX }: { band: { venueId: string; name: string; left: number; right: number }; height: number; scrollX: SharedValue<number> }) {
  const span = b.right - b.left
  const { fontScale } = useWindowDimensions()
  const labelW = Math.min(span - 4, Math.ceil(textWidth(b.name, 11.5 * Math.min(Math.max(fontScale, 1), BOARD_TEXT_CAP))) + space.sm * 2)
  const label = useAnimatedStyle(() => ({ transform: [{ translateX: Math.min(Math.max(scrollX.value - b.left, 0), Math.max(span - 4 - labelW, 0)) }] }))
  return (
    <View accessible accessibilityRole="header" accessibilityLabel={b.name} style={{ position: "absolute", left: b.left + 2, width: span - 4, top: 0, height, justifyContent: "flex-end", paddingBottom: 2, borderBottomWidth: 2, borderBottomColor: colour.forest800, overflow: "hidden" }}>
      <Animated.View style={[{ width: labelW, paddingHorizontal: space.sm }, label]}>
        <Text maxFontSizeMultiplier={BOARD_TEXT_CAP} style={[type.caption, { color: colour.forest800, fontFamily: type.heading.fontFamily, fontSize: 11, lineHeight: 12 }]} numberOfLines={2}>{b.name}</Text>
      </Animated.View>
    </View>
  )
}

/**
 * A STATE ON A BLOCK, AS A WORD: "Unsaved" for a person's change, "Auto" for Ovalball's proposal, "Rooms taken" or
 * "Pitch taken" where Ovalball's proposal gives this match's place to another. Dark ink on a light ground, so it
 * reads at any size; it grows with the reader's text up to the board's cap.
 */
export function StateTag({ kind, compact }: { kind: "unsaved" | "auto" | "rooms" | "pitch"; compact?: boolean }) {
  const look = kind === "auto"
    ? { bg: colour.mint300, fg: colour.forest950, word: "Auto" }
    : kind === "rooms" || kind === "pitch"
      ? { bg: colour.warningSurface, fg: colour.warning, word: compact ? "Taken" : kind === "rooms" ? "Rooms taken" : "Pitch taken" }
      : { bg: colour.pitch400, fg: colour.forest950, word: "Unsaved" }
  const taken = kind === "rooms" || kind === "pitch"
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, minHeight: 18, borderRadius: 9, backgroundColor: look.bg, borderWidth: taken ? 1 : 0, borderColor: "rgba(138,90,0,0.35)" }}>
      {kind === "auto" && <Sparkles size={10} color={colour.forest950} />}
      {taken && <TriangleAlert size={10} color={colour.warning} />}
      <Text maxFontSizeMultiplier={BOARD_TEXT_CAP} style={[type.caption, { fontSize: 11, lineHeight: 14, color: look.fg, fontFamily: type.heading.fontFamily }]}>{look.word}</Text>
    </View>
  )
}

/** THE HOURS, frozen down the left: the hour strong, its quarters quiet, and on today's board a pill for now. */
export function TimeRail({ scale, height, nowMinute }: { scale: BoardScale; height: number; nowMinute: number | null }) {
  const marks = useMemo(() => timeMarks(scale), [scale])
  const showNow = nowMinute !== null && nowMinute >= START_MINUTES && nowMinute <= END_MINUTES
  return (
    <View style={{ width: TIME_AXIS_WIDTH, height, borderRightWidth: 1, borderRightColor: colour.line, backgroundColor: colour.chalk }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {marks.filter((m) => m.labelled).map((m) => (
        <Text key={m.minutes} maxFontSizeMultiplier={BOARD_TEXT_CAP}
          style={m.hour
            ? [type.caption, { position: "absolute", top: Math.max(0, minutesToY(m.minutes, scale) - 8), right: 7, fontSize: 13, lineHeight: 16, color: colour.ink, fontFamily: type.heading.fontFamily, fontVariant: ["tabular-nums"] }]
            : [type.caption, { position: "absolute", top: Math.max(0, minutesToY(m.minutes, scale) - 6), right: 7, fontSize: m.minutes % 30 === 0 ? 10.5 : 10, lineHeight: 12, color: m.minutes % 30 === 0 ? colour.inkMuted : colour.inkSubtle, fontVariant: ["tabular-nums"] }]}>
          {m.label}
        </Text>
      ))}
      {showNow && (
        <View style={{ position: "absolute", top: minutesToY(nowMinute!, scale) - 9, right: 3, paddingHorizontal: 4, height: 18, justifyContent: "center", borderRadius: 9, backgroundColor: colour.pitch600 }}>
          <Text maxFontSizeMultiplier={BOARD_TEXT_CAP} style={[type.caption, { color: colour.forest950, fontSize: 10, lineHeight: 12, fontFamily: type.heading.fontFamily, fontVariant: ["tabular-nums"] }]}>{clock(nowMinute!)}</Text>
        </View>
      )}
    </View>
  )
}

/** The time grid: the hour a firm line, the half hour a light one, the quarters barely there -- and now, today. */
export function TimeGrid({ scale, width, nowMinute }: { scale: BoardScale; width: number; nowMinute: number | null }) {
  const marks = useMemo(() => timeMarks(scale), [scale])
  const showNow = nowMinute !== null && nowMinute >= START_MINUTES && nowMinute <= END_MINUTES
  return (
    <>
      {marks.map((m) => (
        <View key={m.minutes} pointerEvents="none" style={{ position: "absolute", left: 0, width, top: minutesToY(m.minutes, scale), height: m.hour ? 1 : 0.75, backgroundColor: m.hour ? "rgba(16,21,18,0.12)" : m.minutes % 30 === 0 ? "rgba(16,21,18,0.055)" : "rgba(16,21,18,0.028)" }} />
      ))}
      {showNow && <View pointerEvents="none" style={{ position: "absolute", left: 0, width, top: minutesToY(nowMinute!, scale), height: 2, backgroundColor: colour.pitch600, opacity: 0.9, zIndex: 20 }} />}
    </>
  )
}

/**
 * WHAT LETTING GO WOULD MEAN -- calm, short, and away from the finger: what the drop would do, or why it cannot;
 * afterwards, briefly, what happened. Never an alert. When a refusal has somewhere to go ("Open Fixture") the line
 * offers it, and only then can it be tapped.
 */
export function DropPill({ top, bottom, tone, title, lines, action }: {
  top?: number
  bottom?: number
  tone: "ok" | "refused" | "plain"
  title: string
  lines?: string[]
  action?: { label: string; onPress: () => void } | null
}) {
  return (
    <View pointerEvents={action ? "box-none" : "none"} style={{ position: "absolute", ...(bottom !== undefined ? { bottom } : { top }), left: TIME_AXIS_WIDTH + space.sm, right: space.sm, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, backgroundColor: colour.forest950, shadowColor: colour.forest950, shadowOpacity: 0.22, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, zIndex: 60 }}>
      {tone === "refused" ? <TriangleAlert size={16} color={familyOnForest.amber} /> : tone === "ok" ? <Check size={16} color={colour.mint300} /> : null}
      <View style={{ flex: 1 }} pointerEvents="none">
        <Text maxFontSizeMultiplier={1.3} style={[type.smallMedium, { color: colour.onForest, fontFamily: type.heading.fontFamily, fontVariant: ["tabular-nums"] }]}>{title}</Text>
        {(lines ?? []).map((l, i) => (
          <Text key={i} maxFontSizeMultiplier={1.3} style={[type.caption, { color: tone === "refused" ? "#fde9b6" : colour.mint300, fontVariant: ["tabular-nums"] }]}>{l}</Text>
        ))}
      </View>
      {action && (
        <Pressable accessibilityRole="button" accessibilityLabel={action.label} onPress={action.onPress} hitSlop={8}
          style={({ pressed }) => ({ minHeight: 36, paddingHorizontal: space.md, justifyContent: "center", borderRadius: radius.pill, backgroundColor: pressed ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.14)", borderWidth: 1, borderColor: "rgba(255,255,255,0.28)" })}>
          <Text maxFontSizeMultiplier={1.3} style={[type.smallMedium, { color: colour.onForest, fontFamily: type.heading.fontFamily }]}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  )
}

/** A frozen header cell's words: the resource's name, a quieter line under it, and on today's board free or in use. */
export function ColumnHeader({ name, meta, now, children }: { name: string; meta: string; now: boolean | null; children?: ReactNode }) {
  return (
    <>
      <Text style={[type.smallMedium, { color: colour.ink, fontFamily: type.heading.fontFamily, fontSize: 13, lineHeight: 16 }]} numberOfLines={2} maxFontSizeMultiplier={BOARD_TEXT_CAP}>{name}</Text>
      <Text style={[type.caption, { color: colour.inkMuted, fontSize: 11, lineHeight: 14 }]} numberOfLines={1} maxFontSizeMultiplier={BOARD_TEXT_CAP}>{meta}</Text>
      {now !== null && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 1 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: now ? colour.forest800 : colour.pitch600 }} />
          <Text style={[type.caption, { color: now ? colour.ink : colour.forest800, fontSize: 11, lineHeight: 14, fontFamily: type.smallMedium.fontFamily }]} maxFontSizeMultiplier={BOARD_TEXT_CAP}>{now ? "In use" : "Free now"}</Text>
        </View>
      )}
      {children}
    </>
  )
}
