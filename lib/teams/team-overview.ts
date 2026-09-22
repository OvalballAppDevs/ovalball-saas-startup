import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { loadAgenda, type AgendaItem } from "@/lib/agenda/load"
import { shiftDays } from "@/lib/agenda/window"
import type { Database } from "@/types/database.types"

type Client = SupabaseClient<Database>

/**
 * WHAT A TEAM NEEDS TODAY.
 *
 * One server-side read that answers the questions somebody running a rugby team actually asks on a
 * Monday evening -- what needs me, what is next, who am I responsible for -- assembled from canonical
 * truth and nothing else.
 *
 * IT IS A DOMAIN READ, NOT A PAGE. The Team Operations work is very likely to become a native-app
 * surface, and business meaning that lives only inside a React server component has to be rewritten
 * to get there. So this returns data; the page decides how it looks.
 *
 * EVERY NUMBER HERE COMES FROM SOMEWHERE THAT ALREADY OWNS IT. The fixtures and training come from
 * `loadAgenda` -- the same loader the guardian agenda uses, through the same `teams` scope -- so a
 * parent and a team manager can never be told different things about the same fixture. The counts come
 * from the membership tables. Nothing is computed twice and nothing is invented: a team with no
 * fixtures has no next fixture, and says so, rather than being given a placeholder.
 *
 * AND IT IS NOT AUTHORITY. Every query runs through the caller's own authenticated client, so RLS
 * decides the rows. The team id is passed in because the caller has already resolved which team this
 * session is operating as; asking for another team's id returns that team's empty shape rather than
 * its data.
 */

/** Something that is waiting on this person, derived from canonical state rather than a task table. */
export interface TeamAttentionItem {
  key: string
  /** What is waiting, in the product's words. */
  label: string
  /** Where acting on it happens. Always an in-application path. */
  href: string
  /** How many, where a count is meaningful. */
  count: number
}

export interface TeamOverview {
  teamId: string
  /** The very next fixture or training session, whichever comes first. */
  nextUp: AgendaItem | null
  /** What is coming, nextUp included, so a page can show a short list without a second read. */
  upcoming: AgendaItem[]
  /** The most recent fixture that has a canonical result. Never a fixture that merely happened. */
  lastResult: AgendaItem | null
  people: { players: number; staff: number }
  /**
   * Availability for `nextUp`, where it is a fixture and the viewer may see it.
   *
   * `outstanding` is the number who have not answered, and it is the number a manager actually wants:
   * "who do I still need to chase". Null when there is nothing to ask about.
   */
  availability: { attending: number; unavailable: number; outstanding: number } | null
  attention: TeamAttentionItem[]
}

const EMPTY_PEOPLE = { players: 0, staff: 0 }

/**
 * ONE WINDOW, SO TWO SURFACES CANNOT DISAGREE ABOUT WHAT IS NEXT.
 *
 * The Team page asked for the next 60 days and the dashboard for the next 7, and the review team's
 * next fixture is in January -- so the Team page said "Nothing scheduled yet" while the dashboard
 * said "Nothing scheduled this week", and neither mentioned the fixture. A first attempt at this file
 * used the agenda's `year` mode instead, which spans the whole CALENDAR year and therefore includes
 * dates already past: it duly offered a training session from four days ago as the next thing coming
 * up. Both bugs are the same bug, which is two places deciding separately how far a team can see.
 *
 * A SEASON, FORWARD FROM TODAY. Rugby fixtures are arranged months ahead; sixty days is not a season
 * and a week is not even a block of it. Anchored on today rather than on a calendar boundary, because
 * "next" means next from now.
 */
export function teamAgendaWindows(todayIso: string) {
  return {
    upcoming: {
      startIso: todayIso,
      endIso: shiftDays(todayIso, 365),
      order: "asc" as const,
      label: "the season ahead",
    },
    past: {
      startIso: shiftDays(todayIso, -365),
      endIso: todayIso,
      order: "desc" as const,
      label: "the season behind",
    },
  }
}

export async function loadTeamOverview(supabase: Client, teamId: string): Promise<TeamOverview> {
  const today = new Date().toISOString().slice(0, 10)
  const { upcoming: window, past } = teamAgendaWindows(today)

  const [agenda, history, players, staff] = await Promise.all([
    loadAgenda(supabase, { kind: "teams", teamIds: [teamId], clubId: null }, window, { includeTraining: true }),
    loadAgenda(supabase, { kind: "teams", teamIds: [teamId], clubId: null }, past, { includeTraining: false }),
    supabase
      .from("player_team_memberships")
      .select("id", { count: "exact", head: true })
      .eq("team_id", teamId)
      .eq("status", "active"),
    supabase.from("team_permissions").select("id", { count: "exact", head: true }).eq("team_id", teamId),
  ])

  const upcoming = agenda.items
  const nextUp = upcoming[0] ?? null
  // A RESULT, not merely a past date. A fixture that was played and never scored is not a result, and
  // showing it as one would put a silent 0-0 on the team's page.
  const lastResult = history.items.find((i) => i.result !== null) ?? null

  const attention: TeamAttentionItem[] = []

  // ---- Fixtures somebody has asked this team to play ------------------------
  // Pending in both directions is not the same job: a request SENT is waiting on somebody else, and a
  // request RECEIVED is waiting on us. Only the second belongs in Needs Attention.
  const { count: incomingRequests } = await supabase
    .from("fixture_requests")
    .select("id", { count: "exact", head: true })
    .eq("target_team_id", teamId)
    .eq("status", "pending")
  if (incomingRequests && incomingRequests > 0) {
    attention.push({
      key: "fixture-requests",
      label: incomingRequests === 1 ? "A fixture request is waiting for your answer" : `${incomingRequests} fixture requests are waiting for your answer`,
      href: "/fixtures",
      count: incomingRequests,
    })
  }

  // ---- Who has not said whether they can play -------------------------------
  let availability: TeamOverview["availability"] = null
  if (nextUp && nextUp.kind === "fixture") {
    const { data: responses } = await supabase
      .from("player_fixture_attendance")
      .select("status")
      .eq("fixture_id", nextUp.eventId)

    const answered = responses ?? []
    const attending = answered.filter((r) => r.status === "ATTENDING").length
    const unavailable = answered.filter((r) => r.status === "CANNOT_ATTEND").length
    const squad = players.count ?? 0
    // Never negative: a squad can shrink after answers were given, and "-2 outstanding" is worse than
    // no number at all.
    const outstanding = Math.max(squad - answered.length, 0)
    availability = { attending, unavailable, outstanding }

    if (outstanding > 0) {
      attention.push({
        key: "availability",
        label:
          outstanding === 1
            ? "1 player has not said whether they can play"
            : `${outstanding} players have not said whether they can play`,
        href: `/fixtures/${nextUp.eventId}`,
        count: outstanding,
      })
    }
  }

  return {
    teamId,
    nextUp,
    upcoming,
    lastResult,
    people: { players: players.count ?? EMPTY_PEOPLE.players, staff: staff.count ?? EMPTY_PEOPLE.staff },
    availability,
    attention,
  }
}
