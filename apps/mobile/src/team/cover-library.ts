import { groupKeyFor, type DirectoryGroupKey } from "@ovalball/contracts/teams/directory-taxonomy"

type LocalImageAsset = number

/**
 * THE OVALBALL IMAGE LIBRARY -- curated stock cover imagery, Team Profile Section 5.
 *
 * BUILT FROM WHAT ALREADY EXISTS. Every asset here is already bundled in the app (the same Higgsfield-
 * generated Rugby Hub photography batch and existing editorial photography `team-cover-demo.ts` already
 * draws its per-category fallback from), hand-reviewed against the same standing rules: no crest, no
 * brand, no legible text, no malformed ball, no face turned to camera. Nothing new was generated for
 * this catalogue -- see the Section 5 report's HIGGSFIELD ASSET INVENTORY / NEW ASSETS NEEDED fields for
 * what a genuinely richer library (a real "Clubhouse" or "Match Day" category with more than a handful
 * of images) would still need.
 *
 * STABLE CANONICAL KEYS, never array position -- `set_team_cover`'s own server-side allow-list
 * (`20270572000000`) is keyed on these exact strings, so a key can never resolve to a different picture
 * later just because this array was reordered.
 *
 * GENERIC BY DESIGN. Every scene here is deliberately unattributed: nobody is presented as belonging to
 * the team that selects it, no crest, no sponsor board is legible, no scoreboard or trophy is shown as
 * the team's own. A stock cover stays a stock cover, however it is labelled in the UI.
 */
export type StockCategory = "Rugby Teams" | "Training" | "Match Day" | "Pitches"

export interface StockCoverAsset {
  key: string
  category: StockCategory
  asset: LocalImageAsset
  label: string
  /** The directory group this image suits best, used only to order "Rugby Teams" so a club's own kind
   * of side sees a relevant image first -- never to claim the photo depicts that specific team. */
  suitedTo?: DirectoryGroupKey
}

export const STOCK_COVER_CATALOGUE: StockCoverAsset[] = [
  // Rugby Teams
  { key: "rugby-team-scrum-01", category: "Rugby Teams", asset: require("../../assets/hub/scene-scrum.jpg"), label: "Scrum, from behind", suitedTo: "mens" },
  { key: "rugby-team-huddle-womens-01", category: "Rugby Teams", asset: require("../../assets/club-home/team-womens.jpg"), label: "Team huddle", suitedTo: "womens" },
  { key: "rugby-team-huddle-youth-01", category: "Rugby Teams", asset: require("../../assets/club-home/team-youth.jpg"), label: "Team huddle", suitedTo: "youth" },
  { key: "rugby-team-minis-01", category: "Rugby Teams", asset: require("../../assets/club-home/team-minis.jpg"), label: "Mini rugby, in play", suitedTo: "minis" },
  { key: "rugby-team-general-01", category: "Rugby Teams", asset: require("../../assets/editorial/rugby-general.jpg"), label: "Team on the pitch" },
  { key: "rugby-team-community-01", category: "Rugby Teams", asset: require("../../assets/editorial/rugby-community.jpg"), label: "Club community" },

  // Training
  { key: "training-session-01", category: "Training", asset: require("../../assets/editorial/hero-training.jpg"), label: "Training session" },
  { key: "training-session-02", category: "Training", asset: require("../../assets/editorial/rugby-training.jpg"), label: "Training drill" },

  // Match Day
  { key: "matchday-hero-01", category: "Match Day", asset: require("../../assets/editorial/hero-match.jpg"), label: "Match day" },
  { key: "matchday-scene-01", category: "Match Day", asset: require("../../assets/editorial/rugby-matchday.jpg"), label: "Match day atmosphere" },
  { key: "matchday-maul-01", category: "Match Day", asset: require("../../assets/hub/scene-maul.jpg"), label: "Maul" },
  { key: "matchday-ruck-01", category: "Match Day", asset: require("../../assets/hub/scene-ruck.jpg"), label: "Ruck" },
  { key: "matchday-lineout-01", category: "Match Day", asset: require("../../assets/hub/scene-lineout.jpg"), label: "Lineout" },
  { key: "matchday-action-01", category: "Match Day", asset: require("../../assets/hub/scene-match-day.jpg"), label: "Match action" },
  { key: "matchday-floodlit-01", category: "Match Day", asset: require("../../assets/club-home/hero-club.jpg"), label: "Floodlit pitch" },

  // Pitches
  { key: "pitch-empty-01", category: "Pitches", asset: require("../../assets/hub/scene-pitch.jpg"), label: "Empty pitch" },
]

export const STOCK_CATEGORIES: StockCategory[] = ["Rugby Teams", "Training", "Match Day", "Pitches"]

export function stockAssetForKey(key: string | null | undefined): StockCoverAsset | null {
  if (!key) return null
  return STOCK_COVER_CATALOGUE.find((a) => a.key === key) ?? null
}

/** "Rugby Teams" ordered so a club's own kind of side (from the SAME canonical grouping the Team
 * Directory uses, `directory-taxonomy.ts`) appears first -- the library still shows every image, this
 * only orders them; nothing is hidden by team type. */
export function stockCoversForCategory(category: StockCategory, teamGroup?: DirectoryGroupKey): StockCoverAsset[] {
  const items = STOCK_COVER_CATALOGUE.filter((a) => a.category === category)
  if (category !== "Rugby Teams" || !teamGroup) return items
  return [...items].sort((a, b) => (a.suitedTo === teamGroup ? -1 : 0) - (b.suitedTo === teamGroup ? -1 : 0))
}

export function defaultGroupKeyForTeam(team: { category: string; ageGroup: string | null; gender: string | null; active: boolean }): DirectoryGroupKey {
  return groupKeyFor({ id: "", category: team.category, ageGroup: team.ageGroup, gender: team.gender, squadDesignation: null, isActive: team.active, sortOrder: 0 })
}

/**
 * ONE RESOLVER FOR "WHAT PHOTO SOURCE DOES `expo-image`'s `<Image>` TAKE", called from the Profile
 * hero and Team Photo screen alike, so a team's cover is never two different pictures of the same side
 * depending which screen resolved it. `TeamCover`'s own priority order (upload -> stock -> crest ->
 * demo fallback) is unchanged; this only turns the result into a real `source` prop.
 */
export function teamCoverPhotoSource(
  cover: { kind: "cover"; url: string } | { kind: "stock"; key: string } | { kind: "crest"; url: string } | { kind: "none" },
  fallback: LocalImageAsset
): { uri: string } | LocalImageAsset {
  if (cover.kind === "cover") return { uri: cover.url }
  if (cover.kind === "stock") return stockAssetForKey(cover.key)?.asset ?? fallback
  return fallback
}
