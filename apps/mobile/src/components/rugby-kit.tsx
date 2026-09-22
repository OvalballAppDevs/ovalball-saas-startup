import Svg, { ClipPath, Defs, G, Path, Rect } from "react-native-svg"
import { View } from "react-native"

import {
  KIT_BODY_PATH,
  KIT_COLLAR_PATH,
  KIT_VIEWBOX,
  describeKit,
  kitShapes,
  type KitConfig,
} from "@ovalball/contracts/agenda/kit"

/**
 * THE RUGBY SHIRT -- THE APP'S RENDERER OF THE WEBSITE'S SHIRT.
 *
 * A child recognises the shirt they are about to put on far faster than a club
 * badge, and two clubs in the same league often have similar crests and never
 * similar kits. That is why the Match Centre hero gives the kit equal billing
 * with the crest, on both clients.
 *
 * NOTHING ABOUT THE SHIRT IS DECIDED HERE. The body path, the collar, the
 * pattern primitives and the accessible description all come from
 * `@ovalball/contracts/agenda/kit`, which the web's `<svg>` renderer draws from
 * too. This file is the `react-native-svg` translation of that one list, so a
 * club that adjusts its kit sees the same change on both, and an adjustment to
 * the geometry cannot land on one and not the other.
 *
 * COLOUR IS NEVER THE ONLY CARRIER. The accessible label is the shared
 * `describeKit`, which produces "Burnley RUFC primary kit: light blue and claret
 * hoops" from the canonical pattern and the colour values themselves -- so a
 * screen reader hears the kit rather than a hex code, identically on both
 * clients.
 */
export function RugbyKit({
  kit,
  clubName,
  variant = "primary",
  size = 64,
  outline = "rgba(255,255,255,0.18)",
}: {
  kit: KitConfig
  clubName?: string
  variant?: "primary" | "alternate"
  size?: number
  /** The seam colour. The web inherits it from the page; React Native has no cascade, so it is passed. */
  outline?: string
}) {
  const primary = kit.primaryColour
  const secondary = kit.secondaryColour ?? kit.primaryColour
  const accent = kit.accentColour ?? secondary
  const label = describeKit(kit, clubName, variant)

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label}>
      <Svg width={size} height={size} viewBox={`0 0 ${KIT_VIEWBOX} ${KIT_VIEWBOX}`}>
        <Defs>
          <ClipPath id="kitBody">
            <Path d={KIT_BODY_PATH} />
          </ClipPath>
        </Defs>

        <Path d={KIT_BODY_PATH} fill={primary} />

        {/* Clipped to the body, so a sash or a hoop can never paint outside the garment. */}
        <G clipPath="url(#kitBody)">
          {kitShapes(kit.pattern).map((shape, i) =>
            shape.kind === "rect" ? (
              <Rect key={i} x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill={secondary} />
            ) : (
              <Path
                key={i}
                d={shape.d}
                fill={secondary}
                translate={shape.translate ? [shape.translate.x, shape.translate.y] : undefined}
              />
            )
          )}
        </G>

        {/* Collar and seams last, in the trim colour, so the silhouette reads. */}
        <Path d={KIT_COLLAR_PATH} fill={accent} stroke={accent} strokeWidth={1.5} strokeLinejoin="round" />
        <Path d={KIT_BODY_PATH} fill="none" stroke={outline} strokeWidth={1.5} />
      </Svg>
    </View>
  )
}

/**
 * WHAT A FIXTURE CARD SHOWS WHEN THE OPPOSITION HAS NO RECORDED KIT.
 *
 * A club with no structured kit is a real and common state -- an opposition that
 * is only a Club Directory entry almost always is. It gets a deliberate,
 * finished placeholder rather than an empty box, exactly as on the web: the same
 * silhouette, dashed, at a fraction of the opacity.
 */
export function KitPlaceholder({ size = 64, label = "Kit not recorded", tint = "rgba(255,255,255,0.30)" }: { size?: number; label?: string; tint?: string }) {
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label}>
      <Svg width={size} height={size} viewBox={`0 0 ${KIT_VIEWBOX} ${KIT_VIEWBOX}`}>
        <Path
          d={KIT_BODY_PATH}
          fill={tint}
          fillOpacity={0.06}
          stroke={tint}
          strokeWidth={1.5}
          strokeDasharray="3 3"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  )
}
