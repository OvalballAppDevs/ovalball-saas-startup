"use client"

import { useState } from "react"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"
import { DEMO_FAMILY, DEMO_PARENT, MEMBERSHIP_JOURNEY } from "@/lib/marketing/game-day-demo"

/**
 * The member setup journey, walked one stage at a time.
 *
 * Deliberately describes STAGES, never timings. Direct Debit settlement is
 * asynchronous and a mandate is confirmed by the provider, not by this
 * form, so the copy says "set up in a few simple steps" and the membership
 * only reads as active after provider confirmation -- matching the real
 * lifecycle rather than implying an instant payment.
 *
 * Inert: advancing is local state. No provider call, no server action, no
 * bank details anywhere in this component.
 */
const CHILD = DEMO_FAMILY[0]

export function MembershipJourneyDemo() {
  const [stage, setStage] = useState(0)
  const last = MEMBERSHIP_JOURNEY.length - 1
  const current = MEMBERSHIP_JOURNEY[stage]

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.035] p-6 md:p-8">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium tracking-[0.06em] text-white/60 uppercase">
          Setting up a membership
        </h3>
        <span className="shrink-0 rounded-full border border-white/12 px-2.5 py-1 text-[11px] tracking-[0.06em] text-white/60 uppercase">
          Product preview
        </span>
      </div>

      {/* Ordered because the stages genuinely are a sequence. */}
      <ol className="mt-6 flex flex-col gap-2.5">
        {MEMBERSHIP_JOURNEY.map((step, i) => {
          const done = i < stage
          const active = i === stage
          return (
            <li
              key={step.id}
              className={cn(
                "flex items-start gap-3 rounded-lg border px-4 py-3 transition-colors",
                active
                  ? "border-pitch-600/50 bg-pitch-600/[0.09]"
                  : "border-white/10 bg-white/[0.02]"
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                  done
                    ? "bg-pitch-600 text-ink"
                    : active
                      ? "bg-pitch-600/30 text-pitch-400"
                      : "bg-white/10 text-white/60"
                )}
              >
                {done ? <Check className="size-3" strokeWidth={3} aria-hidden="true" /> : i + 1}
              </span>
              <div className="min-w-0">
                <p className={cn("text-sm font-medium", active || done ? "text-white" : "text-white/60")}>
                  {step.label}
                </p>
                {active && <p className="mt-1 text-sm text-white/65">{step.body}</p>}
              </div>
            </li>
          )
        })}
      </ol>

      <div className="mt-6 rounded-lg border border-white/10 bg-forest-950/60 px-5 py-4">
        <p className="text-[11px] tracking-[0.06em] text-white/60 uppercase">Player</p>
        <p className="mt-1 text-sm text-white">
          {CHILD.player} &middot; {CHILD.ageGroup}
        </p>
        <p className="mt-3 text-[11px] tracking-[0.06em] text-white/60 uppercase">Membership</p>
        <p className="mt-1 text-sm text-white">
          {CHILD.membership} &middot; {CHILD.monthly} / month
        </p>
        <p className="mt-3 text-[11px] tracking-[0.06em] text-white/60 uppercase">Status</p>
        <p
          className={cn(
            "mt-1 text-sm font-medium",
            stage === last ? "text-pitch-400" : "text-amber-300"
          )}
        >
          {stage === last ? "Active" : stage >= 2 ? "Awaiting provider confirmation" : "Not yet set up"}
        </p>
      </div>

      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={() => setStage((s) => Math.min(s + 1, last))}
          disabled={stage === last}
          className="flex min-h-11 flex-1 items-center justify-center rounded-lg bg-pitch-600 px-4 text-sm font-medium text-ink transition-colors hover:bg-pitch-400 disabled:cursor-default disabled:bg-pitch-600/25 disabled:text-white/70 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
        >
          {stage === last ? "Membership active" : "Next step"}
        </button>
        {stage > 0 && (
          <button
            type="button"
            onClick={() => setStage(0)}
            className="min-h-11 rounded-lg border border-white/20 px-4 text-sm font-medium text-white/80 transition-colors hover:border-white/40 hover:text-white focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
          >
            Restart
          </button>
        )}
      </div>

      <p role="status" aria-atomic="true" className="mt-3 min-h-5 text-xs text-white/60">
        Step {stage + 1} of {MEMBERSHIP_JOURNEY.length}: {current.label}. {DEMO_PARENT} is the payer
        in this example.
      </p>
    </div>
  )
}
