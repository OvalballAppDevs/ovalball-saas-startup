import {
  KIT_BODY_PATH,
  KIT_COLLAR_PATH,
  KIT_VIEWBOX,
  describeKit,
  kitShapes,
  type KitConfig,
  type KitPattern,
} from "@ovalball/contracts/agenda/kit"

/**
 * The rugby shirt renderer -- THE WEB'S.
 *
 * ONE SHIRT, TWO CLIENTS. The kit editor in Club Settings, the Match Centre hero
 * and the native app all draw the same canonical `club_kits` row: a club must
 * never discover that the shirt it configured looks different on the fixture
 * card, and "different" now includes "on a phone".
 *
 * So the GEOMETRY and the accessible DESCRIPTION moved to
 * `@ovalball/contracts/agenda/kit` in M6 -- the body path, the collar, the
 * pattern primitives and the colour-naming that turns #7a1f3d into "claret".
 * What stays here is the `<svg>` that draws them, because a web SVG is not a
 * React Native one. Copying the path strings into the app instead would have
 * produced two shirts that agree until somebody adjusts a shoulder.
 *
 * SVG rather than an uploaded image: it re-renders at any size, inherits the
 * page's colours for its outline, costs no storage, and stays in sync with the
 * configuration by construction. Nothing here is persisted.
 *
 * Not a server component boundary -- it is pure presentation with no state, so it
 * renders on the server and inside client editors alike.
 */

export type { KitPattern, KitConfig }
export { KIT_PATTERNS, patternNeedsSecondary, describeKit } from "@ovalball/contracts/agenda/kit"

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

  return (
    <svg viewBox={`0 0 ${KIT_VIEWBOX} ${KIT_VIEWBOX}`} className={className} role="img" aria-label={label}>
      <title>{label}</title>
      <defs>
        <clipPath id={clipId}>
          <path d={KIT_BODY_PATH} />
        </clipPath>
      </defs>

      <path d={KIT_BODY_PATH} fill={primary} />

      {/* The pattern, clipped to the shirt body so a sash or a hoop can never
          paint outside the garment. The primitives are the shared contract's --
          the app draws this exact list with react-native-svg. */}
      <g clipPath={`url(#${clipId})`}>
        {kitShapes(kit.pattern).map((shape, i) =>
          shape.kind === "rect" ? (
            <rect key={i} x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill={secondary} />
          ) : (
            <path
              key={i}
              d={shape.d}
              fill={secondary}
              transform={shape.translate ? `translate(${shape.translate.x},${shape.translate.y})` : undefined}
            />
          )
        )}
      </g>

      {/* Collar and seams last, in the trim colour, so the silhouette reads. */}
      <path d={KIT_COLLAR_PATH} fill={accent} stroke={accent} strokeWidth="1.5" strokeLinejoin="round" />
      <path d={KIT_BODY_PATH} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1.5" />
    </svg>
  )
}

/** What a fixture card shows when the opposition is canonical but unclaimed. */
export function KitPlaceholder({ className = "size-20", label = "Kit not recorded" }: { className?: string; label?: string }) {
  return (
    <svg viewBox={`0 0 ${KIT_VIEWBOX} ${KIT_VIEWBOX}`} className={className} role="img" aria-label={label}>
      <title>{label}</title>
      <path
        d={KIT_BODY_PATH}
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
