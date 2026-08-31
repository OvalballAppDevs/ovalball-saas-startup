import type { SignupStep } from "@/lib/signup/types"

/**
 * One image + short supportive line per step for the desktop brand panel.
 * Changing per step (rather than one static image for the whole flow)
 * keeps the panel feeling alive without being decorative for its own sake --
 * each image is chosen to match what that step is actually asking for.
 */
export const STEP_IMAGERY: Record<SignupStep, { src: string; alt: string; line: string }> = {
  account: {
    src: "/images/team-huddle.png",
    alt: "A rugby team huddled together on the pitch before a match",
    line: "Join the club running rugby the way it actually runs.",
  },
  details: {
    src: "/images/handshake.png",
    alt: "Two rugby players shaking hands on the pitch after a match",
    line: "Every club runs on people who show up for each other.",
  },
  club: {
    src: "/images/club-house.png",
    alt: "A rugby club house on a matchday",
    line: "Find your club, or tell us who you are and we'll help.",
  },
  review: {
    src: "/images/arms-round.png",
    alt: "Rugby teammates with arms around each other's shoulders",
    line: "Nearly there. One place for your club, your teams, your fixtures.",
  },
}
