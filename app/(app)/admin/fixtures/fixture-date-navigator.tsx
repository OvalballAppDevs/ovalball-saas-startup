"use client"

import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"

import {
  describeFixtureWindow,
  stepWindow,
  todayIso,
  windowContains,
  windowFor,
  type FixtureWindow,
  type FixtureWindowKind,
} from "@/lib/fixtures/date-window"

/**
 * MOVING A WEEK AT A TIME, WITHOUT OPENING ANYTHING.
 *
 * Previous, next and This Week are ordinary links carrying the next window's
 * two dates. That is the point of the control: an administrator checking the
 * next three Saturdays presses one key three times, rather than opening a
 * dialog, choosing, closing, and repeating. A specific date is still reachable
 * through the picker beside them, which is the interaction a picker is
 * genuinely better at.
 *
 * The stepper is `<Link>`, not a button with an onClick, so the window is in
 * the URL: shareable, bookmarkable, restored by the back button, and prefetched
 * by the router so the next week is usually already there.
 *
 * At 320px the stepper and the picker stack rather than shrinking. A 44px
 * target that has been squeezed to 28px to fit a row is not a control a person
 * can use on a touchscreen in a car park, which is where this screen gets used.
 */
export function FixtureDateNavigator({ window: current, basePath }: { window: FixtureWindow | null; basePath: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const today = todayIso()

  function hrefFor(next: FixtureWindow | null): string {
    const params = new URLSearchParams(searchParams.toString())
    if (next) {
      params.set("from_date", next.from)
      params.set("to_date", next.to)
      // A window and a date bucket are two answers to one question. Choosing a
      // window retires the bucket rather than leaving a stale "Upcoming" beside
      // a range that includes last Tuesday.
      params.delete("date")
    } else {
      params.delete("from_date")
      params.delete("to_date")
    }
    // Any change of window starts at the first page of the new window.
    params.delete("page")
    const query = params.toString()
    return query ? `${basePath}?${query}` : basePath
  }

  const thisPeriod = windowFor(current?.kind ?? "week", today)
  const isNow = current ? windowContains(current, today) : false

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex w-full min-w-0 items-center gap-1.5 sm:w-auto">
        {current ? (
          <>
            <Link
              href={hrefFor(stepWindow(current, -1))}
              aria-label={current.kind === "month" ? "Previous month" : "Previous week"}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-ink/15 bg-white text-ink-muted outline-none hover:border-ink/30 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 sm:size-9"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Link>
            {/* The window states itself. A stepper whose current position is
                only implied is a stepper people press twice to check. */}
            <p aria-live="polite" className="min-w-0 flex-1 truncate px-1 text-center text-sm font-medium text-ink sm:flex-none sm:px-2 sm:text-left">
              {describeFixtureWindow(current)}
              {isNow && <span className="ml-1.5 text-xs font-normal text-forest-800">now</span>}
            </p>
            <Link
              href={hrefFor(stepWindow(current, 1))}
              aria-label={current.kind === "month" ? "Next month" : "Next week"}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-ink/15 bg-white text-ink-muted outline-none hover:border-ink/30 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 sm:size-9"
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          </>
        ) : (
          <p className="text-sm text-ink-muted">Showing the whole list</p>
        )}
      </div>

      <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
        <Link
          href={hrefFor(thisPeriod)}
          className="inline-flex min-h-11 items-center rounded-lg border border-ink/15 bg-white px-3 text-sm font-medium text-ink/70 outline-none hover:border-ink/30 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 sm:min-h-9"
        >
          {thisPeriod.kind === "month" ? "This Month" : "This Week"}
        </Link>

        <select
          aria-label="Period length"
          value={current?.kind ?? "none"}
          onChange={(e) => {
            const value = e.target.value
            router.push(hrefFor(value === "none" ? null : windowFor(value as FixtureWindowKind, current?.from ?? today)))
          }}
          className="h-11 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink/70 outline-none focus-visible:border-pitch-600 sm:h-9"
        >
          <option value="none">No date window</option>
          <option value="week">By week</option>
          <option value="month">By month</option>
        </select>

        {/* The picker is for the job a picker is good at: jumping somewhere
            specific. It sets the window CONTAINING the chosen day rather than
            filtering to that single day, so choosing a Wednesday still shows
            the Saturday everyone came to look at. */}
        <label className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-ink/15 bg-white px-2.5 text-sm text-ink/70 focus-within:border-pitch-600 sm:min-h-9">
          <CalendarDays className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
          <span className="sr-only">Jump to a date</span>
          <input
            type="date"
            value={current?.from ?? ""}
            onChange={(e) => {
              if (!e.target.value) return
              router.push(hrefFor(windowFor(current?.kind ?? "week", e.target.value)))
            }}
            className="w-[8.5rem] bg-transparent text-sm text-ink outline-none"
          />
        </label>
      </div>
    </div>
  )
}
