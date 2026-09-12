import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { getGameKnowledgeBundle } from "@/lib/app-context/game-knowledge-data"
import { getSessionContext } from "@/lib/app-context/session-context"
import { getRugbyHubIdentityContext, resolveActiveRugbyHubTeamId } from "@/lib/app-context/rugby-hub-data"
import { createClient } from "@/lib/supabase/server"
import { GameKnowledgeLanding } from "@/components/rugby-hub/game/game-knowledge-landing"

import { RUGBY_HUB_TEAM_COOKIE } from "../constants"

export const metadata: Metadata = {
  title: "Game Knowledge | Rugby Hub",
  description: "How rugby actually works — possession, contact, restarts, scoring and how it all connects, for Union and League.",
}

export default async function GameKnowledgePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const store = await cookies()
  const teamId = await resolveActiveRugbyHubTeamId(supabase, ctx, store.get(RUGBY_HUB_TEAM_COOKIE)?.value)

  let defaultCode: "union" | "league" = "union"
  if (teamId) {
    const identity = await getRugbyHubIdentityContext(supabase, teamId)
    if (identity.rugbyCode) defaultCode = identity.rugbyCode
  }

  const bundle = await getGameKnowledgeBundle(supabase)

  return (
    <div>
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Rugby Hub</p>
      <h1 className="mt-3 font-display text-display-l text-ink">Game Knowledge</h1>
      <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink/80">
        How rugby actually works — what teams are trying to do, what happens after a tackle, how a game flows from one phase to the next, and where Union
        and League genuinely differ.
      </p>

      <div className="mt-8">
        <GameKnowledgeLanding bundle={bundle} defaultCode={defaultCode} />
      </div>
    </div>
  )
}
