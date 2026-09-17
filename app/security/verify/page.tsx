import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { OvalballLogo } from "@/components/brand/ovalball-logo"
import { createClient } from "@/lib/supabase/server"

import { VerifyFlow } from "./verify-flow"

export const metadata: Metadata = { title: "Enter Your Code" }

/** Outside the (app) group for the same reason as enrolment: an AAL1 session has to be able to reach it. */
export default async function VerifyPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login?next=/security/verify")

  const { data: factors } = await supabase.auth.mfa.listFactors()
  const totp = (factors?.totp ?? []).filter((f) => f.status === "verified")
  // Nothing to present. Sending them to enrolment is the only useful answer.
  if (totp.length === 0) redirect("/security/enrol")

  return (
    <main className="brand-light-scope min-h-screen bg-chalk">
      <div className="border-b border-ink/8 px-4 py-5 md:px-8">
        <Link href="/">
          <OvalballLogo variant="light" />
        </Link>
      </div>
      <div className="mx-auto max-w-lg px-4 py-12 md:py-20">
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Account security</p>
        <h1 className="mt-2 font-display text-display-l text-ink">Enter your code</h1>
        <p className="mt-3 text-base text-ink/60">
          Open your authenticator app and enter the six-digit code it shows for Ovalball.
        </p>
        <VerifyFlow factorId={totp[0].id} />
      </div>
    </main>
  )
}
