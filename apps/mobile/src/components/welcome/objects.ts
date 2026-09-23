import type { ImageSourcePropType } from "react-native"

/**
 * THE WELCOME COLLAGE'S OBJECTS — the one place the cut-outs are referenced.
 *
 * App-owned, bundled, decorative photographs of rugby things -- a ball, boots, a scrum cap, a whistle,
 * cones, posts, a jersey, tape, turf -- generated for the product, reviewed by hand and cut out on a
 * transparent ground so React Native can lay each one out, crop it by the screen edge and move it on
 * its own. They carry no words, no crest and no person, and they are never the source of anything.
 *
 * A slot that is null simply does not draw. The composition is designed around the best six to nine,
 * not around the list. Width and height are the bundled pixel sizes, so a piece can be laid out by
 * width alone and keep its own proportions.
 */
export type WelcomeObject = { source: ImageSourcePropType; width: number; height: number }

export const welcomeObjects: Record<
  "ball" | "boots" | "scrumCap" | "whistle" | "cones" | "posts" | "jersey" | "tape" | "turf",
  WelcomeObject | null
> = {
  ball: { source: require("../../../assets/welcome/rugby-ball.png"), width: 891, height: 509 },
  boots: { source: require("../../../assets/welcome/rugby-boots.png"), width: 684, height: 459 },
  scrumCap: { source: require("../../../assets/welcome/scrum-cap.png"), width: 855, height: 983 },
  whistle: { source: require("../../../assets/welcome/whistle.png"), width: 900, height: 389 },
  cones: { source: require("../../../assets/welcome/training-cones.png"), width: 705, height: 800 },
  posts: null,
  jersey: { source: require("../../../assets/welcome/jersey.png"), width: 755, height: 1000 },
  tape: null,
  turf: null,
}
