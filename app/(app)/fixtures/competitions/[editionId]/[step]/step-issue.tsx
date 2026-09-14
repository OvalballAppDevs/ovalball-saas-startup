"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { competitionConflicts } from "@/lib/competitions/competition-conflicts"
import { MATCH_STATUS_WORD, participantLabel, type CompetitionWorkspace, type WorkspaceMatch } from "@/lib/competitions/workspace-types"
import { keepChoice, keptChoice, leaveNotice, takeNotice } from "@/lib/competitions/flash"
import { cn } from "@/lib/utils"

import { cancelMatch, issueMatches, recordResult, updateMatch } from "../../actions"
import { LEVEL_MARK } from "./step-fixtures"

/**
 * ISSUE -- SEND THE DRAW TO THE CLUBS, THEN RUN IT.
 *
 * Issuing makes draft matches real: an Ovalball club's match becomes a fixture
 * request its fixture administrators Confirm, ask to Change or Decline; a
 * match between clubs not on Ovalball is competition-managed only. Nothing is
 * issued while a draft has a conflict to resolve, and nothing already on a
 * club's calendar is ever cancelled to make room. Results are recorded here,
 * once, and reach the clubs' fixtures through the same sync.
 */

const VERIFICATION_WORD: Record<string, { glyph: string; word: string; className: string }> = {
  not_required: { glyph: "", word: "Competition-managed only", className: "text-sky-700" },
  awaiting: { glyph: "○", word: "Awaiting clubs", className: "text-ink-muted" },
  confirmed: { glyph: "●", word: "Confirmed", className: "text-forest-800" },
  change_requested: { glyph: "▲", word: "Change requested", className: "text-amber-700" },
  declined: { glyph: "■", word: "Declined", className: "text-destructive-text" },
}

export function StepIssue({ ws }: { ws: CompetitionWorkspace }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(() => takeNotice(`${ws.editionId}:issue`))
  // Kept across the remount a save causes, so recording several results does not reset the list each time.
  const [filter, setFilterState] = useState<"attention" | "all">(() => keptChoice(`${ws.editionId}:issue-filter`, "attention"))
  const setFilter = (f: "attention" | "all") => {
    keepChoice(`${ws.editionId}:issue-filter`, f)
    setFilterState(f)
  }
  const [pending, start] = useTransition()
  const byId = useMemo(() => new Map(ws.participants.map((p) => [p.id, p])), [ws.participants])
  const reports = useMemo(() => new Map(competitionConflicts(ws).map((r) => [r.key, r])), [ws])

  const drafts = ws.matches.filter((m) => m.status === "draft")
  const redDrafts = drafts.filter((m) => reports.get(m.id)?.level === "red")
  const missingTeam = drafts.filter((m) => [m.homeParticipantId, m.awayParticipantId].some((id) => id && byId.get(id)?.clubId && !byId.get(id)?.teamId))
  const byStatus = ws.matches.reduce<Record<string, number>>((acc, m) => ((acc[m.status] = (acc[m.status] ?? 0) + 1), acc), {})
  const needsAttention = ws.matches.filter((m) => m.verificationState === "change_requested" || m.verificationState === "declined" || m.syncError || reports.get(m.id)?.level === "red")
  const shown = filter === "attention" ? needsAttention : ws.matches.filter((m) => m.status !== "draft")

  function issue() {
    setError(null)
    setNotice(null)
    start(async () => {
      const r = await issueMatches(ws.editionId, null)
      if (!r.ok) return setError(r.error)
      const issued = r.summary.issued ?? 0
      const awaiting = r.summary.awaiting_clubs ?? 0
      setNotice(`${issued} match${issued === 1 ? "" : "es"} issued. ${awaiting} ${awaiting === 1 ? "is" : "are"} waiting for clubs to confirm.`)
      leaveNotice(`${ws.editionId}:issue`, `${issued} match${issued === 1 ? "" : "es"} issued. ${awaiting} ${awaiting === 1 ? "is" : "are"} waiting for clubs to confirm.`)
      router.refresh()
    })
  }

  const label = (id: string | null, source: WorkspaceMatch["homeSource"]) => (id ? participantLabel(byId.get(id)) : (source?.label ?? "TBC"))

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="issue-title" className="rounded-lg border border-ink/10 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div>
            <h2 id="issue-title" className="text-base font-semibold text-ink">
              Issue and Verify
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted tabular-nums">
              {Object.entries(byStatus)
                .map(([s, n]) => `${n} ${MATCH_STATUS_WORD[s]?.toLowerCase() ?? s}`)
                .join(", ") || "No matches yet."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/competitions/${ws.slug}`} className="text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline">
              Public Page
            </Link>
            <Button type="button" className="h-9" disabled={pending || drafts.length === 0 || redDrafts.length > 0} onClick={issue}>
              {pending ? "Issuing…" : drafts.length === 0 ? "Nothing to Issue" : `Issue ${drafts.length} Draft Match${drafts.length === 1 ? "" : "es"}`}
            </Button>
          </div>
        </div>
        <div className="space-y-1 border-t border-ink/8 px-5 py-2 text-sm [&:not(:has(>:not(:empty)))]:hidden">
          {redDrafts.length > 0 && (
            <p className="text-destructive-text">
              ■ {redDrafts.length} draft match{redDrafts.length === 1 ? " has a conflict" : "es have conflicts"} to resolve in{" "}
              <Link href={`/fixtures/competitions/${ws.editionId}/fixtures`} className="underline underline-offset-2">
                Fixtures
              </Link>{" "}
              before anything is issued.
            </p>
          )}
          {missingTeam.length > 0 && <p className="text-amber-800">▲ {missingTeam.length} draft match{missingTeam.length === 1 ? " involves an Ovalball club" : "es involve Ovalball clubs"} without a team chosen. Choose the team in Participants so the right people are asked.</p>}
          {error && (
            <p role="alert" className="text-destructive-text">
              {error}
            </p>
          )}
          <p role="status" aria-live="polite" className="text-ink empty:hidden">{notice}</p>
        </div>
      </section>

      <section aria-labelledby="matches-title" className="relative overflow-x-auto rounded-lg border border-ink/10 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/8 px-5 py-3">
          <h2 id="matches-title" className="text-sm font-semibold text-ink">
            {filter === "attention" ? `Needs Attention (${needsAttention.length})` : "Issued Matches"}
          </h2>
          <div className="inline-flex rounded-md border border-ink/15 p-0.5" role="radiogroup" aria-label="Show">
            {(["attention", "all"] as const).map((f) => (
              <button key={f} type="button" role="radio" aria-checked={filter === f} onClick={() => setFilter(f)} className={cn("h-7 rounded px-2.5 text-xs", filter === f ? "bg-forest-800 font-medium text-white" : "text-ink hover:bg-ink/[0.05]")}>
                {f === "attention" ? "Needs Attention" : "All Issued"}
              </button>
            ))}
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-muted">{filter === "attention" ? "Nothing needs attention." : "Nothing has been issued yet."}</p>
        ) : (
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b border-ink/8 text-left text-xs text-ink-muted">
                <th scope="col" className="px-4 py-2 font-medium">
                  Match
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  When
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Clubs
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Result
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <IssueRow key={m.id} ws={ws} match={m} label={label} level={reports.get(m.id)?.level ?? "green"} issues={reports.get(m.id)?.issues.map((i) => i.message) ?? []} pending={pending} start={start} onError={setError} onDone={() => router.refresh()} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

function IssueRow({
  ws,
  match: m,
  label,
  level,
  issues,
  pending,
  start,
  onError,
  onDone,
}: {
  ws: CompetitionWorkspace
  match: WorkspaceMatch
  label: (id: string | null, source: WorkspaceMatch["homeSource"]) => string
  level: "green" | "amber" | "red"
  issues: string[]
  pending: boolean
  start: (fn: () => Promise<void>) => void
  onError: (e: string | null) => void
  onDone: () => void
}) {
  const [home, setHome] = useState(m.homeScore?.toString() ?? "")
  const [away, setAway] = useState(m.awayScore?.toString() ?? "")
  const [winner, setWinner] = useState<string>(m.winnerParticipantId ?? "")
  const [reason, setReason] = useState("")
  const [cancelOpen, setCancelOpen] = useState(false)
  const v = VERIFICATION_WORD[m.verificationState] ?? VERIFICATION_WORD.awaiting
  const isKnockout = ws.stages.find((s) => s.id === m.stageId)?.kind === "knockout"
  const draw = home !== "" && home === away
  const canResult = (m.status === "issued" || m.status === "confirmed" || m.status === "scheduled" || m.status === "completed") && m.homeParticipantId && m.awayParticipantId
  const proposal = m.verifications.find((x) => x.status === "change_requested" && (x.proposedDate || x.proposedKickoff || x.proposedVenueId || x.proposedPitchId))
  const venueName = (id: string | null) => (id ? (ws.venues.find((v) => v.id === id)?.name ?? null) : null)
  const pitchName = (id: string | null) => (id ? (ws.pitches.find((p) => p.id === id)?.name ?? null) : null)

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    start(async () => {
      onError(null)
      const r = await fn()
      if (!r.ok) return onError(r.error)
      onDone()
    })

  return (
    <tr className={cn("border-b border-ink/6 align-top last:border-0", level === "red" && "bg-destructive/[0.04]")}>
      <td className="px-4 py-2">
        <p className="font-medium text-ink">
          {label(m.homeParticipantId, m.homeSource)} v {label(m.awayParticipantId, m.awaySource)}
        </p>
        <p className="text-xs text-ink-muted">
          {MATCH_STATUS_WORD[m.status] ?? m.status}
          {level !== "green" && (
            <span className={cn("ml-2", LEVEL_MARK[level].className)}>
              {LEVEL_MARK[level].glyph} {issues.join(" ")}
            </span>
          )}
        </p>
        {m.syncError && <p className="text-xs text-destructive-text">■ {m.syncError}</p>}
      </td>
      <td className="px-3 py-2 text-ink tabular-nums whitespace-nowrap">
        {m.matchDate ?? "Date not set"}
        {m.kickoffTime ? `, ${m.kickoffTime}` : ""}
      </td>
      <td className="px-3 py-2">
        <p className={cn("text-xs font-medium", v.className)}>
          {v.glyph && <span aria-hidden="true">{v.glyph} </span>}
          {v.word}
        </p>
        {m.verifications
          .filter((x) => x.status !== "awaiting" || m.verificationState === "awaiting")
          .map((x) => (
            <p key={x.id} className="text-xs text-ink-muted">
              {participantLabel(ws.participants.find((p) => p.id === x.participantId))}: {VERIFICATION_WORD[x.status]?.word ?? x.status}
              {x.proposedDate ? `, proposes ${x.proposedDate}` : ""}
              {x.proposedKickoff ? ` at ${x.proposedKickoff}` : ""}
              {x.proposedVenueId ? `, proposes ${venueName(x.proposedVenueId) ?? "another ground"}${x.proposedPitchId ? `, ${pitchName(x.proposedPitchId) ?? "another pitch"}` : ""}` : ""}
              {x.message ? `. "${x.message}"` : ""}
            </p>
          ))}
        {proposal && m.status !== "cancelled" && (
          <button type="button" disabled={pending} onClick={() => run(() => updateMatch(ws.editionId, m.id, { ...(proposal.proposedDate ? { match_date: proposal.proposedDate } : {}), ...(proposal.proposedKickoff ? { kickoff_time: proposal.proposedKickoff } : {}), ...(proposal.proposedVenueId ? { venue_id: proposal.proposedVenueId, venue_text: null, pitch_id: proposal.proposedPitchId } : proposal.proposedPitchId ? { pitch_id: proposal.proposedPitchId } : {}) }))} className="mt-1 text-xs font-medium text-forest-800 underline underline-offset-2">
            Apply Proposed Change
          </button>
        )}
      </td>
      <td className="px-3 py-2">
        {canResult ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <input aria-label="Home score" inputMode="numeric" value={home} onChange={(e) => setHome(e.target.value.replace(/\D/g, ""))} className="h-8 w-12 rounded border border-ink/15 text-center tabular-nums" />
            <span className="text-ink-muted">–</span>
            <input aria-label="Away score" inputMode="numeric" value={away} onChange={(e) => setAway(e.target.value.replace(/\D/g, ""))} className="h-8 w-12 rounded border border-ink/15 text-center tabular-nums" />
            {isKnockout && draw && (
              <select aria-label="Winner" value={winner} onChange={(e) => setWinner(e.target.value)} className="h-8 rounded border border-ink/15 px-1 text-xs">
                <option value="">Winner</option>
                <option value={m.homeParticipantId!}>{label(m.homeParticipantId, null)}</option>
                <option value={m.awayParticipantId!}>{label(m.awayParticipantId, null)}</option>
              </select>
            )}
            <button
              type="button"
              disabled={pending || home === "" || away === "" || (isKnockout && draw && !winner)}
              onClick={() => run(() => recordResult(ws.editionId, m.id, Number(home), Number(away), isKnockout && draw ? winner : null))}
              className="h-8 rounded px-2 text-xs font-medium text-forest-800 pointer-coarse:h-11 hover:bg-forest-800/[0.06] disabled:opacity-40"
            >
              Save Result
            </button>
          </div>
        ) : (
          <span className="text-xs text-ink-muted">{m.homeScore !== null ? `${m.homeScore}–${m.awayScore}` : ""}</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {m.status !== "cancelled" && m.status !== "completed" && m.status !== "draft" && (
          cancelOpen ? (
            <div className="flex flex-col items-end gap-1">
              <input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason clubs will see" className="h-8 w-52 rounded border border-ink/15 px-2 text-xs" />
              <div className="flex gap-1">
                <button type="button" disabled={pending || !reason.trim()} onClick={() => run(() => cancelMatch(ws.editionId, m.id, "postponed", reason.trim()))} className="h-7 rounded px-2 text-xs pointer-coarse:h-11 text-ink hover:bg-ink/[0.05] disabled:opacity-40">
                  Postpone
                </button>
                <button type="button" disabled={pending || !reason.trim()} onClick={() => run(() => cancelMatch(ws.editionId, m.id, "cancelled", reason.trim()))} className="h-7 rounded px-2 text-xs pointer-coarse:h-11 text-destructive-text hover:bg-destructive/[0.06] disabled:opacity-40">
                  Cancel Match
                </button>
                <button type="button" onClick={() => setCancelOpen(false)} className="h-7 rounded px-2 text-xs pointer-coarse:h-11 text-ink-muted hover:bg-ink/[0.05]">
                  Keep
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setCancelOpen(true)} className="h-7 rounded px-2 text-xs pointer-coarse:h-11 text-ink-muted hover:bg-ink/[0.05] hover:text-ink">
              Postpone or Cancel
            </button>
          )
        )}
      </td>
    </tr>
  )
}
