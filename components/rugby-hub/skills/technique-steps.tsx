import type { TechniqueStep } from "@/lib/app-context/skills-explorer-types"

/**
 * The step-progression visual (section 7/11/12). Deliberately NOT a
 * hide/reveal tab pattern -- every step's text is always present in the DOM
 * for every viewer (keyboard, screen reader, reduced motion, no-JS all see
 * the same content), so no information ever depends on an interaction. The
 * "micro-interaction" is a restrained hover/focus highlight on each step
 * marker (color only, respecting prefers-reduced-motion via the transition
 * being instant when it's set), not a mechanism that hides content.
 * Original geometry (numbered markers + a connecting line) -- no body/ball
 * diagram, since this slice's content doesn't support anatomical precision.
 * Label vocabulary (Setup/Execution/Finish, See/Decide/Act, ...) is
 * whatever the data says -- never hardcoded here.
 */
export function TechniqueSteps({ steps }: { steps: TechniqueStep[] }) {
  return (
    <ol className="relative flex flex-col gap-6">
      {steps.map((step, i) => (
        <li key={step.label} className="group relative flex gap-4">
          <div className="flex flex-col items-center">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-pitch-600 bg-mint-100 font-display text-base text-forest-900 transition-colors motion-reduce:transition-none group-hover:bg-pitch-400 group-focus-within:bg-pitch-400">
              {i + 1}
            </span>
            {i < steps.length - 1 && <span className="mt-1 w-px flex-1 bg-ink/15" aria-hidden="true" />}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <p className="text-xs font-semibold tracking-[0.06em] text-forest-800 uppercase">{step.label}</p>
            <p className="mt-1 text-[15px] leading-relaxed text-ink/85">{step.text}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}
