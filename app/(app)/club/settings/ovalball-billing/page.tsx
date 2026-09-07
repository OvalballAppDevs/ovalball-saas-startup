import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { getClubReferrals } from "@/lib/platform/referrals"
import { formatPlanPrice, getPlatformPlans } from "@/lib/platform/plans"
import { getClubBillingState, getNextCollection } from "@/lib/platform/subscription"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"

import { ClubSettingsNav } from "../club-settings-nav"
import { resolveClubSettingsNavCapabilities } from "../resolve-nav-capabilities"
import { BillingStateBlock } from "./billing-state-block"
import { PlanChooser, type PlanCard } from "./plan-chooser"
import { ReferralSection } from "./referral-section"
import { StartTrialButton } from "./start-trial-button"

export const dynamic = "force-dynamic"

export const metadata = { title: "Ovalball Subscription | Club Settings" }

/**
 * Club Settings → Ovalball Plan.
 *
 * What THIS CLUB PAYS OVALBALL. The sibling "Subscriptions & Payments" tab
 * is the opposite direction: what this club's own members pay the club,
 * through the club's own connected merchant. The two share no table, no
 * merchant and no webhook, and the first line of each page says which is
 * which so a Club Admin who lands on the wrong one knows immediately.
 */
export default async function OvalballBillingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const clubId = activeClubId(ctx, activeContext)
  if (!clubId) redirect("/dashboard")

  const [navCaps, canManage, canReferrals] = await Promise.all([
    resolveClubSettingsNavCapabilities(supabase, clubId),
    hasCapability(supabase, "club.platform_billing.manage", "club", { clubId }),
    hasCapability(supabase, "club.referrals.view", "club", { clubId }),
  ])
  const canView = navCaps.canPlatformBillingView

  if (!canView) redirect("/club/settings")

  const clubName = activeContext.kind === "club" ? activeContext.label : "This club"

  const [state, nextCollection, plans, referrals, { data: payments }, { data: credits }, { data: planEntitlements }] =
    await Promise.all([
      getClubBillingState(supabase, clubId),
      getNextCollection(supabase, clubId),
      getPlatformPlans(supabase),
      canReferrals ? getClubReferrals(supabase, clubId) : Promise.resolve([]),
      supabase
        .from("platform_payments")
        .select("id, gross_pence, credit_applied_pence, net_pence, status, charge_date, failure_reason")
        .eq("club_id", clubId)
        .order("charge_date", { ascending: false })
        .limit(24),
      supabase
        .from("platform_credits")
        .select("id, amount_pence, source, reason, created_at")
        .eq("club_id", clubId)
        .order("seq", { ascending: false })
        .limit(24),
      supabase.from("platform_plan_entitlements").select("plan_code, entitlement_key"),
    ])

  // Which purchasable plan a closed plan is being compared against, and
  // whether it genuinely adds nothing. Read from the data rather than
  // asserted in copy, so the sentence disappears the moment Pro means
  // something.
  const entitlementsByPlan = new Map<string, Set<string>>()
  for (const row of planEntitlements ?? []) {
    const set = entitlementsByPlan.get(row.plan_code) ?? new Set<string>()
    set.add(row.entitlement_key)
    entitlementsByPlan.set(row.plan_code, set)
  }
  const purchasablePlan = plans.find((p) => p.purchasable) ?? null

  const planCards: PlanCard[] = plans.map((plan) => {
    const mine = entitlementsByPlan.get(plan.code) ?? new Set<string>()
    const baseline = purchasablePlan ? (entitlementsByPlan.get(purchasablePlan.code) ?? new Set<string>()) : new Set<string>()
    const addsNothingYet =
      purchasablePlan !== null &&
      plan.code !== purchasablePlan.code &&
      [...mine].every((key) => baseline.has(key))

    return {
      code: plan.code,
      name: plan.name,
      description: plan.description,
      priceLabel: formatPlanPrice(plan),
      status: plan.status,
      purchasable: plan.purchasable,
      addsNothingYet,
      comparedWithPlanName: purchasablePlan?.name ?? null,
    }
  })

  const hasNothingYet = state === null || (state.effectivePlan === null && state.trialStatus === null)

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Club Settings</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Ovalball Plan</h1>
      {/* Direction of money, in the first line. The sibling tab's lede is the
          mirror image of this sentence. */}
      <p className="mt-2 max-w-xl text-sm text-ink-muted">
        {clubName} pays Ovalball to use the platform. What your own members pay the club is under{" "}
        <Link
          href="/club/settings/subscriptions"
          className="font-medium text-forest-800 underline underline-offset-4"
        >
          Subscriptions &amp; Payments
        </Link>
        .
      </p>

      <ClubSettingsNav active="ovalballBilling" {...navCaps} />

      {state ? (
        <BillingStateBlock
          state={state}
          planName={plans.find((p) => p.code === state.effectivePlan)?.name ?? null}
          nextCollection={nextCollection}
        />
      ) : null}

      {hasNothingYet && canManage ? (
        <div className="mt-6 rounded-lg border border-ink/10 bg-white p-5">
          <p className="text-sm text-ink/70">
            {clubName} has not started an Ovalball trial yet. A trial is thirty usable days &mdash; the clock
            stops whenever Ovalball is in Beta, so you never lose days you could not use.
          </p>
          <div className="mt-4">
            <StartTrialButton />
          </div>
        </div>
      ) : null}

      {/* The plan a club HAS, not the plan its trial grants. A trial resolves
          `effectivePlan` to Standard, and treating that as "your current plan"
          would remove the very button a trialling club needs in order to
          convert. */}
      <PlanChooser
        plans={planCards}
        currentPlanCode={state?.subscriptionStatus ? (state.effectivePlan ?? null) : null}
        canManage={canManage}
      />

      <section className="mt-10">
        <h2 className="font-display text-xl text-ink">Billing history</h2>
        {(payments ?? []).length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-ink/15 px-5 py-8 text-center text-sm text-ink-muted">
            Ovalball has not collected anything from {clubName} yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-ink/8 rounded-lg border border-ink/10 bg-white">
            {(payments ?? []).map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="text-sm tabular-nums text-ink">{formatMoney(payment.net_pence)}</p>
                  <p className="text-xs text-ink-muted">
                    {payment.charge_date ? formatDate(payment.charge_date) : "Not yet scheduled"}
                  </p>
                </div>
                <p className={`text-sm ${payment.status === "failed" ? "text-amber-900" : "text-ink/70"}`}>
                  {describePayment(payment.status, payment.credit_applied_pence, payment.failure_reason)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="font-display text-xl text-ink">Credit</h2>
        {(credits ?? []).length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-ink/15 px-5 py-8 text-center text-sm text-ink-muted">
            No credit yet. Referring a club that goes on to pay is one way to earn some.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-ink/8 rounded-lg border border-ink/10 bg-white">
            {(credits ?? []).map((credit) => (
              <li
                key={credit.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="text-sm tabular-nums text-ink">
                    {credit.amount_pence > 0 ? "+" : "−"}
                    {formatMoney(Math.abs(credit.amount_pence))}
                  </p>
                  <p className="text-xs text-ink-muted">{credit.reason ?? describeCreditSource(credit.source)}</p>
                </div>
                <p className="text-sm text-ink-muted">{formatDate(credit.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canReferrals ? <ReferralSection referrals={referrals} canRefer={canManage} /> : null}
    </div>
  )
}

function describePayment(status: string, creditApplied: number, failureReason: string | null): string {
  switch (status) {
    case "confirmed":
      return "Collected"
    case "skipped":
      return `Skipped — covered by your ${formatMoney(creditApplied)} credit`
    case "failed":
      return failureReason ? `Failed — ${failureReason.replace(/_/g, " ")}` : "Failed"
    case "submitted":
      return "On its way to your bank"
    case "cancelled":
      return "Cancelled"
    default:
      return "Scheduled"
  }
}

function describeCreditSource(source: string): string {
  switch (source) {
    case "referral_reward":
      return "Referral reward"
    case "goodwill":
      return "Credit from Ovalball"
    case "beta_adjustment":
      return "Beta adjustment"
    case "application":
      return "Applied to a collection"
    case "reversal":
      return "Reversed"
    default:
      return "Credit"
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
