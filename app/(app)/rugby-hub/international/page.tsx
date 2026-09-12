import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getInternationalBundle } from "@/lib/app-context/international-data"
import type { RugbyCode } from "@/lib/app-context/international-types"
import { createClient } from "@/lib/supabase/server"
import { InternationalLanding } from "@/components/rugby-hub/international/international-landing"

export const metadata: Metadata = {
  title: "International Rugby | Rugby Hub",
  description: "The major international rugby teams and competitions — the Rugby World Cup, the Six Nations, the British & Irish Lions and more, explained in plain language.",
}

function parseCode(value: string | undefined): "all" | RugbyCode {
  return value === "union" || value === "league" ? value : "all"
}

export default async function InternationalRugbyPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const bundle = await getInternationalBundle(supabase)

  return (
    <div>
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Rugby Hub</p>
      <h1 className="mt-3 font-display text-display-l text-ink">International Rugby</h1>
      <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink/80">
        Who the major international teams are, what the Rugby World Cup and the Six Nations are, who the British &amp; Irish Lions are, and what teams have actually won — the game&apos;s
        biggest stage, explained in plain language.
      </p>

      <div className="mt-8">
        <InternationalLanding bundle={bundle} activeCode={parseCode(code)} />
      </div>
    </div>
  )
}
