import { type SupabaseClient } from "@supabase/supabase-js"

import { type Database } from "@/types/database.types"

/**
 * EVENT CENTRE'S ONE READ.
 *
 * Sibling of lib/app-context/training-centre-data.ts, and deliberately the
 * same shape: one bounded server read that returns the event, its resolved
 * location, its teams, its pitches, the viewer's own players, and the
 * CAPABILITIES that decide what the page puts in front of them.
 *
 * THE CAPABILITIES COME FROM THE DATABASE, not from a role name read here.
 * get_club_event_card resolves can_manage and can_view_register through the
 * same capability engine and the same visibility rule the RLS policy uses, so
 * this module has no authority decision of its own to get wrong -- it cannot
 * widen anything, because there is nothing here to widen from.
 *
 * A FORGED ID RETURNS NULL. get_club_event_card answers null for an event the
 * caller may not see, and the page turns that into notFound() -- the same
 * answer a genuinely missing event gives, so the route cannot be used to test
 * whether some other club's event exists.
 */

export interface EventLocation {
  /** The venue's name, or the external location's name. One model, resolved. */
  name: string
  address: string | null
  postcode: string | null
  latitude: number | null
  longitude: number | null
  directions: string | null
  /**
   * How the coordinates were arrived at. Only 'success' means they came from
   * the location's own canonical postcode; Match Conditions withholds the map
   * for anything else, and an event inherits that judgement rather than
   * pinning a hand-typed number.
   */
  geocodeStatus: string | null
  /** True when this is an external address rather than a canonical club venue. */
  isExternal: boolean
}

export interface EventTeamRef {
  id: string
  displayName: string
}

export interface EventPitchRef {
  id: string
  displayName: string
}

export interface EventPlayerEntry {
  playerId: string
  playerName: string
  teamDisplayName: string | null
  status: string | null
  /**
   * Whether THIS viewer may answer for THIS player, resolved by the canonical
   * safeguarding rule -- guardian always, the player themselves at 18+, 16-17
   * only with recorded consent, under-16 never.
   */
  canRespond: boolean
}

export interface EventRegisterEntry {
  playerId: string
  playerName: string
  teamId: string
  teamDisplayName: string
  status: string | null
}

export interface EventCentreContext {
  id: string
  clubId: string
  name: string
  description: string | null
  startsOn: string
  startTime: string | null
  endsOn: string
  endTime: string | null
  isMultiDay: boolean
  /** No start time at all is the all-day semantic -- never a fake midnight. */
  isAllDay: boolean
  isClubWide: boolean
  status: string
  cancelledAt: string | null
  cancellationReason: string | null
  clubName: string
  clubLogoPath: string | null
  location: EventLocation | null
  teams: EventTeamRef[]
  pitches: EventPitchRef[]
  canManage: boolean
  canViewRegister: boolean
  myPlayers: EventPlayerEntry[]
  register: EventRegisterEntry[]
}

type Client = SupabaseClient<Database>

export async function getEventCentreContext(supabase: Client, eventId: string): Promise<EventCentreContext | null> {
  const { data: card } = await supabase.rpc("get_club_event_card", { p_event_id: eventId })
  if (!card) return null

  const c = card as Record<string, unknown>
  const venue = c.venue as Record<string, unknown> | null
  const external = c.external_location as Record<string, unknown> | null

  // ONE LOCATION, RESOLVED ONCE. The database guarantees venue XOR external,
  // so this cannot produce two answers -- and every consumer below (the hero,
  // the directions link, the weather panel) reads this single resolved value
  // rather than re-deciding which model applies.
  const location: EventLocation | null = venue
    ? {
        name: String(venue.name ?? ""),
        address: (venue.address as string) ?? null,
        postcode: (venue.postcode as string) ?? null,
        latitude: venue.latitude === null || venue.latitude === undefined ? null : Number(venue.latitude),
        longitude: venue.longitude === null || venue.longitude === undefined ? null : Number(venue.longitude),
        directions: (venue.directions as string) ?? null,
        geocodeStatus: (venue.geocode_status as string) ?? null,
        isExternal: false,
      }
    : external
      ? {
          name: String(external.name ?? ""),
          address:
            [external.address_line_1, external.address_line_2, external.town, external.county, external.postcode]
              .filter((p) => typeof p === "string" && p.trim().length > 0)
              .join(", ") || null,
          postcode: (external.postcode as string) ?? null,
          latitude: external.latitude === null || external.latitude === undefined ? null : Number(external.latitude),
          longitude: external.longitude === null || external.longitude === undefined ? null : Number(external.longitude),
          directions: null,
          // An external address only ever gets coordinates from the address
          // lookup that resolved it, so where they exist they are provider
          // output rather than typed numbers.
          geocodeStatus: external.latitude === null || external.latitude === undefined ? null : "success",
          isExternal: true,
        }
      : null

  const startsOn = String(c.starts_on)
  const endsOn = String(c.ends_on)
  const startTime = (c.start_time as string) ?? null

  // Both of the viewer-scoped reads run together: neither depends on the
  // other, and Event Centre should cost one round trip's latency, not three.
  const [{ data: mine }, { data: reg }] = await Promise.all([
    supabase.rpc("get_my_players_for_club_event", { p_event_id: eventId }),
    c.can_view_register ? supabase.rpc("get_club_event_register", { p_event_id: eventId }) : Promise.resolve({ data: [] }),
  ])

  return {
    id: String(c.id),
    clubId: String(c.club_id),
    name: String(c.name),
    description: (c.description as string) ?? null,
    startsOn,
    startTime,
    endsOn,
    endTime: (c.end_time as string) ?? null,
    isMultiDay: endsOn > startsOn,
    isAllDay: startTime === null,
    isClubWide: Boolean(c.is_club_wide),
    status: String(c.status),
    cancelledAt: (c.cancelled_at as string) ?? null,
    cancellationReason: (c.cancellation_reason as string) ?? null,
    clubName: String(c.club_name ?? ""),
    clubLogoPath: (c.club_logo_path as string) ?? null,
    location,
    teams: ((c.teams as Record<string, unknown>[]) ?? []).map((t) => ({
      id: String(t.id),
      displayName: String(t.display_name ?? ""),
    })),
    pitches: ((c.pitches as Record<string, unknown>[]) ?? []).map((p) => ({
      id: String(p.id),
      displayName: String(p.display_name ?? ""),
    })),
    canManage: Boolean(c.can_manage),
    canViewRegister: Boolean(c.can_view_register),
    myPlayers: (mine ?? []).map((m) => ({
      playerId: m.player_id,
      playerName: m.player_name ?? "",
      teamDisplayName: m.team_display_name ?? null,
      status: m.status ?? null,
      canRespond: Boolean(m.can_respond),
    })),
    register: (reg ?? []).map((r) => ({
      playerId: r.player_id,
      playerName: r.player_name ?? "",
      teamId: r.team_id,
      teamDisplayName: r.team_display_name ?? "",
      status: r.status ?? null,
    })),
  }
}

/**
 * WHEN TO FORECAST FOR.
 *
 * A single-day event forecasts its own start. A multi-day event forecasts its
 * FIRST day, because that is the decision a person is making when they open
 * the page ("what should I wear on Friday"), and because a forecast reaching
 * the far end of a seven-day run is beyond the provider's useful horizon
 * anyway -- the adapter answers TOO_EARLY_FOR_FORECAST for that without
 * spending a request.
 *
 * An all-day event has no start time, so it is forecast for late morning:
 * midday weather is what an outdoor club day is actually decided on, and it is
 * an honest stand-in rather than a fabricated 00:00.
 */
export function eventForecastInput(ctx: EventCentreContext) {
  return {
    kickoffDate: ctx.startsOn,
    kickoffTime: ctx.startTime ?? "11:00",
    latitude: ctx.location?.latitude ?? null,
    longitude: ctx.location?.longitude ?? null,
  }
}

/**
 * "12-14 September 2026", "Saturday 12 September 2026".
 *
 * A date RANGE, never a raw timestamp pair. The year and month are printed
 * once when both ends share them, which is what makes a range read as one
 * period rather than as two dates that happen to be adjacent.
 */
export function formatEventDateRange(startsOn: string, endsOn: string): string {
  const start = new Date(`${startsOn}T00:00:00`)
  const end = new Date(`${endsOn}T00:00:00`)

  if (startsOn === endsOn) {
    return start.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
  }

  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()
  if (sameMonth) {
    return `${start.getDate()}–${end.getDate()} ${end.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`
  }

  const sameYear = start.getFullYear() === end.getFullYear()
  const left = start.toLocaleDateString("en-GB", sameYear ? { day: "numeric", month: "long" } : { day: "numeric", month: "long", year: "numeric" })
  const right = end.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
  return `${left} – ${right}`
}
