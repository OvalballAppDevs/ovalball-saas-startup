"use server"

import { cookies } from "next/headers"

import { getSessionContext } from "@/lib/app-context/session-context"
import { getRugbyHubIdentityContext, resolveActiveRugbyHubTeamId } from "@/lib/app-context/rugby-hub-data"
import { createClient } from "@/lib/supabase/server"
import { searchRugbyHub, type HubSearchResult } from "@/lib/app-context/rugby-hub-search"

import { RUGBY_HUB_TEAM_COOKIE } from "./constants"

/**
 * The one Rugby Hub search entry point a client component calls. Identity
 * is re-derived server-side from the real session on every call (never
 * trusts anything the client sends beyond the query text itself). The
 * viewer's own regulatory identity is resolved the exact same way every
 * other Rugby Hub page resolves it (session -> active team -> identity
 * context) and passed through purely as a presentation/grouping signal --
 * it never filters what search_hub_content itself returns, and browsing a
 * RULE result for a different identity is unaffected by it.
 */
export async function searchRugbyHubAction(query: string): Promise<HubSearchResult[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const ctx = await getSessionContext(supabase, user)
  const store = await cookies()
  const teamId = await resolveActiveRugbyHubTeamId(supabase, ctx, store.get(RUGBY_HUB_TEAM_COOKIE)?.value)

  let regulatoryIdentityId: string | null = null
  if (teamId) {
    const identity = await getRugbyHubIdentityContext(supabase, teamId)
    regulatoryIdentityId = identity.regulatoryIdentityId
  }

  return searchRugbyHub(supabase, query, 12, regulatoryIdentityId)
}
