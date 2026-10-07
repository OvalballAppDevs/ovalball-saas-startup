import type { ClubPitch } from "@ovalball/contracts/club/venues"

/**
 * ADD VENUE WIZARD -- pure decisions, pulled out for fast unit tests, the same pattern every other
 * Ovalball wizard (Create Training Plan) already uses. Nothing here talks to Supabase; `data.ts`
 * does that, using exactly the shapes this file produces.
 */

/** `kind: "existing"` is deliberately NOT produced by the Add Venue wizard (which never has an
 * existing photo to start from) -- it exists for Venue Detail's Edit screens, whose draft starts from
 * a real venue/pitch/changing-room that may already have an uploaded cover. `PhotoPicker` shows it as
 * the current preview; unless the person picks a new stock or uploaded photo, the edit save leaves the
 * cover untouched rather than reverting it to the fallback. */
export type DraftPhoto = { kind: "stock"; key: string } | { kind: "upload"; localUri: string; mimeType: string } | { kind: "existing"; url: string } | { kind: "none" }

/**
 * WHAT AN EDIT SCREEN'S SAVE DOES WITH ITS PHOTO -- one rule for a ground, a pitch and a changing room.
 *
 * `existing` is the facility's own uploaded photo, untouched: nothing to write. A library choice is written
 * only when it differs from what is stored, so re-saving a name does not re-stamp the cover. `none` is
 * Reset to Default: it clears a stored cover so the one fallback rule applies again, and writes nothing when
 * there was nothing to clear. Clearing an uploaded photo removes the club's own picture from every surface
 * that shows the facility, which is why the picker stages it and only Save Changes commits it.
 */
export type CoverWrite = { kind: "keep" } | { kind: "stock"; key: string } | { kind: "upload"; localUri: string; mimeType: string } | { kind: "clear" }

export function coverWriteFor(photo: DraftPhoto, stored: { coverImagePath: string | null; coverStockKey: string | null }): CoverWrite {
  switch (photo.kind) {
    case "existing":
      return { kind: "keep" }
    case "upload":
      return { kind: "upload", localUri: photo.localUri, mimeType: photo.mimeType }
    case "stock":
      return !stored.coverImagePath && stored.coverStockKey === photo.key ? { kind: "keep" } : { kind: "stock", key: photo.key }
    case "none":
      return stored.coverImagePath || stored.coverStockKey ? { kind: "clear" } : { kind: "keep" }
  }
}

/** A stored cover as the edit screens' draft: the facility's own photo, its library choice, or none. */
export function draftPhotoFromCover(cover: { kind: "cover"; url: string } | { kind: "stock"; key: string } | { kind: "none" }): DraftPhoto {
  return cover.kind === "cover" ? { kind: "existing", url: cover.url } : cover.kind === "stock" ? { kind: "stock", key: cover.key } : { kind: "none" }
}

export interface PitchDraft {
  /** A LOCAL id only, for list rendering and edit/delete before the pitch exists in the database --
   * never sent to the server and never confused with a real `club_pitches.id`. */
  localId: string
  name: string
  description: string
  photo: DraftPhoto
  physicalSizeCategory: ClubPitch["physicalSizeCategory"]
  layout: ClubPitch["layout"]
  customLengthM: string
  customWidthM: string
}

export function emptyPitchDraft(localId: string): PitchDraft {
  return { localId, name: "", description: "", photo: { kind: "none" }, physicalSizeCategory: "full", layout: "full_only", customLengthM: "", customWidthM: "" }
}

/** The three canonical kinds `venue_changing_rooms.room_type` accepts (migration `20270591000000`) --
 * never a fourth invented at the call site. */
export type ChangingRoomType = "full_size" | "smaller" | "match_officials"

export interface ChangingRoomDraft {
  /** Local id only, same rule as `PitchDraft.localId`. */
  localId: string
  name: string
  roomType: ChangingRoomType
  /** How many individually addressable rows this ONE definition expands into at creation
   * (`create_venue_with_pitches`) -- never stored as a count on a single row. Minimum 1. */
  quantity: number
  photo: DraftPhoto
}

export function emptyChangingRoomDraft(localId: string): ChangingRoomDraft {
  return { localId, name: "", roomType: "full_size", quantity: 1, photo: { kind: "none" } }
}

export interface VenueWizardDraft {
  name: string
  photo: DraftPhoto
  postcode: string
  line1: string
  line2: string
  town: string
  county: string
  country: string
  /** Set only once the postcode has actually resolved -- `null` means "not confirmed yet", which is
   * exactly what `venueDetailsValid` refuses to let the wizard move past. */
  resolvedLatitude: number | null
  resolvedLongitude: number | null
  /** Provenance for `venues.address_provider_ref`, never shown to a user. It held a property id when
   * the provider was a property-address service; postcodes.io has no property records, so a postcode
   * resolution deliberately leaves it empty and the column simply records that no property-level
   * reference exists. Retained rather than dropped because the column is historical data on rows
   * written before the provider change. */
  addressProviderRef: string | null
  cateringAvailable: boolean
  changingRoomsAvailable: boolean
  setPrimary: boolean
  pitches: PitchDraft[]
  changingRooms: ChangingRoomDraft[]
}

export const EMPTY_VENUE_DRAFT: VenueWizardDraft = {
  name: "",
  photo: { kind: "none" },
  postcode: "",
  line1: "",
  line2: "",
  town: "",
  county: "",
  country: "United Kingdom",
  resolvedLatitude: null,
  resolvedLongitude: null,
  addressProviderRef: null,
  cateringAvailable: true,
  changingRoomsAvailable: true,
  setPrimary: false,
  pitches: [],
  changingRooms: [],
}

/** Page 1's own gate -- a name, and an address the platform has actually confirmed it can find. A
 * typed postcode that has not yet resolved is not "an address", it is a guess still in flight. */
export function venueDetailsValid(draft: Pick<VenueWizardDraft, "name" | "resolvedLatitude" | "resolvedLongitude">): boolean {
  return draft.name.trim().length > 0 && draft.resolvedLatitude !== null && draft.resolvedLongitude !== null
}

/** Page 2's own gate -- at least one pitch, and every one of them individually valid. */
export function pitchDraftValid(pitch: Pick<PitchDraft, "name" | "physicalSizeCategory" | "customLengthM" | "customWidthM">): boolean {
  if (!pitch.name.trim()) return false
  if (pitch.physicalSizeCategory !== "custom") return true
  const length = Number(pitch.customLengthM)
  const width = Number(pitch.customWidthM)
  return pitch.customLengthM.trim() !== "" && pitch.customWidthM.trim() !== "" && Number.isFinite(length) && Number.isFinite(width) && length > 0 && width > 0
}

export function canProceedFromPitches(pitches: readonly Pick<PitchDraft, "name" | "physicalSizeCategory" | "customLengthM" | "customWidthM">[]): boolean {
  return pitches.length > 0 && pitches.every(pitchDraftValid)
}

const SIZE_LABEL: Record<ClubPitch["physicalSizeCategory"], string> = { full: "Full size", three_quarter: "Three-quarter size", half: "Half size", custom: "Custom size" }
const LAYOUT_LABEL: Record<ClubPitch["layout"], string> = { full_only: "", two_halves: ", split into two halves", four_quarters: ", split into four quarters" }

/** "Full size pitch" / "Half size pitch, split into two halves" / "Custom size (22m x 15m)" -- the
 * one summary line both the Add Pitches list and Review & Create show, so they can never disagree. */
export function pitchSummaryLabel(pitch: Pick<PitchDraft, "physicalSizeCategory" | "layout" | "customLengthM" | "customWidthM">): string {
  if (pitch.physicalSizeCategory === "custom") {
    const dims = pitch.customLengthM && pitch.customWidthM ? ` (${pitch.customLengthM}m x ${pitch.customWidthM}m)` : ""
    return `Custom size pitch${dims}`
  }
  return `${SIZE_LABEL[pitch.physicalSizeCategory]} pitch${LAYOUT_LABEL[pitch.layout]}`
}

export function pitchCountLabel(count: number): string {
  return `${count} ${count === 1 ? "pitch" : "pitches"}`
}

/** The RPC's own jsonb shape for one pitch -- `create_venue_with_pitches`'s `p_pitches` array element.
 * A stock photo travels inline (no id needed yet); an uploaded photo is deliberately left out here and
 * applied after creation once the pitch has a real id (`applyPendingPhotos` in `data.ts`). */
export function pitchDraftToPayload(pitch: PitchDraft): { name: string; description: string | null; physical_size_category: string; layout: string; custom_length_m: number | null; custom_width_m: number | null; cover_stock_key: string | null } {
  return {
    name: pitch.name.trim(),
    description: pitch.description.trim() || null,
    physical_size_category: pitch.physicalSizeCategory,
    layout: pitch.layout,
    custom_length_m: pitch.physicalSizeCategory === "custom" ? Number(pitch.customLengthM) : null,
    custom_width_m: pitch.physicalSizeCategory === "custom" ? Number(pitch.customWidthM) : null,
    cover_stock_key: pitch.photo.kind === "stock" ? pitch.photo.key : null,
  }
}

/** Whether the club already has any venue at all -- if not, the very first one created must become
 * Primary regardless of the toggle, so the club is never left with venues but no primary ground. */
export function firstVenueMustBePrimary(existingVenueCount: number): boolean {
  return existingVenueCount === 0
}

const ROOM_TYPE_LABEL: Record<ChangingRoomType, string> = {
  full_size: "Full size changing room",
  smaller: "Smaller changing room",
  match_officials: "Match officials changing",
}

export function changingRoomTypeLabel(roomType: ChangingRoomType): string {
  return ROOM_TYPE_LABEL[roomType]
}

/** A named entry with a real quantity -- the same shape of gate `pitchDraftValid` uses. */
export function changingRoomDraftValid(room: Pick<ChangingRoomDraft, "name" | "quantity">): boolean {
  return room.name.trim().length > 0 && Number.isFinite(room.quantity) && room.quantity >= 1
}

export function canProceedFromChangingRooms(rooms: readonly Pick<ChangingRoomDraft, "name" | "quantity">[]): boolean {
  return rooms.length > 0 && rooms.every(changingRoomDraftValid)
}

export function changingRoomCountLabel(count: number): string {
  return `${count} ${count === 1 ? "changing room" : "changing rooms"}`
}

/** "Full size changing room" / "Smaller changing room · Qty 2" -- the one summary line both the Add
 * Changing Rooms list and Review & Create show, so they can never disagree. */
export function changingRoomSummaryLabel(room: Pick<ChangingRoomDraft, "roomType" | "quantity">): string {
  const base = changingRoomTypeLabel(room.roomType)
  return room.quantity > 1 ? `${base} · Qty ${room.quantity}` : base
}

/** The RPC's own jsonb shape for one changing-room definition -- `create_venue_with_pitches`'s
 * `p_changing_rooms` array element. Quantity travels through as a plain number; the server is what
 * expands it into individually addressable rows, never this client. */
export function changingRoomDraftToPayload(room: ChangingRoomDraft): { name: string; room_type: ChangingRoomType; quantity: number; cover_stock_key: string | null } {
  return {
    name: room.name.trim(),
    room_type: room.roomType,
    quantity: Math.max(1, Math.round(room.quantity)),
    cover_stock_key: room.photo.kind === "stock" ? room.photo.key : null,
  }
}

/**
 * THE WIZARD'S OWN STEP COUNT -- three steps when Changing Rooms Available is off (Venue Details /
 * Add Pitches / Review & Create), four when it is on (Add Changing Rooms inserted before Review).
 * Every screen that draws the horizontal progress header derives its step NUMBER from this single
 * source, so turning the toggle off never leaves a stepper claiming "Step 3 of 4" for a wizard that
 * is genuinely only three steps long.
 */
export function wizardStepCount(changingRoomsAvailable: boolean): 3 | 4 {
  return changingRoomsAvailable ? 4 : 3
}
