import type { SupabaseClient } from "@supabase/supabase-js"

import { loadAgenda, type AgendaItem } from "../agenda/load"
import { shiftDays } from "../agenda/window"
import type { Database } from "../database"
import { projectTeamAttention, type TeamAttentionItem, ATTENTION_INCOMPLETE_WITHIN_DAYS } from "./attention"
import { noTeamAuthority, readTeamAuthority, type TeamAuthority } from "./authority"
import { loadTeamMembershipBoard } from "../membership/board"
import { needsActionCount } from "../membership/operate"

type Client = SupabaseClient<Database>

/**
 * WHAT A TEAM NEEDS TODAY -- one read, both clients (CA-M7; moved from `lib/teams/team-overview.ts`).
 *
 * One read that answers the questions somebody running a rugby team actually asks on a Monday evening --
 * what needs me, what is next, who can play, who am I responsible for -- assembled from canonical truth and
 * nothing else. It is a domain read, not a page: the website's dashboard panel and the app's Team Home
 * both render it, and neither may add a fact of its own.
 *
 * EVERY NUMBER HERE COMES FROM SOMEWHERE THAT ALREADY OWNS IT. The fixtures and training come from
 * `loadAgenda` -- the same loader the guardian agenda uses, through the same `teams` scope -- so a parent
 * and a team manager can never be told different things about the same fixture. Availability comes from
 * `fixture_availability_summary`, which answers only somebody holding `team.attendance.view`; the
 * counts come from the membership tables under RLS; the attention items are `projectTeamAttention`.
 *
 * AND IT IS NOT AUTHORITY. Every query runs through the caller's own authenticated client, so RLS decides
 * the rows, and the one capability read (`readTeamAuthority`) decides only what is worth drawing.
 */
export interface TeamOverview {
  teamId: string
  authority: TeamAuthority
  /** The very next fixture or training session that is on, whichever comes first. */
  nextUp: AgendaItem | null
  /** What is coming, nextUp included, so a page can show a short list without a second read. */
  upcoming: AgendaItem[]
  /** The most recent fixture that has a canonical result. Never a fixture that merely happened. */
  lastResult: AgendaItem | null
  people: { players: number; staff: number; pendingRequests: number }
  /**
   * Availability for the next FIXTURE, where the viewer may see it.
   *
   * `awaiting` is the number who have not answered, and it is the number a manager actually wants:
   * "who do I still need to chase". Null where there is no fixture to ask about, or the server declined.
   */
  availability: { fixtureId: string; squad: number; attending: number; unavailable: number; unsure: number; awaiting: number } | null
  /** Subscription attention, only where the viewer may see it and the club collects through Ovalball. */
  subscriptions: { attentionCount: number; programmeExists: boolean } | null
  attention: TeamAttentionItem[]
}

/**
 * ONE WINDOW, SO TWO SURFACES CANNOT DISAGREE ABOUT WHAT IS NEXT.
 *
 * A season, forward from today. Rugby fixtures are arranged months ahead; sixty days is not a season and
 * a week is not even a block of it. Anchored on today rather than on a calendar boundary, because "next"
 * means next from now.
 */
export function teamAgendaWindows(todayIso: string) {
  return {
    upcoming: { startIso: todayIso, endIso: shiftDays(todayIso, 365), order: "asc" as const, label: "the season ahead" },
    past: { startIso: shiftDays(todayIso, -365), endIso: todayIso, order: "desc" as const, label: "the season behind" },
  }
}

const isOn = (item: AgendaItem) => item.status !== "Cancelled"

export async function loadTeamOverview(supabase: Client, clubId: string, teamId: string, todayIso: string = new Date().toISOString().slice(0, 10)): Promise<TeamOverview> {
  const { upcoming: window, past } = teamAgendaWindows(todayIso)
  const scope = { kind: "teams" as const, teamIds: [teamId], clubId }

  const [authority, agenda, history, players, staff, pending] = await Promise.all([
    readTeamAuthority(supabase, clubId, teamId).catch(() => noTeamAuthority()),
    loadAgenda(supabase, scope, window, { includeTraining: true }),
    loadAgenda(supabase, scope, past, { includeTraining: false, includeTournaments: false }),
    supabase.from("player_team_memberships").select("id", { count: "exact", head: true }).eq("team_id", teamId).eq("status", "active"),
    supabase.from("team_permissions").select("id", { count: "exact", head: true }).eq("team_id", teamId),
    supabase.from("player_team_memberships").select("id", { count: "exact", head: true }).eq("team_id", teamId).eq("status", "pending"),
  ])

  const upcoming = agenda.items
  const nextUp = upcoming.find(isOn) ?? null
  const nextFixture = upcoming.find((i) => i.kind === "fixture" && isOn(i)) ?? null
  // A RESULT, not merely a past date. A fixture that was played and never scored is not a result.
  const lastResult = history.items.find((i) => i.result !== null) ?? null

  // ---- The squad's answers for the next fixture: authority-safe, absent where refused ----------------
  let availability: TeamOverview["availability"] = null
  if (nextFixture && authority.attendanceView) {
    const { data } = await supabase.rpc("fixture_availability_summary", { p_fixture_ids: [nextFixture.eventId] })
    const row = data?.[0]
    if (row) {
      availability = {
        fixtureId: nextFixture.eventId,
        squad: row.squad_count ?? 0,
        attending: row.attending_count ?? 0,
        unavailable: row.unavailable_count ?? 0,
        unsure: row.unsure_count ?? 0,
        awaiting: row.awaiting_count ?? 0,
      }
    }
  }

  // ---- Fixtures somebody has asked this team to play, and changes the other club proposed ----------
  const horizon = shiftDays(todayIso, ATTENTION_INCOMPLETE_WITHIN_DAYS)
  const [incoming, proposals, results, callUps, ageGrade, subscriptions] = await Promise.all([
    authority.requestRespond
      ? supabase.from("fixture_requests").select("id").eq("target_team_id", teamId).eq("status", "sent")
      : Promise.resolve({ data: [] as { id: string }[] }),
    authority.fixtureEdit
      ? supabase
          .from("fixtures")
          .select("id, kickoff_date, kickoff_amendment_proposed_by_club_id")
          .or(`owning_team_id.eq.${teamId},opponent_team_id.eq.${teamId}`)
          .not("kickoff_amendment_proposed_at", "is", null)
          .neq("status", "Cancelled")
          .gte("kickoff_date", todayIso)
      : Promise.resolve({ data: [] as { id: string; kickoff_date: string; kickoff_amendment_proposed_by_club_id: string | null }[] }),
    authority.resultRecord
      ? supabase
          .from("fixtures")
          .select("id, kickoff_date, result_status, result_submitted_by_club_id, result_amendment_proposed_by_club_id")
          .or(`owning_team_id.eq.${teamId},opponent_team_id.eq.${teamId}`)
          .in("result_status", ["awaiting_confirmation", "amendment_pending", "disputed"])
      : Promise.resolve({ data: [] as ResultRow[] }),
    authority.callupRequest
      ? supabase.from("fixture_player_call_up").select("id", { count: "exact", head: true }).eq("source_team_id", teamId).eq("status", "requested")
      : Promise.resolve({ count: 0 }),
    authority.rosterManage ? supabase.rpc("team_age_grade_attention", { p_team_id: teamId }) : Promise.resolve({ data: [] as unknown[] }),
    // The one membership standing: exactly the squad's "Need action" -- Action needed, Overdue, Not set up and
    // Due (a Direct Debit the family has still to finish or start) -- so the home and the Memberships page it
    // opens can never give two different counts. A month simply waiting for its collection day is Collecting.
    authority.subscriptionView
      ? loadTeamMembershipBoard(supabase, teamId)
          .then((b) => ({ attentionCount: b.programmeEnabled ? needsActionCount(b.counts) : 0, programmeExists: b.programmeEnabled }))
          .catch(() => null)
      : Promise.resolve(null),
  ])

  // ---- One more live job, read from its own record (notification correctness pass) ----------------
  const tournamentResults = authority.resultRecord ? await tournamentResultsWaitingOn(supabase, teamId) : []

  const incompleteFixtures = upcoming
    .filter((i) => i.kind === "fixture" && isOn(i) && i.date <= horizon)
    .map((i) => {
      const missing: ("kick-off" | "ground")[] = []
      if (!i.time) missing.push("kick-off")
      if (i.homeAway === "Home" && !i.venue) missing.push("ground")
      return { fixtureId: i.eventId, dateIso: i.date, missing }
    })
    .filter((f) => f.missing.length > 0)

  const attention = projectTeamAttention({
    teamId,
    todayIso,
    authority,
    nextFixture: nextFixture
      ? { fixtureId: nextFixture.eventId, dateIso: nextFixture.date, kickoffTime: nextFixture.time, homeAway: nextFixture.homeAway, venueKnown: Boolean(nextFixture.venue), status: nextFixture.status }
      : null,
    availability: availability ? { squad: availability.squad, awaiting: availability.awaiting } : null,
    incompleteFixtures,
    // Only a change the OTHER club proposed is waiting on us; our own proposal is waiting on them.
    kickoffProposals: ((proposals.data ?? []) as { id: string; kickoff_date: string; kickoff_amendment_proposed_by_club_id: string | null }[])
      .filter((f) => f.kickoff_amendment_proposed_by_club_id !== clubId)
      .map((f) => ({ fixtureId: f.id, dateIso: f.kickoff_date })),
    resultConfirmations: resultsWaitingOn(clubId, (results.data ?? []) as ResultRow[]),
    incomingRequests: ((incoming.data ?? []) as { id: string }[]).map((r) => ({ requestId: r.id })),
    pendingJoinRequests: pending.count ?? 0,
    callUpsAwaiting: ("count" in callUps ? callUps.count : 0) ?? 0,
    subscriptionsNeedingAttention: subscriptions ? subscriptions.attentionCount : null,
    tournamentResultConfirmations: tournamentResults,
    ageGradeAttention: ageGradeNeedingTeam(((ageGrade as { data?: { status: string }[] | null }).data ?? []) as { status: string }[]),
  })

  return {
    teamId,
    authority,
    nextUp,
    upcoming,
    lastResult,
    people: { players: players.count ?? 0, staff: staff.count ?? 0, pendingRequests: pending.count ?? 0 },
    availability,
    subscriptions: subscriptions ? { attentionCount: subscriptions.attentionCount, programmeExists: subscriptions.programmeExists } : null,
    attention,
  }
}

/**
 * A RESULT IS THIS CLUB'S JOB while the next move is theirs: the OTHER club submitted a score
 * (confirm or dispute it), the OTHER club proposed changing a final one (agree or dispute), or the two
 * scores disagree (either club may submit the score it believes). Read from the fixture's own columns
 * every time, so the job disappears the moment the result is final -- never because a notification
 * was read or dismissed.
 */
export type ResultJobState = "awaiting" | "amendment" | "disputed"
interface ResultRow {
  id: string
  kickoff_date: string
  result_status: string | null
  result_submitted_by_club_id: string | null
  result_amendment_proposed_by_club_id: string | null
}
export function resultsWaitingOn(clubId: string | null, rows: ResultRow[]): { fixtureId: string; dateIso: string; state: ResultJobState }[] {
  const out: { fixtureId: string; dateIso: string; state: ResultJobState }[] = []
  for (const f of rows) {
    if (f.result_status === "awaiting_confirmation" && f.result_submitted_by_club_id !== clubId) out.push({ fixtureId: f.id, dateIso: f.kickoff_date, state: "awaiting" })
    else if (f.result_status === "amendment_pending" && f.result_amendment_proposed_by_club_id !== clubId) out.push({ fixtureId: f.id, dateIso: f.kickoff_date, state: "amendment" })
    else if (f.result_status === "disputed") out.push({ fixtureId: f.id, dateIso: f.kickoff_date, state: "disputed" })
  }
  return out
}

/**
 * AN AGE-GRADE ROW IS THE TEAM'S JOB only while the team can do something about it: a player outside
 * the team's grade with no dispensation asked for yet, or a player with no date of birth recorded.
 * Once a dispensation is REQUESTED the decision belongs to the club and the governing body, so it
 * leaves the team's list -- which is what makes the job clear when the manager has done their part.
 * Season or register problems are not something a team can fix and are not counted as its job.
 */
export const TEAM_ACTIONABLE_AGE_GRADE_STATUSES = new Set(["OUTSIDE_AGE_GRADE", "AGE_EVIDENCE_REQUIRED"])
export function ageGradeNeedingTeam(rows: { status: string }[]): number {
  return rows.filter((r) => TEAM_ACTIONABLE_AGE_GRADE_STATUSES.has(r.status)).length
}

/**
 * TOURNAMENT GAMES WAITING ON THIS TEAM: the other side submitted a score and this team has not
 * confirmed or contested it. Read from `tournament_games` itself, so the job ends with the state.
 */
export async function tournamentResultsWaitingOn(supabase: Client, teamId: string): Promise<{ gameId: string; dateIso: string }[]> {
  const { data: sides } = await supabase.from("tournament_participants").select("id").eq("team_id", teamId)
  const ids = (sides ?? []).map((s) => s.id)
  if (ids.length === 0) return []
  const list = ids.join(",")
  const { data } = await supabase
    .from("tournament_games")
    .select("id, game_date, result_submitted_by_participant_id")
    .or(`side_a_id.in.(${list}),side_b_id.in.(${list})`)
    .eq("result_status", "awaiting_confirmation")
  return (data ?? [])
    .filter((g) => !ids.includes(g.result_submitted_by_participant_id ?? ""))
    .map((g) => ({ gameId: g.id, dateIso: g.game_date ?? "" }))
}

// No team stage: a dispensation onto this team is decided by the club's Safeguarding Officer or a Club Admin
// (20270742000000), so nothing here counts dispensations "awaiting the team".
