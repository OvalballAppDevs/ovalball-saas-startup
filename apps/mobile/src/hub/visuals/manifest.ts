import { HUB_ASSETS } from "./assets"

/**
 * THE VISUAL MANIFEST — which canonical Hub entities have a scene, and where the hotspots sit.
 *
 * A visual is a scene plus a set of hotspots. Every hotspot POINTS AT A CANONICAL ENTITY (a glossary
 * term, a game concept, an officiating concept, a skill, a guide); its label and its explanation are
 * that entity's own title and text, read from the database at render time, never authored here. So
 * this file holds geometry and references only. It contains no rugby prose, and a key it names must
 * exist and be published — the permanent test checks that against the database.
 *
 * HOTSPOT COORDINATES ARE PROVISIONAL. They were placed for the placeholder photographs and are
 * re-checked by eye against each approved generated asset before the asset key is switched over.
 */
export type HubEntityType =
  | "GAME_CONCEPT"
  | "GLOSSARY_TERM"
  | "OFFICIATING_CONCEPT"
  | "COACHING_CONCEPT"
  | "PARENT_GUIDE"
  | "PLAYER_DEVELOPMENT_CONCEPT"
  | "COMPETITION_GUIDE"
  | "RUGBY_TEAM"
  | "RUGBY_PERSON"
  | "RULE"
  | "SKILL"
  | "POSITION"
  | "STORY"
  | "CLUB"

export type HubEntityRef = { type: HubEntityType; key: string }

export interface HubHotspot {
  id: string
  /** 0..1 of the image width. */
  x: number
  /** 0..1 of the image height. */
  y: number
  /** The canonical entity whose title and explanation the hotspot shows; the label is resolved from it at runtime. */
  entity: HubEntityRef
}

export interface HubVisualStep {
  id: string
  /** The canonical entity for this stage. */
  entity: HubEntityRef
  hotspotIds: string[]
}

export interface HubVisual {
  assetKey: string
  /** width / height */
  aspect: number
  /** What the scene shows, in plain words — the textual equivalent of the picture. */
  alt: string
  hotspots: HubHotspot[]
  steps?: HubVisualStep[]
  kind: "concept" | "scenario" | "coaching" | "guide" | "term"
}

const G = (key: string): HubEntityRef => ({ type: "GLOSSARY_TERM", key })
const C = (key: string): HubEntityRef => ({ type: "GAME_CONCEPT", key })
const O = (key: string): HubEntityRef => ({ type: "OFFICIATING_CONCEPT", key })
const S = (key: string): HubEntityRef => ({ type: "SKILL", key })
const P = (key: string): HubEntityRef => ({ type: "PARENT_GUIDE", key })

export function entityKey(ref: HubEntityRef): string {
  return `${ref.type}:${ref.key}`
}

export const HUB_VISUALS: Record<string, HubVisual> = {
  // ------------------------------------------------------------------ Game Knowledge
  "GAME_CONCEPT:the-breakdown-and-ruck": {
    assetKey: "scene-ruck",
    aspect: 3 / 2,
    alt: "A breakdown on a muddy pitch: a tackled player on the ground on the right, a team-mate on his feet reaching for the ball, two more bound over him, and a line of four defenders standing back from the ruck with their backs to us.",
    kind: "concept",
    hotspots: [
      { id: "ball", x: 0.64, y: 0.58, entity: G("ruck") },
      { id: "breakdown", x: 0.72, y: 0.42, entity: G("breakdown") },
      { id: "turnover", x: 0.78, y: 0.56, entity: G("turnover") },
      { id: "referee", x: 0.3, y: 0.45, entity: O("breakdown-and-ruck-decisions-union") },
    ],
    steps: [
      { id: "tackle", entity: C("the-breakdown-and-ruck"), hotspotIds: ["breakdown"] },
      { id: "ruck", entity: G("ruck"), hotspotIds: ["ball"] },
      { id: "decision", entity: O("breakdown-and-ruck-decisions-union"), hotspotIds: ["referee", "turnover"] },
    ],
  },
  "GAME_CONCEPT:the-scrum-and-lineout-in-play": {
    assetKey: "scene-scrum",
    aspect: 3 / 2,
    alt: "A scrum from behind the scrum-half: two packs bound together and pushing, green against navy, the ball at the scrum-half's feet ready to go in.",
    kind: "concept",
    hotspots: [
      { id: "scrum", x: 0.5, y: 0.5, entity: G("scrum-union") },
      { id: "technique", x: 0.3, y: 0.55, entity: S("scrum-and-lineout-technique") },
      { id: "decision", x: 0.5, y: 0.86, entity: O("scrum-and-lineout-decisions-union") },
    ],
  },
  "GAME_CONCEPT:the-play-the-ball": {
    assetKey: "scene-play-the-ball",
    aspect: 3 / 2,
    alt: "A rugby league play-the-ball from behind: the tackled player stands over the ball rolling it back with his foot, the dummy-half crouches ready to pick it up, and the defensive line waits ten metres away.",
    kind: "concept",
    hotspots: [
      { id: "play-the-ball", x: 0.66, y: 0.76, entity: G("play-the-ball") },
      { id: "count", x: 0.3, y: 0.4, entity: G("tackle-count") },
      { id: "decision", x: 0.57, y: 0.42, entity: O("tackle-and-play-the-ball-decisions-league") },
    ],
  },
  "GAME_CONCEPT:penalties-and-advantage": {
    assetKey: "scene-penalty-advantage",
    aspect: 3 / 2,
    alt: "A referee with an arm stretched out signalling advantage while play goes on: the ball in the air between two attackers on the left, the referee side-on in the middle.",
    kind: "concept",
    hotspots: [
      { id: "penalty", x: 0.3, y: 0.6, entity: G("penalty") },
      { id: "advantage", x: 0.47, y: 0.45, entity: G("advantage") },
      { id: "decision", x: 0.63, y: 0.62, entity: O("advantage") },
    ],
  },
  "GAME_CONCEPT:the-pitch-and-direction-of-play": {
    assetKey: "scene-pitch",
    aspect: 3 / 2,
    alt: "A community pitch from one corner on a grey day: the goal line and in-goal area on the right with the posts, the 22-metre and halfway lines running across the grass.",
    kind: "concept",
    hotspots: [
      { id: "in-goal", x: 0.84, y: 0.5, entity: G("try") },
      { id: "territory", x: 0.42, y: 0.58, entity: G("territory") },
    ],
    steps: [
      { id: "score", entity: G("try"), hotspotIds: ["in-goal"] },
      { id: "territory", entity: G("territory"), hotspotIds: ["territory"] },
    ],
  },
  "GAME_CONCEPT:how-scoring-works": {
    assetKey: "scene-scoring",
    aspect: 3 / 2,
    alt: "A player in green diving to ground the ball over the goal line for a try, the posts behind him, two defenders arriving too late.",
    kind: "concept",
    hotspots: [
      { id: "try", x: 0.63, y: 0.68, entity: G("try") },
      { id: "conversion", x: 0.5, y: 0.2, entity: G("conversion") },
      { id: "penalty", x: 0.13, y: 0.36, entity: G("penalty") },
    ],
  },

  // ------------------------------------------------------------------ Officiating scenarios
  "OFFICIATING_CONCEPT:offside-decisions-union": {
    assetKey: "scene-offside",
    aspect: 3 / 2,
    alt: "A phase of play: the ruck on the left with the ball at its back, and a defensive line in green spread across the pitch, one defender standing a stride ahead of his team-mates.",
    kind: "scenario",
    hotspots: [
      { id: "offside-line", x: 0.5, y: 0.56, entity: G("offside-union") },
      { id: "ruck", x: 0.33, y: 0.48, entity: C("the-breakdown-and-ruck") },
    ],
  },
  "OFFICIATING_CONCEPT:knock-on-and-forward-pass": {
    assetKey: "scene-knock-on",
    aspect: 3 / 2,
    alt: "A player in green fumbling the ball forward out of his hands, team-mates behind him with arms raised, a referee in black on the right.",
    kind: "scenario",
    hotspots: [
      { id: "knock-on", x: 0.35, y: 0.6, entity: G("knock-on") },
      { id: "forward-pass", x: 0.72, y: 0.42, entity: G("forward-pass") },
    ],
  },
  "OFFICIATING_CONCEPT:cards-and-sin-bin": {
    assetKey: "scene-cards",
    aspect: 3 / 2,
    alt: "A referee holding up a yellow card, the player walking away towards the touchline with his head down, team-mates standing back.",
    kind: "scenario",
    hotspots: [
      { id: "yellow", x: 0.6, y: 0.15, entity: G("yellow-card") },
      { id: "sin-bin", x: 0.47, y: 0.42, entity: G("sin-bin") },
      { id: "referee", x: 0.82, y: 0.45, entity: G("referee") },
    ],
  },
  "OFFICIATING_CONCEPT:what-the-referee-does": {
    assetKey: "scene-referee",
    aspect: 3 / 2,
    alt: "A referee in the middle of play with a whistle and an arm out, players competing for the ball around him, an assistant referee with a flag on the far touchline.",
    kind: "scenario",
    hotspots: [
      { id: "referee", x: 0.5, y: 0.5, entity: G("referee") },
      { id: "assistant", x: 0.89, y: 0.5, entity: G("assistant-referee") },
      { id: "touch-judge", x: 0.86, y: 0.66, entity: G("touch-judge") },
    ],
  },

  // ------------------------------------------------------------------ Glossary: See It
  "GLOSSARY_TERM:ruck": {
    assetKey: "scene-ruck",
    aspect: 3 / 2,
    alt: "A breakdown on a muddy pitch: a tackled player on the ground, a team-mate reaching for the ball and two more bound over him, defenders standing back.",
    kind: "term",
    hotspots: [
      { id: "concept", x: 0.64, y: 0.58, entity: C("the-breakdown-and-ruck") },
      { id: "decision", x: 0.3, y: 0.45, entity: O("breakdown-and-ruck-decisions-union") },
    ],
  },
  "GLOSSARY_TERM:maul": {
    assetKey: "scene-maul",
    aspect: 3 / 2,
    alt: "A maul: the ball carrier held up on his feet with three team-mates bound on and driving, a defender bound in from the other side, all seen from behind.",
    kind: "term",
    hotspots: [
      { id: "concept", x: 0.5, y: 0.55, entity: C("the-breakdown-and-ruck") },
      { id: "decision", x: 0.34, y: 0.55, entity: O("breakdown-and-ruck-decisions-union") },
    ],
  },
  "GLOSSARY_TERM:scrum-union": {
    assetKey: "scene-scrum",
    aspect: 3 / 2,
    alt: "A scrum from behind the scrum-half: two packs of eight bound together and pushing, the ball at the scrum-half's feet ready to go in.",
    kind: "term",
    hotspots: [
      { id: "concept", x: 0.5, y: 0.5, entity: C("the-scrum-and-lineout-in-play") },
      { id: "decision", x: 0.5, y: 0.86, entity: O("scrum-and-lineout-decisions-union") },
    ],
  },
  "GLOSSARY_TERM:lineout": {
    assetKey: "scene-lineout",
    aspect: 3 / 2,
    alt: "A lineout in profile: the thrower on the left with the ball in the air, two lines of forwards a metre apart, one jumper lifted high by two team-mates.",
    kind: "term",
    hotspots: [
      { id: "concept", x: 0.6, y: 0.42, entity: C("the-scrum-and-lineout-in-play") },
      { id: "decision", x: 0.26, y: 0.55, entity: O("scrum-and-lineout-decisions-union") },
    ],
  },
  "GLOSSARY_TERM:breakdown": {
    assetKey: "scene-ruck",
    aspect: 3 / 2,
    alt: "The moment after a tackle: the tackled player on the ground, the first supporting players arriving over the ball, the defensive line standing back.",
    kind: "term",
    hotspots: [
      { id: "concept", x: 0.7, y: 0.62, entity: C("the-breakdown-and-ruck") },
      { id: "decision", x: 0.3, y: 0.45, entity: O("breakdown-and-ruck-decisions-union") },
    ],
  },

  // ------------------------------------------------------------------ Parents & Guardians
  "PARENT_GUIDE:first-rugby-match-day": {
    assetKey: "scene-match-day",
    aspect: 3 / 2,
    alt: "A family walking from the car park past a wooden clubhouse towards a community pitch on a grey morning, kit bags in hand, a coach setting out cones on the far side.",
    kind: "guide",
    hotspots: [
      { id: "arrive", x: 0.2, y: 0.72, entity: P("first-rugby-match-day") },
      { id: "meet", x: 0.34, y: 0.6, entity: P("first-rugby-match-day") },
      { id: "warm-up", x: 0.86, y: 0.63, entity: P("first-rugby-training-session") },
      { id: "play", x: 0.62, y: 0.6, entity: C("the-objective-of-the-game") },
      { id: "after", x: 0.28, y: 0.5, entity: P("first-rugby-match-day") },
    ],
    steps: [
      { id: "arrive", entity: P("first-rugby-match-day"), hotspotIds: ["arrive"] },
      { id: "meet", entity: P("first-rugby-match-day"), hotspotIds: ["meet"] },
      { id: "warm-up", entity: P("first-rugby-training-session"), hotspotIds: ["warm-up"] },
      { id: "play", entity: C("the-objective-of-the-game"), hotspotIds: ["play"] },
      { id: "after", entity: P("first-rugby-match-day"), hotspotIds: ["after"] },
    ],
  },
  "PARENT_GUIDE:what-a-new-player-needs": {
    assetKey: "scene-kit",
    aspect: 3 / 2,
    alt: "Kit laid out on a wooden bench under a window: muddy boots, a mouthguard in its case, a plain dark shirt, shorts, socks and a water bottle, a kit bag behind.",
    kind: "guide",
    hotspots: [
      { id: "kit", x: 0.5, y: 0.45, entity: P("what-a-new-player-needs") },
      { id: "contact", x: 0.29, y: 0.5, entity: P("understanding-contact-rugby") },
    ],
  },

  // ------------------------------------------------------------------ Coaching
  "COACHING_CONCEPT:coaching-breakdown-decisions": {
    assetKey: "scene-coach-breakdown",
    aspect: 3 / 2,
    alt: "A coach with his back to us watching three players in green work a breakdown drill over a tackle pad, one bound over the pad and two arriving in support, cones marking the area.",
    kind: "coaching",
    hotspots: [
      { id: "ruck", x: 0.6, y: 0.62, entity: G("ruck") },
      { id: "concept", x: 0.7, y: 0.4, entity: C("the-breakdown-and-ruck") },
      { id: "skill", x: 0.47, y: 0.55, entity: S("contact-and-breakdown-work") },
    ],
  },
  "COACHING_CONCEPT:using-space-time-and-numbers": {
    assetKey: "scene-coach-space",
    aspect: 3 / 2,
    alt: "A small-sided game on a coned grid: a ball carrier in navy attacking two defenders in green with support either side, the coach watching from the near corner.",
    kind: "coaching",
    hotspots: [
      { id: "attack", x: 0.5, y: 0.38, entity: C("attack-and-defence") },
      { id: "decision", x: 0.62, y: 0.47, entity: S("decision-making-under-pressure") },
      { id: "territory", x: 0.82, y: 0.62, entity: G("territory") },
    ],
  },
  "COACHING_CONCEPT:coaching-contact-safely": {
    assetKey: "scene-coach-contact",
    aspect: 3 / 2,
    alt: "A coach kneeling beside a player driving into a tackle pad held by a team-mate, guiding the height of the tackle with his hand.",
    kind: "coaching",
    hotspots: [
      { id: "tackle", x: 0.55, y: 0.5, entity: S("tackling-technique") },
      { id: "confidence", x: 0.3, y: 0.45, entity: P("understanding-contact-rugby") },
      { id: "safety", x: 0.72, y: 0.3, entity: O("foul-play-and-player-safety") },
    ],
  },
  "COACHING_CONCEPT:coaching-tackle-count-decisions": {
    assetKey: "scene-coach-tackle-count",
    aspect: 3 / 2,
    alt: "A coach pointing down the pitch as four players in plain dark kit run a set with the ball, cones marking the tackle line.",
    kind: "coaching",
    hotspots: [
      { id: "count", x: 0.3, y: 0.25, entity: G("tackle-count") },
      { id: "play-the-ball", x: 0.51, y: 0.53, entity: G("play-the-ball") },
      { id: "skill", x: 0.8, y: 0.45, entity: S("play-the-ball-and-restart") },
    ],
  },
}

export function visualFor(ref: HubEntityRef): HubVisual | null {
  return HUB_VISUALS[entityKey(ref)] ?? null
}

/** The opening image of each Hub area (and the landing). Atmosphere only: no text, no crest, no named person. */
export const SECTION_HEROES: Record<"landing" | "learn" | "play" | "coach" | "explore" | "welfare", { assetKey: string; alt: string }> = {
  landing: { assetKey: "hero-landing", alt: "A community rugby pitch under floodlights at dusk, chalk lines bright on the grass." },
  learn: { assetKey: "hero-learn", alt: "A muddy rugby ball resting on a chalk line, the posts soft in the distance." },
  play: { assetKey: "hero-play", alt: "A line of players in training tops stepping through a row of cones on a grey afternoon." },
  coach: { assetKey: "hero-coach", alt: "Coaching kit on the grass: tackle pads, a stack of cones, a whistle and clipboard, and a bag of balls." },
  explore: { assetKey: "hero-explore", alt: "A floodlit stadium at dusk seen from the terraces, the pitch marked and lit below." },
  welfare: { assetKey: "hero-welfare", alt: "A family walking past a wooden clubhouse towards the pitch on a Sunday morning." },
}

export function heroImage(key: keyof typeof SECTION_HEROES): number {
  return HUB_ASSETS[SECTION_HEROES[key].assetKey]
}

/** Every asset key any visual or hero names -- the generation manifest and the permanent test read this. */
export function assetKeysInUse(): string[] {
  const keys = new Set<string>()
  for (const v of Object.values(HUB_VISUALS)) keys.add(v.assetKey)
  for (const h of Object.values(SECTION_HEROES)) keys.add(h.assetKey)
  return [...keys].sort()
}
