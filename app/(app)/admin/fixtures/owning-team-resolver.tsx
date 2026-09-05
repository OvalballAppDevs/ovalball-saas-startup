"use client"

import { useEffect, useState } from "react"

import { Label } from "@/components/ui/label"

import { getClubActiveTeams, searchOpponentClubs, type ClubSearchResult, type OwningTeamOption } from "./actions"

/**
 * Home/Owning side picker for "+ Add Fixture" (Central Fixture Participant
 * Resolution follow-up: "separate club from team", never a single combined
 * club+team fuzzy search). Deliberately NOT the same missing-team-aware
 * picker as OpponentResolver -- the owning/requesting side of a fixture
 * request must always be a real, ACTIVE team the requester actually
 * operates (established principle: "the missing-team workflow applies to
 * the RECEIVING/OPPOSITION side of a request... not a loophole allowing a
 * club user to invent their own team"), so this only ever offers a club's
 * genuinely active roster. To create a fixture for a team a club doesn't
 * yet operate, add that club/team as the AWAY side instead (via
 * OpponentResolver, which does support the missing-team workflow), or wait
 * for that club's own Club Admin to activate the team first.
 */
export function OwningTeamResolver({
  selectedClubId,
  selectedClubName,
  selectedTeamId,
  selectedTeamLabel,
  onSelect,
  lockedClubId,
  lockedClubName,
}: {
  selectedClubId: string | null
  selectedClubName: string | null
  selectedTeamId: string | null
  selectedTeamLabel: string | null
  onSelect: (clubId: string | null, clubName: string | null, teamId: string | null, teamLabel: string | null) => void
  /** Club Admin/Fixtures Secretary fixture creation (Section 16-17): the actor's own side is fixed to their own club -- never a club search, only their real active roster. */
  lockedClubId?: string
  lockedClubName?: string
}) {
  const [clubQuery, setClubQuery] = useState("")
  const [clubResults, setClubResults] = useState<ClubSearchResult[]>([])
  const [searchingClubs, setSearchingClubs] = useState(false)
  const [pickedClub, setPickedClub] = useState<ClubSearchResult | null>(
    lockedClubId && lockedClubName ? { directoryId: "", clubName: lockedClubName, town: null, activated: true, clubId: lockedClubId } : null
  )
  const [teamOptions, setTeamOptions] = useState<OwningTeamOption[]>([])
  const [loadingTeams, setLoadingTeams] = useState(Boolean(lockedClubId))

  useEffect(() => {
    if (!lockedClubId) return
    getClubActiveTeams(lockedClubId).then((options) => {
      setTeamOptions(options)
      setLoadingTeams(false)
    })
  }, [lockedClubId])

  async function handleClubQueryChange(value: string) {
    setClubQuery(value)
    if (value.trim().length < 2) {
      setClubResults([])
      return
    }
    setSearchingClubs(true)
    const found = await searchOpponentClubs(value)
    setSearchingClubs(false)
    setClubResults(found)
  }

  async function handleClubSelect(club: ClubSearchResult) {
    setPickedClub(club)
    setClubQuery("")
    setClubResults([])
    onSelect(null, null, null, null)
    if (!club.activated || !club.clubId) {
      setTeamOptions([])
      return
    }
    setLoadingTeams(true)
    const options = await getClubActiveTeams(club.clubId)
    setLoadingTeams(false)
    setTeamOptions(options)
  }

  function reset() {
    if (lockedClubId && lockedClubName) {
      onSelect(null, null, null, null)
      return
    }
    setPickedClub(null)
    setTeamOptions([])
    onSelect(null, null, null, null)
  }

  if (selectedTeamId && selectedClubName && selectedTeamLabel) {
    return (
      <div>
        <div className="mt-1.5 flex items-center justify-between gap-3 rounded-lg border border-pitch-600/40 bg-pitch-600/5 px-3.5 py-2.5">
          <div>
            <p className="text-sm font-medium text-ink">{selectedClubName}</p>
            <p className="text-xs text-ink/50">{selectedTeamLabel}</p>
          </div>
          <button type="button" onClick={reset} className="text-xs font-medium text-ink/50 underline hover:text-ink">
            Change
          </button>
        </div>
      </div>
    )
  }

  if (!pickedClub) {
    return (
      <div>
        <input
          type="text"
          value={clubQuery}
          onChange={(e) => handleClubQueryChange(e.target.value)}
          placeholder="Search for the club…"
          className="h-10 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
        />
        {searchingClubs && <p className="mt-1 text-xs text-ink/40">Searching&hellip;</p>}
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
                    <span className="block text-sm font-medium text-ink">{c.clubName}</span>
                    {c.town && <span className="text-xs text-ink/50">{c.town}</span>}
                  </span>
                  {!c.activated && <span className="shrink-0 rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-medium text-amber-700">Not on Ovalball</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  if (!pickedClub.activated || !pickedClub.clubId) {
    return (
      <div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/35 bg-amber-500/5 px-3.5 py-2.5">
          <div>
            <p className="text-sm font-medium text-ink">{pickedClub.clubName}</p>
            <p className="text-xs text-amber-700">Not yet active on Ovalball &mdash; can&apos;t be the owning side of a fixture.</p>
          </div>
          <button type="button" onClick={reset} className="shrink-0 text-xs font-medium text-ink/50 underline hover:text-ink">
            Change
          </button>
        </div>
        <p className="mt-1.5 text-xs text-ink/45">A club needs a real, active team of its own to own a fixture. Choose a different club, or add {pickedClub.clubName} as the away side instead.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <Label className="text-ink/80">Team</Label>
        <button type="button" onClick={reset} className="text-xs font-medium text-ink/50 underline hover:text-ink">
          Change club
        </button>
      </div>
      {loadingTeams ? (
        <p className="mt-1.5 text-sm text-ink/50">Loading {pickedClub.clubName}&apos;s teams&hellip;</p>
      ) : teamOptions.length === 0 ? (
        <p className="mt-1.5 rounded-lg border border-ink/15 bg-ink/[0.02] p-3 text-sm text-ink/70">{pickedClub.clubName} has no active teams yet.</p>
      ) : (
        <select
          value=""
          onChange={(e) => {
            const opt = teamOptions.find((o) => o.id === e.target.value)
            if (opt && pickedClub.clubId) onSelect(pickedClub.clubId, pickedClub.clubName, opt.id, opt.label)
          }}
          className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
          aria-label={`${pickedClub.clubName} team`}
        >
          <option value="" disabled>
            Choose a team&hellip;
          </option>
          {teamOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
