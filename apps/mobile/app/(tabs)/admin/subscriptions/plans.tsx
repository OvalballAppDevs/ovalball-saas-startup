import { useCallback, useEffect, useRef, useState } from "react"
import { Switch, Text, TextInput, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import {
  DEFAULT_PROGRAMME_SETTINGS,
  describeSiblingRule,
  FIRST_PAYMENT_POLICY_OPTIONS,
  financeErrorMessage,
  firstPaymentExample,
  formatFinanceDate,
  formatMinorUnits,
  loadSubscriptionSettings,
  ordinalWord,
  PLATFORM_FEE_MODE_OPTIONS,
  poundsToMinorUnits,
  priceInputProblem,
  programmeSettingsEqual,
  saveSiblingDiscountRule,
  saveSubscriptionProgramme,
  setSubscriptionPrice,
  SIBLING_ORDINALS,
  shiftBillingPeriod,
  siblingRuleInput,
  currentBillingPeriod,
  type SiblingDiscountType,
  type SubscriptionProgrammeSettings,
  type SubscriptionSettings,
} from "@ovalball/contracts/club/finance"

import { AdminScreen } from "../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../src/admin/access"
import { useFinanceAuthority } from "../../../../src/admin/finance-authority"
import { Chip, FieldLabel, Notice } from "../../../../src/admin/finance-ui"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { resumedAsk, usePendingIntent } from "../../../../src/admin/pending-intent"
import { supabase } from "../../../../src/auth/supabase"
import { Button, Card, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

const INPUT = { minHeight: TOUCH_TARGET, borderWidth: 1, borderColor: colour.lineStrong, borderRadius: radius.md, paddingHorizontal: space.md, color: colour.ink, backgroundColor: colour.surface } as const

/**
 * PROGRAMME & PRICING -- the website's `/club/settings/subscriptions` configuration, natively (CA-M11.1).
 *
 * ONE UNNAMED PROGRAMME PER CLUB, exactly as the domain holds it: enabled, collection day (1-28), the
 * first-payment policy with its worked example, and the platform fee model -- saved together through
 * `configure_subscription_programme` from one dirty-tracked Save Changes. Pricing is APPEND-ONLY and
 * effective-dated (`set_subscription_price`): there is no "edit the current price", only "schedule a new
 * price from a date", and the history stays visible so the consequence is not hidden. Sibling discounts are
 * one rule per ordinal 2nd-6th (`configure_sibling_discount_rule`), saved per row as the web saves them.
 *
 * Every save confirms in the sheet and is judged again by the server; a recent-authenticator ask holds
 * the intent, steps up and comes back to the same sheet.
 */
export default function ProgrammeAndPricingScreen() {
  const router = useRouter()
  const { clubId, refresh: refreshAccess } = useAdminCentreAccess()
  const { loading: authorityLoading, authority, refresh: refreshAuthority } = useFinanceAuthority(clubId)
  const [settings, setSettings] = useState<SubscriptionSettings | null>(null)
  const [saved, setSaved] = useState<SubscriptionProgrammeSettings>(DEFAULT_PROGRAMME_SETTINGS)
  const [form, setForm] = useState<SubscriptionProgrammeSettings>(DEFAULT_PROGRAMME_SETTINGS)
  const [priceOpen, setPriceOpen] = useState(false)
  const [priceAmount, setPriceAmount] = useState("")
  const [priceFrom, setPriceFrom] = useState("")
  const [priceProblem, setPriceProblem] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)
  const pending = usePendingIntent("finance:plans")
  const generation = useRef(0)

  const load = useCallback(async () => {
    if (!clubId || authorityLoading) return
    const gen = ++generation.current
    setError(null)
    setLoading(true)
    try {
      const next = await loadSubscriptionSettings(supabase, clubId, authority)
      if (gen !== generation.current) return
      setSettings(next)
      const current = next.programme?.settings ?? DEFAULT_PROGRAMME_SETTINGS
      setSaved(current)
      setForm(current)
    } catch (cause) {
      const translated = friendly(cause, "the subscription settings")
      logDetail("admin:subscriptions:plans", translated)
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
      const resume = pending.take()
      if (resume) setAsk(resumedAsk(resume))
    }, [pending])
  )

  const dirty = !programmeSettingsEqual(form, saved)
  const monthly = settings?.currentPrice?.amountMinor ?? null
  const example = monthly !== null ? firstPaymentExample(form.firstPaymentPolicy, monthly) : null

  function saveProgramme() {
    if (!clubId) return
    setAsk({
      title: "Save programme settings?",
      body: "Changing the first-payment policy applies to new memberships from now on -- it never alters payments already scheduled, collected or owed.",
      confirmLabel: "Save Changes",
      reason: "none",
      onConfirm: async () => {
        await saveSubscriptionProgramme(supabase, clubId, form)
        setNotice({ tone: "ok", text: "Programme settings saved." })
        await load()
      },
    })
  }

  function applyPrice() {
    if (!settings?.programme) return
    const problem = priceInputProblem(priceAmount, priceFrom)
    if (problem) {
      setPriceProblem(problem)
      return
    }
    setPriceProblem(null)
    const programmeId = settings.programme.id
    const amountMinor = poundsToMinorUnits(Number(priceAmount))
    const effectiveFrom = priceFrom
    setAsk({
      title: `Charge ${formatMinorUnits(amountMinor)} a month from ${formatFinanceDate(effectiveFrom, "long")}?`,
      body: "Existing subscribers keep paying their current price -- historical months already billed never change, and this does not alter any already-live Direct Debit subscription. Only new enrolments from this date use the new price.",
      confirmLabel: "Apply Price Change",
      reason: "none",
      onConfirm: async () => {
        await setSubscriptionPrice(supabase, programmeId, amountMinor, effectiveFrom)
        setPriceOpen(false)
        setPriceAmount("")
        setPriceFrom("")
        setNotice({ tone: "ok", text: "Price scheduled." })
        await load()
      },
    })
  }

  function saveSibling(ordinal: number, discountType: SiblingDiscountType, discountValue: number) {
    if (!settings?.programme) return
    const programmeId = settings.programme.id
    setAsk({
      title: `Save the ${ordinalWord(ordinal)} child rule?`,
      body: `${describeSiblingRule({ discountType, discountValue })}. Applies to new enrolments from today; it never re-prices an existing member.`,
      confirmLabel: "Save",
      reason: "none",
      onConfirm: async () => {
        await saveSiblingDiscountRule(supabase, programmeId, ordinal, discountType, discountValue)
        setNotice({ tone: "ok", text: `${ordinalWord(ordinal)} child rule saved.` })
        await load()
      },
    })
  }

  const today = new Date().toISOString().slice(0, 10)
  const nextFirst = shiftBillingPeriod(currentBillingPeriod(), 1)

  return (
    <AdminScreen section="Programme & Pricing" onRefresh={() => void Promise.all([refreshAuthority(), load()])} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Programme & Pricing
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>How the club's monthly membership is collected and what it costs. Changes here shape new memberships; they never re-price a member already enrolled.</Text>
      </View>

      <Notice notice={notice} />

      {(authorityLoading || loading) && !settings && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={3} />
          <CardSkeleton lines={2} />
        </View>
      )}
      {error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}
      {!authorityLoading && !authority.configure && !authority.view && <EmptyState title="Not for you at this club" body="Configuring subscriptions needs the finance configure permission at this club." />}

      {settings && authority.view && !authority.configure && (
        <Card style={{ gap: space.sm }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
            Programme
          </Text>
          <Text style={[type.small, { color: colour.ink }]}>{settings.programme ? (settings.programme.settings.enabled ? "Subscriptions are enabled." : "Subscriptions are not enabled.") : "No programme has been configured yet."}</Text>
          <Text style={[type.small, { color: colour.inkMuted }]}>Current monthly amount: {monthly !== null ? formatMinorUnits(monthly) : "not set"}. Changing these settings needs the configure permission.</Text>
        </Card>
      )}

      {settings && authority.configure && (
        <>
          <Card style={{ gap: space.lg }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
                  Enable Club Subscriptions
                </Text>
                <Text style={[type.caption, { color: colour.inkMuted }]}>Turning this on does not immediately collect money -- GoCardless must also be connected and verified, and a price must be set.</Text>
              </View>
              <Switch accessibilityLabel="Enable Club Subscriptions" value={form.enabled} onValueChange={(enabled) => setForm((f) => ({ ...f, enabled }))} trackColor={{ true: colour.pitch600, false: colour.lineStrong }} />
            </View>

            <View style={{ gap: space.sm }}>
              <FieldLabel>Collection Day</FieldLabel>
              <Text style={[type.caption, { color: colour.inkMuted }]}>Members are shown "Scheduled for collection on the {ordinalWord(form.collectionDay)}". Direct Debit is asynchronous, so this is when collection is submitted, not a guaranteed same-day payout.</Text>
              <View accessibilityRole="radiogroup" accessibilityLabel="Collection day" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                  <Chip key={day} label={String(day)} on={form.collectionDay === day} onPress={() => setForm((f) => ({ ...f, collectionDay: day }))} />
                ))}
              </View>
            </View>

            <View style={{ gap: space.sm }}>
              <FieldLabel>First Payment Policy</FieldLabel>
              <Text style={[type.caption, { color: colour.inkMuted }]}>When a player joins part-way through a month:</Text>
              <View accessibilityRole="radiogroup" accessibilityLabel="First payment policy" style={{ gap: space.sm }}>
                {FIRST_PAYMENT_POLICY_OPTIONS.map((option) => {
                  const on = form.firstPaymentPolicy === option.value
                  return (
                    <Card key={option.value} onPress={() => setForm((f) => ({ ...f, firstPaymentPolicy: option.value }))} accessibilityLabel={`${option.label}${on ? ", selected" : ""}`} style={{ padding: space.md, borderColor: on ? colour.forest800 : colour.line, backgroundColor: on ? colour.successSurface : colour.surface, gap: 2 }}>
                      <Text style={[type.smallMedium, { color: colour.ink }]}>{option.label}</Text>
                      <Text style={[type.caption, { color: colour.inkMuted }]}>{option.body}</Text>
                    </Card>
                  )
                })}
              </View>
              {example && monthly !== null ? (
                <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: colour.chalk, borderWidth: 1, borderColor: colour.line, gap: 2 }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>Example -- a player joining on the 16th of this month:</Text>
                  <Text style={[type.caption, { color: colour.inkMuted }]}>
                    {form.firstPaymentPolicy === "PRORATE_CURRENT_MONTH"
                      ? `First payment ${formatMinorUnits(example.firstAmountMinor)}${example.coversLabel ? ` (covers ${example.coversLabel})` : ""}, then ${formatMinorUnits(monthly)} per month from the following 1st.`
                      : `No payment due this month. First payment ${formatMinorUnits(example.firstAmountMinor)} on the following 1st, then every month.`}
                  </Text>
                </View>
              ) : (
                <Text style={[type.caption, { color: colour.inkMuted }]}>Set a monthly price below to see a worked example.</Text>
              )}
            </View>

            <View style={{ gap: space.sm }}>
              <FieldLabel>Platform Fee Model</FieldLabel>
              <Text style={[type.caption, { color: colour.inkMuted }]}>How Ovalball's own platform fee (if any) is applied. Only models confirmed compliant and commercially approved are offered.</Text>
              <View accessibilityRole="radiogroup" accessibilityLabel="Platform fee model" style={{ gap: space.sm }}>
                {PLATFORM_FEE_MODE_OPTIONS.map((option) => {
                  const on = form.platformFeeMode === option.value
                  return (
                    <Card key={option.value} onPress={() => setForm((f) => ({ ...f, platformFeeMode: option.value }))} accessibilityLabel={`${option.label}${on ? ", selected" : ""}`} style={{ padding: space.md, borderColor: on ? colour.forest800 : colour.line, backgroundColor: on ? colour.successSurface : colour.surface }}>
                      <Text style={[type.small, { color: colour.ink }]}>{option.label}</Text>
                    </Card>
                  )
                })}
              </View>
            </View>

            <View style={{ flexDirection: "row", gap: space.sm, borderTopWidth: 1, borderTopColor: colour.line, paddingTop: space.md }}>
              <Button label="Save Changes" onPress={saveProgramme} disabled={!dirty} style={{ flex: 2 }} />
              {dirty && <Button label="Discard" variant="secondary" onPress={() => setForm(saved)} style={{ flex: 1 }} />}
            </View>
          </Card>

          {settings.programme && (
            <Card style={{ gap: space.md }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
                <View style={{ gap: 2 }}>
                  <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
                    Pricing
                  </Text>
                  <Text style={[type.caption, { color: colour.inkMuted }]}>Current monthly amount</Text>
                  <Text style={[type.title, { color: colour.ink, fontVariant: ["tabular-nums"] }]}>{monthly !== null ? formatMinorUnits(monthly) : "Not set"}</Text>
                </View>
                {!priceOpen && <Button label={monthly !== null ? "Schedule a Price Change" : "Set Price"} variant="secondary" onPress={() => setPriceOpen(true)} />}
              </View>

              {priceOpen && (
                <View style={{ gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colour.chalk, borderWidth: 1, borderColor: colour.line }}>
                  <Text style={[type.caption, { color: colour.inkMuted }]}>Existing subscribers keep paying their current price. Only new enrolments created on or after this date use the new price. Migrating an existing subscriber is a separate, deliberate action.</Text>
                  <View style={{ gap: 6 }}>
                    <FieldLabel>New Monthly Amount (£)</FieldLabel>
                    <TextInput accessibilityLabel="New monthly amount in pounds" value={priceAmount} onChangeText={setPriceAmount} keyboardType="decimal-pad" placeholder="15.00" placeholderTextColor={colour.inkSubtle} style={[type.body, INPUT]} />
                  </View>
                  <View style={{ gap: 6 }}>
                    <FieldLabel>Effective From</FieldLabel>
                    <TextInput accessibilityLabel="Effective from date" value={priceFrom} onChangeText={setPriceFrom} keyboardType="numbers-and-punctuation" autoCapitalize="none" placeholder="YYYY-MM-DD" placeholderTextColor={colour.inkSubtle} style={[type.body, INPUT]} />
                    <View style={{ flexDirection: "row", gap: space.sm }}>
                      <Chip label="Today" on={priceFrom === today} onPress={() => setPriceFrom(today)} />
                      <Chip label="1st of Next Month" on={priceFrom === nextFirst} onPress={() => setPriceFrom(nextFirst)} />
                    </View>
                  </View>
                  {priceProblem && (
                    <Text accessibilityRole="alert" style={[type.small, { color: colour.danger }]}>
                      {priceProblem}
                    </Text>
                  )}
                  <View style={{ flexDirection: "row", gap: space.sm }}>
                    <Button label="Cancel" variant="secondary" onPress={() => { setPriceOpen(false); setPriceProblem(null) }} style={{ flex: 1 }} />
                    <Button label="Apply Price Change" onPress={applyPrice} style={{ flex: 2 }} />
                  </View>
                </View>
              )}

              {settings.priceHistory.length > 0 && (
                <View style={{ gap: space.xs, borderTopWidth: 1, borderTopColor: colour.line, paddingTop: space.md }}>
                  <Text style={[type.overline, { color: colour.inkSubtle }]}>PRICE HISTORY</Text>
                  {settings.priceHistory.map((row) => (
                    <View key={row.id} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={[type.small, { color: colour.inkMuted }]}>From {formatFinanceDate(row.effectiveFrom)}</Text>
                      <Text style={[type.small, { color: colour.ink, fontVariant: ["tabular-nums"] }]}>{formatMinorUnits(row.amountMinor)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </Card>
          )}

          {settings.programme && (
            <Card style={{ gap: space.md }}>
              <View style={{ gap: 4 }}>
                <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
                  Sibling Discounts
                </Text>
                <Text style={[type.caption, { color: colour.inkMuted }]}>A discount for the 2nd, 3rd… child from the same paying family, based on how many of their children are already actively enrolled. Applies automatically at enrolment; the parent sees exactly why before they authorise anything.</Text>
              </View>
              {SIBLING_ORDINALS.map((ordinal) => (
                <SiblingRuleEditor key={ordinal} ordinal={ordinal} current={settings.siblingRules.find((r) => r.ordinal === ordinal) ?? null} onSave={saveSibling} />
              ))}
            </Card>
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
          router.push({ pathname: "/step-up", params: { returnTo: "/admin/subscriptions/plans" } } as never)
        }}
        errorMessage={(cause) => financeErrorMessage(cause, friendly(cause, "this change").message)}
      />
    </AdminScreen>
  )
}

function SiblingRuleEditor({ ordinal, current, onSave }: { ordinal: number; current: { discountType: SiblingDiscountType; discountValue: number } | null; onSave: (ordinal: number, discountType: SiblingDiscountType, discountValue: number) => void }) {
  const [discountType, setDiscountType] = useState<SiblingDiscountType>(current?.discountType ?? "NONE")
  const [value, setValue] = useState(current ? String(current.discountType === "PERCENTAGE" ? current.discountValue : current.discountValue / 100) : "")
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    setDiscountType(current?.discountType ?? "NONE")
    setValue(current ? String(current.discountType === "PERCENTAGE" ? current.discountValue : current.discountValue / 100) : "")
  }, [current])

  function save() {
    const parsed = siblingRuleInput(discountType, value)
    if (!parsed.ok) {
      setProblem(parsed.problem)
      return
    }
    setProblem(null)
    onSave(ordinal, discountType, parsed.discountValue)
  }

  return (
    <View style={{ gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{ordinalWord(ordinal)} child</Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>Current: {describeSiblingRule(current)}</Text>
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel={`${ordinalWord(ordinal)} child discount type`} style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        <Chip label="No Discount" on={discountType === "NONE"} onPress={() => setDiscountType("NONE")} />
        <Chip label="Percentage" on={discountType === "PERCENTAGE"} onPress={() => setDiscountType("PERCENTAGE")} />
        <Chip label="Fixed £" on={discountType === "FIXED"} onPress={() => setDiscountType("FIXED")} />
      </View>
      <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
        {discountType !== "NONE" && <TextInput accessibilityLabel={discountType === "PERCENTAGE" ? "Percent off" : "Amount off in pounds"} value={value} onChangeText={setValue} keyboardType="decimal-pad" placeholder={discountType === "PERCENTAGE" ? "Percent off" : "Amount off (£)"} placeholderTextColor={colour.inkSubtle} style={[type.body, INPUT, { flex: 1 }]} />}
        <Button label="Save" variant="secondary" onPress={save} style={discountType === "NONE" ? { flex: 1 } : undefined} />
      </View>
      {problem && (
        <Text accessibilityRole="alert" style={[type.caption, { color: colour.danger }]}>
          {problem}
        </Text>
      )}
    </View>
  )
}
