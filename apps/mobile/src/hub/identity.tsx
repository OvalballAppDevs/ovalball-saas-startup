import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"

import {
  getRugbyHubIdentityContext,
  getRugbyHubTeamOptions,
  resolveRugbyHubAudience,
  type RugbyHubAudience,
  type RugbyHubIdentityContext,
  type RugbyHubTeamOption,
} from "@ovalball/contracts/rugby-hub/rugby-hub-data"

import { supabase } from "../auth/supabase"
import { useAppContexts } from "../context/contexts"
import { friendly, logDetail, type FriendlyError } from "../errors/translate"
import { HUB_TEAM_PREFERENCE_PREFIX, hubTeamPreferenceKey, resolveHubTeam, type HubTeamChoice } from "./team-resolution"

/**
 * WHOSE RUGBY HUB IS THIS.
 *
 * The Hub is the same for everybody -- every article, every law, every club --
 * and it is PERSONAL in one narrow way: Rules, Safeguarding, Player Welfare,
 * the Position Explorer's age stage and the Skills Explorer's contact gate all
 * depend on WHICH TEAM the viewer means by "mine". The website answers that
 * from the session (guardian relationships, the viewer's own player record,
 * team permissions, club membership) plus a cookie naming the chosen team; this
 * answers it from the same session, through the same contracts readers, with
 * the rule in `team-resolution.ts`: a choice remembered for THIS selected
 * context, else the team the selected context is, else the first real option.
 *
 * THE SELECTED CONTEXT LEADS. A parent who switches from Ava to Ben in the
 * header has changed whose rugby they are asking about; the Hub follows,
 * because the remembered choice is keyed by context and cannot outlive it.
 * A coach of several sides gets the side they are standing in. A club admin
 * gets the first of the club's teams and a visible "Viewing" switch, exactly
 * as the website does -- never a silent guess dressed as their own team.
 *
 * WHAT THE CHOICE IS NOT. The options are TEAMS the viewer has a real
 * relationship with, from the server; a stored id that no longer matches
 * anything falls through, and `get_rugby_hub_identity_context` refuses a team
 * the viewer is not related to regardless. Choosing a team grants nothing; it
 * says which of your own rugby you are asking about. There is no filter over
 * children that would let a coach pick somebody else's child.
 */

export interface HubIdentityState {
  /** True until the session, the team options and the chosen team's identity have resolved. */
  loading: boolean
  error: FriendlyError | null
  options: RugbyHubTeamOption[]
  team: RugbyHubTeamOption | null
  teamId: string | null
  /** How the team came to be chosen -- so a screen can say "for the team you are viewing" rather than pretend. */
  source: HubTeamChoice["source"]
  identity: RugbyHubIdentityContext | null
  audience: RugbyHubAudience
  /** The viewer's own code, when their team's identity resolves to one. Null means "exploring". */
  ownCode: "union" | "league" | null
  choose: (teamId: string) => Promise<void>
  /** A stable string the cache keys identity-aware bundles on. */
  identityKey: string
}

const HubIdentity = createContext<HubIdentityState | null>(null)

export function HubIdentityProvider({ children }: { children: React.ReactNode }) {
  const { sessionContext, active, loading: contextsLoading } = useAppContexts()
  const activeKey = active?.key ?? null
  const [options, setOptions] = useState<RugbyHubTeamOption[] | null>(null)
  /** The remembered choice for the CURRENT context: undefined while it is being read. */
  const [remembered, setRemembered] = useState<{ forContext: string | null; teamId: string | null } | undefined>(undefined)
  const [identity, setIdentity] = useState<{ teamId: string; value: RugbyHubIdentityContext } | null>(null)
  const [error, setError] = useState<FriendlyError | null>(null)

  useEffect(() => {
    let live = true
    setRemembered(undefined)
    void AsyncStorage.getItem(hubTeamPreferenceKey(activeKey))
      .then((v) => live && setRemembered({ forContext: activeKey, teamId: v }))
      .catch(() => live && setRemembered({ forContext: activeKey, teamId: null }))
    return () => {
      live = false
    }
  }, [activeKey])

  useEffect(() => {
    if (!sessionContext) {
      setOptions(null)
      return
    }
    let live = true
    setError(null)
    getRugbyHubTeamOptions(supabase, sessionContext)
      .then((list) => live && setOptions(list))
      .catch((cause) => {
        const translated = friendly(cause, "your teams")
        logDetail("hub:team-options", translated)
        if (live) {
          setError(translated)
          setOptions([])
        }
      })
    return () => {
      live = false
    }
  }, [sessionContext])

  const choice = useMemo<HubTeamChoice | null>(() => {
    if (!options || remembered === undefined || remembered.forContext !== activeKey) return null
    return resolveHubTeam(options, active ? { kind: active.kind, id: active.id } : null, remembered.teamId)
  }, [options, remembered, activeKey, active])
  const teamId = choice?.teamId ?? null

  useEffect(() => {
    if (!teamId) {
      setIdentity(null)
      return
    }
    let live = true
    getRugbyHubIdentityContext(supabase, teamId)
      .then((value) => live && setIdentity({ teamId, value }))
      .catch((cause) => {
        const translated = friendly(cause, "your team's rugby code")
        logDetail("hub:identity", translated)
        if (live) setIdentity({ teamId, value: { rugbyCode: null, regulatoryIdentityId: null, mappingType: null } })
      })
    return () => {
      live = false
    }
  }, [teamId])

  const choose = useCallback(
    async (next: string) => {
      setRemembered({ forContext: activeKey, teamId: next })
      try {
        await AsyncStorage.setItem(hubTeamPreferenceKey(activeKey), next)
      } catch {
        // The choice still applies for this launch.
      }
    },
    [activeKey]
  )

  const team = options?.find((t) => t.teamId === teamId) ?? null
  const resolvedIdentity = identity && identity.teamId === teamId ? identity.value : null
  const audience: RugbyHubAudience = sessionContext && team ? resolveRugbyHubAudience(sessionContext, team) : "GENERAL"
  const loading = contextsLoading || options === null || choice === null || (teamId !== null && resolvedIdentity === null)

  const value = useMemo<HubIdentityState>(
    () => ({
      loading,
      error,
      options: options ?? [],
      team,
      teamId,
      source: choice?.source ?? "none",
      identity: resolvedIdentity,
      audience,
      ownCode: resolvedIdentity?.rugbyCode ?? null,
      choose,
      identityKey: `${teamId ?? "none"}:${resolvedIdentity?.regulatoryIdentityId ?? "none"}`,
    }),
    [loading, error, options, team, teamId, choice, resolvedIdentity, audience, choose]
  )

  return <HubIdentity.Provider value={value}>{children}</HubIdentity.Provider>
}

export function useHubIdentity(): HubIdentityState {
  const value = useContext(HubIdentity)
  if (!value) throw new Error("useHubIdentity must be used inside HubIdentityProvider")
  return value
}

/** What to call the team on screen: the child's name for a guardian, the club and team for everybody else. */
export function hubTeamLabel(team: RugbyHubTeamOption): string {
  return team.childName ? `${team.childName} · ${team.teamDisplayName}` : `${team.clubName} · ${team.teamDisplayName}`
}

/** Forgets every remembered Hub team choice, for every context. Called on sign-out beside the context preference. */
export async function forgetHubTeamPreference(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(HUB_TEAM_PREFERENCE_PREFIX))
    if (keys.length > 0) await AsyncStorage.multiRemove(keys)
  } catch {
    // ignore
  }
}
