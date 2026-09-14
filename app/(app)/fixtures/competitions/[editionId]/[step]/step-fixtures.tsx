"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeftRight, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { competitionConflicts } from "@/lib/competitions/competition-conflicts"
import { leagueDraftMatches, type VenueChoice } from "@/lib/competitions/drafts"
import { leagueFeasibility, type MatchesMode } from "@/lib/competitions/league"
import { planReplacement, scheduleWarnings } from "@/lib/competitions/match-edits"
import { MATCH_STATUS_WORD, participantLabel, type CompetitionWorkspace, type DraftMatchInput, type WorkspaceMatch } from "@/lib/competitions/workspace-types"
import type { ConflictReport } from "@/lib/fixtures/conflicts"
import { leaveNotice, takeNotice } from "@/lib/competitions/flash"
import { cn } from "@/lib/utils"

import { deleteDraftMatch, replaceDraftMatches, saveStage, updateMatch, updateMatches, type MatchPatch } from "../../actions"

/**
 * FIXTURES -- THE LEAGUE, ROUND BY ROUND.
 *
 * Generate every group's schedule (everyone once, home and away, or a set
 * number of matches each) with dates by round. An impossible request is
 * refused with the reason, never quietly altered. Every draft match stays
 * editable -- date, kick-off, venue, pitch, round, either team, home and away --
 * and a round, a group or the whole league can be regenerated without touching
 * anything already issued. Choosing a team who already plays elsewhere that
 * round swaps the two, in one save. A match can be added to a round by hand.
 * Each match carries its conflict state: ● ready, ▲ check, ■ resolve; hand
 * edits that leave a group off its requested schedule are said, not blocked.
 */

export function venueChooser(ws: CompetitionWorkspace) {
  const participants = new Map(ws.participants.map((p) => [p.id, p]))
  return (homeParticipantId: string): VenueChoice => {
    const p = participants.get(homeParticipantId)
    if (!p) return { venueId: null, venueText: null }
    if (p.clubId) {
      const grounds = ws.venues.filter((v) => v.clubId === p.clubId)
      const def = grounds.filter((v) => v.isDefaultHome)
      const primary = def.length === 1 ? def[0] : grounds.length === 1 ? grounds[0] : null
      if (primary) return { venueId: primary.id, venueText: null }
    }
    return { venueId: null, venueText: p.homeGround }
  }
}

export const LEVEL_MARK: Record<ConflictReport["level"], { glyph: string; word: string; className: string }> = {
  green: { glyph: "●", word: "Ready", className: "text-forest-800" },
  amber: { glyph: "▲", word: "Check", className: "text-amber-700" },
  red: { glyph: "■", word: "Resolve", className: "text-destructive-text" },
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

export function StepFixtures({ ws }: { ws: CompetitionWorkspace }) {
  const router = useRouter()
  const league = ws.stages.find((s) => s.kind === "league")
  const settings = league?.settings ?? {}
  const [schedule, setSchedule] = useState<"single" | "double" | "custom">(settings.schedule ?? "single")
  const [perTeam, setPerTeam] = useState<number>(settings.perTeam ?? 3)
  const [firstDate, setFirstDate] = useState<string>(settings.firstDate ?? "")
  const [everyDays, setEveryDays] = useState<number>(settings.everyDays ?? 7)
  const [kickoff, setKickoff] = useState<string>(settings.kickoff ?? "")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(() => takeNotice(`${ws.editionId}:fixtures`))
  const [pending, start] = useTransition()

  const reports = useMemo(() => new Map(competitionConflicts(ws).map((r) => [r.key, r])), [ws])
  const matches = ws.matches.filter((m) => m.stageId === league?.id)
  const venueFor = useMemo(() => venueChooser(ws), [ws])
  const [adding, setAdding] = useState<number | null>(null)

  if (ws.format === "knockout") {
    return <p className="rounded-lg border border-ink/10 bg-white px-5 py-6 text-sm text-ink-muted">This competition is a knockout. Its ties are drawn in Knockout.</p>
  }
  if (!league || league.groups.length === 0) {
    return <p className="rounded-lg border border-ink/10 bg-white px-5 py-6 text-sm text-ink-muted">Draw and save the groups first. A league schedule is generated for each group.</p>
  }

  const mode: MatchesMode = schedule === "custom" ? { kind: "custom", perTeam } : { kind: schedule }
  const feasibility = league.groups.map((g) => ({ group: g, f: leagueFeasibility(g.members.length, mode) }))
  const infeasible = feasibility.filter((x) => !x.f.ok)

  const rounds = [...new Set(matches.map((m) => m.roundNumber ?? 0))].sort((a, b) => a - b)
  const issuedCount = matches.filter((m) => m.status !== "draft").length
  const red = matches.filter((m) => reports.get(m.id)?.level === "red")
  const amber = matches.filter((m) => reports.get(m.id)?.level === "amber")

  function build() {
    return leagueDraftMatches(league!.groups, mode, { firstDate: firstDate || null, everyDays, kickoff: kickoff || null, venueFor, newId })
  }

  function persistSettings() {
    return { ...settings, schedule, perTeam, firstDate: firstDate || null, everyDays, kickoff: kickoff || null }
  }

  function generate(scope: { groupId?: string; roundNumber?: number } = {}) {
    setError(null)
    setNotice(null)
    const draft = build()
    if (draft.warnings.length > 0 && !scope.groupId) {
      setError(draft.warnings.join(" "))
      return
    }
    let chosen: DraftMatchInput[] = draft.matches
    if (scope.groupId) chosen = chosen.filter((m) => m.groupId === scope.groupId)
    if (scope.roundNumber) chosen = chosen.filter((m) => m.roundNumber === scope.roundNumber)
    // An issued match is kept as it is, so its pairing is not drafted a second time.
    const issued = matches.filter((m) => m.status !== "draft")
    chosen = chosen.filter(
      (c) =>
        !issued.some(
          (m) =>
            m.groupId === c.groupId &&
            m.roundNumber === c.roundNumber &&
            new Set([m.homeParticipantId, m.awayParticipantId, c.homeParticipantId, c.awayParticipantId]).size === 2,
        ),
    )
    start(async () => {
      // The settings travel with the stage, so regenerating later starts from the same answers.
      const stage = await saveStage(ws.editionId, { stageId: league!.id, kind: "league", name: league!.name, sortOrder: league!.sortOrder, settings: persistSettings(), groups: null })
      if (!stage.ok) return setError(stage.error)
      const r = await replaceDraftMatches(ws.editionId, league!.id, chosen, { groupId: scope.groupId ?? null, roundNumber: scope.roundNumber ?? null }, scope.groupId || scope.roundNumber ? undefined : draft.rounds)
      if (!r.ok) return setError(r.error)
      setNotice(
        `${r.added} draft match${r.added === 1 ? "" : "es"} generated${r.removed ? `, ${r.removed} replaced` : ""}.${r.keptIssued ? ` ${r.keptIssued} issued match${r.keptIssued === 1 ? " was" : "es were"} left as they are.` : ""}`,
      )
      leaveNotice(`${ws.editionId}:fixtures`,
        `${r.added} draft match${r.added === 1 ? "" : "es"} generated${r.removed ? `, ${r.removed} replaced` : ""}.${r.keptIssued ? ` ${r.keptIssued} issued match${r.keptIssued === 1 ? " was" : "es were"} left as they are.` : ""}`,
      )
      router.refresh()
    })
  }

  function setRoundDate(roundNumber: number, date: string) {
    const inRound = matches.filter((m) => m.roundNumber === roundNumber && m.status === "draft")
    start(async () => {
      const r = await replaceDraftMatches(
        ws.editionId,
        league!.id,
        inRound.map((m) => toDraft(m, { matchDate: date || null })),
        { roundNumber },
        league!.rounds.length
          ? league!.rounds.map((x) => (x.roundNumber === roundNumber ? { ...x, roundDate: date || null } : x))
          : rounds.map((n) => ({ roundNumber: n, name: `Round ${n}`, roundDate: n === roundNumber ? date || null : null })),
      )
      if (!r.ok) return setError(r.error)
      router.refresh()
    })
  }

  const labelOf = (id: string) => participantLabel(ws.participants.find((p) => p.id === id))
  // Saved settings are what the schedule was generated with; hand edits are measured against them.
  const savedMode: MatchesMode | null = settings.schedule ? (settings.schedule === "custom" ? { kind: "custom", perTeam: settings.perTeam ?? 3 } : { kind: settings.schedule }) : null
  const warnings = savedMode && matches.length > 0 ? league.groups.flatMap((g) => scheduleWarnings(g, matches.filter((m) => m.groupId === g.id), savedMode, labelOf)) : []

  function replace(m: WorkspaceMatch, side: "home" | "away", participantId: string) {
    setError(null)
    setNotice(null)
    const plan = planReplacement(m, side, participantId, matches, venueFor)
    if (plan.kind === "refused") return setError(plan.reason)
    if (plan.changes.length === 0) return
    start(async () => {
      const r = await updateMatches(ws.editionId, plan.changes)
      if (!r.ok) return setError(r.error)
      const text = plan.kind === "swap" ? `${labelOf(participantId)} swapped with ${labelOf((side === "home" ? m.homeParticipantId : m.awayParticipantId) ?? "")}, in one save.` : `${labelOf(participantId)} is now the ${side} team.`
      setNotice(text)
      leaveNotice(`${ws.editionId}:fixtures`, text)
      router.refresh()
    })
  }

  function moveRound(m: WorkspaceMatch, roundNumber: number) {
    const from = league!.rounds.find((r) => r.roundNumber === m.roundNumber)?.roundDate ?? null
    const to = league!.rounds.find((r) => r.roundNumber === roundNumber)?.roundDate ?? null
    // A date that followed its round follows the new one; a date set by hand stays.
    const followsRound = !m.matchDate || m.matchDate === from
    patch(m, { round_number: roundNumber, ...(followsRound && to ? { match_date: to } : {}) })
  }

  function addMatch(roundNumber: number, input: { groupId: string; home: string; away: string }) {
    setError(null)
    const inRound = matches.filter((m) => m.roundNumber === roundNumber && m.status === "draft")
    const roundDate = league!.rounds.find((r) => r.roundNumber === roundNumber)?.roundDate ?? inRound[0]?.matchDate ?? null
    const venue = venueFor(input.home)
    start(async () => {
      const r = await replaceDraftMatches(ws.editionId, league!.id, [
        ...inRound.map((m) => toDraft(m)),
        { id: newId(), groupId: input.groupId, roundNumber, homeParticipantId: input.home, awayParticipantId: input.away, matchDate: roundDate, kickoffTime: settings.kickoff ?? null, venueId: venue.venueId, venueText: venue.venueText },
      ], { roundNumber })
      if (!r.ok) return setError(r.error)
      setAdding(null)
      const text = `${labelOf(input.home)} v ${labelOf(input.away)} added to Round ${roundNumber}.`
      setNotice(text)
      leaveNotice(`${ws.editionId}:fixtures`, text)
      router.refresh()
    })
  }

  function patch(m: WorkspaceMatch, p: MatchPatch) {
    setError(null)
    start(async () => {
      const r = await updateMatch(ws.editionId, m.id, p)
      if (!r.ok) return setError(r.error)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="schedule-title" className="rounded-lg border border-ink/10 bg-white">
        <div className="flex flex-wrap items-end justify-between gap-4 px-5 py-4">
          <div>
            <h2 id="schedule-title" className="text-base font-semibold text-ink">
              League Schedule
            </h2>
            <p className="mt-0.5 text-sm text-ink-muted">
              {league.groups.length} groups, {matches.length} matches{issuedCount ? `, ${issuedCount} issued` : ""}.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="schedule-mode" className="block text-xs font-medium text-ink-muted">
                Each Team Plays
              </label>
              <select
                id="schedule-mode"
                value={schedule}
                onChange={(e) => setSchedule(e.target.value as typeof schedule)}
                className="mt-1 h-9 rounded-md border border-ink/15 bg-white px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-pitch-400/40"
              >
                <option value="single">Every Opponent Once</option>
                <option value="double">Every Opponent Home and Away</option>
                <option value="custom">A Set Number of Matches</option>
              </select>
            </div>
            {schedule === "custom" && (
              <div>
                <label htmlFor="per-team" className="block text-xs font-medium text-ink-muted">
                  Matches Each
                </label>
                <input id="per-team" type="number" min={1} value={perTeam} onChange={(e) => setPerTeam(Math.max(1, Number(e.target.value) || 1))} className="mt-1 h-9 w-20 rounded-md border border-ink/15 bg-white px-2 text-sm tabular-nums" />
              </div>
            )}
            <div>
              <label htmlFor="first-date" className="block text-xs font-medium text-ink-muted">
                Round 1 Date
              </label>
              <input id="first-date" type="date" value={firstDate} onChange={(e) => setFirstDate(e.target.value)} className="mt-1 h-9 rounded-md border border-ink/15 bg-white px-2 text-sm" />
            </div>
            <div>
              <label htmlFor="every-days" className="block text-xs font-medium text-ink-muted">
                Days Between Rounds
              </label>
              <input id="every-days" type="number" min={1} value={everyDays} onChange={(e) => setEveryDays(Math.max(1, Number(e.target.value) || 7))} className="mt-1 h-9 w-20 rounded-md border border-ink/15 bg-white px-2 text-sm tabular-nums" />
            </div>
            <div>
              <label htmlFor="kickoff" className="block text-xs font-medium text-ink-muted">
                Kick-Off
              </label>
              <input id="kickoff" type="time" value={kickoff} onChange={(e) => setKickoff(e.target.value)} className="mt-1 h-9 rounded-md border border-ink/15 bg-white px-2 text-sm" />
            </div>
            <Button type="button" className="h-9" disabled={pending || infeasible.length > 0} onClick={() => generate()}>
              {pending ? "Working…" : matches.length ? "Regenerate All Drafts" : "Generate Fixtures"}
            </Button>
          </div>
        </div>
        <div className="space-y-1 border-t border-ink/8 px-5 py-2 text-sm [&:not(:has(>:not(:empty)))]:hidden">
          {/* One line per distinct reason: eight groups of four share one answer. */}
          {[...new Map(infeasible.map(({ f }) => [f.reason, infeasible.filter((x) => x.f.reason === f.reason)])).entries()].map(([reason, list]) => (
            <p key={reason} role="alert" className="text-destructive-text">
              ■ {list.length === league.groups.length ? "Every group" : list.map((x) => x.group.name).join(", ")}: {reason}
            </p>
          ))}
          {error && (
            <p role="alert" className="text-destructive-text">
              {error}
            </p>
          )}
          {warnings.map((w) => (
            <p key={w} className="text-amber-800">
              ▲ {w}
            </p>
          ))}
          <p role="status" aria-live="polite" className="text-ink empty:hidden">{notice}</p>
        </div>
      </section>

      {(red.length > 0 || amber.length > 0) && (
        <section aria-labelledby="conflicts-title" className="rounded-lg border border-ink/10 bg-white px-5 py-3">
          <h2 id="conflicts-title" className="text-sm font-semibold text-ink">
            <span className="text-destructive-text">■ {red.length} to resolve</span>
            <span className="ml-3 text-amber-700">▲ {amber.length} to check</span>
          </h2>
          <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto text-sm">
            {[...red, ...amber].map((m) => (
              <li key={m.id}>
                {/* Each message already names the match; the link is the message. */}
                <a href={`#match-${m.id}`} className="text-ink underline-offset-2 hover:underline">
                  {reports.get(m.id)?.issues.map((i) => i.message).join(" ")}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {league.groups.length > 1 && matches.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-muted">Regenerate one group:</span>
          {league.groups.map((g) => (
            <button key={g.id} type="button" disabled={pending} onClick={() => generate({ groupId: g.id })} className="h-8 rounded border border-ink/15 bg-white px-2.5 text-ink hover:bg-ink/[0.04] disabled:opacity-50">
              {g.name}
            </button>
          ))}
        </div>
      )}

      {rounds.map((roundNumber) => {
        const groupName = (id: string | null) => league.groups.find((g) => g.id === id)?.name ?? ""
        const inRound = matches.filter((m) => (m.roundNumber ?? 0) === roundNumber).sort((a, b) => groupName(a.groupId).localeCompare(groupName(b.groupId)))
        const saved = league.rounds.find((r) => r.roundNumber === roundNumber)
        return (
          <section key={roundNumber} aria-labelledby={`round-${roundNumber}`} className="relative overflow-x-auto rounded-lg border border-ink/10 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/8 px-4 py-2">
              <h3 id={`round-${roundNumber}`} className="text-sm font-semibold text-ink">
                Round {roundNumber} <span className="font-normal text-ink-muted">({inRound.length} matches)</span>
              </h3>
              <div className="flex items-center gap-2">
                <label htmlFor={`round-date-${roundNumber}`} className="text-xs text-ink-muted">
                  Round Date
                </label>
                <input
                  id={`round-date-${roundNumber}`}
                  type="date"
                  defaultValue={saved?.roundDate ?? inRound[0]?.matchDate ?? ""}
                  disabled={pending}
                  onBlur={(e) => e.target.value !== (saved?.roundDate ?? inRound[0]?.matchDate ?? "") && setRoundDate(roundNumber, e.target.value)}
                  className="h-8 rounded-md border border-ink/15 bg-white px-2 text-sm"
                />
                <button type="button" disabled={pending} onClick={() => generate({ roundNumber })} className="h-8 rounded px-2 text-xs font-medium text-forest-800 hover:bg-forest-800/[0.06] disabled:opacity-50">
                  Regenerate Round
                </button>
                <button type="button" disabled={pending} aria-expanded={adding === roundNumber} onClick={() => setAdding(adding === roundNumber ? null : roundNumber)} className="h-8 rounded px-2 text-xs font-medium text-forest-800 hover:bg-forest-800/[0.06] disabled:opacity-50">
                  Add Match
                </button>
              </div>
            </div>
            {adding === roundNumber && <AddMatchForm roundNumber={roundNumber} groups={league.groups} busy={new Set(inRound.filter((m) => m.status !== "cancelled").flatMap((m) => [m.homeParticipantId, m.awayParticipantId]).filter((x): x is string => Boolean(x)))} label={labelOf} pending={pending} onAdd={(input) => addMatch(roundNumber, input)} onCancel={() => setAdding(null)} />}
            <table className="w-full min-w-[1320px] text-sm">
              <thead className="sr-only">
                <tr>
                  <th>Check</th>
                  <th>Group</th>
                  <th>Round</th>
                  <th>Date</th>
                  <th>Kick-Off</th>
                  <th>Home</th>
                  <th>Swap</th>
                  <th>Away</th>
                  <th>Venue</th>
                  <th>Pitch</th>
                  <th>Status</th>
                  <th>Remove</th>
                </tr>
              </thead>
              <tbody>
                {inRound.map((m) => (
                  <MatchRow
                    key={m.id}
                    ws={ws}
                    match={m}
                    report={reports.get(m.id)}
                    pending={pending}
                    onPatch={(p) => patch(m, p)}
                    choices={league.groups.find((g) => g.id === m.groupId)?.members ?? ws.participants.filter((p) => p.status === "entered").map((p) => p.id)}
                    onReplace={(side, id) => replace(m, side, id)}
                    rounds={[...rounds, Math.max(0, ...rounds) + 1]}
                    onMoveRound={(n) => moveRound(m, n)}
                    onDelete={() => start(async () => {
                    const r = await deleteDraftMatch(ws.editionId, m.id)
                    if (!r.ok) setError(r.error)
                    router.refresh()
                  })} />
                ))}
              </tbody>
            </table>
          </section>
        )
      })}
    </div>
  )
}

function toDraft(m: WorkspaceMatch, over: Partial<DraftMatchInput> = {}): DraftMatchInput {
  return {
    id: m.id,
    groupId: m.groupId,
    roundNumber: m.roundNumber,
    bracketSlot: m.bracketSlot,
    homeParticipantId: m.homeParticipantId,
    awayParticipantId: m.awayParticipantId,
    homeSource: m.homeSource,
    awaySource: m.awaySource,
    matchDate: m.matchDate,
    kickoffTime: m.kickoffTime,
    venueId: m.venueId,
    venueText: m.venueText,
    pitchId: m.pitchId,
    ...over,
  }
}

export function MatchRow({
  ws,
  match: m,
  report,
  pending,
  onPatch,
  onDelete,
  canDelete = true,
  choices,
  onReplace,
  rounds,
  onMoveRound,
}: {
  ws: CompetitionWorkspace
  match: WorkspaceMatch
  report: ConflictReport | undefined
  pending: boolean
  onPatch: (p: MatchPatch) => void
  onDelete: () => void
  /** A knockout tie is part of the bracket: it is redrawn, never removed on its own. */
  canDelete?: boolean
  /** Teams either side may be replaced with, while the match is a draft. */
  choices?: string[]
  onReplace?: (side: "home" | "away", participantId: string) => void
  /** League rounds the match may move to. */
  rounds?: number[]
  onMoveRound?: (roundNumber: number) => void
}) {
  const home = ws.participants.find((p) => p.id === m.homeParticipantId)
  const away = ws.participants.find((p) => p.id === m.awayParticipantId)
  const group = ws.stages.flatMap((s) => s.groups).find((g) => g.id === m.groupId)
  const level = report?.level ?? "green"
  const mark = LEVEL_MARK[level]
  const locked = m.status === "cancelled" || m.status === "completed"
  const homeGrounds = home?.clubId ? ws.venues.filter((v) => v.clubId === home.clubId) : []
  const venuePitches = m.venueId ? ws.pitches.filter((p) => p.venueId === m.venueId) : []
  const draft = m.status === "draft"
  const sideCell = (side: "home" | "away") => {
    const id = side === "home" ? m.homeParticipantId : m.awayParticipantId
    const p = side === "home" ? home : away
    const fallback = (side === "home" ? m.homeSource : m.awaySource)?.label ?? "TBC"
    if (!draft || !choices || !onReplace) return <span className="font-medium text-ink">{p ? participantLabel(p) : fallback}</span>
    return (
      <select
        aria-label={`${side === "home" ? "Home" : "Away"} Team`}
        value={id ?? ""}
        disabled={pending}
        onChange={(e) => e.target.value && onReplace(side, e.target.value)}
        className={cn("h-8 w-full min-w-44 max-w-64 rounded border border-ink/15 bg-white px-1.5 text-sm font-medium text-ink", side === "home" && "text-right")}
      >
        {!id && <option value="">{fallback}</option>}
        {choices.map((c) => (
          <option key={c} value={c}>
            {participantLabel(ws.participants.find((x) => x.id === c))}
          </option>
        ))}
      </select>
    )
  }
  return (
    <tr id={`match-${m.id}`} className={cn("border-b border-ink/6 last:border-0", level === "red" && "bg-destructive/[0.04]")}>
      <td className="w-24 px-3 py-1.5">
        <span className={cn("text-xs font-medium", mark.className)} title={report?.issues.map((i) => i.message).join(" ")}>
          <span aria-hidden="true">{mark.glyph} </span>
          {mark.word}
        </span>
      </td>
      <td className="w-20 px-2 py-1.5 text-xs text-ink-muted">{group?.name.replace("Group ", "") ?? ""}</td>
      <td className="w-20 px-2 py-1.5">
        {rounds && onMoveRound && !locked ? (
          <select aria-label="Round" value={m.roundNumber ?? ""} disabled={pending} onChange={(e) => onMoveRound(Number(e.target.value))} className="h-8 w-full rounded border border-ink/15 bg-white px-1 text-sm tabular-nums">
            {rounds.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-ink-muted tabular-nums">{m.roundNumber ?? ""}</span>
        )}
      </td>
      <td className="w-36 px-2 py-1.5">
        <input aria-label="Date" type="date" defaultValue={m.matchDate ?? ""} disabled={pending || locked} onBlur={(e) => e.target.value !== (m.matchDate ?? "") && onPatch({ match_date: e.target.value || null })} className="h-8 w-full rounded border border-ink/15 bg-white px-1.5 text-sm" />
      </td>
      <td className="w-24 px-2 py-1.5">
        <input aria-label="Kick-Off" type="time" defaultValue={m.kickoffTime ?? ""} disabled={pending || locked} onBlur={(e) => e.target.value !== (m.kickoffTime ?? "") && onPatch({ kickoff_time: e.target.value || null })} className="h-8 w-full rounded border border-ink/15 bg-white px-1.5 text-sm" />
      </td>
      <td className="min-w-48 px-2 py-1.5 text-right">{sideCell("home")}</td>
      <td className="w-10 px-1 py-1.5 text-center">
        <button
          type="button"
          aria-label="Swap Home and Away"
          title="Swap Home and Away"
          disabled={pending || locked || !m.homeParticipantId || !m.awayParticipantId}
          onClick={() => {
            const venue = away?.clubId ? ws.venues.find((v) => v.clubId === away.clubId && v.isDefaultHome) : undefined
            onPatch({ home_participant_id: m.awayParticipantId, away_participant_id: m.homeParticipantId, venue_id: venue?.id ?? null, venue_text: venue ? null : (away?.homeGround ?? null) })
          }}
          className="inline-flex size-7 items-center justify-center rounded text-ink-muted pointer-coarse:size-11 hover:bg-ink/[0.05] hover:text-ink disabled:opacity-30"
        >
          <ArrowLeftRight className="size-3.5" />
        </button>
      </td>
      <td className="min-w-48 px-2 py-1.5">{sideCell("away")}</td>
      <td className="w-52 px-2 py-1.5">
        {homeGrounds.length > 0 ? (
          <select aria-label="Venue" value={m.venueId ?? ""} disabled={pending || locked} onChange={(e) => onPatch({ venue_id: e.target.value || null, venue_text: null, pitch_id: null })} className="h-8 w-full rounded border border-ink/15 bg-white px-1.5 text-sm">
            <option value="">{m.venueText ?? "Not set"}</option>
            {homeGrounds.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        ) : (
          <input aria-label="Venue" defaultValue={m.venueText ?? ""} placeholder="Ground" disabled={pending || locked} onBlur={(e) => e.target.value !== (m.venueText ?? "") && onPatch({ venue_text: e.target.value || null, venue_id: null })} className="h-8 w-full rounded border border-ink/15 bg-white px-1.5 text-sm" />
        )}
      </td>
      <td className="w-32 px-2 py-1.5">
        {venuePitches.length > 0 ? (
          <select aria-label="Pitch" value={m.pitchId ?? ""} disabled={pending || locked} onChange={(e) => onPatch({ pitch_id: e.target.value || null })} className="h-8 w-full rounded border border-ink/15 bg-white px-1.5 text-sm">
            <option value="">Not set</option>
            {venuePitches.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-ink-muted">{m.venueId ? "No pitches" : ""}</span>
        )}
      </td>
      <td className="w-32 px-2 py-1.5 text-xs text-ink-muted">{MATCH_STATUS_WORD[m.status] ?? m.status}</td>
      <td className="w-10 px-1 py-1.5">
        {canDelete && m.status === "draft" && m.linkedFixtureIds.length === 0 && (
          <button type="button" aria-label="Remove this draft match" title="Remove this draft match" disabled={pending} onClick={onDelete} className="inline-flex size-7 items-center justify-center rounded text-ink-muted pointer-coarse:size-11 hover:bg-destructive/[0.06] hover:text-destructive-text disabled:opacity-30">
            <Trash2 className="size-3.5" />
          </button>
        )}
      </td>
    </tr>
  )
}

function AddMatchForm({
  roundNumber,
  groups,
  busy,
  label,
  pending,
  onAdd,
  onCancel,
}: {
  roundNumber: number
  groups: { id: string; name: string; members: string[] }[]
  /** Teams already playing in this round: offered, but said. */
  busy: Set<string>
  label: (id: string) => string
  pending: boolean
  onAdd: (input: { groupId: string; home: string; away: string }) => void
  onCancel: () => void
}) {
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "")
  const [home, setHome] = useState("")
  const [away, setAway] = useState("")
  const members = groups.find((g) => g.id === groupId)?.members ?? []
  const select = "mt-1 h-9 rounded-md border border-ink/15 bg-white px-2 text-sm"
  return (
    <div role="group" aria-label={`Add a Match to Round ${roundNumber}`} className="flex flex-wrap items-end gap-3 border-b border-ink/8 bg-chalk px-4 py-3">
      {groups.length > 1 && (
        <div>
          <label htmlFor={`add-group-${roundNumber}`} className="block text-xs font-medium text-ink-muted">
            Group
          </label>
          <select id={`add-group-${roundNumber}`} value={groupId} onChange={(e) => (setGroupId(e.target.value), setHome(""), setAway(""))} className={select}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {(["home", "away"] as const).map((side) => (
        <div key={side}>
          <label htmlFor={`add-${side}-${roundNumber}`} className="block text-xs font-medium text-ink-muted">
            {side === "home" ? "Home Team" : "Away Team"}
          </label>
          <select id={`add-${side}-${roundNumber}`} value={side === "home" ? home : away} onChange={(e) => (side === "home" ? setHome(e.target.value) : setAway(e.target.value))} className={select}>
            <option value="">Choose</option>
            {members
              .filter((id) => id !== (side === "home" ? away : home))
              .map((id) => (
                <option key={id} value={id}>
                  {label(id)}
                  {busy.has(id) ? " (already plays this round)" : ""}
                </option>
              ))}
          </select>
        </div>
      ))}
      <Button type="button" className="h-9" disabled={pending || !home || !away || home === away} onClick={() => onAdd({ groupId, home, away })}>
        Add to Round {roundNumber}
      </Button>
      <Button type="button" variant="ghost" className="h-9" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}
