import type { AdminClubRow } from "./types"

/**
 * Lightweight review flags, never an automatic merge/fix -- see
 * 20260831200000's own comment for why. Only renders the flags that
 * actually matter for a review queue; "unverified" alone is common enough
 * (most of the real ingested dataset) that surfacing it per-row would be
 * noise, so it's intentionally left out of this compact badge set and
 * only shown in the full detail page.
 */
export function QualityBadges({ flags }: { flags: AdminClubRow["flags"] }) {
  const active: string[] = []
  if (flags.duplicateNormalizedKey) active.push("Possible duplicate")
  if (flags.duplicateExternalId) active.push("Duplicate source ID")
  if (flags.missingPostcode) active.push("No postcode")
  if (flags.missingTown) active.push("No town")
  if (flags.missingRugbyCode) active.push("No code")

  if (active.length === 0) return null

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {active.map((label) => (
        <span
          key={label}
          className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800"
        >
          {label}
        </span>
      ))}
    </div>
  )
}
