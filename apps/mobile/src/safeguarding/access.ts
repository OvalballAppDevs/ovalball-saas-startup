import { useCallback, useEffect, useState } from "react"
import { useFocusEffect } from "expo-router"
import { noSafeguardingAccess, readSafeguardingAccess, type SafeguardingAccess } from "@ovalball/contracts/club/safeguarding"

import { supabase } from "../auth/supabase"
import { useAppContexts } from "../context/contexts"

/**
 * WHAT THIS PERSON MAY DO ABOUT SAFEGUARDING AT THE ACTIVE CLUB -- asked of the SERVER (CA-M11.1).
 *
 * Two different people reach the safeguarding screens. A Club Admin holds the club's own key
 * (`safeguarding.officer.nominate`) and manages who the officer is; that is the Admin Centre section.
 * A confirmed Safeguarding Officer holds the officer's keys and may or may not be a Club Admin at all;
 * `isOfficer` is what a More row asks before offering them the same screen. Neither is a role label:
 * both come from `my_capabilities`, re-asked on every context change and every focus, never cached
 * across either.
 */
export interface SafeguardingAccessState {
  loading: boolean
  /** The selected context's club, when the selected context is a club context. */
  clubId: string | null
  access: SafeguardingAccess
  /** Any of the officer's own keys at this club. */
  isOfficer: boolean
  refresh: () => Promise<void>
}

export function useSafeguardingOfficerAccess(): SafeguardingAccessState {
  const { active } = useAppContexts()
  const clubId = active?.kind === "club" ? (active.clubId ?? active.id) : null
  const [access, setAccess] = useState<SafeguardingAccess | null>(null)

  const refresh = useCallback(async () => {
    if (!clubId) {
      setAccess(noSafeguardingAccess())
      return
    }
    try {
      setAccess(await readSafeguardingAccess(supabase, clubId))
    } catch {
      setAccess(noSafeguardingAccess())
    }
  }, [clubId])

  useEffect(() => {
    // Cleared FIRST: the previous context's answer must never decide this context's screen.
    setAccess(null)
    void refresh()
  }, [refresh])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh])
  )

  const resolved = access ?? noSafeguardingAccess()
  return { loading: access === null, clubId, access: resolved, isOfficer: resolved.anyOfficer, refresh }
}
