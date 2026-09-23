import type { AgendaItem } from "../agenda/load"
import type { FamilyProjection } from "../family/projection"
import { needsAttendanceResponse } from "../parent/agenda-model"
import { sortAgenda } from "../parent/home"
import {
  projectParticipantMatch,
  projectParticipantTraining,
  type ParticipantMatch,
  type ParticipantTraining,
} from "./match-card"

/**
 * WHAT IS NEXT FOR THIS FAMILY — the one thing Parent Home leads with.
 *
 * ANOTHER PRESENTATION OF TRUTH THAT ALREADY EXISTS. The Calendar draws a
 * participant match as a compact card, Fixtures will draw it expanded, and Home
 * draws it as a hero. All three are `projectParticipantMatch` over the same
 * canonical agenda row -- so a hero cannot say a different kick-off, a different
 * ground or a different home side from the card two taps away. Training is the
 * same arrangement through `projectParticipantTraining`.
 *
 * ORDERED BY WHAT IS ACTUALLY NEXT, not by alternating categories. A family whose
 * next two things are both training gets both; a family with a match on Saturday
 * and a session on Tuesday gets the session first, because Tuesday comes first.
 * Blindly putting "Match" before "Training" would tell a parent the wrong thing is
 * imminent.
 *
 * THE ROWS ARE ALREADY NARROWED. Whatever family scope and child filter produced
 * them applies here unchanged -- this reorders and slices, and can no more widen a
 * scope than any other array operation.
 */

export interface HeroPage {
  key: string
  kind: "match" | "training"
  /** The event, so a card can route through the one destination table. */
  item: AgendaItem
  match: ParticipantMatch | null
  training: ParticipantTraining | null
  /**
   * True where this family still owes an answer for this event.
   *
   * The canonical rule -- `needsAttendanceResponse` -- so the hero's prompt and the
   * word on a Calendar row appear and disappear together. A hero that asked for an
   * answer the rest of the app considered given would be two products.
   */
  needsAnswer: boolean
}

/** How many pages the carousel may hold. Beyond this it stops being a hero. */
export const MAX_HERO_PAGES = 4

/**
 * The pages, in the order they actually happen.
 *
 * ONE PER KIND FIRST. A family's next match and next session are the two things a
 * parent is planning around, so both earn a page even when three matches come
 * first -- and anything after that is only added if there is room, in date order.
 * Everything else is what Fixtures and the Calendar are for.
 */
export function projectHomeHero(
  items: AgendaItem[],
  family: FamilyProjection,
  todayIso: string,
  trainingEndTimes: Map<string, string | null> = new Map()
): HeroPage[] {
  const upcoming = sortAgenda(items).filter((item) => item.date >= todayIso && item.status !== "Cancelled")

  const nextMatch = upcoming.find((item) => item.kind === "fixture") ?? null
  const nextTraining = upcoming.find((item) => item.kind === "training") ?? null

  const chosen: AgendaItem[] = []
  for (const item of [nextMatch, nextTraining]) if (item) chosen.push(item)
  // Then whatever else is soonest, so a family with two matches this week sees the
  // second one without opening Fixtures.
  for (const item of upcoming) {
    if (chosen.length >= MAX_HERO_PAGES) break
    if (!chosen.includes(item)) chosen.push(item)
  }

  return sortAgenda(chosen).map((item) => ({
    key: item.key,
    kind: item.kind === "training" ? "training" : "match",
    item,
    match: item.kind === "training" ? null : projectParticipantMatch(item, family),
    training:
      item.kind === "training"
        ? projectParticipantTraining(item, family, trainingEndTimes.get(item.eventId) ?? null)
        : null,
    needsAnswer: item.playerId !== null && needsAttendanceResponse(item, todayIso),
  }))
}

/** What the hero's own action says. A participant goes to a participant centre. */
export function heroActionLabel(kind: HeroPage["kind"]): string {
  return kind === "training" ? "View Training Centre" : "View Match Centre"
}

/** The band above the hero's title. Never inferred from imagery. */
export function heroKindLabel(kind: HeroPage["kind"]): string {
  return kind === "training" ? "NEXT TRAINING" : "NEXT MATCH"
}
