import { useCallback, useEffect, useRef, useState } from "react"
import { Linking, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import {
  choosePlatformPlan,
  describeBillingState,
  describeCreditSource,
  describeNextCollection,
  describePlatformPayment,
  describeReferral,
  FINANCE_WEB_PATHS,
  financeErrorMessage,
  formatFinanceDate,
  formatMinorUnits,
  loadOvalballBilling,
  REFERRAL_OFFER_SUMMARY,
  startPlatformTrial,
  type OvalballBilling,
  type PlatformPlanCard,
} from "@ovalball/contracts/club/finance"

import { AdminScreen } from "../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../src/admin/access"
import { useFinanceAuthority } from "../../../../src/admin/finance-authority"
import { Notice } from "../../../../src/admin/finance-ui"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { resumedAsk, usePendingIntent } from "../../../../src/admin/pending-intent"
import { supabase } from "../../../../src/auth/supabase"
import { useAppContexts } from "../../../../src/context/contexts"
import { webUrl } from "../../../../src/config/environment"
import { Button, Card, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { colour, onForest, radius, space, type } from "../../../../src/design/tokens"

/**
 * OVALBALL PLAN -- what THIS CLUB PAYS OVALBALL, natively (CA-M11.1, Domain B).
 *
 * The website's `/club/settings/ovalball-billing` over the same RPCs and tables (`club_platform_billing_state`,
 * `club_platform_next_collection`, `platform_plans`, `platform_payments`, `platform_credits`,
 * `club_referral_summary`). The opposite direction of money from Subscriptions & Payments; the two share
 * no table and nothing here reads one of the club's own member records.
 *
 * The club is the ACTIVE context's club, as the web resolves it from the active-context cookie -- never a
 * value typed into a form. Choosing a plan and starting the trial are `select_club_plan` and
 * `start_club_trial`, offered only where `finance.platform_billing.manage` says so and judged again by the
 * server. A plan that cannot be bought gets no button at all, not a greyed-out one. The club's own Direct
 * Debit to Ovalball is provider-hosted and has no client entry point today, on either client.
 */
export default function OvalballPlanScreen() {
  const router = useRouter()
  const { club } = useAppContexts()
  const { clubId, refresh: refreshAccess } = useAdminCentreAccess()
  const { loading: authorityLoading, authority, refresh: refreshAuthority } = useFinanceAuthority(clubId)
  const [billing, setBilling] = useState<OvalballBilling | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)
  const pending = usePendingIntent("finance:ovalball-billing")
  const generation = useRef(0)
  const clubName = club.name ?? "This club"

  const load = useCallback(async () => {
    if (!clubId || authorityLoading || !authority.platformBillingView) {
      if (!authorityLoading) setLoading(false)
      return
    }
    const gen = ++generation.current
    setError(null)
    setLoading(true)
    try {
      const next = await loadOvalballBilling(supabase, clubId, authority)
      if (gen !== generation.current) return
      setBilling(next)
    } catch (cause) {
      const translated = friendly(cause, "the club's Ovalball plan")
      logDetail("admin:subscriptions:ovalball-billing", translated)
      if (gen === generation.current) setError(translated)
    } finally {
      if (gen === generation.current) setLoading(false)
    }
  }, [clubId, authorityLoading, authority])

  useEffect(() => {
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
      const resume = pending.take()
      if (resume) setAsk(resumedAsk(resume))
    }, [load, pending])
  )

  function startTrial() {
    if (!clubId) return
    setAsk({
      title: "Start the free trial?",
      body: "Thirty usable days. The clock stops whenever Ovalball is in Beta, so you never lose days you could not use. Starting it twice does nothing extra.",
      confirmLabel: "Start the Free Trial",
      reason: "none",
      onConfirm: async () => {
        await startPlatformTrial(supabase, clubId)
        setNotice({ tone: "ok", text: "Trial started." })
        await load()
      },
    })
  }

  function choose(plan: PlatformPlanCard) {
    if (!clubId) return
    setAsk({
      title: `Choose ${plan.name}?`,
      body: `${plan.priceLabel}. The price is agreed now and snapshotted; a later list-price change does not move it.`,
      confirmLabel: `Choose ${plan.name}`,
      reason: "none",
      onConfirm: async () => {
        await choosePlatformPlan(supabase, clubId, plan.code)
        setNotice({ tone: "ok", text: `${plan.name} chosen.` })
        await load()
      },
    })
  }

  const state = billing?.state ?? null
  const planName = state ? (billing?.plans.find((p) => p.code === state.effectivePlan)?.name ?? "Your plan") : "Your plan"
  const headline = state ? describeBillingState(state, planName) : null
  const nextLine = state ? describeNextCollection(state, billing?.nextCollection ?? null) : null

  return (
    <AdminScreen section="Ovalball Plan" onRefresh={() => void Promise.all([refreshAuthority(), load()])} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Ovalball Plan
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>{clubName} pays Ovalball to use the platform. What your own members pay the club is under Subscriptions & Payments.</Text>
      </View>

      <Notice notice={notice} />

      {(authorityLoading || (loading && !billing)) && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={3} />
          <CardSkeleton lines={2} />
        </View>
      )}
      {!authorityLoading && !authority.platformBillingView && <EmptyState title="Not for you at this club" body="Seeing the club's Ovalball plan needs the platform billing permission at this club." />}
      {error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}

      {billing && authority.platformBillingView && (
        <>
          {state && headline && nextLine && (
            <View style={{ borderRadius: radius.lg, backgroundColor: colour.forest950, padding: space.xl, gap: space.md }}>
              <Text accessibilityRole="header" style={[type.displaySmall, { color: onForest.primary }]}>
                {headline.headline}
              </Text>
              {headline.explanation && <Text style={[type.small, { color: onForest.secondary }]}>{headline.explanation}</Text>}
              <View style={{ borderTopWidth: 1, borderTopColor: onForest.line, paddingTop: space.md, gap: space.sm }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
                  <Text style={[type.small, { color: onForest.secondary }]}>Next collection</Text>
                  <Text style={[type.small, { color: nextLine.attention ? "#fef3c7" : onForest.primary, flexShrink: 1, textAlign: "right" }]}>{nextLine.text}</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
                  <Text style={[type.small, { color: onForest.secondary }]}>Credit</Text>
                  <Text style={[type.small, { color: onForest.primary, fontVariant: ["tabular-nums"] }]}>{formatMinorUnits(state.creditBalancePence)}</Text>
                </View>
              </View>
            </View>
          )}

          {billing.hasNothingYet && authority.platformBillingManage && (
            <Card style={{ gap: space.md }}>
              <Text style={[type.small, { color: colour.inkMuted }]}>{clubName} has not started an Ovalball trial yet. A trial is thirty usable days -- the clock stops whenever Ovalball is in Beta, so you never lose days you could not use.</Text>
              <Button label="Start the Free Trial" onPress={startTrial} />
            </Card>
          )}

          <View style={{ gap: space.sm }}>
            <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
              Plans
            </Text>
            {billing.plans.map((plan) => {
              const isCurrent = plan.code === billing.currentPlanCode
              const unavailable = !plan.purchasable
              return (
                <Card key={plan.code} style={{ gap: space.sm, borderColor: isCurrent ? colour.forest800 : colour.line }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space.md }}>
                    <Text style={[type.heading, { color: unavailable ? colour.inkMuted : colour.ink }]}>{plan.name}</Text>
                    <Text style={[type.small, { color: colour.inkMuted, fontVariant: ["tabular-nums"] }]}>{plan.priceLabel}</Text>
                  </View>
                  {plan.status === "coming_soon" ? <Text style={[type.caption, { color: colour.inkMuted }]}>Coming soon</Text> : isCurrent ? <Text style={[type.smallMedium, { color: colour.forest800 }]}>Your current plan</Text> : null}
                  {plan.description && <Text style={[type.small, { color: colour.inkMuted }]}>{plan.description}</Text>}
                  {unavailable && plan.addsNothingYet && plan.comparedWithPlanName && (
                    <Text style={[type.small, { color: colour.inkMuted }]}>
                      {plan.name} doesn't include anything {plan.comparedWithPlanName} doesn't yet. When it does, you'll be able to switch.
                    </Text>
                  )}
                  {plan.purchasable && !isCurrent && authority.platformBillingManage && <Button label={`Choose ${plan.name}`} onPress={() => choose(plan)} />}
                </Card>
              )
            })}
          </View>

          <View style={{ gap: space.sm }}>
            <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
              Billing History
            </Text>
            {billing.payments.length === 0 ? (
              <EmptyState title="Nothing collected yet" body={`Ovalball has not collected anything from ${clubName} yet.`} />
            ) : (
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {billing.payments.map((p, i) => (
                  <View key={p.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md, padding: space.lg, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                    <View style={{ gap: 2 }}>
                      <Text style={[type.smallMedium, { color: colour.ink, fontVariant: ["tabular-nums"] }]}>{formatMinorUnits(p.netPence)}</Text>
                      <Text style={[type.caption, { color: colour.inkMuted }]}>{p.chargeDate ? formatFinanceDate(p.chargeDate) : "Not yet scheduled"}</Text>
                    </View>
                    <Text style={[type.small, { color: p.status === "failed" ? colour.warning : colour.inkMuted, flexShrink: 1, textAlign: "right" }]}>{describePlatformPayment(p)}</Text>
                  </View>
                ))}
              </Card>
            )}
          </View>

          <View style={{ gap: space.sm }}>
            <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
              Credit
            </Text>
            {billing.credits.length === 0 ? (
              <EmptyState title="No credit yet" body="Referring a club that goes on to pay is one way to earn some." />
            ) : (
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {billing.credits.map((c, i) => (
                  <View key={c.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md, padding: space.lg, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                    <View style={{ gap: 2, flexShrink: 1 }}>
                      <Text style={[type.smallMedium, { color: colour.ink, fontVariant: ["tabular-nums"] }]}>
                        {c.amountPence > 0 ? "+" : "−"}
                        {formatMinorUnits(Math.abs(c.amountPence))}
                      </Text>
                      <Text style={[type.caption, { color: colour.inkMuted }]}>{c.reason ?? describeCreditSource(c.source)}</Text>
                    </View>
                    <Text style={[type.caption, { color: colour.inkMuted }]}>{formatFinanceDate(c.createdAt)}</Text>
                  </View>
                ))}
              </Card>
            )}
          </View>

          {authority.referralsView && (
            <View style={{ gap: space.sm }}>
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
                Refer a Club
              </Text>
              <View style={{ borderRadius: radius.lg, backgroundColor: colour.mint100, padding: space.lg, gap: space.md }}>
                <Text style={[type.small, { color: colour.forest950 }]}>{REFERRAL_OFFER_SUMMARY}</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                  {authority.platformBillingManage && webUrl ? <Button label="Invite a Club to Ovalball" onPress={() => void Linking.openURL(`${webUrl}${FINANCE_WEB_PATHS.partnerClubs}`)} accessibilityHint="Opens Partner Clubs on the Ovalball website" /> : null}
                  {webUrl ? <Button label="Referral Terms" variant="quiet" onPress={() => void Linking.openURL(`${webUrl}${FINANCE_WEB_PATHS.referralTerms}`)} accessibilityHint="Opens the Ovalball website" /> : null}
                </View>
              </View>
              {billing.referrals.length === 0 ? (
                <EmptyState title="No referrals yet" body="Invitations you send from Partner Clubs count." />
              ) : (
                <Card style={{ padding: 0, overflow: "hidden" }}>
                  {billing.referrals.map((r, i) => {
                    const shown = describeReferral(r)
                    return (
                      <View key={r.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.md, padding: space.lg, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                        <View style={{ gap: 2, flexShrink: 1 }}>
                          <Text style={[type.smallMedium, { color: colour.ink }]}>{r.referredClubName}</Text>
                          <Text style={[type.caption, { color: shown.attention ? colour.warning : colour.inkMuted }]}>{shown.label}</Text>
                        </View>
                        <Text style={[type.caption, { color: colour.inkMuted, fontVariant: ["tabular-nums"] }]}>{r.rewardAmountPence !== null && r.status === "qualified" ? `+${formatMinorUnits(r.rewardAmountPence)}` : formatFinanceDate(r.createdAt)}</Text>
                      </View>
                    )
                  })}
                </Card>
              )}
            </View>
          )}
        </>
      )}

      <ReasonSheet
        ask={ask}
        onClose={() => setAsk(null)}
        onRefused={() => void Promise.all([refreshAccess(), refreshAuthority()])}
        onStepUp={(reason) => {
          if (ask) pending.hold(ask, reason)
          setAsk(null)
          router.push({ pathname: "/step-up", params: { returnTo: "/admin/subscriptions/ovalball-billing" } } as never)
        }}
        errorMessage={(cause) => financeErrorMessage(cause, friendly(cause, "this change").message)}
      />
    </AdminScreen>
  )
}
