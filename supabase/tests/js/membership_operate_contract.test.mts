// RUNNING CLUB MEMBERSHIPS: THE VIEWS' SHARED ARITHMETIC (Club Memberships Part 2, 20270753000000).
//
// packages/contracts/src/membership/operate.ts is what both clients use to segment, filter, break down by team,
// pick a reminder audience and explain a reason. These are its rules: segments and "Need action" count each
// player once; filters keep exactly what was asked; a team breakdown counts a player in each of their teams;
// an audience only ever holds rows the server says can be reminded; every reason has guidance in the content
// standard's case with no provider codes; large sends go in the server's batches and stop, without retrying, at
// the first refusal.

import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { reasonShort, type MembershipReason, type MembershipRow, type ReminderResult } from "@/packages/contracts/src/membership/board"
import {
  NO_MEMBER_FILTERS,
  REMINDER_BATCH,
  REMINDER_RECIPIENTS_EXPLAINED,
  activeFilterCount,
  audiencePlayerIds,
  familiesGetThis,
  filterMembers,
  memberGroups,
  needsActionCount,
  parseReminderPreview,
  reminderMessages,
  segmentCounts,
  sendRemindersInBatches,
  sendRemindersLabel,
  standingGuidance,
  teamBreakdown,
  memberTeamOptions,
} from "@/packages/contracts/src/membership/operate"

const U12 = { id: "t12", name: "Under 12 Boys", ageGroup: "U12" }
const U9 = { id: "t9", name: "Under 9 Mixed", ageGroup: "U9" }
const MEN = { id: "tm", name: "Men's 1st Team", ageGroup: null }
const JUNIOR = { id: "m1", name: "Junior Membership" }

function row(over: Partial<MembershipRow> & Pick<MembershipRow, "playerId" | "standing" | "reason">): MembershipRow {
  return { firstName: over.playerId, surname: "Running", membership: JUNIOR, lastRemindedAt: null, lastRemindedBy: null, canRemind: false, teams: [U12], ...over }
}

const ROWS: MembershipRow[] = [
  row({ playerId: "Abe", standing: "DUE", reason: "NOT_STARTED", canRemind: true }),
  row({ playerId: "Bea", standing: "COLLECTING", reason: "SCHEDULED" }),
  row({ playerId: "Cal", standing: "OVERDUE", reason: "NOT_STARTED", canRemind: true }),
  row({ playerId: "Dan", standing: "NOT_SET_UP", reason: "NO_PAYER", canRemind: true, teams: [U12, U9] }),
  row({ playerId: "Eli", standing: "UP_TO_DATE", reason: "PAID", teams: [U9] }),
  row({ playerId: "Hal", standing: "ACTION_NEEDED", reason: "LEFT_THE_TEAM", teams: [] }),
  row({ playerId: "Kit", standing: "ACTION_NEEDED", reason: "PAYMENT_FAILED", canRemind: false, lastRemindedAt: new Date().toISOString() }),
  row({ playerId: "Ida", standing: "ENDED", reason: "ENDED", teams: [] }),
  row({ playerId: "Zoë", standing: "EXEMPT", reason: "EXEMPT", membership: { id: "m2", name: "Senior Membership" }, teams: [MEN] }),
]

const REASONS: MembershipReason[] = [
  "PAID", "WITH_THE_BANK", "RETRYING", "SCHEDULED", "SETUP_UNFINISHED", "NOT_STARTED", "NOT_COLLECTED", "PAYMENT_FAILED", "CHARGED_BACK",
  "PAYMENT_CANCELLED", "MANDATE_PROBLEM", "LEFT_THE_TEAM", "PAYER_NOT_GUARDIAN", "NO_PAYER", "EXEMPT", "WAIVED", "REFUNDED", "NOTHING_TO_PAY", "ENDED",
]

describe("running memberships contract", () => {
  it("MO1 segments: All leaves out ended memberships; Need action is Action needed + Overdue + Not set up + Due, once each", () => {
    assert.deepEqual(segmentCounts(ROWS), { all: 8, up_to_date: 1, needs_action: 5 })
    // A board's counts give the same answer, so a team's home and the Memberships page it opens never disagree.
    const counts = { total: 8, upToDate: 1, collecting: 1, due: 1, overdue: 1, actionNeeded: 2, notSetUp: 1, exempt: 1, ended: 1 }
    assert.equal(needsActionCount(counts), segmentCounts(ROWS).needs_action)
  })

  it("MO2 filters keep exactly what was asked, and search ignores case and accents", () => {
    assert.deepEqual(filterMembers(ROWS, { ...NO_MEMBER_FILTERS, segment: "needs_action", teamId: "t12" }).map((r) => r.playerId), ["Abe", "Cal", "Dan", "Kit"])
    assert.deepEqual(filterMembers(ROWS, { ...NO_MEMBER_FILTERS, membershipId: "m2" }).map((r) => r.playerId), ["Zoë"])
    assert.deepEqual(filterMembers(ROWS, { ...NO_MEMBER_FILTERS, query: "zoe" }).map((r) => r.playerId), ["Zoë"])
    assert.deepEqual(filterMembers(ROWS, { ...NO_MEMBER_FILTERS, standing: "OVERDUE" }).map((r) => r.playerId), ["Cal"])
    assert.equal(activeFilterCount({ ...NO_MEMBER_FILTERS, teamId: "t12", query: " " }), 1)
  })

  it("MO3 teams are listed youngest first; each team counts every player in it", () => {
    assert.deepEqual(memberTeamOptions(ROWS).map((t) => t.id), ["t9", "t12", "tm"])
    const b = teamBreakdown({ rows: ROWS })
    const u12 = b.find((t) => t.team.id === "t12")!
    assert.deepEqual([u12.total, u12.upToDate, u12.collecting, u12.needsAction, u12.exempt], [5, 0, 1, 4, 0])
    const u9 = b.find((t) => t.team.id === "t9")!
    assert.deepEqual([u9.total, u9.upToDate, u9.needsAction], [2, 1, 1], "Dan is in both teams and counts in both")
    assert.equal(b.some((t) => t.total === 0), false)
  })

  it("MO4 a reminder audience only ever holds rows the server says can be reminded", () => {
    assert.deepEqual(audiencePlayerIds(ROWS, { kind: "needs_action" }), ["Abe", "Cal", "Dan"], "Kit was reminded in the last 3 days; Hal is the club's to sort out")
    assert.deepEqual(audiencePlayerIds(ROWS, { kind: "overdue" }), ["Cal"])
    assert.deepEqual(audiencePlayerIds(ROWS, { kind: "team", teamId: "t9" }), ["Dan"])
    assert.deepEqual(audiencePlayerIds(ROWS, { kind: "selected", playerIds: ["Abe", "Eli", "Kit"] }), ["Abe"])
    assert.equal(sendRemindersLabel(1), "Send Reminder")
    assert.equal(sendRemindersLabel(3), "Send 3 Reminders")
  })

  it("MO5 every reason has guidance: a sentence-case status title, a sentence of body, no provider codes", () => {
    for (const reason of REASONS) {
      for (const viewer of ["club", "team"] as const) {
        const g = standingGuidance(reason, viewer)
        // Sentence case; "Direct Debit" keeps its capitals (a proper name, as the content standard protects acronyms).
        assert.match(g.title.replace(/Direct Debit/g, "Direct debit").replace(/(.)Direct debit/g, "$1direct debit"), /^[A-Z][a-z' ]*$/, `${reason}: "${g.title}" is a sentence-case status`)
        assert.match(g.body, /^[A-Z].*\.$/, `${reason}: body is a sentence`)
        assert.ok(!/mandate|obligation|PAYMENT_|_|chargeback/i.test(g.title + g.body), `${reason}: no provider or database words`)
      }
    }
    // A team's staff are told what the club will handle, never offered the club's own actions.
    assert.equal(standingGuidance("LEFT_THE_TEAM", "team").action, "none")
    assert.equal(standingGuidance("PAYER_NOT_GUARDIAN", "team").action, "none")
    assert.equal(standingGuidance("PAYER_NOT_GUARDIAN", "club").action, "change_payer")
    assert.match(standingGuidance("PAYMENT_FAILED").body, /doesn't try it again on its own/, "says whether it retries automatically")
    // A team's staff never read the family's or the club's private business: no payer, guardianship or chargeback.
    for (const reason of ["CHARGED_BACK", "PAYER_NOT_GUARDIAN", "LEFT_THE_TEAM"] as const) {
      const g = standingGuidance(reason, "team")
      assert.ok(!/payer|guardian|at their request|reclaim/i.test(g.title + g.body), `${reason}: team words stay out of the family's business: ${g.title} ${g.body}`)
      assert.equal(g.action, "none", `${reason}: the club handles it`)
    }
    assert.equal(reasonShort("CHARGED_BACK", "team"), "Payment returned")
    assert.equal(reasonShort("PAYER_NOT_GUARDIAN", "team"), "For the club to sort out")
    assert.equal(reasonShort("PAYER_NOT_GUARDIAN"), "Payer is not a guardian", "the club still sees what it is")
  })

  it("MO6 groups come in working order and settled ones are marked for folding", () => {
    const g = memberGroups(ROWS)
    assert.deepEqual(g.map((x) => x.standing), ["ACTION_NEEDED", "OVERDUE", "NOT_SET_UP", "DUE", "COLLECTING", "UP_TO_DATE", "EXEMPT", "ENDED"])
    assert.deepEqual(g.filter((x) => x.settled).map((x) => x.standing), ["UP_TO_DATE", "EXEMPT", "ENDED"])
  })

  it("MO7 a large send goes in the server's batches and stops at the first refusal, never retrying", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `p${i}`)
    const calls: number[] = []
    const ok = await sendRemindersInBatches(async (batch): Promise<ReminderResult> => {
      calls.push(batch.length)
      return { sent: batch.length, recipients: batch.length, skipped: [] }
    }, [...ids, "p0"])
    assert.deepEqual(calls, [REMINDER_BATCH, REMINDER_BATCH, 20], "duplicates removed; batches of 50")
    assert.equal(ok.result.sent, 120)
    assert.equal(ok.error, null)
    let n = 0
    const stopped = await sendRemindersInBatches(async (batch) => {
      n += 1
      if (n === 2) throw new Error("That is more reminders than one person can send in a day. Try again tomorrow.")
      return { sent: batch.length, recipients: batch.length, skipped: [] }
    }, ids)
    assert.equal(n, 2, "nothing after the refusal is attempted")
    assert.equal(stopped.result.sent, 50)
    assert.ok(stopped.error instanceof Error)
  })

  it("MO8 the preview's JSON: counts, reasons and one example, never who would be told", () => {
    const p = parseReminderPreview({ will_send: 2, skipped: [{ player_id: "Eli", reason: "NOTHING_TO_ASK" }], example: { player_id: "Abe", first_name: "Abe", title: "Membership reminder", body: "Abe's Direct Debit is in place…" } })
    assert.equal(p.willSend, 2)
    assert.deepEqual(p.skipped, [{ playerId: "Eli", reason: "NOTHING_TO_ASK" }])
    assert.equal(p.example?.firstName, "Abe")
    assert.equal(parseReminderPreview({ will_send: 0, skipped: [], example: null }).example, null)
  })

  it("MO9 a mixed audience shows every message it will send, with how many families get each, and who reads it", () => {
    const p = parseReminderPreview({
      will_send: 3,
      skipped: [],
      example: { player_id: "Abe", first_name: "Abe", title: "Membership reminder", body: "Abe's Direct Debit is in place…" },
      examples: [
        { variant: "START", count: 2, player_id: "Abe", first_name: "Abe", title: "Membership reminder", body: "Abe's Direct Debit is in place…" },
        { variant: "SET_UP", count: 1, player_id: "Dan", first_name: "Dan", title: "Membership reminder", body: "Running RFC asks you to set up Dan's membership." },
      ],
    })
    assert.deepEqual(p.examples.map((e) => [e.variant, e.count, e.firstName]), [["START", 2, "Abe"], ["SET_UP", 1, "Dan"]])
    assert.equal(p.examples.reduce((n, e) => n + e.count, 0), p.willSend, "every family is in exactly one message")
    assert.deepEqual(parseReminderPreview({ will_send: 0, skipped: [] }).examples, [], "an older server without examples reads as none")
    assert.deepEqual(reminderMessages(p).map((m) => m.variant), ["START", "SET_UP"])
    const older = parseReminderPreview({ will_send: 2, skipped: [], example: { player_id: "Abe", first_name: "Abe", title: "Membership reminder", body: "B" } })
    assert.deepEqual(reminderMessages(older).map((m) => [m.variant, m.count, m.body]), [["ONE", 2, "B"]], "an older server's one example is every family's message")
    assert.deepEqual(reminderMessages(parseReminderPreview({ will_send: 0, skipped: [], example: null })), [])
    assert.equal(familiesGetThis(1), "1 family gets this:")
    assert.equal(familiesGetThis(4), "4 families get this:")
    assert.match(REMINDER_RECIPIENTS_EXPLAINED, /Never to a child\.$/)
  })
})
