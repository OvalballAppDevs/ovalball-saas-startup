import { useCallback } from "react"
import { Linking } from "react-native"
import { useRouter } from "expo-router"

import { notificationContextHint } from "@ovalball/contracts/notifications/feed"

import { webUrl } from "../config/environment"
import { useAppContexts } from "../context/contexts"
import { routeForHref } from "../links/destinations"
import { teamContextKeyFor } from "../team/context"

/**
 * OPENING A NOTIFICATION, ONCE -- shared by the Notifications Centre and the bell's quick view, so
 * the two surfaces cannot drift into two routing rules. (The push tap in `push.ts` reaches the same
 * `routeForHref`; it has no context to switch because it fires before anybody chose one.)
 *
 * A LINK MAY SELECT A CONTEXT THAT WAS ON OFFER, never grant one: only a team this person already
 * holds as a context is switched into, and only when they are not already standing in a team.
 * Marking the row read is the caller's job, because each surface keeps its own copy of the row.
 */
export function useNotificationNavigator() {
  const router = useRouter()
  const { active, contexts, select } = useAppContexts()

  return useCallback(
    (item: { href: string; data: Record<string, unknown> }) => {
      const hint = notificationContextHint(item.data)
      if (hint.teamId && active?.kind !== "team") {
        const key = teamContextKeyFor(hint.teamId, contexts, active)
        if (key) void select(key)
      }
      const route = routeForHref(item.href, active?.kind ?? null)
      if (route) {
        router.push(route as never)
        return
      }
      void Linking.openURL(`${webUrl}${item.href}`)
    },
    [router, active, contexts, select]
  )
}
