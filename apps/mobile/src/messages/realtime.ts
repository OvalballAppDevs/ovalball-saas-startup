import { useEffect, useRef } from "react"

import { supabase } from "../auth/supabase"

/**
 * LIVE REFRESH, REUSING THE PLATFORM'S OWN MECHANISM.
 *
 * Ovalball already broadcasts on a PRIVATE channel per conversation
 * (`internal.broadcast_fixture_message`, topic `presence:<kind>:<id>`), and the website listens to
 * exactly this. The broadcast deliberately carries NO CONTENT, so the only correct reaction is to
 * re-read through RLS -- which means reusing it adds no new way for a message to reach a device.
 * That is what makes it safe to reuse rather than a second realtime model to build.
 *
 * THE SOCKET MUST BE AUTHENTICATED BEFORE SUBSCRIBING. A private topic joined by an anonymous socket
 * is refused by RLS and the channel settles in CLOSED silently -- nothing raises. The web client
 * learned this the same way; `setAuth` with the current access token is what makes the join carry the
 * person's identity, which is the identity realtime RLS uses to decide whether they may listen.
 *
 * THE CALLBACK IS HELD IN A REF, and that is load-bearing. Naming it as a dependency rebuilds the
 * channel on every render, and `removeChannel` is async, so the rebuild races its own teardown. The
 * effect depends on the TOPIC alone, because the topic is the only thing that identifies the
 * subscription.
 */
export function useConversationRealtime(topic: string | null, onMessage: () => void) {
  const handler = useRef(onMessage)

  useEffect(() => {
    handler.current = onMessage
  })

  useEffect(() => {
    if (!topic) return
    let channel: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (cancelled || !session) return

      await supabase.realtime.setAuth(session.access_token)
      if (cancelled) return

      channel = supabase.channel(topic, { config: { private: true } })
      channel.on("broadcast", { event: "fixture_message_inserted" }, () => handler.current())
      void channel.subscribe()
    })()

    return () => {
      cancelled = true
      if (channel) void supabase.removeChannel(channel)
    }
  }, [topic])
}

/**
 * The topic for a conversation, in the platform's own scheme
 * (`internal.message_realtime_topic`): c club, t team, s safeguarding, a announcement, d direct,
 * f fixture, r request. Written here as a mapping rather than a string built at each call site, so a
 * typo produces no subscription rather than a wrong one.
 */
const TOPIC_PREFIX: Record<string, string> = {
  direct: "presence:d:",
  fixture: "presence:f:",
  request: "presence:r:",
  club: "presence:c:",
}

export function conversationTopic(kind: string, conversationId: string | null): string | null {
  const prefix = TOPIC_PREFIX[kind]
  if (!prefix || !conversationId) return null
  return `${prefix}${conversationId}`
}
