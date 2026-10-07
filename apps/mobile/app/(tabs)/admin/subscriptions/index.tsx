import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pressable, Text, View, useWindowDimensions } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import {
  canOpenSubscriptions,
  financeErrorMessage,
  formatFinanceDate,
  isBillingPeriod,
  readActiveSubscriptionImpact,
  readConnectionStatus,
  VERIFICATION_STATUS,
  type ConnectionStatus,
} from "@ovalball/contracts/club/finance"
import {
  connectionSentence,
  feePercent,
  GOCARDLESS_FEES_SENTENCE,
  loadMembershipSetup,
  PROGRAMME_STATE_LABEL,
  setupProgress,
  type MembershipSetupState,
} from "@ovalball/contracts/membership/setup"
import { exclusionsSentence, formatMoneyMinor, loadClubMembershipBoard, reminderExclusions, type ClubMembershipBoard } from "@ovalball/contracts/membership/board"
import { NEEDS_ACTION, audiencePlayerIds, segmentCounts, sendRemindersLabel } from "@ovalball/contracts/membership/operate"
import { collectionDayLine } from "@ovalball/contracts/membership/family-charge"

import { AdminScreen } from "../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../src/admin/access"
import { useFinanceAuthority } from "../../../../src/admin/finance-authority"
import { FinancePill, Notice } from "../../../../src/admin/finance-ui"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { resumedAsk, usePendingIntent } from "../../../../src/admin/pending-intent"
import { supabase } from "../../../../src/auth/supabase"
import { Button, Card, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { ArrowRight, ArrowUpRight, Bell, Check, ChevronRight, ReceiptPoundSterling, Send, Settings, Shield, Users, Wallet } from "../../../../src/components/icons"
import { ClubCrest } from "../../../../src/components/identity"
import { useAppContexts } from "../../../../src/context/contexts"
import { connectGoCardless, disconnectGoCardless as disconnectThroughWebsite, finishGoCardlessConnect, type GoCardlessConnectResult } from "../../../../src/membership/gocardless-connect"
import { ConnectionChip, ToneChip } from "../../../../src/membership/setup-ui"
import { DetailRow, MoneySheet, StandingBar, StandingLegend, standingLegendSpoken } from "../../../../src/membership/running-ui"
import { ActionGroup, ActionRow } from "../../../../src/people/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { LARGE_TEXT_SCALE, colour, font, radius, space, type } from "../../../../src/design/tokens"

/**
 * MEMBERSHIPS -- the club's running memberships at a glance (Club Memberships Part 2; CA-M11.1 before it).
 *
 * MEMBERS PAY THE CLUB. This is the website's `/club/finance` overview on the phone, over the same server answers:
 * the club's memberships (`club_membership_board`), this month's standing for every member in one bar, the month's
 * money by the canonical definitions, the one action that clears most of what needs doing (Send Reminders, which
 * opens Reminders with the right people chosen -- it never sends from here), and the way to Members, Teams,
 * Reminders, Payments, Settings and the Ovalball Plan. What the club pays Ovalball is the Ovalball Plan screen.
 *
 * NOTHING THE OLD HUB DID IS LOST. The month's ledger -- its figures, what needs attention in it, the memberships
 * to review, Generate Obligations, Export CSV, Waive and Retry -- is Payments now; the setup journey is still the
 * way in for a club that has not switched memberships on; and the GoCardless connection is still here.
 *
 * AUTHORITY IS THE SERVER'S. `useFinanceAuthority` asks club scope for the keys the web gates on, again on every
 * focus; every control appears only where the answer is yes, and every write is judged again by the server. A
 * refusal that asks for a recent authenticator holds the intent, steps up, and re-opens the same sheet --
 * verifying never performs the change.
 *
 * GOCARDLESS IS GOCARDLESS'S OWN SIGN-IN. Connecting is OAuth on GoCardless's own pages in the system's
 * authentication browser, started and finished by the website's app routes with this person's own token
 * (src/membership/gocardless-connect.ts) -- never an embedded browser, never a code or token on the phone.
 * Disconnecting goes through the website too, so the club's token is revoked at GoCardless straight away. The app
 * re-reads the connection when it comes back into focus.
 */
export default function MembershipsOverview() {
  const router = useRouter()
  const params = useLocalSearchParams<{ intent?: string; result?: string; handoff?: string }>()
  const { clubId, refresh: refreshAccess } = useAdminCentreAccess()
  const { club } = useAppContexts()
  const { loading: authorityLoading, authority, refresh: refreshAuthority } = useFinanceAuthority(clubId)
  const [board, setBoard] = useState<ClubMembershipBoard | null>(null)
  const [connection, setConnection] = useState<ConnectionStatus>({ known: false })
  const [membershipSetup, setMembershipSetup] = useState<MembershipSetupState | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)
  const [moneyOpen, setMoneyOpen] = useState(false)
  const pending = usePendingIntent("finance:overview")
  const generation = useRef(0)

  const load = useCallback(async () => {
    if (!clubId || authorityLoading) return
    const gen = ++generation.current
    setError(null)
    setLoading(true)
    try {
      const [nextBoard, conn, memberships] = await Promise.all([
        authority.view ? loadClubMembershipBoard(supabase, clubId) : Promise.resolve(null),
        authority.gocardlessConnect ? readConnectionStatus(supabase, clubId).catch((): ConnectionStatus => ({ known: false })) : Promise.resolve<ConnectionStatus>({ known: false }),
        authority.configure || authority.gocardlessConnect || authority.view ? loadMembershipSetup(supabase, clubId).catch(() => null) : Promise.resolve(null),
      ])
      if (gen !== generation.current) return
      setBoard(nextBoard)
      setConnection(conn)
      setMembershipSetup(memberships)
    } catch (cause) {
      const translated = friendly(cause, "the club's memberships")
      logDetail("admin:subscriptions", translated)
      if (gen === generation.current) setError(translated)
    } finally {
      if (gen === generation.current) setLoading(false)
    }
  }, [clubId, authorityLoading, authority.view, authority.gocardlessConnect, authority.configure])

  useFocusEffect(
    useCallback(() => {
      void load()
      const resume = pending.take()
      if (resume) setAsk(resumedAsk(resume))
    }, [load, pending])
  )

  function connectedNotice(result: GoCardlessConnectResult): { tone: "ok" | "error"; text: string } {
    if (result.outcome === "connected") return { tone: "ok", text: result.verification === "successful" ? "GoCardless is connected and verified." : "GoCardless is connected. GoCardless will verify the club's account." }
    return { tone: "error", text: result.message }
  }

  async function connect() {
    if (!clubId) return
    // Ovalball's terms come first: a club that has not agreed to them connects inside the setup journey.
    if (membershipSetup && !membershipSetup.terms.accepted) {
      router.push({ pathname: "/admin/subscriptions/setup", params: { step: "connect" } } as never)
      return
    }
    setConnecting(true)
    setNotice(null)
    try {
      const result = await connectGoCardless({ supabase, clubId })
      setNotice(connectedNotice(result))
      await load()
    } finally {
      setConnecting(false)
    }
  }

  // ON ANDROID a return can arrive here as a link carrying the connection it belongs to (the helper's default
  // return path is this screen); the helper never finishes one twice.
  const finishedIntent = useRef<string | null>(null)
  useEffect(() => {
    const intentId = typeof params.intent === "string" && params.intent ? params.intent : null
    if (!intentId || finishedIntent.current === intentId) return
    finishedIntent.current = intentId
    void (async () => {
      setConnecting(true)
      try {
        setNotice(connectedNotice(await finishGoCardlessConnect({ supabase, intentId, handoff: typeof params.handoff === "string" ? params.handoff : null })))
        await load()
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
    const figures = impact ? ` Right now: ${impact.activeGoCardlessSubscriptions} live Direct Debit ${impact.activeGoCardlessSubscriptions === 1 ? "subscription" : "subscriptions"}, ${impact.activePayers} active ${impact.activePayers === 1 ? "payer" : "payers"}, ${impact.pendingObligations} pending ${impact.pendingObligations === 1 ? "obligation" : "obligations"}.` : ""
    setAsk({
      title: "Disconnect GoCardless?",
      body: `Ovalball stops using the club's GoCardless account straight away, and no new memberships or collections can be set up until it is connected again. Payment history stays. GoCardless may still collect payments it has already scheduled; cancel those in GoCardless if they should stop.${figures}`,
      confirmLabel: "Confirm Disconnect",
      destructive: true,
      reason: "required",
      onConfirm: async (reason) => {
        const result = await disconnectThroughWebsite({ supabase, clubId, reason })
        // Thrown in the shape the sheet reads, so a recent-authenticator refusal goes to step-up like any other.
        if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code })
        setNotice({ tone: "ok", text: "GoCardless disconnected." })
        await load()
      },
    })
  }

  // Not switched on yet (or never read): the way in is the setup journey, not the settings it will lead to.
  const settingUp = !membershipSetup || membershipSetup.state === "NOT_STARTED" || membershipSetup.state === "SETTING_UP"
  const programme = board?.programme ?? null
  const running = !!programme && (membershipSetup ? !settingUp : programme.enabled || programme.activatedAt !== null)
  const verification = connection.known && connection.connected ? (VERIFICATION_STATUS[connection.verificationStatus ?? "unknown"] ?? VERIFICATION_STATUS.unknown) : null
  // Send Reminders opens Reminders with these people chosen; it is offered only when somebody can be asked now.
  const remindable = useMemo(() => (board && authority.enrolmentManage ? audiencePlayerIds(board.rows, { kind: "needs_action" }).length : 0), [board, authority.enrolmentManage])
  const notIncluded = useMemo(() => (board ? exclusionsSentence(reminderExclusions(board.rows.filter((r) => NEEDS_ACTION.has(r.standing)))) : null), [board])
  const go = (pathname: string, routeParams?: Record<string, string>) => router.push((routeParams ? { pathname, params: routeParams } : pathname) as never)

  return (
    <AdminScreen section="Subscriptions & Payments" onRefresh={() => void Promise.all([refreshAuthority(), load()])} refreshing={false}>
      <Notice notice={notice} />

      {(authorityLoading || (loading && !board && !membershipSetup && !error)) && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={3} />
          <CardSkeleton lines={4} />
        </View>
      )}

      {!authorityLoading && !canOpenSubscriptions(authority) && <EmptyState title="Not for you at this club" body="Club memberships need a finance permission at this club. If that has changed, pull to refresh." />}

      {!authorityLoading && canOpenSubscriptions(authority) && (
        <>
          {error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}

          {settingUp && membershipSetup && (
            <SetupHome
              setup={membershipSetup}
              clubName={club.clubId === clubId ? club.name : null}
              crestUrl={club.clubId === clubId ? club.crestUrl : null}
              onOpen={(step) => router.push((step ? { pathname: "/admin/subscriptions/setup", params: { step } } : "/admin/subscriptions/setup") as never)}
            />
          )}

          {running && board && programme && (
            <>
              <ClubMembershipsCard board={board} />
              <MonthHero board={board} onOpenMoney={() => setMoneyOpen(true)} onOpenSegment={(segment) => go("/admin/subscriptions/members", segment === "all" ? undefined : { segment })} />
              {remindable > 0 && (
                <View style={{ gap: space.sm }}>
                  <Button
                    variant="brand"
                    label={sendRemindersLabel(remindable)}
                    icon={<Send size={18} color={colour.onForest} />}
                    accessibilityHint="Opens Reminders with everybody who needs action chosen. You see the message before anything is sent."
                    onPress={() => go("/admin/subscriptions/reminders", { audience: "needs_action" })}
                  />
                  {notIncluded && <Text style={[type.caption, { color: colour.inkMuted }]}>{notIncluded}</Text>}
                </View>
              )}
            </>
          )}

          <ActionGroup>
            {authority.view && running && <ActionRow first icon={<Users size={20} color={colour.forest800} />} title="Members" caption="See who's up to date and who needs action." onPress={() => go("/admin/subscriptions/members")} />}
            {authority.view && running && <ActionRow icon={<Shield size={20} color={colour.forest800} />} title="Teams" caption="Each team's memberships at a glance." onPress={() => go("/admin/subscriptions/teams")} />}
            {authority.view && running && <ActionRow icon={<Bell size={20} color={colour.forest800} />} title="Reminders" caption={authority.enrolmentManage ? "Remind payers, and see who was reminded." : "See who was reminded, and when."} onPress={() => go("/admin/subscriptions/reminders")} />}
            {authority.view && (
              <ActionRow
                first={!running}
                icon={<ReceiptPoundSterling size={20} color={colour.forest800} />}
                title="Payments"
                caption={authority.enrolmentManage || authority.export ? "Each month's payments: waive, export and generate." : "Each month's payments, from the club's own ledger."}
                onPress={() => go("/admin/subscriptions/payments")}
              />
            )}
            {(authority.configure || authority.view) && !(settingUp && membershipSetup) && (
              <ActionRow
                first={!authority.view}
                icon={<Settings size={20} color={colour.forest800} />}
                title={settingUp ? "Set Up Club Memberships" : "Settings"}
                caption={settingUp ? "Connect GoCardless, choose the settings and add memberships." : "GoCardless, collection, prices and sibling discounts."}
                onPress={() => go(settingUp ? "/admin/subscriptions/setup" : "/admin/subscriptions/settings")}
              />
            )}
            {authority.platformBillingView && <ActionRow first={!authority.view && !authority.configure} icon={<Wallet size={20} color={colour.forest800} />} title="Ovalball Plan" caption="What the club pays Ovalball." onPress={() => go("/admin/subscriptions/ovalball-billing")} />}
          </ActionGroup>

          {/* GOCARDLESS: rare, so it stays below the work -- the same words as setup and Membership Settings. While a
              club is setting up, its connection is the journey's Connect step (with its own manage and disconnect),
              so it is not offered a second time here. */}
          {!(settingUp && membershipSetup) && (
          <Card style={{ gap: space.md }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
                GoCardless
              </Text>
              {membershipSetup ? <ConnectionChip state={membershipSetup.connection.state} /> : connection.known ? <FinancePill label={connection.connected ? "Connected" : "Disconnected"} tone={connection.connected ? "positive" : "neutral"} /> : <FinancePill label="Status not shown" tone="neutral" />}
            </View>
            {/* THE SAME ANSWER AND WORDS AS SETUP AND MEMBERSHIP SETTINGS (membership_setup_state): "Being verified", not a
                second vocabulary for the same GoCardless state. The older status read stays only as the fallback. */}
            {membershipSetup && <Text style={[type.small, { color: colour.ink }]}>{connectionSentence(membershipSetup.connection.state)}</Text>}
            {!membershipSetup && !connection.known && <Text style={[type.small, { color: colour.inkMuted }]}>Seeing the connection needs the GoCardless permission at this club.</Text>}
            {!membershipSetup && connection.known && connection.connected && (
              <View style={{ gap: space.sm }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                  <Text style={[type.small, { color: colour.inkMuted }]}>Verification</Text>
                  {verification && <FinancePill label={verification.label} tone={verification.tone} />}
                </View>
                <Text style={[type.small, { color: colour.inkMuted }]}>Connected {formatFinanceDate(connection.connectedAt)}</Text>
                {verification?.explanation && <Text style={[type.caption, { color: colour.inkMuted }]}>{verification.explanation}</Text>}
              </View>
            )}
            <Text style={[type.caption, { color: colour.inkMuted }]}>{"The club's bank details are held by GoCardless, never by Ovalball."}</Text>
            {authority.gocardlessConnect && connection.known && !connection.connected && (
              <Button variant="brand" label="Connect GoCardless" busy={connecting} onPress={() => void connect()} trailing={<ArrowUpRight size={18} color={colour.onForest} />} accessibilityHint="Opens GoCardless in a secure browser window. You come back here when it is done." />
            )}
            {authority.gocardlessConnect && connection.known && !connection.connected && <Text style={[type.caption, { color: colour.inkSubtle }]}>{"GoCardless's own sign-in opens in a secure browser window. Nothing is typed into the app."}</Text>}
            {authority.gocardlessConnect && connection.known && connection.connected && <Button label="Disconnect GoCardless" variant="quiet" onPress={() => void disconnect()} />}
          </Card>
          )}
        </>
      )}

      {board && (
        <MoneySheet
          visible={moneyOpen}
          money={board.money}
          feePercentLabel={membershipSetup ? feePercent(membershipSetup.feeBps) : null}
          onClose={() => setMoneyOpen(false)}
          onOpenPayments={() => {
            setMoneyOpen(false)
            go("/admin/subscriptions/payments", isBillingPeriod(board.money.period) ? { month: board.money.period } : undefined)
          }}
        />
      )}

      <ReasonSheet
        ask={ask}
        onClose={() => setAsk(null)}
        onRefused={() => void Promise.all([refreshAccess(), refreshAuthority()])}
        onStepUp={(reason) => {
          if (ask) pending.hold(ask, reason)
          setAsk(null)
          router.push({ pathname: "/step-up", params: { returnTo: "/admin/subscriptions" } } as never)
        }}
        errorMessage={(cause) => financeErrorMessage(cause, friendly(cause, "this change").message)}
      />
    </AdminScreen>
  )
}

/**
 * NOT SWITCHED ON YET -- the way in, said once: what Club Memberships does, the four things the club sets up with
 * where each one stands (the server's own readiness, never this screen's guess), Ovalball's fee in plain words, and
 * one button that carries on from wherever the club is. Each step opens that step of the journey.
 */
function SetupHome({ setup, clubName, crestUrl, onOpen }: { setup: MembershipSetupState; clubName: string | null; crestUrl: string | null; onOpen: (step: string | null) => void }) {
  const steps = setupProgress(setup)
  const next = steps.findIndex((x) => !x.done)
  const pct = feePercent(setup.feeBps)
  const started = setup.state !== "NOT_STARTED" || steps.some((x) => x.done)
  const cta = !started ? "Get Started" : setup.readiness.canActivate ? "Review and Activate" : "Continue Setting Up"
  // AT LARGE TEXT SIZES the crest goes above the name: beside it, "Memberships" broke in the middle of the word.
  const { fontScale } = useWindowDimensions()
  const stacked = fontScale > LARGE_TEXT_SCALE
  return (
    <Card style={{ gap: space.md }}>
      {/* The club's own crest beside the name, never tinted or swapped: this is the club's money. */}
      <View style={{ flexDirection: stacked ? "column" : "row", alignItems: stacked ? "flex-start" : "center", gap: space.md }}>
        <ClubCrest clubName={clubName} url={crestUrl} size={48} />
        {/* Headings grow to twice their size and no further: past that, "Memberships" is wider than the card and
            breaks in the middle of the word. Body text keeps the reader's full size. */}
        <Text accessibilityRole="header" maxFontSizeMultiplier={2} style={[type.title, { color: colour.ink, flex: stacked ? undefined : 1, lineHeight: undefined }]}>
          Club Memberships
        </Text>
      </View>
      <Text style={[type.body, { color: colour.inkMuted }]}>Collect membership payments by Direct Debit, and always know who is up to date.</Text>

      <View>
        {steps.map((x, i) => (
          <Pressable
            key={x.key}
            accessibilityRole="button"
            accessibilityLabel={`Step ${i + 1} of ${steps.length}, ${x.title}: ${x.detail}.${x.done ? " Done." : i === next ? " Next." : ""}`}
            accessibilityHint={`Opens the ${x.title} step`}
            onPress={() => onOpen(x.key)}
            style={({ pressed }) => ({ minHeight: 60, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm + 2, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line, opacity: pressed ? 0.7 : 1 })}
          >
            <StepMark index={i} done={x.done} next={i === next} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text maxFontSizeMultiplier={2} style={[type.bodyMedium, { color: colour.ink, lineHeight: undefined }]}>
                {x.title}
              </Text>
              <Text style={[type.small, { color: x.done ? colour.rugby700 : colour.inkMuted }]}>{x.detail}</Text>
            </View>
            <ChevronRight size={18} color={colour.inkSubtle} />
          </Pressable>
        ))}
      </View>

      <Button variant="brand" label={cta} onPress={() => onOpen(null)} trailing={<ArrowRight size={18} color={colour.onForest} />} />

      {/* OVALBALL'S FEE, on the way in: plain words, never only in the terms. */}
      <View accessible style={{ borderRadius: radius.md, backgroundColor: colour.mint100, padding: space.md, gap: 2 }}>
        <Text style={[type.smallMedium, { color: colour.forest800 }]}>{`Ovalball's fee: ${pct} of each membership payment`}</Text>
        <Text style={[type.small, { color: colour.forest800 }]}>{"You choose whether the club or its members pay it. GoCardless's own fees are separate."}</Text>
      </View>
    </Card>
  )
}

/** A step's mark: a tick when it is done, its number filled when it is next, and outlined when it is still to come. */
function StepMark({ index, done, next }: { index: number; done: boolean; next: boolean }) {
  if (done) {
    return (
      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
        <Check size={18} color={colour.rugby700} strokeWidth={2.6} />
      </View>
    )
  }
  return (
    <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: next ? colour.rugby700 : "transparent", borderWidth: next ? 0 : 1.5, borderColor: colour.lineStrong, alignItems: "center", justifyContent: "center" }}>
      <Text allowFontScaling={false} style={[type.smallMedium, { color: next ? colour.onForest : colour.inkMuted }]}>
        {index + 1}
      </Text>
    </View>
  )
}

/** The club's memberships: each one's monthly price and teams, whether new ones are being taken, and the terms. */
function ClubMembershipsCard({ board }: { board: ClubMembershipBoard }) {
  const programme = board.programme!
  const state = programme.enabled ? "ACTIVE" : "PAUSED"
  const fee = programme.feeBearer === "CLUB" ? "The club pays Ovalball's fee" : programme.feeBearer === "PAYER" ? "Members pay Ovalball's fee" : null
  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
          Club Memberships
        </Text>
        {/* Paused wears the amber it wears in Settings, on the app and on the website: one state, one look. */}
        <ToneChip label={PROGRAMME_STATE_LABEL[state]} tone={programme.enabled ? "settled" : "attention"} accessibilityLabel={`Club memberships: ${PROGRAMME_STATE_LABEL[state]}`} />
      </View>
      {board.memberships.length === 0 ? (
        <Text style={[type.small, { color: colour.inkMuted }]}>No memberships yet.</Text>
      ) : (
        <View>
          {board.memberships.map((m, i) => (
            <DetailRow
              key={m.id}
              first={i === 0}
              label={m.name}
              value={[m.priceMinor !== null ? `${formatMoneyMinor(m.priceMinor, programme.currency)} a month` : "No price yet", m.teams === 0 ? "No teams" : `${m.teams} ${m.teams === 1 ? "team" : "teams"}`].join(" · ")}
            />
          ))}
        </View>
      )}
      <Text style={[type.caption, { color: colour.inkMuted }]}>{[collectionDayLine(programme.collectionDay), fee].filter(Boolean).join(" · ")}</Text>
      {!programme.enabled && <Text style={[type.caption, { color: colour.inkMuted }]}>Nobody can start a new membership while new memberships are paused. Members already paying carry on.</Text>}
    </Card>
  )
}

/** "October", from the month the board's money is for (or the day it was read). */
function monthName(board: ClubMembershipBoard): string {
  const iso = board.money.period || board.asOf
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? "This Month" : d.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" })
}

/**
 * THE MONTH, AT A GLANCE: how many need action (the one Bebas figure on these screens), the standing bar, the same in
 * words, and three of the month's money lines. The money opens the whole month in a sheet.
 */
function MonthHero({ board, onOpenMoney, onOpenSegment }: { board: ClubMembershipBoard; onOpenMoney: () => void; onOpenSegment: (segment: "all" | "up_to_date" | "needs_action") => void }) {
  const { fontScale } = useWindowDimensions()
  const stacked = fontScale > LARGE_TEXT_SCALE
  const counts = segmentCounts(board.rows)
  const total = board.counts.total
  const members = `${total} ${total === 1 ? "member" : "members"}`
  const money = (minor: number) => formatMoneyMinor(minor, board.money.currency)
  const figures = [
    { label: "Expected", value: money(board.money.expectedMinor) },
    { label: "Collected", value: money(board.money.collectedMinor) },
    { label: "With the bank", value: money(board.money.collectingMinor) },
  ]
  // THE THREE FIGURES THE APPROVED DESIGN LEADS WITH, from the one standing: exactly the Members screen's segments,
  // so a figure here and the list it opens can never disagree. Each is the way into that list.
  const stats: { key: "all" | "up_to_date" | "needs_action"; value: number; label: string; tone: string }[] = [
    { key: "all", value: counts.all, label: counts.all === 1 ? "Member" : "Members", tone: colour.ink },
    { key: "up_to_date", value: counts.up_to_date, label: "Up to date", tone: colour.rugby700 },
    { key: "needs_action", value: counts.needs_action, label: counts.needs_action === 1 ? "Needs action" : "Need action", tone: counts.needs_action > 0 ? colour.warning : colour.ink },
  ]
  return (
    <Card style={{ gap: space.md }}>
      <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
        {monthName(board)}
      </Text>
      <View style={{ flexDirection: stacked ? "column" : "row", gap: stacked ? 0 : space.sm }}>
        {stats.map((x, i) => (
          <Pressable
            key={x.key}
            accessibilityRole="button"
            accessibilityLabel={`${x.value} ${x.label.toLowerCase()}`}
            accessibilityHint={x.key === "all" ? "Opens Members" : `Opens Members showing who is ${x.key === "up_to_date" ? "up to date" : "needing action"}`}
            onPress={() => onOpenSegment(x.key)}
            style={({ pressed }) => ({
              flex: stacked ? undefined : 1,
              minHeight: 64,
              flexDirection: stacked ? "row" : "column",
              alignItems: stacked ? "baseline" : "flex-start",
              gap: stacked ? space.sm : 0,
              paddingVertical: space.xs,
              borderTopWidth: stacked && i > 0 ? 1 : 0,
              borderTopColor: colour.line,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ fontFamily: font.display, fontSize: 40, lineHeight: 44, letterSpacing: 0.5, color: x.tone, fontVariant: ["tabular-nums"] }}>{x.value}</Text>
            <Text style={[type.small, { color: colour.inkMuted }]}>{x.label}</Text>
          </Pressable>
        ))}
      </View>
      <View accessible accessibilityLabel={`${members}: ${standingLegendSpoken(board.counts)}.`} style={{ gap: space.sm }}>
        <StandingBar counts={board.counts} />
        <StandingLegend counts={board.counts} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`This month's money: ${figures.map((f) => `${f.label.toLowerCase()} ${f.value}`).join(", ")}`}
        accessibilityHint="Shows every figure for the month, and what each one means"
        onPress={onOpenMoney}
        style={({ pressed }) => ({ flexDirection: stacked ? "column" : "row", alignItems: stacked ? "stretch" : "center", gap: stacked ? space.xs : space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colour.line, opacity: pressed ? 0.7 : 1 })}
      >
        {figures.map((f) =>
          stacked ? (
            <View key={f.label} style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
              <Text style={[type.small, { color: colour.inkMuted }]}>{f.label}</Text>
              <Text style={[type.bodyMedium, { color: colour.ink, fontVariant: ["tabular-nums"] }]}>{f.value}</Text>
            </View>
          ) : (
            <View key={f.label} style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
                {f.label}
              </Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[type.heading, { color: colour.ink, fontVariant: ["tabular-nums"] }]}>
                {f.value}
              </Text>
            </View>
          )
        )}
        {stacked ? <Text style={[type.smallMedium, { color: colour.forest800 }]}>See All of This Month's Money</Text> : <ChevronRight size={18} color={colour.inkSubtle} />}
      </Pressable>
    </Card>
  )
}
