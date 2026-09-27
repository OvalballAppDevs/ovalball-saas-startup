import type { AgendaItem } from "@ovalball/contracts"

/**
 * NARROWING WHAT IS ALREADY YOURS.
 *
 * A FILTER NEVER WIDENS. Everything a filter can select is drawn from the rows the server already
 * returned, and applying one can only remove from that array -- there is no query here, so there is no
 * way for a choice made on a phone to reach a row the scope did not authorise. That is the canonical
 * rule the whole agenda is built on, and keeping the rule in a plain module rather than inside a
 * component is what lets it be tested without a renderer.
 */

export interface AgendaFilter {
  /**
   * ONE CHILD, OR ALL OF THEM.
   *
   * The equivalent of the website's `AgendaFilterState.playerId`, which mobile
   * lacked entirely -- so a guardian of two had no way to look at one of them
   * and the only selector on offer was by TEAM, which is a different question
   * wearing the same shape.
   *
   * THE ALLOWED VALUES ARE NOT THIS MODULE'S. They come from the family
   * projection, which is built from `resolveFamilyScope` -- relationships the
   * session proved. An id from anywhere else is normalised to null before it
   * reaches here, and even if one did not, the narrowing below could only ever
   * REMOVE rows the loader already returned for this person's own children.
   *
   * A CHILD FILTER IS NOT A CONTEXT SWITCH. Choosing Pippa narrows what is
   * shown; it does not make the signed-in person Pippa, and nothing about their
   * authority changes.
   */
  playerId: string | null
  teamId: string | null
  oppositionId: string | null
  clubId: string | null
  homeAway: "all" | "Home" | "Away"
  /** The canonical `fixtures.game_type` value itself, or null for "any type" (owner correction pass, Section 13). */
  gameType: string | null
  includeTraining: boolean
  /**
   * Show fixtures that are not going ahead. ON by default for a participant, matching the website's
   * `AgendaFilterState.includeCancelled` -- a cancelled match is the reason somebody does NOT drive to
   * a ground on a Sunday morning, so hiding it by default would be the app deciding they no longer need
   * to know. Switching it off is for looking down a season at what is actually being played.
   *
   * A CLUB/TEAM STAFF AGENDA DEFAULTS THIS OFF instead (owner correction pass, Section 12): a Fixture
   * Secretary scanning the season for what is actually being played is the common case there, and a
   * cancelled match clutters that scan the way it never clutters a parent's "am I driving anywhere" one.
   * `NO_FILTER` itself stays `true` (Calendar and a participant's own Fixtures both still want it),
   * and the Fixtures screen applies the narrower default once, itself, for a staff context only -- see
   * `apps/mobile/app/(tabs)/fixtures/index.tsx`.
   */
  includeCancelled: boolean
}

export const NO_FILTER: AgendaFilter = {
  playerId: null,
  teamId: null,
  oppositionId: null,
  clubId: null,
  homeAway: "all",
  gameType: null,
  includeTraining: true,
  includeCancelled: true,
}

/**
 * "IS ANYTHING NARROWED", measured against a BASELINE rather than always the bare `NO_FILTER`. The
 * Fixtures screen's own staff default (cancelled hidden) is not something a person chose, so it must
 * never light up the Filter button's badge as if they had -- only a departure from whatever this
 * screen's own starting point is counts as an active filter. Every existing caller that never passes
 * a baseline keeps comparing against `NO_FILTER` exactly as before.
 */
export function isFiltered(filter: AgendaFilter, baseline: AgendaFilter = NO_FILTER): boolean {
  return (
    filter.playerId !== baseline.playerId ||
    filter.teamId !== baseline.teamId ||
    filter.oppositionId !== baseline.oppositionId ||
    filter.clubId !== baseline.clubId ||
    filter.homeAway !== baseline.homeAway ||
    filter.gameType !== baseline.gameType ||
    filter.includeTraining !== baseline.includeTraining ||
    filter.includeCancelled !== baseline.includeCancelled
  )
}

export function countActive(filter: AgendaFilter, baseline: AgendaFilter = NO_FILTER): number {
  return [
    filter.playerId !== baseline.playerId,
    filter.teamId !== baseline.teamId,
    filter.oppositionId !== baseline.oppositionId,
    filter.clubId !== baseline.clubId,
    filter.homeAway !== baseline.homeAway,
    filter.gameType !== baseline.gameType,
    filter.includeTraining !== baseline.includeTraining,
    filter.includeCancelled !== baseline.includeCancelled,
  ].filter(Boolean).length
}

/**
 * The narrowing itself.
 *
 * Deliberately a plain array filter over rows the loader returned: there is no query here, so there is
 * no way for a filter to reach a row the scope did not authorise.
 */
export function applyFilter(items: AgendaItem[], filter: AgendaFilter): AgendaItem[] {
  return items.filter((item) => {
    // THE CHILD, FIRST. An agenda row in a family scope carries the player it
    // belongs to; a row with no player at all belongs to no child and is
    // legitimately excluded when one is chosen.
    if (filter.playerId && item.playerId !== filter.playerId) return false
    if (!filter.includeTraining && item.kind === "training") return false
    // The canonical status, never a guess from a struck-through label.
    if (!filter.includeCancelled && item.status === "Cancelled") return false
    if (filter.teamId && item.teamId !== filter.teamId) return false
    if (filter.clubId && item.clubId !== filter.clubId) return false
    // Opposition is matched on the canonical directory id, never on a name. Training has no
    // opposition, so filtering to one legitimately excludes it -- somebody asking about matches
    // against Rossendale is asking about matches.
    if (filter.oppositionId) {
      if (item.kind !== "fixture" || item.them?.directoryId !== filter.oppositionId) return false
    }
    if (filter.homeAway !== "all") {
      if (item.kind !== "fixture" || item.homeAway !== filter.homeAway) return false
    }
    if (filter.gameType) {
      if (item.kind !== "fixture" || item.gameType !== filter.gameType) return false
    }
    return true
  })
}
