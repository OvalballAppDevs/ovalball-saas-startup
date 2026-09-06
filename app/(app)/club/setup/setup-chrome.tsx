"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { AlertCircle, ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { advanceSetup, completeSetup } from "./actions"

export interface StepMeta {
  n: 1 | 2 | 3
  label: string
  done: boolean
}

/**
 * The progress rail.
 *
 * Each step's tick comes from the server's re-derived requirements, not
 * from how far the person has clicked -- so a step that stops being
 * satisfied loses its tick, and the rail never claims a club is further
 * along than its data says.
 *
 * Completed steps are navigable. Steps ahead are not: they would show an
 * empty form for work that has to happen in order, and a wizard that lets
 * you skip to the end is a wizard that has to explain why the end does not
 * work.
 */
export function SetupProgress({ steps, current }: { steps: StepMeta[]; current: number }) {
  const router = useRouter()

  return (
    <ol className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-3 sm:gap-x-3">
      {steps.map((s, i) => {
        const isCurrent = s.n === current
        const reachable = s.done || s.n <= current
        return (
          <li key={s.n} className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              disabled={!reachable || isCurrent}
              onClick={() => router.push(`/club/setup?step=${s.n}`)}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm outline-none transition-colors",
                "focus-visible:ring-2 focus-visible:ring-pitch-400",
                isCurrent && "bg-forest-950 pr-3.5 font-medium text-white",
                !isCurrent && reachable && "text-ink/70 hover:bg-ink/5",
                !reachable && "cursor-default text-ink/35"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold",
                  s.done && !isCurrent && "bg-mint-100 text-forest-950",
                  s.done && isCurrent && "bg-white/20 text-white",
                  !s.done && isCurrent && "bg-white/20 text-white",
                  !s.done && !isCurrent && "border border-ink/20 text-ink/45"
                )}
              >
                {s.done ? <Check className="size-3.5" strokeWidth={3} /> : s.n}
              </span>
              <span className="whitespace-nowrap">{s.label}</span>
              <span className="sr-only">
                {s.done ? " — done" : isCurrent ? " — current step" : " — not started"}
              </span>
            </button>
            {i < steps.length - 1 && (
              <span aria-hidden="true" className="hidden h-px w-6 bg-ink/15 sm:block" />
            )}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * What a step still needs before it can be left.
 *
 * Written as the outstanding work, not as a scold: a person mid-setup
 * already knows they have not finished, and what they want from this box is
 * the list.
 */
export function StepChecklist({ items }: { items: { label: string; done: boolean }[] }) {
  const outstanding = items.filter((i) => !i.done)
  if (outstanding.length === 0) return null

  return (
    <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3">
      <p className="text-sm font-medium text-ink">Still to do on this step</p>
      <ul className="mt-2 space-y-1">
        {outstanding.map((i) => (
          <li key={i.label} className="flex items-start gap-2 text-sm text-ink/70">
            <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" />
            {i.label}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Back / Continue, and on the last step, Finish.
 *
 * Continue only records the resume position -- it is a bookmark, and the
 * database treats it as one. Finish is the only call that decides anything,
 * and it re-checks every requirement server-side before it will activate
 * the club, so a stale page cannot talk it into completing early.
 */
export function StepNav({
  step,
  canContinue,
  blockedReason,
}: {
  step: 1 | 2 | 3
  canContinue: boolean
  blockedReason?: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function go(to: 1 | 2 | 3) {
    setError(null)
    startTransition(async () => {
      const result = await advanceSetup(to)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push(`/club/setup?step=${to}`)
    })
  }

  function finish() {
    setError(null)
    startTransition(async () => {
      const result = await completeSetup()
      if (!result.ok) {
        setError(result.error)
        return
      }
      // A full navigation, not a push: the club has just changed lifecycle
      // state and the shell's gate needs to re-read it.
      window.location.assign("/dashboard?welcome=club-ready")
    })
  }

  return (
    <div className="mt-8 border-t border-ink/10 pt-6">
      {error && (
        <p role="alert" className="mb-4 flex items-start gap-2 text-sm text-red-700">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {step > 1 && (
          <Button type="button" variant="ghost" disabled={pending} onClick={() => go((step - 1) as 1 | 2)}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back
          </Button>
        )}

        <div className="ml-auto flex items-center gap-3">
          {!canContinue && blockedReason && (
            <p className="text-xs text-ink/50">{blockedReason}</p>
          )}
          {step < 3 ? (
            <Button type="button" disabled={!canContinue || pending} onClick={() => go((step + 1) as 2 | 3)}>
              {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
              Continue
              {!pending && <ArrowRight aria-hidden="true" className="size-4" />}
            </Button>
          ) : (
            <Button type="button" disabled={!canContinue || pending} onClick={finish}>
              {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
              Finish setup
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
