import { useCallback, useEffect, useMemo, useState } from "react"
import { Modal, Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
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
import { eventAudienceLabel, eventDays, loadClubEvents, type ClubEventItem } from "@ovalball/contracts/agenda/events"
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
import { CalendarHeading, CalendarModeSwitch } from "../../../src/components/calendar/calendar-chrome"
import { MonthGrid } from "../../../src/components/calendar/month-grid"
import { CalendarEmptyDay, EventSheet, ListDayHeading } from "../../../src/components/calendar/event-sheet"
import {
  ParticipantMatchCard,
  ParticipantTrainingCard,
} from "../../../src/components/participant/match-card"
import {
  AgendaFilterSheet,
  NO_FILTER,
  applyFilter,
  countActive,
  type AgendaFilter,
} from "../../../src/components/agenda-filter"
import { CalendarDays, Check, ChevronDown, ChevronRight, SlidersHorizontal, X } from "../../../src/components/icons"
import { CardSkeleton, EmptyState, ErrorState } from "../../../src/components/ui"
import { TOUCH_TARGET, colour, onForest, radius, space, surface, type } from "../../../src/design/tokens"

/**
 * CALENDAR — one surface, not five panels.
 *
 * WHAT THIS REPLACED. A white header, a white season dropdown, a white Pre/Main
 * bar, a white Week/Month/Season selector and then, finally, a green calendar --
 * five unrelated rectangles stacked down one screen, which is precisely what makes
 * a product look like an administration tool rather than something a parent opens
 * on a Saturday morning. The owner's reference fixed the diagnosis: forest runs
 * from behind the status bar down through the month, and a chalk sheet rises over
 * it carrying the day's rugby. Nothing else is in the top half.
 *
 * THE SETTINGS DID NOT GO, THEY STOPPED BEING FURNITURE. A control a parent never
 * changes during ordinary use has no business holding permanent screen space, so
 * the season and its phase moved into a compact chip beside the month -- and for a
 * FAMILY context they are not offered at all, because "pre-season or main season"
 * is a planning distinction a club makes and a parent has no use for. Season
 * OVERVIEW, the shape of a whole year, is still there for the people who plan one.
 *
 * TWO WAYS TO READ THE SAME ROWS. Month is the grid with a day beneath it; List is
 * the same canonical agenda in a row, grouped by day. Presentation only -- one
 * read, one model, one set of rows narrowed by the one family filter. A toggle
 * that fetched differently would be two calendars wearing one name.
 *
 * AND IT REMAINS READ-ONLY. There is no create, no edit, no drag, no reschedule and
 * no mutation imported anywhere in this file. An event card is an entrance to the
 * Match Centre or the Training Centre -- decided once, in src/links/destinations --
 * and never to administration.
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
  const [mode, setMode] = useState<"month" | "list" | "season">("month")
  const [anchor, setAnchor] = useState(today)
  const [items, setItems] = useState<AgendaItem[] | null>(null)
  // CLUB EVENTS (CA-M10): the club's own calendar entries beside fixtures and training, in a club context,
  // read under their own row rule. A separate shape, never a fake fixture.
  const [events, setEvents] = useState<ClubEventItem[]>([])
  const [label, setLabel] = useState("")
  const [problem, setProblem] = useState<{ message: string; offline: boolean } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [filter, setFilter] = useState<AgendaFilter>(NO_FILTER)
  const [filterOpen, setFilterOpen] = useState(false)
  /** The season chip's sheet. Not on the screen, because it is not a daily decision. */
  const [seasonOpen, setSeasonOpen] = useState(false)
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
      if (active.kind === "club" && (active.clubId ?? active.id)) {
        const range = mode === "season" && season.range ? season.range : { start: grid[0].iso, end: grid[grid.length - 1].iso }
        setEvents(await loadClubEvents(supabase, [(active.clubId ?? active.id) as string], { startIso: range.start, endIso: range.end }).catch(() => []))
      } else {
        setEvents([])
      }
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
    /*
      MONTH SHOWS ONE DAY; LIST SHOWS THEM ALL, grouped, from today onwards -- the
      same rows either way, which is what makes the toggle presentation rather than
      a second product. Season keeps its own grid.
    */
    const grouped = mode === "month" ? groupByDay(rows.filter((item) => item.date === openDay)) : groupByDay(rows.filter((item) => item.date >= today))
    // A day with only a club event on it is still a day with something on it.
    const eventDayKeys = new Set(events.flatMap((e) => eventDays(e, "0000-01-01", "9999-12-31")))
    const wanted = mode === "month" ? [openDay].filter((d) => eventDayKeys.has(d)) : [...eventDayKeys].filter((d) => d >= today)
    for (const date of wanted) if (!grouped.some((d) => d.date === date)) grouped.push({ date, items: [] })
    return grouped.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  }, [shown, mode, openDay, today, events])
  const eventsOn = useCallback((date: string) => events.filter((e) => e.startsOn <= date && e.endsOn >= date), [events])
  // ONE MATCH, EVERY CHILD IN IT (CA-M9): a family reading all its children sees one card per event with
  // a strip per child, never the same match twice.
  const familyReading = active !== null && isFamilyFacingContext(active.kind) && selectedPlayerId === null
  const siblingsFor = useCallback(
    (item: AgendaItem, dayItems: AgendaItem[]) =>
      familyReading
        ? dayItems
            .filter((other) => other.kind === item.kind && other.eventId === item.eventId && other.playerId)
            .map((other) => ({ member: memberFor(projection, other.playerId)!, attendance: other.attendance }))
            .filter((s) => s.member)
        : undefined,
    [familyReading, projection]
  )
  const collapse = useCallback(
    (dayItems: AgendaItem[]) => {
      if (!familyReading) return dayItems
      const seen = new Set<string>()
      return dayItems.filter((item) => {
        const key = `${item.kind}:${item.eventId}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    },
    [familyReading]
  )
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

  const family = active !== null && isFamilyFacingContext(active.kind)
  /*
    THE SEASON CHIP IS FOR PEOPLE WHO PLAN A SEASON.

    A club with a history can look back at last year's rugby, and a club that runs
    a pre-season can look at it. A PARENT does neither: "pre-season or main season"
    is a distinction a club makes for its own planning, and a guardian checking
    Saturday has no use for it. So the whole control -- the season, its phase and
    the season overview -- is offered only outside a family context, and even there
    it is a chip beside the month rather than two bars above it.
  */
  const offerSeason = !family && seasons.length > 1

  const sheetHeading =
    mode === "list"
      ? monthLabel(anchor)
      : `${dayLabel(openDay, today)}${restOfDate(openDay, today) ? ` · ${restOfDate(openDay, today)}` : ""}`

  return (
    <View style={{ flex: 1, backgroundColor: surface.forest }}>
      {/* ============================================================
            ONE FOREST SURFACE, from behind the status bar to the sheet.

            The header is the same P1 header -- the same identity, the same three
            utilities, the same badges from the same canonical read -- standing on
            forest instead of chalk, with no white card behind it and no rule under
            it, because it runs straight into more of its own ground.
         ============================================================ */}
      <AppHeader onOpenContexts={() => setSheetOpen(true)} tone="forest" bottomRule={false} />

      <View style={{ paddingTop: space.md, gap: space.md, paddingBottom: space.lg }}>
        <CalendarHeading
          anchor={anchor}
          onStep={(direction) =>
            setAnchor(clamp(direction === -1 ? previousAnchor("month", anchor) : nextAnchor("month", anchor), season.range))
          }
          trailing={
            offerSeason ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Season, ${seasonLabel(season.selected)}${season.phase === "pre" ? ", pre-season" : ""}. Change it`}
                onPress={() => setSeasonOpen(true)}
                hitSlop={8}
                style={({ pressed }) => ({
                  minHeight: 34,
                  justifyContent: "center",
                  paddingHorizontal: space.md,
                  borderRadius: radius.pill,
                  backgroundColor: surface.forestRaised,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text style={[type.caption, { color: onForest.secondary }]}>
                  {seasonLabel(season.selected)}
                  {season.phase === "pre" ? " · Pre" : ""}
                </Text>
              </Pressable>
            ) : undefined
          }
        />

        {/* TWO WAYS TO READ ONE SET OF ROWS. Presentation only. */}
        <CalendarModeSwitch
          value={mode}
          onChange={setMode}
          options={[
            { key: "month" as const, label: "Month", hint: "The month, with a day at a time beneath it" },
            { key: "list" as const, label: "List", hint: "Everything coming up, in order" },
            ...(offerSeason ? [{ key: "season" as const, label: "Season", hint: "The whole season at once" }] : []),
          ]}
        />

        {mode === "month" && (
          <MonthGrid anchor={anchor} today={today} selected={openDay} marks={marks} onSelect={setOpenDay} />
        )}

        {/* The family chips sit on the forest, above the sheet, where a guardian
            of two looks first: whose week am I reading, before any of it is read. */}
        <ChildFilter style={{ paddingHorizontal: space.lg }} tone="forest" />
      </View>

      {/* ============================================================
            THE CHALK SHEET.
         ============================================================ */}
      <EventSheet heading={sheetHeading} count={mode === "month" ? (days[0]?.items.length ?? 0) : undefined}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl, paddingTop: space.xs, gap: space.sm }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colour.forest800} />}
          showsVerticalScrollIndicator={false}
        >
          {problem && !shown && (
            <View style={{ paddingHorizontal: space.lg }}>
              <ErrorState message={problem.message} offline={problem.offline} onRetry={load} />
            </View>
          )}

          {/* STALE RATHER THAN BLANK, and said out loud rather than presented as
              current. An out-of-date kick-off looks like a fact. */}
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

          {/* ONE CARD PER EVENT, and the SAME card in Month and in List -- two ways
              of reading, never two products. */}
          {mode !== "season" &&
            days.map((day) => (
              <View key={day.date} style={{ gap: space.sm }}>
                {mode === "list" && <ListDayHeading label={`${dayLabel(day.date, today)} · ${restOfDate(day.date, today)}`} />}
                {/* ONE PREMIUM CARD PER EVENT, never a "+2 more" link: a day with a
                    match and two sessions is three things to be at, and each of them
                    names its own child. The sheet scrolls. */}
                {eventsOn(day.date).map((event) => (
                  <ClubEventCard key={event.key} event={event} onPress={() => router.push({ pathname: "/calendar/event/[eventId]", params: { eventId: event.eventId } } as never)} />
                ))}
                {collapse(day.items).map((item) =>
                  item.kind === "training" ? (
                    <ParticipantTrainingCard
                      key={item.key}
                      item={item}
                      family={projection}
                      siblings={siblingsFor(item, day.items)}
                      onPress={() => openEvent(item)}
                    />
                  ) : (
                    <ParticipantMatchCard
                      key={item.key}
                      item={item}
                      family={projection}
                      density="compact"
                      siblings={siblingsFor(item, day.items)}
                      onPress={() => openEvent(item)}
                    />
                  )
                )}
              </View>
            ))}

          {mode !== "season" && days.length === 0 && !!shown && !problem && (
            <CalendarEmptyDay
              body={
                countActive(filter) > 0
                  ? "Nothing matches that filter. Clear it to see the rest."
                  : mode === "list"
                    ? "No rugby scheduled in this period."
                    : "No rugby scheduled for this day."
              }
              action={
                mode === "month" && nextBusyDay && countActive(filter) === 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Go to ${dayLabel(nextBusyDay, today)}`}
                    onPress={() => setOpenDay(nextBusyDay)}
                    style={({ pressed }) => ({
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
                ) : undefined
              }
            />
          )}

          {season.configBroken && mode === "season" && (
            <Text accessibilityRole="alert" style={[type.caption, { color: colour.warning, paddingHorizontal: space.lg }]}>
              This season&apos;s dates are incomplete in Site Admin, so the period cannot be shown.
            </Text>
          )}
        </ScrollView>
      </EventSheet>

      {/* THE FILTER, THE SEASON AND THE WEEK all open as sheets rather than living
          on the screen -- which is the difference between a calendar and a form. */}
      <AgendaFilterSheet
        visible={filterOpen}
        items={items ?? []}
        filter={filter}
        showTraining
        onChange={setFilter}
        onClose={() => setFilterOpen(false)}
        familyScope={family}
      />

      <SeasonSheet
        visible={seasonOpen}
        seasons={seasons}
        selectedId={season.selected?.id ?? null}
        phase={season.phase}
        hasPreSeason={Boolean(season.selected?.preSeasonStartsOn)}
        onClose={() => setSeasonOpen(false)}
        onSeason={(id: string) => {
          setSeasonId(id)
          const picked = seasons.find((option) => option.id === id)
          if (picked) setAnchor(picked.startsOn > today || picked.endsOn < today ? picked.startsOn : today)
        }}
        onPhase={(next: SeasonPhase) => {
          setPhase(next)
          const picked = seasons.find((option) => option.id === (season.selected?.id ?? ""))
          if (!picked) return
          const start = next === "pre" ? picked.preSeasonStartsOn : picked.startsOn
          if (start) setAnchor(start)
        }}
      />

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
 * THE SEASON, AS A SHEET RATHER THAN AS FURNITURE.
 *
 * WHAT THIS REPLACED. Two full-width white bars living permanently above the
 * calendar -- a season dropdown and a Pre/Main segmented control -- which between
 * them took about a fifth of the screen to hold two settings almost nobody changes
 * twice in a session. The functionality is identical; it now opens from a chip
 * beside the month and closes again.
 *
 * AND IT IS NOT OFFERED TO A FAMILY AT ALL. "Pre-season or main season" is a
 * distinction a club draws for its own planning. A guardian checking whether
 * Saturday is on has no use for it, and a control that cannot help somebody is
 * worse than an absent one.
 *
 * THE SEASONS ARE THE CANONICAL REGISTER'S. Site Admin's `public.seasons` rows,
 * scoped to this club's own rugby code -- never a year computed from a date, and
 * never a second answer to "which season is this".
 */
function SeasonSheet({
  visible,
  seasons,
  selectedId,
  phase,
  hasPreSeason,
  onClose,
  onSeason,
  onPhase,
}: {
  visible: boolean
  seasons: SeasonRow[]
  selectedId: string | null
  phase: SeasonPhase
  hasPreSeason: boolean
  onClose: () => void
  onSeason: (id: string) => void
  onPhase: (phase: SeasonPhase) => void
}) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.5)" }}
      />
      <View
        style={{
          backgroundColor: colour.chalk,
          borderTopLeftRadius: 26,
          borderTopRightRadius: 26,
          paddingTop: space.sm,
          paddingBottom: insets.bottom + space.lg,
        }}
      >
        <View style={{ alignSelf: "center", width: 38, height: 4, borderRadius: 2, backgroundColor: colour.line }} />
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingVertical: space.md }}>
          <Text accessibilityRole="header" style={[type.heading, { color: colour.ink, flex: 1 }]}>
            Season
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8}>
            <X size={22} color={colour.ink} strokeWidth={2.2} />
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
          {seasons.map((season) => {
            const selected = season.id === selectedId
            return (
              <Pressable
                key={season.id}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={seasonLabel(season)}
                onPress={() => {
                  onSeason(season.id)
                  onClose()
                }}
                style={({ pressed }) => ({
                  minHeight: TOUCH_TARGET,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                  paddingHorizontal: space.lg,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: selected ? colour.forest800 : colour.line,
                  backgroundColor: pressed ? colour.chalk : colour.surface,
                })}
              >
                <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>{seasonLabel(season)}</Text>
                {selected && <Check size={18} color={colour.forest800} strokeWidth={2.4} />}
              </Pressable>
            )
          })}

          {/* PRE-SEASON ONLY WHERE THE REGISTER HAS ONE. A club that records no
              pre-season is not offered an empty one. */}
          {hasPreSeason && (
            <View style={{ marginTop: space.sm, gap: space.sm }}>
              <Text style={[type.overline, { color: colour.inkMuted }]}>PERIOD</Text>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                {(["main", "pre"] as const).map((option) => {
                  const selected = option === phase
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={option === "pre" ? "Pre-season" : "Main season"}
                      onPress={() => {
                        onPhase(option)
                        onClose()
                      }}
                      style={({ pressed }) => ({
                        flex: 1,
                        minHeight: TOUCH_TARGET,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: radius.md,
                        borderWidth: 1,
                        borderColor: selected ? colour.forest800 : colour.line,
                        backgroundColor: selected ? colour.forest800 : pressed ? colour.chalk : colour.surface,
                      })}
                    >
                      <Text style={[type.smallMedium, { color: selected ? colour.onForest : colour.ink }]}>
                        {option === "pre" ? "Pre-season" : "Main season"}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
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

/**
 * A CLUB EVENT CARD: the third kind of thing on a club's calendar, with its own amber accent -- neither a
 * match's green nor training's blue -- naming what it is, whom it is for and where.
 */
function ClubEventCard({ event, onPress }: { event: ClubEventItem; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Club event: ${event.name}, ${eventAudienceLabel(event)}${event.startTime ? `, ${event.startTime}` : ", all day"}${event.where ? `, ${event.where}` : ""}${event.cancelled ? ". Cancelled" : ""}`}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden", opacity: pressed ? 0.94 : event.cancelled ? 0.62 : 1 })}
    >
      <View style={{ width: 4, backgroundColor: colour.warning }} />
      <View style={{ flex: 1, padding: space.lg, gap: 4 }}>
        <Text style={[type.caption, { color: colour.warning, letterSpacing: 0.8, fontFamily: "Inter_600SemiBold" }]}>CLUB EVENT</Text>
        <Text numberOfLines={2} style={[type.bodyMedium, { color: colour.ink, fontSize: 15, textDecorationLine: event.cancelled ? "line-through" : "none" }]}>{event.name}</Text>
        <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>{[event.startTime ? `${event.startTime}${event.endTime ? `–${event.endTime}` : ""}` : "All day", eventAudienceLabel(event), event.where].filter(Boolean).join(" · ")}</Text>
      </View>
    </Pressable>
  )
}
