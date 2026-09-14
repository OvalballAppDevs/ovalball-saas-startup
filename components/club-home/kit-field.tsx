import type { KitPattern } from "@/components/club/rugby-kit"

/**
 * The club's shirt, as a surface.
 *
 * A rugby club is recognised by its shirt before its badge: hoops, halves or
 * a sash are the first thing anyone sees from the touchline. The homepage
 * draws that pattern, at the scale of the page, in the colours the theme
 * engine has already made safe (--club-hero-pattern on --club-hero), so two
 * clubs with the same colours but different shirts still look different.
 *
 * Pure decoration: aria-hidden, and never anything text sits directly on --
 * the hero keeps its words on the plain shirt colour and fades this in
 * beside them.
 */
export function KitField({ pattern, className = "" }: { pattern: KitPattern; className?: string }) {
  const fill = "var(--club-hero-pattern)"
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 400 400"
      preserveAspectRatio="xMidYMid slice"
      className={className}
    >
      {pattern === "HOOPS" && [20, 90, 160, 230, 300, 370].map((y) => <rect key={y} x="0" y={y} width="400" height="36" fill={fill} />)}
      {pattern === "HORIZONTAL_BANDS" && [70, 250].map((y) => <rect key={y} x="0" y={y} width="400" height="90" fill={fill} />)}
      {pattern === "VERTICAL_STRIPES" && [30, 120, 210, 300, 390].map((x) => <rect key={x} x={x} y="0" width="44" height="400" fill={fill} />)}
      {pattern === "HALVES" && <rect x="200" y="0" width="200" height="400" fill={fill} />}
      {pattern === "QUARTERS" && (
        <>
          <rect x="200" y="0" width="200" height="200" fill={fill} />
          <rect x="0" y="200" width="200" height="200" fill={fill} />
        </>
      )}
      {pattern === "SASH" && <path d="M-40 360 L300 -40 L420 -40 L80 360 L80 460 L-40 460 Z" fill={fill} />}
      {pattern === "CHEST_BAND" && <rect x="0" y="150" width="400" height="100" fill={fill} />}
      {pattern === "CONTRAST_SLEEVES" && (
        <>
          <path d="M0 0 L120 0 L60 400 L0 400 Z" fill={fill} />
          <path d="M400 0 L280 0 L340 400 L400 400 Z" fill={fill} />
        </>
      )}
      {pattern === "SOLID" && (
        // A one-colour shirt is still a shirt: its collar, at the scale of the page.
        <path d="M110 -10 Q200 150 290 -10 L262 -10 Q200 100 138 -10 Z" fill={fill} />
      )}
    </svg>
  )
}
