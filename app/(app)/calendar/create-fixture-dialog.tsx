"use client"

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { createFixture } from "../admin/fixtures/actions"
import { createFixtureRequest } from "../fixtures/new/actions"
import { GAME_TYPE_OPTIONS } from "../admin/fixtures/types"
import { getRequestingTeamIdentity, type TeamSearchResult } from "./fixture-actions"
import { OpponentPicker } from "./opponent-picker"

const SECTION_LABEL = "text-xs font-medium tracking-[0.06em] text-ink/45 uppercase"

export interface CompetitionOption {
  id: string
  label: string
}

export interface CreateFixtureTeamOption {
  id: string
  /** Full, readable name (e.g. "Under 12") -- this is a real selector, not a tight chip, so it always uses the full canonical name (Reconciliation complaint 2). */
  label: string
}

export interface CreateFixturePitchOption {
  id: string
  displayName: string
}

/**
 * Click-empty-slot -> Create Fixture (Calendar mega-spec, sections AD-AF;
 * Reconciliation pass complaints 3-6, 43). Proposes the fixture through
 * the SAME fixture_request_groups/fixture_requests negotiation model
 * every other club-to-club fixture in this app goes through -- creating a
 * Calendar-only "instantly confirmed" fixture would let one club
 * unilaterally commit an opponent who never agreed, breaking the
 * two-sided fairness this app already enforces everywhere else. Only
 * genuinely UNRESOLVED/external opposition (no Ovalball club to negotiate
 * with) effectively behaves like an instant booking, because there is no
 * one on the other side to ask.
 *
 * Exposes the full field set the reconciliation pass required: Your Team
 * (a real picker over the club's own active teams, never the Team
 * Directory), Rugby Code (read-only, implied by Your Team), Season
 * (read-only, implied by whichever season Calendar is currently viewing
 * -- creating a fixture in a different season is a deliberate act done by
 * navigating Calendar there first, not a free field here), Date (now
 * genuinely editable, not a locked prefill), Kickoff, Fixture Type,
 * Competition, Home/Away, Opposition Club/Team (via OpponentPicker),
 * Pitch/Venue (only offered when Home -- an Away fixture uses the
 * opponent's pitch, which this club has no authority to set), Notes.
 */
export function CreateFixtureDialog({
  open,
  onOpenChange,
  clubId,
  teamOptions,
  defaultTeamId,
  date,
  rugbyCode,
  season,
  range,
  competitions,
  pitches,
  onWantTournament,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  clubId: string
  /** The club's own active, creatable teams (Reconciliation complaint 4: never the Team Directory). */
  teamOptions: CreateFixtureTeamOption[]
  defaultTeamId: string
  /** The date Calendar prefills from context -- reviewable and changeable below, never locked in silently (complaint 3). */
  date: string
  rugbyCode: string | null
  season: { id: string; label: string } | null
  /** Pre-Season/Main-Season date-boundary addendum: bounds the date field client-side only -- a fixture REQUEST negotiates with another club and is created via the shared cross-app createFixtureRequest action, so its own server-side validation is intentionally out of this pass's scope (see the final report). */
  range?: { start: string; end: string } | null
  competitions: CompetitionOption[]
  pitches: CreateFixturePitchOption[]
  /** Selecting "Tournament" branches away from this dialog entirely -- never a normal one-opponent form with opponents bolted on (Section DH). */
  onWantTournament: () => void
}) {
  const [teamId, setTeamId] = useState(defaultTeamId)
  const [fixtureDate, setFixtureDate] = useState(date)
  const [gameType, setGameType] = useState<string>("Friendly")
  const [homeAway, setHomeAway] = useState<"home" | "away">("home")
  const [pitchId, setPitchId] = useState("")
  const [opponentTeam, setOpponentTeam] = useState<TeamSearchResult | null>(null)
  const [opponentDirectoryId, setOpponentDirectoryId] = useState<string | null>(null)
  const [rawText, setRawText] = useState("")
  const [missingTeamGender, setMissingTeamGender] = useState<"boys" | "girls" | null>(null)
  const [missingTeamSquad, setMissingTeamSquad] = useState<string | null>(null)
  const [missingTeamAgeGroup, setMissingTeamAgeGroup] = useState<string | null>(null)
  const [missingTeamClubId, setMissingTeamClubId] = useState<string | null>(null)
  const [missingTeamClubName, setMissingTeamClubName] = useState<string | null>(null)

  useEffect(() => {
    if (!teamId) return
    getRequestingTeamIdentity(teamId).then((identity) => setMissingTeamAgeGroup(identity?.ageGroup ?? null))
  }, [teamId])
  const [kickoffTime, setKickoffTime] = useState("")
  const [competitionEditionId, setCompetitionEditionId] = useState("")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setTeamId(defaultTeamId)
    setFixtureDate(date)
    setGameType("Friendly")
    setHomeAway("home")
    setPitchId("")
    setOpponentTeam(null)
    setOpponentDirectoryId(null)
    setRawText("")
    setMissingTeamGender(null)
    setMissingTeamSquad(null)
    setMissingTeamClubId(null)
    setMissingTeamClubName(null)
    setKickoffTime("")
    setCompetitionEditionId("")
    setNotes("")
    setError(null)
  }

  function handleGameTypeChange(value: string) {
    if (value === "Tournament") {
      onOpenChange(false)
      onWantTournament()
      return
    }
    setGameType(value)
  }

  async function handleCreate() {
    if (!opponentDirectoryId && !opponentTeam && !rawText.trim() && !missingTeamGender) {
      setError("Choose an opponent club, or describe the opposition.")
      return
    }
    if (missingTeamGender && !missingTeamAgeGroup) {
      setError("Still resolving your team's age group -- try again in a moment.")
      return
    }
    setSaving(true)
    setError(null)

    // Live bug fix (this dialog's own docstring already promises it): a
    // genuinely external/unclaimed opponent -- plain raw text, or a
    // directory club with no Ovalball account -- has no one who could ever
    // accept a request, so createFixtureRequest left it sitting forever in
    // fixture_request_groups, never becoming a real fixture (confirmed
    // live). Only a real, resolvable Ovalball counterpart (a matched team,
    // or a genuinely claimed club still missing a matching team) goes
    // through that two-sided negotiation; everything else now creates the
    // fixture directly through the same createFixture Fixture Management's
    // own Add Fixture dialog uses -- one canonical creation path, not two.
    const hasRealOvalballOpponent = Boolean(opponentTeam?.teamId) || Boolean(missingTeamClubId)
    if (hasRealOvalballOpponent) {
      const result = await createFixtureRequest({
        requestingClubId: clubId,
        opponentDirectoryId,
        opponentClubId: missingTeamClubId,
        rawOpponentText: opponentTeam ? opponentTeam.clubName : rawText.trim() || missingTeamClubName || "",
        proposedDate: fixtureDate,
        notes: notes.trim() || null,
        gameType,
        competitionEditionId: competitionEditionId || null,
        skipRedirect: true,
        teams: [
          {
            teamId,
            venuePreference: homeAway,
            preferredKickoffTime: kickoffTime || null,
            note: null,
            targetTeamId: opponentTeam?.teamId ?? null,
            targetTeamAgeGroup: !opponentTeam?.teamId && missingTeamGender ? missingTeamAgeGroup : null,
            targetTeamGender: !opponentTeam?.teamId ? missingTeamGender : null,
            targetTeamSquadDesignation: !opponentTeam?.teamId ? missingTeamSquad : null,
            pitchId: pitchId || null,
          },
        ],
      })
      setSaving(false)
      if (!result.ok) {
        setError(result.error)
        return
      }
      onOpenChange(false)
      reset()
      return
    }

    const result = await createFixture({
      owningTeamId: teamId,
      homeAway: homeAway === "home" ? "Home" : "Away",
      opponentTeamId: null,
      opponentDirectoryId,
      rawOppositionText: rawText.trim() || "Opponent to be confirmed",
      kickoffDate: fixtureDate || null,
      kickoffTime: kickoffTime || null,
      gameType: gameType || null,
      status: "Planned",
      venueId: null,
      notes: notes.trim(),
      competitionEditionId: competitionEditionId || null,
      pitchId: homeAway === "home" ? pitchId || null : null,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onOpenChange(false)
    reset()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="max-h-[90vh] w-full max-w-lg overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create fixture</DialogTitle>
          <DialogDescription>
            {rugbyCode === "league" ? "Rugby League" : "Rugby Union"}
            {season && <> &middot; {season.label}</>}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <div>
            <p className={SECTION_LABEL}>Fixture</p>
            <div className="mt-2 grid grid-cols-1 gap-4 rounded-lg border border-ink/10 bg-white p-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="cal-your-team" className="text-ink/80">
                  Your team
                </Label>
                {teamOptions.length > 1 ? (
                  <select
                    id="cal-your-team"
                    value={teamId}
                    onChange={(e) => setTeamId(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
                  >
                    {teamOptions.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="mt-1.5 flex h-10 items-center rounded-lg border border-ink/10 bg-ink/[0.02] px-3 text-sm text-ink/70">
                    {teamOptions.find((t) => t.id === teamId)?.label ?? "Your team"}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="cal-fixture-date" className="text-ink/80">
                  Date
                </Label>
                <DatePicker id="cal-fixture-date" value={fixtureDate} onChange={setFixtureDate} minDate={range?.start} maxDate={range?.end} className="mt-1.5" />
              </div>
            </div>
          </div>

          <div>
            <p className={SECTION_LABEL}>Type &amp; side</p>
            <div className="mt-2 flex flex-col gap-4 rounded-lg border border-ink/10 bg-white p-4">
              <div>
                <Label htmlFor="cal-game-type" className="text-ink/80">
                  Fixture type
                </Label>
                <select
                  id="cal-game-type"
                  value={gameType}
                  onChange={(e) => handleGameTypeChange(e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
                >
                  {GAME_TYPE_OPTIONS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                  <option value="Tournament">Tournament&hellip;</option>
                </select>
              </div>
              <div>
                <Label className="text-ink/80">Home or away?</Label>
                <div className="mt-1.5 flex gap-2">
                  {(["home", "away"] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setHomeAway(opt)}
                      className={`h-9 rounded-full border px-4 text-sm font-medium ${
                        homeAway === opt ? "border-pitch-600 bg-pitch-600/10 text-forest-800" : "border-ink/15 bg-white text-ink/70"
                      }`}
                    >
                      {opt === "home" ? "Home" : "Away"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div>
            <p className={SECTION_LABEL}>Opponent</p>
            <div className="mt-2 rounded-lg border border-ink/10 bg-white p-4">
              <OpponentPicker
                owningTeamId={teamId}
                selectedTeam={opponentTeam}
                onSelectTeam={setOpponentTeam}
                selectedDirectoryId={opponentDirectoryId}
                onSelectDirectory={setOpponentDirectoryId}
                rawText={rawText}
                onRawTextChange={setRawText}
                missingTeamGender={missingTeamGender}
                onMissingTeamGenderChange={setMissingTeamGender}
                missingTeamSquad={missingTeamSquad}
                onMissingTeamSquadChange={setMissingTeamSquad}
                onMissingTeamClubIdChange={(clubId, clubName) => {
                  setMissingTeamClubId(clubId)
                  setMissingTeamClubName(clubName)
                }}
              />
            </div>
          </div>

          <div>
            <p className={SECTION_LABEL}>Schedule</p>
            <div className="mt-2 flex flex-col gap-4 rounded-lg border border-ink/10 bg-white p-4">
              <div>
                <Label htmlFor="cal-kickoff-time" className="text-ink/80">
                  Kickoff time
                </Label>
                <Input id="cal-kickoff-time" type="time" value={kickoffTime} onChange={(e) => setKickoffTime(e.target.value)} className="mt-1.5 h-10 border-ink/15 bg-white" />
              </div>

              {competitions.length > 0 && (
                <div>
                  <Label htmlFor="cal-competition" className="text-ink/80">
                    Competition (optional)
                  </Label>
                  <select
                    id="cal-competition"
                    value={competitionEditionId}
                    onChange={(e) => setCompetitionEditionId(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
                  >
                    <option value="">Not set</option>
                    {competitions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {homeAway === "home" && pitches.length > 0 && (
                <div>
                  <Label htmlFor="cal-pitch" className="text-ink/80">
                    Pitch / venue (optional)
                  </Label>
                  <select
                    id="cal-pitch"
                    value={pitchId}
                    onChange={(e) => setPitchId(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
                  >
                    <option value="">Not set</option>
                    {pitches.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.displayName}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          <div>
            <p className={SECTION_LABEL}>Notes</p>
            <div className="mt-2 rounded-lg border border-ink/10 bg-white p-4">
              <textarea
                id="cal-fixture-notes"
                aria-label="Notes (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Optional"
                className="w-full resize-none text-sm text-ink outline-none placeholder:text-ink/35"
              />
            </div>
          </div>

          {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" className="h-10" />}>Cancel</DialogClose>
          <Button type="button" className="h-10" disabled={saving} onClick={handleCreate}>
            {saving ? "Sending…" : "Propose fixture"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
