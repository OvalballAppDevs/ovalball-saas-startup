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
  /**
   * INFORMATIONAL, not a status. The pale blue Ovalball already uses for a training event's surface
   * (`eventTone.training`), named here so an explanatory note can reach for the meaning rather than
   * for a hex value -- and so Planning's guidance boxes are the same blue as the rest of the app
   * instead of a new one chosen by eye.
   */
  info: "#2f5d8c",
  infoSurface: "#e8eff7",
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
  /**
   * THE APPLICATION PAGE. Warm chalk: the majority of every content screen stands
   * on this, so that the forest -- the brand's signature -- keeps its force by
   * being used for the structure and the features rather than every inch.
   */
  page: colour.chalk,
  /** The deep ground the Calendar's feature area and the tab bar share. */
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
 * MESSAGING -- every colour a conversation uses, named once.
 *
 * Mine is messenger blue, theirs is mint; what sits ON a blue bubble (a quote, a voice track, a time) is white at
 * a named strength rather than a strength chosen per component, so a quote, a voice note and a receipt inside one
 * bubble agree. Nothing here is a new hue: each is drawn from `colour` or is white/ink at a stated opacity.
 */
export const messenger = {
  mine: colour.messengerBlue,
  theirs: colour.mint100,
  /** Text and marks on my bubble, strongest to quietest. */
  onMine: colour.onForest,
  onMineSoft: "rgba(255,255,255,0.82)",
  onMineFaint: "rgba(255,255,255,0.18)",
  onMineLine: "rgba(255,255,255,0.28)",
  /** Marks on their bubble: a quote's ground, a voice track. */
  onTheirsSoft: "rgba(18,61,44,0.07)",
  onTheirsLine: "rgba(18,61,44,0.14)",
  /** A day line or a system notice on the thread's chalk. */
  notice: "rgba(16,21,18,0.06)",
  /** Read receipt: the green tick, never blue -- blue is the bubble. */
  read: colour.rugby700,
  /** A row pressed on light ground, and on forest. */
  pressed: "rgba(16,21,18,0.04)",
  pressedOnForest: "rgba(255,255,255,0.06)",
  /** The scrim behind a sheet or the compact panel. */
  scrim: "rgba(7,28,20,0.5)",
  scrimLight: "rgba(7,28,20,0.32)",
  /** An icon well on forest: a group's symbol in a header or a row. */
  wellOnForest: "rgba(255,255,255,0.12)",
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

/**
 * WHAT KIND OF EVENT THIS IS — a narrow accent down the left of its card.
 *
 * A day holding a match, a session and another match should read as THREE things
 * at a glance, and a colour down the edge does that faster than any amount of
 * reading. Green is the brand's own for rugby played; blue is the app's
 * established second colour -- the same one the Away badge and a received message
 * already use -- for rugby trained.
 *
 * COLOUR IS SUPPLEMENTARY AND NEVER THE ANSWER. Every card also carries the WORD
 * -- MATCH or TRAINING -- its own icon, and an accessible label that names the
 * kind. Somebody who cannot tell the two greens apart loses nothing.
 */
export const eventTone = {
  match: { accent: colour.pitch600, surface: colour.mint100, text: colour.forest800 },
  training: { accent: colour.messengerBlue, surface: "#e8eff7", text: colour.messengerBlue },
  /**
   * A TOURNAMENT'S OWN TONE. Deep forest rather than the match green or the
   * training blue: a festival sits beside both in one day's list, and three
   * distinguishable accents is the point of having an accent at all.
   */
  tournament: { accent: colour.forest800, surface: colour.mint300, text: colour.forest800 },
  /**
   * A CLUB EVENT'S OWN TONE (Events brief, approved mock-up): violet, so a party, a meeting or a charity run
   * reads as neither a match, a session nor a festival. 6.9:1 on white for the text; the word EVENT is
   * always there too.
   */
  event: { accent: "#7448c9", surface: "#efe9fb", text: "#5a34a8" },
} as const

/**
 * A NOTIFICATION FAMILY'S ACCENT ON THE FOREST GROUND -- the foreground banner's progress line.
 *
 * The light-surface accents (messengerBlue, warning, danger) are measured against chalk and go muddy
 * on forest, so each is lifted here to the SAME hue at a brightness that reads on forest950/900:
 * the amber and red are the exact hues `statusOnForest` already grounds itself in, and the blue is
 * messengerBlue lifted. Decorative only -- every banner also carries its icon and its words.
 */
export const familyOnForest = {
  green: colour.pitch400,
  blue: "#8db4e0",
  amber: "rgb(251,191,36)",
  red: "rgb(248,113,113)",
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
 * LARGE TEXT. Above this Dynamic Type scale (iOS's first accessibility size is about 1.4x), controls laid
 * side by side no longer fit their words: paired buttons stack and a row of four tiles becomes two by two.
 */
export const LARGE_TEXT_SCALE = 1.35

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
