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
  informational: "text-ink-muted",
}

/**
 * One regulatory fact/section, presented consistently across Rules,
 * Safeguarding, and Player Welfare. anchorId, when given, is the one
 * canonical section-level fragment target (e.g. "section-SCRUM") -- it
 * belongs on the section's own container, once, never repeated per fact
 * inside a section that groups more than one (see the Pitch length/width
 * merge in the Rules page), and scroll-mt keeps it clear of the page
 * header when a search result jumps straight to it.
 */
export function RegulatoryFactCard({
  title,
  valueDisplay,
  body,
  obligation,
  isOverlay,
  tierLabel,
  sourceKey,
  locator,
  sourceMetadata,
  anchorId,
}: {
  title: string
  valueDisplay?: string | null
  body?: string | null
  obligation?: ObligationBadge | null
  isOverlay?: boolean
  /** "General Law" vs "Your Age Grade's Variation" -- the Tier-1/Tier-2 distinction, separate from isOverlay's narrower competition-overlay concept. Omit where the distinction doesn't apply (Safeguarding, Player Welfare). */
  tierLabel?: string | null
  sourceKey: string | null
  locator: string | null
  sourceMetadata: SourceMetadata | undefined
  anchorId?: string
}) {
  return (
    <article id={anchorId} className="scroll-mt-24 rounded-xl border border-ink/10 bg-white px-4 py-4">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-mint-100 text-forest-800">
          <Info aria-hidden="true" className="size-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink">{title}</h3>
            <div className="flex items-center gap-1.5">
              {tierLabel && (
                <span
                  className={
                    tierLabel === "Your Age Grade's Variation"
                      ? "rounded-full bg-forest-900 px-2 py-0.5 text-xs font-medium text-white"
                      : "rounded-full border border-ink/15 px-2 py-0.5 text-xs font-medium text-ink/60"
                  }
                >
                  {tierLabel}
                </span>
              )}
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
