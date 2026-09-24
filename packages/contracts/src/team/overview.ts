import type { SupabaseClient } from "@supabase/supabase-js"

import { loadAgenda, type AgendaItem } from "../agenda/load"
import { shiftDays } from "../agenda/window"
import type { Database } from "../database"
import { projectTeamAttention, type TeamAttentionItem, ATTENTION_INCOMPLETE_WITHIN_DAYS } from "./attention"
import { noTeamAuthority, readTeamAuthority, type TeamAuthority } from "./authority"
import { loadTeamSubscriptions } from "./subscriptions"

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
    loadAgenda(supabase, scope, past, { includeTraining: false }),
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
          .select("id, kickoff_date, result_submitted_by_club_id")
          .or(`owning_team_id.eq.${teamId},opponent_team_id.eq.${teamId}`)
          .eq("result_status", "awaiting_confirmation")
      : Promise.resolve({ data: [] as { id: string; kickoff_date: string; result_submitted_by_club_id: string | null }[] }),
    authority.callupRequest
      ? supabase.from("fixture_player_call_up").select("id", { count: "exact", head: true }).eq("source_team_id", teamId).eq("status", "requested")
      : Promise.resolve({ count: 0 }),
    authority.rosterManage ? supabase.rpc("team_age_grade_attention", { p_team_id: teamId }) : Promise.resolve({ data: [] as unknown[] }),
    authority.subscriptionView ? loadTeamSubscriptions(supabase, teamId).catch(() => null) : Promise.resolve(null),
  ])

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
    resultConfirmations: ((results.data ?? []) as { id: string; kickoff_date: string; result_submitted_by_club_id: string | null }[])
      .filter((f) => f.result_submitted_by_club_id !== clubId)
      .map((f) => ({ fixtureId: f.id, dateIso: f.kickoff_date })),
    incomingRequests: ((incoming.data ?? []) as { id: string }[]).map((r) => ({ requestId: r.id })),
    pendingJoinRequests: pending.count ?? 0,
    callUpsAwaiting: ("count" in callUps ? callUps.count : 0) ?? 0,
    subscriptionsNeedingAttention: subscriptions ? subscriptions.attentionCount : null,
    ageGradeAttention: ((ageGrade as { data?: unknown[] | null }).data ?? []).length,
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
