"use client"

import { useEffect, useState } from "react"

import {
  distanceMiles,
  findDistanceOrigin,
  resolveClubLocation,
  type ClubMapMarker,
  type FixtureOpportunity,
  type FixtureOpportunityResponseRow,
  type FixtureOpportunityVenuePreference,
} from "@ovalball/contracts/clubhouse"
import { fullTeamLabel } from "@ovalball/contracts/teams/compact-label"
import type { MyTeam } from "@/lib/app-context/my-teams"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

import {
  acceptOpportunityResponse,
  cancelOpportunity,
  declineOpportunityResponse,
  getOpportunitiesData,
  getOpportunityResponses,
  publishOpportunity,
  respondToOpportunity,
  withdrawOpportunityResponse,
} from "./actions"

const GAME_TYPE_OPTIONS = ["Friendly", "League Fixture", "Cup Fixture", "Scheduled Match"] as const

/**
 * CLUBHOUSE PROGRAMME SECTIONS 15/16 -- the whole "Looking for Opposition" experience: publish, browse,
 * respond, manage own listings, review and decide responses. Distance and partnership are computed HERE,
 * client-side, from the same markers population and the same pure functions (resolveClubLocation,
 * distanceMiles, resolvePartnershipStatus) the ordinary Clubhouse map already uses -- never a second geo
 * or partnership calculation. ONLY facts the RPC actually returned are ever shown: no fabricated
 * distance, availability or partnership state.
 */
export function OpportunitiesClient({ contextTeamId, teams, highlightId }: { contextTeamId: string | null; teams: MyTeam[]; highlightId: string | null }) {
  const [teamId, setTeamId] = useState<string | null>(contextTeamId ?? (teams.length === 1 ? teams[0]!.id : null))
  const [opportunities, setOpportunities] = useState<FixtureOpportunity[] | null>(null)
  const [markers, setMarkers] = useState<ClubMapMarker[]>([])
  const [tab, setTab] = useState<"discover" | "mine">("discover")
  const [publishOpen, setPublishOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const myTeamRow = teams.find((t) => t.id === teamId) ?? null

  async function load() {
    if (!teamId) return
    const myClubId = markers.find((m) => m.isOwnClub)?.clubId ?? null
    const data = await getOpportunitiesData(teamId, myClubId, teamId)
    setOpportunities(data.opportunities)
    setMarkers(data.markers)
  }

  useEffect(() => {
    setOpportunities(null)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId])

  const origin = findDistanceOrigin(markers)
  const discoverList = (opportunities ?? []).filter((o) => !o.isMine)
  const mineList = (opportunities ?? []).filter((o) => o.isMine)

  if (!teamId) {
    return (
      <div className="max-w-md">
        <Label className="text-ink/80">Which team is looking for opposition?</Label>
        <div className="mt-2 flex flex-col gap-2">
          {teams.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTeamId(t.id)}
              className="flex items-center justify-between rounded-lg border border-ink/15 bg-white px-4 py-3 text-left text-sm font-medium text-ink hover:bg-ink/[0.03]"
            >
              {fullTeamLabel(t)}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-ink/[0.04] p-1">
          <button
            type="button"
            onClick={() => setTab("discover")}
            className={`rounded-md px-3.5 py-1.5 text-sm font-medium ${tab === "discover" ? "bg-white text-ink shadow-sm" : "text-ink-muted"}`}
          >
            Discover
          </button>
          <button
            type="button"
            onClick={() => setTab("mine")}
            className={`rounded-md px-3.5 py-1.5 text-sm font-medium ${tab === "mine" ? "bg-white text-ink shadow-sm" : "text-ink-muted"}`}
          >
            My Listings{mineList.length > 0 ? ` (${mineList.length})` : ""}
          </button>
        </div>
        <Button type="button" className="h-9" onClick={() => setPublishOpen(true)}>
          Publish a Listing
        </Button>
      </div>

      {error && <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive-text">{error}</p>}

      {publishOpen && myTeamRow && (
        <PublishForm
          teamId={teamId}
          teamLabel={fullTeamLabel(myTeamRow)}
          onClose={() => setPublishOpen(false)}
          onPublished={async () => {
            setPublishOpen(false)
            await load()
            setTab("mine")
          }}
        />
      )}

      {opportunities === null && <p className="mt-8 text-sm text-ink-muted">Loading…</p>}

      {opportunities !== null && tab === "discover" && (
        <div className="mt-6 flex flex-col gap-4">
          {discoverList.length === 0 && (
            <p className="rounded-lg border border-dashed border-ink/15 px-5 py-8 text-center text-sm text-ink-muted">
              No club is currently looking for opposition your {fullTeamLabel(myTeamRow!)} could play. Check back, or publish your own listing.
            </p>
          )}
          {discoverList.map((o) => (
            <DiscoverCard
              key={o.id}
              opportunity={o}
              origin={origin}
              markers={markers}
              teamId={teamId}
              onChanged={load}
              highlighted={o.id === highlightId}
              onError={setError}
            />
          ))}
        </div>
      )}

      {opportunities !== null && tab === "mine" && (
        <div className="mt-6 flex flex-col gap-4">
          {mineList.length === 0 && <p className="rounded-lg border border-dashed border-ink/15 px-5 py-8 text-center text-sm text-ink-muted">You have no listings yet.</p>}
          {mineList.map((o) => (
            <MineCard key={o.id} opportunity={o} onChanged={load} highlighted={o.id === highlightId} onError={setError} />
          ))}
        </div>
      )}
    </div>
  )
}

function statusLabel(status: FixtureOpportunity["myResponseStatus"]): string {
  switch (status) {
    case "pending":
      return "Response sent — waiting to hear back"
    case "accepted":
      return "Accepted"
    case "declined":
      return "Declined"
    case "withdrawn":
      return "Withdrawn"
    case "superseded":
      return "No longer available — filled elsewhere"
    default:
      return ""
  }
}

function opportunityStatusLabel(o: FixtureOpportunity): string {
  const effective =
    new Date(o.proposedDate) < new Date(new Date().toDateString()) ? "expired" : null
  return effective ?? "open"
}

function DiscoverCard({
  opportunity,
  origin,
  markers,
  teamId,
  onChanged,
  highlighted,
  onError,
}: {
  opportunity: FixtureOpportunity
  origin: ClubMapMarker | null
  markers: ClubMapMarker[]
  teamId: string
  onChanged: () => Promise<void>
  highlighted: boolean
  onError: (message: string | null) => void
}) {
  const [respondOpen, setRespondOpen] = useState(false)
  const [note, setNote] = useState("")
  const [sending, setSending] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)

  const location = resolveClubLocation(
    { latitude: opportunity.publishingClubDirectoryLatitude, longitude: opportunity.publishingClubDirectoryLongitude, geocodeSuccess: opportunity.publishingClubDirectoryGeocodeStatus === "success" },
    null
  )
  const miles = origin ? distanceMiles(origin, { latitude: location.latitude, longitude: location.longitude }) : null

  // The Clubhouse markers population already resolves partnership status (buildPartnershipIndex/
  // resolvePartnershipStatus, applied once in readClubhouseMarkers) -- read it directly here rather than
  // re-deriving it a second time from raw rows.
  const marker = markers.find((m) => m.clubId === opportunity.publishingClubId)
  const partnership = marker?.partnershipStatus ?? "unknown"

  async function send() {
    setSending(true)
    onError(null)
    const result = await respondToOpportunity(opportunity.id, teamId, note || null)
    setSending(false)
    if (!result.ok) {
      onError(result.error)
      return
    }
    setRespondOpen(false)
    await onChanged()
  }

  return (
    <div className={`rounded-lg border bg-white p-5 ${highlighted ? "border-pitch-600 ring-2 ring-pitch-400/30" : "border-ink/10"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-medium text-ink">{opportunity.publishingClubName}</p>
          <p className="mt-0.5 text-sm text-ink-muted">
            {fullTeamLabel({
              category: opportunity.publishingTeamCategory,
              ageGroup: opportunity.publishingTeamAgeGroup,
              gender: opportunity.publishingTeamGender,
              squadDesignation: opportunity.publishingTeamSquadDesignation,
              rugbyCode: opportunity.publishingTeamRugbyCode,
              alias: null,
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {miles !== null && <span className="rounded-full bg-ink/8 px-2.5 py-1 font-medium text-ink/70">{Math.round(miles)} mi</span>}
          {partnership === "active" && <span className="rounded-full bg-pitch-600/12 px-2.5 py-1 font-medium text-forest-800">Partner Club</span>}
          {opportunity.myTeamAvailability === "busy" && <span className="rounded-full bg-amber-500/15 px-2.5 py-1 font-medium text-amber-900">You have a clash that day</span>}
          {opportunity.myTeamAvailability === "no_known_clash" && <span className="rounded-full bg-ink/8 px-2.5 py-1 font-medium text-ink/60">No known clash</span>}
        </div>
      </div>

      <p className="mt-3 text-sm text-ink">
        {new Date(`${opportunity.proposedDate}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
        {opportunity.kickoffTime ? ` · ${opportunity.kickoffTime.slice(0, 5)}` : ""}
        {" · Looking for: "}
        {opportunity.venuePreference === "home" ? "away fixture (they're home)" : opportunity.venuePreference === "away" ? "home fixture (they're away)" : "home or away"}
        {opportunity.gameType ? ` · ${opportunity.gameType}` : ""}
      </p>
      {opportunity.note && <p className="mt-1 text-sm text-ink-muted">“{opportunity.note}”</p>}

      {opportunity.myResponseStatus ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium text-forest-800">{statusLabel(opportunity.myResponseStatus)}</p>
          {opportunity.myResponseStatus === "pending" && opportunity.myResponseId && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8"
              disabled={withdrawing}
              onClick={async () => {
                setWithdrawing(true)
                onError(null)
                const result = await withdrawOpportunityResponse(opportunity.myResponseId as string)
                setWithdrawing(false)
                if (!result.ok) {
                  onError(result.error)
                  return
                }
                await onChanged()
              }}
            >
              {withdrawing ? "Withdrawing…" : "Withdraw"}
            </Button>
          )}
        </div>
      ) : respondOpen ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md border border-ink/10 bg-chalk/60 p-3">
          <label className="flex min-w-[12rem] flex-1 flex-col gap-0.5 text-xs text-ink-muted">
            Note (optional)
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="h-9 rounded-md border border-ink/15 bg-white px-2 text-sm outline-none focus-visible:border-pitch-600"
            />
          </label>
          <Button type="button" size="sm" className="h-9" disabled={sending} onClick={send}>
            {sending ? "Sending…" : "Send Response"}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-9" disabled={sending} onClick={() => setRespondOpen(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="mt-3">
          <Button type="button" size="sm" onClick={() => setRespondOpen(true)}>
            Respond
          </Button>
        </div>
      )}
    </div>
  )
}

function MineCard({
  opportunity,
  onChanged,
  highlighted,
  onError,
}: {
  opportunity: FixtureOpportunity
  onChanged: () => Promise<void>
  highlighted: boolean
  onError: (message: string | null) => void
}) {
  const [responsesOpen, setResponsesOpen] = useState(false)
  const [responses, setResponses] = useState<FixtureOpportunityResponseRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const status = opportunityStatusLabel(opportunity)
  const isOpen = status === "open"

  async function toggleResponses() {
    const next = !responsesOpen
    setResponsesOpen(next)
    if (next && responses === null) {
      const rows = await getOpportunityResponses(opportunity.id)
      setResponses(rows)
    }
  }

  async function cancel() {
    setBusy(true)
    onError(null)
    const result = await cancelOpportunity(opportunity.id, opportunity.updatedAt)
    setBusy(false)
    if (!result.ok) {
      onError(result.error)
      return
    }
    await onChanged()
  }

  async function decide(responseId: string, decision: "accept" | "decline") {
    setBusy(true)
    onError(null)
    const result = decision === "accept" ? await acceptOpportunityResponse(responseId, opportunity.updatedAt) : await declineOpportunityResponse(responseId)
    setBusy(false)
    if (!result.ok) {
      onError("isDuplicateRequest" in result && result.isDuplicateRequest ? `${result.error} You already have an open request for this date with them.` : result.error)
      return
    }
    setResponses(null)
    setResponsesOpen(false)
    await onChanged()
  }

  return (
    <div className={`rounded-lg border bg-white p-5 ${highlighted ? "border-pitch-600 ring-2 ring-pitch-400/30" : "border-ink/10"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-ink">
            {new Date(`${opportunity.proposedDate}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
            {opportunity.kickoffTime ? ` · ${opportunity.kickoffTime.slice(0, 5)}` : ""}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {opportunity.venuePreference === "home" ? "Looking for an away fixture" : opportunity.venuePreference === "away" ? "Looking for a home fixture" : "Home or away"}
            {opportunity.gameType ? ` · ${opportunity.gameType}` : ""}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            status === "open" ? "bg-pitch-600/12 text-forest-800" : status === "filled" ? "bg-ink/8 text-ink/70" : "bg-destructive/10 text-destructive-text"
          }`}
        >
          {status === "open" ? "Open" : status === "filled" ? "Filled" : status === "cancelled" ? "Cancelled" : "Expired"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" className="h-8" onClick={toggleResponses}>
          {responsesOpen ? "Hide Responses" : "Review Responses"}
        </Button>
        {isOpen && (
          <Button type="button" size="sm" variant="ghost" className="h-8" disabled={busy} onClick={cancel}>
            Cancel Listing
          </Button>
        )}
      </div>

      {responsesOpen && (
        <div className="mt-3 flex flex-col gap-2 border-t border-ink/10 pt-3">
          {responses === null && <p className="text-sm text-ink-muted">Loading…</p>}
          {responses?.length === 0 && <p className="text-sm text-ink-muted">No responses yet.</p>}
          {responses?.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ink/10 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">
                  {r.respondingClubName ?? "A club"} ·{" "}
                  {fullTeamLabel({
                    category: r.respondingTeamCategory,
                    ageGroup: r.respondingTeamAgeGroup,
                    gender: r.respondingTeamGender,
                    squadDesignation: r.respondingTeamSquadDesignation,
                    rugbyCode: r.respondingTeamRugbyCode,
                    alias: null,
                  })}
                </p>
                {r.note && <p className="text-xs text-ink-muted">“{r.note}”</p>}
              </div>
              {r.status === "pending" ? (
                <div className="flex gap-2">
                  <Button type="button" size="sm" className="h-8" disabled={busy} onClick={() => decide(r.id, "accept")}>
                    Accept
                  </Button>
                  <Button type="button" size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => decide(r.id, "decline")}>
                    Decline
                  </Button>
                </div>
              ) : (
                <span className="text-xs text-ink-muted">{statusLabel(r.status)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PublishForm({ teamId, teamLabel, onClose, onPublished }: { teamId: string; teamLabel: string; onClose: () => void; onPublished: () => Promise<void> }) {
  const [date, setDate] = useState("")
  const [kickoff, setKickoff] = useState("")
  const [venue, setVenue] = useState<FixtureOpportunityVenuePreference>("either")
  const [gameType, setGameType] = useState<(typeof GAME_TYPE_OPTIONS)[number] | "">("")
  const [note, setNote] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!date) {
      setError("A date is required.")
      return
    }
    setSending(true)
    setError(null)
    const result = await publishOpportunity(teamId, date, kickoff || null, venue, gameType || null, note || null)
    setSending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await onPublished()
  }

  return (
    <div className="mt-6 rounded-lg border border-ink/10 bg-white p-5">
      <p className="text-sm font-medium text-ink">Publish a listing for {teamLabel}</p>
      <p className="mt-1 text-xs text-ink-muted">Visible to any compatible club across the Ovalball network, not just partners.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="opp-date" className="text-ink/80">
            Date
          </Label>
          <input
            id="opp-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            min={new Date().toISOString().slice(0, 10)}
            className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm outline-none focus-visible:border-pitch-600"
          />
        </div>
        <div>
          <Label htmlFor="opp-kickoff" className="text-ink/80">
            Kick-Off (Optional)
          </Label>
          <input
            id="opp-kickoff"
            type="time"
            value={kickoff}
            onChange={(e) => setKickoff(e.target.value)}
            className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm outline-none focus-visible:border-pitch-600"
          />
        </div>
        <div>
          <Label htmlFor="opp-venue" className="text-ink/80">
            Venue
          </Label>
          <select
            id="opp-venue"
            value={venue}
            onChange={(e) => setVenue(e.target.value as FixtureOpportunityVenuePreference)}
            className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm outline-none focus-visible:border-pitch-600"
          >
            <option value="home">Home (looking for an away fixture)</option>
            <option value="away">Away (looking for a home fixture)</option>
            <option value="either">Either</option>
          </select>
        </div>
        <div>
          <Label htmlFor="opp-game-type" className="text-ink/80">
            Fixture Type (Optional)
          </Label>
          <select
            id="opp-game-type"
            value={gameType}
            onChange={(e) => setGameType(e.target.value as (typeof GAME_TYPE_OPTIONS)[number])}
            className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm outline-none focus-visible:border-pitch-600"
          >
            <option value="">Not specified</option>
            {GAME_TYPE_OPTIONS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-4">
        <Label htmlFor="opp-note" className="text-ink/80">
          Note (Optional)
        </Label>
        <input
          id="opp-note"
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Anything a compatible club should know."
          className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm outline-none focus-visible:border-pitch-600"
        />
      </div>
      {error && <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive-text">{error}</p>}
      <div className="mt-4 flex gap-2">
        <Button type="button" className="h-10" disabled={sending} onClick={submit}>
          {sending ? "Publishing…" : "Publish Listing"}
        </Button>
        <Button type="button" variant="outline" className="h-10" disabled={sending} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
