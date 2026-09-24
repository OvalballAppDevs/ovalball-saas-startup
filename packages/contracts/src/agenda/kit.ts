/**
 * A CLUB'S KIT, AS DATA.
 *
 * The TYPE only, lifted out of `components/club/rugby-kit.tsx` so that a reader can carry a club's kit
 * without the React component that draws it. The mobile agenda needs the four fields; it draws them
 * itself, because a web SVG is not a React Native one.
 *
 * The strings are the database's own `club_kits` values. Nothing here decides a colour.
 */

export type KitPattern =
  | "SOLID"
  | "HOOPS"
  | "HORIZONTAL_BANDS"
  | "VERTICAL_STRIPES"
  | "QUARTERS"
  | "HALVES"
  | "SASH"
  | "CHEST_BAND"
  | "CONTRAST_SLEEVES"

export interface KitConfig {
  pattern: KitPattern
  primaryColour: string
  secondaryColour: string | null
  accentColour: string | null
}

/**
 * THE SHIRT'S GEOMETRY, SO BOTH CLIENTS DRAW ONE SHIRT.
 *
 * The website has rendered this since Club Settings could configure a kit, and
 * the geometry lived inside the React DOM component -- which React Native cannot
 * import. Copying the path strings into the app would have produced two shirts
 * that agree until somebody adjusts a shoulder.
 *
 * So the SHAPES move here and each client supplies its own renderer: `<svg>` on
 * the web, `react-native-svg` in the app. Neither decides a colour, a pattern or
 * a coordinate; both are handed the same list of primitives.
 *
 * The viewBox is 80x80 and every coordinate below is in that space.
 */
export const KIT_VIEWBOX = 80

/** Shoulders, sleeves and torso. Everything else is clipped to it. */
export const KIT_BODY_PATH =
  "M20 8 L32 4 Q40 10 48 4 L60 8 L74 16 L67 30 L60 26 L60 72 Q40 78 20 72 L20 26 L13 30 L6 16 Z"

/** The collar, drawn last in the trim colour so the silhouette reads as a rugby shirt. */
export const KIT_COLLAR_PATH = "M32 4 Q40 14 48 4 L44 3 Q40 9 36 3 Z"

export type KitShape =
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "path"; d: string; translate?: { x: number; y: number } }

/**
 * The pattern, as primitives clipped to the shirt body.
 *
 * Everything is drawn in the SECONDARY colour over a primary ground, which is
 * why the caller needs only two values and why SOLID legitimately returns
 * nothing at all.
 */
export function kitShapes(pattern: KitPattern): KitShape[] {
  switch (pattern) {
    case "HOOPS":
      return [12, 24, 36, 48, 60, 72].map((y) => ({ kind: "rect", x: 0, y, width: 80, height: 6 }))
    case "HORIZONTAL_BANDS":
      return [18, 46].map((y) => ({ kind: "rect", x: 0, y, width: 80, height: 14 }))
    case "VERTICAL_STRIPES":
      return [14, 28, 42, 56].map((x) => ({ kind: "rect", x, y: 0, width: 7, height: 80 }))
    case "HALVES":
      return [{ kind: "rect", x: 40, y: 0, width: 40, height: 80 }]
    case "QUARTERS":
      return [
        { kind: "rect", x: 40, y: 0, width: 40, height: 40 },
        { kind: "rect", x: 0, y: 40, width: 40, height: 40 },
      ]
    case "SASH":
      return [{ kind: "path", d: "M-10 62 L52 -10 L70 -10 L8 62 Z", translate: { x: 6, y: 6 } }]
    case "CHEST_BAND":
      return [{ kind: "rect", x: 0, y: 28, width: 80, height: 16 }]
    case "CONTRAST_SLEEVES":
      return [
        { kind: "path", d: "M20 8 L6 16 L13 30 L20 26 Z" },
        { kind: "path", d: "M60 8 L74 16 L67 30 L60 26 Z" },
      ]
    case "SOLID":
    default:
      return []
  }
}

/** Human labels live here rather than in the database: rewording "Hoops" must not require a migration, and the stored key is what identity depends on. */
export const KIT_PATTERNS: { key: KitPattern; label: string; description: string }[] = [
  { key: "SOLID", label: "Solid", description: "One colour throughout" },
  { key: "HOOPS", label: "Hoops", description: "Narrow horizontal bands" },
  { key: "HORIZONTAL_BANDS", label: "Bands", description: "Wide horizontal bands" },
  { key: "VERTICAL_STRIPES", label: "Stripes", description: "Vertical stripes" },
  { key: "HALVES", label: "Halves", description: "Split left and right" },
  { key: "QUARTERS", label: "Quarters", description: "Four quarters" },
  { key: "SASH", label: "Sash", description: "Diagonal sash" },
  { key: "CHEST_BAND", label: "Chest band", description: "Single band across the chest" },
  { key: "CONTRAST_SLEEVES", label: "Contrast sleeves", description: "Sleeves in the second colour" },
]

/**
 * THE SWATCHES A CLUB PICKS FROM, on both clients. Presentation only: the server accepts any
 * six-digit hex, and a club that wants an exact shade types it. One list so the web's Club
 * Settings and the app's Branding screen offer the same colours in the same order.
 */
export const KIT_SWATCHES: string[] = [
  "#7a1f3d", "#9b1b30", "#c8102e", "#e35205",
  "#f2a900", "#046a38", "#00594c", "#0b3d91",
  "#5aa9e6", "#4b2e83", "#111111", "#ffffff",
]

/**
 * What the server will refuse, said before the round trip. The CHECK constraints on `club_kits`
 * (pattern in the catalogue, six-digit hex colours, a two-tone pattern needs a second colour) are the
 * authority; this is the same rule, shared so neither client keeps a copy of its own.
 */
export function kitInputProblem(kit: { pattern: string; primaryColour: string; secondaryColour: string | null; accentColour: string | null }): string | null {
  const hex = /^#[0-9a-f]{6}$/i
  if (!KIT_PATTERNS.some((p) => p.key === kit.pattern)) return "Choose a pattern."
  if (!hex.test(kit.primaryColour)) return "The first colour needs to be a six-digit colour code."
  if (kit.secondaryColour != null && kit.secondaryColour !== "" && !hex.test(kit.secondaryColour)) return "The second colour needs to be a six-digit colour code."
  if (kit.accentColour != null && kit.accentColour !== "" && !hex.test(kit.accentColour)) return "The trim colour needs to be a six-digit colour code."
  if (kit.pattern !== "SOLID" && !kit.secondaryColour) return "That pattern needs a second colour."
  return null
}

/** Patterns defined by two colours. SOLID is the only one that is not. */
export function patternNeedsSecondary(pattern: KitPattern): boolean {
  return pattern !== "SOLID"
}

/**
 * THE ACCESSIBLE DESCRIPTION.
 *
 * Kit must never be conveyed by colour alone, and "a shirt" tells a screen
 * reader nothing. This produces the sentence the design brief asked for --
 * "Burnley RUFC primary kit: light blue and claret hoops" -- from the canonical
 * pattern and the colour values themselves, on whichever client is reading it
 * out.
 */
export function describeKit(kit: KitConfig, clubName?: string, variant: "primary" | "alternate" = "primary"): string {
  const pattern = KIT_PATTERNS.find((p) => p.key === kit.pattern)
  const primary = colourName(kit.primaryColour)
  const secondary = kit.secondaryColour ? colourName(kit.secondaryColour) : null

  const colours = kit.pattern === "SOLID" || !secondary ? primary : `${primary} and ${secondary}`
  const shape = kit.pattern === "SOLID" ? "" : ` ${(pattern?.label ?? "").toLowerCase()}`
  const owner = clubName ? `${clubName} ` : ""

  return `${owner}${variant} kit: ${colours}${shape}`.replace(/\s+/g, " ").trim()
}

/**
 * Nearest plain-English colour name for a hex value.
 *
 * Approximate on purpose: this exists so a screen reader hears "claret" rather
 * than "#7a1f3d", and a rough name is far more use than a hex code. It is never
 * stored and never used for matching.
 */
export function colourName(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) return hex
  const r = parseInt(m[1], 16)
  const g = parseInt(m[2], 16)
  const b = parseInt(m[3], 16)

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const light = (max + min) / 2 / 255
  const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255))

  if (light > 0.93) return "white"
  if (light < 0.08) return "black"
  if (sat < 0.12) return light > 0.55 ? "light grey" : "grey"

  let hue = 0
  if (max === r) hue = ((g - b) / (max - min)) % 6
  else if (max === g) hue = (b - r) / (max - min) + 2
  else hue = (r - g) / (max - min) + 4
  hue = (hue * 60 + 360) % 360

  const dark = light < 0.32
  if (hue < 12 || hue >= 345) return dark ? "claret" : "red"
  if (hue < 40) return dark ? "brown" : "orange"
  if (hue < 68) return dark ? "olive" : "yellow"
  if (hue < 160) return dark ? "dark green" : "green"
  if (hue < 200) return dark ? "teal" : "turquoise"
  if (hue < 250) return dark ? "navy" : "light blue"
  if (hue < 290) return "purple"
  return dark ? "maroon" : "pink"
}
