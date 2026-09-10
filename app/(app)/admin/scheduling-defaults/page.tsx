import { redirect } from "next/navigation"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { createClient } from "@/lib/supabase/server"

import { PlatformSchedulingDefaultsForm } from "./defaults-form"

export const dynamic = "force-dynamic"
export const metadata = { title: "Pitch Allocation Defaults" }

/**
 * PLATFORM-WIDE PITCH ALLOCATION DEFAULTS.
 *
 * Lives in Rugby Operations, alongside Fixture Management, Competitions and
 * Seasons -- it is a rugby operational default, not a club setting and not a
 * system/release control. Deliberately NOT in Club Settings: a club's own
 * Pitch Allocation page sets that club's override, and this sets what every
 * club without one inherits.
 *
 * READ BY ANY SITE ADMIN, CHANGED BY A FULL ONE. Knowing what the platform
 * currently reserves is ordinary operational context; changing a value that
 * reaches every club on the platform is not. The page offers the controls
 * accordingly, and public.set_platform_scheduling_defaults re-checks
 * internal.is_full_site_admin() server-side regardless -- the disabled select
 * is a courtesy, never the protection.
 */
export default async function PlatformSchedulingDefaultsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Site Admin route-family guard: requires BOTH real Site Admin authority AND
  // that the account has actively switched into Site Admin as its operating
  // context, so somebody who also runs a club cannot reach this while
  // operating as that club.
  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok) redirect("/dashboard")

  const canEdit = activeSiteAdmin.ctx.siteAdminRole === "full"

  const { data: defaults } = await supabase
    .from("platform_scheduling_defaults")
    .select("warm_up_minutes, pack_up_minutes")
    .maybeSingle()

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Rugby Operations</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Pitch Allocation Defaults</h1>
      <p className="mt-2 max-w-xl text-sm text-ink-muted">
        What every club starts from when scheduling pitches, until it sets its own times.
      </p>

      <div className="mt-8">
        <PlatformSchedulingDefaultsForm
          initial={{
            warmUpMinutes: defaults?.warm_up_minutes ?? 0,
            packUpMinutes: defaults?.pack_up_minutes ?? 0,
          }}
          canEdit={canEdit}
        />
      </div>
    </div>
  )
}
