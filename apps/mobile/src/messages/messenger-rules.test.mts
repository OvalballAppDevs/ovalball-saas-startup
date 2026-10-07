import { test } from "node:test"
import assert from "node:assert/strict"

import { buildItems, dayLabel, quoteOf, type PendingSend } from "./thread-items"
import { answerSeed, answerText, conversationFromPush, isMessageAnswer } from "../notifications/message-answer-rules"
import type { ThreadMessage } from "../../../../packages/contracts/src/messenger-thread-types"

/**
 * THE MOBILE MESSENGER'S LAYOUT AND NOTIFICATION-ANSWER RULES (overnight messaging programme).
 *
 * One conversation is drawn by two windows -- the compact messenger and the full screen -- from these
 * rules, so they are pinned here rather than eyeballed twice.
 */

function message(id: string, createdAt: string, over: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id,
    body: `Message ${id}`,
    createdAt,
    isOwn: false,
    isSystemEvent: false,
    isDeleted: false,
    canDelete: false,
    canReport: true,
    senderName: "Rhian Price",
    senderRoleLabel: "Coach",
    senderClubName: "Hollins Vale RFC",
    senderAvatarUrl: null,
    attachment: null,
    documentShare: null,
    contactCard: null,
    ...over,
  }
}

test("MR1 newest first, a day line above each day's first message, and runs of one sender grouped", () => {
  const items = buildItems(
    [
      message("a", "2026-10-06T09:00:00Z"),
      message("b", "2026-10-07T09:00:00Z"),
      message("c", "2026-10-07T09:02:00Z"),
      message("d", "2026-10-07T09:03:00Z", { isOwn: true, senderName: "You" }),
    ],
    [],
    "me",
    0
  )
  assert.deepEqual(
    items.map((i) => (i.type === "message" ? i.message.id : i.type)),
    ["d", "c", "b", "day", "a", "day"]
  )
  const c = items[1]!
  const b = items[2]!
  assert.ok(c.type === "message" && c.groupedWithOlder && !c.groupedWithNewer, "c follows b from the same person, and d is someone else")
  assert.ok(b.type === "message" && b.groupedWithNewer && !b.groupedWithOlder)
})

test("MR2 the New Messages line sits above the oldest unread incoming message, counting only other people's", () => {
  const items = buildItems(
    [
      message("a", "2026-10-07T08:00:00Z"),
      message("b", "2026-10-07T09:00:00Z"),
      message("mine", "2026-10-07T09:30:00Z", { isOwn: true }),
      message("c", "2026-10-07T10:00:00Z"),
    ],
    [],
    "me",
    2
  )
  const order = items.map((i) => (i.type === "message" ? i.message.id : i.type))
  assert.deepEqual(order, ["c", "mine", "b", "unread", "a", "day"])
  assert.deepEqual(buildItems([message("a", "2026-10-07T08:00:00Z")], [], "me", 0).filter((i) => i.type === "unread"), [], "nothing unread, no line")
})

test("MR3 a pending send is drawn as mine until the stored message with the same reference arrives", () => {
  const pending: PendingSend = { clientMessageId: "11111111-1111-4111-8111-111111111111", body: "On my way", replyTo: null, createdAt: "2026-10-07T10:05:00Z", state: "sending", error: null, retryable: true }
  const before = buildItems([message("a", "2026-10-07T10:00:00Z")], [pending], "me", 0)
  const first = before[0]!
  assert.ok(first.type === "message" && first.pending?.state === "sending" && first.message.isOwn && first.message.body === "On my way")
  const after = buildItems(
    [message("a", "2026-10-07T10:00:00Z"), message("stored", "2026-10-07T10:05:01Z", { isOwn: true, clientMessageId: pending.clientMessageId })],
    [pending],
    "me",
    0
  )
  assert.equal(after.filter((i) => i.type === "message").length, 2, "never shown twice")
  assert.ok(after[0]!.type === "message" && after[0]!.pending === null)
})

test("MR4 a reply quote never carries a deleted message's words, and names the reader as You", () => {
  assert.equal(quoteOf(message("x", "2026-10-07T10:00:00Z", { isDeleted: true, body: "Message has been deleted by user." })).excerpt, "Message has been deleted.")
  assert.equal(quoteOf(message("y", "2026-10-07T10:00:00Z", { isOwn: true })).senderName, "You")
  assert.ok(quoteOf(message("z", "2026-10-07T10:00:00Z", { body: "x".repeat(300) })).excerpt.length <= 120)
})

test("MR5 day lines read the way a phone labels a conversation, in UK time", () => {
  const now = new Date("2026-10-07T12:00:00Z")
  assert.equal(dayLabel("2026-10-07T08:00:00Z", now), "Today")
  assert.equal(dayLabel("2026-10-06T08:00:00Z", now), "Yesterday")
  assert.equal(dayLabel("2026-10-04T08:00:00Z", now), "Sunday")
  assert.equal(dayLabel("2026-09-20T08:00:00Z", now), "20 September")
  assert.equal(dayLabel("2025-09-20T08:00:00Z", now), "20 September 2025")
})

test("MR6 a notification answer names its conversation by address only, and one action is one message", () => {
  assert.deepEqual(conversationFromPush({ direct_conversation_id: "d1", message_id: "m" }), { kind: "direct", id: "d1" })
  assert.deepEqual(conversationFromPush({ fixture_request_id: "r1" }), { kind: "request", id: "r1" })
  assert.deepEqual(conversationFromPush({ fixture_id: "f1" }), { kind: "fixture", id: "f1" })
  assert.equal(conversationFromPush({ announcement_id: "a1" }), null, "an announcement cannot be answered from here")
  assert.equal(isMessageAnswer("reply"), true)
  assert.equal(isMessageAnswer("answer-yes"), true)
  assert.equal(isMessageAnswer("expo.modules.notifications.actions.DEFAULT"), false, "a tap opens, it does not send")
  assert.equal(isMessageAnswer("constructor"), false, "no prototype key is an answer")
  assert.equal(answerText("reply", "  See you at 10  "), "See you at 10")
  assert.equal(answerText("answer-not-sure", "ignored"), "Not sure")
  assert.equal(answerText("reply", ""), "", "an empty reply sends nothing")
  assert.equal(answerSeed({ notificationId: "n1" }, "d1", "reply", "Hi"), "n1:reply:Hi")
})
