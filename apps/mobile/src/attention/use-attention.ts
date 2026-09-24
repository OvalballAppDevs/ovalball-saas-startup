import { useCallback, useEffect, useState } from "react"
import { useFocusEffect } from "expo-router"

import { loadAttentionForContext, type AttentionRead } from "@ovalball/contracts/attention"

import { supabase } from "../auth/supabase"
import { todayIso } from "../agenda/load"
import { useAppContexts } from "../context/contexts"
import { useFamily } from "../family/family"
import { friendly, logDetail } from "../errors/translate"
import { invalidateAttention, recallAttention, rememberAttention } from "./cache"

export interface AttentionState {
  loading: boolean
  read: AttentionRead | null
  error: string | null
  /** Re-read from the source domains, bypassing the cache. */
  refresh: () => Promise<void>
}

/**
 * WHAT NEEDS ME, HERE -- the shared projection for the context this person is standing in.
 *
 * Cleared the moment the context changes, so a team's queue never sits under a family's name for the
 * length of a read. Re-asked on focus, because answering happens on other screens and the projection
 * must not remember a job the domain has already closed.
 */
export function useAttention(): AttentionState {
  const { active, sessionContext } = useAppContexts()
  const { selectedPlayerId } = useFamily()
  const [read, setRead] = useState<AttentionRead | null>(null)
  const [error, setError] = useState<string | null>(null)
  const contextKey = active ? `${active.key}|${selectedPlayerId ?? "all"}` : null

  const load = useCallback(
    async (fresh: boolean) => {
      if (!active || !sessionContext || !contextKey) {
        setRead(null)
        return
      }
      if (!fresh) {
        const cached = recallAttention(contextKey)
        if (cached) {
          setRead(cached)
          return
        }
      }
      setError(null)
      try {
        const next = await loadAttentionForContext(supabase, sessionContext, active, { todayIso: todayIso(), selectedPlayerId })
        rememberAttention(contextKey, next)
        setRead(next)
      } catch (caught) {
        const problem = friendly(caught, "what needs your attention")
        logDetail("attention", problem)
        setRead(null)
        setError(problem.message)
      }
    },
    [active, sessionContext, contextKey, selectedPlayerId]
  )

  useEffect(() => {
    // The previous context's answer is cleared before the next is asked for.
    setRead(null)
    void load(false)
  }, [load])

  useFocusEffect(
    useCallback(() => {
      void load(false)
    }, [load])
  )

  const refresh = useCallback(async () => {
    if (contextKey) invalidateAttention(contextKey)
    await load(true)
  }, [contextKey, load])

  return { loading: read === null && error === null && !!active, read, error, refresh }
}
