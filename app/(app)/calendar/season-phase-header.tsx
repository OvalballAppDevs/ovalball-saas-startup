import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { type SeasonRow } from "@/lib/calendar/season-window"
import { qs } from "@/lib/calendar/query-string"
import { cn } from "@/lib/utils"

/**
 * The one season/phase header Week, Month, AND Agenda all render (Master
 * Architecture Pass reconciliation -- Agenda previously had its own flat
 * "current season / previous seasons" list instead of this Pre-Season/
 * Season toggle + prev/next season nav, so switching views changed both
 * the look AND the underlying state model). `basePath` is the only thing
 * that differs between callers ("/calendar" vs "/calendar/agenda").
 */
export function SeasonPhaseHeader({
  basePath,
  baseParams,
  selectedSeason,
  selectedPhase,
  prevSeason,
  nextSeason,
}: {
  basePath: string
  baseParams: Record<string, string | null | undefined>
  selectedSeason: SeasonRow | null
  selectedPhase: "pre" | "main"
  prevSeason: SeasonRow | null
  nextSeason: SeasonRow | null
}) {
  if (!selectedSeason) return null
  return (
    <div
      className={cn(
        "mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3",
        selectedPhase === "pre" ? "bg-forest-950 text-white" : "bg-forest-900/[0.04] text-forest-950"
      )}
    >
      <div className="flex items-center gap-1">
        <Link
          href={prevSeason ? `${basePath}${qs({ ...baseParams, season: prevSeason.id, phase: null, week: null, month: null })}` : "#"}
          aria-disabled={!prevSeason}
          className={cn(
            "flex size-7 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-pitch-400",
            selectedPhase === "pre" ? "text-white/60 hover:bg-white/10" : "text-ink/50 hover:bg-ink/5",
            !prevSeason && "pointer-events-none opacity-30"
          )}
          aria-label="Previous season"
        >
          <ChevronLeft className="size-4" />
        </Link>
        <span className="min-w-[3.5rem] text-center text-sm font-semibold">{selectedSeason.seasonRef}</span>
        <Link
          href={nextSeason ? `${basePath}${qs({ ...baseParams, season: nextSeason.id, phase: null, week: null, month: null })}` : "#"}
          aria-disabled={!nextSeason}
          className={cn(
            "flex size-7 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-pitch-400",
            selectedPhase === "pre" ? "text-white/60 hover:bg-white/10" : "text-ink/50 hover:bg-ink/5",
            !nextSeason && "pointer-events-none opacity-30"
          )}
          aria-label="Next season"
        >
          <ChevronRight className="size-4" />
        </Link>
      </div>

      <div className={cn("flex items-center gap-1 rounded-lg p-1", selectedPhase === "pre" ? "bg-white/10" : "bg-white")}>
        {selectedSeason.preSeasonStartsOn && (
          <Link
            href={`${basePath}${qs({ ...baseParams, season: selectedSeason.id, phase: "pre", week: null, month: null })}`}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              selectedPhase === "pre" ? "bg-white text-forest-950" : "text-ink/60 hover:bg-ink/5"
            )}
          >
            Pre-Season
          </Link>
        )}
        <Link
          href={`${basePath}${qs({ ...baseParams, season: selectedSeason.id, phase: "main", week: null, month: null })}`}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            selectedPhase === "main" ? "bg-forest-950 text-white" : selectedPhase === "pre" ? "text-white/70 hover:bg-white/10" : "text-ink/60 hover:bg-ink/5"
          )}
        >
          Season
        </Link>
      </div>
    </div>
  )
}
