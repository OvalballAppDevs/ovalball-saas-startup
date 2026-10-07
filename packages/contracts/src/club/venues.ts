import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

type Client = SupabaseClient<Database>

/**
 * CLUB VENUES, PITCHES AND CHANGING ROOMS, for both clients (CA-M2, Venue Detail mock-up).
 *
 * READS are the tables under RLS, exactly what the website's Lookup Administration page reads
 * (`venues_select` = venue.venue.view; `club_pitches_select`; `venue_changing_rooms_select`). WRITES
 * are the canonical operations: `save_club_venue` (one transaction: name, directions, address,
 * default, catering/changing-rooms facilities), `set_venue_active`, `set_default_venue`, the pitch
 * operations `create_club_pitch`, `rename_club_pitch`, `set_club_pitch_description`,
 * `set_club_pitch_configuration`, `set_club_pitch_active`, `set_club_pitch_venue`, and the changing
 * room operations `create_venue_changing_room`, `update_venue_changing_room`,
 * `set_venue_changing_room_active`. There is no delete anywhere in the product: a venue, pitch or
 * changing room is deactivated and keeps every fixture, session and history row that points at it.
 * Turning a venue's Changing Rooms Available off deactivates its existing rooms rather than deleting
 * them (`save_club_venue`'s own guard) -- the same rule, applied where a boolean toggle can otherwise
 * orphan child rows.
 *
 * THE PIN IS NOT A CLIENT'S TO SET. Coordinates come from the postcode through the platform's
 * geocoding step; a client shows a map only for `geocode_status = 'success'` and otherwise offers
 * the postcode -- the same rule as `fixtures/venue.ts`.
 */

export interface ClubVenue {
  id: string
  name: string
  addressLine1: string | null
  addressLine2: string | null
  town: string | null
  county: string | null
  postcode: string | null
  country: string | null
  directions: string | null
  active: boolean
  isDefaultHome: boolean
  latitude: number | null
  longitude: number | null
  geocodeStatus: string
  /** `venue-cover.ts`'s own two source columns -- resolve with `resolveVenueCover`, never read raw. */
  coverImagePath: string | null
  coverStockKey: string | null
  cateringAvailable: boolean
  changingRoomsAvailable: boolean
}

export interface ClubPitch {
  id: string
  displayName: string
  description: string | null
  active: boolean
  sortOrder: number
  venueId: string | null
  /** CA-M11.2 Grounds & Pitches: what this physical pitch IS. Set through `setClubPitchConfiguration`. */
  physicalSizeCategory: "full" | "three_quarter" | "half" | "custom"
  customLengthM: number | null
  customWidthM: number | null
  /** How the club has chosen to use this physical pitch concurrently -- independent of its physical
   * size, see `packages/contracts/src/pitch-allocation/footprint.ts`'s own header comment. */
  layout: "full_only" | "two_halves" | "four_quarters"
  /** GENERATED at the database from `layout` -- how many fixtures this pitch can genuinely host at once. */
  laneCount: number
  /** `pitch-cover.ts`'s own two source columns -- resolve with `resolvePitchCover`, never read raw. */
  coverImagePath: string | null
  coverStockKey: string | null
}

export interface VenueChangingRoom {
  id: string
  venueId: string
  displayName: string
  roomType: "full_size" | "smaller" | "match_officials"
  active: boolean
  sortOrder: number
  /** `changing-room-cover.ts`'s own two source columns -- resolve with `resolveChangingRoomCover`. */
  coverImagePath: string | null
  coverStockKey: string | null
}

export interface ClubVenues {
  venues: ClubVenue[]
  pitches: ClubPitch[]
  changingRooms: VenueChangingRoom[]
}

export async function readClubVenues(supabase: Client, clubId: string): Promise<ClubVenues> {
  const [{ data: venues, error: ve }, { data: pitches, error: pe }, { data: changingRooms, error: ce }] = await Promise.all([
    supabase
      .from("venues")
      .select("id, name, address_line_1, address_line_2, town, county, postcode, country, directions, active, is_default_home, latitude, longitude, geocode_status, cover_image_path, cover_stock_key, catering_available, changing_rooms_available")
      .eq("club_id", clubId)
      .order("is_default_home", { ascending: false })
      .order("name"),
    supabase
      .from("club_pitches")
      .select("id, display_name, description, active, sort_order, venue_id, physical_size_category, custom_length_m, custom_width_m, layout, lane_count, cover_image_path, cover_stock_key")
      .eq("club_id", clubId)
      .order("sort_order"),
    supabase
      .from("venue_changing_rooms")
      .select("id, venue_id, display_name, room_type, active, sort_order, cover_image_path, cover_stock_key")
      .eq("club_id", clubId)
      .order("sort_order"),
  ])
  if (ve) throw ve
  if (pe) throw pe
  if (ce) throw ce
  return {
    venues: (venues ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      addressLine1: v.address_line_1,
      addressLine2: v.address_line_2,
      town: v.town,
      county: v.county,
      postcode: v.postcode,
      country: v.country,
      directions: v.directions,
      active: v.active,
      isDefaultHome: v.is_default_home,
      latitude: v.latitude == null ? null : Number(v.latitude),
      longitude: v.longitude == null ? null : Number(v.longitude),
      geocodeStatus: v.geocode_status,
      coverImagePath: v.cover_image_path,
      coverStockKey: v.cover_stock_key,
      cateringAvailable: v.catering_available,
      changingRoomsAvailable: v.changing_rooms_available,
    })),
    pitches: (pitches ?? []).map((p) => ({
      id: p.id,
      displayName: p.display_name,
      description: p.description,
      active: p.active,
      sortOrder: p.sort_order,
      venueId: p.venue_id,
      physicalSizeCategory: p.physical_size_category as ClubPitch["physicalSizeCategory"],
      customLengthM: p.custom_length_m == null ? null : Number(p.custom_length_m),
      customWidthM: p.custom_width_m == null ? null : Number(p.custom_width_m),
      layout: p.layout as ClubPitch["layout"],
      laneCount: p.lane_count,
      coverImagePath: p.cover_image_path,
      coverStockKey: p.cover_stock_key,
    })),
    changingRooms: (changingRooms ?? []).map((r) => ({
      id: r.id,
      venueId: r.venue_id,
      displayName: r.display_name,
      roomType: r.room_type as VenueChangingRoom["roomType"],
      active: r.active,
      sortOrder: r.sort_order,
      coverImagePath: r.cover_image_path,
      coverStockKey: r.cover_stock_key,
    })),
  }
}

export interface VenueInput {
  name: string
  directions: string
  line1: string
  line2: string
  town: string
  county: string
  postcode: string
  country: string
  setDefault: boolean
  /** Omit (undefined) to leave the venue's current facility flags untouched -- `save_club_venue`
   * coalesces against the existing value, never a hard default, so a caller with no UI for these
   * (web's venue form, today) never silently resets a Club Admin's own choice. */
  cateringAvailable?: boolean
  changingRoomsAvailable?: boolean
  /** A precise, provider-selected pin -- see AddressLookup. Omit to leave coordinates as they are
   * (an existing pin, or whatever the async postcode geocoder later resolves for a brand new one). */
  latitude?: number | null
  longitude?: number | null
  addressProviderRef?: string | null
}

export const EMPTY_VENUE_INPUT: VenueInput = { name: "", directions: "", line1: "", line2: "", town: "", county: "", postcode: "", country: "United Kingdom", setDefault: false, cateringAvailable: true, changingRoomsAvailable: true, latitude: null, longitude: null, addressProviderRef: null }

export function venueInputFrom(v: ClubVenue): VenueInput {
  return {
    name: v.name,
    directions: v.directions ?? "",
    line1: v.addressLine1 ?? "",
    line2: v.addressLine2 ?? "",
    town: v.town ?? "",
    county: v.county ?? "",
    postcode: v.postcode ?? "",
    country: v.country ?? "United Kingdom",
    setDefault: v.isDefaultHome,
    cateringAvailable: v.cateringAvailable,
    changingRoomsAvailable: v.changingRoomsAvailable,
    // Deliberately NOT v.latitude/v.longitude: re-opening an existing venue for editing must not
    // silently resend its own current pin as if it were a fresh AddressLookup selection --
    // `saveClubVenue`'s `?? undefined` turns this null into "omit the parameter", so a save that
    // touches nothing else leaves the existing pin and its true provenance (postcodes.io or
    // getaddress.io, whichever it really was) untouched. A genuine re-selection sets these itself.
    latitude: null,
    longitude: null,
    addressProviderRef: null,
  }
}

/** What the server will refuse, said before the round trip. The operation is the authority. */
export function venueInputProblem(input: VenueInput): string | null {
  if (!input.name.trim()) return "A venue name is required."
  return null
}

/** The domain operation. Returns the venue id. Throws the server's own error. */
export async function saveClubVenue(supabase: Client, clubId: string, venueId: string | null, input: VenueInput): Promise<string> {
  const { data, error } = await supabase.rpc("save_club_venue", {
    p_club_id: clubId,
    p_venue_id: venueId ?? undefined,
    p_name: input.name,
    p_directions: input.directions,
    p_line1: input.line1,
    p_line2: input.line2,
    p_town: input.town,
    p_county: input.county,
    p_postcode: input.postcode,
    p_country: input.country,
    p_set_default: input.setDefault,
    p_catering_available: input.cateringAvailable ?? undefined,
    p_changing_rooms_available: input.changingRoomsAvailable ?? undefined,
    p_latitude: input.latitude ?? undefined,
    p_longitude: input.longitude ?? undefined,
    p_provider_ref: input.addressProviderRef ?? undefined,
  })
  if (error) throw error
  return data as string
}

export async function setVenueActive(supabase: Client, venueId: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_venue_active", { p_id: venueId, p_active: active })
  if (error) throw error
}

export async function setDefaultVenue(supabase: Client, venueId: string): Promise<void> {
  const { error } = await supabase.rpc("set_default_venue", { p_id: venueId })
  if (error) throw error
}

export async function createClubPitch(supabase: Client, clubId: string, displayName: string, venueId: string | null): Promise<string> {
  const { data, error } = await supabase.rpc("create_club_pitch", { p_club_id: clubId, p_display_name: displayName, p_description: undefined, p_venue_id: venueId ?? undefined })
  if (error) throw error
  return data as string
}

export async function renameClubPitch(supabase: Client, pitchId: string, newName: string): Promise<void> {
  const { error } = await supabase.rpc("rename_club_pitch", { p_pitch_id: pitchId, p_new_name: newName })
  if (error) throw error
}

export async function setClubPitchActive(supabase: Client, pitchId: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_club_pitch_active", { p_pitch_id: pitchId, p_active: active })
  if (error) throw error
}

export async function setClubPitchDescription(supabase: Client, pitchId: string, description: string): Promise<void> {
  const { error } = await supabase.rpc("set_club_pitch_description", { p_pitch_id: pitchId, p_description: description })
  if (error) throw error
}

/** Grounds & Pitches' own draft shape for editing a pitch's physical size and split layout. */
export interface PitchConfigurationInput {
  physicalSizeCategory: ClubPitch["physicalSizeCategory"]
  customLengthM: string
  customWidthM: string
  layout: ClubPitch["layout"]
}

export function pitchConfigurationInputFrom(p: Pick<ClubPitch, "physicalSizeCategory" | "customLengthM" | "customWidthM" | "layout">): PitchConfigurationInput {
  return { physicalSizeCategory: p.physicalSizeCategory, customLengthM: p.customLengthM == null ? "" : String(p.customLengthM), customWidthM: p.customWidthM == null ? "" : String(p.customWidthM), layout: p.layout }
}

/** What the server will refuse, said before the round trip (Section 15's own custom-dimensions check, mirrored client-side). */
export function pitchConfigurationInputProblem(input: PitchConfigurationInput): string | null {
  if (input.physicalSizeCategory !== "custom") return null
  const length = Number(input.customLengthM)
  const width = Number(input.customWidthM)
  if (!input.customLengthM.trim() || !input.customWidthM.trim() || !Number.isFinite(length) || !Number.isFinite(width) || length <= 0 || width <= 0) {
    return "Custom size needs a length and width in metres, both greater than zero."
  }
  return null
}

export async function setClubPitchConfiguration(supabase: Client, pitchId: string, input: PitchConfigurationInput): Promise<void> {
  const { error } = await supabase.rpc("set_club_pitch_configuration", {
    p_pitch_id: pitchId,
    p_physical_size_category: input.physicalSizeCategory,
    p_layout: input.layout,
    p_custom_length_m: input.physicalSizeCategory === "custom" ? Number(input.customLengthM) : undefined,
    p_custom_width_m: input.physicalSizeCategory === "custom" ? Number(input.customWidthM) : undefined,
  })
  if (error) throw error
}

export interface VenueCapabilities {
  /** venue.venue.view */
  view: boolean
  /** venue.venue.manage */
  manageVenues: boolean
  /** venue.pitch.manage */
  managePitches: boolean
  /** venue.pitch_allocation.manage -- the allocation board's own authority, never fixture edit (CA-M4). */
  allocate: boolean
  /** venue.pitch_allocation.view -- may open the board read-only (CA-M11.1). */
  viewAllocation: boolean
}

/** Asked of the server in one round trip; each action still asks its own key. */
export async function readVenueCapabilities(supabase: Client, clubId: string): Promise<VenueCapabilities> {
  const { data, error } = await supabase.rpc("my_capabilities", { p_scope_type: "club", p_club_id: clubId })
  if (error) return { view: false, manageVenues: false, managePitches: false, allocate: false, viewAllocation: false }
  const allowed = new Set((data ?? []).filter((r) => r.allowed === true).map((r) => r.capability_key))
  return { view: allowed.has("venue.venue.view"), manageVenues: allowed.has("venue.venue.manage"), managePitches: allowed.has("venue.pitch.manage"), allocate: allowed.has("venue.pitch_allocation.manage"), viewAllocation: allowed.has("venue.pitch_allocation.view") }
}

/** One display line for both clients: the structured parts, then the postcode. */
export function venueAddressLine(v: Pick<ClubVenue, "addressLine1" | "addressLine2" | "town" | "county" | "postcode">): string {
  return [v.addressLine1, v.addressLine2, v.town, v.county, v.postcode].filter((s): s is string => !!s && s.trim().length > 0).join(", ")
}

/**
 * Where to send a maps app. Only a pin the platform derived and confirmed (`geocode_status =
 * 'success'`) is used as coordinates; otherwise the postcode or address is the query. Read-only
 * convenience over canonical data; nothing here writes.
 */
export function venueMapsQuery(v: ClubVenue): { kind: "coordinates"; latitude: number; longitude: number } | { kind: "query"; query: string } | null {
  if (v.geocodeStatus === "success" && v.latitude != null && v.longitude != null) return { kind: "coordinates", latitude: v.latitude, longitude: v.longitude }
  const line = venueAddressLine(v)
  if (line) return { kind: "query", query: `${v.name}, ${line}` }
  return null
}

/** One error rule: the server's own sentence for the outcomes it writes for people; a fallback for everything else. */
export function venueErrorMessage(error: unknown, fallback: string): string {
  const e = (error ?? {}) as { code?: string; message?: string }
  if (e.code === "42501" || e.code === "22023" || e.code === "P0001" || e.code === "P0002" || e.code === "23505") {
    if (e.code === "23505") return "This club already has a venue or pitch with that name."
    return e.message || fallback
  }
  return fallback
}

/**
 * Ask the platform to pin this venue again (CA-M3). The pin is never derived by a client: the
 * platform looks the postcode up through its own worker and records the answer; this only asks.
 */
export async function requestVenueGeocoding(supabase: Client, venueId: string): Promise<void> {
  const { error } = await supabase.rpc("request_venue_geocoding", { p_venue_id: venueId })
  if (error) throw error
}

const SIZE_LABEL: Record<ClubPitch["physicalSizeCategory"], string> = { full: "Full size", three_quarter: "Three-quarter size", half: "Half size", custom: "Custom size" }
const LAYOUT_SUFFIX: Record<ClubPitch["layout"], string> = { full_only: "", two_halves: ", split into two halves", four_quarters: ", split into four quarters" }

/** "Full size pitch" / "Half size pitch, split into two halves" -- the one summary line Venue Detail's
 * Pitches tab and Edit Pitch both show, so they can never disagree (mirrors the Add Venue wizard's own
 * `pitchSummaryLabel`, over the canonical `ClubPitch` shape rather than the wizard's draft shape). */
export function clubPitchSummaryLabel(p: Pick<ClubPitch, "physicalSizeCategory" | "layout" | "customLengthM" | "customWidthM">): string {
  if (p.physicalSizeCategory === "custom") {
    const dims = p.customLengthM && p.customWidthM ? ` (${p.customLengthM}m x ${p.customWidthM}m)` : ""
    return `Custom size pitch${dims}`
  }
  return `${SIZE_LABEL[p.physicalSizeCategory]} pitch${LAYOUT_SUFFIX[p.layout]}`
}

const ROOM_TYPE_LABEL: Record<VenueChangingRoom["roomType"], string> = {
  full_size: "Full size changing room",
  smaller: "Smaller changing room",
  match_officials: "Match officials changing",
}

export function venueChangingRoomTypeLabel(roomType: VenueChangingRoom["roomType"]): string {
  return ROOM_TYPE_LABEL[roomType]
}

export async function createVenueChangingRoom(supabase: Client, clubId: string, venueId: string, displayName: string, roomType: VenueChangingRoom["roomType"], coverStockKey: string | null): Promise<string> {
  const { data, error } = await supabase.rpc("create_venue_changing_room", { p_club_id: clubId, p_venue_id: venueId, p_display_name: displayName, p_room_type: roomType, p_cover_stock_key: coverStockKey ?? undefined })
  if (error) throw error
  return data as string
}

export async function updateVenueChangingRoom(supabase: Client, changingRoomId: string, displayName: string, roomType: VenueChangingRoom["roomType"]): Promise<void> {
  const { error } = await supabase.rpc("update_venue_changing_room", { p_changing_room_id: changingRoomId, p_display_name: displayName, p_room_type: roomType })
  if (error) throw error
}

export async function setVenueChangingRoomActive(supabase: Client, changingRoomId: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_venue_changing_room_active", { p_changing_room_id: changingRoomId, p_active: active })
  if (error) throw error
}
