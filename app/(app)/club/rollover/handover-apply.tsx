"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

import { applySeasonHandover } from "./actions"
import type { HandoverConsequence } from "./handover-overview"

/**
 * The Apply surface.
 *
 * Everything above the button is the exact consequence summary -- the same
 * server-computed lines the Overview shows -- because "these reviewed
 * decisions will now update the club" is only a fair thing to say if the
 * reviewer can see what those decisions are.
 *
 * The button is never a bare disabled control with no explanation. When the
 * handover cannot run, the reason is stated and linked to; the control carries
 * aria-disabled and stays focusable, so a keyboard or screen-reader user
 * reaches the explanation instead of finding a dead end.
 */

export interface AuditEntry {
  at: string
  event: string
  actorName: string
}

const EVENT_WORDS: Record<string, string> = {
  HANDOVER_TEAM_DECISION_RECORDED: "Team decision recorded",
  HANDOVER_TEAM_DECISION_WITHDRAWN: "Team decision withdrawn",
  HANDOVER_MIXED_SPLIT_DECIDED: "Mixed age-grade split decided",
  HANDOVER_TEAM_PLANNED: "Team added to next season's plan",
  HANDOVER_PLACEMENT_DECIDED: "Player placement chosen",
  HANDOVER_PLACEMENT_DECIDED_PLANNED: "Player placed into a planned team",
  HANDOVER_PLACEMENT_WITHDRAWN: "Player placement withdrawn",
  HANDOVER_PLACEMENT_APPLIED: "Player moved",
  HANDOVER_TEAM_PROGRESSED: "Team progressed",
  HANDOVER_TEAM_CREATED: "Team created",
  HANDOVER_TEAM_REACTIVATED: "Team reactivated",
  SEASON_HANDOVER_APPLIED: "Season Handover applied",
  // Recorded by the pre-staged model, which created the team during review.
  SUCCESSOR_TEAM_CREATED_AT_HANDOVER: "Team created (before the staged model)",
  U6_INTAKE_TEAM_CREATED: "U6 intake team created",
  U6_INTAKE_TEAM_REACTIVATED: "U6 intake team reactivated",
  GRADUATED_AT_HANDOVER: "Cohort graduated",
  mixed_boundary_boys_continuation: "Mixed cohort continued as Boys",
  mixed_boundary_girls_team_created: "Girls team created",
  folded: "Team folded",
}

export function HandoverApply({
  rolloverId,
  toSeasonName,
  decisionsRevision,
  isApplied,
  appliedAt,
  blockerCount,
  consequences,
  audit,
  canApply,
}: {
  rolloverId: string | null
  toSeasonName: string | null
  decisionsRevision: number
  isApplied: boolean
  appliedAt: string | null
  blockerCount: number
  consequences: HandoverConsequence[]
  audit: AuditEntry[]
  /** Applying restructures the club, so it is held to Club Admin even where reviewing is not. */
  canApply: boolean
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const progressing = consequences.filter((c) => c.kind === "progress").length
  const folding = consequences.filter((c) => c.kind === "fold").length
  const graduating = consequences.filter((c) => c.kind === "graduate").length
  // After Apply the same rows come back as "created"/"reactivated" rather than
  // "plan", so counting only planned ones would report a completed handover as
  // having created nothing.
  const creating = consequences.filter((c) => c.kind === "plan" || c.kind === "created" || c.kind === "reactivated").length

  async function handleApply() {
    if (!rolloverId) return
    setWorking(true)
    setError(null)
    const result = await applySeasonHandover(rolloverId, decisionsRevision)
    setWorking(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setConfirming(false)
    setOutcome(
      result.alreadyApplied
        ? "This handover had already been applied, so nothing was changed again."
        : `${result.teamsProgressed} team${result.teamsProgressed === 1 ? "" : "s"} progressed, ${result.teamsCreated + result.teamsReactivated} created or reactivated, ${result.playersMoved} player${result.playersMoved === 1 ? "" : "s"} moved.`
    )
    router.refresh()
  }

  if (!rolloverId) {
    return (
      <div className="rounded-lg border border-ink/10 bg-white p-6">
        <p className="text-sm font-medium text-ink">No handover to apply</p>
        <p className="mt-1 max-w-lg text-sm text-ink-muted">
          Prepare one from{" "}
          <Link href="/club/rollover?section=teams" className="text-forest-800 underline underline-offset-2">
            Teams
          </Link>{" "}
          first.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-ink/10 bg-white">
        <div className="border-b border-ink/8 px-5 py-4">
          <div className="flex items-start gap-2.5">
            {isApplied ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-forest-700" />
            ) : blockerCount > 0 ? (
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-700" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-forest-700" />
            )}
            <div>
              <p className="text-sm font-medium text-ink">
                {isApplied
                  ? `Applied${appliedAt ? ` on ${new Date(appliedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}` : ""}`
                  : blockerCount > 0
                    ? "Not ready to apply"
                    : "Ready to apply"}
              </p>
              <p className="mt-1 max-w-xl text-sm text-ink/60">
                {isApplied
                  ? `Your club now runs the ${toSeasonName ?? "new"} season structure. Correcting anything from here is an ordinary team or player change, not a handover decision.`
                  : blockerCount > 0
                    ? `${blockerCount} item${blockerCount === 1 ? " still needs" : "s still need"} a decision. Nothing about your club has changed, and nothing will until every one of them is settled.`
                    : "Every decision is recorded and still valid. Applying carries all of them out at once."}
              </p>
            </div>
          </div>
        </div>

        <ul className="divide-y divide-ink/8 text-sm">
          <li className="flex items-baseline justify-between gap-4 px-5 py-3">
            <span className="text-ink/70">{isApplied ? "Teams progressed" : "Teams progressing"}</span>
            <span className="font-medium text-ink tabular-nums">{progressing}</span>
          </li>
          <li className="flex items-baseline justify-between gap-4 px-5 py-3">
            <span className="text-ink/70">Teams created or reactivated</span>
            <span className="font-medium text-ink tabular-nums">{creating}</span>
          </li>
          <li className="flex items-baseline justify-between gap-4 px-5 py-3">
            <span className="text-ink/70">{isApplied ? "Cohorts that completed the youth pathway" : "Cohorts completing the youth pathway"}</span>
            <span className="font-medium text-ink tabular-nums">{graduating}</span>
          </li>
          <li className="flex items-baseline justify-between gap-4 px-5 py-3">
            <span className="text-ink/70">{isApplied ? "Teams that did not continue" : "Teams not continuing"}</span>
            <span className="font-medium text-ink tabular-nums">{folding}</span>
          </li>
        </ul>

        {!isApplied && (
          <div className="border-t border-ink/8 px-5 py-4">
            {canApply ? (
              <Button
                ref={triggerRef}
                type="button"
                className="h-10"
                aria-disabled={blockerCount > 0 || working}
                aria-describedby={blockerCount > 0 ? "apply-blocked-reason" : undefined}
                onClick={() => {
                  if (blockerCount > 0 || working) return
                  setConfirming(true)
                }}
              >
                Apply handover to {toSeasonName ?? "next season"}
              </Button>
            ) : (
              <p className="text-sm text-ink/60">
                Reviewing a handover and running it are different authorities. Only a Club Admin can apply it.
              </p>
            )}
            {blockerCount > 0 && (
              <p id="apply-blocked-reason" className="mt-2 text-sm text-ink/60">
                {blockerCount} outstanding {blockerCount === 1 ? "item" : "items"} —{" "}
                <Link href="/club/rollover?section=attention" className="text-forest-800 underline underline-offset-2">
                  see what needs a decision
                </Link>
                .
              </p>
            )}
            {error && (
              <p role="alert" className="mt-2 text-sm text-destructive-text">
                {error}
              </p>
            )}
          </div>
        )}

        {outcome && (
          <div role="status" aria-atomic="true" className="border-t border-ink/8 bg-mint-100/60 px-5 py-3.5 text-sm text-forest-950">
            {outcome}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-ink/10 bg-white">
        <div className="border-b border-ink/8 px-5 py-3.5">
          <p className="text-sm font-medium text-ink">Audit</p>
          <p className="mt-0.5 text-sm text-ink-muted">Every decision and every consequence, in the order they happened.</p>
        </div>
        {audit.length === 0 ? (
          <p className="px-5 py-3.5 text-sm text-ink-muted">Nothing recorded yet.</p>
        ) : (
          <ul className="divide-y divide-ink/8">
            {audit.map((a, i) => (
              <li key={`${a.at}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3">
                <span className="text-sm text-ink">{EVENT_WORDS[a.event] ?? a.event}</span>
                <span className="text-sm text-ink-muted">
                  {a.actorName} ·{" "}
                  {new Date(a.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          setConfirming(open)
          if (!open) triggerRef.current?.focus()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply handover to {toSeasonName ?? "next season"}?</DialogTitle>
            <DialogDescription>These reviewed decisions will now update the club for the new season.</DialogDescription>
          </DialogHeader>
          <ul className="space-y-1.5 text-sm text-ink/70">
            <li>{progressing} team{progressing === 1 ? "" : "s"} move up an age grade, keeping their history.</li>
            {creating > 0 && <li>{creating} team{creating === 1 ? "" : "s"} will be created.</li>}
            {graduating > 0 && (
              <li>
                {graduating} cohort{graduating === 1 ? "" : "s"} complete the youth pathway. Their players move to the club&apos;s
                holding list — no senior team is assigned automatically.
              </li>
            )}
            {folding > 0 && <li>{folding} team{folding === 1 ? "" : "s"} will not continue. Their fixtures and results stay available.</li>}
            <li>Players move to the teams recorded against them.</li>
          </ul>
          <p className="text-sm text-ink-muted">This cannot be undone from the handover board.</p>
          {error && (
            <p role="alert" className="text-sm text-destructive-text">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-9" disabled={working} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button type="button" className="h-9" disabled={working} onClick={handleApply}>
              {working ? "Applying…" : `Apply handover to ${toSeasonName ?? "next season"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
