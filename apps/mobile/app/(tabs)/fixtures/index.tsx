import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { AgendaItem } from "@ovalball/contracts"

import { supabase } from "../../../src/auth/supabase"
import { useAppContexts } from "../../../src/context/contexts"
import { readAgenda, todayIso } from "../../../src/agenda/load"
import { anyManagement, loadFixtureAuthority, type FixtureAuthority } from "../../../src/agenda/authority"
import { groupByDay, relativeDate, restOfDate } from "../../../src/agenda/presentation"
import { friendly, logDetail } from "../../../src/errors/translate"
import { AppHeader } from "../../../src/components/app-header"
import { ContextSheet } from "../../../src/components/context-sheet"
import { AgendaRow, NextFixtureCard } from "../../../src/components/agenda-row"
import {
  AgendaFilterSheet,
  NO_FILTER,
  applyFilter,
  countActive,
  type AgendaFilter,
} from "../../../src/components/agenda-filter"
import { OvalIcon, Plus, SlidersHorizontal } from "../../../src/components/icons"
import { CardSkeleton, EmptyState, ErrorState } from "../../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/**
 * FIXTURES — what matches have we got, and what can I do about them.
 *
 * TWO QUESTIONS, TWO SEGMENTS. Upcoming is the one people open the app for, so it is the default and
 * the one the screen is shaped around. Past is a deliberate move, not somewhere to land: opening
 * Fixtures in March and scrolling through five months of finished rugby to find Saturday is the
 * failure this avoids.
 *
 * EVERY ROW COMES FROM THE CANONICAL AGENDA. The same `loadAgenda` the website runs, through the same
 * scope resolver, so Home's next fixture, this list and the Calendar cannot disagree about who is
 * playing whom or which side is at home. That is not a nicety: the three surfaces used to ask three
 * different questions.
 *
 * TRAINING IS NOT A FIXTURE and is excluded here. It belongs on the Calendar, where the question is
 * "when is my rugby" rather than "what matches have we got" -- and a training session in a fixture
 * list, with no opponent and no home or away, is a row that cannot answer either column.
 *
 * WHAT YOU MAY DO IS ASKED OF THE SERVER. `my_capabilities` decides whether Add and Request appear, at
 * the scope of the context somebody is standing in. There is no role name in this file.
 */
export default function Fixtures() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { sessionContext, active } = useAppContexts()
  const [direction, setDirection] = useState<"upcoming" | "past">("upcoming")
  const [items, setItems] = useState<AgendaItem[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [problem, setProblem] = useState<{ message: string; offline: boolean } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [authority, setAuthority] = useState<FixtureAuthority | null>(null)
  const [filter, setFilter] = useState<AgendaFilter>(NO_FILTER)
  const [filterOpen, setFilterOpen] = useState(false)
  const today = todayIso()

  const load = useCallback(async () => {
    if (!sessionContext || !active) return
    setProblem(null)
    try {
      const result = await readAgenda(supabase, sessionContext, active, {
        direction,
        // A FIXTURE LIST IS FIXTURES. Training has no opponent and no home or away; it lives on the
        // Calendar, where the question it answers is the one being asked.
        includeTraining: false,
        today,
      })
      setItems(result.items)
      setTruncated(result.truncated)
    } catch (caught) {
      const failure = friendly(caught, "your fixtures")
      logDetail("fixtures", failure)
      // OFFLINE KEEPS WHAT IS ALREADY ON SCREEN. A schedule somebody loaded five minutes ago is still
      // broadly true, and blanking it because the train went into a tunnel is worse than saying so.
      setProblem({ message: failure.message, offline: /connection/i.test(failure.message) })
    }
  }, [sessionContext, active, direction, today])

  useEffect(() => {
    // CLEARED FIRST ON A CONTEXT CHANGE. The previous side's fixtures must never sit under the new
    // side's name, not even for the moment the next read is in flight.
    setItems(null)
    setProblem(null)
    void load()
  }, [load])

  useEffect(() => {
    let live = true
    setAuthority(null)
    void loadFixtureAuthority(supabase, active).then((result) => {
      if (live) setAuthority(result)
    })
    return () => {
      live = false
    }
  }, [active])

  // A fixture created or cancelled on another screen has to show here on the way back.
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

  // NARROWED, NEVER WIDENED. `items` is what the server authorised; this only removes from it, and the
  // filter's own options are drawn from the same array.
  const shown = useMemo(() => (items ? applyFilter(items, filter) : null), [items, filter])

  const [next, rest] = useMemo(() => {
    const items = shown
    if (!items || items.length === 0 || direction === "past") return [null, items ?? []]
    // THE NEXT ONE THAT IS ACTUALLY ON. A cancelled match is not what somebody is preparing for, so it
    // stays in the list and does not take the headline.
    const index = items.findIndex((item) => item.status !== "Cancelled")
    if (index === -1) return [null, items]
    return [items[index], items.filter((_, i) => i !== index)]
  }, [shown, direction])

  const days = useMemo(() => groupByDay(rest), [rest])
  const canAdd = authority?.create ?? false
  const canRequest = authority?.requestCreate ?? false

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <AppHeader onOpenContexts={() => setSheetOpen(true)} />

      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, gap: space.md }}>
        <Segments value={direction} onChange={setDirection} />

        {/* ONE BUTTON, BECAUSE IT IS ONE JOB. Add Fixture and Request Fixture asked almost identical
            questions; what differs is who the opponent is, which the platform already knows. The
            journey chooses the club first and then says which of the two endings applies.

            MANAGEMENT IS OFFERED ONLY WHERE THE SERVER SAYS SO, and never as a Planner: mass planning,
            import and bulk editing are club-scoped web jobs, and a phone reproducing them badly would
            be worse than one that says where they live. */}
        <View style={{ flexDirection: "row", gap: space.sm }}>
          {(canAdd || canRequest) && direction === "upcoming" && (
            <Action
              label="Add Fixture"
              icon={<Plus size={17} color={colour.onForest} strokeWidth={2.2} />}
              primary
              onPress={() => router.push({ pathname: "/fixtures/new", params: { teamId: active?.id ?? "" } })}
            />
          )}
          <Action
            label={countActive(filter) > 0 ? `Filter · ${countActive(filter)}` : "Filter"}
            icon={<SlidersHorizontal size={16} color={colour.forest800} strokeWidth={2} />}
            onPress={() => setFilterOpen(true)}
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl, paddingTop: space.md, gap: space.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colour.forest800} />}
        showsVerticalScrollIndicator={false}
      >
        {problem && !shown && (
          <View style={{ paddingHorizontal: space.lg }}>
            <ErrorState message={problem.message} offline={problem.offline} onRetry={load} />
          </View>
        )}

        {/* STALE RATHER THAN BLANK. What is on screen is what was true when it loaded, and the banner
            says so instead of the list pretending to be current. */}
        {problem && shown && (
          <View style={{ marginHorizontal: space.lg, padding: space.md, borderRadius: radius.md, backgroundColor: colour.warningSurface }}>
            <Text accessibilityRole="alert" style={[type.caption, { color: colour.warning }]}>
              {problem.offline ? "Offline — showing the schedule as it was." : problem.message}
            </Text>
          </View>
        )}

        {!problem && shown === null && (
          <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
            <CardSkeleton lines={2} />
            <CardSkeleton lines={1} />
            <CardSkeleton lines={1} />
          </View>
        )}

        {!!next && (
          <View style={{ paddingHorizontal: space.lg }}>
            <NextFixtureCard item={next} today={today} onPress={() => router.push(`/fixtures/${next.eventId}`)} />
          </View>
        )}

        {shown?.length === 0 && (
          <View style={{ paddingHorizontal: space.lg }}>
            <EmptyState
              title={
                countActive(filter) > 0
                  ? "Nothing matches that filter"
                  : direction === "upcoming"
                    ? "No fixtures coming up"
                    : "No past fixtures"
              }
              body={
                countActive(filter) > 0
                  ? "Clear the filter to see the rest."
                  : direction === "upcoming"
                  ? canAdd || canRequest
                    ? "Nothing is scheduled for this side yet. Add one, or ask another club for a match."
                    : "Nothing is scheduled for this side yet. Fixtures appear here as soon as they are arranged."
                  : "Nothing has been played yet. Results appear here after the match."
              }
              icon={<OvalIcon size={24} color={colour.inkSubtle} />}
            />
          </View>
        )}

        {days.map((day) => (
          <View key={day.date}>
            <View style={{ paddingHorizontal: space.lg, paddingBottom: space.xs, flexDirection: "row", alignItems: "baseline", gap: space.sm }}>
              {/* ONE DATE. "FRI 2 OCT  Friday, 2 October 2026" said Friday twice and the date twice;
                  the relative word is the useful part and the rest of the date follows it once. */}
              <Text style={[type.overline, { color: colour.forest800 }]}>{relativeDate(day.date, today).toUpperCase()}</Text>
              <Text style={[type.caption, { color: colour.inkSubtle }]}>{restOfDate(day.date, today)}</Text>
            </View>
            <View style={{ backgroundColor: colour.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colour.line }}>
              {day.items.map((item, index) => (
                <View key={item.key} style={index === 0 ? undefined : { borderTopWidth: 1, borderTopColor: colour.line }}>
                  <AgendaRow
                    item={item}
                    today={today}
                    showOwner={active?.kind !== "team"}
                    onPress={() => router.push(`/fixtures/${item.eventId}`)}
                  />
                </View>
              ))}
            </View>
          </View>
        ))}

        {truncated && (
          <Text style={[type.caption, { color: colour.inkMuted, paddingHorizontal: space.lg, textAlign: "center" }]}>
            Showing the first 400. Narrow the view on the web for the full list.
          </Text>
        )}
      </ScrollView>

      <AgendaFilterSheet
        visible={filterOpen}
        // THE UNFILTERED ROWS, so the options do not shrink to whatever the last choice left behind.
        items={items ?? []}
        filter={filter}
        showTraining={false}
        onChange={setFilter}
        onClose={() => setFilterOpen(false)}
      />

      <ContextSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </View>
  )
}

/**
 * UPCOMING AND PAST, AS ONE CONTROL.
 *
 * Two words rather than a filter sheet: there are exactly two directions in time and a person should
 * be able to change their mind with one thumb without a menu opening.
 */
function Segments({
  value,
  onChange,
}: {
  value: "upcoming" | "past"
  onChange: (next: "upcoming" | "past") => void
}) {
  return (
    <View
      accessibilityRole="tablist"
      style={{ flexDirection: "row", backgroundColor: "rgba(16,21,18,0.05)", borderRadius: radius.md, padding: 3 }}
    >
      {(["upcoming", "past"] as const).map((option) => {
        const selected = option === value
        return (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option === "upcoming" ? "Upcoming fixtures" : "Past fixtures"}
            onPress={() => onChange(option)}
            style={{
              flex: 1,
              minHeight: TOUCH_TARGET - 8,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.sm,
              backgroundColor: selected ? colour.surface : "transparent",
            }}
          >
            <Text style={[type.smallMedium, { color: selected ? colour.ink : colour.inkMuted }]}>
              {option === "upcoming" ? "Upcoming" : "Past"}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function Action({
  label,
  icon,
  primary,
  onPress,
}: {
  label: string
  icon: React.ReactNode
  primary?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: TOUCH_TARGET,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: space.sm,
        borderRadius: radius.md,
        backgroundColor: primary ? colour.forest800 : colour.surface,
        borderWidth: primary ? 0 : 1,
        borderColor: colour.lineStrong,
        opacity: pressed ? 0.88 : 1,
      })}
    >
      {icon}
      <Text style={[type.smallMedium, { color: primary ? colour.onForest : colour.forest800 }]}>{label}</Text>
    </Pressable>
  )
}
