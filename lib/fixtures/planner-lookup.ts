/**
 * THE PLANNER'S LOOKUP INDEX.
 *
 * A lookup used to ask the server on every keystroke of every cell: open
 * Opposition Club on row 7, type four letters, and a debounced server action
 * re-resolved the session, re-checked the capability and ran two ILIKE
 * queries before a single option appeared -- then did all of it again on
 * row 8. The answers never changed between rows.
 *
 * So the canonical options are loaded ONCE per planner session, already
 * scoped by the server to what this person may see, and filtered here. This
 * module is the filtering: pure, synchronous, and fast enough over the whole
 * Club Directory that there is nothing left to debounce.
 *
 * It never adds an option. Every entry came from the server; search only
 * decides which of them to show first.
 */

export interface LookupEntry {
  id: string
  /** The canonical value a cell receives when this entry is chosen. */
  label: string
  /** Provenance shown beside the label ("On Ovalball", "Our ground", "U7/U8 Tags"). */
  hint?: string
  /** Other names for this same thing -- a compact team name, a squad alias. Never written into a cell. */
  aliases?: string[]
  /** Something this entry belongs to -- a Mini-Rugby Group tag. Searchable, ranked below the entry's own names. */
  context?: string[]
}

interface IndexedEntry {
  entry: LookupEntry
  order: number
  label: string
  terms: string[]
  context: string[]
}

export interface LookupIndex {
  entries: IndexedEntry[]
}

/**
 * Lower-cased, accent-free, single-spaced. "Rugby Football Club" also answers
 * to "RFC" and "Under 7" also answers to "U7", because that is how clubs are
 * actually written in a secretary's spreadsheet.
 */
export function normaliseSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function variants(value: string): string[] {
  const base = normaliseSearch(value)
  const out = new Set([base])
  out.add(base.replace(/rugby union football club/g, "rufc").replace(/rugby football club/g, "rfc").replace(/rugby club/g, "rc"))
  out.add(base.replace(/\bunder (\d+)/g, "u$1"))
  // "U7/U8 Tags" is found by typing "7/8".
  out.add(base.replace(/\bu(\d+)/g, "$1"))
  return [...out]
}

export function buildLookupIndex(entries: LookupEntry[]): LookupIndex {
  return {
    entries: entries.map((entry, order) => ({
      entry,
      order,
      label: normaliseSearch(entry.label),
      terms: [entry.label, ...(entry.aliases ?? [])].flatMap(variants),
      context: (entry.context ?? []).flatMap(variants),
    })),
  }
}

/**
 * Ranked search. Lower scores first:
 *   0  the label is exactly what was typed
 *   1  the label starts with it
 *   2  a word in the label or an alias starts with it
 *   3  it appears anywhere in the label or an alias
 *   4  it matches only something the entry belongs to (a group tag)
 * Within a score, values used earlier in this session come first, then the
 * server's own canonical order -- which is never rewritten, only preferred.
 */
export function searchLookup(
  index: LookupIndex,
  query: string,
  options: { limit?: number; recent?: string[] } = {},
): LookupEntry[] {
  const limit = options.limit ?? 50
  const recentRank = new Map((options.recent ?? []).map((label, i) => [label, i]))
  const q = normaliseSearch(query)

  const scored: { item: IndexedEntry; score: number }[] = []
  for (const item of index.entries) {
    let score: number
    if (!q) score = 0
    else if (item.label === q) score = 0
    else if (item.label.startsWith(q)) score = 1
    else if (item.terms.some((t) => t.startsWith(q) || t.includes(` ${q}`))) score = 2
    else if (item.terms.some((t) => t.includes(q))) score = 3
    else if (item.context.some((t) => t.includes(q))) score = 4
    else continue
    scored.push({ item, score })
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    const ra = recentRank.get(a.item.entry.label) ?? Number.POSITIVE_INFINITY
    const rb = recentRank.get(b.item.entry.label) ?? Number.POSITIVE_INFINITY
    if (ra !== rb) return ra - rb
    return a.item.order - b.item.order
  })

  return scored.slice(0, limit).map((s) => s.item.entry)
}

/** The exact canonical entry a cell's text names, if any -- case-insensitive. */
export function exactEntry(index: LookupIndex, value: string): LookupEntry | null {
  const q = normaliseSearch(value)
  if (!q) return null
  return index.entries.find((e) => e.label === q)?.entry ?? null
}

/** Most-recent-first, de-duplicated, bounded. Session memory only; nothing is persisted. */
export function rememberRecent(recent: string[], label: string, max = 8): string[] {
  return [label, ...recent.filter((r) => r !== label)].slice(0, max)
}
