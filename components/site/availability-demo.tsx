"use client"

import { useState } from "react"
import { Check, HelpCircle, X } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  ATTENDANCE_OPTIONS,
  BASELINE_COUNTS,
  DEMO_FIXTURE,
  DEMO_SQUAD,
  type AttendanceStatus,
} from "@/lib/marketing/game-day-demo"

/**
 * One response, two views.
 *
 * The left panel is what a guardian or eligible player sees; the right is
 * what authorised team staff see. They are wired to the same piece of
 * state, so answering on the left moves the count on the right -- which is
 * the actual product principle (one response, one fixture, one canonical
 * record) demonstrated rather than described.
 *
 * Entirely client-side: no server action, no network call, no production
 * data. The statuses are the canonical ATTENDING / CANNOT_ATTEND / UNSURE
 * values, not a marketing vocabulary.
 */
const OPTION_ICON = {
  ATTENDING: Check,
  CANNOT_ATTEND: X,
  UNSURE: HelpCircle,
} as const

const PANEL_CLASS = "rounded-xl border border-white/10 bg-white/[0.035] p-6 md:p-7"
const PANEL_TITLE_CLASS = "text-sm font-medium tracking-[0.06em] text-white/60 uppercase"

export function AvailabilityDemo() {
  const [response, setResponse] = useState<AttendanceStatus | null>(null)

  // Charlie sits in "no response" until the visitor answers, so the totals
  // always add up to the squad size no matter what is selected.
  const counts = {
    ATTENDING: BASELINE_COUNTS.ATTENDING + (response === "ATTENDING" ? 1 : 0),
    CANNOT_ATTEND: BASELINE_COUNTS.CANNOT_ATTEND + (response === "CANNOT_ATTEND" ? 1 : 0),
    UNSURE: BASELINE_COUNTS.UNSURE + (response === "UNSURE" ? 1 : 0),
    NO_RESPONSE: BASELINE_COUNTS.NO_RESPONSE - (response ? 1 : 0),
  }

  const selectedLabel = ATTENDANCE_OPTIONS.find((o) => o.id === response)?.label

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* Parent / player view. Flex column so the confirmation line sits at
          the foot of the panel rather than leaving a block of dead space
          beneath it -- the team panel beside it is much taller, and the two
          share a grid row height. */}
      <div className={cn(PANEL_CLASS, "flex flex-col")}>
        <div className="flex items-center justify-between gap-3">
          <h3 className={PANEL_TITLE_CLASS}>Parent &amp; player view</h3>
          <DemoBadge />
        </div>

        <p className="mt-5 font-display text-2xl text-white">Are you available?</p>
        <p className="mt-1 text-sm text-white/60">
          {DEMO_FIXTURE.team} v {DEMO_FIXTURE.opponentTeam}
        </p>
        <p className="mt-0.5 text-sm text-white/60">
          {DEMO_FIXTURE.date} &middot; {DEMO_FIXTURE.kickoff}
        </p>

        <div
          role="radiogroup"
          aria-label={`Availability for ${DEMO_FIXTURE.team} versus ${DEMO_FIXTURE.opponentTeam}`}
          className="mt-6 flex flex-col gap-2.5"
        >
          {ATTENDANCE_OPTIONS.map((option) => {
            const Icon = OPTION_ICON[option.id]
            const active = response === option.id
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setResponse(option.id)}
                className={cn(
                  "flex min-h-12 items-center gap-3 rounded-lg border px-4 text-left text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none",
                  active
                    ? "border-pitch-600 bg-pitch-600 text-ink"
                    : "border-white/15 bg-white/[0.03] text-white/80 hover:border-white/35 hover:text-white"
                )}
              >
                {/* Icon as well as colour: the selected state never depends
                    on the green alone. */}
                <Icon className="size-4 shrink-0" strokeWidth={active ? 3 : 2} aria-hidden="true" />
                {option.label}
                {active && <span className="ml-auto text-xs font-normal text-ink/60">Your response</span>}
              </button>
            )
          })}
        </div>

        <p role="status" aria-atomic="true" className="mt-auto pt-4 min-h-5 text-sm text-white/60">
          {response
            ? `Saved as “${selectedLabel}”. Your team staff can see it straight away.`
            : "Choose a response — the team view updates with it."}
        </p>
      </div>

      {/* Team staff view */}
      <div className={cn(PANEL_CLASS, "flex flex-col")}>
        <div className="flex items-center justify-between gap-3">
          <h3 className={PANEL_TITLE_CLASS}>Team staff view</h3>
          <DemoBadge />
        </div>

        <p className="mt-5 font-display text-2xl text-white">Match availability</p>
        <p className="mt-1 text-sm text-white/60">{DEMO_FIXTURE.squadSize} players in the squad</p>

        <dl className="mt-6 grid grid-cols-2 gap-3">
          <CountTile label="Attending" value={counts.ATTENDING} tone="good" />
          <CountTile label="Can't attend" value={counts.CANNOT_ATTEND} tone="muted" />
          <CountTile label="Unsure" value={counts.UNSURE} tone="warn" />
          <CountTile label="No response" value={counts.NO_RESPONSE} tone="muted" />
        </dl>

        <ul className="mt-6 flex flex-1 flex-col gap-1.5">
          {DEMO_SQUAD.map((member) => (
            <li
              key={member.name}
              className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-3.5 py-2.5 text-sm"
            >
              <span className="text-white/80">{member.name}</span>
              <StatusText status={member.status} />
            </li>
          ))}
          {/* The demo family's own row, driven by the panel on the left. */}
          <li
            className={cn(
              "flex items-center justify-between gap-3 rounded-lg px-3.5 py-2.5 text-sm transition-colors",
              response ? "bg-pitch-600/[0.12]" : "bg-white/[0.03]"
            )}
          >
            <span className="text-white">Charlie M.</span>
            <StatusText status={response ?? "NO_RESPONSE"} />
          </li>
        </ul>

        <p className="mt-4 text-xs text-white/60">
          Visible to authorised team staff for this team, not to other families.
        </p>
      </div>
    </div>
  )
}

function CountTile({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: "good" | "warn" | "muted"
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3",
        tone === "good"
          ? "border-pitch-600/35 bg-pitch-600/[0.09]"
          : tone === "warn"
            ? "border-amber-500/30 bg-amber-500/[0.08]"
            : "border-white/10 bg-white/[0.02]"
      )}
    >
      <dt className="text-xs tracking-[0.04em] text-white/60 uppercase">{label}</dt>
      <dd
        className={cn(
          "mt-1 font-display text-3xl tabular-nums",
          tone === "good" ? "text-pitch-400" : tone === "warn" ? "text-amber-300" : "text-white"
        )}
      >
        {value}
      </dd>
    </div>
  )
}

function StatusText({ status }: { status: AttendanceStatus | "NO_RESPONSE" }) {
  const label =
    status === "NO_RESPONSE"
      ? "No response"
      : (ATTENDANCE_OPTIONS.find((o) => o.id === status)?.label ?? "No response")

  return (
    <span
      className={cn(
        "shrink-0 text-xs font-medium",
        status === "ATTENDING"
          ? "text-pitch-400"
          : status === "UNSURE"
            ? "text-amber-300"
            : status === "CANNOT_ATTEND"
              ? "text-white/60"
              : "text-white/60"
      )}
    >
      {label}
    </span>
  )
}

function DemoBadge() {
  return (
    <span className="shrink-0 rounded-full border border-white/12 px-2.5 py-1 text-[11px] tracking-[0.06em] text-white/60 uppercase">
      Product preview
    </span>
  )
}
