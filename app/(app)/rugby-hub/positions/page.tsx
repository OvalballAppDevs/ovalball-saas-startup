import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { getSessionContext } from "@/lib/app-context/session-context"
import { getRugbyHubIdentityContext, resolveActiveRugbyHubTeamId } from "@/lib/app-context/rugby-hub-data"
import { createClient } from "@/lib/supabase/server"

import { RUGBY_HUB_TEAM_COOKIE } from "../constants"

/**
 * Section 5: never a form before something useful. Resolves straight to
 * the viewer's own code when their active team's identity maps to one;
 * otherwise lands on Union rather than asking -- an arbitrary but honest
 * default (the landing page states plainly that they're exploring, not
 * that this is their code -- see CodeSwitch's "exploring" label).
 */
export default async function PositionExplorerIndexPage() {
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

  redirect(`/rugby-hub/positions/${defaultCode}`)
}
