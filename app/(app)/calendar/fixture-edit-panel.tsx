"use client"

import { useState } from "react"
import { ArrowLeftRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { swapCalendarFixtureHomeAway, updateCalendarFixture, updateCalendarFixtureOpposition, type TeamSearchResult } from "./fixture-actions"
import { OpponentPicker } from "./opponent-picker"

export interface EditableFixture {
  id: string
  owningTeamId: string
  owningTeamName: string
  opponentTeamId: string | null
  opponentDirectoryId: string | null
  oppositionText: string
  kickoffDate: string
  kickoffTime: string | null
  status: string
  competitionEditionId: string | null
  pitchId: string | null
  notes: string | null
}

export interface EditCompetitionOption {
  id: string
  label: string
}
export interface EditPitchOption {
  id: string
  displayName: string
}

const STATUS_OPTIONS = ["Planned", "Booked", "To Be Determined", "Cancelled", "Completed"] as const

/**
 * The structured edit surface embedded inside the fixture Sheet's Edit
 * toggle (Calendar mega-spec, Section AB/DF: never dump the whole Site
 * Admin form here -- this is deliberately just the fields the spec names:
 * Date, Kickoff, Home/Away, Opponent club/team, Competition, Pitch,
 * Status, Notes). Writes go straight to the SAME master fixtures row via
 * fixture-actions.ts -- update_fixture_opposition/swap_fixture_home_away
 * for opposition/home-away, a plain RLS-scoped update for everything else.
 */
export function FixtureEditPanel({
  fixture,
  competitions,
  pitches,
  onSaved,
  onCancel,
}: {
  fixture: EditableFixture
  competitions: EditCompetitionOption[]
  pitches: EditPitchOption[]
  onSaved: () => void
  onCancel: () => void
}) {
  const [opponentTeam, setOpponentTeam] = useState<TeamSearchResult | null>(null)
  const [opponentDirectoryId, setOpponentDirectoryId] = useState<string | null>(fixture.opponentDirectoryId)
  const [rawText, setRawText] = useState(fixture.opponentTeamId ? "" : fixture.oppositionText)
  const [kickoffDate, setKickoffDate] = useState(fixture.kickoffDate)
  const [kickoffTime, setKickoffTime] = useState(fixture.kickoffTime ?? "")
  const [status, setStatus] = useState(fixture.status)
  const [competitionEditionId, setCompetitionEditionId] = useState(fixture.competitionEditionId ?? "")
  const [pitchId, setPitchId] = useState(fixture.pitchId ?? "")
  const [notes, setNotes] = useState(fixture.notes ?? "")
  const [saving, setSaving] = useState(false)
  const [swapping, setSwapping] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const oppositionChanged = opponentTeam !== null || opponentDirectoryId !== fixture.opponentDirectoryId || (fixture.opponentTeamId === null && rawText !== fixture.oppositionText)

  async function handleSave() {
    setSaving(true)
    setError(null)

    if (oppositionChanged) {
      const oppResult = await updateCalendarFixtureOpposition({
        fixtureId: fixture.id,
        opponentTeamId: opponentTeam?.teamId ?? null,
        opponentDirectoryId,
        rawOppositionText: opponentTeam ? opponentTeam.clubName : rawText.trim(),
      })
      if (!oppResult.ok) {
        setSaving(false)
        setError(oppResult.error)
        return
      }
    }

    const result = await updateCalendarFixture({
      fixtureId: fixture.id,
      kickoffDate,
      kickoffTime: kickoffTime || null,
      status,
      competitionEditionId: competitionEditionId || null,
      pitchId: pitchId || null,
      notes: notes.trim() || null,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onSaved()
  }

  async function handleSwap() {
    setSwapping(true)
    setError(null)
    const result = await swapCalendarFixtureHomeAway(fixture.id)
    setSwapping(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onSaved()
  }

  return (
    <div className="flex flex-col gap-4 border-t border-ink/10 pt-4 animate-in fade-in slide-in-from-top-1 duration-150">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="edit-date" className="text-ink/80">
            Date
          </Label>
          <Input id="edit-date" type="date" value={kickoffDate} onChange={(e) => setKickoffDate(e.target.value)} className="mt-1.5 h-10 border-ink/15 bg-white" />
        </div>
        <div>
          <Label htmlFor="edit-time" className="text-ink/80">
            Kickoff
          </Label>
          <Input id="edit-time" type="time" value={kickoffTime} onChange={(e) => setKickoffTime(e.target.value)} className="mt-1.5 h-10 border-ink/15 bg-white" />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label className="text-ink/80">Home / Away</Label>
          <Dialog>
            <DialogTrigger
              render={<Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs text-ink/60" disabled={swapping || !fixture.opponentTeamId} />}
            >
              <ArrowLeftRight className="size-3.5" />
              {swapping ? "Swapping…" : "Swap"}
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Swap home and away?</DialogTitle>
                <DialogDescription>
                  <span className="font-medium text-ink">{fixture.oppositionText}</span> becomes the home side and{" "}
                  <span className="font-medium text-ink">{fixture.owningTeamName}</span> becomes away. If a result is
                  already recorded, the score swaps with them, so it stays correctly attributed &mdash; this is a
                  single, deliberate correction, not two separate label edits.
                </DialogDescription>
              </DialogHeader>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <DialogClose render={<Button type="button" variant="ghost" className="h-9" />}>Cancel</DialogClose>
                <Button type="button" className="h-9" disabled={swapping} onClick={handleSwap}>
                  {swapping ? "Swapping…" : "Swap home/away"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        {!fixture.opponentTeamId && <p className="mt-1 text-xs text-ink/40">Swap needs a resolved opponent team first.</p>}
      </div>

      <OpponentPicker
        owningTeamId={fixture.owningTeamId}
        selectedTeam={opponentTeam}
        onSelectTeam={setOpponentTeam}
        selectedDirectoryId={opponentDirectoryId}
        onSelectDirectory={setOpponentDirectoryId}
        rawText={rawText}
        onRawTextChange={setRawText}
      />

      {competitions.length > 0 && (
        <div>
          <Label htmlFor="edit-competition" className="text-ink/80">
            Competition
          </Label>
          <select
            id="edit-competition"
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

      {pitches.length > 0 && (
        <div>
          <Label htmlFor="edit-pitch" className="text-ink/80">
            Pitch
          </Label>
          <select
            id="edit-pitch"
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

      <div>
        <Label htmlFor="edit-status" className="text-ink/80">
          Status
        </Label>
        <select
          id="edit-status"
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

      <div>
        <Label htmlFor="edit-notes" className="text-ink/80">
          Notes
        </Label>
        <textarea
          id="edit-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
        />
      </div>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" className="h-9" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" className="h-9 flex-1" disabled={saving} onClick={handleSave}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  )
}
