"use client"

import { useState, type CSSProperties, type ReactNode } from "react"

const SIZE_CLASS = {
  xs: "size-6 text-[8px]",
  sm: "size-9 text-[9px]",
  md: "size-12 text-xs",
  lg: "size-20 text-sm",
  xl: "size-24 text-base md:size-32",
} as const

function capAt(img: HTMLImageElement): CSSProperties {
  return { maxWidth: img.naturalWidth * 1.5, maxHeight: img.naturalHeight * 1.5 }
}

export type ClubAvatarSize = keyof typeof SIZE_CLASS

const PLACEHOLDER_VARIANT = {
  light: "border-ink/10 bg-ink/[0.03] text-ink-muted",
  dark: "border-white/15 bg-white/10 text-white/70",
} as const

/**
 * The one club-identity crest component -- every surface that shows a
 * club's identity (public page, dashboard, selectors, partner clubs,
 * admin tables, user management club links) renders it through here, so
 * "no logo" and "broken image" always look the same everywhere rather
 * than each surface inventing its own placeholder. A client component
 * (not a server one) specifically for the onError fallback -- a broken
 * storage URL degrades to initials, never a broken-image icon.
 *
 * `variant="dark"` is for a dark host background (the sidebar, the mobile
 * nav's slide-out header) -- the light-theme placeholder tokens are
 * effectively invisible there (near-black on near-black), so this swaps
 * only the empty-state tile's own colors, never the loaded-image tile
 * (a real crest's own white/transparent background reads fine either way).
 */
export function ClubAvatar({
  logoUrl,
  name,
  size = "sm",
  variant = "light",
  className = "",
  plain = false,
  fallback,
}: {
  logoUrl: string | null
  name: string
  size?: ClubAvatarSize
  variant?: "light" | "dark"
  className?: string
  /** No tile border or background -- for a host that already frames the crest (the club homepage's crest plate). */
  plain?: boolean
  /** Shown instead of initials when there is no crest, e.g. the club's shirt. */
  fallback?: ReactNode
}) {
  const [broken, setBroken] = useState(false)
  // A crest is never scaled up past 1.5x its real size. A 60px upload shown
  // at 128px is a blur; shown smaller inside the same box it is still sharp.
  const [natural, setNatural] = useState<CSSProperties | undefined>(undefined)
  const sizeClass = SIZE_CLASS[size]

  // Capped at 1.5x, a crest smaller than half its box would be a speck on a
  // blank tile. Where the host offers something better to show (the club's
  // shirt), that crest gives way to it rather than being the page's identity.
  function settle(img: HTMLImageElement) {
    const capped = capAt(img)
    const box = img.getBoundingClientRect().width
    if (fallback && box > 0 && Math.max(Number(capped.maxWidth), Number(capped.maxHeight)) < box * 0.5) setBroken(true)
    else setNatural(capped)
  }

  if ((!logoUrl || broken) && fallback) {
    return (
      <div className={`flex shrink-0 items-center justify-center ${sizeClass} ${className}`} aria-hidden="true">
        {fallback}
      </div>
    )
  }

  if (!logoUrl || broken) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded-md border font-medium ${PLACEHOLDER_VARIANT[variant]} ${sizeClass} ${className}`}
        aria-hidden="true"
      >
        {name.slice(0, 2).toUpperCase()}
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage public URLs at many small sizes across the app; avoids next/image's remote-pattern config for what is always a small thumbnail
    <img
      src={logoUrl}
      alt=""
      onError={() => setBroken(true)}
      // Both paths, because a cached crest can finish loading before React
      // hydrates, and then onLoad never fires for it.
      ref={(img) => {
        if (img?.complete && img.naturalWidth > 0 && !natural) settle(img)
      }}
      onLoad={(e) => {
        if (e.currentTarget.naturalWidth > 0) settle(e.currentTarget)
      }}
      style={natural}
      className={`shrink-0 object-contain ${plain ? "" : "rounded-md border border-ink/10 bg-white"} ${sizeClass} ${className}`}
    />
  )
}
