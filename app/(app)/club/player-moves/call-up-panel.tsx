"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowRightLeft, ShieldAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"

import { decideCallUp, requestCallUp } from "./actions"

export interface CallUpTeamOption {
  id: string
  displayName: string
  category: string
  ageGroup: string | null
  gender: string | null
}

export interface CallUpFixtureOption {
  id: string
  owningTeamId: string
  kickoffDate: string
  opponentLabel: string
}

export interface CallUpPlayerOption {
  playerId: string
  playerName: string
  currentTeamId: string
  currentTeamName: string
  category: string
  ageGroup: string | null
  gender: string | null
}

export interface CallUpRow {
  id: string
  playerName: string
  sourceTeamId: string
  sourceTeamName: string
  targetTeamName: string
  fixtureLabel: string
  eligibilityRuleReference: string
  status: "awaiting_eligibility" | "requested" | "approved" | "rejected" | "revoked"
  /** True when the viewer manages the SOURCE team (or the club) -- only they may decide. Section 24: target staff can request, never self-approve. */
  canDecide: boolean
}

const STATUS_LABEL: Record<CallUpRow["status"], string> = {
  awaiting_eligibility: "Waiting on age-grade approval",
  requested: "Awaiting source-team decision",
  approved: "Approved",
  rejected: "Rejected",
  revoked: "Revoked",
}

/**
 * RESUME SEASON HANDOVER / PLAYER REQUESTS Sections 1-5: the player
 * picker shows only players who are ordinarily eligible for THIS
 * target team's own canonical age group by default. A player from a
 * different age group sits behind an explicit "need a player from
 * another age group?" disclosure, and picking one previews the real,
 * computed eligibility requirement (never a manual "is this player
 * under 17" checkbox) before the request is even submitted.
 */
export function CallUpPanel({
  teams,
  fixtures,
  players,
  rows,
}: {
  teams: CallUpTeamOption[]
  fixtures: CallUpFixtureOption[]
  players: CallUpPlayerOption[]
  rows: CallUpRow[]
}) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-6">
      <div className="flex items-center gap-2">
        <ArrowRightLeft className="size-4 text-forest-800" />
        <h2 className="font-display text-lg text-ink">Fixture call-ups</h2>
      </div>
      <p className="mt-1.5 text-sm text-ink/55">
        Borrow a player from another team at this club for one fixture. The source team must approve before the player is eligible to play.
      </p>

      <CallUpRequestForm teams={teams} fixtures={fixtures} players={players} />

      <div className="mt-6 space-y-3 border-t border-ink/10 pt-4">
        {rows.length === 0 ? (
          <p className="text-sm text-ink/50">No call-ups yet.</p>
        ) : (
          rows.map((row) => <CallUpRowItem key={row.id} row={row} />)
        )}
      </div>
    </div>
  )
}

function sameAgeGroup(a: { category: string; ageGroup: string | null; gender: string | null }, b: { category: string; ageGroup: string | null; gender: string | null }) {
  return a.category === b.category && a.ageGroup === b.ageGroup && (a.gender ?? "") === (b.gender ?? "")
}

function CallUpRequestForm({ teams, fixtures, players }: { teams: CallUpTeamOption[]; fixtures: CallUpFixtureOption[]; players: CallUpPlayerOption[] }) {
  const [targetTeamId, setTargetTeamId] = useState(teams[0]?.id ?? "")
  const [fixtureId, setFixtureId] = useState("")
  const [playerKey, setPlayerKey] = useState("")
  const [showOtherAges, setShowOtherAges] = useState(false)
  const [eligibility, setEligibility] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [previewResult, setPreviewResult] = useState<{
    key: string
    data: { requirement: string; reason: string; governingBody: string | null; restrictions: string | null }
  } | null>(null)

  const targetTeam = teams.find((t) => t.id === targetTeamId) ?? null
  const teamFixtures = useMemo(() => fixtures.filter((f) => f.owningTeamId === targetTeamId), [fixtures, targetTeamId])
  const otherClubPlayers = useMemo(() => players.filter((p) => p.currentTeamId !== targetTeamId), [players, targetTeamId])
  const sameAgePlayers = useMemo(
    () => (targetTeam ? otherClubPlayers.filter((p) => sameAgeGroup(p, targetTeam)) : []),
    [otherClubPlayers, targetTeam]
  )
  const otherAgePlayers = useMemo(
    () => (targetTeam ? otherClubPlayers.filter((p) => !sameAgeGroup(p, targetTeam)) : []),
    [otherClubPlayers, targetTeam]
  )
  const selectedPlayer = useMemo(() => otherClubPlayers.find((p) => `${p.playerId}:${p.currentTeamId}` === playerKey) ?? null, [otherClubPlayers, playerKey])

  // Keying the preview to the exact (player, target team) pair lets the
  // preview and its loading state be DERIVED during render instead of
  // synced via effect -- selecting a different player/team naturally
  // shows nothing (key mismatch) until the matching fetch resolves,
  // with no separate reset/loading state to keep in sync by hand.
  const previewKey =
    selectedPlayer && targetTeamId && !sameAgeGroup(selectedPlayer, targetTeam ?? selectedPlayer) ? `${selectedPlayer.playerId}:${targetTeamId}` : null
  const preview = previewResult?.key === previewKey ? previewResult.data : null
  const previewLoading = previewKey !== null && previewResult?.key !== previewKey

  useEffect(() => {
    if (!previewKey || !selectedPlayer) return
    let cancelled = false
    const supabase = createClient()
    void (async () => {
      const { data } = await supabase
        .rpc("preview_player_movement_eligibility", {
          p_player_id: selectedPlayer.playerId,
          p_source_team_id: selectedPlayer.currentTeamId,
          p_target_team_id: targetTeamId,
        })
        .single()
      if (cancelled || !data) return
      setPreviewResult({ key: previewKey, data: { requirement: data.requirement, reason: data.reason, governingBody: data.governing_body, restrictions: data.restrictions } })
    })()
    return () => {
      cancelled = true
    }
  }, [previewKey, selectedPlayer, targetTeamId])

  async function submit() {
    if (!fixtureId || !selectedPlayer || !eligibility.trim()) {
      setError("Choose a fixture, a player, and state the eligibility rule this call-up relies on.")
      return
    }
    setPending(true)
    setError(null)
    setSuccess(null)
    const res = await requestCallUp(fixtureId, selectedPlayer.playerId, selectedPlayer.currentTeamId, targetTeamId, eligibility.trim())
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setSuccess(
      preview?.requirement === "external_approval_required"
        ? `Requested for ${selectedPlayer.playerName}. This needs an age-grade approval before ${selectedPlayer.currentTeamName} can decide it -- see the request below.`
        : `Call-up requested for ${selectedPlayer.playerName}. ${selectedPlayer.currentTeamName} must approve it before kickoff.`
    )
    setEligibility("")
    setPlayerKey("")
  }

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-ink/10 bg-chalk/60 p-4">
      <p className="text-xs font-medium tracking-wide text-ink/55 uppercase">Request a call-up</p>
      <div className="flex flex-wrap gap-2">
        <select
          value={targetTeamId}
          onChange={(e) => {
            setTargetTeamId(e.target.value)
            setFixtureId("")
            setPlayerKey("")
            setShowOtherAges(false)
          }}
          className="h-9 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
        >
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.displayName} needs a player
            </option>
          ))}
        </select>
        <select
          value={fixtureId}
          onChange={(e) => setFixtureId(e.target.value)}
          className="h-9 min-w-[220px] rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
        >
          <option value="">Choose the fixture...</option>
          {teamFixtures.map((f) => (
            <option key={f.id} value={f.id}>
              {new Date(f.kickoffDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} vs {f.opponentLabel}
            </option>
          ))}
        </select>
        <select
          value={playerKey}
          onChange={(e) => setPlayerKey(e.target.value)}
          className="h-9 min-w-[220px] rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
        >
          <option value="">Choose the player...</option>
          {sameAgePlayers.map((p) => (
            <option key={`${p.playerId}:${p.currentTeamId}`} value={`${p.playerId}:${p.currentTeamId}`}>
              {p.playerName} ({p.currentTeamName})
            </option>
          ))}
        </select>
      </div>

      {!showOtherAges && otherAgePlayers.length > 0 && (
        <button type="button" onClick={() => setShowOtherAges(true)} className="text-sm font-medium text-forest-800 underline underline-offset-2">
          Need a player from another age group?
        </button>
      )}
      {showOtherAges && (
        <div className="rounded-lg border border-amber-200/70 bg-amber-50/60 p-3">
          <p className="text-xs text-amber-900">
            Player requests are limited to players who are normally eligible for this age group. Picking someone from another age group may need
            additional governing-body approval -- Ovalball will tell you exactly what&apos;s required.
          </p>
          <select
            value={otherAgePlayers.some((p) => `${p.playerId}:${p.currentTeamId}` === playerKey) ? playerKey : ""}
            onChange={(e) => setPlayerKey(e.target.value)}
            className="mt-2 h-9 min-w-[220px] rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
          >
            <option value="">Choose a player from another age group...</option>
            {otherAgePlayers.map((p) => (
              <option key={`${p.playerId}:${p.currentTeamId}`} value={`${p.playerId}:${p.currentTeamId}`}>
                {p.playerName} ({p.currentTeamName})
              </option>
            ))}
          </select>
        </div>
      )}

      {previewLoading && <p className="text-sm text-ink/50">Checking eligibility...</p>}
      {preview && preview.requirement === "not_permitted" && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>{preview.reason}</span>
        </div>
      )}
      {preview && preview.requirement === "external_approval_required" && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Additional approval required</p>
            <p className="mt-0.5">{preview.reason}</p>
            {preview.restrictions && <p className="mt-1 font-medium text-amber-900">Restriction on record: {preview.restrictions}</p>}
            <p className="mt-1 text-xs text-amber-800">
              Ovalball records {preview.governingBody ?? "the governing body's"} approval -- it does not grant it. The request can still be drafted now
              and will wait for that approval before the source team decides it.
            </p>
          </div>
        </div>
      )}

      <input
        value={eligibility}
        onChange={(e) => setEligibility(e.target.value)}
        placeholder='Eligibility rule reference (e.g. "RFU age-grade continuum" or "GOVERNING-BODY CONFIRMATION REQUIRED")'
        className="h-9 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
      />
      {error && <p className="text-sm text-red-700">{error}</p>}
      {success && <p className="text-sm text-forest-800">{success}</p>}
      <Button size="sm" disabled={pending || preview?.requirement === "not_permitted"} onClick={() => void submit()}>
        {pending ? "Requesting..." : preview?.requirement === "external_approval_required" ? "Draft request (needs approval)" : "Request call-up"}
      </Button>
    </div>
  )
}

function CallUpRowItem({ row }: { row: CallUpRow }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const status = row.status

  async function decide(action: "approve" | "reject" | "revoke") {
    setPending(true)
    setError(null)
    const res = await decideCallUp(row.id, action, null)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
  }

  return (
    <div className="rounded-lg border border-ink/10 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-ink">
            {row.playerName}: {row.sourceTeamName} → {row.targetTeamName}
          </p>
          <p className="text-xs text-ink/55">
            {row.fixtureLabel} · {row.eligibilityRuleReference}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            status === "approved"
              ? "bg-mint-100/70 text-forest-950"
              : status === "requested" || status === "awaiting_eligibility"
                ? "bg-amber-50 text-amber-900"
                : "bg-ink/5 text-ink/60"
          }`}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>
      {status === "awaiting_eligibility" && (
        <p className="mt-2 text-xs text-ink/55">Waiting on a Club Admin to record the required age-grade approval before this can be decided.</p>
      )}
      {row.canDecide && status === "requested" && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={pending} onClick={() => void decide("approve")}>
            Approve
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => void decide("reject")}>
            Reject
          </Button>
        </div>
      )}
      {row.canDecide && status === "awaiting_eligibility" && (
        <div className="mt-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={() => void decide("reject")}>
            Withdraw / reject
          </Button>
        </div>
      )}
      {row.canDecide && status === "approved" && (
        <div className="mt-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={() => void decide("revoke")}>
            Revoke
          </Button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  )
}
