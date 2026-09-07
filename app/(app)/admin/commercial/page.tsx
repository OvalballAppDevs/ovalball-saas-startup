import { redirect } from "next/navigation"
import Link from "next/link"
import { Receipt } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"

import { ExtendTrialDialog } from "./extend-trial-dialog"

export const dynamic = "force-dynamic"

export const metadata = { title: "Commercial" }

const SECONDS_PER_DAY = 86_400
const TRIAL_WARNING_DAYS = 7

/**
 * The commercial picture across every club.
 *
 * Deliberately not a dashboard of tiles. Nobody opens this page to learn
 * that eleven clubs are on Standard; they open it because something needs
 * doing. So the clubs that need attention come first, the counts are a
 * quiet line below, and the full table is last.
 */
export default async function AdminCommercialPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok) redirect("/dashboard")

  if (!(await hasCapability(supabase, "site.commercial.view", "site"))) {
    redirect("/dashboard")
  }

  const canManage = await hasCapability(supabase, "site.commercial.manage", "site")

  const [overviewRes, referralRes] = await Promise.all([
    supabase.rpc("platform_commercial_overview"),
    supabase.from("platform_referrals").select("status"),
  ])

  // "Nothing needs attention" is an all-clear a Site Admin acts on -- it must
  // never be what a failed read looks like.
  const overviewError = overviewRes.error
  const referralError = referralRes.error
  const clubs = overviewRes.data ?? []
  const referrals = referralRes.data ?? []

  const daysLeft = (seconds: number | null) =>
    seconds === null ? null : Math.ceil(seconds / SECONDS_PER_DAY)

  const attention = clubs
    .map((club) => {
      const remaining = daysLeft(club.trial_remaining_seconds ? Number(club.trial_remaining_seconds) : null)

      if (club.subscription_status === "past_due") {
        return {
          club,
          headline: club.last_payment_failed_at
            ? `Payment failed ${relativeDays(club.last_payment_failed_at)}`
            : "Payment failed",
          detail: `${planLabel(club.plan_code)} · past due`,
        }
      }
      if (club.subscription_status === "pending_setup" && !club.mandate_present) {
        return {
          club,
          headline: "Plan chosen, no Direct Debit set up",
          detail: `${planLabel(club.plan_code)} · waiting on the club`,
        }
      }
      if (club.trial_status === "active" && remaining !== null && remaining <= TRIAL_WARNING_DAYS) {
        return {
          club,
          headline: remaining <= 1 ? "Trial ends today" : `Trial ends in ${remaining} days`,
          detail: club.plan_code ? planLabel(club.plan_code) : "No plan chosen yet",
        }
      }
      return null
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)

  const counts = {
    standard: clubs.filter((c) => c.plan_code === "standard" && isLive(c.subscription_status)).length,
    pro: clubs.filter((c) => c.plan_code === "pro" && isLive(c.subscription_status)).length,
    trial: clubs.filter((c) => c.trial_status === "active" || c.trial_status === "paused").length,
    pastDue: clubs.filter((c) => c.subscription_status === "past_due").length,
    cancelled: clubs.filter((c) => c.subscription_status === "cancelled" || c.subscription_status === "ended").length,
    creditPence: clubs.reduce((total, c) => total + (c.credit_balance_pence ?? 0), 0),
    referralsPending: referrals.filter((r) => r.status === "pending" || r.status === "registered").length,
    rewardsEarned: referrals.filter((r) => r.status === "qualified").length,
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <Receipt className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">Commercial</h1>
      <p className="mt-2 max-w-xl text-sm text-ink/55">
        Trials, Ovalball subscriptions, credits and referrals across every club. This is what clubs
        pay Ovalball &mdash; never what a club&rsquo;s own members pay the club.
      </p>

      {(overviewError || referralError) && (
        <div role="alert" className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-5 py-4">
          <p className="text-sm font-medium text-amber-950">
            {overviewError ? "Club commercial data" : "Referral data"} could not be loaded
          </p>
          <p className="mt-1 text-sm text-amber-900">
            This is a read failure, not a zero. Treat the figures below as incomplete rather than as an
            all-clear.
          </p>
          <p className="mt-1.5 font-mono text-xs break-words text-amber-900/80">
            {(overviewError ?? referralError)?.message}
          </p>
        </div>
      )}

      <section className="mt-8">
        <h2 className="font-display text-xl text-ink">Needs attention</h2>
        {overviewError ? (
          <p className="mt-3 rounded-lg border border-ink/10 bg-white px-5 py-4 text-sm text-ink/70">
            Unknown &mdash; the club commercial read failed above, so nothing can be checked for
            attention right now.
          </p>
        ) : attention.length === 0 ? (
          <p className="mt-3 rounded-lg border border-ink/10 bg-white px-5 py-4 text-sm text-ink/70">
            Nothing needs attention. No failed payments, no trial ending within a week, and no club
            waiting to finish setting up a Direct Debit.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-amber-900/10 rounded-lg border border-amber-300 bg-amber-50">
            {attention.map(({ club, headline, detail }) => (
              <li
                key={club.club_id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-amber-950">{club.club_name}</p>
                  <p className="text-xs text-amber-900">
                    {headline} &middot; {detail}
                  </p>
                </div>
                <Link
                  href={`/admin/clubs?q=${encodeURIComponent(club.club_slug)}`}
                  className="text-sm font-medium text-amber-950 underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-amber-950/50"
                >
                  Open club
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Context, not the point of the page — so a line of running text
          with tabular figures, not six big-number tiles. */}
      <p className="mt-8 border-y border-ink/10 py-4 text-sm text-ink/70 tabular-nums">
        {counts.standard} on Standard &middot; {counts.pro} on Pro &middot; {counts.trial} on trial
        &middot; {counts.pastDue} past due &middot; {counts.cancelled} cancelled
        <span className="block sm:inline sm:before:content-['_·_']">
          {formatMoney(counts.creditPence)} credit outstanding &middot; {counts.referralsPending} referrals
          pending &middot; {counts.rewardsEarned} rewards earned
        </span>
      </p>

      <p className="mt-3">
        <Link href="/admin/commercial/referrals" className="text-sm font-medium text-forest-800 underline underline-offset-4">
          Referral Administration →
        </Link>
      </p>

      <section className="mt-8">
        <h2 className="font-display text-xl text-ink">Every club</h2>

        {clubs.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-ink/15 px-5 py-8 text-center text-sm text-ink/55">
            No club has started a trial or taken a plan yet.
          </p>
        ) : (
          <>
            {/* Desktop: a table. Mobile: the same rows as cards, below. */}
            <div className="mt-3 hidden overflow-x-auto rounded-lg border border-ink/10 bg-white md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-left text-xs text-ink/55">
                    <th scope="col" className="px-5 py-3 font-medium">Club</th>
                    <th scope="col" className="px-5 py-3 font-medium">Plan</th>
                    <th scope="col" className="px-5 py-3 font-medium">Status</th>
                    <th scope="col" className="px-5 py-3 font-medium">Next collection</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Credit</th>
                    {canManage ? <th scope="col" className="px-5 py-3"><span className="sr-only">Actions</span></th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/8">
                  {clubs.map((club) => (
                    <tr key={club.club_id}>
                      <td className="px-5 py-3.5 text-ink">{club.club_name}</td>
                      <td className="px-5 py-3.5 text-ink/70">{planLabel(club.plan_code)}</td>
                      <td className="px-5 py-3.5">
                        <StatusPill
                          subscriptionStatus={club.subscription_status}
                          trialStatus={club.trial_status}
                          trialDays={daysLeft(club.trial_remaining_seconds ? Number(club.trial_remaining_seconds) : null)}
                        />
                      </td>
                      <td className="px-5 py-3.5 text-ink/70 tabular-nums">
                        {club.next_collection_on ? formatDate(club.next_collection_on) : "—"}
                      </td>
                      <td className="px-5 py-3.5 text-right text-ink/70 tabular-nums">
                        {formatMoney(club.credit_balance_pence ?? 0)}
                      </td>
                      {canManage ? (
                        <td className="px-5 py-3.5 text-right">
                          {club.trial_status ? (
                            <ExtendTrialDialog clubId={club.club_id} clubName={club.club_name} />
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="mt-3 space-y-2 md:hidden">
              {clubs.map((club) => (
                <li key={club.club_id} className="rounded-lg border border-ink/10 bg-white px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-ink">{club.club_name}</p>
                    <StatusPill
                      subscriptionStatus={club.subscription_status}
                      trialStatus={club.trial_status}
                      trialDays={daysLeft(club.trial_remaining_seconds ? Number(club.trial_remaining_seconds) : null)}
                    />
                  </div>
                  <dl className="mt-2 space-y-1 text-xs text-ink/60">
                    <div className="flex justify-between gap-3">
                      <dt>Plan</dt>
                      <dd className="text-ink/80">{planLabel(club.plan_code)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Next collection</dt>
                      <dd className="tabular-nums text-ink/80">
                        {club.next_collection_on ? formatDate(club.next_collection_on) : "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Credit</dt>
                      <dd className="tabular-nums text-ink/80">{formatMoney(club.credit_balance_pence ?? 0)}</dd>
                    </div>
                  </dl>
                  {canManage && club.trial_status ? (
                    <div className="mt-2.5">
                      <ExtendTrialDialog clubId={club.club_id} clubName={club.club_name} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}

/**
 * Status is carried by the word, never by the colour alone — the colour is
 * a second signal for people who read at a glance, not the only one.
 */
function StatusPill({
  subscriptionStatus,
  trialStatus,
  trialDays,
}: {
  subscriptionStatus: string | null
  trialStatus: string | null
  trialDays: number | null
}) {
  let label: string
  let tone: "good" | "warn" | "quiet"

  if (subscriptionStatus === "active") {
    label = "Active"
    tone = "good"
  } else if (subscriptionStatus === "past_due") {
    label = "Payment failed"
    tone = "warn"
  } else if (subscriptionStatus === "scheduled") {
    label = "Starting"
    tone = "good"
  } else if (subscriptionStatus === "pending_setup") {
    label = "Setup needed"
    tone = "warn"
  } else if (subscriptionStatus === "cancelled") {
    label = "Ending"
    tone = "quiet"
  } else if (subscriptionStatus === "ended") {
    label = "Ended"
    tone = "quiet"
  } else if (trialStatus === "active") {
    label = trialDays === null ? "On trial" : `Trial · ${trialDays}d`
    tone = trialDays !== null && trialDays <= TRIAL_WARNING_DAYS ? "warn" : "quiet"
  } else if (trialStatus === "paused") {
    label = "Trial paused"
    tone = "quiet"
  } else if (trialStatus === "completed") {
    label = "Trial ended"
    tone = "warn"
  } else {
    label = "No plan"
    tone = "quiet"
  }

  const toneClass =
    tone === "good"
      ? "bg-mint-100 text-forest-950"
      : tone === "warn"
        ? "bg-amber-50 text-amber-900"
        : "bg-ink/5 text-ink/60"

  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClass}`}>{label}</span>
  )
}

function isLive(status: string | null): boolean {
  return status === "active" || status === "past_due" || status === "scheduled"
}

function planLabel(code: string | null): string {
  if (code === "standard") return "Standard"
  if (code === "pro") return "Pro"
  return "—"
}

function formatMoney(pence: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(pence / 100)
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

function relativeDays(value: string): string {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / (SECONDS_PER_DAY * 1000))
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  return `${days} days ago`
}
