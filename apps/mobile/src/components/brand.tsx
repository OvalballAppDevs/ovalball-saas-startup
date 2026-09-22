import { Text, View } from "react-native"
import Svg, { Ellipse } from "react-native-svg"

import { colour, type } from "../design/tokens"

/**
 * THE OVALBALL MARK, drawn rather than shipped as an image.
 *
 * Two protected logo files exist in `public/icons` and are explicitly not to be touched, copied or
 * re-encoded, so the app does not reach for them. The mark is instead the one geometric idea the
 * brand is built on -- an outlined oval -- expressed as a vector that is sharp at any size and needs
 * no asset pipeline.
 *
 * The wordmark's split weight (OVAL in chalk, BALL in pitch green) is the brand's own treatment and is
 * reproduced here rather than reinvented.
 */
export function OvalballMark({ size = 96, tint = colour.chalk }: { size?: number; tint?: string }) {
  const height = size * 0.62
  return (
    <Svg width={size} height={height} viewBox="0 0 100 62" accessibilityRole="image" accessibilityLabel="Ovalball">
      <Ellipse
        cx={50}
        cy={31}
        rx={44}
        ry={25}
        stroke={tint}
        strokeWidth={9}
        fill="none"
        transform="rotate(-18 50 31)"
      />
    </Svg>
  )
}

export function OvalballWordmark({ size = 34, onDark = true }: { size?: number; onDark?: boolean }) {
  const base = onDark ? colour.chalk : colour.forest800
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="Ovalball" style={{ flexDirection: "row" }}>
      <Text style={[type.display, { fontSize: size, lineHeight: size * 1.1, color: base }]}>OVAL</Text>
      <Text style={[type.display, { fontSize: size, lineHeight: size * 1.1, color: colour.pitch600 }]}>BALL</Text>
    </View>
  )
}
