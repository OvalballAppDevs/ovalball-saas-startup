"use server"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { createClient } from "@/lib/supabase/server"

export interface ClubSearchResult {
  clubId: string
  name: string
  slug: string
  status: string
  town: string | null
  county: string | null
  rugbyCode: string
  /** Operational teams this club actually runs. Distinguishes same-named clubs. */
  teamCount: number
}

/**
 * Club search for Lookup Administration.
 *
 * SOURCE MATTERS (and is deliberate). This page administers venues and
 * pitches, which only an ACTIVATED club can own, so it searches
 * `club_directory` joined `clubs!inner` -- recognised clubs that are
 * actually on Ovalball. The full directory, which includes every
 * recognised-but-unclaimed rugby club, would offer clubs with no `clubs`
 * row and therefore nothing to administer. The two sources are never
 * silently mixed: a field that means "any recognised club" would query
 * club_directory alone, and would say so.
 *
 * Authorization is re-derived here, not inherited from the page: a server
 * action is a public endpoint, and the page's guard does not protect it.
 */
export async function searchAdminClubs(query: string): Promise<ClubSearchResult[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok) return []

  // `_` and `%` are wildcards in LIKE; a club legitimately named "St_" must
  // search for that text, not for "St" plus any character.
  const escaped = trimmed.replace(/[%_\\]/g, (c) => `\\${c}`)

  const { data, error } = await supabase
    .from("club_directory")
    .select("name, town, county, rugby_code, clubs!inner(id, slug, status)")
    .ilike("name", `%${escaped}%`)
    .order("name")
    .limit(15)

  if (error || !data) return []

  const rows = data.filter((r) => r.clubs)
  const ids = rows.map((r) => r.clubs!.id)

  // One batched count, never a query per row.
  const teamCounts = new Map<string, number>()
  if (ids.length > 0) {
    const { data: teams } = await supabase
      .from("teams")
      .select("club_id")
      .in("club_id", ids)
      .eq("active", true)
      .is("folded_at", null)
    for (const t of teams ?? []) {
      teamCounts.set(t.club_id, (teamCounts.get(t.club_id) ?? 0) + 1)
    }
  }

  return rows.map((r) => ({
    clubId: r.clubs!.id,
    name: r.name,
    slug: r.clubs!.slug,
    status: r.clubs!.status,
    town: r.town,
    county: r.county,
    rugbyCode: r.rugby_code,
    teamCount: teamCounts.get(r.clubs!.id) ?? 0,
  }))
}
