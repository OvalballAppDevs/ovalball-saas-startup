import type { ImageSourcePropType } from "react-native"

/**
 * OVALBALL'S OWN EDITORIAL ARTWORK — the one place it is referenced.
 *
 * These are app-owned, bundled, decorative photographs of rugby union -- a pitch,
 * posts, cones, an evening -- generated once for the product and reviewed by hand
 * before they were kept. They carry no text, no logos, no crest, no sponsor and
 * no person as a subject, so that ONE match image and ONE training image serve
 * every club: the club arrives on top of them as live canonical data -- its crest,
 * its safe kit accent, its fixture.
 *
 * NEVER THE SOURCE OF ANYTHING. Not a fixture, not a venue, not a club, not a
 * person. If a picture disagrees with the canonical text drawn over it, the
 * picture is wrong by definition and the text is right.
 *
 * BUNDLED, so a hero renders on first paint with nothing to fetch, and a stable
 * ground colour sits beneath each so nothing flashes if decoding is slow.
 */
export const editorial: {
  heroMatch: ImageSourcePropType | null
  heroTraining: ImageSourcePropType | null
  news: Record<"matchday" | "training" | "community" | "general", ImageSourcePropType | null>
} = {
  heroMatch: require("../../../assets/editorial/hero-match.jpg"),
  heroTraining: require("../../../assets/editorial/hero-training.jpg"),
  news: {
    matchday: require("../../../assets/editorial/rugby-matchday.jpg"),
    training: require("../../../assets/editorial/rugby-training.jpg"),
    community: require("../../../assets/editorial/rugby-community.jpg"),
    general: require("../../../assets/editorial/rugby-general.jpg"),
  },
}
