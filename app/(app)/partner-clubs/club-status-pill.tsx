import { BadgeCheck, MapPinOff } from "lucide-react"

import type { MapClub } from "./map-data"

/**
 * The single place that turns partnership/activation state into a label
 * -- color is always paired with text here (never the only signal), and
 * every surface that shows a club's map status (popup card, list row)
 * renders through this so the wording can't drift between them.
 */
export function ClubStatusPill({ club }: { club: MapClub }) {
  if (club.isOwnClub) {
    return <span className="inline-flex items-center rounded-full bg-ink/8 px-2.5 py-1 text-xs font-medium text-ink/60">Your club</span>
  }
  if (!club.clubId) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
        <MapPinOff className="size-3" />
        Not yet on Ovalball
      </span>
    )
  }
  if (club.partnershipStatus === "active") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-pitch-600/12 px-2.5 py-1 text-xs font-medium text-forest-800">
        <BadgeCheck className="size-3" />
        Partner Club
      </span>
    )
  }
  if (club.partnershipStatus === "pending_outgoing") {
    return <span className="inline-flex items-center rounded-full bg-pitch-600/12 px-2.5 py-1 text-xs font-medium text-forest-800">On Ovalball &middot; Request sent</span>
  }
  if (club.partnershipStatus === "pending_incoming") {
    return <span className="inline-flex items-center rounded-full bg-pitch-600/12 px-2.5 py-1 text-xs font-medium text-forest-800">On Ovalball &middot; Wants to partner</span>
  }
  return <span className="inline-flex items-center rounded-full bg-pitch-600/12 px-2.5 py-1 text-xs font-medium text-forest-800">On Ovalball</span>
}
