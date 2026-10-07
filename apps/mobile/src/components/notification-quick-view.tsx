import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Animated, Easing, Linking, Modal, PanResponder, Pressable, Text, View, useWindowDimensions } from "react-native"
import { useRouter } from "expo-router"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import * as Haptics from "expo-haptics"

import { isFamilyFacingContext } from "@ovalball/contracts"
import { countNeedingAction, sortAttention, type AttentionItem } from "@ovalball/contracts/attention"
import {
  attentionVerdict,
  dismissNotification,
  markNotificationRead,
  newestFirst,
  readNotificationPage,
  verdictsNewestAskOnly,
  restoreNotification,
  type AttentionVerdict,
  type FeedNotification,
} from "@ovalball/contracts/notifications/feed"

import { supabase } from "../auth/supabase"
import { useAppContexts } from "../context/contexts"
import { invalidateAttention } from "../attention/cache"
import { useAttention } from "../attention/use-attention"
import { routeForAttentionItem } from "../attention/routes"
import { webUrl } from "../config/environment"
import { useNotificationNavigator } from "../notifications/open"
import { friendly, logDetail } from "../errors/translate"
import { Bell, ChevronRight, CircleCheck, FileText, Settings } from "./icons"
import { SwipeToDelete, UndoBar } from "./swipe-to-delete"
import { JobRow, NotificationRow, SkeletonRow, TabButton } from "./notification-rows"
import { TOUCH_TARGET, colour, radius, space, type } from "../design/tokens"

/**
 * THE BELL'S QUICK VIEW -- a look at what is new without leaving the screen.
 *
 * NOT A SECOND INBOX. It reads the same canonical rows the Notifications Centre reads
 * (`readNotificationPage` → `my_notifications`), asks the same live projection whether each ask is
 * still open (`attentionVerdict`), opens a row through the same navigator the Centre uses
 * (`useNotificationNavigator` → `routeForHref`) and marks it read through the same operation. It
 * keeps nothing of its own: close it and nothing is left behind.
 *
 * A HANDFUL, NEWEST FIRST: the four most recent rows of the chosen view, in the order they arrived.
 * Everything else is one tap away in the Centre.
 *
 * OPENING THE PANEL CHANGES NOTHING; OPENING A ROW READS IT. Looking at a list is not dealing with
 * it, so appearing marks nothing read (the website's bell keeps the same rule). Tapping a row marks
 * that row read and the bell's count comes back down from the server. Swiping the PANEL up puts it
 * away; swiping a ROW left reveals Delete, which dismisses that notification server-side (website
 * included) with an Undo. Deleting a notification never resolves the job it was about.
 */
export interface QuickViewAnchor {
  x: number
  y: number
  width: number
  height: number
}

type Tab = "all" | "action" | "unread"

const VISIBLE_ROWS = 4
const PANEL_GUTTER = 12

export function NotificationQuickView({
  anchor,
  onForestGround,
  onClose,
}: {
  anchor: QuickViewAnchor | null
  onForestGround: boolean
  onClose: () => void
}) {
  const visible = anchor !== null
  const { width: windowWidth } = useWindowDimensions()
  const router = useRouter()
  const navigateTo = useNotificationNavigator()
  const { unread, refreshUnread, active } = useAppContexts()
  const attention = useAttention()
  const refreshAttention = attention.refresh
  const familyFacing = active !== null && isFamilyFacingContext(active.kind)

  const [tab, setTab] = useState<Tab>("all")
  const [recent, setRecent] = useState<FeedNotification[] | null>(null)
  const [unreadRows, setUnreadRows] = useState<FeedNotification[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [deleted, setDeleted] = useState<FeedNotification | null>(null)
  const progress = useRef(new Animated.Value(0)).current
  const drag = useRef(new Animated.Value(0)).current
  const closing = useRef(false)

  const load = useCallback(async () => {
    setProblem(null)
    try {
      // Two windows onto the same rows: the newest, and the unread ones the server itself selects --
      // so "Unread" is the storage's answer even when every recent row has been read.
      // The tab counts and the live jobs are re-asked with the rows: a notification that arrived while
      // the app was open is counted, and its ask highlighted, the moment it is shown.
      const [page, unreadPage] = await Promise.all([
        readNotificationPage(supabase, { limit: 12 }),
        readNotificationPage(supabase, { limit: VISIBLE_ROWS, unreadOnly: true }),
        refreshUnread(),
        refreshAttention(),
      ])
      setRecent(page.items)
      setUnreadRows(unreadPage.items)
    } catch (caught) {
      const failure = friendly(caught, "your notifications")
      logDetail("notification quick view", failure)
      setProblem(failure.message)
    }
  }, [refreshUnread, refreshAttention])

  useEffect(() => {
    if (!visible) return
    closing.current = false
    drag.setValue(0)
    progress.setValue(0)
    setTab("all")
    setDeleted(null)
    setRecent(null)
    setUnreadRows(null)
    void load()
    void Haptics.selectionAsync()
  }, [visible, load, progress, drag])

  // STARTED FROM THE MODAL'S OWN onShow: a native-driven animation begun in the same frame a modal
  // mounts is dropped on iOS, which left the panel open but invisible.
  const reveal = useCallback(() => {
    Animated.spring(progress, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 5 }).start()
  }, [progress])

  /** Close first, act after: the next screen never appears underneath a half-open panel. */
  const close = useCallback(
    (then?: () => void) => {
      if (closing.current) return
      closing.current = true
      Animated.timing(progress, { toValue: 0, duration: 150, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => {
        onClose()
        then?.()
      })
    },
    [progress, onClose]
  )

  const verdicts = useMemo(() => {
    const byId = new Map<string, FeedNotification>()
    for (const n of [...(recent ?? []), ...(unreadRows ?? [])]) byId.set(n.id, n)
    return verdictsNewestAskOnly([...byId.values()], (n) => attentionVerdict(n.type, n.data, attention.read, familyFacing))
  }, [recent, unreadRows, attention.read, familyFacing])

  // NEWEST FIRST, ALWAYS (owner rule). Read state and action state change how a row looks, never
  // where it sits -- the same order the Notifications Centre and the website use.
  const rows = useMemo(
    () => newestFirst(tab === "unread" ? (unreadRows ?? []) : (recent ?? [])).slice(0, VISIBLE_ROWS),
    [tab, recent, unreadRows]
  )

  const loaded = recent !== null && unreadRows !== null
  const actionCount = countNeedingAction(attention.read?.items ?? [])
  // ACTION REQUIRED IS THE LIVE PROJECTION ITSELF -- the same jobs Home's Needs Attention lists, so the
  // tab's number and the tab's rows are one count, and a job with no notification still appears.
  const jobs = useMemo(
    () => sortAttention(attention.read?.items ?? []).filter((i) => i.priority !== "for_information").slice(0, VISIBLE_ROWS),
    [attention.read]
  )

  function openJob(item: AttentionItem) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    close(() => {
      const route = routeForAttentionItem(item, active?.kind ?? null)
      if (route) router.push(route as never)
      else void Linking.openURL(`${webUrl}${item.href}`)
    })
  }
  const allCount = Math.min(VISIBLE_ROWS, recent?.length ?? 0)

  function openRow(item: FeedNotification) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    if (item.readAt === null) {
      // Optimistically clear the dot at once; the server's answer then brings the bell's count down.
      const stamp = new Date().toISOString()
      setRecent((prev) => prev?.map((n) => (n.id === item.id ? { ...n, readAt: stamp } : n)) ?? prev)
      setUnreadRows((prev) => prev?.filter((n) => n.id !== item.id) ?? prev)
      void markNotificationRead(supabase, item.id)
        .then(() => {
          invalidateAttention()
          return refreshUnread()
        })
        .catch((caught) => logDetail("mark notification", friendly(caught, "that notification")))
    }
    close(() => navigateTo(item))
  }

  function deleteRow(item: FeedNotification) {
    setRecent((prev) => prev?.filter((n) => n.id !== item.id) ?? prev)
    setUnreadRows((prev) => prev?.filter((n) => n.id !== item.id) ?? prev)
    setDeleted(item)
    void dismissNotification(supabase, item.id)
      .then(() => refreshUnread())
      .catch((caught) => {
        logDetail("dismiss notification", friendly(caught, "that notification"))
        void load()
      })
  }

  function undoDelete() {
    const item = deleted
    if (!item) return
    setDeleted(null)
    void restoreNotification(supabase, item.id)
      .then(() => Promise.all([load(), refreshUnread()]))
      .catch((caught) => logDetail("restore notification", friendly(caught, "that notification")))
  }

  // SWIPE UP TO PUT IT AWAY -- the panel follows the finger, and a short flick is enough.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dy < -6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_, g) => drag.setValue(Math.min(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (g.dy < -36 || g.vy < -0.5) close()
          else Animated.spring(drag, { toValue: 0, useNativeDriver: true, speed: 24, bounciness: 6 }).start()
        },
      }),
    [drag, close]
  )

  if (!anchor) return null

  const panelWidth = Math.min(windowWidth - PANEL_GUTTER * 2, 392)
  const panelLeft = windowWidth - PANEL_GUTTER - panelWidth
  const bellCentre = anchor.x + anchor.width / 2
  const caretLeft = Math.max(24, Math.min(panelWidth - 38, bellCentre - panelLeft - 8))
  const top = anchor.y + anchor.height + 8

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onShow={reveal} onRequestClose={() => close()}>
      {/* A modal is its own native window; swipe gestures inside it need their own gesture root. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
      <Animated.View style={{ flex: 1, opacity: progress }}>
        <Pressable accessibilityLabel="Close notifications" onPress={() => close()} style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.28)" }} />
      </Animated.View>

      {/* THE BELL, LIFTED ABOVE THE SCRIM -- tapping it again closes the panel it opened. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close notifications"
        onPress={() => close()}
        style={{
          position: "absolute",
          left: anchor.x,
          top: anchor.y,
          width: anchor.width,
          height: anchor.height,
          borderRadius: radius.pill,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: onForestGround ? "rgba(255,255,255,0.16)" : "rgba(16,21,18,0.08)",
        }}
      >
        <Bell size={20} color={onForestGround ? colour.onForest : colour.ink} strokeWidth={1.9} />
      </Pressable>

      <Animated.View
        {...pan.panHandlers}
        style={{
          position: "absolute",
          top,
          left: panelLeft,
          width: panelWidth,
          opacity: progress,
          transformOrigin: `${caretLeft + 8}px 0px`,
          transform: [
            { translateY: Animated.add(drag, progress.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] })) },
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
          ],
          shadowColor: colour.forest950,
          shadowOpacity: 0.28,
          shadowRadius: 30,
          shadowOffset: { width: 0, height: 16 },
          elevation: 18,
        }}
      >
        {/* The caret ties the panel to the bell it came from. */}
        <View
          style={{
            position: "absolute",
            top: -7,
            left: caretLeft,
            width: 16,
            height: 16,
            borderRadius: 3,
            backgroundColor: colour.surface,
            transform: [{ rotate: "45deg" }],
          }}
        />
        <View style={{ borderRadius: radius.xl, backgroundColor: colour.surface, overflow: "hidden" }}>
          {/* HEADER */}
          <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: space.lg + 2, paddingRight: space.md, paddingTop: space.lg, paddingBottom: space.sm }}>
            <Text accessibilityRole="header" style={[type.title, { color: colour.ink, flex: 1 }]}>
              Notifications
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Notification preferences"
              onPress={() => close(() => router.push("/notifications/preferences" as never))}
              hitSlop={4}
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                borderRadius: radius.pill,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed ? colour.line : colour.chalk,
              })}
            >
              <Settings size={19} color={colour.ink} strokeWidth={1.9} />
            </Pressable>
          </View>

          {/* TABS -- each badge is that view's own number, from the same reads the Centre uses. */}
          <View accessibilityRole="tablist" style={{ flexDirection: "row", paddingHorizontal: space.md, gap: space.xs, borderBottomWidth: 1, borderBottomColor: colour.line }}>
            <TabButton label="All" count={loaded ? allCount : null} badge={colour.pitch600} selected={tab === "all"} onPress={() => setTab("all")} />
            <TabButton label="Action Required" count={actionCount} badge={colour.danger} selected={tab === "action"} onPress={() => setTab("action")} />
            <TabButton label="Unread" count={unread.notifications} badge={colour.inkSubtle} selected={tab === "unread"} onPress={() => setTab("unread")} />
          </View>

          {/* ROWS */}
          <View style={{ paddingVertical: space.xs }}>
            {problem ? (
              <View style={{ padding: space.lg, gap: space.sm }}>
                <Text style={[type.small, { color: colour.inkMuted }]}>{problem}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Try Again" onPress={() => void load()} hitSlop={8}>
                  <Text style={[type.smallMedium, { color: colour.forest800 }]}>Try Again</Text>
                </Pressable>
              </View>
            ) : tab === "action" ? (
              attention.read?.coverage === "web" ? (
                <View style={{ paddingVertical: space.lg, paddingHorizontal: space.lg }}>
                  <Text style={[type.small, { color: colour.inkMuted }]}>This context's work lives on the Ovalball website.</Text>
                </View>
              ) : !attention.read ? (
                [0, 1, 2].map((i) => <SkeletonRow key={i} />)
              ) : jobs.length === 0 ? (
                <View style={{ alignItems: "center", paddingVertical: space.xl, paddingHorizontal: space.lg, gap: space.xs }}>
                  <CircleCheck size={24} color={colour.pitch600} strokeWidth={1.9} />
                  <Text style={[type.smallMedium, { color: colour.ink }]}>Nothing needs you right now</Text>
                  <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center" }]}>Anything that needs your answer appears here.</Text>
                </View>
              ) : (
                jobs.map((job) => <JobRow key={job.id} item={job} divider={false} onPress={() => openJob(job)} />)
              )
            ) : !loaded ? (
              [0, 1, 2].map((i) => <SkeletonRow key={i} />)
            ) : rows.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: space.xl, paddingHorizontal: space.lg, gap: space.xs }}>
                <CircleCheck size={24} color={colour.pitch600} strokeWidth={1.9} />
                <Text style={[type.smallMedium, { color: colour.ink }]}>You're all caught up</Text>
                <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center" }]}>Nothing new since you last looked.</Text>
              </View>
            ) : (
              rows.map((item, index) => (
                <SwipeToDelete key={item.id} inset={space.sm} onDelete={() => deleteRow(item)}>
                  <NotificationRow
                    item={item}
                    verdict={verdicts.get(item.id) ?? "unknown"}
                    divider={index > 0 && verdicts.get(rows[index - 1].id) !== "open" && verdicts.get(item.id) !== "open"}
                    onPress={() => openRow(item)}
                    onDelete={() => deleteRow(item)}
                  />
                </SwipeToDelete>
              ))
            )}
            <UndoBar visible={deleted !== null} onUndo={undoDelete} onExpire={() => setDeleted(null)} />
          </View>

          {/* FOOTER */}
          <View style={{ height: 1, backgroundColor: colour.line }} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View all notifications"
            onPress={() => close(() => router.push("/notifications" as never))}
            style={({ pressed }) => ({
              minHeight: 54,
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              paddingHorizontal: space.lg + 2,
              backgroundColor: pressed ? colour.chalk : colour.surface,
            })}
          >
            <FileText size={19} color={colour.ink} strokeWidth={1.8} />
            <Text style={[type.smallMedium, { color: colour.ink, flex: 1, fontSize: 15 }]}>View All Notifications</Text>
            <ChevronRight size={18} color={colour.ink} />
          </Pressable>
        </View>
      </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  )
}
