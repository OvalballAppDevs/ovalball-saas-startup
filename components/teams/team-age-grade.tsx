import { AlertTriangle, CheckCircle2, Clock } from "lucide-react"

import {
  AGE_GRADE_STATUS_LABEL,
  type AgeGradeStatus,
  type MyPlayerAgeGradeStatus,
  type TeamAgeGradeAttention,
} from "@/lib/teams/age-grade"
import { cn } from "@/lib/utils"

/**
 * CONVERGENCE STEP 12 -- age grade, on the team where the work happens.
 *
 * WHAT IS DELIBERATELY ABSENT: a date of birth, an age, a medical note, a safeguarding record, and
 * any row for a player who is fine. The server returns only what needs attention and only as a
 * status; there is nothing here to read as a file on a child.
 *
 * STATUS IS NEVER CARRIED BY COLOUR ALONE. Each state has an icon, its own words, and a sentence
 * saying what it means -- a greyscale screenshot and a screen reader get the same answer.
 */

const STATUS_STYLE: Record<AgeGradeStatus, { Icon: typeof AlertTriangle; className: string }> = {
  ELIGIBLE: { Icon: CheckCircle2, className: "text-ink-muted" },
  OUTSIDE_AGE_GRADE: { Icon: AlertTriangle, className: "text-warning" },
  DISPENSATION_APPROVED: { Icon: CheckCircle2, className: "text-ink-muted" },
  DISPENSATION_PENDING: { Icon: Clock, className: "text-ink-muted" },
  AGE_EVIDENCE_REQUIRED: { Icon: AlertTriangle, className: "text-warning" },
  AGE_GRADE_NOT_ESTABLISHED: { Icon: AlertTriangle, className: "text-warning" },
  SEASON_NOT_ESTABLISHED: { Icon: AlertTriangle, className: "text-warning" },
  UNKNOWN_TEAM: { Icon: AlertTriangle, className: "text-warning" },
}

function StatusLine({ status, children }: { status: AgeGradeStatus; children: React.ReactNode }) {
  const { Icon, className } = STATUS_STYLE[status]
  return (
    <span className="flex items-start gap-1.5">
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", className)} aria-hidden="true" />
      <span>{children}</span>
    </span>
  )
}

/** Staff. Renders nothing at all when there is nothing to attend to. */
export function TeamAgeGradeAttentionPanel({ rows }: { rows: TeamAgeGradeAttention[] }) {
  if (rows.length === 0) return null
  return (
    <section aria-labelledby="team-age-grade-heading" className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
      <h2 id="team-age-grade-heading" className="font-display text-base text-ink">
        Age Grade — Needs Attention
      </h2>
      <p className="mt-1 mb-3 text-sm text-ink-muted">
        {rows.length === 1 ? "One player on this team needs" : `${rows.length} players on this team need`} a look. Age
        grade comes from the recorded date of birth and the season, and is never inferred from the team.
      </p>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.playerId} className="text-sm text-ink">
            <StatusLine status={row.status}>
              <span className="font-medium">{row.displayName}</span>
              <span className="text-ink-muted"> — {AGE_GRADE_STATUS_LABEL[row.status]}</span>
              <span className="block text-ink-muted">{row.detail}</span>
            </StatusLine>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Family. The same status vocabulary for their own child, shown only for this team, so a parent sees
 * the club's position rather than being asked to interpret a roster.
 */
export function MyChildAgeGradeNote({ rows, teamId }: { rows: MyPlayerAgeGradeStatus[]; teamId: string }) {
  const mine = rows.filter((r) => r.teamId === teamId && r.status !== "ELIGIBLE")
  if (mine.length === 0) return null
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
      {mine.map((row) => (
        <p key={`${row.teamId}-${row.status}`} className="text-sm text-ink">
          <StatusLine status={row.status}>
            <span className="font-medium">{AGE_GRADE_STATUS_LABEL[row.status]}</span>
            <span className="block text-ink-muted">{row.detail}</span>
            {/* A parent is told the club's position, not asked to decide it: a dispensation is a
                club and governing-body decision, so the honest thing to show is status. */}
            <span className="block text-ink-muted">Your club handles this — there is nothing for you to do here.</span>
          </StatusLine>
        </p>
      ))}
    </div>
  )
}
