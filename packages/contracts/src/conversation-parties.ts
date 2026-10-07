import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "./database"
import type { SessionContext } from "./session-context"
import { resolvePersonalAvatarUrls } from "./personal-avatar"
import { canonicalRoleLabel } from "./role-labels"

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

export async function loadConversationParticipants(
  supabase: SupabaseClient<Database>,
  kind: GroupConversationKind,
  id: string,
  parties: ConversationParties,
  viewerId: string
): Promise<ConversationParticipants> {
  const column = kind === "request" ? "fixture_request_id" : "fixture_id"

  // THE SERVER SAYS WHO IS IN IT (`conversation_people`, 20270735). These used to be three reads of
  // `club_memberships` and `team_permissions` across BOTH clubs -- tables a person may read only for their own
  // club, mostly only their own row -- so a coach saw herself and nobody else: not the other club's coach who
  // had just written, not even her own Club Admin. The viewer's own subscription is still read here: it is
  // their row, and it is what the mute and leave controls show.
  const [people, mine] = await Promise.all([
    readConversationPeople(supabase, kind, id, parties),
    kind === "club"
      ? Promise.resolve({ data: null as { muted: boolean; left_at: string | null } | null })
      : supabase.from("fixture_conversation_subscriptions").select("muted, left_at").eq(column, id).eq("user_id", viewerId).maybeSingle(),
  ])

  const avatars = await resolvePersonalAvatarUrls(supabase, people.map((p) => p.avatar_storage_path))
  const participants: ConversationParticipant[] = people
    // SOMEBODY WHO LEFT IS NOT LISTED; the server still names them so their earlier messages keep a name.
    .filter((p) => !p.left_conversation)
    .map((p) => ({
      userId: p.user_id,
      name: [p.first_name, p.surname].filter(Boolean).join(" ") || "Ovalball user",
      roleLabel: conversationRoleLabel(p.role_kind, p.role_key),
      clubId: p.club_id,
      // No party club (somebody added who holds no membership there) is no club -- never "Ovalball", which is not one.
      clubName: p.club_name ?? "",
      avatarUrl: p.avatar_storage_path ? (avatars.get(p.avatar_storage_path) ?? null) : null,
      lastActiveAt: p.last_active_at ?? null,
      isMe: p.user_id === viewerId,
    }))

  return {
    // ALPHABETICAL, AND PRESENCE NEVER REORDERS ANYBODY. A list that rearranges itself as people come
    // online is a list you cannot scan twice.
    participants: participants.sort((a, b) => a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" })),
    muted: mine.data?.muted ?? false,
    left: Boolean(mine.data?.left_at),
  }
}

/** One row of `conversation_people`: who, at which club, standing how. */
export interface ConversationPerson {
  user_id: string
  first_name: string | null
  surname: string | null
  avatar_storage_path: string | null
  last_active_at: string | null
  club_id: string
  club_name: string | null
  /** "club" (a Club Admin or Fixtures Secretary), "team" (a team official) or "added". */
  role_kind: string
  /** A canonical role key -- CLUB_ADMIN, FIXTURES_SECRETARY, COACH, TEAM_MANAGER, TEAM_ADMINISTRATION -- or null when added. */
  role_key: string | null
  left_conversation: boolean
}

/**
 * Everybody a group conversation is between, from the server -- or nobody, when the caller is not party to
 * it. Keyed the way the thread itself is: the shared conversation id for a fixture or club thread, the
 * request's own id for a request.
 */
export async function readConversationPeople(
  supabase: SupabaseClient<Database>,
  kind: GroupConversationKind,
  id: string,
  parties: Pick<ConversationParties, "conversationId">
): Promise<ConversationPerson[]> {
  const { data, error } = await supabase.rpc(
    "conversation_people",
    kind === "request" ? { p_fixture_request_id: id } : { p_conversation_id: parties.conversationId ?? id }
  )
  if (error) return []
  return (data ?? []) as ConversationPerson[]
}

/**
 * A conversation role in the app's one vocabulary. The server returns CANONICAL role keys (CLUB_ADMIN,
 * FIXTURES_SECRETARY, COACH, TEAM_MANAGER, TEAM_ADMINISTRATION), named by `role_definitions.label` verbatim
 * (`canonicalRoleLabel`) -- never a second set of words.
 */
export function conversationRoleLabel(kind: string, key: string | null): string {
  if (kind === "added") return "Added to conversation"
  return key ? canonicalRoleLabel(key) : "Member"
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
