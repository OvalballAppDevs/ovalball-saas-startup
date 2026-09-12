import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getGlossaryBundle } from "@/lib/app-context/glossary-data"
import { createClient } from "@/lib/supabase/server"
import { GlossaryLanding } from "@/components/rugby-hub/glossary/glossary-landing"

export const metadata: Metadata = {
  title: "Glossary | Rugby Hub",
  description: "What rugby terms actually mean — plain-English definitions for Union and League.",
}

export default async function GlossaryPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const bundle = await getGlossaryBundle(supabase)

  return (
    <div>
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Rugby Hub</p>
      <h1 className="mt-3 font-display text-display-l text-ink">Glossary</h1>
      <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink/80">
        What does that word actually mean? Short, plain-English definitions for the terms you&apos;ll hear around the pitch — browse by letter or code below.
      </p>

      <div className="mt-8">
        <GlossaryLanding terms={bundle.terms} />
      </div>
    </div>
  )
}
