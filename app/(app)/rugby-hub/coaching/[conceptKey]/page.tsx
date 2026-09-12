import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { findCoachingConceptByKey, getCoachingBundle } from "@/lib/app-context/coaching-data"
import { createClient } from "@/lib/supabase/server"
import { CoachingDetail } from "@/components/rugby-hub/coaching/coaching-detail"

export async function generateMetadata({ params }: { params: Promise<{ conceptKey: string }> }): Promise<Metadata> {
  const { conceptKey } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from("hub_content_items")
    .select("title, summary")
    .eq("content_key", conceptKey)
    .eq("content_type", "COACHING_CONCEPT")
    .eq("status", "PUBLISHED")
    .maybeSingle()
  return {
    title: data ? `${data.title} | Coaching Knowledge | Rugby Hub` : "Coaching Knowledge | Rugby Hub",
    description: data?.summary,
  }
}

export default async function CoachingConceptPage({ params }: { params: Promise<{ conceptKey: string }> }) {
  const { conceptKey } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const bundle = await getCoachingBundle(supabase)
  const concept = findCoachingConceptByKey(bundle, conceptKey)
  if (!concept) notFound()

  return (
    <div>
      <Link
        href="/rugby-hub/coaching"
        className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-forest-800 outline-none transition-colors hover:text-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        ← Coaching Knowledge
      </Link>

      <div className="mt-6 rounded-2xl border border-ink/10 bg-white p-5 sm:p-6">
        <CoachingDetail bundle={bundle} concept={concept} />
      </div>
    </div>
  )
}
