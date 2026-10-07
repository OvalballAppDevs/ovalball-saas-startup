import { test } from "node:test"
import assert from "node:assert/strict"

import { resolveIntent } from "./intents"

/**
 * TWO ROUTING DEFECTS FOUND DURING THE NOTIFICATIONS AUDIT (2026-10-02), PINNED HERE.
 *
 * Both share one root cause: an href this build has no native screen for was matched by a
 * generic, EARLIER branch instead of falling through to its own NOT_YET_SUPPORTED case --
 * which is what makes the fallback (open the website) a deliberate choice rather than an
 * accident. The generic branch is not wrong to exist; it was wrong to be tried first for a
 * shape it was never meant to recognise.
 */

test("an announcement thread falls through to the website, not the generic inbox", () => {
  // `/messages/announcement/<id>` is a real, distinct destination (`notificationHref`'s
  // `announcement_received` case) with its own dedicated screen on the website
  // (app/(app)/messages/announcement/[id]/) -- deliberately not one of the generic
  // conversation kinds (`direct`/`fixture`/`request`/`club`), because a recipient who cannot
  // reply still needs to read it. No native screen exists for it yet. Before the fix,
  // "announcement" failed the THREAD_KINDS check and fell through to the bare `{kind:
  // "MESSAGES"}` catch-all inside the SAME branch -- silently opening the inbox instead of
  // the announcement, with no sign anything had gone wrong.
  const intent = resolveIntent("ovalball://messages/announcement/ann-123")
  assert.equal(intent.kind, "NOT_YET_SUPPORTED")
  assert.equal((intent as { path: string }).path, "/messages/announcement/ann-123")
})

test("an announcement link with no id still falls through, not into the inbox", () => {
  const intent = resolveIntent("ovalball://messages/announcement/")
  assert.notEqual(intent.kind, "MESSAGES")
})

test("a Competition Match request link does not get read as fixture id 'competitions'", () => {
  // `/fixtures/competitions/requests` and `/fixtures/competitions/<editionId>/issue`
  // (notificationHref's competition_match_* cases) are Competition Match administration
  // screens that exist only on the website. Before the fix, the generic /fixtures/<id>
  // matcher split on "/" and read the FIRST segment as a fixture id regardless of what it
  // was, so these produced `{kind: "FIXTURE", fixtureId: "competitions"}` -- an attempt to
  // open a fixture that does not and cannot exist.
  const requests = resolveIntent("ovalball://fixtures/competitions/requests")
  assert.notEqual(requests.kind, "FIXTURE")
  assert.equal(requests.kind, "NOT_YET_SUPPORTED")

  const issue = resolveIntent("ovalball://fixtures/competitions/edition-77/issue")
  assert.notEqual(issue.kind, "FIXTURE")
  assert.equal(issue.kind, "NOT_YET_SUPPORTED")
})

test("a competition-match request link keeps its query string for the web fallback", () => {
  const intent = resolveIntent("ovalball://fixtures/competitions/requests?match=match-9")
  assert.equal(intent.kind, "NOT_YET_SUPPORTED")
  assert.equal((intent as { path: string }).path, "/fixtures/competitions/requests")
})

test("an ordinary fixture link is completely unaffected", () => {
  assert.deepEqual(resolveIntent("ovalball://fixtures/abc-123"), { kind: "FIXTURE", fixtureId: "abc-123" })
  assert.deepEqual(resolveIntent("ovalball://fixtures/abc-123/match-centre"), { kind: "MATCH_CENTRE", fixtureId: "abc-123" })
})

test("an ordinary message thread link is completely unaffected", () => {
  assert.deepEqual(resolveIntent("ovalball://messages/fixture/fix-1"), {
    kind: "MESSAGE_THREAD",
    conversationId: "fix-1",
    conversationKind: "fixture",
  })
})

test("the website's Club Memberships pages open their native screens, and the older addresses still land", () => {
  const P = "2f1c7a8e-5b3d-4c2a-9e1f-0a1b2c3d4e5f"
  const S = "7d6e5f4a-3b2c-4d1e-8f0a-1b2c3d4e5f6a"
  assert.deepEqual(resolveIntent("ovalball://club/finance"), { kind: "SCREEN", pathname: "/admin/subscriptions" })
  assert.deepEqual(resolveIntent("https://ovalball.co.uk/club/finance/members"), { kind: "SCREEN", pathname: "/admin/subscriptions/members" })
  // One member, by the player; the club the link names only chooses, so it is not carried.
  assert.deepEqual(resolveIntent(`ovalball://club/finance/members/${P}?club=c-1`), { kind: "SCREEN", pathname: "/admin/subscriptions/member/[playerId]", params: { playerId: P } })
  assert.deepEqual(resolveIntent("ovalball://club/finance/reminders"), { kind: "SCREEN", pathname: "/admin/subscriptions/reminders" })
  assert.deepEqual(resolveIntent("ovalball://club/finance/payments?month=2026-10-01"), { kind: "SCREEN", pathname: "/admin/subscriptions/payments", params: { month: "2026-10-01" } })
  assert.deepEqual(resolveIntent("ovalball://club/finance/payments?month=October"), { kind: "SCREEN", pathname: "/admin/subscriptions/payments" }, "a month that is not a billing month is ignored")
  // One membership's record, at the address the website has always used.
  assert.deepEqual(resolveIntent(`ovalball://club/finance/${S}`), { kind: "SCREEN", pathname: "/admin/subscriptions/membership/[payerSubscriptionId]", params: { payerSubscriptionId: S } })
  // The old finance page carried its month: that month's payments.
  assert.deepEqual(resolveIntent("ovalball://club/finance?month=2026-09-01"), { kind: "SCREEN", pathname: "/admin/subscriptions/payments", params: { month: "2026-09-01" } })
  // The settings address still opens the hub, which decides setup or settings.
  assert.deepEqual(resolveIntent("ovalball://club/settings/subscriptions"), { kind: "SCREEN", pathname: "/admin/subscriptions" })
  // Nothing is guessed: an id that is not a record's, or a shape this build has no screen for, is not routed natively.
  assert.deepEqual(resolveIntent("ovalball://club/finance/members/not-a-player"), { kind: "UNKNOWN" })
  assert.equal(resolveIntent("ovalball://club/finance/something/else").kind, "UNKNOWN")
})
