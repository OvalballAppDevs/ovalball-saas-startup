import { View } from "react-native"
import Svg, { Defs, Ellipse, G, Line, LinearGradient, Path, Rect, Stop } from "react-native-svg"

import type { ClubAccents } from "@ovalball/contracts"

/**
 * A RUGBY BALL IN THE CLUB'S OWN COLOURS — drawn, never generated.
 *
 * ONE APPLICATION-OWNED SHAPE, coloured from the club's canonical accents. There
 * is no image per club to go stale when a Club Admin changes the home kit: the
 * next read projects the new colours and the ball follows, with nothing between
 * `club_kits` and this file but the accent projection.
 *
 * COMPOSED, NOT CLIPPED. The first attempt was a rotated rectangle with two bars
 * across it, tucked half off the card's corner -- which read as an unfinished
 * placeholder, because that is what it was. This is a ball: an ellipse with a
 * darker lower half for volume, a lace panel, a seam, and two hoops in the club's
 * highlight colour, sitting whole inside the card rather than escaping it.
 *
 * DECORATION, AND IT KNOWS IT. Hidden from assistive technology; a screen reader
 * hearing "rugby ball" before the match it is behind would be noise.
 */
export function ClubBall({ accents, size = 132 }: { accents: ClubAccents; size?: number }) {
  const w = size
  const h = size * 0.6
  const cx = w / 2
  const cy = h / 2
  const rx = w / 2 - 2
  const ry = h / 2 - 2
  // The ball's body is the club's primary. For a club whose primary lifts to
  // near-white that is a pale ball with coloured hoops -- which is what their
  // kit looks like -- and the lower half is shaded so it reads as a solid thing.
  const body = accents.primary
  const hoop = accents.highlight === accents.primary ? accents.secondary : accents.highlight
  const seam = accents.onPrimary

  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width: w, height: h }}>
      <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <Defs>
          <LinearGradient id="ballShade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#ffffff" stopOpacity="0.18" />
            <Stop offset="0.55" stopColor="#000000" stopOpacity="0" />
            <Stop offset="1" stopColor="#000000" stopOpacity="0.32" />
          </LinearGradient>
          <LinearGradient id="hoopShade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000000" stopOpacity="0" />
            <Stop offset="1" stopColor="#000000" stopOpacity="0.28" />
          </LinearGradient>
        </Defs>
        <G rotation={-18} origin={`${cx}, ${cy}`}>
          <Ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={body} />
          {/* Two hoops, clipped to the ellipse by drawing them as arcs of it. */}
          <Path d={hoopPath(cx, cy, rx, ry, 0.26, 0.11)} fill={hoop} />
          <Path d={hoopPath(cx, cy, rx, ry, 0.56, 0.11)} fill={hoop} />
          <Path d={hoopPath(cx, cy, rx, ry, 0.26, 0.11)} fill="url(#hoopShade)" />
          <Path d={hoopPath(cx, cy, rx, ry, 0.56, 0.11)} fill="url(#hoopShade)" />
          {/* The seam and the laces. */}
          <Line x1={cx - rx * 0.62} y1={cy} x2={cx + rx * 0.62} y2={cy} stroke={seam} strokeOpacity="0.55" strokeWidth={1.6} strokeLinecap="round" />
          {[-0.18, -0.06, 0.06, 0.18].map((t) => (
            <Rect key={t} x={cx + rx * t - 1} y={cy - ry * 0.16} width={2} height={ry * 0.32} rx={1} fill={seam} fillOpacity="0.6" />
          ))}
          {/* Volume over everything. */}
          <Ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="url(#ballShade)" />
        </G>
      </Svg>
    </View>
  )
}

/**
 * A vertical band across an ellipse, as a path, so the hoops end exactly at the
 * ball's own edge instead of poking out of it.
 */
function hoopPath(cx: number, cy: number, rx: number, ry: number, at: number, width: number): string {
  const x0 = cx - rx + 2 * rx * at
  const x1 = x0 + 2 * rx * width
  const y = (x: number) => ry * Math.sqrt(Math.max(0, 1 - ((x - cx) / rx) ** 2))
  return `M ${x0} ${cy - y(x0)} L ${x1} ${cy - y(x1)} A ${rx} ${ry} 0 0 1 ${x1} ${cy + y(x1)} L ${x0} ${cy + y(x0)} A ${rx} ${ry} 0 0 0 ${x0} ${cy - y(x0)} Z`
}

/**
 * A club's colours as a quiet band at the edge of a surface -- the approved
 * design's diagonal motif, kept to an edge where it cannot sit behind text.
 */
export function ClubAccentEdge({ accents, height = 4 }: { accents: ClubAccents; height?: number }) {
  return (
    <View accessible={false} pointerEvents="none" style={{ flexDirection: "row", height, borderRadius: height, overflow: "hidden" }}>
      <View style={{ flex: 2, backgroundColor: accents.highlight }} />
      <View style={{ flex: 1, backgroundColor: accents.primary, opacity: 0.6 }} />
    </View>
  )
}
