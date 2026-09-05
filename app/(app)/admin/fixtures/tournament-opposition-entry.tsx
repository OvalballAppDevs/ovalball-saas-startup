"use client"

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"

import { eligibleOppositionCanonicalTypes, findCanonicalTypeForIdentity } from "@/lib/fixtures/eligibility"

import { searchOpponentClubs, type ClubSearchResult } from "./actions"
import { getClubTeamTypeStates, type ClubTeamTypeState } from "./tournament-fixture-actions"
import { loadTournamentTeamTypeOptions, type CanonicalTeamTypeOption } from "../../calendar/tournament-actions"

export interface OppositionValue {
  clubDirectoryId: string | null
  clubName: string | null
  clubActivated: boolean
  clubId: string | null
  canonicalTeamTypeId: string | null
}

const STATE_LABEL: Record<ClubTeamTypeState["state"], string> = {
  active: "Active",
  inactive: "Inactive",
  not_operated: "Not currently operated",
}

/**
 * One row of the Tournament participant list (Section 7-8/18). Follow-up
 * fix: the host's own age group (set once, at the top of the form) is the
 * single source of truth -- every opposition entry defaults to that SAME
 * identity automatically, never its own independent "pick an age" control.
 * A compact "Override age" link reveals the full age/gender selector (with
 * the same warning-on-mismatch pattern opponent-resolver.tsx already
 * established for ordinary fixtures) only when someone deliberately needs
 * a different age for one specific participant.
 */
export function TournamentOppositionEntry({
  index,
  value,
  onChange,
  onRemove,
  removable,
  hostAgeGroup,
  hostGender,
}: {
  index: number
  value: OppositionValue
  onChange: (next: OppositionValue) => void
  onRemove: () => void
  removable: boolean
  hostAgeGroup: string | null
  hostGender: string | null
}) {
  const [clubQuery, setClubQuery] = useState("")
  const [clubResults, setClubResults] = useState<ClubSearchResult[]>([])
  const [teamTypes, setTeamTypes] = useState<CanonicalTeamTypeOption[]>([])
  const [clubStates, setClubStates] = useState<ClubTeamTypeState[]>([])
  const [overriding, setOverriding] = useState(false)
  // Holds a chosen-but-not-yet-confirmed override so a genuine age change
  // can require an explicit Cancel/Confirm action rather than silently
  // landing the moment the <select> fires its onChange.
  const [pendingOverrideId, setPendingOverrideId] = useState<string | null>(null)

  useEffect(() => {
    loadTournamentTeamTypeOptions().then(setTeamTypes)
  }, [])

  useEffect(() => {
    if (!value.clubId) return
    getClubTeamTypeStates(value.clubId).then(setClubStates)
  }, [value.clubId])

  // Auto-default to the host's own identity the moment both the club and
  // the team-type catalogue are known, unless the user has deliberately
  // opened the override control -- never overwrites a value they've
  // already chosen there. findCanonicalTypeForIdentity normalizes gender
  // the same way the shared eligibility filter does (bug fix: `teams.gender`
  // is stored null for the ordinary Boys/Mixed pathway while the matching
  // canonical_team_types row explicitly stores 'boys' -- a raw `===`
  // comparison between the two never matched, leaving this stuck on
  // "Resolving..." forever for every ordinary-pathway host).
  useEffect(() => {
    if (overriding || value.canonicalTeamTypeId || !value.clubDirectoryId || teamTypes.length === 0 || !hostAgeGroup) return
    const defaultType = findCanonicalTypeForIdentity(hostAgeGroup, hostGender, teamTypes)
    if (defaultType) onChange({ ...value, canonicalTeamTypeId: defaultType.id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.clubDirectoryId, teamTypes, overriding])

  async function handleClubQueryChange(q: string) {
    setClubQuery(q)
    if (q.trim().length < 2) {
      setClubResults([])
      return
    }
    setClubResults(await searchOpponentClubs(q))
  }

  function handleClubSelect(club: ClubSearchResult) {
    setClubQuery("")
    setClubResults([])
    onChange({ clubDirectoryId: club.directoryId, clubName: club.clubName, clubActivated: club.activated, clubId: club.clubId ?? null, canonicalTeamTypeId: null })
    setOverriding(false)
  }

  function stateFor(typeId: string): ClubTeamTypeState["state"] {
    return clubStates.find((s) => s.canonicalTeamTypeId === typeId)?.state ?? "not_operated"
  }

  const selectedType = teamTypes.find((t) => t.id === value.canonicalTeamTypeId)
  const defaultType = hostAgeGroup ? findCanonicalTypeForIdentity(hostAgeGroup, hostGender, teamTypes) : undefined
  // Shared, structured-field-based filter (lib/fixtures/eligibility.ts) --
  // never a label-string match, which cannot correctly express "a Boys/
  // Mixed host must never be offered a Girls identity, at any age." Tournament
  // mode deliberately offers the FULL compatible pathway (any age within the
  // same gender lane), not just the host's own exact age -- an ordinary 1-v-1
  // fixture request stays strict-same-age via opponent-resolver.tsx's own
  // eligibleAgeGroupsFor, unaffected by this.
  const eligibleTypes = hostAgeGroup ? eligibleOppositionCanonicalTypes({ category: "youth", ageGroup: hostAgeGroup, gender: hostGender }, teamTypes, "tournament") : teamTypes
  const isDefaultAge = Boolean(selectedType && defaultType && selectedType.id === defaultType.id)
  // pendingOverrideId is only ever set by the "different age" branch of the
  // select's onChange (same-age choices commit immediately) -- so whenever
  // the confirm dialog is open, it is always a genuine age-group change; no
  // separate "is this actually a same-age squad choice" check is needed
  // here. If canonical_team_types ever grows distinct B/C squad rows, this
  // is the place to add the calmer same-age wording the product brief asks
  // for -- today there is only one canonical row per age (see NOTE below),
  // so that distinction cannot yet arise.
  const pendingType = teamTypes.find((t) => t.id === pendingOverrideId)

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">Opposition {index + 1}</span>
        {removable && (
          <button type="button" onClick={onRemove} className="text-xs font-medium text-destructive underline hover:text-destructive/80">
            Remove
          </button>
        )}
      </div>

      {!value.clubDirectoryId ? (
        <div className="mt-2">
          <Label className="text-ink/80">Club</Label>
          <input
            type="text"
            value={clubQuery}
            onChange={(e) => handleClubQueryChange(e.target.value)}
            placeholder="Search for the opposition club…"
            className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
          />
          {clubResults.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-1 rounded-lg border border-ink/10 bg-ink/[0.02] p-1.5">
              {clubResults.map((c) => (
                <li key={c.directoryId}>
                  <button
                    type="button"
                    onClick={() => handleClubSelect(c)}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-pitch-400"
                  >
                    <span className="text-sm font-medium text-ink">{c.clubName}</span>
                    {!c.activated && <span className="shrink-0 rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-medium text-amber-700">Not on Ovalball</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 rounded-md border border-ink/10 bg-ink/[0.02] px-3 py-2">
            <span className="text-sm font-medium text-ink">{value.clubName}</span>
            <button
              type="button"
              onClick={() => {
                onChange({ clubDirectoryId: null, clubName: null, clubActivated: false, clubId: null, canonicalTeamTypeId: null })
                setOverriding(false)
              }}
              className="text-xs font-medium text-ink/50 underline hover:text-ink"
            >
              Change
            </button>
          </div>
          {!value.clubActivated && <p className="text-xs text-amber-700">Club not yet claimed on Ovalball -- recorded, no fake acceptance.</p>}

          {!overriding ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label className="text-ink/80">Team / age group</Label>
                <p className="mt-1 text-sm text-ink">
                  {selectedType ? selectedType.label : "Resolving…"}
                  {value.clubActivated && value.canonicalTeamTypeId && (
                    <span className="ml-1.5 text-xs text-ink/40">({STATE_LABEL[stateFor(value.canonicalTeamTypeId)]})</span>
                  )}
                </p>
              </div>
              <button type="button" onClick={() => setOverriding(true)} className="shrink-0 text-xs font-medium text-forest-800 underline hover:text-forest-950">
                Override age
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor={`opp-team-${index}`} className="text-ink/80">
                  Team / age group
                </Label>
                <button
                  type="button"
                  onClick={() => setOverriding(false)}
                  className="text-xs font-medium text-ink/50 underline hover:text-ink"
                >
                  Use host&apos;s age
                </button>
              </div>
              <select
                id={`opp-team-${index}`}
                value={value.canonicalTeamTypeId ?? ""}
                onChange={(e) => {
                  const newId = e.target.value || null
                  if (!newId) {
                    onChange({ ...value, canonicalTeamTypeId: null })
                    return
                  }
                  const newType = teamTypes.find((t) => t.id === newId)
                  const sameAgeAsDefault = newType && defaultType && newType.ageGroup === defaultType.ageGroup
                  // A same-age choice (e.g. re-selecting the primary squad, or
                  // any future squad variant at the host's own age) commits
                  // immediately -- only a genuine age-group change needs the
                  // explicit "Are you sure?" gate below.
                  if (sameAgeAsDefault) onChange({ ...value, canonicalTeamTypeId: newId })
                  else setPendingOverrideId(newId)
                }}
                className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
              >
                <option value="">Choose a team…</option>
                {eligibleTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                    {value.clubActivated ? ` — ${STATE_LABEL[stateFor(t.id)]}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* A genuine age-group override requires an explicit confirm/cancel
              action, not passive warning text a user can silently ignore --
              only reachable via the "different age" branch above, so a same-
              age squad choice never triggers this. */}
          <Dialog open={Boolean(pendingOverrideId)} onOpenChange={(next) => !next && setPendingOverrideId(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  Invite {value.clubName} {pendingType?.label}?
                </DialogTitle>
                <DialogDescription>
                  The host team is {hostAgeGroup ? `${defaultType?.label ?? hostAgeGroup}` : "a different age"}. You are inviting a different age group to this tournament.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button type="button" variant="ghost" className="h-9" />}>Cancel</DialogClose>
                <Button
                  type="button"
                  className="h-9"
                  onClick={() => {
                    if (pendingOverrideId) onChange({ ...value, canonicalTeamTypeId: pendingOverrideId })
                    setPendingOverrideId(null)
                  }}
                >
                  Yes, use {pendingType?.label}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {value.canonicalTeamTypeId && !isDefaultAge && (
            <p className="text-xs text-ink/50">
              Inviting {selectedType?.label} &mdash; a different age group than the host ({defaultType?.label ?? hostAgeGroup}).
            </p>
          )}
          {value.clubActivated && value.canonicalTeamTypeId && stateFor(value.canonicalTeamTypeId) !== "active" && (
            <p className="text-xs text-amber-700">
              {value.clubName} does not currently have this team active on Ovalball. They will be asked to{" "}
              {stateFor(value.canonicalTeamTypeId) === "inactive" ? "reactivate" : "create"} it before accepting the invitation.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
