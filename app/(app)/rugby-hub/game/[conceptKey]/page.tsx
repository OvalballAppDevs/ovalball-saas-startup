import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { findConceptByKey, getGameKnowledgeBundle } from "@/lib/app-context/game-knowledge-data"
import { createClient } from "@/lib/supabase/server"
import { GameConceptDetail } from "@/components/rugby-hub/game/game-concept-detail"

export async function generateMetadata({ params }: { params: Promise<{ conceptKey: string }> }): Promise<Metadata> {
  const { conceptKey } = await params
  const supabase = await createClient()
  const { data } = await supabase.from("hub_content_items").select("title, summary").eq("content_key", conceptKey).eq("content_type", "GAME_CONCEPT").eq("status", "PUBLISHED").maybeSingle()
  return {
    title: data ? `${data.title} | Game Knowledge | Rugby Hub` : "Game Knowledge | Rugby Hub",
    description: data?.summary,
  }
}

export default async function GameConceptPage({ params }: { params: Promise<{ conceptKey: string }> }) {
  const { conceptKey } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const bundle = await getGameKnowledgeBundle(supabase)
  const concept = findConceptByKey(bundle, conceptKey)
  if (!concept) notFound()

  return (
    <div>
      <Link
        href="/rugby-hub/game"
        className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-forest-800 outline-none transition-colors hover:text-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        ← Game Knowledge
      </Link>

      <div className="mt-6 rounded-2xl border border-ink/10 bg-white p-5 sm:p-6">
        <GameConceptDetail bundle={bundle} concept={concept} />
      </div>
    </div>
  )
}
