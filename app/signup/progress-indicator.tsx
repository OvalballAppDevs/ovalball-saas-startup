import { Check } from "lucide-react"

import { cn } from "@/lib/utils"
import type { SignupStep } from "@/lib/signup/types"

const STEP_LABELS: Record<SignupStep, string> = {
  account: "Account",
  details: "Your details",
  club: "Your club",
  review: "Review",
}

const STEP_ORDER: SignupStep[] = ["account", "details", "club", "review"]

/**
 * Numbered-circle stepper with a filling connector line. Completed steps
 * show a checkmark, the active step is filled and scaled up slightly,
 * upcoming steps are outlined only. The same component serves mobile and
 * desktop -- labels hide below sm and a "Step N of 4" line takes over so
 * mobile never squeezes four text labels across the screen.
 */
export function ProgressIndicator({ current }: { current: SignupStep }) {
  const currentIndex = STEP_ORDER.indexOf(current)

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex items-center">
        {STEP_ORDER.map((step, index) => {
          const isDone = index < currentIndex
          const isCurrent = index === currentIndex
          const isLast = index === STEP_ORDER.length - 1

          return (
            <li key={step} className={cn("flex items-center", !isLast && "flex-1")}>
              <div className="flex flex-col items-center gap-2">
                <div
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-medium transition-all duration-300",
                    isDone && "border-pitch-600 bg-pitch-600 text-white",
                    isCurrent &&
                      "scale-110 border-forest-900 bg-forest-900 text-white shadow-[0_0_0_4px_rgba(50,166,101,0.18)]",
                    !isDone && !isCurrent && "border-ink/15 bg-white text-ink/40"
                  )}
                >
                  {isDone ? <Check className="size-4" strokeWidth={3} /> : index + 1}
                </div>
                <span
                  className={cn(
                    "hidden text-xs font-medium tracking-[0.03em] whitespace-nowrap sm:block",
                    isCurrent ? "text-ink" : isDone ? "text-ink/55" : "text-ink/35"
                  )}
                >
                  {STEP_LABELS[step]}
                </span>
              </div>

              {!isLast && (
                <div className="mx-2 h-0.5 flex-1 overflow-hidden rounded-full bg-ink/10 sm:-mt-6">
                  <div
                    className={cn(
                      "h-full bg-pitch-600 transition-all duration-500 ease-out",
                      isDone ? "w-full" : "w-0"
                    )}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ol>

      <p className="text-xs font-medium tracking-[0.04em] text-ink/45 uppercase sm:hidden">
        Step {currentIndex + 1} of {STEP_ORDER.length} · {STEP_LABELS[current]}
      </p>
    </div>
  )
}
