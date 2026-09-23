/**
 * The Rugby Hub information architecture, in one place.
 *
 * This is PRODUCT IA, organised by what a person came to do — never by
 * content_type, never by table, never by the order features shipped in.
 * Several of these destinations span more than one storage mechanism
 * (Teams & Competitions and International Rugby are both RUGBY_TEAM rows
 * with different team_types; The Story of Rugby is its own heritage
 * schema), and that is exactly why the grouping cannot be derived from the
 * data layer.
 *
 * Five groups, chosen so that an ordinary person can predict where a thing
 * lives before they click:
 *
 *   Learn the Game    what rugby is and how it works
 *   Play & Develop    how to play it, and how getting better works
 *   Coach Rugby       how to help other people learn it
 *   Explore Rugby     the teams, people and history of the sport
 *   Welfare & Support looking after the people in the game
 *
 * This replaced a single "Learn the Game" group holding eleven unrelated
 * destinations — Glossary next to Famous Clubs next to Coaching — whose
 * secondary row measured 1529px inside a 768px column and clipped five
 * items at every desktop width.
 *
 * Room to grow, deliberately: Volunteers belongs in Welfare & Support
 * alongside Parents & Guardians; Culture, History & Traditions and Rugby Facts &
 * Discoveries belong in Explore Rugby; future coach resources join Coach
 * Rugby. None of those are listed here, because nothing appears in this
 * navigation until it is a real, reachable destination.
 */

export interface HubDestination {
  href: string
  label: string
  /** One short line, used by the Hub home cards and the mobile menu. Not marketing copy. */
  description: string
}

export interface HubGroup {
  key: string
  label: string
  /** What this group is for, in a person's own words. Shown on the Hub home. */
  blurb: string
  items: HubDestination[]
}

export const HUB_GROUPS: HubGroup[] = [
  {
    key: "learn",
    label: "Learn the Game",
    blurb: "What rugby is, how it works, and the words and rules that go with it.",
    items: [
      { href: "/rugby-hub/game", label: "Game Knowledge", description: "How rugby actually works — possession, contact, restarts and how a game flows." },
      { href: "/rugby-hub/rules", label: "Rules", description: "Playing rules and age-grade guidance relevant to your team." },
      { href: "/rugby-hub/officiating", label: "Officiating", description: "Who match officials are, what they're looking for, and how to respect their decisions." },
      { href: "/rugby-hub/positions", label: "Positions", description: "Explore the pitch, pick a position, and find out what it actually does." },
      { href: "/rugby-hub/glossary", label: "Glossary", description: "Plain-English definitions for the rugby terms you'll hear around the pitch." },
    ],
  },
  {
    key: "play",
    label: "Play & Develop",
    blurb: "How to play, and how getting better actually happens over time.",
    items: [
      { href: "/rugby-hub/skills", label: "Skills", description: "What each skill is, why it matters, and how to get better at it." },
      { href: "/rugby-hub/development", label: "Player Development", description: "The ideas above the individual skills, and why the game is taught in stages." },
    ],
  },
  {
    key: "coach",
    label: "Coach Rugby",
    blurb: "How to help players learn, whatever your experience.",
    items: [
      { href: "/rugby-hub/coaching", label: "Coaching Knowledge", description: "Planning sessions, designing practice, feedback, and coaching everyone in the group." },
    ],
  },
  {
    key: "explore",
    label: "Explore Rugby",
    blurb: "The teams, competitions, people and history that make up the sport.",
    items: [
      { href: "/rugby-hub/story", label: "The Story of Rugby", description: "An interactive journey from a shared beginning to two distinct games." },
      { href: "/rugby-hub/competitions", label: "Teams & Competitions", description: "How clubs, teams and competitions fit together — leagues, tables and promotion explained." },
      { href: "/rugby-hub/international", label: "International Rugby", description: "The Rugby World Cup, the Six Nations, the Lions and the world's major international teams." },
      { href: "/rugby-hub/clubs", label: "Famous Clubs", description: "The domestic and professional clubs that shaped rugby history." },
      { href: "/rugby-hub/people", label: "People & Rugby Legends", description: "The players, coaches, referees and pioneers who shaped both codes." },
    ],
  },
  {
    key: "welfare",
    label: "Welfare & Support",
    blurb: "Looking after the people in the game.",
    items: [
      { href: "/rugby-hub/parents", label: "Parents & Guardians", description: "Rugby explained for the adults supporting a player — starting out, match day, contact, and where official guidance lives." },
      { href: "/rugby-hub/player-welfare", label: "Player Welfare", description: "Concussion and player-welfare guidance from official rugby sources." },
      { href: "/rugby-hub/safeguarding", label: "Safeguarding", description: "Official safeguarding guidance and reporting information." },
    ],
  },
]

export const HUB_HOME = { href: "/rugby-hub", label: "Overview" }

/**
 * The newcomer path. Pure navigation into destinations that already exist —
 * no account state, no progress, nothing stored. Deliberately short: the
 * point is to remove the "where do I even start" problem, not to build a
 * syllabus.
 */
export const HUB_START_HERE: { href: string; label: string; description: string }[] = [
  { href: "/rugby-hub/game", label: "Game Knowledge", description: "Start with what the game is actually trying to do." },
  { href: "/rugby-hub/glossary", label: "Glossary", description: "Look up any word you hear and don't recognise." },
  { href: "/rugby-hub/positions", label: "Positions", description: "Find out what each player on the pitch is there to do." },
]

/**
 * Route matching is data-driven and boundary-safe: a destination matches its
 * own path or anything beneath it, never a path that merely shares a string
 * prefix. Nothing here matches on labels, so renaming a nav label can never
 * change which section highlights.
 */
function matchesRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/")
}

/** The most specific destination that owns this route, so a deep link highlights the right section. */
export function findActiveDestination(pathname: string): { group: HubGroup; item: HubDestination } | null {
  let best: { group: HubGroup; item: HubDestination } | null = null
  for (const group of HUB_GROUPS) {
    for (const item of group.items) {
      if (matchesRoute(pathname, item.href) && (!best || item.href.length > best.item.href.length)) {
        best = { group, item }
      }
    }
  }
  return best
}

export function findActiveGroup(pathname: string): HubGroup | null {
  return findActiveDestination(pathname)?.group ?? null
}

/** A one-item group has already taken the reader where they were going, so it renders no secondary row. */
export function groupNeedsSecondaryRow(group: HubGroup): boolean {
  return group.items.length > 1
}
