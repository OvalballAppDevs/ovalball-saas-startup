"use client"

import { useEffect, useState } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { findMatchingOpponentTeamsForClub, getRequestingTeamIdentity, type RequestingTeamIdentity, type TeamSearchResult } from "./fixture-actions"
import { teamCategoryLabel } from "./team-labels"
import { searchClubsForTournament, type ClubDirectoryOption } from "./tournament-actions"

/**
 * Club-scoped opponent picker for Calendar (Club Directory search -> age-
 * eligible team match), mirroring app/(app)/admin/fixtures/opponent-
 * resolver.tsx's exact interaction shape and copy so a Club Admin sees the
 * same pattern in both places -- reimplemented here (not imported) because
 * the admin version's underlying search actions are Site-Admin-gated.
 */
export function OpponentPicker({
  owningTeamId,
  selectedTeam,
  onSelectTeam,
  selectedDirectoryId,
  onSelectDirectory,
  rawText,
  onRawTextChange,
  missingTeamGender,
  onMissingTeamGenderChange,
  missingTeamSquad,
  onMissingTeamSquadChange,
  onMissingTeamClubIdChange,
}: {
  owningTeamId: string | null
  selectedTeam: TeamSearchResult | null
  onSelectTeam: (team: TeamSearchResult | null) => void
  selectedDirectoryId: string | null
  onSelectDirectory: (directoryId: string | null) => void
  rawText: string
  onRawTextChange: (text: string) => void
  /** Central Fixture Participant Resolution: when a claimed club has no matching team, the requester may name a structured Team Directory identity (boys/girls + optional B/C squad) instead of only free text -- the recipient is then offered a controlled create/reactivate action rather than the request being unresolvable. Optional: a caller that doesn't yet support the missing-team flow can omit these and get the old free-text-only behaviour. */
  missingTeamGender?: "boys" | "girls" | null
  onMissingTeamGenderChange?: (gender: "boys" | "girls" | null) => void
  missingTeamSquad?: string | null
  onMissingTeamSquadChange?: (squad: string | null) => void
  /** The claimed club's real clubs.id and display name, needed so fixture_request_groups.opponent_club_id/raw_opponent_text are set even when no team resolved yet -- resolve_incoming_request_target reads opponent_club_id directly, and without it a genuinely claimed club would be mistaken for unclaimed. */
  onMissingTeamClubIdChange?: (clubId: string | null, clubName: string | null) => void
}) {
  const [clubQuery, setClubQuery] = useState("")
  const [clubResults, setClubResults] = useState<ClubDirectoryOption[]>([])
  const [selectedClub, setSelectedClub] = useState<ClubDirectoryOption | null>(null)
  const [matches, setMatches] = useState<TeamSearchResult[] | null>(null)
  const [resolving, setResolving] = useState(false)
  const [requestingIdentity, setRequestingIdentity] = useState<RequestingTeamIdentity | null>(null)
  const supportsMissingTeam = Boolean(onMissingTeamGenderChange)

  useEffect(() => {
    if (!supportsMissingTeam || !owningTeamId) return
    getRequestingTeamIdentity(owningTeamId).then(setRequestingIdentity)
  }, [owningTeamId, supportsMissingTeam])

  async function handleClubQueryChange(value: string) {
    setClubQuery(value)
    if (value.trim().length < 2) {
      setClubResults([])
      return
    }
    setClubResults(await searchClubsForTournament(value))
  }

  async function handleClubSelect(club: ClubDirectoryOption) {
    setSelectedClub(club)
    setClubQuery("")
    setClubResults([])
    onSelectTeam(null)

    if (!club.activated) {
      onSelectDirectory(club.directoryId)
      onRawTextChange(club.name)
      setMatches(null)
      return
    }
    onSelectDirectory(null)
    onMissingTeamClubIdChange?.(club.clubId, club.name)
    if (!owningTeamId || !club.clubId) return
    setResolving(true)
    const result = await findMatchingOpponentTeamsForClub(owningTeamId, club.clubId)
    setResolving(false)
    setMatches(result.matches)
    if (result.matches.length === 1) onSelectTeam(result.matches[0])
  }

  function reset() {
    setSelectedClub(null)
    setMatches(null)
    onSelectTeam(null)
    onSelectDirectory(null)
    onRawTextChange("")
    onMissingTeamGenderChange?.(null)
    onMissingTeamSquadChange?.(null)
    onMissingTeamClubIdChange?.(null, null)
  }

  if (selectedTeam) {
    return (
      <div>
        <Label className="text-ink/80">Opponent</Label>
        <div className="mt-1.5 flex items-center justify-between gap-3 rounded-lg border border-pitch-600/40 bg-pitch-600/5 px-3.5 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{selectedTeam.clubName}</p>
            <p className="truncate text-xs text-ink/50">
              {selectedTeam.teamName} &middot; {teamCategoryLabel(selectedTeam)}
            </p>
          </div>
          <button type="button" onClick={reset} className="shrink-0 text-xs font-medium text-ink/50 underline hover:text-ink">
            Change
          </button>
        </div>
      </div>
    )
  }

  if (selectedDirectoryId && selectedClub) {
    return (
      <div>
        <Label className="text-ink/80">Opponent</Label>
        <div className="mt-1.5 flex items-center justify-between gap-3 rounded-lg border border-amber-500/35 bg-amber-500/5 px-3.5 py-2.5">
          <div>
            <p className="text-sm font-medium text-ink">{selectedClub.name}</p>
            <p className="text-xs text-amber-700">Not yet active on Ovalball &mdash; recorded, no roster to match against.</p>
          </div>
          <button type="button" onClick={reset} className="text-xs font-medium text-ink/50 underline hover:text-ink">
            Change
          </button>
        </div>
      </div>
    )
  }

  if (!selectedClub) {
    return (
      <div>
        <Label className="text-ink/80">Opponent club</Label>
        <input
          type="text"
          value={clubQuery}
          onChange={(e) => handleClubQueryChange(e.target.value)}
          placeholder="Search for the opponent club…"
          className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
        />
        {clubResults.length > 0 && (
          <ul className="mt-1.5 flex flex-col gap-1 rounded-lg border border-ink/10 bg-white p-1.5">
            {clubResults.map((c) => (
              <li key={c.directoryId}>
                <button
                  type="button"
                  onClick={() => handleClubSelect(c)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left outline-none hover:bg-ink/[0.04] focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  <span>
                    <span className="block text-sm font-medium text-ink">{c.name}</span>
                    {c.town && <span className="text-xs text-ink/50">{c.town}</span>}
                  </span>
                  {!c.activated && <span className="shrink-0 rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-medium text-amber-700">Not on Ovalball</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2">
          <Label htmlFor="cal-opposition-text" className="text-ink/80">
            Or describe an external/unresolved opposition
          </Label>
          <Input
            id="cal-opposition-text"
            value={rawText}
            onChange={(e) => onRawTextChange(e.target.value)}
            placeholder="e.g. Rossendale RUFC"
            className="mt-1.5 h-10 border-ink/15 bg-white"
          />
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <Label className="text-ink/80">Opponent</Label>
        <button type="button" onClick={reset} className="text-xs font-medium text-ink/50 underline hover:text-ink">
          Change club
        </button>
      </div>
      {resolving && <p className="mt-1.5 text-sm text-ink/50">Resolving {selectedClub.name}&apos;s matching team&hellip;</p>}
      {!resolving && matches && matches.length > 1 && (
        <div className="mt-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-sm text-ink/80">{selectedClub.name} has {matches.length} age-eligible teams &mdash; choose one:</p>
          <div className="mt-2 flex flex-col gap-1.5">
            {matches.map((t) => (
              <button
                key={t.teamId}
                type="button"
                onClick={() => onSelectTeam(t)}
                className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-left text-sm font-medium text-ink outline-none hover:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                {t.teamName}
                <span className="ml-1.5 font-normal text-ink/45">{teamCategoryLabel(t)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {!resolving && matches && matches.length === 0 && supportsMissingTeam && requestingIdentity?.ageGroup && (
        <div className="mt-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-sm text-ink/70">
            {selectedClub.name} does not currently have {requestingIdentity.ageGroup} active on Ovalball.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Label className="text-ink/80">Requesting</Label>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-ink">{requestingIdentity.ageGroup}</span>
            <select
              value={missingTeamGender ?? ""}
              onChange={(e) => onMissingTeamGenderChange?.((e.target.value || null) as "boys" | "girls" | null)}
              className="h-8 rounded-md border border-ink/15 bg-white px-2 text-xs outline-none focus-visible:border-pitch-600"
              aria-label="Boys or girls"
            >
              <option value="">Boys/Girls…</option>
              <option value="boys">Boys</option>
              <option value="girls">Girls</option>
            </select>
            <select
              value={missingTeamSquad ?? ""}
              onChange={(e) => onMissingTeamSquadChange?.(e.target.value || null)}
              className="h-8 rounded-md border border-ink/15 bg-white px-2 text-xs outline-none focus-visible:border-pitch-600"
              aria-label="Squad (optional)"
            >
              <option value="">Primary squad</option>
              <option value="B">B squad</option>
              <option value="C">C squad</option>
            </select>
          </div>
          {missingTeamGender && (
            <p className="mt-2 text-xs text-amber-700">
              {selectedClub.name} will be asked to create {requestingIdentity.ageGroup}
              {missingTeamGender === "girls" ? " Girls" : ""}
              {missingTeamSquad ? ` ${missingTeamSquad}` : ""} before they can accept this fixture.
            </p>
          )}
          <div className="mt-3">
            <Label htmlFor="cal-opposition-text-noteam" className="text-ink/80">
              Or leave the team unresolved
            </Label>
            <Input
              id="cal-opposition-text-noteam"
              value={rawText}
              onChange={(e) => onRawTextChange(e.target.value)}
              placeholder={selectedClub.name}
              className="mt-1.5 h-10 border-ink/15 bg-white"
              disabled={Boolean(missingTeamGender)}
            />
          </div>
        </div>
      )}
      {!resolving && matches && matches.length === 0 && !(supportsMissingTeam && requestingIdentity?.ageGroup) && (
        <div className="mt-1.5 rounded-lg border border-ink/15 bg-ink/[0.02] p-3">
          <p className="text-sm text-ink/70">No age-eligible team found for {selectedClub.name}.</p>
          <div className="mt-3">
            <Label htmlFor="cal-opposition-text-noteam-fallback" className="text-ink/80">
              Leave the team unresolved
            </Label>
            <Input
              id="cal-opposition-text-noteam-fallback"
              value={rawText}
              onChange={(e) => onRawTextChange(e.target.value)}
              placeholder={selectedClub.name}
              className="mt-1.5 h-10 border-ink/15 bg-white"
            />
          </div>
        </div>
      )}
    </div>
  )
}
