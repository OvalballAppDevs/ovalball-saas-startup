/**
 * THE MATCH CENTRE'S SECTIONS -- one list, used by the tab bar, every deep link and every notification.
 *
 * Match Centre is the one destination for a game (owner brief, 2026-10-03). A notification that is about
 * attendance opens the Attendance section, one about a result opens Result, and so on; the section is
 * carried as `?tab=` on the canonical `/fixtures/<id>` address so the website, which ignores it, still
 * lands on its own Match Centre.
 */
export const MATCH_CENTRE_SECTIONS = ["overview", "arena", "result", "attendance", "changing-room", "rewards"] as const
export type MatchCentreSection = (typeof MATCH_CENTRE_SECTIONS)[number]

/** The word on the tab. Title Case: these are navigation. */
export const MATCH_CENTRE_SECTION_LABEL: Record<MatchCentreSection, string> = {
  overview: "Overview",
  arena: "Arena Details",
  result: "Result",
  attendance: "Attendance",
  "changing-room": "Changing Room",
  rewards: "Rewards",
}

/** A section name from a link, or Overview for anything unrecognised -- never a dead end. */
export function parseMatchCentreSection(raw: string | string[] | null | undefined): MatchCentreSection {
  const value = Array.isArray(raw) ? raw[0] : raw
  const lowered = (value ?? "").toLowerCase()
  if (lowered === "changing_room" || lowered === "changingroom" || lowered === "messages") return "changing-room"
  if (lowered === "awards" || lowered === "recognition") return "rewards"
  if (lowered === "venue" || lowered === "arena-details") return "arena"
  return (MATCH_CENTRE_SECTIONS as readonly string[]).includes(lowered) ? (lowered as MatchCentreSection) : "overview"
}

/** The canonical address of one section of one game. */
export function matchCentreHref(fixtureId: string, section: MatchCentreSection = "overview"): string {
  return section === "overview" ? `/fixtures/${fixtureId}` : `/fixtures/${fixtureId}?tab=${section}`
}
