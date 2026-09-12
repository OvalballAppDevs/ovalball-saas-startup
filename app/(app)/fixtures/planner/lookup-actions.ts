"use server"

import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"
import { fullTeamLabel } from "@/lib/teams/compact-label"

/**
 * THE PLANNER'S LOOKUPS.
 *
 * A spreadsheet column of free text is a column of future problems. Every
 * structured field here -- our team, the opponent, their team, the
 * competition, the venue, the pitch -- has a canonical record behind it,
 * and the planner's job is to help somebody land on that record rather
 * than to accept a string that merely looks like one.
 *
 * NOTHING HERE CREATES ANYTHING. These are reads. A club typed into the
 * Opposition cell never becomes a club; it either matches the Club
 * Directory or it is a row that needs review. The same rule the import
 * engine has always enforced, now visible while the person is typing
 * instead of only after they submit.
 *
 * Every function re-resolves authority for itself. A search is a read of
 * canonical data, so the bar is the one the planner page already sets --
 * you may plan fixtures for this club -- and RLS decides the rest.
 */

export interface ClubOption {
  id: string
  name: string
  /** "ovalball" means a tenant club whose teams we can offer and who gets ASKED, not booked. */
  kind: "ovalball" | "directory"
  /** Set for an Ovalball club: the tenant id, used to list their real teams. */
  tenantClubId: string | null
}

export interface NamedOption {
  id: string
  label: string
  hint?: string
}

async function plannerClub(requestedClubId?: string): Promise<string | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const clubId = activeManageableClubId(ctx, activeContext) ?? requestedClubId ?? null
  if (!clubId) return null
  if (!(await hasCapability(supabase, "fixture.create", "club", { clubId }))) return null
  return clubId
}

/**
 * OPPONENTS, WITH THEIR PROVENANCE SHOWN.
 *
 * Two sources in one list because a fixture secretary thinks of one thing
 * -- "who are we playing" -- and should not have to know whether that club
 * happens to be an Ovalball customer. But the two are NOT interchangeable
 * and the list says so: an Ovalball club gets asked and can accept or
 * decline; a directory club is simply recorded. Hiding that difference
 * until after creation would be hiding the thing that changes what happens
 * next.
 *
 * Ovalball clubs rank first because choosing one produces a better fixture
 * -- a real two-sided arrangement rather than a one-sided note.
 */
export async function searchOppositionClubs(query: string, clubId?: string): Promise<ClubOption[]> {
  const scope = await plannerClub(clubId)
  if (!scope) return []
  const term = query.trim()
  if (term.length < 2) return []

  const supabase = await createClient()
  const escaped = term.replace(/[%_]/g, (c) => `\\${c}`)

  const [{ data: tenantRows }, { data: directoryRows }] = await Promise.all([
    supabase
      .from("clubs")
      .select("id, directory_id, club_directory!inner(id, name)")
      .eq("status", "active")
      .ilike("club_directory.name", `%${escaped}%`)
      .neq("id", scope)
      .limit(8),
    supabase.from("club_directory").select("id, name").ilike("name", `%${escaped}%`).order("name").limit(20),
  ])

  const tenantByDirectoryId = new Map(
    (tenantRows ?? []).map((c) => [c.directory_id, { tenantClubId: c.id, name: c.club_directory?.name ?? "" }]),
  )

  const options: ClubOption[] = []
  for (const [directoryId, tenant] of tenantByDirectoryId) {
    if (!directoryId) continue
    options.push({ id: directoryId, name: tenant.name, kind: "ovalball", tenantClubId: tenant.tenantClubId })
  }
  for (const d of directoryRows ?? []) {
    if (tenantByDirectoryId.has(d.id)) continue
    options.push({ id: d.id, name: d.name, kind: "directory", tenantClubId: null })
  }

  return options.slice(0, 20)
}

/**
 * The opponent's own teams -- real ones, or none.
 *
 * Offered only for an Ovalball opponent, because only an Ovalball club has
 * canonical teams. For a directory club there is genuinely nothing to
 * choose from, and inventing a dropdown of guesses would be worse than the
 * honest empty answer the cell gives instead.
 */
export async function listOppositionTeams(tenantClubId: string, clubId?: string): Promise<NamedOption[]> {
  if (!(await plannerClub(clubId))) return []
  const supabase = await createClient()
  const { data } = await supabase
    .from("teams")
    .select("id, rugby_code, category, age_group, gender, squad_designation")
    .eq("club_id", tenantClubId)
    .eq("active", true)
    .order("category")
    .order("age_group")
    .limit(100)
  return (data ?? []).map((t) => ({
    id: t.id,
    label: fullTeamLabel({
      category: t.category,
      ageGroup: t.age_group,
      gender: t.gender,
      squadDesignation: t.squad_designation,
      rugbyCode: t.rugby_code,
    }),
  }))
}

/**
 * VENUES, RANKED BY WHERE THE MATCH IS ACTUALLY BEING PLAYED.
 *
 * A home fixture is at one of our grounds; an away fixture is at theirs.
 * Offering the same alphabetical list for both makes the person do the
 * filtering the software already has the facts to do. The ranking is a
 * suggestion, never a restriction -- a cup tie at a neutral ground is an
 * ordinary thing and the full list stays reachable by typing.
 */
export async function searchVenues(
  query: string,
  homeAway: string,
  opponentDirectoryId: string | null,
  clubId?: string,
): Promise<NamedOption[]> {
  const scope = await plannerClub(clubId)
  if (!scope) return []
  const supabase = await createClient()
  const term = query.trim().replace(/[%_]/g, (c) => `\\${c}`)

  let ours = supabase.from("venues").select("id, name").eq("club_id", scope).eq("active", true).order("name").limit(25)
  if (term) ours = ours.ilike("name", `%${term}%`)

  // The opponent's own ground, when we know who they are and they have one
  // recorded. This is the single most useful suggestion on an away row.
  const theirsQuery = opponentDirectoryId
    ? supabase
        .from("club_directory")
        .select("id, name, home_ground")
        .eq("id", opponentDirectoryId)
        .maybeSingle()
    : Promise.resolve({ data: null as { id: string; name: string; home_ground: string | null } | null })

  const [{ data: ourRows }, { data: theirRow }] = await Promise.all([ours, theirsQuery])

  const ourOptions: NamedOption[] = (ourRows ?? []).map((v) => ({ id: v.id, label: v.name, hint: "Our ground" }))
  const theirOption: NamedOption[] =
    theirRow && theirRow.home_ground
      ? [{ id: `directory:${theirRow.id}`, label: theirRow.home_ground, hint: `${theirRow.name} — their ground` }]
      : []

  const away = homeAway.trim().toLowerCase().startsWith("a")
  const ranked = away ? [...theirOption, ...ourOptions] : [...ourOptions, ...theirOption]
  return term ? ranked.filter((o) => o.label.toLowerCase().includes(term.toLowerCase())) : ranked
}

/**
 * Pitches belong to a venue, so the list follows the venue.
 *
 * Showing every pitch the club owns regardless of where the match is being
 * played is how somebody ends up allocating Pitch 2 at a ground three
 * towns away.
 */
export async function listPitches(venueId: string | null, clubId?: string): Promise<NamedOption[]> {
  const scope = await plannerClub(clubId)
  if (!scope) return []
  const supabase = await createClient()
  let q = supabase
    .from("club_pitches")
    .select("id, display_name, venue_id")
    .eq("club_id", scope)
    .eq("active", true)
    .order("sort_order")
    .limit(60)
  if (venueId && !venueId.startsWith("directory:")) q = q.eq("venue_id", venueId)
  const { data } = await q
  return (data ?? []).map((p) => ({ id: p.id, label: p.display_name }))
}
