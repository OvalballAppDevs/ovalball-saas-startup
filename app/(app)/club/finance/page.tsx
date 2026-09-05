import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { getSessionContext } from "@/lib/app-context/session-context"
import { computeDashboardMetrics, isObligationOverdue } from "@/lib/payments/domain/dashboard-metrics"
import { formatMinorUnits } from "@/lib/payments/domain/money"
import { createClient } from "@/lib/supabase/server"

import { AttentionPanel } from "./attention-panel"
import { ExportButton } from "./export-button"
import { GenerateObligationsButton } from "./generate-obligations-button"
import { MonthSelector } from "./month-selector"
import { RelationshipReviewPanel, type RelationshipReviewItem } from "./relationship-review-panel"
import { SubscriberTable } from "./subscriber-table"

function currentMonthISO() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
}

/**
 * Club Admin Finance Dashboard. Every card's number comes from
 * computeDashboardMetrics() (lib/payments/domain/dashboard-metrics.ts),
 * never invented in this component -- see that file for each metric's
 * exact formula. Accounting integrity and auditability take precedence
 * over visual polish.
 */
export default async function ClubFinanceDashboardPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const params = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const clubId = activeClubId(ctx, activeContext)

  const canView = clubId ? await hasCapability(supabase, "club.subscription.view_finance", "club", { clubId }) : false
  if (!clubId || !canView) redirect("/dashboard")

  const canManageEnrolment = await hasCapability(supabase, "club.subscription.manage_enrolment", "club", { clubId })
  const canManagePayments = await hasCapability(supabase, "club.subscription.manage_payment_actions", "club", { clubId })
  const canExport = await hasCapability(supabase, "club.subscription.export", "club", { clubId })

  const billingPeriod = params.month && /^\d{4}-\d{2}-01$/.test(params.month) ? params.month : currentMonthISO()
  const clubName = activeContext.kind === "club" ? activeContext.label : "Club"

  const [{ data: obligationsRaw }, { count: activeSubsCount }] = await Promise.all([
    supabase
      .from("membership_obligations")
      .select(
        "id, amount_due_minor, due_date, status, resolved_reason, player_id, players(first_name, surname), payer_subscription_id, player_subscription_payers(payer_user_id), gocardless_payment_id, is_prorated, membership_effective_date"
      )
      .eq("club_id", clubId)
      .eq("billing_period", billingPeriod),
    // head:true means this query returns no row data, only the `count`
    // metadata field -- destructuring `{ data: activeSubs }` and using
    // `activeSubs?.length` would always read 0/undefined under
    // head:true regardless of the real count.
    supabase.from("gocardless_subscriptions").select("id", { count: "exact", head: true }).eq("club_id", clubId).eq("status", "active"),
  ])

  const obligations = obligationsRaw ?? []
  const metrics = computeDashboardMetrics(
    obligations.map((o) => ({ amountDueMinor: o.amount_due_minor, status: o.status })),
    activeSubsCount ?? 0
  )

  const failedCount = obligations.filter((o) => o.status === "FAILED").length
  const overdueCount = obligations.filter((o) => isObligationOverdue(o.status, o.due_date)).length
  const notSetUpCount = obligations.filter((o) => o.status === "SETUP_PENDING").length

  const paymentIds = obligations.map((o) => o.gocardless_payment_id).filter((id): id is string => Boolean(id))
  const { data: payments } = paymentIds.length > 0 ? await supabase.from("gocardless_payments").select("id, obligation_id, status, gc_payment_id").in("id", paymentIds) : { data: [] }
  const paymentByObligationId = new Map((payments ?? []).map((p) => [p.obligation_id, p]))

  // Relationship-derived review conditions, club-wide (not scoped to
  // this billing period) -- PAYMENT_FAILED/PAYMENT_RETRY_REQUIRES_ATTENTION
  // are deliberately excluded here since AttentionPanel above already
  // covers those from the canonical obligation rows; this panel is only
  // the relationship-derived reasons.
  const { data: actionRequiredRaw } = await supabase.rpc("get_finance_action_required", { p_club_id: clubId })
  const relationshipReasons = (actionRequiredRaw ?? []).filter((r) => r.reason !== "PAYMENT_FAILED" && r.reason !== "PAYMENT_RETRY_REQUIRES_ATTENTION")
  const relationshipPlayerIds = [...new Set(relationshipReasons.map((r) => r.player_id))]
  const { data: relationshipPlayers } = relationshipPlayerIds.length > 0 ? await supabase.from("players").select("id, first_name, surname").in("id", relationshipPlayerIds) : { data: [] }
  const relationshipPlayerNameById = new Map((relationshipPlayers ?? []).map((p) => [p.id, `${p.first_name} ${p.surname}`]))
  const relationshipReviewItems: RelationshipReviewItem[] = relationshipReasons.map((r) => ({
    payerSubscriptionId: r.payer_subscription_id,
    playerName: relationshipPlayerNameById.get(r.player_id) ?? "Unknown player",
    reason: r.reason,
  }))

  const rows = obligations.map((o) => ({
    obligationId: o.id,
    payerSubscriptionId: o.payer_subscription_id,
    playerName: o.players ? `${o.players.first_name} ${o.players.surname}` : "Unknown",
    amountMinor: o.amount_due_minor,
    dueDate: o.due_date,
    status: isObligationOverdue(o.status, o.due_date) ? "OVERDUE" : o.status,
    resolvedReason: o.resolved_reason,
    payment: paymentByObligationId.get(o.id) ?? null,
    isProrated: o.is_prorated,
  }))

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">{clubName}</p>
          <h1 className="mt-2 font-display text-display-l text-ink">Finance Dashboard</h1>
        </div>
        <MonthSelector currentMonth={billingPeriod} />
      </div>

      {(canManageEnrolment || canExport) && (
        <div className="mt-4 flex flex-wrap gap-3">
          {canManageEnrolment && <GenerateObligationsButton clubId={clubId} billingPeriod={billingPeriod} />}
          {canExport && <ExportButton clubId={clubId} billingPeriod={billingPeriod} />}
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <MetricCard label="Expected revenue" value={formatMinorUnits(metrics.expectedRevenueMinor)} />
        <MetricCard label="Collected this month" value={formatMinorUnits(metrics.collectedMinor)} tone="success" />
        <MetricCard label="Outstanding" value={formatMinorUnits(metrics.outstandingMinor)} tone={metrics.outstandingMinor > 0 ? "warning" : undefined} />
        <MetricCard label="Payment success rate" value={metrics.successRatePercent !== null ? `${metrics.successRatePercent}%` : "—"} />
        <MetricCard label="Active Direct Debits" value={String(metrics.activeDirectDebits)} />
        <MetricCard label="Exempt / waived" value={formatMinorUnits(metrics.exemptWaivedMinor)} />
      </div>

      <div className="mt-6 space-y-3">
        <AttentionPanel failedCount={failedCount} notSetUpCount={notSetUpCount} overdueCount={overdueCount} />
        <RelationshipReviewPanel items={relationshipReviewItems} />
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Subscribers -- {billingPeriod.slice(0, 7)}</h2>
        <div className="mt-3">
          <SubscriberTable clubId={clubId} rows={rows} canManageEnrolment={canManageEnrolment} canManagePayments={canManagePayments} />
        </div>
      </div>
    </div>
  )
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <p className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">{label}</p>
      <p className={`mt-1.5 text-2xl font-medium tabular-nums ${tone === "success" ? "text-forest-800" : tone === "warning" ? "text-amber-700" : "text-ink"}`}>{value}</p>
    </div>
  )
}
