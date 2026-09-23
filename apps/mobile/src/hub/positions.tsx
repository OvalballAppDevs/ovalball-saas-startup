import { Pressable, Text, View, useWindowDimensions } from "react-native"
import Svg, { Circle, Line, Rect } from "react-native-svg"
import type { AgeStage, PositionExplorerBundle, PositionSummary } from "@ovalball/contracts/rugby-hub/position-explorer-data"

import { colour, radius, space, type } from "../design/tokens"
import { HubCallout } from "./ui"

/**
 * THE PITCH — an original Ovalball drawing with a real button per position.
 *
 * Markers are placed by each position's own normalised pitch anchor, never a
 * hard-coded layout, and every marker is a focusable, labelled button; the
 * field itself is decorative and hidden from assistive technology. Below it
 * the same positions are listed by family, so nobody has to find a marker to
 * reach a position.
 */
export function PositionPitch({ bundle, onSelect, selectedKey }: { bundle: PositionExplorerBundle; onSelect: (p: PositionSummary) => void; selectedKey?: string | null }) {
  const { width } = useWindowDimensions()
  const w = Math.min(width - space.lg * 2, 420)
  const h = Math.round((w * 7) / 5)
  const stroke = "rgba(248,250,247,0.55)"
  const league = bundle.rugbyCode === "league"
  return (
    <View style={{ width: w, height: h, alignSelf: "center", borderRadius: radius.xl, overflow: "hidden" }}>
      <Svg width={w} height={h} viewBox="0 0 100 140" preserveAspectRatio="none" accessible={false} importantForAccessibility="no-hide-descendants">
        <Rect x={0} y={0} width={100} height={140} rx={2} fill={league ? "#132733" : colour.forest900} />
        <Rect x={2} y={2} width={96} height={136} fill="none" stroke={stroke} strokeWidth={0.4} />
        <Line x1={2} y1={14} x2={98} y2={14} stroke={stroke} strokeWidth={0.4} />
        <Line x1={2} y1={126} x2={98} y2={126} stroke={stroke} strokeWidth={0.4} />
        <Line x1={2} y1={70} x2={98} y2={70} stroke={stroke} strokeWidth={0.5} />
        <Line x1={2} y1={36} x2={98} y2={36} stroke={stroke} strokeWidth={0.3} strokeDasharray="1.2 1.2" />
        <Line x1={2} y1={104} x2={98} y2={104} stroke={stroke} strokeWidth={0.3} strokeDasharray="1.2 1.2" />
        <Circle cx={50} cy={70} r={0.8} fill={stroke} />
      </Svg>
      {bundle.positions.map((p) => {
        const size = 40
        const left = (p.pitchAnchorX ?? 0.5) * w - size / 2
        const top = (p.pitchAnchorY ?? 0.5) * h - size / 2
        const on = p.positionKey === selectedKey
        return (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={`${p.displayName}${p.shirtNumber ? `, number ${p.shirtNumber}` : ""}`}
            accessibilityHint="Opens what this position does"
            onPress={() => onSelect(p)}
            hitSlop={4}
            style={({ pressed }) => ({
              position: "absolute",
              left,
              top,
              width: size,
              height: size,
              borderRadius: size / 2,
              borderWidth: 2,
              borderColor: on || pressed ? colour.chalk : "rgba(248,250,247,0.45)",
              backgroundColor: on ? colour.pitch400 : pressed ? colour.forest800 : "rgba(18,61,44,0.92)",
              alignItems: "center",
              justifyContent: "center",
            })}
          >
            <Text style={[type.smallMedium, { color: on ? colour.ink : colour.chalk, fontFamily: "Inter_600SemiBold" }]}>{p.shirtNumber ?? p.displayName.charAt(0)}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/**
 * The age-stage banner: NOT_APPLICABLE and EMERGING are real, sourced states
 * from the governing body's own note; NORMAL and UNASSESSED draw nothing,
 * because an unresearched identity gets ordinary exploration rather than a
 * fabricated claim either way.
 */
export function AgeStageBanner({ stage, note }: { stage: AgeStage; note: string | null }) {
  if (stage === "NORMAL" || stage === "UNASSESSED" || !note) return null
  const notApplicable = stage === "NOT_APPLICABLE"
  return (
    <HubCallout heading={notApplicable ? "At your stage, everyone plays every role" : "Positions are still emerging at your stage"}>
      {note}
    </HubCallout>
  )
}

/** When every position in a code shares one stage for this viewer, it is the code's stage and is shown once above the pitch. */
export function resolveCodeAgeStage(bundle: PositionExplorerBundle): { stage: AgeStage; note: string | null } | null {
  if (bundle.positions.length === 0) return null
  const [first, ...rest] = bundle.positions
  if (first.ageStage === "NORMAL" || first.ageStage === "UNASSESSED") return null
  if (rest.every((p) => p.ageStage === first.ageStage)) return { stage: first.ageStage, note: first.ageStageNote }
  return null
}

/** `FRONT_ROW` -> `Front row`, for the family line under a position's name. */
export function familySentence(family: string): string {
  const words = family.replaceAll("_", " ").toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
