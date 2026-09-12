import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { findClubByKey, getClubsBundle } from "@/lib/app-context/clubs-data"
import { createClient } from "@/lib/supabase/server"
import { ClubDetail } from "@/components/rugby-hub/clubs/club-detail"

export async function generateMetadata({ params }: { params: Promise<{ clubKey: string }> }): Promise<Metadata> {
  const { clubKey } = await params
  const supabase = await createClient()
  const { data } = await supabase.from("hub_content_items").select("title, summary").eq("content_key", clubKey).eq("content_type", "RUGBY_TEAM").eq("team_type", "CLUB_TEAM").eq("status", "PUBLISHED").maybeSingle()
  return {
    title: data ? `${data.title} | Famous Clubs | Rugby Hub` : "Famous Clubs | Rugby Hub",
    description: data?.summary,
  }
}

export default async function FamousClubPage({ params }: { params: Promise<{ clubKey: string }> }) {
  const { clubKey } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const bundle = await getClubsBundle(supabase)
  const club = findClubByKey(bundle, clubKey)
  if (!club) notFound()

  return (
    <div>
      <Link
        href="/rugby-hub/clubs"
        className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-forest-800 outline-none transition-colors hover:text-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        ← Famous Clubs
      </Link>

      <div className="mt-6 rounded-2xl border border-ink/10 bg-white p-5 sm:p-6">
        <ClubDetail bundle={bundle} club={club} />
      </div>
    </div>
  )
}
