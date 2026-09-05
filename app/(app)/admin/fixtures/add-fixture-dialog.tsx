"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

import { listCompetitionEditionsForRugbyCode, type CompetitionEditionOption } from "@/lib/fixtures/competitions"

import { createFixture, getClubVenuesAndPitches, getRequestingTeamIdentity, type PitchWithVenueOption, type TeamSearchResult, type VenueOption } from "./actions"
import { GAME_TYPE_OPTIONS, STATUS_OPTIONS } from "./types"
import { OpponentResolver } from "./opponent-resolver"
import { OwningTeamResolver } from "./owning-team-resolver"
import { createTournamentWithOppositionAction } from "./tournament-fixture-actions"
import { TournamentOppositionEntry, type OppositionValue } from "./tournament-opposition-entry"

const EMPTY_OPPOSITION: OppositionValue = { clubDirectoryId: null, clubName: null, clubActivated: false, clubId: null, canonicalTeamTypeId: null }

const SECTION_LABEL = "text-xs font-medium tracking-[0.06em] text-ink/45 uppercase"

export function AddFixtureDialog({
  lockedClubId,
  lockedClubName,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  hideTrigger,
  initialTeamId,
  initialTeamLabel,
  initialDate,
  initialTournament,
}: {
  lockedClubId?: string
  lockedClubName?: string
  /** Controlled-open pair: pass both to let a caller (e.g. Calendar) open this dialog itself, instead of the built-in "+ Add fixture" trigger. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Suppress the built-in DialogTrigger button -- used together with the controlled-open pair, so a caller's own "click empty slot" affordance is the only way in. */
  hideTrigger?: boolean
  /** Calendar context prefill (Section 5 of the consolidation instruction) -- still fully editable, never locked beyond lockedClubId itself. */
  initialTeamId?: string
  initialTeamLabel?: string
  initialDate?: string
  initialTournament?: boolean
} = {}) {
  const router = useRouter()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = controlledOnOpenChange ?? setInternalOpen

  // Home/owning side: always a club's own real active team (Central
  // Fixture Participant Resolution -- the requester's own side is never
  // inventable, only the away/opposition side can be a missing-team
  // structured identity). Section 16-17: a Club Admin/Fixtures Secretary's
  // own club is fixed via lockedClubId -- never an open club search.
  const [homeClubId, setHomeClubId] = useState<string | null>(lockedClubId ?? null)
  const [homeClubName, setHomeClubName] = useState<string | null>(lockedClubName ?? null)
  const [homeTeamId, setHomeTeamId] = useState<string | null>(initialTeamId ?? null)
  const [homeTeamLabel, setHomeTeamLabel] = useState<string | null>(initialTeamLabel ?? null)

  const [homeAway, setHomeAway] = useState<"Home" | "Away">("Home")
  const [awayTeam, setAwayTeam] = useState<TeamSearchResult | null>(null)
  const [opponentDirectoryId, setOpponentDirectoryId] = useState<string | null>(null)
  const [oppositionText, setOppositionText] = useState("")
  const [kickoffDate, setKickoffDate] = useState(initialDate ?? "")
  const [kickoffTime, setKickoffTime] = useState("")
  const [gameType, setGameType] = useState<string>("")
  const [status, setStatus] = useState<string>("Planned")
  const [notes, setNotes] = useState("")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [missingTeamGender, setMissingTeamGender] = useState<"boys" | "girls" | null>(null)
  const [missingTeamSquad, setMissingTeamSquad] = useState<string | null>(null)
  const [missingTeamAgeGroup, setMissingTeamAgeGroup] = useState<string | null>(null)
  const [pendingRequestSent, setPendingRequestSent] = useState(false)
  // Host's own gender (distinct from missingTeamGender, which is the
  // user's own selected gender for the AWAY side's missing-team identity)
  // -- feeds the Tournament opposition entries' age-default/eligibility.
  const [hostGender, setHostGender] = useState<string | null>(null)

  const [rugbyCode, setRugbyCode] = useState<string | null>(null)
  const [competitions, setCompetitions] = useState<CompetitionEditionOption[]>([])
  const [competitionEditionId, setCompetitionEditionId] = useState<string>("")
  const [venues, setVenues] = useState<VenueOption[]>([])
  const [venueId, setVenueId] = useState<string>("")
  const [venueTouched, setVenueTouched] = useState(false)
  const [allPitches, setAllPitches] = useState<PitchWithVenueOption[]>([])
  const [pitchId, setPitchId] = useState<string>("")
  // Pitch options are scoped to whichever venue is currently selected --
  // never every pitch from every venue at once (Section 11/12 of the
  // venue instruction). A legacy pitch with no venue_id still shows when
  // no venue is selected, so existing unattached pitches remain usable.
  const pitches = allPitches.filter((p) => (venueId ? p.venueId === venueId : true))

  // Tournament (Section 1-13): host-only, no Away orientation, a repeatable
  // opposition list instead of one opponent -- routes creation through
  // create_tournament + invite_tournament_participant instead of
  // createFixture, one master tournament event, never one fixtures row
  // per opponent.
  const [isTournament, setIsTournament] = useState(Boolean(initialTournament))
  const [opposition, setOpposition] = useState<OppositionValue[]>([{ ...EMPTY_OPPOSITION }, { ...EMPTY_OPPOSITION }, { ...EMPTY_OPPOSITION }])
  const [tournamentSuccess, setTournamentSuccess] = useState<string | null>(null)

  useEffect(() => {
    const identityPromise = homeTeamId ? getRequestingTeamIdentity(homeTeamId) : Promise.resolve(null)
    identityPromise.then((identity) => {
      setMissingTeamAgeGroup(identity?.ageGroup ?? null)
      setRugbyCode(identity?.rugbyCode ?? null)
      setHostGender(identity?.gender ?? null)
    })
  }, [homeTeamId])

  useEffect(() => {
    const competitionsPromise = rugbyCode ? listCompetitionEditionsForRugbyCode(rugbyCode) : Promise.resolve([])
    competitionsPromise.then(setCompetitions)
  }, [rugbyCode])

  // Venue/pitch options belong to whichever club ends up Home -- the away
  // club's own venues aren't relevant to where this fixture is actually
  // played (Section 12). Defaults to that club's own default home venue,
  // but stays deliberately overridable (Section 6) -- venueTouched tracks
  // whether the user has deliberately changed it, so a later homeClub
  // change (e.g. switching Home/Away) doesn't clobber their choice.
  useEffect(() => {
    const homeClub = isTournament ? homeClubId : homeAway === "Home" ? homeClubId : awayTeam?.clubId ?? null
    const venuesPromise = homeClub ? getClubVenuesAndPitches(homeClub) : Promise.resolve({ venues: [], pitches: [] })
    venuesPromise.then(({ venues: v, pitches: p }) => {
      setVenues(v)
      setAllPitches(p)
      if (!venueTouched) {
        const defaultVenue = v.find((x) => x.isDefaultHome)
        setVenueId(defaultVenue?.id ?? "")
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- venueTouched intentionally excluded: re-running this effect when it flips would immediately re-fetch and could race the user's own selection.
  }, [homeAway, homeClubId, awayTeam, isTournament])

  function reset() {
    setHomeClubId(lockedClubId ?? null)
    setHomeClubName(lockedClubName ?? null)
    setHomeTeamId(initialTeamId ?? null)
    setHomeTeamLabel(initialTeamLabel ?? null)
    setHomeAway("Home")
    setAwayTeam(null)
    setOpponentDirectoryId(null)
    setOppositionText("")
    setKickoffDate(initialDate ?? "")
    setKickoffTime("")
    setGameType("")
    setStatus("Planned")
    setNotes("")
    setError(null)
    setMissingTeamGender(null)
    setMissingTeamSquad(null)
    setMissingTeamAgeGroup(null)
    setPendingRequestSent(false)
    setRugbyCode(null)
    setCompetitions([])
    setCompetitionEditionId("")
    setVenues([])
    setVenueId("")
    setVenueTouched(false)
    setAllPitches([])
    setPitchId("")
    setIsTournament(Boolean(initialTournament))
    setOpposition([{ ...EMPTY_OPPOSITION }, { ...EMPTY_OPPOSITION }, { ...EMPTY_OPPOSITION }])
    setTournamentSuccess(null)
  }

  function updateOpposition(i: number, next: OppositionValue) {
    setOpposition((prev) => prev.map((o, idx) => (idx === i ? next : o)))
  }

  async function handleCreateTournament() {
    if (!homeTeamId) {
      setError("Choose the host (home) team.")
      return
    }
    if (!kickoffDate) {
      setError("A date is required to create a tournament.")
      return
    }
    const filled = opposition.filter((o) => o.clubDirectoryId && o.canonicalTeamTypeId)
    if (filled.length === 0) {
      setError("Add at least one opposition club and team.")
      return
    }
    setCreating(true)
    setError(null)
    const result = await createTournamentWithOppositionAction({
      hostTeamId: homeTeamId,
      eventDate: kickoffDate,
      kickoffTime: kickoffTime || null,
      pitchId: pitchId || null,
      venueId: venueId || null,
      competitionEditionId: competitionEditionId || null,
      notes: notes || null,
      opposition: filled.map((o) => ({ kind: "club_and_type" as const, clubDirectoryId: o.clubDirectoryId!, canonicalTeamTypeId: o.canonicalTeamTypeId! })),
    })
    setCreating(false)
    if (result.ok) {
      setTournamentSuccess(`Tournament created with ${filled.length} opposition invitation(s) sent.`)
    } else {
      setError(result.error)
    }
  }

  async function handleCreate() {
    if (isTournament) {
      await handleCreateTournament()
      return
    }
    if (!homeTeamId) {
      setError("Choose the owning (home) team.")
      return
    }
    const opponentDescription = awayTeam ? awayTeam.teamName : oppositionText.trim()
    if (!opponentDescription && !missingTeamGender) {
      setError("Choose an opponent team, or describe the opposition.")
      return
    }
    if (missingTeamGender && !missingTeamAgeGroup) {
      setError("Still resolving the owning team's age group -- try again in a moment.")
      return
    }
    setCreating(true)
    setError(null)

    // Live bug fix: this branch used to force EVERY Club Admin/Fixtures
    // Secretary submission (lockedClubId is only ever set on that surface)
    // through createFixtureRequest unconditionally -- even for a raw-text
    // or unclaimed-directory opponent with no Ovalball account to ever
    // accept it, silently leaving a pending request that could never
    // resolve into a real fixture (confirmed live: the row landed in
    // fixture_request_groups, never fixtures, and neither Fixture
    // Management nor Calendar could ever show it). This dialog's own
    // docstring already says an unresolved/external opponent should
    // "effectively behave like an instant booking, because there is no
    // one on the other side to ask" -- createFixture (below) already
    // implements exactly that distinction server-side (a genuinely
    // active, claimed opponent club routes to the request flow itself;
    // an external/unclaimed one inserts the fixture directly) and is
    // safe to call from a Club Admin now that its own authorization
    // defers to fixtures_insert_scoped's RLS rather than requiring Site
    // Admin. One canonical creation path for every caller, never two.
    const result = await createFixture({
      owningTeamId: homeTeamId,
      homeAway,
      opponentTeamId: awayTeam?.teamId ?? null,
      opponentDirectoryId,
      rawOppositionText: opponentDescription || "Opponent to be confirmed",
      kickoffDate: kickoffDate || null,
      kickoffTime: kickoffTime || null,
      gameType: gameType || null,
      status,
      venueId: venueId || null,
      notes,
      competitionEditionId: competitionEditionId || null,
      pitchId: pitchId || null,
      targetTeamAgeGroup: !awayTeam && missingTeamGender ? missingTeamAgeGroup : null,
      targetTeamGender: !awayTeam ? missingTeamGender : null,
      targetTeamSquadDesignation: !awayTeam ? missingTeamSquad : null,
    })
    setCreating(false)
    if (result.ok) {
      if (result.pendingRequest) {
        setPendingRequestSent(true)
        return
      }
      setOpen(false)
      reset()
      router.push(`/admin/fixtures/${result.fixtureId}`)
    } else {
      setError(result.error)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      {!hideTrigger && <DialogTrigger render={<Button type="button" className="h-10" />}>+ Add fixture</DialogTrigger>}
      <DialogContent className="max-h-[90vh] w-full max-w-lg overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isTournament ? "Add a tournament" : "Add a fixture"}</DialogTitle>
          <DialogDescription>
            {isTournament
              ? "The host club and at least one opposition entry are required. A date is required to schedule it."
              : "Home and away sides are required. A kickoff date is required to publish it as scheduled."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <div>
            <p className={SECTION_LABEL}>Home</p>
            <div className="mt-2 rounded-lg border border-ink/10 bg-white p-4">
              <OwningTeamResolver
                selectedClubId={homeClubId}
                selectedClubName={homeClubName}
                selectedTeamId={homeTeamId}
                selectedTeamLabel={homeTeamLabel}
                lockedClubId={lockedClubId}
                lockedClubName={lockedClubName}
                onSelect={(clubId, clubName, teamId, teamLabel) => {
                  setHomeClubId(lockedClubId ?? clubId)
                  setHomeClubName(lockedClubName ?? clubName)
                  setHomeTeamId(teamId)
                  setHomeTeamLabel(teamLabel)
                }}
              />
              {rugbyCode && <p className="mt-2.5 text-xs text-ink/40">Rugby {rugbyCode === "union" ? "Union" : "League"}</p>}
            </div>
          </div>

          <label className="flex items-center gap-2 rounded-lg border border-ink/10 bg-ink/[0.02] px-3.5 py-2.5 text-sm font-medium text-ink">
            <input
              type="checkbox"
              checked={isTournament}
              onChange={(e) => {
                setIsTournament(e.target.checked)
                setHomeAway("Home")
              }}
              className="size-4 rounded border-ink/25 accent-pitch-600"
            />
            Tournament
          </label>
          {isTournament && (
            <p className="-mt-3 text-xs text-ink/45">
              The host team&apos;s own side is fixed as home &mdash; an away club cannot create or control another club&apos;s tournament from this form.
            </p>
          )}

          {!isTournament && (
            <div>
              <Label className="text-ink/80">Is the home team playing home or away?</Label>
              <div className="mt-1.5 flex gap-2">
                {(["Home", "Away"] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setHomeAway(opt)}
                    className={`h-9 rounded-full border px-4 text-sm font-medium ${
                      homeAway === opt ? "border-pitch-600 bg-pitch-600/10 text-forest-800" : "border-ink/15 bg-white text-ink/70"
                    }`}
                  >
                    {opt.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isTournament && (
            <div>
              <div className="flex items-center justify-between">
                <p className={SECTION_LABEL}>Opposition</p>
                <button
                  type="button"
                  onClick={() => setOpposition((prev) => [...prev, { ...EMPTY_OPPOSITION }])}
                  className="text-xs font-medium text-forest-800 underline hover:text-forest-950"
                >
                  + Add opposition
                </button>
              </div>
              <div className="mt-2 flex flex-col gap-3 rounded-lg border border-ink/10 bg-white p-4">
                {opposition.map((o, i) => (
                  <TournamentOppositionEntry
                    key={i}
                    index={i}
                    value={o}
                    hostAgeGroup={missingTeamAgeGroup}
                    hostGender={hostGender}
                    onChange={(next) => updateOpposition(i, next)}
                    onRemove={() => setOpposition((prev) => prev.filter((_, idx) => idx !== i))}
                    removable={opposition.length > 1}
                  />
                ))}
              </div>
              {tournamentSuccess && (
                <p className="mt-3 rounded-lg border border-forest-800/20 bg-forest-800/5 px-3 py-2 text-sm text-forest-800">{tournamentSuccess}</p>
              )}
            </div>
          )}

          {!isTournament && (
          <div>
            <p className={SECTION_LABEL}>Away</p>
            <div className="mt-2 rounded-lg border border-ink/10 bg-white p-4">
              <OpponentResolver
                owningTeamId={homeTeamId}
                selectedTeam={awayTeam}
                onSelectTeam={setAwayTeam}
                selectedDirectoryId={opponentDirectoryId}
                onSelectDirectory={setOpponentDirectoryId}
                rawText={oppositionText}
                onRawTextChange={setOppositionText}
                missingTeamGender={missingTeamGender}
                onMissingTeamGenderChange={setMissingTeamGender}
                missingTeamSquad={missingTeamSquad}
                onMissingTeamSquadChange={setMissingTeamSquad}
                missingTeamAgeGroup={missingTeamAgeGroup}
                onMissingTeamAgeGroupChange={setMissingTeamAgeGroup}
              />
            </div>
          </div>
          )}

          {!isTournament && pendingRequestSent && (
            <p className="rounded-lg border border-forest-800/20 bg-forest-800/5 px-3 py-2 text-sm text-forest-800">
              Fixture request sent -- the opponent club must accept &amp; create the team before this fixture is confirmed. It will appear in Fixture Management once accepted.
            </p>
          )}

          <div>
            <p className={SECTION_LABEL}>When</p>
            <div className="mt-2 rounded-lg border border-ink/10 bg-white p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="kickoff-date" className="text-ink/80">
                    Kickoff date
                  </Label>
                  <DatePicker id="kickoff-date" value={kickoffDate} onChange={setKickoffDate} placeholder="Select kickoff date" className="mt-1.5" />
                </div>
                <div>
                  <Label htmlFor="kickoff-time" className="text-ink/80">
                    Kickoff time
                  </Label>
                  <Input id="kickoff-time" type="time" value={kickoffTime} onChange={(e) => setKickoffTime(e.target.value)} className="mt-1.5 h-10 border-ink/15 bg-white" />
                </div>
              </div>
              <p className="mt-2.5 text-xs text-ink/40">Season is determined automatically from the kickoff date.</p>
            </div>
          </div>

          <div>
            <p className={SECTION_LABEL}>Details</p>
            <div className="mt-2 flex flex-col gap-4 rounded-lg border border-ink/10 bg-white p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="game-type" className="text-ink/80">
                    Game type
                  </Label>
                  <select
                    id="game-type"
                    value={gameType}
                    onChange={(e) => setGameType(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
                  >
                    <option value="">Not set</option>
                    {GAME_TYPE_OPTIONS.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="status" className="text-ink/80">
                    Status
                  </Label>
                  <select
                    id="status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="competition" className="text-ink/80">
                    Competition
                  </Label>
                  <select
                    id="competition"
                    value={competitionEditionId}
                    onChange={(e) => setCompetitionEditionId(e.target.value)}
                    disabled={!rugbyCode}
                    className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600 disabled:opacity-50"
                  >
                    <option value="">Not set</option>
                    {competitions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.competitionName} &middot; {c.seasonName}
                      </option>
                    ))}
                  </select>
                  {rugbyCode && competitions.length === 0 && <p className="mt-1 text-xs text-ink/40">No active competitions for this rugby code yet.</p>}
                </div>
                <div>
                  <Label htmlFor="venue" className="text-ink/80">
                    Venue
                  </Label>
                  <select
                    id="venue"
                    value={venueId}
                    onChange={(e) => {
                      setVenueId(e.target.value)
                      setVenueTouched(true)
                      setPitchId("")
                    }}
                    disabled={venues.length === 0}
                    className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600 disabled:opacity-50"
                  >
                    <option value="">Not set</option>
                    {venues.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                        {v.isDefaultHome ? " (Default)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="pitch" className="text-ink/80">
                    Pitch
                  </Label>
                  <select
                    id="pitch"
                    value={pitchId}
                    onChange={(e) => setPitchId(e.target.value)}
                    disabled={pitches.length === 0}
                    className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600 disabled:opacity-50"
                  >
                    <option value="">Not set</option>
                    {pitches.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.displayName}
                      </option>
                    ))}
                  </select>
                  {venueId && pitches.length === 0 && <p className="mt-1 text-xs text-ink/40">No pitches assigned to this venue yet.</p>}
                </div>
              </div>

              <div>
                <Label htmlFor="fixture-notes" className="text-ink/80">
                  Notes
                </Label>
                <textarea
                  id="fixture-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
                />
              </div>
            </div>
          </div>

          {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

          <Button type="button" className="h-10 w-full" disabled={creating} onClick={handleCreate}>
            {creating ? "Creating…" : isTournament ? "Create tournament" : "Create fixture"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
