import { redirect } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

/**
 * Reuses referral_data_health_detail() verbatim (spec B9) -- no new
 * anomaly detection, no silently hiding a real finding behind a zero count.
 */
export default async function ReferralDataHealthPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok) redirect("/dashboard")
  if (!(await hasCapability(supabase, "site.commercial.view", "site"))) redirect("/dashboard")

  const { data: rows, error } = await supabase.rpc("referral_data_health_detail")

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8 md:py-12">
      <Link href="/admin/commercial/referrals" className="inline-flex items-center gap-1.5 text-sm text-ink/55 hover:text-ink/80">
        <ArrowLeft className="size-3.5" /> Referral Administration
      </Link>
      <h1 className="mt-2 font-display text-display-l text-ink">Referral Data Health</h1>
      <p className="mt-2 max-w-xl text-sm text-ink/55">
        Every row below is a real finding from reconcile_referral_attribution -- never hidden behind a zero count.
      </p>

      <div className="mt-6">
        {error ? (
          /* The page above promises findings are "never hidden behind a zero
             count". Rendering "No anomalies found." when the check itself
             failed would break that promise in the most dangerous direction:
             a false all-clear on a data-integrity screen. */
          <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-5 py-4">
            <p className="text-sm font-medium text-amber-950">The data-health check could not be run</p>
            <p className="mt-1 text-sm text-amber-900">
              This is not an all-clear. Whether there are anomalies is currently unknown. Refresh to try
              again.
            </p>
            <p className="mt-1.5 font-mono text-xs break-words text-amber-900/80">{error.message}</p>
          </div>
        ) : !rows || rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-ink/15 px-5 py-8 text-center text-sm text-ink/55">
            No anomalies found.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row, i) => (
              <li key={i} className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3.5">
                <p className="text-sm font-medium text-destructive">{row.category.replace(/_/g, " ")}</p>
                <p className="mt-1 text-sm text-ink/80">{row.finding}</p>
                {row.club_name && (
                  <p className="mt-1 text-xs text-ink/55">
                    Club:{" "}
                    {row.club_id ? (
                      <Link href={`/admin/clubs/${row.club_id}`} className="font-medium text-forest-800 underline underline-offset-2">
                        {row.club_name}
                      </Link>
                    ) : (
                      row.club_name
                    )}
                  </p>
                )}
                {row.detail && <p className="mt-1 text-xs text-ink/50">{row.detail}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
