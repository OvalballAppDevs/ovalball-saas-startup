"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Clock, MapPin, Pencil } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { PitchWithVenueOption, VenueOption } from "../actions"

import { setFixtureMeetTime } from "./meet-time-actions"
import { updateFixturePitchAction, updateFixtureVenueAction } from "./result-admin-actions"

const TBC_VALUE = "__tbc__"

/**
 * The matchday strip: where the game is played, on which pitch, and when the
 * players are told to arrive.
 *
 * MEET TIME LIVES HERE, NOT IN THE MATCH CENTRE. It is a property of the
 * fixture, scheduled once by whoever runs the fixture, alongside kick-off and
 * venue. It used to be editable from the Match Centre, which made the surface
 * the whole club READS the fixture on a second place to CHANGE it -- and one
 * fact with two editing authorities is one fact that will eventually disagree
 * with itself. The Match Centre still displays it prominently; it no longer
 * owns it.
 *
 * The two controls have deliberately different reach, because the underlying
 * authorities differ:
 *
 *   venue/pitch -- HOME CLUB ONLY. A named venue and pitch belong to the club
 *     that owns them, mirroring update_fixture_venue/update_fixture_pitch's
 *     own authorization. An away fixture shows a read-only line.
 *
 *   meet time -- EITHER SIDE. update_fixture_meet_time checks
 *     can_submit_fixture_result, which both clubs hold, and an away club has
 *     the strongest reason of all to set one: their players have to travel.
 */
export function VenuePitchSection({
  fixtureId,
  isHomeFixture,
  currentVenueId,
  currentVenueName,
  currentPitchId,
  currentPitchName,
  currentMeetTime,
  kickoffTime,
  venues,
  pitches,
}: {
  fixtureId: string
  isHomeFixture: boolean
  currentVenueId: string | null
  currentVenueName: string | null
  currentPitchId: string | null
  currentPitchName: string | null
  /** Canonical fixtures.meet_time as HH:MM, or null. */
  currentMeetTime: string | null
  /** Canonical fixtures.kickoff_time as HH:MM, or null -- a meet time cannot exist without one. */
  kickoffTime: string | null
  venues: VenueOption[]
  pitches: PitchWithVenueOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [venueValue, setVenueValue] = useState(currentVenueId ?? TBC_VALUE)
  const [pitchValue, setPitchValue] = useState(currentPitchId ?? TBC_VALUE)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentVenue = venues.find((v) => v.id === currentVenueId)
  const address = currentVenue ? [currentVenue.address, currentVenue.postcode].filter(Boolean).join(", ") : null
  const pitchOptionsForVenue = pitches.filter((p) => (venueValue === TBC_VALUE ? true : p.venueId === venueValue))

  if (!isHomeFixture) {
    return (
      <div className="mt-3 flex flex-col gap-3 rounded-lg border border-ink/8 bg-white px-4 py-3.5">
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <MapPin className="size-4 shrink-0 text-ink-muted" />
          {currentVenueName ? (
            <span>
              {currentVenueName}
              {currentPitchName ? ` · ${currentPitchName}` : ""} <span className="text-ink-muted">(set by the home club)</span>
            </span>
          ) : (
            <span>Venue set by the home club &mdash; not yet chosen.</span>
          )}
        </div>
        {/* Still this club's own to set: their players are the ones travelling. */}
        <MeetTimeControl fixtureId={fixtureId} currentMeetTime={currentMeetTime} kickoffTime={kickoffTime} />
      </div>
    )
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const venueResult = await updateFixtureVenueAction(fixtureId, venueValue === TBC_VALUE ? null : venueValue)
    if (!venueResult.ok) {
      setSaving(false)
      setError(venueResult.error)
      return
    }
    if (pitchValue === TBC_VALUE) {
      await updateFixturePitchAction(fixtureId, { pitchText: null })
    } else {
      await updateFixturePitchAction(fixtureId, { pitchId: pitchValue })
    }
    setSaving(false)
    setOpen(false)
    router.refresh()
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-ink/8 bg-white px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <MapPin className="mt-0.5 size-4 shrink-0 text-pitch-600" />
          <div>
            <p className="text-xs font-medium tracking-[0.04em] text-ink-muted uppercase">Venue</p>
            {currentVenueName ? (
              <>
                <p className="text-sm font-medium text-ink">{currentVenueName}</p>
                {address && <p className="text-xs text-ink-muted">{address}</p>}
              </>
            ) : (
              <p className="text-sm text-ink-muted italic">Not set</p>
            )}
            <p className="mt-1.5 text-xs font-medium tracking-[0.04em] text-ink-muted uppercase">Pitch</p>
            <p className="text-sm text-ink/70">{currentPitchName ?? <span className="text-ink-muted italic">Not set</span>}</p>
          </div>
        </div>

        <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) {
            setVenueValue(currentVenueId ?? TBC_VALUE)
            setPitchValue(currentPitchId ?? TBC_VALUE)
          }
          setError(null)
        }}
      >
        <DialogTrigger
          render={
            <Button type="button" variant="outline" size="sm" className="h-8 shrink-0">
              <Pencil className="mr-1.5 size-3.5" />
              Change venue / pitch
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Venue / Pitch</DialogTitle>
            <DialogDescription>Only this club&apos;s own active venues and pitches are offered.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-ink/80">Venue</span>
              <select
                value={venueValue}
                onChange={(e) => {
                  setVenueValue(e.target.value)
                  setPitchValue(TBC_VALUE)
                }}
                className="h-10 rounded-lg border border-ink/15 px-3 text-sm outline-none focus-visible:border-pitch-600"
              >
                <option value={TBC_VALUE}>Not set</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.isDefaultHome ? " (Default)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-ink/80">Pitch</span>
              <select
                value={pitchValue}
                onChange={(e) => setPitchValue(e.target.value)}
                className="h-10 rounded-lg border border-ink/15 px-3 text-sm outline-none focus-visible:border-pitch-600"
              >
                <option value={TBC_VALUE}>TBC / Not assigned</option>
                {pitchOptionsForVenue.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
              {venueValue !== TBC_VALUE && pitchOptionsForVenue.length === 0 && (
                <span className="text-xs text-ink-muted">No pitches assigned to this venue yet.</span>
              )}
            </label>

            {error && <p className="text-sm text-destructive-text">{error}</p>}
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" className="h-9" />}>Cancel</DialogClose>
            <Button type="button" className="h-9" disabled={saving} onClick={handleSave}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
        </Dialog>
      </div>

      <div className="border-t border-ink/8 pt-3">
        <MeetTimeControl fixtureId={fixtureId} currentMeetTime={currentMeetTime} kickoffTime={kickoffTime} />
      </div>
    </div>
  )
}

/**
 * The canonical arrival time.
 *
 * Saved explicitly rather than on blur: a time input fires change on every
 * keystroke and on every arrow press, and an autosaving one would write half
 * an hour on the way to typing half past three.
 */
function MeetTimeControl({
  fixtureId,
  currentMeetTime,
  kickoffTime,
}: {
  fixtureId: string
  currentMeetTime: string | null
  kickoffTime: string | null
}) {
  const router = useRouter()
  const [value, setValue] = useState(currentMeetTime ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const dirty = (value || null) !== (currentMeetTime || null)

  async function save(next: string | null) {
    setBusy(true)
    setError(null)
    setSaved(false)
    const result = await setFixtureMeetTime(fixtureId, next)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSaved(true)
    router.refresh()
  }

  return (
    <div>
      <div className="flex items-start gap-3">
        <Clock className="mt-0.5 size-4 shrink-0 text-pitch-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <Label htmlFor={`meet-time-${fixtureId}`} className="text-xs font-medium tracking-[0.04em] text-ink-muted uppercase">
            Meet Time
          </Label>
          <p className="mt-1 text-xs text-ink-muted">
            {kickoffTime
              ? "When players should arrive. Shown alongside kick-off everywhere this fixture appears."
              : "Set a kick-off time first — a meet time needs something to be early for."}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              id={`meet-time-${fixtureId}`}
              type="time"
              value={value}
              disabled={!kickoffTime || busy}
              max={kickoffTime ?? undefined}
              onChange={(e) => {
                setValue(e.target.value)
                setSaved(false)
                setError(null)
              }}
              className="h-10 w-32"
            />
            <Button type="button" size="sm" className="h-10" disabled={busy || !kickoffTime || !dirty} onClick={() => void save(value || null)}>
              {busy ? "Saving…" : "Save"}
            </Button>
            {currentMeetTime && !dirty && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10 text-ink-muted"
                disabled={busy}
                onClick={() => {
                  setValue("")
                  void save(null)
                }}
              >
                Clear
              </Button>
            )}
          </div>
          {error && (
            <p role="alert" className="mt-2 text-sm text-destructive-text">
              {error}
            </p>
          )}
          {saved && !error && <p className="mt-2 text-sm text-forest-800">Meet time saved.</p>}
        </div>
      </div>
    </div>
  )
}
