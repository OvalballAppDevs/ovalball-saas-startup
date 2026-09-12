import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { findParentGuideByKey, getParentsBundle } from "@/lib/app-context/parents-data"
import { createClient } from "@/lib/supabase/server"
import { ParentGuideDetail } from "@/components/rugby-hub/parents/parent-guide-detail"

export async function generateMetadata({ params }: { params: Promise<{ guideKey: string }> }): Promise<Metadata> {
  const { guideKey } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from("hub_content_items")
    .select("title, summary")
    .eq("content_key", guideKey)
    .eq("content_type", "PARENT_GUIDE")
    .eq("status", "PUBLISHED")
    .maybeSingle()
  return {
    title: data ? `${data.title} | Parents & Guardians | Rugby Hub` : "Parents & Guardians | Rugby Hub",
    description: data?.summary,
  }
}

export default async function ParentGuidePage({ params }: { params: Promise<{ guideKey: string }> }) {
  const { guideKey } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const bundle = await getParentsBundle(supabase)
  const guide = findParentGuideByKey(bundle, guideKey)
  if (!guide) notFound()

  return (
    <div>
      <Link
        href="/rugby-hub/parents"
        className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-forest-800 outline-none transition-colors hover:text-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        ← Parents &amp; Guardians
      </Link>

      <div className="mt-6 rounded-2xl border border-ink/10 bg-white p-5 sm:p-6">
        <ParentGuideDetail bundle={bundle} guide={guide} />
      </div>
    </div>
  )
}
