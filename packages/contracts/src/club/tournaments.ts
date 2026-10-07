import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { loadScheduleGrounds, type ScheduleGround } from "../agenda/grounds"

/**
 * TOURNAMENTS -- the canonical read/write contract, shared by web and mobile.
 *
 * A tournament is ONE occasion the club hosts or attends. Underneath it sit the AGE GROUPS it runs,
 * and underneath those the participating teams. That hierarchy is deliberate and must not be
 * flattened: a club fielding U11 A, B and C is one tournament with three teams in one age group,
 * never three tournaments.
 *
 *   tournaments                 the occasion -- name, format, dates, venue
 *     tournament_age_groups     which grades it runs (the organiser's decision)
 *       tournament_participants every side, the host's own included -- other Ovalball clubs, and
 *                               clubs that are not on Ovalball at all (one canonical side, 20270605)
 *       tournament_team_entries a VIEW of the host club's own participant rows, never counted again
 *
 * Which age group a team belongs to is NOT stored again here: it comes from the team's own
 * `age_group`, which is already canonical. Storing it twice would create a second truth about what a
 * U9 team is.
 */

type Client = SupabaseClient<Database>

/**
 * THE FIVE COMPETITION SHAPES.
 *
 * `league` was renamed to `round_robin` in migration 20270599: its own description was "all teams play
 * in a group format", which is round robin said differently, and two values meaning one shape left an
 * organiser guessing. `tri_fixture` and `swiss` are genuinely new shapes rather than new words.
 */
export type TournamentFormat = "round_robin" | "tri_fixture" | "swiss" | "knockout" | "hybrid"

/** How the club relates to this occasion. Presented to a person as Hosting / Attending / Past, which
 * is the language a tournament actually uses -- "home" and "away" describe a single fixture between
 * two sides and mean nothing for a festival of fourteen teams. */
export type TournamentRelationship = "hosting" | "attending" | "past"

/** Whether the network can find this tournament. `private` is the default everywhere: a tournament is
 * never made discoverable by omission. */
export type TournamentVisibility = "public" | "private"

export interface TournamentListItem {
  id: string
  name: string
  /** ISO date the tournament starts. */
  startsOn: string
  /** ISO date it ends, when it runs over more than one day. Null for a single-day tournament. */
  endsOn: string | null
  format: TournamentFormat
  visibility: TournamentVisibility
  relationship: TournamentRelationship
  /** Whether the club looking at the list runs it. A club runs its own tournaments from the organiser's
   * screen and goes to everybody else's through the Tournament Centre -- a past one included. */
  hostedByThisClub: boolean
  venueName: string | null
  /** The grades this tournament runs, in age order -- "U9", "U10", "U11". */
  ageGroups: string[]
  /** Every participating side: our own entered teams plus every other club's. */
  teamCount: number
  /** The tournament's own photograph, as the two canonical columns. Resolved by
   * `resolveTournamentCover` and turned into something renderable by the client, exactly as the
   * detail hero does -- the list and the hero share one selection, never two. */
  coverImagePath: string | null
  coverStockKey: string | null
  status: string
  cancelledAt: string | null
}

export interface TournamentCapabilities {
  view: boolean
  manage: boolean
  /** False when the server could not be asked. "Not allowed" and "did not answer" are different facts,
   * and a screen that sends a person elsewhere on "not allowed" must never act on silence. */
  answered?: boolean
}

/** THE CANONICAL AGE GRADES -- re-exported, never redefined.
 *
 * `teams/age-groups.ts` mirrors the real `teams_age_group_check` constraint, and that file exists
 * precisely because two silently different hardcoded copies once drifted apart on the web. An earlier
 * draft of this module invented its own list (U7…U16+), which was wrong twice over: it dropped U6,
 * U17, U18 and U19, and "U16+" is not a grade any team can actually hold. */
export { YOUTH_AGE_GROUPS as TOURNAMENT_AGE_GROUPS, type YouthAgeGroup } from "../teams/age-groups"

/** Sorts age grades numerically rather than as text, so U9 comes before U10 instead of after it. */
export function compareAgeGroups(a: string, b: string): number {
  const n = (s: string) => {
    const m = s.match(/\d+/)
    return m ? Number(m[0]) : 999
  }
  const d = n(a) - n(b)
  return d !== 0 ? d : a.localeCompare(b)
}

/** Which bucket a tournament falls into for the Home filters. A tournament whose last day has passed
 * is Past whoever ran it -- that is what a person means by the word, and it takes precedence over
 * hosting/attending. */
export function relationshipFor(hostClubId: string | null, viewerClubId: string | null, startsOn: string, endsOn: string | null, today: string): TournamentRelationship {
  const lastDay = endsOn ?? startsOn
  if (lastDay < today) return "past"
  return hostClubId && viewerClubId && hostClubId === viewerClubId ? "hosting" : "attending"
}

export function tournamentDateLine(startsOn: string, endsOn: string | null): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
  if (!endsOn || endsOn === startsOn) return fmt(startsOn)
  return `${fmt(startsOn)} – ${fmt(endsOn)}`
}

export function teamCountLabel(n: number): string {
  return `${n} ${n === 1 ? "team" : "teams"}`
}

export const TOURNAMENT_FORMAT_LABELS: Record<TournamentFormat, { label: string; blurb: string }> = {
  round_robin: { label: "Round Robin", blurb: "All teams play each other" },
  tri_fixture: { label: "Tri-Fixture", blurb: "Exactly three teams" },
  swiss: { label: "Swiss System", blurb: "A set number of rounds" },
  knockout: { label: "Knockout", blurb: "Single elimination" },
  hybrid: { label: "Hybrid", blurb: "Groups then knockout" },
}

/** The one shape whose name does not finish the sentence: a Swiss competition is defined by how many
 * rounds it runs, so the round count travels with the format everywhere it is shown or saved. */
export const SWISS_DEFAULT_ROUNDS = 4
export const SWISS_ROUND_RANGE = { min: 2, max: 12 } as const

/** "Round Robin", or "Swiss System · 5 rounds" -- the shape, finished. */
export function formatLabel(format: TournamentFormat, swissRounds?: number | null): string {
  const base = TOURNAMENT_FORMAT_LABELS[format]?.label ?? format
  return format === "swiss" && swissRounds ? `${base} · ${swissRounds} rounds` : base
}

/** Every tournament this club can see -- the ones it hosts and the ones it has been entered into.
 * Read through RLS; nothing here widens what the server would already return. */
export async function readClubTournaments(supabase: Client, clubId: string, today: string): Promise<TournamentListItem[]> {
  const { data, error } = await supabase
    .from("tournaments")
    .select("id, name, event_date, ends_on, format, visibility, status, cancelled_at, host_club_id, venue_id, cover_image_path, cover_stock_key, venues(name), tournament_age_groups(age_group), tournament_team_entries(id), tournament_participants(id)")
    .order("event_date", { ascending: false })
  if (error) throw error

  // A tournament this club was entered into is at another club's ground, whose venue row the embed cannot
  // read; the schedule's one ground rule names it for anybody who can see the tournament.
  const unnamed = (data ?? []).filter((row) => {
    const v = (row as { venues?: unknown }).venues
    return (row as { venue_id: string | null }).venue_id && !(Array.isArray(v) ? v[0] : v)
  })
  const grounds = unnamed.length ? await loadScheduleGrounds(supabase, { tournamentIds: unnamed.map((row) => row.id) }) : new Map<string, ScheduleGround>()

  return (data ?? []).map((row) => {
    const r = row as unknown as {
      id: string; name: string | null; event_date: string; ends_on: string | null; format: string | null
      visibility: string | null; status: string; cancelled_at: string | null; host_club_id: string | null
      cover_image_path: string | null; cover_stock_key: string | null
      venues: { name: string | null } | { name: string | null }[] | null
      tournament_age_groups: { age_group: string }[] | null
      tournament_team_entries: { id: string }[] | null
      tournament_participants: { id: string }[] | null
    }
    const venue = Array.isArray(r.venues) ? r.venues[0] : r.venues
    return {
      id: r.id,
      name: r.name ?? "Tournament",
      startsOn: r.event_date,
      endsOn: r.ends_on,
      format: (r.format ?? "round_robin") as TournamentFormat,
      visibility: (r.visibility ?? "private") as TournamentVisibility,
      relationship: relationshipFor(r.host_club_id, clubId, r.event_date, r.ends_on, today),
      hostedByThisClub: r.host_club_id === clubId,
      venueName: venue?.name ?? grounds.get(r.id)?.name ?? null,
      ageGroups: (r.tournament_age_groups ?? []).map((a) => a.age_group).sort(compareAgeGroups),
      // EVERY SIDE IN THE TOURNAMENT, ONCE -- what a person means by "8 teams". The host's own sides
      // are participant rows like everybody else's (one canonical tournament side, 20270605);
      // tournament_team_entries is a view over those same rows, so adding the two counted them twice.
      teamCount: (r.tournament_participants ?? []).length,
      coverImagePath: r.cover_image_path ?? null,
      coverStockKey: r.cover_stock_key ?? null,
      status: r.status,
      cancelledAt: r.cancelled_at,
    }
  })
}

/** The same `my_capabilities` the venue contract uses -- the server decides what this person may do,
 * and the UI only reflects it. Hiding a button is never the boundary: every write RPC re-checks. */
export async function readTournamentCapabilities(supabase: Client, clubId: string): Promise<TournamentCapabilities> {
  const { data, error } = await supabase.rpc("my_capabilities", { p_scope_type: "club", p_club_id: clubId })
  if (error) return { view: false, manage: false, answered: false }
  const allowed = new Set((data ?? []).filter((r) => r.allowed === true).map((r) => r.capability_key))
  return { view: allowed.has("tournament.tournament.view"), manage: allowed.has("tournament.tournament.manage"), answered: true }
}

/** The filter buckets on Tournaments Home, in the order the design shows them. */
export type TournamentFilter = "all" | "hosting" | "attending" | "past"

/** What the filter sheet holds. Empty arrays mean "no opinion", which is not the same as "none
 * selected" -- a person who has not touched a group should see everything in it. */
export interface TournamentFilters {
  relationships: TournamentRelationship[]
  visibilities: TournamentVisibility[]
  formats: TournamentFormat[]
  ageGroups: string[]
}

export const EMPTY_TOURNAMENT_FILTERS: TournamentFilters = { relationships: [], visibilities: [], formats: [], ageGroups: [] }

export function activeFilterCount(f: TournamentFilters): number {
  return f.relationships.length + f.visibilities.length + f.formats.length + f.ageGroups.length
}

/** The segmented tab and the sheet's own filters are ANDed, and the text search is ANDed on top --
 * the three are different questions and a person expects all of them to apply at once. */
export function filterTournaments(items: TournamentListItem[], tab: TournamentFilter, query: string, filters: TournamentFilters = EMPTY_TOURNAMENT_FILTERS): TournamentListItem[] {
  const q = query.trim().toLowerCase()
  return items.filter((t) => {
    if (tab !== "all" && t.relationship !== tab) return false
    if (filters.relationships.length > 0 && !filters.relationships.includes(t.relationship)) return false
    if (filters.visibilities.length > 0 && !filters.visibilities.includes(t.visibility)) return false
    if (filters.formats.length > 0 && !filters.formats.includes(t.format)) return false
    if (filters.ageGroups.length > 0 && !t.ageGroups.some((a) => filters.ageGroups.includes(a))) return false
    if (!q) return true
    return (
      t.name.toLowerCase().includes(q) ||
      (t.venueName ?? "").toLowerCase().includes(q) ||
      t.ageGroups.some((a) => a.toLowerCase().includes(q))
    )
  })
}
