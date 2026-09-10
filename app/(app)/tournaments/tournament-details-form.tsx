"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import type { TournamentBuilderOptions } from "@/lib/app-context/tournament-builder-data"
import type { TournamentCentreContext } from "@/lib/tournaments/view-model"

import { saveTournamentAction } from "./actions"

const FIELD =
  "mt-1.5 h-11 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600"

/**
 * WHAT THE OCCASION IS. The few facts that define a tournament and nothing
 * else -- teams, opponents, schedule and pitches each get their own step,
 * because a single form carrying all five is the database-shaped page this
 * flow exists to avoid.
 *
 * THE RUGBY CODE IS NOT A FIELD. It is the club's, and a club plays one code.
 * Offering a choice here would invite a Union club to create a League
 * tournament that none of its teams could ever be entered into -- the RPC
 * refuses exactly that, and a control that can only produce a refusal is not
 * a control.
 *
 * THE SEASON IS NOT A FIELD EITHER. It resolves from the canonical Seasons
 * register against the dates, in the database, so there is one season calendar
 * and no second answer typed in here.
 */
export function TournamentDetailsForm({
  options,
  tournament,
}: {
  options: TournamentBuilderOptions
  tournament: TournamentCentreContext | null
}) {
  const router = useRouter()
  const [name, setName] = useState(tournament?.name ?? "")
  const [startsOn, setStartsOn] = useState(tournament?.startsOn ?? "")
  const [endsOn, setEndsOn] = useState(tournament?.endsOn ?? "")
  const [venueId, setVenueId] = useState(tournament?.venue?.id ?? options.venues[0]?.id ?? "")
  const [notes, setNotes] = useState(tournament?.notes ?? "")
  const [multiDay, setMultiDay] = useState(Boolean(tournament?.isMultiDay))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const result = await saveTournamentAction({
      tournamentId: tournament?.id ?? null,
      clubId: options.clubId,
      name,
      startsOn,
      endsOn: multiDay && endsOn ? endsOn : startsOn,
      rugbyCode: options.rugbyCode,
      venueId: venueId || null,
      hostDirectoryId: null,
      notes: notes.trim() || null,
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (tournament) {
      setSaved(true)
      router.refresh()
    } else {
      router.push(`/tournaments/${result.value}/edit?step=teams`)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 rounded-2xl border border-ink/10 bg-white p-4 sm:p-5">
      <div>
        <Label htmlFor="t-name">Tournament Name</Label>
        <input
          id="t-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={160}
          placeholder="Preston Festival"
          className={FIELD}
        />
        <p className="mt-1.5 text-xs text-ink-muted">What people call the day. This is how it appears on the Calendar.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="t-start">{multiDay ? "First Day" : "Date"}</Label>
          <input id="t-start" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} required className={FIELD} />
        </div>
        {multiDay && (
          <div>
            <Label htmlFor="t-end">Last Day</Label>
            <input id="t-end" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} required className={FIELD} />
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={multiDay}
          onChange={(e) => {
            setMultiDay(e.target.checked)
            if (e.target.checked && !endsOn) setEndsOn(startsOn)
          }}
          className="size-4 rounded border-ink/25 text-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400"
        />
        This tournament runs over more than one day
      </label>

      <div>
        <Label htmlFor="t-venue">Venue</Label>
        <select id="t-venue" value={venueId} onChange={(e) => setVenueId(e.target.value)} className={FIELD}>
          <option value="">Not set</option>
          {options.venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-ink-muted">
          One of {options.clubName}&rsquo;s own venues. Pitches can only be reserved at a venue the club owns.
        </p>
      </div>

      <div>
        <Label htmlFor="t-notes">Details</Label>
        <textarea
          id="t-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything everyone attending needs to know."
          className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3.5 py-2.5 text-base text-ink outline-none focus-visible:border-pitch-600"
        />
      </div>

      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive-text">{error}</p>}

      <div className="flex items-center gap-3 border-t border-ink/10 pt-4">
        <Button type="submit" className="h-11 sm:h-10" disabled={busy}>
          {busy ? "Saving…" : tournament ? "Save Changes" : "Create Tournament"}
        </Button>
        {saved && <span className="text-sm text-forest-800">Saved.</span>}
      </div>
    </form>
  )
}
