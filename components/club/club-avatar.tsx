"use client"

import { useState, type CSSProperties } from "react"

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
 *
 * A CLUB IS NEVER REPRESENTED BY ITS KIT.
 *
 * This component used to take a `fallback` node, and `CrestPlate` passed the
 * club's home shirt into it on the reasoning that a shirt is "the next most
 * recognisable thing a club owns". The owner has ruled otherwise: a crest, a
 * kit and a person's face are three different concepts and none of them is a
 * fallback for another. Preston Grasshoppers has no crest, so every surface
 * that showed its identity -- the Club Desk hero, the public club home, the
 * chrome bars -- showed a shirt illustration where the badge belongs.
 *
 * The prop is GONE rather than merely unused, because the guarantee has to be
 * structural: with no way to pass kit artwork in, club presentation cannot
 * return it. `scripts/verify-identity-presentation.mjs` holds the rest.
 */
export function ClubAvatar({
  logoUrl,
  name,
  size = "sm",
  variant = "light",
  className = "",
  plain = false,
}: {
  logoUrl: string | null
  name: string
  size?: ClubAvatarSize
  variant?: "light" | "dark"
  className?: string
  /** No tile border or background -- for a host that already frames the crest (the club homepage's crest plate). */
  plain?: boolean
}) {
  const [broken, setBroken] = useState(false)
  // A crest is never scaled up past 1.5x its real size. A 60px upload shown
  // at 128px is a blur; shown smaller inside the same box it is still sharp.
  const [natural, setNatural] = useState<CSSProperties | undefined>(undefined)
  const sizeClass = SIZE_CLASS[size]

  // Capped at 1.5x so a small upload stays sharp rather than being blown up
  // into a blur. A REAL CREST IS ALWAYS SHOWN: this used to discard one that
  // rendered smaller than half its box in favour of the kit, so a club with a
  // perfectly good low-resolution badge was represented by a shirt it never
  // chose.
  function settle(img: HTMLImageElement) {
    setNatural(capAt(img))
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
