"use client"

import { useState } from "react"
import { CircleAlert, CircleCheck, Clock, ShieldCheck, UserRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  requestApprovalSentence,
  requestAskedLine,
  requestDispensationLine,
  requestFitLine,
  type TeamPlaceRequest,
  type TeamPlaceRequests,
} from "@ovalball/contracts/team/team-code"

/**
 * WAITING FOR APPROVAL -- the website's approver's card (team codes place players, 20270741000000; the
 * layout the product owner approved 2026-10-05). The phone draws the same card from the same reader
 * (`team_place_requests`) with the same words (`requestFitLine`, `requestAskedLine`,
 * `requestApprovalSentence`): who it is, whether they fit, how it was asked, and exactly what approving
 * does. Approve and Decline are the team page's existing operations, which re-decide everything. Declining
 * asks why, as the phone's sheet does: the reason is recorded, and whoever asked is told.
 *
 * A child's own request still waiting for a parent is counted in one quiet line and never named.
 */
export function PlaceRequestCards({
  data,
  pendingId,
  onApprove,
  onDecline,
}: {
  data: TeamPlaceRequests
  pendingId: string | null
  onApprove: (request: TeamPlaceRequest) => void
  onDecline: (request: TeamPlaceRequest, reason: string) => void
}) {
  const [declining, setDeclining] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const team = data.team
  if (!team) return null
  return (
    <div className="mt-4 flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {data.requests.map((r) => {
          const name = `${r.firstName} ${r.surname}`.trim()
          const fits = r.fit === "FITS"
          const busy = pendingId === r.membershipId
          return (
            <li key={r.membershipId} className="rounded-lg border border-ink/10 bg-white p-4 shadow-xs">
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-mint-100 text-sm font-semibold text-forest-800">
                  {initials(r.firstName, r.surname)}
                </span>
                <div className="min-w-0">
                  <p className="text-base font-semibold text-ink">{name}</p>
                  <p className="text-sm text-ink-muted">Player · {team.label}</p>
                </div>
              </div>
              <ul className="mt-3 flex flex-col gap-1.5 text-sm">
                <li className={`flex items-start gap-2 ${fits ? "text-forest-800" : "text-amber-800"}`}>
                  {fits ? <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
                  {requestFitLine(r, team)}
                </li>
                {requestDispensationLine(r) && (
                  <li className="flex items-start gap-2 text-forest-800">
                    <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    {requestDispensationLine(r)}
                  </li>
                )}
                <li className="flex items-start gap-2 text-ink-muted">
                  <UserRound aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  {requestAskedLine(r)}
                </li>
              </ul>
              {r.decidedByOthers ? (
                <p className="mt-3 rounded-lg border border-ink/10 bg-chalk px-3 py-2.5 text-sm text-ink">
                  This request is yours, or your child&apos;s, so another approver at the club decides it.
                </p>
              ) : declining === r.membershipId ? (
                <div className="mt-3">
                  <label htmlFor={`decline-${r.membershipId}`} className="text-sm font-medium text-ink">
                    Reason
                  </label>
                  <textarea
                    id={`decline-${r.membershipId}`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    maxLength={500}
                    aria-describedby={`decline-${r.membershipId}-hint`}
                    className="mt-1.5 w-full resize-none rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:border-pitch-600"
                  />
                  <p id={`decline-${r.membershipId}-hint`} className="mt-1 text-xs text-ink-muted">
                    {r.askedBy === "PARENT" ? "Say why. The reason is recorded and their parent is told." : "Say why. The reason is recorded and they are told."}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button type="button" variant="destructive" className="h-10 flex-1 sm:flex-none" disabled={busy || reason.trim().length === 0} onClick={() => onDecline(r, reason)}>
                      {busy ? "Declining…" : "Decline Request"}
                    </Button>
                    <Button type="button" variant="outline" className="h-10 flex-1 sm:flex-none" disabled={busy} onClick={() => setDeclining(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="mt-3 rounded-lg border border-ink/10 bg-chalk px-3 py-2.5 text-sm text-ink">{requestApprovalSentence(r, team.label, team.clubName)}</p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 flex-1 sm:flex-none"
                      disabled={busy}
                      onClick={() => {
                        setReason("")
                        setDeclining(r.membershipId)
                      }}
                    >
                      Decline
                    </Button>
                    <Button type="button" className="h-10 flex-1 sm:flex-none" disabled={busy} onClick={() => onApprove(r)}>
                      {busy ? "Working…" : "Approve"}
                    </Button>
                  </div>
                </>
              )}
            </li>
          )
        })}
      </ul>
      {data.awaitingGuardian > 0 && (
        <p className="flex items-center gap-2 px-1 text-sm text-ink-muted">
          <Clock aria-hidden="true" className="size-4 shrink-0" />
          {data.awaitingGuardian === 1 ? "1 more is waiting for a parent to confirm." : `${data.awaitingGuardian} more are waiting for a parent to confirm.`}
        </p>
      )}
      {data.awaitingDispensation > 0 && (
        <p className="flex items-center gap-2 px-1 text-sm text-ink-muted">
          <Clock aria-hidden="true" className="size-4 shrink-0" />
          {data.awaitingDispensation === 1
            ? "1 more is waiting for the club to decide a dispensation."
            : `${data.awaitingDispensation} more are waiting for the club to decide a dispensation.`}
        </p>
      )}
    </div>
  )
}

function initials(first: string, last: string): string {
  return `${first.trim().charAt(0)}${last.trim().charAt(0)}`.toUpperCase() || "?"
}
