"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, CheckCircle2, Undo2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { YOUTH_AGE_GROUPS as AGE_GROUPS } from "@/lib/teams/age-groups"

import {
  confirmMixedBoundaryRollover,
  confirmRolloverTeamProposal,
  generateRolloverProposal,
  resolveRolloverGroupFlag,
  undoRolloverTeamDecision,
  type RolloverProposalAction,
} from "./actions"

/**
 * The Teams section of the Season Handover board.
 *
 * Every control here records a DECISION. None of them changes a team: since
 * the staged commit model, a club's teams are exactly what they were until the
 * handover is applied, which is what makes "Confirmed" mean "decided" rather
 * than "already done" -- and what makes Undo possible at all.
 *
 * Squads are grouped under their age grade because that is how a club thinks
 * about them, and stated to be independently decidable because they are: a
 * club may progress the primary and fold the B squad in the same handover.
 */

export interface RolloverTeamProposalRow {
  id: string
  teamId: string
  teamDisplayName: string
  teamGender: "boys" | "girls" | "mixed" | "mens" | "womens" | null
  teamSquadDesignation: string | null
  currentAgeGroup: string
  proposedAgeGroup: string | null
  requiresManualChoice: boolean
  isMixedBoundary: boolean
  decision: "pending" | "confirmed" | "folded" | "deferred" | "graduated"
  decidedAgeGroup: string | null
  girlsTeamCreated: boolean | null
  createGirlsTeam: boolean | null
  foldReason: string | null
  /** Once the handover has run, its decisions are history and cannot be changed here. */
  applied: boolean
}

export interface RolloverGroupFlagRow {
  id: string
  displayTag: string
  reason: string
  resolved: boolean
}

export interface RolloverBatch {
  id: string
  fromSeasonName: string | null
  toSeasonName: string
  createdAt: string
  isApplied: boolean
  proposals: RolloverTeamProposalRow[]
  groupFlags: RolloverGroupFlagRow[]
}

export interface SeasonOption {
  id: string
  name: string
}

export function RolloverReview({
  clubId,
  rugbyCode,
  toSeasonOptions,
  batches,
  currentSeasonName,
}: {
  clubId: string
  rugbyCode: "union" | "league"
  toSeasonOptions: SeasonOption[]
  batches: RolloverBatch[]
  /** The canonical current season (same `seasons` table Calendar reads) -- lets the empty state name it explicitly rather than reading as if no season exists anywhere. */
  currentSeasonName: string | null
}) {
  const [toSeasonId, setToSeasonId] = useState(toSeasonOptions[0]?.id ?? "")
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)

  async function handleGenerate() {
    if (!toSeasonId) return
    setGenerating(true)
    setGenerateError(null)
    const result = await generateRolloverProposal(clubId, rugbyCode, toSeasonId)
    setGenerating(false)
    if (!result.ok) setGenerateError(result.error)
  }

  return (
    <div>
      <div className="rounded-lg border border-ink/10 bg-white p-6">
        <p className="text-sm font-medium text-ink">Prepare a handover</p>
        <p className="mt-1 max-w-xl text-sm text-ink/60">
          Reads every active {rugbyCode === "union" ? "Union" : "League"} youth team and proposes what it becomes next
          season. Preparing changes nothing, and neither does deciding — your club runs exactly what it runs today until
          the handover is applied.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select
            value={toSeasonId}
            onChange={(e) => setToSeasonId(e.target.value)}
            className="h-11 rounded-lg border border-ink/15 bg-white px-3.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
            aria-label="Target season"
          >
            {toSeasonOptions.length === 0 && <option value="">No upcoming season configured yet</option>}
            {toSeasonOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Button type="button" className="h-10" disabled={generating || !toSeasonId} onClick={handleGenerate}>
            {generating ? "Preparing…" : "Prepare handover"}
          </Button>
        </div>
        {toSeasonOptions.length === 0 && (
          <p className="mt-2 text-sm text-ink-muted">
            {currentSeasonName
              ? `The season after ${currentSeasonName} hasn't been added yet — ask a Site Admin to create it under Seasons.`
              : "Ask a Site Admin to add next season under Seasons first."}
          </p>
        )}
        {generateError && <p className="mt-2 text-sm text-destructive-text">{generateError}</p>}
      </div>

      {batches.length === 0 && <p className="mt-6 text-sm text-ink-muted">No handover has been prepared yet.</p>}

      {batches.map((batch) => (
        <BatchCard key={batch.id} batch={batch} />
      ))}
    </div>
  )
}

function BatchCard({ batch }: { batch: RolloverBatch }) {
  const [bulkWorking, setBulkWorking] = useState(false)
  const [bulkResult, setBulkResult] = useState<string | null>(null)

  // Grouped by the age grade they are at TODAY, which is how a club reads its
  // own structure. Squads sit under their primary and are decided separately.
  const groups = useMemo(() => {
    const byAge = new Map<string, RolloverTeamProposalRow[]>()
    for (const p of batch.proposals) {
      const list = byAge.get(p.currentAgeGroup) ?? []
      list.push(p)
      byAge.set(p.currentAgeGroup, list)
    }
    return [...byAge.entries()]
      .map(([age, rows]) => ({
        age,
        rows: rows.sort((a, b) => (a.teamSquadDesignation ?? "").localeCompare(b.teamSquadDesignation ?? "")),
      }))
      .sort((a, b) => a.age.localeCompare(b.age, undefined, { numeric: true }))
  }, [batch.proposals])

  // Bulk confirm records decisions and nothing else. Anything exceptional --
  // a Mixed split, a cohort with no automatic successor -- is deliberately
  // left out: those are the cases a human is here to answer.
  const bulkCandidates = batch.proposals.filter(
    (p) => p.decision === "pending" && !p.requiresManualChoice && !p.isMixedBoundary && p.proposedAgeGroup
  )

  async function handleBulkConfirm() {
    setBulkWorking(true)
    setBulkResult(null)
    let done = 0
    const failures: string[] = []
    for (const p of bulkCandidates) {
      const result = await confirmRolloverTeamProposal(p.id, "confirm", p.proposedAgeGroup, null, null)
      if (result.ok) done += 1
      else failures.push(`${p.teamDisplayName}: ${result.error}`)
    }
    setBulkWorking(false)
    setBulkResult(
      failures.length === 0
        ? `${done} team${done === 1 ? "" : "s"} recorded. Nothing has changed yet — apply the handover to carry these out.`
        : `${done} recorded, ${failures.length} could not be: ${failures[0]}`
    )
  }

  return (
    <div className="mt-6 rounded-lg border border-ink/10 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink/8 px-5 py-4">
        <div>
          <p className="text-sm font-medium text-ink">
            {batch.fromSeasonName ?? "—"} &rarr; {batch.toSeasonName}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Prepared{" "}
            {new Date(batch.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            {batch.isApplied && " · applied"}
          </p>
        </div>
        {!batch.isApplied && bulkCandidates.length > 0 && (
          <Button type="button" variant="outline" className="h-9" disabled={bulkWorking} onClick={handleBulkConfirm}>
            {bulkWorking ? "Recording…" : `Confirm ${bulkCandidates.length} straightforward team${bulkCandidates.length === 1 ? "" : "s"}`}
          </Button>
        )}
      </div>

      {bulkResult && (
        <p role="status" aria-atomic="true" className="border-b border-ink/8 bg-mint-100/60 px-5 py-3 text-sm text-forest-950">
          {bulkResult}
        </p>
      )}

      {batch.groupFlags.length > 0 && (
        <div className="space-y-2 border-b border-ink/8 px-5 py-4">
          {batch.groupFlags.map((f) => (
            <GroupFlagRow key={f.id} flag={f} />
          ))}
        </div>
      )}

      {groups.map((group) => (
        <section key={group.age} aria-label={`${group.age} teams`} className="border-b border-ink/8 last:border-b-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 bg-ink/[0.02] px-5 py-2.5">
            <h3 className="text-sm font-medium text-ink">{group.age}</h3>
            {group.rows.length > 1 && (
              <p className="text-xs text-ink/55">
                Each squad is decided on its own — confirming {group.age} does not decide{" "}
                {group.rows
                  .filter((r) => r.teamSquadDesignation)
                  .map((r) => `${group.age} ${r.teamSquadDesignation}`)
                  .join(" or ")}
                .
              </p>
            )}
          </div>
          <ul className="divide-y divide-ink/8">
            {group.rows.map((p) =>
              p.isMixedBoundary ? (
                <MixedBoundaryProposalRow key={p.id} proposal={p} />
              ) : (
                <TeamProposalRow key={p.id} proposal={p} />
              )
            )}
          </ul>
        </section>
      ))}
    </div>
  )
}

function GroupFlagRow({ flag }: { flag: RolloverGroupFlagRow }) {
  const [resolved, setResolved] = useState(flag.resolved)
  const [working, setWorking] = useState(false)

  async function handleResolve() {
    setWorking(true)
    const result = await resolveRolloverGroupFlag(flag.id)
    setWorking(false)
    if (result.ok) setResolved(true)
  }

  return (
    <div className={`flex items-start gap-2 rounded-lg px-3.5 py-2.5 text-sm ${resolved ? "bg-ink/5 text-ink-muted" : "bg-amber-50 text-amber-900"}`}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="flex-1">
        <p className="font-medium">{flag.displayTag} Mini-Rugby Group requires reconfiguration</p>
        <p className="mt-0.5">{flag.reason}</p>
      </div>
      {!resolved && (
        <Button type="button" variant="outline" className="h-8 shrink-0" disabled={working} onClick={handleResolve}>
          {working ? "Marking…" : "Mark resolved"}
        </Button>
      )}
      {resolved && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-forest-700" />}
    </div>
  )
}

/** Undo is possible precisely because deciding changed nothing. */
function UndoDecision({ proposalId, onDone }: { proposalId: string; onDone: () => void }) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <span className="flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        className="h-8"
        disabled={working}
        onClick={async () => {
          setWorking(true)
          setError(null)
          const result = await undoRolloverTeamDecision(proposalId)
          setWorking(false)
          if (result.ok) onDone()
          else setError(result.error)
        }}
      >
        <Undo2 className="size-3.5" />
        {working ? "Undoing…" : "Undo"}
      </Button>
      {error && <span className="text-xs text-destructive-text">{error}</span>}
    </span>
  )
}

/**
 * The U11 Mixed -> U12 structural transition. Never a plain Confirm button and
 * never a defaulted Girls-team answer: the server refuses a null answer, and
 * this mirrors that by leaving the control unusable until a radio is picked.
 */
function MixedBoundaryProposalRow({ proposal }: { proposal: RolloverTeamProposalRow }) {
  const [decision, setDecision] = useState(proposal.decision)
  const [girlsPlanned, setGirlsPlanned] = useState(proposal.createGirlsTeam)
  const [reviewing, setReviewing] = useState(false)
  const [createGirlsTeam, setCreateGirlsTeam] = useState<"yes" | "no" | null>(null)
  const [girlsSquad, setGirlsSquad] = useState("")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    if (createGirlsTeam === null) return
    setWorking(true)
    setError(null)
    const result = await confirmMixedBoundaryRollover(proposal.id, createGirlsTeam === "yes", null, girlsSquad.trim() || null)
    setWorking(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setDecision("confirmed")
    setGirlsPlanned(createGirlsTeam === "yes")
    setReviewing(false)
  }

  if (decision !== "pending") {
    return (
      <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <span className="text-sm font-medium text-ink">{proposal.teamDisplayName}</span>
        <span className="flex flex-wrap items-center gap-3 text-sm text-forest-800">
          <span>
            {proposal.currentAgeGroup} Mixed &rarr; {proposal.proposedAgeGroup} Boys
            {girlsPlanned
              ? proposal.applied
                ? ` · ${proposal.proposedAgeGroup} Girls created`
                : ` · ${proposal.proposedAgeGroup} Girls will be created`
              : " · no Girls team"}
          </span>
          {!proposal.applied && <UndoDecision proposalId={proposal.id} onDone={() => setDecision("pending")} />}
        </span>
      </li>
    )
  }

  if (!reviewing) {
    return (
      <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <div className="text-sm">
          <span className="font-medium text-ink">{proposal.teamDisplayName}</span>
          <span className="ml-2 font-medium text-amber-700">Mixed &rarr; {proposal.proposedAgeGroup} structural transition</span>
        </div>
        <Button type="button" className="h-8" onClick={() => setReviewing(true)}>
          Review transition
        </Button>
      </li>
    )
  }

  return (
    <li className="px-5 py-3.5">
      <div className="rounded-lg border border-amber-200/80 bg-amber-50/70 p-5">
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="size-3.5 text-amber-800" />
          <p className="text-xs font-medium tracking-[0.06em] text-amber-900 uppercase">
            Mixed &rarr; {proposal.proposedAgeGroup} structural transition
          </p>
        </div>

        <div className="mt-3.5 rounded-lg border border-ink/10 bg-white p-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-ink-muted">Current</p>
              <p className="mt-0.5 text-sm font-medium text-ink">
                {proposal.currentAgeGroup} Mixed{proposal.teamSquadDesignation ? ` ${proposal.teamSquadDesignation}` : ""}
              </p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Continues next season as</p>
              <p className="mt-0.5 text-sm font-medium text-ink">
                {proposal.proposedAgeGroup} Boys{proposal.teamSquadDesignation ? ` ${proposal.teamSquadDesignation}` : ""}
              </p>
            </div>
          </div>
          <ul className="mt-3.5 space-y-1 border-t border-ink/10 pt-3">
            {["Same team", "Previous history retained", "Existing team ID retained"].map((fact) => (
              <li key={fact} className="flex items-center gap-1.5 text-xs text-forest-800">
                <CheckCircle2 className="size-3.5 shrink-0" />
                {fact}
              </li>
            ))}
          </ul>
        </div>

        <fieldset className="mt-5 m-0 border-0 p-0">
          <legend className="p-0 text-sm font-medium text-ink">
            Should the club run a {proposal.proposedAgeGroup} Girls team next season?
          </legend>
          <p className="mt-1 text-xs text-ink-muted">
            A separate team with its own history. It is created when this handover is applied, not now, and will not inherit any
            of {proposal.teamDisplayName}&apos;s past fixtures or results.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <label className="flex items-center gap-2.5 text-sm text-ink">
              <input
                type="radio"
                name={`girls-${proposal.id}`}
                checked={createGirlsTeam === "yes"}
                onChange={() => setCreateGirlsTeam("yes")}
                className="size-4 accent-pitch-600"
              />
              Yes — run a {proposal.proposedAgeGroup} Girls team
            </label>
            <label className="flex items-center gap-2.5 text-sm text-ink">
              <input
                type="radio"
                name={`girls-${proposal.id}`}
                checked={createGirlsTeam === "no"}
                onChange={() => setCreateGirlsTeam("no")}
                className="size-4 accent-pitch-600"
              />
              No — do not run a Girls team
            </label>
          </div>
          {createGirlsTeam === "yes" && (
            <input
              value={girlsSquad}
              onChange={(e) => setGirlsSquad(e.target.value)}
              placeholder="Squad (optional, e.g. B)"
              aria-label={`Squad designation for the new ${proposal.proposedAgeGroup} Girls team`}
              className="mt-2.5 h-9 w-48 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
            />
          )}
        </fieldset>

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive-text">
            {error}
          </p>
        )}

        <div className="mt-4 flex items-center gap-2">
          <Button
            type="button"
            className="h-9"
            aria-disabled={createGirlsTeam === null || working}
            aria-describedby={createGirlsTeam === null ? `girls-choice-hint-${proposal.id}` : undefined}
            onClick={() => {
              if (createGirlsTeam === null || working) return
              void handleConfirm()
            }}
          >
            {working ? "Recording…" : "Record this decision"}
          </Button>
          <Button type="button" variant="ghost" className="h-9" disabled={working} onClick={() => setReviewing(false)}>
            Cancel
          </Button>
          {createGirlsTeam === null && (
            <p id={`girls-choice-hint-${proposal.id}`} className="text-xs text-ink-muted">
              Choose Yes or No above to continue.
            </p>
          )}
        </div>
      </div>
    </li>
  )
}

function TeamProposalRow({ proposal }: { proposal: RolloverTeamProposalRow }) {
  const [decision, setDecision] = useState(proposal.decision)
  const [decidedAgeGroup, setDecidedAgeGroup] = useState(proposal.decidedAgeGroup)
  const [adjusting, setAdjusting] = useState(false)
  const [folding, setFolding] = useState(false)
  const [chosenAgeGroup, setChosenAgeGroup] = useState(proposal.proposedAgeGroup ?? "U7")
  const [chosenSquad, setChosenSquad] = useState("")
  const [foldReason, setFoldReason] = useState("")
  const [working, setWorking] = useState<RolloverProposalAction | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function act(action: RolloverProposalAction, ageGroup: string | null, foldReasonInput: string | null, squadDesignation: string | null = null) {
    setWorking(action)
    setError(null)
    const result = await confirmRolloverTeamProposal(proposal.id, action, ageGroup, squadDesignation, foldReasonInput)
    setWorking(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setDecision(
      action === "confirm" || action === "adjust"
        ? "confirmed"
        : action === "fold"
          ? "folded"
          : action === "graduate"
            ? "graduated"
            : "deferred"
    )
    setDecidedAgeGroup(ageGroup)
    setAdjusting(false)
    setFolding(false)
  }

  if (decision !== "pending") {
    const label =
      decision === "confirmed"
        ? proposal.applied
          ? `Became ${decidedAgeGroup}`
          : `Decided: becomes ${decidedAgeGroup}`
        : decision === "folded"
          ? proposal.applied
            ? "Not continuing"
            : "Decided: will not continue"
          : decision === "graduated"
            ? proposal.applied
              ? "Youth pathway complete"
              : "Decided: youth pathway complete"
            : "Deferred — still needs a decision"
    return (
      <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <div className="text-sm">
          <span className="font-medium text-ink">{proposal.teamDisplayName}</span>
          <span className="ml-2 text-ink-muted">{proposal.currentAgeGroup}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`text-sm ${decision === "deferred" ? "text-amber-700" : "text-forest-800"}`}>{label}</span>
          {!proposal.applied && <UndoDecision proposalId={proposal.id} onDone={() => setDecision("pending")} />}
        </div>
        {error && (
          <p role="alert" className="w-full text-sm text-destructive-text">
            {error}
          </p>
        )}
      </li>
    )
  }

  const noSuccessor = proposal.requiresManualChoice && !proposal.proposedAgeGroup

  return (
    <li className="px-5 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <span className="font-medium text-ink">{proposal.teamDisplayName}</span>
          <span className="ml-2 text-ink-muted">
            {proposal.currentAgeGroup} &rarr;{" "}
            {noSuccessor ? (
              <span className="font-medium text-amber-700">no automatic successor</span>
            ) : proposal.requiresManualChoice ? (
              <span className="font-medium text-amber-700">needs an explicit choice</span>
            ) : (
              proposal.proposedAgeGroup
            )}
          </span>
        </div>
        {!adjusting && !folding && (
          <div className="flex flex-wrap items-center gap-2">
            {!proposal.requiresManualChoice && (
              <Button type="button" className="h-8" disabled={working !== null} onClick={() => act("confirm", proposal.proposedAgeGroup, null)}>
                {working === "confirm" ? "Recording…" : "Confirm"}
              </Button>
            )}
            {noSuccessor && (
              <Button type="button" className="h-8" disabled={working !== null} onClick={() => act("graduate", null, null)}>
                {working === "graduate" ? "Recording…" : "Youth pathway complete"}
              </Button>
            )}
            <Button type="button" variant="outline" className="h-8" disabled={working !== null} onClick={() => setAdjusting(true)}>
              {proposal.requiresManualChoice ? "Choose destination" : "Adjust"}
            </Button>
            <Button type="button" variant="outline" className="h-8" disabled={working !== null} onClick={() => setFolding(true)}>
              Fold
            </Button>
            <Button type="button" variant="outline" className="h-8" disabled={working !== null} onClick={() => act("defer", null, null)}>
              {working === "defer" ? "Deferring…" : "Defer"}
            </Button>
          </div>
        )}
      </div>

      {noSuccessor && !adjusting && !folding && (
        <p className="mt-1.5 max-w-2xl text-sm text-ink/55">
          There is no established next age grade for this cohort in this code, so Ovalball will not invent one. Either the youth
          pathway ends here — its players move to the club&apos;s holding list, with no senior team assigned automatically — or
          you choose a destination yourself.
        </p>
      )}

      {adjusting && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-ink/5 px-3.5 py-2.5">
          <select
            value={chosenAgeGroup}
            onChange={(e) => setChosenAgeGroup(e.target.value)}
            className="h-9 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
            aria-label={`Destination age group for ${proposal.teamDisplayName}`}
          >
            {AGE_GROUPS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <input
            value={chosenSquad}
            onChange={(e) => setChosenSquad(e.target.value)}
            placeholder="Squad (optional, e.g. B)"
            className="h-9 w-40 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
            aria-label={`Squad designation for ${proposal.teamDisplayName}`}
          />
          <Button type="button" className="h-9" disabled={working !== null} onClick={() => act("adjust", chosenAgeGroup, null, chosenSquad.trim() || null)}>
            {working === "adjust" ? "Recording…" : "Record this destination"}
          </Button>
          <Button type="button" variant="outline" className="h-9" onClick={() => setAdjusting(false)}>
            Cancel
          </Button>
        </div>
      )}

      {folding && (
        <div className="mt-2 rounded-lg bg-ink/5 px-3.5 py-2.5">
          <p className="text-sm text-ink/70">
            {proposal.teamDisplayName} will not continue next season. Its fixtures, results and history stay available, and its
            players appear in Players needing a new place. Nothing happens until the handover is applied.
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <input
              value={foldReason}
              onChange={(e) => setFoldReason(e.target.value)}
              placeholder="Reason for folding"
              aria-label={`Reason for folding ${proposal.teamDisplayName}`}
              className="h-9 min-w-56 flex-1 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
            />
            <Button
              type="button"
              variant="destructive"
              className="h-9"
              aria-disabled={working !== null || !foldReason.trim()}
              onClick={() => {
                if (working !== null || !foldReason.trim()) return
                void act("fold", null, foldReason)
              }}
            >
              {working === "fold" ? "Recording…" : `Fold ${proposal.teamDisplayName}`}
            </Button>
            <Button type="button" variant="outline" className="h-9" onClick={() => setFolding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive-text">
          {error}
        </p>
      )}
    </li>
  )
}
