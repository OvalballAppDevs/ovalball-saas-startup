import Link from "next/link"
import { ChevronRight, Gauge, ShieldCheck } from "lucide-react"

import { AlertList } from "@/components/dashboard/alert-list"
import {
  DashboardSection,
  SectionError,
  SectionUnauthorized,
} from "@/components/dashboard/dashboard-section"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { UpdatedAt } from "@/components/dashboard/updated-at"
import { BetaBadge } from "@/components/platform/beta-badge"
import type { BetaBadgeState } from "@/lib/platform/mode"
import {
  buildAlerts,
  type CommercialSnapshot,
  type ReadState,
  type ReferralHealthStatus,
  type SiteAdminDashboardData,
} from "@/lib/app-context/site-admin-dashboard-data"

/**
 * The Site Admin command centre.
 *
 * Phase A builds the shell, the read foundation and the first two real
 * sections. It deliberately does NOT render the growth chart, the fixture
 * activity visual, the finance panel, Top Referring Clubs or the referral
 * funnel: those are later phases, and a placeholder holding invented
 * numbers would be worse than an absent section. Nothing here says "coming
 * soon" either -- a section that does not exist yet simply is not on the
 * page.
 *
 * What IS here is real, canonical and drill-through-able:
 *   1. Platform pulse   -- who is on Ovalball
 *   2. Needs attention  -- what a Site Admin should do next
 *   3. Platform state   -- mode, release, referral data health
 */
export function SiteAdminDashboard({
  firstName,
  data,
  badgeState,
  appVersion,
}: {
  firstName: string | null
  data: SiteAdminDashboardData
  badgeState: BetaBadgeState
  appVersion: string
}) {
  const { platform, operations, commercial } = data
  const alerts = buildAlerts(operations, commercial)

  // The operational block is the fastest-moving read, so it owns the
  // "Updated" clock. Falling back to the platform read keeps the label
  // truthful when operations itself failed.
  const generatedAt =
    operations.state === "ok"
      ? operations.data.generatedAt
      : platform.state === "ok"
        ? platform.data.generatedAt
        : null

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-8 md:py-12">
      {/* ---------- command centre header ---------- */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <Gauge aria-hidden="true" className="size-5 text-forest-800" />
            <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">
              Site Admin
            </p>
          </div>
          <h1 className="mt-2 font-display text-display-l text-ink">Platform</h1>
          <p className="mt-2 max-w-xl text-sm text-ink/55">
            {firstName ? `${firstName} — everything ` : "Everything "}
            Ovalball is doing right now, across every club.
          </p>
        </div>

        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <BetaBadge state={badgeState} />
            <span className="inline-block rounded-full bg-ink/5 px-2.5 py-0.5 font-mono text-xs text-ink/60">
              v{appVersion}
            </span>
          </div>
          <UpdatedAt generatedAt={generatedAt} />
        </div>
      </div>

      {/* ---------- 1. platform pulse ---------- */}
      <DashboardSection
        title="Platform pulse"
        description="Canonical counts. Players are sporting identities and parents are distinct people, so these are separate populations and are never added together."
      >
        {platform.state === "error" ? (
          <SectionError what="Platform pulse" message={platform.message} />
        ) : platform.state === "unauthorized" ? (
          <SectionUnauthorized what="Platform pulse" />
        ) : platform.state === "ok" ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              <KpiCard
                label="Registered users"
                value={platform.data.registeredUsers}
                secondary={
                  platform.data.suspendedUsers > 0
                    ? `${platform.data.suspendedUsers.toLocaleString("en-GB")} suspended`
                    : undefined
                }
                href="/admin/users"
              />
              <KpiCard
                label="Registered clubs"
                value={platform.data.registeredClubs}
                secondary={`${platform.data.activeClubs.toLocaleString("en-GB")} active`}
                href="/admin/clubs"
              />
              <KpiCard
                label="Registered teams"
                value={platform.data.registeredTeams}
                secondary={`${platform.data.activeTeams.toLocaleString("en-GB")} active`}
                href="/admin/team-directory"
              />
              {/* No Site Admin parent or player surface exists yet, so these
                  two deliberately do not link. See the drill-through gaps in
                  docs/SITE_ADMIN_DASHBOARD_ARCHITECTURE.md. */}
              <KpiCard label="Registered parents" value={platform.data.registeredParents} />
              <KpiCard
                label="Registered players"
                value={platform.data.registeredPlayers}
                secondary={`${platform.data.activePlayers.toLocaleString("en-GB")} active`}
              />
            </div>

            <p className="mt-3 text-xs text-ink/45">
              {platform.data.directoryClubs.toLocaleString("en-GB")} clubs in the canonical
              directory — addressable market, not customers.
            </p>
          </>
        ) : null}
      </DashboardSection>

      {/* ---------- 2. needs attention ---------- */}
      <DashboardSection
        title="Needs attention"
        description="Only signals that are non-zero and that a Site Admin can actually act on."
      >
        {operations.state === "error" ? (
          <SectionError what="Needs attention" message={operations.message} />
        ) : operations.state === "unauthorized" ? (
          <SectionUnauthorized what="Needs attention" />
        ) : (
          <AlertList alerts={alerts} />
        )}
      </DashboardSection>

      {/* ---------- 3. platform state ---------- */}
      <DashboardSection
        title="Platform state"
        description="Whether Ovalball is charging clubs, and whether referral attribution can be trusted."
        action={{ href: "/admin/system-health", label: "System Health" }}
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <dl className="divide-y divide-ink/8 rounded-lg border border-ink/10 bg-white">
            <div className="flex items-center justify-between gap-4 px-5 py-3.5">
              <dt className="text-sm text-ink/55">Platform mode</dt>
              <dd>
                {badgeState.mode === "beta" ? (
                  <BetaBadge state={badgeState} />
                ) : (
                  <span className="inline-block rounded-full bg-mint-100 px-2.5 py-0.5 text-xs font-medium text-forest-950">
                    LIVE
                  </span>
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 px-5 py-3.5">
              <dt className="text-sm text-ink/55">Published release</dt>
              <dd className="font-mono text-sm text-ink">
                {badgeState.releaseVersion ?? "None published"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 px-5 py-3.5">
              <dt className="text-sm text-ink/55">Billing</dt>
              <dd className={`text-sm ${badgeState.mode === "beta" ? "text-purple-900" : "text-ink"}`}>
                {badgeState.mode === "beta" ? "Paused — Beta" : "Active"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 px-5 py-3.5">
              <dt className="text-sm text-ink/55">Fixtures today</dt>
              <dd className="font-mono text-sm text-ink tabular-nums">
                {operations.state === "ok" ? operations.data.fixturesToday.toLocaleString("en-GB") : "—"}
              </dd>
            </div>
          </dl>

          <ReferralHealthCard commercial={commercial} />
        </div>
      </DashboardSection>
    </div>
  )
}

/**
 * Referral data health, straight from F0's canonical referral_data_health().
 *
 * Commercial capability gated: a Site Admin without site.commercial.view
 * never had this fetched, and is told the section was omitted rather than
 * being shown a blank card.
 *
 * There is no drill-through yet, and none is invented. The Site Admin
 * referral administration surface is a known gap (Stage 1 R-5) and is
 * required before Phase F1; /admin/commercial is the closest legitimate
 * destination and is offered as exactly that, not as the referral screen.
 */
function ReferralHealthCard({ commercial }: { commercial: ReadState<CommercialSnapshot> }) {
  if (commercial.state === "omitted") {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-4">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink/35" />
        <div>
          <p className="text-sm font-medium text-ink">Commercial data not shown</p>
          <p className="mt-1 text-sm text-ink/55">{commercial.reason}</p>
        </div>
      </div>
    )
  }

  if (commercial.state === "error") {
    return <SectionError what="Referral data health" message={commercial.message} />
  }

  if (commercial.state === "unauthorized") {
    return <SectionUnauthorized what="Referral data health" />
  }

  const c = commercial.data
  const tone = HEALTH_TONE[c.referralHealthStatus]

  return (
    <div className="rounded-lg border border-ink/10 bg-white px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-sm text-ink/55">Referral data health</p>
        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.chip}`}>
          {c.referralHealthStatus}
        </span>
      </div>

      <p className="mt-2 text-sm text-ink/70">{tone.explanation}</p>

      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-ink/8 pt-3">
        <div>
          <dt className="text-xs text-ink/50">Referrals</dt>
          <dd className="mt-0.5 font-display text-xl text-ink tabular-nums">
            {c.referralsTotal.toLocaleString("en-GB")}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink/50">Clubs on Ovalball</dt>
          <dd className="mt-0.5 font-display text-xl text-ink tabular-nums">
            {(c.referralsRegistered + c.referralsQualified).toLocaleString("en-GB")}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink/50">Paid conversions</dt>
          <dd className="mt-0.5 font-display text-xl text-ink tabular-nums">
            {c.referralsQualified.toLocaleString("en-GB")}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-xs text-ink/45">
        Rewards cannot be earned while Ovalball is in Beta: a referral qualifies only when a
        referred club&rsquo;s first subscription payment is collected.
      </p>

      <Link
        href="/admin/commercial"
        className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-forest-800 underline underline-offset-4 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        Commercial overview
        <ChevronRight aria-hidden="true" className="size-3.5" />
      </Link>
    </div>
  )
}

const HEALTH_TONE: Record<ReferralHealthStatus, { chip: string; explanation: string }> = {
  HEALTHY: {
    chip: "bg-mint-100 text-forest-950",
    explanation: "Every referral invitation that produced a club has its attribution recorded.",
  },
  "RECONCILIATION NEEDED": {
    chip: "bg-amber-100 text-amber-950",
    explanation:
      "Some attribution is missing and can be repaired safely from existing evidence. Referral counts are a lower bound until it is.",
  },
  "ACTION REQUIRED": {
    chip: "bg-amber-900 text-amber-50",
    explanation:
      "A reward or an ambiguous referrer needs a person to decide. Reconciliation cannot settle this on its own, and referral figures should not be treated as complete.",
  },
}
