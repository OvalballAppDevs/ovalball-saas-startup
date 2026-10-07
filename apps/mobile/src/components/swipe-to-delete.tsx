import { useEffect, useRef } from "react"
import { Animated, Pressable, Text, View } from "react-native"
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable"
import * as Haptics from "expo-haptics"

import { Trash2, Undo2 } from "./icons"
import { colour, radius, space, type } from "../design/tokens"

/**
 * SWIPE LEFT TO REVEAL DELETE -- one notification row, in the bell's quick view and the Centre alike.
 *
 * REVEAL, THEN TAP. A swipe opens the red Delete action; the delete itself is a deliberate tap on it,
 * and is followed by an Undo, so a stray thumb on a crowded touchline never loses anything for good.
 * The row itself must also offer `deleteAccessibilityAction` -- a swipe is not discoverable without
 * sight, so a screen reader gets the same delete as a named action.
 */
export const deleteAccessibilityAction = [{ name: "delete", label: "Delete notification" }]
export function SwipeToDelete({
  children,
  onDelete,
  inset = 0,
}: {
  children: React.ReactNode
  onDelete: () => void
  /** Horizontal inset of the row inside its list, so the action lines up with the row's own edge. */
  inset?: number
}) {
  const ref = useRef<SwipeableMethods>(null)
  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={1.6}
      rightThreshold={36}
      overshootRight={false}
      onSwipeableWillOpen={() => void Haptics.selectionAsync()}
      renderRightActions={() => (
        <View style={{ paddingRight: inset, paddingVertical: 2, justifyContent: "center" }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete notification"
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
              ref.current?.close()
              onDelete()
            }}
            style={({ pressed }) => ({
              width: 88,
              flex: 1,
              borderRadius: radius.lg,
              marginLeft: space.xs,
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              backgroundColor: pressed ? "#a51d17" : colour.danger,
            })}
          >
            <Trash2 size={20} color={colour.onForest} strokeWidth={2} />
            <Text style={[type.caption, { color: colour.onForest, fontFamily: "Inter_600SemiBold" }]}>Delete</Text>
          </Pressable>
        </View>
      )}
    >
      {children}
    </ReanimatedSwipeable>
  )
}

/**
 * "Notification deleted · Undo" -- shown after a delete for a few seconds. Undo puts the very same row
 * back through `restoreNotification`, unread if it was unread.
 */
export function UndoBar({ visible, onUndo, onExpire }: { visible: boolean; onUndo: () => void; onExpire: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current
  const expire = useRef(onExpire)
  expire.current = onExpire

  useEffect(() => {
    if (!visible) return
    opacity.setValue(0)
    Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start()
    const timer = setTimeout(() => expire.current(), 4500)
    return () => clearTimeout(timer)
  }, [visible, opacity])

  if (!visible) return null
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={{
        opacity,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        marginHorizontal: space.sm,
        marginVertical: space.xs,
        paddingLeft: space.md,
        paddingRight: space.xs,
        minHeight: 44,
        borderRadius: radius.md,
        backgroundColor: colour.forest900,
      }}
    >
      <Text style={[type.small, { color: colour.onForest, flex: 1 }]}>Notification deleted</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Undo"
        onPress={onUndo}
        hitSlop={6}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.sm, minHeight: 36, opacity: pressed ? 0.7 : 1 })}
      >
        <Undo2 size={16} color={colour.pitch400} strokeWidth={2.2} />
        <Text style={[type.smallMedium, { color: colour.pitch400, fontFamily: "Inter_600SemiBold" }]}>Undo</Text>
      </Pressable>
    </Animated.View>
  )
}
