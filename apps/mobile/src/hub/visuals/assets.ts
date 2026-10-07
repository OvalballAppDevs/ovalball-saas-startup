import { libraryAsset } from "../../media/stock-assets"

/**
 * THE HUB'S APP-OWNED IMAGERY, keyed once.
 *
 * Every visual in `manifest.ts` names an `assetKey`; this is the only file that knows which file it
 * is. Each entry is an approved Higgsfield generation (Nano Banana Pro, reviewed by eye and recorded in
 * `docs/mobile/RUGBY_HUB_VISUAL_ASSET_MANIFEST.md`), sized to at most 1200 px wide. Should an asset ever
 * be withdrawn, point its key at one of the app's editorial photographs under `assets/editorial/` rather
 * than removing the key: the manifest and the explainer only ever ask for a key. Nothing here is
 * canonical rugby content: an image is a scene, and every label or explanation drawn over it comes
 * from the database at render time.
 *
 * ONE CATALOGUE. A scene that is also a Stock Media Library picture is taken from the library by its key
 * (`src/media/stock-assets.ts`) instead of being required a second time; the Hub's own scenes stay here.
 */
export const HUB_ASSETS: Record<string, number> = {
  // section heroes
  "hero-landing": require("../../../assets/hub/hero-landing.jpg"),
  "hero-learn": require("../../../assets/hub/hero-learn.jpg"),
  "hero-play": require("../../../assets/hub/hero-play.jpg"),
  "hero-coach": require("../../../assets/hub/hero-coach.jpg"),
  "hero-explore": require("../../../assets/hub/hero-explore.jpg"),
  "hero-welfare": require("../../../assets/hub/hero-welfare.jpg"),
  // game knowledge scenes
  "scene-ruck": libraryAsset("matchday-ruck-01"),
  "scene-maul": libraryAsset("matchday-maul-01"),
  "scene-scrum": libraryAsset("rugby-team-scrum-01"),
  "scene-lineout": libraryAsset("matchday-lineout-01"),
  "scene-play-the-ball": require("../../../assets/hub/scene-play-the-ball.jpg"),
  "scene-penalty-advantage": require("../../../assets/hub/scene-penalty-advantage.jpg"),
  "scene-scoring": require("../../../assets/hub/scene-scoring.jpg"),
  "scene-pitch": libraryAsset("pitch-empty-01"),
  // officiating scenarios
  "scene-offside": require("../../../assets/hub/scene-offside.jpg"),
  "scene-knock-on": require("../../../assets/hub/scene-knock-on.jpg"),
  "scene-cards": require("../../../assets/hub/scene-cards.jpg"),
  "scene-referee": require("../../../assets/hub/scene-referee.jpg"),
  // coaching
  "scene-coach-breakdown": require("../../../assets/hub/scene-coach-breakdown.jpg"),
  "scene-coach-space": require("../../../assets/hub/scene-coach-space.jpg"),
  "scene-coach-contact": require("../../../assets/hub/scene-coach-contact.jpg"),
  "scene-coach-tackle-count": require("../../../assets/hub/scene-coach-tackle-count.jpg"),
  // parents
  "scene-match-day": libraryAsset("matchday-action-01"),
  "scene-kit": require("../../../assets/hub/scene-kit.jpg"),
}
