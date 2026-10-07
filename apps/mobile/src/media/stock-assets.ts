import { groupKeyFor } from "@ovalball/contracts/teams/directory-taxonomy"
import {
  isIllustrative,
  resolveObjectMedia,
  stockMedia,
  stockMediaFor,
  type ObjectMedia,
  type StockDomain,
  type StockFallbackHint,
  type StockMediaEntry,
} from "@ovalball/contracts/media/stock-library"

/** A bundled local image -- what `require()` of an image resolves to at build time. */
export type LocalImageAsset = number

/**
 * THE PHONE'S BINDING OF THE ONE STOCK MEDIA LIBRARY (`@ovalball/contracts/media/stock-library`) TO ITS FILES.
 *
 * This is the only place a library picture is `require()`d. Every surface -- a team, a ground, a pitch, a
 * changing room, an event, a tournament -- asks for a picture by key through here, so there is no second
 * catalogue for any of them to drift from. A structural test holds this map, the library and the server's
 * list (`internal.stock_media`) to exactly the same keys.
 */
const STOCK_ASSETS: Record<string, LocalImageAsset> = {
  "pitch-match-02": require("../../assets/training-planning/pitch-match-02.jpg"),
  "clubhouse-evening-01": require("../../assets/training-planning/clubhouse-evening-01.jpg"),
  "venue-brick-clubhouse-01": require("../../assets/training-planning/venue-brick-clubhouse-01.jpg"),
  "venue-small-stand-01": require("../../assets/training-planning/venue-small-stand-01.jpg"),
  "venue-rural-pavilion-01": require("../../assets/training-planning/venue-rural-pavilion-01.jpg"),
  "venue-dusk-01": require("../../assets/training-planning/venue-dusk-01.jpg"),
  "venue-white-pavilion-01": require("../../assets/training-planning/venue-white-pavilion-01.jpg"),
  "venue-village-ground-01": require("../../assets/training-planning/venue-village-ground-01.jpg"),
  "arena-estate-01": require("../../assets/arena/arena-estate-01.jpg"),
  "venue-pavilion-posts-01": require("../../assets/arena/venue-pavilion-posts-01.jpg"),
  "venue-timber-pavilion-01": require("../../assets/arena/venue-timber-pavilion-01.jpg"),
  "venue-clubhouse-dusk-02": require("../../assets/arena/venue-clubhouse-dusk-02.jpg"),
  "pitch-training-02": require("../../assets/training-planning/pitch-training-02.jpg"),
  "pitch-wet-weather-02": require("../../assets/training-planning/pitch-wet-weather-02.jpg"),
  "pitch-shared-training-02": require("../../assets/training-planning/pitch-shared-training-02.jpg"),
  "pitch-4g-01": require("../../assets/training-planning/pitch-4g-01.jpg"),
  "pitch-muddy-01": require("../../assets/training-planning/pitch-muddy-01.jpg"),
  "pitch-sunny-maintained-01": require("../../assets/training-planning/pitch-sunny-maintained-01.jpg"),
  "pitch-training-cones-01": require("../../assets/training-planning/pitch-training-cones-01.jpg"),
  "pitch-hilly-01": require("../../assets/training-planning/pitch-hilly-01.jpg"),
  "pitch-clean-post-01": require("../../assets/training-planning/pitch-clean-post-01.jpg"),
  "pitch-touchline-01": require("../../assets/arena/pitch-touchline-01.jpg"),
  "pitch-through-posts-01": require("../../assets/arena/pitch-through-posts-01.jpg"),
  "pitch-empty-01": require("../../assets/hub/scene-pitch.jpg"),
  "changing-modern-home-01": require("../../assets/training-planning/changing-modern-home-01.jpg"),
  "changing-modern-away-01": require("../../assets/training-planning/changing-modern-away-01.jpg"),
  "changing-traditional-01": require("../../assets/training-planning/changing-traditional-01.jpg"),
  "changing-basic-01": require("../../assets/training-planning/changing-basic-01.jpg"),
  "changing-officials-01": require("../../assets/training-planning/changing-officials-01.jpg"),
  "changing-junior-01": require("../../assets/training-planning/changing-junior-01.jpg"),
  "changing-older-clubhouse-01": require("../../assets/training-planning/changing-older-clubhouse-01.jpg"),
  "changing-tiled-01": require("../../assets/training-planning/changing-tiled-01.jpg"),
  "changing-bench-hooks-01": require("../../assets/training-planning/changing-bench-hooks-01.jpg"),
  "changing-oak-hooks-01": require("../../assets/arena/changing-oak-hooks-01.jpg"),
  "tournament-festival-aerial-01": require("../../assets/arena/tournament-festival-aerial-01.jpg"),
  "changing-compact-01": require("../../assets/training-planning/changing-compact-01.jpg"),
  "rugby-team-scrum-01": require("../../assets/hub/scene-scrum.jpg"),
  "rugby-team-huddle-womens-01": require("../../assets/club-home/team-womens.jpg"),
  "rugby-team-huddle-youth-01": require("../../assets/club-home/team-youth.jpg"),
  "rugby-team-minis-01": require("../../assets/club-home/team-minis.jpg"),
  "rugby-team-general-01": require("../../assets/editorial/rugby-general.jpg"),
  "rugby-team-community-01": require("../../assets/editorial/rugby-community.jpg"),
  "training-session-01": require("../../assets/editorial/hero-training.jpg"),
  "training-session-02": require("../../assets/editorial/rugby-training.jpg"),
  "training-hero-02": require("../../assets/training-planning/training-hero-02.jpg"),
  "training-evening-01": require("../../assets/training-planning/training-evening-01.jpg"),
  "pitch-floodlit-02": require("../../assets/training-planning/pitch-floodlit-02.jpg"),
  "training-coaching-01": require("../../assets/training-planning/training-coaching-01.jpg"),
  "training-equipment-01": require("../../assets/training-planning/training-equipment-01.jpg"),
  "training-player-ball-01": require("../../assets/training-planning/training-player-ball-01.jpg"),
  "training-huddle-01": require("../../assets/training-planning/training-huddle-01.jpg"),
  "matchday-hero-01": require("../../assets/editorial/hero-match.jpg"),
  "matchday-scene-01": require("../../assets/editorial/rugby-matchday.jpg"),
  "matchday-maul-01": require("../../assets/hub/scene-maul.jpg"),
  "matchday-ruck-01": require("../../assets/hub/scene-ruck.jpg"),
  "matchday-lineout-01": require("../../assets/hub/scene-lineout.jpg"),
  "matchday-action-01": require("../../assets/hub/scene-match-day.jpg"),
  "matchday-floodlit-01": require("../../assets/club-home/hero-club.jpg"),
  "event-christmas-01": require("../../assets/events/event-christmas-01.jpg"),
  "event-summer-bbq-01": require("../../assets/events/event-summer-bbq-01.jpg"),
  "event-awards-01": require("../../assets/events/event-awards-01.jpg"),
  "event-charity-run-01": require("../../assets/events/event-charity-run-01.jpg"),
  "event-family-day-01": require("../../assets/events/event-family-day-01.jpg"),
  "event-family-fun-day-02": require("../../assets/events/event-family-fun-day-02.jpg"),
  "event-awards-02": require("../../assets/events/event-awards-02.jpg"),
  "event-winter-social-01": require("../../assets/events/event-winter-social-01.jpg"),
  "event-course-01": require("../../assets/events/event-course-01.jpg"),
  "event-tour-01": require("../../assets/events/event-tour-01.jpg"),
  "event-volunteer-01": require("../../assets/events/event-volunteer-01.jpg"),
  "event-bonfire-01": require("../../assets/events/event-bonfire-01.jpg"),
  "event-meeting-01": require("../../assets/events/event-meeting-01.jpg"),
  "tournament-minis-festival-01": require("../../assets/tournaments/tournament-minis-festival-01.jpg"),
  "tournament-minis-tag-01": require("../../assets/tournaments/tournament-minis-tag-01.jpg"),
  "tournament-age-grade-festival-01": require("../../assets/tournaments/tournament-age-grade-festival-01.jpg"),
  "tournament-festival-pitches-01": require("../../assets/tournaments/tournament-festival-pitches-01.jpg"),
  "tournament-match-action-01": require("../../assets/tournaments/tournament-match-action-01.jpg"),
  "tournament-touchline-crowd-01": require("../../assets/tournaments/tournament-touchline-crowd-01.jpg"),
  "tournament-club-festival-day-01": require("../../assets/tournaments/tournament-club-festival-day-01.jpg"),
  "tournament-trophy-table-01": require("../../assets/tournaments/tournament-trophy-table-01.jpg"),
  "tournament-posts-morning-01": require("../../assets/tournaments/tournament-posts-morning-01.jpg"),
  "tournament-setup-morning-01": require("../../assets/tournaments/tournament-setup-morning-01.jpg"),
  "tournament-default-01": require("../../assets/tournaments/tournament-card-01.jpg"),
}

/** The bundled file for a library key, or null for a key this build does not carry. */
export function stockAsset(key: string | null | undefined): LocalImageAsset | null {
  return key ? (STOCK_ASSETS[key] ?? null) : null
}

/**
 * A library picture used as fixed SCREEN ART -- a hero or a tile that is never a record's cover. Named by its
 * library key so the file is bound in exactly one place; a key this build does not carry is a build error,
 * not a blank screen.
 */
export function libraryAsset(key: string): LocalImageAsset {
  const asset = STOCK_ASSETS[key]
  if (asset === undefined) throw new Error(`Not an Ovalball library picture: ${key}`)
  return asset
}

/** Every key this build carries, for the structural test. */
export const BUNDLED_STOCK_KEYS: readonly string[] = Object.keys(STOCK_ASSETS)

/** A library picture a picker can show: the entry and its bundled file. */
export interface StockPickerItem extends StockMediaEntry {
  asset: LocalImageAsset
}

/** What a person may choose for this kind of object, ready to draw. */
export function stockPickerItems(domain: StockDomain, ordered?: StockMediaEntry[]): StockPickerItem[] {
  return (ordered ?? stockMediaFor(domain)).flatMap((m) => {
    const asset = stockAsset(m.key)
    return asset ? [{ ...m, asset }] : []
  })
}

/** The cover shapes the canonical resolvers return (`*-cover.ts` in the contracts package). */
export type CoverAnswer = { kind: "cover"; url: string } | { kind: "stock"; key: string } | { kind: "crest"; url: string } | { kind: "none" }

/**
 * ONE RESOLVER FROM A COVER ANSWER TO A PICTURE AND ITS PROVENANCE, for every kind of object.
 *
 * Uploaded beats chosen, chosen beats the fallback, and the fallback is the library's one deterministic,
 * category-aware rule seeded by the record's id -- never a fixed constant per screen, never random. A team's
 * crest is identity, not a photograph: it is drawn as the badge, and the photograph behind it falls back.
 */
export function coverMedia(domain: StockDomain, cover: CoverAnswer, seed?: string | null, hint?: StockFallbackHint): ObjectMedia {
  return resolveObjectMedia({
    domain,
    uploadedUrl: cover.kind === "cover" ? cover.url : null,
    stockKey: cover.kind === "stock" ? cover.key : null,
    seed,
    hint,
  })
}

/** The `<Image source>` for a resolved picture. */
export function mediaSource(media: ObjectMedia): { uri: string } | LocalImageAsset {
  if (media.url) return { uri: media.url }
  return stockAsset(media.stockKey) ?? stockAsset("pitch-match-02")!
}

/** Both at once: the picture to draw for this cover answer. */
export function coverPhotoSource(domain: StockDomain, cover: CoverAnswer, seed?: string | null, hint?: StockFallbackHint): { uri: string } | LocalImageAsset {
  return mediaSource(coverMedia(domain, cover, seed, hint))
}

/** The library picture nobody chose for this record -- the fallback alone, as a bundled file. */
export function fallbackAsset(domain: StockDomain, seed?: string | null, hint?: StockFallbackHint): LocalImageAsset {
  return mediaSource(resolveObjectMedia({ domain, seed, hint })) as LocalImageAsset
}

/** Whether this picture must carry the "Illustrative" mark where it is shown. */
export function mediaIsIllustrative(domain: StockDomain, media: ObjectMedia): boolean {
  return isIllustrative(domain, media.provenance)
}

/** A library entry's own label, for an accessibility description of a chosen picture. */
export function stockLabel(key: string | null | undefined): string | null {
  return stockMedia(key)?.label ?? null
}


// ---------------------------------------------------------------------------------------------------
// TEAMS -- the side's own photo, else its chosen library picture, else the picture for its kind of side
// ---------------------------------------------------------------------------------------------------

/** The fields a team picture's fallback is decided from -- exactly what the team readers already return. */
export interface TeamPictureInput {
  category: string
  ageGroup: string | null
  gender: string | null
  active: boolean
}

/**
 * The side's directory group, from the SAME canonical bucketing the Team Directory uses (`groupKeyFor`), so a
 * team classified as Women's here is the team the Directory shows under Adult Women.
 */
export function teamFallbackHint(team: TeamPictureInput): StockFallbackHint {
  return {
    teamGroup: groupKeyFor({ id: "", category: team.category, ageGroup: team.ageGroup, gender: team.gender, squadDesignation: null, isActive: team.active, sortOrder: 0 }),
  }
}

/** The library picture a side with no photo of its own stands in with. The crest is never the photograph. */
export function teamFallbackAsset(team: TeamPictureInput): LocalImageAsset {
  return fallbackAsset("TEAM", null, teamFallbackHint(team))
}

/** A team's cover answer as a picture: its own upload, its chosen library picture, else its kind of side. */
export function teamCoverSource(cover: CoverAnswer, team: TeamPictureInput): { uri: string } | LocalImageAsset {
  return coverPhotoSource("TEAM", cover, null, teamFallbackHint(team))
}

/** The same, with its provenance -- for a surface that must say "Illustrative". */
export function teamCoverMedia(cover: CoverAnswer, team: TeamPictureInput): ObjectMedia {
  return coverMedia("TEAM", cover, null, teamFallbackHint(team))
}
