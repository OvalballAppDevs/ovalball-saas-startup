import type { DirectoryGroupKey } from "../teams/directory-taxonomy"

/**
 * THE OVALBALL STOCK MEDIA LIBRARY -- one categorised base for every picture Ovalball supplies.
 *
 * WHAT IT REPLACES. Six unrelated catalogues -- team, venue, pitch, changing room, tournament and event --
 * each with its own array, its own lookup, its own fallback rule and its own copy of the keys on the
 * server, plus a team stand-in set and a dozen fixed fallback constants. The same photograph sat behind
 * several of them under different labels; a pitch "Training" picture was allowed by the server and offered
 * by no screen; an unknown event key quietly rendered the Christmas picture. This is the one list.
 *
 * WHAT AN ENTRY IS. A stable key (stored in `*.cover_stock_key`; never an array position), the group and
 * category it is browsed under, a label for a screen reader, the asset file it is drawn from, and the
 * DOMAINS it may stand for -- the kinds of object a person may choose it for. The server keeps the same
 * key-and-domain list (`internal.stock_media`, 20270732) and refuses any other, so a picture can never be
 * stored against an object the library would not offer it for. `scripts`-free, platform-free: the phone
 * binds each key to its bundled file in `apps/mobile/src/media/stock-assets.ts`, and a structural test
 * keeps the three lists -- this one, the bundle and the server's -- identical.
 *
 * THE STANDING RULES FOR EVERY PICTURE HERE (each was reviewed at full size before it was bundled): no
 * crest, badge, sponsor board or readable sign; no fabricated club name; no readable number plate; no
 * football goals at a rugby ground; no face turned to camera, and doubly so where children are shown.
 */

/** The kinds of object a library picture may stand for. */
export type StockDomain = "VENUE" | "PITCH" | "CHANGING_ROOM" | "TEAM" | "EVENT" | "TOURNAMENT"

/** The top level a person browses by. */
export type StockGroup = "Facilities" | "Rugby" | "Events" | "Tournaments"

export interface StockMediaEntry {
  key: string
  group: StockGroup
  /** The category chip a picture is filed under -- Title Case, as a control label. */
  category: string
  /** What the picture shows, for a screen reader and a preview caption. */
  label: string
  /** The bundled file, relative to `apps/mobile/assets/`. */
  file: string
  domains: readonly StockDomain[]
  /**
   * FALSE for a picture that is only ever a fallback. The tournament default is what a tournament nobody
   * has photographed looks like; offering it as a choice would let somebody "choose" the default and quietly
   * opt that tournament out of ever following it again.
   */
  pickable: boolean
  /** The directory group a team picture suits best -- used only to ORDER team pictures, never to claim one depicts that team. */
  suitedTo?: DirectoryGroupKey
  /**
   * FALSE for a picture a person may choose but that never stands in by itself. A facility's stand-in is drawn
   * from its domain's pool by a stable hash; adding a picture to that pool would quietly move every existing
   * ground, pitch and room to a different picture. Pictures added after the pool was set are choices only, so
   * nobody's stand-in changes underneath them.
   */
  fallback?: false
}

/*
  ORDER MATTERS ONLY WITHIN A DOMAIN, and is kept exactly as the catalogues it replaces ordered them, so a
  record-seeded fallback (`stockFallbackKey`) picks the very same picture it did before -- the Match Centre's
  illustrative grounds, pitches and rooms do not change under anybody.
*/
export const STOCK_MEDIA: readonly StockMediaEntry[] = [
  // ---------------------------------------------------------------------------------- Facilities
  { key: "pitch-match-02", group: "Facilities", category: "Pitches", label: "Rugby ground, wide view", file: "training-planning/pitch-match-02.jpg", domains: ["VENUE", "PITCH"], pickable: true },
  { key: "clubhouse-evening-01", group: "Facilities", category: "Grounds", label: "Clubhouse, early evening", file: "training-planning/clubhouse-evening-01.jpg", domains: ["VENUE"], pickable: true },
  { key: "venue-brick-clubhouse-01", group: "Facilities", category: "Grounds", label: "Traditional brick clubhouse", file: "training-planning/venue-brick-clubhouse-01.jpg", domains: ["VENUE"], pickable: true },
  { key: "venue-small-stand-01", group: "Facilities", category: "Grounds", label: "Small stand beside the pitch", file: "training-planning/venue-small-stand-01.jpg", domains: ["VENUE"], pickable: true },
  { key: "venue-rural-pavilion-01", group: "Facilities", category: "Grounds", label: "Rural pavilion", file: "training-planning/venue-rural-pavilion-01.jpg", domains: ["VENUE"], pickable: true },
  { key: "venue-dusk-01", group: "Facilities", category: "Grounds", label: "Clubhouse at dusk", file: "training-planning/venue-dusk-01.jpg", domains: ["VENUE"], pickable: true },
  { key: "venue-white-pavilion-01", group: "Facilities", category: "Grounds", label: "Pavilion and covered stand", file: "training-planning/venue-white-pavilion-01.jpg", domains: ["VENUE"], pickable: true },
  { key: "venue-village-ground-01", group: "Facilities", category: "Grounds", label: "Village rugby ground", file: "training-planning/venue-village-ground-01.jpg", domains: ["VENUE"], pickable: true },
  // THE ARENA PASS (2026-10-04): approved Higgsfield photographs, each inspected at full resolution against the
  // rugby checklist (H-shaped posts, no nets or football goals, no lettering, badges or sponsor boards).
  { key: "arena-estate-01", group: "Facilities", category: "Arena", label: "Rugby ground from above, misty morning", file: "arena/arena-estate-01.jpg", domains: ["VENUE"], pickable: true, fallback: false },
  { key: "venue-pavilion-posts-01", group: "Facilities", category: "Grounds", label: "Brick pavilion beyond the posts", file: "arena/venue-pavilion-posts-01.jpg", domains: ["VENUE"], pickable: true, fallback: false },
  { key: "venue-timber-pavilion-01", group: "Facilities", category: "Grounds", label: "Timber pavilion on a wet matchday", file: "arena/venue-timber-pavilion-01.jpg", domains: ["VENUE"], pickable: true, fallback: false },
  { key: "venue-clubhouse-dusk-02", group: "Facilities", category: "Grounds", label: "Clubhouse at dusk, floodlights on", file: "arena/venue-clubhouse-dusk-02.jpg", domains: ["VENUE"], pickable: true, fallback: false },
  { key: "pitch-training-02", group: "Facilities", category: "Pitches", label: "Training pitch", file: "training-planning/pitch-training-02.jpg", domains: ["PITCH"], pickable: true },
  { key: "pitch-wet-weather-02", group: "Facilities", category: "Pitches", label: "Pitch after rain", file: "training-planning/pitch-wet-weather-02.jpg", domains: ["PITCH"], pickable: true },
  { key: "pitch-shared-training-02", group: "Facilities", category: "Pitches", label: "Shared training pitch", file: "training-planning/pitch-shared-training-02.jpg", domains: ["PITCH"], pickable: true },
  { key: "pitch-4g-01", group: "Facilities", category: "Pitches", label: "4G artificial pitch", file: "training-planning/pitch-4g-01.jpg", domains: ["PITCH"], pickable: true },
  { key: "pitch-muddy-01", group: "Facilities", category: "Pitches", label: "Muddy winter pitch", file: "training-planning/pitch-muddy-01.jpg", domains: ["PITCH"], pickable: true },
  { key: "pitch-sunny-maintained-01", group: "Facilities", category: "Pitches", label: "Well-maintained pitch", file: "training-planning/pitch-sunny-maintained-01.jpg", domains: ["PITCH"], pickable: true },
  { key: "pitch-training-cones-01", group: "Facilities", category: "Pitches", label: "Small training pitch", file: "training-planning/pitch-training-cones-01.jpg", domains: ["PITCH"], pickable: true },
  { key: "pitch-hilly-01", group: "Facilities", category: "Pitches", label: "Rural hilly pitch", file: "training-planning/pitch-hilly-01.jpg", domains: ["PITCH"], pickable: true },
  { key: "pitch-clean-post-01", group: "Facilities", category: "Pitches", label: "Rugby posts, clear sky", file: "training-planning/pitch-clean-post-01.jpg", domains: ["PITCH"], pickable: true },
  { key: "pitch-touchline-01", group: "Facilities", category: "Pitches", label: "Pitch from the touchline", file: "arena/pitch-touchline-01.jpg", domains: ["VENUE", "PITCH"], pickable: true, fallback: false },
  { key: "pitch-through-posts-01", group: "Facilities", category: "Pitches", label: "Through the posts, evening", file: "arena/pitch-through-posts-01.jpg", domains: ["PITCH"], pickable: true, fallback: false },
  { key: "pitch-empty-01", group: "Facilities", category: "Pitches", label: "Empty pitch", file: "hub/scene-pitch.jpg", domains: ["TEAM"], pickable: true },
  { key: "changing-modern-home-01", group: "Facilities", category: "Changing Rooms", label: "Modern home changing room", file: "training-planning/changing-modern-home-01.jpg", domains: ["CHANGING_ROOM"], pickable: true },
  { key: "changing-modern-away-01", group: "Facilities", category: "Changing Rooms", label: "Modern away changing room", file: "training-planning/changing-modern-away-01.jpg", domains: ["CHANGING_ROOM"], pickable: true },
  { key: "changing-traditional-01", group: "Facilities", category: "Changing Rooms", label: "Traditional clubhouse changing room", file: "training-planning/changing-traditional-01.jpg", domains: ["CHANGING_ROOM"], pickable: true },
  { key: "changing-basic-01", group: "Facilities", category: "Changing Rooms", label: "Small basic changing room", file: "training-planning/changing-basic-01.jpg", domains: ["CHANGING_ROOM"], pickable: true },
  { key: "changing-officials-01", group: "Facilities", category: "Changing Rooms", label: "Match officials changing room", file: "training-planning/changing-officials-01.jpg", domains: ["CHANGING_ROOM"], pickable: true },
  { key: "changing-junior-01", group: "Facilities", category: "Changing Rooms", label: "Junior changing room", file: "training-planning/changing-junior-01.jpg", domains: ["CHANGING_ROOM"], pickable: true },
  { key: "changing-older-clubhouse-01", group: "Facilities", category: "Changing Rooms", label: "Older clubhouse changing room", file: "training-planning/changing-older-clubhouse-01.jpg", domains: ["CHANGING_ROOM"], pickable: true },
  { key: "changing-tiled-01", group: "Facilities", category: "Changing Rooms", label: "Clean tiled changing room", file: "training-planning/changing-tiled-01.jpg", domains: ["CHANGING_ROOM"], pickable: true },
  { key: "changing-bench-hooks-01", group: "Facilities", category: "Changing Rooms", label: "Bench and hooks", file: "training-planning/changing-bench-hooks-01.jpg", domains: ["CHANGING_ROOM"], pickable: true },
  { key: "changing-compact-01", group: "Facilities", category: "Changing Rooms", label: "Compact community changing room", file: "training-planning/changing-compact-01.jpg", domains: ["CHANGING_ROOM"], pickable: true },
  { key: "changing-oak-hooks-01", group: "Facilities", category: "Changing Rooms", label: "Oak benches and kit hooks", file: "arena/changing-oak-hooks-01.jpg", domains: ["CHANGING_ROOM"], pickable: true, fallback: false },

  // ---------------------------------------------------------------------------------- Rugby
  { key: "rugby-team-scrum-01", group: "Rugby", category: "Teams", label: "Scrum, from behind", file: "hub/scene-scrum.jpg", domains: ["TEAM"], pickable: true, suitedTo: "mens" },
  { key: "rugby-team-huddle-womens-01", group: "Rugby", category: "Teams", label: "Team huddle", file: "club-home/team-womens.jpg", domains: ["TEAM"], pickable: true, suitedTo: "womens" },
  { key: "rugby-team-huddle-youth-01", group: "Rugby", category: "Teams", label: "Team huddle", file: "club-home/team-youth.jpg", domains: ["TEAM"], pickable: true, suitedTo: "youth" },
  { key: "rugby-team-minis-01", group: "Rugby", category: "Teams", label: "Mini rugby, in play", file: "club-home/team-minis.jpg", domains: ["TEAM"], pickable: true, suitedTo: "minis" },
  { key: "rugby-team-general-01", group: "Rugby", category: "Teams", label: "Team on the pitch", file: "editorial/rugby-general.jpg", domains: ["TEAM"], pickable: true },
  { key: "rugby-team-community-01", group: "Rugby", category: "Teams", label: "Club community", file: "editorial/rugby-community.jpg", domains: ["TEAM"], pickable: true },
  { key: "training-session-01", group: "Rugby", category: "Training", label: "Training session", file: "editorial/hero-training.jpg", domains: ["TEAM"], pickable: true },
  { key: "training-session-02", group: "Rugby", category: "Training", label: "Training drill", file: "editorial/rugby-training.jpg", domains: ["TEAM"], pickable: true },
  { key: "training-hero-02", group: "Rugby", category: "Training", label: "Training session", file: "training-planning/training-hero-02.jpg", domains: ["PITCH"], pickable: true },
  { key: "training-evening-01", group: "Rugby", category: "Training", label: "Evening training", file: "training-planning/training-evening-01.jpg", domains: ["PITCH"], pickable: true },
  { key: "pitch-floodlit-02", group: "Rugby", category: "Training", label: "Floodlit training", file: "training-planning/pitch-floodlit-02.jpg", domains: ["PITCH"], pickable: true },
  { key: "training-coaching-01", group: "Rugby", category: "Training", label: "Coach with players", file: "training-planning/training-coaching-01.jpg", domains: ["PITCH"], pickable: true },
  { key: "training-equipment-01", group: "Rugby", category: "Training", label: "Cones, balls and tackle shields", file: "training-planning/training-equipment-01.jpg", domains: ["PITCH"], pickable: true, fallback: false },
  { key: "training-player-ball-01", group: "Rugby", category: "Training", label: "Player with the ball", file: "training-planning/training-player-ball-01.jpg", domains: ["PITCH"], pickable: true },
  { key: "training-huddle-01", group: "Rugby", category: "Training", label: "Pre-training huddle", file: "training-planning/training-huddle-01.jpg", domains: ["PITCH"], pickable: true },
  { key: "matchday-hero-01", group: "Rugby", category: "Match Day", label: "Match day", file: "editorial/hero-match.jpg", domains: ["TEAM"], pickable: true },
  { key: "matchday-scene-01", group: "Rugby", category: "Match Day", label: "Match day atmosphere", file: "editorial/rugby-matchday.jpg", domains: ["TEAM"], pickable: true },
  { key: "matchday-maul-01", group: "Rugby", category: "Match Day", label: "Maul", file: "hub/scene-maul.jpg", domains: ["TEAM"], pickable: true },
  { key: "matchday-ruck-01", group: "Rugby", category: "Match Day", label: "Ruck", file: "hub/scene-ruck.jpg", domains: ["TEAM"], pickable: true },
  { key: "matchday-lineout-01", group: "Rugby", category: "Match Day", label: "Lineout", file: "hub/scene-lineout.jpg", domains: ["TEAM"], pickable: true },
  { key: "matchday-action-01", group: "Rugby", category: "Match Day", label: "Match action", file: "hub/scene-match-day.jpg", domains: ["TEAM"], pickable: true },
  { key: "matchday-floodlit-01", group: "Rugby", category: "Match Day", label: "Floodlit pitch", file: "club-home/hero-club.jpg", domains: ["TEAM"], pickable: true },

  // ---------------------------------------------------------------------------------- Events
  { key: "event-christmas-01", group: "Events", category: "Christmas", label: "Clubhouse at Christmas", file: "events/event-christmas-01.jpg", domains: ["EVENT"], pickable: true },
  { key: "event-summer-bbq-01", group: "Events", category: "Social", label: "Summer barbecue", file: "events/event-summer-bbq-01.jpg", domains: ["EVENT"], pickable: true },
  { key: "event-awards-01", group: "Events", category: "Awards", label: "Awards evening", file: "events/event-awards-01.jpg", domains: ["EVENT"], pickable: true },
  { key: "event-charity-run-01", group: "Events", category: "Fundraising", label: "Charity run", file: "events/event-charity-run-01.jpg", domains: ["EVENT"], pickable: true },
  { key: "event-family-day-01", group: "Events", category: "Community", label: "Family fun day", file: "events/event-family-day-01.jpg", domains: ["EVENT"], pickable: true },
  { key: "event-family-fun-day-02", group: "Events", category: "Community", label: "Marquee beside the pitch", file: "events/event-family-fun-day-02.jpg", domains: ["EVENT"], pickable: true, fallback: false },
  { key: "event-awards-02", group: "Events", category: "Awards", label: "Function room set for awards night", file: "events/event-awards-02.jpg", domains: ["EVENT"], pickable: true, fallback: false },
  { key: "event-winter-social-01", group: "Events", category: "Social", label: "Winter evening on the veranda", file: "events/event-winter-social-01.jpg", domains: ["EVENT"], pickable: true, fallback: false },
  { key: "event-course-01", group: "Events", category: "Courses", label: "Course or workshop", file: "events/event-course-01.jpg", domains: ["EVENT"], pickable: true },
  { key: "event-tour-01", group: "Events", category: "Tours", label: "Tour or trip", file: "events/event-tour-01.jpg", domains: ["EVENT"], pickable: true },
  { key: "event-volunteer-01", group: "Events", category: "Volunteering", label: "Volunteer day", file: "events/event-volunteer-01.jpg", domains: ["EVENT"], pickable: true },
  { key: "event-bonfire-01", group: "Events", category: "Festivals", label: "Bonfire night", file: "events/event-bonfire-01.jpg", domains: ["EVENT"], pickable: true },
  { key: "event-meeting-01", group: "Events", category: "Meetings", label: "Meeting", file: "events/event-meeting-01.jpg", domains: ["EVENT"], pickable: true },

  // ---------------------------------------------------------------------------------- Tournaments
  { key: "tournament-minis-festival-01", group: "Tournaments", category: "Festivals", label: "Minis festival, autumn morning", file: "tournaments/tournament-minis-festival-01.jpg", domains: ["TOURNAMENT"], pickable: true },
  { key: "tournament-minis-tag-01", group: "Tournaments", category: "Festivals", label: "Minis waiting to play", file: "tournaments/tournament-minis-tag-01.jpg", domains: ["TOURNAMENT"], pickable: true },
  { key: "tournament-age-grade-festival-01", group: "Tournaments", category: "Festivals", label: "Age-grade festival in full flow", file: "tournaments/tournament-age-grade-festival-01.jpg", domains: ["TOURNAMENT"], pickable: true },
  { key: "tournament-festival-aerial-01", group: "Tournaments", category: "Festivals", label: "Festival across three pitches", file: "arena/tournament-festival-aerial-01.jpg", domains: ["TOURNAMENT"], pickable: true, fallback: false },
  { key: "tournament-festival-pitches-01", group: "Tournaments", category: "Festivals", label: "Four pitches marked out", file: "tournaments/tournament-festival-pitches-01.jpg", domains: ["TOURNAMENT"], pickable: true },
  { key: "tournament-match-action-01", group: "Tournaments", category: "Rugby Action", label: "Youth match action", file: "tournaments/tournament-match-action-01.jpg", domains: ["TOURNAMENT"], pickable: true },
  { key: "tournament-touchline-crowd-01", group: "Tournaments", category: "Rugby Action", label: "A full touchline", file: "tournaments/tournament-touchline-crowd-01.jpg", domains: ["TOURNAMENT"], pickable: true },
  { key: "tournament-club-festival-day-01", group: "Tournaments", category: "Festivals", label: "Festival day at the club", file: "tournaments/tournament-club-festival-day-01.jpg", domains: ["TOURNAMENT"], pickable: true },
  { key: "tournament-trophy-table-01", group: "Tournaments", category: "Trophies", label: "Trophy and medals", file: "tournaments/tournament-trophy-table-01.jpg", domains: ["TOURNAMENT"], pickable: true },
  { key: "tournament-posts-morning-01", group: "Tournaments", category: "General", label: "Posts on a misty morning", file: "tournaments/tournament-posts-morning-01.jpg", domains: ["TOURNAMENT"], pickable: true },
  { key: "tournament-setup-morning-01", group: "Tournaments", category: "Festivals", label: "Set up and ready", file: "tournaments/tournament-setup-morning-01.jpg", domains: ["TOURNAMENT"], pickable: true },
  { key: "tournament-default-01", group: "Tournaments", category: "General", label: "Tournament day", file: "tournaments/tournament-card-01.jpg", domains: ["TOURNAMENT"], pickable: false },
]

const BY_KEY = new Map(STOCK_MEDIA.map((m) => [m.key, m]))

/** One library entry, or null for a key the library does not hold (an older or newer app's key). */
export function stockMedia(key: string | null | undefined): StockMediaEntry | null {
  return key ? (BY_KEY.get(key) ?? null) : null
}

/** What a person may CHOOSE for this kind of object, in the library's own order. */
export function stockMediaFor(domain: StockDomain): StockMediaEntry[] {
  return STOCK_MEDIA.filter((m) => m.pickable && m.domains.includes(domain))
}

/** The category chips to browse this domain by, in first-appearance order. */
export function stockCategoriesFor(domain: StockDomain): string[] {
  return Array.from(new Set(stockMediaFor(domain).map((m) => m.category)))
}

/** True when this key may be stored against this kind of object -- the same rule the server applies. */
export function isStockKeyAllowed(key: string | null | undefined, domain: StockDomain): boolean {
  const entry = stockMedia(key)
  return !!entry && entry.pickable && entry.domains.includes(domain)
}

/**
 * Team pictures in the order a side of this kind would want to see them: its own kind first. Every picture is
 * still shown -- this only orders, and never claims a picture depicts the team that chooses it.
 */
export function stockMediaForTeam(group: DirectoryGroupKey | null | undefined): StockMediaEntry[] {
  const all = stockMediaFor("TEAM")
  if (!group) return all
  return [...all].sort((a, b) => (a.suitedTo === group ? -1 : 0) - (b.suitedTo === group ? -1 : 0))
}

// ---------------------------------------------------------------------------------------------------
// FALLBACK -- deterministic and category-aware
// ---------------------------------------------------------------------------------------------------

/**
 * A STABLE INDEX FROM A STABLE ID (FNV-1a, 32-bit). The same record always lands on the same picture, and
 * nothing is chosen at random on a render.
 */
export function stableStockIndex(seed: string, size: number): number {
  if (size <= 0) return 0
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % size
}

export interface StockFallbackHint {
  /** An event's type and first day: a Christmas social looks like Christmas, an August one like a barbecue. */
  eventType?: string | null
  startsOn?: string | null
  /** A team's directory group: a minis side stands in with minis, never with a men's scrum. */
  teamGroup?: DirectoryGroupKey | null
}

/** What each kind of object shows with no record to seed from. */
const DOMAIN_DEFAULT: Record<StockDomain, string> = {
  VENUE: "clubhouse-evening-01",
  PITCH: "pitch-match-02",
  CHANGING_ROOM: "changing-modern-home-01",
  TEAM: "rugby-team-general-01",
  EVENT: "event-family-day-01",
  TOURNAMENT: "tournament-default-01",
}

const TEAM_GROUP_PICTURE: Record<DirectoryGroupKey, string> = {
  mens: "rugby-team-scrum-01",
  colts: "rugby-team-scrum-01",
  womens: "rugby-team-huddle-womens-01",
  girls: "rugby-team-huddle-youth-01",
  juniors: "rugby-team-huddle-youth-01",
  youth: "rugby-team-huddle-youth-01",
  minis: "rugby-team-minis-01",
  retired: "rugby-team-general-01",
}

/** The picture an event without one of its own uses: chosen by type, and by season for socials and festivals. */
export function eventDefaultStockKey(type: string | null | undefined, startsOn: string | null | undefined): string {
  const month = Number((startsOn ?? "").slice(5, 7))
  switch (type) {
    case "SOCIAL":
    case "CLUB_FUNCTION":
      return month === 11 || month === 12 ? "event-christmas-01" : "event-summer-bbq-01"
    case "FESTIVAL":
      return month === 10 || month === 11 ? "event-bonfire-01" : "event-family-day-01"
    case "COMMUNITY":
    case "TEAM_EVENT":
      return "event-family-day-01"
    case "FUNDRAISING":
      return "event-charity-run-01"
    case "AWARDS":
      return "event-awards-01"
    case "MEETING":
      return "event-meeting-01"
    case "EDUCATION":
    case "TRAINING":
      return "event-course-01"
    case "TOUR":
      return "event-tour-01"
    case "VOLUNTEER":
      return "event-volunteer-01"
    default:
      return "event-family-day-01"
  }
}

/**
 * The seed is namespaced by kind, exactly as the Match Centre's arena seeded it ("venue:<id>", "pitch:<id>",
 * "room:<id>"), so a ground keeps the very picture it already had there -- and now shows it everywhere else too.
 */
const SEED_NAMESPACE = { VENUE: "venue", PITCH: "pitch", CHANGING_ROOM: "room" } as const

/** The pool a facility seeded from its record id draws from: grounds look like grounds, pitches like pitches. */
function facilityPool(domain: "VENUE" | "PITCH" | "CHANGING_ROOM"): StockMediaEntry[] {
  const all = stockMediaFor(domain).filter((m) => m.fallback !== false)
  return domain === "PITCH" ? all.filter((m) => m.category === "Pitches") : all
}

/**
 * THE ONE FALLBACK RULE, for every kind of object, on every screen.
 *
 *   VENUE / PITCH / CHANGING_ROOM -- seeded from the record's own id within that kind's pool (a pitch never
 *     falls back to a changing room, nor a ground to a training drill); with no record, the kind's default.
 *   TEAM -- the picture for the side's directory group.
 *   EVENT -- by type and season.
 *   TOURNAMENT -- the tournament default, which is never a choice.
 */
export function stockFallbackKey(domain: StockDomain, seed?: string | null, hint?: StockFallbackHint): string {
  switch (domain) {
    case "VENUE":
    case "PITCH":
    case "CHANGING_ROOM": {
      if (!seed) return DOMAIN_DEFAULT[domain]
      const pool = facilityPool(domain)
      return pool[stableStockIndex(`${SEED_NAMESPACE[domain]}:${seed}`, pool.length)]?.key ?? DOMAIN_DEFAULT[domain]
    }
    case "TEAM":
      return hint?.teamGroup ? TEAM_GROUP_PICTURE[hint.teamGroup] : DOMAIN_DEFAULT.TEAM
    case "EVENT":
      return hint?.eventType || hint?.startsOn ? eventDefaultStockKey(hint?.eventType, hint?.startsOn) : DOMAIN_DEFAULT.EVENT
    case "TOURNAMENT":
      return DOMAIN_DEFAULT.TOURNAMENT
  }
}

// ---------------------------------------------------------------------------------------------------
// PROVENANCE -- where the picture on screen came from
// ---------------------------------------------------------------------------------------------------

/**
 * WHERE A PICTURE CAME FROM, SO NOBODY MISTAKES ONE KIND FOR ANOTHER.
 *
 *   UPLOADED   -- this object's own photograph (`cover_image_path`).
 *   CLUB_MEDIA -- the club's own canonical media standing in (a team with no picture shows its club's crest).
 *   STOCK      -- an Ovalball library picture somebody CHOSE for this object.
 *   FALLBACK   -- an Ovalball library picture nobody chose, picked by the one fallback rule.
 */
export type MediaProvenance = "UPLOADED" | "CLUB_MEDIA" | "STOCK" | "FALLBACK"

export interface ObjectMedia {
  provenance: MediaProvenance
  /** The picture's URL, for UPLOADED and CLUB_MEDIA. */
  url: string | null
  /** The library key, for STOCK and FALLBACK. */
  stockKey: string | null
}

export function resolveObjectMedia(input: {
  domain: StockDomain
  uploadedUrl?: string | null
  stockKey?: string | null
  clubMediaUrl?: string | null
  seed?: string | null
  hint?: StockFallbackHint
}): ObjectMedia {
  if (input.uploadedUrl) return { provenance: "UPLOADED", url: input.uploadedUrl, stockKey: null }
  // A key the library does not hold for this kind of object -- an older app's, a newer app's -- falls back
  // rather than rendering nothing or the wrong picture.
  if (input.stockKey && isStockKeyAllowed(input.stockKey, input.domain)) return { provenance: "STOCK", url: null, stockKey: input.stockKey }
  if (input.clubMediaUrl) return { provenance: "CLUB_MEDIA", url: input.clubMediaUrl, stockKey: null }
  return { provenance: "FALLBACK", url: null, stockKey: stockFallbackKey(input.domain, input.seed, input.hint) }
}

/**
 * TRUE WHERE A LIBRARY PICTURE COULD BE MISTAKEN FOR THE REAL THING, and so must say "Illustrative".
 *
 * A ground, a pitch, a changing room and a team are real places and real people: a visitor shown a library
 * changing room under Preston's name would reasonably think it IS Preston's changing room -- whether somebody
 * chose that picture or nobody did. An event's or a tournament's cover is a mood picture, never presented as
 * a record of the day, so it carries its provenance without the label.
 */
export function isIllustrative(domain: StockDomain, provenance: MediaProvenance): boolean {
  if (provenance !== "STOCK" && provenance !== "FALLBACK") return false
  return domain === "VENUE" || domain === "PITCH" || domain === "CHANGING_ROOM" || domain === "TEAM"
}

/** The words a screen shows for a picture's provenance -- one vocabulary, every surface. */
export const MEDIA_PROVENANCE_WORDS: Record<MediaProvenance, string> = {
  UPLOADED: "Your own photo.",
  CLUB_MEDIA: "Your club's own picture.",
  STOCK: "Chosen from the Ovalball library.",
  FALLBACK: "None chosen yet: an Ovalball library picture stands in.",
}
