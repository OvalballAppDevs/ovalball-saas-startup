import type { SupabaseClient } from "@supabase/supabase-js"
import {
  getDirectThread,
  loadThreadMessages,
  THREAD_PAGE_SIZE,
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
  /**
   * THE PERSON this conversation is with, for the header.
   *
   * A PERSON's own picture, or null meaning initials. Never a club crest and never a kit -- the
   * platform-wide identity rule, and the reason this is a separate field from the club identity on
   * the subtitle line rather than one ambiguous "image".
   */
  avatarUrl: string | null
  /** True where the header is about a person; false for a fixture, request or club thread. */
  isPerson: boolean
  messages: ThreadMessage[]
  canSend: boolean
  /** Present when sending is not possible. One sentence for every cause, on purpose. */
  unavailableReason: string | null
  /** The realtime topic for this conversation, in the platform's own scheme. */
  conversationId: string | null
  /** False once the oldest message has been read, so "load older" can stop offering itself. */
  hasMore: boolean
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
      avatarUrl: thread.otherAvatarUrl,
      isPerson: true,
      messages: thread.messages,
      canSend: thread.canSend,
      unavailableReason: thread.unavailableReason,
      // A direct thread has two people and its realtime topic is keyed by the conversation itself.
      conversationId: id,
      // The canonical direct reader returns the whole thread, so there is nothing older to fetch.
      // Saying so is better than offering a button that would find nothing.
      hasMore: false,
    }
  }

  // A fixture or club thread is keyed by its shared conversation id; a request thread by its own id,
  // because a request has no mirror row. That distinction belongs to the canonical reader's ThreadScope
  // and is reproduced here rather than re-derived.
  const header = await conversationHeader(supabase, kind, id)
  if (!header) return null

  // THE NEWEST PAGE, not the whole history. A club's fixture thread can run for a season, and pulling
  // all of it onto a phone to show the last six messages is slow before it is anything else.
  const messages = await loadThreadMessages(
    supabase,
    viewerId,
    {
      key: kind === "request" ? { column: "fixture_request_id", value: id } : { column: "conversation_id", value: header.conversationId },
      clubIds: header.clubIds,
      teams: [],
    },
    { limit: THREAD_PAGE_SIZE }
  )

  return {
    title: header.title,
    subtitle: header.subtitle,
    // A fixture, request or club thread is not a person, so it gets no personal avatar -- and
    // deliberately no crest in its place either.
    avatarUrl: null,
    isPerson: false,
    messages,
    canSend: header.canSend,
    unavailableReason: header.canSend ? null : "You can read this conversation but not reply to it.",
    conversationId: header.conversationId,
    // A full page back suggests there is more behind it. One short of a page means the thread ended.
    hasMore: messages.length >= THREAD_PAGE_SIZE,
  }
}

/**
 * The page before the one already on screen.
 *
 * The cursor is the oldest message's TIMESTAMP, not an offset: an offset shifts the moment somebody
 * sends while history is being read, and the shift is silent -- a message skipped or shown twice.
 */
export async function loadOlderMessages(
  supabase: Client,
  kind: ConversationKind,
  id: string,
  viewerId: string,
  oldest: ThreadMessage
): Promise<{ messages: ThreadMessage[]; hasMore: boolean }> {
  if (kind === "direct") return { messages: [], hasMore: false }
  const header = await conversationHeader(supabase, kind, id)
  if (!header) return { messages: [], hasMore: false }

  const messages = await loadThreadMessages(
    supabase,
    viewerId,
    {
      key: kind === "request" ? { column: "fixture_request_id", value: id } : { column: "conversation_id", value: header.conversationId },
      clubIds: header.clubIds,
      teams: [],
    },
    { limit: THREAD_PAGE_SIZE, before: oldest.createdAt }
  )
  return { messages, hasMore: messages.length >= THREAD_PAGE_SIZE }
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

  if (error) {
    // A FAILED SEND MUST BE DIAGNOSABLE ON A DEVICE. A send that failed on a phone previously produced
    // one sentence and no log at all, which left nothing to investigate -- the one situation where a
    // developer most needs detail is the one where the screen must not show any. The code, the
    // PostgREST hint and the conversation's shape go to the development console; none of it reaches a
    // person, and no token, body or identifier beyond the conversation's own id is recorded.
    logSendFailure(kind, id, error)
    // "Couldn't be sent" is a different fact from "this conversation isn't available", and conflating
    // them tells somebody their conversation has gone when their network hiccuped. RLS refusals keep
    // the undifferentiated wording, because THOSE reasons must not be distinguishable.
    const refused = error.code === "42501" || /row-level security|permission denied/i.test(error.message ?? "")
    return {
      ok: false,
      message: refused ? "This conversation isn't available." : "Message couldn't be sent. Try again.",
    }
  }
  return { ok: true }
}

/** Development only, and deliberately narrow: enough to find the cause, nothing that identifies a person. */
function logSendFailure(kind: string, conversationId: string, error: { code?: string; message?: string; details?: string; hint?: string }): void {
  if (typeof __DEV__ === "undefined" || !__DEV__) return
  // eslint-disable-next-line no-console
  console.warn("[ovalball] send failed", {
    kind,
    conversationId,
    code: error.code ?? null,
    message: error.message ?? null,
    details: error.details ?? null,
    hint: error.hint ?? null,
  })
}

declare const __DEV__: boolean | undefined

/** Opening a thread is reading it. Failure is silent: a lingering badge is a nuisance; an interruption is worse. */
export async function markRead(supabase: Client, kind: ConversationKind, id: string): Promise<void> {
  if (kind === "direct") {
    await supabase.rpc("mark_direct_conversation_read", { p_conversation_id: id })
    return
  }

  // EVERY OTHER KIND IS READ THE WAY THE WEBSITE READS IT. This used to return early for anything that
  // was not a direct conversation, which meant opening a fixture thread on a phone, reading it and
  // going back left the badge saying four unread messages over a conversation that had just been read.
  // The count is not wrong there -- the reading simply was never recorded.
  //
  // `notifications_update_self` allows a person to change `read_at` on their own notifications and
  // nothing else (`enforce_notification_read_only_update`), so this cannot alter what a notification
  // says -- only that it has been seen.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("type", "new_fixture_message")
    .is("read_at", null)
    .contains(
      "data",
      kind === "request" ? { fixture_request_id: id } : kind === "fixture" ? { fixture_id: id } : { club_conversation_id: id }
    )
}
