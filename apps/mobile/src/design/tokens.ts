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

  /**
   * MESSAGING. Not decoration and not a choice made here: the website colours a message you SENT in
   * messenger blue and one you RECEIVED in mint, and the app inherits both. Getting these the wrong
   * way round -- which the first mobile draft did -- misattributes every message on the screen.
   */
  messengerBlue: "#2f5d8c",

  line: "rgba(16,21,18,0.10)",
  lineStrong: "rgba(16,21,18,0.16)",

  /** Status. Never colour alone -- every status also carries a word. */
  danger: "#c1221b",
  dangerSurface: "#fdf2f2",
  warning: "#8a5a00",
  warningSurface: "#fdf6e7",
  successSurface: "#e9f7ee",
} as const

/**
 * SEMANTIC TOKENS — what a thing IS, not what colour it happens to be.
 *
 * Every value below is drawn from `colour` above or mixed from it. Nothing here
 * invents a green: a second forest that is nearly the first one is how a product
 * ends up with three slightly different headers, and it is the exact thing the
 * Calendar's rebuild had to undo.
 *
 * They exist so that a screen can say `surface.forest` rather than `colour.forest900`,
 * and so that changing what "the calendar's ground" means is one edit rather than
 * a search across components.
 */
export const surface = {
  /** The deep ground the Calendar, its header and the tab bar all share. */
  forest: colour.forest950,
  /** A panel lifted slightly off that ground -- a segmented control, a chip. */
  forestRaised: "rgba(255,255,255,0.08)",
  /** The page beneath the forest: the sheet the events live on. */
  chalk: colour.chalk,
  /** A card lifted off the chalk. */
  card: colour.surface,
} as const

export const onForest = {
  /** Headings and dates on the forest ground. */
  primary: colour.onForest,
  /** Weekday labels, captions, the month's quieter half. */
  secondary: "rgba(255,255,255,0.62)",
  /** Days belonging to the neighbouring month. */
  faint: "rgba(255,255,255,0.30)",
  /** A hairline on forest, for a divider that must not read as a border. */
  line: "rgba(255,255,255,0.12)",
} as const

/**
 * A CANONICAL STATE, SHOWN ON THE FOREST GROUND.
 *
 * The same three tones the light surfaces use, measured against forest instead of
 * chalk. Never colour alone: every one of these carries the state's own WORD, and
 * the tone only makes it findable.
 */
export const statusOnForest = {
  calm: { ground: "rgba(90,203,131,0.22)", ink: colour.chalk },
  warning: { ground: "rgba(251,191,36,0.18)", ink: "#fef3c7" },
  danger: { ground: "rgba(248,113,113,0.18)", ink: "#fee2e2" },
} as const

/** The month grid's own states, named for what they mean. */
export const calendarTone = {
  /** The day whose events are in the sheet. */
  selected: colour.pitch600,
  selectedInk: colour.forest950,
  /** Today, when it is not the selected day: an outline, never a fill. */
  today: colour.pitch400,
  /** Something is on. One dot, whatever is on. */
  eventDot: colour.pitch400,
  /** The round month steps. */
  control: colour.pitch600,
  controlInk: colour.forest950,
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

/**
 * ELEVATION, stated once. React Native's shadow props differ between the platforms, and a card that
 * floats on iOS and sits flat on Android is the commonest way a shared design drifts apart.
 */
export const elevation = {
  card: {
    shadowColor: "#071c14",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  sheet: {
    shadowColor: "#071c14",
    shadowOpacity: 0.18,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: -8 },
    elevation: 16,
  },
} as const

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
