import Link from "next/link"

import { cn } from "@/lib/utils"

/**
 * THE TACTILE CONTROL LANGUAGE.
 *
 * A physical bottom edge and a real press. The depth is one hard shadow
 * directly beneath the button -- the way a moulded key sits proud of a panel
 * -- and pressing it moves the button down onto that shadow rather than
 * animating a glow. That is what makes it feel like something that gives.
 *
 * DELIBERATELY NOT SKEUOMORPHIC. No bevels, no gradients pretending to be
 * plastic, no inner glow. One offset shadow and 2px of travel is the whole
 * effect; anything more reads as a toy, and this page is somebody checking
 * whether their daughter has a match on Saturday.
 *
 * SELECTED IS NEVER COLOUR ALONE. The selected state changes the GROUND (dark
 * forest), the TEXT WEIGHT, and removes the raised edge so the control sits
 * flush -- pressed in, and staying pressed. In greyscale the selected control
 * is the dark one and the flush one; to a screen reader it is the one carrying
 * aria-current. Three independent signals, none of them hue.
 *
 * WHY THESE ARE LINKS. The date mode lives in the URL so a week is shareable
 * and the back button works. A link is what that is, so these render as
 * anchors and carry `aria-current` rather than faking a button with
 * `aria-pressed`. Where a control genuinely toggles client state instead, the
 * button variant below carries `aria-pressed` properly.
 */

const BASE =
  "relative inline-flex select-none items-center justify-center gap-1.5 rounded-xl px-3.5 text-sm font-medium outline-none transition-[transform,box-shadow,background-color,color] duration-100 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-offset-2"

/** Raised: sits on a hard bottom edge and travels down onto it when pressed. */
const RAISED =
  "border border-ink/12 bg-white text-ink shadow-[0_3px_0_0_theme(colors.ink/12%)] hover:bg-chalk hover:shadow-[0_3px_0_0_theme(colors.ink/18%)] active:translate-y-[3px] active:shadow-none"

/** Pressed in and staying there. No edge, because it is no longer proud of the surface. */
const SELECTED = "border border-forest-950 bg-forest-900 font-semibold text-chalk shadow-none translate-y-[1px] hover:bg-forest-950"

const SIZES = {
  // 44px, the established interaction target. BOTH sizes clear it: the drawer
  // chips were h-9 (36px), which broke the rule this very file states, and a
  // filter is no less tappable for being secondary.
  md: "h-11",
  sm: "h-11 px-3 text-[13px]",
} as const

export function TactileLink({
  href,
  selected,
  children,
  size = "md",
  className,
  ariaLabel,
  /**
   * Which kind of "current" this is. "page" for a control that changes which
   * rugby is shown; "true" for one that only changes how it is arranged. Two
   * controls carrying aria-current="page" at once said the page was in two
   * places, which it never is.
   */
  currentToken = "page",
}: {
  href: string
  selected?: boolean
  children: React.ReactNode
  size?: keyof typeof SIZES
  className?: string
  ariaLabel?: string
  currentToken?: "page" | "true"
}) {
  return (
    <Link
      href={href}
      aria-current={selected ? currentToken : undefined}
      aria-label={ariaLabel}
      className={cn(BASE, SIZES[size], selected ? SELECTED : RAISED, className)}
    >
      {children}
    </Link>
  )
}

/**
 * The same language for a real toggle.
 *
 * `aria-pressed` rather than `aria-current`, because this one is a state the
 * control owns rather than a place the person is.
 */
export function TactileToggle({
  pressed,
  children,
  size = "md",
  className,
  ...rest
}: {
  pressed: boolean
  children: React.ReactNode
  size?: keyof typeof SIZES
  className?: string
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className">) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(BASE, SIZES[size], pressed ? SELECTED : RAISED, className)}
      {...rest}
    >
      {children}
    </button>
  )
}

/**
 * A quieter raised control for navigation arrows -- previous/next week and so
 * on. Square, so it stays a 44px target without a label stretching it.
 */
export function TactileIconLink({
  href,
  label,
  children,
  className,
}: {
  href: string
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Link href={href} aria-label={label} className={cn(BASE, "size-11 shrink-0 px-0", RAISED, className)}>
      {children}
    </Link>
  )
}
