"use client"

import { useState } from "react"
import { ArrowDown, ArrowUp, LayoutGrid, MapPin, Navigation } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AddressLookupField } from "@/components/address/address-lookup-field"
import { cn } from "@/lib/utils"

import {
  createClubPitch,
  createVenue,
  lookupVenueAddress,
  renameClubPitch,
  reorderClubPitches,
  setClubPitchActive,
  setClubPitchVenue,
  setDefaultVenue,
  setVenueActive,
  updateVenue,
  type ClubPitch,
  type ClubVenue,
} from "../actions"

type PitchWithVenue = ClubPitch & { venueId: string | null }

/** Safe, structured directions link -- built from address/postcode text, never a stored arbitrary URL (Section 19 of the venue instruction). */
function directionsHref(venue: ClubVenue): string | null {
  const query = [venue.address, venue.postcode].filter(Boolean).join(", ") || venue.name
  if (!query.trim()) return null
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

const UNASSIGNED_VALUE = ""

/**
 * Lookup Administration: Venues & Pitches. Venues and Pitches are
 * independent lookup records -- a venue is a physical location, a pitch is
 * its own record with its own id, related to a venue only through the
 * nullable club_pitches.venue_id foreign key (Venue 1 -> many Pitches).
 * This is the ONE place either is created, edited, or deactivated --
 * Fixture Administration (add-fixture-dialog.tsx's getClubVenuesAndPitches,
 * the Fixture Detail page's VenuePitchSection) reads the exact same
 * venues/club_pitches rows this writes to, never a parallel copy.
 *
 * Shared between Club Admin (/club/venues, always full write) and Site
 * Admin's parent view (/admin/lookups, gated by the manage_global_lookups
 * capability) via the readOnly prop -- one component, not two drifting
 * implementations of the same list.
 */
export function VenuesSection({
  clubId,
  initialVenues,
  initialPitches,
  readOnly = false,
}: {
  clubId: string
  initialVenues: ClubVenue[]
  initialPitches: PitchWithVenue[]
  readOnly?: boolean
}) {
  const [tab, setTab] = useState<"venues" | "pitches">("venues")
  const [venues, setVenues] = useState(initialVenues)
  const [pitches, setPitches] = useState(initialPitches)
  const [error, setError] = useState<string | null>(null)

  const active = venues.filter((v) => v.active)

  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" className="flex w-fit gap-1 rounded-lg border border-ink/10 bg-ink/[0.02] p-1">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "venues"}
          onClick={() => setTab("venues")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-pitch-400",
            tab === "venues" ? "bg-white text-forest-800 shadow-sm" : "text-ink/50 hover:text-ink/80"
          )}
        >
          <MapPin className="size-3.5" />
          Venues
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "pitches"}
          onClick={() => setTab("pitches")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-pitch-400",
            tab === "pitches" ? "bg-white text-forest-800 shadow-sm" : "text-ink/50 hover:text-ink/80"
          )}
        >
          <LayoutGrid className="size-3.5" />
          Pitches
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {tab === "venues" ? (
        <VenuesTab clubId={clubId} venues={venues} setVenues={setVenues} pitches={pitches} readOnly={readOnly} setError={setError} />
      ) : (
        <PitchesTab clubId={clubId} pitches={pitches} setPitches={setPitches} venues={active} readOnly={readOnly} setError={setError} />
      )}
    </div>
  )
}

function VenuesTab({
  clubId,
  venues,
  setVenues,
  pitches,
  readOnly,
  setError,
}: {
  clubId: string
  venues: ClubVenue[]
  setVenues: React.Dispatch<React.SetStateAction<ClubVenue[]>>
  pitches: PitchWithVenue[]
  readOnly: boolean
  setError: (e: string | null) => void
}) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [address, setAddress] = useState("")
  const [postcode, setPostcode] = useState("")
  const [directions, setDirections] = useState("")
  const [setDefault, setSetDefault] = useState(false)
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const active = venues.filter((v) => v.active)
  const archived = venues.filter((v) => !v.active)

  function resetForm() {
    setName("")
    setAddress("")
    setPostcode("")
    setDirections("")
    setSetDefault(false)
    setFormError(null)
  }

  function startEdit(v: ClubVenue) {
    setEditingId(v.id)
    setName(v.name)
    setAddress(v.address ?? "")
    setPostcode(v.postcode ?? "")
    setDirections(v.directions ?? "")
    setFormError(null)
  }

  async function handleAdd() {
    setPending(true)
    setFormError(null)
    const result = await createVenue({ clubId, name, address, postcode, directions, setDefault })
    setPending(false)
    if (!result.ok) {
      setFormError(result.error)
      return
    }
    setAdding(false)
    resetForm()
    window.location.reload()
  }

  async function handleSaveEdit() {
    if (!editingId) return
    setPending(true)
    setFormError(null)
    const result = await updateVenue({ id: editingId, name, address, postcode, directions })
    setPending(false)
    if (!result.ok) {
      setFormError(result.error)
      return
    }
    setVenues((prev) =>
      prev.map((v) =>
        v.id === editingId ? { ...v, name: name.trim(), address: address.trim() || null, postcode: postcode.trim() || null, directions: directions.trim() || null } : v
      )
    )
    setEditingId(null)
    resetForm()
  }

  async function handleToggleActive(venue: ClubVenue) {
    setPending(true)
    setError(null)
    const result = await setVenueActive(venue.id, !venue.active)
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setVenues((prev) => prev.map((v) => (v.id === venue.id ? { ...v, active: !v.active } : v)))
  }

  async function handleSetDefault(venueId: string) {
    setPending(true)
    setError(null)
    const result = await setDefaultVenue(venueId)
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setVenues((prev) => prev.map((v) => ({ ...v, isDefaultHome: v.id === venueId })))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Venues</p>
        {!readOnly && !adding && (
          <Button type="button" size="sm" className="h-8" onClick={() => setAdding(true)}>
            Add venue
          </Button>
        )}
      </div>

      {active.length === 0 && !adding && <p className="text-sm text-ink/45">No venues added yet.</p>}

      <ul className="flex flex-col gap-3">
        {active.map((venue) => {
          const venuePitches = pitches.filter((p) => p.active && p.venueId === venue.id)
          const editing = editingId === venue.id
          return (
            <li key={venue.id} className="rounded-lg border border-ink/10 bg-white px-4 py-3.5">
              {editing ? (
                <div className="flex flex-col gap-3">
                  <AddressLookupField
                    search={lookupVenueAddress}
                    onSelect={(picked) => {
                      setAddress([picked.address, picked.town, picked.county].filter(Boolean).join(", "))
                      setPostcode(picked.postcode)
                    }}
                  />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="text-ink/80">Name</Label>
                      <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 h-9 border-ink/15 bg-white" />
                    </div>
                    <div>
                      <Label className="text-ink/80">Postcode</Label>
                      <Input value={postcode} onChange={(e) => setPostcode(e.target.value)} className="mt-1.5 h-9 border-ink/15 bg-white" />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-ink/80">Address</Label>
                      <Input value={address} onChange={(e) => setAddress(e.target.value)} className="mt-1.5 h-9 border-ink/15 bg-white" />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-ink/80">Directions / notes (optional)</Label>
                      <Input value={directions} onChange={(e) => setDirections(e.target.value)} className="mt-1.5 h-9 border-ink/15 bg-white" />
                    </div>
                  </div>
                  {formError && <p className="text-xs text-destructive">{formError}</p>}
                  <div className="flex items-center gap-2">
                    <Button type="button" size="sm" className="h-8" disabled={pending || !name.trim()} onClick={handleSaveEdit}>
                      Save
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8"
                      onClick={() => {
                        setEditingId(null)
                        resetForm()
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                      <MapPin className="mt-0.5 size-4 shrink-0 text-ink/35" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="truncate text-sm font-medium text-ink">{venue.name}</p>
                          {venue.isDefaultHome && (
                            <span className="shrink-0 rounded-full bg-pitch-600/12 px-2 py-0.5 text-[11px] font-medium text-forest-800">Default</span>
                          )}
                        </div>
                        {(venue.address || venue.postcode) && (
                          <p className="truncate text-xs text-ink/50">{[venue.address, venue.postcode].filter(Boolean).join(", ")}</p>
                        )}
                        {venue.directions && <p className="truncate text-xs text-ink/40">{venue.directions}</p>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {directionsHref(venue) && (
                        <a
                          href={directionsHref(venue)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-forest-800 outline-none hover:bg-ink/[0.04] focus-visible:ring-2 focus-visible:ring-pitch-400"
                        >
                          <Navigation className="size-3.5" />
                          Directions
                        </a>
                      )}
                      {!readOnly && (
                        <>
                          {!venue.isDefaultHome && (
                            <Button type="button" variant="ghost" size="sm" className="h-8" disabled={pending} onClick={() => handleSetDefault(venue.id)}>
                              Set as default
                            </Button>
                          )}
                          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => startEdit(venue)}>
                            Edit
                          </Button>
                          <Button type="button" variant="ghost" size="sm" className="h-8 text-destructive" disabled={pending} onClick={() => handleToggleActive(venue)}>
                            Deactivate
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mt-2.5 border-t border-ink/6 pt-2.5">
                    <p className="text-xs font-medium tracking-[0.04em] text-ink/40 uppercase">Pitches</p>
                    {venuePitches.length === 0 ? (
                      <p className="mt-1 text-xs text-ink/40">No pitches assigned to this venue yet.</p>
                    ) : (
                      <ul className="mt-1.5 flex flex-wrap gap-1.5">
                        {venuePitches.map((p) => (
                          <li key={p.id} className="rounded-full border border-ink/10 bg-ink/[0.02] px-2.5 py-1 text-xs text-ink/70">
                            {p.displayName}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </li>
          )
        })}
      </ul>

      {adding && (
        <div className="rounded-lg border border-ink/10 bg-white p-4">
          <AddressLookupField
            search={lookupVenueAddress}
            onSelect={(picked) => {
              setAddress([picked.address, picked.town, picked.county].filter(Boolean).join(", "))
              setPostcode(picked.postcode)
            }}
          />
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="venue-name" className="text-ink/80">
                Venue name
              </Label>
              <Input id="venue-name" autoFocus placeholder="e.g. Burnley RUFC Ground" value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 h-10 border-ink/15 bg-white" />
            </div>
            <div>
              <Label htmlFor="venue-postcode" className="text-ink/80">
                Postcode
              </Label>
              <Input id="venue-postcode" placeholder="e.g. BB11 1AA" value={postcode} onChange={(e) => setPostcode(e.target.value)} className="mt-1.5 h-10 border-ink/15 bg-white" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="venue-address" className="text-ink/80">
                Address
              </Label>
              <Input id="venue-address" placeholder="e.g. Coal Clough Lane, Burnley" value={address} onChange={(e) => setAddress(e.target.value)} className="mt-1.5 h-10 border-ink/15 bg-white" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="venue-directions" className="text-ink/80">
                Directions / notes (optional)
              </Label>
              <Input id="venue-directions" placeholder="e.g. Park behind the clubhouse" value={directions} onChange={(e) => setDirections(e.target.value)} className="mt-1.5 h-10 border-ink/15 bg-white" />
            </div>
          </div>

          <label className="mt-3 flex items-center gap-2 text-sm text-ink/80">
            <input type="checkbox" checked={setDefault} onChange={(e) => setSetDefault(e.target.checked)} className="size-4 rounded border-ink/25" />
            Set as default home venue
          </label>

          {formError && <p className="mt-2 text-sm text-destructive">{formError}</p>}

          <div className="mt-3 flex items-center gap-2">
            <Button type="button" size="sm" className="h-9" disabled={pending || !name.trim()} onClick={handleAdd}>
              {pending ? "Adding…" : "Add venue"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9"
              onClick={() => {
                setAdding(false)
                resetForm()
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {archived.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowArchived((v) => !v)} className="text-xs font-medium text-ink/45 underline underline-offset-2 hover:text-ink/70">
            {showArchived ? "Hide" : "Show"} deactivated venues ({archived.length})
          </button>
          {showArchived && (
            <ul className="mt-2 flex flex-col gap-2">
              {archived.map((venue) => (
                <li key={venue.id} className="flex items-center justify-between gap-3 rounded-lg border border-ink/8 bg-ink/2 px-4 py-3 opacity-70">
                  <p className="truncate text-sm text-ink/60">{venue.name}</p>
                  {!readOnly && (
                    <Button type="button" variant="ghost" size="sm" className="h-8" disabled={pending} onClick={() => handleToggleActive(venue)}>
                      Reactivate
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The one authoritative pitch list -- every pitch, assigned or not, with
 * an Assigned Venue selector on every row (not just unassigned ones).
 * Changing the selector calls setClubPitchVenue directly, so reassigning
 * an already-assigned pitch works exactly the same as assigning a fresh
 * one -- no separate "move" flow.
 */
function PitchesTab({
  clubId,
  pitches,
  setPitches,
  venues,
  readOnly,
  setError,
}: {
  clubId: string
  pitches: PitchWithVenue[]
  setPitches: React.Dispatch<React.SetStateAction<PitchWithVenue[]>>
  venues: ClubVenue[]
  readOnly: boolean
  setError: (e: string | null) => void
}) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState("")
  const [newDescription, setNewDescription] = useState("")
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  // Map for looking up a venue even when it's since been deactivated --
  // a pitch pointed at a now-inactive venue must still show which venue
  // that is, never silently fall back to "unassigned" (Section: venue
  // deactivation must not corrupt existing relationships).
  const venuesById = new Map(venues.map((v) => [v.id, v]))
  const active = pitches.filter((p) => p.active).sort((a, b) => a.sortOrder - b.sortOrder)
  const archived = pitches.filter((p) => !p.active)

  async function handleMove(index: number, direction: -1 | 1) {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= active.length) return
    const reordered = [...active]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(targetIndex, 0, moved)
    const ids = reordered.map((p) => p.id)

    setPitches((prev) => {
      const bySortOrder = new Map(ids.map((id, i) => [id, i]))
      return prev.map((p) => (bySortOrder.has(p.id) ? { ...p, sortOrder: bySortOrder.get(p.id)! } : p))
    })
    setPending(true)
    const result = await reorderClubPitches(clubId, ids)
    setPending(false)
    if (!result.ok) setError(result.error)
  }

  async function handleAdd() {
    setPending(true)
    setFormError(null)
    const result = await createClubPitch(clubId, newName, newDescription)
    setPending(false)
    if (!result.ok) {
      setFormError(result.error)
      return
    }
    setNewName("")
    setNewDescription("")
    setAdding(false)
    window.location.reload()
  }

  async function handleRename(id: string) {
    setPending(true)
    setFormError(null)
    const result = await renameClubPitch(id, renameValue)
    setPending(false)
    if (!result.ok) {
      setFormError(result.error)
      return
    }
    setPitches((prev) => prev.map((p) => (p.id === id ? { ...p, displayName: renameValue.trim() } : p)))
    setRenamingId(null)
  }

  async function handleToggleActive(pitch: PitchWithVenue) {
    setPending(true)
    setError(null)
    const result = await setClubPitchActive(pitch.id, !pitch.active)
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setPitches((prev) => prev.map((p) => (p.id === pitch.id ? { ...p, active: !p.active } : p)))
  }

  async function handleAssignVenue(pitchId: string, venueId: string) {
    setPending(true)
    setError(null)
    const result = await setClubPitchVenue(pitchId, venueId || null)
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setPitches((prev) => prev.map((p) => (p.id === pitchId ? { ...p, venueId: venueId || null } : p)))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">All pitches</p>
          <p className="mt-0.5 text-xs text-ink/45">Every pitch is its own record -- assign it to a venue now, or leave it unassigned and attach one later.</p>
        </div>
        {!readOnly && !adding && (
          <Button type="button" size="sm" className="h-8 shrink-0" onClick={() => setAdding(true)}>
            Add pitch
          </Button>
        )}
      </div>

      {active.length === 0 && !adding && <p className="text-sm text-ink/45">No pitches added yet.</p>}

      <ul className="flex flex-col gap-2">
        {active.map((pitch, index) => {
          const assignedVenue = pitch.venueId ? venuesById.get(pitch.venueId) : null
          const assignedVenueInactive = pitch.venueId != null && !assignedVenue
          return (
            <li key={pitch.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3">
              {renamingId === pitch.id ? (
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="h-9 border-ink/15 bg-white" />
                  <Button type="button" size="sm" className="h-9" disabled={pending || !renameValue.trim()} onClick={() => handleRename(pitch.id)}>
                    Save
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setRenamingId(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex min-w-0 items-center gap-2">
                    <LayoutGrid className="size-4 shrink-0 text-ink/35" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{pitch.displayName}</p>
                      {pitch.description && <p className="truncate text-xs text-ink/50">{pitch.description}</p>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {readOnly ? (
                      <span className="text-xs text-ink/50">
                        {assignedVenueInactive ? "Assigned venue is inactive" : (assignedVenue?.name ?? "Unassigned")}
                      </span>
                    ) : (
                      <select
                        value={pitch.venueId ?? UNASSIGNED_VALUE}
                        disabled={pending}
                        onChange={(e) => handleAssignVenue(pitch.id, e.target.value)}
                        className="h-8 rounded-md border border-ink/15 bg-white px-2 text-xs text-ink outline-none focus-visible:border-pitch-600"
                      >
                        <option value={UNASSIGNED_VALUE}>Select venue…</option>
                        {venues.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                        {assignedVenueInactive && pitch.venueId && (
                          <option value={pitch.venueId}>Assigned venue (inactive)</option>
                        )}
                      </select>
                    )}
                    {!readOnly && (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={pending || index === 0}
                          onClick={() => handleMove(index, -1)}
                          aria-label={`Move ${pitch.displayName} up`}
                        >
                          <ArrowUp className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={pending || index === active.length - 1}
                          onClick={() => handleMove(index, 1)}
                          aria-label={`Move ${pitch.displayName} down`}
                        >
                          <ArrowDown className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8"
                          onClick={() => {
                            setRenamingId(pitch.id)
                            setRenameValue(pitch.displayName)
                            setFormError(null)
                          }}
                        >
                          Edit
                        </Button>
                        <Button type="button" variant="ghost" size="sm" className="h-8 text-destructive" disabled={pending} onClick={() => handleToggleActive(pitch)}>
                          Deactivate
                        </Button>
                      </>
                    )}
                  </div>
                </>
              )}
            </li>
          )
        })}
      </ul>

      {adding && (
        <div className="rounded-lg border border-ink/10 bg-white p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="pitch-name" className="text-ink/80">
                Name
              </Label>
              <Input id="pitch-name" autoFocus placeholder="e.g. Main Pitch" value={newName} onChange={(e) => setNewName(e.target.value)} className="mt-1.5 h-10 border-ink/15 bg-white" />
            </div>
            <div>
              <Label htmlFor="pitch-description" className="text-ink/80">
                Description (optional)
              </Label>
              <Input
                id="pitch-description"
                placeholder="e.g. Artificial grass, floodlit"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="mt-1.5 h-10 border-ink/15 bg-white"
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-ink/45">You can assign it to a venue from the list above once it&apos;s added.</p>

          {formError && <p className="mt-2 text-sm text-destructive">{formError}</p>}

          <div className="mt-3 flex items-center gap-2">
            <Button type="button" size="sm" className="h-9" disabled={pending || !newName.trim()} onClick={handleAdd}>
              {pending ? "Adding…" : "Add pitch"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9"
              onClick={() => {
                setAdding(false)
                setFormError(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {archived.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowArchived((v) => !v)} className="text-xs font-medium text-ink/45 underline underline-offset-2 hover:text-ink/70">
            {showArchived ? "Hide" : "Show"} deactivated pitches ({archived.length})
          </button>
          {showArchived && (
            <ul className="mt-2 flex flex-col gap-2">
              {archived.map((pitch) => (
                <li key={pitch.id} className="flex items-center justify-between gap-3 rounded-lg border border-ink/8 bg-ink/2 px-4 py-3 opacity-70">
                  <p className="truncate text-sm text-ink/60">{pitch.displayName}</p>
                  {!readOnly && (
                    <Button type="button" variant="ghost" size="sm" className="h-8" disabled={pending} onClick={() => handleToggleActive(pitch)}>
                      Reactivate
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
