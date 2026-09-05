import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { ClubSettingsNav } from "../club-settings-nav"
import { GoCardlessConnectPanel } from "./gocardless-connect-panel"
import { PricePanel } from "./price-panel"
import { SiblingDiscountPanel } from "./sibling-discount-panel"
import { SubscriptionSettingsForm } from "./subscription-settings-form"
import { getSiblingDiscountRules } from "./actions"

/**
 * Club Settings > Subscriptions & Payments (Side Project 1 integration).
 * Renders the explicit state machine (never just an on/off checkbox), the
 * GoCardless connection panel (OAuth-only, no token ever shown here), and
 * effective-dated pricing. Sandbox-only for the whole feature -- nothing
 * on this page can create a live mandate or move real money.
 */
export default async function ClubSubscriptionsSettingsPage({ searchParams }: { searchParams: Promise<{ gc_connected?: string; gc_error?: string }> }) {
  const params = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const clubId = activeClubId(ctx, activeContext)

  const [canConfigure, canViewFinance, canProfile, canVenues, canPitches, canRollover, canPitchAllocation, canPlayerMoves, canGuardians] = clubId
    ? await Promise.all([
        hasCapability(supabase, "club.subscription.configure", "club", { clubId }),
        hasCapability(supabase, "club.subscription.view_finance", "club", { clubId }),
        hasCapability(supabase, "club.edit_profile", "club", { clubId }),
        hasCapability(supabase, "club.venues.manage", "club", { clubId }),
        hasCapability(supabase, "club.pitches.manage", "club", { clubId }),
        hasCapability(supabase, "club.season_rollover.manage", "club", { clubId }),
        hasCapability(supabase, "fixture.edit", "club", { clubId }),
        hasCapability(supabase, "manage_fixture_callups", "club", { clubId }),
        hasCapability(supabase, "club.guardians.manage", "club", { clubId }),
      ])
    : [false, false, false, false, false, false, false, false, false]
  if (!clubId || (!canConfigure && !canViewFinance)) redirect("/club/settings")
  const canTeams = canProfile || canPitches

  const clubName = activeContext.kind === "club" ? activeContext.label : "Club"

  const [{ data: programme }, { data: pricing }, { data: connection }] = await Promise.all([
    supabase.from("club_subscription_programmes").select("id, enabled, collection_day, platform_fee_mode, first_payment_policy, currency").eq("club_id", clubId).maybeSingle(),
    supabase.from("club_subscription_pricing").select("id, amount_minor, effective_from").order("effective_from", { ascending: false }),
    supabase.rpc("get_gocardless_connection_status", { p_club_id: clubId }).maybeSingle(),
  ])

  const today = new Date().toISOString().slice(0, 10)
  const currentPrice = pricing?.find((p) => p.effective_from <= today) ?? null

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Club Settings</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Subscriptions &amp; Payments</h1>
      <p className="mt-2 max-w-md text-sm text-ink/55">Monthly membership subscriptions for {clubName}, collected via GoCardless Direct Debit. Sandbox only -- no real money moves through this feature yet.</p>

      <ClubSettingsNav
        active="subscriptions"
        canProfile={canProfile}
        canTeams={canTeams}
        canVenues={canVenues}
        canRollover={canRollover}
        canPitchAllocation={canPitchAllocation}
        canPlayerMoves={canPlayerMoves}
        canGuardians={canGuardians}
        canSubscriptions
      />

      {params.gc_error && <p className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{params.gc_error}</p>}
      {params.gc_connected && <p className="mt-6 rounded-lg border border-pitch-600/30 bg-pitch-50 px-4 py-3 text-sm text-forest-800">GoCardless connected successfully.</p>}

      <section className="mt-8">
        <GoCardlessConnectPanel clubId={clubId} connected={Boolean(connection)} verificationStatus={connection?.verification_status ?? null} connectedAt={connection?.connected_at ?? null} canConnect={canConfigure} />
      </section>

      {canConfigure && (
        <section className="mt-8">
          <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Programme settings</h2>
          <div className="mt-3">
            <SubscriptionSettingsForm
              clubId={clubId}
              monthlyAmountMinor={currentPrice?.amount_minor ?? null}
              initial={{
                enabled: programme?.enabled ?? false,
                collectionDay: programme?.collection_day ?? 1,
                platformFeeMode: (programme?.platform_fee_mode as "NONE" | "PARTNER_REVENUE_SHARE") ?? "NONE",
                firstPaymentPolicy: (programme?.first_payment_policy as "PRORATE_CURRENT_MONTH" | "NEXT_COLLECTION_DAY") ?? "NEXT_COLLECTION_DAY",
              }}
            />
          </div>
        </section>
      )}

      {canConfigure && programme && (
        <section className="mt-8">
          <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Pricing</h2>
          <div className="mt-3">
            <PricePanel programmeId={programme.id} clubId={clubId} currentAmountMinor={currentPrice?.amount_minor ?? null} priceHistory={pricing ?? []} />
          </div>
        </section>
      )}

      {canConfigure && programme && (
        <section className="mt-8">
          <div className="mt-3">
            <SiblingDiscountPanel programmeId={programme.id} clubId={clubId} rules={await getSiblingDiscountRules(programme.id)} />
          </div>
        </section>
      )}

      {canViewFinance && (
        <section className="mt-8 border-t border-ink/10 pt-6">
          <Link href="/club/finance" className="text-sm font-medium text-forest-800 underline underline-offset-4 hover:text-forest-950">
            View Finance Dashboard →
          </Link>
        </section>
      )}
    </div>
  )
}
