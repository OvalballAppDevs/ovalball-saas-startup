"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronDown } from "lucide-react"

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { groupAndSortLanes, type FilterableLane } from "@/lib/teams/filter-groups"
import { qs } from "@/lib/calendar/query-string"
import { cn } from "@/lib/utils"

/**
 * The one grouped team-filter component Month/Week/Agenda all render
 * (Master Architecture Pass addendum reconciliation, "Calendar Filters" /
 * "One filter model" / "Same filters in Agenda") -- replaces the flat,
 * alphabetically-scattered chip wall with Minis+Juniors/Colts/Girls/
 * Women's/Men's groups (lib/teams/filter-groups.ts), never a
 * page-local reimplementation. Single-select, matching the existing
 * "view as this one lane, or All teams" semantics -- this was never a
 * multi-select filter and this rework doesn't change that.
 *
 * Desktop: grouped chip clusters, each with its own small uppercase
 * label, wrapping naturally. Mobile: a compact trigger showing the
 * current selection, opening a Sheet with the same groups as a scrollable
 * list -- never the old full chip wall pushed below the fold.
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
      {/* Desktop: grouped chip clusters. */}
      <div className="mt-3 hidden flex-wrap items-start gap-x-5 gap-y-2 md:flex">
        <TeamChip label="All teams" active={!activeTeam} href={hrefFor(null)} />
        {groups.map((g) => (
          <div key={g.key} className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold tracking-[0.08em] text-ink/35 uppercase">{g.label}</span>
            {g.lanes.map((l) => (
              <TeamChip key={l.id} label={l.label} title={l.fullLabel} active={activeTeam === l.id} href={hrefFor(l.id)} />
            ))}
          </div>
        ))}
      </div>

      {/* Mobile: compact trigger + grouped Sheet. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 flex w-full items-center justify-between gap-2 rounded-lg border border-ink/15 bg-white px-3 py-2 text-left text-sm font-medium text-ink outline-none md:hidden"
      >
        <span className="truncate">{activeLane ? activeLane.fullLabel : "All teams"}</span>
        <ChevronDown className="size-4 shrink-0 text-ink/40" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Filter by team</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-5 px-4 pb-6">
            <Link
              href={hrefFor(null)}
              onClick={() => setOpen(false)}
              className={cn(
                "rounded-lg border px-3 py-2.5 text-sm font-medium",
                !activeTeam ? "border-pitch-600 bg-pitch-600/10 text-forest-900" : "border-ink/15 text-ink/70"
              )}
            >
              All teams
            </Link>
            {groups.map((g) => (
              <div key={g.key}>
                <p className="text-xs font-semibold tracking-[0.06em] text-ink/45 uppercase">{g.label}</p>
                <div className="mt-2 flex flex-col gap-1.5">
                  {g.lanes.map((l) => (
                    <Link
                      key={l.id}
                      href={hrefFor(l.id)}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "rounded-lg border px-3 py-2.5 text-sm font-medium",
                        activeTeam === l.id ? "border-pitch-600 bg-pitch-600/10 text-forest-900" : "border-ink/15 text-ink/70"
                      )}
                    >
                      {l.fullLabel}
                    </Link>
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

function TeamChip({ label, title, active, href }: { label: string; title?: string; active: boolean; href: string }) {
  return (
    <Link
      href={href}
      title={title}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active ? "border-pitch-600 bg-pitch-600/10 text-forest-900" : "border-ink/15 text-ink/60 hover:bg-ink/5"
      )}
    >
      {label}
    </Link>
  )
}
