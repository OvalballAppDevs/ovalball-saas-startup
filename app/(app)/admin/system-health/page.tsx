import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronRight, ShieldCheck } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { AUTH_SESSION_VERSION } from "@/lib/auth/session-version"
import { getBetaBadgeState, getPlatformMode } from "@/lib/platform/mode"
import { createClient } from "@/lib/supabase/server"
import { APP_BUILD_SHA, APP_VERSION } from "@/lib/version"
import { BetaBadge } from "@/components/platform/beta-badge"

/**
 * Read-only build/release metadata -- no secrets, no connection strings,
 * no service-role keys, nothing an attacker could use. Full Site Admin
 * only (matches how narrowly the other admin-console-specific surfaces
 * are gated in this app) since it's still internal operational detail,
 * not something every Site Admin profile needs.
 */
export default async function SystemHealthPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Site Admin route-family guard (addendum): active context must also be
  // Site Admin, not merely account-held authority -- see
  // requireActiveSiteAdmin()'s own doc comment.
  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok || activeSiteAdmin.ctx.siteAdminRole !== "full") redirect("/dashboard")

  // System state, read from the SAME canonical resolvers the rest of the
  // product uses. This card answers "what is the system doing" without
  // duplicating Release Management: there is no mutation here, only the
  // answer and a way through to the one page that owns the action.
  const [platformMode, badgeState] = await Promise.all([getPlatformMode(supabase), getBetaBadgeState(supabase)])
  const inBeta = platformMode.mode === "beta"

  const rows = [
    { label: "Application", value: `v${APP_VERSION}` },
    { label: "Build", value: APP_BUILD_SHA },
    { label: "Environment", value: process.env.NODE_ENV === "production" ? "Production" : "Local / Development" },
    { label: "Auth Session Version", value: String(AUTH_SESSION_VERSION) },
  ]

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <ShieldCheck className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">System Health</h1>
      <p className="mt-2 max-w-lg text-sm text-ink/55">
        Release and build information. An ordinary deploy never invalidates existing sessions --
        only a deliberate Auth Session Version increase does.
      </p>

      <dl className="mt-8 divide-y divide-ink/8 rounded-lg border border-ink/10 bg-white">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between px-5 py-3.5">
            <dt className="text-sm text-ink/55">{r.label}</dt>
            <dd className="font-mono text-sm text-ink">{r.value}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-8">
        <h2 className="font-display text-xl text-ink">Platform state</h2>
        <p className="mt-1 text-sm text-ink/55">
          Whether Ovalball is charging clubs. Managed on Release &amp; Platform Mode &mdash; this
          card only reports it.
        </p>

        <dl className="mt-4 divide-y divide-ink/8 rounded-lg border border-ink/10 bg-white">
          <div className="flex items-center justify-between gap-4 px-5 py-3.5">
            <dt className="text-sm text-ink/55">Platform mode</dt>
            <dd>
              {inBeta ? (
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
            <dd className="font-mono text-sm text-ink">{badgeState.releaseVersion ?? "None published"}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 px-5 py-3.5">
            <dt className="text-sm text-ink/55">Billing</dt>
            <dd className={`text-sm ${inBeta ? "text-purple-900" : "text-ink"}`}>
              {inBeta ? "Paused — Beta" : "Active"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4 px-5 py-3.5">
            <dt className="text-sm text-ink/55">Trials</dt>
            <dd className={`text-sm ${inBeta ? "text-purple-900" : "text-ink"}`}>
              {inBeta ? "Paused — Beta" : "Active"}
            </dd>
          </div>
        </dl>

        {/* A link, never a second copy of the mutation. One canonical
            action, on one page. */}
        <Link
          href="/admin/releases"
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-forest-800 underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          Manage Release &amp; Platform Mode
          <ChevronRight aria-hidden="true" className="size-3.5" />
        </Link>
      </section>
    </div>
  )
}
