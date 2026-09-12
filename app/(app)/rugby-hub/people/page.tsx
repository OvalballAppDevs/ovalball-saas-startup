import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getPeopleBundle } from "@/lib/app-context/people-data"
import { createClient } from "@/lib/supabase/server"
import { PeopleLanding } from "@/components/rugby-hub/people/people-landing"

export const metadata: Metadata = {
  title: "People & Rugby Legends | Rugby Hub",
  description: "The players, coaches, referees and pioneers who have shaped rugby union and rugby league — who they are and what they achieved, explained in plain language.",
}

export default async function PeoplePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const bundle = await getPeopleBundle(supabase)

  return (
    <div>
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Rugby Hub</p>
      <h1 className="mt-3 font-display text-display-l text-ink">People &amp; Rugby Legends</h1>
      <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink/80">
        Who some of rugby&apos;s most significant players, coaches, referees and pioneers are, what they achieved, and how their stories connect to the teams, competitions and history you can
        explore elsewhere in Rugby Hub.
      </p>

      <div className="mt-8">
        <PeopleLanding bundle={bundle} />
      </div>
    </div>
  )
}
