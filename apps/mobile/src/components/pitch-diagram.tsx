import Svg, { Defs, G, Line, LinearGradient, Path, Rect, Stop } from "react-native-svg"
import { View } from "react-native"

/**
 * A RUGBY PITCH, DRAWN -- the same pitch the website draws.
 *
 * WHY THIS EXISTS. The canonical pitch is a name -- "Pitch 2", "Top Field",
 * "Bottom Pitch 3" -- and printing that name as a line of text told a parent
 * standing at a gate almost nothing. Drawing the pitch does not tell them where
 * it is either, and this component is careful not to pretend otherwise: it is
 * not a map of the ground, it does not know where Pitch 2 sits relative to Pitch
 * 1, and it never implies it does. What it does is make the pitch READ as a
 * place rather than a string, and carry the club's own name for it at the size a
 * name deserves.
 *
 * Anything more would be an invention. Ovalball does not hold a survey of any
 * club's grounds, and a diagram that placed pitches relative to each other would
 * be fabricating one -- the sort of plausible detail somebody would follow, and
 * then not find the pitch.
 *
 * WHAT IS ACCURATE HERE. The markings are World Rugby's, in proportion: a 100m
 * field of play with 22m lines, a halfway line, 10m dashed lines either side of
 * halfway, 5m dashed lines, and in-goal areas. A rugby person reads it as a rugby
 * pitch immediately, which is the whole point of drawing it rather than a green
 * rectangle.
 *
 * EVERY COORDINATE IS THE WEB COMPONENT'S. This is the react-native-svg
 * translation of `components/fixtures/match-centre/pitch-diagram.tsx`, at the
 * same 240x150 viewBox, so the two pitches are one drawing. They are not shared
 * through the contracts package the way the KIT is, because unlike the kit this
 * has no configuration and no variants -- there is exactly one pitch and no data
 * flows into it, so there is nothing for a shared module to hold but a second
 * copy of the same literal.
 *
 * ACCESSIBILITY. The drawing is DECORATIVE and is hidden from VoiceOver, because
 * the pitch NAME is always rendered as real text beside it. A screen reader gets
 * the name, which is the information; it is not read a description of goalposts.
 */
export function PitchDiagram({ width = 320, height = 200 }: { width?: number; height?: number }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={height} viewBox="0 0 240 150" preserveAspectRatio="xMidYMid meet">
        <Defs>
          {/* A pitch is not flat green. The turf runs a little darker at the
              edges and catches the light through the middle, which is what makes
              a photograph of one read as grass rather than as a rectangle. */}
          <LinearGradient id="turf" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#1d6b42" />
            <Stop offset="45%" stopColor="#2a8a55" />
            <Stop offset="100%" stopColor="#175c38" />
          </LinearGradient>
        </Defs>

        <Rect x="0" y="0" width="240" height="150" rx="6" fill="url(#turf)" />

        {/* Mown stripes. Real, and the reason a pitch photographs the way it
            does -- the mower runs up and down and the grass lies in alternate
            directions, so alternate bands catch the light differently. */}
        {[0, 2, 4, 6, 8].map((i) => (
          <Rect key={i} x={i * 24} y="0" width="24" height="150" fill="#ffffff" opacity={0.055} />
        ))}

        {/* WHITE markings, as they are painted. In the page's ink colour this
            read as a diagram of a pitch; in white on grass it reads as the pitch. */}
        <G stroke="#ffffff" strokeWidth={1.3} fill="none" opacity={0.9} strokeLinecap="square">
          {/* Touchlines and dead-ball lines -- the outer boundary. */}
          <Rect x="6" y="10" width="228" height="130" />
          {/* Try lines. The in-goal areas outside them are where a try is scored. */}
          <Line x1="30" y1="10" x2="30" y2="140" />
          <Line x1="210" y1="10" x2="210" y2="140" />
          {/* 22m lines. */}
          <Line x1="70" y1="10" x2="70" y2="140" />
          <Line x1="170" y1="10" x2="170" y2="140" />
          {/* Halfway. */}
          <Line x1="120" y1="10" x2="120" y2="140" />
        </G>

        <G stroke="#ffffff" strokeWidth={1.1} fill="none" opacity={0.62}>
          {/* 10m lines, dashed either side of halfway. */}
          <Line x1="102" y1="10" x2="102" y2="140" strokeDasharray="4 5" />
          <Line x1="138" y1="10" x2="138" y2="140" strokeDasharray="4 5" />
          {/* 5m lines, dashed, in from each try line. */}
          <Line x1="39" y1="10" x2="39" y2="140" strokeDasharray="3 6" />
          <Line x1="201" y1="10" x2="201" y2="140" strokeDasharray="3 6" />
          {/* The 5m and 15m lines running the length of the pitch. */}
          <Line x1="30" y1="19" x2="210" y2="19" strokeDasharray="3 6" />
          <Line x1="30" y1="131" x2="210" y2="131" strokeDasharray="3 6" />
          <Line x1="30" y1="43" x2="210" y2="43" strokeDasharray="3 6" opacity={0.7} />
          <Line x1="30" y1="107" x2="210" y2="107" strokeDasharray="3 6" opacity={0.7} />
        </G>

        {/* Posts. The H is what makes it rugby rather than any other field sport. */}
        <G stroke="#ffffff" strokeWidth={2} fill="none" opacity={0.95} strokeLinecap="round">
          <Path d="M29 58 v34 M25 67 h8" />
          <Path d="M211 58 v34 M207 67 h8" />
        </G>
      </Svg>
    </View>
  )
}
