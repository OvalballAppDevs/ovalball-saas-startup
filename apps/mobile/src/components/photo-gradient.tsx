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
