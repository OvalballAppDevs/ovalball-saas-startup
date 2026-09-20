import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

/**
 * THE OPPOSITION CLUB CATALOGUE, IN ONE RUGBY CODE ONLY.
 *
 * The Season Planner, the fixture editor and the Competition Creator all
 * offer "which club?" from this one read. It is loaded once per surface and
 * filtered in the browser (lib/fixtures/planner-lookup.ts), never searched
 * per keystroke.
 *
 * Union and League are strictly isolated: the scope is in the query, so a
 * Union club is never offered a League opponent, not even as an option it
 * could pick by mistake.
 *
 * NOTHING HERE CREATES ANYTHING. A club typed into a search box never becomes
 * a club; it matches the Club Directory or it stays text.
 */

export interface ClubCatalogueEntry {
  /** Club Directory id -- the identity every surface resolves against. */
  id: string
  name: string
  /** Set for an Ovalball club: the tenant id, used to list their real teams. Such a club is ASKED, not booked. */
  tenantClubId: string | null
  /** Their recorded home ground, offered first on an away fixture. */
  homeGround: string | null
  /** An Ovalball club's pitch at that ground, when the ground has exactly one. */
  homePitch: string | null
}

const PAGE = 1000

export async function loadClubCatalogue(
  supabase: SupabaseClient<Database>,
  rugbyCode: string,
  options: { excludeClubId?: string | null } = {},
): Promise<ClubCatalogueEntry[]> {
  const directory: { id: string; name: string; home_ground: string | null }[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("club_directory")
      .select("id, name, home_ground")
      .eq("rugby_code", rugbyCode)
      .order("name")
      .order("id")
      .range(from, from + PAGE - 1)
    if (error) {
      console.error("loadClubCatalogue failed:", error)
      return []
    }
    directory.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }

  let tenantQuery = supabase.from("clubs").select("id, directory_id").eq("status", "active").not("directory_id", "is", null)
  if (options.excludeClubId) tenantQuery = tenantQuery.neq("id", options.excludeClubId)
  const { data: tenants } = await tenantQuery
  const tenantByDirectory = new Map((tenants ?? []).map((t) => [t.directory_id as string, t.id]))

  // An Ovalball club's primary ground is its own default venue record; the
  // Club Directory's recorded ground is the answer for everyone else.
  //
  // READ THROUGH THE PUBLIC PROJECTION, NOT THROUGH `venues`.
  //
  // This used to select from `public.venues` (joining `club_pitches`) with the
  // caller's own client. `venues_select` answers `venue.venue.view` AT THAT
  // CLUB, so a fixture secretary arranging a match at another club could not
  // read that club's venue rows -- and RLS does not refuse, it returns nothing.
  // The ground still appeared, because the code fell through to the Club
  // Directory's free-text `home_ground`; the pitch silently never did, and the
  // "their only pitch" branch of defaultVenue() was dead in practice.
  //
  // `public_venues` is the projection that exists for precisely this: what a
  // visiting club is told about where to turn up. It carries the two facts the
  // rule needs and no more.
  const defaultGround = new Map<string, string>()
  const onlyPitch = new Map<string, string>()
  const tenantIds = [...tenantByDirectory.values()]
  for (let i = 0; i < tenantIds.length; i += 200) {
    const { data: grounds } = await supabase
      .from("public_venues")
      .select("id, club_id, name, only_pitch_name")
      .in("club_id", tenantIds.slice(i, i + 200))
      .eq("is_default_home", true)
    for (const g of grounds ?? []) {
      if (!g.club_id || !g.name) continue
      defaultGround.set(g.club_id, g.name)
      if (g.only_pitch_name) onlyPitch.set(g.club_id, g.only_pitch_name)
    }
  }

  // Ovalball clubs rank first because choosing one produces a better fixture
  // -- a real two-sided arrangement rather than a one-sided note. Within each
  // kind the canonical alphabetical order is kept.
  const entries = directory.map((d) => {
    const tenantClubId = tenantByDirectory.get(d.id) ?? null
    return {
      id: d.id,
      name: d.name,
      tenantClubId,
      homeGround: (tenantClubId ? defaultGround.get(tenantClubId) : undefined) ?? d.home_ground,
      homePitch: tenantClubId ? (onlyPitch.get(tenantClubId) ?? null) : null,
    }
  })
  return [...entries.filter((o) => o.tenantClubId), ...entries.filter((o) => !o.tenantClubId)]
}
