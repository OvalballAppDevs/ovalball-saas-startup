import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { AgendaItem, RangeMode } from "@ovalball/contracts"
import {
  dayLabel,
  isFamilyFacingContext,
  marksByDay,
  memberFor,
  monthCells,
  monthLabel,
  nextAnchor,
  nextDayWithSomething,
  previousAnchor,
  startOfMonth,
  windowContainsToday,
} from "@ovalball/contracts"

import { supabase } from "../../../src/auth/supabase"
import { useAppContexts } from "../../../src/context/contexts"
import { readAgenda, todayIso } from "../../../src/agenda/load"
import { mondayOf } from "@ovalball/contracts"
import { clubRugbyCode, loadSeasons, resolveSeason, seasonLabel, type SeasonPhase, type SeasonRow } from "../../../src/agenda/seasons"
import { daysBetween, exactDate, groupByDay, relativeDate, restOfDate } from "../../../src/agenda/presentation"
import { friendly, logDetail } from "../../../src/errors/translate"
import { AppHeader } from "../../../src/components/app-header"
import { ChildFilter } from "../../../src/components/child-filter"
import { useFamily } from "../../../src/family/family"
import { ContextSheet } from "../../../src/components/context-sheet"
import { AgendaRow } from "../../../src/components/agenda-row"
import { routeForAgendaItem } from "../../../src/links/destinations"
import { SeasonGrid } from "../../../src/components/season-grid"
import { WeekSheet } from "../../../src/components/week-sheet"
import { MonthCalendar } from "../../../src/components/month-calendar"
import {
  AgendaFilterSheet,
  NO_FILTER,
  applyFilter,
  countActive,
  type AgendaFilter,
} from "../../../src/components/agenda-filter"
import { CalendarDays, Check, ChevronDown, ChevronRight, SlidersHorizontal, X } from "../../../src/components/icons"
import { CardSkeleton, EmptyState, ErrorState } from "../../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

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

  /*
    TWO GRAINS. THE MONTH IS THE CALENDAR.

    A month grid with the chosen day's rugby in a sheet beneath it -- the shape the
    owner asked for, and the shape every native calendar uses. It answers "what has
    this family got on in October" at a glance, which no scrolling list does, and
    the sheet answers "and what exactly" in words the moment a day is tapped.

    The old WEEK grain is gone: a month grid contains every week, the strip it used
    is the same information in less of it, and two date pickers on one screen is one
    too many. SEASON stays, because "what has this side got on all year" is a
    different question and the register is its own authority.
  */
  const [mode, setMode] = useState<"month" | "season">("month")
  const [anchor, setAnchor] = useState(today)
  const [items, setItems] = useState<AgendaItem[] | null>(null)
  const [label, setLabel] = useState("")
  const [problem, setProblem] = useState<{ message: string; offline: boolean } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [filter, setFilter] = useState<AgendaFilter>(NO_FILTER)
  const [filterOpen, setFilterOpen] = useState(false)
  // THE SEASON COMES FROM THE CANONICAL REGISTER, never from a date. A club's season is whatever Site
  // Admin recorded, and a calendar that computed one from a month boundary would be a second answer.
  const [seasons, setSeasons] = useState<SeasonRow[]>([])
  const [seasonId, setSeasonId] = useState<string | null>(null)
  const [phase, setPhase] = useState<SeasonPhase | null>(null)
  // WHICH SQUARE IS OPEN. Null means the grid alone -- the season's shape, which is what somebody came
  // to Season view to see. Tapping a week expands it underneath rather than navigating away.
  const [openWeek, setOpenWeek] = useState<string | null>(null)
  /*
    WHICH DAY THE SHEET IS SHOWING. It opens on today, because that is the day
    somebody has in mind when they open a calendar, and it is what makes "find
    today" a thing you do not have to do.
  */
  const [openDay, setOpenDay] = useState<string>(today)

  // The register, scoped to our own rugby code -- a Union club is never shown a League season.
  useEffect(() => {
    let live = true
    setSeasons([])
    setSeasonId(null)
    setPhase(null)
    void (async () => {
      const code = await clubRugbyCode(supabase, active?.clubId ?? null)
      const rows = await loadSeasons(supabase, code)
      if (live) setSeasons(rows)
    })()
    return () => {
      live = false
    }
  }, [active])

  const season = useMemo(
    () => resolveSeason(seasons, null, today, seasonId, phase),
    [seasons, today, seasonId, phase]
  )

  const load = useCallback(async () => {
    if (!sessionContext || !active) return
    setProblem(null)
    try {
      // IN SEASON MODE THE WINDOW IS THE REGISTER'S OWN. Not a year from today, not a computed
      // boundary -- the dates Site Admin recorded for this season and this phase, which is what makes
      // Pre-Season a real view rather than a label.
      /*
        ONE READ, THE WHOLE VISIBLE GRID.

        The month view draws six rows, which spill into the neighbouring months, so
        the read covers exactly those forty-two days -- from the Monday on or before
        the first to the Sunday on or after the last. Reading only the calendar
        month would leave the spill days dotless while their numbers were plainly
        on screen, which reads as "nothing on" rather than "not asked about".

        IT IS ONE BOUNDED QUERY, and it does not grow with the family: the scope is
        resolved once from the session and every child's rugby comes back in the
        same read. No request per day, none per child, and no unbounded history --
        stepping to another month asks once more.
      */
      const grid = monthCells(anchor)
      const result =
        mode === "season" && season.range
          ? await readAgenda(supabase, sessionContext, active, { range: season.range, includeTraining: true, today })
          : await readAgenda(supabase, sessionContext, active, {
              range: { start: grid[0].iso, end: grid[grid.length - 1].iso, label: monthLabel(anchor) },
              includeTraining: true,
              today,
            })
      setItems(result.items)
      setLabel(
        mode === "season"
          ? `${seasonLabel(season.selected)}${season.phase === "pre" ? " · Pre-season" : ""}`
          : result.label
      )
    } catch (caught) {
      const failure = friendly(caught, "your calendar")
      logDetail("calendar", failure)
      setProblem({ message: failure.message, offline: /connection/i.test(failure.message) })
    }
  }, [sessionContext, active, mode, anchor, today, season.range, season.selected, season.phase])

  useEffect(() => {
    // CLEARED ON A CONTEXT CHANGE, never on a date change. Moving to next week should not blank the
    // screen; switching from one child to another must, because the previous child's events under the
    // new child's name is the one thing this must never show.
    setItems(null)
    setProblem(null)
  }, [active])

  /*
    MOVING MONTH MOVES THE SHEET WITH IT. Stepping to November and leaving the sheet
    on a day in October would leave the grid and the list describing two different
    months -- so the selection lands on the first of the month arrived at, or on
    today when the month arrived at is this one.
  */
  useEffect(() => {
    if (mode !== "month") return
    setOpenDay((current) => (current.slice(0, 7) === anchor.slice(0, 7) ? current : monthStartOrToday(anchor, today)))
  }, [anchor, mode, today])

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

  // NARROWED, NEVER WIDENED -- and the strip's dots follow the same narrowing, so a day that has been
  // filtered out does not still advertise itself as having rugby in it.
  /* The same merge Fixtures does, and for the same reason: the selected child
     is family state, already normalised against the resolved family, so the
     chip row and the calendar cannot disagree about who is selected. */
  const { selectedPlayerId, projection } = useFamily()
  const effective = useMemo(() => ({ ...filter, playerId: selectedPlayerId }), [filter, selectedPlayerId])
  const shown = useMemo(() => (items ? applyFilter(items, effective) : null), [items, effective])
  const days = useMemo(() => {
    const rows = shown ?? []
    // A day the strip selected narrows the list; nothing selected shows the whole week or month.
    // THE SHEET SHOWS ONE DAY. Season mode keeps its whole-range list, because its
    // question is the shape of a year rather than the detail of an afternoon.
    return groupByDay(mode === "month" ? rows.filter((item) => item.date === openDay) : rows)
  }, [shown, mode, openDay])
  // The chosen square's own week, Monday to Sunday, cut out of the rows already on screen.
  const weekItems = useMemo(() => {
    if (!openWeek || !shown) return []
    const end = addDays(openWeek, 6)
    return shown.filter((item) => item.date >= openWeek && item.date <= end)
  }, [openWeek, shown])
  /*
    THE DOTS FOLLOW THE NARROWING. A day filtered down to nothing must not still
    advertise itself as having rugby on it -- the grid and the sheet are two views
    of one list, and a dot over an empty day is the grid contradicting the sheet.
  */
  const marks = useMemo(() => marksByDay(shown ?? []), [shown])
  /** The next day at or after the one being read that has anything on it. */
  const nextBusyDay = useMemo(
    () => nextDayWithSomething(new Set((shown ?? []).map((item) => item.date)), openDay),
    [shown, openDay]
  )
  const showOwner = active?.kind !== "team"

  /*
    ONE DESTINATION TABLE, for every way into an event from this screen -- the
    month grid, the week list and the week sheet. Three copies of the same two
    lines is three chances for one of them to keep sending a parent to fixture
    administration after the others stopped.
  */
  const openEvent = useCallback(
    (item: AgendaItem) => {
      if (!active) return
      const route = routeForAgendaItem(item, active.kind)
      if (route) router.push(route as never)
    },
    [router, active]
  )

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <AppHeader onOpenContexts={() => setSheetOpen(true)} />
      <ChildFilter style={{ paddingHorizontal: space.lg, paddingTop: space.md }} />

      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm }}>
        {/* THE SEASON, WHERE THERE IS MORE THAN ONE TO CHOOSE FROM. A club in its first season has one
            and needs no selector; a club with a history gets to look back at last year's rugby without
            paging through the months between. */}
        {seasons.length > 1 && (
          <SeasonBar
            seasons={seasons}
            selectedId={season.selected?.id ?? null}
            phase={season.phase}
            hasPreSeason={Boolean(season.selected?.preSeasonStartsOn)}
            onSeason={(id: string) => {
              setSeasonId(id)
              // MOVING SEASON MOVES THE VIEW INTO IT. Staying on this week while looking at last season
              // would show an empty week and no reason why.
              const picked = seasons.find((option) => option.id === id)
              if (picked) setAnchor(picked.startsOn > today || picked.endsOn < today ? picked.startsOn : today)
            }}
            onPhase={(next) => {
              setPhase(next)
              // A PHASE THAT CHANGED NOTHING WAS THE DEFECT. In Season mode the window itself changes;
              // in Week or Month the view moves into the phase, so switching to Pre-Season always takes
              // somebody somewhere rather than leaving them on a week outside it.
              const picked = seasons.find((option) => option.id === (season.selected?.id ?? ""))
              if (!picked) return
              const start = next === "pre" ? picked.preSeasonStartsOn : picked.startsOn
              if (start) setAnchor(start)
            }}
          />
        )}

        {season.configBroken && (
          <Text accessibilityRole="alert" style={[type.caption, { color: colour.warning }]}>
            This season&apos;s dates are incomplete in Site Admin, so the period cannot be shown.
          </Text>
        )}

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: space.sm }}>
          {/* TODAY IS ALWAYS ONE TAP AWAY, and it says so only when you are not
              already there -- a control that does nothing is a control people
              learn to distrust. */}
          {(anchor.slice(0, 7) !== today.slice(0, 7) || openDay !== today) && mode === "month" && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go to today"
              onPress={() => {
                setAnchor(clamp(today, season.range))
                setOpenDay(today)
              }}
              style={({ pressed }) => ({
                minHeight: 34,
                justifyContent: "center",
                paddingHorizontal: space.md,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: colour.lineStrong,
                backgroundColor: pressed ? colour.chalk : colour.surface,
              })}
            >
              <Text style={[type.caption, { color: colour.forest800 }]}>Today</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={countActive(filter) > 0 ? `Filter, ${countActive(filter)} applied` : "Filter"}
            onPress={() => setFilterOpen(true)}
            style={({ pressed }) => ({
              minHeight: 34,
              flexDirection: "row",
              alignItems: "center",
              gap: space.xs,
              paddingHorizontal: space.md,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: countActive(filter) > 0 ? colour.forest800 : colour.lineStrong,
              backgroundColor: pressed ? colour.chalk : colour.surface,
            })}
          >
            <SlidersHorizontal size={14} color={colour.forest800} strokeWidth={2} />
            <Text style={[type.caption, { color: colour.forest800 }]}>
              {countActive(filter) > 0 ? `Filter · ${countActive(filter)}` : "Filter"}
            </Text>
          </Pressable>
          <Toggle value={mode} onChange={setMode} />
        </View>
      </View>

      {/* ============================================================
            THE MONTH, ON ITS OWN DARK PLATE.

            The owner's reference design, in Ovalball's forest rather than its
            navy: the month named top left, two round steps top right, a weekday
            row, and six rows of days carrying a dot for rugby played and a dot
            for rugby trained. The plate is dark so the grid reads as one object
            and the sheet of events below it reads as another -- which is the
            whole idea of the layout.
         ============================================================ */}
      {mode === "month" && (
        <View style={{ backgroundColor: colour.forest900, paddingTop: space.md, paddingBottom: space.xl }}>
          <MonthCalendar
            anchor={anchor}
            today={today}
            selected={openDay}
            marks={marks}
            onSelect={setOpenDay}
            onStep={(direction) =>
              setAnchor(clamp(direction === -1 ? previousAnchor("month", anchor) : nextAnchor("month", anchor), season.range))
            }
          />
        </View>
      )}

      {/* THE SHEET, LIFTED OVER THE PLATE. Rounded and pulled up so the day's
          rugby reads as a card drawn out of the month above it rather than as the
          next section down the page -- which is what makes the grid and the list
          feel like one control. */}
      <ScrollView
        style={
          mode === "month"
            ? {
                marginTop: -space.lg,
                borderTopLeftRadius: radius.xl,
                borderTopRightRadius: radius.xl,
                backgroundColor: colour.chalk,
              }
            : undefined
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl, paddingTop: space.md, gap: space.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colour.forest800} />}
        showsVerticalScrollIndicator={false}
      >
        {mode === "month" && (
          <>
            {/* The grab handle from the reference: it says this panel is the thing
                that moves, and it costs one line. */}
            <View style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: colour.line }} />
            <Text
              accessibilityRole="header"
              style={[type.overline, { color: colour.inkMuted, paddingHorizontal: space.lg, marginTop: space.xs }]}
            >
              {dayLabel(openDay, today).toUpperCase()}
              {restOfDate(openDay, today) ? ` · ${restOfDate(openDay, today).toUpperCase()}` : ""}
            </Text>
          </>
        )}
        {problem && !shown && (
          <View style={{ paddingHorizontal: space.lg }}>
            <ErrorState message={problem.message} offline={problem.offline} onRetry={load} />
          </View>
        )}

        {problem && shown && (
          <View style={{ marginHorizontal: space.lg, padding: space.md, borderRadius: radius.md, backgroundColor: colour.warningSurface }}>
            <Text accessibilityRole="alert" style={[type.caption, { color: colour.warning }]}>
              {problem.offline ? "Offline — showing the calendar as it was." : problem.message}
            </Text>
          </View>
        )}

        {!problem && shown === null && (
          <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
            <CardSkeleton lines={1} />
            <CardSkeleton lines={1} />
          </View>
        )}

        {/* A QUIET DAY IS AN ANSWER, and it says where the rugby actually is
            rather than leaving somebody tapping across the month to find out.
            `nextDayWithSomething` reads the days already on screen, so the
            suggestion can never point at a day the filter has emptied. */}
        {mode === "month" && days.length === 0 && !!shown && !problem && (
          <View style={{ paddingHorizontal: space.lg }}>
            <EmptyState
              title={countActive(filter) > 0 ? "Nothing matches that filter" : "Nothing on this day"}
              body={
                countActive(filter) > 0
                  ? "Clear the filter to see the rest of the month."
                  : nextBusyDay
                    ? `The next thing on is ${dayLabel(nextBusyDay, today)}${restOfDate(nextBusyDay, today) ? `, ${restOfDate(nextBusyDay, today)}` : ""}.`
                    : active?.kind === "family"
                      ? "No fixtures or training for your children this month."
                      : "No fixtures or training this month."
              }
              icon={<CalendarDays size={24} color={colour.inkSubtle} />}
            />
            {!!nextBusyDay && countActive(filter) === 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Go to ${dayLabel(nextBusyDay, today)}`}
                onPress={() => setOpenDay(nextBusyDay)}
                style={({ pressed }) => ({
                  alignSelf: "center",
                  marginTop: space.md,
                  minHeight: TOUCH_TARGET,
                  justifyContent: "center",
                  paddingHorizontal: space.lg,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: colour.lineStrong,
                  backgroundColor: pressed ? colour.chalk : colour.surface,
                })}
              >
                <Text style={[type.smallMedium, { color: colour.forest800 }]}>
                  Go to {dayLabel(nextBusyDay, today)}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {mode === "season" && shown?.length === 0 && countActive(filter) > 0 && (
          <View style={{ paddingHorizontal: space.lg }}>
            <EmptyState
              title="Nothing matches that filter"
              body="Clear the filter to see the rest of the season."
              icon={<CalendarDays size={24} color={colour.inkSubtle} />}
            />
          </View>
        )}

        {mode === "season" && !!season.range && !!shown && (
          <SeasonGrid
            rangeStart={season.range.start}
            rangeEnd={season.range.end}
            items={shown}
            today={today}
            selectedWeek={openWeek}
            onSelectWeek={setOpenWeek}
          />
        )}

        {days.map((day) => (
          <View key={day.date} style={mode === "month" ? { paddingHorizontal: space.lg, gap: space.sm } : undefined}>
            {/* IN MONTH MODE THE SHEET ALREADY SAYS WHICH DAY IT IS, so a heading
                here would say it twice, three lines apart. Season mode keeps its
                per-day heading, because its list spans a whole year. */}
            {mode !== "month" && (
              <View style={{ paddingHorizontal: space.lg, paddingBottom: space.xs, flexDirection: "row", alignItems: "baseline", gap: space.sm }}>
                <Text style={[type.overline, { color: day.date === today ? colour.pitch600 : colour.forest800 }]}>
                  {relativeDate(day.date, today).toUpperCase()}
                </Text>
                <Text style={[type.caption, { color: colour.inkSubtle }]}>{restOfDate(day.date, today)}</Text>
              </View>
            )}

            {/* ONE CARD PER EVENT in the day sheet -- the reference's shape, and
                the right one for a family: Pippa's training at six and George's
                match at half past are two separate things to be at, so they are
                two separate objects rather than two rows of one table. Season
                mode stays a dense list, because a year of rugby as cards is a
                scroll nobody finishes.

                THE ROW INSIDE IS THE SHARED ONE. Home, Fixtures and Calendar draw
                a piece of rugby with one component, so a cancelled match is struck
                through here exactly as it is there and a redesign reaches all
                three. Only the frame around it differs. */}
            {mode === "month" ? (
              day.items.map((item) => (
                <View
                  key={item.key}
                  style={{
                    borderRadius: radius.lg,
                    backgroundColor: colour.surface,
                    borderWidth: 1,
                    borderColor: colour.line,
                    overflow: "hidden",
                  }}
                >
                  <AgendaRow
                    item={item}
                    today={today}
                    showOwner={showOwner}
                    child={memberFor(projection, item.playerId)}
                    onPress={() => openEvent(item)}
                  />
                </View>
              ))
            ) : (
              <View style={{ backgroundColor: colour.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colour.line }}>
                {day.items.map((item, index) => (
                  <View key={item.key} style={index === 0 ? undefined : { borderTopWidth: 1, borderTopColor: colour.line }}>
                    {/* EVERY EVENT ROUTES TO ITS OWN DOMAIN OBJECT, and which one it
                        is comes from the single destination table in
                        src/links/destinations -- shared with Home, Fixtures, a
                        notification and a deep link. A match opens the Match Centre
                        for a parent or a player and the fixture console for staff; a
                        session opens the Training Centre. Neither is ever a
                        "calendar event detail". */}
                    <AgendaRow
                      item={item}
                      today={today}
                      showOwner={showOwner}
                      child={memberFor(projection, item.playerId)}
                      onPress={() => openEvent(item)}
                    />
                  </View>
                ))}
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      <AgendaFilterSheet
        visible={filterOpen}
        items={items ?? []}
        filter={filter}
        // The Calendar genuinely mixes matches and training, so the toggle has something to do here.
        showTraining
        onChange={setFilter}
        onClose={() => setFilterOpen(false)}
        // NO TEAM CHIPS FOR A FAMILY. The child chips above the list are the
        // canonical way a guardian narrows; a side's name is the same question in
        // the wrong language.
        familyScope={active !== null && isFamilyFacingContext(active.kind)}
      />

      {/* THE WEEK ARRIVES OVER THE GRID, not underneath it. Expanding in place put February's rugby
          below thirty squares, so reading it meant scrolling past the whole season and back. */}
      <WeekSheet
        visible={openWeek !== null}
        mondayIso={openWeek}
        items={weekItems}
        today={today}
        onClose={() => setOpenWeek(null)}
        onOpenItem={(item) => {
          setOpenWeek(null)
          openEvent(item)
        }}
      />

      <ContextSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </View>
  )
}


/**
 * THE SEASON, AND WHICH PART OF IT.
 *
 * A DROPDOWN RATHER THAN ARROWS. A club with five seasons behind it should reach 2023/24 in one tap,
 * not four; and the register's own names -- "2026/27" -- are what a person recognises, never a label
 * assembled from dates.
 *
 * PRE-SEASON APPEARS ONLY WHERE THE REGISTER RECORDS ONE. It is a real phase with real dates for clubs
 * that run it and no phase at all for clubs that do not, so offering it everywhere would be inventing a
 * window. The canonical resolver draws that line; this only renders it.
 */
function SeasonBar({
  seasons,
  selectedId,
  phase,
  hasPreSeason,
  onSeason,
  onPhase,
}: {
  seasons: SeasonRow[]
  selectedId: string | null
  phase: SeasonPhase
  hasPreSeason: boolean
  onSeason: (id: string) => void
  onPhase: (phase: SeasonPhase) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = seasons.find((season) => season.id === selectedId) ?? null

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`Season: ${seasonLabel(selected)}. Choose`}
          onPress={() => setOpen((value) => !value)}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: TOUCH_TARGET - 8,
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            paddingHorizontal: space.md,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colour.lineStrong,
            backgroundColor: colour.surface,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink, flex: 1, fontSize: 13 }]}>
            {seasonLabel(selected)}
          </Text>
          <View style={open ? { transform: [{ rotate: "180deg" }] } : undefined}>
            <ChevronDown size={16} color={colour.inkSubtle} strokeWidth={2.2} />
          </View>
        </Pressable>

        {hasPreSeason && (
          <View style={{ flexDirection: "row", backgroundColor: "rgba(16,21,18,0.05)", borderRadius: radius.md, padding: 3 }}>
            {(["pre", "main"] as const).map((option) => {
              const selectedPhase = option === phase
              return (
                <Pressable
                  key={option}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: selectedPhase }}
                  accessibilityLabel={option === "pre" ? "Pre-season" : "Main season"}
                  onPress={() => onPhase(option)}
                  style={{
                    minHeight: TOUCH_TARGET - 14,
                    paddingHorizontal: space.md,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: radius.sm,
                    backgroundColor: selectedPhase ? colour.surface : "transparent",
                  }}
                >
                  <Text style={[type.smallMedium, { color: selectedPhase ? colour.ink : colour.inkMuted, fontSize: 12 }]}>
                    {option === "pre" ? "Pre" : "Main"}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        )}
      </View>

      {open && (
        <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
          {seasons.map((option, index) => {
            const isSelected = option.id === selectedId
            return (
              <Pressable
                key={option.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={option.name}
                onPress={() => {
                  onSeason(option.id)
                  setOpen(false)
                }}
                style={({ pressed }) => ({
                  minHeight: TOUCH_TARGET,
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: space.md,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: colour.line,
                  backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent",
                })}
              >
                <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>{option.name}</Text>
                {isSelected && <Check size={18} color={colour.forest800} strokeWidth={2.6} />}
              </Pressable>
            )
          })}
        </View>
      )}
    </View>
  )
}

/**
 * Where the sheet lands when the month changes: the first of the month arrived at,
 * or today when that month is this one -- so stepping back to this month returns
 * somebody to the day they actually care about rather than to the 1st.
 */
function monthStartOrToday(anchor: string, today: string): string {
  return anchor.slice(0, 7) === today.slice(0, 7) ? today : startOfMonth(anchor)
}

function Toggle({
  value,
  onChange,
}: {
  value: "month" | "season"
  onChange: (next: "month" | "season") => void
}) {
  return (
    <View
      accessibilityRole="tablist"
      style={{ flexDirection: "row", backgroundColor: "rgba(16,21,18,0.05)", borderRadius: radius.md, padding: 3 }}
    >
      {(["month", "season"] as const).map((option) => {
        const selected = option === value
        return (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option === "month" ? "One month at a time" : "The whole season"}
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
              {option === "month" ? "Month" : "Season"}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function Step({
  label,
  direction,
  onPress,
  disabled,
}: {
  label: string
  direction: "back" | "forward"
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: TOUCH_TARGET,
        height: TOUCH_TARGET,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.28 : pressed ? 0.6 : 1,
      })}
    >
      <View style={direction === "back" ? { transform: [{ rotate: "180deg" }] } : undefined}>
        <ChevronRight size={20} color={colour.forest800} />
      </View>
    </Pressable>
  )
}

/** "1 Aug – 31 Aug 2026" — the window a phase covers, in the form somebody reads rather than two ISO values. */
function rangeLabel(startIso: string, endIso: string): string {
  const start = new Date(`${startIso}T12:00:00`)
  const end = new Date(`${endIso}T12:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return `${startIso} – ${endIso}`
  const sameYear = start.getFullYear() === end.getFullYear()
  return `${start.toLocaleDateString("en-GB", sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" })} – ${end.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
}

/** Six days on from a Monday, so a week's own rows can be cut out of the season's. */
function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00`)
  date.setDate(date.getDate() + days)
  return format(date)
}

/** Keep an anchor inside the season the register describes. No range means no bound, not an open one. */
function clamp(iso: string, range: { start: string; end: string } | null): string {
  if (!range) return iso
  if (iso < range.start) return range.start
  if (iso > range.end) return range.end
  return iso
}


function format(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}
