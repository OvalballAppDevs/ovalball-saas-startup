"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CalendarHeart, MapPin } from "lucide-react"

import { AddressLookupField } from "@/components/address/address-lookup-field"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

import { lookupEventAddress, saveClubEvent } from "./actions"

/**
 * ADD / EDIT EVENT.
 *
 * THE CANONICAL EVENT INTERACTION, and deliberately not an overloaded fixture
 * form: a fixture form is built around two sides, a kick-off and a result, and
 * a club open day has none of those. Bending it would have made every fixture
 * field optional to accommodate a party.
 *
 * WHAT THE FORM ENFORCES IS ONLY WHAT HELPS SOMEBODY FILL IT IN. Every real
 * rule -- the span, venue XOR external location, team and pitch ownership,
 * who may create at all -- is enforced in public.save_club_event. This is the
 * courteous half of the same rules, not the authority.
 */

export interface EventTeamOption {
  id: string
  label: string
}

export interface EventVenueOption {
  id: string
  name: string
}

export interface EventPitchOption {
  id: string
  displayName: string
}

export interface ExistingEvent {
  id: string
  name: string
  description: string | null
  startsOn: string
  startTime: string | null
  endsOn: string
  endTime: string | null
  isClubWide: boolean
  venueId: string | null
  teamIds: string[]
  pitchIds: string[]
}

export function EventForm({
  clubId,
  teams,
  venues,
  pitches,
  canCreateClubWide,
  existing,
  open,
  onOpenChange,
}: {
  clubId: string
  teams: EventTeamOption[]
  venues: EventVenueOption[]
  pitches: EventPitchOption[]
  /** Only club-scoped authority may make an event reach every team. */
  canCreateClubWide: boolean
  existing?: ExistingEvent | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState(existing?.name ?? "")
  const [description, setDescription] = useState(existing?.description ?? "")
  const [startsOn, setStartsOn] = useState(existing?.startsOn ?? "")
  const [startTime, setStartTime] = useState(existing?.startTime?.slice(0, 5) ?? "")
  const [endsOn, setEndsOn] = useState(existing?.endsOn ?? "")
  const [endTime, setEndTime] = useState(existing?.endTime?.slice(0, 5) ?? "")
  const [isClubWide, setIsClubWide] = useState(existing?.isClubWide ?? false)
  const [teamIds, setTeamIds] = useState<string[]>(existing?.teamIds ?? [])
  const [pitchIds, setPitchIds] = useState<string[]>(existing?.pitchIds ?? [])
  const [locationMode, setLocationMode] = useState<"venue" | "external">(
    existing && !existing.venueId ? "external" : "venue"
  )
  const [venueId, setVenueId] = useState(existing?.venueId ?? venues[0]?.id ?? "")
  const [external, setExternal] = useState<{ name: string; line1: string; line2: string; town: string; county: string; postcode: string }>({
    name: "",
    line1: "",
    line2: "",
    town: "",
    county: "",
    postcode: "",
  })

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  function submit() {
    setError(null)
    startTransition(async () => {
      const result = await saveClubEvent({
        eventId: existing?.id ?? null,
        clubId,
        name,
        description: description || null,
        startsOn,
        // An empty time is the ALL-DAY semantic and is sent as null. It is
        // never turned into 00:00, which would tell a family to arrive at
        // midnight.
        startTime: startTime || null,
        // An end date is required by the model; defaulting it to the start
        // date is what makes a single-day event a one-date form rather than
        // asking everyone to type the same date twice.
        endsOn: endsOn || startsOn,
        endTime: endTime || null,
        isClubWide,
        teamIds: isClubWide ? [] : teamIds,
        pitchIds,
        venueId: locationMode === "venue" ? venueId || null : null,
        external: locationMode === "external" ? { ...external } : null,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-full max-w-lg overflow-y-auto p-0">
        <DialogHeader className="border-b border-ink/8 px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 font-display text-lg text-ink">
            <CalendarHeart className="size-4 text-[#6d3b5d]" aria-hidden="true" />
            {existing ? "Edit Event" : "Add Event"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-5 px-5 py-5">
          <Field label="Event Name" htmlFor="ev-name">
            <input
              id="ev-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={160}
              placeholder="Centenary Weekend"
              className={INPUT}
            />
          </Field>

          <Field label="Description" htmlFor="ev-desc" hint="Optional. What it is, who it is for, anything people need to bring.">
            <textarea id="ev-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={cn(INPUT, "resize-y")} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts" htmlFor="ev-start-date">
              <input id="ev-start-date" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className={INPUT} />
            </Field>
            <Field label="Start Time" htmlFor="ev-start-time" hint="Leave blank for an all-day event.">
              <input id="ev-start-time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={INPUT} />
            </Field>
            <Field label="Ends" htmlFor="ev-end-date" hint="Same day unless it runs longer.">
              <input id="ev-end-date" type="date" value={endsOn} min={startsOn || undefined} onChange={(e) => setEndsOn(e.target.value)} className={INPUT} />
            </Field>
            <Field label="End Time" htmlFor="ev-end-time">
              <input id="ev-end-time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={INPUT} />
            </Field>
          </div>

          {/* WHO IT IS FOR. Club-wide is a single choice rather than "select
              all", so adding a team next month does not quietly leave it out
              of an event that was always meant to include everyone. */}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-ink">Teams</legend>
            {canCreateClubWide && (
              <label className="flex min-h-11 items-center gap-2.5 text-sm text-ink">
                <input type="checkbox" checked={isClubWide} onChange={(e) => setIsClubWide(e.target.checked)} className="size-4" />
                All Teams (club-wide)
              </label>
            )}
            {!isClubWide && (
              <div className="flex flex-wrap gap-1.5">
                {teams.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTeamIds(toggle(teamIds, t.id))}
                    aria-pressed={teamIds.includes(t.id)}
                    className={cn(CHIP, teamIds.includes(t.id) ? CHIP_ON : CHIP_OFF)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          {/* WHERE. One model or the other, never both -- the same rule the
              database enforces, offered here as a choice rather than as an
              error after the fact. */}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-ink">Location</legend>
            <div className="inline-flex w-fit items-center gap-0.5 rounded-xl bg-chalk p-1">
              <button type="button" onClick={() => setLocationMode("venue")} aria-pressed={locationMode === "venue"} className={cn(SEG, locationMode === "venue" ? SEG_ON : SEG_OFF)}>
                Club Venue
              </button>
              <button type="button" onClick={() => setLocationMode("external")} aria-pressed={locationMode === "external"} className={cn(SEG, locationMode === "external" ? SEG_ON : SEG_OFF)}>
                Another Address
              </button>
            </div>

            {locationMode === "venue" ? (
              <select value={venueId} onChange={(e) => setVenueId(e.target.value)} className={INPUT} aria-label="Club Venue">
                {venues.length === 0 && <option value="">No venues recorded yet</option>}
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex flex-col gap-2">
                <input
                  value={external.name}
                  onChange={(e) => setExternal({ ...external, name: e.target.value })}
                  placeholder="Venue name, e.g. The Grand Hotel"
                  aria-label="Location Name"
                  className={INPUT}
                />
                {/* The same address lookup the club venue form uses, running
                    as a server action -- the provider is never reached from
                    the browser and no key is exposed to it. */}
                <AddressLookupField
                  search={lookupEventAddress}
                  onSelect={(a) =>
                    setExternal((prev) => ({
                      ...prev,
                      line1: a.line1,
                      line2: a.line2,
                      town: a.town,
                      county: a.county,
                      postcode: a.postcode,
                    }))
                  }
                />
                {external.postcode && (
                  <p className="flex items-center gap-1.5 text-xs text-ink-muted">
                    <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                    {[external.line1, external.town, external.postcode].filter(Boolean).join(", ")}
                  </p>
                )}
              </div>
            )}
          </fieldset>

          {/* PITCHES ARE OPTIONAL. A presentation evening needs none; a
              centenary weekend may need several. Reserving one here is what
              Pitch Allocation reads -- there is no second place to record it. */}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-ink">Pitch Requirement</legend>
            {pitches.length === 0 ? (
              <p className="text-xs text-ink-muted">This club has no pitches recorded.</p>
            ) : (
              <>
                <p className="text-xs text-ink-muted">Leave all unselected if this event needs no pitch.</p>
                <div className="flex flex-wrap gap-1.5">
                  {pitches.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPitchIds(toggle(pitchIds, p.id))}
                      aria-pressed={pitchIds.includes(p.id)}
                      className={cn(CHIP, pitchIds.includes(p.id) ? CHIP_ON : CHIP_OFF)}
                    >
                      {p.displayName}
                    </button>
                  ))}
                </div>
              </>
            )}
          </fieldset>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ink/8 bg-chalk px-5 py-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex min-h-11 items-center rounded-lg px-3.5 text-sm font-medium text-ink-muted hover:text-ink sm:min-h-9"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={isPending}
            className="inline-flex min-h-11 items-center rounded-lg bg-forest-950 px-4 text-sm font-medium text-white transition-colors hover:bg-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none disabled:opacity-60 sm:min-h-9"
          >
            {isPending ? "Saving…" : existing ? "Save Changes" : "Create Event"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const INPUT =
  "min-h-11 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-400 focus-visible:ring-2 focus-visible:ring-pitch-400/40 sm:min-h-10"
const CHIP = "inline-flex min-h-11 items-center rounded-full border px-3 text-[13px] font-medium transition-colors sm:min-h-9"
const CHIP_ON = "border-forest-950 bg-forest-950 text-white"
const CHIP_OFF = "border-ink/15 bg-white text-ink-muted hover:text-ink"
const SEG = "inline-flex min-h-11 items-center rounded-lg px-3.5 text-[13px] font-medium transition-colors sm:min-h-9"
const SEG_ON = "bg-forest-950 text-white shadow-sm"
const SEG_OFF = "text-ink-muted hover:bg-white hover:text-ink"

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  )
}
