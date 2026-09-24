import { useCallback, useEffect, useRef, useState } from "react"
import { Linking, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams } from "expo-router"
import {
  FINANCE_MANDATE_STATUS_LABEL,
  FINANCE_SUBSCRIPTION_STATUS_LABEL,
  FINANCE_WEB_PATHS,
  formatFinanceDate,
  formatMinorUnits,
  hasSiblingDiscount,
  loadMembershipDetail,
  OBLIGATION_STATUS_LABEL,
  obligationTone,
  ordinalWord,
  PAYMENT_STATUS_LABEL,
  REVIEW_REASON_LABEL,
  type MembershipDetail,
} from "@ovalball/contracts/club/finance"

import { AdminScreen } from "../../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../../src/admin/access"
import { useFinanceAuthority } from "../../../../../src/admin/finance-authority"
import { Definition, FinancePill } from "../../../../../src/admin/finance-ui"
import { supabase } from "../../../../../src/auth/supabase"
import { webUrl } from "../../../../../src/config/environment"
import { Button, Card, CardSkeleton, EmptyState } from "../../../../../src/components/ui"
import { colour, space, type } from "../../../../../src/design/tokens"

/**
 * ONE MEMBERSHIP'S OPERATIONAL DETAIL -- the website's `/club/finance/[payerSubscriptionId]`, natively.
 *
 * ONE DOOR: `get_membership_operational_detail` decides whether this person may see this membership and
 * answers nothing when they may not -- the screen says "not found" and gives no existence signal. Player,
 * programme and payer by name and email only; mandate and subscription status in the web's own words;
 * and a history built from the canonical obligations each joined to the ONE provider attempt it produced.
 * Sibling arithmetic is the SNAPSHOT from this member's own enrolment, ordinal only -- never another
 * child's name or figures.
 *
 * CANCEL MEMBERSHIP is a provider write with the club's merchant token, held only by the web server. Where
 * the web offers it (`finance.payment.act`, an active payer), the phone hands off to the same page.
 */
export default function MembershipDetailScreen() {
  const { payerSubscriptionId } = useLocalSearchParams<{ payerSubscriptionId: string }>()
  const { clubId } = useAdminCentreAccess()
  const { authority } = useFinanceAuthority(clubId)
  const [detail, setDetail] = useState<MembershipDetail | null | undefined>(undefined)
  const generation = useRef(0)

  const load = useCallback(async () => {
    if (!payerSubscriptionId) return
    const gen = ++generation.current
    const next = await loadMembershipDetail(supabase, payerSubscriptionId).catch(() => null)
    if (gen === generation.current) setDetail(next)
  }, [payerSubscriptionId])

  useEffect(() => {
    void load()
  }, [load])
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const showCancel = Boolean(detail && authority.paymentAct && detail.payerStatus === "active" && webUrl)

  return (
    <AdminScreen section="Membership" onRefresh={() => void load()} refreshing={false}>
      {detail === undefined && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={3} />
          <CardSkeleton lines={4} />
        </View>
      )}
      {detail === null && <EmptyState title="Membership not found" body="It may have been removed, or it is not one you can see at this club." />}

      {detail && (
        <>
          <View style={{ gap: space.xs }}>
            <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
              {detail.playerName}
            </Text>
            <Text style={[type.body, { color: colour.inkMuted }]}>
              Payer: {detail.payerName || "—"}
              {detail.payerEmail ? ` (${detail.payerEmail})` : ""}
            </Text>
          </View>

          {detail.reviewReasons.length > 0 && (
            <View accessibilityRole="alert" style={{ padding: space.md, borderRadius: 12, backgroundColor: colour.warningSurface, gap: 4 }}>
              {detail.reviewReasons.map((reason) => (
                <Text key={reason} style={[type.smallMedium, { color: colour.warning }]}>
                  {REVIEW_REASON_LABEL[reason] ?? reason}
                </Text>
              ))}
            </View>
          )}
          {detail.payerStatus === "ended" && (
            <View style={{ padding: space.md, borderRadius: 12, backgroundColor: "rgba(16,21,18,0.05)" }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>Membership cancelled{detail.payerEffectiveTo ? ` (effective ${formatFinanceDate(detail.payerEffectiveTo)})` : ""}</Text>
              {detail.payerEndReason && <Text style={[type.caption, { color: colour.inkMuted }]}>{detail.payerEndReason}</Text>}
            </View>
          )}

          <Card style={{ gap: space.md }}>
            <Definition term="Monthly amount">
              {hasSiblingDiscount(detail) ? (
                <View style={{ gap: 2 }}>
                  <Text style={[type.small, { color: colour.ink }]}>Standard rate: {formatMinorUnits(detail.baseAmountMinor ?? 0)}</Text>
                  <Text style={[type.small, { color: colour.inkMuted }]}>
                    Sibling discount: {ordinalWord(detail.siblingOrdinal ?? 0)} child, {detail.siblingDiscountType === "PERCENTAGE" ? `${detail.siblingDiscountValue}%` : formatMinorUnits(detail.siblingDiscountValue ?? 0)} (-{formatMinorUnits(detail.siblingDiscountAmountMinor ?? 0)})
                  </Text>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>Membership rate: {formatMinorUnits(detail.finalAmountMinor ?? detail.baseAmountMinor ?? 0)}</Text>
                </View>
              ) : (
                <Text style={[type.small, { color: colour.ink }]}>{formatMinorUnits(detail.finalAmountMinor ?? detail.programmeAmountMinor ?? 0)}</Text>
              )}
            </Definition>
            <Definition term="First-payment policy">{detail.firstPaymentPolicy ?? "—"}</Definition>
            <Definition term="Direct Debit mandate">{detail.mandateStatus ? (FINANCE_MANDATE_STATUS_LABEL[detail.mandateStatus] ?? detail.mandateStatus) : "Not set up"}</Definition>
            <Definition term="Recurring subscription">{detail.subscriptionStatus ? (FINANCE_SUBSCRIPTION_STATUS_LABEL[detail.subscriptionStatus] ?? detail.subscriptionStatus) : "Not yet active"}</Definition>
          </Card>

          {showCancel && (
            <Card style={{ gap: space.sm }}>
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
                Cancel Membership
              </Text>
              <Text style={[type.small, { color: colour.inkMuted }]}>Stopping all future collections uses the club's GoCardless connection, which lives on the Ovalball website. The reason is asked for there and recorded.</Text>
              <Button label="Cancel Membership on the Website" variant="secondary" onPress={() => void Linking.openURL(`${webUrl}${FINANCE_WEB_PATHS.membership(detail.payerSubscriptionId)}`)} accessibilityHint="Opens the Ovalball website" />
            </Card>
          )}

          <View style={{ gap: space.sm }}>
            <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
              Payment History
            </Text>
            {detail.history.length === 0 ? (
              <EmptyState title="No billing history yet" body="Obligations appear here once they have been generated for a period." />
            ) : (
              <Card style={{ padding: 0, overflow: "hidden" }}>
                {detail.history.map((o, i) => (
                  <View key={o.obligationId} style={{ padding: space.lg, gap: 6, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={[type.smallMedium, { color: colour.ink }]}>{o.billingPeriod.slice(0, 7)}</Text>
                      <Text style={[type.smallMedium, { color: colour.ink, fontVariant: ["tabular-nums"] }]}>
                        {formatMinorUnits(o.amountMinor)}
                        {o.isProrated ? " · Pro-rata" : ""}
                      </Text>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
                      <FinancePill label={OBLIGATION_STATUS_LABEL[o.status] ?? o.status} tone={obligationTone(o.status)} />
                      <Text style={[type.caption, { color: colour.inkMuted }]}>Due {formatFinanceDate(o.dueDate)}</Text>
                    </View>
                    <Text style={[type.caption, { color: colour.inkMuted }]}>Payment: {o.payment ? (PAYMENT_STATUS_LABEL[o.payment.status] ?? o.payment.status) : "—"}</Text>
                  </View>
                ))}
              </Card>
            )}
          </View>
        </>
      )}
    </AdminScreen>
  )
}
