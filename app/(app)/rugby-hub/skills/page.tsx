import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { getSessionContext } from "@/lib/app-context/session-context"
import { getRugbyHubIdentityContext, resolveActiveRugbyHubTeamId } from "@/lib/app-context/rugby-hub-data"
import { getSkillsExplorerBundle } from "@/lib/app-context/skills-explorer-data"
import { createClient } from "@/lib/supabase/server"
import { SkillsLanding } from "@/components/rugby-hub/skills/skills-landing"

import { RUGBY_HUB_TEAM_COOKIE } from "../constants"

export const metadata: Metadata = {
  title: "Skills | Rugby Hub",
  description: "Learn rugby skills — what they are, why they matter, and how to get better at them.",
}

/**
 * Identity resolution reuses the exact same session context / team options
 * / getRugbyHubIdentityContext RPC every other Rugby Hub page already
 * uses -- never a second resolver. The resolved regulatory_identity_id
 * only ever affects whether the tackling skill's technique steps are
 * replaced with the real regulatory contact-introduction note; it never
 * hides Union or League skills from each other. Two skills here (Scrum and
 * Lineout Technique, Play-the-Ball and Restart) are genuinely code-specific
 * -- their small code badge comes from hub_skills.rugby_code, not from a
 * branch in this page. Every other skill stays code-universal and every
 * code stays visible to every viewer regardless of their own team's code.
 */
export default async function SkillsLandingPage() {
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

  return (
    <div>
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Rugby Hub</p>
      <h1 className="mt-3 font-display text-display-l text-ink">Skills</h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink/80">
        What each skill is, why it matters, when you use it, and how to actually get better at it &mdash; connected to
        the positions that rely on it.
      </p>

      <div className="mt-8">
        <SkillsLanding skills={bundle.skills} />
      </div>
    </div>
  )
}
