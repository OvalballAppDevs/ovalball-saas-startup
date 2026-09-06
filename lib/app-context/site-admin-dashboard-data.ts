import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { hasCapability } from "@/lib/permissions/has-capability"
import type { Database } from "@/types/database.types"

/**
 * The Site Admin dashboard's read model.
 *
 * Deliberately a sibling of dashboard-data.ts rather than an extension of
 * it: that file answers "what does THIS PERSON need to do this week",
 * scoped to their own teams, and is correct for Club/Team/Parent/Player.
 * This one answers "what is the platform doing", scoped to nothing. Mixing
 * them would give the personal dashboard a reason to hold platform-wide
 * aggregates it must never read.
 *
 * Three reads, grouped by how often their answers change, never one per
 * tile. See supabase/migrations/20261013000000_site_admin_dashboard_read_model.sql
 * for why the aggregation happens in the database.
 */

/**
 * Zero is a real business answer. A failed privileged query is not.
 *
 * The old dashboard discarded Supabase errors (`const { data } = await …`)
 * and rendered the resulting undefined as an empty state, which made "no
 * fixtures" and "the query blew up" pixel-identical. On a platform
 * dashboard that is worse than useless: "0 registered clubs" would be read
 * as a business fact. Every read here therefore returns a discriminated
 * result the UI has to look at.
 */
export type ReadState<T> =
  | { state: "ok"; data: T }
  /** The caller is a Site Admin but lacks the extra capability. Section is omitted, not blanked. */
  | { state: "omitted"; reason: string }
  /** The database refused. Distinct from "omitted": something is wrong. */
  | { state: "unauthorized" }
  /** Anything else. The section shows an error; the rest of the page still renders. */
  | { state: "error"; message: string }

export interface PlatformSnapshot {
  registeredUsers: number
  suspendedUsers: number
  registeredClubs: number
  activeClubs: number
  registeredTeams: number
  activeTeams: number
  registeredParents: number
  registeredPlayers: number
  activePlayers: number
  directoryClubs: number
  generatedAt: string
}

export interface OperationsSnapshot {
  fixturesToday: number
  pendingClubClaims: number
  pendingDirectoryRequests: number
  stuckFixtureRequests: number
  disputedResults: number
  resultsAwaitingConfirmation: number
  openSupportTickets: number
  generatedAt: string
}

export interface CommercialSnapshot {
  clubsOnTrial: number
  trialsEndingSoon: number
  activeSubscriptions: number
  pastDueSubscriptions: number
  awaitingMandate: number
  referralHealthStatus: ReferralHealthStatus
  referralsTotal: number
  referralsAwaitingActivation: number
  referralsRegistered: number
  referralsQualified: number
  generatedAt: string
}

export type ReferralHealthStatus = "HEALTHY" | "RECONCILIATION NEEDED" | "ACTION REQUIRED"

export interface SiteAdminDashboardData {
  platform: ReadState<PlatformSnapshot>
  operations: ReadState<OperationsSnapshot>
  commercial: ReadState<CommercialSnapshot>
}

/** Postgres "insufficient privilege". The database refused, not the network. */
const INSUFFICIENT_PRIVILEGE = "42501"

function toErrorState<T>(error: { code?: string; message: string }): ReadState<T> {
  if (error.code === INSUFFICIENT_PRIVILEGE) return { state: "unauthorized" }
  return { state: "error", message: error.message }
}

/**
 * Every read is issued in parallel and every failure is contained to its
 * own section: a commercial outage must not blank the platform counts.
 */
export async function getSiteAdminDashboardData(
  supabase: SupabaseClient<Database>
): Promise<SiteAdminDashboardData> {
  // Asked once, up front, so an unauthorized commercial section is OMITTED
  // server-side rather than fetched-and-hidden. The RPC re-checks the same
  // capability itself; this is what stops the request being made at all.
  const canSeeCommercial = await hasCapability(supabase, "site.commercial.view", "site")

  const [platform, operations, commercial] = await Promise.all([
    readPlatform(supabase),
    readOperations(supabase),
    canSeeCommercial
      ? readCommercial(supabase)
      : Promise.resolve<ReadState<CommercialSnapshot>>({
          state: "omitted",
          reason: "Commercial visibility is not granted to this Site Admin profile.",
        }),
  ])

  return { platform, operations, commercial }
}

async function readPlatform(
  supabase: SupabaseClient<Database>
): Promise<ReadState<PlatformSnapshot>> {
  const { data, error } = await supabase.rpc("site_admin_dashboard_platform")
  if (error) return toErrorState(error)

  const row = data?.[0]
  if (!row) return { state: "error", message: "The platform snapshot returned no rows." }

  return {
    state: "ok",
    data: {
      registeredUsers: row.registered_users,
      suspendedUsers: row.suspended_users,
      registeredClubs: row.registered_clubs,
      activeClubs: row.active_clubs,
      registeredTeams: row.registered_teams,
      activeTeams: row.active_teams,
      registeredParents: row.registered_parents,
      registeredPlayers: row.registered_players,
      activePlayers: row.active_players,
      directoryClubs: row.directory_clubs,
      generatedAt: row.generated_at,
    },
  }
}

async function readOperations(
  supabase: SupabaseClient<Database>
): Promise<ReadState<OperationsSnapshot>> {
  const { data, error } = await supabase.rpc("site_admin_dashboard_operations")
  if (error) return toErrorState(error)

  const row = data?.[0]
  if (!row) return { state: "error", message: "The operations snapshot returned no rows." }

  return {
    state: "ok",
    data: {
      fixturesToday: row.fixtures_today,
      pendingClubClaims: row.pending_club_claims,
      pendingDirectoryRequests: row.pending_directory_requests,
      stuckFixtureRequests: row.stuck_fixture_requests,
      disputedResults: row.disputed_results,
      resultsAwaitingConfirmation: row.results_awaiting_confirmation,
      openSupportTickets: row.open_support_tickets,
      generatedAt: row.generated_at,
    },
  }
}

async function readCommercial(
  supabase: SupabaseClient<Database>
): Promise<ReadState<CommercialSnapshot>> {
  const { data, error } = await supabase.rpc("site_admin_dashboard_commercial")
  if (error) return toErrorState(error)

  const row = data?.[0]
  if (!row) return { state: "error", message: "The commercial snapshot returned no rows." }

  return {
    state: "ok",
    data: {
      clubsOnTrial: row.clubs_on_trial,
      trialsEndingSoon: row.trials_ending_soon,
      activeSubscriptions: row.active_subscriptions,
      pastDueSubscriptions: row.past_due_subscriptions,
      awaitingMandate: row.awaiting_mandate,
      referralHealthStatus: normaliseHealth(row.referral_health_status),
      referralsTotal: row.referrals_total,
      referralsAwaitingActivation: row.referrals_awaiting_activation,
      referralsRegistered: row.referrals_registered,
      referralsQualified: row.referrals_qualified,
      generatedAt: row.generated_at,
    },
  }
}

/**
 * F0 owns these three strings (referral_data_health). Anything else means
 * the two have drifted, and the honest answer is the most serious one --
 * never a cheerful default.
 */
function normaliseHealth(value: string | null): ReferralHealthStatus {
  if (value === "HEALTHY" || value === "RECONCILIATION NEEDED" || value === "ACTION REQUIRED") {
    return value
  }
  return "ACTION REQUIRED"
}

export type AlertSeverity = "info" | "warning" | "action"

export interface DashboardAlert {
  key: string
  severity: AlertSeverity
  count: number | null
  title: string
  detail: string
  /** Null where no canonical Site Admin destination exists yet. Never a fabricated route. */
  href: string | null
}

/**
 * Turns the snapshots into the Needs Attention list.
 *
 * Two rules, both about not crying wolf:
 *   * a signal reading zero produces no alert at all;
 *   * an alert with no real destination gets no link rather than a
 *     plausible-looking one. Two Phase A signals genuinely have nowhere to
 *     go (see docs/SITE_ADMIN_DASHBOARD_ARCHITECTURE.md, drill-through
 *     gaps) and saying so is more useful than a dead end.
 */
export function buildAlerts(
  operations: ReadState<OperationsSnapshot>,
  commercial: ReadState<CommercialSnapshot>
): DashboardAlert[] {
  const alerts: DashboardAlert[] = []

  if (operations.state === "ok") {
    const o = operations.data

    if (o.pendingClubClaims > 0) {
      alerts.push({
        key: "club-claims",
        severity: "action",
        count: o.pendingClubClaims,
        title: o.pendingClubClaims === 1 ? "Club claim awaiting review" : "Club claims awaiting review",
        detail: "Nobody at these clubs can start until a Site Admin approves the claim.",
        href: "/admin/claims",
      })
    }

    if (o.disputedResults > 0) {
      alerts.push({
        key: "disputed-results",
        severity: "action",
        count: o.disputedResults,
        title: o.disputedResults === 1 ? "Disputed result" : "Disputed results",
        detail: "Two clubs disagree about a score. Only a Site Admin can settle it.",
        href: "/admin/fixtures?resultStatus=disputed",
      })
    }

    if (o.stuckFixtureRequests > 0) {
      alerts.push({
        key: "stuck-fixture-requests",
        severity: "warning",
        count: o.stuckFixtureRequests,
        title: "Fixture requests unanswered for over two weeks",
        detail: "Sent, never answered. No Site Admin fixture-request surface exists yet.",
        href: null,
      })
    }

    if (o.pendingDirectoryRequests > 0) {
      alerts.push({
        key: "directory-requests",
        severity: "warning",
        count: o.pendingDirectoryRequests,
        title: "Directory requests awaiting review",
        detail: "New clubs asking to be added. No Site Admin review surface exists yet.",
        href: null,
      })
    }

    if (o.openSupportTickets > 0) {
      alerts.push({
        key: "support",
        severity: "info",
        count: o.openSupportTickets,
        title: o.openSupportTickets === 1 ? "Open support ticket" : "Open support tickets",
        detail: "Raised by clubs and by the public.",
        href: "/admin/support",
      })
    }

    if (o.resultsAwaitingConfirmation > 0) {
      alerts.push({
        key: "awaiting-results",
        severity: "info",
        count: o.resultsAwaitingConfirmation,
        title: "Results awaiting confirmation",
        detail: "Submitted by one club, not yet confirmed by the other.",
        href: "/admin/fixtures?resultStatus=awaiting_confirmation",
      })
    }
  }

  if (commercial.state === "ok") {
    const c = commercial.data

    if (c.pastDueSubscriptions > 0) {
      alerts.push({
        key: "past-due",
        severity: "action",
        count: c.pastDueSubscriptions,
        title: c.pastDueSubscriptions === 1 ? "Subscription past due" : "Subscriptions past due",
        detail: "An Ovalball collection failed and has not recovered.",
        href: "/admin/commercial",
      })
    }

    if (c.trialsEndingSoon > 0) {
      alerts.push({
        key: "trials-ending",
        severity: "warning",
        count: c.trialsEndingSoon,
        title: "Trials ending within a week",
        detail: "Running trial clocks only — trials paused by Beta are not counted.",
        href: "/admin/commercial",
      })
    }
  }

  // Severity order, then the biggest number, so the most serious thing is
  // always the first thing read.
  const rank: Record<AlertSeverity, number> = { action: 0, warning: 1, info: 2 }
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || (b.count ?? 0) - (a.count ?? 0))
}
