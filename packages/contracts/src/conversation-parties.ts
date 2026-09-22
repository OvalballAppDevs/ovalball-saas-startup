import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "./database"
import type { SessionContext } from "./session-context"
import { resolvePersonalAvatarUrls } from "./personal-avatar"

/**
 * WHO A GROUP CONVERSATION IS ACTUALLY BETWEEN.
 *
 * A fixture, request or club thread is an ORGANISATIONAL conversation: it belongs to two clubs and,
 * for a fixture or a request, to the two teams playing. Everything a reader needs beyond the messages
 * themselves comes from those three facts -- which names to resolve, which role labels are relevant,
 * who counts as a participant, and who may be added.
 *
 * THIS EXISTS BECAUSE THE MOBILE CLIENT GOT IT WRONG BY COPYING TOO LITTLE. Its own conversation
 * loader passed `clubIds: []` for a fixture thread, which is not an error anywhere -- it simply means
 * `resolveParticipantIdentities` has nothing to scope a name lookup to, and
 * `get_conversation_participant_names` is never called. Every message in a fixture conversation then
 * rendered as "Ovalball user · Member" with initials instead of a face, on a screen where the whole
 * point is knowing who said something. The names were never missing from the database; nobody asked
 * for them.
 *
 * So the derivation lives HERE, once, and both clients call it. The website keeps building its own
 * richer header -- it also needs the result, the competition, the pitch and the kickoff amendment,
 * which a phone does not -- but the three facts that decide IDENTITY are no longer derived twice.
 *
 * NOTHING HERE IS AUTHORITY. Every read goes through RLS or a SECURITY DEFINER RPC already scoped to
 * the caller: a conversation this person is not party to returns nothing, and the caller gets null.
 * The participant list is a VIEW of who has access, never the thing that grants it --
 * `internal.can_access_fixture_conversation` decides that, and it is what the RPCs re-check.
 */

export type GroupConversationKind = "fixture" | "request" | "club"

export interface ConversationParties {
  /** The shared conversation id a fixture or club thread is keyed by; null for a request. */
  conversationId: string | null
  /** Both clubs party to the conversation. Scopes every name and role label resolved for it. */
  clubIds: string[]
  /** Both teams, for a fixture or request. Empty for a club conversation, which has no teams. */
  teams: { id: string; displayName: string; clubName: string; clubId: string }[]
}

const TEAM_SELECT =
  "id, display_name, club_id, clubs(club_directory(name))"

export async function resolveConversationParties(
  supabase: SupabaseClient<Database>,
  kind: GroupConversationKind,
  id: string
): Promise<ConversationParties | null> {
  if (kind === "club") {
    const { data } = await supabase
      .from("club_conversations")
      .select("id, requesting_club_id, recipient_club_id")
      .eq("id", id)
      .maybeSingle()
    if (!data) return null
    return {
      conversationId: data.id,
      clubIds: [data.requesting_club_id, data.recipient_club_id].filter((v): v is string => Boolean(v)),
      teams: [],
    }
  }

  if (kind === "fixture") {
    const { data } = await supabase
      .from("fixtures")
      .select(
        `id, conversation_id, owning_team:teams!fixtures_owning_team_id_fkey(${TEAM_SELECT}), opponent_team:teams!fixtures_opponent_team_id_fkey(${TEAM_SELECT})`
      )
      .eq("id", id)
      .maybeSingle()
    if (!data) return null
    // AN OPPONENT WHO IS NOT ON OVALBALL HAS NO TEAM ROW, and that is the common case for a club in
    // its first season. One team and one club is a complete answer, not a half-failure.
    return {
      conversationId: data.conversation_id ?? id,
      ...await sides(supabase, [data.owning_team, data.opponent_team]),
    }
  }

  const { data } = await supabase
    .from("fixture_requests")
    .select(
      `id, requesting_team:teams!fixture_requests_requesting_team_id_fkey(${TEAM_SELECT}), target_team:teams!fixture_requests_target_team_id_fkey(${TEAM_SELECT}), fixture_request_groups(requesting_club_id, opponent_club_id)`
    )
    .eq("id", id)
    .maybeSingle()
  if (!data) return null

  const fromTeams = await sides(supabase, [data.requesting_team, data.target_team])
  return {
    // A REQUEST HAS NO MIRROR ROW, so it is keyed by its own id rather than by a shared conversation.
    conversationId: null,
    // The request group names both clubs even when a team is not on Ovalball, so it is preferred and
    // the team-derived ids only fill what it leaves out.
    clubIds: Array.from(
      new Set(
        [data.fixture_request_groups?.requesting_club_id, data.fixture_request_groups?.opponent_club_id, ...fromTeams.clubIds].filter(
          (v): v is string => Boolean(v)
        )
      )
    ),
    teams: fromTeams.teams,
  }
}

type TeamRow = { id: string; display_name: string; club_id: string; clubs: { club_directory: { name: string } | null } | null } | null

/**
 * The two sides, with their aliases applied.
 *
 * A club that calls its side something of its own has a `team_aliases` row, and the website uses it
 * when labelling a team in a conversation. Reading it here means the phone and the browser call the
 * same team the same thing, rather than one of them showing the canonical name.
 */
async function sides(
  supabase: SupabaseClient<Database>,
  rows: (TeamRow | TeamRow[])[]
): Promise<{ clubIds: string[]; teams: ConversationParties["teams"] }> {
  const teams = rows.flat().filter((t): t is NonNullable<TeamRow> => Boolean(t))
  const teamIds = teams.map((t) => t.id)
  const { data: aliases } = teamIds.length
    ? await supabase.from("team_aliases").select("team_id, alias").in("team_id", teamIds)
    : { data: [] as { team_id: string; alias: string }[] }
  const aliasByTeam = new Map((aliases ?? []).map((a) => [a.team_id, a.alias]))

  return {
    clubIds: Array.from(new Set(teams.map((t) => t.club_id).filter(Boolean))),
    teams: teams.map((t) => ({
      id: t.id,
      displayName: aliasByTeam.get(t.id) || t.display_name,
      clubName: t.clubs?.club_directory?.name ?? "Ovalball",
      clubId: t.club_id,
    })),
  }
}

/**
 * WHO IS IN THIS CONVERSATION, and it is not "every member of both clubs".
 *
 * It is the people `internal.can_access_fixture_conversation` actually admits -- Club Admins and
 * Fixture Secretaries at either club, and team officials on either team -- plus anybody explicitly
 * added to this one conversation. Parents and players are not here, because they are not in it.
 *
 * SOMEBODY WHO LEFT IS NOT LISTED, and that is separate from whether they may return: leaving is a
 * subscription, access is a role. A person who left keeps the right to rejoin and simply stops being
 * shown as present.
 */
export interface ConversationParticipant {
  userId: string
  name: string
  roleLabel: string
  clubId: string
  clubName: string
  avatarUrl: string | null
  lastActiveAt: string | null
  /** True for the viewer's own row, so an interface can say "You" rather than offering to block them. */
  isMe: boolean
}

export interface ConversationParticipants {
  participants: ConversationParticipant[]
  /** The viewer's own subscription state for this conversation. */
  muted: boolean
  left: boolean
}

const CLUB_ROLE_LABEL: Record<string, string> = { CLUB_ADMIN: "Club Admin", FIXTURE_SECRETARY: "Fixtures Admin" }
const TEAM_PERMISSION_LABEL: Record<string, string> = {
  team_admin: "Team Admin",
  coach: "Coach",
  manager: "Manager",
  view_only: "Parent/Player",
}

export async function loadConversationParticipants(
  supabase: SupabaseClient<Database>,
  kind: GroupConversationKind,
  id: string,
  parties: ConversationParties,
  viewerId: string
): Promise<ConversationParticipants> {
  const clubIds = parties.clubIds
  const teamIds = parties.teams.map((t) => t.id)
  const column = kind === "request" ? "fixture_request_id" : "fixture_id"

  const [officials, teamOfficials, added, subscriptions] = await Promise.all([
    clubIds.length
      ? supabase
          .from("club_memberships")
          .select("user_id, role, club_id, clubs(club_directory(name))")
          .in("club_id", clubIds)
          .in("role", ["CLUB_ADMIN", "FIXTURE_SECRETARY"])
          .eq("status", "active")
      : Promise.resolve({ data: [] as never[] }),
    teamIds.length
      ? supabase
          .from("team_permissions")
          .select("permission, team_id, club_memberships!inner(user_id, status, club_id, clubs(club_directory(name)))")
          .in("team_id", teamIds)
          .in("permission", ["team_admin", "coach", "manager"])
          .eq("club_memberships.status", "active")
      : Promise.resolve({ data: [] as never[] }),
    // A club conversation has no explicit-participant table of its own; the two tables below are keyed
    // by fixture or request, so they are simply not asked for one.
    kind === "club"
      ? Promise.resolve({ data: [] as { user_id: string }[] })
      : supabase.from("fixture_conversation_participants").select("user_id").eq(column, id),
    kind === "club"
      ? Promise.resolve({ data: [] as { user_id: string; muted: boolean; left_at: string | null }[] })
      : supabase.from("fixture_conversation_subscriptions").select("user_id, muted, left_at").eq(column, id),
  ])

  const seen = new Set<string>()
  const participants: ConversationParticipant[] = []
  const add = (userId: string, roleLabel: string, clubId: string, clubName: string) => {
    if (!userId || seen.has(userId)) return
    seen.add(userId)
    participants.push({ userId, name: "", roleLabel, clubId, clubName, avatarUrl: null, lastActiveAt: null, isMe: userId === viewerId })
  }

  for (const row of officials.data ?? []) {
    add(row.user_id, CLUB_ROLE_LABEL[row.role] ?? row.role, row.club_id, row.clubs?.club_directory?.name ?? "Ovalball")
  }
  for (const row of teamOfficials.data ?? []) {
    const membership = row.club_memberships as unknown as
      | { user_id: string; club_id: string; clubs: { club_directory: { name: string } | null } | null }
      | null
    if (!membership) continue
    add(
      membership.user_id,
      TEAM_PERMISSION_LABEL[row.permission ?? ""] ?? (row.permission ?? "Member"),
      membership.club_id,
      membership.clubs?.club_directory?.name ?? "Ovalball"
    )
  }

  // EXPLICITLY ADDED PEOPLE. Their club comes from their own active membership rather than being
  // assumed from the conversation's clubs -- `add_fixture_conversation_participant` has already
  // constrained it to one of them, so reading it back is cheap and cannot be wrong.
  const addedIds = (added.data ?? []).map((r) => r.user_id).filter((uid) => !seen.has(uid))
  const { data: addedMemberships } =
    addedIds.length && clubIds.length
      ? await supabase
          .from("club_memberships")
          .select("user_id, club_id, clubs(club_directory(name))")
          .in("user_id", addedIds)
          .in("club_id", clubIds)
          .eq("status", "active")
      : { data: [] as never[] }
  for (const membership of addedMemberships ?? []) {
    add(membership.user_id, "Added to conversation", membership.club_id, membership.clubs?.club_directory?.name ?? "Ovalball")
  }

  // NAMES THROUGH THE SECURITY DEFINER RPC, not a table read. `profiles_select_self_or_admin` blocks
  // an ordinary member from selecting somebody else's profile row, so a plain query here would return
  // nothing and every participant would be called "Ovalball user" -- which is exactly the failure this
  // module was written to end.
  const { data: profiles } =
    seen.size && clubIds.length
      ? await supabase.rpc("get_conversation_participant_names", { p_user_ids: [...seen], p_club_ids: clubIds })
      : { data: [] as never[] }

  const avatars = await resolvePersonalAvatarUrls(supabase, (profiles ?? []).map((p) => p.avatar_storage_path))
  const byId = new Map((profiles ?? []).map((p) => [p.user_id, p]))
  for (const participant of participants) {
    const profile = byId.get(participant.userId)
    participant.name = [profile?.first_name, profile?.surname].filter(Boolean).join(" ") || "Ovalball user"
    participant.lastActiveAt = profile?.last_active_at ?? null
    participant.avatarUrl = profile?.avatar_storage_path ? (avatars.get(profile.avatar_storage_path) ?? null) : null
  }

  const left = new Set((subscriptions.data ?? []).filter((s) => s.left_at !== null).map((s) => s.user_id))
  const mine = (subscriptions.data ?? []).find((s) => s.user_id === viewerId)

  return {
    // ALPHABETICAL, AND PRESENCE NEVER REORDERS ANYBODY. A list that rearranges itself as people come
    // online is a list you cannot scan twice.
    participants: participants
      .filter((p) => !left.has(p.userId))
      .sort((a, b) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" })),
    muted: mine?.muted ?? false,
    left: left.has(viewerId),
  }
}

/**
 * Whether the viewer may add or remove people here.
 *
 * MIRRORED FOR THE INTERFACE ONLY. The RPCs re-check it themselves and are the real boundary, so the
 * worst this can do is show a control that is then refused -- never grant anything. It is derived from
 * the session context both clients already hold rather than from another round trip.
 */
export function canManageConversationParticipants(ctx: SessionContext, parties: ConversationParties): boolean {
  if (ctx.isSiteAdmin) return true
  const clubIds = new Set(parties.clubIds)
  const teamIds = new Set(parties.teams.map((t) => t.id))
  return (
    ctx.clubMemberships.some((m) => (m.role === "CLUB_ADMIN" || m.role === "FIXTURE_SECRETARY") && clubIds.has(m.clubId)) ||
    ctx.teamPermissions.some(
      (tp) => (tp.permission === "team_admin" || tp.permission === "coach" || tp.permission === "manager") && teamIds.has(tp.teamId)
    )
  )
}

/**
 * People at BOTH clubs who could be added to this conversation.
 *
 * `list_addable_club_members` re-checks `can_access_fixture_conversation` inside itself, so a caller
 * with no standing here gets an empty list rather than an error that would confirm the fixture exists.
 * It returns operational contacts only -- never parents or players.
 *
 * `blockedByMe` reports the VIEWER'S OWN decision back to them, which is safe. There is deliberately no
 * "they blocked me" flag: a disabled row with any reason attached is still an answer to a question
 * nobody is entitled to ask.
 */
export interface AddableMember {
  userId: string
  name: string
  blockedByMe: boolean
}

export async function listAddableMembers(
  supabase: SupabaseClient<Database>,
  kind: GroupConversationKind,
  id: string
): Promise<AddableMember[]> {
  if (kind === "club") return []
  const { data, error } = await supabase.rpc("list_addable_club_members", {
    p_fixture_id: (kind === "fixture" ? id : null) as unknown as string,
    p_fixture_request_id: (kind === "request" ? id : null) as unknown as string,
  })
  if (error || !data) return []
  return data.map((row) => ({ userId: row.user_id, name: row.name, blockedByMe: row.blocked_by_me }))
}
