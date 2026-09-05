import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import { resolveClubLogoUrl } from "./club-logo"
import { manageableTeams, type SessionContext } from "./session-context"

export interface ConversationSummary {
  /** Which half of fixture_messages' exactly-one-of columns this thread keys off. */
  kind: "request" | "fixture"
  id: string
  myClubName: string
  myTeamDisplayName: string
  myClubLogoUrl: string | null
  opponentClubName: string
  oppositionLabel: string
  opponentClubLogoUrl: string | null
  date: string | null
  status: string
  latestMessagePreview: string | null
  latestMessageAt: string | null
  latestMessageSenderName: string | null
  unreadCount: number
}

type ClubRef = { logo_storage_path: string | null; club_directory: { name: string; logo_storage_path: string | null } | null } | null | undefined

function logoUrlFrom(supabase: SupabaseClient<Database>, club: ClubRef): string | null {
  return resolveClubLogoUrl(supabase, club)
}

function clubNameFrom(club: ClubRef): string {
  return club?.club_directory?.name ?? "Ovalball"
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

  const CLUB_LOGO_SELECT = "clubs(logo_storage_path, club_directory(name, logo_storage_path))"

  const { data: requests } = await supabase
    .from("fixture_requests")
    .select(
      `id, status, requesting_team_id, target_team_id, resulting_fixture_id, requesting_team:teams!fixture_requests_requesting_team_id_fkey(display_name, ${CLUB_LOGO_SELECT}), target_team:teams!fixture_requests_target_team_id_fkey(display_name, ${CLUB_LOGO_SELECT}), fixture_request_groups(proposed_date, raw_opponent_text)`
    )
    .or(`requesting_team_id.in.(${myTeamIdList.join(",")}),target_team_id.in.(${myTeamIdList.join(",")})`)

  const graduatedFixtureIds: string[] = []

  for (const r of requests ?? []) {
    if (r.status === "accepted" && r.resulting_fixture_id) {
      graduatedFixtureIds.push(r.resulting_fixture_id)
      continue
    }
    const isRequester = myTeamIds.has(r.requesting_team_id)
    const myTeam = isRequester ? r.requesting_team : r.target_team
    const oppTeam = isRequester ? r.target_team : r.requesting_team
    summaries.set(`request:${r.id}`, {
      kind: "request",
      id: r.id,
      myClubName: clubNameFrom(myTeam?.clubs),
      myTeamDisplayName: myTeam?.display_name ?? "Team",
      myClubLogoUrl: logoUrlFrom(supabase, myTeam?.clubs),
      opponentClubName: oppTeam ? clubNameFrom(oppTeam.clubs) : (r.fixture_request_groups?.raw_opponent_text ?? "Opponent"),
      oppositionLabel: oppTeam?.display_name ?? r.fixture_request_groups?.raw_opponent_text ?? "Opponent",
      opponentClubLogoUrl: logoUrlFrom(supabase, oppTeam?.clubs),
      date: r.fixture_request_groups?.proposed_date ?? null,
      status: r.status,
      latestMessagePreview: null,
      latestMessageAt: null,
      latestMessageSenderName: null,
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
        `id, kickoff_date, status, owning_team_id, opponent_team_id, owning_team:teams!fixtures_owning_team_id_fkey(display_name, ${CLUB_LOGO_SELECT}), opponent_team:teams!fixtures_opponent_team_id_fkey(display_name, ${CLUB_LOGO_SELECT}), raw_opposition_text`
      )
      .in("id", fixtureIds)

    for (const f of fixtures ?? []) {
      const isOwner = myTeamIds.has(f.owning_team_id)
      const isOpponent = f.opponent_team_id ? myTeamIds.has(f.opponent_team_id) : false
      if (!isOwner && !isOpponent) continue
      const myTeam = isOwner ? f.owning_team : f.opponent_team
      const oppTeam = isOwner ? f.opponent_team : f.owning_team
      summaries.set(`fixture:${f.id}`, {
        kind: "fixture",
        id: f.id,
        myClubName: clubNameFrom(myTeam?.clubs),
        myTeamDisplayName: myTeam?.display_name ?? "Team",
        myClubLogoUrl: logoUrlFrom(supabase, myTeam?.clubs),
        opponentClubName: oppTeam ? clubNameFrom(oppTeam.clubs) : (f.raw_opposition_text ?? "Opponent"),
        oppositionLabel: oppTeam?.display_name ?? f.raw_opposition_text,
        opponentClubLogoUrl: logoUrlFrom(supabase, oppTeam?.clubs),
        date: f.kickoff_date,
        status: f.status,
        latestMessagePreview: null,
        latestMessageAt: null,
        latestMessageSenderName: null,
        unreadCount: 0,
      })
    }
  }

  if (summaries.size === 0) return []

  const requestIds = Array.from(summaries.values()).filter((s) => s.kind === "request").map((s) => s.id)
  const fixtureIdsForMessages = Array.from(summaries.values()).filter((s) => s.kind === "fixture").map((s) => s.id)

  const { data: messages } = await supabase
    .from("fixture_messages")
    .select("fixture_id, fixture_request_id, body, created_at, sender_user_id")
    .or(
      [
        requestIds.length > 0 ? `fixture_request_id.in.(${requestIds.join(",")})` : null,
        fixtureIdsForMessages.length > 0 ? `fixture_id.in.(${fixtureIdsForMessages.join(",")})` : null,
      ]
        .filter(Boolean)
        .join(",")
    )
    .order("created_at", { ascending: false })

  const latestSenderIds = new Set<string>()
  const latestByKey = new Map<string, { body: string; createdAt: string; senderId: string }>()
  for (const m of messages ?? []) {
    const key = m.fixture_id ? `fixture:${m.fixture_id}` : `request:${m.fixture_request_id}`
    if (!latestByKey.has(key)) {
      latestByKey.set(key, { body: m.body, createdAt: m.created_at, senderId: m.sender_user_id })
      latestSenderIds.add(m.sender_user_id)
    }
  }

  // profiles_select_self_or_admin blocks a plain SELECT of anyone else's
  // row -- resolve through the same SECURITY DEFINER path
  // resolveParticipantIdentities uses, scoped to every club this session
  // has real standing at (the caller's own clubs are always a safe set to
  // pass -- get_conversation_participant_names still independently checks
  // the caller has standing at one of them before returning anything).
  const { data: myTeamClubRows } =
    myTeamIdList.length > 0 ? await supabase.from("teams").select("club_id").in("id", myTeamIdList) : { data: [] }
  const relevantClubIds = Array.from(new Set([...clubWideClubIds, ...(myTeamClubRows ?? []).map((t) => t.club_id)]))

  const { data: senderProfiles } =
    latestSenderIds.size > 0 && relevantClubIds.length > 0
      ? await supabase.rpc("get_conversation_participant_names", {
          p_user_ids: Array.from(latestSenderIds),
          p_club_ids: relevantClubIds,
        })
      : { data: [] }
  const senderNameById = new Map((senderProfiles ?? []).map((p) => [p.user_id, p.first_name || "Someone"]))

  for (const [key, latest] of latestByKey) {
    const summary = summaries.get(key)
    if (!summary) continue
    summary.latestMessagePreview = latest.body
    summary.latestMessageAt = latest.createdAt
    summary.latestMessageSenderName = latest.senderId === userId ? "You" : (senderNameById.get(latest.senderId) ?? "Someone")
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

export interface ClubConversationSummary {
  kind: "club"
  id: string
  myClubName: string
  myClubLogoUrl: string | null
  opponentClubName: string
  opponentClubLogoUrl: string | null
  status: "pending" | "accepted"
  direction: "incoming" | "outgoing"
  latestMessagePreview: string | null
  latestMessageAt: string | null
  latestMessageSenderName: string | null
  unreadCount: number
  requestedAt: string
}

/**
 * Direct club-to-club conversations -- entirely separate from
 * getConversationSummaries above (which stays fixture/request-scoped,
 * untouched). Declined requests are excluded here; the recipient/
 * requester still see them via respond_to_club_conversation's own
 * notification at the moment they're declined, but they don't linger in
 * an ongoing list. club-wide fixture authority (CLUB_ADMIN/FIXTURE_
 * SECRETARY) is the same boundary used for fixture-scoped club-wide
 * conversations -- a club conversation is club-level by definition, so
 * there is no narrower team-level access to consider here.
 */
export async function getClubConversationSummaries(
  supabase: SupabaseClient<Database>,
  ctx: SessionContext,
  userId: string
): Promise<ClubConversationSummary[]> {
  const clubWideClubIds = ctx.clubMemberships.filter((m) => m.role === "CLUB_ADMIN" || m.role === "FIXTURE_SECRETARY").map((m) => m.clubId)
  if (clubWideClubIds.length === 0) return []

  const { data: rows } = await supabase
    .from("club_conversations")
    .select(
      `id, requesting_club_id, recipient_club_id, status, created_at, requesting_club:clubs!club_conversations_requesting_club_id_fkey(logo_storage_path, club_directory(name, logo_storage_path)), recipient_club:clubs!club_conversations_recipient_club_id_fkey(logo_storage_path, club_directory(name, logo_storage_path))`
    )
    .or(`requesting_club_id.in.(${clubWideClubIds.join(",")}),recipient_club_id.in.(${clubWideClubIds.join(",")})`)
    .neq("status", "declined")

  const summaries = new Map<string, ClubConversationSummary>()
  for (const r of rows ?? []) {
    const iAmRequester = clubWideClubIds.includes(r.requesting_club_id)
    const myClub = iAmRequester ? r.requesting_club : r.recipient_club
    const opponentClub = iAmRequester ? r.recipient_club : r.requesting_club
    summaries.set(`club:${r.id}`, {
      kind: "club",
      id: r.id,
      myClubName: clubNameFrom(myClub),
      myClubLogoUrl: logoUrlFrom(supabase, myClub),
      opponentClubName: clubNameFrom(opponentClub),
      opponentClubLogoUrl: logoUrlFrom(supabase, opponentClub),
      status: r.status as "pending" | "accepted",
      direction: iAmRequester ? "outgoing" : "incoming",
      latestMessagePreview: null,
      latestMessageAt: null,
      latestMessageSenderName: null,
      unreadCount: 0,
      requestedAt: r.created_at,
    })
  }
  if (summaries.size === 0) return []

  const ids = Array.from(summaries.values()).map((s) => s.id)
  const { data: messages } = await supabase
    .from("fixture_messages")
    .select("club_conversation_id, body, created_at, sender_user_id, kind")
    .in("club_conversation_id", ids)
    .order("created_at", { ascending: false })

  const latestSenderIds = new Set<string>()
  const latestByKey = new Map<string, { body: string; createdAt: string; senderId: string; isSystemEvent: boolean }>()
  for (const m of messages ?? []) {
    const key = `club:${m.club_conversation_id}`
    if (!latestByKey.has(key)) {
      latestByKey.set(key, { body: m.body, createdAt: m.created_at, senderId: m.sender_user_id, isSystemEvent: m.kind === "system_event" })
      if (m.kind !== "system_event") latestSenderIds.add(m.sender_user_id)
    }
  }

  const { data: senderProfiles } =
    latestSenderIds.size > 0
      ? await supabase.rpc("get_conversation_participant_names", { p_user_ids: Array.from(latestSenderIds), p_club_ids: clubWideClubIds })
      : { data: [] }
  const senderNameById = new Map((senderProfiles ?? []).map((p) => [p.user_id, p.first_name || "Someone"]))

  for (const [key, latest] of latestByKey) {
    const summary = summaries.get(key)
    if (!summary) continue
    summary.latestMessagePreview = latest.body
    summary.latestMessageAt = latest.createdAt
    summary.latestMessageSenderName = latest.isSystemEvent ? null : latest.senderId === userId ? "You" : (senderNameById.get(latest.senderId) ?? "Someone")
  }

  const { data: unread } = await supabase
    .from("notifications")
    .select("data")
    .eq("user_id", userId)
    .eq("type", "new_fixture_message")
    .is("read_at", null)

  for (const n of unread ?? []) {
    const data = n.data as { club_conversation_id?: string } | null
    const key = data?.club_conversation_id ? `club:${data.club_conversation_id}` : null
    const summary = key ? summaries.get(key) : undefined
    if (summary) summary.unreadCount += 1
  }

  return Array.from(summaries.values()).sort((a, b) => (b.latestMessageAt ?? b.requestedAt).localeCompare(a.latestMessageAt ?? a.requestedAt))
}
