"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight, History, SlidersHorizontal, X } from "lucide-react"

import type { AgendaFilterState } from "@/lib/agenda/filters"
import { filterQuery, hasActiveFilters } from "@/lib/agenda/filters"
import type { AgendaFilterAffordances } from "@/lib/agenda/scope"
import { nextAnchor, previousAnchor, type DateWindow } from "@/lib/agenda/window"
import { cn } from "@/lib/utils"

import { TactileIconLink, TactileLink } from "./tactile"

/**
 * THE CONTROLS.
 *
 * Every one of these is a LINK. The filter state lives in the URL, so a week
 * is shareable, the back button undoes a filter, and the page works before any
 * JavaScript has run. The only client state in this file is whether the
 * secondary filter drawer is open, which is genuinely a browser concern.
 *
 * HIERARCHY, because the brief's own warning is the right one: a page covered
 * in chunky buttons has no hierarchy at all. So there are exactly two tiers.
 *
 *   PRIMARY, always visible: the date mode (Week / Month / Year), the
 *   previous/next stepper, and Past. These are what a person reaches for on
 *   nearly every visit.
 *
 *   SECONDARY, behind one "Filters" control: opposition, home/away, training,
 *   child, team, club. Valuable, but not on every visit -- and on a phone they
 *   would otherwise occupy the screen the agenda needs.
 *
 * A filter that this viewer has only one of is not offered at all (see
 * filterAffordances): a club filter for somebody with one club is noise.
 */

export interface Option {
  id: string
  name: string
}

export function AgendaControls({
  state,
  todayIso,
  window,
  affordances,
  oppositions,
  teams,
  clubs,
  children: childOptions,
}: {
  state: AgendaFilterState
  todayIso: string
  window: DateWindow
  affordances: AgendaFilterAffordances
  oppositions: Option[]
  teams: Option[]
  clubs: Option[]
  children: Option[]
}) {
  const [open, setOpen] = useState(false)
  const href = (patch: Partial<AgendaFilterState>) => filterQuery({ ...state, ...patch }, todayIso)

  const activeCount =
    (state.opposition ? 1 : 0) +
    (state.homeAway !== "all" ? 1 : 0) +
    (!state.includeTraining ? 1 : 0) +
    (state.playerId ? 1 : 0) +
    (state.teamId ? 1 : 0) +
    (state.clubId ? 1 : 0) +
    // Counted like any other filter. When it was not, the attendance callout
    // could narrow the whole agenda while Filters read "0" -- the page saying
    // nothing was filtering it while something plainly was.
    (state.needsResponse ? 1 : 0)

  /** Clearing everything means everything, attendance included. */
  const CLEARED: Partial<AgendaFilterState> = {
    opposition: null,
    homeAway: "all",
    includeTraining: true,
    playerId: null,
    teamId: null,
    clubId: null,
    needsResponse: false,
  }

  const anchored = state.mode !== "upcoming"

  return (
    <div className="flex flex-col gap-3">
      {/* ---- PRIMARY: where in time -------------------------------------
          ONE row of "when", then Filters. Week/Month/Year are TIME-RANGE
          controls over the chronological agenda -- they narrow which rugby is
          listed, they do not switch the page into a second calendar product.
          The date jump lives in the drawer: jumping to a named day is a
          deliberate act, not a per-visit one, and on a phone it was costing a
          whole row of chrome above the rugby. */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Date range" className="flex flex-wrap items-center gap-2">
          <TactileLink href={href({ mode: "upcoming", direction: "upcoming", anchor: todayIso })} selected={state.mode === "upcoming" && state.direction === "upcoming"}>
            Upcoming
          </TactileLink>
          <TactileLink href={href({ mode: "week", anchor: todayIso })} selected={state.mode === "week"}>
            Week
          </TactileLink>
          <TactileLink href={href({ mode: "month", anchor: todayIso })} selected={state.mode === "month"}>
            Month
          </TactileLink>
          <TactileLink href={href({ mode: "year", anchor: todayIso })} selected={state.mode === "year"}>
            Year
          </TactileLink>
          <TactileLink
            href={href({ mode: "upcoming", direction: state.direction === "past" ? "upcoming" : "past", anchor: todayIso })}
            selected={state.direction === "past" && state.mode === "upcoming"}
            ariaLabel={state.direction === "past" ? "Show today and upcoming" : "Show past rugby"}
          >
            <History className="size-4" aria-hidden="true" />
            Past
          </TactileLink>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            aria-expanded={open}
            aria-controls="agenda-filter-drawer"
            onClick={() => setOpen((v) => !v)}
            className={cn(
              "relative inline-flex h-11 select-none items-center gap-1.5 rounded-xl border px-3.5 text-sm font-medium outline-none transition-[transform,box-shadow,background-color] duration-100 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-offset-2 active:translate-y-[3px] active:shadow-none",
              activeCount > 0
                ? "border-forest-950 bg-forest-900 font-semibold text-chalk shadow-none"
                : "border-ink/12 bg-white text-ink shadow-[0_3px_0_0_theme(colors.ink/12%)] hover:bg-chalk"
            )}
          >
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            Filters
            {activeCount > 0 && (
              <span className="ml-0.5 rounded-full bg-chalk px-1.5 text-[11px] font-bold text-forest-900 tabular-nums">{activeCount}</span>
            )}
          </button>
        </div>
      </div>

      {/* ---- PRIMARY: stepping through the chosen range ------------------ */}
      {anchored && (
        <div className="flex items-center gap-2">
          <TactileIconLink href={href({ anchor: previousAnchor(state.mode, state.anchor) })} label={`Previous ${state.mode}`}>
            <ChevronLeft className="size-4" aria-hidden="true" />
          </TactileIconLink>
          {/* NOT aria-live. Previous/next are links, so arriving at a new
              window is a navigation: the region is recreated, never mutated,
              and a live region on it announces nothing. The heading carries
              the window into the page outline instead, which is what a screen
              reader actually lands on -- and it outranks the month headers
              below, which it previously did not. */}
          <h2 className="min-w-0 flex-1 text-center font-display text-lg text-ink">{window.label}</h2>
          <TactileIconLink href={href({ anchor: nextAnchor(state.mode, state.anchor) })} label={`Next ${state.mode}`}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </TactileIconLink>
        </div>
      )}

      {/* ---- SECONDARY: the drawer -------------------------------------- */}
      {open && (
        <div id="agenda-filter-drawer" className="rounded-xl border border-ink/10 bg-white p-4 shadow-[0_1px_0_0_theme(colors.ink/6%)]">
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-xs font-semibold tracking-[0.08em] text-ink-muted uppercase">Jump to a Date</p>
              <div className="mt-2">
                <DateJump state={state} todayIso={todayIso} />
              </div>
            </div>

            <FilterRow label="Show">
              <TactileLink size="sm" href={href({ includeTraining: true })} selected={state.includeTraining}>
                Matches &amp; Training
              </TactileLink>
              <TactileLink size="sm" href={href({ includeTraining: false })} selected={!state.includeTraining}>
                Matches Only
              </TactileLink>
            </FilterRow>

            {/* The same filter the callout sets, reachable the ordinary way.
                One state, two doors -- so whichever a person used, the other
                shows it as on and can turn it off. */}
            {affordances.attendance && (
              <FilterRow label="Attendance">
                <TactileLink size="sm" href={href({ needsResponse: false })} selected={!state.needsResponse}>
                  All Activities
                </TactileLink>
                <TactileLink size="sm" href={href({ needsResponse: true })} selected={state.needsResponse}>
                  Needs My Response
                </TactileLink>
              </FilterRow>
            )}

            <FilterRow label="Home or Away">
              <TactileLink size="sm" href={href({ homeAway: "all" })} selected={state.homeAway === "all"}>
                All
              </TactileLink>
              <TactileLink size="sm" href={href({ homeAway: "Home" })} selected={state.homeAway === "Home"}>
                Home
              </TactileLink>
              <TactileLink size="sm" href={href({ homeAway: "Away" })} selected={state.homeAway === "Away"}>
                Away
              </TactileLink>
            </FilterRow>

            {affordances.child && childOptions.length > 0 && (
              <FilterRow label="Child">
                <TactileLink size="sm" href={href({ playerId: null })} selected={state.playerId === null}>
                  All Children
                </TactileLink>
                {childOptions.map((c) => (
                  <TactileLink key={c.id} size="sm" href={href({ playerId: c.id })} selected={state.playerId === c.id}>
                    {c.name}
                  </TactileLink>
                ))}
              </FilterRow>
            )}

            {affordances.team && teams.length > 1 && (
              <SelectRow
                label="Team"
                value={state.teamId}
                options={teams}
                allLabel="All teams"
                hrefFor={(v) => href({ teamId: v })}
              />
            )}

            {affordances.club && clubs.length > 1 && (
              <SelectRow label="Club" value={state.clubId} options={clubs} allLabel="All clubs" hrefFor={(v) => href({ clubId: v })} />
            )}

            {oppositions.length > 0 && (
              <SelectRow
                label="Opposition"
                value={state.opposition}
                options={oppositions}
                allLabel="Any opposition"
                hrefFor={(v) => href({ opposition: v })}
              />
            )}

            {hasActiveFilters(state) && (
              <div className="border-t border-ink/8 pt-3">
                <Link
                  href={filterQuery({ ...state, ...CLEARED }, todayIso)}
                  className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
                >
                  <X className="size-3.5" aria-hidden="true" />
                  Clear All Filters
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Jump straight to a date.
 *
 * Navigates on change rather than needing a Go button: picking a date IS the
 * action, and a second confirming click would be a step for nothing. The
 * visible label is the icon plus an accessible name, so it stays a 44px target
 * without a text label stretching the control row on a phone.
 */
function DateJump({ state, todayIso }: { state: AgendaFilterState; todayIso: string }) {
  const router = useRouter()
  return (
    <label className="relative inline-flex h-11 shrink-0 items-center rounded-xl border border-ink/12 bg-white px-3 text-sm text-ink shadow-[0_3px_0_0_theme(colors.ink/12%)] focus-within:ring-2 focus-within:ring-pitch-400 focus-within:ring-offset-2 hover:bg-chalk">
      <span className="sr-only">Jump to a date</span>
      <input
        type="date"
        value={state.mode === "day" ? state.anchor : ""}
        onChange={(e) => {
          const v = e.target.value
          if (!v) return
          // NO-OP GUARD. Chrome restores a form control's value when the page
          // is navigated to or restored, and that restoration fires change on
          // the outgoing instance -- which pushed a navigation nobody asked
          // for and bounced a person forward again after they pressed Back.
          // Caught in UAT: a plain ?mode=day URL arrived carrying the previous
          // page's view. Navigating only on a real change closes it.
          if (state.mode === "day" && v === state.anchor) return
          router.push(filterQuery({ ...state, mode: "day", anchor: v }, todayIso))
        }}
        className="w-[8.5rem] bg-transparent text-sm text-ink outline-none"
      />
    </label>
  )
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <p className="text-xs font-semibold tracking-[0.08em] text-ink-muted uppercase">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

/**
 * A native select for the long lists.
 *
 * Twenty oppositions as tactile chips would be the button-soup the brief warns
 * against, and a native select is also the control a phone renders as its own
 * scrollable picker with type-ahead -- better than anything hand-built here,
 * and keyboard-complete for free. It navigates on change, and the surrounding
 * noscript-safe links mean the page still works without JavaScript.
 */
function SelectRow({
  label,
  value,
  options,
  allLabel,
  hrefFor,
}: {
  label: string
  value: string | null
  options: Option[]
  allLabel: string
  hrefFor: (value: string | null) => string
}) {
  const id = `agenda-filter-${label.toLowerCase().replace(/\s+/g, "-")}`
  const [draft, setDraft] = useState(value ?? "")
  return (
    <div>
      <label htmlFor={id} className="text-xs font-semibold tracking-[0.08em] text-ink-muted uppercase">
        {label}
      </label>
      {/*
        A local draft plus an explicit Apply, NOT navigate-on-change.
        Arrow-keying through a closed <select> fires `change` on every keypress,
        so navigating there threw a keyboard user to the first option and
        reloaded the page under them -- the opposition filter was unusable
        without a mouse. Applying on submit also means this works with no
        JavaScript at all, because it is a real form.
      */}
      <div className="mt-2 flex gap-2">
        <select
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-11 min-w-0 flex-1 rounded-xl border border-ink/12 bg-white px-3 text-sm text-ink shadow-[0_3px_0_0_theme(colors.ink/12%)] outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          <option value="">{allLabel}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <TactileLink href={hrefFor(draft || null)} size="sm" ariaLabel={`Apply ${label.toLowerCase()} filter`}>
          Apply
        </TactileLink>
      </div>
    </div>
  )
}
