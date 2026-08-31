"use client"

import { useEffect, useRef } from "react"
import type { CSSProperties, ElementType, ReactNode } from "react"

interface RevealProps {
  children: ReactNode
  /** Stagger index within the containing section (80ms per step, see globals.css). */
  index?: number
  as?: ElementType
  className?: string
  /** "fade" (default): opacity + rise, used for copy. "wipe": clip-path wipe, used for imagery. */
  variant?: "fade" | "wipe"
}

/**
 * Standard-tier scroll reveal (fade + rise), driven entirely by
 * IntersectionObserver + a single DOM attribute write -- no scroll listener,
 * no state re-render per frame. Reveals once and stops observing; the CSS in
 * globals.css already renders the final state by default when
 * prefers-reduced-motion is set, so no JS branching is needed here for that.
 */
export function Reveal({
  children,
  index = 0,
  as: Tag = "div",
  className,
  variant = "fade",
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.setAttribute("data-reveal", "in")
            observer.unobserve(el)
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const style = { "--reveal-index": index } as CSSProperties

  return (
    <Tag
      ref={ref}
      data-reveal=""
      data-reveal-variant={variant === "wipe" ? "wipe" : undefined}
      style={style}
      className={className}
    >
      {children}
    </Tag>
  )
}
