import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getCoachingBundle } from "@/lib/app-context/coaching-data"
import type { RugbyCode } from "@/lib/app-context/coaching-types"
import { createClient } from "@/lib/supabase/server"
import { CoachingLanding } from "@/components/rugby-hub/coaching/coaching-landing"

export const metadata: Metadata = {
  title: "Coaching Knowledge | Rugby Hub",
  description: "How to help players learn — session design, practice design, feedback, questioning and inclusive coaching, explained for volunteer and community rugby coaches.",
}

function parseCode(value: string | undefined): "all" | RugbyCode {
  return value === "union" || value === "league" ? value : "all"
}

export default async function CoachingKnowledgePage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const bundle = await getCoachingBundle(supabase)

  return (
    <div>
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Rugby Hub</p>
      <h1 className="mt-3 font-display text-display-l text-ink">Coaching Knowledge</h1>
      <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink/80">
        Skills explain what a player does. This explains what you do — how to design a session players learn from, how to say less and ask more, and how to run one evening that works for everybody in
        it.
      </p>

      <div className="mt-8">
        <CoachingLanding bundle={bundle} activeCode={parseCode(code)} />
      </div>
    </div>
  )
}
