"use client"

import { useState } from "react"
import { SlidersHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { AgendaFilters } from "@/lib/parent/agenda-model"

/**
 * One filter model for the agenda, in one sheet.
 *
 * A plain GET form, exactly like the Calendar's own filter sheet: the URL
 * is the filter state, so a parent can bookmark "Pippa, needs response" and
 * the server renders the same thing every time. No client state beyond
 * open/closed, so this keeps working if the sheet's JS never arrives.
 *
 * Date ranges are the practical ones a parent actually asks for. There is
 * deliberately no custom range picker: this is a parent checking what their
 * child has on, not a reporting console.
 */

const DATE_RANGES = [
  ["all", "Everything upcoming"],
  ["next_14_days", "Next 14 days"],
  ["this_month", "This month"],
  ["next_30_days", "Next 30 days"],
  ["season", "This season"],
] as const

const ATTENDANCE_OPTIONS = [
  ["all", "Any response"],
  ["needs_response", "Needs response"],
  ["ATTENDING", "Attending"],
  ["CANNOT_ATTEND", "Can't attend"],
  ["UNSURE", "Unsure"],
] as const

const KIND_OPTIONS = [
  ["all", "Matches & training"],
  ["fixture", "Matches only"],
  ["training", "Training only"],
] as const

export function AgendaFilterSheet({
  filters,
  // Deliberately NOT named `children`: that is React's own reserved prop, and
  // passing a data array under it makes the component read as though it were
  // wrapping JSX.
  familyChildren,
  venues,
  showChildFilter,
}: {
  filters: AgendaFilters
  familyChildren: { playerId: string; name: string; teamId: string; teamName: string }[]
  venues: string[]
  showChildFilter: boolean
}) {
  const [open, setOpen] = useState(false)

  const activeCount =
    (filters.playerIds.length > 0 ? 1 : 0) +
    (filters.teamIds.length > 0 ? 1 : 0) +
    (filters.kind !== "all" ? 1 : 0) +
    (filters.attendance !== "all" ? 1 : 0) +
    (filters.venue ? 1 : 0) +
    (filters.dateRange !== "all" ? 1 : 0)

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
          <SheetTitle>Filter Fixtures</SheetTitle>
        </SheetHeader>
        <form method="get" action="/agenda" className="flex max-h-[calc(100vh-8rem)] flex-col gap-5 overflow-y-auto px-4 pb-4">
          {/* Child only appears in All Children mode -- with one child
              selected there is nothing to choose between. */}
          {showChildFilter && familyChildren.length > 1 && (
            <fieldset>
              <legend className="text-sm font-medium text-ink">Child</legend>
              <div className="mt-2 flex flex-col gap-1.5">
                {familyChildren.map((c) => (
                  <label key={c.playerId} className="flex items-center gap-2 text-sm text-ink/80">
                    <input
                      type="checkbox"
                      name="child"
                      value={c.playerId}
                      defaultChecked={filters.playerIds.includes(c.playerId)}
                      className="size-4 accent-pitch-600"
                    />
                    {c.name} <span className="text-ink-subtle">· {c.teamName}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset>
            <legend className="text-sm font-medium text-ink">Date</legend>
            <div className="mt-2 flex flex-col gap-1.5">
              {DATE_RANGES.map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm text-ink/80">
                  <input type="radio" name="range" value={value} defaultChecked={filters.dateRange === value} className="size-4 accent-pitch-600" />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium text-ink">Event type</legend>
            <div className="mt-2 flex flex-col gap-1.5">
              {KIND_OPTIONS.map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm text-ink/80">
                  <input type="radio" name="kind" value={value} defaultChecked={filters.kind === value} className="size-4 accent-pitch-600" />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium text-ink">Attendance</legend>
            <div className="mt-2 flex flex-col gap-1.5">
              {ATTENDANCE_OPTIONS.map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm text-ink/80">
                  <input type="radio" name="attendance" value={value} defaultChecked={filters.attendance === value} className="size-4 accent-pitch-600" />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          {venues.length > 0 && (
            <fieldset>
              <legend className="text-sm font-medium text-ink">Venue</legend>
              <div className="mt-2 flex flex-col gap-1.5">
                <label className="flex items-center gap-2 text-sm text-ink/80">
                  <input type="radio" name="venue" value="" defaultChecked={!filters.venue} className="size-4 accent-pitch-600" />
                  Any venue
                </label>
                {venues.map((v) => (
                  <label key={v} className="flex items-center gap-2 text-sm text-ink/80">
                    <input type="radio" name="venue" value={v} defaultChecked={filters.venue === v} className="size-4 accent-pitch-600" />
                    {v}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div className="mt-2 flex items-center gap-3">
            <Button type="submit" className="h-9">
              Apply filters
            </Button>
            <Button type="button" variant="ghost" className="h-9" nativeButton={false} render={<a href="/agenda" />}>
              Clear all
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
