import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

/**
 * THE SEASON PLANNER -- club days over the canonical fixture-request domain.
 *
 * Nothing here is a second fixture system. The three RPCs (20270760000000) read and write ordinary fixture requests;
 * acceptance, decline and counter-proposals stay on the canonical request screens; a fixture appears on the board
 * because the request lifecycle produced it. Authority is the existing club-scope planner check
 * (`fixture.planner.use`), so team staff never reach mass scheduling.
 *
 * The pure helpers below hold the planning rules the screens share: weeks of a season around a playing day, what a
 * team's day already holds, Home/Away defaults, the reverse leg, and the board's states.
 */

type Client = SupabaseClient<Database>

export type CommitmentKind = "fixture" | "competition" | "request_out" | "request_in"

export interface PlannerCommitment {
  date: string
  kind: CommitmentKind
  status: string
  refId: string
  groupId: string | null
  opponent: string | null
  opponentClubId: string | null
  homeAway: "Home" | "Away" | "TBD" | string | null
}

export interface PlannerTeam {
  teamId: string
  displayName: string
  category: string | null
  ageGroup: string | null
  gender: string | null
  /** The opponent club's sides this team may play, by canonical eligibility. Empty means none -- never invented. */
  compatible: { teamId: string; displayName: string }[]
  /** Everything this team already has in the chosen Monday-Sunday week. */
  week: PlannerCommitment[]
  /** Everything already arranged with THIS opponent in the season (for duplicates and the reverse leg). */
  withOpponent: PlannerCommitment[]
  /** The team's playing day (ISO weekday) and where it comes from: its own override, its kind, or the club. */
  preferredDay: IsoWeekday | null
  preferredDaySource: "team" | "category" | "club" | null
}

export interface PlannerClubDay {
  date: string
  weekFrom: string
  weekTo: string
  season: { id: string; name: string; startsOn: string; endsOn: string; structure: SeasonStructure | null } | null
  clubDefaultDay: IsoWeekday | null
  teams: PlannerTeam[]
}

/** current = this season's teams; handed_over = a handover into it is applied; not_finalised = neither yet. */
export type SeasonStructure = "current" | "handed_over" | "not_finalised"

export type SendOutcome = "sent" | "blocked" | "needs_acknowledgement" | "failed"

export interface SendItem {
  requestingTeamId: string
  targetTeamId: string
  venue: "home" | "away"
  acknowledgePending?: boolean
  /** The planner's own note on this fixture. */
  note?: string | null
}

export interface SendResult {
  requestingTeamId: string
  targetTeamId: string | null
  outcome: SendOutcome
  requestId: string | null
  reason: string | null
}

export interface BoardRow {
  teamId: string
  teamName: string
  date: string
  kind: CommitmentKind
  status: string
  refId: string
  groupId: string | null
  opponent: string | null
  opponentClubId: string | null
  /** The opposing club's own name (the label above also carries their team). */
  opponentClubName: string | null
  homeAway: string | null
  planned: boolean
}

function commitment(raw: Record<string, unknown>): PlannerCommitment {
  return {
    date: String(raw.date),
    kind: raw.kind as CommitmentKind,
    status: String(raw.status ?? ""),
    refId: String(raw.ref_id),
    groupId: (raw.group_id as string | null) ?? null,
    opponent: (raw.opponent as string | null) ?? null,
    opponentClubId: (raw.opponent_club_id as string | null) ?? null,
    homeAway: (raw.home_away as string | null) ?? null,
  }
}

/** One opponent, one date: my teams, their compatible sides, and what is already in the way. */
export async function readClubDay(supabase: Client, clubId: string, opponentClubId: string, date: string): Promise<{ ok: true; day: PlannerClubDay } | { ok: false; code: string | null; message: string }> {
  const { data, error } = await supabase.rpc("planner_club_day", { p_club_id: clubId, p_opponent_club_id: opponentClubId, p_date: date })
  if (error || !data) return { ok: false, code: error?.code ?? null, message: error?.message ?? "The club day could not be read." }
  const raw = data as Record<string, unknown>
  const season = raw.season as Record<string, string> | null
  return {
    ok: true,
    day: {
      date: String(raw.date),
      weekFrom: String(raw.week_from),
      weekTo: String(raw.week_to),
      season: season ? { id: season.id, name: season.name, startsOn: season.starts_on, endsOn: season.ends_on, structure: (season.structure as SeasonStructure | null) ?? null } : null,
      clubDefaultDay: (raw.club_default_day as IsoWeekday | null) ?? null,
      teams: ((raw.teams as Record<string, unknown>[]) ?? []).map((t) => ({
        teamId: String(t.team_id),
        displayName: String(t.display_name),
        category: (t.category as string | null) ?? null,
        ageGroup: (t.age_group as string | null) ?? null,
        gender: (t.gender as string | null) ?? null,
        compatible: ((t.compatible as Record<string, string>[]) ?? []).map((c) => ({ teamId: c.team_id, displayName: c.display_name })),
        week: ((t.week as Record<string, unknown>[]) ?? []).map(commitment),
        withOpponent: ((t.with_opponent as Record<string, unknown>[]) ?? []).map(commitment),
        preferredDay: (t.preferred_day as IsoWeekday | null) ?? null,
        preferredDaySource: (t.preferred_day_source as PlannerTeam["preferredDaySource"]) ?? null,
      })),
    },
  }
}

/** Send a club day. The server re-checks every conflict now and answers per team; a replayed batch id creates nothing. */
export async function sendClubDay(
  supabase: Client,
  input: { clubId: string; opponentClubId: string; date: string; batchId: string; items: SendItem[]; reverseOfGroupId?: string | null }
): Promise<{ ok: true; groupId: string | null; replay: boolean; results: SendResult[] } | { ok: false; code: string | null; message: string }> {
  const { data, error } = await supabase.rpc("planner_send_club_day", {
    p_club_id: input.clubId,
    p_opponent_club_id: input.opponentClubId,
    p_date: input.date,
    p_batch_id: input.batchId,
    p_items: input.items.map((i) => ({
      requesting_team_id: i.requestingTeamId,
      target_team_id: i.targetTeamId,
      venue_preference: i.venue,
      acknowledge_pending: Boolean(i.acknowledgePending),
      note: i.note ?? null,
    })),
    p_reverse_of: input.reverseOfGroupId ?? undefined,
  })
  if (error || !data) return { ok: false, code: error?.code ?? null, message: error?.message ?? "The requests could not be sent." }
  const raw = data as Record<string, unknown>
  return {
    ok: true,
    groupId: (raw.group_id as string | null) ?? null,
    replay: Boolean(raw.replay),
    results: ((raw.results as Record<string, unknown>[]) ?? []).map((r) => ({
      requestingTeamId: String(r.requesting_team_id),
      targetTeamId: (r.target_team_id as string | null) ?? null,
      outcome: r.outcome as SendOutcome,
      requestId: (r.request_id as string | null) ?? null,
      reason: (r.reason as string | null) ?? null,
    })),
  }
}

/** Every commitment of the club's teams in one season -- the live board. */
export async function readSeasonBoard(supabase: Client, clubId: string, seasonId: string): Promise<{ ok: true; rows: BoardRow[] } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc("planner_season_board", { p_club_id: clubId, p_season_id: seasonId })
  if (error) return { ok: false, message: error.message }
  return {
    ok: true,
    rows: (data ?? []).map((r) => ({
      teamId: r.team_id,
      teamName: r.team_name,
      date: r.the_date,
      kind: r.kind as CommitmentKind,
      status: r.status,
      refId: r.ref_id,
      groupId: r.group_id ?? null,
      opponent: r.opponent_label ?? null,
      opponentClubId: r.opponent_club_id ?? null,
      opponentClubName: r.opponent_club_name ?? null,
      homeAway: r.home_away ?? null,
      planned: Boolean(r.planned),
    })),
  }
}

// =====================================================================================================================
// PURE PLANNING RULES
// =====================================================================================================================

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const
/** ISO weekday: 1 Monday ... 7 Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

function parse(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`)
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}
export function addDays(dateIso: string, days: number): string {
  const d = parse(dateIso)
  d.setUTCDate(d.getUTCDate() + days)
  return iso(d)
}
export function isoWeekday(dateIso: string): IsoWeekday {
  const day = parse(dateIso).getUTCDay()
  return (day === 0 ? 7 : day) as IsoWeekday
}
export function mondayOfWeek(dateIso: string): string {
  return addDays(dateIso, 1 - isoWeekday(dateIso))
}

export interface PlanningWeek {
  /** Monday of the week. */
  weekStart: string
  /** The club's playing day inside that week. */
  matchDate: string
}

/**
 * THE SEASON AS RUGBY WEEKS: Monday-commencing weeks from the season start to its end, each with the playing day
 * inside it. Weeks whose playing day is outside the season, or already past, are not offered.
 */
export function seasonWeeks(startsOn: string, endsOn: string, playingDay: IsoWeekday, todayIso: string): PlanningWeek[] {
  const weeks: PlanningWeek[] = []
  for (let monday = mondayOfWeek(startsOn); monday <= endsOn; monday = addDays(monday, 7)) {
    const matchDate = addDays(monday, playingDay - 1)
    if (matchDate < startsOn || matchDate > endsOn || matchDate < todayIso) continue
    weeks.push({ weekStart: monday, matchDate })
  }
  return weeks
}

/** What a team's chosen day already holds, in the order the planner must respect it. */
export type TeamDayState =
  | { kind: "ready" }
  | { kind: "no_match" }
  | { kind: "playing"; commitment: PlannerCommitment }
  | { kind: "competition"; commitment: PlannerCommitment }
  | { kind: "already_with_opponent"; commitment: PlannerCommitment }
  | { kind: "incoming_from_opponent"; commitment: PlannerCommitment }
  | { kind: "pending_elsewhere"; commitment: PlannerCommitment }

export function teamDayState(team: PlannerTeam, date: string, opponentClubId: string): TeamDayState {
  const today = team.week.filter((c) => c.date === date)
  const fixture = today.find((c) => c.kind === "fixture")
  if (fixture) return { kind: "playing", commitment: fixture }
  const competition = today.find((c) => c.kind === "competition")
  if (competition) return { kind: "competition", commitment: competition }
  const withThem = today.find((c) => c.opponentClubId === opponentClubId)
  if (withThem) return withThem.kind === "request_in" ? { kind: "incoming_from_opponent", commitment: withThem } : { kind: "already_with_opponent", commitment: withThem }
  if (team.compatible.length === 0) return { kind: "no_match" }
  const pending = today.find((c) => c.kind === "request_out" || c.kind === "request_in")
  if (pending) return { kind: "pending_elsewhere", commitment: pending }
  return { kind: "ready" }
}

/** Selectable at all (a deliberate acknowledgement may still be needed for pending_elsewhere). */
export function canSelect(state: TeamDayState): boolean {
  return state.kind === "ready" || state.kind === "pending_elsewhere"
}

/** Other commitments in the same week (not the chosen day) -- a soft note, never a block. */
export function otherDaysThisWeek(team: PlannerTeam, date: string): PlannerCommitment[] {
  return team.week.filter((c) => c.date !== date && (c.kind === "fixture" || c.kind === "competition"))
}

export type VenueBulk = "alternate" | "home" | "away"

/** Home/Away for the selected teams in the order shown: alternate (Home first), all Home, or all Away. */
export function bulkVenues(teamIds: readonly string[], mode: VenueBulk): Record<string, "home" | "away"> {
  const result: Record<string, "home" | "away"> = {}
  teamIds.forEach((id, index) => {
    result[id] = mode === "home" ? "home" : mode === "away" ? "away" : index % 2 === 0 ? "home" : "away"
  })
  return result
}

/** THE REVERSE LEG: the same pairings with Home and Away inverted -- only what was actually in the first day. */
export function reverseItems(items: readonly SendItem[]): SendItem[] {
  return items.map((i) => ({ requestingTeamId: i.requestingTeamId, targetTeamId: i.targetTeamId, venue: i.venue === "home" ? "away" : "home" }))
}

/**
 * Is there already a return meeting with this opponent in the season? Any live commitment with them on another date
 * counts (a fixture, or a request still open either way). Declined requests do not.
 */
export function existingReturnDates(teams: readonly PlannerTeam[], firstDate: string): string[] {
  const dates = new Set<string>()
  for (const team of teams) {
    for (const c of team.withOpponent) {
      if (c.date === firstDate) continue
      if (c.kind === "request_out" && c.status === "declined") continue
      dates.add(c.date)
    }
  }
  return [...dates].sort()
}

// ---------------------------------------------------------------------------------------------------------------------
// THE BOARD
// ---------------------------------------------------------------------------------------------------------------------

export type BoardState = "confirmed" | "completed" | "pending" | "countered" | "incoming" | "declined" | "competition" | "planned"

/** A board row's state, from the canonical statuses only. */
export function boardState(row: Pick<BoardRow, "kind" | "status">): BoardState {
  if (row.kind === "fixture") return row.status === "Completed" ? "completed" : row.status === "Booked" ? "confirmed" : "planned"
  if (row.kind === "competition") return "competition"
  if (row.kind === "request_in") return "incoming"
  if (row.status === "declined") return "declined"
  if (row.status === "counter_proposed") return "countered"
  return "pending"
}

export const BOARD_STATE_LABEL: Record<BoardState, string> = {
  confirmed: "Confirmed",
  completed: "Played",
  pending: "Pending",
  countered: "New date proposed",
  incoming: "Request received",
  declined: "Declined",
  competition: "Competition",
  planned: "Planned",
}

export interface WeekSummary {
  weekStart: string
  confirmed: number
  pending: number
  incoming: number
  needsAttention: number
  /** Teams with nothing that week (from the club's team list). */
  unfilled: number
}

/** One planning week's counts, over the club's teams. A declined or countered request needs attention. */
export function summariseWeek(rows: readonly BoardRow[], weekStart: string, teamIds: readonly string[]): WeekSummary {
  const weekEnd = addDays(weekStart, 6)
  const inWeek = rows.filter((r) => r.date >= weekStart && r.date <= weekEnd)
  const busyTeams = new Set<string>()
  let confirmed = 0
  let pending = 0
  let incoming = 0
  let needsAttention = 0
  for (const row of inWeek) {
    const state = boardState(row)
    if (state === "declined") {
      needsAttention += 1
      continue
    }
    busyTeams.add(row.teamId)
    if (state === "confirmed" || state === "completed" || state === "competition" || state === "planned") confirmed += 1
    else if (state === "pending") pending += 1
    else if (state === "incoming") incoming += 1
    else if (state === "countered") needsAttention += 1
  }
  return { weekStart, confirmed, pending, incoming, needsAttention, unfilled: teamIds.filter((id) => !busyTeams.has(id)).length }
}

export interface ClubDayRollup {
  groupId: string
  opponent: string | null
  date: string
  confirmed: number
  pending: number
  countered: number
  declined: number
}

/** Planned club days read as one: "Burnley · 7 Nov -- 2 confirmed, 1 countered, 1 declined". */
export function clubDayRollups(rows: readonly BoardRow[]): ClubDayRollup[] {
  const byGroup = new Map<string, ClubDayRollup>()
  for (const row of rows) {
    if (!row.planned || !row.groupId) continue
    const day = byGroup.get(row.groupId) ?? { groupId: row.groupId, opponent: row.opponentClubName ?? row.opponent, date: row.date, confirmed: 0, pending: 0, countered: 0, declined: 0 }
    const state = boardState(row)
    if (state === "confirmed" || state === "completed") day.confirmed += 1
    else if (state === "countered") day.countered += 1
    else if (state === "declined") day.declined += 1
    else if (state === "pending") day.pending += 1
    if (row.date < day.date) day.date = row.date
    byGroup.set(row.groupId, day)
  }
  return [...byGroup.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** "W/C 1 Nov" -- the week as a club secretary says it. */
export function weekCommencingLabel(weekStart: string): string {
  return `W/C ${parse(weekStart).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`
}

/** "Sun 7 Nov" */
export function shortMatchDate(dateIso: string): string {
  return parse(dateIso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
}

/** "Sunday 7 November 2027" */
export function longMatchDate(dateIso: string): string {
  // Built from parts: some engines put a comma after the weekday ("Sunday, 1 November"), which is not how it is said.
  const d = parse(dateIso)
  const part = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-GB", { ...o, timeZone: "UTC" })
  return `${part({ weekday: "long" })} ${part({ day: "numeric" })} ${part({ month: "long" })} ${part({ year: "numeric" })}`
}

// =====================================================================================================================
// A CLUB DAY ANSWERED AS ONE (20270761000000)
// =====================================================================================================================

export interface ClubDayClub {
  id: string
  name: string
  logoPath: string | null
}

export type ClubDayFixtureStatus = "sent" | "accepted" | "declined" | "counter_proposed" | "cancelled" | "expired" | "draft"

export interface ClubDayFixture {
  requestId: string
  status: ClubDayFixtureStatus
  requestingTeamId: string
  requestingTeam: string
  requestingAgeGroup: string | null
  targetTeamId: string | null
  targetTeam: string | null
  /** Home/Away from the PLANNING club's side (the canonical venue preference is the requester's). */
  venue: "home" | "away" | "either" | string
  kickoff: string | null
  date: string
  countered: boolean
  counteredByRequester: boolean
  note: string | null
  counterNote: string | null
  responseNote: string | null
  resultingFixtureId: string | null
}

export interface ClubDayDetail {
  groupId: string
  side: "sent" | "received"
  date: string
  reverseOfGroupId: string | null
  returnGroupIds: string[]
  requestingClub: ClubDayClub
  opponentClub: ClubDayClub
  fixtures: ClubDayFixture[]
}

function club(raw: unknown): ClubDayClub {
  const c = (raw ?? {}) as Record<string, unknown>
  return { id: String(c.id ?? ""), name: String(c.name ?? "Club"), logoPath: (c.logo_path as string | null) ?? null }
}

export async function readClubDayDetail(supabase: Client, groupId: string): Promise<{ ok: true; detail: ClubDayDetail } | { ok: false; code: string | null; message: string }> {
  const { data, error } = await supabase.rpc("planner_club_day_detail", { p_group_id: groupId })
  if (error || !data) return { ok: false, code: error?.code ?? null, message: error?.message ?? "This club day could not be read." }
  const raw = data as Record<string, unknown>
  return {
    ok: true,
    detail: {
      groupId: String(raw.group_id),
      side: raw.side as "sent" | "received",
      date: String(raw.date),
      reverseOfGroupId: (raw.reverse_of_group_id as string | null) ?? null,
      returnGroupIds: ((raw.return_group_ids as string[]) ?? []).map(String),
      requestingClub: club(raw.requesting_club),
      opponentClub: club(raw.opponent_club),
      fixtures: ((raw.fixtures as Record<string, unknown>[]) ?? []).map((f) => ({
        requestId: String(f.request_id),
        status: f.status as ClubDayFixtureStatus,
        requestingTeamId: String(f.requesting_team_id),
        requestingTeam: String(f.requesting_team ?? "Team"),
        requestingAgeGroup: (f.requesting_age_group as string | null) ?? null,
        targetTeamId: (f.target_team_id as string | null) ?? null,
        targetTeam: (f.target_team as string | null) ?? null,
        venue: String(f.venue ?? "either"),
        kickoff: (f.kickoff as string | null) ?? null,
        date: String(f.date),
        countered: Boolean(f.countered),
        counteredByRequester: Boolean(f.countered_by_requester),
        note: (f.note as string | null) ?? null,
        counterNote: (f.counter_note as string | null) ?? null,
        responseNote: (f.response_note as string | null) ?? null,
        resultingFixtureId: (f.resulting_fixture_id as string | null) ?? null,
      })),
    },
  }
}

export type RespondOutcome = "accepted" | "declined" | "already_resolved" | "not_actionable" | "failed"

export interface ClubDaySummary {
  total: number
  accepted: number
  declined: number
  pending: number
  countered: number
  withdrawn: number
}

/** Answer a club day: everything still open (no ids) or the named fixtures. The server re-checks each one. */
export async function respondClubDay(
  supabase: Client,
  input: { groupId: string; action: "accept" | "decline"; requestIds?: string[] | null; notes?: Record<string, string> | null }
): Promise<{ ok: true; results: { requestId: string; outcome: RespondOutcome; reason: string | null }[]; summary: ClubDaySummary } | { ok: false; code: string | null; message: string }> {
  const { data, error } = await supabase.rpc("planner_respond_club_day", {
    p_group_id: input.groupId,
    p_action: input.action,
    p_request_ids: input.requestIds ?? undefined,
    p_notes: input.notes ?? undefined,
  })
  if (error || !data) return { ok: false, code: error?.code ?? null, message: error?.message ?? "The club day could not be answered." }
  const raw = data as Record<string, unknown>
  const sum = (raw.summary ?? {}) as Record<string, number>
  return {
    ok: true,
    results: ((raw.results as Record<string, unknown>[]) ?? []).map((r) => ({ requestId: String(r.request_id), outcome: r.outcome as RespondOutcome, reason: (r.reason as string | null) ?? null })),
    summary: { total: sum.total ?? 0, accepted: sum.accepted ?? 0, declined: sum.declined ?? 0, pending: sum.pending ?? 0, countered: sum.countered ?? 0, withdrawn: sum.withdrawn ?? 0 },
  }
}

export async function noteClubDayFixture(supabase: Client, requestId: string, note: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc("planner_note_club_day_fixture", { p_request_id: requestId, p_note: note })
  return error ? { ok: false, message: error.message } : { ok: true }
}

export interface ClubDayListItem extends ClubDaySummary {
  groupId: string
  direction: "sent" | "received"
  date: string
  opponentClubId: string
  opponentName: string
  opponentLogoPath: string | null
  reverseOfGroupId: string | null
  hasReturn: boolean
}

export async function readClubDays(supabase: Client, clubId: string, seasonId: string): Promise<{ ok: true; days: ClubDayListItem[] } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc("planner_club_days", { p_club_id: clubId, p_season_id: seasonId })
  if (error) return { ok: false, message: error.message }
  return {
    ok: true,
    days: (data ?? []).map((d) => ({
      groupId: d.group_id,
      direction: d.direction as "sent" | "received",
      date: d.the_date,
      opponentClubId: d.opponent_club_id,
      opponentName: d.opponent_name,
      opponentLogoPath: d.opponent_logo_path ?? null,
      total: d.total,
      accepted: d.accepted,
      pending: d.pending,
      countered: d.countered,
      declined: d.declined,
      withdrawn: d.withdrawn,
      reverseOfGroupId: d.reverse_of_group_id ?? null,
      hasReturn: Boolean(d.has_return),
    })),
  }
}

export type PlayingDayCategory = "senior_mens" | "senior_womens" | "colts" | "age_grade"

export interface PlayingDays {
  clubDefault: IsoWeekday | null
  categories: Record<PlayingDayCategory, IsoWeekday | null>
  seasonStructure: SeasonStructure | null
  teams: { teamId: string; displayName: string; category: string | null; gender: string | null; override: IsoWeekday | null; effective: IsoWeekday | null; source: "team" | "category" | "club" | null }[]
}

export async function readPlayingDays(supabase: Client, clubId: string, seasonId?: string | null): Promise<{ ok: true; days: PlayingDays } | { ok: false; code: string | null; message: string }> {
  const { data, error } = await supabase.rpc("planner_playing_days", { p_club_id: clubId, p_season_id: seasonId ?? undefined })
  if (error || !data) return { ok: false, code: error?.code ?? null, message: error?.message ?? "The playing days could not be read." }
  const raw = data as Record<string, unknown>
  const cats = (raw.categories ?? {}) as Record<string, IsoWeekday | null>
  return {
    ok: true,
    days: {
      clubDefault: (raw.club_default as IsoWeekday | null) ?? null,
      categories: { senior_mens: cats.senior_mens ?? null, senior_womens: cats.senior_womens ?? null, colts: cats.colts ?? null, age_grade: cats.age_grade ?? null },
      seasonStructure: (raw.season_structure as SeasonStructure | null) ?? null,
      teams: ((raw.teams as Record<string, unknown>[]) ?? []).map((t) => ({
        teamId: String(t.team_id),
        displayName: String(t.display_name),
        category: (t.category as string | null) ?? null,
        gender: (t.gender as string | null) ?? null,
        override: (t.override as IsoWeekday | null) ?? null,
        effective: (t.effective as IsoWeekday | null) ?? null,
        source: (t.source as "team" | "category" | "club" | null) ?? null,
      })),
    },
  }
}

export async function setClubPlayingDays(
  supabase: Client,
  clubId: string,
  days: { clubDefault: IsoWeekday | null } & Record<PlayingDayCategory, IsoWeekday | null>
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc("set_club_playing_days", {
    p_club_id: clubId,
    p_default: days.clubDefault as number,
    p_senior_mens: days.senior_mens ?? undefined,
    p_senior_womens: days.senior_womens ?? undefined,
    p_colts: days.colts ?? undefined,
    p_age_grade: days.age_grade ?? undefined,
  })
  return error ? { ok: false, message: error.message } : { ok: true }
}

export async function setTeamPlayingDay(supabase: Client, teamId: string, day: IsoWeekday | null): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc("set_team_playing_day", { p_team_id: teamId, p_day: day as number })
  return error ? { ok: false, message: error.message } : { ok: true }
}

/** Which kind of team a team is, for its playing day -- from its own category and gender, nothing invented. */
export function playingDayCategory(category: string | null, gender: string | null): PlayingDayCategory {
  if (category === "senior") return gender === "womens" ? "senior_womens" : "senior_mens"
  if (category === "colts") return "colts"
  return "age_grade"
}

export const PLAYING_DAY_CATEGORY_LABEL: Record<PlayingDayCategory, string> = {
  senior_mens: "Senior Men",
  senior_womens: "Senior Women",
  colts: "Colts",
  age_grade: "Age Grade",
}

/** The club day's own state, from its fixtures' canonical states -- never a made-up batch status. */
export type ClubDayState = "confirmed" | "partly_confirmed" | "awaiting" | "needs_attention" | "declined" | "withdrawn"

export function clubDayState(s: ClubDaySummary): ClubDayState {
  const live = s.total - s.withdrawn
  if (live === 0) return "withdrawn"
  if (s.accepted === live) return "confirmed"
  if (s.declined === live) return "declined"
  if (s.countered > 0) return "needs_attention"
  if (s.accepted > 0) return "partly_confirmed"
  if (s.pending > 0) return "awaiting"
  return "needs_attention"
}

export const CLUB_DAY_STATE_LABEL: Record<ClubDayState, string> = {
  confirmed: "Confirmed",
  partly_confirmed: "Partly confirmed",
  awaiting: "Awaiting reply",
  needs_attention: "Needs attention",
  declined: "Declined",
  withdrawn: "Withdrawn",
}

/** "3 accepted · 1 declined · 2 awaiting decision" */
export function clubDaySummaryWords(s: ClubDaySummary): string {
  const awaiting = s.pending + s.countered
  return [
    s.accepted ? `${s.accepted} accepted` : null,
    s.declined ? `${s.declined} declined` : null,
    awaiting ? `${awaiting} awaiting decision` : null,
  ]
    .filter(Boolean)
    .join(" · ") || "Nothing answered yet"
}

/** The fixture as the receiving club reads it: their side's Home/Away is the reverse of the requester's preference. */
export function venueForSide(venue: string, side: "sent" | "received"): "Home" | "Away" | "TBC" {
  const v = venue === "home" ? "Home" : venue === "away" ? "Away" : "TBC"
  if (side === "sent" || v === "TBC") return v
  return v === "Home" ? "Away" : "Home"
}

/** The reverse of a past club day: every pairing it held, Home/Away inverted, with what happened the first time. */
export interface ReturnPairing extends SendItem {
  previousStatus: ClubDayFixtureStatus
  requestingTeam: string
  targetTeam: string | null
  /** Included by default; a pairing the other club declined is offered too, but labelled. */
  include: boolean
}

export function returnPairings(detail: ClubDayDetail): ReturnPairing[] {
  return detail.fixtures
    .filter((f) => f.targetTeamId && (f.venue === "home" || f.venue === "away"))
    .map((f) => ({
      requestingTeamId: f.requestingTeamId,
      targetTeamId: f.targetTeamId as string,
      venue: f.venue === "home" ? ("away" as const) : ("home" as const),
      previousStatus: f.status,
      requestingTeam: f.requestingTeam,
      targetTeam: f.targetTeam,
      include: f.status !== "cancelled" && f.status !== "expired",
    }))
}
