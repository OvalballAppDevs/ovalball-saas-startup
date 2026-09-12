import { notFound, redirect } from "next/navigation"
import { cookies } from "next/headers"

import { getSessionContext } from "@/lib/app-context/session-context"
import { getRugbyHubIdentityContext, getRugbyHubTeamOptions, resolveActiveRugbyHubTeamId } from "@/lib/app-context/rugby-hub-data"
import { getPositionExplorerBundle } from "@/lib/app-context/position-explorer-data"
import { createClient } from "@/lib/supabase/server"
import { PositionExplorerClient, type ContextLabel } from "@/components/rugby-hub/positions/position-explorer-client"

import { RUGBY_HUB_TEAM_COOKIE } from "../../constants"

/**
 * Fetches the Explorer bundle ONCE per code and stays mounted across
 * [positionKey] changes -- see position-explorer-client.tsx's own comment
 * for why that's what makes selection instant with no re-fetch.
 *
 * Code/identity resolution reuses the exact same session context, team
 * options, and getRugbyHubIdentityContext RPC every other Rugby Hub page
 * already uses -- never a second resolver, and the ?code= URL segment is
 * presentation/browsing state only: it is NEVER used to authorise, gate
 * capability, or stand in for the viewer's own resolved identity (section
 * 28). A viewer can freely browse league while their own team is union;
 * doing so never changes what they're permitted to see or do anywhere else.
 */
export default async function PositionExplorerLayout({ children, params }: { children: React.ReactNode; params: Promise<{ code: string }> }) {
  const { code } = await params
  if (code !== "union" && code !== "league") notFound()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const store = await cookies()
  const teamId = await resolveActiveRugbyHubTeamId(supabase, ctx, store.get(RUGBY_HUB_TEAM_COOKIE)?.value)
  const teamOptions = await getRugbyHubTeamOptions(supabase, ctx)
  const team = teamOptions.find((t) => t.teamId === teamId)

  let regulatoryIdentityId: string | null = null
  let contextLabel: ContextLabel = { kind: "exploring" }

  if (teamId && team) {
    const identity = await getRugbyHubIdentityContext(supabase, teamId)
    if (identity.rugbyCode === code && (identity.mappingType === "DIRECT" || identity.mappingType === "DERIVED_COMPOSITE")) {
      regulatoryIdentityId = identity.regulatoryIdentityId
      contextLabel = { kind: "own-context", text: `${team.childName ? `${team.childName}'s ` : "your "}${team.teamDisplayName} team` }
    }
  }

  const bundle = await getPositionExplorerBundle(supabase, code, regulatoryIdentityId)

  return (
    <div>
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Rugby Hub</p>
      <h1 className="mt-3 font-display text-display-l text-ink">Position Explorer</h1>
      <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink/80">
        Explore the pitch, pick a position, and find out what it actually does &mdash; on the ball, off it, in attack
        and in defence.
      </p>

      <div className="mt-6">
        <PositionExplorerClient bundle={bundle} contextLabel={contextLabel} />
      </div>

      {children}
    </div>
  )
}
