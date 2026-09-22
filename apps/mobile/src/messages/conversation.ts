import type { SupabaseClient } from "@supabase/supabase-js"
import {
  getDirectThread,
  loadThreadMessages,
  type Database,
  type ThreadMessage,
} from "@ovalball/contracts"

/**
 * ONE CONVERSATION, READ THE WAY THE WEBSITE READS IT.
 *
 * `getDirectThread` and `loadThreadMessages` are the website's own readers, from the shared package.
 * They resolve participant identities, apply withdrawal, and -- for a direct thread -- return
 * `canSend` and a single `unavailableReason` that reads the same whether the cause was a block in
 * either direction, messaging switched off, or a lapsed relationship. That sentence is deliberately
 * undifferentiated and is reproduced, not improved on: telling somebody which reason applies tells
 * them whether they were blocked.
 *
 * AUTHORITY IS THE SERVER'S, ALWAYS. A conversation id from a deep link is an id, not a permission.
 * Every read below goes through RLS or an RPC that scopes itself to the caller, so an id for a
 * conversation this person is not in simply returns nothing -- the app never decides.
 *
 * SENDING IS THE SAME INSERT THE WEBSITE MAKES. `fixture_messages` with exactly one container column
 * set; RLS decides whether it is allowed. There is no mobile send path and no service role.
 */

export type ConversationKind = "direct" | "fixture" | "request" | "club"

export interface Conversation {
  title: string
  subtitle: string | null
  messages: ThreadMessage[]
  canSend: boolean
  /** Present when sending is not possible. One sentence for every cause, on purpose. */
  unavailableReason: string | null
}

type Client = SupabaseClient<Database>

export async function loadConversation(
  supabase: Client,
  kind: ConversationKind,
  id: string,
  viewerId: string
): Promise<Conversation | null> {
  if (kind === "direct") {
    const thread = await getDirectThread(supabase, id, viewerId)
    if (!thread) return null
    return {
      title: thread.otherName,
      subtitle: thread.contextLabel,
      messages: thread.messages,
      canSend: thread.canSend,
      unavailableReason: thread.unavailableReason,
    }
  }

  // A fixture or club thread is keyed by its shared conversation id; a request thread by its own id,
  // because a request has no mirror row. That distinction belongs to the canonical reader's ThreadScope
  // and is reproduced here rather than re-derived.
  const header = await conversationHeader(supabase, kind, id)
  if (!header) return null

  const messages = await loadThreadMessages(supabase, viewerId, {
    key: kind === "request" ? { column: "fixture_request_id", value: id } : { column: "conversation_id", value: header.conversationId },
    clubIds: header.clubIds,
    teams: [],
  })

  return {
    title: header.title,
    subtitle: header.subtitle,
    messages,
    canSend: header.canSend,
    unavailableReason: header.canSend ? null : "You can read this conversation but not reply to it.",
  }
}

/**
 * The little a header needs, read through RLS.
 *
 * Whether the row comes back AT ALL is the authority: a fixture, request or club conversation this
 * person is not party to returns nothing, and this returns null, and the screen says the conversation
 * is unavailable. No membership is computed here.
 */
async function conversationHeader(
  supabase: Client,
  kind: Exclude<ConversationKind, "direct">,
  id: string
): Promise<{ conversationId: string; title: string; subtitle: string | null; clubIds: string[]; canSend: boolean } | null> {
  if (kind === "club") {
    // A club conversation is between TWO clubs, so both are named and the header says which is which
    // rather than guessing which side the viewer is on -- a guess that would be wrong for anybody who
    // belongs to both.
    const { data } = await supabase
      .from("club_conversations")
      .select(
        "id, status, requesting_club_id, recipient_club_id, requester:clubs!club_conversations_requesting_club_id_fkey(club_directory(name)), recipient:clubs!club_conversations_recipient_club_id_fkey(club_directory(name))"
      )
      .eq("id", id)
      .maybeSingle()
    if (!data) return null
    const requester = data.requester?.club_directory?.name ?? "A club"
    const recipient = data.recipient?.club_directory?.name ?? "A club"
    return {
      conversationId: data.id,
      title: `${requester} and ${recipient}`,
      subtitle: "Club conversation",
      clubIds: [data.requesting_club_id, data.recipient_club_id].filter(Boolean) as string[],
      // A closed conversation is readable and not repliable -- the row stays, which is the product's
      // own rule: an existing conversation is never hidden merely because it cannot be answered.
      canSend: data.status !== "closed",
    }
  }

  if (kind === "fixture") {
    const { data } = await supabase
      .from("fixtures")
      .select("id, conversation_id, kickoff_date, raw_opposition_text, opponent_team_display_name_snapshot, owning_team_display_name_snapshot")
      .eq("id", id)
      .maybeSingle()
    if (!data?.conversation_id) return null
    const opponent = data.opponent_team_display_name_snapshot ?? data.raw_opposition_text ?? "Opposition"
    return {
      conversationId: data.conversation_id,
      title: `vs ${opponent}`,
      subtitle: [data.owning_team_display_name_snapshot, data.kickoff_date].filter(Boolean).join(" · ") || null,
      clubIds: [],
      canSend: true,
    }
  }

  const { data } = await supabase
    .from("fixture_requests")
    .select("id, status, teams!fixture_requests_requesting_team_id_fkey(display_name)")
    .eq("id", id)
    .maybeSingle()
  if (!data) return null
  return {
    conversationId: data.id,
    title: "Fixture request",
    subtitle: data.teams?.display_name ?? null,
    clubIds: [],
    canSend: data.status === "sent" || data.status === "counter_proposed",
  }
}

/** The website's own insert: one container column, RLS decides. Never a service role. */
export async function sendMessage(
  supabase: Client,
  kind: ConversationKind,
  id: string,
  senderUserId: string,
  body: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const trimmed = body.trim()
  if (!trimmed) return { ok: false, message: "Write a message first." }

  const { error } = await supabase.from("fixture_messages").insert({
    direct_conversation_id: kind === "direct" ? id : null,
    fixture_id: kind === "fixture" ? id : null,
    fixture_request_id: kind === "request" ? id : null,
    club_conversation_id: kind === "club" ? id : null,
    sender_user_id: senderUserId,
    body: trimmed,
    kind: "message",
    content_type: "text",
  })

  // ONE SENTENCE, whatever RLS refused for. The reasons a send can fail are the same reasons a
  // conversation can be unavailable, and they must not be distinguishable.
  if (error) return { ok: false, message: "This conversation isn't available." }
  return { ok: true }
}

/** Opening a thread is reading it. Failure is silent: a lingering badge is a nuisance; an interruption is worse. */
export async function markRead(supabase: Client, kind: ConversationKind, id: string): Promise<void> {
  if (kind !== "direct") return
  await supabase.rpc("mark_direct_conversation_read", { p_conversation_id: id })
}
