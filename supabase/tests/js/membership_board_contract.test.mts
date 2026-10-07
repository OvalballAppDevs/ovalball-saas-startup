// THE MEMBERSHIP BOARD CONTRACT CARRIES THE SERVER'S STANDING, AND GIVES IT ONE SET OF WORDS (20270746000000).
//
// Both clients read a membership board through packages/contracts/src/membership/board.ts. These are the pure
// parts: every standing and reason the server can return has words; the club board and a team board parse
// to the same row shape, and a team board carries nothing the team may not see; the Team Manager's one line
// reads the way the brief wrote it; a reminder's outcome says what happened without naming anybody. Part 2
// (20270753000000): NOT_STARTED, the membership on every row, the club's memberships and the money chain, one
// member's read and the reminder history.

import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
  STANDING_LABEL,
  STANDING_ORDER,
  STANDING_TONE,
  groupByStanding,
  parseClubMembershipBoard,
  parseTeamMembershipBoard,
  reasonSentence,
  reminderOutcomeSentence,
  standingSummaryLine,
  formatMoneyMinor,
  stripCells,
  reminderExclusions,
  exclusionsSentence,
  reasonShort,
  teamAttentionSentence,
  type MembershipReason,
} from "@/packages/contracts/src/membership/board"
import { askableSentence, parseClubMemberMembership, parseMembershipReminderHistory } from "@/packages/contracts/src/membership/member"

const REASONS: MembershipReason[] = [
  "PAID", "WITH_THE_BANK", "RETRYING", "SCHEDULED", "SETUP_UNFINISHED", "NOT_STARTED", "NOT_COLLECTED", "PAYMENT_FAILED", "CHARGED_BACK",
  "PAYMENT_CANCELLED", "MANDATE_PROBLEM", "LEFT_THE_TEAM", "PAYER_NOT_GUARDIAN", "NO_PAYER", "EXEMPT", "WAIVED", "REFUNDED",
  "NOTHING_TO_PAY", "ENDED",
]

describe("membership board contract", () => {
  it("MB1 every standing has a label, a tone and a place in the working order; labels are sentence case", () => {
    for (const s of STANDING_ORDER) {
      assert.ok(STANDING_LABEL[s], s)
      assert.ok(STANDING_TONE[s], s)
      assert.match(STANDING_LABEL[s], /^[A-Z][a-z ]*$/, `${s} is sentence case`)
    }
    assert.equal(new Set(STANDING_ORDER).size, 8)
    assert.equal(STANDING_TONE.ACTION_NEEDED, "problem")
    assert.equal(STANDING_TONE.OVERDUE, "attention")
    assert.notEqual(STANDING_TONE.DUE, "problem", "an ordinary month not yet paid is not red")
  })

  it("MB2 every reason the server can give has a sentence, for the club and for a team", () => {
    for (const r of REASONS) {
      for (const viewer of ["club", "team"] as const) {
        const s = reasonSentence(r, viewer)
        assert.match(s, /^[A-Z].*\.$/, `${r}/${viewer}: ${s}`)
        assert.ok(!/GoCardless|mandate|obligation/i.test(s), `${r} uses no provider or database words: ${s}`)
      }
      // The few words beside a chip: a status, so sentence case, no full stop, no provider or database words.
      const short = reasonShort(r)
      assert.match(short, /^[A-Z][^.]*$/, `${r}: ${short}`)
      assert.ok(!/GoCardless|mandate|obligation/i.test(short), `${r}: ${short}`)
      assert.ok(short.length <= 26, `${r} is short enough for a row: ${short}`)
    }
    assert.match(reasonSentence("NOT_STARTED"), /hasn't started the membership/)
  })

  it("MB3 a team board parses to the same rows with nothing the team may not see", () => {
    const team = parseTeamMembershipBoard({
      team_id: "t1", team_name: "Under 12 Boys", club_id: "c1", as_of: "2026-10-20", programme_enabled: true, taking_new_memberships: false,
      counts: { total: 2, up_to_date: 1, collecting: 0, due: 0, overdue: 0, action_needed: 1, not_set_up: 0, exempt: 0 },
      rows: [
        { player_id: "p1", first_name: "Cal", surname: "Standing", standing: "ACTION_NEEDED", reason: "PAYMENT_FAILED", membership: { id: "m1", name: "Junior Membership" }, last_reminded_at: null, last_reminded_by: null, can_remind: true },
        { player_id: "p2", first_name: "Abe", surname: "Standing", standing: "UP_TO_DATE", reason: "PAID", membership: null, last_reminded_at: null, last_reminded_by: null, can_remind: false },
      ],
    })
    assert.equal(team.rows.length, 2)
    assert.equal(team.teamName, "Under 12 Boys")
    assert.equal(team.takingNewMemberships, false, "a paused club's team board still shows, taking no new memberships")
    assert.deepEqual(team.rows[0].membership, { id: "m1", name: "Junior Membership" })
    assert.equal(team.rows[1].membership, null)
    // Decision #2: a team's board carries no money -- nothing is invented for it on the way through.
    for (const key of ["amountDueMinor", "monthlyAmountMinor", "payer", "teams", "payerSubscriptionId", "mandateStatus", "collectionStarted"] as const) {
      assert.ok(!(key in team.rows[0]), `a team row has no ${key}`)
    }
    assert.equal(team.rows[0].canRemind, true)
    assert.equal(standingSummaryLine(team.counts), "2 players · 1 up to date · 1 needs attention")
  })

  it("MB4 the club board carries the payer, the teams and the month's money", () => {
    const club = parseClubMembershipBoard({
      club_id: "c1", team_id: null, as_of: "2026-10-20",
      programme: { id: "g1", enabled: true, activated_at: "2026-10-06T10:00:00Z", collection_day: 1, price_minor: null, currency: "GBP", fee_bearer: "CLUB" },
      memberships: [{ id: "m1", name: "Junior Membership", price_minor: 1600, teams: 2, members: 7 }, { id: "m2", name: "Senior Membership", price_minor: 3000, teams: 1, members: 0 }],
      counts: { total: 1, up_to_date: 0, collecting: 0, due: 1, overdue: 0, action_needed: 0, not_set_up: 0, exempt: 0, ended: 0, active_memberships: 1, direct_debit_in_place: 1 },
      money: { period: "2026-10-01", currency: "GBP", expected_minor: 1600, collected_minor: 1000, collecting_minor: 0, outstanding_minor: 1600, overdue_minor: 0,
               failed_minor: 0, refunded_minor: 600, waived_minor: 0, ovalball_fee_minor: 0, members_fee_minor: 0, fee_on_refunds_minor: 40,
               club_receives_minor: 960, next_collection_minor: 0 },
      rows: [{ player_id: "p3", first_name: "Eve", surname: "Standing", standing: "DUE", reason: "SETUP_UNFINISHED", amount_due_minor: 600,
               membership: { id: "m1", name: "Junior Membership" }, collection_started: false,
               teams: [{ id: "t1", name: "Under 12 Boys", age_group: "U12" }], payer: { user_id: "u1", relationship: "guardian", name: "Gus Standing" },
               payer_subscription_id: "s1", monthly_amount_minor: 1600, obligation_status: "SETUP_PENDING", due_date: "2026-10-01",
               mandate_status: null, next_collection_date: null, last_reminded_at: null, last_reminded_by: null, can_remind: true }],
    })
    assert.equal(club.rows[0].payer?.name, "Gus Standing")
    assert.deepEqual(club.rows[0].teams, [{ id: "t1", name: "Under 12 Boys", ageGroup: "U12" }])
    assert.equal(club.money.outstandingMinor, 1600)
    assert.equal(club.programme?.collectionDay, 1)
    assert.equal(club.programme?.priceMinor, null, "with two memberships there is no single price")
    assert.equal(club.programme?.feeBearer, "CLUB")
    assert.deepEqual(club.memberships.map((m) => [m.name, m.priceMinor, m.teams, m.members]), [["Junior Membership", 1600, 2, 7], ["Senior Membership", 3000, 1, 0]])
    assert.equal(club.counts.directDebitInPlace, 1)
    assert.equal(club.rows[0].membership?.name, "Junior Membership")
    assert.equal(club.rows[0].collectionStarted, false)
    // The money chain: collected less the fee taken (earned, or on refunded payments) is what reaches the club.
    const m = club.money
    assert.equal(m.collectedMinor - (m.ovalballFeeMinor - m.membersFeeMinor) - m.feeOnRefundsMinor, m.clubReceivesMinor)
  })

  it("MB10 one member's read: contact details only when the server sends them; who a reminder goes to, in a sentence", () => {
    assert.equal(parseClubMemberMembership(null), null, "a player the club's memberships do not know reads as nothing")
    const d = parseClubMemberMembership({
      player: { id: "p1", first_name: "Dan", surname: "Running", is_adult: false, teams: [{ id: "t1", name: "Under 12 Boys" }] },
      standing: { standing: "NOT_SET_UP", reason: "NO_PAYER", amount_due_minor: null, next_collection_date: null, collection_started: false,
                  last_reminded_at: null, last_reminded_by: null, can_remind: true },
      membership: { id: "m1", name: "Junior Membership", monthly_amount_minor: 1600, enrolment_status: null, payer_subscription_id: null },
      payer: null,
      askable: [{ name: "Gus Running", relationship: "guardian", is_payer: false }, { name: "Hana Running", relationship: "guardian", is_payer: false }],
      direct_debit: null, history: [], can: { remind: true, release_payer: true, cancel: false },
    })!
    assert.equal(d.membership?.enrolmentStatus, null)
    assert.equal(d.payer, null)
    assert.equal(askableSentence(d.askable, d.player.firstName), "The reminder goes to Gus Running and Hana Running.")
    assert.equal(askableSentence([{ name: "Pam", relationship: "guardian", isPayer: true }], "Abe"), "The reminder goes to Pam, who pays for Abe.")
    assert.equal(askableSentence([], "Zak"), "There is no adult the club can contact about Zak's membership.")
    const withoutContact = parseClubMemberMembership({ player: {}, standing: {}, payer: { name: "Pam", relationship: "guardian", email: null, phone: null } })!
    assert.equal(withoutContact.payer?.email, null)
    assert.equal(withoutContact.payer?.phone, null)
  })

  it("MB11 reminder history: a team's staff never learn how many people were told", () => {
    const h = parseMembershipReminderHistory({
      club_id: "c1", team_id: "t1",
      reminders: [{ sent_at: "2026-10-06T10:00:00Z", player_id: "p1", first_name: "Abe", surname: "Running", sent_by: "Clubadmin Running",
                    standing: "DUE", reason: "NOT_STARTED", scope: "club", recipients: null }],
    })
    assert.equal(h.reminders[0].recipients, null)
    assert.equal(h.reminders[0].reason, "NOT_STARTED")
    assert.equal(h.reminders[0].scope, "club")
  })

  it("MB5 the Team Manager's one line reads as the brief wrote it", () => {
    assert.equal(
      standingSummaryLine({ total: 18, upToDate: 14, collecting: 2, due: 0, overdue: 1, actionNeeded: 1, notSetUp: 0, exempt: 0 }),
      "18 players · 14 up to date · 2 collecting · 2 need attention"
    )
  })

  it("MB6 a reminder's outcome says what happened, and never who was told", () => {
    assert.equal(reminderOutcomeSentence({ sent: 1, recipients: 2, skipped: [] }), "Reminder sent.")
    assert.equal(
      reminderOutcomeSentence({ sent: 2, recipients: 2, skipped: [{ playerId: "p", reason: "RECENTLY_REMINDED" }] }),
      "2 reminders sent. 1 was reminded in the last 3 days, so wasn't asked again."
    )
    assert.equal(reminderOutcomeSentence({ sent: 0, recipients: 0, skipped: [{ playerId: "p", reason: "NOBODY_TO_ASK" }] }),
      "No reminder sent. 1 has no adult the club can contact.")
  })

  it("MB8 the strip never loses a small standing, and says how many players a cell stands for", () => {
    const big = stripCells({ total: 400, upToDate: 396, collecting: 0, due: 0, overdue: 2, actionNeeded: 1, notSetUp: 1, exempt: 0 })
    assert.ok(big.per > 1)
    assert.equal(big.cells[0], "ACTION_NEEDED")
    assert.ok(big.cells.includes("OVERDUE") && big.cells.includes("NOT_SET_UP"), "an amber standing is drawn however large the club")
    const small = stripCells({ total: 3, upToDate: 2, collecting: 0, due: 1, overdue: 0, actionNeeded: 0, notSetUp: 0, exempt: 0 })
    assert.deepEqual(small, { cells: ["DUE", "UP_TO_DATE", "UP_TO_DATE"], per: 1 })
  })

  it("MB9 a bulk reminder says who it leaves out, and why", () => {
    const now = new Date().toISOString()
    const base = { firstName: "A", surname: "", membership: null, amountDueMinor: null, lastRemindedBy: null }
    const x = reminderExclusions([
      { ...base, playerId: "1", standing: "ACTION_NEEDED", reason: "PAYMENT_FAILED", lastRemindedAt: now, canRemind: false },
      { ...base, playerId: "2", standing: "ACTION_NEEDED", reason: "LEFT_THE_TEAM", lastRemindedAt: null, canRemind: false },
      { ...base, playerId: "3", standing: "NOT_SET_UP", reason: "NO_PAYER", lastRemindedAt: null, canRemind: true },
    ])
    assert.deepEqual(x, { held: 1, clubToSortOut: 1 })
    assert.equal(exclusionsSentence(x), "2 not included: 1 reminded in the last 3 days, 1 for the club to sort out.")
    assert.equal(exclusionsSentence({ held: 0, clubToSortOut: 0 }), null)
  })

  it("MB12 every month status has one tone, shared by both clients; red only for a failed or reclaimed payment", async () => {
    const { MONTH_STATUS_TONE } = await import("@/packages/contracts/src/membership/board")
    const { OBLIGATION_STATUSES } = await import("@/packages/contracts/src/club/finance")
    for (const status of OBLIGATION_STATUSES) assert.ok(MONTH_STATUS_TONE[status], `${status} has a tone`)
    assert.deepEqual(Object.entries(MONTH_STATUS_TONE).filter(([, t]) => t === "problem").map(([s]) => s).sort(), ["CHARGEDBACK", "FAILED"])
    assert.equal(MONTH_STATUS_TONE.OVERDUE, "attention")
  })

  it("MB7 rows group in working order, and money reads as pounds", () => {
    const g = groupByStanding([
      { playerId: "a", firstName: "A", surname: "", standing: "UP_TO_DATE", reason: "PAID", membership: null, amountDueMinor: 1600, lastRemindedAt: null, lastRemindedBy: null, canRemind: false },
      { playerId: "b", firstName: "B", surname: "", standing: "ACTION_NEEDED", reason: "PAYMENT_FAILED", membership: null, amountDueMinor: 1600, lastRemindedAt: null, lastRemindedBy: null, canRemind: true },
    ])
    assert.deepEqual(g.map((x) => x.standing), ["ACTION_NEEDED", "UP_TO_DATE"])
    assert.equal(formatMoneyMinor(1600), "£16")
    assert.equal(formatMoneyMinor(1135), "£11.35")
  })

  it("MB13 telling a team's staff says what happened, including when there was nobody to tell", () => {
    assert.equal(teamAttentionSentence({ sent: 2, players: 3, reason: null }), "The team's staff were told 3 players need action.")
    assert.equal(teamAttentionSentence({ sent: 1, players: 1, reason: null }), "The team's staff were told 1 player needs action.")
    assert.match(teamAttentionSentence({ sent: 0, players: 4, reason: "NOBODY_TO_TELL" }), /^4 players need action, but nobody .* so nobody was told\.$/, "never 'nothing needs attention' when four do")
    assert.equal(teamAttentionSentence({ sent: 0, players: 0, reason: "NOTHING_NEEDS_ATTENTION" }), "Nothing needs the team's attention right now.")
  })
})
