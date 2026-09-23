import type { AgendaItem, AgendaSide } from "../agenda/load"
import { ATTENDANCE_STATE_WORDS } from "../availability/vocabulary"
import { memberFor, type FamilyMember, type FamilyProjection } from "../family/projection"

/**
 * ONE PARTICIPANT-FACING MATCH MODEL, FOR EVERY DENSITY IT IS DRAWN AT.
 *
 * A parent meets the same fixture in three places -- a day in the Calendar, the
 * Fixtures list, and the Match Centre -- and it is one fixture. What differs is
 * how much room there is to say it, not what is true about it. So the TRUTH is
 * resolved once, here, and a component chooses a density.
 *
 * WHY THAT MATTERS MORE THAN IT SOUNDS. The alternative is two card components
 * each working out which side is at home, each picking a crest, each deciding what
 * to call the opposition when it is only a Club Directory entry -- and the day one
 * of them gets it wrong, a parent is told their child is playing at home when they
 * are not. Which side is which is a domain question with one answer.
 *
 * IT ADDS NOTHING AND AUTHORISES NOTHING. Every value is copied from an
 * `AgendaItem` the server already returned under the viewer's own scope, plus the
 * child's identity from `FamilyProjection`. No query, no clock, no capability.
 */

export type MatchCardDensity = "compact" | "expanded"

export interface MatchSide {
  clubName: string
  /** The canonical display name -- "Under 12 Boys". Null where the side is only a Club Directory entry. */
  teamName: string | null
  crestUrl: string | null
  /** True for the side this viewer's family is on, so a card can say which is theirs. */
  isOurs: boolean
}

export interface ParticipantMatch {
  /** WHO IS AT HOME, on the left. Canonical, never "our team first". */
  home: MatchSide | null
  away: MatchSide | null
  /**
   * TRUE ONLY WHERE THE ORIENTATION IS REAL.
   *
   * A fixture can be "TBD" or "Not Applicable" -- a festival, a tournament, a
   * match whose venue is not settled. Those have no home side, and drawing one
   * anyway would tell a parent to travel or not travel on an invention. The card
   * then shows both sides without claiming which ground they are on.
   */
  oriented: boolean
  /** "Away" / "Home" for the viewer's own side, or null where there is no orientation. */
  ourOrientation: "Home" | "Away" | null
  /** "Union · U12" -- the canonical code and the canonical compact identity, where both are known. */
  classification: string | null
  kickoff: string | null
  meetTime: string | null
  venue: string | null
  /** The canonical fixture status, or null where it is simply going ahead. */
  status: string | null
  cancelled: boolean
  /** The child this row belongs to, projected -- never rebuilt from the row. */
  child: FamilyMember | null
  /** The child's own canonical answer, and the word for it. */
  attendance: AgendaItem["attendance"]
  attendanceWord: string
  answered: boolean
  /** One sentence carrying every fact on the card, for somebody who cannot see it. */
  spoken: string
}

const CODE_WORDS: Record<string, string> = { union: "Union", league: "League" }

/** "Union · U12", from canonical fields only. Null rather than a guess. */
export function matchClassification(side: AgendaSide | null): string | null {
  if (!side) return null
  const code = side.rugbyCode ? (CODE_WORDS[side.rugbyCode] ?? null) : null
  // The compact identity is the canonical short form -- "U12", "Girls U14" --
  // derived from the team's structured fields, never trimmed off a display name.
  const grade = side.compactName
  return [code, grade].filter(Boolean).join(" · ") || null
}

function toSide(side: AgendaSide | null, isOurs: boolean): MatchSide | null {
  if (!side) return null
  return { clubName: side.clubName, teamName: side.teamName, crestUrl: side.crestUrl, isOurs }
}

/** What a side is called when it has to fit on one line: the team, else the club. */
export function sideLabel(side: MatchSide | null): string {
  if (!side) return "To be confirmed"
  return side.teamName ?? side.clubName
}

/**
 * WHAT A SIDE IS CALLED WHEN IT IS READ ALOUD.
 *
 * The club AND the team, because two Under 12 sides playing each other are both
 * called "Under 12 Boys" -- and "Under 12 Boys versus Under 12 Boys" tells a
 * blind parent nothing at all. The card shows the team on one line and the club
 * beneath it; the sentence has to carry both.
 */
export function spokenSideLabel(side: MatchSide | null): string {
  if (!side) return "an opponent to be confirmed"
  if (!side.teamName || side.teamName === side.clubName) return side.clubName
  return `${side.clubName} ${side.teamName}`
}

export function projectParticipantMatch(item: AgendaItem, family: FamilyProjection): ParticipantMatch {
  /*
    HOME AND AWAY, FROM THE CANONICAL ORIENTATION.

    `homeAway` is the viewer's OWN side's orientation, so "Home" puts us on the
    left and "Away" puts us on the right. Putting our team on the left every time
    would be easier and would be wrong: a parent reads the left-hand crest as the
    side playing at their own ground, and being told the wrong one is how somebody
    drives to the wrong place.
  */
  const oriented = item.homeAway === "Home" || item.homeAway === "Away"
  const ourSide = toSide(item.us, true)
  const theirSide = toSide(item.them, false)
  const home = !oriented ? ourSide : item.homeAway === "Home" ? ourSide : theirSide
  const away = !oriented ? theirSide : item.homeAway === "Home" ? theirSide : ourSide

  const child = memberFor(family, item.playerId)
  const attendanceWord = ATTENDANCE_STATE_WORDS[item.attendance ?? "AWAITING"]
  const cancelled = item.status === "Cancelled"

  return {
    home,
    away,
    oriented,
    ourOrientation: oriented ? (item.homeAway as "Home" | "Away") : null,
    classification: matchClassification(item.us),
    kickoff: item.time ? item.time.slice(0, 5) : null,
    meetTime: item.meetTime ? item.meetTime.slice(0, 5) : null,
    venue: item.venue,
    status: item.status,
    cancelled,
    child,
    attendance: item.attendance,
    attendanceWord,
    answered: item.attendance !== null,
    /*
      THE WHOLE CARD AS ONE SENTENCE.

      VoiceOver must not have to infer a fixture from a "VS" between two images,
      so the sides are spoken with the word "versus" and the orientation is said in
      full. Crests are decorative once the names are spoken.
    */
    spoken: [
      child ? `${child.shortLabel}, ${child.teamName}.` : null,
      `${spokenSideLabel(home)} versus ${spokenSideLabel(away)}.`,
      oriented ? `${item.homeAway} for ${spokenSideLabel(ourSide)}.` : null,
      item.time ? `Kick off ${item.time.slice(0, 5)}.` : null,
      item.meetTime ? `Meet ${item.meetTime.slice(0, 5)}.` : null,
      item.venue ? `${item.venue}.` : null,
      cancelled ? "Cancelled." : item.status && item.status !== "Booked" ? `${item.status}.` : null,
      child ? `${attendanceWord}.` : null,
    ]
      .filter(Boolean)
      .join(" "),
  }
}

/** The training twin: the same child strip and the same words, without an opposition. */
export interface ParticipantTraining {
  title: string
  teamName: string | null
  start: string | null
  /** "18:00 – 19:30" where both are known. */
  window: string | null
  venue: string | null
  cancelled: boolean
  status: string | null
  child: FamilyMember | null
  attendance: AgendaItem["attendance"]
  attendanceWord: string
  spoken: string
}

export function projectParticipantTraining(
  item: AgendaItem,
  family: FamilyProjection,
  endTime?: string | null
): ParticipantTraining {
  const child = memberFor(family, item.playerId)
  const start = item.time ? item.time.slice(0, 5) : null
  const end = endTime ? endTime.slice(0, 5) : null
  const attendanceWord = ATTENDANCE_STATE_WORDS[item.attendance ?? "AWAITING"]
  const cancelled = item.status === "Cancelled"
  return {
    title: "Training Session",
    teamName: item.us.teamName,
    start,
    // Only where the end is genuinely known. "18:00 – " is worse than "18:00".
    window: start && end ? `${start} – ${end}` : null,
    venue: item.venue,
    cancelled,
    status: item.status,
    child,
    attendance: item.attendance,
    attendanceWord,
    spoken: [
      child ? `${child.shortLabel}, ${child.teamName}.` : null,
      "Training session.",
      start ? `${start}.` : null,
      item.venue ? `${item.venue}.` : null,
      cancelled ? "Cancelled." : null,
      child ? `${attendanceWord}.` : null,
    ]
      .filter(Boolean)
      .join(" "),
  }
}
