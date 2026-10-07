import { useCallback, useEffect, useRef, useState } from "react"
import { AccessibilityInfo, Linking, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import {
  billingPeriodLabel,
  describeSiblingRule,
  FINANCE_MANDATE_STATUS_LABEL,
  FINANCE_SUBSCRIPTION_STATUS_LABEL,
  FINANCE_WEB_PATHS,
  formatFinanceDate,
  formatMinorUnits,
  OBLIGATION_STATUS_SHORT,
  obligationTone,
  ordinalWord,
} from "@ovalball/contracts/club/finance"
import { formatMoneyMinor, reminderOutcomeSentence, remindAgainOn, sendMembershipReminders } from "@ovalball/contracts/membership/board"
import { standingGuidance } from "@ovalball/contracts/membership/operate"
import { askableSentence, CHANGE_PAYER_STEPS, feePositionLabel, loadClubMemberMembership, releaseResponsiblePayer, type ClubMemberMembership, type MemberPaymentMonth } from "@ovalball/contracts/membership/member"
import { membershipMoneyLine, membershipSetupErrorMessage } from "@ovalball/contracts/membership/setup"

import { AdminScreen } from "../../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../../src/admin/access"
import { useFinanceAuthority } from "../../../../../src/admin/finance-authority"
import { FinancePill, NavRow, Notice } from "../../../../../src/admin/finance-ui"
import { supabase } from "../../../../../src/auth/supabase"
import { webUrl } from "../../../../../src/config/environment"
import { Sheet } from "../../../../../src/components/field-sheet"
import { ArrowRightLeft, ChevronRight, ExternalLink, Send } from "../../../../../src/components/icons"
import { Button, Card, CardSkeleton, EmptyState, ErrorState } from "../../../../../src/components/ui"
import { friendly, friendlyAction, logDetail, type FriendlyError } from "../../../../../src/errors/translate"
import { remindedLine } from "../../../../../src/membership/board-ui"
import { AsyncButton, ContactRow, DetailRow, IdentityBlock, StatusCard, personName, reminderProblem, spoken } from "../../../../../src/membership/running-ui"
import { ToneChip } from "../../../../../src/membership/setup-ui"
import { LARGE_TEXT_SCALE, TOUCH_TARGET, colour, font, radius, space, type } from "../../../../../src/design/tokens"

/**
 * ONE MEMBER -- where their membership stands and the one thing to do about it (Club Memberships Part 2).
 *
 * Keyed by the PLAYER, so somebody nobody has set a membership up for has a page too: `club_member_membership`
 * decides everything on it -- the standing, who a reminder would go to, whether this reader may see the payer's
 * email and telephone (the People rule), and what this reader may do (`can`). Nothing is worked out here: what
 * the Direct Debit collects a month, and Ovalball's fee on it, are the membership's own snapshot from the server.
 *
 * One scroll, in the order a person needs it: the status and its one action; the membership; who pays; the Direct
 * Debit in words; and the months' payments with Ovalball's fee and where it stands.
 *
 * CHANGING WHO PAYS ends the current payer's set-up through `release_responsible_payer`, with a reason; the server
 * refuses while a GoCardless collection is running, and the way forward -- cancelling the membership -- is offered
 * beside its sentence. CANCEL and RETRY are provider writes with the club's merchant token, held only by the web
 * server, so they hand off to the membership's page on the website, where the web offers them (`finance.payment.act`).
 */

const FIRST_PAYMENT_WORDS: Record<string, string> = {
  PRORATE_CURRENT_MONTH: "Part month",
  NEXT_COLLECTION_DAY: "From the next collection day",
}

type Said = { tone: "ok" | "error"; text: string }

export default function MemberDetailScreen() {
  const router = useRouter()
  const { playerId } = useLocalSearchParams<{ playerId: string }>()
  const { clubId } = useAdminCentreAccess()
  const { loading: authorityLoading, authority, refresh: refreshAuthority } = useFinanceAuthority(clubId)
  const [data, setData] = useState<ClubMemberMembership | null | undefined>(undefined)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [refused, setRefused] = useState(false)
  const [notice, setNotice] = useState<Said | null>(null)
  const [changing, setChanging] = useState(false)
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<{ text: string; collecting: boolean } | null>(null)
  const generation = useRef(0)
  const { height } = useWindowDimensions()

  const load = useCallback(async () => {
    if (!clubId || !playerId) return
    const gen = ++generation.current
    setError(null)
    try {
      const next = await loadClubMemberMembership(supabase, clubId, String(playerId))
      if (gen !== generation.current) return
      setData(next)
      setRefused(false)
    } catch (cause) {
      const translated = friendly(cause, "this member's membership")
      logDetail("admin:memberships:member", translated)
      if (gen !== generation.current) return
      if ((cause as { code?: string }).code === "42501") setRefused(true)
      else setError(translated)
    }
  }, [clubId, playerId])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  // WHAT MEMBERS PAY WHEN THEY PAY OVALBALL'S FEE: the membership's own snapshot from the server (a later rate or
  // settings change never reaches an existing member), worded once by the Part 1 helper.
  const membership = data?.membership ?? null
  const moneyLine =
    membership && membership.feeBearer === "PAYER" && membership.monthlyFeeMinor !== null && membership.monthlyCollectMinor !== null && membership.monthlyAmountMinor !== null
      ? membershipMoneyLine(
          { money: { feeMinor: membership.monthlyFeeMinor, membersPayMinor: membership.monthlyCollectMinor, clubReceivesMinor: membership.monthlyAmountMinor } },
          "PAYER"
        )
      : null

  useEffect(() => {
    if (notice) AccessibilityInfo.announceForAccessibility(notice.text)
  }, [notice])

  const first = data?.player.firstName ?? ""
  const name = data ? personName(data.player.firstName, data.player.surname) : null
  const active = membership?.enrolmentStatus === "active"
  const payerSubscriptionId = membership?.payerSubscriptionId ?? null
  // Cancel and Retry live on the membership's own page on the website, where the web offers them.
  const canCancel = !!(data?.can.cancel && active && payerSubscriptionId && webUrl)
  const canRetry = !!(data?.can.cancel && payerSubscriptionId && webUrl && data.history.some((h) => h.status === "FAILED"))
  const openOnWebsite = () => {
    if (payerSubscriptionId && webUrl) void Linking.openURL(`${webUrl}${FINANCE_WEB_PATHS.membership(payerSubscriptionId)}`)
  }
  const canChangePayer = !!data?.can.releasePayer && active && !!payerSubscriptionId

  async function remind(): Promise<string> {
    if (!clubId || !data) return ""
    try {
      const result = await sendMembershipReminders(supabase, { clubId, playerIds: [data.player.id] })
      const text = reminderOutcomeSentence(result)
      setNotice({ tone: "ok", text })
      await load()
      return text
    } catch (cause) {
      const text = reminderProblem(cause)
      setNotice({ tone: "error", text })
      return text
    }
  }

  function openChangePayer() {
    setReason("")
    setProblem(null)
    setChanging(true)
  }

  async function changePayer() {
    if (!payerSubscriptionId || !data || reason.trim().length === 0) return
    const payerName = data.payer?.name ?? "The payer"
    setSaving(true)
    setProblem(null)
    try {
      await releaseResponsiblePayer(supabase, { payerSubscriptionId, reason: reason.trim() })
      setChanging(false)
      setNotice({ tone: "ok", text: `${payerName} no longer pays for ${first}'s membership. It shows as not set up until the guardian who will pay sets it up with their own Direct Debit.` })
      await load()
    } catch (cause) {
      const text = membershipSetupErrorMessage(cause, friendlyAction(cause, "change", "who pays").message)
      // THE ONE REFUSAL WITH A WAY FORWARD: a Direct Debit still collecting is stopped by cancelling the membership.
      const code = (cause as { code?: string }).code
      const collecting = code === "55000" && (data.standing.collectionStarted || /cancel the membership first/i.test(text))
      setProblem({ text, collecting })
      AccessibilityInfo.announceForAccessibility(text)
    } finally {
      setSaving(false)
    }
  }

  const refresh = () => void Promise.all([refreshAuthority(), load()])

  if (!authorityLoading && !authority.view) {
    return (
      <AdminScreen section="Member" onRefresh={refresh}>
        <EmptyState title="Not for you at this club" body="Seeing a member's membership needs the finance view permission at this club. If that has changed, pull to refresh." />
      </AdminScreen>
    )
  }

  if (refused) {
    return (
      <AdminScreen section="Member" onRefresh={refresh}>
        <EmptyState title="Not for you at this club" body="Seeing a member's membership needs the finance view permission at this club. If that has changed, pull to refresh." />
      </AdminScreen>
    )
  }

  if (data === undefined || !name) {
    return (
      <AdminScreen section="Member" onRefresh={refresh}>
        {error ? (
          <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />
        ) : data === null ? (
          <EmptyState title="This player isn't part of the club's memberships." body="They may not be in a team with a membership, or their membership may have ended a long time ago." />
        ) : (
          <View style={{ gap: space.md }}>
            <CardSkeleton lines={3} />
            <CardSkeleton lines={4} />
          </View>
        )}
      </AdminScreen>
    )
  }

  const d = data as ClubMemberMembership
  const guidance = standingGuidance(d.standing.reason, "club")
  const offerRemind = guidance.action === "remind" && d.can.remind && d.standing.canRemind
  // THE NEXT STEP SITS WITH THE GUIDANCE THAT NAMES IT: a failed payment's retry, and ending a membership that no
  // longer has a team, are offered in the status card; the bottom of the page keeps only what the card does not.
  const retryInCard = canRetry && d.standing.reason === "PAYMENT_FAILED"
  const cancelInCard = canCancel && guidance.action === "end_or_place"
  const reminded = remindedLine({ lastRemindedAt: d.standing.lastRemindedAt, lastRemindedBy: d.standing.lastRemindedBy })
  const again = remindAgainOn({ lastRemindedAt: d.standing.lastRemindedAt, canRemind: d.standing.canRemind, standing: d.standing.standing, reason: d.standing.reason })
  const teams = d.player.teams.map((t) => t.name)
  const identityLine = [teams.join(", "), membership?.name].filter(Boolean).join(" · ") || null
  const sibling =
    membership && (membership.siblingOrdinal ?? 0) > 1 && (membership.siblingDiscountType === "PERCENTAGE" || membership.siblingDiscountType === "FIXED") && (membership.siblingDiscountValue ?? 0) > 0
      ? `${ordinalWord(membership.siblingOrdinal ?? 0)} child · ${describeSiblingRule({ discountType: membership.siblingDiscountType, discountValue: membership.siblingDiscountValue ?? 0 })}`
      : null

  return (
    <AdminScreen section={name} onRefresh={refresh}>
      <IdentityBlock name={name} line={identityLine} standing={d.standing.standing} />

      {/* ------------------------------------------------------------------ where it stands, and the one thing to do */}
      <StatusCard guidance={guidance}>
        {offerRemind && (
          <AsyncButton variant="brand" label="Send Reminder" icon={<Send size={18} color={colour.onForest} />} accessibilityHint={askableSentence(d.askable, first)} onPress={remind} />
        )}
        {guidance.action === "change_payer" && canChangePayer && <Button label="Change Who Pays" variant="secondary" onPress={openChangePayer} />}
        {retryInCard && (
          <Button label="Retry Payment on the Website" variant="secondary" trailing={<ExternalLink size={16} color={colour.inkMuted} />} accessibilityHint="Opens this membership on the Ovalball website" onPress={openOnWebsite} />
        )}
        {cancelInCard && (
          <Button label="Cancel Membership on the Website" variant="secondary" trailing={<ExternalLink size={16} color={colour.inkMuted} />} accessibilityHint="Opens this membership on the Ovalball website" onPress={openOnWebsite} />
        )}
        {reminded && <Text style={[type.caption, { color: colour.inkMuted }]}>{again ? `${reminded} · can remind again ${again}` : reminded}</Text>}
        {!d.payer && guidance.action === "remind" && <Text style={[type.caption, { color: colour.inkMuted }]}>{askableSentence(d.askable, first)}</Text>}
        <Notice notice={notice} />
      </StatusCard>

      {/* ------------------------------------------------------------------ the membership */}
      <Card style={{ gap: space.xs }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.sm, marginBottom: space.xs }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flexShrink: 1 }]}>
            {membership?.name ?? "Membership"}
          </Text>
          {membership?.enrolmentStatus === "active" && <ToneChip label="Active" tone="settled" accessibilityLabel="Membership: Active" />}
          {membership?.enrolmentStatus === "ended" && <ToneChip label="Ended" tone="neutral" accessibilityLabel="Membership: Ended" />}
        </View>
        {!membership ? (
          <Text style={[type.small, { color: colour.inkMuted }]}>{`No membership covers ${first}'s teams.`}</Text>
        ) : (
          <View>
            <DetailRow first label="Price" value={membership.monthlyAmountMinor !== null ? `${formatMoneyMinor(membership.monthlyAmountMinor)} a month` : "No price yet"} caption={moneyLine ? `${moneyLine}.` : null} />
            {membership.collectionDay ? <DetailRow label="Collection Day" value={`${ordinalWord(membership.collectionDay)} of each month`} /> : null}
            {membership.firstPaymentPolicy && FIRST_PAYMENT_WORDS[membership.firstPaymentPolicy] ? <DetailRow label="First Payment" value={FIRST_PAYMENT_WORDS[membership.firstPaymentPolicy]!} /> : null}
            {membership.effectiveFrom ? <DetailRow label="Started" value={formatFinanceDate(membership.effectiveFrom, "long")} /> : null}
            {membership.enrolmentStatus === "ended" && membership.endedAt ? <DetailRow label="Ended" value={formatFinanceDate(membership.endedAt, "long")} caption={membership.endReason} /> : null}
            {sibling ? <DetailRow label="Sibling Discount" value={sibling} caption={membership.baseAmountMinor ? `Standard price ${formatMoneyMinor(membership.baseAmountMinor)} a month` : null} /> : null}
            <DetailRow label="Teams" value={teams.length > 0 ? teams.join(", ") : "No team"} />
          </View>
        )}
      </Card>

      {/* ------------------------------------------------------------------ who pays */}
      <Card style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
          Responsible Payer
        </Text>
        {d.payer ? (
          <View>
            <View accessible style={{ gap: 2, paddingBottom: space.sm }}>
              <Text style={[type.bodyMedium, { color: colour.ink }]}>{d.payer.name ?? (d.payer.relationship === "self" ? name : "A guardian")}</Text>
              <Text style={[type.small, { color: colour.inkMuted }]}>{d.payer.relationship === "self" ? "Pays for themselves" : "Parent or guardian"}</Text>
            </View>
            {d.payer.email ? <ContactRow kind="email" value={d.payer.email} /> : null}
            {d.payer.phone ? <ContactRow kind="phone" value={d.payer.phone} /> : null}
            {canChangePayer && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Change Who Pays"
                accessibilityHint="Ends the current payer's set-up so another guardian can take the membership on"
                onPress={openChangePayer}
                style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 8, flexDirection: "row", alignItems: "center", gap: space.md, borderTopWidth: 1, borderTopColor: colour.line, opacity: pressed ? 0.7 : 1 })}
              >
                <ArrowRightLeft size={18} color={colour.forest800} />
                <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>Change Who Pays</Text>
                <ChevronRight size={18} color={colour.inkSubtle} />
              </Pressable>
            )}
          </View>
        ) : (
          <Text style={[type.small, { color: colour.inkMuted }]}>{`Nobody has set up ${first}'s membership yet.`}</Text>
        )}
      </Card>

      {/* ------------------------------------------------------------------ the Direct Debit, in words */}
      {d.directDebit && (
        <Card style={{ gap: space.xs }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, marginBottom: space.xs }]}>
            Direct Debit
          </Text>
          <DetailRow first label="Bank Authorisation" value={d.directDebit.mandateStatus ? (FINANCE_MANDATE_STATUS_LABEL[d.directDebit.mandateStatus] ?? "Status not shown") : "Not set up"} />
          <DetailRow
            label="Monthly Collection"
            value={d.directDebit.subscriptionStatus ? (FINANCE_SUBSCRIPTION_STATUS_LABEL[d.directDebit.subscriptionStatus] ?? "Status not shown") : d.directDebit.mandateStatus ? "Not started" : "Not set up"}
          />
          {d.standing.nextCollectionDate ? <DetailRow label="Next Collection" value={formatFinanceDate(d.standing.nextCollectionDate, "long")} /> : null}
        </Card>
      )}

      {/* ------------------------------------------------------------------ the months' payments */}
      <Card style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, marginBottom: space.xs }]}>
          Payments
        </Text>
        {d.history.length === 0 ? (
          <Text style={[type.small, { color: colour.inkMuted }]}>No payments yet.</Text>
        ) : (
          d.history.map((month, i) => <PaymentMonthRow key={month.obligationId ?? month.billingPeriod} month={month} first={i === 0} />)
        )}
      </Card>

      {/* ------------------------------------------------------------------ the jobs that live on the website, and the full record */}
      {((canRetry && !retryInCard) || (canCancel && !cancelInCard)) && (
        <View style={{ gap: space.sm }}>
          {canRetry && !retryInCard && <Button label="Retry Payment on the Website" variant="secondary" trailing={<ExternalLink size={16} color={colour.inkMuted} />} accessibilityHint="Opens this membership on the Ovalball website" onPress={openOnWebsite} />}
          {canCancel && !cancelInCard && <Button label="Cancel Membership on the Website" variant="secondary" trailing={<ExternalLink size={16} color={colour.inkMuted} />} accessibilityHint="Opens this membership on the Ovalball website" onPress={openOnWebsite} />}
          <Text style={[type.caption, { color: colour.inkMuted }]}>{"Retrying a payment and cancelling a membership use the club's GoCardless connection, which lives on the Ovalball website."}</Text>
        </View>
      )}
      {payerSubscriptionId && (
        <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
          <NavRow first label="Membership Record" caption="The price breakdown, review notes and the full payment history." onPress={() => router.push(`/admin/subscriptions/membership/${payerSubscriptionId}` as never)} />
        </View>
      )}

      <Sheet
        visible={changing}
        title="Change Who Pays"
        hint={d.payer?.name ? `${d.payer.name} pays for ${first} now.` : undefined}
        onClose={() => setChanging(false)}
        onSave={() => void changePayer()}
        saving={saving}
        problem={null}
        saveLabel="Change Who Pays"
        canSave={reason.trim().length > 0}
        dismissLabel="Keep Current Payer"
        destructive
      >
        <ScrollView style={{ maxHeight: Math.max(220, height * 0.45) }} contentContainerStyle={{ gap: space.md }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View style={{ gap: space.sm }}>
            {CHANGE_PAYER_STEPS.map((step, i) => (
              <View key={step} accessible accessibilityLabel={`Step ${i + 1} of ${CHANGE_PAYER_STEPS.length}: ${step}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
                  <Text allowFontScaling={false} style={[type.caption, { color: colour.forest800, fontFamily: font.bodySemi }]}>
                    {i + 1}
                  </Text>
                </View>
                <Text style={[type.small, { color: colour.ink, flex: 1 }]}>{step}</Text>
              </View>
            ))}
          </View>
          <View style={{ gap: 6 }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>
              Reason<Text style={{ color: colour.danger }}> *</Text>
            </Text>
            <TextInput
              accessibilityLabel="Reason"
              accessibilityHint="Required. Recorded with the change."
              value={reason}
              onChangeText={setReason}
              editable={!saving}
              multiline
              maxLength={500}
              placeholder="Recorded with the change"
              placeholderTextColor={colour.inkSubtle}
              selectionColor={colour.pitch600}
              style={[type.body, { minHeight: 72, padding: space.md, textAlignVertical: "top", borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, color: colour.ink }]}
            />
          </View>
          {problem && (
            <View accessibilityRole="alert" style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.dangerSurface, gap: space.sm }}>
              <Text style={[type.small, { color: colour.danger }]}>{problem.text}</Text>
              {problem.collecting && canCancel && <Button label="Cancel Membership on the Website" variant="secondary" trailing={<ExternalLink size={16} color={colour.inkMuted} />} accessibilityHint="Opens the Ovalball website" onPress={openOnWebsite} />}
            </View>
          )}
        </ScrollView>
      </Sheet>
    </AdminScreen>
  )
}

/** One month: what it was for, its amount and its record's word, and Ovalball's fee with where that fee stands. */
function PaymentMonthRow({ month, first }: { month: MemberPaymentMonth; first: boolean }) {
  const { fontScale } = useWindowDimensions()
  const stacked = fontScale > LARGE_TEXT_SCALE
  const label = month.billingPeriod ? billingPeriodLabel(month.billingPeriod) : "A month"
  const status = OBLIGATION_STATUS_SHORT[month.status] ?? "Status not shown"
  const position = feePositionLabel(month.feePosition)
  const fee = month.feeMinor && month.feeMinor > 0 ? `Ovalball's fee ${formatMinorUnits(month.feeMinor)}${position ? ` · ${position}` : ""}` : null
  const collect = month.collectMinor !== null && month.collectMinor > month.amountMinor ? `${formatMinorUnits(month.collectMinor)} by Direct Debit` : null
  const details = [month.isProrated ? "Part month" : null, collect, fee].filter((part): part is string => Boolean(part))
  const amount = formatMoneyMinor(month.amountMinor)
  return (
    <View accessible accessibilityLabel={spoken([`${label}, ${amount}, ${status}`, ...details].join(". "))} style={{ paddingVertical: space.sm + 2, gap: 4, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line }}>
      <View style={{ flexDirection: stacked ? "column" : "row", alignItems: stacked ? "flex-start" : "center", justifyContent: "space-between", gap: space.sm }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{label}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text style={[type.smallMedium, { color: colour.ink, fontVariant: ["tabular-nums"] }]}>{amount}</Text>
          <FinancePill label={status} tone={obligationTone(month.status)} />
        </View>
      </View>
      {details.length > 0 && <Text style={[type.caption, { color: colour.inkMuted, fontVariant: ["tabular-nums"] }]}>{details.join(" · ")}</Text>}
    </View>
  )
}
