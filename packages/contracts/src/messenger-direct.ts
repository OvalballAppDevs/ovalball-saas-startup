import type { SupabaseClient } from "@supabase/supabase-js"

import { resolvePersonalAvatarUrl } from "./personal-avatar"
import type { ThreadMessage } from "./messenger-thread-types"
import { loadThreadMessages } from "./messenger-thread"

/**
 * READING A 1:1 CONVERSATION.
 *
 * Every query here is an ordinary authenticated read, so RLS decides what
 * comes back: membership of the thread grants the history, and nothing else
 * grants anything. There is no administrator clause — a private conversation
 * is not club property, and a moderator who legitimately needs one goes
 * through the audited Support path that already exists.
 *
 * WHETHER YOU MAY SEND is a separate question from whether you may read, and
 * is asked of internal.may_direct_message rather than inferred here. A
 * relationship that has lapsed, a club that has switched direct messaging
 * off, or a block in either direction all stop the composer while leaving the
 * history exactly where it was.
 */

export interface DirectThreadView {
  conversationId: string
  otherUserId: string
  otherName: string
  /**
   * THE OTHER PERSON'S OWN PICTURE, from the canonical resolver -- `profiles.avatar_storage_path`
   * through a short-lived signed URL on the private `avatars` bucket. Null where they have none, or
   * where the viewer may not see it, which both mean "show initials" and never "show something else".
   *
   * Added because a conversation header that names somebody and shows nothing is a header that
   * invites a club crest to be dropped in beside the name -- and a club is not a person. Carried on
   * the thread so every surface gets it from one place rather than resolving identity separately.
   */
  otherAvatarUrl: string | null
  /** A light line under the name where there is something true to say. */
  contextLabel: string | null
  messages: ThreadMessage[]
  canSend: boolean
  /**
   * ONE SENTENCE FOR EVERY CAUSE. Block in either direction, policy off,
   * relationship lapsed — all read the same, because the differences are
   * exactly what must not be disclosed.
   */
  unavailableReason: string | null
}

const UNAVAILABLE = "This conversation isn't available."

/**
 * The other party's picture, through the ONE canonical personal-avatar resolver.
 *
 * A failure resolves to null, which the interface already renders as initials -- a missing picture is
 * never a reason to show a different image, and never a reason to fail the whole thread.
 */
async function resolveOtherAvatar(supabase: SupabaseClient, otherUserId: string): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("avatar_storage_path")
    .eq("id", otherUserId)
    .maybeSingle()
  return resolvePersonalAvatarUrl(supabase, data?.avatar_storage_path ?? null)
}

export async function getDirectThread(
  supabase: SupabaseClient,
  conversationId: string,
  viewerId: string,
): Promise<DirectThreadView | null> {
  const { data: conversation } = await supabase
    .from("direct_conversations")
    .select("id, user_a, user_b")
    .eq("id", conversationId)
    .maybeSingle()

  if (!conversation) return null

  const otherUserId = conversation.user_a === viewerId ? conversation.user_b : conversation.user_a

  // ONE call for the name and the send authority. Deliberately not the
  // candidate list: a blocked or lapsed thread drops out of discovery, and a
  // header that then read "Ovalball user" would hide who you were talking to
  // at exactly the moment you most want to know.
  const { data: headerRows } = await supabase.rpc("direct_conversation_header", {
    p_conversation_id: conversationId,
  })
  const header = (headerRows ?? [])[0]
  if (!header) return null

  // THE SAME READER THE REST OF MESSENGER USES, and it has to be.
  //
  // This block used to be its own small query that selected the message columns and nothing else, then
  // set `attachment`, `documentShare` and `contactCard` to null -- which was CORRECT when a direct
  // conversation was the one container that could not carry any of them. It stopped being correct the
  // moment the platform grew a direct attachment target, and it would have failed silently: the RPC
  // writes the row, the sender sees their own optimistic send, and the recipient opens the thread to a
  // caption with nothing attached to it. A second reader is a second answer waiting to go stale.
  //
  // `loadThreadMessages` is keyed on `conversation_id`, which for a direct message IS the direct
  // conversation's id (`internal.set_fixture_message_conversation_id`), so no new key is needed.
  const built = await loadThreadMessages(supabase, viewerId, {
    key: { column: "conversation_id", value: conversationId },
    // EMPTY ON PURPOSE. Club and team role labels belong to organisational conversations; a private one
    // has no side, and "Fixture Secretary, Burnley RUFC" under a personal message would attribute it to
    // an organisation that is not party to it.
    clubIds: [],
    teams: [],
  })

  // WHO SAID IT COMES FROM THE HEADER, not from a club lookup that deliberately was not done. Two
  // people, one of them you: the canonical resolver's "Ovalball user" fallback is right in general and
  // wrong here, where the other person's name is already known and authoritative.
  const otherAvatarUrl = await resolveOtherAvatar(supabase, otherUserId)
  const messages: ThreadMessage[] = built.map((m) => ({
    ...m,
    senderName: m.isOwn ? "You" : (header.other_display_name ?? "Ovalball user"),
    senderRoleLabel: "",
    senderClubName: "",
    senderAvatarUrl: m.isOwn ? null : otherAvatarUrl,
  }))

  const canSend = header.can_send === true

  // The context line is a nicety, so it comes from discovery and is simply
  // absent when discovery no longer lists them.
  const { data: candidates } = await supabase.rpc("my_direct_message_candidates")
  const match = (candidates ?? []).find((c: { user_id: string }) => c.user_id === otherUserId)

  return {
    conversationId,
    otherUserId,
    otherName: header.other_display_name ?? "Ovalball user",
    otherAvatarUrl,
    contextLabel: match ? [match.context_label, match.context_detail].filter(Boolean).join(" · ") : null,
    messages,
    canSend,
    unavailableReason: canSend ? null : UNAVAILABLE,
  }
}
