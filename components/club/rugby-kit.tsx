/**
 * The rugby shirt renderer.
 *
 * ONE renderer, deliberately. The kit editor in Club Settings and the future
 * Matchday invitation draw the same component from the same canonical
 * `club_kits` row -- a club must never discover that the shirt it configured
 * looks different on the fixture card.
 *
 * SVG rather than an uploaded image: it re-renders at any size, inherits the
 * page's colours for its outline, costs no storage, and stays in sync with
 * the configuration by construction. Nothing here is persisted.
 *
 * Not a server component boundary -- it is pure presentation with no state,
 * so it renders on the server and inside client editors alike.
 */

export type KitPattern =
  | "SOLID"
  | "HOOPS"
  | "HORIZONTAL_BANDS"
  | "VERTICAL_STRIPES"
  | "HALVES"
  | "QUARTERS"
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
 * Human labels live here, not in the database: rewording "Hoops" must not
 * require a migration, and the stored key is what identity depends on.
 *
 * HOOPS and HORIZONTAL_BANDS are kept separate rather than consolidated.
 * They are the same geometry at different frequencies -- hoops are many
 * narrow bands, bands are a few wide ones -- and rugby clubs describe
 * themselves using both words. Collapsing them would force half of them to
 * pick a label they do not use.
 */
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

/** Patterns that are defined by two colours. SOLID is the only one that is not. */
export function patternNeedsSecondary(pattern: KitPattern): boolean {
  return pattern !== "SOLID"
}

/**
 * The accessible description.
 *
 * Kit must never be conveyed by colour alone, and "a shirt" tells a screen
 * reader nothing. This produces the sentence the design brief asked for --
 * "Burnley RUFC primary kit: light blue and claret hoops" -- from the
 * canonical pattern and the colour values themselves.
 */
export function describeKit(kit: KitConfig, clubName?: string, variant: "primary" | "alternate" = "primary"): string {
  const pattern = KIT_PATTERNS.find((p) => p.key === kit.pattern)
  const primary = colourName(kit.primaryColour)
  const secondary = kit.secondaryColour ? colourName(kit.secondaryColour) : null

  const colours =
    kit.pattern === "SOLID" || !secondary ? primary : `${primary} and ${secondary}`
  const shape = kit.pattern === "SOLID" ? "" : ` ${(pattern?.label ?? "").toLowerCase()}`
  const owner = clubName ? `${clubName} ` : ""

  return `${owner}${variant} kit: ${colours}${shape}`.replace(/\s+/g, " ").trim()
}

/**
 * Nearest plain-English colour name for a hex value.
 *
 * Approximate on purpose: this exists so a screen reader hears "claret"
 * rather than "#7a1f3d", and a rough name is far more use than a hex code.
 * It is never stored and never used for matching.
 */
function colourName(hex: string): string {
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

/**
 * The shirt itself.
 *
 * Pattern fills are clipped to the shirt body so a sash or a hoop can never
 * paint outside the garment, and the collar and sleeve seams are drawn last
 * so the shape reads as a rugby shirt rather than a coloured blob.
 */
export function RugbyKit({
  kit,
  clubName,
  variant = "primary",
  className = "size-20",
  title,
}: {
  kit: KitConfig
  clubName?: string
  variant?: "primary" | "alternate"
  className?: string
  /** Overrides the generated accessible description. */
  title?: string
}) {
  const primary = kit.primaryColour
  const secondary = kit.secondaryColour ?? kit.primaryColour
  const accent = kit.accentColour ?? secondary
  const label = title ?? describeKit(kit, clubName, variant)
  const clipId = `kitclip-${kit.pattern}-${primary}-${secondary}`.replace(/[^a-zA-Z0-9-]/g, "")

  // Body outline: shoulders, sleeves, torso.
  const bodyPath =
    "M20 8 L32 4 Q40 10 48 4 L60 8 L74 16 L67 30 L60 26 L60 72 Q40 78 20 72 L20 26 L13 30 L6 16 Z"

  return (
    <svg viewBox="0 0 80 80" className={className} role="img" aria-label={label}>
      <title>{label}</title>
      <defs>
        <clipPath id={clipId}>
          <path d={bodyPath} />
        </clipPath>
      </defs>

      <path d={bodyPath} fill={primary} />

      <g clipPath={`url(#${clipId})`}>
        {kit.pattern === "HOOPS" &&
          [12, 24, 36, 48, 60, 72].map((y) => (
            <rect key={y} x="0" y={y} width="80" height="6" fill={secondary} />
          ))}

        {kit.pattern === "HORIZONTAL_BANDS" &&
          [18, 46].map((y) => <rect key={y} x="0" y={y} width="80" height="14" fill={secondary} />)}

        {kit.pattern === "VERTICAL_STRIPES" &&
          [14, 28, 42, 56].map((x) => (
            <rect key={x} x={x} y="0" width="7" height="80" fill={secondary} />
          ))}

        {kit.pattern === "HALVES" && <rect x="40" y="0" width="40" height="80" fill={secondary} />}

        {kit.pattern === "QUARTERS" && (
          <>
            <rect x="40" y="0" width="40" height="40" fill={secondary} />
            <rect x="0" y="40" width="40" height="40" fill={secondary} />
          </>
        )}

        {kit.pattern === "SASH" && (
          <path d="M-10 62 L52 -10 L70 -10 L8 62 Z" fill={secondary} transform="translate(6,6)" />
        )}

        {kit.pattern === "CHEST_BAND" && <rect x="0" y="28" width="80" height="16" fill={secondary} />}

        {kit.pattern === "CONTRAST_SLEEVES" && (
          <>
            <path d="M20 8 L6 16 L13 30 L20 26 Z" fill={secondary} />
            <path d="M60 8 L74 16 L67 30 L60 26 Z" fill={secondary} />
          </>
        )}
      </g>

      {/* Collar and seams last, in the trim colour, so the silhouette reads. */}
      <path
        d="M32 4 Q40 14 48 4 L44 3 Q40 9 36 3 Z"
        fill={accent}
        stroke={accent}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d={bodyPath} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1.5" />
    </svg>
  )
}

/** What a fixture card shows when the opposition is canonical but unclaimed. */
export function KitPlaceholder({ className = "size-20", label = "Kit not recorded" }: { className?: string; label?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} role="img" aria-label={label}>
      <title>{label}</title>
      <path
        d="M20 8 L32 4 Q40 10 48 4 L60 8 L74 16 L67 30 L60 26 L60 72 Q40 78 20 72 L20 26 L13 30 L6 16 Z"
        fill="currentColor"
        fillOpacity="0.06"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="1.5"
        strokeDasharray="3 3"
        strokeLinejoin="round"
      />
    </svg>
  )
}
