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
  teamId: string | null
  oppositionId: string | null
  clubId: string | null
  homeAway: "all" | "Home" | "Away"
  includeTraining: boolean
}

export const NO_FILTER: AgendaFilter = {
  teamId: null,
  oppositionId: null,
  clubId: null,
  homeAway: "all",
  includeTraining: true,
}

export function isFiltered(filter: AgendaFilter): boolean {
  return (
    filter.teamId !== null ||
    filter.oppositionId !== null ||
    filter.clubId !== null ||
    filter.homeAway !== "all" ||
    !filter.includeTraining
  )
}

export function countActive(filter: AgendaFilter): number {
  return [
    filter.teamId !== null,
    filter.oppositionId !== null,
    filter.clubId !== null,
    filter.homeAway !== "all",
    !filter.includeTraining,
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
    if (!filter.includeTraining && item.kind === "training") return false
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
    return true
  })
}
