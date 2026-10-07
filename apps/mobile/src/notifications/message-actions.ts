import * as Notifications from "expo-notifications"
import { clientMessageIdFrom, loadReactions, sendConversationMessage, setMessageReaction } from "@ovalball/contracts"

import { supabase } from "../auth/supabase"
import { answerSeed, answerText, conversationFromPush, QUICK_ANSWERS } from "./message-answer-rules"

export { conversationFromPush, isMessageAnswer, QUICK_ANSWERS } from "./message-answer-rules"

/**
 * ANSWERING A MESSAGE FROM ITS NOTIFICATION.
 *
 * The delivery trigger marks each message push with a category for its kind of conversation, and this
 * registers what each offers. Each
 * one requires the phone to be UNLOCKED (`isAuthenticationRequired`) -- a reply from a locked phone in a
 * changing room is a reply from whoever is holding it.
 *
 * THE PAYLOAD IS NOT THE AUTHORITY. A notification's conversation id is only an address. The answer is
 * sent through `send_conversation_message`, which applies the same RLS a reply typed in the app does,
 * so a payload naming somebody else's conversation is refused. The push itself never carried the
 * message's words (only "Sent you a message."), so nothing here relies on content from the lock screen.
 *
 * ONE ANSWER, ONCE. The send reference is derived from the notification and the action, so iOS handing
 * the same action over twice still produces one message.
 */

export const MESSAGE_CATEGORY = "ovalball-message"
export const DIRECT_CATEGORY = "ovalball-direct"
export const FIXTURE_CATEGORY = "ovalball-fixture"

const unlocked = { opensAppToForeground: false, isAuthenticationRequired: true } as const
const reply = { identifier: "reply", buttonTitle: "Reply", textInput: { submitButtonTitle: "Send", placeholder: "Write a reply" }, options: unlocked }

/**
 * THE ACTIONS FIT THE CONVERSATION (the server chooses the category per push):
 * - a direct message: Reply, and 👍 -- a reaction to that message, not words put in somebody's mouth;
 * - a fixture or request thread: Reply, "Yes 👍" and "Not sure" -- the question there is "are we on?";
 * - a club thread (and any older push): Reply.
 */
export async function registerMessageCategory(): Promise<void> {
  try {
    await Promise.all([
      Notifications.setNotificationCategoryAsync(DIRECT_CATEGORY, [reply, { identifier: "react-thumbs", buttonTitle: "👍", options: unlocked }]),
      Notifications.setNotificationCategoryAsync(FIXTURE_CATEGORY, [
        reply,
        { identifier: "answer-yes", buttonTitle: QUICK_ANSWERS["answer-yes"]!, options: unlocked },
        { identifier: "answer-not-sure", buttonTitle: QUICK_ANSWERS["answer-not-sure"]!, options: unlocked },
      ]),
      Notifications.setNotificationCategoryAsync(MESSAGE_CATEGORY, [reply]),
    ])
  } catch {
    // A platform without categories simply offers the plain notification; opening it still works.
  }
}

/**
 * 👍 from a direct-message notification: a reaction to THAT message, through the canonical reaction RPC (which
 * re-checks that the reader may post there). Taking a reaction back is a toggle, so a repeated delivery of the
 * same action must not undo the first: if 👍 is already mine, nothing is sent.
 */
export async function reactFromNotification(data: Record<string, unknown>): Promise<boolean> {
  const messageId = typeof data.message_id === "string" ? data.message_id : null
  const { data: auth } = await supabase.auth.getUser()
  if (!messageId || !auth.user) return false
  const existing = await loadReactions(supabase, [messageId], auth.user.id)
  if (existing.get(messageId)?.some((r) => r.mine && r.emoji === "👍")) return true
  const result = await setMessageReaction(supabase, messageId, "👍")
  return result.ok
}

/**
 * Send the answer. Returns false when it could not be sent, so the caller can say so -- an answer that
 * silently vanished is worse than one that was never offered.
 */
export async function sendMessageAnswer(data: Record<string, unknown>, actionIdentifier: string, userText: string | null | undefined): Promise<boolean> {
  const target = conversationFromPush(data)
  const text = answerText(actionIdentifier, userText)
  if (!target || !text) return false
  const seed = answerSeed(data, target.id, actionIdentifier, text)
  const result = await sendConversationMessage(supabase, {
    kind: target.kind,
    targetId: target.id,
    body: text,
    clientMessageId: clientMessageIdFrom(seed),
  })
  return result.ok
}

/** A local, content-free notice that an answer did not go -- the only honest thing to do from a lock screen. */
export async function noticeAnswerNotSent(): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title: "Reply not sent", body: "Open Ovalball to try again." },
      trigger: null,
    })
  } catch {
    // Nothing further can be done without the app open.
  }
}
