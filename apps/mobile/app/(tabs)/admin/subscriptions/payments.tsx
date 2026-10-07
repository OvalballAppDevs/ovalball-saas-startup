import { useCallback, useMemo, useRef, useState } from "react"
import { Linking, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import {
  canRetryPayment,
  canWaiveObligation,
  currentBillingPeriod,
  FINANCE_WEB_PATHS,
  filterObligationRows,
  financeErrorMessage,
  financeExportFileName,
  financeRowsToCsv,
  formatMinorUnits,
  generateObligations,
  isBillingPeriod,
  loadFinanceDashboard,
  MEMBER_FILTERS,
  readFinanceExportRows,
  REVIEW_REASON_LABEL,
  setObligationExemption,
  type FinanceDashboard,
  type FinanceObligationRow,
  type MemberFilter,
} from "@ovalball/contracts/club/finance"

import { AdminScreen } from "../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../src/admin/access"
import { useFinanceAuthority } from "../../../../src/admin/finance-authority"
import { shareFinanceCsv } from "../../../../src/admin/finance-export"
import { Chip, FinancePill, MetricTile, MonthSelector, NavRow, Notice, ObligationRow } from "../../../../src/admin/finance-ui"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { resumedAsk, usePendingIntent } from "../../../../src/admin/pending-intent"
import { supabase } from "../../../../src/auth/supabase"
import { webUrl } from "../../../../src/config/environment"
import { Button, Card, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { PayoutsSection } from "../../../../src/membership/payouts"
import { SearchField } from "../../../../src/membership/running-ui"
import { ButtonRow } from "../../../../src/people/ui"
import { colour, space, type } from "../../../../src/design/tokens"

/**
 * PAYMENTS -- each month's payments, from the club's own ledger (CA-M11.1; moved here by Club Memberships Part 2).
 *
 * What the old Subscriptions & Payments overview and its Members ledger did for a month, together and unchanged in
 * function: the month selector; the month's figures (`computeDashboardMetrics`, the web's own formulas); what needs
 * attention in the ledger; the memberships the relationship engine says to review; Generate Obligations and Export
 * CSV; and the obligation rows themselves with the search, the filters, Waive and the Retry hand-off. The overview
 * now leads with each member's standing; this is where the club works through the month's money.
 *
 * WAIVE is the web's `set_obligation_exemption` with a recorded reason, offered where the web offers it
 * (`finance.enrolment.manage`, on a row not already settled or excused). RETRY is a provider write that needs the
 * club's merchant token, held only by the web server -- so the row hands off to the membership page on the website
 * rather than pretending. Nothing here holds a token.
 *
 * Every write goes through the reason sheet; a refusal that asks for a recent authenticator holds the intent, steps
 * up and comes back to the same sheet -- verifying never performs the change.
 */
export default function PaymentsScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ filter?: string; month?: string }>()
  const { clubId, refresh: refreshAccess } = useAdminCentreAccess()
  const { loading: authorityLoading, authority, refresh: refreshAuthority } = useFinanceAuthority(clubId)
  const [period, setPeriod] = useState(isBillingPeriod(params.month) ? params.month : currentBillingPeriod())
  const [filter, setFilter] = useState<MemberFilter>(MEMBER_FILTERS.some((f) => f.key === params.filter) ? (params.filter as MemberFilter) : "all")
  const [query, setQuery] = useState("")
  const [dashboard, setDashboard] = useState<FinanceDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [ask, setAsk] = useState<ReasonAsk | null>(null)
  const pending = usePendingIntent("finance:payments")
  const generation = useRef(0)

  const load = useCallback(async () => {
    if (!clubId || authorityLoading || !authority.view) {
      if (!authorityLoading) setLoading(false)
      return
    }
    const gen = ++generation.current
    setError(null)
    setLoading(true)
    try {
      const next = await loadFinanceDashboard(supabase, clubId, period)
      if (gen !== generation.current) return
      setDashboard(next)
    } catch (cause) {
      const translated = friendly(cause, "the month's payments")
      logDetail("admin:subscriptions:payments", translated)
      if (gen === generation.current) setError(translated)
    } finally {
      if (gen === generation.current) setLoading(false)
    }
  }, [clubId, authorityLoading, authority.view, period])

  useFocusEffect(
    useCallback(() => {
      void load()
      const resume = pending.take()
      if (resume) setAsk(resumedAsk(resume))
    }, [load, pending])
  )

  const choosePeriod = (next: string) => {
    if (next === period) return
    setDashboard(null) // the old month's rows are not this month's: hold the place until the new ones arrive
    setPeriod(next)
  }

  const rows = useMemo(() => (dashboard ? filterObligationRows(dashboard.rows, filter, query) : []), [dashboard, filter, query])
  const metrics = dashboard?.metrics ?? null
  const attention = dashboard?.attention ?? null
  const nothingNeedsAttention = attention !== null && attention.failed === 0 && attention.overdue === 0 && attention.notSetUp === 0
  const openMembership = (payerSubscriptionId: string) => router.push(`/admin/subscriptions/membership/${payerSubscriptionId}` as never)

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
        const exported = await readFinanceExportRows(supabase, clubId, period)
        const shared = await shareFinanceCsv(financeRowsToCsv(exported), financeExportFileName(period))
        setNotice(shared.ok ? { tone: "ok", text: `Export shared (${exported.length} ${exported.length === 1 ? "row" : "rows"}).` } : { tone: "error", text: shared.message })
      },
    })
  }

  function waive(row: FinanceObligationRow) {
    setAsk({
      title: `Waive ${row.playerName}'s payment for this period?`,
      body: "The obligation is marked waived and excluded from what is outstanding. The reason is recorded in the club's finance audit.",
      confirmLabel: "Waive",
      reason: "required",
      onConfirm: async (reason) => {
        await setObligationExemption(supabase, row.obligationId, "WAIVED", reason)
        setNotice({ tone: "ok", text: `${row.playerName}'s payment waived.` })
        await load()
      },
    })
  }

  function retryOnWeb(row: FinanceObligationRow) {
    if (!webUrl) return
    void Linking.openURL(`${webUrl}${FINANCE_WEB_PATHS.membership(row.payerSubscriptionId)}`)
  }

  return (
    <AdminScreen section="Payments" onRefresh={() => void Promise.all([refreshAuthority(), load()])} refreshing={false}>
      {/* THE HEADER ALREADY SAYS "Payments": no second title, just what the screen is for. */}
      <Text style={[type.body, { color: colour.inkMuted }]}>Each month's payments, from the club's own ledger. Statuses are the record's own words.</Text>

      {!authorityLoading && !authority.view && <EmptyState title="Not for you at this club" body="Seeing members' payments needs the finance view permission at this club. If that has changed, pull to refresh." />}

      {authorityLoading && (
        <View style={{ gap: space.md }}>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={3} />
        </View>
      )}

      {authority.view && (
        <>
          {/* ------------------------------------------------------------------ the month, and its figures */}
          <View style={{ gap: space.md }}>
            <MonthSelector period={period} onChange={choosePeriod} />
            <Notice notice={notice} />
            {error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}
            {loading && !dashboard && !error && (
              <View style={{ gap: space.md }}>
                <CardSkeleton lines={2} />
                <CardSkeleton lines={3} />
              </View>
            )}
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
              <Card
                style={{ gap: space.sm }}
                onPress={nothingNeedsAttention ? undefined : () => setFilter("attention")}
                accessibilityLabel={nothingNeedsAttention ? undefined : `Needs attention this month: ${[attention.failed > 0 ? `${attention.failed} failed` : null, attention.overdue > 0 ? `${attention.overdue} overdue` : null, attention.notSetUp > 0 ? `${attention.notSetUp} not yet collected` : null].filter(Boolean).join(", ")}. Shows them below`}
              >
                <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
                  Needs Attention
                </Text>
                {nothingNeedsAttention ? (
                  <Text style={[type.small, { color: colour.inkMuted }]}>Nothing needs attention this month.</Text>
                ) : (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                    {/* Statuses, so sentence case; in the ledger's own words (as the website's attention panel), so a month
                        nobody has paid yet never reads as a person's "Not set up". Red only for a failed payment. */}
                    {attention.failed > 0 && <FinancePill label={`${attention.failed} failed`} tone="danger" />}
                    {attention.overdue > 0 && <FinancePill label={`${attention.overdue} overdue`} tone="caution" />}
                    {attention.notSetUp > 0 && <FinancePill label={`${attention.notSetUp} not yet collected`} tone="caution" />}
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
                  <NavRow key={`${item.payerSubscriptionId}-${item.reason}`} first={i === 0} label={item.playerName} caption={REVIEW_REASON_LABEL[item.reason] ?? "Review this membership."} onPress={() => openMembership(item.payerSubscriptionId)} />
                ))}
              </Card>
            )}

            {(authority.enrolmentManage || authority.export) && (
              <ButtonRow>
                {authority.enrolmentManage ? <Button label="Generate Obligations" variant="secondary" onPress={generate} /> : null}
                {authority.export ? <Button label="Export CSV" variant="secondary" onPress={exportCsv} /> : null}
              </ButtonRow>
            )}
          </View>

          {/* ------------------------------------------------------------------ the ledger: who owes what this month */}
          <View style={{ gap: space.md }}>
            <SearchField value={query} onChange={setQuery} placeholder="Search by player name" label="Search payments" />

            <View accessibilityRole="radiogroup" accessibilityLabel="Filter payments" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              {MEMBER_FILTERS.map((f) => (
                <Chip key={f.key} label={f.label} on={filter === f.key} onPress={() => setFilter(f.key)} />
              ))}
            </View>

            {dashboard && !loading && rows.length === 0 && (
              dashboard.rows.length === 0 ? (
                <EmptyState title="No obligations for this period yet" body={authority.enrolmentManage ? "Generate this month's obligations above once members are enrolled." : "Obligations appear once they have been generated for the period."} />
              ) : (
                <EmptyState title="Nobody matches" body={query ? "Try a different name." : "Nobody is in this state for the period."} />
              )
            )}

            {dashboard && rows.length > 0 && (
              <View style={{ gap: space.sm }}>
                <Text style={[type.caption, { color: colour.inkSubtle }]}>
                  {rows.length} of {dashboard.rows.length} {dashboard.rows.length === 1 ? "obligation" : "obligations"}
                </Text>
                <Card style={{ padding: 0, overflow: "hidden" }}>
                  {rows.map((row, i) => {
                    const offerWaive = authority.enrolmentManage && canWaiveObligation(row.status)
                    const offerRetry = authority.paymentAct && canRetryPayment(row)
                    return (
                      <ObligationRow key={row.obligationId} row={row} first={i === 0} onPress={() => openMembership(row.payerSubscriptionId)}>
                        {(offerWaive || offerRetry) && (
                          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md }}>
                            {offerRetry && <Button label="Retry on the Website" variant="quiet" onPress={() => retryOnWeb(row)} accessibilityHint="Retrying a payment uses the club's GoCardless connection, which lives on the Ovalball website" />}
                            {offerWaive && <Button label="Waive" variant="quiet" onPress={() => waive(row)} />}
                          </View>
                        )}
                      </ObligationRow>
                    )
                  })}
                </Card>
              </View>
            )}
          </View>

          {/* WHAT REACHED THE CLUB'S BANK: GoCardless's payouts, explained from its own items (20270754000000). */}
          {clubId && <PayoutsSection clubId={clubId} errorMessage={(cause) => friendly(cause, "the club's payouts").message} />}
        </>
      )}

      <ReasonSheet
        ask={ask}
        onClose={() => setAsk(null)}
        onRefused={() => void Promise.all([refreshAccess(), refreshAuthority()])}
        onStepUp={(reason) => {
          if (ask) pending.hold(ask, reason)
          setAsk(null)
          router.push({ pathname: "/step-up", params: { returnTo: "/admin/subscriptions/payments" } } as never)
        }}
        errorMessage={(cause) => financeErrorMessage(cause, friendly(cause, "this change").message)}
      />
    </AdminScreen>
  )
}
