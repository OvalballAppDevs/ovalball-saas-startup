import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { findPersonByKey, getPeopleBundle } from "@/lib/app-context/people-data"
import { createClient } from "@/lib/supabase/server"
import { PersonDetail } from "@/components/rugby-hub/people/person-detail"

export async function generateMetadata({ params }: { params: Promise<{ personKey: string }> }): Promise<Metadata> {
  const { personKey } = await params
  const supabase = await createClient()
  const { data } = await supabase.from("hub_content_items").select("title, summary").eq("content_key", personKey).eq("content_type", "RUGBY_PERSON").eq("status", "PUBLISHED").maybeSingle()
  return {
    title: data ? `${data.title} | People & Rugby Legends | Rugby Hub` : "People & Rugby Legends | Rugby Hub",
    description: data?.summary,
  }
}

export default async function PersonPage({ params }: { params: Promise<{ personKey: string }> }) {
  const { personKey } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const bundle = await getPeopleBundle(supabase)
  const person = findPersonByKey(bundle, personKey)
  if (!person) notFound()

  return (
    <div>
      <Link
        href="/rugby-hub/people"
        className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-forest-800 outline-none transition-colors hover:text-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        ← People &amp; Rugby Legends
      </Link>

      <div className="mt-6 rounded-2xl border border-ink/10 bg-white p-5 sm:p-6">
        <PersonDetail bundle={bundle} person={person} />
      </div>
    </div>
  )
}
