/**
 * THE OVALBALL NATIVE DESIGN FOUNDATION.
 *
 * The same brand, expressed for a platform that has no cascade. Every colour below is copied from
 * `app/globals.css` by VALUE, because a React Native app cannot read a CSS custom property and
 * translating Tailwind classes at runtime would be a second design system pretending to be one. The
 * contrast ratios in that file were measured, and are inherited here rather than re-guessed:
 * ink-muted is 5.64:1 on chalk, ink-subtle 4.72:1, and both clear WCAG AA for normal text.
 *
 * TOKENS, NOT A COMPONENT LIBRARY. This is deliberately small: colour, type, spacing, radius. A
 * hundred-component system built before there are ten screens is a hundred components designed against
 * imagined requirements.
 *
 * DARK MODE IS STRUCTURED FOR, NOT BUILT. Every colour is reached through a name, so a second palette
 * is a second object rather than an edit to every screen. Getting the canonical light experience right
 * comes first.
 */

export const colour = {
  /** The brand grounds. forest950 is the launch screen and the bottom bar; forest800 is the brand ink. */
  forest950: "#071c14",
  forest900: "#0b2b1e",
  forest800: "#123d2c",
  rugby700: "#185c3b",
  pitch600: "#32a665",
  pitch400: "#5acb83",
  mint300: "#91e3ac",
  mint100: "#dcf7e5",

  /** The page. chalk is the app ground; white is a card lifted off it. */
  chalk: "#f8faf7",
  surface: "#ffffff",

  /** Text. Measured on chalk, the darker of the two grounds. */
  ink: "#101512",
  inkMuted: "#616562",
  inkSubtle: "#6d716e",
  onForest: "#ffffff",
  onForestMuted: "rgba(255,255,255,0.72)",

  line: "rgba(16,21,18,0.10)",
  lineStrong: "rgba(16,21,18,0.16)",

  /** Status. Never colour alone -- every status also carries a word. */
  danger: "#c1221b",
  dangerSurface: "#fdf2f2",
  warning: "#8a5a00",
  warningSurface: "#fdf6e7",
  successSurface: "#e9f7ee",
} as const

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const

/**
 * MINIMUM TOUCH TARGET. 44pt is Apple's floor and Android's 48dp rounds down to about the same; every
 * pressable in this app is at least this tall, which is cheaper to hold as a token than to remember.
 */
export const TOUCH_TARGET = 44

export const font = {
  display: "BebasNeue_400Regular",
  body: "Inter_400Regular",
  bodyMedium: "Inter_500Medium",
  bodySemi: "Inter_600SemiBold",
} as const

/**
 * A type scale, not a list of sizes. `lineHeight` is set on every step because React Native's default
 * leading differs between the platforms, and text that reflows differently on Android than on iOS is a
 * layout bug that only one of the two testers ever sees.
 */
export const type = {
  display: { fontFamily: font.display, fontSize: 34, lineHeight: 38, letterSpacing: 0.5 },
  displaySmall: { fontFamily: font.display, fontSize: 24, lineHeight: 28, letterSpacing: 0.4 },
  title: { fontFamily: font.bodySemi, fontSize: 20, lineHeight: 26 },
  heading: { fontFamily: font.bodySemi, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: font.body, fontSize: 16, lineHeight: 24 },
  bodyMedium: { fontFamily: font.bodyMedium, fontSize: 16, lineHeight: 24 },
  small: { fontFamily: font.body, fontSize: 14, lineHeight: 20 },
  smallMedium: { fontFamily: font.bodyMedium, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: font.body, fontSize: 12, lineHeight: 16 },
  overline: { fontFamily: font.bodySemi, fontSize: 11, lineHeight: 14, letterSpacing: 1.2 },
} as const
