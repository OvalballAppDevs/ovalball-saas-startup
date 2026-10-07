"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  FileText,
  Landmark,
  ListChecks,
  Lock,
  PoundSterling,
  ReceiptPoundSterling,
  RefreshCw,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react"
import {
  activatedSentence,
  activationStatus,
  CLUB_MEMBERSHIP_TERMS_STATUS,
  collectionDaySentence,
  connectionFacts,
  connectionSentence,
  feeBearerOptions,
  feeBearerSentence,
  feePercent,
  firstPaymentPolicyOptions,
  GOCARDLESS_ABOUT_URL,
  GOCARDLESS_CONNECT_POINTS,
  GOCARDLESS_FEES_SENTENCE,
  goCardlessVerifyUrl,
  membershipDisclosure,
  onlyWaitingForVerification,
  setupOverviewSteps,
  setupProgress,
  type ActivationOutcome,
  type ActivationStatus,
  type FeeBearer,
  type MembershipSetupState,
  type ReadinessItem,
  type SetupFirstPaymentPolicy,
  type SetupMembership,
} from "@ovalball/contracts/membership/setup"
import { formatMinorUnits, ordinalWord } from "@ovalball/contracts/club/finance"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

import { acceptMembershipTermsAction, activateMembershipsAction, saveMembershipAction, saveMembershipSettingsAction } from "./actions"
import {
  ARIA_DISABLED_LOOK,
  CheckRow,
  ChoiceCards,
  CollectionDaySelect,
  ConnectionChip,
  DisconnectGoCardlessDialog,
  disconnectImpactClause,
  exampleBasis,
  FirstPaymentExampleBlock,
  MembershipCard,
  MembershipDialog,
  MoneyReceipt,
  Panel,
  ReceiptAnnouncer,
  ReceiptPlaceholder,
  StillToDo,
  TermsPanel,
  teamsSentence,
  useFirstPaymentExample,
  type MembershipDraft,
} from "./membership-parts"

/**
 * CLUB MEMBERSHIPS -- SETTING UP, ON THE WEBSITE (Club Memberships Part 1).
 *
 * The phone's five steps, laid out for a desk: the step in an eight-column panel and, from the lg breakpoint, a
 * sticky four-column rail that keeps the whole setup, and the money receipt, in view. Below that breakpoint the rail
 * is not drawn (it would only stack after the step's own buttons): the step bar shows progress, the Settings step
 * carries its own receipt and Review says what members pay beside Ovalball's fee. Everything is read from
 * `membership_setup_state` (passed in by the page and re-read after every change) and every change is a server door
 * that re-checks authority and validity; Activate re-derives readiness whatever this page showed.
 *
 * THE SAME WORDS AND THE SAME ORDER AS THE PHONE (apps/mobile/app/(tabs)/admin/subscriptions/setup.tsx), from the one
 * contract: Get Started says what the club will set up and what Ovalball's fee is before anything is asked; Connect
 * says why GoCardless, how the money works and what the club agrees to, with the box to tick beside the button it
 * unlocks; a connected club sees its GoCardless account as facts; and Review opens with where activation stands.
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

/** Each reason to connect with its icon, as the phone draws them. */
const CONNECT_ICON: Record<(typeof GOCARDLESS_CONNECT_POINTS)[number]["key"], React.ReactNode> = {
  secure: <Lock className="size-5" />,
  bank: <Landmark className="size-5" />,
  data: <ListChecks className="size-5" />,
  return: <RefreshCw className="size-5" />,
}

function firstUnfinished(s: MembershipSetupState): StepKey {
  const connected = s.connection.state !== "NOT_CONNECTED" && s.connection.state !== "DISCONNECTED"
  if (!connected || !s.terms.accepted) return s.state === "NOT_STARTED" && !connected && !s.terms.accepted ? "start" : "connect"
  if (!s.programme || !s.programme.feeBearer) return "settings"
  if (s.readiness.missing.includes("MEMBERSHIP")) return "memberships"
  return "review"
}

type Notice = { tone: "positive" | "info" | "warning" | "danger"; text: string }

const NOTICE_CLASS: Record<Notice["tone"], string> = {
  positive: "border-pitch-600/30 bg-mint-100/50 text-forest-800",
  info: "border-ink/10 bg-chalk text-ink",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  danger: "border-destructive/30 bg-destructive/5 text-destructive-text",
}

const teamCount = (n: number) => (n === 0 ? "no teams yet" : n === 1 ? "1 team" : `${n} teams`)

export function MembershipSetupJourney({ setup, clubName, initialStep, initialNotice }: { setup: MembershipSetupState; clubName: string; initialStep?: string; initialNotice?: Notice | null }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [step, setStep] = useState<StepKey>(() => STEPS.find((s) => s.key === initialStep)?.key ?? firstUnfinished(setup))
  const [draft, setDraft] = useState<{ collectionDay: number; firstPaymentPolicy: SetupFirstPaymentPolicy; feeBearer: FeeBearer | null }>(() => ({
    collectionDay: setup.programme?.collectionDay ?? 1,
    firstPaymentPolicy: setup.programme?.firstPaymentPolicy ?? "NEXT_COLLECTION_DAY",
    feeBearer: setup.programme?.feeBearer ?? null,
  }))
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState<"connect" | "terms" | "settings" | null>(null)
  const [notice, setNotice] = useState<Notice | null>(initialNotice ?? null)
  const [editing, setEditing] = useState<SetupMembership | "new" | null>(null)
  const [sheetSaving, setSheetSaving] = useState(false)
  const [sheetProblem, setSheetProblem] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [activating, setActivating] = useState(false)
  const [activateProblem, setActivateProblem] = useState<string | null>(null)
  const [activated, setActivated] = useState<ActivationOutcome | null>(null)
  // Disconnecting: whether the dialog is open, and what it would leave running (kept while it closes).
  const [disconnect, setDisconnect] = useState<{ open: boolean; impact: string }>({ open: false, impact: "" })
  const headingRef = useRef<HTMLHeadingElement>(null)

  const s = setup
  const bps = s.feeBps
  const pct = feePercent(bps)
  const currency = s.programme?.currency ?? "GBP"
  const connected = s.connection.state !== "NOT_CONNECTED" && s.connection.state !== "DISCONNECTED"
  // A membership's money line is the server's figures under the SAVED arrangement, never the draft's.
  const savedBearer = s.programme?.feeBearer ?? null
  // How every membership is collected and what someone joining part-way pays first: the club's SAVED settings, said
  // on each membership once there are any -- never the draft on the Settings step.
  const collection = s.programme
    ? { day: s.programme.collectionDay, firstPayment: firstPaymentPolicyOptions(s.programme.collectionDay).find((o) => o.value === s.programme!.firstPaymentPolicy)?.label ?? null }
    : null
  const basis = exampleBasis(s.memberships, { pricesNext: true })
  const { example, changedSinceOpening } = useFirstPaymentExample({ clubId: s.clubId, monthlyAmountMinor: basis.amountMinor, collectionDay: draft.collectionDay, firstPaymentPolicy: draft.firstPaymentPolicy, feeBearer: draft.feeBearer })
  const index = STEPS.findIndex((x) => x.key === step)
  const priced = s.memberships.filter((m) => m.monthlyAmountMinor !== null)
  const pricedTeams = priced.reduce((n, m) => n + m.teams.length, 0)
  const unassigned = s.teams.filter((t) => !t.productId)
  // Nothing is left for the club to do: GoCardless is finishing its own review.
  const waiting = onlyWaitingForVerification(s)
  // Where Review stands, in the server's own readiness. Activate is judged again on the server whatever this says.
  const status = activationStatus(s, clubName)
  // THE AGREEMENT SITS WITH THE BUTTON IT UNLOCKS -- Connect GoCardless, or Agree and Continue -- so the two are always
  // seen together; the terms panel above only points to it. It is recorded on the server only when that button is used.
  const canAgree = !s.terms.accepted && (s.canConfigure || s.canConnect)
  const agreement = canAgree ? (
    <div className="max-w-xl">
      <CheckRow checked={agreed} onChange={setAgreed} label={`I agree to Ovalball's terms on behalf of ${clubName}`} />
    </div>
  ) : null

  // The step's own heading takes focus when the step changes, so a keyboard or screen reader lands on it.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    headingRef.current?.focus()
  }, [step, activated])

  function go(next: StepKey) {
    setNotice(null)
    setActivateProblem(null)
    setStep(next)
  }

  function refresh() {
    startTransition(() => router.refresh())
  }

  async function connect() {
    setBusy("connect")
    setNotice(null)
    if (!s.terms.accepted) {
      const recorded = await acceptMembershipTermsAction(s.clubId, s.terms.version)
      if (!recorded.ok) {
        setNotice({ tone: "danger", text: recorded.error })
        setBusy(null)
        return
      }
    }
    // GoCardless's own sign-in, through the website's own start route; it comes back to this page.
    window.location.assign(`/api/gocardless/oauth/start?clubId=${encodeURIComponent(s.clubId)}`)
  }

  async function agreeThen(next: StepKey) {
    setBusy("terms")
    const recorded = await acceptMembershipTermsAction(s.clubId, s.terms.version)
    setBusy(null)
    if (!recorded.ok) return setNotice({ tone: "danger", text: recorded.error })
    refresh()
    go(next)
  }

  // Membership Settings' own disconnect (its server action, its words, a reason recorded with it): what it would leave
  // running is read first, so the dialog's description is whole when it opens.
  async function askDisconnect() {
    setNotice(null)
    const impact = await disconnectImpactClause(s.clubId)
    setDisconnect({ open: true, impact })
  }

  const settingsChanged = !s.programme || s.programme.collectionDay !== draft.collectionDay || s.programme.firstPaymentPolicy !== draft.firstPaymentPolicy || s.programme.feeBearer !== draft.feeBearer

  async function saveSettings() {
    if (!settingsChanged) return go("memberships")
    setBusy("settings")
    const saved = await saveMembershipSettingsAction(s.clubId, draft)
    setBusy(null)
    if (!saved.ok) return setNotice({ tone: "danger", text: saved.error })
    refresh()
    go("memberships")
  }

  async function saveMembership(d: MembershipDraft) {
    if (!editing) return
    setSheetSaving(true)
    setSheetProblem(null)
    const result = await saveMembershipAction(s.clubId, {
      productId: editing === "new" ? null : editing.id,
      name: d.name,
      monthlyAmountMinor: d.monthlyAmountMinor,
      teamIds: d.teamIds,
      priceFrom: d.priceFrom,
      before: editing === "new" ? null : { name: editing.name, teamIds: editing.teams.map((t) => t.id) },
    })
    setSheetSaving(false)
    refresh()
    if (!result.ok) return setSheetProblem(result.error)
    setEditing(null)
  }

  async function activate() {
    setActivating(true)
    setActivateProblem(null)
    const result = await activateMembershipsAction(s.clubId)
    setActivating(false)
    if (!result.ok) {
      setActivateProblem(result.error)
      refresh()
      return
    }
    setConfirming(false)
    setActivated(result.outcome)
    // The action refreshes this route, which then IS Membership Settings; the success is said there.
    router.replace(`/club/settings/subscriptions?activated=${result.outcome === "RESUMED" ? "resumed" : "1"}`)
  }

  // ------------------------------------------------------------------------------------------------- the footer
  // A primary button that cannot be pressed yet keeps its place in the tab order (focusableWhenDisabled), so the
  // reason wired to it by aria-describedby is heard when it is reached.
  let footer: React.ReactNode = null
  if (step === "start") {
    footer = (
      <Button className="h-11 px-5 sm:h-10" onClick={() => go("connect")}>
        Get Started
        <ArrowRight aria-hidden="true" data-icon="inline-end" />
      </Button>
    )
  } else if (step === "connect") {
    if (!connected && s.canConnect) {
      const termsOk = s.terms.accepted || agreed
      footer = (
        <div className="w-full space-y-3">
          {agreement}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" className="h-11 sm:h-10" onClick={() => go("start")}>
              Back
            </Button>
            <Button
              className={`h-11 px-5 sm:h-10 ${ARIA_DISABLED_LOOK}`}
              focusableWhenDisabled
              disabled={!termsOk || busy !== null}
              onClick={() => void connect()}
              aria-describedby={!termsOk ? "connect-why" : undefined}
            >
              {busy === "connect" ? "Opening GoCardless…" : s.connection.state === "DISCONNECTED" ? "Reconnect GoCardless" : "Connect GoCardless"}
              <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
            </Button>
            <a href={GOCARDLESS_ABOUT_URL} target="_blank" rel="noreferrer" className="text-sm font-medium text-forest-800 underline-offset-4 hover:underline">
              Learn More About GoCardless
            </a>
          </div>
          {!termsOk && (
            <p id="connect-why" className="text-xs text-ink-muted">
              Tick the agreement to connect.
            </p>
          )}
        </div>
      )
    } else {
      // A club connected before these terms existed agrees here, before it goes on: the agreement is not skippable.
      const mustAgree = canAgree
      footer = (
        <div className="w-full space-y-3">
          {agreement}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" className="h-11 sm:h-10" onClick={() => go("start")}>
              Back
            </Button>
            <Button
              className={`h-11 px-5 sm:h-10 ${ARIA_DISABLED_LOOK}`}
              focusableWhenDisabled
              disabled={busy !== null || (mustAgree && !agreed)}
              onClick={() => (mustAgree ? void agreeThen("settings") : go("settings"))}
              aria-describedby={mustAgree && !agreed ? "agree-why" : undefined}
            >
              {mustAgree ? "Agree and Continue" : "Continue"}
            </Button>
          </div>
          {mustAgree && !agreed && (
            <p id="agree-why" className="text-xs text-ink-muted">
              Tick the agreement to continue.
            </p>
          )}
        </div>
      )
    }
  } else if (step === "settings") {
    footer = (
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" className="h-11 sm:h-10" onClick={() => go("connect")}>
          Back
        </Button>
        {s.canConfigure ? (
          <Button
            className={`h-11 px-5 sm:h-10 ${ARIA_DISABLED_LOOK}`}
            focusableWhenDisabled
            disabled={!draft.feeBearer || busy !== null}
            onClick={() => void saveSettings()}
            aria-describedby={!draft.feeBearer ? "settings-why" : undefined}
          >
            {busy === "settings" ? "Saving…" : "Save and Continue"}
          </Button>
        ) : (
          <Button className="h-11 px-5 sm:h-10" onClick={() => go("memberships")}>
            Continue
          </Button>
        )}
        {s.canConfigure && !draft.feeBearer && (
          <p id="settings-why" className="text-xs text-ink-muted">{`Choose who pays Ovalball's ${pct} to continue.`}</p>
        )}
      </div>
    )
  } else if (step === "memberships") {
    const none = s.readiness.readyMemberships === 0 && s.canConfigure
    footer = (
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" className="h-11 sm:h-10" onClick={() => go("settings")}>
          Back
        </Button>
        <Button className={`h-11 px-5 sm:h-10 ${ARIA_DISABLED_LOOK}`} focusableWhenDisabled disabled={none} onClick={() => go("review")} aria-describedby={none ? "memberships-why" : undefined}>
          Continue
        </Button>
        {none && (
          <p id="memberships-why" className="text-xs text-ink-muted">
            Give a membership a monthly price and at least one team to continue.
          </p>
        )}
      </div>
    )
  } else {
    const blocked = !s.readiness.canActivate || !s.canConfigure
    footer = (
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" className="h-11 sm:h-10" onClick={() => go("memberships")}>
          Back
        </Button>
        <Button className={`h-11 px-5 sm:h-10 ${ARIA_DISABLED_LOOK}`} focusableWhenDisabled disabled={blocked} onClick={() => setConfirming(true)} aria-describedby="activate-why">
          Activate Club Memberships
        </Button>
        {/* What pressing it does, said where it is pressed -- or why it cannot be pressed yet. */}
        <p id="activate-why" className="text-xs text-ink-muted">
          {!s.canConfigure
            ? "Only someone who can set up memberships can switch them on."
            : !blocked
              ? "Members, or their parents, can set up their Direct Debit as soon as memberships are on."
              : waiting
                ? "Activate becomes available when GoCardless finishes verifying."
                : "Finish the things listed above to switch memberships on."}
        </p>
      </div>
    )
  }

  // ------------------------------------------------------------------------------------------------- activated
  if (activated) {
    return (
      <div className="mt-8 grid gap-6 lg:grid-cols-12">
        <Panel className="lg:col-span-8">
          <div className="flex flex-col items-start gap-4 py-2">
            <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-full bg-mint-100 text-forest-800">
              <CheckCircle2 className="size-7" />
            </span>
            <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold text-ink outline-none">
              {activated === "RESUMED" ? "Club Memberships Are Back On" : "Club Memberships Are On"}
            </h2>
            <p className="max-w-prose text-base text-ink-muted">{activatedSentence(pricedTeams)}</p>
            <ul className="mt-2 grid w-full gap-3 md:grid-cols-3">
              <InfoTile icon={<CalendarDays className="size-5" />} title={`Payments are taken on the ${ordinalWord(s.programme?.collectionDay ?? draft.collectionDay)} of each month`} />
              <InfoTile icon={<PoundSterling className="size-5" />} title={feeBearerSentence(s.programme?.feeBearer ?? draft.feeBearer, bps)} />
              <InfoTile icon={<RefreshCw className="size-5" />} title="Changes reach new memberships" body="You can pause new memberships at any time in Membership Settings." />
            </ul>
            <Button className="mt-2 h-11 px-5 sm:h-10" onClick={() => router.refresh()}>
              Open Membership Settings
            </Button>
          </div>
        </Panel>
      </div>
    )
  }

  return (
    <div className="mt-8">
      {/* Ticks only for what is really finished (the server's readiness), as on the phone. */}
      <StepBar current={index} completed={[true, ...setupProgress(s).map((x) => x.done)]} onOpen={(i) => (i < index ? go(STEPS[i]!.key) : undefined)} />

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-12">
        {/* ---------------------------------------------------------------------------------- the step */}
        <div className="min-w-0 space-y-6 lg:col-span-8">
          {step === "start" && (
            <Panel>
              <div className="flex flex-col gap-6 md:flex-row md:items-start">
                <span aria-hidden="true" className="flex size-16 shrink-0 items-center justify-center rounded-full bg-mint-100 text-forest-800">
                  <ShieldCheck className="size-8" />
                </span>
                <div className="min-w-0">
                  <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold text-ink outline-none">
                    Set Up Club Memberships
                  </h2>
                  <p className="mt-1 max-w-prose text-base text-ink-muted">Collect monthly membership payments by Direct Debit, and always know who is up to date.</p>
                </div>
              </div>
              <ul className="mt-6 grid gap-3 md:grid-cols-2">
                <InfoTile icon={<Wallet className="size-5" />} title="Collect membership payments with GoCardless" />
                <InfoTile icon={<ListChecks className="size-5" />} title="See who has set up, who has paid and who needs attention" />
                <InfoTile icon={<Users className="size-5" />} title="Keep memberships connected to your teams and people" />
                <InfoTile icon={<Bell className="size-5" />} title="Reduce chasing with built-in reminders" />
              </ul>

              {/* What the club will do, in order: a real sequence, so it is numbered. */}
              <div className="mt-8">
                <h3 className="text-base font-semibold text-ink">What You&rsquo;ll Set Up</h3>
                <ol className="mt-3 divide-y divide-ink/10 border-y border-ink/10">
                  {setupOverviewSteps(bps).map((x, i) => (
                    <li key={x.key} className="flex items-start gap-3 py-3">
                      <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-mint-100 text-xs font-semibold text-rugby-700 tabular-nums">
                        {i + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink">{x.title}</span>
                        <span className="mt-0.5 block max-w-prose text-sm text-ink-muted">{x.body}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Ovalball's fee before anything is asked of the club: plain words, never only in the terms. */}
              <div className="mt-6 rounded-xl bg-mint-100/60 px-4 py-3">
                <h3 className="text-base font-semibold text-forest-800">{`Ovalball's fee is ${pct}`}</h3>
                <p className="mt-0.5 max-w-prose text-sm text-forest-800">{`Ovalball takes ${pct} of each membership payment collected. You choose whether the club or its members pay it. GoCardless's own fees are separate.`}</p>
              </div>

              <p className="mt-4 rounded-xl border border-ink/10 bg-chalk px-4 py-3 text-sm text-ink">
                No money is collected until you switch memberships on and each member, or their parent, sets up their own Direct Debit.
              </p>
            </Panel>
          )}

          {step === "connect" && (
            <>
              <Panel>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold text-ink outline-none">
                    Connect GoCardless
                  </h2>
                  <ConnectionChip state={s.connection.state} />
                </div>
                <p className="mt-2 max-w-prose text-base text-ink-muted">{connectionSentence(s.connection.state)}</p>
                {connected && s.connection.environment === "sandbox" && <p className="mt-1 text-xs text-ink-muted">This is a GoCardless test account: no real money moves.</p>}
                {s.connection.state === "ACTION_REQUIRED" && s.canConnect && (
                  <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="min-w-0 flex-1 text-sm text-amber-900">GoCardless needs more information from the club before it can collect payments.</p>
                    <Button variant="outline" className="h-11 sm:h-9" nativeButton={false} render={<a href={goCardlessVerifyUrl(s.connection.environment)} target="_blank" rel="noreferrer" />}>
                      Finish Verification with GoCardless
                      <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
                    </Button>
                  </div>
                )}

                {/* CONNECTED: the club's account as facts -- never a token or an id -- and, for whoever may connect it,
                    the way to disconnect it. */}
                {connected && (
                  <div className="mt-6 border-t border-ink/10 pt-6">
                    <div className="flex items-center gap-3">
                      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-mint-100 text-forest-800">
                        <Landmark className="size-5" />
                      </span>
                      <h3 className="text-base font-semibold text-ink">The Club&rsquo;s GoCardless Account</h3>
                    </div>
                    <dl className="mt-4 divide-y divide-ink/10 border-y border-ink/10">
                      {connectionFacts(s.connection).map((fact) => (
                        <div key={fact.label} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5 py-2.5">
                          <dt className="text-sm text-ink-muted">{fact.label}</dt>
                          <dd className="text-sm font-medium text-ink">{fact.value}</dd>
                        </div>
                      ))}
                    </dl>
                    {s.canConnect && (
                      <Button variant="outline" className="mt-4 h-11 sm:h-9" onClick={() => void askDisconnect()}>
                        Disconnect GoCardless
                      </Button>
                    )}
                  </div>
                )}

                {/* NOT CONNECTED: why GoCardless, what happens to bank details and what Ovalball receives; then how the
                    money works; then what the club agrees to, with the box to tick beside the button it unlocks. */}
                {!connected && (
                  <ul className="mt-6 grid gap-3 md:grid-cols-2">
                    {GOCARDLESS_CONNECT_POINTS.map((point) => (
                      <InfoTile key={point.key} icon={CONNECT_ICON[point.key]} title={point.title} body={point.body} />
                    ))}
                  </ul>
                )}
                {!connected && (
                  <div className="mt-6 border-t border-ink/10 pt-6">
                    <h3 className="text-base font-semibold text-ink">How the Money Works</h3>
                    <p className="mt-1 max-w-prose text-sm text-ink">{membershipDisclosure(bps)}</p>
                    <p className="mt-2 text-xs text-ink-muted">{CLUB_MEMBERSHIP_TERMS_STATUS}</p>
                  </div>
                )}
                {!connected && s.canConnect && <p className="mt-4 max-w-prose text-sm text-ink-muted">After connecting, GoCardless may need to verify the club&rsquo;s account. You can carry on setting up while it does.</p>}
                {!s.canConnect && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Connecting GoCardless needs the GoCardless permission at this club. A Club Admin can connect it; you can carry on with the other steps.</p>}
              </Panel>
              <TermsPanel
                title={s.terms.accepted ? "Ovalball's Terms" : "What the Club Agrees To"}
                bps={bps}
                terms={s.terms}
                clubName={clubName}
                agreed={agreed}
                onAgreedChange={setAgreed}
                canAgree={false}
                agreeBelow={canAgree}
              />
            </>
          )}

          {step === "settings" && (
            <Panel>
              <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold text-ink outline-none">
                Collection Settings
              </h2>
              <p className="mt-1 max-w-prose text-base text-ink-muted">These apply to new memberships. Changing them later never changes a payment already set up.</p>
              {!s.canConfigure && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Only someone who can set up memberships can change these settings.</p>}

              <section className="mt-6 border-t border-ink/10 pt-6">
                <h3 className="text-base font-semibold text-ink">Collection Day</h3>
                <div className="mt-3">
                  <CollectionDaySelect labelHidden value={draft.collectionDay} disabled={!s.canConfigure} onChange={(collectionDay) => setDraft({ ...draft, collectionDay })} />
                </div>
                <p className="mt-2 max-w-prose text-sm text-ink-muted">{collectionDaySentence(draft.collectionDay)}</p>
              </section>

              <section className="mt-6 border-t border-ink/10 pt-6">
                <h3 className="text-base font-semibold text-ink">First Payment</h3>
                <p className="mt-1 max-w-prose text-sm text-ink-muted">When a player joins part-way through a month:</p>
                <div className="mt-3">
                  <ChoiceCards legend="First payment" columns={2} disabled={!s.canConfigure} value={draft.firstPaymentPolicy} onChange={(firstPaymentPolicy) => setDraft({ ...draft, firstPaymentPolicy })} options={firstPaymentPolicyOptions(draft.collectionDay)} />
                </div>
                <FirstPaymentExampleBlock heading={basis.heading} example={example} />
              </section>

              <section className="mt-6 border-t border-ink/10 pt-6">
                <h3 className="text-base font-semibold text-ink">Ovalball&rsquo;s Fee</h3>
                <p className="mt-1 max-w-prose text-sm text-ink-muted">{`Ovalball's fee is ${pct} of the membership price in each payment collected through Ovalball. Who pays it?`}</p>
                <div className="mt-3">
                  <ChoiceCards legend={`Who pays Ovalball's ${pct}`} columns={2} disabled={!s.canConfigure} value={draft.feeBearer} onChange={(feeBearer) => setDraft({ ...draft, feeBearer })} options={feeBearerOptions(bps)} />
                </div>
                {/* Below lg the rail is not drawn, so the receipt sits here under the choice it follows. The
                    sentence below says GoCardless's fees, so the receipt does not say them again. */}
                {draft.feeBearer && (
                  <div className="mt-3 max-w-sm lg:hidden">{example ? <MoneyReceipt example={example} bps={bps} currency={currency} caveat={false} /> : <ReceiptPlaceholder />}</div>
                )}
                <p className="mt-3 max-w-prose text-xs text-ink-muted">{GOCARDLESS_FEES_SENTENCE}</p>
              </section>
            </Panel>
          )}

          {step === "memberships" && (
            <Panel>
              <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold text-ink outline-none">
                Memberships
              </h2>
              <p className="mt-1 max-w-prose text-base text-ink-muted">Each team has one membership. A player in teams with different memberships pays the higher price, and the club can switch them.</p>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {s.memberships.map((m) => (
                  <MembershipCard key={m.id} membership={m} currency={currency} feeBearer={savedBearer} collection={collection} onEdit={s.canConfigure ? () => (setSheetProblem(null), setEditing(m)) : undefined} />
                ))}
                {s.canConfigure && (
                  <button
                    type="button"
                    onClick={() => (setSheetProblem(null), setEditing("new"))}
                    className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-ink/25 bg-chalk p-5 text-sm font-medium text-forest-800 hover:border-forest-800 hover:bg-white focus-visible:ring-3 focus-visible:ring-pitch-400/50 focus-visible:outline-none"
                  >
                    <span aria-hidden="true" className="text-2xl leading-none">
                      +
                    </span>
                    Add a Membership
                  </button>
                )}
              </div>
              {unassigned.length > 0 && s.memberships.length > 0 && (
                <p className="mt-4 rounded-xl border border-ink/10 bg-chalk px-4 py-3 text-sm text-ink">
                  {`${unassigned.length === 1 ? "1 team has" : `${unassigned.length} teams have`} no membership: ${teamsSentence(unassigned, 4)}. Players only in ${unassigned.length === 1 ? "that team" : "those teams"} are not asked to pay.`}
                </p>
              )}
            </Panel>
          )}

          {step === "review" && (
            <Panel>
              <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold text-ink outline-none">
                Review and Activate
              </h2>
              <p className="mt-1 max-w-prose text-base text-ink-muted">Check everything before switching memberships on. Nothing is collected until each member sets up their Direct Debit.</p>
              {/* Ready or not, first: the server's readiness in one line, and what is still to do inside it. */}
              <ActivationStatusPanel status={status}>
                {status.kind === "ACTION_REQUIRED" && <StillToDo bare missing={s.readiness.missing} connection={s.connection.state} onOpen={(item) => go(STEP_FOR[item])} />}
              </ActivationStatusPanel>
              <dl className="mt-6 divide-y divide-ink/10 rounded-xl border border-ink/10">
                <ReviewLine icon={<FileText className="size-4" />} label="Ovalball's Terms" value={s.terms.accepted ? "Agreed" : "Not agreed yet"} onOpen={() => go("connect")} />
                <ReviewLine icon={<Landmark className="size-4" />} label="GoCardless" value={<ConnectionChip state={s.connection.state} />} onOpen={() => go("connect")} />
                <ReviewLine icon={<CalendarDays className="size-4" />} label="Collection Day" value={s.programme ? `${ordinalWord(s.programme.collectionDay)} of each month` : "Not set"} onOpen={() => go("settings")} />
                <ReviewLine icon={<ReceiptPoundSterling className="size-4" />} label="First Payment" value={s.programme ? (firstPaymentPolicyOptions(s.programme.collectionDay).find((o) => o.value === s.programme!.firstPaymentPolicy)?.label ?? "") : "Not set"} onOpen={() => go("settings")} />
                <ReviewLine icon={<PoundSterling className="size-4" />} label="Ovalball's Fee" value={s.programme?.feeBearer ? (feeBearerOptions(bps).find((o) => o.value === s.programme!.feeBearer)?.label ?? "") : "Not chosen"} onOpen={() => go("settings")} />
              </dl>
              <div className="mt-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold text-ink">{s.memberships.length === 1 ? "Membership" : "Memberships"}</h3>
                  {s.canConfigure && (
                    <Button variant="ghost" className="h-11 sm:h-8" onClick={() => go("memberships")}>
                      Edit
                    </Button>
                  )}
                </div>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  {s.memberships.map((m) => (
                    <MembershipCard key={m.id} membership={m} currency={currency} feeBearer={savedBearer} collection={collection} />
                  ))}
                </div>
              </div>
              {/* Ovalball's fee, its own card: the rate, who pays it, and what that means for what members pay. */}
              <section aria-labelledby="review-fee" className="mt-6 rounded-xl border border-ink/10 p-4 md:p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 id="review-fee" className="text-base font-semibold text-ink">
                    Ovalball&rsquo;s Fee
                  </h3>
                  <p className="text-3xl font-semibold text-forest-800 tabular-nums">{pct}</p>
                </div>
                <p className="mt-1 max-w-prose text-sm text-ink">{`Ovalball takes ${pct} of each membership payment collected. ${feeBearerSentence(savedBearer, bps)} GoCardless's own fees are separate.`}</p>
                <MembersPaySummary memberships={s.memberships} bps={bps} currency={currency} />
              </section>
              {activateProblem && (
                <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive-text">
                  {activateProblem}
                </p>
              )}
            </Panel>
          )}

          {/* What the step's buttons last said, beside them. Both regions are always present, so a new notice is
              announced (politely, or at once for a problem) rather than only drawn. */}
          <div>
            <div role="status" aria-live="polite">
              {notice && notice.tone !== "danger" && <p className={`mb-4 max-w-prose rounded-xl border px-4 py-3 text-sm ${NOTICE_CLASS[notice.tone]}`}>{notice.text}</p>}
            </div>
            <div role="alert">{notice?.tone === "danger" && <p className={`mb-4 max-w-prose rounded-xl border px-4 py-3 text-sm ${NOTICE_CLASS.danger}`}>{notice.text}</p>}</div>
            <div className="flex flex-wrap items-center gap-3">{footer}</div>
          </div>
        </div>

        {/* ---------------------------------------------------------------------------------- the rail (lg and up) */}
        <aside aria-label="Your Setup" className="hidden space-y-4 lg:sticky lg:top-6 lg:col-span-4 lg:block">
          <Panel title="Your Setup">
            <ol className="space-y-2.5">
              <RailItem done={s.terms.accepted} label="Ovalball's Terms" value={s.terms.accepted ? "Agreed" : "Not agreed yet"} />
              <RailItem done={s.connection.state === "READY"} label="GoCardless" value={<ConnectionChip state={s.connection.state} />} />
              <RailItem done={!!s.programme?.feeBearer} label="Collection Settings" value={s.programme ? `${ordinalWord(s.programme.collectionDay)} of each month` : "Not saved yet"} />
              <RailItem done={s.readiness.readyMemberships > 0} label="Memberships" value={s.readiness.readyMemberships > 0 ? `${s.readiness.readyMemberships} ready` : "None ready yet"} />
            </ol>
          </Panel>
          {draft.feeBearer ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink">{`Ovalball's Fee: ${pct}`}</p>
              {example ? <MoneyReceipt example={example} bps={bps} currency={currency} /> : <ReceiptPlaceholder />}
              <p className="text-xs text-ink-muted">{feeBearerSentence(draft.feeBearer, bps)}</p>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-ink/20 px-4 py-3 text-sm text-ink-muted">{`Choose who pays Ovalball's ${pct} to see what the club receives each month.`}</p>
          )}
        </aside>
      </div>

      {/* The receipt's new figures, said once for a screen reader whichever copy of the receipt is on screen. */}
      <ReceiptAnnouncer example={draft.feeBearer ? example : null} announce={changedSinceOpening} />

      <MembershipDialog
        open={editing !== null}
        membership={editing === "new" ? null : editing}
        teams={s.teams}
        memberships={s.memberships}
        askPriceStart={false}
        saving={sheetSaving}
        problem={sheetProblem}
        onClose={() => setEditing(null)}
        onSave={(d) => void saveMembership(d)}
      />

      <DisconnectGoCardlessDialog
        clubId={s.clubId}
        open={disconnect.open}
        impact={disconnect.impact}
        onClose={() => setDisconnect((d) => ({ ...d, open: false }))}
        onDisconnected={() => {
          setDisconnect((d) => ({ ...d, open: false }))
          setNotice({ tone: "info", text: "GoCardless is disconnected. Connect it again to carry on setting up." })
          refresh()
        }}
      />

      <Dialog open={confirming} onOpenChange={(next) => !next && setConfirming(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Activate Club Memberships?</DialogTitle>
            <DialogDescription>Members, or their parents, can set up their Direct Debit as soon as memberships are on.</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm text-ink">
            {priced.map((m) => (
              <ConfirmLine
                key={m.id}
                text={`${m.name}: ${m.money ? `members pay ${formatMinorUnits(m.money.membersPayMinor, currency)}` : formatMinorUnits(m.monthlyAmountMinor ?? 0, currency)} a month, ${teamCount(m.teams.length)}.`}
              />
            ))}
            <ConfirmLine text={`Payments are taken on the ${ordinalWord(s.programme?.collectionDay ?? draft.collectionDay)} of each month.`} />
            <ConfirmLine text={feeBearerSentence(s.programme?.feeBearer ?? null, bps)} />
            <ConfirmLine text="You can pause new memberships at any time in Membership Settings." />
          </ul>
          {activateProblem && (
            <p role="alert" className="text-sm text-destructive-text">
              {activateProblem}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" className="h-11 sm:h-9" onClick={() => setConfirming(false)}>
              Not Yet
            </Button>
            <Button className="h-11 sm:h-9" disabled={activating} onClick={() => void activate()}>
              {activating ? "Activating…" : "Activate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {pending && <span className="sr-only" role="status">Updating</span>}
    </div>
  )
}

const STATUS_LOOK: Record<ActivationStatus["kind"], { box: string; icon: string; title: string }> = {
  READY: { box: "border-pitch-600/30 bg-mint-100/50", icon: "text-pitch-600", title: "text-forest-800" },
  WAITING: { box: "border-ink/10 bg-chalk", icon: "text-forest-800", title: "text-forest-800" },
  ACTION_REQUIRED: { box: "border-amber-200 bg-amber-50", icon: "text-amber-800", title: "text-amber-800" },
  NOT_ALLOWED: { box: "border-ink/10 bg-chalk", icon: "text-ink-muted", title: "text-ink" },
}

/**
 * READY OR ACTION REQUIRED -- Review's first line, in the server's own readiness (`activationStatus`): green and ticked
 * when Activate will be accepted, amber with each thing to finish when it will not, plain while only GoCardless is left
 * to act or only a Club Admin can switch memberships on.
 */
function ActivationStatusPanel({ status, children }: { status: ActivationStatus; children?: React.ReactNode }) {
  const look = STATUS_LOOK[status.kind]
  const Icon = status.kind === "READY" ? CheckCircle2 : status.kind === "ACTION_REQUIRED" ? AlertTriangle : Clock
  return (
    <div className={`mt-6 rounded-xl border p-4 ${look.box}`}>
      <div className="flex items-start gap-3">
        <Icon aria-hidden="true" className={`mt-0.5 size-5 shrink-0 ${look.icon}`} />
        <div className="min-w-0 flex-1">
          <h3 className={`text-base font-semibold ${look.title}`}>{status.title}</h3>
          <p className="mt-0.5 max-w-prose text-sm text-ink">{status.body}</p>
          {children ? <div className="mt-2">{children}</div> : null}
        </div>
      </div>
    </div>
  )
}

/**
 * What each membership means in money for a new member, under the club's chosen fee arrangement: the server's
 * figures (`money`), inside Review's Ovalball's Fee card. GoCardless's own fee is said once, after the list.
 */
function MembersPaySummary({ memberships, bps, currency }: { memberships: SetupMembership[]; bps: number; currency: string }) {
  const withMoney = memberships.flatMap((m) => (m.money ? [{ id: m.id, name: m.name, money: m.money }] : []))
  const money = (minor: number) => formatMinorUnits(minor, currency)
  return (
    <section aria-labelledby="what-members-pay" className="mt-4">
      <h4 id="what-members-pay" className="text-sm font-semibold text-ink">
        What Members Pay
      </h4>
      {withMoney.length === 0 ? (
        <p className="mt-1 max-w-prose text-sm text-ink-muted">What members pay shows here once a membership has a monthly price and you have chosen who pays Ovalball&rsquo;s fee.</p>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-ink/10 border-y border-ink/10">
            {withMoney.map((m) => (
              <li key={m.id} className="py-3">
                <p className="text-sm font-medium text-ink">{m.name}</p>
                <dl className="mt-1.5 grid gap-x-6 gap-y-1 sm:grid-cols-3">
                  <div className="flex items-baseline justify-between gap-3 sm:block">
                    <dt className="text-sm text-ink-muted">Members pay</dt>
                    <dd className="text-ink tabular-nums">
                      <span className="text-2xl font-semibold">{money(m.money.membersPayMinor)}</span>
                      <span className="ml-1 text-sm text-ink-muted">a month</span>
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 sm:block">
                    <dt className="text-sm text-ink-muted">{`Ovalball's fee (${feePercent(bps)})`}</dt>
                    <dd className="text-sm text-ink tabular-nums sm:mt-2">{money(m.money.feeMinor)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 sm:block">
                    <dt className="text-sm text-ink-muted">The club receives</dt>
                    <dd className="text-sm font-medium text-ink tabular-nums sm:mt-2">{money(m.money.clubReceivesMinor)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-muted">Before GoCardless&rsquo;s own fee.</p>
        </>
      )}
    </section>
  )
}

/**
 * `completed` is each step's real completion, so a step passed but not finished keeps its number; a passed step can
 * still be opened either way.
 */
function StepBar({ current, onOpen, completed }: { current: number; onOpen: (index: number) => void; completed?: boolean[] }) {
  return (
    <nav aria-label="Setup steps">
      <ol className="flex flex-wrap gap-x-2 gap-y-3">
        {STEPS.map((step, i) => {
          const on = i === current
          const passed = i < current
          const done = completed ? completed[i] === true && !on : passed
          const content = (
            <>
              <span aria-hidden="true" className={`flex size-7 shrink-0 items-center justify-center rounded-full border-[1.5px] text-xs font-semibold ${on || done ? "border-forest-800 bg-forest-800 text-white" : "border-ink/25 bg-white text-ink-muted"}`}>
                {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span className={`text-sm ${on ? "font-semibold text-forest-800" : "text-ink-muted"}`}>{step.label}</span>
            </>
          )
          return (
            <li key={step.key} className="flex items-center gap-2" aria-current={on ? "step" : undefined}>
              {passed ? (
                <button type="button" onClick={() => onOpen(i)} className="flex min-h-11 items-center gap-2 rounded-lg pr-1 hover:text-forest-950 focus-visible:ring-3 focus-visible:ring-pitch-400/50 focus-visible:outline-none sm:min-h-8">
                  {content}
                  <span className="sr-only">{done ? "(done, opens this step)" : "(not finished, opens this step)"}</span>
                </button>
              ) : (
                <span className="flex min-h-11 items-center gap-2 sm:min-h-8">{content}</span>
              )}
              {i < STEPS.length - 1 && <span aria-hidden="true" className={`hidden h-px w-8 md:block ${i < current ? "bg-forest-800" : "bg-ink/15"}`} />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function InfoTile({ icon, title, body }: { icon: React.ReactNode; title: string; body?: string }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-ink/10 bg-white p-4">
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-mint-100 text-forest-800">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{title}</span>
        {body && <span className="mt-0.5 block text-sm text-ink-muted">{body}</span>}
      </span>
    </li>
  )
}

function ReviewLine({ icon, label, value, onOpen }: { icon: React.ReactNode; label: string; value: React.ReactNode; onOpen: () => void }) {
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-2">
      <span aria-hidden="true" className="text-forest-800">
        {icon}
      </span>
      <dt className="text-sm font-medium text-ink">{label}</dt>
      <dd className="ml-auto flex items-center gap-2 text-right text-sm text-ink-muted">
        {value}
        <Button variant="ghost" size="sm" className="h-11 sm:h-7" onClick={onOpen} aria-label={`Change ${label}`}>
          Change
        </Button>
      </dd>
    </div>
  )
}

/** A not-done item is a short dash, never an empty circle that reads as a radio button waiting to be chosen. */
function RailItem({ done, label, value }: { done: boolean; label: string; value: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span aria-hidden="true" className={`flex size-5 shrink-0 items-center justify-center rounded-full ${done ? "bg-forest-800 text-white" : ""}`}>
        {done ? <Check className="size-3" strokeWidth={3} /> : <span className="h-0.5 w-2.5 rounded-full bg-ink/30" />}
      </span>
      <span className="min-w-0 flex-1 text-sm text-ink">
        {label}
        <span className="sr-only">{done ? ", done" : ", to do"}</span>
      </span>
      <span className="text-right text-sm text-ink-muted">{value}</span>
    </li>
  )
}

function ConfirmLine({ text }: { text: string }) {
  return (
    <li className="flex gap-2.5">
      <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-forest-800" />
      <span>{text}</span>
    </li>
  )
}
