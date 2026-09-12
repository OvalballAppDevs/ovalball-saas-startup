"use server"

import { getSessionContext } from "@/lib/app-context/session-context"
import { loadThreadMessages, type ThreadScope } from "@/lib/messenger/thread"
import type { ThreadMessage } from "@/lib/messenger/thread-types"
import { fullTeamLabel } from "@/lib/teams/compact-label"
import { createClient } from "@/lib/supabase/server"

/**
 * OPENING A CONVERSATION FROM THE COMPACT MESSENGER.
 *
 * The panel is a client component in the app shell, so it cannot render a
 * server component the way /messages does. It asks for the conversation here
 * instead -- through the SAME reader the workspace uses, under the SAME RLS,
 * as the SAME user.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO is decide anything. It resolves the
 * conversation's identity so the panel can title itself, then hands the
 * message list to loadThreadMessages. Every row it returns is a row the
 * caller's own client was allowed to read; a person who cannot see a
 * conversation gets an empty result from RLS, not a decision made here.
 *
 * Sending, deleting, reporting and accepting all continue to go through the
 * existing actions unchanged -- there is no send path in this file, because
 * there is already one and it is correct.
 */

export type CompactConversationKind = "request" | "fixture" | "club" | "direct"

export interface CompactConversation {
  kind: CompactConversationKind
  id: string
  /** WHO: the club on the other side. */
  title: string
  /** WHY: the fixture, the request, the reason this thread exists. */
  context: string | null
  otherClubLogoUrl: string | null
  myClubName: string
  myTeamName: string | null
  myClubLogoUrl: string | null
  status: string
  /** Where the workspace version of this conversation lives. */
  href: string
  /**
   * The Realtime topic this conversation broadcasts on -- the SAME one the
   * workspace joins, so the panel hears about a new message through the
   * existing channel rather than a second one.
   */
  presenceTopic: string
  /** False while a club message request is still unanswered. */
  canCompose: boolean
  /** Club threads only: which side of an unanswered request the viewer is on. */
  requestSide: "recipient" | "requester" | null
  messages: ThreadMessage[]
}

export type CompactConversationResult =
  | { ok: true; conversation: CompactConversation }
  | { ok: false; error: string }

function logoUrl(supabase: Awaited<ReturnType<typeof createClient>>, path: string | null | undefined): string | null {
  if (!path) return null
  return supabase.storage.from("club-logos").getPublicUrl(path).data.publicUrl
}

function teamLabel(
  t:
    | { display_name: string; rugby_code?: string | null; category: string; age_group: string | null; gender: string | null; squad_designation: string | null }
    | null
    | undefined
): string | null {
  if (!t) return null
  if (!t.category) return t.display_name
  return fullTeamLabel({
    category: t.category,
    ageGroup: t.age_group,
    gender: t.gender,
    squadDesignation: t.squad_designation,
    rugbyCode: t.rugby_code,
    alias: null,
  })
}

const TEAM_FIELDS =
  "id, display_name, club_id, rugby_code, category, age_group, gender, squad_designation, clubs(logo_storage_path, club_directory(name, logo_storage_path))"

export async function openCompactConversation(
  kind: CompactConversationKind,
  id: string
): Promise<CompactConversationResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You are signed out. Sign in again to read this conversation." }

  // WHICH SIDE IS MINE, resolved exactly as the workspace resolves it.
  //
  // The first version asked only club_memberships, which is the authority a
  // Club Admin has and NOT the authority a Team Admin has -- so a Team Admin
  // matched neither club, fell through to the wrong branch, and was shown
  // their own club as the opponent under the title "Opponent". Team
  // permissions are half the answer, so both halves are read.
  const ctx = await getSessionContext(supabase, user)
  const myClubIds = new Set(ctx.clubMemberships.map((m) => m.clubId))
  const myTeamIds = new Set(ctx.teamPermissions.map((tp) => tp.teamId))
  const isMine = (teamId: string | null | undefined, clubId: string | null | undefined) =>
    Boolean((teamId && myTeamIds.has(teamId)) || (clubId && myClubIds.has(clubId)))

  let scope: ThreadScope
  let shell: Omit<CompactConversation, "messages">

  if (kind === "fixture") {
    const { data: f } = await supabase
      .from("fixtures")
      .select(
        `conversation_id, status, kickoff_date, kickoff_time, owning_team:teams!fixtures_owning_team_id_fkey(${TEAM_FIELDS}), opponent_team:teams!fixtures_opponent_team_id_fkey(${TEAM_FIELDS}), opponent_team_display_name_snapshot, opponent_directory:club_directory!fixtures_opponent_directory_id_fkey(name, logo_storage_path)`
      )
      .eq("id", id)
      .maybeSingle()
    if (!f) return { ok: false, error: "This conversation is no longer available." }

    const iOwn = isMine(f.owning_team?.id, f.owning_team?.club_id)
    const mine = iOwn ? f.owning_team : (f.opponent_team ?? f.owning_team)
    const theirs = iOwn ? f.opponent_team : f.owning_team

    // MOST OPPONENTS ARE NOT ON OVALBALL YET.
    //
    // A fixture identifies its opponent EITHER by an Ovalball team OR by a
    // Club Directory entry, and the common case for a club in its first season
    // is the second. Reading only the team relation produced a conversation
    // titled "Opponent" against a club whose name the list beside it was
    // already showing correctly.
    const theirDirectory = theirs?.clubs?.club_directory ?? f.opponent_directory ?? null
    const theirName =
      theirDirectory?.name ?? f.opponent_team_display_name_snapshot ?? "Opponent"

    shell = {
      kind,
      id,
      title: theirName,
      context: `${teamLabel(mine) ?? "Your team"} vs ${teamLabel(theirs) ?? theirName}`,
      otherClubLogoUrl: logoUrl(supabase, theirs?.clubs?.logo_storage_path ?? theirDirectory?.logo_storage_path),
      myClubName: mine?.clubs?.club_directory?.name ?? "Ovalball",
      myTeamName: teamLabel(mine),
      myClubLogoUrl: logoUrl(supabase, mine?.clubs?.logo_storage_path ?? mine?.clubs?.club_directory?.logo_storage_path),
      status: f.status ?? "",
      href: `/messages/fixture/${id}`,
      presenceTopic: `presence:f:${f.conversation_id ?? id}`,
      canCompose: true,
      requestSide: null,
    }
    scope = {
      key: { column: "conversation_id", value: f.conversation_id ?? id },
      clubIds: [f.owning_team?.club_id, f.opponent_team?.club_id].filter((v): v is string => Boolean(v)),
      teams: [f.owning_team, f.opponent_team]
        .filter((t): t is NonNullable<typeof t> => Boolean(t))
        .map((t) => ({ id: t.id, displayName: t.display_name, clubName: t.clubs?.club_directory?.name ?? "", clubId: t.club_id })),
    }
  } else if (kind === "request") {
    const { data: r } = await supabase
      .from("fixture_requests")
      .select(
        `status, requesting_team:teams!fixture_requests_requesting_team_id_fkey(${TEAM_FIELDS}), target_team:teams!fixture_requests_target_team_id_fkey(${TEAM_FIELDS}), fixture_request_groups(proposed_date, raw_opponent_text, requesting_club_id, opponent_club_id)`
      )
      .eq("id", id)
      .maybeSingle()
    if (!r) return { ok: false, error: "This conversation is no longer available." }

    const iRequested =
      isMine(r.requesting_team?.id, r.requesting_team?.club_id) ||
      myClubIds.has(r.fixture_request_groups?.requesting_club_id ?? "")
    const mine = iRequested ? r.requesting_team : r.target_team
    const theirs = iRequested ? r.target_team : r.requesting_team

    shell = {
      kind,
      id,
      title: theirs?.clubs?.club_directory?.name ?? r.fixture_request_groups?.raw_opponent_text ?? "Opponent",
      context: `Fixture request · ${teamLabel(mine) ?? "Your team"} vs ${teamLabel(theirs) ?? r.fixture_request_groups?.raw_opponent_text ?? "Opponent"}`,
      otherClubLogoUrl: logoUrl(supabase, theirs?.clubs?.logo_storage_path ?? theirs?.clubs?.club_directory?.logo_storage_path),
      myClubName: mine?.clubs?.club_directory?.name ?? "Ovalball",
      myTeamName: teamLabel(mine),
      myClubLogoUrl: logoUrl(supabase, mine?.clubs?.logo_storage_path ?? mine?.clubs?.club_directory?.logo_storage_path),
      status: r.status,
      href: `/messages/request/${id}`,
      presenceTopic: `presence:r:${id}`,
      canCompose: true,
      requestSide: null,
    }
    scope = {
      key: { column: "fixture_request_id", value: id },
      clubIds: [r.fixture_request_groups?.requesting_club_id, r.fixture_request_groups?.opponent_club_id].filter(
        (v): v is string => Boolean(v)
      ),
      teams: [r.requesting_team, r.target_team]
        .filter((t): t is NonNullable<typeof t> => Boolean(t))
        .map((t) => ({ id: t.id, displayName: t.display_name, clubName: t.clubs?.club_directory?.name ?? "", clubId: t.club_id })),
    }
  } else if (kind === "direct") {
    // THE PANEL ALREADY LISTED THESE AND COULD NOT OPEN THEM.
    //
    // getMessengerRows includes direct conversations, so a direct row
    // appeared in the compact inbox from the day direct messaging shipped --
    // and clicking it reached this function, matched no branch, fell through
    // to the club branch, found no club_conversation and reported "This
    // conversation is no longer available." about a conversation that was
    // perfectly available two panes away.
    //
    // Authority is NOT re-derived here: direct_conversation_header is the
    // same RPC the full surface reads, so who the other person is and
    // whether this viewer may still send are answered once, in the database.
    const { data: headerRows } = await supabase.rpc("direct_conversation_header", {
      p_conversation_id: id,
    })
    const header = headerRows?.[0]
    if (!header) return { ok: false, error: "This conversation is no longer available." }

    shell = {
      kind,
      id,
      title: header.other_display_name ?? "Ovalball user",
      context: "Direct message",
      // A person is not a club: no crest, and no club identity is claimed on
      // either side, because a direct message is sent as the person.
      otherClubLogoUrl: null,
      myClubName: "",
      myTeamName: null,
      myClubLogoUrl: null,
      // A direct conversation has no lifecycle to report -- it is not
      // pending, accepted, booked or cancelled. Empty rather than invented.
      status: "",
      href: `/messages/direct/${id}`,
      presenceTopic: `presence:d:${id}`,
      canCompose: header.can_send === true,
      requestSide: null,
    }
    // A direct message's conversation_id IS the direct conversation's id
    // (internal.set_fixture_message_conversation_id), so the shared loader
    // needs no new key. clubIds and teams stay empty: role labels belong to
    // organisational conversations, and a private one has no side.
    scope = { key: { column: "conversation_id", value: id }, clubIds: [], teams: [] }
  } else {
    const { data: cc } = await supabase
      .from("club_conversations")
      .select(
        "id, status, requesting_club_id, recipient_club_id, requesting_club:clubs!club_conversations_requesting_club_id_fkey(logo_storage_path, club_directory(name, logo_storage_path)), recipient_club:clubs!club_conversations_recipient_club_id_fkey(logo_storage_path, club_directory(name, logo_storage_path))"
      )
      .eq("id", id)
      .maybeSingle()
    if (!cc) return { ok: false, error: "This conversation is no longer available." }

    const iRequested = myClubIds.has(cc.requesting_club_id)
    const mine = iRequested ? cc.requesting_club : cc.recipient_club
    const theirs = iRequested ? cc.recipient_club : cc.requesting_club

    shell = {
      kind,
      id,
      title: theirs?.club_directory?.name ?? "Club",
      context: "Club message",
      otherClubLogoUrl: logoUrl(supabase, theirs?.logo_storage_path ?? theirs?.club_directory?.logo_storage_path),
      myClubName: mine?.club_directory?.name ?? "Ovalball",
      myTeamName: null,
      myClubLogoUrl: logoUrl(supabase, mine?.logo_storage_path ?? mine?.club_directory?.logo_storage_path),
      status: cc.status,
      href: `/messages/club/${id}`,
      presenceTopic: `presence:c:${cc.id}`,
      // Unchanged rule: nothing can be written into a club conversation until
      // the invited club has accepted the request.
      canCompose: cc.status === "accepted",
      requestSide: cc.status === "pending" ? (iRequested ? "requester" : "recipient") : null,
    }
    scope = {
      key: { column: "conversation_id", value: cc.id },
      clubIds: [cc.requesting_club_id, cc.recipient_club_id],
      teams: [],
    }
  }

  const messages = await loadThreadMessages(supabase, user.id, scope)
  return { ok: true, conversation: { ...shell, messages } }
}
