import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AccessibilityInfo, Pressable, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import * as WebBrowser from "expo-web-browser"
import {
  acceptMembershipTerms,
  activatedSentence,
  activateMemberships,
  activationStatus,
  CLUB_MEMBERSHIP_TERMS_STATUS,
  connectionFacts,
  collectionDaySentence,
  CONNECTION_STATE_LABEL,
  connectionSentence,
  createMembership,
  feeBearerOptions,
  feeBearerSentence,
  feePercent,
  firstPaymentExampleSentences,
  firstPaymentPolicyOptions,
  GOCARDLESS_ABOUT_URL,
  GOCARDLESS_CONNECT_POINTS,
  goCardlessVerifyUrl,
  loadFirstPaymentExample,
  loadMembershipSetup,
  membershipDisclosure,
  membershipSetupErrorMessage,
  onlyWaitingForVerification,
  receiptAnnouncement,
  renameMembership,
  saveMembershipSettings,
  setMembershipPrice,
  setMembershipTeams,
  setupOverviewSteps,
  setupProgress,
  type ActivationOutcome,
  type FeeBearer,
  type FirstPaymentExample,
  type MembershipSetupState,
  type ReadinessItem,
  type SetupFirstPaymentPolicy,
  type SetupMembership,
} from "@ovalball/contracts/membership/setup"
import { formatMinorUnits, ordinalWord, readActiveSubscriptionImpact } from "@ovalball/contracts/club/finance"
import { isRecentAuthRefusal } from "@ovalball/contracts/club/permissions"

import { useAdminCentreAccess } from "../../../../src/admin/access"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { resumedAsk, usePendingIntent } from "../../../../src/admin/pending-intent"
import { supabase } from "../../../../src/auth/supabase"
import { Button, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { Sheet } from "../../../../src/components/field-sheet"
import { ClubCrest } from "../../../../src/components/identity"
import { ArrowRight, ArrowUpRight, Bell, CalendarDays, CircleCheck, Clock, FileText, Landmark, ListChecks, Lock, Plus, PoundSterling, ReceiptPoundSterling, RefreshCw, TriangleAlert, Users, Wallet } from "../../../../src/components/icons"
import { useAppContexts } from "../../../../src/context/contexts"
import { friendly, logDetail } from "../../../../src/errors/translate"
import { connectGoCardless, disconnectGoCardless as disconnectThroughWebsite, finishGoCardlessConnect, type GoCardlessConnectResult } from "../../../../src/membership/gocardless-connect"
import {
  CollectionDaySheet,
  ConnectionChip,
  InfoRow,
  MembershipCard,
  MembershipSheet,
  MembershipsMoney,
  MoneyReceipt,
  ReceiptPlaceholder,
  ReviewRow,
  StillToDo,
  TermsCard,
  teamsSentence,
  type MembershipDraft,
} from "../../../../src/membership/setup-ui"
import { ActionGroup, Body, ButtonRow, ChoiceRow, FlowScreen, IconTile, Note, SectionTitle, Steps } from "../../../../src/people/ui"
import { FormRow } from "../../../../src/tournaments/form-primitives"
import { TOUCH_TARGET, colour, font, radius, space, type } from "../../../../src/design/tokens"

/**
 * CLUB MEMBERSHIPS -- SETTING UP (Club Memberships Part 1).
 *
 * Five steps from "nothing set up" to "families can join", every money consequence shown before Activate:
 * Get Started, Connect (agree to Ovalball's fee and connect GoCardless), Settings (collection day, first
 * payment, who pays Ovalball's fee), Memberships (name, monthly price, teams), Review.
 *
 * THE SERVER DECIDES, THE SCREEN EXPLAINS. Every step reads `membership_setup_state` -- the connection in
 * GoCardless's own terms, the club's agreement, its memberships and what is still missing -- and every change
 * goes through a door that checks authority and validity again. Activate re-derives readiness on the server
 * whatever this screen showed; a button disabled here is guidance, never the protection.
 *
 * NOTHING SECRET TOUCHES THE PHONE. Connecting is GoCardless's own sign-in in the system's authentication
 * browser (src/membership/gocardless-connect.ts); the app only ever learns how it ended. The state is read
 * again whenever the screen comes back into focus, because GoCardless verifies in its own time.
 */

type StepKey = "start" | "connect" | "settings" | "memberships" | "review"

const STEPS: { key: StepKey; label: string }[] = [
  { key: "start", label: "Get Started" },
  { key: "connect", label: "Connect" },
  { key: "settings", label: "Settings" },
  { key: "memberships", label: "Memberships" },
  { key: "review", label: "Review" },
]

const STEP_FOR: Record<ReadinessItem, StepKey> = { TERMS: "connect", CONNECT: "connect", VERIFY: "connect", FEE: "settings", MEMBERSHIP: "memberships" }

const RETURN_PATH = "/admin/subscriptions/setup"

/** Where a returning person picks up: the first step with something left to do. */
function firstUnfinished(s: MembershipSetupState): StepKey {
  const connected = s.connection.state !== "NOT_CONNECTED" && s.connection.state !== "DISCONNECTED"
  if (!connected || !s.terms.accepted) return s.state === "NOT_STARTED" && !connected && !s.terms.accepted ? "start" : "connect"
  if (!s.programme || !s.programme.feeBearer) return "settings"
  if (s.readiness.missing.includes("MEMBERSHIP")) return "memberships"
  return "review"
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

interface SettingsDraft {
  collectionDay: number
  firstPaymentPolicy: SetupFirstPaymentPolicy
  feeBearer: FeeBearer | null
}

type Notice = { tone: "positive" | "info" | "warning" | "danger"; text: string }

export default function ClubMembershipsSetup() {
  const router = useRouter()
  const params = useLocalSearchParams<{ step?: string; intent?: string; result?: string; handoff?: string }>()
  const { clubId } = useAdminCentreAccess()
  const { club } = useAppContexts()
  const clubName = club.clubId === clubId ? club.name : null

  const [setup, setSetup] = useState<MembershipSetupState | null>(null)
  const [loadProblem, setLoadProblem] = useState<string | null>(null)
  const [step, setStep] = useState<StepKey | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState<"connect" | "terms" | "settings" | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [draft, setDraft] = useState<SettingsDraft | null>(null)
  const [dayOpen, setDayOpen] = useState(false)
  const [example, setExample] = useState<FirstPaymentExample | null>(null)
  const [editing, setEditing] = useState<SetupMembership | "new" | null>(null)
  const [sheetSaving, setSheetSaving] = useState(false)
  const [sheetProblem, setSheetProblem] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [activating, setActivating] = useState(false)
  const [activateProblem, setActivateProblem] = useState<string | null>(null)
  const [activated, setActivated] = useState<ActivationOutcome | null>(null)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)
  const pending = usePendingIntent("memberships:setup")
  const generation = useRef(0)

  const load = useCallback(async () => {
    if (!clubId) return
    const gen = ++generation.current
    try {
      const next = await loadMembershipSetup(supabase, clubId)
      if (gen !== generation.current) return
      setSetup(next)
      setLoadProblem(null)
    } catch (cause) {
      const failure = friendly(cause, "the club's membership setup")
      logDetail("memberships:setup", failure)
      if (gen === generation.current) setLoadProblem(membershipSetupErrorMessage(cause, failure.message))
    }
  }, [clubId])

  // A different club is a different setup: nothing of the last one's answers, drafts or step carries over.
  useEffect(() => {
    setSetup(null)
    setStep(null)
    setDraft(null)
    setAgreed(false)
    setActivated(null)
  }, [clubId])

  // Read again on every return: from GoCardless's pages, from verification, from a step-up.
  useFocusEffect(
    useCallback(() => {
      void load()
      // Back from verifying who they are: the same question again, the reason put back.
      const resume = pending.take()
      if (resume) setAsk(resumedAsk(resume))
    }, [load, pending])
  )

  // WHERE TO START: an active programme is managed, not set up; otherwise the step asked for, else the first
  // step with something left to do.
  useEffect(() => {
    if (!setup || step !== null) return
    if (setup.state === "ACTIVE" || setup.state === "PAUSED") {
      router.replace("/admin/subscriptions/settings" as never)
      return
    }
    const asked = STEPS.find((s) => s.key === params.step)?.key
    setStep(asked ?? firstUnfinished(setup))
    // A step asked for by a link is used once: left in the address, it would decide every later visit too.
    if (asked) router.setParams({ step: undefined } as never)
  }, [setup, step, params.step, router])

  // The settings draft is the person's until they save it: re-reading the server never overwrites it.
  useEffect(() => {
    if (!setup || draft) return
    setDraft({
      collectionDay: setup.programme?.collectionDay ?? 1,
      firstPaymentPolicy: setup.programme?.firstPaymentPolicy ?? "NEXT_COLLECTION_DAY",
      feeBearer: setup.programme?.feeBearer ?? null,
    })
  }, [setup, draft])

  const index = step ? STEPS.findIndex((s) => s.key === step) : 0
  useEffect(() => {
    if (step && !activated) AccessibilityInfo.announceForAccessibility(`Step ${index + 1} of ${STEPS.length}: ${STEPS[index]!.label}`)
  }, [step, index, activated])

  useEffect(() => {
    if (notice && notice.tone !== "positive") AccessibilityInfo.announceForAccessibility(notice.text)
  }, [notice])

  function go(next: StepKey) {
    setNotice(null)
    setActivateProblem(null)
    setStep(next)
  }

  // THE WORKED EXAMPLE AND THE RECEIPT come from the server's own rules, for the club's own first priced
  // membership -- or, before there is one, a stated £10.00 example.
  const exampleAmount = useMemo(() => {
    const priced = setup?.memberships.find((m) => m.monthlyAmountMinor !== null && m.teams.length > 0) ?? setup?.memberships.find((m) => m.monthlyAmountMinor !== null)
    return priced?.monthlyAmountMinor ?? 1000
  }, [setup])
  // The example's basis, said: the club's own membership when it has a priced one, otherwise a stated £10.00 --
  // said to be an example, because the club's own prices come in the next step.
  const exampleMembership = setup?.memberships.find((m) => m.monthlyAmountMinor === exampleAmount && m.monthlyAmountMinor !== null) ?? null
  const exampleHeading = exampleMembership ? `For example, on ${exampleMembership.name}` : "For example, on a £10.00 monthly membership (you set your own prices next)"
  const receiptBasis = exampleMembership ? `On ${exampleMembership.name} at ${formatMinorUnits(exampleAmount)} a month` : "On a £10.00 monthly membership, as an example"
  // WHICH INPUTS THE FIGURES ARE FOR: a receipt is only ever shown for the choices on screen. Until the server has
  // answered for the current ones, its place is held -- never the last choice's numbers under a new choice.
  const exampleKey = draft ? `${exampleAmount}|${draft.collectionDay}|${draft.firstPaymentPolicy}|${draft.feeBearer ?? ""}` : ""
  const [exampleFor, setExampleFor] = useState<string | null>(null)
  const exampleGeneration = useRef(0)
  useEffect(() => {
    if (!clubId || !draft || (step !== "settings" && step !== "review")) return
    const gen = ++exampleGeneration.current
    const key = exampleKey
    loadFirstPaymentExample(supabase, { clubId, monthlyAmountMinor: exampleAmount, joinDate: todayIso(), collectionDay: draft.collectionDay, firstPaymentPolicy: draft.firstPaymentPolicy, feeBearer: draft.feeBearer })
      .then((next) => {
        if (gen !== exampleGeneration.current) return
        setExample(next)
        setExampleFor(key)
      })
      .catch((cause) => {
        logDetail("memberships:example", friendly(cause, "the example"))
        if (gen === exampleGeneration.current) {
          setExample(null)
          setExampleFor(key)
        }
      })
  }, [clubId, draft, exampleAmount, step, exampleKey])
  const exampleCurrent = example !== null && exampleFor === exampleKey
  // A changed choice is heard as well as seen: the new figures, said once, when they arrive.
  const announcedFor = useRef<string | null>(null)
  useEffect(() => {
    if (step !== "settings" || !exampleCurrent || !example || !draft?.feeBearer || announcedFor.current === exampleKey) return
    if (announcedFor.current !== null) {
      AccessibilityInfo.announceForAccessibility(receiptAnnouncement({ memberPaysMinor: example.monthlyCollectMinor, feeMinor: example.monthlyFeeMinor, clubReceivesMinor: example.clubReceivesMonthlyBeforeGoCardlessMinor }))
    }
    announcedFor.current = exampleKey
  }, [step, exampleCurrent, example, draft?.feeBearer, exampleKey])

  // ---------------------------------------------------------------------------------------------------------------
  // CONNECT
  // ---------------------------------------------------------------------------------------------------------------

  function connectNotice(result: GoCardlessConnectResult): Notice {
    if (result.outcome === "connected") {
      if (result.verification === "successful") return { tone: "positive", text: "GoCardless is connected and the club's account is verified." }
      if (result.verification === "action_required") return { tone: "warning", text: "GoCardless is connected. GoCardless needs more information from the club before it can collect." }
      return { tone: "positive", text: "GoCardless is connected. GoCardless will verify the club's account; you can carry on setting up." }
    }
    return { tone: result.outcome === "cancelled" ? "info" : "danger", text: result.message }
  }

  async function connect() {
    if (!setup || !clubId) return
    setBusy("connect")
    setNotice(null)
    try {
      if (!setup.terms.accepted) await acceptMembershipTerms(supabase, clubId, setup.terms.version)
      const result = await connectGoCardless({ supabase, clubId, returnPath: RETURN_PATH })
      await load()
      setNotice(connectNotice(result))
      if (result.outcome === "connected") AccessibilityInfo.announceForAccessibility(connectNotice(result).text)
    } catch (cause) {
      const failure = friendly(cause, "GoCardless")
      logDetail("memberships:connect", failure)
      setNotice({ tone: "danger", text: membershipSetupErrorMessage(cause, failure.message) })
      await load()
    } finally {
      setBusy(null)
    }
  }

  // ON ANDROID a return can reach this screen as a link, with the connection it belongs to. The helper answers
  // with the running call's result, or one it already gave -- a connection is never finished twice from here.
  const finishedIntent = useRef<string | null>(null)
  useEffect(() => {
    const intentId = typeof params.intent === "string" && params.intent ? params.intent : null
    if (!intentId || finishedIntent.current === intentId) return
    finishedIntent.current = intentId
    void (async () => {
      setBusy("connect")
      try {
        const result = await finishGoCardlessConnect({ supabase, intentId, handoff: typeof params.handoff === "string" ? params.handoff : null })
        await load()
        setNotice(connectNotice(result))
      } finally {
        setBusy(null)
        router.setParams({ intent: undefined, result: undefined, handoff: undefined } as never)
      }
    })()
  }, [params.intent, load, router])

  async function agreeToTerms(then?: StepKey) {
    if (!setup || !clubId) return
    setBusy("terms")
    setNotice(null)
    try {
      await acceptMembershipTerms(supabase, clubId, setup.terms.version)
      await load()
      if (then) go(then)
    } catch (cause) {
      const failure = friendly(cause, "the agreement")
      logDetail("memberships:terms", failure)
      setNotice({ tone: "danger", text: membershipSetupErrorMessage(cause, failure.message) })
      await load()
    } finally {
      setBusy(null)
    }
  }

  /**
   * MANAGING THE CONNECTION, for whoever may connect it: disconnecting goes through the website's route, so the
   * club's token is revoked at GoCardless straight away -- the same door, words and reason as the Memberships home.
   */
  async function askDisconnect() {
    if (!clubId) return
    const impact = await readActiveSubscriptionImpact(supabase, clubId).catch(() => null)
    const live =
      impact && impact.activeGoCardlessSubscriptions > 0
        ? ` Right now ${impact.activeGoCardlessSubscriptions === 1 ? "1 Direct Debit collection is" : `${impact.activeGoCardlessSubscriptions} Direct Debit collections are`} live.`
        : ""
    setAsk({
      title: "Disconnect GoCardless?",
      body: `Ovalball stops using the club's GoCardless account straight away, and memberships can't be switched on until it is connected again. Everything set up here, and all payment history, stays. GoCardless may still collect payments it has already scheduled; cancel those in GoCardless if they should stop.${live}`,
      confirmLabel: "Disconnect GoCardless",
      destructive: true,
      reason: "required",
      onConfirm: async (reason) => {
        const result = await disconnectThroughWebsite({ supabase, clubId, reason })
        // Thrown in the shape the sheet reads, so a recent-authenticator refusal goes to step-up like any other.
        if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code })
        setNotice({ tone: "info", text: "GoCardless is disconnected. Connect it again to carry on setting up." })
        await load()
      },
    })
  }

  async function openVerification() {
    if (!setup) return
    await WebBrowser.openBrowserAsync(goCardlessVerifyUrl(setup.connection.environment)).catch(() => undefined)
    await load()
  }

  // ---------------------------------------------------------------------------------------------------------------
  // SETTINGS
  // ---------------------------------------------------------------------------------------------------------------

  const settingsChanged =
    !!draft && (!setup?.programme || setup.programme.collectionDay !== draft.collectionDay || setup.programme.firstPaymentPolicy !== draft.firstPaymentPolicy || setup.programme.feeBearer !== draft.feeBearer)

  async function saveSettings() {
    if (!clubId || !draft) return
    if (!settingsChanged) return go("memberships")
    setBusy("settings")
    setNotice(null)
    try {
      await saveMembershipSettings(supabase, clubId, draft)
      await load()
      go("memberships")
    } catch (cause) {
      const failure = friendly(cause, "the collection settings")
      logDetail("memberships:settings", failure)
      setNotice({ tone: "danger", text: membershipSetupErrorMessage(cause, failure.message) })
    } finally {
      setBusy(null)
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // MEMBERSHIPS -- one membership's changes, in the order most likely to be refused first (a name already used),
  // so a refusal leaves the rest unchanged. The screen re-reads whatever happens, so it never shows a guess.
  // ---------------------------------------------------------------------------------------------------------------

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
      await load()
      AccessibilityInfo.announceForAccessibility(`${d.name} saved.`)
    } catch (cause) {
      const failure = friendly(cause, "this membership")
      logDetail("memberships:membership", failure)
      setSheetProblem(membershipSetupErrorMessage(cause, failure.message))
      await load()
    } finally {
      setSheetSaving(false)
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // ACTIVATE
  // ---------------------------------------------------------------------------------------------------------------

  async function activate() {
    if (!clubId) return
    setActivating(true)
    setActivateProblem(null)
    try {
      const outcome = await activateMemberships(supabase, clubId)
      setConfirming(false)
      setActivated(outcome)
      AccessibilityInfo.announceForAccessibility("Club memberships are on.")
      await load()
    } catch (cause) {
      if (isRecentAuthRefusal(cause)) {
        setConfirming(false)
        router.push({ pathname: "/step-up", params: { returnTo: RETURN_PATH } } as never)
        return
      }
      const failure = friendly(cause, "club memberships")
      logDetail("memberships:activate", failure)
      setActivateProblem(membershipSetupErrorMessage(cause, failure.message))
      await load()
    } finally {
      setActivating(false)
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // THE SCREEN
  // ---------------------------------------------------------------------------------------------------------------

  const back = activated ? undefined : index > 0 ? () => go(STEPS[index - 1]!.key) : undefined

  // Until the step and the draft exist there is nothing true to draw -- including while an active programme is
  // on its way to Membership Settings.
  if (!clubId || (!setup && !loadProblem) || (setup && (!step || !draft))) {
    return (
      <FlowScreen title="Club Memberships">
        <Body>
          <CardSkeleton lines={3} />
          <CardSkeleton lines={2} />
        </Body>
      </FlowScreen>
    )
  }

  if (!setup) {
    return (
      <FlowScreen title="Club Memberships">
        <Body>
          <ErrorState message={loadProblem ?? "Could not load the club's membership setup."} onRetry={() => void load()} />
        </Body>
      </FlowScreen>
    )
  }

  if (!setup.canConfigure && !setup.canConnect) {
    return (
      <FlowScreen title="Club Memberships">
        <Body>
          <EmptyState title="Not for you at this club" body="Setting up club memberships needs a finance permission at this club. If that has changed, come back to this screen." />
        </Body>
      </FlowScreen>
    )
  }

  const s = setup
  const d = draft!
  const bps = s.feeBps
  const pct = feePercent(bps)
  const connected = s.connection.state !== "NOT_CONNECTED" && s.connection.state !== "DISCONNECTED"
  const termsOk = s.terms.accepted || agreed
  const currency = s.programme?.currency ?? "GBP"
  const unassigned = s.teams.filter((t) => !t.productId)
  const pricedTeams = s.memberships.reduce((n, m) => n + (m.monthlyAmountMinor !== null ? m.teams.length : 0), 0)
  const receipt = !d.feeBearer ? null : exampleCurrent && example ? (
    <MoneyReceipt basis={receiptBasis} memberPaysMinor={example.monthlyCollectMinor} feeMinor={example.monthlyFeeMinor} clubReceivesMinor={example.clubReceivesMonthlyBeforeGoCardlessMinor} bps={bps} currency={currency} />
  ) : (
    <ReceiptPlaceholder />
  )
  const waitingForGoCardless = onlyWaitingForVerification(s)
  // How every membership is collected and what a part-way joiner pays first: the club's saved settings, once.
  const collection = s.programme
    ? { day: s.programme.collectionDay, firstPayment: firstPaymentPolicyOptions(s.programme.collectionDay).find((o) => o.value === s.programme!.firstPaymentPolicy)?.label ?? null }
    : null

  // -------------------------------------------------------------------------------------------------- footers
  let footer: React.ReactNode
  // THE AGREEMENT SITS WITH THE BUTTON IT UNLOCKS: ticked right above Connect, never scrolled out of sight above it.
  const agreement =
    !s.terms.accepted && (s.canConfigure || s.canConnect) ? (
      <ChoiceRow kind="checkbox" checked={agreed} label={`I agree to Ovalball's terms on behalf of ${clubName ?? "the club"}`} onPress={() => setAgreed((v) => !v)} />
    ) : null
  const status = activationStatus(s, clubName)
  if (activated) {
    footer = (
      <View style={{ gap: space.xs }}>
        <Button variant="brand" label="Done" onPress={() => router.dismissTo("/admin/subscriptions" as never)} />
        <Button label="Membership Settings" variant="quiet" onPress={() => router.replace("/admin/subscriptions/settings" as never)} />
      </View>
    )
  } else if (step === "start") {
    footer = <Button variant="brand" label="Get Started" onPress={() => go("connect")} trailing={<ArrowRight size={18} color={colour.onForest} />} />
  } else if (step === "connect") {
    if (!connected && s.canConnect) {
      footer = (
        <View style={{ gap: space.sm }}>
          {agreement}
          <Button
            variant="brand"
            label={s.connection.state === "DISCONNECTED" ? "Reconnect GoCardless" : "Connect GoCardless"}
            onPress={() => void connect()}
            busy={busy === "connect"}
            disabled={!termsOk || busy !== null}
            trailing={<ArrowUpRight size={18} color={colour.onForest} />}
            accessibilityHint={termsOk ? "Opens GoCardless in a secure browser window. You come back here when it is done." : "Tick the agreement first"}
          />
          <Button label="Learn More About GoCardless" variant="quiet" onPress={() => void WebBrowser.openBrowserAsync(GOCARDLESS_ABOUT_URL).catch(() => undefined)} />
        </View>
      )
    } else {
      // A club connected before these terms existed agrees here, before it goes on: the agreement is not skippable.
      const mustAgree = !s.terms.accepted && (s.canConfigure || s.canConnect)
      footer = (
        <View style={{ gap: space.sm }}>
          {mustAgree && agreement}
          <ButtonRow weights={[1, 2]}>
            <Button label="Back" variant="secondary" onPress={() => go("start")} />
            <Button
              variant="brand"
              label={mustAgree ? "Agree and Continue" : "Continue"}
              busy={busy === "terms"}
              disabled={busy !== null || (mustAgree && !agreed)}
              onPress={() => (mustAgree ? void agreeToTerms("settings") : go("settings"))}
            />
          </ButtonRow>
        </View>
      )
    }
  } else if (step === "settings") {
    footer = s.canConfigure ? (
      <View style={{ gap: space.xs }}>
        {!d.feeBearer && <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center" }]}>{`Choose who pays Ovalball's ${pct} to continue.`}</Text>}
        <ButtonRow weights={[1, 2]}>
          <Button label="Back" variant="secondary" onPress={() => go("connect")} />
          <Button variant="brand" label="Save and Continue" busy={busy === "settings"} disabled={!d.feeBearer || busy !== null} onPress={() => void saveSettings()} />
        </ButtonRow>
      </View>
    ) : (
      <ButtonRow weights={[1, 2]}>
        <Button label="Back" variant="secondary" onPress={() => go("connect")} />
        <Button variant="brand" label="Continue" onPress={() => go("memberships")} />
      </ButtonRow>
    )
  } else if (step === "memberships") {
    const none = s.readiness.readyMemberships === 0
    footer = (
      <View style={{ gap: space.xs }}>
        {none && s.canConfigure && <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center" }]}>Give a membership a monthly price and at least one team to continue.</Text>}
        <ButtonRow weights={[1, 2]}>
          <Button label="Back" variant="secondary" onPress={() => go("settings")} />
          <Button variant="brand" label="Continue" disabled={none && s.canConfigure} onPress={() => go("review")} />
        </ButtonRow>
      </View>
    )
  } else {
    const blocked = !s.readiness.canActivate || !s.canConfigure
    footer = (
      <View style={{ gap: space.xs }}>
        {/* WHAT PRESSING IT DOES, said where it is pressed -- or why it cannot be pressed yet. */}
        <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center" }]}>
          {!s.canConfigure
            ? "Only someone who can set up memberships can switch them on."
            : !blocked
              ? "Members, or their parents, can set up their Direct Debit as soon as memberships are on."
              : waitingForGoCardless
                ? "Activate becomes available when GoCardless finishes verifying."
                : "Finish the things listed above to switch memberships on."}
        </Text>
        <Button variant="brand" label="Activate Club Memberships" disabled={blocked} onPress={() => setConfirming(true)} />
      </View>
    )
  }

  // WHAT AN ACTION SAID sits with the buttons, pinned where the person's thumb already is: at the top of a long
  // step it was scrolled out of sight by the time Connect came back.
  if (notice && !activated) {
    footer = (
      <View style={{ gap: space.sm }}>
        <Note tone={notice.tone}>{notice.text}</Note>
        {footer}
      </View>
    )
  }

  return (
    <FlowScreen title="Club Memberships" footer={footer} onBack={back} scrollKey={activated ? "activated" : step}>
      <Body>
        {/* Ticks only for what is really finished: passing a step without finishing it never shows it done. */}
        {!activated && <Steps labels={STEPS.map((x) => x.label)} current={index} done={[true, ...setupProgress(s).map((x) => x.done)]} />}

        {/* ---------------------------------------------------------------------------------- DONE */}
        {activated && (
          <View style={{ gap: space.xl, paddingTop: space.lg }}>
            <View style={{ alignItems: "center", gap: space.md }}>
              <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
                <CircleCheck size={36} color={colour.forest800} />
              </View>
              <Text accessibilityRole="header" style={[type.title, { color: colour.ink, textAlign: "center" }]}>
                {activated === "RESUMED" ? "Club Memberships Are Back On" : "Club Memberships Are On"}
              </Text>
              <Text style={[type.body, { color: colour.inkMuted, textAlign: "center" }]}>
                {activatedSentence(pricedTeams)}
              </Text>
            </View>
            <ActionGroup>
              <InfoRow first icon={<CalendarDays size={20} color={colour.forest800} />} title={`Payments are taken on the ${ordinalWord(s.programme?.collectionDay ?? d.collectionDay)} of each month`} body="Each member's first payment follows the club's first payment setting." />
              <InfoRow icon={<PoundSterling size={20} color={colour.forest800} />} title={feeBearerSentence(s.programme?.feeBearer ?? d.feeBearer, bps)} />
              <InfoRow icon={<RefreshCw size={20} color={colour.forest800} />} title="Changes reach new memberships" body="Changing a setting later never changes a payment already set up. You can pause new memberships at any time in Membership Settings." />
            </ActionGroup>
          </View>
        )}

        {/* ---------------------------------------------------------------------------------- GET STARTED */}
        {!activated && step === "start" && (
          <View style={{ gap: space.xl }}>
            <View style={{ alignItems: "center", gap: space.md, paddingTop: space.sm }}>
              {/* The club's own crest, never tinted or swapped: this is the club's money, not a generic wizard's. */}
              <ClubCrest clubName={clubName} url={club.clubId === clubId ? club.crestUrl : null} size={72} />
              <Text accessibilityRole="header" style={[type.title, { fontSize: 24, lineHeight: 30, color: colour.ink, textAlign: "center" }]}>
                Set Up Club Memberships
              </Text>
              <Text style={[type.body, { color: colour.inkMuted, textAlign: "center" }]}>Collect monthly membership payments by Direct Debit, and always know who is up to date.</Text>
            </View>
            <ActionGroup>
              <InfoRow first icon={<Wallet size={20} color={colour.forest800} />} title="Collect membership payments with GoCardless" />
              <InfoRow icon={<ListChecks size={20} color={colour.forest800} />} title="See who has set up, who has paid and who needs action" />
              <InfoRow icon={<Users size={20} color={colour.forest800} />} title="Keep memberships connected to your teams and people" />
              <InfoRow icon={<Bell size={20} color={colour.forest800} />} title="Reduce chasing with built-in reminders" />
            </ActionGroup>

            {/* WHAT THE CLUB WILL DO, in order -- a real sequence, so it is numbered. */}
            <View style={{ gap: space.sm }}>
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
                {"What You'll Set Up"}
              </Text>
              <ActionGroup>
                {setupOverviewSteps(bps).map((x, i) => (
                  <View key={x.key} accessible accessibilityLabel={`${i + 1}. ${x.title}. ${x.body}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md, paddingVertical: space.md, paddingHorizontal: space.lg, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
                      <Text allowFontScaling={false} style={[type.smallMedium, { color: colour.rugby700 }]}>
                        {i + 1}
                      </Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Text style={[type.bodyMedium, { color: colour.ink }]}>{x.title}</Text>
                      <Text style={[type.small, { color: colour.inkMuted }]}>{x.body}</Text>
                    </View>
                  </View>
                ))}
              </ActionGroup>
            </View>

            {/* OVALBALL'S FEE before anything is asked of the club: plain words, never only in the terms. */}
            <View accessible style={{ borderRadius: radius.lg, backgroundColor: colour.mint100, padding: space.lg, gap: space.xs }}>
              <Text style={[type.heading, { color: colour.forest800 }]}>{`Ovalball's fee is ${pct}`}</Text>
              <Text style={[type.small, { color: colour.forest800 }]}>{`Ovalball takes ${pct} of each membership payment collected. You choose whether the club or its members pay it. GoCardless's own fees are separate.`}</Text>
            </View>

            <Note>No money is collected until you switch memberships on and each member, or their parent, sets up their own Direct Debit.</Note>
          </View>
        )}

        {/* ---------------------------------------------------------------------------------- CONNECT */}
        {!activated && step === "connect" && (
          <View style={{ gap: space.xl }}>
            <View style={{ gap: space.sm }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
                <Text accessibilityRole="header" style={[type.title, { color: colour.ink }]}>
                  Connect GoCardless
                </Text>
                <ConnectionChip state={s.connection.state} />
              </View>
              <Text style={[type.body, { color: colour.inkMuted }]}>{connectionSentence(s.connection.state)}</Text>
              {s.connection.environment === "sandbox" && connected && <Text style={[type.caption, { color: colour.inkSubtle }]}>This is a GoCardless test account: no real money moves.</Text>}
            </View>

            {s.connection.state === "ACTION_REQUIRED" && s.canConnect && (
              <View style={{ gap: space.sm }}>
                <Note tone="warning">GoCardless needs more information from the club before it can collect payments. It only takes a few minutes on GoCardless's own site.</Note>
                <Button label="Finish Verification with GoCardless" variant="secondary" onPress={() => void openVerification()} trailing={<ArrowUpRight size={18} color={colour.ink} />} />
              </View>
            )}

            {/* CONNECTED: the connection as facts, and what an authorised person can do with it. */}
            {connected && (
              <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.lg, gap: space.md }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                  <IconTile>
                    <Landmark size={20} color={colour.forest800} />
                  </IconTile>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
                      {"The Club's GoCardless Account"}
                    </Text>
                  </View>
                </View>
                <View>
                  {connectionFacts(s.connection).map((f, i) => (
                    <View key={f.label} accessible accessibilityLabel={`${f.label}: ${f.value}`} style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: space.sm, paddingVertical: space.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line }}>
                      <Text style={[type.small, { color: colour.inkMuted }]}>{f.label}</Text>
                      <Text style={[type.smallMedium, { color: colour.ink, flexShrink: 1, textAlign: "right" }]}>{f.value}</Text>
                    </View>
                  ))}
                </View>
                {s.canConnect && <Button label="Disconnect GoCardless" variant="quiet" onPress={() => void askDisconnect()} />}
              </View>
            )}

            {/* NOT CONNECTED: why GoCardless, what happens to bank details, what Ovalball receives -- then the money's
                roles, then what the club agrees to, and the button with its agreement pinned below. */}
            {!connected && (
              <ActionGroup>
                {GOCARDLESS_CONNECT_POINTS.map((point, i) => (
                  <InfoRow
                    key={point.key}
                    first={i === 0}
                    icon={point.key === "secure" ? <Lock size={20} color={colour.forest800} /> : point.key === "bank" ? <Landmark size={20} color={colour.forest800} /> : point.key === "data" ? <ListChecks size={20} color={colour.forest800} /> : <RefreshCw size={20} color={colour.forest800} />}
                    title={point.title}
                    body={point.body}
                  />
                ))}
              </ActionGroup>
            )}

            {!connected && (
              <View style={{ gap: space.xs }}>
                <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
                  How the Money Works
                </Text>
                <Text style={[type.small, { color: colour.ink }]}>{membershipDisclosure(bps)}</Text>
                <Text style={[type.caption, { color: colour.inkSubtle }]}>{CLUB_MEMBERSHIP_TERMS_STATUS}</Text>
              </View>
            )}

            <TermsCard
              title={s.terms.accepted ? "Ovalball's Terms" : "What the Club Agrees To"}
              bps={bps}
              terms={s.terms}
              clubName={clubName}
              agreed={agreed}
              onToggle={() => setAgreed((v) => !v)}
              canAgree={false}
              agreeBelow={!s.terms.accepted && (s.canConfigure || s.canConnect)}
            />

            {!connected && s.canConnect && <Note>After connecting, GoCardless may need to verify the club's account. You can carry on setting up while it does.</Note>}
            {!s.canConnect && <Note tone="warning">Connecting GoCardless needs the GoCardless permission at this club. A Club Admin can connect it; you can carry on with the other steps.</Note>}
          </View>
        )}

        {/* ---------------------------------------------------------------------------------- SETTINGS */}
        {!activated && step === "settings" && (
          <View style={{ gap: space.xl }}>
            <SectionTitle title="Collection Settings" detail="These apply to new memberships. Changing them later never changes a payment already scheduled, collected or owed." />
            {!s.canConfigure && <Note tone="warning">Only someone who can set up memberships can change these settings.</Note>}

            <View style={{ gap: space.sm }}>
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
                Collection Day
              </Text>
              <FormRow icon={<CalendarDays size={20} color={colour.forest800} />} label="Day" value={`${ordinalWord(d.collectionDay)} of each month`} onPress={s.canConfigure ? () => setDayOpen(true) : undefined} />
              <Text style={[type.small, { color: colour.inkMuted }]}>{collectionDaySentence(d.collectionDay)}</Text>
            </View>

            <View style={{ gap: space.sm }}>
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
                First Payment
              </Text>
              <Text style={[type.small, { color: colour.inkMuted }]}>When a player joins part-way through a month:</Text>
              <View accessibilityRole="radiogroup" accessibilityLabel="First payment" style={{ gap: space.sm }}>
                {firstPaymentPolicyOptions(d.collectionDay).map((option) => (
                  <ChoiceRow key={option.value} kind="radio" checked={d.firstPaymentPolicy === option.value} label={option.label} description={option.body} disabled={!s.canConfigure} onPress={() => setDraft({ ...d, firstPaymentPolicy: option.value })} />
                ))}
              </View>
              {exampleCurrent && example && (
                <View accessible style={{ gap: 2, padding: space.md, borderRadius: 12, backgroundColor: colour.surface, borderWidth: 1, borderColor: colour.line }}>
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
                  <ChoiceRow key={option.value} kind="radio" describeInLabel checked={d.feeBearer === option.value} label={option.label} description={option.body} disabled={!s.canConfigure} onPress={() => setDraft({ ...d, feeBearer: option.value })} />
                ))}
              </View>
              {receipt}
            </View>
          </View>
        )}

        {/* ---------------------------------------------------------------------------------- MEMBERSHIPS */}
        {!activated && step === "memberships" && (
          <View style={{ gap: space.lg }}>
            <SectionTitle title="Memberships" detail="What each team's players pay a month, collected by Direct Debit. Each team has one membership; a player in two teams with different memberships pays the higher price, and a Club Admin can move them to the other one." />
            {s.memberships.length === 0 && <EmptyState title="No memberships yet" body="Add a membership with a monthly price and the teams it covers." />}
            {s.memberships.map((m) => (
              <MembershipCard key={m.id} membership={m} currency={currency} feeBearer={s.programme?.feeBearer ?? null} collection={collection} onEdit={s.canConfigure ? () => { setSheetProblem(null); setEditing(m) } : undefined} />
            ))}
            {s.canConfigure && (
              <Button label="Add a Membership" variant="secondary" icon={<Plus size={18} color={colour.ink} />} onPress={() => { setSheetProblem(null); setEditing("new") }} />
            )}
            {unassigned.length > 0 && s.memberships.length > 0 && (
              <Note>{`${unassigned.length === 1 ? "1 team has" : `${unassigned.length} teams have`} no membership: ${teamsSentence(unassigned, 4)}. Players only in ${unassigned.length === 1 ? "that team" : "those teams"} are not asked to pay.`}</Note>
            )}
          </View>
        )}

        {/* ---------------------------------------------------------------------------------- REVIEW */}
        {!activated && step === "review" && (
          <View style={{ gap: space.xl }}>
            <SectionTitle title="Review and Activate" detail="Check everything before switching memberships on. Nothing is collected until each member sets up their Direct Debit." />

            {/* READY OR NOT, FIRST: the server's readiness in one line. Activate is judged again on the server. */}
            <StatusPanel status={status}>
              {status.kind === "ACTION_REQUIRED" && <StillToDo missing={s.readiness.missing} connection={s.connection.state} onOpen={(item) => go(STEP_FOR[item])} bare />}
            </StatusPanel>

            <ActionGroup>
              <ReviewRow first icon={<FileText size={20} color={colour.forest800} />} label="Ovalball's Terms" value={s.terms.accepted ? "Agreed" : "Not agreed yet"} onPress={() => go("connect")} hint="Opens the Connect step" />
              <ReviewRow icon={<Landmark size={20} color={colour.forest800} />} label="GoCardless" chip={<ConnectionChip state={s.connection.state} />} chipLabel={CONNECTION_STATE_LABEL[s.connection.state]} onPress={() => go("connect")} hint="Opens the Connect step" />
              <ReviewRow icon={<CalendarDays size={20} color={colour.forest800} />} label="Collection Day" value={s.programme ? `${ordinalWord(s.programme.collectionDay)} of each month` : "Not set"} onPress={() => go("settings")} hint="Opens the Settings step" />
              <ReviewRow
                icon={<ReceiptPoundSterling size={20} color={colour.forest800} />}
                label="First Payment"
                value={s.programme ? (firstPaymentPolicyOptions(s.programme.collectionDay).find((o) => o.value === s.programme!.firstPaymentPolicy)?.label ?? null) : "Not set"}
                onPress={() => go("settings")}
                hint="Opens the Settings step"
              />
              <ReviewRow icon={<PoundSterling size={20} color={colour.forest800} />} label="Ovalball's Fee" value={s.programme?.feeBearer ? (feeBearerOptions(bps).find((o) => o.value === s.programme!.feeBearer)?.label ?? null) : "Not chosen"} onPress={() => go("settings")} hint="Opens the Settings step" />
            </ActionGroup>

            <View style={{ gap: space.md }}>
              <SectionTitle
                title={s.memberships.length === 1 ? "Membership" : "Memberships"}
                action={s.canConfigure ? <TextLink label="Edit" accessibilityLabel="Edit memberships" onPress={() => go("memberships")} /> : undefined}
              />
              {s.memberships.map((m) => (
                <MembershipCard key={m.id} membership={m} currency={currency} feeBearer={s.programme?.feeBearer ?? null} collection={collection} />
              ))}
            </View>

            {/* OVALBALL'S FEE, ITS OWN CARD, as the approved design has it: the rate, who pays it, and what members pay. */}
            <View style={{ borderRadius: radius.lg, backgroundColor: colour.surface, borderWidth: 1, borderColor: colour.line, padding: space.lg, gap: space.md }}>
              <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space.md }}>
                <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flexShrink: 1 }]}>
                  {"Ovalball's Fee"}
                </Text>
                <Text style={[type.title, { color: colour.rugby700, fontVariant: ["tabular-nums"] }]}>{pct}</Text>
              </View>
              <Text style={[type.small, { color: colour.ink }]}>{`Ovalball takes ${pct} of each membership payment collected. ${feeBearerSentence(s.programme?.feeBearer ?? null, bps)} GoCardless's own fees are separate.`}</Text>
              <MembershipsMoney memberships={s.memberships} bearer={s.programme?.feeBearer ?? null} bps={bps} currency={currency} />
            </View>

            {activateProblem && <Note tone="danger">{activateProblem}</Note>}
          </View>
        )}
      </Body>

      <CollectionDaySheet
        visible={dayOpen}
        day={d.collectionDay}
        onClose={() => setDayOpen(false)}
        onChoose={(day) => {
          setDraft({ ...d, collectionDay: day })
          setDayOpen(false)
        }}
      />

      <MembershipSheet
        visible={editing !== null}
        membership={editing === "new" ? null : editing}
        teams={s.teams}
        memberships={s.memberships}
        askPriceStart={false}
        onClose={() => setEditing(null)}
        onSave={(next) => void saveMembership(next)}
        saving={sheetSaving}
        problem={sheetProblem}
      />

      <Sheet
        visible={confirming}
        title="Activate Club Memberships?"
        hint="Members, or their parents, can set up their Direct Debit as soon as memberships are on."
        onClose={() => setConfirming(false)}
        onSave={() => void activate()}
        saving={activating}
        problem={activateProblem}
        saveLabel="Activate"
        dismissLabel="Not Yet"
        brand
      >
        <View style={{ gap: space.sm }}>
          {s.memberships
            .filter((m) => m.money !== null && m.teams.length > 0)
            .map((m) => (
              <ConfirmLine key={m.id} text={`${m.name}: members pay ${formatMinorUnits(m.money!.membersPayMinor)} a month, ${m.teams.length === 1 ? "1 team" : `${m.teams.length} teams`}.`} />
            ))}
          <ConfirmLine text={`Payments are taken on the ${ordinalWord(s.programme?.collectionDay ?? d.collectionDay)} of each month.`} />
          <ConfirmLine text={feeBearerSentence(s.programme?.feeBearer ?? null, bps)} />
          <ConfirmLine text="You can pause new memberships at any time in Membership Settings." />
        </View>
      </Sheet>
    </FlowScreen>
  )
}

function TextLink({ label, accessibilityLabel, onPress }: { label: string; accessibilityLabel?: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({ minHeight: TOUCH_TARGET, minWidth: TOUCH_TARGET, alignItems: "flex-end", justifyContent: "center", opacity: pressed ? 0.7 : 1 })}
    >
      <Text style={[type.smallMedium, { color: colour.forest800 }]}>{label}</Text>
    </Pressable>
  )
}

function ConfirmLine({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: "row", gap: space.sm }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colour.forest800, marginTop: 8 }} />
      <Text style={[type.small, { color: colour.ink, flex: 1, fontFamily: font.body }]}>{text}</Text>
    </View>
  )
}

const PANEL: Record<"READY" | "WAITING" | "ACTION_REQUIRED" | "NOT_ALLOWED", { bg: string; border: string; ink: string }> = {
  READY: { bg: colour.successSurface, border: "rgba(24,92,59,0.25)", ink: colour.rugby700 },
  WAITING: { bg: colour.surface, border: colour.line, ink: colour.forest800 },
  ACTION_REQUIRED: { bg: colour.warningSurface, border: "rgba(138,90,0,0.22)", ink: colour.warning },
  NOT_ALLOWED: { bg: colour.surface, border: colour.line, ink: colour.inkMuted },
}

/**
 * READY OR ACTION REQUIRED -- Review's first line, in the server's own readiness: green and ticked when Activate
 * will be accepted, amber with each thing to finish when it will not, plain while only GoCardless is left to act.
 */
function StatusPanel({ status, children }: { status: ReturnType<typeof activationStatus>; children?: React.ReactNode }) {
  const shade = PANEL[status.kind]
  const Icon = status.kind === "READY" ? CircleCheck : status.kind === "ACTION_REQUIRED" ? TriangleAlert : Clock
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: shade.border, backgroundColor: shade.bg, padding: space.lg, gap: space.sm }}>
      <View accessible accessibilityRole="header" accessibilityLabel={`${status.title}. ${status.body}`} style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
        <Icon size={22} color={shade.ink} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[type.heading, { color: shade.ink }]}>{status.title}</Text>
          <Text style={[type.small, { color: colour.ink }]}>{status.body}</Text>
        </View>
      </View>
      {children}
    </View>
  )
}

