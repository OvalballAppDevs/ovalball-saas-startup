import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

type Client = SupabaseClient<Database>

/**
 * CLUB VENUES AND PITCHES, for both clients (CA-M2).
 *
 * READS are the tables under RLS, exactly what the website's Lookup Administration page reads
 * (`venues_select` = venue.venue.view; `club_pitches_select`). WRITES are the canonical operations:
 * `save_club_venue` (one transaction: name, directions, address, default), `set_venue_active`,
 * `set_default_venue`, and the pitch operations `create_club_pitch`, `rename_club_pitch`,
 * `set_club_pitch_active`, `set_club_pitch_venue`. There is no delete anywhere in the product:
 * a venue or pitch is deactivated and keeps every fixture, session and history row that points at it.
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
}

export interface ClubPitch {
  id: string
  displayName: string
  description: string | null
  active: boolean
  sortOrder: number
  venueId: string | null
}

export interface ClubVenues {
  venues: ClubVenue[]
  pitches: ClubPitch[]
}

export async function readClubVenues(supabase: Client, clubId: string): Promise<ClubVenues> {
  const [{ data: venues, error: ve }, { data: pitches, error: pe }] = await Promise.all([
    supabase
      .from("venues")
      .select("id, name, address_line_1, address_line_2, town, county, postcode, country, directions, active, is_default_home, latitude, longitude, geocode_status")
      .eq("club_id", clubId)
      .order("is_default_home", { ascending: false })
      .order("name"),
    supabase.from("club_pitches").select("id, display_name, description, active, sort_order, venue_id").eq("club_id", clubId).order("sort_order"),
  ])
  if (ve) throw ve
  if (pe) throw pe
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
    })),
    pitches: (pitches ?? []).map((p) => ({ id: p.id, displayName: p.display_name, description: p.description, active: p.active, sortOrder: p.sort_order, venueId: p.venue_id })),
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
}

export const EMPTY_VENUE_INPUT: VenueInput = { name: "", directions: "", line1: "", line2: "", town: "", county: "", postcode: "", country: "United Kingdom", setDefault: false }

export function venueInputFrom(v: ClubVenue): VenueInput {
  return { name: v.name, directions: v.directions ?? "", line1: v.addressLine1 ?? "", line2: v.addressLine2 ?? "", town: v.town ?? "", county: v.county ?? "", postcode: v.postcode ?? "", country: v.country ?? "United Kingdom", setDefault: v.isDefaultHome }
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

export interface VenueCapabilities {
  /** venue.venue.view */
  view: boolean
  /** venue.venue.manage */
  manageVenues: boolean
  /** venue.pitch.manage */
  managePitches: boolean
}

/** Asked of the server in one round trip; each action still asks its own key. */
export async function readVenueCapabilities(supabase: Client, clubId: string): Promise<VenueCapabilities> {
  const { data, error } = await supabase.rpc("my_capabilities", { p_scope_type: "club", p_club_id: clubId })
  if (error) return { view: false, manageVenues: false, managePitches: false }
  const allowed = new Set((data ?? []).filter((r) => r.allowed === true).map((r) => r.capability_key))
  return { view: allowed.has("venue.venue.view"), manageVenues: allowed.has("venue.venue.manage"), managePitches: allowed.has("venue.pitch.manage") }
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
