import { useEffect, useRef } from "react"
import { Animated, Easing, Modal, Pressable, ScrollView, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { AgendaItem } from "@ovalball/contracts"

import { AgendaRow } from "./agenda-row"
import { CalendarDays, X } from "./icons"
import { exactDate, groupByDay, relativeDate, restOfDate } from "../agenda/presentation"
import { TOUCH_TARGET, colour, elevation, radius, space, type } from "../design/tokens"

/**
 * ONE WEEK, OPENED FROM ITS SQUARE.
 *
 * A SHEET, NOT AN EXPANSION UNDERNEATH THE GRID. Expanding in place pushed the week's rugby below
 * thirty squares, so choosing a week in February meant scrolling past the whole season to read it --
 * and then scrolling back to choose another. A sheet arrives over the grid, is dismissed with a
 * gesture somebody already has, and leaves the grid exactly where it was.
 *
 * THE SAME ROWS AS EVERYWHERE ELSE. These are real `AgendaItem`s drawn by the same `AgendaRow` the
 * Calendar and Fixtures use, so a fixture looks and speaks the same here as it does in a list, and
 * tapping one goes to the same destination. A week panel with its own smaller fixture card would be a
 * second way to draw a fixture.
 *
 * A REST WEEK IS A REAL ANSWER. It gets a sentence saying so rather than an empty sheet, because an
 * empty sheet reads as something that failed to load.
 */
export function WeekSheet({
  visible,
  mondayIso,
  items,
  today,
  onClose,
  onOpenItem,
}: {
  visible: boolean
  mondayIso: string | null
  /** Only this week's rows; the caller has already cut them out of the season. */
  items: AgendaItem[]
  today: string
  onClose: () => void
  onOpenItem: (item: AgendaItem) => void
}) {
  const insets = useSafeAreaInsets()
  const translate = useRef(new Animated.Value(600)).current
  const backdrop = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!visible) return
    translate.setValue(600)
    Animated.parallel([
      Animated.spring(translate, { toValue: 0, damping: 26, stiffness: 260, useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 1, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start()
  }, [visible, translate, backdrop])

  const days = groupByDay(items)
  const sunday = mondayIso ? addDays(mondayIso, 6) : null

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.5)", opacity: backdrop }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close this week" onPress={onClose} style={{ flex: 1 }} />
      </Animated.View>

      <Animated.View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: "80%",
          backgroundColor: colour.chalk,
          borderTopLeftRadius: radius.xl + 6,
          borderTopRightRadius: radius.xl + 6,
          paddingBottom: insets.bottom + space.md,
          transform: [{ translateY: translate }],
          ...elevation.sheet,
        }}
      >
        <View style={{ paddingTop: space.sm, alignItems: "center" }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colour.lineStrong }} />
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
              {mondayIso ? weekTitle(mondayIso, today) : "Week"}
            </Text>
            {!!mondayIso && !!sunday && (
              <Text style={[type.caption, { color: colour.inkMuted }]}>
                {span(mondayIso, sunday)}
              </Text>
            )}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            hitSlop={8}
            style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "flex-end", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
          >
            <X size={22} color={colour.ink} strokeWidth={2.2} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: space.lg }}>
          {days.length === 0 && (
            <View style={{ paddingHorizontal: space.lg, paddingVertical: space.xl, alignItems: "center", gap: space.sm }}>
              <CalendarDays size={24} color={colour.inkSubtle} />
              <Text style={[type.smallMedium, { color: colour.ink }]}>A rest week</Text>
              <Text style={[type.small, { color: colour.inkMuted, textAlign: "center" }]}>
                Nothing is scheduled — which is a real answer, not a gap in the data.
              </Text>
            </View>
          )}

          {days.map((day) => (
            <View key={day.date}>
              <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xs, flexDirection: "row", alignItems: "baseline", gap: space.sm }}>
                <Text style={[type.overline, { color: day.date === today ? colour.pitch600 : colour.forest800 }]}>
                  {relativeDate(day.date, today).toUpperCase()}
                </Text>
                <Text style={[type.caption, { color: colour.inkSubtle }]}>{restOfDate(day.date, today)}</Text>
              </View>
              <View style={{ backgroundColor: colour.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colour.line }}>
                {day.items.map((item, index) => (
                  <View key={item.key} style={index === 0 ? undefined : { borderTopWidth: 1, borderTopColor: colour.line }}>
                    <AgendaRow item={item} today={today} showOwner onPress={() => onOpenItem(item)} />
                  </View>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </Animated.View>
    </Modal>
  )
}

/** "This week" where it is, otherwise the Monday -- the same relative rule the rest of the app uses. */
function weekTitle(mondayIso: string, today: string): string {
  const relative = relativeDate(mondayIso, today)
  return relative === "Today" ? "This week" : `Week of ${exactDate(mondayIso).replace(/^[A-Za-z]+,\s*/, "")}`
}

function span(startIso: string, endIso: string): string {
  const start = new Date(`${startIso}T12:00:00`)
  const end = new Date(`${endIso}T12:00:00`)
  const sameMonth = start.getMonth() === end.getMonth()
  const startPart = start.toLocaleDateString("en-GB", sameMonth ? { day: "numeric" } : { day: "numeric", month: "short" })
  const endPart = end.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
  return `${startPart} – ${endPart}`
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00`)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}
