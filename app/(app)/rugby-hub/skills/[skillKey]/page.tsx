import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { cookies } from "next/headers"

import { getSessionContext } from "@/lib/app-context/session-context"
import { getRugbyHubIdentityContext, resolveActiveRugbyHubTeamId } from "@/lib/app-context/rugby-hub-data"
import { getSkillsExplorerBundle, findSkillByKey, resolveSupersededSkillKey } from "@/lib/app-context/skills-explorer-data"
import { createClient } from "@/lib/supabase/server"
import { SkillDetail } from "@/components/rugby-hub/skills/skill-detail"

import { RUGBY_HUB_TEAM_COOKIE } from "../../constants"

export async function generateMetadata({ params }: { params: Promise<{ skillKey: string }> }): Promise<Metadata> {
  const { skillKey } = await params
  const supabase = await createClient()
  const { data } = await supabase.from("hub_skills").select("display_name, summary").eq("skill_key", skillKey).eq("status", "PUBLISHED").maybeSingle()
  return {
    title: data ? `${data.display_name} | Skills | Rugby Hub` : "Skills | Rugby Hub",
    description: data?.summary,
  }
}

export default async function SkillDetailPage({ params }: { params: Promise<{ skillKey: string }> }) {
  const { skillKey } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const store = await cookies()
  const teamId = await resolveActiveRugbyHubTeamId(supabase, ctx, store.get(RUGBY_HUB_TEAM_COOKIE)?.value)

  let regulatoryIdentityId: string | null = null
  if (teamId) {
    const identity = await getRugbyHubIdentityContext(supabase, teamId)
    regulatoryIdentityId = identity.regulatoryIdentityId
  }

  const bundle = await getSkillsExplorerBundle(supabase, regulatoryIdentityId)
  const skill = findSkillByKey(bundle, skillKey)
  if (!skill) {
    // Not among the currently PUBLISHED skills -- check whether this key
    // is a retired identity with a real successor (e.g. set-piece-technique)
    // before giving up to a 404. A superseded skill deterministically
    // redirects to its canonical successor; anything else is a genuine 404.
    const successorKey = await resolveSupersededSkillKey(supabase, skillKey)
    if (successorKey) redirect(`/rugby-hub/skills/${successorKey}`)
    notFound()
  }

  return (
    <div>
      <Link
        href="/rugby-hub/skills"
        className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-forest-800 outline-none transition-colors hover:text-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        ← Skills
      </Link>

      <div className="mt-6 rounded-2xl border border-ink/10 bg-white p-5 sm:p-6">
        <SkillDetail bundle={bundle} skill={skill} />
      </div>
    </div>
  )
}
