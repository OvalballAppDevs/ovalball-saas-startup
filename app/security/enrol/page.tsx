import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { OvalballLogo } from "@/components/brand/ovalball-logo"
import { createClient } from "@/lib/supabase/server"

import { EnrolFlow } from "./enrol-flow"

export const metadata: Metadata = { title: "Set Up Your Authenticator" }

/**
 * DELIBERATELY OUTSIDE THE (app) GROUP.
 *
 * Phase 2 F lists what an AAL1 session may still do, and enrolling a second factor is on that list --
 * it has to be, or a person required to have MFA could never get it. Putting this page inside the
 * authenticated app layout would put it behind the very gate it exists to let people through.
 */
export default async function EnrolPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login?next=/security/enrol")

  return (
    <main className="brand-light-scope min-h-screen bg-chalk">
      <div className="border-b border-ink/8 px-4 py-5 md:px-8">
        <Link href="/">
          <OvalballLogo variant="light" />
        </Link>
      </div>
      <div className="mx-auto max-w-lg px-4 py-12 md:py-20">
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Account security</p>
        <h1 className="mt-2 font-display text-display-l text-ink">Set up your authenticator</h1>
        <p className="mt-3 text-base text-ink/60">
          An authenticator app generates a six-digit code that changes every 30 seconds. You&rsquo;ll be
          asked for one when you sign in, so a stolen password is not enough to reach your club&rsquo;s
          information.
        </p>
        <EnrolFlow />
      </div>
    </main>
  )
}
