import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AccessibilityInfo, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router"
import * as WebBrowser from "expo-web-browser"
import {
  acceptMembershipTerms,
  activateMemberships,
  archiveMembership,
  collectionDaySentence,
  connectionSentence,
  createMembership,
  feeBearerOptions,
  feePercent,
  firstPaymentExampleSentences,
  firstPaymentPolicyOptions,
  goCardlessVerifyUrl,
  loadFirstPaymentExample,
  loadMembershipSetup,
  membershipSetupErrorMessage,
  pauseMemberships,
  PROGRAMME_STATE_LABEL,
  readMembershipPriceHistory,
  receiptAnnouncement,
  renameMembership,
  saveMembershipSettings,
  setMembershipPrice,
  setMembershipTeams,
  type FeeBearer,
  type FirstPaymentExample,
  type MembershipPriceRow,
  type MembershipSetupState,
  type SetupFirstPaymentPolicy,
  type SetupMembership,
} from "@ovalball/contracts/membership/setup"
import {
  formatFinanceDate,
  formatMinorUnits,
  ordinalWord,
  readActiveSubscriptionImpact,
  readSiblingDiscountRules,
  saveSiblingDiscountRule,
  type SiblingRule,
} from "@ovalball/contracts/club/finance"

import { AdminScreen } from "../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../src/admin/access"
import { useFinanceAuthority } from "../../../../src/admin/finance-authority"
import { Notice } from "../../../../src/admin/finance-ui"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { resumedAsk, usePendingIntent } from "../../../../src/admin/pending-intent"
import { supabase } from "../../../../src/auth/supabase"
import { Button, Card, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { ArrowUpRight, CalendarDays, Plus, UserPlus } from "../../../../src/components/icons"
import { useAppContexts } from "../../../../src/context/contexts"
import { friendly, logDetail } from "../../../../src/errors/translate"
import { connectGoCardless, disconnectGoCardless as disconnectThroughWebsite, finishGoCardlessConnect, type GoCardlessConnectResult } from "../../../../src/membership/gocardless-connect"
import { Sheet } from "../../../../src/components/field-sheet"
import { CollectionDaySheet, ConnectionChip, MembershipCard, MembershipSheet, MoneyReceipt, ReceiptPlaceholder, TermsCard, ToneChip, teamsSentence, type MembershipDraft } from "../../../../src/membership/setup-ui"
import { SiblingDiscounts, type SiblingRuleChange } from "../../../../src/membership/sibling-rules"
import { ChoiceRow, Note, SectionTitle } from "../../../../src/people/ui"
import { FormRow, FormSwitchRow } from "../../../../src/tournaments/form-primitives"
import { colour, space, type } from "../../../../src/design/tokens"

/**
 * MEMBERSHIP SETTINGS -- the club's memberships once they are on (Club Memberships Part 1).
 *
 * The same server answer as the setup journey (`membership_setup_state`) and the same doors, arranged for a club
 * that is already collecting: whether new memberships are being taken, the GoCardless connection, the collection
 * settings and who pays Ovalball's fee (one Save for all three), the memberships with their prices, teams and price
 * history, sibling discounts, and the terms the club agreed to.
 *
 * NOTHING HERE RE-PRICES A MEMBER. Settings and prices reach new memberships; a member already enrolled keeps the
 * price, the collection day and the fee arrangement they joined on (the enrolment snapshots them). Pausing stops new
 * memberships only -- members already enrolled keep paying, so no collection is stranded.
 *
 * Every change is judged again on the server; a refusal that asks for a recent authenticator holds the intent,
 * steps up and comes back to the same sheet.
 */

const RETURN_PATH = "/admin/subscriptions/settings"

interface SettingsDraft {
  collectionDay: number
  firstPaymentPolicy: SetupFirstPaymentPolicy
  feeBearer: FeeBearer | null
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

type NoticePlace = "status" | "memberships" | "collection" | "gocardless" | "terms"

function sameSettings(a: SettingsDraft, b: SettingsDraft): boolean {
  return a.collectionDay === b.collectionDay && a.firstPaymentPolicy === b.firstPaymentPolicy && a.feeBearer === b.feeBearer
}

export default function MembershipSettingsScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ intent?: string; result?: string; handoff?: string }>()
  const { clubId, refresh: refreshAccess } = useAdminCentreAccess()
  const { authority, refresh: refreshAuthority } = useFinanceAuthority(clubId)
  const { club } = useAppContexts()
  const clubName = club.clubId === clubId ? club.name : null

  const [setup, setSetup] = useState<MembershipSetupState | null>(null)
  const [history, setHistory] = useState<MembershipPriceRow[]>([])
  const [siblingRules, setSiblingRules] = useState<SiblingRule[]>([])
  const [loadProblem, setLoadProblem] = useState<string | null>(null)
  // WHAT AN ACTION SAID is shown in the section that did it, and said aloud: at the top of a six-section screen it
  // was out of sight, and silent, by the time the person had scrolled to the control.
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string; at: NoticePlace } | null>(null)
  const [saved, setSaved] = useState<SettingsDraft | null>(null)
  const [form, setForm] = useState<SettingsDraft | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsProblem, setSettingsProblem] = useState<string | null>(null)
  const [dayOpen, setDayOpen] = useState(false)
  const [example, setExample] = useState<FirstPaymentExample | null>(null)
  const [editing, setEditing] = useState<SetupMembership | "new" | null>(null)
  const [sheetSaving, setSheetSaving] = useState(false)
  const [sheetProblem, setSheetProblem] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)
  const [siblingsDirty, setSiblingsDirty] = useState(false)
  const [leave, setLeave] = useState<(() => void) | null>(null)
  const navigation = useNavigation()
  const pending = usePendingIntent("finance:membership-settings")
  const generation = useRef(0)
  // The last settings the server confirmed, read by `load` without making it depend on them.
  const savedRef = useRef<SettingsDraft | null>(null)

  const load = useCallback(async () => {
    if (!clubId) return
    const gen = ++generation.current
    try {
      const next = await loadMembershipSetup(supabase, clubId)
      const [prices, rules] = next.programme
        ? await Promise.all([readMembershipPriceHistory(supabase, next.programme.id).catch(() => [] as MembershipPriceRow[]), readSiblingDiscountRules(supabase, next.programme.id).catch(() => [] as SiblingRule[])])
        : [[] as MembershipPriceRow[], [] as SiblingRule[]]
      if (gen !== generation.current) return
      setSetup(next)
      setHistory(prices)
      setSiblingRules(rules)
      setLoadProblem(null)
      const current: SettingsDraft = {
        collectionDay: next.programme?.collectionDay ?? 1,
        firstPaymentPolicy: next.programme?.firstPaymentPolicy ?? "NEXT_COLLECTION_DAY",
        feeBearer: next.programme?.feeBearer ?? null,
      }
      // A draft the person has not touched follows the server; one they have changed is theirs until Save or Discard.
      const previous = savedRef.current
      setForm((f) => (f && previous && !sameSettings(f, previous) ? f : current))
      savedRef.current = current
      setSaved(current)
    } catch (cause) {
      const failure = friendly(cause, "the club's membership settings")
      logDetail("memberships:settings", failure)
      if (gen === generation.current) setLoadProblem(membershipSetupErrorMessage(cause, failure.message))
    }
  }, [clubId])

  useEffect(() => {
    setSetup(null)
    setForm(null)
    setSaved(null)
    savedRef.current = null
  }, [clubId])

  useFocusEffect(
    useCallback(() => {
      void load()
      const resume = pending.take()
      if (resume) setAsk(resumedAsk(resume))
    }, [load, pending])
  )

  useEffect(() => {
    if (notice) AccessibilityInfo.announceForAccessibility(notice.text)
  }, [notice])

  // A club that has not switched memberships on yet is set up, not managed.
  useEffect(() => {
    if (setup && (setup.state === "NOT_STARTED" || setup.state === "SETTING_UP")) router.replace("/admin/subscriptions/setup" as never)
  }, [setup, router])

  const exampleAmount = useMemo(() => {
    const priced = setup?.memberships.find((m) => m.monthlyAmountMinor !== null && m.teams.length > 0) ?? setup?.memberships.find((m) => m.monthlyAmountMinor !== null)
    return priced?.monthlyAmountMinor ?? 1000
  }, [setup])
  const exampleMembership = setup?.memberships.find((m) => m.monthlyAmountMinor === exampleAmount && m.monthlyAmountMinor !== null) ?? null
  const exampleHeading = exampleMembership ? `For example, on ${exampleMembership.name}` : "For example, on a £10.00 monthly membership"
  const receiptBasis = exampleMembership ? `On ${exampleMembership.name} at ${formatMinorUnits(exampleAmount)} a month` : "On a £10.00 monthly membership, as an example"
  // The figures are only ever shown for the choices on screen; until the server answers for these, the place is held.
  const exampleKey = form ? `${exampleAmount}|${form.collectionDay}|${form.firstPaymentPolicy}|${form.feeBearer ?? ""}` : ""
  const [exampleFor, setExampleFor] = useState<string | null>(null)
  const exampleGeneration = useRef(0)
  useEffect(() => {
    if (!clubId || !form) return
    const gen = ++exampleGeneration.current
    const key = exampleKey
    loadFirstPaymentExample(supabase, { clubId, monthlyAmountMinor: exampleAmount, joinDate: todayIso(), collectionDay: form.collectionDay, firstPaymentPolicy: form.firstPaymentPolicy, feeBearer: form.feeBearer })
      .then((next) => {
        if (gen !== exampleGeneration.current) return
        setExample(next)
        setExampleFor(key)
      })
      .catch(() => {
        if (gen === exampleGeneration.current) {
          setExample(null)
          setExampleFor(key)
        }
      })
  }, [clubId, form, exampleAmount, exampleKey])
  const exampleCurrent = example !== null && exampleFor === exampleKey
  const heard = useRef<string | null>(null)
  useEffect(() => {
    if (!exampleCurrent || !example || !form?.feeBearer || heard.current === exampleKey) return
    if (heard.current !== null) {
      AccessibilityInfo.announceForAccessibility(receiptAnnouncement({ memberPaysMinor: example.monthlyCollectMinor, feeMinor: example.monthlyFeeMinor, clubReceivesMinor: example.clubReceivesMonthlyBeforeGoCardlessMinor }))
    }
    heard.current = exampleKey
  }, [exampleCurrent, example, form?.feeBearer, exampleKey])

  // NOTHING UNSAVED IS LOST WITHOUT ASKING: leaving with changed settings or sibling discounts asks first.
  const formDirty = !!form && !!saved && !sameSettings(form, saved)
  const anyDirty = formDirty || siblingsDirty
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (event) => {
      if (!anyDirty) return
      event.preventDefault()
      setLeave(() => () => navigation.dispatch(event.data.action))
    })
    return unsubscribe
  }, [navigation, anyDirty])

  const historyByMembership = useMemo(() => {
    const map = new Map<string, MembershipPriceRow[]>()
    for (const row of history) {
      if (!row.productId) continue
      map.set(row.productId, [...(map.get(row.productId) ?? []), row])
    }
    return map
  }, [history])

  const settingsErrorMessage = (cause: unknown, what: string) => membershipSetupErrorMessage(cause, friendly(cause, what).message)

  // ---------------------------------------------------------------------------------------------------- status
  function pause() {
    if (!clubId) return
    setAsk({
      title: "Pause New Memberships?",
      body: "Nobody can start a new membership while new memberships are paused. Members already enrolled keep paying as normal, and nothing already scheduled changes.",
      confirmLabel: "Pause New Memberships",
      reason: "required",
      placeholder: "Recorded with the change, e.g. end of season",
      onConfirm: async (reason) => {
        await pauseMemberships(supabase, clubId, reason)
        setNotice({ tone: "ok", text: "New memberships are paused.", at: "status" })
        await load()
      },
    })
  }

  function resume() {
    if (!clubId) return
    setAsk({
      title: "Take New Memberships Again?",
      body: "Members can start a new membership again. Ovalball checks the club is still ready first: GoCardless connected and verified, and a membership with a price and a team.",
      confirmLabel: "Take New Memberships",
      reason: "none",
      onConfirm: async () => {
        await activateMemberships(supabase, clubId)
        setNotice({ tone: "ok", text: "New memberships are open again.", at: "status" })
        await load()
      },
    })
  }

  // ---------------------------------------------------------------------------------------------------- GoCardless
  function connectedText(result: GoCardlessConnectResult): { tone: "ok" | "error"; text: string; at: NoticePlace } {
    if (result.outcome === "connected") return { tone: "ok", text: result.verification === "successful" ? "GoCardless is connected and verified." : "GoCardless is connected. GoCardless will verify the club's account.", at: "gocardless" }
    return { tone: "error", text: result.message, at: "gocardless" }
  }

  async function connect() {
    if (!clubId || !setup) return
    setConnecting(true)
    setNotice(null)
    try {
      if (!setup.terms.accepted) await acceptMembershipTerms(supabase, clubId, setup.terms.version)
      const result = await connectGoCardless({ supabase, clubId, returnPath: RETURN_PATH })
      await load()
      setNotice(connectedText(result))
    } catch (cause) {
      setNotice({ tone: "error", text: settingsErrorMessage(cause, "GoCardless"), at: "gocardless" })
    } finally {
      setConnecting(false)
    }
  }

  const finishedIntent = useRef<string | null>(null)
  useEffect(() => {
    const intentId = typeof params.intent === "string" && params.intent ? params.intent : null
    if (!intentId || finishedIntent.current === intentId) return
    finishedIntent.current = intentId
    void (async () => {
      setConnecting(true)
      try {
        const result = await finishGoCardlessConnect({ supabase, intentId, handoff: typeof params.handoff === "string" ? params.handoff : null })
        await load()
        setNotice(connectedText(result))
      } finally {
        setConnecting(false)
        router.setParams({ intent: undefined, result: undefined, handoff: undefined } as never)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.intent])

  async function disconnect() {
    if (!clubId) return
    const impact = await readActiveSubscriptionImpact(supabase, clubId).catch(() => null)
    const figures = impact
      ? ` Right now: ${impact.activeGoCardlessSubscriptions} live Direct Debit ${impact.activeGoCardlessSubscriptions === 1 ? "subscription" : "subscriptions"}, ${impact.activePayers} active ${impact.activePayers === 1 ? "payer" : "payers"}, ${impact.pendingObligations} pending ${impact.pendingObligations === 1 ? "payment" : "payments"}.`
      : ""
    setAsk({
      title: "Disconnect GoCardless?",
      body: `Ovalball stops using the club's GoCardless account straight away, and no new memberships or collections can be set up until it is connected again. Payment history stays. GoCardless may still collect payments it has already scheduled; cancel those in GoCardless if they should stop.${figures}`,
      confirmLabel: "Disconnect GoCardless",
      destructive: true,
      reason: "required",
      onConfirm: async (reason) => {
        const result = await disconnectThroughWebsite({ supabase, clubId, reason })
        // Thrown in the shape the sheet reads, so a recent-authenticator refusal goes to step-up like any other.
        if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code })
        setNotice({ tone: "ok", text: result.message, at: "gocardless" })
        await load()
      },
    })
  }

  // ---------------------------------------------------------------------------------------------------- settings
  async function saveSettings() {
    if (!clubId || !form) return
    setSavingSettings(true)
    setSettingsProblem(null)
    try {
      await saveMembershipSettings(supabase, clubId, form)
      savedRef.current = form
      setSaved(form)
      setNotice({ tone: "ok", text: "Settings saved. They apply to new memberships from now on.", at: "collection" })
      await load()
    } catch (cause) {
      setSettingsProblem(settingsErrorMessage(cause, "the collection settings"))
    } finally {
      setSavingSettings(false)
    }
  }

  // ---------------------------------------------------------------------------------------------------- memberships
  async function saveMembership(d: MembershipDraft) {
    if (!clubId || !editing) return
    setSheetSaving(true)
    setSheetProblem(null)
    try {
      if (editing === "new") {
        await createMembership(supabase, clubId, { name: d.name, monthlyAmountMinor: d.monthlyAmountMinor, teamIds: d.teamIds })
      } else {
        if (d.name !== editing.name) await renameMembership(supabase, editing.id, d.name)
        if (d.priceFrom) await setMembershipPrice(supabase, editing.id, d.monthlyAmountMinor, d.priceFrom)
        const before = editing.teams.map((t) => t.id).sort().join()
        const after = [...d.teamIds].sort().join()
        if (before !== after) await setMembershipTeams(supabase, editing.id, d.teamIds)
      }
      setEditing(null)
      setNotice({ tone: "ok", text: `${d.name} saved.`, at: "memberships" })
      await load()
    } catch (cause) {
      setSheetProblem(settingsErrorMessage(cause, "this membership"))
      await load()
    } finally {
      setSheetSaving(false)
    }
  }

  function archive(m: SetupMembership) {
    setEditing(null)
    setAsk({
      title: `Remove ${m.name}?`,
      body: `Nobody is paying for ${m.name}. ${m.teams.length > 0 ? `${teamsSentence(m.teams, 4)} will have no membership until you add ${m.teams.length === 1 ? "it" : "them"} to another.` : ""}`.trim(),
      confirmLabel: "Remove Membership",
      destructive: true,
      reason: "none",
      onConfirm: async () => {
        await archiveMembership(supabase, m.id)
        setNotice({ tone: "ok", text: `${m.name} removed.`, at: "memberships" })
        await load()
      },
    })
  }

  /** Every changed rule, one door call each; the first refusal stops the rest and is said in the server's words. */
  async function saveSiblings(changes: SiblingRuleChange[]) {
    const programmeId = setup?.programme?.id
    if (!programmeId) return
    try {
      for (const c of changes) await saveSiblingDiscountRule(supabase, programmeId, c.ordinal, c.discountType, c.discountValue)
    } finally {
      await load()
    }
  }

  async function agree() {
    if (!clubId || !setup) return
    try {
      await acceptMembershipTerms(supabase, clubId, setup.terms.version)
      setNotice({ tone: "ok", text: "Agreement recorded.", at: "terms" })
      await load()
    } catch (cause) {
      setNotice({ tone: "error", text: settingsErrorMessage(cause, "the agreement"), at: "terms" })
    }
  }

  // ---------------------------------------------------------------------------------------------------- the screen
  const refresh = () => void Promise.all([refreshAuthority(), load()])

  if (!setup || !form || !saved) {
    return (
      <AdminScreen section="Membership Settings" onRefresh={refresh}>
        {loadProblem ? (
          <ErrorState message={loadProblem} onRetry={() => void load()} />
        ) : (
          <View style={{ gap: space.md }}>
            <CardSkeleton lines={2} />
            <CardSkeleton lines={4} />
          </View>
        )}
      </AdminScreen>
    )
  }

  if (!setup.canConfigure && !setup.canConnect && !authority.view) {
    return (
      <AdminScreen section="Membership Settings" onRefresh={refresh}>
        <EmptyState title="Not for you at this club" body="Membership settings need a finance permission at this club. If that has changed, pull to refresh." />
      </AdminScreen>
    )
  }

  const s = setup
  const bps = s.feeBps
  const pct = feePercent(bps)
  const currency = s.programme?.currency ?? "GBP"
  const active = s.state === "ACTIVE"
  const connected = s.connection.state !== "NOT_CONNECTED" && s.connection.state !== "DISCONNECTED"
  const dirty = !sameSettings(form, saved)
  const unassigned = s.teams.filter((t) => !t.productId)
  const noticeAt = (at: NoticePlace) => (notice && notice.at === at ? <Notice notice={notice} /> : null)

  return (
    <AdminScreen section="Membership Settings" onRefresh={refresh}>
      {/* THE HEADER ALREADY SAYS "Membership Settings": no second title, just what the screen is for. */}
      <Text style={[type.body, { color: colour.inkMuted }]}>Changes reach new memberships. A member already paying keeps the price and settings they joined on.</Text>

      {/* ------------------------------------------------------------------------- 1. status: are new memberships open */}
      <Card style={{ gap: space.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
            Club Memberships
          </Text>
          <ToneChip label={PROGRAMME_STATE_LABEL[s.state]} tone={active ? "settled" : "attention"} accessibilityLabel={`Club memberships: ${PROGRAMME_STATE_LABEL[s.state]}`} />
        </View>
        {s.canConfigure ? (
          <FormSwitchRow
            flat
            icon={<UserPlus size={20} color={colour.forest800} />}
            label="Taking New Memberships"
            hint={active ? "Members can start a membership." : "Paused: nobody can start a membership. Members already enrolled keep paying."}
            value={active}
            onChange={(on) => (on ? resume() : pause())}
          />
        ) : (
          <Text style={[type.small, { color: colour.inkMuted }]}>{active ? "Members can start a membership." : "New memberships are paused. Members already enrolled keep paying."}</Text>
        )}
        {s.programme?.activatedAt && <Text style={[type.caption, { color: colour.inkMuted }]}>{`First switched on ${formatFinanceDate(s.programme.activatedAt, "long")}.`}</Text>}
        {noticeAt("status")}
      </Card>

      {/* ------------------------------------------------------------------------- 2. memberships: the most frequent job */}
      <Card style={{ gap: 0 }}>
        <SectionTitle
          title="Memberships"
          detail="Each team has one membership. A player in two teams with different memberships pays the higher price."
          action={s.canConfigure ? <Button label="Add" variant="quiet" icon={<Plus size={18} color={colour.forest800} />} onPress={() => { setSheetProblem(null); setEditing("new") }} /> : undefined}
        />
        {s.memberships.map((m, i) => (
          <View key={m.id} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
            <MembershipCard flat membership={m} currency={currency} feeBearer={s.programme?.feeBearer ?? null} showHolders history={historyByMembership.get(m.id)} onEdit={s.canConfigure ? () => { setSheetProblem(null); setEditing(m) } : undefined} />
          </View>
        ))}
        {unassigned.length > 0 && <Note>{`${unassigned.length === 1 ? "1 team has" : `${unassigned.length} teams have`} no membership: ${teamsSentence(unassigned, 4)}. Players only in ${unassigned.length === 1 ? "that team" : "those teams"} are not asked to pay.`}</Note>}
        {noticeAt("memberships")}
      </Card>

      {/* ------------------------------------------------------------------------- 3. collection and Ovalball's fee */}
      <Card style={{ gap: space.lg }}>
        <SectionTitle title="Collection and Fee" detail="For new memberships. A member already paying keeps the settings they joined on." />

        <View style={{ gap: space.sm }}>
          <FormRow icon={<CalendarDays size={20} color={colour.forest800} />} label="Collection Day" value={`${ordinalWord(form.collectionDay)} of each month`} onPress={s.canConfigure ? () => setDayOpen(true) : undefined} />
          <Text style={[type.small, { color: colour.inkMuted }]}>{collectionDaySentence(form.collectionDay)}</Text>
        </View>

        <View style={{ gap: space.sm }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
            First Payment
          </Text>
          <Text style={[type.small, { color: colour.inkMuted }]}>When a player joins part-way through a month:</Text>
          <View accessibilityRole="radiogroup" accessibilityLabel="First payment" style={{ gap: space.sm }}>
            {firstPaymentPolicyOptions(form.collectionDay).map((option) => (
              <ChoiceRow key={option.value} kind="radio" checked={form.firstPaymentPolicy === option.value} label={option.label} description={option.body} disabled={!s.canConfigure} onPress={() => setForm({ ...form, firstPaymentPolicy: option.value })} />
            ))}
          </View>
          {exampleCurrent && example && (
            <View accessible style={{ gap: 2, paddingLeft: space.md, borderLeftWidth: 2, borderLeftColor: colour.lineStrong }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>{exampleHeading}</Text>
              {firstPaymentExampleSentences(example).map((line) => (
                <Text key={line} style={[type.small, { color: colour.inkMuted }]}>
                  {line}
                </Text>
              ))}
            </View>
          )}
        </View>

        <View style={{ gap: space.sm }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
            {"Ovalball's Fee"}
          </Text>
          <Text style={[type.small, { color: colour.inkMuted }]}>{`Ovalball's fee is ${pct} of the membership price in each payment collected through Ovalball. GoCardless's own fees are separate. Who pays Ovalball's fee?`}</Text>
          <View accessibilityRole="radiogroup" accessibilityLabel={`Who pays Ovalball's ${pct}`} style={{ gap: space.sm }}>
            {feeBearerOptions(bps).map((option) => (
              <ChoiceRow key={option.value} kind="radio" describeInLabel checked={form.feeBearer === option.value} label={option.label} description={option.body} disabled={!s.canConfigure} onPress={() => setForm({ ...form, feeBearer: option.value })} />
            ))}
          </View>
          {form.feeBearer ? (
            exampleCurrent && example ? (
              <MoneyReceipt basis={receiptBasis} memberPaysMinor={example.monthlyCollectMinor} feeMinor={example.monthlyFeeMinor} clubReceivesMinor={example.clubReceivesMonthlyBeforeGoCardlessMinor} bps={bps} currency={currency} />
            ) : (
              <ReceiptPlaceholder />
            )
          ) : (
            <Note tone="warning">{`No fee arrangement is chosen yet, so Ovalball takes no fee from this club's memberships. Choose who pays Ovalball's ${pct}.`}</Note>
          )}
        </View>

        {settingsProblem && <Note tone="danger">{settingsProblem}</Note>}
        {noticeAt("collection")}
        {s.canConfigure && dirty && (
          <View style={{ flexDirection: "row", gap: space.sm, borderTopWidth: 1, borderTopColor: colour.line, paddingTop: space.md }}>
            <Button variant="brand" label="Save Changes" onPress={() => void saveSettings()} busy={savingSettings} style={{ flex: 2 }} />
            <Button label="Discard" variant="secondary" onPress={() => setForm(saved)} style={{ flex: 1 }} />
          </View>
        )}
      </Card>

      {/* ------------------------------------------------------------------------- 4. sibling discounts */}
      {s.programme && (authority.configure || authority.view) && (
        <Card style={{ gap: space.md }}>
          <SectionTitle title="Sibling Discounts" detail="For the 2nd, 3rd… child from the same paying family. Applied when a membership starts; the family sees why before they agree to anything." />
          <SiblingDiscounts rules={siblingRules} onSaveAll={saveSiblings} errorMessage={(cause) => settingsErrorMessage(cause, "the sibling discounts")} editable={authority.configure} onDirty={setSiblingsDirty} />
        </Card>
      )}

      {/* ------------------------------------------------------------------------- 5. GoCardless: rare, and it stays below the work */}
      <Card style={{ gap: space.md }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
            GoCardless
          </Text>
          <ConnectionChip state={s.connection.state} />
        </View>
        <Text style={[type.small, { color: colour.ink }]}>{connectionSentence(s.connection.state)}</Text>
        {(connected && s.connection.connectedAt) || (connected && s.connection.environment === "sandbox") ? (
          <Text style={[type.caption, { color: colour.inkMuted }]}>
            {[connected && s.connection.connectedAt ? `Since ${formatFinanceDate(s.connection.connectedAt, "long")}.` : null, connected && s.connection.environment === "sandbox" ? "A GoCardless test account: no real money moves." : null].filter(Boolean).join(" ")}
          </Text>
        ) : null}
        <Text style={[type.caption, { color: colour.inkMuted }]}>The club's bank details are held by GoCardless, never by Ovalball.</Text>
        {s.canConnect && s.connection.state === "ACTION_REQUIRED" && (
          <Button variant="brand" label="Finish Verification with GoCardless" onPress={() => void WebBrowser.openBrowserAsync(goCardlessVerifyUrl(s.connection.environment)).then(() => load()).catch(() => undefined)} trailing={<ArrowUpRight size={18} color={colour.onForest} />} />
        )}
        {s.canConnect && !connected && (
          <Button variant="brand" label={s.connection.state === "DISCONNECTED" ? "Reconnect GoCardless" : "Connect GoCardless"} busy={connecting} disabled={!s.terms.accepted && !agreed} onPress={() => void connect()} trailing={<ArrowUpRight size={18} color={colour.onForest} />} accessibilityHint="Opens GoCardless in a secure browser window. You come back here when it is done." />
        )}
        {noticeAt("gocardless")}
        {s.canConnect && connected && <Button label="Disconnect GoCardless" variant="quiet" onPress={() => void disconnect()} />}
        {!s.canConnect && <Text style={[type.caption, { color: colour.inkMuted }]}>Connecting or disconnecting GoCardless needs the GoCardless permission at this club.</Text>}
      </Card>

      {/* ------------------------------------------------------------------------- 6. the terms the club agreed to */}
      <TermsCard title="Ovalball's Terms" bps={bps} terms={s.terms} clubName={clubName} agreed={agreed} onToggle={() => setAgreed((v) => !v)} canAgree={s.canConfigure || s.canConnect} />
      {!s.terms.accepted && (s.canConfigure || s.canConnect) && <Button label="Agree to These Terms" variant="secondary" disabled={!agreed} onPress={() => void agree()} />}
      {noticeAt("terms")}

      <Sheet
        visible={leave !== null}
        title="Leave Without Saving?"
        hint={[formDirty ? "Your collection and fee changes" : null, siblingsDirty ? "your sibling discount changes" : null].filter(Boolean).join(" and ").replace(/^y/, "Y") + " have not been saved."}
        onClose={() => setLeave(null)}
        onSave={() => {
          const go = leave
          setLeave(null)
          setForm(saved)
          go?.()
        }}
        saving={false}
        problem={null}
        saveLabel="Discard Changes"
        dismissLabel="Keep Editing"
        destructive
      >
        <View />
      </Sheet>

      <CollectionDaySheet
        visible={dayOpen}
        day={form.collectionDay}
        onClose={() => setDayOpen(false)}
        onChoose={(day) => {
          setForm({ ...form, collectionDay: day })
          setDayOpen(false)
        }}
      />

      <MembershipSheet
        visible={editing !== null}
        membership={editing === "new" ? null : editing}
        teams={s.teams}
        memberships={s.memberships}
        askPriceStart
        onClose={() => setEditing(null)}
        onSave={(next) => void saveMembership(next)}
        onArchive={editing && editing !== "new" ? () => archive(editing) : undefined}
        saving={sheetSaving}
        problem={sheetProblem}
      />

      <ReasonSheet
        ask={ask}
        onClose={() => setAsk(null)}
        onRefused={() => void Promise.all([refreshAccess(), refreshAuthority(), load()])}
        onStepUp={(reason) => {
          if (ask) pending.hold(ask, reason)
          setAsk(null)
          router.push({ pathname: "/step-up", params: { returnTo: "/admin/subscriptions/settings" } } as never)
        }}
        errorMessage={(cause) => settingsErrorMessage(cause, "this change")}
      />
    </AdminScreen>
  )
}
