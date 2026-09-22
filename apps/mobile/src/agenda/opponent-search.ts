import type { SupabaseClient } from "@supabase/supabase-js"
import { clubLogoUrlFromPath, type Database } from "@ovalball/contracts"

/**
 * FINDING THE CLUB YOU ARE PLAYING, IN THE ONE PLACE CLUBS ARE LISTED.
 *
 * THE CLUB DIRECTORY IS THE CANONICAL CATALOGUE -- every rugby club in the country, whether or not it
 * has ever opened Ovalball. So Add Fixture searches THAT rather than offering a free-text box, and the
 * difference is what makes the next question answerable: a club picked from the Directory has an
 * identity, so the platform can say whether it is on Ovalball, and a club typed as text never can.
 *
 * SCOPED TO THE VIEWER'S OWN RUGBY CODE. A Rugby Union club is never shown Rugby League catalogue
 * data -- not as an option, not greyed out, not as a "not offered" note. Telling a union club that a
 * league side is unavailable is telling it about a sport it does not play, so the filter is in the
 * QUERY and the other code's clubs never reach the device.
 *
 * WHETHER THEY ARE ON OVALBALL IS A FACT ABOUT THE CLUB, not about the search: a `clubs` row exists
 * for a Directory entry that has been claimed. It decides what happens next -- a fixture against a club
 * on Ovalball is a REQUEST that side confirms, and one against a club that is not is simply recorded --
 * so it is resolved here and shown before anybody commits to a date.
 */

export interface DirectoryClub {
  directoryId: string
  name: string
  town: string | null
  county: string | null
  crestUrl: string | null
  /** True where a `clubs` row exists: the club has actually started using Ovalball. */
  onOvalball: boolean
  /** The operational club id, where there is one. Needed to ask which of their sides we may play. */
  clubId: string | null
}

const PAGE = 25

export async function searchDirectoryClubs(
  supabase: SupabaseClient<Database>,
  search: string,
  options: { rugbyCode: string | null; excludeClubId: string | null }
): Promise<DirectoryClub[]> {
  let query = supabase
    .from("club_directory")
    .select("id, name, town, county, logo_storage_path, clubs(id, status)")
    .eq("active", true)
    .order("name")
    .limit(PAGE)

  // THE CODE FILTER IS IN THE QUERY, never in the browser. Loading both catalogues and hiding one works
  // right up until somebody renders the unfiltered array.
  if (options.rugbyCode) query = query.eq("rugby_code", options.rugbyCode)

  const needle = search.trim()
  if (needle) query = query.ilike("name", `%${needle}%`)

  const { data } = await query
  return (data ?? [])
    .map((row) => {
      // A Directory entry can in principle be claimed more than once over its life; the ACTIVE club is
      // the one that can receive a fixture request. PostgREST types a one-to-many embed as either shape
      // depending on the relationship it infers, so both are handled rather than cast away.
      const claimed = row.clubs as { id: string; status: string }[] | { id: string; status: string } | null
      const candidates = Array.isArray(claimed) ? claimed : claimed ? [claimed] : []
      const club = candidates.find((c) => c.status === "active") ?? null
      return {
        directoryId: row.id,
        name: row.name,
        town: row.town,
        county: row.county,
        crestUrl: clubLogoUrlFromPath(supabase, row.logo_storage_path),
        onOvalball: Boolean(club),
        clubId: club?.id ?? null,
      }
    })
    // A fixture against ourselves is not a fixture.
    .filter((club) => !options.excludeClubId || club.clubId !== options.excludeClubId)
}

/** Our own team's rugby code, so the search never crosses into the other sport. */
export async function teamRugbyCode(supabase: SupabaseClient<Database>, teamId: string): Promise<string | null> {
  if (!teamId) return null
  const { data } = await supabase.from("teams").select("rugby_code").eq("id", teamId).maybeSingle()
  return data?.rugby_code ?? null
}
