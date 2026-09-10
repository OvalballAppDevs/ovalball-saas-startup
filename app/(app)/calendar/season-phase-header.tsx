import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { type SeasonRow } from "@/lib/calendar/season-window"
import { qs } from "@/lib/calendar/query-string"
import { cn } from "@/lib/utils"

/**
 * WHOSE SEASON, AND WHICH ONE.
 *
 * The one season/phase header Week, Month, Season AND Agenda all render, so
 * switching views never changes either the look or the underlying state model.
 * `basePath` is the only thing that differs between callers ("/calendar" vs
 * "/calendar/agenda").
 *
 * IT STATES A RUGBY SEASON, NOT A SETTING. It used to show the bare reference
 * -- "26/27" -- flanked by two chevrons, which reads as a dropdown value
 * someone happened to leave selected rather than as the season the club is
 * playing. It now leads with the season's own canonical name ("Rugby Union
 * 26/27"), which the register derives from the code and the year and which
 * therefore carries the rugby code without a second lookup or a hardcoded
 * word, and names the context underneath it.
 *
 * PHASE IS PART OF THE IDENTITY, not a filter applied to it, so the toggle
 * lives inside this block rather than in the toolbar below. Pre-Season is
 * offered only where the register records a pre-season start: a season without
 * one has no pre-season, and inventing a boundary here would be a second
 * answer to a question Site Admin already answers.
 */
export function SeasonPhaseHeader({
  basePath,
  baseParams,
  contextLabel,
  selectedSeason,
  selectedPhase,
  prevSeason,
  nextSeason,
}: {
  basePath: string
  baseParams: Record<string, string | null | undefined>
  /** Whose calendar this is -- the club, the team, or the family scope. */
  contextLabel?: string
  selectedSeason: SeasonRow | null
  selectedPhase: "pre" | "main"
  prevSeason: SeasonRow | null
  nextSeason: SeasonRow | null
}) {
  if (!selectedSeason) return null

  const isPre = selectedPhase === "pre"
  const stepper = cn(
    "flex size-11 items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 sm:size-9",
    isPre ? "text-white/70 hover:bg-white/12" : "text-ink-muted hover:bg-ink/6"
  )

  return (
    <div
      className={cn(
        "mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-2xl px-4 py-3.5",
        isPre ? "bg-forest-950 text-white" : "border border-ink/8 bg-white"
      )}
    >
      <div className="flex min-w-0 items-center gap-1">
        <Link
          href={prevSeason ? `${basePath}${qs({ ...baseParams, season: prevSeason.id, phase: null, week: null, month: null })}` : "#"}
          aria-disabled={!prevSeason}
          tabIndex={prevSeason ? undefined : -1}
          className={cn(stepper, "-ml-2", !prevSeason && "pointer-events-none opacity-25")}
          aria-label="Previous Season"
        >
          <ChevronLeft className="size-4" />
        </Link>

        <div className="min-w-0 px-1">
          {/* The season's canonical name carries both the code and the year,
              so neither is spelled out again or hardcoded here. */}
          <p className={cn("truncate font-display text-lg leading-none", isPre ? "text-white" : "text-ink")}>{selectedSeason.name}</p>
          {contextLabel && (
            <p className={cn("mt-1 truncate text-xs", isPre ? "text-white/60" : "text-ink-subtle")}>{contextLabel}</p>
          )}
        </div>

        <Link
          href={nextSeason ? `${basePath}${qs({ ...baseParams, season: nextSeason.id, phase: null, week: null, month: null })}` : "#"}
          aria-disabled={!nextSeason}
          tabIndex={nextSeason ? undefined : -1}
          className={cn(stepper, !nextSeason && "pointer-events-none opacity-25")}
          aria-label="Next Season"
        >
          <ChevronRight className="size-4" />
        </Link>
      </div>

      <div
        className={cn("flex items-center gap-1 rounded-xl p-1", isPre ? "bg-white/10" : "bg-chalk")}
        role="group"
        aria-label="Season Phase"
      >
        {selectedSeason.preSeasonStartsOn && (
          <Link
            href={`${basePath}${qs({ ...baseParams, season: selectedSeason.id, phase: "pre", week: null, month: null })}`}
            aria-current={isPre ? "true" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors sm:min-h-9",
              isPre ? "bg-white text-forest-950 shadow-sm" : "text-ink-muted hover:bg-white hover:text-ink"
            )}
          >
            Pre-Season
          </Link>
        )}
        <Link
          href={`${basePath}${qs({ ...baseParams, season: selectedSeason.id, phase: "main", week: null, month: null })}`}
          aria-current={!isPre ? "true" : undefined}
          className={cn(
            "inline-flex min-h-11 items-center rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors sm:min-h-9",
            !isPre ? "bg-forest-950 text-white shadow-sm" : "text-white/70 hover:bg-white/12"
          )}
        >
          Season
        </Link>
      </div>
    </div>
  )
}
