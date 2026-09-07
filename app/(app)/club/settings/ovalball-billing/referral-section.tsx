import Link from "next/link"

import { REFERRAL_OFFER_SUMMARY, type ClubReferral } from "@/lib/platform/referrals"

/**
 * Referring another club, on the same page as what Ovalball costs — because
 * that is when a club thinks about it.
 *
 * The offer is quoted exactly as the engine behaves. "Successfully
 * collected" is doing real work in that sentence: a reward is not earned on
 * a sign-up, a trial, or a submitted payment, and the copy must not promise
 * otherwise.
 */
export function ReferralSection({
  referrals,
  canRefer,
}: {
  referrals: ClubReferral[]
  canRefer: boolean
}) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-xl text-ink">Refer a club</h2>

      <div className="mt-4 rounded-lg bg-mint-100 px-5 py-5">
        <p className="max-w-xl text-sm leading-relaxed text-forest-950">{REFERRAL_OFFER_SUMMARY}</p>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          {canRefer ? (
            <Link
              href="/partner-clubs"
              className="inline-flex h-9 items-center rounded-lg bg-pitch-600 px-3.5 text-sm font-medium text-ink outline-none transition-colors hover:bg-pitch-600/80 focus-visible:ring-3 focus-visible:ring-pitch-400/50"
            >
              Invite a club to Ovalball
            </Link>
          ) : null}
          <Link
            href="/legal/referral-terms"
            className="text-sm font-medium text-forest-800 underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            Referral terms
          </Link>
        </div>
      </div>

      {referrals.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-ink/15 px-5 py-8 text-center text-sm text-ink-muted">
          You haven&rsquo;t referred a club yet. Invitations you send from Partner Clubs count.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-ink/8 rounded-lg border border-ink/10 bg-white">
          {referrals.map((referral) => {
            const shown = describeReferral(referral)
            return (
              <li
                key={referral.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="text-sm text-ink">{referral.referredClubName}</p>
                  <p className={`text-xs ${shown.attention ? "text-amber-900" : "text-ink-muted"}`}>{shown.label}</p>
                </div>
                <p className="text-sm tabular-nums text-ink/70">
                  {referral.rewardAmountPence !== null && referral.status === "qualified"
                    ? `+${formatMoney(referral.rewardAmountPence)}`
                    : formatDate(referral.createdAt)}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/**
 * Statuses are shown as what happened, never as the database's word.
 * `reversed` is the only one that gets colour, because it is the only one a
 * club needs to notice.
 */
function describeReferral(referral: ClubReferral): { label: string; attention: boolean } {
  switch (referral.status) {
    case "pending":
      return { label: "Invitation sent", attention: false }
    case "registered":
      return { label: "On Ovalball, not yet paid", attention: false }
    case "qualified":
      return { label: "Reward earned", attention: false }
    case "reversed":
      return { label: "Reward withdrawn — their payment didn't complete", attention: true }
    case "rejected":
      return { label: "Not eligible", attention: false }
  }
}

function formatMoney(pence: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 }).format(
    pence / 100
  )
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}
