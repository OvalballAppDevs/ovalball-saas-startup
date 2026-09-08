"use client"

import { useMemo, useState, useTransition } from "react"
import { ChevronRight, UserRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

import {
  clearPlayerPlacement,
  loadPlacementOptions,
  planMissingPlacementTeam,
  setPlayerPlacement,
  setPlayerPlannedPlacement,
  type PlacementOption,
  type PlacementVerdict,
} from "./actions"

/**
 * Player Handover Proposals -- the first UI consumer of
 * age_grade_rollover_player_proposals.
 *
 * Two things this deliberately does NOT do. It does not show a date of birth:
 * the server reads one to resolve an age grade and returns the DECISION, and
 * that decision is all this needs. And it does not decide anything itself --
 * every verdict shown here came back from the server, which classifies a squad
 * change against an age-grade change, runs the canonical movement resolver for
 * the latter, and refuses what it will not allow. The board displays authority
 * it does not hold.
 *
 * Rows are keyed by playerId, not proposal id. Deciding a team refreshes the
 * undecided player proposals, which deletes and regenerates them, so proposal
 * ids churn. The player is the stable handle.
 *
 * Nothing here moves a child. Every control records a placement DECISION, and
 * the memberships change when the handover is applied -- which is why a
 * placement can be changed back right up to that point.
 */

export type PlayerReviewState = "READY" | "NEEDS_ATTENTION" | "BLOCKED"

export interface PlayerProposalRow {
  proposalId: string
  playerId: string
  playerName: string
  /** As the team stands now -- where the player is today. */
  currentTeamName: string
  /** The operational squad they normally land in next season, e.g. "U16 B". */
  normalPlacementName: string | null
  /** What the club chose, when that differs from normal. */
  selectedPlacementName: string | null
  /** Their age grade next season. Supporting information, not the placement. */
  regulatoryAgeLabel: string | null
  reviewState: PlayerReviewState
  allocationStatus: string | null
  movementRequirement: string | null
  dispensationRequired: boolean
  reason: string | null
  placementApplied: boolean
  /** True when the club runs no team at the player's normal age grade. */
  normalTeamMissing: boolean
  /** The club has decided to run the team this player needs; it does not exist yet. */
  plannedTeamName: string | null
  /** A human chose this placement, so it can be put back to the normal one. */
  placementChosen: boolean
}

type Filter = "all" | "attention" | "approval" | "holding" | "ready"

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "attention", label: "Needs attention" },
  { key: "approval", label: "Awaiting approval" },
  { key: "holding", label: "Club holding" },
  { key: "ready", label: "Ready" },
]

/**
 * Domain states become rugby language. A club administrator should never meet
 * NORMAL_PLACEMENT or a canonical type id.
 */
function statusLabel(row: PlayerProposalRow): string {
  if (row.placementApplied) return "Placed"
  if (row.plannedTeamName) return "Team planned"
  if (row.allocationStatus === "DOB_REQUIRED") return "Date of birth needed"
  if (row.allocationStatus === "CLUB_HOLDING") return "Club holding"
  if (row.reviewState === "BLOCKED") return "Not permitted"
  if (row.dispensationRequired || row.movementRequirement === "external_approval_required") return "Governing approval"
  if (row.reviewState === "NEEDS_ATTENTION") return "Needs attention"
  return "Ready"
}

/**
 * Status is carried by the word. The tint is a third signal after the label and
 * the row's own explanation, never the only one.
 */
function statusTone(row: PlayerProposalRow): string {
  const label = statusLabel(row)
  if (label === "Ready" || label === "Placed" || label === "Team planned") return "bg-mint-100 text-forest-950"
  if (label === "Club holding") return "bg-ink/5 text-ink/80"
  if (label === "Not permitted") return "bg-destructive/10 text-destructive-text"
  return "bg-amber-50 text-amber-900"
}

function matchesFilter(row: PlayerProposalRow, filter: Filter): boolean {
  if (filter === "all") return true
  if (filter === "ready") return row.reviewState === "READY"
  if (filter === "holding") return row.allocationStatus === "CLUB_HOLDING"
  if (filter === "approval")
    return row.dispensationRequired || row.movementRequirement === "external_approval_required"
  return row.reviewState !== "READY"
}

export function PlayerHandoverProposals({ rows, toSeasonName }: { rows: PlayerProposalRow[]; toSeasonName: string | null }) {
  const [filter, setFilter] = useState<Filter>("all")
  const [query, setQuery] = useState("")
  // Anything needing a decision opens already expanded: a consequence a club
  // has to act on should not be behind a disclosure.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(rows.filter((r) => r.reviewState !== "READY").map((r) => r.playerId))
  )
  const [choosing, setChoosing] = useState<PlayerProposalRow | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const visible = useMemo(
    () =>
      rows.filter(
        (r) => matchesFilter(r, filter) && r.playerName.toLowerCase().includes(query.trim().toLowerCase())
      ),
    [rows, filter, query]
  )

  const attentionCount = rows.filter((r) => r.reviewState !== "READY").length

  function toggle(playerId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(playerId)) next.delete(playerId)
      else next.add(playerId)
      return next
    })
  }

  if (rows.length === 0) {
    return (
      <section className="rounded-lg border border-ink/10 bg-white p-5">
        <div className="flex items-center gap-2.5">
          <UserRound className="size-5 text-forest-800" aria-hidden="true" />
          <h2 className="font-display text-lg text-ink">Player handover</h2>
        </div>
        <p className="mt-2 text-sm text-ink-muted">
          No players are affected by this handover yet. Players appear here once their teams have proposals.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-ink/10 bg-white" aria-labelledby="player-handover-heading">
      <div className="border-b border-ink/10 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <UserRound className="size-5 text-forest-800" aria-hidden="true" />
          <h2 id="player-handover-heading" className="font-display text-lg text-ink">
            Player handover
          </h2>
        </div>
        <p className="mt-1.5 text-sm text-ink-muted">
          {rows.length} player{rows.length === 1 ? "" : "s"} reviewed for {toSeasonName ?? "next season"}.{" "}
          {attentionCount === 0
            ? "Every player has somewhere to go."
            : `${attentionCount} need${attentionCount === 1 ? "s" : ""} a decision.`}
        </p>

        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="player-search">
            Search players by name
          </label>
          <input
            id="player-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search players"
            className="h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-sm text-ink outline-none focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400 sm:w-56"
          />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter players by status">
            {FILTERS.map((f) => {
              const active = filter === f.key
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(f.key)}
                  className={`h-11 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none ${
                    active ? "bg-forest-800 text-white" : "bg-ink/5 text-ink/70 hover:text-ink"
                  }`}
                >
                  {f.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* One atomic announcement for whatever the server last decided. */}
      <p role="status" aria-atomic="true" className="sr-only">
        {message ?? ""}
      </p>

      {visible.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-muted">No players match that search.</p>
      ) : (
        <>
          {/* Desktop: a real table, because this really is tabular. */}
          <table className="hidden w-full border-collapse text-left md:table">
            <caption className="sr-only">
              Player handover proposals for {toSeasonName ?? "next season"}
            </caption>
            <thead>
              <tr className="border-b border-ink/10 text-xs tracking-[0.04em] text-ink/55 uppercase">
                <th scope="col" className="px-5 py-2.5 font-medium">
                  Player
                </th>
                <th scope="col" className="px-5 py-2.5 font-medium">
                  Current
                </th>
                <th scope="col" className="px-5 py-2.5 font-medium">
                  Normal next
                </th>
                <th scope="col" className="px-5 py-2.5 font-medium">
                  Selected
                </th>
                <th scope="col" className="px-5 py-2.5 font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const open = expanded.has(row.playerId)
                return (
                  <>
                    <tr key={row.playerId} className="border-b border-ink/8 align-middle">
                      <th scope="row" className="px-5 py-3 text-sm font-medium text-ink">
                        <button
                          type="button"
                          onClick={() => toggle(row.playerId)}
                          aria-expanded={open}
                          aria-controls={`player-detail-${row.playerId}`}
                          className="flex items-center gap-1.5 rounded text-left focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
                        >
                          <ChevronRight
                            className={`size-4 shrink-0 text-ink/40 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
                            aria-hidden="true"
                          />
                          {row.playerName}
                        </button>
                      </th>
                      <td className="px-5 py-3 text-sm text-ink/80">{row.currentTeamName}</td>
                      <td className="px-5 py-3 text-sm text-ink/80">
                        {row.normalPlacementName ?? <span className="text-ink/55">Not available</span>}
                      </td>
                      <td className="px-5 py-3 text-sm text-ink/80">
                        {row.selectedPlacementName ?? row.normalPlacementName ?? (
                          row.plannedTeamName ? (
                            <span>
                              {row.plannedTeamName}
                              <span className="ml-1.5 text-xs text-ink/55">planned</span>
                            </span>
                          ) : (
                            "—"
                          )
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${statusTone(row)}`}>
                          {statusLabel(row)}
                        </span>
                      </td>
                    </tr>
                    <tr id={`player-detail-${row.playerId}`} hidden={!open}>
                      <td colSpan={5} className="border-b border-ink/8 bg-chalk/60 px-5 py-4">
                        <PlayerDetail
                          row={row}
                          pending={pending}
                          onAnnounce={setMessage}
                          onChoose={() => setChoosing(row)}
                          startTransition={startTransition}
                        />
                      </td>
                    </tr>
                  </>
                )
              })}
            </tbody>
          </table>

          {/* Narrow widths: cards, not a squeezed table. */}
          <ul className="divide-y divide-ink/8 md:hidden">
            {visible.map((row) => (
              <li key={row.playerId} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-ink">{row.playerName}</p>
                  <span className={`inline-flex shrink-0 rounded-md px-2 py-1 text-xs font-medium ${statusTone(row)}`}>
                    {statusLabel(row)}
                  </span>
                </div>
                <div className="mt-2.5 text-sm text-ink/80">
                  <p>{row.currentTeamName}</p>
                  <p className="my-1 ml-1.5 border-l border-ink/20 pl-3 text-xs text-ink/50" aria-hidden="true">
                    &nbsp;
                  </p>
                  <p>
                    {row.selectedPlacementName ?? row.normalPlacementName ?? row.plannedTeamName ?? "No team yet"}
                    {!row.selectedPlacementName && !row.normalPlacementName && row.plannedTeamName && (
                      <span className="ml-1.5 text-xs text-ink/55">planned</span>
                    )}
                  </p>
                </div>
                <div className="mt-3">
                  <PlayerDetail
                    row={row}
                    pending={pending}
                    onAnnounce={setMessage}
                    onChoose={() => setChoosing(row)}
                    startTransition={startTransition}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {choosing && (
        <ChangePlacementDialog
          row={choosing}
          onClose={() => setChoosing(null)}
          onAnnounce={setMessage}
        />
      )}
    </section>
  )
}

function PlayerDetail({
  row,
  pending,
  onAnnounce,
  onChoose,
  startTransition,
}: {
  row: PlayerProposalRow
  pending: boolean
  onAnnounce: (m: string) => void
  onChoose: () => void
  startTransition: (cb: () => void) => void
}) {
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="space-y-3">
      {row.reason && <p className="max-w-2xl text-sm text-ink/80">{row.reason}</p>}

      {row.regulatoryAgeLabel && (
        <p className="text-sm text-ink/55">
          {row.regulatoryAgeLabel} is {row.playerName.split(" ")[0]}&apos;s age group for this season.
        </p>
      )}

      {row.plannedTeamName && !row.placementApplied && (
        <p className="text-sm text-ink/80">
          {row.plannedTeamName} will be created when this handover is applied, and {row.playerName.split(" ")[0]} joins it then.
        </p>
      )}

      {error && <p className="text-sm text-destructive-text">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {!row.placementApplied && (
          <Button type="button" variant="outline" className="h-11" onClick={onChoose} disabled={pending}>
            Change placement
          </Button>
        )}

        {row.normalTeamMissing && !row.plannedTeamName && !row.placementApplied && (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null)
                const res = await planMissingPlacementTeam(row.proposalId)
                if (!res.ok) setError(res.error)
                else onAnnounce("The club will run that team next season. It is created when the handover is applied.")
              })
            }
          >
            Run this team next season
          </Button>
        )}

        {row.placementChosen && !row.placementApplied && (
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null)
                const res = await clearPlayerPlacement(row.proposalId)
                if (!res.ok) setError(res.error)
                else onAnnounce(`${row.playerName} is back to their normal placement.`)
              })
            }
          >
            Undo this choice
          </Button>
        )}
      </div>
    </div>
  )
}

function ChangePlacementDialog({
  row,
  onClose,
  onAnnounce,
}: {
  row: PlayerProposalRow
  onClose: () => void
  onAnnounce: (m: string) => void
}) {
  const [options, setOptions] = useState<PlacementOption[] | null>(null)
  const [verdict, setVerdict] = useState<PlacementVerdict | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (options === null && !pending) {
    startTransition(async () => setOptions(await loadPlacementOptions(row.proposalId)))
  }

  // The server's own sentence, shown before anything is finalised.
  const verdictText = verdict?.reason ?? null
  const blocked = verdict?.reviewState === "BLOCKED"

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Change placement for {row.playerName}</DialogTitle>
          <DialogDescription>
            Teams are shown as they will be next season. Moving between squads at the same age grade is your
            decision; moving age grade is checked against the governing rules. Nothing moves until the handover is
            applied.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {options === null && <p className="text-sm text-ink-muted">Loading teams…</p>}
          {options?.map((o) => (
            <button
              key={o.teamId ?? `planned-${o.plannedId}`}
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null)
                  if (o.plannedId) {
                    const res = await setPlayerPlannedPlacement(row.proposalId, o.plannedId)
                    if (!res.ok) {
                      setError(res.error)
                      setVerdict(null)
                    } else {
                      setVerdict({
                        overrideKind: null,
                        movementRequirement: null,
                        reviewState: "READY",
                        reason: `${o.displayName} will be created when this handover is applied, and ${row.playerName.split(" ")[0]} joins it then.`,
                        dispensationRequired: false,
                      })
                      onAnnounce(`${o.displayName} will be created when this handover is applied.`)
                    }
                    return
                  }
                  if (!o.teamId) return
                  const res = await setPlayerPlacement(row.proposalId, o.teamId)
                  if (!res.ok) {
                    setError(res.error)
                    setVerdict(null)
                  } else {
                    setVerdict(res.verdict)
                    onAnnounce(res.verdict.reason ?? "Placement updated.")
                  }
                })
              }
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-ink/10 px-3.5 py-3 text-left text-sm hover:bg-chalk focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
            >
              <span className="text-ink">{o.displayName}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-ink/55">
                {o.isPlanned && <span>Created on apply</span>}
                {o.isNormal && <span>Normal placement</span>}
              </span>
            </button>
          ))}
        </div>

        {/* One atomic message. Not the whole chooser as a live region. */}
        <p
          role="status"
          aria-atomic="true"
          id={`verdict-${row.playerId}`}
          className={`text-sm ${blocked ? "text-destructive-text" : "text-ink/80"}`}
        >
          {verdictText}
        </p>

        {error && <p className="text-sm text-destructive-text">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" onClick={onClose}>
            Cancel
          </Button>
          {/* A blocked placement offers no misleading save. */}
          {!blocked && (
            <Button
              type="button"
              className="h-11"
              aria-disabled={verdict?.reviewState === "NEEDS_ATTENTION"}
              aria-describedby={`verdict-${row.playerId}`}
              onClick={onClose}
            >
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
