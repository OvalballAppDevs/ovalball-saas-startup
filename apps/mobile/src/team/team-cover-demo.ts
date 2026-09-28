import { groupKeyFor, type DirectoryGroupKey } from "@ovalball/contracts/teams/directory-taxonomy"

/** A bundled local image `require()` always resolves to this at build time. */
type LocalImageAsset = number

/**
 * A TEAM'S PHOTOGRAPH WHEN IT HAS NOT UPLOADED ONE OF ITS OWN — a visual correction pass, not a new
 * data source. `resolveTeamCover` (`packages/contracts/src/team-cover.ts`) still owns the real chain
 * for every client: a team's own `cover_image_path`, then the club crest as the identity-only fallback,
 * then nothing. That is unchanged and remains what a screen reader, an export and a production club
 * with no cover photo all see. This module answers a narrower, presentation-only question a mobile
 * screen asks AFTER that chain has already said "no real cover exists": which bundled, category-
 * appropriate photograph should stand in so a team card is never a plain crest-on-forest tile.
 *
 * THE CREST IS NEVER THE PHOTOGRAPH. A screen using this still renders the crest separately, as the
 * small identity badge it already was — this only supplies the big photographic background behind it.
 *
 * DETERMINISTIC, FROM FIELDS A TEAM ALREADY HAS. No schema change: `category`/`ageGroup`/`gender` are
 * exactly what `readClubTeams` already returns, and `groupKeyFor` is the SAME canonical bucketing the
 * Team Directory itself uses (`teams/directory-taxonomy.ts`) — reused rather than re-invented, so a
 * team classified as Women's here is the same team the Directory would show under "Adult Women".
 *
 * THE IMAGES THEMSELVES are Higgsfield-generated (Sept 2026 Rugby Hub photography batch) or the app's
 * own existing bundled editorial photography, each hand-reviewed against the standing rules: no crest,
 * no brand, no legible text, no malformed ball, no face turned to camera — doubly strict for `minis`,
 * which depicts children and never shows an identifiable face.
 */
const teamCoverAssets: Record<DirectoryGroupKey, LocalImageAsset> = {
  mens: require("../../assets/hub/scene-scrum.jpg"),
  womens: require("../../assets/club-home/team-womens.jpg"),
  girls: require("../../assets/club-home/team-youth.jpg"),
  juniors: require("../../assets/club-home/team-youth.jpg"),
  youth: require("../../assets/club-home/team-youth.jpg"),
  colts: require("../../assets/hub/scene-scrum.jpg"),
  minis: require("../../assets/club-home/team-minis.jpg"),
  retired: require("../../assets/editorial/rugby-general.jpg"),
}

export interface DemoTeamCoverInput {
  category: string
  ageGroup: string | null
  gender: string | null
  active: boolean
}

/** The bundled, category-appropriate stand-in for a team with no cover photo of its own. */
export function demoTeamCoverAsset(team: DemoTeamCoverInput): LocalImageAsset {
  const key = groupKeyFor({
    id: "",
    category: team.category,
    ageGroup: team.ageGroup,
    gender: team.gender,
    squadDesignation: null,
    isActive: team.active,
    sortOrder: 0,
  })
  return teamCoverAssets[key]
}
