import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import { manageableTeams, type SessionContext } from "./session-context"

export interface ConversationSummary {
  /** Which half of fixture_messages' exactly-one-of columns this thread keys off. */
  kind: "request" | "fixture"
  id: string
  myTeamDisplayName: string
  oppositionLabel: string
  date: string | null
  status: string
  latestMessagePreview: string | null
  latestMessageAt: string | null
  unreadCount: number
}

/**
 * Everything this session can hold a fixture-linked conversation about.
 * Team ids come from manageableTeams() (write-authority teams) plus every
 * team at a club where the session holds club-wide fixture authority --
 * "Club Admin/Fixture Secretary may access relevant club-wide fixture
 * conversations" falls out of that for free. RLS (fixture_requests_select_
 * scoped / fixture_messages_select_scoped) is the real boundary regardless
 * of what this query asks for.
 *
 * Once a request is accepted (resulting_fixture_id set), its conversation
 * is represented under the FIXTURE, not the request -- matching how
 * messaging naturally continues after confirmation ("CONFIRMED" is a
 * fixture-status word, not a request-status word).
 */
export async function getConversationSummaries(
  supabase: SupabaseClient<Database>,
  ctx: SessionContext,
  userId: string
): Promise<ConversationSummary[]> {
  // Deliberately NOT getMyTeams -- that also includes view_only (Parent/
  // Player) assignments, correct for "which teams can I see the calendar
  // for" but wrong here: "Parent/Player -> no operational club-to-club
  // messaging" per the brief, and can_manage_team (the actual RLS check on
  // fixture_requests/fixture_messages) already excludes view_only too, so
  // this mirrors the real authorization boundary rather than the broader
  // visibility one.
  const clubWideClubIds = ctx.clubMemberships
    .filter((m) => m.role === "CLUB_ADMIN" || m.role === "FIXTURE_SECRETARY")
    .map((m) => m.clubId)
  const myTeamIds = new Set(manageableTeams(ctx).map((tp) => tp.teamId))
  if (clubWideClubIds.length > 0) {
    const { data: clubTeams } = await supabase.from("teams").select("id").in("club_id", clubWideClubIds).eq("active", true)
    for (const t of clubTeams ?? []) myTeamIds.add(t.id)
  }
  if (myTeamIds.size === 0) return []
  const myTeamIdList = Array.from(myTeamIds)

  const summaries = new Map<string, ConversationSummary>()

  const { data: requests } = await supabase
    .from("fixture_requests")
    .select(
      "id, status, requesting_team_id, target_team_id, resulting_fixture_id, requesting_team:teams!fixture_requests_requesting_team_id_fkey(display_name), target_team:teams!fixture_requests_target_team_id_fkey(display_name), fixture_request_groups(proposed_date, raw_opponent_text)"
    )
    .or(`requesting_team_id.in.(${myTeamIdList.join(",")}),target_team_id.in.(${myTeamIdList.join(",")})`)

  const graduatedFixtureIds: string[] = []

  for (const r of requests ?? []) {
    if (r.status === "accepted" && r.resulting_fixture_id) {
      graduatedFixtureIds.push(r.resulting_fixture_id)
      continue
    }
    const isRequester = myTeamIds.has(r.requesting_team_id)
    summaries.set(`request:${r.id}`, {
      kind: "request",
      id: r.id,
      myTeamDisplayName: (isRequester ? r.requesting_team?.display_name : r.target_team?.display_name) ?? "Team",
      oppositionLabel:
        (isRequester ? r.target_team?.display_name : r.requesting_team?.display_name) ??
        r.fixture_request_groups?.raw_opponent_text ??
        "Opponent",
      date: r.fixture_request_groups?.proposed_date ?? null,
      status: r.status,
      latestMessagePreview: null,
      latestMessageAt: null,
      unreadCount: 0,
    })
  }

  // Fixtures already carrying messages that didn't come from an accepted
  // request in the query above (e.g. a directly-resolved Ovalball-vs-
  // Ovalball fixture) -- found via the messages themselves, never a broad
  // "every fixture for my teams" query (that's the Calendar page's job,
  // not Messages).
  const { data: messagedFixtureRows } = await supabase
    .from("fixture_messages")
    .select("fixture_id")
    .not("fixture_id", "is", null)
  const extraFixtureIds = Array.from(
    new Set((messagedFixtureRows ?? []).map((m) => m.fixture_id).filter((id): id is string => Boolean(id)))
  )

  const fixtureIds = Array.from(new Set([...graduatedFixtureIds, ...extraFixtureIds]))
  if (fixtureIds.length > 0) {
    const { data: fixtures } = await supabase
      .from("fixtures")
      .select(
        "id, kickoff_date, status, owning_team_id, opponent_team_id, owning_team:teams!fixtures_owning_team_id_fkey(display_name), opponent_team:teams!fixtures_opponent_team_id_fkey(display_name), raw_opposition_text"
      )
      .in("id", fixtureIds)

    for (const f of fixtures ?? []) {
      const isOwner = myTeamIds.has(f.owning_team_id)
      const isOpponent = f.opponent_team_id ? myTeamIds.has(f.opponent_team_id) : false
      if (!isOwner && !isOpponent) continue
      summaries.set(`fixture:${f.id}`, {
        kind: "fixture",
        id: f.id,
        myTeamDisplayName: (isOwner ? f.owning_team?.display_name : f.opponent_team?.display_name) ?? "Team",
        oppositionLabel: (isOwner ? f.opponent_team?.display_name : f.owning_team?.display_name) ?? f.raw_opposition_text,
        date: f.kickoff_date,
        status: f.status,
        latestMessagePreview: null,
        latestMessageAt: null,
        unreadCount: 0,
      })
    }
  }

  if (summaries.size === 0) return []

  const requestIds = Array.from(summaries.values()).filter((s) => s.kind === "request").map((s) => s.id)
  const fixtureIdsForMessages = Array.from(summaries.values()).filter((s) => s.kind === "fixture").map((s) => s.id)

  const { data: messages } = await supabase
    .from("fixture_messages")
    .select("fixture_id, fixture_request_id, body, created_at")
    .or(
      [
        requestIds.length > 0 ? `fixture_request_id.in.(${requestIds.join(",")})` : null,
        fixtureIdsForMessages.length > 0 ? `fixture_id.in.(${fixtureIdsForMessages.join(",")})` : null,
      ]
        .filter(Boolean)
        .join(",")
    )
    .order("created_at", { ascending: false })

  for (const m of messages ?? []) {
    const key = m.fixture_id ? `fixture:${m.fixture_id}` : `request:${m.fixture_request_id}`
    const summary = summaries.get(key)
    if (summary && !summary.latestMessageAt) {
      summary.latestMessagePreview = m.body
      summary.latestMessageAt = m.created_at
    }
  }

  const { data: unread } = await supabase
    .from("notifications")
    .select("data")
    .eq("user_id", userId)
    .eq("type", "new_fixture_message")
    .is("read_at", null)

  for (const n of unread ?? []) {
    const data = n.data as { fixture_id?: string; fixture_request_id?: string } | null
    const key = data?.fixture_id ? `fixture:${data.fixture_id}` : data?.fixture_request_id ? `request:${data.fixture_request_id}` : null
    const summary = key ? summaries.get(key) : undefined
    if (summary) summary.unreadCount += 1
  }

  return Array.from(summaries.values()).sort((a, b) => {
    const aTime = a.latestMessageAt ?? a.date ?? ""
    const bTime = b.latestMessageAt ?? b.date ?? ""
    return bTime.localeCompare(aTime)
  })
}
