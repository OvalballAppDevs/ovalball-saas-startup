import type { ConversationSendKind } from "@ovalball/contracts"

/**
 * WHAT AN ANSWER FROM A MESSAGE NOTIFICATION MEANS -- pure, so it can be pinned by tests.
 *
 * The notification's conversation id is an address, never an authority: the send that follows is judged
 * by the server like any other. These rules only decide which conversation the address names, what the
 * answer says, and the stable seed that makes one action one message.
 */

export const QUICK_ANSWERS: Record<string, string> = {
  "answer-yes": "Yes 👍",
  "answer-not-sure": "Not sure",
}

/** Which conversation a message notification is about, read from the address it carries. */
export function conversationFromPush(data: Record<string, unknown>): { kind: ConversationSendKind; id: string } | null {
  const pick = (key: string) => (typeof data[key] === "string" ? (data[key] as string) : null)
  const direct = pick("direct_conversation_id")
  if (direct) return { kind: "direct", id: direct }
  const request = pick("fixture_request_id")
  if (request) return { kind: "request", id: request }
  const club = pick("club_conversation_id")
  if (club) return { kind: "club", id: club }
  const fixture = pick("fixture_id")
  if (fixture) return { kind: "fixture", id: fixture }
  return null
}

/** Whether a notification response is one of the answers above rather than a tap to open. */
export function isMessageAnswer(actionIdentifier: string): boolean {
  return actionIdentifier === "reply" || Object.hasOwn(QUICK_ANSWERS, actionIdentifier)
}

/** The words an action sends: the typed reply, or the quick answer's own label. Empty means nothing to send. */
export function answerText(actionIdentifier: string, userText: string | null | undefined): string {
  return (actionIdentifier === "reply" ? (userText ?? "") : (Object.hasOwn(QUICK_ANSWERS, actionIdentifier) ? QUICK_ANSWERS[actionIdentifier]! : "")).trim()
}

/** One notification, one action, one text: the seed of the send reference, so a repeat delivery is one message. */
export function answerSeed(data: Record<string, unknown>, targetId: string, actionIdentifier: string, text: string): string {
  return `${typeof data.notificationId === "string" ? data.notificationId : targetId}:${actionIdentifier}:${text}`
}
