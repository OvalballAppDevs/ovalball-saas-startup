import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getClubsBundle } from "@/lib/app-context/clubs-data"
import type { RugbyCode } from "@/lib/app-context/clubs-types"
import { createClient } from "@/lib/supabase/server"
import { ClubsLanding } from "@/components/rugby-hub/clubs/clubs-landing"

export const metadata: Metadata = {
  title: "Famous Clubs | Rugby Hub",
  description: "The domestic and professional rugby clubs that shaped the game — who they are, why they matter, and what they've won, explained in plain language.",
}

function parseCode(value: string | undefined): "all" | RugbyCode {
  return value === "union" || value === "league" ? value : "all"
}

export default async function FamousClubsPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const bundle = await getClubsBundle(supabase)

  return (
    <div>
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Rugby Hub</p>
      <h1 className="mt-3 font-display text-display-l text-ink">Famous Clubs</h1>
      <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink/80">
        These are clubs that shaped rugby history — not simply today&apos;s biggest names. Who they are, why they matter, and what they&apos;ve won, explained in plain language.
      </p>

      <div className="mt-8">
        <ClubsLanding bundle={bundle} activeCode={parseCode(code)} />
      </div>
    </div>
  )
}
