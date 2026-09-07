import { UserRound } from "lucide-react"
import Link from "next/link"

import type { SafeguardingOfficerProjection } from "@/lib/app-context/rugby-hub-data"

/**
 * "Your Club Safeguarding Officer" -- deliberately a separate visual block
 * from published regulatory guidance and official governing-body reporting
 * routes (a local Club contact must never be visually confused with the
 * RFU/RFL's own official reporting route).
 */
export function SafeguardingOfficerCard({ officer }: { officer: SafeguardingOfficerProjection }) {
  const isPending = officer.registrationState === "PENDING"
  const buttonLabel = officer.messageMode === "OVALBALL" ? "Message Safeguarding Officer" : "Email Safeguarding Officer"

  return (
    <article className="flex items-start gap-3 rounded-xl border border-ink/10 bg-white px-4 py-4">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-pitch-100 text-forest-800">
        <UserRound aria-hidden="true" className="size-[18px]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium tracking-[0.06em] text-forest-800 uppercase">{officer.officerType === "primary" ? "Primary Safeguarding Officer" : "Deputy Safeguarding Officer"}</p>
        <h3 className="mt-0.5 text-[15px] font-semibold text-ink">{officer.officerDisplayName}</h3>
        {isPending && <p className="mt-1 text-xs text-ink/50">Not yet an active Ovalball user &mdash; reachable by email only.</p>}
        <Link
          href={`/rugby-hub/safeguarding/contact?club=${officer.clubId}&assignment=${officer.safeguardingOfficerAssignmentId}&mode=${officer.messageMode}`}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm font-medium text-forest-800 outline-none transition-colors hover:border-ink/30 focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          {buttonLabel}
        </Link>
      </div>
    </article>
  )
}

export function NoSafeguardingOfficerNotice() {
  return (
    <div className="rounded-lg border border-ink/15 bg-mint-100/40 px-4 py-3.5">
      <p className="text-[15px] leading-relaxed text-ink/80">This club hasn&rsquo;t assigned a Safeguarding Officer contact on Ovalball yet.</p>
    </div>
  )
}
