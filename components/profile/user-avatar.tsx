"use client"

import { useState } from "react"

const SIZE_CLASS = {
  xs: "size-6 text-[9px]",
  sm: "size-8 text-[10px]",
  md: "size-12 text-xs",
  lg: "size-24 text-lg",
} as const

export type UserAvatarSize = keyof typeof SIZE_CLASS

const PLACEHOLDER_VARIANT = {
  light: "border-forest-800/15 bg-forest-800/8 text-forest-800",
  dark: "border-white/15 bg-white/10 text-white/70",
} as const

/**
 * The PERSONAL identity companion to ClubAvatar -- deliberately
 * rounded-full (not ClubAvatar's rounded-md) so a person's photo never
 * reads as a club crest at a glance. Initials come from first+surname,
 * never a raw email/username, matching the brief's "clean initials, never
 * a generic technical label" requirement.
 *
 * `variant="dark"` exists for the same reason as ClubAvatar's own: the
 * light-theme placeholder tokens read as near-black-on-near-black on a
 * dark host background (the app sidebar's identity block, now showing a
 * personal avatar for a Site Admin with no club) -- see ClubAvatar's own
 * comment for the precedent this mirrors.
 */
export function UserAvatar({
  avatarUrl,
  name,
  size = "sm",
  variant = "light",
  className = "",
}: {
  avatarUrl: string | null
  name: string
  size?: UserAvatarSize
  variant?: "light" | "dark"
  className?: string
}) {
  const [broken, setBroken] = useState(false)
  const sizeClass = SIZE_CLASS[size]
  const initials =
    name
      .trim()
      .split(/\s+/)
      .map((part) => part.charAt(0))
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"

  if (!avatarUrl || broken) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded-full border font-semibold ${PLACEHOLDER_VARIANT[variant]} ${sizeClass} ${className}`}
        aria-hidden="true"
      >
        {initials}
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage public URL at small thumbnail sizes across the app, avoids next/image's remote-pattern config
    <img
      src={avatarUrl}
      alt=""
      onError={() => setBroken(true)}
      className={`shrink-0 rounded-full border border-ink/10 bg-white object-cover ${sizeClass} ${className}`}
    />
  )
}
