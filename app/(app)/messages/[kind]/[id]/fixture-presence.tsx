"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { createClient } from "@/lib/supabase/client"

/**
 * Never a permanent `online = true` flag. "Online" is claimed ONLY while
 * this user is genuinely present in the live Realtime Presence channel
 * (gone the instant their tab closes or their socket drops) -- everyone
 * else falls back to the honest last_active_at heartbeat: Recently active
 * (<15 min), Last active HH:MM (same day), or Offline. Club-scoped by
 * construction: the channel itself is a private topic, authorized only for
 * real fixture-conversation participants by realtime.messages RLS
 * (internal.can_access_fixture_presence_topic) -- nobody outside that
 * boundary can even join to see who else is present.
 */

export type PresenceStatus = { online: boolean; label: string }

export function presenceLabel(userId: string, onlineUserIds: Set<string>, lastActiveAt: string | null): PresenceStatus {
  if (onlineUserIds.has(userId)) return { online: true, label: "Online" }
  if (!lastActiveAt) return { online: false, label: "Offline" }
  const ageMs = Date.now() - new Date(lastActiveAt).getTime()
  if (ageMs < 15 * 60 * 1000) return { online: false, label: "Recently active" }
  if (ageMs < 24 * 60 * 60 * 1000) {
    const hhmm = new Date(lastActiveAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    return { online: false, label: `Last active ${hhmm}` }
  }
  return { online: false, label: "Offline" }
}

/**
 * Also the live-refresh mechanism (no separate channel -- two independent
 * .channel(sameTopic) + .subscribe() calls for the same topic collide, see
 * the module comment above): internal.broadcast_fixture_message()
 * broadcasts a lightweight event on this exact topic whenever a message
 * or system event (pitch/kickoff/result/etc.) is inserted into the
 * conversation, from EITHER side. router.refresh() re-runs this route's
 * server components and merges the result into the existing client tree,
 * so every consumer of server-rendered fixture data (the message list,
 * the result panel, the header) updates without a full page reload --
 * regardless of which client component actually calls it.
 */
export function useFixturePresence(topic: string, myUserId: string): Set<string> {
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set())
  const heartbeatStarted = useRef(false)
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel(topic, { config: { presence: { key: myUserId }, private: true } })

    channel
      .on("presence", { event: "sync" }, () => {
        setOnlineUserIds(new Set(Object.keys(channel.presenceState())))
      })
      .on("broadcast", { event: "fixture_message_inserted" }, () => {
        router.refresh()
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ online_at: new Date().toISOString() })
        }
      })

    if (!heartbeatStarted.current) {
      heartbeatStarted.current = true
      void supabase.rpc("touch_last_active")
    }
    const heartbeat = setInterval(() => void supabase.rpc("touch_last_active"), 60_000)

    return () => {
      clearInterval(heartbeat)
      void supabase.removeChannel(channel)
    }
  }, [topic, myUserId])

  return onlineUserIds
}

export function PresenceDot({ online }: { online: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={online ? "inline-block size-2 rounded-full bg-pitch-600" : "inline-block size-2 rounded-full bg-ink/20"}
    />
  )
}
