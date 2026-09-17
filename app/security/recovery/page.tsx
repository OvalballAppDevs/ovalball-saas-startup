import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { OvalballLogo } from "@/components/brand/ovalball-logo"
import { createClient } from "@/lib/supabase/server"

import { RecoveryFlow } from "./recovery-flow"

export const metadata: Metadata = { title: "Use a Recovery Code" }

export default async function RecoveryPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login?next=/security/recovery")

  return (
    <main className="brand-light-scope min-h-screen bg-chalk">
      <div className="border-b border-ink/8 px-4 py-5 md:px-8">
        <Link href="/">
          <OvalballLogo variant="light" />
        </Link>
      </div>
      <div className="mx-auto max-w-lg px-4 py-12 md:py-20">
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Account security</p>
        <h1 className="mt-2 font-display text-display-l text-ink">Use a recovery code</h1>
        <p className="mt-3 text-base text-ink/60">
          Enter one of the codes you saved when you set up your authenticator. Each one works once. Using
          it removes your current authenticator, and you&rsquo;ll set up a new one straight away.
        </p>
        <RecoveryFlow />
      </div>
    </main>
  )
}
