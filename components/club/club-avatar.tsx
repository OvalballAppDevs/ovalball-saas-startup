"use client"

import { useState } from "react"

const SIZE_CLASS = {
  xs: "size-6 text-[8px]",
  sm: "size-9 text-[9px]",
  md: "size-12 text-xs",
  lg: "size-20 text-sm",
} as const

export type ClubAvatarSize = keyof typeof SIZE_CLASS

const PLACEHOLDER_VARIANT = {
  light: "border-ink/10 bg-ink/[0.03] text-ink/30",
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
}: {
  logoUrl: string | null
  name: string
  size?: ClubAvatarSize
  variant?: "light" | "dark"
  className?: string
}) {
  const [broken, setBroken] = useState(false)
  const sizeClass = SIZE_CLASS[size]

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
      className={`shrink-0 rounded-md border border-ink/10 bg-white object-contain ${sizeClass} ${className}`}
    />
  )
}
