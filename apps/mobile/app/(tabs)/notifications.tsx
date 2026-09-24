import { useCallback, useEffect, useState } from "react"
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { getRecentNotifications, type NotificationItem } from "@ovalball/contracts"

import { supabase } from "../../src/auth/supabase"
import { webUrl } from "../../src/config/environment"
import { useAppContexts } from "../../src/context/contexts"
import { narrowIntentForContext, routeForIntent } from "../../src/links/destinations"
import { resolveIntent } from "../../src/links/intents"
import { teamContextKeyFor } from "../../src/team/context"
import { Bell, ChevronRight } from "../../src/components/icons"
import { CardSkeleton, EmptyState, ErrorState } from "../../src/components/ui"
import { friendly, logDetail } from "../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../src/design/tokens"

/**
 * NOTIFICATIONS — the canonical bell, natively.
 *
 * P1 DOES NOT IMPLEMENT PUSH, and this screen does not pretend otherwise. There
 * is no device registry, no token and no delivery: what this shows is the
 * IN-APP notification product that already exists, read through
 * `public.my_bell_notifications` -- the same function the website's bell reads,
 * whose split from the Messages badge is decided in the database by the
 * notification registry's own topic.
 *
 * That is the point of doing it this way round. When push arrives at P11 it
 * becomes another DELIVERY CHANNEL for these same rows, rather than a second
 * event system wired straight from a button to APNs.
 *
 * WHERE A NOTIFICATION GOES is `notificationHref`, the shared destination map --
 * the one the structural guard checks against the registry so that no type falls
 * through to a dashboard. The app parses that canonical href through its OWN
 * intent resolver rather than carrying a second table: a href the app can open
 * natively opens natively, and anything else opens the canonical web page. A
 * notification that goes nowhere spends a person's attention and gives nothing
 * back.
 *
 * READ IS NOT DONE. A notification being read says somebody looked at it, never
 * that the thing it was about has been dealt with -- so nothing here marks a
 * task complete, and the unread badge is not an outstanding-work counter.
 */
export default function Notifications() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { refreshUnread, active, contexts, select } = useAppContexts()

  const [items, setItems] = useState<NotificationItem[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setProblem(null)
    try {
      setItems(await getRecentNotifications(supabase, 30))
    } catch (caught) {
      const failure = friendly(caught, "your notifications")
      logDetail("notifications", failure)
      setProblem(failure.message)
    }
  }, [])

  useEffect(() => {
    void load()
    void refreshUnread()
  }, [load, refreshUnread])

  function open(item: NotificationItem) {
    /*
      THE CANONICAL DESTINATION, PARSED RATHER THAN RE-DERIVED.

      `item.href` is the shared map's answer. `resolveIntent` already knows every
      path the app can open -- a fixture, a Match Centre, a training session, a
      conversation, the calendar -- so feeding it the canonical href gives the
      native destination without a second table of type-to-route, which is the
      thing that drifts.

      AND THE ID IS NOT A PERMISSION. Every screen these reach re-reads through
      RLS; one this person may no longer see says so on arrival rather than being
      filtered out of a list by a client.
    */
    /*
      AND NARROWED TO THE VIEWER'S OWN CONTEXT FIRST.

      The canonical href for every fixture notification is `/fixtures/<id>`, which
      resolves to the address that decides by authority. For a parent or a player
      that is narrowed here to the participant address, which cannot draw
      administration at all -- so the bell cannot be a way into a fixture console
      even if the deciding gate were ever wrong.
    */
    const intent = narrowIntentForContext(resolveIntent(`ovalball://${item.href.replace(/^\//, "")}`), active?.kind ?? null)
    const route = routeForIntent(intent)
    if (route) {
      /*
        A TEAM LINK OPENS IN THAT TEAM (CA-M7). If the notification names a team the person holds as a
        context and is not standing in, the app selects it first -- the same switch the header offers,
        over the same list the website computes. A team that is not one of their contexts is left
        alone: a link can select a context that was on offer, never grant one.
      */
      if (intent.kind === "TEAM") {
        const key = teamContextKeyFor(intent.teamId, contexts, active)
        if (key) void select(key)
      }
      router.push(route as never)
      return
    }
    // Everything the app has no native screen for yet opens the canonical page
    // rather than nothing at all.
    void Linking.openURL(`${webUrl}${item.href}`)
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View
        style={{
          paddingTop: insets.top + space.sm,
          paddingBottom: space.sm,
          paddingHorizontal: space.md,
          borderBottomWidth: 1,
          borderBottomColor: colour.line,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => ({
            width: TOUCH_TARGET,
            height: TOUCH_TARGET,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.ink} />
          </View>
        </Pressable>
        <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>
          Notifications
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.md }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true)
              void Promise.all([load(), refreshUnread()]).finally(() => setRefreshing(false))
            }}
            tintColor={colour.forest800}
          />
        }
      >
        {problem ? (
          <ErrorState message={problem} onRetry={() => void load()} />
        ) : items === null ? (
          <CardSkeleton lines={3} />
        ) : items.length === 0 ? (
          <EmptyState
            title="Nothing new"
            body="Changes to your rugby — a moved kick-off, a cancelled session, something that needs an answer — arrive here."
            icon={<Bell size={26} color={colour.forest800} strokeWidth={1.8} />}
          />
        ) : (
          <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
            {items.map((item, index) => {
              const unread = item.readAt === null
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${unread ? "Unread. " : ""}${item.title}. ${item.body}`}
                  onPress={() => open(item)}
                  style={({ pressed }) => ({
                    minHeight: TOUCH_TARGET,
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: space.md,
                    padding: space.lg,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: colour.line,
                    backgroundColor: pressed ? colour.chalk : colour.surface,
                  })}
                >
                  {/* UNREAD IS A MARK AND A WORD, never a colour alone -- the
                      accessible sentence above says "Unread" outright. */}
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      marginTop: 6,
                      backgroundColor: unread ? colour.pitch600 : "transparent",
                    }}
                  />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      style={[
                        type.smallMedium,
                        { color: colour.ink, fontFamily: unread ? "Inter_600SemiBold" : "Inter_500Medium" },
                      ]}
                    >
                      {item.title}
                    </Text>
                    <Text style={[type.small, { color: colour.inkMuted, marginTop: 2 }]}>{item.body}</Text>
                  </View>
                  <ChevronRight size={17} color={colour.inkSubtle} />
                </Pressable>
              )
            })}
          </View>
        )}

        {/* SAID PLAINLY RATHER THAN IMPLIED. Push is P11, and a person whose
            phone stays quiet should know why rather than assume Ovalball is
            broken. */}
        <Text style={[type.caption, { color: colour.inkSubtle, textAlign: "center", paddingHorizontal: space.lg }]}>
          Ovalball does not send push notifications to this device yet. These arrive when you open the
          app.
        </Text>
      </ScrollView>
    </View>
  )
}
