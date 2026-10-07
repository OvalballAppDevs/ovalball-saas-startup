"use client"

import { useState, useTransition } from "react"
import { CircleCheck, KeyRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import { childRequestAnswered, childRequestSteps, type FamilyTeamRequest } from "@ovalball/contracts/team/team-code"

import { answerTeamRequest } from "./actions"

/**
 * THE REQUESTS, AND THE ANSWERS JUST GIVEN. The server stops listing a request the moment it is answered,
 * and the page refreshes with that answer -- which replaced the confirmation with "Nothing is waiting on
 * you" before the parent could read who decides next (found by browser suite 96). So an answered card stays
 * where it was, showing its answer, until the parent leaves the page.
 */
export function TeamRequestList({ requests, highlighted }: { requests: FamilyTeamRequest[]; highlighted: string | null }) {
  const [answered, setAnswered] = useState<FamilyTeamRequest[]>([])
  const [order] = useState(() => requests.map((r) => r.membershipId))
  const shown = [...requests, ...answered.filter((a) => !requests.some((r) => r.membershipId === a.membershipId))].sort(
    (a, b) => rank(order, a.membershipId) - rank(order, b.membershipId)
  )

  if (shown.length === 0) {
    return (
      <p className="mt-6 rounded-lg border border-dashed border-ink/15 bg-white/60 px-4 py-6 text-center text-sm text-ink-muted">
        Nothing is waiting on you. A request your child makes with a team&apos;s code appears here for you to confirm.
      </p>
    )
  }
  return (
    <ul className="mt-6 flex flex-col gap-4">
      {shown.map((r) => (
        <TeamRequestCard
          key={r.membershipId}
          request={r}
          highlighted={r.membershipId === highlighted}
          onAnswered={() => setAnswered((prev) => (prev.some((a) => a.membershipId === r.membershipId) ? prev : [...prev, r]))}
        />
      ))}
    </ul>
  )
}

/** Where a request first appeared; one that arrives later goes after the rest. */
function rank(order: string[], id: string): number {
  const at = order.indexOf(id)
  return at === -1 ? order.length : at
}

/**
 * CONFIRM A CHILD'S REQUEST -- the website's half (team codes place players, 20270741000000; the layout
 * the product owner approved 2026-10-05). The phone's "Confirm Jamie's Request" says the same three steps
 * in the same words; both answer through the server, which re-checks the parent.
 */
export function TeamRequestCard({ request, highlighted, onAnswered }: { request: FamilyTeamRequest; highlighted: boolean; onAnswered?: () => void }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<"confirmed" | "declined" | null>(null)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState("")
  const first = request.firstName || "your child"

  function answer(kind: "CONFIRM" | "DECLINE") {
    setError(null)
    start(async () => {
      const result = await answerTeamRequest(request.membershipId, kind, kind === "DECLINE" ? reason : undefined)
      if (!result.ok) {
        setError(result.error)
        return
      }
      onAnswered?.()
      setDone(kind === "CONFIRM" ? "confirmed" : "declined")
    })
  }

  if (done) {
    const answered = childRequestAnswered(done, request)
    return (
      <li className="rounded-lg border border-ink/10 bg-white p-5" role="status">
        <p className="flex items-center gap-2 text-base font-semibold text-ink">
          {done === "confirmed" && <CircleCheck aria-hidden="true" className="size-5 shrink-0 text-forest-800" />}
          {answered.title}
        </p>
        <p className="mt-1 text-sm text-ink-muted">{answered.sentence}</p>
      </li>
    )
  }

  return (
    <li id={`request-${request.membershipId}`} className={`rounded-lg border bg-white p-5 ${highlighted ? "border-forest-800" : "border-ink/10"}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-mint-100 text-sm font-semibold text-forest-800">
          {`${request.firstName.charAt(0)}${request.surname.charAt(0)}`.toUpperCase()}
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-ink">{`${request.firstName} ${request.surname}`.trim()}</h2>
          <p className="text-sm text-ink-muted">
            {request.clubName ? `Asked to join ${request.teamLabel} at ${request.clubName}` : `Asked to join ${request.teamLabel}`}
          </p>
        </div>
      </div>
      <p className="mt-3 flex items-start gap-2 text-sm text-ink-muted">
        <KeyRound aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        Used the team&apos;s code from {first}&apos;s own account{request.requestedAt ? `, ${askedWhen(request.requestedAt)}` : ""}.
      </p>

      <h3 className="mt-5 text-base font-semibold text-ink">What Happens Next</h3>
      <ol className="mt-2 flex flex-col gap-2 text-sm text-ink">
        {childRequestSteps(request).map((step, i) => (
          <li key={step} className="flex items-start gap-3">
            <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-mint-100 text-xs font-semibold text-forest-800">
              {i + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>
      <p className="mt-4 rounded-lg border border-ink/10 bg-chalk px-3 py-2.5 text-sm text-ink">
        Nothing happens until you confirm. If {first} didn&apos;t ask, decline it.
      </p>

      {declining && (
        <div className="mt-4">
          <label htmlFor={`decline-${request.membershipId}`} className="text-sm font-medium text-ink">
            Reason (Optional)
          </label>
          <textarea
            id={`decline-${request.membershipId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="mt-1.5 w-full resize-none rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:border-pitch-600"
          />
          <p className="mt-1 text-xs text-ink-muted">{first} is told, and reads any reason you give.</p>
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm text-destructive-text" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {declining ? (
          <>
            <Button type="button" variant="destructive" className="h-11 px-6" disabled={pending} onClick={() => answer("DECLINE")}>
              {pending ? "Declining…" : "Decline Request"}
            </Button>
            <Button type="button" variant="outline" className="h-11 px-6" disabled={pending} onClick={() => setDeclining(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button type="button" className="h-11 px-6" disabled={pending} onClick={() => answer("CONFIRM")}>
              {pending ? "Confirming…" : "Confirm"}
            </Button>
            <Button type="button" variant="outline" className="h-11 px-6" disabled={pending} onClick={() => setDeclining(true)}>
              Decline
            </Button>
          </>
        )}
      </div>
    </li>
  )
}

function askedWhen(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return "recently"
  const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })
  const day = (d: Date) => d.toLocaleDateString("en-GB", { timeZone: "Europe/London" })
  if (day(at) === day(new Date())) return `today at ${time}`
  return `on ${at.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Europe/London" })} at ${time}`
}
