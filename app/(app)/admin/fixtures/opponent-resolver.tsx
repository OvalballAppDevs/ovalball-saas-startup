"use client"

import { useEffect, useState } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { ageFixtureBand } from "@/lib/fixtures/eligibility"
import { fullTeamLabel } from "@/lib/teams/compact-label"
import { YOUTH_AGE_GROUPS } from "@/lib/teams/age-groups"

import { findMatchingOpponentTeams, getRequestingTeamIdentity, searchOpponentClubs, type ClubSearchResult, type RequestingTeamIdentity, type TeamSearchResult } from "./actions"

/**
 * Which age groups are actually eligible to face the requesting team,
 * mirroring internal.teams_can_play_fixture / lib/fixtures/eligibility.ts's
 * real rule exactly (never a looser proactive-UI guess): girls youth is
 * age-flexible only when BOTH sides are girls; U6/U7/U8 form one
 * compatible tag-rugby band; every other age is its own strict band (no
 * override possible at all). This UI picks gender via its OWN separate
 * control before showing ages (so a boys/mixed candidateGender can never
 * see a girls-only age list mixed in) -- a genuinely different shape from
 * lib/fixtures/eligibility.ts's eligibleOppositionCanonicalTypes (which
 * filters a combined age+gender candidate list in one step, used by
 * tournament-opposition-entry.tsx). Both must express the SAME domain
 * rule; any future correction to one must be checked against the other.
 */
function eligibleAgeGroupsFor(requesting: RequestingTeamIdentity, candidateGender: "boys" | "girls" | null): string[] {
  if (!requesting.ageGroup) return [...YOUTH_AGE_GROUPS]
  if (candidateGender === "girls" && requesting.gender === "girls") return [...YOUTH_AGE_GROUPS]
  const band = ageFixtureBand(requesting.ageGroup)
  if (band === "tag_u6_u8") return ["U6", "U7", "U8"]
  return requesting.ageGroup ? [requesting.ageGroup] : [...YOUTH_AGE_GROUPS]
}

/**
 * Delegates to lib/teams/compact-label.ts's fullTeamLabel -- the ONE
 * canonical full-name formatter (Reconciliation complaint 2). This
 * function previously derived its own label from `teamNumber`, which was
 * only ever populated for the search-result path (not the club-match
 * path), and never handled `category === "colts"` at all -- silently
 * mislabelling every Colts opponent as bare "Senior". Fixed by routing
 * through the shared formatter with the real `squad_designation` field.
 */
function teamCategoryLabel(t: TeamSearchResult): string {
  return fullTeamLabel({ category: t.category, ageGroup: t.ageGroup, gender: t.gender, squadDesignation: t.squadDesignation })
}

/**
 * Opponent resolution, per the brief's own worked examples: pick a club
 * first (any recognised canonical club_directory club, whether or not it
 * has activated an Ovalball account -- a club needs no account to be a
 * fixture opponent), then use the OWNING team's real rugby_code/category/
 * age_group/team_number/gender (never a display_name string comparison)
 * to resolve which of that club's teams is the real match -- auto-select
 * on exactly one match, force an explicit choice on more than one, and
 * never silently guess. An unactivated club has no `clubs` row, and teams
 * belong to clubs (never directly to club_directory), so it genuinely has
 * no team-level data to match against -- that path goes straight to
 * opponent_directory_id + free text, the same "canonical club + unresolved
 * team text" provenance already used when an activated club has no
 * matching team either. Never fabricates a team, and never creates a
 * `clubs` activation row just to let the fixture proceed.
 */
export function OpponentResolver({
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
  missingTeamAgeGroup,
  onMissingTeamAgeGroupChange,
}: {
  owningTeamId: string | null
  selectedTeam: TeamSearchResult | null
  onSelectTeam: (team: TeamSearchResult | null) => void
  selectedDirectoryId: string | null
  onSelectDirectory: (directoryId: string | null) => void
  rawText: string
  onRawTextChange: (text: string) => void
  /** Central Fixture Participant Resolution: when a claimed club has no matching team, Site Admin may name a structured Team Directory identity (boys/girls + optional B/C squad) instead of only free text -- routes through the same request/accept flow a club-initiated request uses, never a direct unilateral insert. */
  missingTeamGender?: "boys" | "girls" | null
  onMissingTeamGenderChange?: (gender: "boys" | "girls" | null) => void
  missingTeamSquad?: string | null
  onMissingTeamSquadChange?: (squad: string | null) => void
  /** Age-group auto-sync + override: defaults to the requesting team's own age group, but can be overridden to any other age eligible per teamsCanPlayFixture (girls flexibility / the U6-U8 band) -- a genuinely ineligible age is never offered as an option at all. Optional: callers that don't pass it (none currently) fall back to always matching the requesting team's own age, the previous hardcoded behaviour. */
  missingTeamAgeGroup?: string | null
  onMissingTeamAgeGroupChange?: (ageGroup: string | null) => void
}) {
  const [clubQuery, setClubQuery] = useState("")
  const [clubResults, setClubResults] = useState<ClubSearchResult[]>([])
  const [searchingClubs, setSearchingClubs] = useState(false)
  const [selectedClub, setSelectedClub] = useState<ClubSearchResult | null>(null)
  const [matches, setMatches] = useState<TeamSearchResult[] | null>(null)
  const [allClubTeams, setAllClubTeams] = useState<TeamSearchResult[]>([])
  const [resolving, setResolving] = useState(false)
  const [showAllClubTeams, setShowAllClubTeams] = useState(false)
  const [requestingIdentity, setRequestingIdentity] = useState<RequestingTeamIdentity | null>(null)
  const supportsMissingTeam = Boolean(onMissingTeamGenderChange)

  useEffect(() => {
    if (!supportsMissingTeam || !owningTeamId) return
    getRequestingTeamIdentity(owningTeamId).then((identity) => {
      setRequestingIdentity(identity)
      // Auto-sync: default the missing-team age group to the requesting
      // team's own age the moment we know it, rather than leaving it
      // unset -- the user can still override below.
      if (identity?.ageGroup) onMissingTeamAgeGroupChange?.(identity.ageGroup)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onMissingTeamAgeGroupChange is a setState setter from the parent, stable in practice; including it would re-run this fetch on every parent render.
  }, [owningTeamId, supportsMissingTeam])

  // If Boys/Girls changes such that the currently-selected override age is
  // no longer eligible (e.g. switching away from Girls drops the age-
  // flexibility exception), snap back to the requesting team's own age
  // rather than silently leaving an now-invalid selection in place.
  useEffect(() => {
    if (!requestingIdentity?.ageGroup) return
    const eligible = eligibleAgeGroupsFor(requestingIdentity, missingTeamGender ?? null)
    if (missingTeamAgeGroup && !eligible.includes(missingTeamAgeGroup)) {
      onMissingTeamAgeGroupChange?.(requestingIdentity.ageGroup)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingTeamGender, requestingIdentity])

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
    setSelectedClub(club)
    setClubQuery("")
    setClubResults([])
    setShowAllClubTeams(false)
    onSelectTeam(null)

    if (!club.activated || !club.clubId) {
      // No Ovalball account -> no team-level canonical data exists to match
      // against. Store the canonical club identity (never a fabricated
      // team), and leave the team description as free text.
      onSelectDirectory(club.directoryId)
      onRawTextChange(club.clubName)
      setMatches(null)
      setAllClubTeams([])
      return
    }

    // Set even for an activated club (not just the unactivated fallback
    // below) -- the canonical club_directory reference this club has
    // regardless of activation, and the signal a missing-team structured
    // request needs to identify the CLAIMED opponent club server-side.
    onSelectDirectory(club.directoryId)
    // Reset the free-text fallback too -- otherwise, when editing an
    // EXISTING fixture, whatever raw text loaded from the fixture's
    // previous opponent survives untouched into this brand-new club
    // selection (a real bug: picking a resolved club could silently
    // submit completely unrelated leftover text as the "team
    // description"). Defaults to the club's own name, the same safe
    // fallback the unactivated branch above already uses, so a user who
    // saves without touching this field still gets something sensible.
    onRawTextChange(club.clubName)
    if (!owningTeamId) return
    setResolving(true)
    const result = await findMatchingOpponentTeams(owningTeamId, club.clubId)
    setResolving(false)
    setMatches(result.matches)
    setAllClubTeams(result.allClubTeams)
    if (result.matches.length === 1) {
      onSelectTeam(result.matches[0])
    }
  }

  function reset() {
    setSelectedClub(null)
    setMatches(null)
    setAllClubTeams([])
    setShowAllClubTeams(false)
    onSelectTeam(null)
    onSelectDirectory(null)
    onRawTextChange("")
    onMissingTeamGenderChange?.(null)
    onMissingTeamSquadChange?.(null)
    onMissingTeamAgeGroupChange?.(null)
  }

  if (selectedTeam) {
    // A resolved match is always ELIGIBLE (findMatchingOpponentTeams only
    // ever returns teams teamsCanPlayFixture already accepts), but ages can
    // still legitimately differ within a valid band (U6-U8) or via girls
    // age-flexibility -- surface that plainly rather than let a different
    // age slip past unnoticed just because the pairing is technically valid.
    const ageDiffers = Boolean(requestingIdentity?.ageGroup) && selectedTeam.ageGroup !== null && selectedTeam.ageGroup !== requestingIdentity?.ageGroup
    return (
      <div>
        <span className="text-sm text-ink/70">Opponent</span>
        <div className="mt-1.5 flex items-center justify-between gap-3 rounded-lg border border-pitch-600/40 bg-pitch-600/5 px-3.5 py-2.5">
          <div>
            <p className="text-sm font-medium text-ink">{selectedTeam.clubName}</p>
            <p className="text-xs text-ink/50">
              {selectedTeam.teamName} &middot; {teamCategoryLabel(selectedTeam)}
            </p>
          </div>
          <button type="button" onClick={reset} className="text-xs font-medium text-ink/50 underline hover:text-ink">
            Change
          </button>
        </div>
        {ageDiffers && (
          <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs font-medium text-amber-800">
            <span aria-hidden="true">⚠</span>
            Different age groups &mdash; your {requestingIdentity?.ageGroup} team vs {selectedTeam.clubName} {selectedTeam.ageGroup}. This pairing is
            allowed under the current age-band rules, but double-check it&apos;s intentional.
          </p>
        )}
      </div>
    )
  }

  // Gate on the club's REAL activation state, never on selectedDirectoryId's
  // mere presence -- onSelectDirectory is now called unconditionally for
  // every selected club (activated or not) so the missing-team workflow
  // always has the canonical directory id available. Before this fix,
  // selectedDirectoryId being truthy the instant ANY club was picked meant
  // this "not yet active" branch fired for every activated club too (any
  // time matches.length !== 1), permanently shadowing the real resolving/
  // matches/missing-team-picker UI below it -- a real, confirmed bug (the
  // Rossendale "not yet active" anomaly a prior pass flagged but didn't fix).
  if (selectedClub && !selectedClub.activated) {
    return (
      <div>
        <span className="text-sm text-ink/70">Opponent</span>
        <div className="mt-1.5 flex items-center justify-between gap-3 rounded-lg border border-amber-500/35 bg-amber-500/5 px-3.5 py-2.5">
          <div>
            <p className="text-sm font-medium text-ink">{selectedClub.clubName}</p>
            <p className="text-xs text-amber-700">Not yet active on Ovalball &mdash; no team roster available to match against.</p>
          </div>
          <button type="button" onClick={reset} className="text-xs font-medium text-ink/50 underline hover:text-ink">
            Change
          </button>
        </div>
        <div className="mt-2">
          <Label htmlFor="opposition-text-unactivated" className="text-ink/80">
            Team description
          </Label>
          <Input
            id="opposition-text-unactivated"
            value={rawText}
            onChange={(e) => onRawTextChange(e.target.value)}
            placeholder={selectedClub.clubName}
            className="mt-1.5 h-10 border-ink/15 bg-white"
          />
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
        <div className="mt-2">
          <Label htmlFor="opposition-text" className="text-ink/80">
            Or describe an external/unresolved opposition
          </Label>
          <Input
            id="opposition-text"
            value={rawText}
            onChange={(e) => onRawTextChange(e.target.value)}
            placeholder="e.g. Rossendale RUFC, or “Centenary Festival”"
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

      {resolving && <p className="mt-1.5 text-sm text-ink/50">Resolving {selectedClub.clubName}&apos;s matching team&hellip;</p>}

      {!resolving && matches && matches.length > 1 && (
        <div className="mt-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-sm text-ink/80">
            {selectedClub.clubName} has {matches.length} teams that could match &mdash; choose the right one:
          </p>
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

      {!resolving && matches && matches.length === 0 && (
        <div className="mt-1.5 rounded-lg border border-ink/15 bg-ink/[0.02] p-3">
          <p className="text-sm text-ink/70">No matching team found for {selectedClub.clubName}.</p>
          {allClubTeams.length > 0 && !showAllClubTeams && (
            <button type="button" onClick={() => setShowAllClubTeams(true)} className="mt-2 text-xs font-medium text-forest-800 underline hover:text-forest-950">
              Choose from {selectedClub.clubName}&apos;s {allClubTeams.length} other team{allClubTeams.length === 1 ? "" : "s"} instead
            </button>
          )}
          {showAllClubTeams && (
            <div className="mt-2 flex flex-col gap-1.5">
              {allClubTeams.map((t) => (
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
          )}
          {supportsMissingTeam && requestingIdentity?.ageGroup && (() => {
            const eligibleAges = eligibleAgeGroupsFor(requestingIdentity, missingTeamGender ?? null)
            const currentAge = missingTeamAgeGroup ?? requestingIdentity.ageGroup
            const isDifferentAge = currentAge !== requestingIdentity.ageGroup
            return (
              <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="text-sm text-ink/70">
                  {selectedClub.clubName} does not currently have {requestingIdentity.ageGroup} active on Ovalball.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Label className="text-ink/80">Requesting team plays</Label>
                  {eligibleAges.length > 1 ? (
                    <select
                      value={currentAge}
                      onChange={(e) => onMissingTeamAgeGroupChange?.(e.target.value)}
                      className="h-8 rounded-md border border-ink/15 bg-white px-2 text-xs font-medium text-ink outline-none focus-visible:border-pitch-600"
                      aria-label="Age group for the opponent team"
                    >
                      {eligibleAges.map((age) => (
                        <option key={age} value={age}>
                          {age}
                          {age === requestingIdentity.ageGroup ? " (same as your team)" : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-ink">{requestingIdentity.ageGroup}</span>
                  )}
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
                {isDifferentAge && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-xs font-medium text-amber-800">
                    <span aria-hidden="true">⚠</span>
                    You&apos;re creating a fixture between different age groups &mdash; your {requestingIdentity.ageGroup} team vs {selectedClub.clubName}{" "}
                    {currentAge}
                    {missingTeamGender === "girls" ? " Girls" : ""}.
                  </p>
                )}
                {missingTeamGender && (
                  <p className="mt-2 text-xs text-amber-700">
                    {selectedClub.clubName} will be sent a fixture request and asked to create {currentAge}
                    {missingTeamGender === "girls" ? " Girls" : ""}
                    {missingTeamSquad ? ` ${missingTeamSquad}` : ""} before they can accept it -- this will not create the fixture directly.
                  </p>
                )}
              </div>
            )
          })()}
          <div className="mt-3">
            <Label htmlFor="opposition-text-noteam" className="text-ink/80">
              Or leave the team unresolved
            </Label>
            <Input
              id="opposition-text-noteam"
              value={rawText}
              onChange={(e) => onRawTextChange(e.target.value)}
              placeholder={selectedClub.clubName}
              disabled={Boolean(missingTeamGender)}
              className="mt-1.5 h-10 border-ink/15 bg-white"
            />
          </div>
        </div>
      )}
    </div>
  )
}
