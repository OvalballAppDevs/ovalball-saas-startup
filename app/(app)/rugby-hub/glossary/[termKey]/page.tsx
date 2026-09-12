import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { findTermByKey, getGlossaryBundle } from "@/lib/app-context/glossary-data"
import { createClient } from "@/lib/supabase/server"
import { GlossaryTermDetail } from "@/components/rugby-hub/glossary/glossary-term-detail"

export async function generateMetadata({ params }: { params: Promise<{ termKey: string }> }): Promise<Metadata> {
  const { termKey } = await params
  const supabase = await createClient()
  const { data } = await supabase.from("hub_glossary_terms").select("display_term, plain_language_definition").eq("term_key", termKey).eq("status", "PUBLISHED").maybeSingle()
  return {
    title: data ? `${data.display_term} | Glossary | Rugby Hub` : "Glossary | Rugby Hub",
    description: data?.plain_language_definition,
  }
}

export default async function GlossaryTermPage({ params }: { params: Promise<{ termKey: string }> }) {
  const { termKey } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const bundle = await getGlossaryBundle(supabase)
  const term = findTermByKey(bundle, termKey)
  if (!term) notFound()

  return (
    <div>
      <Link
        href="/rugby-hub/glossary"
        className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-forest-800 outline-none transition-colors hover:text-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        ← Glossary
      </Link>

      <div className="mt-6 rounded-2xl border border-ink/10 bg-white p-5 sm:p-6">
        <GlossaryTermDetail bundle={bundle} term={term} />
      </div>
    </div>
  )
}
