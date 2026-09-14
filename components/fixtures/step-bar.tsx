"use client"

import Link from "next/link"
import { useEffect, useRef } from "react"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * THE LIVE STEP BAR.
 *
 * Import Fixtures and the Competition Creator are genuine sequences, so their
 * steps are numbered -- and each step carries its live state under its name
 * ("32 rows", "4 groups", "3 to resolve"), so the bar is also the summary.
 * The current step is marked for assistive technology with aria-current.
 * A step with an href can be revisited; one without is not reachable yet.
 */

export interface StepBarStep {
  key: string
  label: string
  /** A short live state under the label. */
  detail?: string
  href?: string
  onSelect?: () => void
  done?: boolean
}

export function StepBar({ steps, current, label }: { steps: StepBarStep[]; current: string; label: string }) {
  // On a phone the bar scrolls sideways: the current step is brought into view.
  const listRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const list = listRef.current
    const active = list?.querySelector<HTMLElement>('[aria-current="step"]')
    if (list && active && list.scrollWidth > list.clientWidth) list.scrollLeft = Math.max(0, active.offsetLeft - 16)
  }, [current])
  // A current key that names no step means the sequence is finished.
  const found = steps.findIndex((s) => s.key === current)
  const currentIndex = found < 0 ? steps.length : found
  return (
    <nav aria-label={label} className="rounded-lg bg-forest-800 text-white">
      <ol ref={listRef} className="relative flex overflow-x-auto">
        {steps.map((step, i) => {
          const isCurrent = i === currentIndex
          const done = step.done ?? i < currentIndex
          const body = (
            <>
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                  isCurrent ? "bg-chalk text-forest-800" : done ? "bg-pitch-600 text-white" : "border border-white/35 text-white/75",
                )}
                aria-hidden="true"
              >
                {done && !isCurrent ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className="min-w-0 text-left">
                <span className={cn("block truncate text-sm font-medium", !isCurrent && !done && "text-white/75")}>{step.label}</span>
                {step.detail && <span className={cn("block truncate text-xs tabular-nums", isCurrent ? "text-forest-800/75" : "text-white/65")}>{step.detail}</span>}
              </span>
              {done && !isCurrent && <span className="sr-only"> (done)</span>}
            </>
          )
          const itemClass = cn(
            "flex min-w-36 flex-1 items-center gap-2.5 px-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-inset",
            isCurrent && "bg-chalk text-forest-800",
            i === 0 && "rounded-l-lg",
            i === steps.length - 1 && "rounded-r-lg",
          )
          return (
            <li key={step.key} className="flex flex-1 border-r border-white/10 last:border-r-0" aria-current={isCurrent ? "step" : undefined}>
              {step.href && !isCurrent ? (
                <Link href={step.href} className={cn(itemClass, "hover:bg-white/10")}>
                  {body}
                </Link>
              ) : step.onSelect && !isCurrent ? (
                <button type="button" onClick={step.onSelect} className={cn(itemClass, "hover:bg-white/10")}>
                  {body}
                </button>
              ) : (
                <div className={itemClass}>{body}</div>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
