import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@ovalball/contracts"
import { fullTeamLabel } from "@ovalball/contracts"
import { readClubTeams, sortTeamsInRugbyAgeOrder, type ClubTeam } from "@ovalball/contracts/club/teams"
import { readClubVenues, type ClubPitch, type ClubVenue } from "@ovalball/contracts/club/venues"

type Client = SupabaseClient<Database>

export interface CanonicalSeason {
  id: string
  name: string
  startsOn: string
  endsOn: string
  preSeasonStartsOn: string | null
}

export interface SeasonsForClub {
  /** Every canonical season for this club's own rugby code, newest first -- never a Training-specific list. */
  seasons: CanonicalSeason[]
  /** The one whose own date range contains today, if any -- the Select Team & Type screen's default. */
  currentSeasonId: string | null
}

/**
 * The pure part: given raw season rows already known to be for the right rugby code, decide the
 * current one. Pulled out so "current season = the row containing today" can be pinned with a fast
 * unit test (`data.test.mts`) using a handful of made-up rows, never a live database -- the same
 * reasoning `orderClubTeamsForDisplay` already uses this file for.
 */
export function pickCurrentSeason(seasons: readonly CanonicalSeason[], todayIso: string): CanonicalSeason | null {
  return seasons.find((s) => s.startsOn <= todayIso && s.endsOn >= todayIso) ?? null
}

/**
 * EVERY CANONICAL SEASON FOR THIS CLUB'S RUGBY CODE -- the same `public.seasons` table
 * `club/handover.ts` already reads ("the same canonical `seasons` table... never a second season
 * concept"), never a Training-specific season list and never a hardcoded array. `is_regression_fixture`
 * rows are excluded so a real club is never offered a synthetic SQL-test season, matching
 * `handover.ts`'s own exclusion. `currentSeasonId` -- the row whose own range contains today -- is the
 * Select Team & Type screen's default selection, but every canonical season for the sport is a real,
 * selectable option, never hidden.
 */
export async function loadSeasonsForClub(supabase: Client, clubId: string, todayIso = new Date().toISOString().slice(0, 10)): Promise<SeasonsForClub> {
  const { data: club } = await supabase.from("clubs").select("club_directory(rugby_code)").eq("id", clubId).maybeSingle()
  const rugbyCode = club?.club_directory?.rugby_code
  if (rugbyCode !== "union" && rugbyCode !== "league") return { seasons: [], currentSeasonId: null }

  const { data: rows } = await supabase
    .from("seasons")
    .select("id, name, starts_on, ends_on, pre_season_starts_on")
    .eq("rugby_code", rugbyCode)
    .eq("is_regression_fixture", false)
    .order("starts_on", { ascending: false })

  const seasons: CanonicalSeason[] = (rows ?? []).map((s) => ({ id: s.id, name: s.name, startsOn: s.starts_on, endsOn: s.ends_on, preSeasonStartsOn: s.pre_season_starts_on }))
  return { seasons, currentSeasonId: pickCurrentSeason(seasons, todayIso)?.id ?? null }
}

/**
 * THE ONE CANONICAL, CORRECTLY-ORDERED TEAM LIST for every Training Planning screen -- Home's own team
 * rows and the Create Plan wizard's team selector both call this, never a second hand-rolled query or
 * sort. Team identity/ordering comes from `readClubTeams` + `sortTeamsInRugbyAgeOrder`
 * (`@ovalball/contracts/club/teams`) -- the exact sorter Find a Fixture and the Clubhouse club detail
 * screen already use, senior sides first then every age grade oldest-to-youngest, never database
 * insertion order or a lexical sort. That function has no notion of a cover photo, so this adds one
 * small supplementary query for `cover_image_path`/`cover_stock_key` and merges it in by id.
 */
export interface OrderedTeamOption {
  teamId: string
  displayName: string
  teamLabel: string
  category: "senior" | "youth" | "colts"
  ageGroup: string | null
  gender: string | null
  coverImagePath: string | null
  coverStockKey: string | null
}

/**
 * The pure part of `loadOrderedClubTeams`, pulled out so the ordering can be pinned with a fast unit
 * test (`data.test.mts`) that never touches a live database -- the same shape as `sortTeamsInRugbyAgeOrder`'s
 * own tests (`supabase/tests/js/club_teams_ordering.test.mts`), one level up: this proves Training
 * Planning's own merge step doesn't accidentally lose or re-derive the order the sorter already gave it.
 */
export function orderClubTeamsForDisplay(teams: readonly ClubTeam[], coverRows: readonly { id: string; cover_image_path: string | null; cover_stock_key: string | null }[]): OrderedTeamOption[] {
  const coverByTeam = new Map(coverRows.map((c) => [c.id, c]))
  const ordered = sortTeamsInRugbyAgeOrder(teams.filter((t) => t.active))
  return ordered.map((t) => ({
    teamId: t.id,
    displayName: t.displayName,
    teamLabel: t.fullLabel,
    category: t.category,
    ageGroup: t.ageGroup,
    gender: t.gender,
    coverImagePath: coverByTeam.get(t.id)?.cover_image_path ?? null,
    coverStockKey: coverByTeam.get(t.id)?.cover_stock_key ?? null,
  }))
}

export async function loadOrderedClubTeams(supabase: Client, clubId: string): Promise<OrderedTeamOption[]> {
  const [{ teams }, { data: coverRows }] = await Promise.all([
    readClubTeams(supabase, clubId),
    supabase.from("teams").select("id, cover_image_path, cover_stock_key").eq("club_id", clubId),
  ])
  return orderClubTeamsForDisplay(teams, coverRows ?? [])
}

/**
 * TRAINING PLANNING HOME -- the exact data shape app/(app)/club/training/page.tsx already assembles
 * (overview RPC + teams + plans-with-rules + a 14-day upcoming window), read the same way on mobile:
 * direct table selects under RLS (training_plans/training_plan_schedule_rules/training_sessions are
 * all `select using (true)` -- read access is open, matching the web page's own un-gated reads) plus
 * the one existing batched RPC for the four summary counts. No new RPC, no second query shape.
 */
export interface TrainingPlanningOverview {
  activePlanCount: number
  teamsWithoutPlanCount: number
  upcomingSessionCount: number
  needsAttentionPlanCount: number
}

export interface TrainingPlanTeamRow {
  teamId: string
  teamLabel: string
  teamCoverImagePath: string | null
  teamCoverStockKey: string | null
  /** For the canonical team fallback (`teamFallbackAsset`, media/stock-assets.ts) -- never a Training-Planning-specific photograph. */
  teamCategory: string
  teamAgeGroup: string | null
  teamGender: string | null
  planId: string | null
  planStatus: "ACTIVE" | "INACTIVE" | "NEEDS_ATTENTION" | null
  needsAttentionReason: string | null
  nextSession: { date: string; startTime: string | null; venueName: string | null; pitchName: string | null } | null
}

export interface UpcomingTrainingSession {
  id: string
  teamLabel: string
  date: string
  startTime: string | null
  venueName: string | null
  pitchName: string | null
}

export interface TrainingPlanningHomeData {
  overview: TrainingPlanningOverview
  teams: TrainingPlanTeamRow[]
  upcomingSessions: UpcomingTrainingSession[]
}

export async function loadTrainingPlanningHome(supabase: Client, clubId: string): Promise<TrainingPlanningHomeData> {
  const today = new Date().toISOString().slice(0, 10)

  const [{ data: overviewRows }, orderedTeams, { data: planRows }, { data: nextSessionRows }] = await Promise.all([
    supabase.rpc("get_training_management_overview", { p_club_id: clubId }),
    loadOrderedClubTeams(supabase, clubId),
    supabase.from("training_plans").select("id, team_id, status, needs_attention_reason").eq("club_id", clubId).order("created_at", { ascending: false }),
    supabase
      .from("training_sessions")
      .select("id, team_id, occurrence_date, start_time, venues(name), club_pitches(display_name), teams(display_name, rugby_code, category, age_group, gender, squad_designation)")
      .eq("club_id", clubId)
      .neq("status", "CANCELLED")
      .gte("occurrence_date", today)
      .order("occurrence_date", { ascending: true })
      .order("start_time", { ascending: true })
      .limit(500),
  ])

  const overviewRow = (overviewRows ?? [])[0] as
    | { active_plan_count: number; teams_without_plan_count: number; upcoming_session_count: number; needs_attention_plan_count: number }
    | undefined

  const overview: TrainingPlanningOverview = {
    activePlanCount: overviewRow?.active_plan_count ?? 0,
    teamsWithoutPlanCount: overviewRow?.teams_without_plan_count ?? 0,
    upcomingSessionCount: overviewRow?.upcoming_session_count ?? 0,
    needsAttentionPlanCount: overviewRow?.needs_attention_plan_count ?? 0,
  }

  // Latest non-INACTIVE plan per team, mirroring page.tsx's "any plan that isn't inactive counts as
  // having one" (teamIdsWithAnyPlan) -- but keeping the actual row for status/needs-attention display.
  const planByTeam = new Map<string, { id: string; status: string; needs_attention_reason: string | null }>()
  for (const p of planRows ?? []) {
    if (p.status === "INACTIVE") continue
    if (!planByTeam.has(p.team_id)) planByTeam.set(p.team_id, { id: p.id, status: p.status, needs_attention_reason: p.needs_attention_reason })
  }

  const nextByTeam = new Map<string, { date: string; startTime: string | null; venueName: string | null; pitchName: string | null }>()
  for (const s of nextSessionRows ?? []) {
    if (!s.team_id || nextByTeam.has(s.team_id)) continue
    nextByTeam.set(s.team_id, {
      date: s.occurrence_date ?? "",
      startTime: s.start_time,
      venueName: (s.venues as { name: string } | null)?.name ?? null,
      pitchName: (s.club_pitches as { display_name: string } | null)?.display_name ?? null,
    })
  }

  // Already in canonical rugby order from loadOrderedClubTeams -- never re-sorted here.
  const teams: TrainingPlanTeamRow[] = orderedTeams.map((t) => {
    const plan = planByTeam.get(t.teamId)
    return {
      teamId: t.teamId,
      teamLabel: t.teamLabel,
      teamCoverImagePath: t.coverImagePath,
      teamCoverStockKey: t.coverStockKey,
      teamCategory: t.category,
      teamAgeGroup: t.ageGroup,
      teamGender: t.gender,
      planId: plan?.id ?? null,
      planStatus: (plan?.status as TrainingPlanTeamRow["planStatus"]) ?? null,
      needsAttentionReason: plan?.needs_attention_reason ?? null,
      nextSession: nextByTeam.get(t.teamId) ?? null,
    }
  })

  const upcomingSessions: UpcomingTrainingSession[] = (nextSessionRows ?? []).slice(0, 30).map((s) => ({
    id: s.id,
    teamLabel: s.teams
      ? fullTeamLabel({
          category: s.teams.category as "senior" | "youth" | "colts",
          ageGroup: s.teams.age_group,
          gender: s.teams.gender,
          squadDesignation: s.teams.squad_designation,
          rugbyCode: s.teams.rugby_code as "union" | "league",
        })
      : "Team",
    date: s.occurrence_date ?? "",
    startTime: s.start_time,
    venueName: (s.venues as { name: string } | null)?.name ?? null,
    pitchName: (s.club_pitches as { display_name: string } | null)?.display_name ?? null,
  }))

  return { overview, teams, upcomingSessions }
}

export interface VenuesAndPitchesForClub {
  /** Active venues only -- an inactive venue is not offered for a new recurring plan, the same rule
   * `orderClubTeamsForDisplay` already applies to inactive teams. */
  venues: ClubVenue[]
  /** Active pitches at an active venue only. */
  pitches: ClubPitch[]
}

/**
 * THE CANONICAL VENUE/PITCH SOURCE for Training Planning Page 4 (Venue & Pitch) -- the exact same
 * `readClubVenues` Arena Planning, Pitch Allocation and the Venue Profile screen already read, never a
 * second venue/pitch model invented for the wizard. `training_plans.preferred_venue_id` and
 * `preferred_pitch_id` are real foreign keys into these same two tables (`venues`, `club_pitches`), so
 * selecting here already produces IDs Review & Create's future `save_training_plan` call can use as-is.
 */
export async function loadVenuesAndPitchesForClub(supabase: Client, clubId: string): Promise<VenuesAndPitchesForClub> {
  const all = await readClubVenues(supabase, clubId)
  const venues = all.venues.filter((v) => v.active)
  const activeVenueIds = new Set(venues.map((v) => v.id))
  const pitches = all.pitches.filter((p) => p.active && p.venueId && activeVenueIds.has(p.venueId))
  return { venues, pitches }
}

/**
 * CREATE TRAINING PLAN (Review & Create, Step 6) -- the ONE canonical write, `save_training_plan`
 * (`20270584000000_a_training_plan_keeps_its_own_buffers_and_notes.sql`). It validates every field
 * server-side, creates the plan, replaces its schedule rules, generates every `training_sessions`
 * occurrence for the plan's full season range in the same call, and notifies Team Staff -- there is no
 * separate "generate sessions" or "notify" step for this screen to call itself.
 */
export async function createTrainingPlan(supabase: Client, args: import("./create-plan/review-logic").SaveTrainingPlanArgs): Promise<string> {
  // p_plan_id/p_default_session_notes are genuinely nullable at the SQL level -- the generated Args
  // type just doesn't reflect that (the same known `supabase gen types` limitation the web action's own
  // comment on this RPC explains: it never marks a function parameter's default-null as optional).
  const { data, error } = await supabase.rpc("save_training_plan", {
    p_plan_id: args.p_plan_id,
    p_club_id: args.p_club_id,
    p_team_id: args.p_team_id,
    p_schedule_mode: args.p_schedule_mode,
    p_season_id: args.p_season_id,
    p_preferred_venue_id: args.p_preferred_venue_id,
    p_preferred_pitch_id: args.p_preferred_pitch_id,
    p_rules: args.p_rules,
    p_warm_up_minutes: args.p_warm_up_minutes,
    p_pack_up_minutes: args.p_pack_up_minutes,
    p_default_session_notes: args.p_default_session_notes,
    p_needs_changing_room: args.p_needs_changing_room,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
  if (error) throw error
  return data as string
}

/**
 * PLAN DETAIL -- the destination Training Planning Home's own team row already links to
 * (`/admin/training-planning/plan/[planId]`) once a team has a plan. Reads the plan, its schedule
 * rules and its upcoming sessions with plain selects (the same RLS-open tables Home already reads).
 *
 * "EDIT PLAN DETAILS" (Step 7) reuses this exact loader for its initial values and the exact same
 * `createTrainingPlan`/`save_training_plan` write `Review & Create` uses -- it is the one canonical
 * plan mutation regardless of which screen calls it, never a second persistence path.
 */
export interface TrainingPlanDetailRule {
  weekday: number
  startTime: string
  durationMinutes: number
}

export interface TrainingPlanUpcomingSession {
  id: string
  occurrenceDate: string
  startTime: string | null
  pitchName: string | null
  status: string
  isOverridden: boolean
}

export interface TrainingPlanDetail {
  id: string
  clubId: string
  teamId: string
  teamLabel: string
  scheduleMode: "SEASON" | "SEASON_PRE_SEASON" | "CUSTOM"
  status: string
  needsAttentionReason: string | null
  seasonId: string | null
  seasonName: string | null
  venueId: string | null
  venueName: string | null
  pitchId: string | null
  pitchName: string | null
  warmUpMinutes: number
  packUpMinutes: number
  defaultSessionNotes: string | null
  /** "Needs a changing room" at every session of the plan. */
  needsChangingRoom: boolean
  rules: TrainingPlanDetailRule[]
  upcomingSessions: TrainingPlanUpcomingSession[]
  /** The real total, independent of how many rows `upcomingSessions` was capped to -- Overview's own
   * count must never silently disagree with what Sessions actually lists more of. */
  totalUpcomingCount: number
}

export async function loadTrainingPlanDetail(supabase: Client, planId: string): Promise<TrainingPlanDetail | null> {
  const { data: plan } = await supabase
    .from("training_plans")
    .select(
      "id, club_id, team_id, schedule_mode, status, needs_attention_reason, season_id, preferred_venue_id, preferred_pitch_id, warm_up_minutes, pack_up_minutes, default_session_notes, needs_changing_room, teams(display_name, category, age_group, gender, squad_designation, rugby_code), seasons(name), venues(name), club_pitches(display_name)"
    )
    .eq("id", planId)
    .maybeSingle()
  if (!plan) return null

  const today = new Date().toISOString().slice(0, 10)
  const [{ data: ruleRows }, { data: sessionRows }, { count }] = await Promise.all([
    supabase.from("training_plan_schedule_rules").select("weekday, start_time, duration_minutes").eq("training_plan_id", planId).order("weekday"),
    supabase
      .from("training_sessions")
      .select("id, occurrence_date, start_time, status, is_overridden, club_pitches(display_name)")
      .eq("training_plan_id", planId)
      .eq("status", "PLANNED")
      .gte("occurrence_date", today)
      .order("occurrence_date")
      .limit(30),
    supabase.from("training_sessions").select("id", { count: "exact", head: true }).eq("training_plan_id", planId).eq("status", "PLANNED").gte("occurrence_date", today),
  ])

  const team = plan.teams as { display_name: string; category: string; age_group: string | null; gender: string | null; squad_designation: string | null; rugby_code: string } | null

  return {
    id: plan.id,
    clubId: plan.club_id,
    teamId: plan.team_id,
    teamLabel: team
      ? fullTeamLabel({ category: team.category as "senior" | "youth" | "colts", ageGroup: team.age_group, gender: team.gender, squadDesignation: team.squad_designation, rugbyCode: team.rugby_code as "union" | "league" })
      : "Team",
    scheduleMode: plan.schedule_mode as "SEASON" | "SEASON_PRE_SEASON" | "CUSTOM",
    status: plan.status,
    needsAttentionReason: plan.needs_attention_reason,
    seasonId: plan.season_id,
    seasonName: (plan.seasons as { name: string } | null)?.name ?? null,
    venueId: plan.preferred_venue_id,
    venueName: (plan.venues as { name: string } | null)?.name ?? null,
    pitchId: plan.preferred_pitch_id,
    pitchName: (plan.club_pitches as { display_name: string } | null)?.display_name ?? null,
    warmUpMinutes: plan.warm_up_minutes,
    packUpMinutes: plan.pack_up_minutes,
    defaultSessionNotes: plan.default_session_notes,
    needsChangingRoom: plan.needs_changing_room === true,
    rules: (ruleRows ?? []).map((r) => ({ weekday: r.weekday, startTime: String(r.start_time).slice(0, 5), durationMinutes: r.duration_minutes })),
    upcomingSessions: (sessionRows ?? []).map((s) => ({
      id: s.id,
      occurrenceDate: s.occurrence_date as string,
      startTime: s.start_time ? String(s.start_time).slice(0, 5) : null,
      pitchName: (s.club_pitches as { display_name: string } | null)?.display_name ?? null,
      status: s.status,
      isOverridden: s.is_overridden,
    })),
    totalUpcomingCount: count ?? 0,
  }
}

export interface TrainingPlanSessionsPage {
  rows: TrainingPlanUpcomingSession[]
  total: number
}

/**
 * THE SESSIONS TAB'S OWN READ -- every occurrence the plan has ever generated, PLANNED and
 * CANCELLED alike, oldest first, paginated with `range` rather than the Overview tab's
 * upcoming-only, 30-row `loadTrainingPlanDetail` query. A cancelled row is real history (Section
 * 7's "cancelled history remains preserved"), so it is never filtered out here -- `status` travels
 * through so the caller can label each row Upcoming/Completed/Cancelled itself
 * (`sessionDisplayStatus`), and a session superseded by a later schedule edit appears right next
 * to its cancelled predecessor, in the order they actually happened.
 */
export async function loadTrainingPlanSessions(supabase: Client, planId: string, offset: number, limit: number): Promise<TrainingPlanSessionsPage> {
  const [{ data: rows }, { count }] = await Promise.all([
    supabase
      .from("training_sessions")
      .select("id, occurrence_date, start_time, status, is_overridden, club_pitches(display_name)")
      .eq("training_plan_id", planId)
      .order("occurrence_date")
      .order("status")
      .range(offset, offset + limit - 1),
    supabase.from("training_sessions").select("id", { count: "exact", head: true }).eq("training_plan_id", planId),
  ])
  return {
    rows: (rows ?? []).map((s) => ({
      id: s.id,
      occurrenceDate: s.occurrence_date as string,
      startTime: s.start_time ? String(s.start_time).slice(0, 5) : null,
      pitchName: (s.club_pitches as { display_name: string } | null)?.display_name ?? null,
      status: s.status,
      isOverridden: s.is_overridden,
    })),
    total: count ?? 0,
  }
}

export async function deactivateTrainingPlan(supabase: Client, planId: string, reason: string | null): Promise<void> {
  const { error } = await supabase.rpc("deactivate_training_plan", { p_plan_id: planId, p_reason: reason ?? undefined } as never)
  if (error) throw error
}

export async function reactivateTrainingPlan(supabase: Client, planId: string): Promise<void> {
  const { error } = await supabase.rpc("reactivate_training_plan", { p_plan_id: planId })
  if (error) throw error
}
