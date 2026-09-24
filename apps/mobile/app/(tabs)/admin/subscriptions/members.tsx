import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Linking, Text, TextInput, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import {
  canRetryPayment,
  canWaiveObligation,
  currentBillingPeriod,
  FINANCE_WEB_PATHS,
  filterObligationRows,
  financeErrorMessage,
  isBillingPeriod,
  loadFinanceDashboard,
  MEMBER_FILTERS,
  REVIEW_REASON_LABEL,
  setObligationExemption,
  type FinanceDashboard,
  type FinanceObligationRow,
  type MemberFilter,
} from "@ovalball/contracts/club/finance"

import { AdminScreen } from "../../../../src/admin/screen"
import { useAdminCentreAccess } from "../../../../src/admin/access"
import { useFinanceAuthority } from "../../../../src/admin/finance-authority"
import { Chip, MonthSelector, NavRow, Notice, ObligationRow } from "../../../../src/admin/finance-ui"
import { ReasonSheet, type ReasonAsk } from "../../../../src/admin/reason-sheet"
import { resumedAsk, usePendingIntent } from "../../../../src/admin/pending-intent"
import { supabase } from "../../../../src/auth/supabase"
import { webUrl } from "../../../../src/config/environment"
import { Search } from "../../../../src/components/icons"
import { Button, Card, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { friendly, logDetail, type FriendlyError } from "../../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * MEMBERS -- who owes what this period, natively (CA-M11.1).
 *
 * The website's subscriber table over the same canonical obligation rows, with OVERDUE derived by the same
 * rule. Statuses are shown verbatim from the domain vocabulary, never collapsed to yes/no. Search and the
 * filters are presentation over one read. Every row opens the membership.
 *
 * WAIVE is the web's `set_obligation_exemption` with a recorded reason, offered where the web offers it
 * (`finance.enrolment.manage`, on a row not already settled or excused). RETRY is a provider write that
 * needs the club's merchant token, held only by the web server -- so the row hands off to the membership
 * page on the website rather than pretending. Nothing here holds a token.
 */
export default function MembersScreen() {
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
  const pending = usePendingIntent("finance:members")
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
      const board = await loadFinanceDashboard(supabase, clubId, period)
      if (gen !== generation.current) return
      setDashboard(board)
    } catch (cause) {
      const translated = friendly(cause, "the club's members")
      logDetail("admin:subscriptions:members", translated)
      if (gen === generation.current) setError(translated)
    } finally {
      if (gen === generation.current) setLoading(false)
    }
  }, [clubId, authorityLoading, authority.view, period])

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

  const rows = useMemo(() => (dashboard ? filterObligationRows(dashboard.rows, filter, query) : []), [dashboard, filter, query])

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
    <AdminScreen section="Members" onRefresh={() => void Promise.all([refreshAuthority(), load()])} refreshing={false}>
      <View style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.display, { color: colour.ink }]}>
          Members
        </Text>
        <Text style={[type.body, { color: colour.inkMuted }]}>Who owes what for the period, from the club's own ledger. Statuses are the record's own words.</Text>
      </View>

      {!authorityLoading && !authority.view && <EmptyState title="Not for you at this club" body="Seeing members' payment status needs the finance view permission at this club." />}

      {authority.view && (
        <>
          <MonthSelector period={period} onChange={setPeriod} />

          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface }}>
            <Search size={18} color={colour.inkSubtle} />
            <TextInput accessibilityLabel="Search members" value={query} onChangeText={setQuery} placeholder="Search by player name" placeholderTextColor={colour.inkSubtle} autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={[type.body, { flex: 1, minHeight: TOUCH_TARGET, color: colour.ink }]} />
          </View>

          <View accessibilityRole="radiogroup" accessibilityLabel="Filter members" style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {MEMBER_FILTERS.map((f) => (
              <Chip key={f.key} label={f.label} on={filter === f.key} onPress={() => setFilter(f.key)} />
            ))}
          </View>

          <Notice notice={notice} />

          {loading && !dashboard && (
            <View style={{ gap: space.md }}>
              <CardSkeleton lines={2} />
              <CardSkeleton lines={2} />
            </View>
          )}
          {error && <ErrorState message={error.message} onRetry={() => void load()} offline={error.retryable} />}

          {filter === "attention" && dashboard && dashboard.review.length > 0 && (
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

          {dashboard && !loading && rows.length === 0 && (
            dashboard.rows.length === 0 ? (
              <EmptyState title="No obligations for this period yet" body={authority.enrolmentManage ? "Generate this month's obligations from the overview once members are enrolled." : "Obligations appear once they have been generated for the period."} />
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
                    <ObligationRow key={row.obligationId} row={row} first={i === 0} onPress={() => router.push(`/admin/subscriptions/membership/${row.payerSubscriptionId}` as never)}>
                      {(offerWaive || offerRetry) && (
                        <View style={{ flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md }}>
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
        </>
      )}

      <ReasonSheet
        ask={ask}
        onClose={() => setAsk(null)}
        onRefused={() => void Promise.all([refreshAccess(), refreshAuthority()])}
        onStepUp={(reason) => {
          if (ask) pending.hold(ask, reason)
          setAsk(null)
          router.push({ pathname: "/step-up", params: { returnTo: "/admin/subscriptions/members" } } as never)
        }}
        errorMessage={(cause) => financeErrorMessage(cause, friendly(cause, "this change").message)}
      />
    </AdminScreen>
  )
}
