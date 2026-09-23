import { View } from "react-native"
import { Image } from "expo-image"
import Svg, { Path } from "react-native-svg"

import { colour } from "../design/tokens"

/**
 * THE OVALBALL MARK — a professional reproduction of the canonical artwork, not a redesign.
 *
 * The canonical mark is `public/icons/Ovalball Square Logo.png`, which is protected and is only ever
 * READ. Its geometry was measured from that file (`scratchpad/welcome/fit-ring.mjs`): the ring is an
 * outer ellipse (centre 649.2,487.9 · 356.5×180.2 · −20.5°) minus an inner ellipse that is offset and
 * turned a little differently (646.8,492.4 · 287.4×120.2 · −17.7°), which is why the band is broad at
 * the lower left and fine at the upper right. Drawn as one even-odd path it overlaps the original's
 * ring pixels at IoU 0.954 -- the remainder is anti-aliasing. A vector is sharp at any size and needs
 * no asset pipeline; there is no glow, gradient, bevel or shadow because the master has none.
 *
 * The wordmark is the file's OWN letterforms: lifted from the canonical PNG with alpha recovered from
 * its luminance and green, never re-typeset in a look-alike face. OVAL is chalk on a dark ground and
 * deep forest on a light one; BALL is the mark's own green in both.
 */
export const BRAND_GREEN = "#03ac63"

/** Measured outer-minus-inner ring, in the canonical 1254-square's coordinates. */
export const RING_PATH =
  "M 315.30 612.62 A 356.47 180.17 -20.48 1 0 983.18 363.18 A 356.47 180.17 -20.48 1 0 315.30 612.62 Z " +
  "M 373.11 579.93 A 287.35 120.21 -17.74 1 0 920.49 404.83 A 287.35 120.21 -17.74 1 0 373.11 579.93 Z"
/** The ring's bounding box in those coordinates (x 309–989, y 278–698). */
const RING_BOX = { x: 309.4, y: 278.0, w: 679.7, h: 419.8 }

export function OvalballMark({ size = 96, tint = colour.chalk }: { size?: number; tint?: string }) {
  const height = size * (RING_BOX.h / RING_BOX.w)
  return (
    <Svg
      width={size}
      height={height}
      viewBox={`${RING_BOX.x} ${RING_BOX.y} ${RING_BOX.w} ${RING_BOX.h}`}
      accessibilityRole="image"
      accessibilityLabel="Ovalball"
    >
      <Path d={RING_PATH} fill={tint} fillRule="evenodd" />
    </Svg>
  )
}

const WORDMARK = {
  dark: require("../../assets/welcome/ovalball-wordmark-on-dark.png"),
  light: require("../../assets/welcome/ovalball-wordmark-on-light.png"),
}
/** 1778 × 236 at 2x: the cap height is the whole image height. */
const WORDMARK_RATIO = 236 / 1778

/**
 * `size` is the cap height in points, as it was when this was set in type, so every existing caller
 * keeps its proportions. The image is 889 px wide at 1x, so nothing up to a 296-pt-wide wordmark on a
 * 3× screen is ever upscaled.
 */
export function OvalballWordmark({ size = 34, onDark = true }: { size?: number; onDark?: boolean }) {
  const width = size / WORDMARK_RATIO
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="Ovalball">
      <Image
        source={onDark ? WORDMARK.dark : WORDMARK.light}
        style={{ width, height: size }}
        contentFit="contain"
        accessible={false}
      />
    </View>
  )
}
