/**
 * WHICH PICTURE ARENA HOME OPENS ON -- the owner's order, as data (no React Native here, so it is tested on
 * its own in `hero-photo-choice.test.mts`). Arena should look like the club's own estate, so the club's own
 * pictures of its PRIMARY venue come first, and Ovalball's picture of a ground only when there is none:
 *
 *   A. the primary venue's own picture -- a photograph the club uploaded, else a library picture the club
 *      chose for it (still a choice somebody at the club made);
 *   B. a photograph the club uploaded of one of that venue's pitches -- its ground, by the people who run it;
 *   C. Ovalball's Arena picture.
 *
 * There is no Arena-only photo: the venue's picture is the one record (`venues.cover_image_path` /
 * `cover_stock_key`), so changing it from Arena Settings changes the venue too, and the other way round.
 *
 * A candidate that is too small or the wrong shape for a full-width banner is passed over for the next one
 * rather than shown poorly (`heroUnsuitable`). Ovalball's own pictures are marked Illustrative wherever they
 * are shown; a club's photograph never is.
 */

/** The venue and pitch fields the order is decided from -- both the Arena Home and the Arena day projections carry them. */
export type HeroVenue = { id: string; name: string; isDefault: boolean; coverImagePath: string | null; coverStockKey: string | null }
export type HeroPitch = { id: string; venueId: string; name: string; active: boolean; sortOrder: number; coverImagePath: string | null }

export type HeroCandidate =
  | { origin: "VENUE_PHOTO"; ownership: "club"; venueId: string; venueName: string; path: string }
  | { origin: "VENUE_LIBRARY"; ownership: "ovalball"; venueId: string; venueName: string; stockKey: string }
  | { origin: "PITCH_PHOTO"; ownership: "club"; venueId: string; venueName: string; pitchId: string; pitchName: string; path: string }
  | { origin: "ARENA_LIBRARY"; ownership: "ovalball" }

/** The club's primary venue -- the one marked as its home ground. */
export function primaryVenue<V extends HeroVenue>(venues: readonly V[]): V | null {
  return venues.find((v) => v.isDefault) ?? null
}

export function arenaHeroCandidates(input: { venues: readonly HeroVenue[]; pitches: readonly HeroPitch[] }): HeroCandidate[] {
  const out: HeroCandidate[] = []
  const venue = primaryVenue(input.venues)
  if (venue) {
    const path = (venue.coverImagePath ?? "").trim()
    if (path) out.push({ origin: "VENUE_PHOTO", ownership: "club", venueId: venue.id, venueName: venue.name, path })
    else if (venue.coverStockKey) out.push({ origin: "VENUE_LIBRARY", ownership: "ovalball", venueId: venue.id, venueName: venue.name, stockKey: venue.coverStockKey })
    const ground = input.pitches
      .filter((p) => p.venueId === venue.id && p.active && (p.coverImagePath ?? "").trim())
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    for (const p of ground) {
      out.push({ origin: "PITCH_PHOTO", ownership: "club", venueId: venue.id, venueName: venue.name, pitchId: p.id, pitchName: p.name, path: (p.coverImagePath ?? "").trim() })
    }
  }
  out.push({ origin: "ARENA_LIBRARY", ownership: "ovalball" })
  return out
}

/**
 * What a picture needs to be to fill the Arena banner well: wide enough for a full-width 3x phone screen
 * (club uploads are saved 1,600 pixels wide, 1,200 at the least), tall enough to crop, and landscape, so the
 * words at its foot land on the photograph's own ground rather than on a sliver of a portrait.
 */
export const HERO_MINIMUM = { width: 1200, height: 600, aspect: 1.25 } as const

export type HeroUnsuitable = "too small" | "not landscape"

export function heroUnsuitable(px: { width: number; height: number }): HeroUnsuitable | null {
  if (!(px.width > 0 && px.height > 0)) return "too small"
  if (px.width / px.height < HERO_MINIMUM.aspect) return "not landscape"
  if (px.width < HERO_MINIMUM.width || px.height < HERO_MINIMUM.height) return "too small"
  return null
}

/** What is showing, in words, for Arena Settings ("Showing your photograph of Pitch 1 at Ovalball UAT Ground"). */
export function heroDescription(c: HeroCandidate): string {
  switch (c.origin) {
    case "VENUE_PHOTO":
      return `Your photograph of ${c.venueName}`
    case "VENUE_LIBRARY":
      return `The Ovalball library picture chosen for ${c.venueName}`
    case "PITCH_PHOTO":
      return `Your photograph of ${c.pitchName} at ${c.venueName}`
    case "ARENA_LIBRARY":
      return "Ovalball's Arena picture"
  }
}
