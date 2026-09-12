import type { AgeStage } from "@/lib/app-context/position-explorer-types"

/**
 * Section 12's age-aware behaviour. NOT_APPLICABLE and EMERGING are real,
 * sourced states from hub_position_age_stage.stage_note -- never hardcoded
 * age-assumption prose. UNASSESSED and NORMAL render nothing: an
 * unresearched identity gets ordinary full exploration, not a fabricated
 * claim either way.
 */
export function AgeStageBanner({ stage, note }: { stage: AgeStage; note: string | null }) {
  if (stage === "NORMAL" || stage === "UNASSESSED" || !note) return null

  const isNotApplicable = stage === "NOT_APPLICABLE"

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${isNotApplicable ? "border-mint-300 bg-mint-100 text-forest-900" : "border-pitch-400/50 bg-mint-100/60 text-forest-900"}`}>
      <p className="font-semibold">{isNotApplicable ? "At your stage, everyone plays every role" : "Positions are still emerging at your stage"}</p>
      <p className="mt-1 text-forest-900/80">{note}</p>
    </div>
  )
}
