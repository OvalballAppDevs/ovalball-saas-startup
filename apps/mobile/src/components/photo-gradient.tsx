import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg"

import { colour } from "../design/tokens"

/**
 * THE ONE DARK-BOTTOM OVERLAY every photographic surface in the app uses (`RugbyHero`,
 * `ProfileCoverPhoto`) — thin at the top so the photograph reads, deep at the foot so chalk text sits
 * on it reliably. Pulled out once so the Club Admin Home hero, its action tiles, its team cards and the
 * Team Profile cover all darken the same way rather than four hand-rolled gradients drifting apart.
 */
export function PhotoBottomShade({ strength = 0.85 }: { strength?: number }) {
  return (
    <Svg style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%">
      <Defs>
        <LinearGradient id="photoBottomShade" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0.35" stopColor={colour.forest950} stopOpacity="0" />
          <Stop offset="1" stopColor={colour.forest950} stopOpacity={strength} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#photoBottomShade)" />
    </Svg>
  )
}

/**
 * A HERO WITH ITS CONTROLS AT THE TOP AND ITS WORDS AT THE FOOT (Arena Home, the approved mock-up): forest
 * behind the floating back control and status bar, the photograph clear through the middle, and the foot
 * deepening into `ground` -- the page's own colour -- so the words read and the photograph dissolves into
 * the page beneath the stat card rather than ending at an edge. One smooth gradient, never flat bands.
 */
export function PhotoEdgeShade({ top = 0.62, ground = colour.forest950 }: { top?: number; ground?: string }) {
  return (
    <Svg pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%">
      <Defs>
        <LinearGradient id="photoEdgeShade" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colour.forest950} stopOpacity={top} />
          <Stop offset="0.28" stopColor={colour.forest950} stopOpacity="0.16" />
          <Stop offset="0.46" stopColor={colour.forest950} stopOpacity="0.34" />
          <Stop offset="0.74" stopColor={ground} stopOpacity="0.82" />
          <Stop offset="1" stopColor={ground} stopOpacity="1" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#photoEdgeShade)" />
    </Svg>
  )
}
