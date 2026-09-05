import { CheckCircle2, Clock, AlertTriangle, ShieldCheck } from "lucide-react"

export interface HandoverReviewTeam {
  displayName: string
  fromAgeGroup: string
  toAgeGroup: string | null
  needsDecision: boolean
}

export interface HandoverGroupFlag {
  displayTag: string
  reason: string
}

export interface AutomaticHandoverStatusProps {
  fromSeasonName: string | null
  toSeasonName: string
  toSeasonRef: string
  /** null when no season_transitions row exists yet (still outside the 24h lookahead window). */
  status: "not_due" | "prepared" | "ready" | "applying" | "needs_attention" | "completed"
  boundaryDate: string | null
  needsAttentionReason: string | null
  progressingTeams: HandoverReviewTeam[]
  decisionTeams: HandoverReviewTeam[]
  groupFlags: HandoverGroupFlag[]
  graduatingPendingCount: number
}

const STATUS_COPY: Record<AutomaticHandoverStatusProps["status"], { label: string; tone: "muted" | "amber" | "green" | "red" }> = {
  not_due: { label: "Not yet due", tone: "muted" },
  prepared: { label: "Preparing", tone: "amber" },
  ready: { label: "Scheduled", tone: "amber" },
  applying: { label: "Applying now", tone: "amber" },
  needs_attention: { label: "Needs your attention", tone: "red" },
  completed: { label: "Complete", tone: "green" },
}

const TONE_CLASSES: Record<string, string> = {
  muted: "border-ink/15 bg-ink/5 text-ink/70",
  amber: "border-amber-300/70 bg-amber-50 text-amber-900",
  green: "border-pitch-600/25 bg-mint-100/40 text-forest-950",
  red: "border-red-300/70 bg-red-50 text-red-900",
}

/**
 * RESUME SEASON HANDOVER Sections 18-20: surfaces the automatic
 * transition engine's REAL state (internal.process_due_season_
 * transitions(), on a pg_cron schedule) so a Club Admin never has to
 * infer it from side effects. Ordinary mechanical progressions never
 * require pressing anything here -- this is a status view, not another
 * "Apply rollover" button. needs_attention always states the exact
 * reason the engine itself recorded, never a generic failure message.
 */
export function AutomaticHandoverStatus({
  fromSeasonName,
  toSeasonName,
  toSeasonRef,
  status,
  boundaryDate,
  needsAttentionReason,
  progressingTeams,
  decisionTeams,
  groupFlags,
  graduatingPendingCount,
}: AutomaticHandoverStatusProps) {
  const copy = STATUS_COPY[status]
  const boundaryLabel = boundaryDate
    ? new Date(boundaryDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : null

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-6">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-forest-800" />
        <h2 className="font-display text-lg text-ink">Automatic season handover</h2>
      </div>
      <p className="mt-1.5 text-sm text-ink/55">
        {fromSeasonName ? `${fromSeasonName} → ` : ""}
        {toSeasonName}
      </p>

      <div className={`mt-4 flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm ${TONE_CLASSES[copy.tone]}`}>
        {status === "completed" && <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
        {status === "needs_attention" && <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
        {(status === "not_due" || status === "prepared" || status === "ready" || status === "applying") && <Clock className="mt-0.5 size-4 shrink-0" />}
        <div>
          <p className="font-medium">{copy.label}</p>
          {status === "not_due" && boundaryLabel && (
            <p className="mt-0.5 text-ink/70">
              Eligible age-grade teams will progress automatically into {toSeasonRef} on {boundaryLabel}. You&apos;ll get a reminder the day before.
            </p>
          )}
          {status === "ready" && boundaryLabel && (
            <p className="mt-0.5">Teams will progress automatically into {toSeasonRef} on {boundaryLabel}. Nothing further is needed unless listed below.</p>
          )}
          {status === "needs_attention" && needsAttentionReason && <p className="mt-0.5">{needsAttentionReason}</p>}
          {status === "completed" && <p className="mt-0.5">All eligible teams have automatically progressed into {toSeasonRef}.</p>}
        </div>
      </div>

      {(progressingTeams.length > 0 || decisionTeams.length > 0 || groupFlags.length > 0 || graduatingPendingCount > 0) && (
        <div className="mt-4 space-y-3 border-t border-ink/10 pt-4">
          {progressingTeams.length > 0 && (
            <details className="group" open={false}>
              <summary className="cursor-pointer text-sm font-medium text-ink/70">
                {progressingTeams.length} team{progressingTeams.length === 1 ? "" : "s"} progressing automatically
              </summary>
              <ul className="mt-2 space-y-1 pl-1 text-sm text-ink/60">
                {progressingTeams.map((t, i) => (
                  <li key={i}>
                    {t.displayName}: {t.fromAgeGroup} → {t.toAgeGroup ?? "?"}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {decisionTeams.length > 0 && (
            <div>
              <p className="text-sm font-medium text-amber-900">
                {decisionTeams.length} team{decisionTeams.length === 1 ? "" : "s"} require your decision below
              </p>
              <ul className="mt-1 pl-1 text-sm text-ink/60">
                {decisionTeams.map((t, i) => (
                  <li key={i}>{t.displayName}</li>
                ))}
              </ul>
            </div>
          )}
          {groupFlags.length > 0 && (
            <div>
              <p className="text-sm font-medium text-amber-900">
                {groupFlags.length} Mini-Rugby Group{groupFlags.length === 1 ? "" : "s"} require review
              </p>
              <ul className="mt-1 pl-1 text-sm text-ink/60">
                {groupFlags.map((f, i) => (
                  <li key={i}>
                    {f.displayTag}: {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {graduatingPendingCount > 0 && (
            <p className="text-sm text-ink/60">
              {graduatingPendingCount} graduating player{graduatingPendingCount === 1 ? "" : "s"} waiting to be placed. Staff stay attached to their current
              team automatically -- they are never copied onto an adult team.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
