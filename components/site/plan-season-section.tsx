"use client"

import { useState } from "react"

import { cn } from "@/lib/utils"
import {
  SEASON_FIXTURES,
  SEASON_MONTHS,
  SEASON_TEAMS,
  type SeasonFixture,
} from "@/lib/marketing/fixture-demo-data"
import { Reveal } from "@/lib/motion/reveal"

const TEAM_FILTER_ALL = "All teams"

/**
 * Feature Story 2 -- Plan Your Season. A club-wide season timeline: every
 * real playing side gets its own row, the team filter narrows the view
 * without losing the "whole club" context, and each month's fixture chips
 * assemble in as the section scrolls into view (staggered Reveal, same
 * IntersectionObserver primitive used sitewide -- no scroll-scrubbing
 * needed here, the content itself is static once revealed).
 */
export function PlanSeasonSection() {
  const [teamFilter, setTeamFilter] = useState<string>(TEAM_FILTER_ALL)

  const visibleTeams = teamFilter === TEAM_FILTER_ALL ? SEASON_TEAMS : [teamFilter]

  return (
    <section className="bg-chalk py-20 md:py-28">
      <div className="mx-auto max-w-[1200px] px-4 md:px-8">
        <Reveal>
          <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
            Plan your season
          </p>
          <h2 className="mt-3 max-w-2xl font-display text-display-xl text-ink">
            Plan the whole season. Not the next spreadsheet.
          </h2>
          <p className="mt-4 max-w-xl text-base text-ink/60 md:text-lg">
            Every team runs its own fixture list. The club still sees the
            whole picture &mdash; gaps, clashes and cup rounds included, one
            season at a time.
          </p>
        </Reveal>

        <Reveal index={1}>
          <div className="mt-10 flex flex-wrap gap-2">
            {[TEAM_FILTER_ALL, ...SEASON_TEAMS].map((team) => {
              const active = team === teamFilter
              return (
                <button
                  key={team}
                  onClick={() => setTeamFilter(team)}
                  className={cn(
                    "rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pitch-400",
                    active
                      ? "border-forest-900 bg-forest-900 text-white"
                      : "border-ink/15 bg-white text-ink/70 hover:border-pitch-600 hover:text-ink"
                  )}
                >
                  {team}
                </button>
              )
            })}
          </div>
        </Reveal>

        {/* relative wrapper + edge gradient: on narrow viewports the grid is
            wider than the screen (min-w-[760px]), and nothing about
            overflow-x-auto alone signals that more months exist off to the
            right -- this fade is the affordance for that, harmless on wide
            viewports where the grid already fits. */}
        <div className="relative mt-8">
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
            {/* Month header row */}
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: `140px repeat(${SEASON_MONTHS.length}, 1fr)` }}
            >
              <div />
              {SEASON_MONTHS.map((month) => (
                <div key={month} className="pb-2 text-center text-xs font-medium tracking-[0.06em] text-ink/60 uppercase">
                  {month}
                </div>
              ))}
            </div>

            {visibleTeams.map((team, rowIndex) => (
              <Reveal key={team} index={rowIndex} className="mt-2 block">
                <div
                  className="grid items-center gap-2"
                  style={{ gridTemplateColumns: `140px repeat(${SEASON_MONTHS.length}, 1fr)` }}
                >
                  <p className="truncate pr-2 text-sm font-medium text-ink">{team}</p>
                  {SEASON_MONTHS.map((month) => {
                    const fixtures = SEASON_FIXTURES.filter(
                      (f) => f.team === team && f.month === month
                    )
                    return (
                      <div key={month} className="flex min-h-11 flex-col gap-1 rounded-md bg-white p-1.5">
                        {fixtures.map((fixture, i) => (
                          <SeasonChip key={i} fixture={fixture} />
                        ))}
                      </div>
                    )
                  })}
                </div>
              </Reveal>
            ))}
            </div>
          </div>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-chalk to-transparent md:hidden"
          />
        </div>

        <Reveal index={visibleTeams.length + 1}>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-ink/65">
            <LegendItem swatch="bg-pitch-600" label="Confirmed" />
            <LegendItem swatch="bg-mint-300" label="Planned" />
            <LegendItem swatch="bg-rugby-700" label="Cup / event" />
            <span>H / A = Home / Away</span>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function SeasonChip({ fixture }: { fixture: SeasonFixture }) {
  return (
    <div
      title={`${fixture.opponent} (${fixture.venue})`}
      className={cn(
        "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] leading-tight font-medium whitespace-nowrap",
        fixture.isCup
          ? "bg-rugby-700 text-white"
          : fixture.status === "confirmed"
            ? "bg-pitch-600/15 text-forest-800"
            : "bg-mint-300/40 text-forest-900"
      )}
    >
      <span className="truncate">{fixture.opponent}</span>
      <span className="opacity-60">{fixture.venue}</span>
    </div>
  )
}

function LegendItem({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("size-2.5 rounded-full", swatch)} />
      {label}
    </span>
  )
}
