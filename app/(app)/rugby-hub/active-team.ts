import "server-only"

import { cookies } from "next/headers"
import type { SupabaseClient } from "@supabase/supabase-js"

import { ACTIVE_CONTEXT_COOKIE, resolveActiveContext } from "@/lib/app-context/active-context"
import { getRugbyHubTeamOptions, type RugbyHubTeamOption } from "@/lib/app-context/rugby-hub-data"
import type { SessionContext } from "@/lib/app-context/session-context"
import type { Database } from "@/types/database.types"
import { rememberedHubTeamFromCookie, resolveHubTeam, type HubTeamChoice } from "@ovalball/contracts/rugby-hub/team-choice"

import { RUGBY_HUB_TEAM_COOKIE } from "./constants"

export interface HubTeamForRequest extends HubTeamChoice {
  options: RugbyHubTeamOption[]
  team: RugbyHubTeamOption | null
  /** The app-wide selected context this answer was made for. */
  activeKey: string
}

/**
 * WHOSE RUGBY HUB, on the website (RH-M0.2 / RH5).
 *
 * The Hub follows the app-wide selected context -- the context switcher in the shell -- exactly as
 * the app follows its header: a parent viewing Ava gets Ava's rules, and switching to Ben changes
 * them, with no Hub-only choice surviving the switch. The rule is the shared one
 * (`resolveHubTeam`): a Hub choice remembered for THIS context, else the team the context is, else
 * the first real option. The remembered choice lives in one cookie whose value names the context
 * it was made in, so it is simply not read for any other.
 *
 * Every Rugby Hub page and action resolves the team through this one function. Nothing here is
 * authority: the options are the server's list of the viewer's real relationships, and each
 * identity read still refuses a team the viewer is not related to.
 */
export async function resolveHubTeamForRequest(supabase: SupabaseClient<Database>, ctx: SessionContext): Promise<HubTeamForRequest> {
  const store = await cookies()
  const active = resolveActiveContext(ctx, store.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const options = await getRugbyHubTeamOptions(supabase, ctx)
  const remembered = rememberedHubTeamFromCookie(store.get(RUGBY_HUB_TEAM_COOKIE)?.value, active.key)
  const choice = resolveHubTeam(options, { kind: active.kind, id: active.id, clubId: active.clubId }, remembered)
  return { ...choice, options, team: options.find((t) => t.teamId === choice.teamId) ?? null, activeKey: active.key }
}
