import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getParentsBundle } from "@/lib/app-context/parents-data"
import { createClient } from "@/lib/supabase/server"
import { ParentsLanding } from "@/components/rugby-hub/parents/parents-landing"

export const metadata: Metadata = {
  title: "Parents & Guardians | Rugby Hub",
  description: "Rugby explained for the adults supporting a player — what happens first, what to expect at training and on match day, contact and welfare, and where the official guidance lives.",
}

export default async function ParentsAndGuardiansPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const bundle = await getParentsBundle(supabase)

  return (
    <div>
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Rugby Hub</p>
      <h1 className="mt-3 font-display text-display-l text-ink">Parents &amp; Guardians</h1>
      <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink/80">
        Rugby explained for the adult standing at the side of it. What happens first, what your player needs, what training and match day actually involve, and how to be useful — whether or not you
        have ever played.
      </p>

      <div className="mt-8">
        <ParentsLanding bundle={bundle} />
      </div>
    </div>
  )
}
