import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { findDevelopmentConceptByKey, getDevelopmentBundle } from "@/lib/app-context/development-data"
import { createClient } from "@/lib/supabase/server"
import { DevelopmentDetail } from "@/components/rugby-hub/development/development-detail"

export async function generateMetadata({ params }: { params: Promise<{ conceptKey: string }> }): Promise<Metadata> {
  const { conceptKey } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from("hub_content_items")
    .select("title, summary")
    .eq("content_key", conceptKey)
    .eq("content_type", "PLAYER_DEVELOPMENT_CONCEPT")
    .eq("status", "PUBLISHED")
    .maybeSingle()
  return {
    title: data ? `${data.title} | Player Development | Rugby Hub` : "Player Development | Rugby Hub",
    description: data?.summary,
  }
}

export default async function PlayerDevelopmentConceptPage({ params }: { params: Promise<{ conceptKey: string }> }) {
  const { conceptKey } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const bundle = await getDevelopmentBundle(supabase)
  const concept = findDevelopmentConceptByKey(bundle, conceptKey)
  if (!concept) notFound()

  return (
    <div>
      <Link
        href="/rugby-hub/development"
        className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-forest-800 outline-none transition-colors hover:text-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        ← Player Development
      </Link>

      <div className="mt-6 rounded-2xl border border-ink/10 bg-white p-5 sm:p-6">
        <DevelopmentDetail bundle={bundle} concept={concept} />
      </div>
    </div>
  )
}
