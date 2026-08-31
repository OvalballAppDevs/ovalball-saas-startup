"use client"

import { ArrowRight, Check, Clock, MapPin } from "lucide-react"
import { useState } from "react"

import { cn } from "@/lib/utils"
import { DEMO_TEAMS, WORKFLOW_STAGES, type FixtureWorkflowStatus } from "@/lib/marketing/fixture-demo-data"
import { Reveal } from "@/lib/motion/reveal"
import { useReducedMotion } from "@/lib/motion/use-reduced-motion"

const STAGE_INDEX: Record<FixtureWorkflowStatus, number> = {
  planned: 0,
  "request-sent": 1,
  "awaiting-club": 2,
  confirmed: 3,
}

/**
 * Feature Story 1 -- Organise Fixtures. Switching teams swaps the fixture
 * list (client-side mock data, see lib/marketing/fixture-demo-data.ts);
 * one fixture per team can be walked through the real Ovalball fixture
 * workflow live. Entirely demonstration data, never touches Supabase.
 */
export function OrganiseFixturesSection() {
  const reducedMotion = useReducedMotion()
  const [teamId, setTeamId] = useState(DEMO_TEAMS[0].id)
  const [overrides, setOverrides] = useState<Record<string, FixtureWorkflowStatus>>({})

  const team = DEMO_TEAMS.find((t) => t.id === teamId) ?? DEMO_TEAMS[0]
  const heroFixture = team.fixtures.find((f) => (overrides[f.id] ?? f.status) !== "confirmed") ?? team.fixtures[0]
  const heroStatus = overrides[heroFixture.id] ?? heroFixture.status
  const stageIndex = STAGE_INDEX[heroStatus]

  function advance() {
    const nextStatus = WORKFLOW_STAGES[Math.min(stageIndex + 1, WORKFLOW_STAGES.length - 1)].status
    setOverrides((prev) => ({ ...prev, [heroFixture.id]: nextStatus }))
  }

  return (
    <section className="bg-forest-950 py-20 md:py-28">
      <div className="mx-auto max-w-[1200px] px-4 md:px-8">
        <Reveal>
          <p className="text-sm font-medium tracking-[0.08em] text-pitch-400 uppercase">
            Organise fixtures
          </p>
          <h2 className="mt-3 max-w-2xl font-display text-display-xl text-white">
            Fixtures. Without the admin.
          </h2>
          <p className="mt-4 max-w-xl text-base text-white/60 md:text-lg">
            One fixture record. One status. Both clubs know where they
            stand &mdash; no more chasing replies across email and WhatsApp.
          </p>
        </Reveal>

        <Reveal index={1}>
          <div role="tablist" aria-label="Select a team" className="mt-10 flex flex-wrap gap-2">
            {DEMO_TEAMS.map((t) => {
              const active = t.id === teamId
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTeamId(t.id)}
                  className={cn(
                    "min-h-11 rounded-full border px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pitch-400",
                    active
                      ? "border-pitch-600 bg-pitch-600 text-ink"
                      : "border-white/15 bg-white/5 text-white/70 hover:border-white/30 hover:text-white"
                  )}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
        </Reveal>

        <Reveal index={2}>
          <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1.1fr]">
            {/* Hero fixture: the workflow demo */}
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-6 md:p-8">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-medium text-white">{heroFixture.opponent}</p>
                  <p className="mt-1 flex items-center gap-3 text-sm text-white/50">
                    <span className="flex items-center gap-1">
                      <MapPin className="size-3.5" /> {heroFixture.venue}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="size-3.5" /> {heroFixture.date}, {heroFixture.kickoff}
                    </span>
                  </p>
                </div>
                {heroStatus === "confirmed" && (
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-pitch-600">
                    <Check className="size-5 text-white" strokeWidth={3} />
                  </span>
                )}
              </div>

              {/* One atomic status message, not a live region on every
                  badge -- screen readers hear "Request sent for fixture
                  against Camberley RFC" once per change, not a stream of
                  competing announcements from the track below. */}
              <p role="status" aria-atomic="true" className="sr-only">
                {WORKFLOW_STAGES[stageIndex].label} for fixture against {heroFixture.opponent}
              </p>

              {/* Workflow track */}
              <div className="mt-8 flex items-center">
                {WORKFLOW_STAGES.map((stage, i) => {
                  const isDone = i < stageIndex
                  const isCurrent = i === stageIndex
                  const isLast = i === WORKFLOW_STAGES.length - 1
                  return (
                    <div key={stage.status} className={cn("flex items-center", !isLast && "flex-1")}>
                      <div className="flex flex-col items-center gap-2">
                        <div
                          className={cn(
                            "flex size-3 shrink-0 items-center justify-center rounded-full transition-all",
                            !reducedMotion && "duration-500",
                            isDone || isCurrent ? "scale-100 bg-pitch-600" : "scale-75 bg-white/15"
                          )}
                        />
                        <span
                          className={cn(
                            "text-center text-xs font-medium whitespace-nowrap",
                            isCurrent ? "text-white" : isDone ? "text-white/60" : "text-white/45"
                          )}
                        >
                          {stage.label}
                        </span>
                      </div>
                      {!isLast && (
                        <div className="mx-1.5 -mt-5 h-px flex-1 overflow-hidden bg-white/10">
                          <div
                            className={cn(
                              "h-full bg-pitch-600 transition-all ease-out",
                              !reducedMotion && "duration-700",
                              isDone ? "w-full" : "w-0"
                            )}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Request-travelling visual, only mid-flight */}
              {(heroStatus === "request-sent" || heroStatus === "awaiting-club") && (
                <div className="mt-6 flex items-center justify-center gap-3 rounded-lg bg-white/[0.03] py-4 text-sm text-white/60">
                  <span className="font-medium text-white/80">Your club</span>
                  <span className="relative flex h-4 w-16 items-center">
                    <span className="absolute inset-0 h-px w-full bg-white/15" />
                    <ArrowRight
                      className={cn(
                        "absolute size-4 text-pitch-400",
                        !reducedMotion && "animate-[ovalball-request-travel_1.6s_ease-in-out_infinite]"
                      )}
                    />
                  </span>
                  <span className="font-medium text-white/80">{heroFixture.opponent}</span>
                </div>
              )}

              <button
                type="button"
                onClick={advance}
                disabled={heroStatus === "confirmed"}
                className="mt-6 w-full rounded-lg bg-pitch-600 px-4 py-3 text-sm font-medium text-ink transition-colors hover:bg-pitch-400 disabled:cursor-default disabled:bg-white/10 disabled:text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                {heroStatus === "planned" && "Send fixture request"}
                {heroStatus === "request-sent" && "Simulate club reply"}
                {heroStatus === "awaiting-club" && "Confirm fixture"}
                {heroStatus === "confirmed" && "Fixture confirmed"}
              </button>
            </div>

            {/* Rest of the team's fixture list */}
            <div className="flex flex-col gap-2.5">
              {team.fixtures.map((fixture) => {
                const status = overrides[fixture.id] ?? fixture.status
                const isConfirmed = status === "confirmed"
                return (
                  <div
                    key={fixture.id}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-lg border px-4 py-3.5 transition-colors",
                      fixture.id === heroFixture.id
                        ? "border-pitch-600/40 bg-pitch-600/[0.06]"
                        : "border-white/10 bg-white/[0.02]"
                    )}
                  >
                    <div>
                      <p className="text-sm font-medium text-white">{fixture.opponent}</p>
                      <p className="mt-0.5 text-xs text-white/60">
                        {fixture.date} &middot; {fixture.venue}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                        isConfirmed ? "bg-pitch-600/15 text-pitch-400" : "bg-white/8 text-white/50"
                      )}
                    >
                      {isConfirmed && <Check className="size-3" strokeWidth={3} />}
                      {WORKFLOW_STAGES.find((s) => s.status === status)?.label}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </Reveal>

        <Reveal index={3}>
          <p className="mt-6 text-sm text-white/50">
            Demonstration data &mdash; try switching teams or walking the fixture through its workflow above.
          </p>
        </Reveal>
      </div>
    </section>
  )
}
