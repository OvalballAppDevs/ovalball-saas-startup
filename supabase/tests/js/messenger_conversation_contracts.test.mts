// THE MESSENGER'S SHARED RULES FOR SENDING, REACTING AND PRESENCE (overnight messaging programme).
//
// packages/contracts/src/messenger-send.ts, messenger-reactions.ts and messenger-presence.ts are read by the web
// and the mobile app alike. These are their pure rules: a send reference is a real UUID made once per message; only
// a failure that never reached a decision is offered Retry; one reaction per person, with the server's answer
// replacing the guess; and presence says only what the heartbeat supports -- never "Offline" as a claim, never a
// permanent "Online".

import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { clientMessageIdFrom, isRetryableSendError, newClientMessageId } from "@/packages/contracts/src/messenger-send"
import {
  applyReactionLocally,
  myReaction,
  REACTION_EMOJI,
  reactionsAccessibilityLabel,
  summariseReactions,
} from "@/packages/contracts/src/messenger-reactions"
import { ONLINE_WINDOW_MS, presenceFromLastActive } from "@/packages/contracts/src/messenger-presence"
import { fixtureContext, matchDay } from "@/packages/contracts/src/messenger-rows"
import { byRecentActivity, type MessengerRow } from "@/packages/contracts/src/messenger-view-model"
import { receiptLabel, receiptState, receiptTime } from "@/packages/contracts/src/messenger-receipts"
import { formatVoiceDuration, validateVoiceNote, voiceStoragePath } from "@/packages/contracts/src/messenger-voice"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe("the messenger's shared send, reaction and presence rules", () => {
  it("MC1 a send reference is a version-4 UUID, different for every message", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newClientMessageId()))
    assert.equal(ids.size, 200)
    for (const id of ids) assert.match(id, UUID)
  })

  it("MC1b a reference derived from one notification action is stable, distinct per action, and UUID-shaped", () => {
    const a = clientMessageIdFrom("notification-1:reply:See you there")
    assert.equal(a, clientMessageIdFrom("notification-1:reply:See you there"), "the same action twice is one message")
    assert.notEqual(a, clientMessageIdFrom("notification-1:reply:See you there!"))
    assert.notEqual(a, clientMessageIdFrom("notification-2:reply:See you there"))
    assert.match(a, UUID)
    assert.match(clientMessageIdFrom(""), UUID)
  })

  it("MC2 Retry is offered only for a failure that never reached a decision", () => {
    assert.equal(isRetryableSendError({ code: "42501", message: "new row violates row-level security policy" }), false, "refused stays refused")
    assert.equal(isRetryableSendError({ code: "22023", message: "Write a message first." }), false)
    assert.equal(isRetryableSendError({ code: "PGRST202", message: "Could not find the function" }), false)
    assert.equal(isRetryableSendError({ code: "", message: "TypeError: Network request failed" }), true)
    assert.equal(isRetryableSendError({ message: "Failed to fetch" }), true)
    assert.equal(isRetryableSendError(null), false)
  })

  it("MC3 reactions: counted per emoji, mine marked, most-used first, and the offered set is the five in the brief", () => {
    assert.deepEqual([...REACTION_EMOJI], ["👍", "❤️", "😂", "🎉", "👏"])
    const summary = summariseReactions(
      [
        { emoji: "❤️", user_id: "b" },
        { emoji: "👍", user_id: "a" },
        { emoji: "👍", user_id: "c" },
      ],
      "a"
    )
    assert.deepEqual(summary, [
      { emoji: "👍", count: 2, mine: true },
      { emoji: "❤️", count: 1, mine: false },
    ])
    assert.equal(myReaction(summary), "👍")
    assert.deepEqual(summariseReactions(null, "a"), [])
  })

  it("MC4 one reaction per person: another emoji changes it, the same one takes it back", () => {
    const start = [
      { emoji: "👍", count: 2, mine: true },
      { emoji: "❤️", count: 1, mine: false },
    ]
    assert.deepEqual(applyReactionLocally(start, "❤️"), [
      { emoji: "❤️", count: 2, mine: true },
      { emoji: "👍", count: 1, mine: false },
    ])
    assert.deepEqual(applyReactionLocally(start, "👍"), [
      { emoji: "👍", count: 1, mine: false },
      { emoji: "❤️", count: 1, mine: false },
    ])
    assert.deepEqual(applyReactionLocally([{ emoji: "🎉", count: 1, mine: true }], null), [], "a chip at zero disappears")
    assert.deepEqual(applyReactionLocally([], "👏"), [{ emoji: "👏", count: 1, mine: true }])
    assert.equal(start[0]!.count, 2, "the input is never mutated")
  })

  it("MC5 reactions are read aloud as words, not emoji", () => {
    assert.equal(
      reactionsAccessibilityLabel([
        { emoji: "👍", count: 3, mine: true },
        { emoji: "❤️", count: 1, mine: false },
      ]),
      "3 thumbs up, including you. 1 heart."
    )
    assert.equal(reactionsAccessibilityLabel([{ emoji: "🎉", count: 1, mine: true }]), "1 celebrate, yours.")
  })

  it("MC6 presence: Online now within two missed heartbeats, then Recently active, then a truthful Last online in UK time", () => {
    const now = Date.parse("2026-10-07T12:00:00Z") // 13:00 in London
    assert.deepEqual(presenceFromLastActive(new Date(now - 30_000).toISOString(), now), { online: true, label: "Online now" })
    assert.equal(presenceFromLastActive(new Date(now - ONLINE_WINDOW_MS - 1).toISOString(), now).online, false)
    assert.equal(presenceFromLastActive(new Date(now - 10 * 60_000).toISOString(), now).label, "Recently active")
    assert.equal(presenceFromLastActive("2026-10-07T09:05:00Z", now).label, "Last online today at 10:05am")
    assert.equal(presenceFromLastActive("2026-10-06T19:12:00Z", now).label, "Last online yesterday at 8:12pm")
    assert.equal(presenceFromLastActive("2022-02-11T15:45:00Z", now).label, "Last online 11/02/22 at 3:45pm", "GMT in winter")
    assert.deepEqual(presenceFromLastActive(null, now), { online: false, label: null }, "no heartbeat is not a claim of anything")
    assert.deepEqual(presenceFromLastActive("not a date", now), { online: false, label: null })
  })

  it("MC7 receipts: Sent until somebody reads it; Read in a direct conversation; a count, never names, in a group", () => {
    assert.equal(receiptLabel(null), "Sent")
    assert.equal(receiptLabel({ readCount: 0, firstReadAt: null, isDirect: true }), "Sent")
    assert.equal(receiptLabel({ readCount: 1, firstReadAt: "2026-10-07T09:33:00Z", isDirect: true }), "Read")
    assert.equal(receiptLabel({ readCount: 4, firstReadAt: "2026-10-07T09:33:00Z", isDirect: false }), "Read by 4")
    assert.equal(receiptState({ readCount: 2, firstReadAt: null, isDirect: false }), "read")
    assert.equal(receiptTime("2026-10-07T09:33:00Z"), "7 Oct 2026, 10:33")
  })

  it("MC8 voice notes: two minutes and two megabytes at most, a path named by the send reference in the conversation's folder", () => {
    assert.equal(validateVoiceNote(300, 1000), "That was too short to send. Hold on a moment longer.")
    assert.equal(validateVoiceNote(120_001, 1000), "Voice notes can be up to two minutes long.")
    assert.equal(validateVoiceNote(5000, 2 * 1024 * 1024 + 1), "That recording is too large to send.")
    assert.equal(validateVoiceNote(5000, 48_000), null)
    assert.equal(voiceStoragePath("direct", "abc", "ref-1"), "d/abc/ref-1.m4a")
    assert.equal(voiceStoragePath("fixture_request", "r1", "ref-2"), "r/r1/ref-2.m4a")
    assert.equal(formatVoiceDuration(7_400), "0:07")
    assert.equal(formatVoiceDuration(102_000), "1:42")
  })

  it("MC9 a fixture conversation says which match: the day, and the year only when it is not this one", () => {
    const now = new Date("2026-10-07T12:00:00Z")
    assert.equal(matchDay("2026-10-17", now), "Sat 17 Oct")
    assert.equal(matchDay("2025-11-08", now), "Sat 8 Nov 2025")
    assert.equal(matchDay(null, now), null)
    // One label, said once: the title already names the opposition club.
    assert.equal(fixtureContext("Under 12 Boys", "Under 12 Boys", "2026-10-17", now), "Under 12 Boys · Sat 17 Oct")
    assert.equal(fixtureContext("Under 12 Boys", "Under 12 Girls", "2026-10-17", now), "Under 12 Boys vs Under 12 Girls · Sat 17 Oct")
    assert.equal(fixtureContext("Under 12 Boys", null, null, now), "Under 12 Boys")
  })

  it("MC10 the conversation list is most recently received first, and a conversation with no messages sits below", () => {
    const row = (key: string, activityAt: string | null) => ({ key, activityAt }) as MessengerRow
    const sorted = [row("quiet", null), row("old", "2026-10-06T09:00:00Z"), row("new", "2026-10-07T08:20:00+00:00"), row("mid", "2026-10-07T07:00:00Z")].sort(byRecentActivity)
    assert.deepEqual(sorted.map((r) => r.key), ["new", "mid", "old", "quiet"])
  })
})
