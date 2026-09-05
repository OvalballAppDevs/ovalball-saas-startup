"use client"

import { useState } from "react"
import { AlertTriangle, CheckCircle2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { YOUTH_AGE_GROUPS as AGE_GROUPS } from "@/lib/teams/age-groups"

import {
  confirmMixedBoundaryRollover,
  confirmRolloverTeamProposal,
  generateRolloverProposal,
  resolveRolloverGroupFlag,
  type RolloverProposalAction,
} from "./actions"

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
  decision: "pending" | "confirmed" | "folded" | "deferred"
  decidedAgeGroup: string | null
  girlsTeamCreated: boolean | null
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
        <p className="text-sm font-medium text-ink">Generate a rollover proposal</p>
        <p className="mt-1 text-sm text-ink/60">
          Reads every active {rugbyCode === "union" ? "Union" : "League"} youth team and proposes its next age
          group. Nothing changes until you confirm each proposal below.
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
            {generating ? "Generating…" : "Generate proposal"}
          </Button>
        </div>
        {toSeasonOptions.length === 0 && (
          <p className="mt-2 text-sm text-ink/45">
            {currentSeasonName
              ? `The season after ${currentSeasonName} hasn't been added yet — ask a Site Admin to create it under Seasons.`
              : "Ask a Site Admin to add next season under Seasons first."}
          </p>
        )}
        {generateError && <p className="mt-2 text-sm text-destructive">{generateError}</p>}
      </div>

      {batches.length === 0 && (
        <p className="mt-6 text-sm text-ink/45">No rollover has been generated yet.</p>
      )}

      {batches.map((batch) => (
        <div key={batch.id} className="mt-6 rounded-lg border border-ink/10 bg-white p-6">
          <p className="text-sm font-medium text-ink">
            {batch.fromSeasonName ?? "—"} &rarr; {batch.toSeasonName}
          </p>
          <p className="mt-0.5 text-xs text-ink/45">
            Generated {new Date(batch.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </p>

          {batch.groupFlags.length > 0 && (
            <div className="mt-4 space-y-2">
              {batch.groupFlags.map((f) => (
                <GroupFlagRow key={f.id} flag={f} />
              ))}
            </div>
          )}

          <ul className="mt-4 divide-y divide-ink/10">
            {batch.proposals.map((p) =>
              p.isMixedBoundary ? (
                <MixedBoundaryProposalRow key={p.id} proposal={p} />
              ) : (
                <TeamProposalRow key={p.id} proposal={p} />
              )
            )}
          </ul>
        </div>
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
    <div className={`flex items-start gap-2 rounded-lg px-3.5 py-2.5 text-sm ${resolved ? "bg-ink/5 text-ink/50" : "bg-amber-50 text-amber-900"}`}>
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

/**
 * The U11 Mixed -> U12 structural transition (20260903300000). This is
 * NEVER a plain Confirm button, and never defaults the Girls-team
 * question to Yes or No -- confirm_mixed_boundary_rollover() itself
 * refuses a null answer, and this component mirrors that by disabling
 * "Confirm changes" until a radio option is actually picked.
 */
function MixedBoundaryProposalRow({ proposal }: { proposal: RolloverTeamProposalRow }) {
  const [decision, setDecision] = useState(proposal.decision)
  const [girlsTeamCreated, setGirlsTeamCreated] = useState(proposal.girlsTeamCreated)
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
    setGirlsTeamCreated(createGirlsTeam === "yes")
    setReviewing(false)
  }

  if (decision !== "pending") {
    return (
      <li className="flex flex-wrap items-center justify-between gap-3 py-3">
        <span className="text-sm font-medium text-ink">{proposal.teamDisplayName}</span>
        <span className="text-sm text-forest-800">
          {proposal.currentAgeGroup} Mixed &rarr; {proposal.proposedAgeGroup} Boys
          {girlsTeamCreated ? ` · new ${proposal.proposedAgeGroup} Girls team created` : " · no Girls team created"}
        </span>
      </li>
    )
  }

  if (!reviewing) {
    return (
      <li className="flex flex-wrap items-center justify-between gap-3 py-3">
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
    <li className="py-3">
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
              <p className="text-xs text-ink/50">Current</p>
              <p className="mt-0.5 text-sm font-medium text-ink">
                {proposal.currentAgeGroup} Mixed{proposal.teamSquadDesignation ? ` ${proposal.teamSquadDesignation}` : ""}
              </p>
            </div>
            <div>
              <p className="text-xs text-ink/50">Proposed continuation</p>
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
          <legend className="p-0 text-sm font-medium text-ink">Create a new {proposal.proposedAgeGroup} Girls team for next season?</legend>
          <p className="mt-1 text-xs text-ink/55">
            This creates a separate team with its own history. It will not inherit any of {proposal.teamDisplayName}&apos;s past
            fixtures or results.
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
              Yes — create a new {proposal.proposedAgeGroup} Girls team
            </label>
            <label className="flex items-center gap-2.5 text-sm text-ink">
              <input
                type="radio"
                name={`girls-${proposal.id}`}
                checked={createGirlsTeam === "no"}
                onChange={() => setCreateGirlsTeam("no")}
                className="size-4 accent-pitch-600"
              />
              No — do not create a Girls team
            </label>
          </div>
          {createGirlsTeam === "yes" && (
            <input
              value={girlsSquad}
              onChange={(e) => setGirlsSquad(e.target.value)}
              placeholder="Squad (optional, e.g. A)"
              aria-label={`Squad designation for the new ${proposal.proposedAgeGroup} Girls team`}
              className="mt-2.5 h-9 w-48 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
            />
          )}
        </fieldset>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <div className="mt-4 flex items-center gap-2">
          <Button
            type="button"
            className="h-9"
            disabled={createGirlsTeam === null || working}
            aria-describedby={createGirlsTeam === null ? `girls-choice-hint-${proposal.id}` : undefined}
            onClick={handleConfirm}
          >
            {working ? "Confirming…" : "Confirm changes"}
          </Button>
          <Button type="button" variant="ghost" className="h-9" disabled={working} onClick={() => setReviewing(false)}>
            Cancel
          </Button>
          {createGirlsTeam === null && (
            <p id={`girls-choice-hint-${proposal.id}`} className="text-xs text-ink/45">
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
    setDecision(action === "confirm" || action === "adjust" ? "confirmed" : action === "fold" ? "folded" : "deferred")
    setDecidedAgeGroup(ageGroup)
    setAdjusting(false)
    setFolding(false)
  }

  if (decision !== "pending") {
    const label =
      decision === "confirmed"
        ? `Confirmed → ${decidedAgeGroup}`
        : decision === "folded"
          ? "Folded"
          : "Deferred"
    return (
      <li className="flex items-center justify-between gap-3 py-3">
        <div className="text-sm">
          <span className="font-medium text-ink">{proposal.teamDisplayName}</span>
          <span className="ml-2 text-ink/50">{proposal.currentAgeGroup}</span>
        </div>
        <span className="text-sm text-forest-800">{label}</span>
      </li>
    )
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <span className="font-medium text-ink">{proposal.teamDisplayName}</span>
          <span className="ml-2 text-ink/50">
            {proposal.currentAgeGroup} &rarr;{" "}
            {proposal.requiresManualChoice ? (
              <span className="font-medium text-amber-700">requires explicit choice</span>
            ) : (
              proposal.proposedAgeGroup
            )}
          </span>
        </div>
        {!adjusting && !folding && (
          <div className="flex flex-wrap items-center gap-2">
            {!proposal.requiresManualChoice && (
              <Button
                type="button"
                className="h-8"
                disabled={working !== null}
                onClick={() => act("confirm", proposal.proposedAgeGroup, null)}
              >
                {working === "confirm" ? "Confirming…" : "Confirm"}
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
          <Button
            type="button"
            className="h-9"
            disabled={working !== null}
            onClick={() => act("adjust", chosenAgeGroup, null, chosenSquad.trim() || null)}
          >
            {working === "adjust" ? "Confirming…" : "Confirm this destination"}
          </Button>
          <Button type="button" variant="outline" className="h-9" onClick={() => setAdjusting(false)}>
            Cancel
          </Button>
        </div>
      )}

      {folding && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-ink/5 px-3.5 py-2.5">
          <input
            value={foldReason}
            onChange={(e) => setFoldReason(e.target.value)}
            placeholder="Reason for folding"
            aria-label={`Reason for folding ${proposal.teamDisplayName}`}
            className="h-9 flex-1 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
          />
          <Button
            type="button"
            variant="destructive"
            className="h-9"
            disabled={working !== null || !foldReason.trim()}
            onClick={() => act("fold", null, foldReason)}
          >
            {working === "fold" ? "Folding…" : "Confirm fold"}
          </Button>
          <Button type="button" variant="outline" className="h-9" onClick={() => setFolding(false)}>
            Cancel
          </Button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </li>
  )
}
