import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Linking, Modal, Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { isFamilyFacingContext } from "@ovalball/contracts"
import { countNeedingAction, sortAttention, type AttentionItem } from "@ovalball/contracts/attention"
import {
  attentionVerdict,
  CLUBHOUSE_NOTIFICATION_TYPES,
  dismissNotification,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationUnread,
  newestFirst,
  notificationContextHint,
  verdictsNewestAskOnly,
  notificationPriority,
  readNotificationPage,
  restoreNotification,
  type FeedCursor,
  type FeedNotification,
} from "@ovalball/contracts/notifications/feed"

import { supabase } from "../../../src/auth/supabase"
import { webUrl } from "../../../src/config/environment"
import { useAppContexts } from "../../../src/context/contexts"
import { invalidateAttention } from "../../../src/attention/cache"
import { routeForAttentionItem } from "../../../src/attention/routes"
import { useAttention } from "../../../src/attention/use-attention"
import { useNotificationNavigator } from "../../../src/notifications/open"
import { QuietClock } from "../../../src/components/notification-card"
import { JobRow, NotificationRow, TabButton } from "../../../src/components/notification-rows"
import { OvalballDetailHeader } from "../../../src/components/app-header"
import { SwipeToDelete, UndoBar } from "../../../src/components/swipe-to-delete"
import { Bell, CircleCheck, Settings } from "../../../src/components/icons"
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
 * operations both clients share, and there is no local inbox. DELETE (owner product decision) is a
 * server fact too: `dismissNotification` hides the row from its owner everywhere, with an Undo that
 * puts it back exactly -- and deleting a notification never resolves the job it was about.
 *
 * A PUSH TAP OPENS THE SAME PLACE THIS LIST DOES. `routeForHref` (`src/links/destinations.ts`) is the
 * one function behind both: this screen's `open()` below and the push response listener wired in
 * `src/notifications/push.ts`. Neither keeps its own routing table.
 */
/** The three views the approved mock-up draws: All, Action Required, Unread. */
type CentreView = "all" | "action" | "unread"
type Filter = "all" | "unread" | "clubhouse"

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
  const { unread, refreshUnread, active, contexts } = useAppContexts()
  const navigateTo = useNotificationNavigator()
  const attention = useAttention()
  const familyFacing = active !== null && isFamilyFacingContext(active.kind)

  // Clubhouse Home's "See All" arrives with ?filter=clubhouse -- landing straight on Recent, already
  // filtered, rather than on Needs Attention with the person having to find the filter themselves.
  const arrivedViaClubhouse = params.filter === "clubhouse"
  const [view, setView] = useState<CentreView>("all")
  // The feed's own filter: Unread is the server's unread-only page; Clubhouse is the type subset.
  const filter: Filter = arrivedViaClubhouse ? "clubhouse" : view === "unread" ? "unread" : "all"
  const [clubhouseCategory, setClubhouseCategory] = useState<ClubhouseCategory>("all")
  const [items, setItems] = useState<FeedNotification[] | null>(null)
  const [cursor, setCursor] = useState<FeedCursor | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [held, setHeld] = useState<FeedNotification | null>(null)
  const [deleted, setDeleted] = useState<FeedNotification | null>(null)
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
  // ---- Delete, and undo: the server's dismissal, then the badge recounted from the same source ----
  const deleteItem = useCallback(
    (item: FeedNotification) => {
      setItems((prev) => (prev ?? []).filter((n) => n.id !== item.id))
      setDeleted(item)
      dismissNotification(supabase, item.id)
        .then(() => refreshUnread())
        .catch((caught) => {
          logDetail("dismiss notification", friendly(caught, "that notification"))
          void loadFirstPage(filter === "unread")
        })
    },
    [refreshUnread, loadFirstPage, filter]
  )

  const undoDelete = useCallback(() => {
    const item = deleted
    if (!item) return
    setDeleted(null)
    restoreNotification(supabase, item.id)
      .then(() => Promise.all([loadFirstPage(filter === "unread"), refreshUnread()]))
      .catch((caught) => logDetail("restore notification", friendly(caught, "that notification")))
  }, [deleted, loadFirstPage, filter, refreshUnread])

  // The one opening rule (context switch + `routeForHref`) lives in `src/notifications/open.ts`, shared
  // with the bell's quick view so the two surfaces cannot route the same row differently.
  function open(item: FeedNotification) {
    if (item.readAt === null) void setRead(item, true)
    navigateTo(item)
  }

  function openAttention(item: AttentionItem) {
    const route = routeForAttentionItem(item, active?.kind ?? null)
    if (route) router.push(route as never)
    else void Linking.openURL(`${webUrl}${item.href}`)
  }

  // ---- What the projection says about each notification, for the card and for the filter --------
  const verdicts = useMemo(
    () => verdictsNewestAskOnly(items ?? [], (n) => attentionVerdict(n.type, n.data, attention.read, familyFacing)),
    [items, attention.read, familyFacing]
  )

  const canOfferActionFilter = attention.read?.coverage === "native"
  const visible = useMemo(() => {
    const all = items ?? []
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

  // NEWEST FIRST in every view, grouped by day only for reading -- never re-ranked by state.
  const sections = useMemo(() => groupByDay(newestFirst(visible), now), [visible, now])
  const jobs = useMemo(() => sortAttention(attentionItems), [attentionItems])

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader
        title={arrivedViaClubhouse ? "Clubhouse Activity" : "Notifications"}
        tone="chalk"
        onBack={() => router.back()}
        rightAction={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Notification preferences"
            onPress={() => router.push("/notifications/preferences" as never)}
            hitSlop={8}
            style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
          >
            <Settings size={21} color={colour.ink} strokeWidth={1.9} />
          </Pressable>
        }
      />

      {!arrivedViaClubhouse && (
        <View accessibilityRole="tablist" style={{ flexDirection: "row", paddingHorizontal: space.md, gap: space.xs, borderBottomWidth: 1, borderBottomColor: colour.line }}>
          <TabButton label="All" count={null} badge={colour.pitch600} selected={view === "all"} onPress={() => setView("all")} />
          {/* TWO FIGURES, TWO WORDS. The action count is the projection's; the unread count is the
              badge's own canonical read. They are never added together. */}
          <TabButton label="Action Required" count={actionCount} badge={colour.danger} selected={view === "action"} onPress={() => setView("action")} />
          <TabButton label="Unread" count={unread.notifications} badge={colour.inkSubtle} selected={view === "unread"} onPress={() => setView("unread")} />
        </View>
      )}

      <ScrollView
        contentContainerStyle={{ paddingVertical: space.sm, paddingBottom: insets.bottom + space.xxl, gap: space.xs }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colour.forest800} />}
        onScroll={({ nativeEvent }) => {
          const nearEnd = nativeEvent.layoutMeasurement.height + nativeEvent.contentOffset.y >= nativeEvent.contentSize.height - 240
          if (view !== "action" && nearEnd) void loadMore()
        }}
        scrollEventThrottle={160}
      >
        {arrivedViaClubhouse && (
          <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap", paddingHorizontal: space.lg, paddingVertical: space.sm }}>
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

        {view === "action" ? (
          <ActionView state={attention} jobs={jobs} contextLabel={active?.label ?? null} familyFacing={familyFacing} onOpen={openAttention} />
        ) : problem ? (
          <View style={{ padding: space.lg }}>
            <ErrorState message={problem} onRetry={() => void loadFirstPage(filter === "unread")} />
          </View>
        ) : items === null ? (
          <View style={{ padding: space.lg }}>
            <CardSkeleton lines={3} />
          </View>
        ) : visible.length === 0 ? (
          <View style={{ padding: space.lg }}>
            {filter === "unread" ? (
              <EmptyState title="You're all caught up" body="Everything Ovalball has told you has been read." icon={<CircleCheck size={26} color={colour.forest800} strokeWidth={1.8} />} />
            ) : filter === "clubhouse" ? (
              <EmptyState title="No Clubhouse activity yet" body="Fixture requests, partner requests and club-claim outcomes will appear here as you connect with clubs." icon={<Bell size={26} color={colour.forest800} strokeWidth={1.8} />} />
            ) : (
              <EmptyState title="No new notifications" body="Changes to your rugby — a moved kick-off, a cancelled session, an answer from a family — arrive here." icon={<Bell size={26} color={colour.forest800} strokeWidth={1.8} />} />
            )}
          </View>
        ) : (
          <>
            {unread.notifications > 0 && (
              <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: space.lg }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Mark all read"
                  onPress={() => void markAll()}
                  style={({ pressed }) => ({ minHeight: 36, flexDirection: "row", alignItems: "center", gap: 4, opacity: pressed ? 0.6 : 1 })}
                >
                  <CircleCheck size={15} color={colour.forest800} strokeWidth={2} />
                  <Text style={[type.caption, { color: colour.forest800, fontFamily: "Inter_500Medium" }]}>Mark All Read</Text>
                </Pressable>
              </View>
            )}
            {sections.map((section) => (
              <View key={section.label}>
                <Text style={[type.smallMedium, { color: colour.ink, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xs }]}>{section.label}</Text>
                <View style={{ backgroundColor: colour.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colour.line, paddingVertical: space.xs }}>
                  {section.items.map((item, index) => (
                    <SwipeToDelete key={item.id} inset={space.sm} onDelete={() => deleteItem(item)}>
                      <NotificationRow
                        item={item}
                        verdict={verdicts.get(item.id) ?? "unknown"}
                        divider={index > 0}
                        onPress={() => open(item)}
                        onDelete={() => deleteItem(item)}
                        onLongPress={() => setHeld(item)}
                      />
                    </SwipeToDelete>
                  ))}
                </View>
              </View>
            ))}
            <UndoBar visible={deleted !== null} onUndo={undoDelete} onExpire={() => setDeleted(null)} />
            {cursor && visible.length > 0 && (
              <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm }}>
                <Button label={loadingMore ? "Loading…" : "Show Older"} variant="secondary" busy={loadingMore} onPress={() => void loadMore()} />
              </View>
            )}
            {!cursor && (items?.length ?? 0) > 0 && (
              <Text style={[type.caption, { color: colour.inkSubtle, textAlign: "center", marginTop: space.sm }]}>That is everything Ovalball has told you.</Text>
            )}
          </>
        )}

        <Text style={[type.caption, { color: colour.inkSubtle, textAlign: "center", marginTop: space.sm, paddingHorizontal: space.lg }]}>
          The same list is on the website and stays in step with it.
        </Text>
      </ScrollView>

      {/* PRESS AND HOLD: read or unread, open, or delete. */}
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
                  label="Delete"
                  variant="danger"
                  onPress={() => {
                    const target = held
                    setHeld(null)
                    deleteItem(target)
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

/** Today, Yesterday, then one section per earlier day -- the rows inside each stay newest first. */
function groupByDay(items: FeedNotification[], now: Date): { label: string; items: FeedNotification[] }[] {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const today = startOf(now)
  const out: { label: string; items: FeedNotification[] }[] = []
  for (const item of items) {
    const at = new Date(item.createdAt)
    const days = Math.round((today - startOf(at)) / 86_400_000)
    const label = days <= 0 ? "Today" : days === 1 ? "Yesterday" : at.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
    const last = out[out.length - 1]
    if (last && last.label === label) last.items.push(item)
    else out.push({ label, items: [item] })
  }
  return out
}

/**
 * ACTION REQUIRED -- the live projection for this context, the same jobs Home's Needs Attention lists.
 *
 * Empty is a real answer with two faces: "YOU'RE ALL CAUGHT UP" where the app holds this context's work
 * and finds none, and an honest hand-off where the context's work is a web desk. A job leaves this list
 * when its record is settled -- never because a notification was read or dismissed.
 */
function ActionView({
  state,
  jobs,
  contextLabel,
  familyFacing,
  onOpen,
}: {
  state: ReturnType<typeof useAttention>
  jobs: AttentionItem[]
  contextLabel: string | null
  familyFacing: boolean
  onOpen: (item: AttentionItem) => void
}) {
  if (state.error) return <View style={{ padding: space.lg }}><ErrorState message={state.error} onRetry={() => void state.refresh()} /></View>
  if (state.loading || !state.read) return <View style={{ padding: space.lg }}><CardSkeleton lines={3} /></View>
  if (state.read.coverage !== "native") {
    return (
      <View style={{ padding: space.lg }}>
        <EmptyState
          title="This work lives on the website"
          body={`${contextLabel ?? "This context"} is a desk job with wide authority. Its queues are on the Ovalball website rather than squeezed onto a phone.`}
          icon={<QuietClock />}
        />
      </View>
    )
  }
  if (jobs.length === 0) {
    return (
      <View style={{ padding: space.lg }}>
        <EmptyState
          title="You're all caught up"
          body={familyFacing ? "Nothing needs an answer right now. When a match or a session needs one, it appears here." : "Nothing is waiting on you right now."}
          icon={<CircleCheck size={26} color={colour.forest800} strokeWidth={1.8} />}
        />
      </View>
    )
  }
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ backgroundColor: colour.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colour.line, paddingVertical: space.xs }}>
        {jobs.map((job, index) => (
          <JobRow key={job.id} item={job} divider={index > 0 && jobs[index - 1].priority === "for_information"} onPress={() => onOpen(job)} />
        ))}
      </View>
      <Text style={[type.caption, { color: colour.inkSubtle, paddingHorizontal: space.lg }]}>
        Each item is read from the record it is about and disappears when that record is settled. Reading or deleting a notification never settles one.
      </Text>
    </View>
  )
}
