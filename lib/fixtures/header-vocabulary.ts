/**
 * THE ONE HEADER VOCABULARY.
 *
 * REAL FILES DO NOT USE OUR COLUMN NAMES. A league sends "Start Date", a
 * club spreadsheet says "KO", a Spond export says "Match Type". Refusing
 * those and asking a fixture secretary to rename eleven headers by hand is
 * the friction that sends people back to the spreadsheet -- so headers are
 * matched on their MEANING.
 *
 * Two mechanisms, deliberately separate:
 *
 *   NORMALISATION handles the same word written differently -- case,
 *   spaces, underscores, punctuation. "Kick Off Time", "kickoff_time" and
 *   "KICK-OFF TIME" are one header.
 *
 *   SYNONYMS handle genuinely different words for the same thing, listed
 *   explicitly so the vocabulary stays reviewable rather than guessed at
 *   by fuzzy matching.
 *
 * This module is deliberately free of `server-only`: the planner reads an
 * uploaded file's headers in the browser and the import engine reads the
 * same headers on the server, and they must agree about what "Opposition"
 * means. A second copy of this table would be two vocabularies drifting.
 */
export const HEADER_SYNONYMS: Record<string, string> = {
  startdate: "date",
  fixturedate: "date",
  matchdate: "date",
  starttime: "kickoff",
  kickofftime: "kickoff",
  ko: "kickoff",
  meetup: "meettime",
  meetingtime: "meettime",
  meet: "meettime",
  matchtype: "homeaway",
  ha: "homeaway",
  homeoraway: "homeaway",
  // These resolve to the names the engine actually ASKS FOR -- "venuename",
  // not "venue". A synonym normalising to a name no caller requests is an
  // entry that has never once matched.
  ground: "venuename",
  place: "venuename",
  location: "venuename",
  venue: "venuename",
  pitch: "pitchname",
  opponent: "awayclub",
  opposition: "awayclub",
  oppositionclub: "awayclub",
  oppositionteam: "awayteam",
  ourteam: "hometeam",
  club: "homeclub",
}

export function normaliseHeader(name: string): string {
  const key = name.trim().toLowerCase().replace(/[^a-z0-9]/g, "")
  return HEADER_SYNONYMS[key] ?? key
}
