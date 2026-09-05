"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { toPublicSubmissionError } from "@/lib/errors/public-error"
import { teamsCanPlayFixture } from "@/lib/fixtures/eligibility"
import { buildFixtureCsv } from "@/lib/fixtures/csv-export"
import { fullTeamLabel } from "@/lib/teams/compact-label"

import { requireSiteAdmin } from "../require-site-admin"
import { buildAdminFixtureQuery } from "./query"
import type { AdminFixtureQuery } from "./types"

export type ActionResult = { ok: true } | { ok: false; error: string }

/**
 * Section 25/14: several read-only lookups this file exposes (club/team
 * search, active-team rosters, pitches, a team's own age/gender/rugby_code)
 * were gated requireSiteAdmin even though the tables they read (teams,
 * club_pitches, club_directory) already grant broad authenticated read
 * access via their own RLS for exactly this data (teams_select: active=true
 * OR site admin OR club admin; club_pitches_select: true; club_directory_
 * select: active=true OR site admin) -- the action-level gate was simply a
 * stricter-than-necessary restriction, not the real security boundary, and
 * it blocked the Club Admin/Fixtures Secretary Fixture Management surface
 * (Section 14, sharing the SAME Add Fixture dialog as Site Admin) from ever
 * calling them. Widened to "any signed-in user" -- RLS on the underlying
 * tables remains the actual, unchanged enforcement.
 */
async function requireAuthenticated(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user ? { ok: true as const, user } : { ok: false as const, error: "You must be signed in." }
}

export interface TeamSearchResult {
  teamId: string
  teamName: string
  clubId: string
  clubName: string
  town: string | null
  rugbyCode: string
  category: string
  ageGroup: string | null
  teamNumber: number | null
  squadDesignation: string | null
  gender: string | null
}

/**
 * Home/away-team selection must resolve to a stable team id, never a name
 * string -- shown with club/town context so "Men's 1st Team" at two
 * different clubs is never ambiguous. teams_select is already public
 * (active = true or is_site_admin()/is_club_admin()), so this is no new
 * exposure, same reasoning as the existing signup/fixture opponent search.
 */
export async function searchTeams(query: string): Promise<TeamSearchResult[]> {
  if (query.trim().length < 2) return []
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase)
  if (!auth.ok) return []

  const escaped = query.trim().replace(/[%_]/g, (c) => `\\${c}`)
  const cols = "id, display_name, rugby_code, category, age_group, team_number, squad_designation, gender, club_id"
  const plainSelect = `${cols}, clubs(club_directory(name, town))`
  // `!inner` is required on both embeds -- without it, PostgREST's
  // dotted-path filter only nulls out non-matching embedded rows, it does
  // NOT restrict which top-level teams rows come back (confirmed by
  // direct testing against this project's own PostgREST instance), so a
  // plain club_directory.name filter alone would silently return up to
  // `limit` arbitrary unrelated teams instead of the real matches.
  const innerSelect = `${cols}, clubs!inner(club_directory!inner(name, town))`

  // PostgREST cannot mix a direct-column condition and a dotted embedded-
  // resource path inside a single .or() filter string -- that produces an
  // unparseable logic tree (found via live testing: this exact query 500'd
  // every team search, silently, since the error was never checked).
  // Run the two matches as separate queries and merge, deduping by id.
  const [{ data: byTeamName }, { data: byClubName }] = await Promise.all([
    supabase.from("teams").select(plainSelect).ilike("display_name", `%${escaped}%`).eq("active", true).limit(10),
    supabase.from("teams").select(innerSelect).ilike("clubs.club_directory.name", `%${escaped}%`).eq("active", true).limit(10),
  ])

  const results = new Map<string, TeamSearchResult>()
  for (const t of [...(byTeamName ?? []), ...(byClubName ?? [])]) {
    const directory = t.clubs?.club_directory
    if (!directory) continue
    results.set(t.id, {
      teamId: t.id,
      teamName: t.display_name,
      clubId: t.club_id,
      clubName: directory.name,
      town: directory.town,
      rugbyCode: t.rugby_code,
      category: t.category,
      ageGroup: t.age_group,
      teamNumber: t.team_number,
      squadDesignation: t.squad_designation,
      gender: t.gender,
    })
  }

  return [...results.values()].slice(0, 10)
}

export interface ClubSearchResult {
  directoryId: string
  clubId: string | null
  clubName: string
  town: string | null
  activated: boolean
}

/**
 * Searches the FULL canonical club_directory, not just activated `clubs` --
 * a club does not need an Ovalball account to be selected as a fixture
 * opponent (club_directory is every recognised real-world club; clubs is
 * only the subset that has claimed/activated an account). activated=false
 * results have no clubId (teams belong to clubs, never directly to
 * club_directory, so an unactivated club genuinely has no team-level data
 * to match against) -- the caller falls back to opponent_directory_id +
 * free text for those, never fabricating a team or an activation row.
 */
export async function searchOpponentClubs(query: string): Promise<ClubSearchResult[]> {
  if (query.trim().length < 2) return []
  const supabase = await createClient()
  const auth = await requireAuthenticated(supabase)
  if (!auth.ok) return []

  const escaped = query.trim().replace(/[%_]/g, (c) => `\\${c}`)
  const { data } = await supabase
    .from("club_directory")
    .select("id, name, town, clubs(id, status)")
    .ilike("name", `%${escaped}%`)
    .eq("active", true)
    .limit(10)

  return (data ?? []).map((d) => {
    const activeClub = (d.clubs as { id: string; status: string }[] | { id: string; status: string } | null | undefined) ?? null
    const club = Array.isArray(activeClub) ? activeClub.find((c) => c.status === "active") : activeClub?.status === "active" ? activeClub : null
    return { directoryId: d.id, clubId: club?.id ?? null, clubName: d.name, town: d.town, activated: Boolean(club) }
  })
}

export interface OpponentMatchResult {
  matches: TeamSearchResult[]
  allClubTeams: TeamSearchResult[]
}

/**
 * Given the owning team and a chosen opponent club, finds which of that
 * club's teams are the real canonical match -- same rugby_code AND
 * category (union/league can't cross, senior/youth can't cross), AND
 * same age_group when the owning team has one (youth), AND same
 * team_number/gender when the owning team has them (senior), matching the
 * brief's own worked examples (Burnley U12 A -> prefer opponent teams with
 * the same rugby code + age group/category; Men's 1st -> prefer opponent
 * Men's 1st) rather than any display_name string comparison. 0 matches ->
 * caller shows "no matching team" and falls back to allClubTeams / raw
 * text; 1 match -> caller auto-selects it; >1 -> caller must ask the user
 * to choose from `matches`.
 */
export async function findMatchingOpponentTeams(owningTeamId: string, opponentClubId: string): Promise<OpponentMatchResult> {
  const supabase = await createClient()
  const auth = await requireAuthenticated(supabase)
  if (!auth.ok) return { matches: [], allClubTeams: [] }

  const { data: owningTeam } = await supabase
    .from("teams")
    .select("rugby_code, category, age_group, team_number, gender")
    .eq("id", owningTeamId)
    .maybeSingle()
  if (!owningTeam) return { matches: [], allClubTeams: [] }

  const cols = "id, display_name, rugby_code, category, age_group, team_number, squad_designation, gender, club_id, clubs!inner(club_directory!inner(name, town))"
  const { data: clubTeams } = await supabase.from("teams").select(cols).eq("club_id", opponentClubId).eq("active", true).order("display_name")

  const toResult = (t: NonNullable<typeof clubTeams>[number]): TeamSearchResult | null => {
    const directory = t.clubs?.club_directory
    if (!directory) return null
    return {
      teamId: t.id,
      teamName: t.display_name,
      clubId: t.club_id,
      clubName: directory.name,
      town: directory.town,
      rugbyCode: t.rugby_code,
      category: t.category,
      ageGroup: t.age_group,
      teamNumber: t.team_number,
      squadDesignation: t.squad_designation,
      gender: t.gender,
    }
  }

  const allClubTeams = (clubTeams ?? []).map(toResult).filter((t): t is TeamSearchResult => t !== null)

  // Eligibility-aware: only ever suggests/auto-selects a team the owning
  // side could actually play (same rule internal.teams_can_play_fixture
  // enforces at save time -- see lib/fixtures/eligibility.ts). Never
  // offers a U13 team for a U12 fixture, or a Men's team for a Women's
  // fixture, even as a manual option.
  const owningFields = { rugbyCode: owningTeam.rugby_code, category: owningTeam.category, ageGroup: owningTeam.age_group, teamNumber: owningTeam.team_number, gender: owningTeam.gender }
  const matches = allClubTeams.filter((t) =>
    teamsCanPlayFixture(owningFields, { rugbyCode: t.rugbyCode, category: t.category, ageGroup: t.ageGroup, teamNumber: t.teamNumber, gender: t.gender })
  )

  return { matches, allClubTeams }
}

export interface PitchOption {
  id: string
  display_name: string
}

/** Read-only lookup for the grid quick-edit's Pitch control -- club_pitches is readable to any authenticated user (club_pitches_select), matching the same club-scoped pitch list the detail page's own PitchInline already uses. Shape matches PitchInline's own AvailablePitch prop directly. */
export async function getClubPitches(clubId: string): Promise<PitchOption[]> {
  const supabase = await createClient()
  const auth = await requireAuthenticated(supabase)
  if (!auth.ok) return []

  const { data } = await supabase.from("club_pitches").select("id, display_name").eq("club_id", clubId).eq("active", true).order("sort_order")
  return data ?? []
}

export interface VenueOption {
  id: string
  name: string
  isDefaultHome: boolean
  address: string | null
  postcode: string | null
}

export interface PitchWithVenueOption {
  id: string
  displayName: string
  venueId: string | null
}

/**
 * Venue Lookup Administration read for fixture creation (Section 5/11 of
 * the venue instruction): every active venue for the club, plus every
 * active pitch annotated with which venue it belongs to (a pitch with no
 * venue_id is legacy/unassigned data, still selectable, just not scoped
 * to a venue). venues_select/club_pitches_select are both open reads, so
 * any authenticated user who can see the club can see this -- the same
 * boundary the existing getClubPitches already relies on.
 */
export async function getClubVenuesAndPitches(clubId: string): Promise<{ venues: VenueOption[]; pitches: PitchWithVenueOption[] }> {
  const supabase = await createClient()
  const auth = await requireAuthenticated(supabase)
  if (!auth.ok) return { venues: [], pitches: [] }

  const [{ data: venues }, { data: pitches }] = await Promise.all([
    supabase.from("venues").select("id, name, is_default_home, address, postcode").eq("club_id", clubId).eq("active", true).order("name"),
    supabase.from("club_pitches").select("id, display_name, venue_id").eq("club_id", clubId).eq("active", true).order("sort_order"),
  ])

  return {
    venues: (venues ?? []).map((v) => ({ id: v.id, name: v.name, isDefaultHome: v.is_default_home, address: v.address, postcode: v.postcode })),
    pitches: (pitches ?? []).map((p) => ({ id: p.id, displayName: p.display_name, venueId: p.venue_id })),
  }
}

export interface CreateFixtureInput {
  owningTeamId: string
  homeAway: "Home" | "Away" | "TBD" | "Not Applicable"
  opponentTeamId: string | null
  opponentDirectoryId: string | null
  rawOppositionText: string
  kickoffDate: string | null
  kickoffTime: string | null
  gameType: string | null
  status: string
  venueId: string | null
  notes: string
  /** Competition/edition and pitch at creation time (Add Fixture form completeness follow-up) -- carried onto the resulting fixture on the direct-insert path, or onto the request/group on the pending-request path (accept_fixture_request already threads pitch_id onto the resulting fixture; competition_edition_id already lives on fixture_request_groups and is read the same way). */
  competitionEditionId?: string | null
  pitchId?: string | null
  /**
   * Central Fixture Participant Resolution, section 9/52: a Site Admin
   * naming a structured (missing or reactivatable) Team Directory identity
   * on a CLAIMED opponent club must not silently create the fixture --
   * "Site Admin should not silently create a team inside a claimed club
   * simply by allocating a fixture. Receiving Club Admin retains control."
   * Routes through the SAME fixture_request_groups/fixture_requests +
   * accept_fixture_request_with_team_action flow club-initiated requests
   * use, never a separate Site Admin architecture. Left null/unset for the
   * ordinary already-active-team or unclaimed-club paths, which keep the
   * existing direct insert unchanged.
   */
  targetTeamAgeGroup?: string | null
  targetTeamGender?: "boys" | "girls" | null
  targetTeamSquadDesignation?: string | null
}

export type FixtureResult =
  | { ok: true; fixtureId: string; pendingRequest?: false }
  | { ok: true; fixtureId: null; pendingRequest: true }
  | { ok: false; error: string }

export interface RequestingTeamIdentity {
  ageGroup: string | null
  rugbyCode: string
  /** Needed for the age-group auto-sync/override warning (Central Fixture Participant Resolution follow-up): girls youth fixtures are age-flexible only when BOTH sides are girls (internal.teams_can_play_fixture / lib/fixtures/eligibility.ts), so the eligible-age computation needs the requesting side's own gender, not just its age. */
  gender: string | null
  /** The team's own club -- needed by tournament host UI to look up that club's venues (getClubVenuesAndPitches) without a second round-trip. */
  clubId: string
}

/** Site Admin equivalent of calendar/fixture-actions.ts's getRequestingTeamIdentity -- same read-only purpose, kept local rather than cross-imported across route groups. */
export async function getRequestingTeamIdentity(teamId: string): Promise<RequestingTeamIdentity | null> {
  const supabase = await createClient()
  const auth = await requireAuthenticated(supabase)
  if (!auth.ok) return null
  const { data } = await supabase.from("teams").select("age_group, rugby_code, gender, club_id").eq("id", teamId).single()
  if (!data) return null
  return { ageGroup: data.age_group, rugbyCode: data.rugby_code, gender: data.gender, clubId: data.club_id }
}

/**
 * fixtures_insert_scoped (can_manage_team) is the real boundary; Site
 * Admin satisfies it unconditionally, same as every other Site Admin
 * write path in this project. Deliberately does NOT invent a fixture
 * date when none is supplied -- kickoff_date is NOT NULL on the base
 * table, so an unscheduled placeholder date is impossible to represent
 * without a schema change this feature doesn't need; the form requires a
 * date before allowing a scheduled fixture to be created (import review
 * rows without a date are held at "needs review" instead, never guessed).
 */
export async function createFixture(input: CreateFixtureInput): Promise<FixtureResult> {
  const supabase = await createClient()
  // Section 14/25 pattern (see requireAuthenticated's own doc comment):
  // fixtures_insert_scoped's RLS policy (internal.can_manage_fixture_side)
  // is already the real, correctly club/team-scoped boundary for this
  // insert -- a bare requireSiteAdmin gate here silently broke the Club
  // Admin/Fixtures Secretary "+ Add fixture" button on their own Fixture
  // Management page (live-reported: submitting never persisted, because
  // every non-Site-Admin was rejected before the insert was even
  // attempted), despite sharing the exact same dialog Site Admin uses.
  const auth = await requireAuthenticated(supabase)
  if (!auth.ok) return { ok: false, error: auth.error }

  if (!input.kickoffDate) return { ok: false, error: "A kickoff date is required to publish a scheduled fixture." }
  if (!input.rawOppositionText.trim()) return { ok: false, error: "An opponent (resolved team, or raw text) is required." }

  // Central Fixture Participant Resolution, section 9/52: a structured
  // identity on a CLAIMED opponent club (missing or reactivatable team)
  // must route through the same fixture_requests -> recipient-accepts
  // flow as a club-initiated request, never a direct unilateral insert --
  // only the wording differs (derived from created_by being a Site Admin,
  // never hardcoded). An ALREADY-ACTIVE opponent team, or an unclaimed
  // club, keeps the existing direct-insert path below unchanged.
  if (!input.opponentTeamId && input.targetTeamAgeGroup && input.opponentDirectoryId) {
    const { data: opponentClub } = await supabase.from("clubs").select("id").eq("directory_id", input.opponentDirectoryId).eq("status", "active").maybeSingle()
    if (opponentClub) {
      const { data: owningTeam } = await supabase.from("teams").select("club_id").eq("id", input.owningTeamId).single()
      if (!owningTeam) return { ok: false, error: "Owning team not found." }

      const venuePreference = input.homeAway === "Home" ? "home" : input.homeAway === "Away" ? "away" : "either"
      const { data: group, error: groupError } = await supabase
        .from("fixture_request_groups")
        .insert({
          requesting_club_id: owningTeam.club_id,
          opponent_club_id: opponentClub.id,
          raw_opponent_text: input.rawOppositionText.trim(),
          proposed_date: input.kickoffDate,
          notes: input.notes.trim() || null,
          game_type: input.gameType,
          competition_edition_id: input.competitionEditionId ?? null,
          created_by: auth.user.id,
        })
        .select("id")
        .single()
      if (groupError || !group) return { ok: false, error: groupError?.message ?? toPublicSubmissionError() }

      const { error: requestError } = await supabase.from("fixture_requests").insert({
        group_id: group.id,
        requesting_team_id: input.owningTeamId,
        venue_preference: venuePreference,
        preferred_kickoff_time: input.kickoffTime || null,
        pitch_id: input.pitchId ?? null,
        target_team_age_group: input.targetTeamAgeGroup,
        target_team_gender: input.targetTeamGender ?? null,
        target_team_squad_designation: input.targetTeamSquadDesignation ?? null,
        created_by: auth.user.id,
      })
      if (requestError) return { ok: false, error: requestError.message }

      revalidatePath("/admin/fixtures")
      return { ok: true, fixtureId: null, pendingRequest: true }
    }
  }

  const { data, error } = await supabase
    .from("fixtures")
    .insert({
      owning_team_id: input.owningTeamId,
      home_away: input.homeAway,
      opponent_team_id: input.opponentTeamId,
      opponent_directory_id: input.opponentDirectoryId,
      raw_opposition_text: input.rawOppositionText.trim(),
      kickoff_date: input.kickoffDate,
      kickoff_time: input.kickoffTime || null,
      game_type: input.gameType,
      status: input.status,
      venue_id: input.venueId,
      notes: input.notes.trim() || null,
      source: "site_admin_manual",
      competition_edition_id: input.competitionEditionId ?? null,
      pitch_id: input.pitchId ?? null,
    })
    .select("id")
    .single()

  if (error || !data) {
    console.error("createFixture failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }

  revalidatePath("/admin/fixtures")
  return { ok: true, fixtureId: data.id }
}

export interface EditFixtureInput {
  fixtureId: string
  homeAway: "Home" | "Away" | "TBD" | "Not Applicable"
  rawOppositionText: string
  kickoffDate: string
  kickoffTime: string | null
  gameType: string | null
  status: string
  venueId: string | null
  notes: string
}

export async function updateFixture(input: EditFixtureInput): Promise<ActionResult> {
  const supabase = await createClient()
  // fixtures_update_scoped's RLS (internal.can_manage_fixture_side) is the
  // real boundary -- see createFixture's comment above.
  const auth = await requireAuthenticated(supabase)
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase
    .from("fixtures")
    .update({
      home_away: input.homeAway,
      raw_opposition_text: input.rawOppositionText.trim(),
      kickoff_date: input.kickoffDate,
      kickoff_time: input.kickoffTime || null,
      game_type: input.gameType,
      status: input.status,
      venue_id: input.venueId,
      notes: input.notes.trim() || null,
    })
    .eq("id", input.fixtureId)

  if (error) {
    console.error("updateFixture failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath("/admin/fixtures")
  revalidatePath(`/admin/fixtures/${input.fixtureId}`)
  return { ok: true }
}

/**
 * update_fixture_opposition is the real boundary -- structured Opposition
 * Club (canonical club_directory search) + Opposition Team (Team Directory
 * / activated-club-team resolution via OpponentResolver, the SAME
 * component fixture creation already uses) rather than the old free-text-
 * only Opposition field. Age-grade/rugby-code eligibility is enforced by
 * the pre-existing enforce_fixture_age_eligibility trigger (fires on this
 * UPDATE the same as any other write), never duplicated here.
 */
export async function updateFixtureOpposition(
  fixtureId: string,
  opponentTeamId: string | null,
  opponentDirectoryId: string | null,
  rawOppositionText: string
): Promise<ActionResult> {
  const supabase = await createClient()
  // update_fixture_opposition itself already checks is_site_admin() OR
  // can_manage_team() OR can_manage_club_fixtures() -- it is the real
  // boundary, this action only forwards the call.
  const auth = await requireAuthenticated(supabase)
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase.rpc("update_fixture_opposition", {
    p_fixture_id: fixtureId,
    p_opponent_team_id: opponentTeamId as unknown as string,
    p_opponent_directory_id: opponentDirectoryId as unknown as string,
    p_raw_opposition_text: rawOppositionText,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath("/admin/fixtures")
  revalidatePath(`/admin/fixtures/${fixtureId}`)
  return { ok: true }
}

/**
 * swap_fixture_home_away is the real boundary -- the deliberate Home Team
 * editing operation (mega-spec section W): flips which already-resolved
 * side is home, atomically correcting home_away, owning/opponent team_id,
 * and home_score/away_score together so a completed result's orientation
 * never goes backwards.
 */
export async function swapFixtureHomeAway(fixtureId: string): Promise<ActionResult> {
  const supabase = await createClient()
  // swap_fixture_home_away itself already checks is_site_admin() OR
  // can_manage_team() -- it is the real boundary.
  const auth = await requireAuthenticated(supabase)
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase.rpc("swap_fixture_home_away", { p_fixture_id: fixtureId })
  if (error) return { ok: false, error: error.message }

  revalidatePath("/admin/fixtures")
  revalidatePath(`/admin/fixtures/${fixtureId}`)
  return { ok: true }
}

export interface OwningTeamOption {
  id: string
  label: string
}

/**
 * The club's own real, active roster for the Owning Team editor
 * (Reconciliation complaint 7) -- fullTeamLabel, never a raw display_name,
 * matching every other "normal selector" context (complaint 2).
 */
export async function getClubActiveTeams(clubId: string): Promise<OwningTeamOption[]> {
  const supabase = await createClient()
  const auth = await requireAuthenticated(supabase)
  if (!auth.ok) return []

  const { data } = await supabase
    .from("teams")
    .select("id, category, age_group, gender, squad_designation")
    .eq("club_id", clubId)
    .eq("active", true)
    .order("category")
    .order("age_group")

  return (data ?? []).map((t) => ({
    id: t.id,
    label: fullTeamLabel({ category: t.category, ageGroup: t.age_group, gender: t.gender, squadDesignation: t.squad_designation }),
  }))
}

/**
 * update_fixture_owning_team is the real boundary -- the Change Home Team
 * (or Change Away Team, depending on the fixture's current home_away)
 * operation for the OWNING side (Reconciliation complaint 7), distinct
 * from updateFixtureOpposition (opponent side) and swapFixtureHomeAway
 * (flips which resolved side is Home). Never crosses clubs -- the RPC
 * itself enforces that, this is just the forwarding call.
 */
export async function updateFixtureOwningTeam(fixtureId: string, newOwningTeamId: string): Promise<ActionResult> {
  const supabase = await createClient()
  // update_fixture_owning_team itself already checks is_site_admin() OR
  // can_manage_team() -- it is the real boundary.
  const auth = await requireAuthenticated(supabase)
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase.rpc("update_fixture_owning_team", { p_fixture_id: fixtureId, p_new_owning_team_id: newOwningTeamId })
  if (error) return { ok: false, error: error.message }

  revalidatePath("/admin/fixtures")
  revalidatePath(`/admin/fixtures/${fixtureId}`)
  return { ok: true }
}

/**
 * update_fixture_competition is the real boundary (owning club's Club
 * Admin/Fixtures Secretary, or Site Admin, and a rugby-code match check) --
 * this only forwards the call. p_competition_edition_id null clears it
 * back to "no competition set".
 */
export async function updateFixtureCompetition(fixtureId: string, competitionEditionId: string | null): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireAuthenticated(supabase)
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase.rpc("update_fixture_competition", {
    p_fixture_id: fixtureId,
    // Declared nullable uuid in SQL -- the generated type doesn't capture that.
    p_competition_edition_id: competitionEditionId as unknown as string,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath("/admin/fixtures")
  revalidatePath(`/admin/fixtures/${fixtureId}`)
  return { ok: true }
}

/** Normal administrative action -- sets status='Cancelled' and records who/when/why. Never deletes the row, so history/messages/audit survive intact. */
const DIRECT_STATUS_TRANSITIONS = new Set(["Planned", "Booked", "To Be Determined", "Completed"])

/**
 * The compact status-control counterpart to the full Edit form's status
 * field -- a single-purpose write for the common case (moving a fixture
 * between its real, already-existing lifecycle values). Cancelled is
 * deliberately excluded here: that transition always needs a reason and
 * cancellation metadata, so it stays exclusively behind cancelFixture()
 * below, never reachable as a bare status write that could skip the
 * reason. Never accepts an arbitrary string -- only one of the fixture's
 * real STATUS_OPTIONS values.
 */
export async function updateFixtureStatus(fixtureId: string, status: string): Promise<ActionResult> {
  if (!DIRECT_STATUS_TRANSITIONS.has(status)) {
    return { ok: false, error: "That status change isn't available here." }
  }
  const supabase = await createClient()
  // fixtures_update_scoped's RLS is the real boundary -- see createFixture's comment above.
  const auth = await requireAuthenticated(supabase)
  if (!auth.ok) return { ok: false, error: auth.error }

  const { data: current } = await supabase.from("fixtures").select("status").eq("id", fixtureId).maybeSingle()
  if (!current) return { ok: false, error: "Fixture not found." }
  if (current.status === "Cancelled") {
    return { ok: false, error: "A cancelled fixture can't be reopened this way -- edit the fixture directly if that's genuinely needed." }
  }

  const { error } = await supabase.from("fixtures").update({ status }).eq("id", fixtureId)
  if (error) {
    console.error("updateFixtureStatus failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath("/admin/fixtures")
  revalidatePath(`/admin/fixtures/${fixtureId}`)
  return { ok: true }
}

export async function cancelFixture(fixtureId: string, reason: string): Promise<ActionResult> {
  const supabase = await createClient()
  // fixtures_update_scoped's RLS is the real boundary -- see createFixture's comment above.
  const auth = await requireAuthenticated(supabase)
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase
    .from("fixtures")
    .update({ status: "Cancelled", cancelled_at: new Date().toISOString(), cancelled_by: auth.user.id, cancellation_reason: reason.trim() || null })
    .eq("id", fixtureId)

  if (error) {
    console.error("cancelFixture failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath("/admin/fixtures")
  revalidatePath(`/admin/fixtures/${fixtureId}`)
  return { ok: true }
}

/**
 * Wraps delete_fixture() -- the only path that may permanently remove a
 * fixtures row, blocked server-side (not just in this action) whenever
 * meaningful history exists. Prefer Cancel for anything with real
 * activity.
 */
export async function deleteFixture(fixtureId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'fixture_ops'])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase.rpc("delete_fixture", { p_fixture_id: fixtureId })
  if (error) {
    return { ok: false, error: error.message }
  }
  revalidatePath("/admin/fixtures")
  return { ok: true }
}

export interface MessageRecipient {
  userId: string
  name: string
  roleLabel: string
}

/**
 * Read-only preview of exactly who internal.notify_fixture_message_recipients()
 * (20260831140000_partner_and_message_notifications.sql) will actually
 * notify for this fixture -- mirrors that trigger's own two-branch query
 * (team_admin/coach/manager on either team, or CLUB_ADMIN/FIXTURE_SECRETARY
 * at either club) exactly, so what the admin sees before sending is never a
 * guess or a simplified approximation of the real fan-out. Shown so a Site
 * Admin can confirm a message will reach the right people, never every club
 * member, before it actually sends -- matches the brief's explicit
 * "showing recipients before sending" requirement.
 */
export async function getFixtureMessageRecipients(fixtureId: string): Promise<MessageRecipient[]> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase)
  if (!auth.ok) return []

  const { data: fixture } = await supabase.from("fixtures").select("owning_team_id, opponent_team_id").eq("id", fixtureId).maybeSingle()
  if (!fixture) return []
  const teamIds = [fixture.owning_team_id, fixture.opponent_team_id].filter((id): id is string => Boolean(id))
  if (teamIds.length === 0) return []

  const { data: teams } = await supabase.from("teams").select("id, club_id").in("id", teamIds)
  const clubIds = [...new Set((teams ?? []).map((t) => t.club_id))]

  const [{ data: teamOfficials }, { data: clubOfficials }] = await Promise.all([
    supabase
      .from("team_permissions")
      .select("permission, club_memberships!inner(user_id, status)")
      .in("team_id", teamIds)
      .in("permission", ["team_admin", "coach", "manager"]),
    clubIds.length > 0
      ? supabase.from("club_memberships").select("user_id, role, status").in("club_id", clubIds).in("role", ["CLUB_ADMIN", "FIXTURE_SECRETARY"])
      : Promise.resolve({ data: [] as { user_id: string; role: string; status: string }[] }),
  ])

  const roleLabelByUserId = new Map<string, string>()
  for (const row of teamOfficials ?? []) {
    const membership = row.club_memberships as unknown as { user_id: string; status: string }
    if (membership?.status !== "active") continue
    roleLabelByUserId.set(membership.user_id, row.permission === "team_admin" ? "Team Admin" : row.permission === "coach" ? "Coach" : "Manager")
  }
  for (const row of clubOfficials ?? []) {
    if (row.status !== "active") continue
    if (!roleLabelByUserId.has(row.user_id)) {
      roleLabelByUserId.set(row.user_id, row.role === "CLUB_ADMIN" ? "Club Admin" : "Fixtures Admin")
    }
  }
  roleLabelByUserId.delete(auth.user.id)
  if (roleLabelByUserId.size === 0) return []

  const userIds = [...roleLabelByUserId.keys()]
  const { data: profiles } = await supabase.from("profiles").select("id, first_name, surname").in("id", userIds)
  const nameById = new Map((profiles ?? []).map((p) => [p.id, [p.first_name, p.surname].filter(Boolean).join(" ") || "Unnamed"]))

  return userIds.map((userId) => ({ userId, name: nameById.get(userId) ?? "Unnamed", roleLabel: roleLabelByUserId.get(userId)! }))
}

/**
 * send_fixture_support_message is the real boundary -- requires the
 * explicit manage_fixture_support capability (internal.can_manage_
 * fixture_support()), never a bare Site Admin profile check. The message
 * is flagged is_site_admin_message=true server-side, so it renders
 * visibly as Ovalball/Site Admin support in the conversation -- never
 * indistinguishable from either club's own messages. Recipients are
 * whoever the existing notification trigger on fixture_messages already
 * notifies (club officials with a real relationship to the fixture),
 * never every club member.
 */
export async function sendAdminFixtureMessage(fixtureId: string, body: string): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase)
  if (!auth.ok) return { ok: false, error: auth.error }

  if (!body.trim()) return { ok: false, error: "Message cannot be empty." }

  const { error } = await supabase.rpc("send_fixture_support_message", { p_fixture_id: fixtureId, p_body: body })
  if (error) {
    return { ok: false, error: error.message }
  }
  revalidatePath(`/admin/fixtures/${fixtureId}`)
  return { ok: true }
}

export type ExportCsvResult = { ok: true; csv: string; filename: string } | { ok: false; error: string }

export async function exportFixturesCsv(query: AdminFixtureQuery): Promise<ExportCsvResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase)
  if (!auth.ok) return { ok: false, error: auth.error }

  const { data, error } = await buildAdminFixtureQuery(supabase, query)
  if (error || !data) return { ok: false, error: "Couldn't generate the export. Please try again." }

  const csv = await buildFixtureCsv(supabase, data)
  const timestamp = new Date().toISOString().slice(0, 10)
  return { ok: true, csv, filename: `ovalball-fixtures-${timestamp}.csv` }
}
