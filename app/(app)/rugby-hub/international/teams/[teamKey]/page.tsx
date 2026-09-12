import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { findTeamByKey, getInternationalBundle } from "@/lib/app-context/international-data"
import { createClient } from "@/lib/supabase/server"
import { TeamDetail } from "@/components/rugby-hub/international/team-detail"

export async function generateMetadata({ params }: { params: Promise<{ teamKey: string }> }): Promise<Metadata> {
  const { teamKey } = await params
  const supabase = await createClient()
  const { data } = await supabase.from("hub_content_items").select("title, summary").eq("content_key", teamKey).eq("content_type", "RUGBY_TEAM").eq("status", "PUBLISHED").maybeSingle()
  return {
    title: data ? `${data.title} | International Rugby | Rugby Hub` : "International Rugby | Rugby Hub",
    description: data?.summary,
  }
}

export default async function InternationalTeamPage({ params }: { params: Promise<{ teamKey: string }> }) {
  const { teamKey } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const bundle = await getInternationalBundle(supabase)
  const team = findTeamByKey(bundle, teamKey)
  if (!team) notFound()

  return (
    <div>
      <Link
        href="/rugby-hub/international"
        className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-forest-800 outline-none transition-colors hover:text-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        ← International Rugby
      </Link>

      <div className="mt-6 rounded-2xl border border-ink/10 bg-white p-5 sm:p-6">
        <TeamDetail bundle={bundle} team={team} />
      </div>
    </div>
  )
}
