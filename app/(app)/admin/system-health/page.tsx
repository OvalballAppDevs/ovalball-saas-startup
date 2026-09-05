import { redirect } from "next/navigation"
import { ShieldCheck } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { AUTH_SESSION_VERSION } from "@/lib/auth/session-version"
import { createClient } from "@/lib/supabase/server"
import { APP_BUILD_SHA, APP_VERSION } from "@/lib/version"

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
    </div>
  )
}
