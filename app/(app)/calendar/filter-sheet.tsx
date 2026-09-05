"use client"

import { useState } from "react"
import { SlidersHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { FIXTURE_STATUS_LABEL } from "@/lib/fixtures/status"

// A deliberately curated everyday subset of ALL_FIXTURE_STATUSES
// (lib/fixtures/status.ts) -- Calendar's Filter sheet only, never a
// separate list of what a status IS or how it's labelled/styled. Excludes
// the three legacy CSV-import-only statuses (Annual Holiday/Festival/
// Lancashire Cup), which would clutter an everyday forward-looking filter
// -- "To Be Determined" was previously missing here entirely (a real
// oversight, not a deliberate omission) and is included now.
const STATUS_OPTIONS = ["Booked", "Planned", "To Be Determined", "Cancelled", "Completed"] as const

/**
 * The everyday Calendar stays calm: Team stays as its own always-visible
 * row of chips (switched often), Status/Home-Away/Kind live behind one
 * compact Filter button instead of a permanent row of dropdowns. A plain
 * GET form -- no client state beyond open/closed -- so filtering works
 * without depending on JS beyond the Sheet itself.
 */
export function FilterSheet({
  activeStatuses,
  activeHomeAway,
  activeKind,
  activeTeam,
  activeWeek,
  activeSeason,
  activePhase,
  activeView,
}: {
  activeStatuses: string[]
  activeHomeAway: string | null
  activeKind: string | null
  activeTeam: string | null
  activeWeek: string | null
  activeSeason: string | null
  activePhase: string | null
  activeView: string | null
}) {
  const [open, setOpen] = useState(false)
  const activeCount = activeStatuses.length + (activeHomeAway ? 1 : 0) + (activeKind ? 1 : 0)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setOpen(true)}>
        <SlidersHorizontal className="size-3.5" />
        Filter
        {activeCount > 0 && (
          <span className="flex size-4 items-center justify-center rounded-full bg-pitch-600 text-[10px] font-semibold text-white">{activeCount}</span>
        )}
      </Button>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Filter Calendar</SheetTitle>
        </SheetHeader>
        <form method="get" action="/calendar" className="flex flex-col gap-5 px-4 pb-4">
          {activeTeam && <input type="hidden" name="team" value={activeTeam} />}
          {activeWeek && <input type="hidden" name="week" value={activeWeek} />}
          {activeSeason && <input type="hidden" name="season" value={activeSeason} />}
          {activePhase && <input type="hidden" name="phase" value={activePhase} />}
          {activeView && <input type="hidden" name="view" value={activeView} />}

          <fieldset>
            <legend className="text-sm font-medium text-ink">Status</legend>
            <div className="mt-2 flex flex-col gap-1.5">
              {STATUS_OPTIONS.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm text-ink/80">
                  <input type="checkbox" name="status" value={s} defaultChecked={activeStatuses.includes(s)} className="size-4 accent-pitch-600" />
                  {FIXTURE_STATUS_LABEL[s]}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium text-ink">Home / Away</legend>
            <div className="mt-2 flex flex-col gap-1.5">
              {[
                ["", "Both"],
                ["home", "Home"],
                ["away", "Away"],
              ].map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm text-ink/80">
                  <input type="radio" name="ha" value={value} defaultChecked={(activeHomeAway ?? "") === value} className="size-4 accent-pitch-600" />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium text-ink">Kind</legend>
            <div className="mt-2 flex flex-col gap-1.5">
              {[
                ["", "Fixtures & training"],
                ["fixture", "Fixtures only"],
                ["training", "Training only"],
              ].map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm text-ink/80">
                  <input type="radio" name="kind" value={value} defaultChecked={(activeKind ?? "") === value} className="size-4 accent-pitch-600" />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-2 flex items-center gap-3">
            <Button type="submit" className="h-9">
              Apply filters
            </Button>
            <Button type="button" variant="ghost" className="h-9" nativeButton={false} render={<a href="/calendar" />}>
              Clear all
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
