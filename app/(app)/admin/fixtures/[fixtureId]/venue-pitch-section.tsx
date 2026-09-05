"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { MapPin, Pencil } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import type { PitchWithVenueOption, VenueOption } from "../actions"

import { updateFixturePitchAction, updateFixtureVenueAction } from "./result-admin-actions"

const TBC_VALUE = "__tbc__"

/**
 * Reconciliation pass Section 6: a proper full-width operational Venue/
 * Pitch section beneath home/away/swap, replacing the old tiny "Pitch: Not
 * set" inline text. Only rendered for a strict Home fixture (a named venue/
 * pitch is home-club-owned, mirroring update_fixture_venue/update_fixture_
 * pitch's own authorization shape) -- an Away fixture shows a quieter
 * read-only line instead, since this club has no authority to set it.
 */
export function VenuePitchSection({
  fixtureId,
  isHomeFixture,
  currentVenueId,
  currentVenueName,
  currentPitchId,
  currentPitchName,
  venues,
  pitches,
}: {
  fixtureId: string
  isHomeFixture: boolean
  currentVenueId: string | null
  currentVenueName: string | null
  currentPitchId: string | null
  currentPitchName: string | null
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
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-ink/8 bg-ink/[0.015] px-4 py-3 text-sm text-ink/50">
        <MapPin className="size-4 shrink-0 text-ink/35" />
        {currentVenueName ? (
          <span>
            {currentVenueName}
            {currentPitchName ? ` · ${currentPitchName}` : ""} <span className="text-ink/35">(set by the home club)</span>
          </span>
        ) : (
          <span>Venue set by the home club &mdash; not yet chosen.</span>
        )}
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
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink/8 bg-white px-4 py-3.5">
      <div className="flex items-start gap-3">
        <MapPin className="mt-0.5 size-4 shrink-0 text-pitch-600" />
        <div>
          <p className="text-xs font-medium tracking-[0.04em] text-ink/40 uppercase">Venue</p>
          {currentVenueName ? (
            <>
              <p className="text-sm font-medium text-ink">{currentVenueName}</p>
              {address && <p className="text-xs text-ink/50">{address}</p>}
            </>
          ) : (
            <p className="text-sm text-ink/40 italic">Not set</p>
          )}
          <p className="mt-1.5 text-xs font-medium tracking-[0.04em] text-ink/40 uppercase">Pitch</p>
          <p className="text-sm text-ink/70">{currentPitchName ?? <span className="text-ink/40 italic">Not set</span>}</p>
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
            <DialogTitle>Change venue / pitch</DialogTitle>
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
                <span className="text-xs text-ink/45">No pitches assigned to this venue yet.</span>
              )}
            </label>

            {error && <p className="text-sm text-destructive">{error}</p>}
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
  )
}
