// WHAT REACHED THE CLUB'S BANK, READ THE SAME WAY EVERYWHERE (20270754000000, Part 2 §29).
//
// packages/contracts/src/membership/payouts.ts turns club_payouts into the lines both clients show. The lines come
// in the order the money moved, leave out what is nil, end with what was paid in, and add up to it; VAT is shown as
// part of GoCardless's fee, never on top; a debit reads with a minus sign; and nothing carries a GoCardless id.

import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { parseClubPayouts, payoutLines, payoutStatusLabel, signedMoney } from "@/packages/contracts/src/membership/payouts"

const RAW = {
  club_id: "c1",
  payouts: [
    { id: "p1", reference: "HOLLINSVALE-1", arrival_date: "2026-10-04", status: "paid", currency: "GBP", amount_minor: 27473, recorded_at: "2026-10-06T13:30:00Z",
      members_paid_minor: 26240, gocardless_fees_minor: -582, gocardless_vat_minor: -98, ovalball_fee_minor: -640, refunds_minor: 0, failures_minor: 0,
      other_minor: 2455, items: 50, ovalball_payments: 16, balanced: true },
    { id: "p2", reference: null, arrival_date: null, status: "pending", currency: "GBP", amount_minor: 1560, members_paid_minor: 1600, gocardless_fees_minor: 0,
      gocardless_vat_minor: 0, ovalball_fee_minor: -40, refunds_minor: 0, failures_minor: 0, other_minor: 0, items: 2, ovalball_payments: 1, balanced: true },
  ],
}

describe("payouts contract", () => {
  it("MP1 the lines run in the order the money moved, skip what is nil, and end with what was paid in", () => {
    const [p1, p2] = parseClubPayouts(RAW)
    assert.deepEqual(payoutLines(p1).map((l) => l.key), ["members", "gocardless", "ovalball", "other", "paid"])
    assert.deepEqual(payoutLines(p2).map((l) => l.key), ["members", "ovalball", "paid"])
    for (const p of [p1, p2]) {
      const lines = payoutLines(p)
      const sum = lines.filter((l) => l.key !== "paid").reduce((s, l) => s + l.amountMinor, 0)
      assert.equal(sum, lines[lines.length - 1].amountMinor, `${p.id}: the lines add up to what was paid in`)
    }
  })

  it("MP2 VAT is part of GoCardless's fee, said once; debits read with a minus sign", () => {
    const [p1] = parseClubPayouts(RAW)
    const gc = payoutLines(p1).find((l) => l.key === "gocardless")!
    assert.equal(gc.amountMinor, -582)
    assert.equal(gc.note, "Including £0.98 VAT")
    assert.equal(signedMoney(-582), "−£5.82")
    assert.equal(signedMoney(27473), "£274.73")
  })

  it("MP3 labels follow the content standard and nothing carries a provider id", () => {
    const [p1, p2] = parseClubPayouts(RAW)
    for (const l of payoutLines(p1)) assert.match(l.label, /^[A-Z]/, l.label)
    assert.equal(payoutStatusLabel(p1.status), "Paid")
    assert.equal(payoutStatusLabel(p2.status), "On its way")
    assert.equal(payoutStatusLabel("bounced"), "Returned by the bank")
    assert.ok(!/PO_|PM_|OR_/.test(JSON.stringify(parseClubPayouts(RAW))))
  })
})
