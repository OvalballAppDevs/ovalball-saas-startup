import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { dateWithinAnySeason, type SeasonRow } from "@/lib/calendar/season-window"
import { fullTeamLabel } from "@/lib/teams/compact-label"
import type { Database } from "@/types/database.types"

import { callUpdateFixtureSchedule } from "./update-fixture-schedule"
import { suggestOppositionTeam, type MatchableTeam, type OppositionSuggestion } from "./opposition-match"
import type { ClubGrounds } from "./venue-defaults"

/**
 * THE ONE FIXTURE EDITOR.
 *
 * Calendar, the Fixture Control Centre and fixture detail all open the same
 * editor, and it reads and writes through this module only:
 *
 *   loadFixtureEditor  -- the fixture's values, which fields this person may
 *                         change and why not (public.fixture_editable_fields,
 *                         computed from the same predicates the writers
 *                         enforce), and the canonical options for each field.
 *   saveFixtureEditor  -- diffs against the stored fixture and sends each
 *                         changed field to its own canonical writer. Nothing
 *                         unchanged is written, so saving a date can never
 *                         blank a venue or the notes again.
 *
 * Same person + same fixture + same capability = same editable field set,
 * whichever surface is asking, because none of them decides it.
 */

type Supabase = SupabaseClient<Database>

export interface FieldAuthority {
  editable: boolean
  reason: string | null
}

export type EditableFieldKey = "schedule" | "meetTime" | "venue" | "competition" | "opposition" | "ourTeam" | "homeAway" | "details" | "result"

export interface FixtureEditorValues {
  kickoffDate: string
  kickoffTime: string | null
  meetTime: string | null
  ourTeamId: string
  homeAway: "Home" | "Away" | "TBD" | "Not Applicable"
  opponentTeamId: string | null
  opponentDirectoryId: string | null
  opponentClubName: string | null
  rawOppositionText: string
  venueId: string | null
  venueAddress: string | null
  pitchId: string | null
  gameType: string | null
  competitionEditionId: string | null
  status: string
  notes: string | null
  homeScore: number | null
  awayScore: number | null
}

export interface FixtureEditorModel {
  fixtureId: string
  rugbyCode: string
  owningClubId: string
  values: FixtureEditorValues
  fields: Record<EditableFieldKey, FieldAuthority>
  competitionName: string | null
  pendingKickoff: { date: string; time: string | null } | null
  /** The opposition has been asked to confirm this team and has not answered yet. */
  pendingTeamRequest: { teamLabel: string } | null
  options: {
    ourTeams: { id: string; label: string }[]
    competitions: { id: string; label: string }[]
    /** Grounds of the fixture's home club (where venue and pitch are chosen from). */
    homeGrounds: ClubGrounds
    ourGrounds: ClubGrounds
  }
  ourTeam: MatchableTeam
}

const TEAM_FIELDS = "id, club_id, rugby_code, category, age_group, gender, squad_designation"

function matchable(t: { id: string; rugby_code: string; category: string; age_group: string | null; gender: string | null; squad_designation: string | null }): MatchableTeam {
  return {
    id: t.id,
    label: fullTeamLabel({ category: t.category, ageGroup: t.age_group, gender: t.gender, squadDesignation: t.squad_designation, rugbyCode: t.rugby_code }),
    rugbyCode: t.rugby_code,
    category: t.category,
    ageGroup: t.age_group,
    gender: t.gender,
    squadDesignation: t.squad_designation,
  }
}

export async function clubGrounds(supabase: Supabase, clubId: string | null): Promise<ClubGrounds> {
  if (!clubId) return { venues: [], pitches: [] }
  const [{ data: venues }, { data: pitches }] = await Promise.all([
    supabase.from("venues").select("id, name, is_default_home, active").eq("club_id", clubId).eq("active", true).order("name"),
    supabase.from("club_pitches").select("id, display_name, venue_id, active").eq("club_id", clubId).eq("active", true).order("sort_order"),
  ])
  return {
    venues: (venues ?? []).map((v) => ({ id: v.id, name: v.name, isDefaultHome: v.is_default_home, active: v.active })),
    pitches: (pitches ?? []).map((p) => ({ id: p.id, name: p.display_name, venueId: p.venue_id, active: p.active })),
  }
}

export async function loadFixtureEditor(supabase: Supabase, fixtureId: string): Promise<FixtureEditorModel | null> {
  const { data: f } = await supabase
    .from("fixtures")
    .select(
      "id, owning_team_id, opponent_team_id, opponent_directory_id, raw_opposition_text, home_away, home_team_id, kickoff_date, kickoff_time, meet_time, venue_id, venue_address, pitch_id, game_type, competition_edition_id, status, notes, home_score, away_score, kickoff_amendment_proposed_date, kickoff_amendment_proposed_time",
    )
    .eq("id", fixtureId)
    .maybeSingle()
  if (!f) return null

  const [{ data: fieldsJson }, { data: ourTeamRow }, opponentDirectory] = await Promise.all([
    supabase.rpc("fixture_editable_fields", { p_fixture_id: fixtureId }),
    supabase.from("teams").select(TEAM_FIELDS).eq("id", f.owning_team_id).maybeSingle(),
    f.opponent_directory_id
      ? supabase.from("club_directory").select("name").eq("id", f.opponent_directory_id).maybeSingle()
      : f.opponent_team_id
        ? supabase.from("teams").select("clubs(club_directory(id, name))").eq("id", f.opponent_team_id).maybeSingle()
        : Promise.resolve({ data: null }),
  ])
  if (!ourTeamRow || !fieldsJson) return null

  const fieldsRaw = fieldsJson as Record<string, { editable: boolean; reason: string | null }> & { competitionName?: string | null }
  const keys: EditableFieldKey[] = ["schedule", "meetTime", "venue", "competition", "opposition", "ourTeam", "homeAway", "details", "result"]
  const fields = Object.fromEntries(keys.map((k) => [k, { editable: Boolean(fieldsRaw[k]?.editable), reason: fieldsRaw[k]?.reason ?? null }])) as Record<
    EditableFieldKey,
    FieldAuthority
  >

  let opponentClubName: string | null = null
  let opponentDirectoryId = f.opponent_directory_id
  const od = opponentDirectory.data as { name?: string; clubs?: { club_directory?: { id: string; name: string } | null } | null } | null
  if (od?.name) opponentClubName = od.name
  else if (od?.clubs?.club_directory) {
    opponentClubName = od.clubs.club_directory.name
    opponentDirectoryId = opponentDirectoryId ?? od.clubs.club_directory.id
  }

  let homeClubId: string | null = null
  if (f.home_team_id) {
    const { data: homeTeam } = await supabase.from("teams").select("club_id").eq("id", f.home_team_id).maybeSingle()
    homeClubId = homeTeam?.club_id ?? null
  }

  const [{ data: clubTeams }, { data: editions }, homeGrounds, ourGrounds, { data: openAsk }] = await Promise.all([
    supabase.from("teams").select(TEAM_FIELDS).eq("club_id", ourTeamRow.club_id).eq("active", true).order("category").order("age_group"),
    supabase
      .from("competition_editions")
      .select("id, competitions!inner(name, active), seasons(name, starts_on)")
      .eq("rugby_code", ourTeamRow.rugby_code)
      .eq("active", true)
      .eq("competitions.active", true),
    clubGrounds(supabase, homeClubId),
    clubGrounds(supabase, ourTeamRow.club_id),
    supabase
      .from("fixture_requests")
      .select("teams!fixture_requests_target_team_id_fkey(rugby_code, category, age_group, gender, squad_designation)")
      .eq("existing_fixture_id", fixtureId)
      .eq("status", "sent")
      .maybeSingle(),
  ])

  return {
    fixtureId,
    rugbyCode: ourTeamRow.rugby_code,
    owningClubId: ourTeamRow.club_id,
    values: {
      kickoffDate: f.kickoff_date,
      kickoffTime: f.kickoff_time?.slice(0, 5) ?? null,
      meetTime: f.meet_time?.slice(0, 5) ?? null,
      ourTeamId: f.owning_team_id,
      homeAway: f.home_away as FixtureEditorValues["homeAway"],
      opponentTeamId: f.opponent_team_id,
      opponentDirectoryId,
      opponentClubName,
      rawOppositionText: f.raw_opposition_text,
      venueId: f.venue_id,
      venueAddress: f.venue_address,
      pitchId: f.pitch_id,
      gameType: f.game_type,
      competitionEditionId: f.competition_edition_id,
      status: f.status,
      notes: f.notes,
      homeScore: f.home_score,
      awayScore: f.away_score,
    },
    fields,
    competitionName: fieldsRaw.competitionName ?? null,
    pendingKickoff: f.kickoff_amendment_proposed_date
      ? { date: f.kickoff_amendment_proposed_date, time: f.kickoff_amendment_proposed_time?.slice(0, 5) ?? null }
      : null,
    pendingTeamRequest: openAsk?.teams
      ? {
          teamLabel: fullTeamLabel({
            category: openAsk.teams.category,
            ageGroup: openAsk.teams.age_group,
            gender: openAsk.teams.gender,
            squadDesignation: openAsk.teams.squad_designation,
            rugbyCode: openAsk.teams.rugby_code,
          }),
        }
      : null,
    options: {
      ourTeams: (clubTeams ?? []).map((t) => ({ id: t.id, label: matchable(t).label })),
      competitions: (editions ?? [])
        .filter((e) => e.competitions)
        .sort((a, b) => (b.seasons?.starts_on ?? "").localeCompare(a.seasons?.starts_on ?? "") || a.competitions!.name.localeCompare(b.competitions!.name))
        .map((e) => ({ id: e.id, label: e.seasons ? `${e.competitions!.name} · ${e.seasons.name}` : e.competitions!.name })),
      homeGrounds,
      ourGrounds,
    },
    ourTeam: matchable(ourTeamRow),
  }
}

// ---------------------------------------------------------------------------
// Opposition: a club's teams, the suggested team, and their grounds.
// ---------------------------------------------------------------------------

export interface OppositionOptions {
  directoryId: string
  clubName: string
  /** Set when the club is on Ovalball. */
  tenantClubId: string | null
  teams: MatchableTeam[]
  suggestion: OppositionSuggestion
  grounds: ClubGrounds
}

export async function loadOppositionOptions(supabase: Supabase, directoryId: string, ourTeam: MatchableTeam): Promise<OppositionOptions | null> {
  const { data: directory } = await supabase.from("club_directory").select("id, name, home_ground, rugby_code").eq("id", directoryId).maybeSingle()
  if (!directory) return null
  // Union and League are isolated: a club in the other code has nothing to offer.
  if (directory.rugby_code !== ourTeam.rugbyCode) return null
  const { data: tenant } = await supabase.from("clubs").select("id").eq("directory_id", directoryId).eq("status", "active").maybeSingle()
  const [{ data: teamRows }, grounds] = await Promise.all([
    tenant
      ? supabase.from("teams").select(TEAM_FIELDS).eq("club_id", tenant.id).eq("active", true).order("category").order("age_group")
      : Promise.resolve({ data: [] as { id: string; club_id: string; rugby_code: string; category: string; age_group: string | null; gender: string | null; squad_designation: string | null }[] }),
    tenant ? clubGrounds(supabase, tenant.id) : Promise.resolve({ venues: [], pitches: [] } as ClubGrounds),
  ])
  const teams = (teamRows ?? []).map(matchable)
  return {
    directoryId,
    clubName: directory.name,
    tenantClubId: tenant?.id ?? null,
    teams,
    suggestion: suggestOppositionTeam(ourTeam, teams),
    grounds: { ...grounds, directoryHomeGround: tenant ? null : directory.home_ground },
  }
}

// ---------------------------------------------------------------------------
// Season window
// ---------------------------------------------------------------------------

/**
 * A fixture's date must fall inside a real season of its code, from the
 * canonical season register (pre-season through main season end). No
 * configured seasons means nothing to check against, not a default window.
 */
export async function fixtureDateSeasonError(supabase: Supabase, rugbyCode: string, kickoffDate: string): Promise<string | null> {
  const { data: seasonRows } = await supabase
    .from("seasons")
    .select("id, name, season_ref, rugby_code, pre_season_starts_on, starts_on, ends_on")
    .eq("rugby_code", rugbyCode)
    .eq("is_regression_fixture", false)
  if (!seasonRows || seasonRows.length === 0) return null
  const seasons: SeasonRow[] = seasonRows.map((s) => ({
    id: s.id,
    name: s.name,
    seasonRef: s.season_ref,
    rugbyCode: s.rugby_code,
    preSeasonStartsOn: s.pre_season_starts_on,
    startsOn: s.starts_on,
    endsOn: s.ends_on,
  }))
  if (!dateWithinAnySeason(seasons, kickoffDate)) {
    return "That date falls outside every configured season (Pre-Season through Main Season End) for this fixture's club. Choose a date within a real season window."
  }
  return null
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

export type FixtureEditorPatch = Partial<{
  kickoffDate: string
  kickoffTime: string | null
  meetTime: string | null
  ourTeamId: string
  homeAway: FixtureEditorValues["homeAway"]
  opposition: { teamId: string | null; directoryId: string | null; rawText: string }
  venueId: string | null
  /** An away ground at a club not on Ovalball, where no venue record exists. */
  venueText: string | null
  pitchId: string | null
  gameType: string | null
  competitionEditionId: string | null
  status: string
  notes: string | null
  /** Ask the Ovalball opposition club to confirm this team of theirs. */
  askTeamId: string | null
  /** The score, recorded through submit_fixture_result. */
  result: { home: number; away: number } | null
}>

export interface FixtureEditorSaveResult {
  ok: boolean
  saved: string[]
  errors: { field: string; message: string }[]
  notices: string[]
}

const norm = (v: string | null | undefined) => (v ?? "").trim() || null
const time5 = (v: string | null | undefined) => (v ? v.slice(0, 5) : null)

export async function saveFixtureEditor(supabase: Supabase, fixtureId: string, patch: FixtureEditorPatch): Promise<FixtureEditorSaveResult> {
  const model = await loadFixtureEditor(supabase, fixtureId)
  if (!model) return { ok: false, saved: [], errors: [{ field: "fixture", message: "Fixture not found." }], notices: [] }
  const cur = model.values
  const result: FixtureEditorSaveResult = { ok: true, saved: [], errors: [], notices: [] }
  const fail = (field: string, message: string) => {
    result.ok = false
    result.errors.push({ field, message })
  }

  // 0. A new date must sit inside a real season before anything is written.
  if (patch.kickoffDate !== undefined && patch.kickoffDate !== cur.kickoffDate) {
    const seasonError = await fixtureDateSeasonError(supabase, model.rugbyCode, patch.kickoffDate)
    if (seasonError) return { ok: false, saved: [], errors: [{ field: "schedule", message: seasonError }], notices: [] }
  }

  // 1. Our team.
  if (patch.ourTeamId !== undefined && patch.ourTeamId !== cur.ourTeamId) {
    const { error } = await supabase.rpc("update_fixture_owning_team", { p_fixture_id: fixtureId, p_new_owning_team_id: patch.ourTeamId })
    if (error) fail("ourTeam", error.message)
    else result.saved.push("ourTeam")
  }

  // 2. Opposition.
  if (patch.opposition !== undefined) {
    const o = patch.opposition
    const changed =
      o.teamId !== cur.opponentTeamId || (o.teamId === null && o.directoryId !== cur.opponentDirectoryId) || norm(o.rawText) !== norm(cur.rawOppositionText)
    // An Ovalball club is asked, never booked. Correcting which of the SAME
    // club's teams we play is an edit; naming a different Ovalball club's
    // team would put a fixture on their calendar that nobody there agreed to.
    let refused = false
    if (changed && o.teamId && o.teamId !== cur.opponentTeamId) {
      const ids = [o.teamId, cur.opponentTeamId].filter((id): id is string => Boolean(id))
      const { data: clubsOf } = await supabase.from("teams").select("id, club_id").in("id", ids)
      const newClub = clubsOf?.find((t) => t.id === o.teamId)?.club_id ?? null
      const currentClub = clubsOf?.find((t) => t.id === cur.opponentTeamId)?.club_id ?? null
      if (!newClub || newClub !== currentClub) {
        refused = true
        fail(
          "opposition",
          "That club is on Ovalball, so they are asked rather than booked. Record the club without a team, or send them a fixture request from Request a Fixture.",
        )
      }
    }
    if (changed && !refused) {
      const { error } = await supabase.rpc("update_fixture_opposition", {
        p_fixture_id: fixtureId,
        // Both ids are required arguments; null is the value, not an omission.
        p_opponent_team_id: o.teamId ?? null,
        p_opponent_directory_id: o.teamId ? null : (o.directoryId ?? null),
        p_raw_opposition_text: o.rawText,
      } as never)
      if (error) fail("opposition", error.message)
      else result.saved.push("opposition")
    }
  }

  // 3. Details: home/away first, because the venue belongs to the home club.
  const details: Record<string, string | null> = {}
  if (patch.homeAway !== undefined && patch.homeAway !== cur.homeAway) details.home_away = patch.homeAway
  if (patch.gameType !== undefined && norm(patch.gameType) !== norm(cur.gameType)) details.game_type = patch.gameType
  if (patch.status !== undefined && patch.status !== cur.status) details.status = patch.status
  if (patch.notes !== undefined && norm(patch.notes) !== norm(cur.notes)) details.notes = patch.notes
  if (patch.venueText !== undefined && norm(patch.venueText) !== norm(cur.venueAddress)) details.venue_text = patch.venueText
  if (Object.keys(details).length > 0) {
    const { error } = await supabase.rpc("update_fixture_details", { p_fixture_id: fixtureId, p_patch: details })
    if (error) fail("details", error.message)
    else result.saved.push(...Object.keys(details))
  }

  // 4. Schedule: date, kick-off, venue and pitch, in one atomic writer that
  //    turns a kick-off change on a shared fixture into a proposal.
  const schedule: Parameters<typeof callUpdateFixtureSchedule>[2] = {}
  if (patch.kickoffDate !== undefined && patch.kickoffDate !== cur.kickoffDate) schedule.kickoffDate = patch.kickoffDate
  if (patch.kickoffTime !== undefined && time5(patch.kickoffTime) !== time5(cur.kickoffTime)) schedule.kickoffTime = patch.kickoffTime
  const homeAwayChanged = details.home_away !== undefined
  if (patch.venueId !== undefined && (patch.venueId !== cur.venueId || homeAwayChanged)) schedule.venueId = patch.venueId
  if (patch.pitchId !== undefined && (patch.pitchId !== cur.pitchId || homeAwayChanged)) schedule.pitchId = patch.pitchId
  if (Object.keys(schedule).length > 0 && !result.errors.some((e) => e.field === "details" && homeAwayChanged)) {
    const r = await callUpdateFixtureSchedule(supabase, fixtureId, schedule, "fixture_editor")
    if (!r.ok) fail("schedule", r.error)
    else {
      result.saved.push("schedule")
      if (r.kickoffProposed) result.notices.push("The new date and kick-off have been sent to the other club to agree.")
    }
  }

  // 5. Meet time -- after kick-off, which it must not be later than.
  if (patch.meetTime !== undefined && time5(patch.meetTime) !== time5(cur.meetTime)) {
    // null clears the meet time; the writer accepts it.
    const { error } = await supabase.rpc("update_fixture_meet_time", { p_fixture_id: fixtureId, p_meet_time: patch.meetTime } as never)
    if (error) fail("meetTime", error.message)
    else result.saved.push("meetTime")
  }

  // 6. Competition.
  if (patch.competitionEditionId !== undefined && patch.competitionEditionId !== cur.competitionEditionId) {
    const { error } = await supabase.rpc("update_fixture_competition", {
      p_fixture_id: fixtureId,
      p_competition_edition_id: patch.competitionEditionId,
    } as never)
    if (error) fail("competition", error.message)
    else result.saved.push("competition")
  }

  // 7. Ask the opposition to confirm their team -- after the club is recorded.
  if (patch.askTeamId && !result.errors.some((e) => e.field === "opposition")) {
    const { error } = await supabase.rpc("ask_opponent_to_confirm_team", { p_fixture_id: fixtureId, p_target_team_id: patch.askTeamId })
    if (error) fail("opposition", error.message)
    else {
      result.saved.push("askTeam")
      result.notices.push("The opposition club has been asked to confirm their team. The fixture updates when they accept.")
    }
  }

  // 8. The result.
  if (patch.result && (patch.result.home !== cur.homeScore || patch.result.away !== cur.awayScore)) {
    const { error } = await supabase.rpc("submit_fixture_result", { p_fixture_id: fixtureId, p_home_score: patch.result.home, p_away_score: patch.result.away })
    if (error) fail("result", error.message)
    else result.saved.push("result")
  }

  return result
}
