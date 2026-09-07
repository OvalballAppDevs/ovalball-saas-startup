import Link from "next/link"
import { ChevronRight, Gauge, ShieldCheck } from "lucide-react"

import { AdoptionBars, GroupedBarChart } from "@/components/dashboard/charts"
import { AlertList } from "@/components/dashboard/alert-list"
import { GrowthPanel } from "@/components/dashboard/growth-panel"
import {
  DashboardSection,
  SectionError,
  SectionUnauthorized,
} from "@/components/dashboard/dashboard-section"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { UpdatedAt } from "@/components/dashboard/updated-at"
import { BetaBadge } from "@/components/platform/beta-badge"
import type { CommercialCardsData, ReferralIntelligenceData } from "@/lib/app-context/commercial-intelligence-data"
import type { BetaBadgeState } from "@/lib/platform/mode"
import {
  buildAlerts,
  type FixtureTodayRow,
  type CommercialSnapshot,
  type ReadState,
  type ReferralHealthStatus,
  type SiteAdminDashboardData,
} from "@/lib/app-context/site-admin-dashboard-data"

/**
 * The Site Admin command centre.
 *
 * Phase A built the shell, the read foundation, Platform Pulse, Needs
 * Attention and Platform State. Phase B adds rugby activity, growth and
 * adoption:
 *
 *   1. Platform pulse    -- who is on Ovalball
 *   2. Rugby today       -- fixtures playing today + booked counters
 *   3. Rugby activity    -- 12 weeks, booked vs playing
 *   4. Platform growth   -- one metric at a time, real timestamps
 *   5. Adoption          -- what active clubs actually use
 *   6. Needs attention   -- what a Site Admin should do next
 *   7. Platform state    -- mode, release, referral data health
 *
 * Still deliberately absent: finance visuals, Top Referring Clubs, the
 * referral funnel and the referral live log. Those are commercial phases,
 * and a placeholder holding invented numbers would be worse than nothing.
 * Nothing here says "coming soon" -- a section that does not exist yet
 * simply is not on the page.
 */
export function SiteAdminDashboard({
  firstName,
  data,
  badgeState,
  appVersion,
  commercialCards,
  referralIntelligence,
}: {
  firstName: string | null
  data: SiteAdminDashboardData
  badgeState: BetaBadgeState
  appVersion: string
  /** null when the viewing Site Admin lacks site.commercial.view -- the whole section then does not render, never a locked placeholder. Inside it, each card carries its own read state. */
  commercialCards: CommercialCardsData | null
  referralIntelligence: ReadState<ReferralIntelligenceData> | null
}) {
  const { platform, operations, commercial, fixturesToday, trends } = data
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
          <p className="mt-2 max-w-xl text-sm text-ink-muted">
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

            <p className="mt-3 text-xs text-ink-muted">
              {platform.data.directoryClubs.toLocaleString("en-GB")} clubs in the canonical
              directory — addressable market, not customers.
            </p>
          </>
        ) : null}
      </DashboardSection>

      {/* ---------- 2. rugby today ---------- */}
      <DashboardSection
        title="Rugby today"
        description="Physical fixtures playing today, in kickoff order. One confirmed fixture is one row, however many clubs are involved."
        action={{ href: "/admin/fixtures", label: "Fixture Management" }}
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
          {fixturesToday.state === "error" ? (
            <SectionError what="Rugby today" message={fixturesToday.message} />
          ) : fixturesToday.state === "unauthorized" ? (
            <SectionUnauthorized what="Rugby today" />
          ) : fixturesToday.state === "ok" ? (
            <FixturesTodayList
              rows={fixturesToday.data}
              total={operations.state === "ok" ? operations.data.fixturesToday : null}
            />
          ) : null}

          {operations.state === "ok" ? (
            <dl className="divide-y divide-ink/8 rounded-lg border border-ink/10 bg-white">
              <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                <dt className="text-sm text-ink-muted">Playing today</dt>
                <dd className="font-display text-xl text-ink tabular-nums">
                  {operations.data.fixturesToday.toLocaleString("en-GB")}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                <dt className="text-sm text-ink-muted">
                  Booked this week
                  <span className="mt-0.5 block text-xs text-ink-muted">Arranged since Monday</span>
                </dt>
                <dd className="font-display text-xl text-ink tabular-nums">
                  {operations.data.fixturesBookedThisWeek.toLocaleString("en-GB")}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                <dt className="text-sm text-ink-muted">
                  Booked this month
                  <span className="mt-0.5 block text-xs text-ink-muted">Arranged, not played</span>
                </dt>
                <dd className="font-display text-xl text-ink tabular-nums">
                  {operations.data.fixturesBookedThisMonth.toLocaleString("en-GB")}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 px-5 py-3.5">
                <dt className="text-sm text-ink-muted">Cancelled this month</dt>
                <dd className="font-display text-xl text-ink tabular-nums">
                  {operations.data.fixturesCancelledThisMonth.toLocaleString("en-GB")}
                </dd>
              </div>
            </dl>
          ) : null}
        </div>
      </DashboardSection>

      {/* ---------- 3. rugby activity ---------- */}
      <DashboardSection
        title="Rugby activity"
        description="Twelve weeks. Two different questions, kept apart: when fixtures were arranged, and when they are played."
      >
        {trends.state === "error" ? (
          <SectionError what="Rugby activity" message={trends.message} />
        ) : trends.state === "unauthorized" ? (
          <SectionUnauthorized what="Rugby activity" />
        ) : trends.state === "ok" ? (
          <div className="rounded-lg border border-ink/10 bg-white px-5 py-4">
            <GroupedBarChart
              title="Fixture activity, last 12 weeks"
              summary={`Booked totals ${trends.data.fixtureWeeks.reduce((s, w) => s + w.booked, 0)} and playing totals ${trends.data.fixtureWeeks.reduce((s, w) => s + w.playing, 0)} across the period.`}
              points={trends.data.fixtureWeeks.map((w) => ({
                label: formatWeek(w.weekStart),
                a: w.booked,
                b: w.playing,
              }))}
              aLabel="Booked (arranged)"
              bLabel="Playing (kickoff)"
            />
          </div>
        ) : null}
      </DashboardSection>

      {/* ---------- 4. platform growth ---------- */}
      <DashboardSection
        title="Platform growth"
        description="Newly registered per period, from canonical creation timestamps. Same definitions as Platform Pulse."
      >
        {trends.state === "error" ? (
          <SectionError what="Platform growth" message={trends.message} />
        ) : trends.state === "unauthorized" ? (
          <SectionUnauthorized what="Platform growth" />
        ) : trends.state === "ok" ? (
          <div className="rounded-lg border border-ink/10 bg-white px-5 py-4">
            <GrowthPanel daily={trends.data.growthDaily} monthly={trends.data.growthMonthly} />
          </div>
        ) : null}
      </DashboardSection>

      {/* ---------- 5. adoption ---------- */}
      <DashboardSection
        title="Adoption"
        description="What active clubs actually use — measured by real usage, never by whether a menu item is visible to them."
        action={{ href: "/admin/clubs", label: "Club Management" }}
      >
        {trends.state === "error" ? (
          <SectionError what="Adoption" message={trends.message} />
        ) : trends.state === "unauthorized" ? (
          <SectionUnauthorized what="Adoption" />
        ) : trends.state === "ok" ? (
          <div className="rounded-lg border border-ink/10 bg-white px-5 py-4">
            <AdoptionBars
              denominator={trends.data.adoption.activeClubs}
              denominatorLabel="active clubs"
              rows={[
                { label: "With an active team", value: trends.data.adoption.withActiveTeams },
                { label: "With fixtures", value: trends.data.adoption.withFixtures },
                { label: "With a partner club", value: trends.data.adoption.withPartnerClubs },
                {
                  label: "Parent / player adoption",
                  value: trends.data.adoption.withParentPlayer,
                  note: "A player at one of the club's teams has an active guardian.",
                },
                {
                  label: "Using Training Management",
                  value: trends.data.adoption.usingTraining,
                  note: "An active training plan or a planned session — not menu availability.",
                },
                {
                  label: "Taking member payments",
                  value: trends.data.adoption.withMemberPayments,
                  note: "The club charging its own members. Never Ovalball subscription money.",
                },
              ]}
            />
          </div>
        ) : null}
      </DashboardSection>

      {/* ---------- 6. needs attention ---------- */}
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

      {/* ---------- 7. platform state ---------- */}
      <DashboardSection
        title="Platform state"
        description="Whether Ovalball is charging clubs, and whether referral attribution can be trusted."
        action={{ href: "/admin/system-health", label: "System Health" }}
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <dl className="divide-y divide-ink/8 rounded-lg border border-ink/10 bg-white">
            <div className="flex items-center justify-between gap-4 px-5 py-3.5">
              <dt className="text-sm text-ink-muted">Platform mode</dt>
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
              <dt className="text-sm text-ink-muted">Published release</dt>
              <dd className="font-mono text-sm text-ink">
                {badgeState.releaseVersion ?? "None published"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 px-5 py-3.5">
              <dt className="text-sm text-ink-muted">Billing</dt>
              <dd className={`text-sm ${badgeState.mode === "beta" ? "text-purple-900" : "text-ink"}`}>
                {badgeState.mode === "beta" ? "Paused — Beta" : "Active"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 px-5 py-3.5">
              <dt className="text-sm text-ink-muted">Fixtures today</dt>
              <dd className="font-mono text-sm text-ink tabular-nums">
                {operations.state === "ok" ? operations.data.fixturesToday.toLocaleString("en-GB") : "—"}
              </dd>
            </div>
          </dl>

          <ReferralHealthCard commercial={commercial} />
        </div>
      </DashboardSection>

      {/* ---------- 8. commercial ---------- */}
      {commercialCards && (
        <DashboardSection
          title="Commercial"
          description="Three separate money domains -- what clubs pay Ovalball, what a club's own members pay the club, and referral rewards. Never mixed."
          action={{ href: "/admin/commercial", label: "Commercial" }}
        >
          {/* Each card carries its own read state. A referral outage must not
              turn the SaaS card into a confident, wrong "£0". */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MoneyCardState label="Ovalball SaaS" state={commercialCards.saas} href="/admin/commercial">
              {(d) => ({
                value: d.billingCollecting ? formatMoney(d.mrrPence) : "Beta",
                detail: d.billingCollecting
                  ? `MRR · ${d.activeSubscriptions} active, ${d.onTrial} on trial`
                  : `SaaS billing not currently collecting · ${d.activeSubscriptions} active, ${d.onTrial} on trial`,
              })}
            </MoneyCardState>
            <MoneyCardState
              label="Club member payments"
              state={commercialCards.memberPayments}
              href="/admin/clubs"
            >
              {(d) => ({
                value: formatMoney(d.collectedLast30dPence),
                // Clubs connected comes from the same authorized adoption read
                // the Adoption section uses, so the two can never disagree. If
                // that read failed, the clause is dropped rather than guessed.
                detail:
                  trends.state === "ok"
                    ? `Collected, last 30 days · ${trends.data.adoption.withMemberPayments} clubs taking member payments`
                    : "Collected, last 30 days",
              })}
            </MoneyCardState>
            <MoneyCardState
              label="Referrals & rewards"
              state={commercialCards.referrals}
              href="/admin/commercial/referrals"
            >
              {(d) => ({
                // The offer is a free month, so that is what the card leads
                // with. The pence figure is how the month is implemented in
                // the ledger, not the promise, and belongs in the detail.
                value:
                  d.freeMonthsEarned === 1 ? "1 free month" : `${d.freeMonthsEarned} free months`,
                detail: `Earned · ${d.activated} of ${d.total} referred clubs activated`,
              })}
            </MoneyCardState>
          </div>
        </DashboardSection>
      )}

      {/* ---------- 9. referral intelligence (F1) ---------- */}
      {referralIntelligence && (
        <DashboardSection
          title="Referral intelligence"
          description="Ranked by clubs actually activated, not invitations sent -- during Beta a paid conversion is real when it happens, never assumed."
          action={{ href: "/admin/commercial/referrals", label: "Referral Administration" }}
        >
          {referralIntelligence.state === "error" ? (
            <SectionError what="Referral intelligence" message={referralIntelligence.message} />
          ) : referralIntelligence.state === "unauthorized" ? (
            <SectionUnauthorized what="Referral intelligence" />
          ) : referralIntelligence.state === "ok" ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-ink/10 bg-white p-5">
              <h3 className="text-sm font-semibold text-ink">Referral funnel</h3>
              <ul className="mt-3 flex flex-col gap-2">
                {referralIntelligence.data.funnel.map((stage) => (
                  <li key={stage.key} className="flex flex-col gap-0.5 text-sm">
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-ink/80">{stage.label}</span>
                      <span className="font-mono text-ink tabular-nums">{stage.count}</span>
                    </span>
                    {stage.note ? <span className="text-xs text-ink-muted">{stage.note}</span> : null}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg border border-ink/10 bg-white p-5">
              <h3 className="text-sm font-semibold text-ink">Top referring clubs</h3>
              {referralIntelligence.data.topClubs.length === 0 ? (
                <p className="mt-3 text-sm text-ink-muted">No referrals yet.</p>
              ) : (
                <ol className="mt-3 flex flex-col gap-2">
                  {referralIntelligence.data.topClubs.map((c, i) => (
                    <li key={c.clubId} className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-ink/80">
                        {i + 1}. {c.clubName}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-ink-muted tabular-nums">
                        {c.clubsActivated} activated · {formatMoney(c.rewardEarnedPence)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="rounded-lg border border-ink/10 bg-white p-5 lg:col-span-2">
              <h3 className="text-sm font-semibold text-ink">Live referral activity</h3>
              {referralIntelligence.data.activity.length === 0 ? (
                <p className="mt-3 text-sm text-ink-muted">No referral activity yet.</p>
              ) : (
                <ul className="mt-3 flex flex-col gap-2">
                  {referralIntelligence.data.activity.slice(0, 8).map((event) => (
                    <li key={event.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-ink/80">{event.detail}</span>
                      <span className="shrink-0 text-xs text-ink-muted tabular-nums">{formatRelativeDate(event.occurredAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-lg border border-ink/10 bg-white p-5 lg:col-span-2">
              <h3 className="text-sm font-semibold text-ink">Referral rewards</h3>
              <p className="mt-1 text-xs text-ink-muted">
                The offer is one month of the referring club&rsquo;s own plan, free, once a referred club&rsquo;s
                first subscription payment is collected. Months are counted from qualifying referrals, never
                divided out of a credit balance.
              </p>

              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                <RewardFigure
                  label="Free months earned"
                  value={String(referralIntelligence.data.reward.freeMonthsEarned)}
                />
                <RewardFigure
                  label="Withdrawn"
                  value={String(referralIntelligence.data.reward.freeMonthsWithdrawn)}
                  hint="Payment later reversed"
                />
                <RewardFigure
                  label="Value earned"
                  value={formatMoney(referralIntelligence.data.reward.rewardEarnedPence)}
                  hint="Snapshotted at earning"
                />
                <RewardFigure
                  label="Value withdrawn"
                  value={formatMoney(referralIntelligence.data.reward.rewardWithdrawnPence)}
                />
              </dl>

              <div className="mt-5 border-t border-ink/8 pt-4">
                <p className="text-xs font-medium text-ink/70">Club credit ledger — all sources pooled</p>
                <dl className="mt-2.5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                  <RewardFigure
                    label="Applied"
                    value={formatMoney(referralIntelligence.data.reward.ledgerAppliedPence)}
                    hint="Against collections"
                  />
                  <RewardFigure
                    label="Outstanding"
                    value={formatMoney(referralIntelligence.data.reward.ledgerOutstandingPence)}
                    hint="Balance remaining"
                  />
                </dl>
                <p className="mt-3 text-xs text-ink-muted">
                  Applied and outstanding are ledger-wide: a credit balance can mix referral rewards with
                  goodwill and beta adjustments, and spending it writes one pooled entry rather than
                  decrementing a particular reward. So <strong>months</strong> applied and remaining are not
                  derivable per referral and are deliberately not shown — only the money is exact.
                </p>
              </div>

              {referralIntelligence.data.reward.unverifiedRewardCount > 0 && (
                <div role="alert" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
                  <p className="text-sm font-medium text-amber-950">
                    {referralIntelligence.data.reward.unverifiedRewardCount} reward
                    {referralIntelligence.data.reward.unverifiedRewardCount === 1 ? "" : "s"} cannot be
                    verified
                  </p>
                  <p className="mt-1 text-sm text-amber-900">
                    The value above includes a reward whose recorded amount does not match the plan price it
                    snapshotted, so it may not be money that actually moved.
                  </p>
                  <Link
                    href="/admin/commercial/referrals/data-health"
                    className="mt-1.5 inline-block text-xs font-medium text-amber-900 underline underline-offset-2"
                  >
                    View reward integrity detail
                  </Link>
                </div>
              )}
            </div>
          </div>
          ) : null}
        </DashboardSection>
      )}
    </div>
  )
}

/**
 * A money card that knows it might not have a number.
 *
 * The dashboard's founding rule applied to the smallest surface on it: a
 * read failure renders as a visible failure, never as a confident "£0" a
 * Site Admin would take for a business fact. The render callback only ever
 * runs on the "ok" branch, so there is no path where an error state can
 * reach the money formatter at all.
 */
function MoneyCardState<T>({
  label,
  state,
  href,
  children,
}: {
  label: string
  state: ReadState<T>
  href: string
  children: (data: T) => { value: string; detail: string }
}) {
  if (state.state === "ok") {
    const { value, detail } = children(state.data)
    return <MoneyCard label={label} value={value} detail={detail} href={href} />
  }

  const isDenied = state.state === "unauthorized"
  return (
    <div
      role={isDenied ? undefined : "alert"}
      className={`rounded-lg border px-5 py-4 ${
        isDenied ? "border-ink/10 bg-white" : "border-amber-300 bg-amber-50"
      }`}
    >
      <p className={`text-sm ${isDenied ? "text-ink-muted" : "text-amber-900"}`}>{label}</p>
      <p className={`mt-1 text-sm font-medium ${isDenied ? "text-ink" : "text-amber-950"}`}>
        {isDenied ? "Not available to your Site Admin profile" : "Could not be loaded"}
      </p>
      {state.state === "error" ? (
        <p className="mt-1 font-mono text-xs break-words text-amber-900/80">{state.message}</p>
      ) : null}
      {state.state === "omitted" ? (
        <p className="mt-1 text-xs text-ink-muted">{state.reason}</p>
      ) : null}
      {!isDenied && state.state === "error" ? (
        <p className="mt-1 text-xs text-amber-900/80">This is a read failure, not a zero.</p>
      ) : null}
    </div>
  )
}

/**
 * dt/dd are returned as siblings, not wrapped in a div carrying a stray <p>.
 * A <dl> may only directly contain dt/dd groups, and axe flags anything else
 * -- which breaks the term/definition pairing a screen reader relies on. The
 * hint therefore lives inside the <dd> it qualifies.
 */
function RewardFigure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <>
      <dt className="sr-only">{label}</dt>
      <dd className="min-w-0">
        <span className="block text-xs text-ink/60">{label}</span>
        <span className="mt-0.5 block font-mono text-lg text-ink tabular-nums">{value}</span>
        {hint ? <span className="mt-0.5 block text-xs text-ink-muted">{hint}</span> : null}
      </dd>
    </>
  )
}

function MoneyCard({ label, value, detail, href }: { label: string; value: string; detail: string; href: string }) {
  return (
    <Link
      href={href}
      className="group block rounded-lg border border-ink/10 bg-white px-5 py-4 outline-none transition-colors hover:border-forest-800/30 focus-visible:ring-2 focus-visible:ring-pitch-400"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-ink-muted">{label}</p>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-muted transition-colors group-hover:text-forest-800" />
      </div>
      <p className="mt-3 font-display text-3xl leading-none text-ink tabular-nums">{value}</p>
      <p className="mt-2 text-xs text-ink-muted">{detail}</p>
    </Link>
  )
}

function formatMoney(pence: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 }).format(pence / 100)
}

function formatRelativeDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  return `${days}d ago`
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
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-muted" />
        <div>
          <p className="text-sm font-medium text-ink">Commercial data not shown</p>
          <p className="mt-1 text-sm text-ink-muted">{commercial.reason}</p>
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
        <p className="text-sm text-ink-muted">Referral data health</p>
        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.chip}`}>
          {c.referralHealthStatus}
        </span>
      </div>

      <p className="mt-2 text-sm text-ink/70">{tone.explanation}</p>

      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-ink/8 pt-3">
        <div>
          <dt className="text-xs text-ink-muted">Referrals</dt>
          <dd className="mt-0.5 font-display text-xl text-ink tabular-nums">
            {c.referralsTotal.toLocaleString("en-GB")}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Clubs on Ovalball</dt>
          <dd className="mt-0.5 font-display text-xl text-ink tabular-nums">
            {(c.referralsRegistered + c.referralsQualified).toLocaleString("en-GB")}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Paid conversions</dt>
          <dd className="mt-0.5 font-display text-xl text-ink tabular-nums">
            {c.referralsQualified.toLocaleString("en-GB")}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-xs text-ink-muted">
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

function formatWeek(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

/**
 * The first five fixtures playing today.
 *
 * Club and team identity come from the season-aware canonical resolver, and
 * nothing here is player data. Each row drills into the existing Site Admin
 * fixture detail page rather than a second implementation of it.
 */
function FixturesTodayList({ rows, total }: { rows: FixtureTodayRow[]; total: number | null }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8">
        <p className="text-sm font-medium text-ink">No fixtures playing today</p>
        <p className="mt-1 text-sm text-ink-muted">
          Fixtures kicking off today appear here, earliest first.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-ink/10 bg-white">
      <ul className="divide-y divide-ink/8">
        {rows.map((f) => (
          <li key={f.fixtureId}>
            <Link
              href={`/admin/fixtures/${f.fixtureId}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 outline-none transition-colors hover:bg-ink/[0.02] focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-inset"
            >
              <span className="w-12 shrink-0 font-mono text-sm text-ink/70 tabular-nums">
                {f.kickoffTime ? f.kickoffTime.slice(0, 5) : "TBD"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">
                  {f.homeClub} {f.homeTeam} <span className="text-ink-muted">v</span> {f.awayClub}{" "}
                  {f.awayTeam}
                </span>
                <span className="block truncate text-xs text-ink-muted">
                  {[f.competition, f.venue, f.rugbyCode === "league" ? "League" : "Union"]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-ink/5 px-2.5 py-0.5 text-xs font-medium text-ink/60">
                {f.status}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {total !== null && total > rows.length ? (
        <Link
          href="/admin/fixtures"
          className="flex items-center gap-1 border-t border-ink/8 px-5 py-3 text-sm font-medium text-forest-800 underline underline-offset-4 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          View all {total} fixtures today
          <ChevronRight aria-hidden="true" className="size-3.5" />
        </Link>
      ) : null}
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
