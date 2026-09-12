import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getOfficiatingBundle } from "@/lib/app-context/officiating-data"
import { createClient } from "@/lib/supabase/server"
import { OfficiatingLanding } from "@/components/rugby-hub/officiating/officiating-landing"

export const metadata: Metadata = {
  title: "Officiating & Respect the Referee | Rugby Hub",
  description: "Who match officials are, what they're looking for, why decisions happen, and how to support them.",
}

export default async function OfficiatingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const bundle = await getOfficiatingBundle(supabase)

  return (
    <div>
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Rugby Hub</p>
      <h1 className="mt-3 font-display text-display-l text-ink">Officiating & Respect the Referee</h1>
      <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink/80">
        Who match officials are, what they&apos;re looking for when they make a decision, and how players, captains, coaches, parents and
        spectators should treat them.
      </p>

      <div className="mt-8">
        <OfficiatingLanding bundle={bundle} />
      </div>
    </div>
  )
}
