/**
 * WHICH MONTHS ARE COLLECTED HOW, WHEN A MEMBERSHIP STARTS -- each month exactly once.
 *
 * A membership is collected by a monthly GoCardless subscription on the club's collection day. Its first
 * month (and, near a month end, sometimes the next one) cannot always be collected by that subscription:
 *
 *   - a PRO-RATA first month is a smaller, one-off amount, so the subscription must start the month after;
 *   - a full first month whose collection day falls before the mandate's next possible charge date (Bacs
 *     needs a few working days for a new mandate) would otherwise be skipped by the subscription.
 *
 * Every such month is collected by its own one-off payment, and the subscription is given an EXPLICIT start
 * date on the first collection day after them. Leaving the start date to GoCardless was the defect: with a
 * late collection day the subscription's first charge could fall in the same month as the pro-rata one-off,
 * so October was collected twice (the audit's worked example: join 10 October, collection day 28 -- £11.35
 * then £16.00), and the second payment was then dropped from the ledger.
 *
 * Pure: dates in, plan out, so the rule is tested without a provider.
 */

export interface FirstCollectionPlan {
  /** First-of-month periods ('YYYY-MM-01') collected by a one-off payment each, in order. */
  oneOffPeriods: string[]
  /** The subscription's first charge date ('YYYY-MM-DD'): a collection day after every one-off period. */
  subscriptionStartDate: string
}

/** 'YYYY-MM-DD' for the given month's collection day (1-28, so it exists in every month). */
function collectionDateIn(period: string, collectionDay: number): string {
  return `${period.slice(0, 7)}-${String(collectionDay).padStart(2, "0")}`
}

/** The first of the month after `period` ('YYYY-MM-01'). */
export function nextPeriod(period: string): string {
  const [y, m] = period.slice(0, 7).split("-").map(Number)
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 }
  return `${next.y}-${String(next.m).padStart(2, "0")}-01`
}

export function planFirstCollection(input: {
  /** The month ('YYYY-MM-01') of this enrolment's first obligation. */
  firstPeriod: string
  /** Whether that first obligation is a pro-rata part month. */
  firstIsProrated: boolean
  /** The club's collection day, 1-28. */
  collectionDay: number
  /** The mandate's next possible charge date ('YYYY-MM-DD'), as GoCardless reported it, if known. */
  nextPossibleChargeDate: string | null
  /** Today ('YYYY-MM-DD'). */
  today: string
}): FirstCollectionPlan {
  if (!Number.isInteger(input.collectionDay) || input.collectionDay < 1 || input.collectionDay > 28) {
    throw new Error("The collection day must be between the 1st and the 28th.")
  }
  // The subscription can never charge before the mandate allows it, nor in the past.
  const earliest = input.nextPossibleChargeDate && input.nextPossibleChargeDate > input.today ? input.nextPossibleChargeDate : input.today

  // A pro-rata month is the one-off's, so the subscription's earliest month is the next one.
  let subscriptionPeriod = input.firstIsProrated ? nextPeriod(input.firstPeriod) : input.firstPeriod
  let start = collectionDateIn(subscriptionPeriod, input.collectionDay)
  // Bounded: a mandate's next possible charge date is days away, never months.
  for (let guard = 0; start < earliest && guard < 3; guard++) {
    subscriptionPeriod = nextPeriod(subscriptionPeriod)
    start = collectionDateIn(subscriptionPeriod, input.collectionDay)
  }

  const oneOffPeriods: string[] = []
  for (let p = input.firstPeriod; p < subscriptionPeriod; p = nextPeriod(p)) oneOffPeriods.push(p)
  return { oneOffPeriods, subscriptionStartDate: start }
}
