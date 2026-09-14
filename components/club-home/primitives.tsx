import Link from "next/link"
import type { CSSProperties, ReactNode } from "react"

import { clubThemeVariables, type ClubTheme } from "@/lib/club-theme/theme"
import { cn } from "@/lib/utils"

/**
 * Shared building blocks for a club's public pages. Every colour is a
 * --club-* variable from the theme engine; nothing here knows a hex value.
 */

/** Scopes one club's theme to everything inside it. */
export function ClubThemeScope({ theme, children, className }: { theme: ClubTheme; children: ReactNode; className?: string }) {
  return (
    <div
      style={clubThemeVariables(theme) as CSSProperties}
      className={cn("min-h-screen bg-(--club-page) text-ink antialiased", className)}
    >
      {children}
    </div>
  )
}

/** Focus ring for controls on light surfaces. Always visible, always >= 3:1. */
export const FOCUS_LIGHT = "outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-(--club-focus)"
/** Focus ring for controls on the hero. */
export const FOCUS_HERO = "outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-(--club-focus-hero)"

const BUTTON_BASE = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors"

export const BUTTON_SOLID = cn(BUTTON_BASE, FOCUS_LIGHT, "bg-(--club-solid) text-(--club-on-solid) hover:bg-(--club-solid-hover)")
export const BUTTON_QUIET = cn(BUTTON_BASE, FOCUS_LIGHT, "border border-ink/15 bg-white text-ink hover:border-ink/35")
export const TEXT_LINK = cn(FOCUS_LIGHT, "rounded-sm font-semibold text-(--club-ink) underline decoration-(--club-ink)/35 underline-offset-4 hover:decoration-(--club-ink)")

export function SectionHeading({
  id,
  title,
  description,
  action,
}: {
  id: string
  title: string
  description?: string
  action?: { href: string; label: string }
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="min-w-0">
        <h2 id={id} className="scroll-mt-32 font-display text-4xl leading-none tracking-wide text-ink md:text-5xl">
          {title}
        </h2>
        {description && <p className="mt-2 max-w-xl text-sm text-ink-muted">{description}</p>}
      </div>
      {action && (
        <Link href={action.href} className={cn(TEXT_LINK, "text-sm")}>
          {action.label}
        </Link>
      )}
    </div>
  )
}

/** A quiet, word-first label. Meaning is in the text; colour only supports it. */
export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "brand" | "strong" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        tone === "neutral" && "bg-ink/[0.06] text-ink/75",
        tone === "brand" && "bg-(--club-tint-strong) text-(--club-ink)",
        tone === "strong" && "bg-(--club-solid) text-(--club-on-solid)"
      )}
    >
      {children}
    </span>
  )
}

/** A deliberate empty state: what will appear here, and why it is not here yet. */
export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-(--club-border) bg-(--club-tint) px-5 py-6 md:px-7">
      <p className="font-semibold text-ink">{title}</p>
      <div className="mt-1 max-w-prose text-sm text-ink-muted">{children}</div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
