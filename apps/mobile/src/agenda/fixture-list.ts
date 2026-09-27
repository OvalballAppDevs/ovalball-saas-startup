/**
 * FIVE AT A TIME (owner correction pass, Sections 9-10): Upcoming shows the next five, Past the five
 * most recent, each with a "View all" to see the rest -- never a fixed page the caller has to
 * reconstruct. Ordering itself is the loader's job (ascending for upcoming, newest-first for past);
 * this only ever slices, exactly like `applyFilter` only ever narrows. Generic over the row shape so it
 * works equally over plain `AgendaItem[]` or the `{row, siblings}[]` a family reading collapses onto.
 */
export interface FixturePage<T> {
  shown: T[]
  hasMore: boolean
}

export function pageFixtures<T>(items: T[], expanded: boolean, pageSize = 5): FixturePage<T> {
  if (expanded || items.length <= pageSize) return { shown: items, hasMore: false }
  return { shown: items.slice(0, pageSize), hasMore: true }
}
