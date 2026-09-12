import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getCompetitionBundle } from "@/lib/app-context/teams-competitions-data"
import type { RugbyCode } from "@/lib/app-context/teams-competitions-types"
import { createClient } from "@/lib/supabase/server"
import { CompetitionsLanding } from "@/components/rugby-hub/competitions/competitions-landing"

export const metadata: Metadata = {
  title: "Teams & Competitions | Rugby Hub",
  description: "How rugby's teams, clubs and competitions fit together — what Premiership Rugby, Super League and the Challenge Cup actually are, and how league tables and promotion work.",
}

function parseCode(value: string | undefined): "all" | RugbyCode {
  return value === "union" || value === "league" ? value : "all"
}

export default async function CompetitionsPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const bundle = await getCompetitionBundle(supabase)

  return (
    <div>
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Rugby Hub</p>
      <h1 className="mt-3 font-display text-display-l text-ink">Teams & Competitions</h1>
      <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink/80">
        What a club and a team actually are, how league tables and promotion work, and what competitions like Premiership Rugby, Super League and the Challenge Cup are — the sport&apos;s
        wider structure, explained in plain language.
      </p>

      <div className="mt-8">
        <CompetitionsLanding bundle={bundle} activeCode={parseCode(code)} />
      </div>
    </div>
  )
}
