import { useEffect, useRef, useState } from "react"
import { Animated, Pressable, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { X } from "./icons"
import { NotificationGlyph } from "./notification-glyph"
import { notificationFamily } from "../notifications/family"
import { colour, radius, space, type } from "../design/tokens"

/**
 * OVALBALL'S OWN FOREGROUND NOTICE -- never the OS banner.
 *
 * `src/notifications/push.ts` suppresses the native alert while the app is in the foreground
 * (`shouldShowBanner: false` in its handler) specifically so this draws instead: the same brand
 * chrome as every other screen, rather than a system tray banner in iOS or Android's own style
 * stacking on top of it. Tap to open -- the tap reuses whatever route the caller already resolved
 * with `routeForHref`, exactly as a tap on a backgrounded push does; this component makes no routing
 * decision of its own.
 *
 * ONE AT A TIME, NEWEST FIRST, THE REST QUEUED (owner rule, notifications UX pass). Several pushes
 * landing together never stack down the screen: the newest is shown, a quiet "+N more" says others
 * are waiting, and when it is dismissed or times out the next one appears. Nothing is dropped
 * silently -- beyond the five newest, the rest are still in the bell and the Centre.
 *
 * ONE ICON TILE PER NOTIFICATION FAMILY, the same families the Preferences screens group by, so the
 * banner's own colour reinforces the category rather than inventing a fourth vocabulary.
 */
interface Notice {
  type: string
  title: string
  body: string
  onPress: () => void
}

interface QueuedNotice extends Notice {
  id: string
}

type Listener = (notice: Notice) => void
let listener: Listener | null = null

export function showForegroundNotice(notice: Notice): void {
  listener?.(notice)
}

const AUTO_DISMISS_MS = 5000
const MAX_WAITING = 5
let nextId = 0


export function ForegroundBannerHost() {
  const insets = useSafeAreaInsets()
  const [queue, setQueue] = useState<QueuedNotice[]>([])

  useEffect(() => {
    listener = (next) => {
      const id = `banner-${++nextId}`
      setQueue((prev) => [...prev, { ...next, id }].slice(-(MAX_WAITING + 1)))
    }
    return () => {
      listener = null
    }
  }, [])

  function remove(id: string) {
    setQueue((prev) => prev.filter((n) => n.id !== id))
  }

  if (queue.length === 0) return null
  const showing = queue[queue.length - 1]

  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", top: 0, left: 0, right: 0, paddingTop: insets.top + space.xs, paddingHorizontal: space.md }}
    >
      <BannerItem key={showing.id} notice={showing} waiting={queue.length - 1} onDismiss={() => remove(showing.id)} />
    </View>
  )
}

function BannerItem({ notice, waiting, onDismiss }: { notice: QueuedNotice; waiting: number; onDismiss: () => void }) {
  const offset = useRef(new Animated.Value(-24)).current
  const opacity = useRef(new Animated.Value(0)).current
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const family = notificationFamily(notice.type)
  const accent = family.onForest

  useEffect(() => {
    Animated.parallel([
      Animated.spring(offset, { toValue: 0, useNativeDriver: true, bounciness: 4 }),
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }),
    ]).start()
    dismissTimer.current = setTimeout(() => dismiss(), AUTO_DISMISS_MS)
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function dismiss() {
    if (dismissTimer.current) clearTimeout(dismissTimer.current)
    Animated.timing(opacity, { toValue: 0, duration: 160, useNativeDriver: true }).start(onDismiss)
  }

  return (
    <Animated.View style={{ opacity, transform: [{ translateY: offset }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${notice.title}. ${notice.body}`}
        onPress={() => {
          const go = notice.onPress
          dismiss()
          go()
        }}
        style={({ pressed }) => ({
          flexDirection: "row",
          gap: space.sm,
          alignItems: "flex-start",
          backgroundColor: colour.forest900,
          borderRadius: radius.lg,
          borderLeftWidth: 4,
          borderLeftColor: accent,
          paddingVertical: space.sm,
          paddingLeft: space.sm,
          paddingRight: 34,
          shadowColor: "#000",
          shadowOpacity: 0.25,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 6,
          opacity: pressed ? 0.92 : 1,
        })}
      >
        <NotificationGlyph family={family} size={36} onForest />
        <View style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
          <Text style={[type.smallMedium, { color: colour.onForest }]} numberOfLines={1}>
            {notice.title}
          </Text>
          {!!notice.body && (
            <Text style={[type.caption, { color: colour.onForestMuted, marginTop: 2 }]} numberOfLines={2}>
              {notice.body}
            </Text>
          )}
          {waiting > 0 && (
            <Text style={[type.caption, { color: colour.onForest, marginTop: 4, fontFamily: "Inter_600SemiBold" }]}>
              +{waiting} more
            </Text>
          )}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        onPress={dismiss}
        hitSlop={8}
        style={{ position: "absolute", top: 8, right: 8, width: 24, height: 24, alignItems: "center", justifyContent: "center" }}
      >
        <X size={14} color={colour.onForestMuted} strokeWidth={2} />
      </Pressable>
    </Animated.View>
  )
}
