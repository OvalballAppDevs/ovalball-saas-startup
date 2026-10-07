// A MEMBERSHIP'S FIRST MONTHS ARE EACH COLLECTED EXACTLY ONCE (lib/payments/gocardless/collection-plan.ts).
//
// The audit of 5 October 2026 proved a first-month double charge: activation created a pro-rata one-off for
// the joining month AND a subscription with no start date, so with a late collection day GoCardless took the
// subscription's first payment in the same month (join 10 October, collection day 28: £11.35 + £16.00 for
// October). It also proved that the default settings (next collection day, the 1st) refused every join after
// the 1st. These cases are the audit's own worked examples, run through the one rule activation now uses.

import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { nextPeriod, planFirstCollection } from "@/lib/payments/gocardless/collection-plan"

/** Every month a plan collects, and how: one-off months, then the subscription's months from its start. */
function monthsCollected(plan: ReturnType<typeof planFirstCollection>, through: string): Map<string, number> {
  const seen = new Map<string, number>()
  for (const p of plan.oneOffPeriods) seen.set(p.slice(0, 7), (seen.get(p.slice(0, 7)) ?? 0) + 1)
  for (let p = `${plan.subscriptionStartDate.slice(0, 7)}-01`; p <= through; p = nextPeriod(p)) {
    seen.set(p.slice(0, 7), (seen.get(p.slice(0, 7)) ?? 0) + 1)
  }
  return seen
}

describe("first collection plan", () => {
  it("C1 the proven double charge cannot happen: a pro-rata October and collection day 28 start the subscription in November", () => {
    // Example C: join Sat 10 Oct 2026; the new mandate can charge from about Thu 15 Oct.
    const plan = planFirstCollection({ firstPeriod: "2026-10-01", firstIsProrated: true, collectionDay: 28, nextPossibleChargeDate: "2026-10-15", today: "2026-10-10" })
    assert.deepEqual(plan.oneOffPeriods, ["2026-10-01"])
    assert.equal(plan.subscriptionStartDate, "2026-11-28")
    for (const [month, times] of monthsCollected(plan, "2027-02-01")) assert.equal(times, 1, `${month} collected ${times} times`)
  })

  it("C2 Example A: pro-rata October, collection day 1 -- one-off for October, subscription from 1 November", () => {
    const plan = planFirstCollection({ firstPeriod: "2026-10-01", firstIsProrated: true, collectionDay: 1, nextPossibleChargeDate: "2026-10-16", today: "2026-10-10" })
    assert.deepEqual(plan, { oneOffPeriods: ["2026-10-01"], subscriptionStartDate: "2026-11-01" })
  })

  it("C3 Example D (the defaults): next collection day, the 1st, joining on the 10th -- November is the first month, collected by the subscription", () => {
    // The generator writes nothing for October; activation now takes November's obligation as the first.
    const plan = planFirstCollection({ firstPeriod: "2026-11-01", firstIsProrated: false, collectionDay: 1, nextPossibleChargeDate: "2026-10-16", today: "2026-10-10" })
    assert.deepEqual(plan, { oneOffPeriods: [], subscriptionStartDate: "2026-11-01" })
  })

  it("C4 a full first month the mandate cannot reach on its collection day is collected one-off, never skipped", () => {
    // Joining 30 Oct, first month November, collection day 1, mandate ready about 5 Nov: the subscription
    // cannot charge 1 November, so November is a one-off and the subscription starts 1 December.
    const plan = planFirstCollection({ firstPeriod: "2026-11-01", firstIsProrated: false, collectionDay: 1, nextPossibleChargeDate: "2026-11-05", today: "2026-10-30" })
    assert.deepEqual(plan, { oneOffPeriods: ["2026-11-01"], subscriptionStartDate: "2026-12-01" })
    for (const [month, times] of monthsCollected(plan, "2027-03-01")) assert.equal(times, 1, `${month} collected ${times} times`)
  })

  it("C5 a pro-rata month near the end of the month: both months the subscription cannot reach are one-offs", () => {
    const plan = planFirstCollection({ firstPeriod: "2026-10-01", firstIsProrated: true, collectionDay: 1, nextPossibleChargeDate: "2026-11-05", today: "2026-10-30" })
    assert.deepEqual(plan, { oneOffPeriods: ["2026-10-01", "2026-11-01"], subscriptionStartDate: "2026-12-01" })
  })

  it("C6 the subscription never starts before the mandate allows, nor in the past, and the year turns over", () => {
    const plan = planFirstCollection({ firstPeriod: "2026-12-01", firstIsProrated: true, collectionDay: 15, nextPossibleChargeDate: null, today: "2026-12-20" })
    assert.deepEqual(plan, { oneOffPeriods: ["2026-12-01"], subscriptionStartDate: "2027-01-15" })
    assert.ok(plan.subscriptionStartDate >= "2026-12-20")
  })

  it("C7 a collection day outside 1-28 is refused, as the database refuses it", () => {
    assert.throws(() => planFirstCollection({ firstPeriod: "2026-10-01", firstIsProrated: false, collectionDay: 31, nextPossibleChargeDate: null, today: "2026-10-01" }))
  })
})
