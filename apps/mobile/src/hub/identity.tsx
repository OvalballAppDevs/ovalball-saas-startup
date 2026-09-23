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

/**
 * WHOSE RUGBY HUB IS THIS.
 *
 * The Hub is the same for everybody -- every article, every law, every club --
 * and it is PERSONAL in one narrow way: Rules, Safeguarding, Player Welfare,
 * the Position Explorer's age stage and the Skills Explorer's contact gate all
 * depend on WHICH TEAM the viewer means by "mine". The website answers that
 * from the session (guardian relationships, the viewer's own player record,
 * team permissions, club membership) plus a cookie naming the chosen team; this
 * answers it from the same session, through the same contracts readers, plus
 * an AsyncStorage preference in place of the cookie.
 *
 * WHAT THE CHOICE IS. `resolveActiveRugbyHubTeamId`'s rule, exactly: the
 * preferred team if it is still one of the viewer's real options, else the
 * first real option, else nothing. The preference is only ever one of the
 * options the SERVER offered -- a stored id that no longer matches anything
 * falls through, and the server's own `get_rugby_hub_identity_context` refuses
 * a team the viewer is not related to regardless. Choosing a team here grants
 * nothing; it says which of your own rugby you are asking about.
 *
 * THE FIRST PREFERENCE COMES FROM THE APP'S OWN CONTEXT. A parent standing in
 * Ava's context has already said whose rugby they mean, so that team is the
 * default until they choose otherwise in the Hub. A club admin's context is a
 * club, so the first of that club's teams is offered. `active.id` is the team
 * id for parent, player and team contexts and the club id for a club context
 * -- see active-context-rules.ts.
 *
 * AND IT IS NOT A CHILD SELECTOR. The options are TEAMS the viewer has a real
 * relationship with; a guardian's option is labelled with the child's name
 * because that is what a parent is choosing between, but there is no filter
 * over children that would let a coach pick somebody else's child.
 */

const PREFERRED_TEAM_KEY = "ovalball.rugby-hub.team"

export interface HubIdentityState {
  /** True until the session and the team options have resolved once. */
  loading: boolean
  error: FriendlyError | null
  options: RugbyHubTeamOption[]
  team: RugbyHubTeamOption | null
  teamId: string | null
  identity: RugbyHubIdentityContext | null
  audience: RugbyHubAudience
  /** The viewer's own code, when their team's identity resolves to one. Null means "exploring". */
  ownCode: "union" | "league" | null
  choose: (teamId: string) => Promise<void>
  /** A stable string the cache can key identity-aware bundles on. */
  identityKey: string
}

const HubIdentity = createContext<HubIdentityState | null>(null)

export function HubIdentityProvider({ children }: { children: React.ReactNode }) {
  const { sessionContext, active, loading: contextsLoading } = useAppContexts()
  const [options, setOptions] = useState<RugbyHubTeamOption[] | null>(null)
  const [preferred, setPreferred] = useState<string | null | undefined>(undefined)
  const [identity, setIdentity] = useState<{ teamId: string; value: RugbyHubIdentityContext } | null>(null)
  const [error, setError] = useState<FriendlyError | null>(null)

  useEffect(() => {
    let live = true
    void AsyncStorage.getItem(PREFERRED_TEAM_KEY)
      .then((v) => live && setPreferred(v))
      .catch(() => live && setPreferred(null))
    return () => {
      live = false
    }
  }, [])

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

  const teamId = useMemo(() => {
    if (!options || preferred === undefined) return null
    const fromPreference = options.find((t) => t.teamId === preferred)?.teamId
    if (fromPreference) return fromPreference
    const fromContext = active
      ? active.kind === "club"
        ? options.find((t) => t.clubId === active.id)?.teamId
        : options.find((t) => t.teamId === active.id)?.teamId
      : undefined
    return fromContext ?? options[0]?.teamId ?? null
  }, [options, preferred, active])

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

  const choose = useCallback(async (next: string) => {
    setPreferred(next)
    try {
      await AsyncStorage.setItem(PREFERRED_TEAM_KEY, next)
    } catch {
      // The choice still applies for this launch.
    }
  }, [])

  const team = options?.find((t) => t.teamId === teamId) ?? null
  const resolvedIdentity = identity && identity.teamId === teamId ? identity.value : null
  const audience: RugbyHubAudience = sessionContext && team ? resolveRugbyHubAudience(sessionContext, team) : "GENERAL"
  const loading = contextsLoading || options === null || preferred === undefined || (teamId !== null && resolvedIdentity === null)

  const value = useMemo<HubIdentityState>(
    () => ({
      loading,
      error,
      options: options ?? [],
      team,
      teamId,
      identity: resolvedIdentity,
      audience,
      ownCode: resolvedIdentity?.rugbyCode ?? null,
      choose,
      identityKey: `${teamId ?? "none"}:${resolvedIdentity?.regulatoryIdentityId ?? "none"}`,
    }),
    [loading, error, options, team, teamId, resolvedIdentity, audience, choose]
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

/** Forgets the chosen team. Called on sign-out beside the context preference. */
export async function forgetHubTeamPreference(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PREFERRED_TEAM_KEY)
  } catch {
    // ignore
  }
}
