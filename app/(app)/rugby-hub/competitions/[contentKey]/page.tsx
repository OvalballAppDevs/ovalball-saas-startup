import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { findGuideByKey, getCompetitionBundle } from "@/lib/app-context/teams-competitions-data"
import { createClient } from "@/lib/supabase/server"
import { CompetitionGuideDetail } from "@/components/rugby-hub/competitions/competition-guide-detail"

export async function generateMetadata({ params }: { params: Promise<{ contentKey: string }> }): Promise<Metadata> {
  const { contentKey } = await params
  const supabase = await createClient()
  const { data } = await supabase.from("hub_content_items").select("title, summary").eq("content_key", contentKey).eq("content_type", "COMPETITION_GUIDE").eq("status", "PUBLISHED").maybeSingle()
  return {
    title: data ? `${data.title} | Teams & Competitions | Rugby Hub` : "Teams & Competitions | Rugby Hub",
    description: data?.summary,
  }
}

export default async function CompetitionGuidePage({ params }: { params: Promise<{ contentKey: string }> }) {
  const { contentKey } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const bundle = await getCompetitionBundle(supabase)
  const guide = findGuideByKey(bundle, contentKey)
  if (!guide) notFound()

  return (
    <div>
      <Link
        href="/rugby-hub/competitions"
        className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-forest-800 outline-none transition-colors hover:text-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        ← Teams & Competitions
      </Link>

      <div className="mt-6 rounded-2xl border border-ink/10 bg-white p-5 sm:p-6">
        <CompetitionGuideDetail bundle={bundle} guide={guide} />
      </div>
    </div>
  )
}
