import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

/**
 * WHERE IS THIS MATCH BEING PLAYED — ONE ANSWER, FOR EVERY SURFACE.
 *
 * A fixture can say where it is in three different ways, and before this each
 * surface picked a different one. The Match Centre read `venue_id` alone and
 * therefore said "the venue hasn't been confirmed yet" about a fixture whose
 * address the Calendar was displaying two taps away; the forecast route read
 * `venue_id` alone and therefore had no coordinates to ask the sky about. The
 * fixture was never ambiguous. The readers were.
 *
 * THE ORDER, AND WHY IT IS THIS ORDER:
 *
 *   1. THE EXPLICIT VENUE (`fixtures.venue_id`). Somebody chose this ground for
 *      this match. A choice always beats a default.
 *
 *   2. THE FIXTURE'S OWN ADDRESS (`fixtures.venue_address`). Free text a fixture
 *      secretary typed, usually when the opponent is a Club Directory entry with
 *      no Ovalball ground behind it. It is a real answer and has been on the
 *      Calendar all along.
 *
 *   3. THE HOME SIDE'S DEFAULT GROUND (`venues.is_default_home` for the home
 *      club). A match with nothing recorded is played where the home side plays,
 *      which is what everybody involved already assumes -- and for an AWAY
 *      fixture that is the OPPOSITION's ground, not ours. Getting that backwards
 *      would send a parent to the wrong town.
 *
 *   4. Nothing. Only then is the venue genuinely unconfirmed.
 *
 * THE NAME AND THE ADDRESS ARE DIFFERENT QUESTIONS. A Match Centre asks "where
 * are we playing" and the answer is a ground's NAME; a navigation control asks
 * "how do I get there" and the answer is an address. Both come from here, so
 * they cannot describe different places.
 *
 * COORDINATES CARRY THEIR PROVENANCE. Only a venue geocoded from its own
 * canonical postcode is offered for a forecast: a number somebody typed can pin a
 * rugby club on a football ground three kilometres away, and asking the sky about
 * the wrong place produces a confident wrong answer rather than an honest absent
 * one. `geocodeStatus` travels with the coordinates so a caller can apply that
 * rule rather than re-deriving it.
 */

export interface ResolvedVenue {
  /** The ground's NAME -- what a Match Centre shows. */
  name: string
  /** The full address, for navigation. Null where only a name is known. */
  address: string | null
  postcode: string | null
  latitude: number | null
  longitude: number | null
  /** "success" where the coordinates were derived from the venue's own postcode. */
  geocodeStatus: string | null
  /** Which rule produced the NAME, so a surface can be honest about it. */
  source: "fixture_venue" | "fixture_address" | "home_ground" | "directory_ground"
  /**
   * WHERE THE COORDINATES CAME FROM, which is not always where the name came from.
   *
   * A fixture secretary types an address for an opponent who has no Ovalball
   * ground: that free text is the best NAME there is, and it has no coordinates at
   * all. The best LOCATION is then the home side's own geocoded record -- their
   * venue, or their Club Directory entry. Two questions, two best answers, and the
   * provenance says so rather than implying the typed line was geocoded.
   */
  coordinateSource: "venue" | "directory" | null
}

/**
 * THE GROUND'S NAME, OUT OF AN ADDRESS SOMEBODY TYPED.
 *
 * A free-text fixture address is written the way a person writes one -- the
 * ground, then how to get to it -- so the first segment is the name and the rest
 * is the journey. This is presentation of a value that already exists, not a
 * parse that invents one: where there is no comma the whole string IS the name,
 * and nothing is discarded because the full text is carried alongside.
 */
export function venueNameFromAddress(address: string): string {
  const first = address.split(",")[0]?.trim()
  return first && first.length > 0 ? first : address.trim()
}

/** The fixture fields this resolver needs. Any reader can supply them from its own select. */
export interface VenueInputs {
  venueId: string | null
  venueAddress: string | null
  /** The club whose ground it is: the owning team's for a home fixture, the opponent's for an away one. */
  homeClubId: string | null
  /**
   * The home side's CLUB DIRECTORY entry, where that side is not an Ovalball club.
   *
   * A directory entry records a home ground and a postcode and carries its own
   * geocode, so an opponent with no Ovalball account still has a real location.
   */
  homeDirectoryId?: string | null
}

/**
 * WHICH CLUB IS AT HOME.
 *
 * `home_away` is the OWNING team's orientation, so "Home" means our club and
 * "Away" means theirs. An unsettled orientation has no home club and therefore no
 * default ground -- which is correct, because a festival is not played at anybody's.
 */
export function homeClubIdFor(input: {
  homeAway: string | null
  owningClubId: string | null
  opponentClubId: string | null
}): string | null {
  if (input.homeAway === "Home") return input.owningClubId
  if (input.homeAway === "Away") return input.opponentClubId
  return null
}

export async function resolveFixtureVenue(
  supabase: SupabaseClient<Database>,
  input: VenueInputs
): Promise<ResolvedVenue | null> {
  // 1. THE EXPLICIT CHOICE.
  if (input.venueId) {
    const { data } = await supabase
      .from("venues")
      .select("name, address, address_line_1, address_line_2, town, county, postcode, latitude, longitude, geocode_status")
      .eq("id", input.venueId)
      .maybeSingle()
    if (data) return fromVenueRow(data, "fixture_venue")
  }

  // 2. WHAT THE FIXTURE ITSELF SAYS.
  const typed = input.venueAddress?.trim()
  if (typed) {
    /*
      FREE TEXT IS THE BEST NAME AND NO LOCATION AT ALL.

      A secretary typed it, usually for an opponent with no Ovalball ground, and
      it is what the Calendar has shown all along -- so it answers "where". It
      cannot answer "which point on the earth", because a string is not a geocode.
      The coordinates therefore come from the home side's own geocoded record, and
      `coordinateSource` says so instead of implying the typed line was geocoded.
    */
    const located = await homeSideLocation(supabase, input)
    return {
      name: venueNameFromAddress(typed),
      address: typed,
      postcode: located?.postcode ?? null,
      latitude: located?.latitude ?? null,
      longitude: located?.longitude ?? null,
      geocodeStatus: located?.geocodeStatus ?? null,
      source: "fixture_address",
      coordinateSource: located?.coordinateSource ?? null,
    }
  }

  // 3. WHERE THE HOME SIDE PLAYS.
  const ground = await homeSideGround(supabase, input.homeClubId)
  if (ground) return ground

  // 4. Genuinely unconfirmed.
  return null
}

/**
 * The home side's own ground: their default Ovalball venue, else the ground their
 * Club Directory entry records. A club that is only a Directory entry still has a
 * home ground and a postcode, and it is canonical data with its own geocode.
 */
async function homeSideGround(
  supabase: SupabaseClient<Database>,
  homeClubId: string | null
): Promise<ResolvedVenue | null> {
  if (!homeClubId) return null
  const { data } = await supabase
    .from("venues")
    .select("name, address, address_line_1, address_line_2, town, county, postcode, latitude, longitude, geocode_status")
    .eq("club_id", homeClubId)
    .eq("is_default_home", true)
    .eq("active", true)
    .limit(1)
    .maybeSingle()
  if (data) return fromVenueRow(data, "home_ground")
  return null
}

/** Coordinates for the home side, from whichever canonical record actually has them. */
async function homeSideLocation(
  supabase: SupabaseClient<Database>,
  input: VenueInputs
): Promise<{
  postcode: string | null
  latitude: number | null
  longitude: number | null
  geocodeStatus: string | null
  coordinateSource: "venue" | "directory"
} | null> {
  const ground = await homeSideGround(supabase, input.homeClubId)
  if (ground) {
    return {
      postcode: ground.postcode,
      latitude: ground.latitude,
      longitude: ground.longitude,
      geocodeStatus: ground.geocodeStatus,
      coordinateSource: "venue",
    }
  }
  if (!input.homeDirectoryId) return null
  const { data } = await supabase
    .from("club_directory")
    .select("home_ground, postcode, latitude, longitude, geocode_status")
    .eq("id", input.homeDirectoryId)
    .maybeSingle()
  if (!data) return null
  return {
    postcode: data.postcode,
    latitude: data.latitude === null ? null : Number(data.latitude),
    longitude: data.longitude === null ? null : Number(data.longitude),
    geocodeStatus: data.geocode_status,
    coordinateSource: "directory",
  }
}

function fromVenueRow(
  row: {
    name: string | null
    address: string | null
    address_line_1: string | null
    address_line_2: string | null
    town: string | null
    county: string | null
    postcode: string | null
    latitude: number | string | null
    longitude: number | string | null
    geocode_status: string | null
  },
  source: ResolvedVenue["source"]
): ResolvedVenue {
  const lines = [row.address_line_1, row.address_line_2, row.town, row.county, row.postcode].filter(
    (l): l is string => Boolean(l && l.trim())
  )
  return {
    name: row.name?.trim() || "Ground",
    // The structured address where the venue has one, else the single-line field.
    address: lines.length > 0 ? lines.join(", ") : (row.address?.trim() || null),
    postcode: row.postcode,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    geocodeStatus: row.geocode_status,
    source,
    coordinateSource: "venue",
  }
}

/**
 * COORDINATES A FORECAST MAY BE ASKED FOR.
 *
 * Only where they came from the venue's OWN canonical postcode. Everything else --
 * free text, a pending geocode, a number somebody typed -- returns null, and the
 * caller says "no location" rather than asking the sky about the wrong place.
 */
export function forecastLocation(venue: ResolvedVenue | null): { latitude: number; longitude: number } | null {
  if (!venue || venue.geocodeStatus !== "success") return null
  if (venue.latitude === null || venue.longitude === null) return null
  return { latitude: venue.latitude, longitude: venue.longitude }
}
