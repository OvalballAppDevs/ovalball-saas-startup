"use server"

import { revalidatePath } from "next/cache"

import { bulkLookupPostcodes } from "@/lib/geocoding/postcodes-io"
import { searchUkAddresses, type AddressLookupResult } from "@/lib/address-lookup/lookup"
import { createClient } from "@/lib/supabase/server"

/**
 * EVENT MANAGEMENT'S WRITES.
 *
 * Every one of them is a thin call onto a canonical database function that
 * does the authorising. Nothing in this file decides who may do what:
 * public.save_club_event gates on the capability engine, validates the span,
 * enforces venue XOR external location, and rejects any team, pitch or venue
 * that does not belong to the club. A forged id in a form post is refused
 * there, where a crafted request cannot route around it.
 */

/**
 * Address lookup for an external event location.
 *
 * THE PROVIDER IS NEVER REACHED FROM THE BROWSER. This is a server action, so
 * the address provider's credentials stay on the server exactly as they do for
 * club venue lookup -- the same searchUkAddresses the venue form already uses,
 * not a second integration.
 */
export async function lookupEventAddress(query: string): Promise<AddressLookupResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "You must be signed in." }
  if (query.trim().length < 3) return { status: "ok", candidates: [] }
  return searchUkAddresses(query)
}

export type SaveEventResult = { ok: true; eventId: string } | { ok: false; error: string }

export interface SaveEventInput {
  eventId?: string | null
  clubId: string
  name: string
  description?: string | null
  startsOn: string
  startTime?: string | null
  endsOn: string
  endTime?: string | null
  isClubWide: boolean
  teamIds: string[]
  pitchIds: string[]
  /** Exactly one of these two is used; the database enforces that. */
  venueId?: string | null
  external?: {
    name: string
    line1?: string | null
    line2?: string | null
    town?: string | null
    county?: string | null
    postcode?: string | null
  } | null
}

export async function saveClubEvent(input: SaveEventInput): Promise<SaveEventResult> {
  const supabase = await createClient()

  // COORDINATES FOR AN EXTERNAL ADDRESS, RESOLVED SERVER-SIDE.
  //
  // Stored so the event's weather panel and map have somewhere to point --
  // a free-text line alone could never be forecast against. Resolved from the
  // postcode through the same postcodes.io client the venue backfill uses, and
  // NEVER taken from the browser: a client-supplied latitude/longitude is an
  // unverified claim about where an event is, and this form does not accept
  // one.
  let latitude: number | null = null
  let longitude: number | null = null
  if (input.external?.postcode) {
    const coords = await bulkLookupPostcodes([input.external.postcode])
    const hit = coords.get(input.external.postcode.trim())
    if (hit) {
      latitude = hit.latitude
      longitude = hit.longitude
    }
    // A postcode the provider cannot resolve simply yields no coordinates --
    // never a fabricated 0,0, and never an approximate guess. The event saves;
    // its weather panel says the location is unavailable, honestly.
  }

  const { data, error } = await supabase.rpc("save_club_event", {
    p_club_id: input.clubId,
    p_name: input.name,
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn,
    p_event_id: input.eventId ?? undefined,
    p_description: input.description ?? undefined,
    p_start_time: input.startTime || undefined,
    p_end_time: input.endTime || undefined,
    p_is_club_wide: input.isClubWide,
    p_team_ids: input.teamIds,
    p_pitch_ids: input.pitchIds,
    p_venue_id: input.venueId ?? undefined,
    p_external_location_name: input.external?.name ?? undefined,
    p_external_address_line_1: input.external?.line1 ?? undefined,
    p_external_address_line_2: input.external?.line2 ?? undefined,
    p_external_town: input.external?.town ?? undefined,
    p_external_county: input.external?.county ?? undefined,
    p_external_postcode: input.external?.postcode ?? undefined,
    p_external_country: undefined,
    p_external_latitude: latitude ?? undefined,
    p_external_longitude: longitude ?? undefined,
    p_external_address_provider_ref: undefined,
    p_season_id: undefined,
  })

  if (error) return { ok: false, error: toPublicError(error.message) }

  revalidatePath("/club/events")
  revalidatePath("/calendar")
  revalidatePath("/calendar/pitch-allocation")
  if (data) revalidatePath(`/events/${data}`)
  return { ok: true, eventId: String(data) }
}

export async function cancelClubEvent(eventId: string, reason: string | null): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("cancel_club_event", { p_event_id: eventId, p_reason: reason ?? undefined })
  if (error) return { ok: false, error: toPublicError(error.message) }
  revalidatePath("/club/events")
  revalidatePath("/calendar")
  revalidatePath(`/events/${eventId}`)
  return { ok: true }
}

/**
 * The database's own validation messages are written for people and are safe
 * to show. Anything else is logged and replaced, so a Postgres error never
 * becomes a description of the schema in somebody's browser.
 */
const SAFE_PREFIXES = [
  "An event needs",
  "An event cannot",
  "A club-wide event",
  "Choose at least one team",
  "One of those teams",
  "One of those pitches",
  "That venue does not belong",
  "You do not have permission",
  "Only club administration",
]

function toPublicError(message: string): string {
  if (SAFE_PREFIXES.some((p) => message.startsWith(p))) return message
  console.error("Club event RPC raw error (sanitized before returning to browser):", message)
  return "Something went wrong. Please try again."
}
