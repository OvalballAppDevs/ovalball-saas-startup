import { useCallback, useEffect, useState } from "react"
import { useFocusEffect } from "expo-router"
import { noFinanceAuthority, readFinanceAuthority, type FinanceAuthority } from "@ovalball/contracts/club/finance"

import { supabase } from "../auth/supabase"

/**
 * WHAT THIS PERSON MAY DO WITH THE CLUB'S MONEY -- asked of the SERVER, at club scope, for exactly the
 * keys the website's finance pages gate on (`FINANCE_AUTHORITY_KEYS`). Cleared first on every club change
 * and re-asked every time a finance screen comes back into focus, so a yes never outlives the permission
 * it came from. The answer decides what is OFFERED; every RPC judges the call again.
 */
export function useFinanceAuthority(clubId: string | null): { loading: boolean; authority: FinanceAuthority; refresh: () => Promise<void> } {
  const [authority, setAuthority] = useState<FinanceAuthority | null>(null)

  const refresh = useCallback(async () => {
    if (!clubId) {
      setAuthority(noFinanceAuthority())
      return
    }
    try {
      setAuthority(await readFinanceAuthority(supabase, clubId))
    } catch {
      setAuthority(noFinanceAuthority())
    }
  }, [clubId])

  useEffect(() => {
    setAuthority(null)
    void refresh()
  }, [refresh])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh])
  )

  return { loading: authority === null, authority: authority ?? noFinanceAuthority(), refresh }
}
