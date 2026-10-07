import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

type Client = SupabaseClient<Database>

/**
 * WHERE A MATCH IS PLAYED -- the host's ground, pitch and changing rooms (20270728).
 *
 * The host is the HOME side, whoever is looking. A host club on Ovalball (CANONICAL) offers its own
 * grounds, pitches and rooms, and the match only ever references them; the opposition picks from that
 * catalogue and never writes to it. A host that is not on Ovalball (PROVISIONAL) has nothing to pick
 * from, so the ground is its Club Directory home ground, the pitch is written down, and the changing
 * rooms are numbered -- all of it held on this match alone. Until home or away is agreed (UNDECIDED)
 * there is no host, and so no ground.
 *
 * The server validates every one of these rules; this module only reads and writes through it.
 */
export type FacilityMode = "CANONICAL" | "PROVISIONAL" | "UNDECIDED"

export interface FacilityVenue {
  id: string
  name: string
  address: string | null
  postcode: string | null
  isDefault: boolean
  coverImagePath: string | null
  coverStockKey: string | null
  changingRoomsAvailable: boolean | null
  cateringAvailable: boolean | null
}

export interface FacilityPitch {
  id: string
  venueId: string | null
  name: string
  description: string | null
  size: string | null
  coverImagePath: string | null
  coverStockKey: string | null
}

export interface FacilityRoom {
  id: string
  venueId: string
  name: string
  roomType: string | null
  coverImagePath: string | null
  coverStockKey: string | null
}

export interface FixtureFacilityOptions {
  mode: FacilityMode
  hostIsOwning: boolean | null
  hostClubName: string | null
  defaultVenueId: string | null
  provisionalGround: { name: string | null; address: string | null; postcode: string | null } | null
  venues: FacilityVenue[]
  pitches: FacilityPitch[]
  rooms: FacilityRoom[]
}

/** The host's options -- for the match as saved, or as it would be with `homeAway` (before saving). */
export async function readFixtureFacilityOptions(
  supabase: Client,
  fixtureId: string,
  homeAway: "Home" | "Away" | "TBD" | "Not Applicable" | null = null
): Promise<FixtureFacilityOptions> {
  const { data, error } = await supabase.rpc("get_fixture_facility_options", {
    p_fixture_id: fixtureId,
    ...(homeAway ? { p_home_away: homeAway } : {}),
  })
  if (error) throw error
  return data as unknown as FixtureFacilityOptions
}

/** Keys present change; keys absent keep their value. An empty string or null clears. */
export interface FixtureFacilitiesPatch {
  venue_id?: string | null
  venue_text?: string | null
  pitch_id?: string | null
  pitch_text?: string | null
  home_room_id?: string | null
  away_room_id?: string | null
  home_room_number?: number | null
  away_room_number?: number | null
  /** The host's room for the match officials, at the fixture's ground -- a host on Ovalball only. */
  officials_room_id?: string | null
  no_changing_rooms?: boolean
  changing_room_notes?: string | null
  catering_required?: boolean
}

export interface FixtureFacilitiesResult {
  mode: FacilityMode
  /** Choices the server cleared because they no longer fitted the ground -- "pitch", "home_room", "away_room", "officials_room". */
  cleared: string[]
}

export async function setFixtureFacilities(supabase: Client, fixtureId: string, patch: FixtureFacilitiesPatch): Promise<FixtureFacilitiesResult> {
  const { data, error } = await supabase.rpc("set_fixture_facilities", { p_fixture_id: fixtureId, p_patch: patch as never })
  if (error) throw error
  return data as unknown as FixtureFacilitiesResult
}

/** Numbered changing rooms for a host that is not on Ovalball. */
export const PROVISIONAL_ROOM_NUMBERS: readonly number[] = Array.from({ length: 20 }, (_, i) => i + 1)

/**
 * A STABLE CHOICE FROM A STOCK CATALOGUE for something with no picture of its own -- a typed pitch, a
 * numbered room. The same match always shows the same picture, on every device and every visit; it is
 * illustrative, never presented as a photograph of the real place.
 */
export { stableStockIndex } from "../media/stock-library"

/** "Room 4", or the canonical room's own name. */
export function changingRoomLabel(room: { name: string } | null, number: number | null): string | null {
  if (room) return room.name
  if (number !== null && number !== undefined) return `Room ${number}`
  return null
}
