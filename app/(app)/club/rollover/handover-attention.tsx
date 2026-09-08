import Link from "next/link"
import { CheckCircle2 } from "lucide-react"

import { AskGuardianButton } from "./ask-guardian-button"

/**
 * Everything standing between this handover and Apply, in one queue.
 *
 * The rows come from handover_apply_blockers -- the same function Apply itself
 * runs before it touches anything -- so this list cannot say the handover is
 * clear while Apply refuses it, or the reverse. Each row deep-links to the
 * section that owns the decision; the item also stays visible in its own
 * section, because a queue that is the ONLY place something appears hides it
 * from anyone who did not think to look here.
 */

export interface HandoverBlocker {
  kind: "season" | "team" | "collision" | "player" | "dispensation" | "stale"
  subject: string
  detail: string
  /** The stable id of whoever or whatever needs the decision. Never a display string. */
  subjectId: string | null
  /** True when the item is waiting on protected player information only a guardian can supply. */
  needsPlayerInformation: boolean
}

const DESTINATION: Record<HandoverBlocker["kind"], { href: string; label: string }> = {
  season: { href: "/admin/seasons", label: "Open Seasons" },
  team: { href: "/club/rollover?section=teams", label: "Decide in Teams" },
  collision: { href: "/club/rollover?section=teams", label: "Resolve in Teams" },
  player: { href: "/club/rollover?section=players", label: "Review in Players" },
  dispensation: { href: "/club/rollover?section=players", label: "Review in Players" },
  stale: { href: "/club/rollover?section=players", label: "Review in Players" },
}

export function HandoverNeedsAttention({ blockers, planned }: { blockers: HandoverBlocker[]; planned: { label: string; note: string }[] }) {
  return (
    <div className="space-y-6">
      {blockers.length === 0 ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-ink/10 bg-white p-6">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-forest-700" />
          <div>
            <p className="text-sm font-medium text-ink">Nothing outstanding</p>
            <p className="mt-1 max-w-lg text-sm text-ink/55">
              Every team has a decision and every player has somewhere to go. The handover can be applied from{" "}
              <Link href="/club/rollover?section=apply" className="text-forest-800 underline underline-offset-2">
                Apply &amp; audit
              </Link>
              .
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-ink/10 bg-white">
          <div className="border-b border-ink/8 px-5 py-3.5">
            <p className="text-sm font-medium text-ink">
              {blockers.length} {blockers.length === 1 ? "item needs" : "items need"} a decision
            </p>
            <p className="mt-0.5 max-w-xl text-sm text-ink/55">
              Nothing about your club has changed. The handover holds here until each of these is settled, rather than moving
              some cohorts and leaving others.
            </p>
          </div>
          <ul className="divide-y divide-ink/8">
            {blockers.map((b, i) => (
              <li key={`${b.kind}-${b.subject}-${i}`} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{b.subject}</p>
                  <p className="mt-0.5 text-sm text-ink/60">{b.detail}</p>
                </div>
                {b.needsPlayerInformation && b.subjectId ? (
                  // The club cannot answer this one. Gender is protected
                  // identity information, and running a team is not the
                  // authority to record it -- so the action offered here is to
                  // ask the people who hold that relationship.
                  <AskGuardianButton playerId={b.subjectId} playerName={b.subject} />
                ) : (
                  <Link
                    href={DESTINATION[b.kind].href}
                    className="shrink-0 rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink outline-none hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-pitch-400"
                  >
                    {DESTINATION[b.kind].label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {planned.length > 0 && (
        <div className="rounded-lg border border-ink/10 bg-white">
          <div className="border-b border-ink/8 px-5 py-3.5">
            <p className="text-sm font-medium text-ink">Resolved by a decision to add a team</p>
            <p className="mt-0.5 max-w-xl text-sm text-ink/55">
              These were gaps. The club has decided to run the missing side, so they no longer hold the handover -- the team is
              created when it is applied.
            </p>
          </div>
          <ul className="divide-y divide-ink/8">
            {planned.map((p) => (
              <li key={p.label} className="flex items-start gap-2.5 px-5 py-3.5">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-forest-700" />
                <div>
                  <p className="text-sm font-medium text-ink">{p.label}</p>
                  <p className="mt-0.5 text-sm text-ink/55">{p.note}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
