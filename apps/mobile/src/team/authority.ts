import { useCallback, useEffect, useState } from "react"
import { useFocusEffect } from "expo-router"
import { noTeamAuthority, readTeamAuthority, type TeamAuthority } from "@ovalball/contracts/team/authority"

import { supabase } from "../auth/supabase"
import { useAppContexts } from "../context/contexts"

/**
 * WHAT MAY I DO WITH THE TEAM I AM STANDING IN -- asked of the server, re-asked on every focus.
 *
 * One `my_capabilities` read at team scope for the ACTIVE team context, mapped by the shared
 * `readTeamAuthority`. Nothing here is authority: every screen that draws a control from it still has
 * the server refuse the write independently. A cached yes outlives the permission it came from, so the
 * answer is cleared the moment the context changes and never held across one.
 *
 * Outside a team context the answer is `null` -- not "no authority" but "not a team" -- so a screen can
 * tell "you may not" apart from "this is not the place".
 */
export interface TeamAuthorityState {
  loading: boolean
  teamId: string | null
  clubId: string | null
  /** The team's canonical display name, from the context the person selected. */
  teamName: string | null
  authority: TeamAuthority
  refresh: () => Promise<void>
}

export function useTeamAuthority(): TeamAuthorityState {
  const { active } = useAppContexts()
  const teamId = active?.kind === "team" ? active.id : null
  const clubId = active?.kind === "team" ? (active.clubId ?? null) : null
  const teamName = active?.kind === "team" ? active.label : null
  const [authority, setAuthority] = useState<TeamAuthority | null>(null)

  const refresh = useCallback(async () => {
    if (!teamId || !clubId) {
      setAuthority(noTeamAuthority())
      return
    }
    try {
      setAuthority(await readTeamAuthority(supabase, clubId, teamId))
    } catch {
      setAuthority(noTeamAuthority())
    }
  }, [teamId, clubId])

  useEffect(() => {
    // Cleared FIRST: the previous team's answer must never decide this team's controls.
    setAuthority(null)
    void refresh()
  }, [refresh])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh])
  )

  return { loading: authority === null, teamId, clubId, teamName, authority: authority ?? noTeamAuthority(), refresh }
}
