import type { SVGProps } from "react"

interface OvalballMarkProps extends SVGProps<SVGSVGElement> {
  /**
   * "dark": for use over dark/video backgrounds -- the ring renders white.
   * "light": for use over chalk/white backgrounds -- the ring renders ink.
   * Defaults to "dark" since that is this mark's most common context
   * (header, video hero, dark brand panels).
   */
  variant?: "light" | "dark"
}

/**
 * The Ovalball symbol: a single tilted ring, kept deliberately simple.
 * An earlier version added a second, differently-tilted crescent behind it
 * (matching the brand board too literally) -- at the small sizes this mark
 * actually renders at (nav, favicons), two overlapping colored shapes read
 * as visual noise rather than a mark. One clean ring reads correctly at
 * every size this component is used at.
 */
export function OvalballMark({ variant = "dark", ...props }: OvalballMarkProps) {
  return (
    <svg
      viewBox="0 0 64 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Ovalball"
      {...props}
    >
      <ellipse
        cx="32"
        cy="20"
        rx="26"
        ry="15"
        stroke={variant === "dark" ? "#ffffff" : "var(--ink)"}
        strokeWidth="7"
        transform="rotate(-14 32 20)"
      />
    </svg>
  )
}
