import { useCallback, useEffect, useState } from "react"
import { AppState } from "react-native"
import { loadDirectPresence, PRESENCE_HEARTBEAT_MS, presenceFromLastActive, touchLastActive, type DirectPresence, type PresenceState } from "@ovalball/contracts"

import { supabase } from "../auth/supabase"

/**
 * PRESENCE, AS THE PLATFORM ALREADY DEFINES IT.
 *
 * The heartbeat is `touch_last_active` -- the same one the website's conversation page sends -- every
 * minute while the app is in the FOREGROUND and somebody is signed in. Backgrounded, it stops, so a
 * phone in a pocket stops looking "Online" within two minutes rather than ever claiming it.
 *
 * Reading it back is `my_direct_presence`, which answers only for the other person in my own direct
 * conversations, only between adults, and never across a block. A group conversation shows no presence,
 * because there is no server answer for it that would be both truthful and safe to give.
 */
export function usePresenceHeartbeat(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn) return
    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (timer) return
      void touchLastActive(supabase).catch(() => {})
      timer = setInterval(() => void touchLastActive(supabase).catch(() => {}), PRESENCE_HEARTBEAT_MS)
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }
    if (AppState.currentState === "active") start()
    const subscription = AppState.addEventListener("change", (state) => (state === "active" ? start() : stop()))
    return () => {
      stop()
      subscription.remove()
    }
  }, [signedIn])
}

/** The other person's presence in each of my direct conversations, refreshed once a minute while shown. */
export function useDirectPresence(enabled = true) {
  const [byConversation, setByConversation] = useState<Map<string, DirectPresence>>(new Map())
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(async () => {
    try {
      setByConversation(await loadDirectPresence(supabase))
    } catch {
      // Presence is a nicety: failing to read it shows nothing, never a wrong state.
    }
    setNow(Date.now())
  }, [])

  useEffect(() => {
    if (!enabled) return
    void refresh()
    const timer = setInterval(() => void refresh(), PRESENCE_HEARTBEAT_MS)
    return () => clearInterval(timer)
  }, [enabled, refresh])

  const presenceFor = useCallback(
    (conversationId: string | null | undefined): PresenceState =>
      conversationId ? presenceFromLastActive(byConversation.get(conversationId)?.lastActiveAt ?? null, now) : { online: false, label: null },
    [byConversation, now]
  )

  /** The same answer by person: only for people I already have a direct conversation with. */
  const presenceForUser = useCallback(
    (userId: string): PresenceState => {
      for (const entry of byConversation.values()) if (entry.otherUserId === userId) return presenceFromLastActive(entry.lastActiveAt, now)
      return { online: false, label: null }
    },
    [byConversation, now]
  )

  return { presenceFor, presenceForUser, refresh }
}
