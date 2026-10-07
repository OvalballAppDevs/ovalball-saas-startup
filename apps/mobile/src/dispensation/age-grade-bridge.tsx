import { Text, View } from "react-native"
import Svg, { Circle, G, Line, Rect, Text as SvgText } from "react-native-svg"

import { dispensationLadder, dispensationLadderSentence, type DispensationRecord } from "@ovalball/contracts/team/dispensation"

import { colour, font, radius, space, type } from "../design/tokens"

/**
 * THE AGE-GRADE BRIDGE -- the phone's drawing of the one picture the website draws too, from the same
 * `dispensationLadder` (packages/contracts/src/team/dispensation.ts): the child's grade filled, the team's
 * outlined, and the bridge between them dashed amber while a request waits, solid green once approved,
 * broken grey otherwise. VoiceOver reads one sentence instead of the drawing.
 */
const RUNG = 88
const BOX_W = 72
const BOX_H = 44

const BRIDGE = {
  waiting: { stroke: colour.warning, dash: "7 6", width: 3 },
  built: { stroke: colour.pitch600, dash: undefined, width: 4 },
  broken: { stroke: "#9ca3a0", dash: "3 8", width: 3 },
} as const

export function AgeGradeBridge({ record }: { record: Pick<DispensationRecord, "playerAgeGroup" | "teamAgeGroup" | "verdict" | "status" | "player" | "team"> }) {
  const ladder = dispensationLadder(record)
  if (!ladder) return null
  const width = ladder.rungs.length * RUNG
  const playerAt = ladder.rungs.findIndex((r) => r.role === "player")
  const teamAt = ladder.rungs.findIndex((r) => r.role === "team")
  const cx = (i: number) => i * RUNG + RUNG / 2
  const from = cx(Math.min(playerAt, teamAt))
  const to = cx(Math.max(playerAt, teamAt))
  const bridge = BRIDGE[ladder.bridge]
  const y = 8 + BOX_H + 14
  const gap = ladder.bridge === "broken" ? 14 : 0
  const mid = (from + to) / 2
  const height = y + 10

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={dispensationLadderSentence(record)} style={{ gap: space.sm }}>
      <View style={{ width: "100%", aspectRatio: width / height, maxWidth: 420 }}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
          {ladder.rungs.map((rung, i) => {
            const x = i * RUNG + (RUNG - BOX_W) / 2
            const player = rung.role === "player"
            const team = rung.role === "team"
            return (
              <G key={rung.grade}>
                <Rect
                  x={x}
                  y={8}
                  width={BOX_W}
                  height={BOX_H}
                  rx={10}
                  fill={player ? colour.forest800 : team ? "#ffffff" : "transparent"}
                  stroke={player || team ? colour.forest800 : "rgba(16,21,18,0.14)"}
                  strokeWidth={team ? 2.5 : 1.5}
                  strokeDasharray={rung.role === "edge" ? "4 4" : undefined}
                />
                <SvgText
                  x={x + BOX_W / 2}
                  y={8 + BOX_H / 2 + 8}
                  textAnchor="middle"
                  fontSize={24}
                  fontFamily={font.display}
                  letterSpacing={1}
                  fill={player ? "#ffffff" : team ? colour.forest800 : "#8a8f8b"}
                >
                  {rung.grade}
                </SvgText>
              </G>
            )
          })}
          <Line x1={from} y1={y} x2={gap ? mid - gap / 2 : to} y2={y} stroke={bridge.stroke} strokeWidth={bridge.width} strokeDasharray={bridge.dash} strokeLinecap="round" />
          {gap > 0 && <Line x1={mid + gap / 2} y1={y} x2={to} y2={y} stroke={bridge.stroke} strokeWidth={bridge.width} strokeDasharray={bridge.dash} strokeLinecap="round" />}
          <Circle cx={from} cy={y} r={5} fill={bridge.stroke} />
          <Circle cx={to} cy={y} r={5} fill={bridge.stroke} />
        </Svg>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space.lg, rowGap: space.xs }} importantForAccessibility="no-hide-descendants">
        <Legend filled label={record.player.firstName ? `${record.player.firstName}'s age grade` : "Their age grade"} />
        <Legend filled={false} label={record.team.label} />
      </View>
    </View>
  )
}

function Legend({ filled, label }: { filled: boolean; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View
        style={{
          width: 12,
          height: 12,
          borderRadius: radius.sm / 2,
          backgroundColor: filled ? colour.forest800 : "#ffffff",
          borderWidth: filled ? 0 : 2,
          borderColor: colour.forest800,
        }}
      />
      <Text style={[type.small, { color: colour.inkMuted }]}>{label}</Text>
    </View>
  )
}
