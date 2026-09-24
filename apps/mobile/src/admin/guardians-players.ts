import { useCallback, useEffect, useState } from "react"
import { useFocusEffect } from "expo-router"
import { noGuardiansPlayersCapabilities, readGuardiansPlayersCapabilities, type GuardiansPlayersCapabilities } from "@ovalball/contracts/club/guardians-players"

import { supabase } from "../auth/supabase"
import { useAppContexts } from "../context/contexts"

/**
 * WHAT THIS PERSON MAY DO ABOUT THE CLUB'S PLAYERS AND GUARDIANS -- asked of the SERVER (CA-M11.1).
 *
 * One `my_capabilities` read at club scope, re-asked on every context change and every time a screen
 * comes back into focus. Every control in the section is drawn from these answers and none from a
 * role label; the database judges every write again regardless of what was drawn.
 */
export interface GuardiansPlayersState {
  loading: boolean
  clubId: string | null
  clubName: string | null
  caps: GuardiansPlayersCapabilities
  refresh: () => Promise<void>
}

export function useGuardiansPlayersAccess(): GuardiansPlayersState {
  const { active, club } = useAppContexts()
  const clubId = active?.kind === "club" ? (active.clubId ?? active.id) : null
  const [caps, setCaps] = useState<GuardiansPlayersCapabilities | null>(null)

  const refresh = useCallback(async () => {
    if (!clubId) {
      setCaps(noGuardiansPlayersCapabilities())
      return
    }
    try {
      setCaps(await readGuardiansPlayersCapabilities(supabase, clubId))
    } catch {
      setCaps(noGuardiansPlayersCapabilities())
    }
  }, [clubId])

  useEffect(() => {
    // Cleared FIRST: the previous context's answer must never decide this context's controls.
    setCaps(null)
    void refresh()
  }, [refresh])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh])
  )

  return { loading: caps === null, clubId, clubName: club.name ?? null, caps: caps ?? noGuardiansPlayersCapabilities(), refresh }
}

/** Today as a civil date, for the reads that ask "from today". */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}
