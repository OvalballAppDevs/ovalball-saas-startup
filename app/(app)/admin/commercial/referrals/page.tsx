import { redirect } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

type ReferralStatus = "pending" | "registered" | "qualified" | "rejected" | "reversed"

const STATUS_LABELS: Record<ReferralStatus, string> = {
  pending: "Pending",
  registered: "Registered",
  qualified: "Qualified",
  rejected: "Rejected",
  reversed: "Reversed",
}

/**
 * Dashboard R-5 -- the canonical operational drill-through for referral
 * administration. One source of truth: admin_referral_overview (a
 * security_invoker view over platform_referrals, joined to the real chain
 * -- invitation, referring/referred club, qualifying payment). The referrer
 * and reward beneficiary are always THE REFERRING CLUB, never a person --
 * no profile/user name appears anywhere on this page.
 *
 * Beta semantics: with SaaS billing not currently collecting, "qualified"
 * (a real paid first collection) is possible but rare -- the honest
 * headline metric right now is "referred clubs activated"
 * (status IN ('registered','qualified')), never invitations sent alone.
 */
export default async function ReferralAdministrationPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok) redirect("/dashboard")

  if (!(await hasCapability(supabase, "site.commercial.view", "site"))) {
    redirect("/dashboard")
  }

  let query = supabase.from("admin_referral_overview").select("*").order("created_at", { ascending: false })
  if (params.status && ["pending", "registered", "qualified", "rejected", "reversed"].includes(params.status)) {
    query = query.eq("status", params.status)
  }
  if (params.q?.trim()) {
    const q = `%${params.q.trim()}%`
    query = query.or(`referring_club_name.ilike.${q},referred_club_name.ilike.${q}`)
  }

  const [{ data: referrals }, { data: healthRows }] = await Promise.all([
    query,
    supabase.rpc("referral_data_health").then((r) => ({ data: r.data?.[0] ?? null })),
  ])

  const rows = referrals ?? []
  const activated = rows.filter((r) => r.status === "registered" || r.status === "qualified").length
  const qualified = rows.filter((r) => r.status === "qualified")
  const rewardEarnedPence = qualified.reduce((sum, r) => sum + (r.reward_amount_pence ?? 0), 0)
  const rewardReversedPence = qualified.filter((r) => r.reward_reversed).reduce((sum, r) => sum + (r.reward_amount_pence ?? 0), 0)

  const anomalyCount = healthRows
    ? healthRows.missing_attribution +
      healthRows.pending_for_activated_club +
      healthRows.ambiguous_referrer +
      healthRows.qualified_without_reward +
      healthRows.reward_without_referral +
      healthRows.duplicate_attribution
    : 0

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-12">
      <Link href="/admin/commercial" className="inline-flex items-center gap-1.5 text-sm text-ink/55 hover:text-ink/80">
        <ArrowLeft className="size-3.5" /> Commercial
      </Link>
      <h1 className="mt-2 font-display text-display-l text-ink">Referral Administration</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink/55">
        The canonical referral chain: an invited club, the club that referred it, and what it earned. The
        reward beneficiary is always the referring club, never a person.
      </p>

      <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong className="font-semibold">Beta:</strong> Ovalball SaaS billing is not currently collecting, so a real
        paid qualifying conversion is possible but rare. Referral success is ranked by clubs actually activated on
        Ovalball, not invitations sent.
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total referrals" value={String(rows.length)} />
        <Stat label="Referred clubs activated" value={String(activated)} />
        <Stat label="Reward £ earned" value={formatMoney(rewardEarnedPence)} />
        <Stat label="Reward £ reversed" value={formatMoney(rewardReversedPence)} />
      </div>

      {anomalyCount > 0 && (
        <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3.5">
          <p className="text-sm font-medium text-destructive">
            {anomalyCount} data-health {anomalyCount === 1 ? "anomaly" : "anomalies"} found
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-destructive/80">
            {healthRows?.missing_attribution ? <li>{healthRows.missing_attribution} missing attribution</li> : null}
            {healthRows?.pending_for_activated_club ? <li>{healthRows.pending_for_activated_club} pending for an activated club</li> : null}
            {healthRows?.ambiguous_referrer ? <li>{healthRows.ambiguous_referrer} ambiguous referrer</li> : null}
            {healthRows?.qualified_without_reward ? <li>{healthRows.qualified_without_reward} qualified without a reward</li> : null}
            {healthRows?.reward_without_referral ? <li>{healthRows.reward_without_referral} reward without a referral</li> : null}
            {healthRows?.duplicate_attribution ? <li>{healthRows.duplicate_attribution} duplicate attribution</li> : null}
          </ul>
          <Link href="/admin/commercial/referrals/data-health" className="mt-2 inline-block text-xs font-medium text-destructive underline underline-offset-2">
            View anomaly detail
          </Link>
        </div>
      )}

      <form className="mt-6 flex flex-wrap items-end gap-3" action="/admin/commercial/referrals">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-ink/70">Search club</span>
          <input
            type="text"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Referring or referred club"
            className="h-10 w-56 rounded-md border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-ink/70">Status</span>
          <select
            name="status"
            defaultValue={params.status ?? ""}
            className="h-10 rounded-md border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
          >
            <option value="">All</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-10 rounded-md border border-ink/15 bg-white px-4 text-sm font-medium text-ink hover:border-ink/30">
          Filter
        </button>
      </form>

      <section className="mt-6">
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-ink/15 px-5 py-8 text-center text-sm text-ink/55">
            No referrals match this filter.
          </p>
        ) : (
          <>
            <div className="hidden overflow-x-auto rounded-lg border border-ink/10 bg-white md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-left text-xs text-ink/55">
                    <th scope="col" className="px-5 py-3 font-medium">Referring club</th>
                    <th scope="col" className="px-5 py-3 font-medium">Referred club</th>
                    <th scope="col" className="px-5 py-3 font-medium">Status</th>
                    <th scope="col" className="px-5 py-3 font-medium">Invited</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Reward £</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/8">
                  {rows.map((r) => (
                    <tr key={r.referral_id}>
                      <td className="px-5 py-3.5 text-ink">{r.referring_club_name}</td>
                      <td className="px-5 py-3.5 text-ink/70">{r.referred_club_name ?? "—"}</td>
                      <td className="px-5 py-3.5">
                        <StatusPill status={r.status as ReferralStatus} />
                      </td>
                      <td className="px-5 py-3.5 text-ink/70 tabular-nums">{formatDate(r.invitation_created_at ?? r.created_at)}</td>
                      <td className="px-5 py-3.5 text-right text-ink/70 tabular-nums">
                        {r.reward_amount_pence ? formatMoney(r.reward_amount_pence) : "—"}
                        {r.reward_reversed && <span className="ml-1 text-xs text-destructive">(reversed)</span>}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <Link href={`/admin/commercial/referrals/${r.referral_id}`} className="text-xs font-medium text-forest-800 underline underline-offset-2">
                          Detail
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="space-y-2 md:hidden">
              {rows.map((r) => (
                <li key={r.referral_id} className="rounded-lg border border-ink/10 bg-white px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-ink">{r.referring_club_name}</p>
                    <StatusPill status={r.status as ReferralStatus} />
                  </div>
                  <p className="mt-1 text-xs text-ink/55">Referred: {r.referred_club_name ?? "—"}</p>
                  <dl className="mt-2 space-y-1 text-xs text-ink/60">
                    <div className="flex justify-between gap-3">
                      <dt>Invited</dt>
                      <dd className="tabular-nums text-ink/80">{formatDate(r.invitation_created_at ?? r.created_at)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Reward</dt>
                      <dd className="tabular-nums text-ink/80">
                        {r.reward_amount_pence ? formatMoney(r.reward_amount_pence) : "—"}
                        {r.reward_reversed && " (reversed)"}
                      </dd>
                    </div>
                  </dl>
                  <Link href={`/admin/commercial/referrals/${r.referral_id}`} className="mt-2 inline-block text-xs font-medium text-forest-800 underline underline-offset-2">
                    View detail
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <p className="text-xs font-medium tracking-[0.04em] text-ink/45 uppercase">{label}</p>
      <p className="mt-1 text-lg font-semibold text-ink tabular-nums">{value}</p>
    </div>
  )
}

function StatusPill({ status }: { status: ReferralStatus }) {
  const toneClass =
    status === "qualified"
      ? "bg-mint-100 text-forest-950"
      : status === "registered"
        ? "bg-pitch-600/10 text-forest-900"
        : status === "pending"
          ? "bg-ink/5 text-ink/60"
          : "bg-destructive/10 text-destructive"
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClass}`}>{STATUS_LABELS[status]}</span>
}

function formatMoney(pence: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 }).format(pence / 100)
}

function formatDate(value: string | null): string {
  if (!value) return "—"
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}
