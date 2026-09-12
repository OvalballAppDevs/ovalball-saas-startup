import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import type { CodeScope, Certainty } from "./heritage-types"

export type { CodeScope, Certainty } from "./heritage-types"
export { CERTAINTY_LABEL } from "./heritage-types"

/**
 * The Story of Rugby -- data layer over the existing heritage_eras /
 * heritage_entries / heritage_entry_sources schema (20261110000000). Reuses
 * it exactly as it stands: no new history model, no new tables, no
 * additional historical claims. Heritage has no draft/publication state --
 * see that migration's own header ("the one part of the Rugby Hub with
 * nothing club-specific or child-specific in it") -- so there is nothing to
 * filter for visibility here, only to shape for the UI.
 *
 * Two queries total for the whole experience: one for the full timeline
 * (landing page, and reused by the detail page to compute previous/next and
 * same-era relatives without a second round trip's worth of N+1 queries),
 * one for a single entry's own sources when its detail page is opened. That
 * is the whole query budget -- forty entries and eight eras is not a
 * dataset that benefits from pagination or a bespoke index; it benefits
 * from not being fetched one row at a time.
 */

export interface HeritageEra {
  id: string
  eraKey: string
  title: string
  codeScope: CodeScope
  startsYear: number
  endsYear: number | null
  summary: string
  sortOrder: number
}

export interface HeritageEntry {
  id: string
  entryKey: string
  eraId: string | null
  entryType: string
  codeScope: CodeScope
  title: string
  happenedYear: number
  happenedOn: string | null
  endsYear: number | null
  summary: string
  detail: string | null
  certainty: Certainty
  certaintyNote: string | null
  significance: number
  people: string[]
  places: string[]
  tags: string[]
}

export interface HeritageSource {
  id: string
  sourceTitle: string
  sourceUrl: string | null
  publisher: string | null
  sourceTier: string
  supports: string | null
  retrievedOn: string | null
}

export interface HeritageTimeline {
  eras: HeritageEra[]
  entries: HeritageEntry[]
}

function mapEra(row: Database["public"]["Tables"]["heritage_eras"]["Row"]): HeritageEra {
  return {
    id: row.id,
    eraKey: row.era_key,
    title: row.title,
    codeScope: row.code_scope as CodeScope,
    startsYear: row.starts_year,
    endsYear: row.ends_year,
    summary: row.summary,
    sortOrder: row.sort_order,
  }
}

function mapEntry(row: Database["public"]["Tables"]["heritage_entries"]["Row"]): HeritageEntry {
  return {
    id: row.id,
    entryKey: row.entry_key,
    eraId: row.era_id,
    entryType: row.entry_type,
    codeScope: row.code_scope as CodeScope,
    title: row.title,
    happenedYear: row.happened_year,
    happenedOn: row.happened_on,
    endsYear: row.ends_year,
    summary: row.summary,
    detail: row.detail,
    certainty: row.certainty as Certainty,
    certaintyNote: row.certainty_note,
    significance: row.significance,
    people: row.people ?? [],
    places: row.places ?? [],
    tags: row.tags ?? [],
  }
}

/** The whole timeline, eras and entries together, in canonical order. One query each, never one per era. */
export async function getHeritageTimeline(supabase: SupabaseClient<Database>): Promise<HeritageTimeline> {
  const [erasResult, entriesResult] = await Promise.all([
    supabase.from("heritage_eras").select("*").order("sort_order", { ascending: true }),
    supabase.from("heritage_entries").select("*").order("happened_year", { ascending: true }),
  ])
  const eras = (erasResult.data ?? []).map(mapEra)
  const entries = (entriesResult.data ?? []).map(mapEntry)
  return { eras, entries }
}

/** A single entry's sources. Called only when a detail page actually opens -- never prefetched for all 40 on the landing page. */
export async function getHeritageEntrySources(supabase: SupabaseClient<Database>, entryId: string): Promise<HeritageSource[]> {
  const { data } = await supabase
    .from("heritage_entry_sources")
    .select("*")
    .eq("entry_id", entryId)
    .order("source_tier", { ascending: true })
  return (data ?? []).map((row) => ({
    id: row.id,
    sourceTitle: row.source_title,
    sourceUrl: row.source_url,
    publisher: row.publisher,
    sourceTier: row.source_tier,
    supports: row.supports,
    retrievedOn: row.retrieved_on,
  }))
}

/** Strict chronological neighbours within the given entry list (respects whatever code filter the caller already applied), tie-broken by significance so same-year entries have a stable order. */
export function findAdjacentEntries(entries: HeritageEntry[], entryKey: string): { previous: HeritageEntry | null; next: HeritageEntry | null } {
  const sorted = [...entries].sort((a, b) => a.happenedYear - b.happenedYear || b.significance - a.significance || a.entryKey.localeCompare(b.entryKey))
  const index = sorted.findIndex((e) => e.entryKey === entryKey)
  if (index === -1) return { previous: null, next: null }
  return { previous: sorted[index - 1] ?? null, next: sorted[index + 1] ?? null }
}

/** Same-era relatives, excluding the entry itself -- a real structural relationship already present via era_id, not an invented one. */
export function findEraRelatives(entries: HeritageEntry[], entry: HeritageEntry, limit = 4): HeritageEntry[] {
  if (!entry.eraId) return []
  return entries
    .filter((e) => e.eraId === entry.eraId && e.entryKey !== entry.entryKey)
    .sort((a, b) => b.significance - a.significance || a.happenedYear - b.happenedYear)
    .slice(0, limit)
}
