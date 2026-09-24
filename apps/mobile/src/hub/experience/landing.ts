import { HUB_GROUPS } from "@ovalball/contracts/rugby-hub/ia"
import type { HeritageEntry } from "@ovalball/contracts/rugby-hub/heritage-data"
import { stableHash } from "@ovalball/contracts/rugby-hub/quick-check"

/**
 * WHICH GROUP LEADS. The IA never changes and no group is ever hidden; what a context changes is
 * only the ORDER the same five groups are read in. A parent or guardian meets Welfare & Support
 * and Learn the Game first; a team or club context meets Coach Rugby and Play & Develop first;
 * everyone else reads the website's order. Presentation only -- never a filter.
 */
export function orderedGroupKeys(kind: string | null | undefined): string[] {
  const ia = HUB_GROUPS.map((g) => g.key)
  const lead = kind === "parent" || kind === "family" ? ["welfare", "learn"] : kind === "team" || kind === "club" ? ["coach", "play"] : []
  return [...lead.filter((k) => ia.includes(k)), ...ia.filter((k) => !lead.includes(k))]
}

/**
 * ONE MOMENT FROM THE STORY, chosen by the day of the year over the entries in a stable order, so
 * everyone opening the Hub on the same day meets the same moment and nobody is served a random one.
 */
export function storyOfTheDay(entries: HeritageEntry[], dayOfYear: number): HeritageEntry | null {
  if (entries.length === 0) return null
  const ordered = [...entries].sort((a, b) => stableHash(a.entryKey) - stableHash(b.entryKey) || a.entryKey.localeCompare(b.entryKey))
  return ordered[((dayOfYear % ordered.length) + ordered.length) % ordered.length] ?? null
}

export function dayOfYear(now: Date): number {
  const start = Date.UTC(now.getUTCFullYear(), 0, 1)
  return Math.floor((now.getTime() - start) / 86_400_000)
}
