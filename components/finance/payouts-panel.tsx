import { formatFinanceDate } from "@ovalball/contracts/club/finance"
import { PAYOUTS_EXPLAINED, payoutStatusLabel, signedMoney, type ClubPayout } from "@ovalball/contracts/membership/payouts"
import { Panel, ToneChip } from "@/app/(app)/club/settings/subscriptions/membership-parts"

/**
 * WHAT REACHED THE CLUB'S BANK (20270754000000, Part 2 §29) -- each GoCardless payout, read left to right in the
 * order the money moved: what members paid through Ovalball, GoCardless's fees (VAT included in them), Ovalball's
 * fee, refunds and failures, the club's other GoCardless activity, and what was paid in. GoCardless's own figures,
 * from club_payouts; the same lines the app shows (packages/contracts/src/membership/payouts.ts).
 *
 * A table, because a club reconciles payouts against its bank statement line by line; it scrolls inside its own
 * frame on a phone rather than pushing the page sideways.
 */
export function PayoutsPanel({ payouts, problem = null }: { payouts: ClubPayout[] | null; problem?: string | null }) {
  return (
    <Panel id="payouts" title="Payouts" description={PAYOUTS_EXPLAINED}>
      {problem ? (
        <p role="alert" className="text-sm text-destructive-text">
          {problem}
        </p>
      ) : !payouts || payouts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink/15 p-5">
          <p className="text-sm font-medium text-ink">No payouts yet.</p>
          <p className="mt-1 text-sm text-ink-muted">The first arrives a few working days after GoCardless collects a payment.</p>
        </div>
      ) : (
        <div className="relative -mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[56rem] border-separate border-spacing-0 text-sm tabular-nums">
            <caption className="sr-only">
              Payouts, newest first: what members paid through Ovalball, GoCardless&apos;s fees, Ovalball&apos;s fee, refunds and failures, other GoCardless activity, and what was paid into the club&apos;s bank.
            </caption>
            <thead>
              <tr className="text-left text-xs font-semibold text-ink-muted">
                <th scope="col" className="border-b border-ink/10 py-2 pr-4 font-semibold">Arrived</th>
                <th scope="col" className="border-b border-ink/10 py-2 pr-4 font-semibold">Status</th>
                <th scope="col" className="border-b border-ink/10 py-2 pr-4 text-right font-semibold">Members Paid</th>
                <th scope="col" className="border-b border-ink/10 py-2 pr-4 text-right font-semibold">GoCardless&apos;s Fees</th>
                <th scope="col" className="border-b border-ink/10 py-2 pr-4 text-right font-semibold">Ovalball&apos;s Fee</th>
                <th scope="col" className="border-b border-ink/10 py-2 pr-4 text-right font-semibold">Refunds and Failures</th>
                <th scope="col" className="border-b border-ink/10 py-2 pr-4 text-right font-semibold">Other Activity</th>
                <th scope="col" className="border-b border-ink/10 py-2 text-right font-semibold text-ink">Paid In</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => {
                const adjustments = p.refundsMinor + p.failuresMinor
                return (
                  <tr key={p.id} className="align-top">
                    <th scope="row" className="border-b border-ink/5 py-3 pr-4 text-left font-medium text-ink">
                      <span className="block">{p.arrivalDate ? formatFinanceDate(p.arrivalDate, "long") : "Date to follow"}</span>
                      {p.reference && <span className="block text-xs font-normal text-ink-muted">Ref. {p.reference}</span>}
                    </th>
                    <td className="border-b border-ink/5 py-3 pr-4">
                      <ToneChip label={payoutStatusLabel(p.status)} tone={p.status === "paid" ? "settled" : p.status === "bounced" ? "attention" : "moving"} />
                      {p.items > 0 && !p.balanced && <span className="mt-1 block max-w-[12rem] text-xs text-amber-800">These lines don&apos;t add up to the payout; the amount paid in is GoCardless&apos;s own.</span>}
                      {p.items === 0 && <span className="mt-1 block max-w-[12rem] text-xs text-ink-muted">GoCardless&apos;s breakdown isn&apos;t available.</span>}
                    </td>
                    <td className="border-b border-ink/5 py-3 pr-4 text-right text-ink">{signedMoney(p.membersPaidMinor, p.currency)}</td>
                    <td className="border-b border-ink/5 py-3 pr-4 text-right text-ink">
                      {signedMoney(p.gocardlessFeesMinor, p.currency)}
                      {p.gocardlessVatMinor !== 0 && <span className="block text-xs text-ink-muted">incl. {signedMoney(Math.abs(p.gocardlessVatMinor), p.currency)} VAT</span>}
                    </td>
                    <td className="border-b border-ink/5 py-3 pr-4 text-right text-ink">{signedMoney(p.ovalballFeeMinor, p.currency)}</td>
                    <td className="border-b border-ink/5 py-3 pr-4 text-right text-ink">{adjustments === 0 ? <span className="text-ink-muted">—</span> : signedMoney(adjustments, p.currency)}</td>
                    <td className="border-b border-ink/5 py-3 pr-4 text-right text-ink">
                      {p.otherMinor === 0 ? <span className="text-ink-muted">—</span> : signedMoney(p.otherMinor, p.currency)}
                    </td>
                    <td className="border-b border-ink/5 py-3 text-right text-base font-semibold text-forest-800">{signedMoney(p.amountMinor, p.currency)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-3 max-w-prose text-xs text-ink-muted">
            Other activity is anything the club collected through GoCardless outside Ovalball, and its fees. GoCardless&apos;s fees include VAT where it applies.
          </p>
        </div>
      )}
    </Panel>
  )
}
