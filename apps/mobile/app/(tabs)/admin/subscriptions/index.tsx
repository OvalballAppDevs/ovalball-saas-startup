import { useCallback, useEffect, useRef, useState } from "react"
import { Linking, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import {
  canOpenSubscriptions,
  currentBillingPeriod,
  disconnectGoCardless,
  FINANCE_WEB_PATHS,
  financeErrorMessage,
  financeExportFileName,
  financeRowsToCsv,
  formatFinanceDate,
  formatMinorUnits,
  generateObligations,
  loadFinanceDashboard,
  readActiveSubscriptionImpact,
  readConnectionStatus,
  readFinanceExportRows,
  REVIEW_REASON_LABEL,
  VERIFICATION_STATUS,
  type ConnectionStatus,
  type FinanceDashboard,
} from "@ovalball/contracts/club/finance"

import { AdminScreen } from "../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../src/admin/access"
import { useFinanceAuthority } from "../../../../src/admin/finance-authority"
import { shareFinanceCsv } from "../../../../src/admin/finance-export"
import { FinancePill, MetricTile, MonthSelector, NavRow, Notice } from "../../../../src/admin/finance-ui"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { resumedAsk, usePendingIntent } from "../../../../src/admin/pending-intent"
import { supabase } from "../../../../src/auth/supabase"
import { webUrl } from "../../../../src/config/environment"
import { Button, Card, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * SUBSCRIPTIONS & PAYMENTS -- the club's money, natively (CA-M11.1).
 *
 * MEMBERS PAY THE CLUB. This is the website's `/club/settings/subscriptions` and `/club/finance` on the
 * phone, over the same rows and the same operations: the club's own GoCardless connection, this period's
 * ledger (`membership_obligations`), what needs attention, the memberships the relationship engine says to
 * review, obligation generation and the export. What the club pays Ovalball is the Ovalball Plan screen.
 *
 * AUTHORITY IS THE SERVER'S. `useFinanceAuthority` asks club scope for the keys the web gates on; every
 * control appears only where the answer is yes, and every write is judged again by the RPC. A refusal that
 * asks for a recent authenticator holds the intent, steps up, and re-opens the same sheet -- verifying
 * never performs the change.
 *
 * GOCARDLESS IS A HAND-OFF. Connecting the merchant is OAuth on GoCardless's own pages, started by the
 * website's `/api/gocardless/oauth/start` route in the system browser -- never a WebView, never a token on
 * the phone. The app re-reads the connection when it comes back into focus.
 */
export default function SubscriptionsOverview() {
  const router = useRouter()
  const { clubId, refresh: refreshAccess } = useAdminCentreAccess()
  const { loading: authorityLoading, authority, refresh: refreshAuthority } = useFinanceAuthority(clubId)
  const [period, setPeriod] = useState(currentBillingPeriod())
  const [dashboard, setDashboard] = useState<FinanceDashboard | null>(null)
  const [connection, setConnection] = useState<ConnectionStatus>({ known: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)
  const pending = usePendingIntent("finance:overview")
  const generation = useRef(0)

  const load = useCallback(async () => {
    if (!clubId || authorityLoading) return
    const gen = ++generation.current
    setError(null)
    setLoading(true)
    try {
      const [board, conn] = await Promise.all([
        authority.view ? loadFinanceDashboard(supabase, clubId, period) : Promise.resolve(null),
        authority.gocardlessConnect ? readConnectionStatus(supabase, clubId) : Promise.resolve<ConnectionStatus>({ known: false }),
      ])
      if (gen !== generation.current) return
      setDashboard(board)
      setConnection(conn)
    } catch (cause) {
      const translated = friendly(cause, "the club's finances")
      logDetail("admin:subscriptions", translated)
      if (gen === generation.current) setError(translated)
    } finally {
      if (gen === generation.current) setLoading(false)
    }
  }, [clubId, authorityLoading, authority.view, authority.gocardlessConnect, period])

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

  function connect() {
    if (!clubId || !webUrl) return
    void Linking.openURL(`${webUrl}${FINANCE_WEB_PATHS.gocardlessConnect(clubId)}`)
  }

  async function disconnect() {
    if (!clubId) return
    const impact = await readActiveSubscriptionImpact(supabase, clubId).catch(() => null)
    const figures = impact ? ` Right now: ${impact.activeGoCardlessSubscriptions} live Direct Debit ${impact.activeGoCardlessSubscriptions === 1 ? "subscription" : "subscriptions"}, ${impact.activePayers} active ${impact.activePayers === 1 ? "payer" : "payers"}, ${impact.pendingObligations} pending ${impact.pendingObligations === 1 ? "obligation" : "obligations"}.` : ""
    setAsk({
      title: "Disconnect GoCardless?",
      body: `Existing subscriptions and payment history are preserved, but no new collections can be scheduled until reconnected. This does not cancel live GoCardless subscriptions on GoCardless's side -- do that first if required.${figures}`,
      confirmLabel: "Confirm Disconnect",
      destructive: true,
      reason: "required",
      onConfirm: async (reason) => {
        await disconnectGoCardless(supabase, clubId, reason)
        setNotice({ tone: "ok", text: "GoCardless disconnected." })
        await load()
      },
    })
  }

  function generate() {
    if (!clubId) return
    setAsk({
      title: "Generate this month's obligations?",
      body: "Creates what each enrolled member owes for the selected period. Repeating it for the same period creates nothing new.",
      confirmLabel: "Generate Obligations",
      reason: "none",
      onConfirm: async () => {
        await generateObligations(supabase, clubId, period)
        setNotice({ tone: "ok", text: "Obligations generated for this period." })
        await load()
      },
    })
  }

  function exportCsv() {
    if (!clubId) return
    setAsk({
      title: "Export this period as CSV?",
      body: "Player, payer, amounts and statuses for the selected period. No bank details, ever. The export is recorded in the club's finance audit.",
      confirmLabel: "Export CSV",
      reason: "none",
      onConfirm: async () => {
        const rows = await readFinanceExportRows(supabase, clubId, period)
        const shared = await shareFinanceCsv(financeRowsToCsv(rows), financeExportFileName(period))
        setNotice(shared.ok ? { tone: "ok", text: `Export shared (${rows.length} ${rows.length === 1 ? "row" : "rows"}).` } : { tone: "error", text: shared.message })
      },
    })
  }

  const verification = connection.known && connection.connected ? (VERIFICATION_STATUS[connection.verificationStatus ?? "unknown"] ?? VERIFICATION_STATUS.unknown) : null
  const metrics = dashboard?.metrics ?? null
  const attention = dashboard?.attention ?? null
  const nothingNeedsAttention = attention !== null && attention.failed === 0 && attention.overdue === 0 && attention.notSetUp === 0

  return (
    <AdminScreen section="Subscriptions & Payments" onRefresh={() => void Promise.all([refreshAuthority(), load()])} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Subscriptions & Payments
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>Members pay the club. Monthly membership subscriptions collected through the club's own GoCardless Direct Debit. What the club pays Ovalball is under Ovalball Plan.</Text>
      </View>

      <Notice notice={notice} />

      {(authorityLoading || (loading && !dashboard)) && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={3} />
        </View>
      )}

      {!authorityLoading && !canOpenSubscriptions(authority) && <EmptyState title="Not for you at this club" body="Subscriptions and payments need a finance permission at this club. If that has changed, pull to refresh." />}

      {!authorityLoading && canOpenSubscriptions(authority) && (
        <>
          <Card style={{ gap: space.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
                GoCardless
              </Text>
              {connection.known ? <FinancePill label={connection.connected ? "Connected" : "Disconnected"} tone={connection.connected ? "positive" : "neutral"} /> : <FinancePill label="Status Not Shown" tone="neutral" />}
            </View>
            {!connection.known && <Text style={[type.small, { color: colour.inkMuted }]}>Seeing the connection needs the GoCardless permission at this club.</Text>}
            {connection.known && connection.connected && (
              <View style={{ gap: space.sm }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                  <Text style={[type.small, { color: colour.inkMuted }]}>Verification</Text>
                  {verification && <FinancePill label={verification.label} tone={verification.tone} />}
                </View>
                <Text style={[type.small, { color: colour.inkMuted }]}>Connected {formatFinanceDate(connection.connectedAt)}</Text>
                {verification?.explanation && <Text style={[type.caption, { color: colour.inkMuted }]}>{verification.explanation}</Text>}
              </View>
            )}
            <Text style={[type.caption, { color: colour.inkMuted }]}>Your club's bank details are held by GoCardless, never by Ovalball. Ovalball only sees connection and verification status.</Text>
            {authority.gocardlessConnect && connection.known && !connection.connected && <Button label="Connect GoCardless" onPress={connect} accessibilityHint="Opens the Ovalball website, then GoCardless, in your browser" />}
            {authority.gocardlessConnect && connection.known && !connection.connected && <Text style={[type.caption, { color: colour.inkSubtle }]}>Opens the Ovalball website, then GoCardless's own sign-in. Nothing is typed into the app.</Text>}
            {authority.gocardlessConnect && connection.known && connection.connected && <Button label="Disconnect" variant="secondary" onPress={() => void disconnect()} />}
          </Card>

          {authority.view && (
            <View style={{ gap: space.md }}>
              <MonthSelector period={period} onChange={setPeriod} />
              {error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}
              {metrics && (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                  <MetricTile label="Expected revenue" value={formatMinorUnits(metrics.expectedRevenueMinor)} />
                  <MetricTile label="Collected this month" value={formatMinorUnits(metrics.collectedMinor)} tone="positive" />
                  <MetricTile label="Outstanding" value={formatMinorUnits(metrics.outstandingMinor)} tone={metrics.outstandingMinor > 0 ? "caution" : undefined} />
                  <MetricTile label="Payment success rate" value={metrics.successRatePercent !== null ? `${metrics.successRatePercent}%` : "—"} />
                  <MetricTile label="Active Direct Debits" value={String(metrics.activeDirectDebits)} />
                  <MetricTile label="Exempt / waived" value={formatMinorUnits(metrics.exemptWaivedMinor)} />
                </View>
              )}

              {attention && (
                <Card style={{ gap: space.sm }} onPress={nothingNeedsAttention ? undefined : () => router.push({ pathname: "/admin/subscriptions/members", params: { filter: "attention" } } as never)} accessibilityLabel="Needs attention this month">
                  <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
                    Needs Attention
                  </Text>
                  {nothingNeedsAttention ? (
                    <Text style={[type.small, { color: colour.inkMuted }]}>Nothing needs attention this month.</Text>
                  ) : (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                      {attention.failed > 0 && <FinancePill label={`${attention.failed} Failed`} tone="danger" />}
                      {attention.overdue > 0 && <FinancePill label={`${attention.overdue} Overdue`} tone="danger" />}
                      {attention.notSetUp > 0 && <FinancePill label={`${attention.notSetUp} Not Set Up`} tone="caution" />}
                    </View>
                  )}
                </Card>
              )}

              {dashboard && dashboard.review.length > 0 && (
                <Card style={{ padding: 0, overflow: "hidden", borderColor: colour.warning }}>
                  <View style={{ padding: space.lg, paddingBottom: space.sm }}>
                    <Text accessibilityRole="header" style={[type.heading, { color: colour.warning }]}>
                      Memberships Needing Review
                    </Text>
                  </View>
                  {dashboard.review.map((item, i) => (
                    <NavRow key={`${item.payerSubscriptionId}-${item.reason}`} first={i === 0} label={item.playerName} caption={REVIEW_REASON_LABEL[item.reason] ?? item.reason} onPress={() => router.push(`/admin/subscriptions/membership/${item.payerSubscriptionId}` as never)} />
                  ))}
                </Card>
              )}

              {(authority.enrolmentManage || authority.export) && (
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  {authority.enrolmentManage && <Button label="Generate Obligations" variant="secondary" onPress={generate} style={{ flex: 1 }} />}
                  {authority.export && <Button label="Export CSV" variant="secondary" onPress={exportCsv} style={{ flex: 1 }} />}
                </View>
              )}
            </View>
          )}

          <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
            {authority.view && <NavRow first label="Members" caption={dashboard ? `${dashboard.rows.length} ${dashboard.rows.length === 1 ? "obligation" : "obligations"} this period` : "Who owes what this period"} onPress={() => router.push("/admin/subscriptions/members" as never)} />}
            {(authority.configure || authority.view) && <NavRow first={!authority.view} label="Programme & Pricing" caption="Collection day, first payment, price and sibling discounts" onPress={() => router.push("/admin/subscriptions/plans" as never)} />}
            {authority.platformBillingView && <NavRow first={!authority.view && !authority.configure} label="Ovalball Plan" caption="What the club pays Ovalball" onPress={() => router.push("/admin/subscriptions/ovalball-billing" as never)} />}
          </View>
        </>
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
