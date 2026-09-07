import { Info } from "lucide-react"

import type { SourceMetadata } from "@/lib/app-context/rugby-hub-data"

import { OfficialSourceLink } from "./official-source-link"

interface ObligationBadge {
  label: string
  tone: "mandatory" | "recommended" | "informational"
}

const OBLIGATION_STYLES: Record<ObligationBadge["tone"], string> = {
  mandatory: "bg-forest-900 text-white",
  recommended: "border border-pitch-600/40 text-forest-800",
  informational: "text-ink/50",
}

/** One regulatory fact/section, presented consistently across Rules, Safeguarding, and Player Welfare. */
export function RegulatoryFactCard({
  title,
  valueDisplay,
  body,
  obligation,
  isOverlay,
  sourceKey,
  locator,
  sourceMetadata,
}: {
  title: string
  valueDisplay?: string | null
  body?: string | null
  obligation?: ObligationBadge | null
  isOverlay?: boolean
  sourceKey: string | null
  locator: string | null
  sourceMetadata: SourceMetadata | undefined
}) {
  return (
    <article className="rounded-xl border border-ink/10 bg-white px-4 py-4">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-mint-100 text-forest-800">
          <Info aria-hidden="true" className="size-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink">{title}</h3>
            <div className="flex items-center gap-1.5">
              {isOverlay && <span className="rounded-full border border-pitch-600/40 px-2 py-0.5 text-xs font-medium text-forest-800">Competition variation</span>}
              {obligation && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${OBLIGATION_STYLES[obligation.tone]}`}>{obligation.label}</span>}
            </div>
          </div>

          {valueDisplay && <p className="mt-1 font-display text-2xl text-forest-900">{valueDisplay}</p>}
          {body && <p className="mt-1.5 text-[15px] leading-relaxed text-ink/80">{body}</p>}

          <OfficialSourceLink sourceKey={sourceKey} locator={locator} metadata={sourceMetadata} />
        </div>
      </div>
    </article>
  )
}
