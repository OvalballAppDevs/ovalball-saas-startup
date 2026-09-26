import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Linking, Modal, Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { isFamilyFacingContext } from "@ovalball/contracts"
import { countNeedingAction, groupAttention, type AttentionItem } from "@ovalball/contracts/attention"
import {
  attentionVerdict,
  CLUBHOUSE_NOTIFICATION_TYPES,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationUnread,
  notificationContextHint,
  notificationPriority,
  readNotificationPage,
  type FeedCursor,
  type FeedNotification,
} from "@ovalball/contracts/notifications/feed"

import { supabase } from "../../../src/auth/supabase"
import { webUrl } from "../../../src/config/environment"
import { useAppContexts } from "../../../src/context/contexts"
import { invalidateAttention } from "../../../src/attention/cache"
import { routeForAttentionItem } from "../../../src/attention/routes"
import { useAttention } from "../../../src/attention/use-attention"
import { narrowIntentForContext, routeForIntent } from "../../../src/links/destinations"
import { resolveIntent } from "../../../src/links/intents"
import { teamContextKeyFor } from "../../../src/team/context"
import { NotificationCard, QuietClock } from "../../../src/components/notification-card"
import { NeedsAttention, type AttentionItem as AttentionRow } from "../../../src/components/needs-attention"
import { Bell, ChevronRight, CircleCheck, Settings2 } from "../../../src/components/icons"
import { Button, CardSkeleton, EmptyState, ErrorState } from "../../../src/components/ui"
import { friendly, logDetail } from "../../../src/errors/translate"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/**
 * NOTIFICATIONS -- one trustworthy attention system, natively (CA-M8).
 *
 * TWO THINGS, TOLD APART. "Needs Attention" is the shared attention projection: what still needs this
 * person in the context they are standing in, read from the domains that own the work. "Recent" is the
 * canonical notification feed: what Ovalball has told them, newest first, paged from
 * `my_notifications`. A notification is a message; an attention item is a job. Opening a message
 * marks it read and changes nothing about the job; answering the job makes the item disappear and
 * leaves the message read or unread exactly as it was. READ IS NOT RESOLVED.
 *
 * THE FILTERS ARE TRUTHFUL. "All" and "Unread" are what the storage holds. "Needs Action" is offered
 * only where the projection can actually say -- a context whose work the app holds -- and it lists the
 * notifications the projection still finds open, never the ones whose type merely sounds like a job.
 *
 * NO FAKE STATE. Read and unread are the row's own `read_at`, changed through the canonical
 * operations both clients share. There is no dismiss, no delete and no local inbox: what a person
 * cannot do on the website they cannot do here, and what they can do is the same thing.
 *
 * PUSH IS NOT PRETENDED. Nothing here is delivered to the device; the foundation for that is recorded
 * as pending in the domain map, with its prerequisites, rather than approximated.
 */
type Tab = "attention" | "recent"
type Filter = "all" | "unread" | "action" | "clubhouse"

/**
 * CLUBHOUSE ACTIVITY'S OWN CATEGORY SUB-FILTER (mock-up reconciliation): the reference shows Clubhouse
 * Activity as its own feed with Fixtures/Partnerships/Opportunities tabs, not just the generic
 * Notifications screen's All/Unread/Action/Clubhouse row. Rather than a second screen/read path, this
 * refines the SAME already-`clubhouse`-filtered `visible` list client-side, purely from the type each
 * notification already carries -- never a new query, never a fabricated feed.
 */
type ClubhouseCategory = "all" | "fixtures" | "partnerships" | "opportunities"
function clubhouseCategoryOf(type: string): Exclude<ClubhouseCategory, "all"> {
  if (type.startsWith("fixture_opportunity")) return "opportunities"
  if (type.startsWith("fixture_request")) return "fixtures"
  return "partnerships"
}

const TOPIC_LABEL: Record<string, string> = {
  fixture_updates: "Fixture update",
  fixture_requests: "Fixture request",
  calendar_training_updates: "Training",
  access_invitations: "Access",
  account_security: "Account",
  support_moderation: "Safeguarding & support",
  platform_billing: "Ovalball billing",
  membership_payments: "Membership payment",
}

export default function Notifications() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const params = useLocalSearchParams<{ filter?: string }>()
  const { unread, refreshUnread, active, contexts, select } = useAppContexts()
  const attention = useAttention()
  const familyFacing = active !== null && isFamilyFacingContext(active.kind)

  // Clubhouse Home's "See All" arrives with ?filter=clubhouse -- landing straight on Recent, already
  // filtered, rather than on Needs Attention with the person having to find the filter themselves.
  const arrivedViaClubhouse = params.filter === "clubhouse"
  const [tab, setTab] = useState<Tab>(arrivedViaClubhouse ? "recent" : "attention")
  const [filter, setFilter] = useState<Filter>(arrivedViaClubhouse ? "clubhouse" : "all")
  const [clubhouseCategory, setClubhouseCategory] = useState<ClubhouseCategory>("all")
  const [items, setItems] = useState<FeedNotification[] | null>(null)
  const [cursor, setCursor] = useState<FeedCursor | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [held, setHeld] = useState<FeedNotification | null>(null)
  const now = useMemo(() => new Date(), [items])
  const generation = useRef(0)

  const loadFirstPage = useCallback(async (unreadOnly: boolean) => {
    const mine = ++generation.current
    setProblem(null)
    try {
      const page = await readNotificationPage(supabase, { unreadOnly })
      if (mine !== generation.current) return
      setItems(page.items)
      setCursor(page.next)
    } catch (caught) {
      if (mine !== generation.current) return
      const failure = friendly(caught, "your notifications")
      logDetail("notifications", failure)
      setItems(null)
      setProblem(failure.message)
    }
  }, [])

  // The unread-only page comes from the server, so "Unread" is the storage's answer, not a client's.
  useEffect(() => {
    setItems(null)
    void loadFirstPage(filter === "unread")
    void refreshUnread()
  }, [filter, loadFirstPage, refreshUnread])

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await readNotificationPage(supabase, { cursor, unreadOnly: filter === "unread" })
      setItems((prev) => [...(prev ?? []), ...page.items])
      setCursor(page.next)
    } catch (caught) {
      logDetail("notifications page", friendly(caught, "older notifications"))
    } finally {
      setLoadingMore(false)
    }
  }, [cursor, loadingMore, filter])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([loadFirstPage(filter === "unread"), refreshUnread(), attention.refresh()])
    setRefreshing(false)
  }, [loadFirstPage, filter, refreshUnread, attention])

  // ---- The read mutation: canonical, then the badge recounted from the same source ---------------
  const setRead = useCallback(
    async (item: FeedNotification, read: boolean) => {
      const stamp = read ? new Date().toISOString() : null
      setItems((prev) => (prev ?? []).map((n) => (n.id === item.id ? { ...n, readAt: stamp } : n)))
      try {
        if (read) await markNotificationRead(supabase, item.id)
        else await markNotificationUnread(supabase, item.id)
      } catch (caught) {
        // The server's answer wins: put the row back as it was.
        setItems((prev) => (prev ?? []).map((n) => (n.id === item.id ? { ...n, readAt: item.readAt } : n)))
        logDetail("mark notification", friendly(caught, "that notification"))
      }
      invalidateAttention()
      await refreshUnread()
    },
    [refreshUnread]
  )

  const markAll = useCallback(async () => {
    const stamp = new Date().toISOString()
    setItems((prev) => (prev ?? []).map((n) => (n.readAt ? n : { ...n, readAt: stamp })))
    try {
      await markAllNotificationsRead(supabase)
    } catch (caught) {
      logDetail("mark all read", friendly(caught, "your notifications"))
      void loadFirstPage(filter === "unread")
    }
    await refreshUnread()
  }, [refreshUnread, loadFirstPage, filter])

  // ---- Opening: read first, then the one resolver, standing in the right context ------------------
  function open(item: FeedNotification) {
    if (item.readAt === null) void setRead(item, true)
    const hint = notificationContextHint(item.data)
    // A LINK MAY SELECT A CONTEXT THAT WAS ON OFFER, never grant one: only a team this person already
    // holds as a context is switched into, and only when they are not already standing in it.
    if (hint.teamId && active?.kind !== "team") {
      const key = teamContextKeyFor(hint.teamId, contexts, active)
      if (key) void select(key)
    }
    const intent = narrowIntentForContext(resolveIntent(`ovalball://${item.href.replace(/^\//, "")}`), active?.kind ?? null)
    const route = routeForIntent(intent)
    if (route) {
      router.push(route as never)
      return
    }
    void Linking.openURL(`${webUrl}${item.href}`)
  }

  function openAttention(item: AttentionItem) {
    const route = routeForAttentionItem(item, active?.kind ?? null)
    if (route) router.push(route as never)
    else void Linking.openURL(`${webUrl}${item.href}`)
  }

  // ---- What the projection says about each notification, for the card and for the filter --------
  const verdicts = useMemo(() => {
    const map = new Map<string, ReturnType<typeof attentionVerdict>>()
    for (const n of items ?? []) map.set(n.id, attentionVerdict(n.type, n.data, attention.read, familyFacing))
    return map
  }, [items, attention.read, familyFacing])

  const canOfferActionFilter = attention.read?.coverage === "native"
  const visible = useMemo(() => {
    const all = items ?? []
    if (filter === "action") return all.filter((n) => verdicts.get(n.id) === "open")
    if (filter === "clubhouse") {
      const clubhouseOnly = all.filter((n) => CLUBHOUSE_NOTIFICATION_TYPES.has(n.type))
      if (clubhouseCategory === "all") return clubhouseOnly
      return clubhouseOnly.filter((n) => clubhouseCategoryOf(n.type) === clubhouseCategory)
    }
    return all
  }, [items, filter, clubhouseCategory, verdicts])

  const attentionItems = attention.read?.items ?? []
  const actionCount = countNeedingAction(attentionItems)
  const contextLabelFor = useCallback(
    (n: FeedNotification): string | null => {
      const hint = notificationContextHint(n.data)
      if (hint.teamId) return contexts.find((c) => c.kind === "team" && c.id === hint.teamId)?.label ?? null
      if (hint.clubId) return contexts.find((c) => c.kind === "club" && (c.clubId ?? c.id) === hint.clubId)?.label ?? null
      return null
    },
    [contexts]
  )

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View style={{ paddingTop: insets.top + space.sm, paddingBottom: space.sm, paddingHorizontal: space.md, borderBottomWidth: 1, borderBottomColor: colour.line, gap: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            hitSlop={8}
            style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
          >
            <View style={{ transform: [{ rotate: "180deg" }] }}>
              <ChevronRight size={22} color={colour.ink} />
            </View>
          </Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
              {arrivedViaClubhouse ? "Clubhouse Activity" : "Notifications"}
            </Text>
            {/* TWO FIGURES, TWO WORDS. The unread count is the badge's own number from the one canonical
                read; the action count is the projection's, and is never added to it. */}
            <Text style={[type.caption, { color: colour.inkMuted }]}>
              {[unread.notifications > 0 ? `${unread.notifications} unread` : "Nothing unread", actionCount > 0 ? `${actionCount} need${actionCount === 1 ? "s" : ""} action` : null]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Notification preferences"
            onPress={() => router.push("/notifications/preferences" as never)}
            hitSlop={8}
            style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
          >
            <Settings2 size={20} color={colour.ink} strokeWidth={1.9} />
          </Pressable>
        </View>

        <View accessibilityRole="tablist" style={{ flexDirection: "row", backgroundColor: "rgba(16,21,18,0.05)", borderRadius: radius.md, padding: 3 }}>
          {(["attention", "recent"] as const).map((option) => {
            const selected = option === tab
            const label = option === "attention" ? (attentionItems.length > 0 ? `Needs Attention (${attentionItems.length})` : "Needs Attention") : "Recent"
            return (
              <Pressable
                key={option}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={label}
                onPress={() => setTab(option)}
                style={{ flex: 1, minHeight: TOUCH_TARGET - 8, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: selected ? colour.surface : "transparent" }}
              >
                <Text style={[type.smallMedium, { color: selected ? colour.ink : colour.inkMuted, fontSize: 13 }]}>{label}</Text>
              </Pressable>
            )
          })}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colour.forest800} />}
        onScroll={({ nativeEvent }) => {
          const nearEnd = nativeEvent.layoutMeasurement.height + nativeEvent.contentOffset.y >= nativeEvent.contentSize.height - 240
          if (tab === "recent" && nearEnd) void loadMore()
        }}
        scrollEventThrottle={160}
      >
        {tab === "attention" && (
          <AttentionPanel
            state={attention}
            contextLabel={active?.label ?? null}
            familyFacing={familyFacing}
            onOpen={openAttention}
          />
        )}

        {tab === "recent" && (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <View style={{ flexDirection: "row", gap: space.sm, flex: 1, flexWrap: "wrap" }}>
                {(["all", "unread", ...(canOfferActionFilter ? (["action"] as const) : []), "clubhouse"] as Filter[]).map((option) => {
                  const on = option === filter
                  const label = option === "all" ? "All" : option === "unread" ? "Unread" : option === "action" ? "Needs Action" : "Clubhouse"
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={label}
                      onPress={() => setFilter(option)}
                      style={{ minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.forest800 : colour.lineStrong, backgroundColor: on ? colour.forest800 : colour.surface, justifyContent: "center" }}
                    >
                      <Text style={[type.small, { color: on ? colour.onForest : colour.ink }]}>{label}</Text>
                    </Pressable>
                  )
                })}
              </View>
              {unread.notifications > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Mark all read"
                  onPress={() => void markAll()}
                  style={({ pressed }) => ({ minHeight: 36, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: space.sm, opacity: pressed ? 0.6 : 1 })}
                >
                  <CircleCheck size={15} color={colour.forest800} strokeWidth={2} />
                  <Text style={[type.caption, { color: colour.forest800, fontFamily: "Inter_500Medium" }]}>Mark All Read</Text>
                </Pressable>
              )}
            </View>

            {filter === "clubhouse" && (
              <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
                {(["all", "fixtures", "partnerships", "opportunities"] as ClubhouseCategory[]).map((option) => {
                  const on = option === clubhouseCategory
                  const label = option === "all" ? "All" : option === "fixtures" ? "Fixtures" : option === "partnerships" ? "Partnerships" : "Opportunities"
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={label}
                      onPress={() => setClubhouseCategory(option)}
                      style={{ minHeight: 32, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.pitch600 : colour.lineStrong, backgroundColor: on ? colour.mint100 : colour.surface, justifyContent: "center" }}
                    >
                      <Text style={[type.caption, { color: on ? colour.forest800 : colour.inkMuted }]}>{label}</Text>
                    </Pressable>
                  )
                })}
              </View>
            )}

            {problem ? (
              <ErrorState message={problem} onRetry={() => void loadFirstPage(filter === "unread")} />
            ) : items === null ? (
              <CardSkeleton lines={3} />
            ) : visible.length === 0 ? (
              filter === "all" ? (
                <EmptyState title="No new notifications" body="Changes to your rugby — a moved kick-off, a cancelled session, an answer from a family — arrive here." icon={<Bell size={26} color={colour.forest800} strokeWidth={1.8} />} />
              ) : filter === "unread" ? (
                <EmptyState title="You're all caught up" body="Everything Ovalball has told you has been read." icon={<CircleCheck size={26} color={colour.forest800} strokeWidth={1.8} />} />
              ) : filter === "clubhouse" ? (
                <EmptyState title="No Clubhouse activity yet" body="Fixture requests, partner requests and club-claim outcomes will appear here as you connect with clubs." icon={<Bell size={26} color={colour.forest800} strokeWidth={1.8} />} />
              ) : (
                <EmptyState title="Nothing waiting on you" body="None of these notifications is about a job that is still open." icon={<CircleCheck size={26} color={colour.forest800} strokeWidth={1.8} />} />
              )
            ) : (
              <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
                {visible.map((item, index) => (
                  <View key={item.id} style={{ borderTopWidth: index === 0 ? 0 : 1, borderTopColor: colour.line }}>
                    <NotificationCard
                      item={item}
                      priority={notificationPriority(item.type)}
                      verdict={verdicts.get(item.id) ?? "unknown"}
                      contextLabel={contextLabelFor(item)}
                      topicLabel={item.topicKey ? (TOPIC_LABEL[item.topicKey] ?? null) : null}
                      now={now}
                      onOpen={() => open(item)}
                      onLongPress={() => setHeld(item)}
                    />
                  </View>
                ))}
              </View>
            )}

            {cursor && visible.length > 0 && (
              <Button label={loadingMore ? "Loading…" : "Show Older"} variant="secondary" busy={loadingMore} onPress={() => void loadMore()} />
            )}
            {!cursor && (items?.length ?? 0) > 0 && (
              <Text style={[type.caption, { color: colour.inkSubtle, textAlign: "center" }]}>That is everything Ovalball has told you.</Text>
            )}
          </>
        )}

        <Text style={[type.caption, { color: colour.inkSubtle, textAlign: "center", marginTop: space.sm }]}>
          Notifications are not sent to this device yet. The same list is on the website and stays in step with it.
        </Text>
      </ScrollView>

      {/* PRESS AND HOLD: read or unread, and open. The two things a person may do to a notification. */}
      <Modal visible={held !== null} transparent animationType="fade" onRequestClose={() => setHeld(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setHeld(null)} style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.45)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colour.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, paddingBottom: insets.bottom + space.lg, gap: space.sm }}>
            {held && (
              <>
                <Text style={[type.smallMedium, { color: colour.ink }]} numberOfLines={2}>{held.title}</Text>
                <Button
                  label={held.readAt === null ? "Mark as Read" : "Mark as Unread"}
                  variant="secondary"
                  onPress={() => {
                    const target = held
                    setHeld(null)
                    void setRead(target, target.readAt === null)
                  }}
                />
                <Button
                  label="Open"
                  onPress={() => {
                    const target = held
                    setHeld(null)
                    open(target)
                  }}
                />
              </>
            )}
          </View>
        </Pressable>
      </Modal>
    </View>
  )
}

/**
 * NEEDS ATTENTION -- the projection for this context, banded by priority.
 *
 * Empty is a real answer with two faces: "YOU'RE ALL CAUGHT UP" where the app holds this context's work
 * and finds none, and an honest hand-off where the context's work is a web desk. A queue drawn empty for
 * a Site Admin would be a lie; a link to where it lives is not.
 */
function AttentionPanel({
  state,
  contextLabel,
  familyFacing,
  onOpen,
}: {
  state: ReturnType<typeof useAttention>
  contextLabel: string | null
  familyFacing: boolean
  onOpen: (item: AttentionItem) => void
}) {
  if (state.error) return <ErrorState message={state.error} onRetry={() => void state.refresh()} />
  if (state.loading || !state.read) return <CardSkeleton lines={3} />
  if (state.read.coverage === "web") {
    return (
      <EmptyState
        title="This work lives on the website"
        body={`${contextLabel ?? "This context"} is a desk job with wide authority. Its queues are on the Ovalball website rather than squeezed onto a phone.`}
        icon={<QuietClock />}
      />
    )
  }
  if (state.read.items.length === 0) {
    return (
      <EmptyState
        title="You're all caught up"
        body={familyFacing ? "Nothing needs an answer right now. When a match or a session needs one, it appears here." : "Nothing is waiting on you right now."}
        icon={<CircleCheck size={26} color={colour.forest800} strokeWidth={1.8} />}
      />
    )
  }
  const bands = groupAttention(state.read.items)
  return (
    <View style={{ gap: space.lg }}>
      {bands.map((band) => {
        const rows: AttentionRow[] = band.items.map((item) => ({
          key: item.id,
          label: item.title,
          detail: item.summary,
          urgent: item.priority === "urgent",
          onPress: () => onOpen(item),
        }))
        return (
          <View key={band.priority} style={{ gap: space.sm }}>
            <Text style={[type.overline, { color: band.priority === "urgent" ? colour.warning : colour.forest800 }]}>{band.label.toUpperCase()}</Text>
            <NeedsAttention items={rows} showHeading={false} />
          </View>
        )
      })}
      <Text style={[type.caption, { color: colour.inkSubtle }]}>
        Each item is read from the record it is about and disappears when that record is settled. Reading a notification never settles one.
      </Text>
    </View>
  )
}
