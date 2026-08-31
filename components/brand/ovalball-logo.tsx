import { cn } from "@/lib/utils"

import { OvalballMark } from "./ovalball-mark"

interface VariantProps {
  /**
   * "dark": for use over dark/video backgrounds (predominantly white
   * wordmark, controlled green accent on "BALL").
   * "light": for use over chalk/white backgrounds (ink "OVAL", dark forest
   * green "BALL").
   */
  variant: "light" | "dark"
  className?: string
}

/**
 * The two-tone "OVALBALL" wordmark alone, with no mark -- exported
 * separately so contexts that compose their own mark treatment (the header's
 * scroll-progress ring around the mark, for instance) can still reuse the
 * one canonical wordmark styling instead of recreating it inline.
 */
export function OvalballWordmark({ variant, className }: VariantProps) {
  const isDark = variant === "dark"

  return (
    <span className={cn("font-display text-xl tracking-wide", className)}>
      <span className={isDark ? "text-white" : "text-ink"}>OVAL</span>
      <span className={isDark ? "text-pitch-600" : "text-forest-800"}>
        BALL
      </span>
    </span>
  )
}

/**
 * The single reusable Ovalball logo lockup (mark + two-tone wordmark), for
 * any context that doesn't need the header's scroll-progress ring. Never
 * recreate this treatment ad hoc in a component -- import this everywhere
 * the brand identity appears. Does not include the "Rugby, connected."
 * tagline: that is marketing copy, not part of the logo.
 */
export function OvalballLogo({ variant, className }: VariantProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <OvalballMark variant={variant} className="h-6 w-9 shrink-0" aria-hidden="true" />
      <OvalballWordmark variant={variant} />
    </span>
  )
}
