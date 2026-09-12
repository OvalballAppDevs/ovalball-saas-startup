"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

import { createClient } from "@/lib/supabase/client"

/**
 * LIVE REFRESH FOR A CONVERSATION THAT HAS NO PRESENCE LIST.
 *
 * The fixture workspace already subscribes, but it does so inside
 * useFixturePresence because a fixture also shows who is online. A direct
 * conversation has two people and no presence roster, so it needs the
 * refresh half on its own.
 *
 * This is deliberately the SAME topic and the SAME broadcast event the
 * database already sends (internal.broadcast_fixture_message), not a second
 * realtime model. The payload is ignored on purpose: it carries no content,
 * so the only correct reaction is to re-read through RLS, which is what
 * router.refresh() does by re-running the server component.
 *
 * THE ROUTER IS HELD IN A REF, AND THAT IS LOAD-BEARING. useRouter() returns
 * a new object identity on every render, so naming it as a dependency tears
 * the channel down and rebuilds it on each render; removeChannel() is async,
 * so the rebuild races its own teardown and the subscription settles in
 * CLOSED -- silently, because a refused channel reports nothing. The effect
 * must therefore depend on the TOPIC alone, which is the only thing that
 * actually identifies the subscription. A ref keeps the latest router
 * available to the callback without making it a reason to resubscribe.
 */
export function useConversationRealtime(topic: string | null) {
  const router = useRouter()
  const routerRef = useRef(router)

  // Kept current in an effect rather than during render: a ref written while
  // rendering is a lint error and, more to the point, a render is not the
  // moment this value is needed -- only the broadcast callback reads it.
  useEffect(() => {
    routerRef.current = router
  })

  useEffect(() => {
    if (!topic) return
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false

    // THE TOPIC IS PRIVATE, SO THE SOCKET MUST BE AUTHENTICATED FIRST.
    // The browser client restores its session from cookies asynchronously;
    // subscribing before that lands joins as an anonymous socket, RLS
    // refuses it, and the channel settles in CLOSED without ever raising
    // anything. Resolving the session first is what makes the join carry
    // the person's identity -- which is the same identity realtime RLS
    // uses to decide whether they may listen at all.
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (cancelled || !session) return

      await supabase.realtime.setAuth(session.access_token)
      if (cancelled) return

      channel = supabase.channel(topic, { config: { private: true } })
      channel.on("broadcast", { event: "fixture_message_inserted" }, () => {
        routerRef.current.refresh()
      })
      void channel.subscribe()
    })()

    return () => {
      cancelled = true
      if (channel) void supabase.removeChannel(channel)
    }
  }, [topic])
}
