import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { AgendaItem, RangeMode } from "@ovalball/contracts"
import { nextAnchor, previousAnchor, windowContainsToday } from "@ovalball/contracts"

import { supabase } from "../../src/auth/supabase"
import { useAppContexts } from "../../src/context/contexts"
import { readAgenda, todayIso } from "../../src/agenda/load"
import { daysBetween, exactDate, groupByDay, relativeDate } from "../../src/agenda/presentation"
import { friendly, logDetail } from "../../src/errors/translate"
import { AppHeader } from "../../src/components/app-header"
import { ContextSheet } from "../../src/components/context-sheet"
import { AgendaRow } from "../../src/components/agenda-row"
import { CalendarDays, ChevronRight } from "../../src/components/icons"
import { CardSkeleton, EmptyState, ErrorState } from "../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../src/design/tokens"

/**
 * CALENDAR — when is my rugby happening.
 *
 * NOT A SECOND FIXTURE LIST. Fixtures answers "what matches have we got"; this answers "what is on
 * this week", which is a different question with training and club events in it, and for a parent it
 * is the question that actually matters on a Tuesday evening.
 *
 * AN AGENDA, NOT A MONTH GRID. A month grid on a phone is 35 cells four millimetres across, and a
 * fixture in one of them is a dot. The useful default on a handset is a list of days with what is
 * actually happening in them, so that is what this is -- with a month STRIP above it for movement,
 * which is the part a grid was genuinely good at.
 *
 * THE STRIP CARRIES DOTS, SO A JUMP IS INFORMED. Moving through empty weeks looking for a fixture is
 * the failure this avoids: the days with something on them are marked, so somebody can see where to
 * go before they go there.
 *
 * THE SAME AGENDA AS HOME AND FIXTURES. Same loader, same scope resolver, same items -- so if Home
 * says Saturday, U12 Boys v Burnley, 10:30, this says the same, because it is the same row.
 *
 * FAMILY IS THE POINT, not a mode. In a family context the loader returns one row per child per event
 * and each row names the child, so a parent with three children sees all three children's rugby in one
 * list -- and two children playing at the same time appear as two rows at the same time, which is how
 * a clash makes itself obvious without a conflict engine.
 */
export default function Calendar() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { sessionContext, active } = useAppContexts()
  const today = todayIso()

  const [mode, setMode] = useState<Extract<RangeMode, "week" | "month">>("week")
  const [anchor, setAnchor] = useState(today)
  const [items, setItems] = useState<AgendaItem[] | null>(null)
  const [label, setLabel] = useState("")
  const [problem, setProblem] = useState<{ message: string; offline: boolean } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)

  const load = useCallback(async () => {
    if (!sessionContext || !active) return
    setProblem(null)
    try {
      const result = await readAgenda(supabase, sessionContext, active, { mode, anchor, includeTraining: true, today })
      setItems(result.items)
      setLabel(result.label)
    } catch (caught) {
      const failure = friendly(caught, "your calendar")
      logDetail("calendar", failure)
      setProblem({ message: failure.message, offline: /connection/i.test(failure.message) })
    }
  }, [sessionContext, active, mode, anchor, today])

  useEffect(() => {
    // CLEARED ON A CONTEXT CHANGE, never on a date change. Moving to next week should not blank the
    // screen; switching from one child to another must, because the previous child's events under the
    // new child's name is the one thing this must never show.
    setItems(null)
    setProblem(null)
  }, [active])

  useEffect(() => {
    void load()
  }, [load])

  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  const days = useMemo(() => groupByDay(items ?? []), [items])
  const busyDates = useMemo(() => new Set((items ?? []).map((item) => item.date)), [items])
  const showOwner = active?.kind !== "team"

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <AppHeader onOpenContexts={() => setSheetOpen(true)} />

      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Step
            label={mode === "week" ? "Previous week" : "Previous month"}
            direction="back"
            onPress={() => setAnchor(previousAnchor(mode, anchor))}
          />
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text accessibilityRole="header" numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
              {label}
            </Text>
          </View>
          <Step
            label={mode === "week" ? "Next week" : "Next month"}
            direction="forward"
            onPress={() => setAnchor(nextAnchor(mode, anchor))}
          />
        </View>

        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Toggle value={mode} onChange={setMode} />
          {/* TODAY IS ALWAYS ONE TAP AWAY, and it disappears when you are already there rather than
              sitting inert. Somebody three months into the future should never have to count back. */}
          {anchor !== today && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go to today"
              onPress={() => setAnchor(today)}
              style={({ pressed }) => ({
                minHeight: TOUCH_TARGET - 8,
                paddingHorizontal: space.lg,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colour.lineStrong,
                backgroundColor: colour.surface,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={[type.smallMedium, { color: colour.forest800 }]}>Today</Text>
            </Pressable>
          )}
        </View>

        {mode === "week" && <WeekStrip anchor={anchor} today={today} busy={busyDates} onPick={setAnchor} />}
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl, paddingTop: space.md, gap: space.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colour.forest800} />}
        showsVerticalScrollIndicator={false}
      >
        {problem && !items && (
          <View style={{ paddingHorizontal: space.lg }}>
            <ErrorState message={problem.message} offline={problem.offline} onRetry={load} />
          </View>
        )}

        {problem && items && (
          <View style={{ marginHorizontal: space.lg, padding: space.md, borderRadius: radius.md, backgroundColor: colour.warningSurface }}>
            <Text accessibilityRole="alert" style={[type.caption, { color: colour.warning }]}>
              {problem.offline ? "Offline — showing the calendar as it was." : problem.message}
            </Text>
          </View>
        )}

        {!problem && items === null && (
          <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
            <CardSkeleton lines={1} />
            <CardSkeleton lines={1} />
          </View>
        )}

        {items?.length === 0 && (
          <View style={{ paddingHorizontal: space.lg }}>
            <EmptyState
              title={emptyTitle(mode, anchor, today)}
              body={
                active?.kind === "family"
                  ? "No fixtures or training for your children in this period. Try the next one."
                  : "No fixtures or training in this period. Try the next one."
              }
              icon={<CalendarDays size={24} color={colour.inkSubtle} />}
            />
          </View>
        )}

        {days.map((day) => (
          <View key={day.date}>
            <View style={{ paddingHorizontal: space.lg, paddingBottom: space.xs, flexDirection: "row", alignItems: "baseline", gap: space.sm }}>
              <Text style={[type.overline, { color: day.date === today ? colour.pitch600 : colour.forest800 }]}>
                {relativeDate(day.date, today).toUpperCase()}
              </Text>
              <Text style={[type.caption, { color: colour.inkSubtle }]}>{exactDate(day.date)}</Text>
            </View>
            <View style={{ backgroundColor: colour.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colour.line }}>
              {day.items.map((item, index) => (
                <View key={item.key} style={index === 0 ? undefined : { borderTopWidth: 1, borderTopColor: colour.line }}>
                  <AgendaRow
                    item={item}
                    today={today}
                    showOwner={showOwner}
                    // EVERY EVENT ROUTES TO ITS OWN DOMAIN OBJECT. A fixture opens Fixture Detail --
                    // the same screen the Fixtures tab opens, not a calendar-flavoured copy of it.
                    // Training has no native destination yet and is honestly not tappable rather than
                    // opening something that would have to apologise.
                    onPress={item.kind === "fixture" ? () => router.push(`/fixtures/${item.eventId}` as never) : undefined}
                  />
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      <ContextSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </View>
  )
}

/**
 * SEVEN DAYS, WITH THE BUSY ONES MARKED.
 *
 * The one thing a month grid was genuinely good at -- seeing at a glance where something is -- without
 * the thing it was bad at, which is being four millimetres wide. A dot means the day has rugby in it.
 */
function WeekStrip({
  anchor,
  today,
  busy,
  onPick,
}: {
  anchor: string
  today: string
  busy: Set<string>
  onPick: (iso: string) => void
}) {
  const start = startOfWeek(anchor)
  const days = Array.from({ length: 7 }, (_, index) => shift(start, index))

  return (
    <View style={{ flexDirection: "row", gap: 4 }}>
      {days.map((iso) => {
        const date = new Date(`${iso}T12:00:00`)
        const isToday = iso === today
        const hasRugby = busy.has(iso)
        return (
          <Pressable
            key={iso}
            accessibilityRole="button"
            accessibilityLabel={`${exactDate(iso)}${hasRugby ? ". Has rugby" : ". Nothing scheduled"}`}
            accessibilityState={{ selected: isToday }}
            onPress={() => onPick(iso)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: TOUCH_TARGET + 6,
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              borderRadius: radius.md,
              backgroundColor: isToday ? colour.forest800 : pressed ? colour.mint100 : "transparent",
            })}
          >
            <Text style={[type.caption, { color: isToday ? colour.onForestMuted : colour.inkMuted, fontSize: 10 }]}>
              {date.toLocaleDateString("en-GB", { weekday: "narrow" })}
            </Text>
            <Text style={[type.smallMedium, { color: isToday ? colour.onForest : colour.ink }]}>
              {date.getDate()}
            </Text>
            {/* A DOT, AND A LABEL THAT SAYS IT. The dot is a convenience for the eye; the spoken label
                carries the same fact for anybody who is not using one. */}
            <View
              style={{
                width: 4,
                height: 4,
                borderRadius: 2,
                backgroundColor: hasRugby ? (isToday ? colour.mint300 : colour.pitch600) : "transparent",
              }}
            />
          </Pressable>
        )
      })}
    </View>
  )
}

function Toggle({
  value,
  onChange,
}: {
  value: "week" | "month"
  onChange: (next: "week" | "month") => void
}) {
  return (
    <View
      accessibilityRole="tablist"
      style={{ flex: 1, flexDirection: "row", backgroundColor: "rgba(16,21,18,0.05)", borderRadius: radius.md, padding: 3 }}
    >
      {(["week", "month"] as const).map((option) => {
        const selected = option === value
        return (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option === "week" ? "One week at a time" : "One month at a time"}
            onPress={() => onChange(option)}
            style={{
              flex: 1,
              minHeight: TOUCH_TARGET - 14,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.sm,
              backgroundColor: selected ? colour.surface : "transparent",
            }}
          >
            <Text style={[type.smallMedium, { color: selected ? colour.ink : colour.inkMuted, fontSize: 13 }]}>
              {option === "week" ? "Week" : "Month"}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function Step({ label, direction, onPress }: { label: string; direction: "back" | "forward"; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: TOUCH_TARGET,
        height: TOUCH_TARGET,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={direction === "back" ? { transform: [{ rotate: "180deg" }] } : undefined}>
        <ChevronRight size={20} color={colour.forest800} />
      </View>
    </Pressable>
  )
}

function emptyTitle(mode: "week" | "month", anchor: string, today: string): string {
  if (mode === "month") return "Nothing scheduled this month"
  const days = daysBetween(today, anchor)
  if (days >= 0 && days < 7) return "Nothing scheduled this week"
  return "Nothing scheduled"
}

/**
 * A RUGBY WEEK STARTS ON MONDAY.
 *
 * The same rule the canonical window uses, and it is not arbitrary: the fixture is on Saturday and the
 * training that prepares for it is on Tuesday and Thursday, so a Sunday-start week cuts that story in
 * half. Reimplemented here only because the strip needs the seven dates rather than a window.
 */
function startOfWeek(iso: string): string {
  const date = new Date(`${iso}T12:00:00`)
  const day = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - day)
  return format(date)
}

function shift(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00`)
  date.setDate(date.getDate() + days)
  return format(date)
}

function format(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}
