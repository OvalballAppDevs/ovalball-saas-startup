"use client"

import { useRef, useState } from "react"

import { cn } from "@/lib/utils"
import { JOURNEY_FIXTURES, JOURNEY_STAGES } from "@/lib/marketing/fixture-journey-demo"

/**
 * The six stages a fixture moves through, as a tab set.
 *
 * Genuine tabs this time -- one selected stage, one panel -- so the ARIA
 * pattern is the honest one: arrow keys move between stages, Home/End jump
 * to the ends, and the panel is labelled by its tab. Nothing here depends
 * on hover, and the panel content is text, so the walkthrough works at any
 * width and with any input device.
 */
const FIXTURE = JOURNEY_FIXTURES[0]

const STAGE_DETAIL: Record<string, { line: string; detail: string }> = {
  request: {
    line: `${FIXTURE.ourTeam} → ${FIXTURE.opponentTeam}`,
    detail: `A request goes to a real club and a real team, with the date and venue you are proposing attached to it.`,
  },
  discuss: {
    line: "“11:00 works for us. We can host.”",
    detail: `The conversation belongs to this fixture, so the reply is not sitting in someone's personal inbox.`,
  },
  confirm: {
    line: `${FIXTURE.date} · ${FIXTURE.kickoff} · ${FIXTURE.homeOrAway}`,
    detail: `Agreed once. Both clubs are now working from the same record rather than two versions of it.`,
  },
  schedule: {
    line: `${FIXTURE.shortDate} in the club and team calendars`,
    detail: `The fixture appears for the people it belongs to, without anyone re-entering it anywhere.`,
  },
  allocate: {
    line: `${FIXTURE.pitch} · ${FIXTURE.pitchWindow}`,
    detail: `A home fixture reaches the ground planning, so the pitch it needs is visible to whoever manages it.`,
  },
  play: {
    line: `${FIXTURE.venue} · ${FIXTURE.kickoff}`,
    detail: `Both teams arrive at the same place, at the same time, expecting the same game.`,
  },
}

export function FixtureJourney() {
  const [active, setActive] = useState(0)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"]
    if (!keys.includes(event.key)) return
    event.preventDefault()

    const last = JOURNEY_STAGES.length - 1
    let next = index
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index === last ? 0 : index + 1
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index === 0 ? last : index - 1
    if (event.key === "Home") next = 0
    if (event.key === "End") next = last

    setActive(next)
    tabRefs.current[next]?.focus()
  }

  const stage = JOURNEY_STAGES[active]
  const detail = STAGE_DETAIL[stage.id]

  return (
    <div>
      <div
        role="tablist"
        aria-label="Stages of organising a fixture"
        className="flex flex-wrap gap-2"
      >
        {JOURNEY_STAGES.map((s, i) => {
          const selected = i === active
          return (
            <button
              key={s.id}
              ref={(el) => {
                tabRefs.current[i] = el
              }}
              type="button"
              role="tab"
              id={`journey-tab-${s.id}`}
              aria-selected={selected}
              aria-controls={`journey-panel-${s.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none",
                selected
                  ? "border-pitch-600 bg-pitch-600 text-ink"
                  : "border-white/15 bg-white/[0.04] text-white/70 hover:border-white/30 hover:text-white"
              )}
            >
              {/* The number carries real information here: these stages are
                  genuinely sequential. */}
              <span className={cn("text-xs tabular-nums", selected ? "text-ink/55" : "text-white/40")}>
                {String(i + 1).padStart(2, "0")}
              </span>
              {s.label}
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id={`journey-panel-${stage.id}`}
        aria-labelledby={`journey-tab-${stage.id}`}
        tabIndex={0}
        className="mt-6 rounded-xl border border-white/10 bg-white/[0.035] p-6 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none md:p-8"
      >
        <p className="text-base text-white/75 md:text-lg">{stage.blurb}</p>

        <div className="mt-6 rounded-lg border border-white/10 bg-forest-950/60 px-4 py-4">
          <p className="text-xs tracking-[0.06em] text-white/40 uppercase">
            {FIXTURE.ourTeam} v {FIXTURE.opponentTeam}
          </p>
          <p className="mt-1.5 font-display text-xl text-white">{detail.line}</p>
          <p className="mt-2 text-sm text-white/60">{detail.detail}</p>
        </div>

        <div className="mt-5 flex items-center gap-2" aria-hidden="true">
          {JOURNEY_STAGES.map((s, i) => (
            <span
              key={s.id}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i <= active ? "bg-pitch-600" : "bg-white/10"
              )}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
