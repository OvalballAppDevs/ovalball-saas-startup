import type { SupabaseClient } from "@supabase/supabase-js"

import { loadAgenda, type AgendaItem } from "../agenda/load"
import { resolveClubLogoUrl } from "../club-logo"
import { readClubTeams, type ClubTeam } from "../club/teams"
import { noClubAuthority, readClubAuthority } from "../club/overview"
import { resolveTeamCover, type TeamCover } from "../team-cover"
import { teamAgendaWindows } from "./overview"
import type { Database } from "../database"
import { noTeamAuthority, readTeamAuthority, type TeamAuthority } from "./authority"

type Client = SupabaseClient<Database>

export interface TeamProfileIdentity extends ClubTeam {
  clubId: string
  clubName: string
  /** The Club Directory row this club is presented under -- `/clubhouse/club/[directoryId]`, the one
   * canonical cross-club Club Profile route every viewer (including this team's own club) already uses. */
  clubDirectoryId: string
  crestUrl: string | null
  cover: TeamCover
  /** "About This Team", canonical (`teams.description`) -- null where nobody has written one, never invented. */
  description: string | null
}

/**
 * IDENTITY IS PUBLIC, EVERYTHING ELSE IS NOT. Name, age-grade, category, crest and cover photo are
 * exactly the fields Clubhouse already shows a stranger from another club through `readClubTeams` --
 * this loads the same list (so the label is derived once, not a second time here) and finds the one
 * row, rather than re-deriving `compactTeamLabel`/`fullTeamLabel` a second way. Throws if the team or
 * its club cannot be found; a caller with an invalid teamId has a routing bug, not a privacy question.
 */
export async function loadTeamProfileIdentity(supabase: Client, teamId: string): Promise<TeamProfileIdentity> {
  const { data: row, error } = await supabase.from("teams").select("club_id, cover_image_path, description").eq("id", teamId).maybeSingle()
  if (error) throw error
  if (!row) throw new Error("This team could not be found.")
  const clubId = row.club_id

  const [directory, { data: club }] = await Promise.all([
    readClubTeams(supabase, clubId),
    supabase.from("clubs").select("directory_id, logo_storage_path, club_directory(name, logo_storage_path)").eq("id", clubId).maybeSingle(),
  ])
  const team = [...directory.teams, ...directory.folded].find((t) => t.id === teamId)
  if (!team) throw new Error("This team could not be found.")

  const clubName = club?.club_directory?.name ?? "Ovalball"
  const crestUrl = resolveClubLogoUrl(supabase, club ?? null)
  const cover = resolveTeamCover({ supabase, coverImagePath: row.cover_image_path, crestUrl })

  return { ...team, clubId, clubName, clubDirectoryId: club?.directory_id ?? "", crestUrl, cover, description: row.description }
}

/**
 * THE ONE GOVERNED WRITE for "About This Team" -- never a direct client `.update()` on `teams`, even
 * though its own RLS would permit one for the right holder. `set_team_description` (SECURITY DEFINER)
 * re-checks `team.team.manage` / `club.profile.edit` / the site fallback server-side, trims the text,
 * and stores canonical NULL for a whitespace-only value rather than an indistinguishable empty string
 * -- the same shape `identity.description` already expects. Throws on refusal; the caller's own
 * authority-gated UI is a convenience, never the real gate.
 */
export async function setTeamDescription(supabase: Client, teamId: string, description: string): Promise<void> {
  const { error } = await supabase.rpc("set_team_description", { p_team_id: teamId, p_description: description })
  if (error) throw error
}

/**
 * A TEAM PROFILE MAY BE OPENED BY ANYONE WITH A LINK TO IT -- a Club Admin on their own side, a
 * parent scanning their own club's Teams tab, another club's Fixture Secretary browsing Clubhouse
 * before proposing a fixture. `team.team.view` is decided for THAT VIEWER by the same capability
 * engine every mutation re-runs (`readTeamAuthority`), and it is asked before a single count query
 * runs -- never inferred afterwards from what a query happened to return.
 *
 * THIS IS A COUNT, NEVER A ROW READ -- `player_team_memberships`/`team_permissions` RLS is built to
 * protect full identifying rows (`team.roster.view`, or being the player/guardian themselves), a
 * strictly narrower question than "may this person know roughly how big the squad is"
 * (`team.team.view`). A viewer can hold `team.team.view` for a team without holding `team.roster.view`
 * for it -- a guardian whose own child plays there is exactly this combination -- and a client-side
 * `.count()` in that case does not fail closed to zero, it fails to whatever partial slice of rows RLS
 * happens to let through (their own child's row alone), which is a fabricated ONE: a plausible, wrong
 * number that looks like real data. `team_people_counts` (RPC, SECURITY DEFINER) asks the SAME
 * `team.team.view` question server-side against the caller's own session -- never a client-supplied
 * boolean -- and only then returns a true aggregate; it returns null on both fields, never zero or a
 * partial number, where that capability is not held.
 *
 * TWO SEPARATE GATES, NOT ONE. `team.team.view` ("see the club's teams and their details") unlocks
 * the aggregate numbers -- enough to say a side exists and roughly how big it is, never who is on it.
 * `team.roster.view` ("see the players and people on a team") is what a Squad tab needs before it may
 * point at the existing, already-authority-correct roster screen (`team/people`) for names. A viewer
 * who holds neither sees neither: identity (name, age-grade, crest, cover) is the only thing this
 * module ever returns unconditionally, because that much is already public through Clubhouse's own
 * cross-club team browsing (`readClubTeams`).
 */
export interface TeamProfilePeople {
  /** Aggregate counts, gated on `authority.view`. Null (not zero) where the viewer may not be told. */
  counts: { players: number; staff: number } | null
  /** Whether the Squad tab may deep-link to full roster identities, gated on `authority.rosterView`. */
  rosterVisible: boolean
}

/** The season a fixture/win summary is scoped to -- the canonical register, never a computed cutoff. */
export interface TeamProfileSeason {
  id: string
  /** "2026/27" -- built from the register's own year bounds, never a free-text label. */
  label: string
  startsOn: string
  endsOn: string
}

/** Fixtures and wins for the current season -- public, the same sporting facts Clubhouse already shows
 * cross-club through fixtures/results, never gated behind roster authority. Null only where there is no
 * current season on record for this team's rugby code (a real gap between seasons, not "unauthorised"). */
export interface TeamProfileFixtureSummary {
  fixtures: number
  wins: number
}

export interface TeamProfile {
  teamId: string
  authority: TeamAuthority
  nextUp: AgendaItem | null
  upcoming: AgendaItem[]
  people: TeamProfilePeople
  season: TeamProfileSeason | null
  seasonSummary: TeamProfileFixtureSummary | null
  /**
   * WHETHER THIS VIEWER MAY CHANGE THE TEAM'S COVER PHOTO (Section 7 foundation) -- Club authority
   * (`club.profile.edit`, the same key that already gates the club's own cover) OR Team authority
   * (`team.team.manage`, the same key the existing "Manage Team" link already gates on). Never inferred
   * from fixture editing, result recording, pitch allocation or roster viewing, which are independent
   * capabilities. No new capability was created: both keys already exist and already mean "may change
   * this identity's own presentation fields". The Overview screen does not yet act on this -- there is
   * no cover editor to send it to until Section 6 -- but the signal is real and tested now so that
   * screen can attach to it without a second authority read.
   */
  canEditCover: boolean
}

const isOn = (item: AgendaItem) => item.status !== "Cancelled"
const won = (item: AgendaItem) => item.result !== null && item.result.ourScore > item.result.theirScore

/**
 * The Team Profile read -- identity is the caller's own (already resolved before this is called, from
 * `teams`/`club-logo`/`team-cover`, the same public data Clubhouse already shows cross-club); this
 * supplies only the parts that depend on WHO is asking.
 */
export async function loadTeamProfile(supabase: Client, clubId: string, teamId: string, rugbyCode: string, todayIso: string = new Date().toISOString().slice(0, 10)): Promise<TeamProfile> {
  const scope = { kind: "teams" as const, teamIds: [teamId], clubId }

  const [authority, clubAuthority, { data: seasonRow }] = await Promise.all([
    readTeamAuthority(supabase, clubId, teamId).catch(() => noTeamAuthority()),
    readClubAuthority(supabase, clubId).catch(() => noClubAuthority()),
    supabase.from("seasons").select("id, starts_on, ends_on, season_year_start, season_year_end").eq("rugby_code", rugbyCode).lte("starts_on", todayIso).gte("ends_on", todayIso).maybeSingle(),
  ])

  // ONE FETCH SERVES BOTH THE UPCOMING LIST AND THE SEASON SUMMARY where a current season is on
  // record -- today always falls inside it by construction, so filtering locally avoids a second
  // network round trip for the same underlying fixtures (Section 13: no serial waterfall). Where no
  // current season exists (a genuine gap between seasons), this falls back to the same rolling
  // upcoming-only window the screen used before season-scoping existed, and the summary is honestly
  // absent rather than guessed from an arbitrary range.
  const window = seasonRow ? { startIso: seasonRow.starts_on, endIso: seasonRow.ends_on, order: "asc" as const, label: "this season" } : teamAgendaWindows(todayIso).upcoming
  const agenda = await loadAgenda(supabase, scope, window, { includeTraining: true })
  const upcoming = seasonRow ? agenda.items.filter((i) => i.date >= todayIso) : agenda.items
  const nextUp = upcoming.find(isOn) ?? null

  let counts: TeamProfilePeople["counts"] = null
  if (authority.view) {
    const { data } = await supabase.rpc("team_people_counts", { p_team_id: teamId }).maybeSingle()
    if (data && data.players !== null && data.staff !== null) {
      counts = { players: data.players, staff: data.staff }
    }
  }

  const season: TeamProfileSeason | null = seasonRow
    ? { id: seasonRow.id, label: `${seasonRow.season_year_start}/${String(seasonRow.season_year_end).slice(-2)}`, startsOn: seasonRow.starts_on, endsOn: seasonRow.ends_on }
    : null
  const seasonFixtures = seasonRow ? agenda.items.filter((i) => i.kind === "fixture" && isOn(i)) : []
  const seasonSummary: TeamProfileFixtureSummary | null = seasonRow ? { fixtures: seasonFixtures.length, wins: seasonFixtures.filter(won).length } : null

  return {
    teamId,
    authority,
    nextUp,
    upcoming,
    people: { counts, rosterVisible: authority.rosterView },
    season,
    seasonSummary,
    canEditCover: authority.teamManage || clubAuthority.profileEdit,
  }
}
