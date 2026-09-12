import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { findConceptByKey, getOfficiatingBundle } from "@/lib/app-context/officiating-data"
import { createClient } from "@/lib/supabase/server"
import { OfficiatingConceptDetail } from "@/components/rugby-hub/officiating/officiating-concept-detail"

export async function generateMetadata({ params }: { params: Promise<{ contentKey: string }> }): Promise<Metadata> {
  const { contentKey } = await params
  const supabase = await createClient()
  const { data } = await supabase.from("hub_content_items").select("title, summary").eq("content_key", contentKey).eq("content_type", "OFFICIATING_CONCEPT").eq("status", "PUBLISHED").maybeSingle()
  return {
    title: data ? `${data.title} | Officiating | Rugby Hub` : "Officiating | Rugby Hub",
    description: data?.summary,
  }
}

export default async function OfficiatingConceptPage({ params }: { params: Promise<{ contentKey: string }> }) {
  const { contentKey } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const bundle = await getOfficiatingBundle(supabase)
  const concept = findConceptByKey(bundle, contentKey)
  if (!concept) notFound()

  return (
    <div>
      <Link
        href="/rugby-hub/officiating"
        className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-forest-800 outline-none transition-colors hover:text-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        ← Officiating
      </Link>

      <div className="mt-6 rounded-2xl border border-ink/10 bg-white p-5 sm:p-6">
        <OfficiatingConceptDetail bundle={bundle} concept={concept} />
      </div>
    </div>
  )
}
