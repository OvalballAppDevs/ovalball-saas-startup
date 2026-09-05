"use client"

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { listCompetitionEditionsForRugbyCode, type CompetitionEditionOption } from "@/lib/fixtures/competitions"

import { updateFixture, updateFixtureCompetition, type TeamSearchResult } from "../actions"
import { GAME_TYPE_OPTIONS, STATUS_OPTIONS } from "../types"

export interface EditFixtureInitial {
  fixtureId: string
  owningTeamId: string
  homeAway: "Home" | "Away" | "TBD" | "Not Applicable"
  rawOppositionText: string
  opponentTeam: TeamSearchResult | null
  opponentDirectoryId: string | null
  kickoffDate: string
  kickoffTime: string
  gameType: string
  status: string
  notes: string
  rugbyCode: string
  competitionEditionId: string | null
}

/**
 * Opposition editing lives in the hero now (OpponentTeamEditor, next to
 * the away/home badge, alongside the symmetric OwningTeamEditor for the
 * other side) -- deliberately NOT duplicated here too (Reconciliation
 * complaint 34/35: one operation, one place). This form covers everything
 * else: scheduling, status, game type, competition, notes.
 */
export function EditFixtureForm({ initial }: { initial: EditFixtureInitial }) {
  const [form, setForm] = useState(initial)
  // Tracks what's actually been saved, separately from the `initial` prop
  // (this form doesn't force a full page refresh after saving) -- without
  // this, the unsaved-changes guard below would keep firing forever after
  // a successful save, since `form` would never again equal the original
  // `initial` prop.
  const [savedForm, setSavedForm] = useState(initial)
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [error, setError] = useState<string | null>(null)
  const [competitionOptions, setCompetitionOptions] = useState<CompetitionEditionOption[]>([])
  const isDirty = JSON.stringify(form) !== JSON.stringify(savedForm)

  useEffect(() => {
    if (!isDirty) return
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [isDirty])

  useEffect(() => {
    let active = true
    listCompetitionEditionsForRugbyCode(initial.rugbyCode).then((options) => {
      if (active) setCompetitionOptions(options)
    })
    return () => {
      active = false
    }
  }, [initial.rugbyCode])

  async function handleSave() {
    setStatus("saving")
    setError(null)
    const [fixtureResult, competitionResult] = await Promise.all([
      updateFixture({
        fixtureId: form.fixtureId,
        homeAway: form.homeAway,
        rawOppositionText: form.rawOppositionText,
        kickoffDate: form.kickoffDate,
        kickoffTime: form.kickoffTime || null,
        gameType: form.gameType || null,
        status: form.status,
        venueId: null,
        notes: form.notes,
      }),
      form.competitionEditionId !== savedForm.competitionEditionId
        ? updateFixtureCompetition(form.fixtureId, form.competitionEditionId)
        : Promise.resolve({ ok: true as const }),
    ])
    if (fixtureResult.ok && competitionResult.ok) {
      setStatus("saved")
      setSavedForm(form)
      setTimeout(() => setStatus("idle"), 2000)
    } else {
      setStatus("error")
      setError(!fixtureResult.ok ? fixtureResult.error : !competitionResult.ok ? competitionResult.error : "Couldn't save changes.")
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="edit-date" className="text-ink/80">
            Kickoff date
          </Label>
          <Input
            id="edit-date"
            type="date"
            value={form.kickoffDate}
            onChange={(e) => setForm((f) => ({ ...f, kickoffDate: e.target.value }))}
            className="mt-1.5 h-10 border-ink/15 bg-white"
          />
        </div>
        <div>
          <Label htmlFor="edit-time" className="text-ink/80">
            Kickoff time
          </Label>
          <Input
            id="edit-time"
            type="time"
            value={form.kickoffTime}
            onChange={(e) => setForm((f) => ({ ...f, kickoffTime: e.target.value }))}
            className="mt-1.5 h-10 border-ink/15 bg-white"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="edit-home-away" className="text-ink/80">
            Venue side
          </Label>
          {/* Home <-> Away is deliberately NOT offered here -- that specific
              transition needs to atomically flip owning/opponent team_id and
              home_score/away_score together (mega-spec section W), which
              this plain select cannot do safely. Use "Swap home/away" in the
              hero above for that; this control only ever moves to/from an
              undetermined venue side, which has no score to get backwards. */}
          <select
            id="edit-home-away"
            value={form.homeAway}
            onChange={(e) => setForm((f) => ({ ...f, homeAway: e.target.value as EditFixtureInitial["homeAway"] }))}
            className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
          >
            <option value={initial.homeAway}>{initial.homeAway === "Home" ? "Home" : initial.homeAway === "Away" ? "Away" : initial.homeAway}</option>
            {initial.homeAway !== "TBD" && <option value="TBD">TBD</option>}
            {initial.homeAway !== "Not Applicable" && <option value="Not Applicable">Not applicable</option>}
          </select>
          <p className="mt-1 text-xs text-ink/40">To make the other side home, use &ldquo;Swap home/away&rdquo; above.</p>
        </div>
        <div>
          <Label htmlFor="edit-status" className="text-ink/80">
            Status
          </Label>
          <select
            id="edit-status"
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
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
          <Label htmlFor="edit-game-type" className="text-ink/80">
            Game type
          </Label>
          <select
            id="edit-game-type"
            value={form.gameType}
            onChange={(e) => setForm((f) => ({ ...f, gameType: e.target.value }))}
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
          <Label htmlFor="edit-competition" className="text-ink/80">
            Competition
          </Label>
          <select
            id="edit-competition"
            value={form.competitionEditionId ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, competitionEditionId: e.target.value || null }))}
            className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
          >
            <option value="">None</option>
            {competitionOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.competitionName} &middot; {c.seasonName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label htmlFor="edit-notes" className="text-ink/80">
          Notes
        </Label>
        <textarea
          id="edit-notes"
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          rows={3}
          className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
        />
      </div>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="flex items-center gap-3 border-t border-ink/10 pt-5">
        <Button type="button" className="h-10" disabled={status === "saving" || !isDirty} onClick={handleSave}>
          {status === "saving" ? "Saving…" : "Save changes"}
        </Button>
        {isDirty && status !== "saving" && (
          <Button type="button" variant="ghost" className="h-10 text-ink/50" onClick={() => setForm(savedForm)}>
            Discard
          </Button>
        )}
        {status === "saved" && <span className="text-sm text-forest-800">Saved.</span>}
        {isDirty && status === "idle" && <span className="text-sm text-ink/40">You have unsaved changes.</span>}
      </div>
    </div>
  )
}
