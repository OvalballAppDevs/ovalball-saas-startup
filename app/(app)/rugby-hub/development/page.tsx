import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getDevelopmentBundle } from "@/lib/app-context/development-data"
import type { RugbyCode } from "@/lib/app-context/development-types"
import { createClient } from "@/lib/supabase/server"
import { DevelopmentLanding } from "@/components/rugby-hub/development/development-landing"

export const metadata: Metadata = {
  title: "Player Development | Rugby Hub",
  description: "How learning rugby actually works — the ideas above the individual skills, explained in plain language for players, parents and new coaches.",
}

function parseCode(value: string | undefined): "all" | RugbyCode {
  return value === "union" || value === "league" ? value : "all"
}

export default async function PlayerDevelopmentPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const bundle = await getDevelopmentBundle(supabase)

  return (
    <div>
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Rugby Hub</p>
      <h1 className="mt-3 font-display text-display-l text-ink">Player Development</h1>
      <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink/80">
        Skills teach you how to do a thing. This is the layer above: what you are actually learning, why rugby is taught in stages, and how getting better tends to work. Nothing here scores, ranks or
        tracks anybody.
      </p>

      <div className="mt-8">
        <DevelopmentLanding bundle={bundle} activeCode={parseCode(code)} />
      </div>
    </div>
  )
}
