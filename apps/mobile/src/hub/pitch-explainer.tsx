import { useState } from "react"
import { Pressable, Text, View, useWindowDimensions } from "react-native"
import Svg, { Line, Rect } from "react-native-svg"

import { colour, radius, space, type, TOUCH_TARGET } from "../design/tokens"
import { useReduceMotion } from "./visuals/explainer"

/**
 * THE PITCH, DRAWN NATIVELY — standard rugby union markings as vector, never as a picture.
 *
 * Geometry is the Laws' own: goal lines with an in-goal behind each, dead-ball lines, 22-metre
 * lines, 10-metre lines, halfway, the dashed 5- and 15-metre lines, touchlines, posts. Regions with a
 * canonical glossary term are buttons that hand the term's key to the caller, whose explanation is
 * the term's own text; the rest are labelled marks. This file draws lines and names them; it explains
 * nothing itself.
 */
interface Region {
  id: string
  label: string
  termKey: string | null
  /** viewBox rect */
  x: number
  y: number
  w: number
  h: number
}

// viewBox 0..100 (width), 0..156 (length): in-goal 0–12 and 144–156, goal lines at 12 and 144,
// 22-metre lines at 40 and 116, 10-metre lines at 65 and 91, halfway at 78.
const REGIONS: Region[] = [
  { id: "in-goal-top", label: "In-goal (try)", termKey: "try", x: 2, y: 2, w: 96, h: 10 },
  { id: "twenty-two-top", label: "22-metre area", termKey: null, x: 2, y: 12, w: 96, h: 28 },
  { id: "middle", label: "Between the 22s (territory)", termKey: "territory", x: 2, y: 40, w: 96, h: 76 },
  { id: "twenty-two-bottom", label: "22-metre area", termKey: null, x: 2, y: 116, w: 96, h: 28 },
  { id: "in-goal-bottom", label: "In-goal (try)", termKey: "try", x: 2, y: 144, w: 96, h: 10 },
]

const LINES: { label: string; y: number; dashed?: boolean; strong?: boolean }[] = [
  { label: "Dead-ball line", y: 2 },
  { label: "Goal line", y: 12, strong: true },
  { label: "22-metre line", y: 40 },
  { label: "10-metre line", y: 65, dashed: true },
  { label: "Halfway line", y: 78, strong: true },
  { label: "10-metre line", y: 91, dashed: true },
  { label: "22-metre line", y: 116 },
  { label: "Goal line", y: 144, strong: true },
  { label: "Dead-ball line", y: 154 },
]

export function HubPitchExplainer({ onOpenTerm }: { onOpenTerm: (termKey: string) => void }) {
  const { width } = useWindowDimensions()
  const reduceMotion = useReduceMotion()
  void reduceMotion // no motion is used; selection is a plain state change either way
  const w = Math.min(width - space.lg * 2, 420)
  const h = Math.round((w * 156) / 100)
  const stroke = "rgba(248,250,247,0.6)"
  const [selected, setSelected] = useState<string | null>(null)
  const sel = REGIONS.find((r) => r.id === selected) ?? null

  return (
    <View style={{ gap: space.md }}>
      <View style={{ width: w, height: h, alignSelf: "center", borderRadius: radius.xl, overflow: "hidden" }}>
        <Svg width={w} height={h} viewBox="0 0 100 156" preserveAspectRatio="none" accessible={false} importantForAccessibility="no-hide-descendants">
          <Rect x={0} y={0} width={100} height={156} fill={colour.forest900} />
          {/* in-goal areas, slightly lighter */}
          <Rect x={2} y={2} width={96} height={10} fill="rgba(248,250,247,0.06)" />
          <Rect x={2} y={144} width={96} height={10} fill="rgba(248,250,247,0.06)" />
          {/* touchlines */}
          <Line x1={2} y1={2} x2={2} y2={154} stroke={stroke} strokeWidth={0.5} />
          <Line x1={98} y1={2} x2={98} y2={154} stroke={stroke} strokeWidth={0.5} />
          {LINES.map((l) => (
            <Line key={`${l.label}-${l.y}`} x1={2} y1={l.y} x2={98} y2={l.y} stroke={stroke} strokeWidth={l.strong ? 0.7 : 0.4} strokeDasharray={l.dashed ? "1.5 1.5" : undefined} />
          ))}
          {/* 5-metre and 15-metre dashed lines along each touchline, between the goal lines */}
          {[7, 93, 17, 83].map((x) => (
            <Line key={`long-${x}`} x1={x} y1={12} x2={x} y2={144} stroke={stroke} strokeWidth={0.3} strokeDasharray="1.2 2" />
          ))}
          {/* posts on each goal line */}
          <Line x1={47} y1={9} x2={47} y2={15} stroke={colour.chalk} strokeWidth={0.8} />
          <Line x1={53} y1={9} x2={53} y2={15} stroke={colour.chalk} strokeWidth={0.8} />
          <Line x1={47} y1={12} x2={53} y2={12} stroke={colour.chalk} strokeWidth={0.8} />
          <Line x1={47} y1={141} x2={47} y2={147} stroke={colour.chalk} strokeWidth={0.8} />
          <Line x1={53} y1={141} x2={53} y2={147} stroke={colour.chalk} strokeWidth={0.8} />
          <Line x1={47} y1={144} x2={53} y2={144} stroke={colour.chalk} strokeWidth={0.8} />
          {sel && <Rect x={sel.x} y={sel.y} width={sel.w} height={sel.h} fill="rgba(90,203,131,0.22)" stroke={colour.pitch400} strokeWidth={0.6} />}
        </Svg>
        {REGIONS.map((r) => (
          <Pressable
            key={r.id}
            accessibilityRole="button"
            accessibilityLabel={r.label}
            accessibilityHint={r.termKey ? "Shows the glossary term for this area" : "Highlights this area"}
            accessibilityState={{ selected: r.id === selected }}
            onPress={() => setSelected(r.id)}
            style={{ position: "absolute", left: (r.x / 100) * w, top: (r.y / 156) * h, width: (r.w / 100) * w, height: Math.max((r.h / 156) * h, TOUCH_TARGET) }}
          />
        ))}
        {/* native labels for the lines */}
        {LINES.filter((l) => l.strong || l.label.startsWith("22")).map((l) => (
          <Text key={`label-${l.y}`} pointerEvents="none" style={[type.caption, { position: "absolute", right: 8, top: (l.y / 156) * h - 14, color: "rgba(248,250,247,0.85)" }]}>
            {l.label}
          </Text>
        ))}
      </View>
      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.lg, gap: space.sm }}>
        {sel ? (
          <>
            <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
              {sel.label}
            </Text>
            {sel.termKey ? (
              <Pressable accessibilityRole="link" accessibilityLabel={`Open the glossary term for ${sel.label}`} onPress={() => onOpenTerm(sel.termKey!)} style={{ minHeight: TOUCH_TARGET, justifyContent: "center" }}>
                <Text style={[type.smallMedium, { color: colour.forest800, textDecorationLine: "underline" }]}>Read the glossary term</Text>
              </Pressable>
            ) : (
              <Text style={[type.small, { color: colour.inkMuted }]}>A standard marking on a rugby union pitch.</Text>
            )}
          </>
        ) : (
          <Text style={[type.small, { color: colour.inkMuted }]}>Tap an area of the pitch to name it.</Text>
        )}
      </View>
      <View accessible accessibilityRole="summary" style={{ gap: 4 }}>
        <Text style={[type.overline, { color: colour.inkSubtle }]}>IN WORDS</Text>
        <Text style={[type.small, { color: colour.inkMuted }]}>{`From one end: dead-ball line, in-goal area, goal line with posts, 22-metre line, 10-metre line, halfway line, then the same in reverse. Touchlines run the length of each side, with dashed 5- and 15-metre lines inside them.`}</Text>
      </View>
    </View>
  )
}
