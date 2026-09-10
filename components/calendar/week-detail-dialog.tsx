"use client"

import { useOptimistic, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

/**
 * ONE WEEK, IN FULL.
 *
 * The Season grid is deliberately high-level: a cell says whether anything is
 * on and roughly what. Everything else -- which team, what time, which pitch,
 * and the routes into Match Centre and Training Centre -- lives here, so
 * scanning the year and reading a week are two different acts rather than one
 * very long page.
 *
 * THE URL IS THE STATE. The panel is open because `?week=` is set, not because
 * a component remembers a click, so a week is linkable, Back closes it, and a
 * reload lands where it was. Closing navigates rather than mutating local
 * state, which is also what keeps the CONTENTS server-rendered: the events are
 * passed in as already-authorised children, and this client component never
 * fetches, filters or decides who may see what.
 *
 * WHY CLOSING IS OPTIMISTIC. Removing `?week=` is a server navigation, and a
 * server navigation takes time. With the panel driven straight off the `open`
 * prop, that time was dead air: you pressed the close button and the panel sat
 * there, fully open, until the round trip finished -- long enough to read as a
 * broken button and to press it again.
 *
 * `useOptimistic` closes it on the press and then RECONCILES with the prop
 * when the navigation lands. This is deliberately not a second source of
 * truth: the optimistic value is derived from `open` and is discarded the
 * moment a new `open` arrives, so it cannot drift, cannot disagree with the
 * URL, and needs no effect to keep the two in step. If the navigation fails,
 * React restores the value from the prop and the panel reopens -- which is the
 * honest outcome, because the week is still selected.
 */
export function WeekDetailDialog({
  open,
  closeHref,
  title,
  subtitle,
  countLabel,
  prevWeekHref,
  nextWeekHref,
  children,
}: {
  open: boolean
  closeHref: string
  title: string
  subtitle: string
  /** "9 Events" -- the panel's own scale, before the list of them. */
  countLabel: string
  /** Neighbouring weeks inside the same season, or null at either end. */
  prevWeekHref: string | null
  nextWeekHref: string | null
  children: React.ReactNode
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [optimisticOpen, setOptimisticOpen] = useOptimistic(open)

  return (
    <Dialog
      open={optimisticOpen}
      onOpenChange={(next) => {
        if (next) return
        // One close path for every gesture -- the close button, Escape, a
        // click on the backdrop -- so all three behave identically and none
        // needs its own handler.
        startTransition(() => {
          setOptimisticOpen(false)
          router.push(closeHref, { scroll: false })
        })
      }}
    >
      <DialogContent
        className={[
          // MOBILE: a bottom sheet, anchored to the bottom edge and full
          // width, because a centred 512px modal on a 390px screen is a
          // desktop dialog wearing a costume. Above `sm` it returns to a
          // centred panel.
          "fixed inset-x-0 bottom-0 top-auto left-0 max-h-[88vh] w-full max-w-none translate-x-0 translate-y-0",
          "gap-0 overflow-hidden rounded-t-2xl rounded-b-none p-0",
          "sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[85vh] sm:w-full sm:max-w-lg",
          "sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
          "flex flex-col",
        ].join(" ")}
        // Open on the panel, not on its first link. The default lands focus on
        // the first event, which reads as though that event is selected and
        // puts a keyboard user one stray Enter from navigating away from the
        // week they just opened. Focusing the panel keeps the heading the
        // first thing announced, and Tab still reaches every event in order.
        initialFocus={false}
        showCloseButton={false}
      >
        {/* The grab handle is the sheet's own affordance and means nothing on
            a desktop panel, so it is hidden there rather than drawn twice. */}
        <div aria-hidden="true" className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-ink/15 sm:hidden" />

        <DialogHeader className="shrink-0 border-b border-ink/8 px-5 pt-4 pb-3.5 text-left">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="font-display text-xl leading-none text-ink">{title}</DialogTitle>
              <DialogDescription className="mt-1.5 text-sm text-ink-muted">{subtitle}</DialogDescription>
            </div>
            <WeekDialogClose />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            {countLabel ? (
              <p className="inline-flex w-fit items-center rounded-full bg-forest-950/6 px-2.5 py-1 text-xs font-medium text-forest-900">{countLabel}</p>
            ) : (
              <p className="text-xs text-ink-subtle">Nothing booked</p>
            )}
            {/* STEP THROUGH THE SEASON WITHOUT LEAVING. Reviewing a season
                means reading several weeks in a row, and a modal backdrop
                makes that close-then-click, close-then-click. These move the
                selection straight to the neighbouring week -- the same URL
                change the grid makes, so the grid stays in step. */}
            {(prevWeekHref || nextWeekHref) && (
              <div className="flex shrink-0 items-center gap-1">
                <WeekStep href={prevWeekHref} label="Previous Week" direction="prev" />
                <WeekStep href={nextWeekHref} label="Next Week" direction="next" />
              </div>
            )}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The close control.
 *
 * Rendered here rather than taken from DialogContent's default so it sits
 * inside the header's own layout instead of floating over the title, and so it
 * meets the 44px target on a phone where it is the primary way out.
 */
function WeekDialogClose() {
  return (
    <DialogClose
      aria-label="Close"
      className="-mt-1.5 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-ink/6 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none sm:size-9"
    >
      <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
        <path d="M5 5l10 10M15 5L5 15" />
      </svg>
    </DialogClose>
  )
}

/** One week-stepping control, disabled rather than hidden at the season's ends. */
function WeekStep({ href, label, direction }: { href: string | null; label: string; direction: "prev" | "next" }) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight
  const shared =
    "inline-flex size-11 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none sm:size-9"
  if (!href) {
    return (
      <span aria-hidden="true" className={`${shared} cursor-default text-ink/20`}>
        <Icon className="size-4" />
      </span>
    )
  }
  return (
    <Link href={href} aria-label={label} scroll={false} className={`${shared} text-ink-muted hover:bg-ink/6 hover:text-ink`}>
      <Icon className="size-4" />
    </Link>
  )
}
