import { AlertTriangle, CheckCircle2 } from "lucide-react"

import type { AdminClubRow } from "../types"

const SIGNALS: { key: keyof AdminClubRow["flags"]; label: string; detail: string }[] = [
  { key: "duplicateNormalizedKey", label: "Possible duplicate name", detail: "Another directory entry shares this normalized name." },
  { key: "duplicateExternalId", label: "Duplicate source ID", detail: "Another row shares the same (source, external ID) pair." },
  { key: "missingPostcode", label: "Missing postcode", detail: "No postcode on file for this club." },
  { key: "missingTown", label: "Missing town", detail: "No town on file for this club." },
  { key: "missingRugbyCode", label: "Missing rugby code", detail: "Rugby union/league is not set." },
  { key: "missingWebsite", label: "Missing website", detail: "Neither the canonical nor Ovalball profile has a website." },
  { key: "missingLogo", label: "Missing crest", detail: "This activated club has no crest uploaded." },
  { key: "noPublicProfile", label: "No public profile", detail: "This activated club has no bio written for its public page." },
  { key: "unverified", label: "Unverified record", detail: "Verification status is not marked verified." },
  { key: "inactive", label: "Inactive record", detail: "Hidden from signup, claim, and join discovery." },
  { key: "pendingClaim", label: "Pending claim", detail: "A claim on this club is awaiting Site Admin review." },
]

/** Non-blocking, review-only signals -- never auto-corrected or auto-merged, matching the brief's own "flagged for Site Admin review" instruction. */
export function DataQualityPanel({ flags }: { flags: AdminClubRow["flags"] }) {
  const active = SIGNALS.filter((s) => flags[s.key])

  if (active.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-forest-800">
        <CheckCircle2 className="size-4" />
        No data-quality issues flagged for this club.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {active.map((signal) => (
        <li key={signal.key} className="flex items-start gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-medium text-ink">{signal.label}</p>
            <p className="text-xs text-ink/55">{signal.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
