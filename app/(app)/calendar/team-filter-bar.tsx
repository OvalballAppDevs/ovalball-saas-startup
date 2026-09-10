"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronDown, Users } from "lucide-react"

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { groupAndSortLanes, type FilterableLane } from "@/lib/teams/filter-groups"
import { qs } from "@/lib/calendar/query-string"
import { cn } from "@/lib/utils"

/**
 * WHOSE RUGBY AM I LOOKING AT.
 *
 * The one grouped team filter Calendar and Agenda both render -- never a
 * page-local reimplementation. Single-select, matching the existing "this one
 * lane, or All Teams" semantics; this was never a multi-select filter.
 *
 * IT IS A CHOICE, NOT A WALL. It used to lay every team out as a chip: a club
 * running eighteen sides got eighteen equally-prominent pills across two rows,
 * with "All Teams" as the first of them, so the global context choice looked
 * like just another team and the filter out-shouted the season it was meant to
 * be filtering. It is now one control stating the current choice, opening the
 * same grouped list -- at every width, not only on a phone, because eighteen
 * pills are no more readable on a desktop than on a handset.
 *
 * Grouping (Minis + Juniors / Colts / Girls / Women's / Men's) comes from
 * lib/teams/filter-groups.ts, which is also the one place the group order and
 * labels are decided.
 *
 * A viewer with a single team is offered nothing: there is no choice to make,
 * and the team they are looking at is already named in the header above.
 */
export function TeamFilterBar<T extends FilterableLane>({
  lanes,
  activeTeam,
  baseParams,
}: {
  lanes: T[]
  activeTeam: string | null
  baseParams: Record<string, string | null | undefined>
}) {
  const [open, setOpen] = useState(false)
  if (lanes.length <= 1) return null

  const groups = groupAndSortLanes(lanes)
  const activeLane = activeTeam ? lanes.find((l) => l.id === activeTeam) : null
  const hrefFor = (teamId: string | null) => `/calendar${qs({ ...baseParams, team: teamId })}`

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl border px-3 text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none sm:min-h-9",
          // A chosen team is a live filter and says so; "All Teams" is the
          // resting state and stays quiet.
          activeLane ? "border-forest-950 bg-forest-950 text-white" : "border-ink/12 bg-white text-ink-muted hover:text-ink"
        )}
      >
        <Users className={cn("size-3.5 shrink-0", activeLane ? "text-white/70" : "text-ink-subtle")} aria-hidden="true" />
        <span className="truncate">{activeLane ? activeLane.fullLabel : "All Teams"}</span>
        <ChevronDown className={cn("size-3.5 shrink-0", activeLane ? "text-white/70" : "text-ink-subtle")} aria-hidden="true" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Filter by Team</SheetTitle>
          </SheetHeader>
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-8">
            {/* The global choice, set apart from the teams rather than filed
                among them -- it is a different kind of answer. */}
            <TeamOption label="All Teams" active={!activeTeam} href={hrefFor(null)} onNavigate={() => setOpen(false)} />

            {groups.map((g) => (
              <div key={g.key}>
                <p className="text-[11px] font-semibold tracking-[0.08em] text-ink-subtle uppercase">{g.label}</p>
                <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {g.lanes.map((l) => (
                    <TeamOption
                      key={l.id}
                      label={l.fullLabel}
                      active={activeTeam === l.id}
                      href={hrefFor(l.id)}
                      onNavigate={() => setOpen(false)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

function TeamOption({ label, active, href, onNavigate }: { label: string; active: boolean; href: string; onNavigate: () => void }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex min-h-11 items-center rounded-xl border px-3.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none",
        active ? "border-forest-950 bg-forest-950 text-white" : "border-ink/12 bg-white text-ink hover:bg-chalk"
      )}
    >
      {label}
    </Link>
  )
}
