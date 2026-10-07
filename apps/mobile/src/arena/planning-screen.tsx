import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router"
import DateTimePicker from "@react-native-community/datetimepicker"

import {
  ARENA_FILTERS,
  filterActivities,
  filterCounts,
  needsAllocationAt,
  readArenaDay,
  readArenaRange,
  toMinutes,
  type ArenaActivity,
  type ArenaDay,
  type ArenaFilter,
  type ArenaRange,
} from "@ovalball/contracts/arena"

import { useAdminCentreAccess } from "../admin/access"
import { useReduceMotion } from "../a11y/reduce-motion"
import { supabase } from "../auth/supabase"
import { OvalballDetailHeader } from "../components/app-header"
import { Button, CardSkeleton, EmptyState, ErrorState } from "../components/ui"
import { CircleCheck, Maximize2, Settings, Sparkles } from "../components/icons"
import { TOUCH_TARGET, colour, radius, space, surface, type } from "../design/tokens"
import { friendly, logDetail } from "../errors/translate"
import type { BoardScale } from "../pitch-allocation/geometry"
import { Sheet } from "../pitch-allocation/sheets"
import { todayIso } from "../pitch-allocation/model"
import { MonthView, WeekView } from "./calendar-views"
import { ActivityList, CateringView, NeedsAllocation, ReadinessCard } from "./day-views"
import { openActivity } from "./navigation"
import { AllocationSheet } from "./planner/allocation-sheet"
import { PitchBoard } from "./planner/pitch-board"
import type { Allocatable } from "./planner/plan"
import { PlanBar, UnsavedSheet } from "./planner/plan-bar"
import { PLANNING_MODES, PlanningToolbar, type DayView, type PlanningMode } from "./planner/planning-toolbar"
import { RoomBoard } from "./planner/room-board"
import { SCENARIOS, isScenario, sampleAutoAllocate, scenarioDay, type ScenarioKey } from "./planner/scenarios"
import { useDayPlanner } from "./planner/use-day-planner"
import { ActivitySheet, AttentionSheet, AutoPlanSheet } from "./sheets"
import { addDays, longDate, monthEnd, monthStart, monthTitle, shortDate, weekStart, weekdayShort } from "./style"

const isIso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)

/**
 * ARENA PLANNING -- the club's physical operations board: WHERE AND WHEN.
 *
 * One day is one read (get_arena_day) and one plan. The Pitches board, the Changing Rooms board, the List
 * and the Allocate sheet are four ways of looking at the same day, and every change made in any of them --
 * a drag, a tap, Auto Allocate's proposal -- is staged in the one plan (useDayPlanner) and saved together
 * as one transaction the server checks with its own rules. Week and Month are for finding the day; the
 * venue chosen here filters every view of it alike.
 */
export function ArenaPlanningScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const params = useLocalSearchParams<{ date?: string; mode?: string; view?: string; stress?: string; scenario?: string }>()
  // DEVELOPMENT ONLY: a planning day made up in memory (`?scenario=thursday`, or `?stress=1` for the large club), to
  // prove the board against the days a club really has without touching a real allocation. Never in a release build.
  const scenarioKey: ScenarioKey | null = __DEV__ ? (params.stress === "1" ? "large" : isScenario(params.scenario) ? params.scenario : null) : null
  const sample = scenarioKey !== null
  const { clubId } = useAdminCentreAccess()
  const reduceMotion = useReduceMotion()
  const [mode, setMode] = useState<PlanningMode>(params.mode === "week" || params.mode === "month" ? params.mode : "day")
  const [date, setDate] = useState<string>(isIso(params.date) ? params.date : todayIso())
  const [venueId, setVenueId] = useState<string | null>(null)
  const [filter, setFilter] = useState<ArenaFilter>("ALL")
  const [dayView, setDayView] = useState<DayView>(params.view === "list" || params.view === "catering" || params.view === "rooms" ? params.view : "pitches")
  const [day, setDay] = useState<ArenaDay | null>(null)
  const [range, setRange] = useState<ArenaRange | null>(null)
  const [problem, setProblem] = useState<{ message: string; forbidden: boolean } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [scale, setScale] = useState<BoardScale>("comfortable")
  const [fullScreen, setFullScreen] = useState(false)
  const [guard, setGuard] = useState<(() => void) | null>(null)
  // Sheets
  const [selected, setSelected] = useState<ArenaActivity | null>(null)
  const [allocating, setAllocating] = useState<{ activity: Allocatable; pitchId?: string } | null>(null)
  const [review, setReview] = useState(false)
  const [autoAsk, setAutoAsk] = useState<{ rerun: boolean } | null>(null)
  const [attention, setAttention] = useState(false)
  const [venuePicker, setVenuePicker] = useState(false)
  const [datePicker, setDatePicker] = useState(false)
  const [modePicker, setModePicker] = useState(false)
  const [focus, setFocus] = useState<{ key: string; seq: number } | null>(null)
  const autoOfferedFor = useRef<string | null>(null)
  // A link that arrives while Planning is already open (a notification, Arena Home) moves it to that day and view.
  const linked = useRef(`${params.date ?? ""}|${params.mode ?? ""}|${params.view ?? ""}`)

  const loadDay = useCallback(async () => {
    if (!clubId) return
    setProblem(null)
    try {
      const real = await readArenaDay(supabase, clubId, date)
      setDay(scenarioKey ? scenarioDay(real, scenarioKey) : real)
    } catch (cause) {
      const failure = friendly(cause, "this day")
      logDetail("arena day", failure)
      const code = typeof cause === "object" && cause && "code" in cause ? String((cause as { code: unknown }).code) : ""
      setProblem({ message: failure.message, forbidden: code === "42501" })
    }
  }, [clubId, date, scenarioKey])

  const loadRange = useCallback(async () => {
    if (!clubId) return
    setProblem(null)
    const from = mode === "week" ? weekStart(date) : monthStart(date)
    const until = mode === "week" ? addDays(weekStart(date), 6) : monthEnd(date)
    try {
      setRange(await readArenaRange(supabase, clubId, from, until))
    } catch (cause) {
      const failure = friendly(cause, mode === "week" ? "this week" : "this month")
      logDetail("arena range", failure)
      const code = typeof cause === "object" && cause && "code" in cause ? String((cause as { code: unknown }).code) : ""
      setProblem({ message: failure.message, forbidden: code === "42501" })
    }
  }, [clubId, date, mode])

  // THE DAY'S ONE PLAN. Saving reads the day again before the plan is cleared, so nothing jumps back.
  const samplePreview = useMemo(() => (sample ? { preview: sampleAutoAllocate } : null), [sample])
  const planner = useDayPlanner({ clubId, day, sample: samplePreview, onSaved: async (message) => { setNotice(message); await loadDay() } })
  const dirty = planner.counts.total > 0

  const load = useCallback(async () => {
    if (mode === "week" || mode === "month") await loadRange()
    else await loadDay()
  }, [mode, loadDay, loadRange])

  // Opening the screen, coming back to it, or another date or view: read again -- unless there are unsaved
  // changes, which are never read over.
  useFocusEffect(useCallback(() => { if (!dirty) void load() }, [load, dirty]))
  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(id)
  }, [notice])

  // LEAVING WITH UNSAVED CHANGES asks first: Save, Discard or Keep Editing.
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (event) => {
      if (!dirty) return
      event.preventDefault()
      setGuard(() => () => navigation.dispatch(event.data.action))
    })
    return unsubscribe
  }, [navigation, dirty])
  // Another day is another plan: changing the date waits for this one to be saved or discarded.
  const guarded = useCallback((action: () => void) => {
    if (dirty) setGuard(() => action)
    else action()
  }, [dirty])
  useEffect(() => {
    const key = `${params.date ?? ""}|${params.mode ?? ""}|${params.view ?? ""}`
    if (key === linked.current) return
    linked.current = key
    guarded(() => {
      if (isIso(params.date)) setDate(params.date)
      if (params.mode === "day" || params.mode === "week" || params.mode === "month") setMode(params.mode)
      if (params.view === "pitches" || params.view === "rooms" || params.view === "list" || params.view === "catering") setDayView(params.view)
    })
  }, [params.date, params.mode, params.view, guarded])

  // AUTO ALLOCATE puts its proposal on the board. It works from what is saved, so a person's own unsaved
  // changes are saved first rather than planned around blind.
  const startAuto = useCallback((rerun: boolean) => {
    if (planner.counts.manual > 0) { setAutoAsk({ rerun }); return }
    // The proposal is laid on both boards: from the List or Catering it is shown on the Pitches board.
    setDayView((v) => (v === "rooms" ? v : "pitches"))
    void planner.runAuto(venueId, rerun)
  }, [planner, venueId])

  // THE CLUB'S OWN SETTING: a day with gaps opens with Auto Allocate's proposal already on the board -- once per day.
  useEffect(() => {
    if (!day || mode !== "day" || !day.canManage || !day.policy.autoAllocateHomeFixtures) return
    if (day.readiness.needsAllocation === 0 || autoOfferedFor.current === day.date) return
    autoOfferedFor.current = day.date
    if (planner.counts.total === 0) void planner.runAuto(venueId, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per day as it opens
  }, [day, mode])

  const counts = useMemo(() => (day ? filterCounts(day, venueId) : null), [day, venueId])
  const listed = useMemo(() => (day ? filterActivities(day, filter, venueId) : []), [day, filter, venueId])
  const venueName = venueId ? day?.venues.find((v) => v.id === venueId)?.name ?? "Venue" : "All Venues"
  const needsHere = useMemo(() => (day ? needsAllocationAt(day, venueId).length : 0), [day, venueId])
  const allocatableHere = useMemo(() => (day ? filterActivities(day, "ALL", venueId).filter((a) => (a.kind === "FIXTURE" && a.home) || a.kind === "TRAINING").length : 0), [day, venueId])
  const canManage = day?.canManage ?? range?.canManage ?? false
  const now = new Date()
  const nowMinute = date === todayIso() ? toMinutes(`${now.getHours()}:${now.getMinutes()}`) : null

  const step = (direction: 1 | -1) => {
    if (mode === "week") guarded(() => setDate(addDays(date, 7 * direction)))
    else if (mode === "month") guarded(() => setDate(direction === 1 ? addDays(monthEnd(date), 1) : monthStart(addDays(monthStart(date), -1))))
    else guarded(() => setDate(addDays(date, direction)))
  }
  const dateLabel = mode === "week" ? `Week of ${shortDate(weekStart(date))}` : mode === "month" ? monthTitle(date) : `${date === todayIso() ? "Today · " : ""}${weekdayShort(date)} ${shortDate(date)}`
  const dateSpoken = mode === "week" ? `Week of ${longDate(weekStart(date))}` : mode === "month" ? monthTitle(date) : longDate(date)
  const openDay = (d: string) => guarded(() => { setDate(d); setMode("day") })
  // The canonical centre that owns a time Arena may not move: the fixture, the training session, the event.
  const openCentre = (a: ArenaActivity) => { if (!sample) openActivity(router, a) }
  const allocate = (a: Allocatable, pitchId?: string) => { setSelected(null); setAttention(false); setReview(false); setAllocating({ activity: a, pitchId }) }
  const save = async () => { await planner.save() }

  return (
    <View style={{ flex: 1, backgroundColor: surface.page }}>
      <OvalballDetailHeader
        title="Arena Planning"
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/admin/arena" as never))}
        rightAction={canManage ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Arena settings" onPress={() => router.push("/admin/arena/settings" as never)} hitSlop={6}
            style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: pressed ? "rgba(255,255,255,0.12)" : "transparent" })}>
            <Settings size={20} color={colour.onForest} />
          </Pressable>
        ) : undefined}
      />

      {!fullScreen && (
        <PlanningToolbar
          mode={mode}
          dateLabel={dateLabel}
          dateSpoken={dateSpoken}
          prevLabel={mode === "week" ? "Previous week" : mode === "month" ? "Previous month" : "Previous day"}
          nextLabel={mode === "week" ? "Next week" : mode === "month" ? "Next month" : "Next day"}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onPickDate={() => setDatePicker(true)}
          showVenue={(day?.venues.length ?? 0) > 1}
          venueName={venueName}
          onPickVenue={() => setVenuePicker(true)}
          onPickMode={() => setModePicker(true)}
          dayView={dayView}
          onDayView={setDayView}
        />
      )}
      {sample && (
        <View style={{ paddingVertical: 4, paddingHorizontal: space.md, backgroundColor: colour.warningSurface }}>
          <Text style={[type.caption, { color: colour.warning, fontFamily: type.smallMedium.fontFamily }]}>{`Sample day: ${SCENARIOS.find((x) => x.key === scenarioKey)?.title ?? "made up"}. Nothing here is real or can be saved.`}</Text>
        </View>
      )}
      {notice && (
        <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: space.md, backgroundColor: colour.mint100 }}>
          <CircleCheck size={14} color={colour.forest800} />
          <Text style={[type.caption, { color: colour.forest800, flex: 1 }]}>{notice}</Text>
        </View>
      )}

      {problem && (
        <View style={{ padding: space.lg }}>
          {problem.forbidden
            ? <EmptyState title="Arena is for the people who plan the club's facilities" body="Planning pitches and changing rooms is given to specific people by the club." />
            : <ErrorState message={problem.message} onRetry={() => void load()} />}
        </View>
      )}

      {!problem && mode === "day" && !day && <View style={{ padding: space.lg }}><CardSkeleton lines={4} /></View>}
      {!problem && mode !== "day" && !range && <View style={{ padding: space.lg }}><CardSkeleton lines={6} /></View>}

      {/* DAY · PITCHES: the board, with what is waiting at its foot */}
      {!problem && mode === "day" && day && dayView === "pitches" && (
        <PitchBoard
          day={day}
          planner={planner}
          venueId={venueId}
          canManage={day.canManage}
          reduceMotion={reduceMotion}
          nowMinute={nowMinute}
          scale={scale}
          onOpen={setSelected}
          onOpenCentre={openCentre}
          onAllocate={(a) => allocate(a)}
          onAuto={(rerun) => startAuto(rerun)}
          autoBusy={planner.auto.state === "calculating"}
          fullScreen={fullScreen}
          focus={focus}
          onToggleScale={() => setScale((v) => (v === "comfortable" ? "compact" : "comfortable"))}
          onLeaveFullScreen={() => setFullScreen(false)}
        />
      )}

      {/* DAY · LIST and CATERING */}
      {!problem && mode === "day" && day && (dayView === "list" || dayView === "catering") && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.md, gap: space.md, paddingBottom: space.xxl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { if (dirty) return; setRefreshing(true); await loadDay(); setRefreshing(false) }} />}>
          <ReadinessCard day={day} canManage={day.canManage} allVenues={venueId !== null} needsHere={needsHere} allocatableHere={allocatableHere} onAutoAllocate={() => startAuto(false)} onRerun={() => startAuto(true)} onAttention={() => setAttention(true)} />
          {dayView === "list" && (
            <>
              <NeedsAllocation day={day} venueId={venueId} canManage={day.canManage} onAllocate={(a) => allocate(a)} onOpen={setSelected} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs }}>
                {ARENA_FILTERS.map((f) => {
                  const on = filter === f.key
                  const n = counts?.[f.key] ?? 0
                  return (
                    <Pressable key={f.key} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${f.label}, ${n}`} onPress={() => setFilter(f.key)}
                      style={({ pressed }) => ({ minHeight: 36, paddingHorizontal: space.md, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: on ? colour.pitch600 : colour.lineStrong, backgroundColor: on ? colour.mint100 : colour.surface, opacity: pressed ? 0.8 : 1 })}>
                      <Text style={[type.smallMedium, { color: f.key === "UNALLOCATED" && n > 0 ? colour.warning : colour.forest800 }]}>{`${f.label} (${n})`}</Text>
                    </Pressable>
                  )
                })}
              </ScrollView>
              {day.readiness.activities === 0 ? (
                <EmptyState title="No activity this day" body="Nothing is using the club's facilities on this day." />
              ) : (
                <ActivityList day={day} activities={listed} onOpen={setSelected} />
              )}
              {listed.length > 0 && needsHere === 0 && day.readiness.pitchConflicts + day.readiness.roomConflicts === 0 && (
                <View style={{ flexDirection: "row", gap: space.xs, alignItems: "center" }}>
                  <CircleCheck size={16} color={colour.forest800} />
                  <Text style={[type.caption, { color: colour.forest800, flex: 1 }]}>All allocated: everything has a venue, a pitch and the changing rooms it needs.</Text>
                </View>
              )}
            </>
          )}
          {dayView === "catering" && <CateringView day={day} onOpen={setSelected} />}
        </ScrollView>
      )}

      {/* DAY · CHANGING ROOMS: the same day and the same plan, seen by room -- who is in each, as what, and what
          still needs one. */}
      {!problem && mode === "day" && day && dayView === "rooms" && (
        <RoomBoard
          day={day}
          planner={planner}
          venueId={venueId}
          canManage={day.canManage}
          reduceMotion={reduceMotion}
          nowMinute={nowMinute}
          scale={scale}
          onOpen={setSelected}
          onAllocate={(a) => allocate(a)}
          onAuto={(rerun) => startAuto(rerun)}
          autoBusy={planner.auto.state === "calculating"}
        />
      )}

      {!problem && mode !== "day" && range && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.md, gap: space.md, paddingBottom: space.xxl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadRange(); setRefreshing(false) }} />}>
          {mode === "week"
            ? <WeekView days={range.days} today={todayIso()} onOpenDay={openDay} />
            : <MonthView days={range.days} monthOf={date} today={todayIso()} onOpenDay={openDay} />}
        </ScrollView>
      )}

      {/* UNSAVED: one bar for the whole day, whichever view made the change -- still there over Week or Month */}
      {day && <PlanBar planner={planner} day={day} onSave={() => void save()} onReview={() => setReview(true)} onRerun={() => startAuto(true)}
        onShow={(key) => { setDayView((v) => (v === "rooms" ? v : "pitches")); setFocus((f) => ({ key, seq: (f?.seq ?? 0) + 1 })) }} />}

      {/* ===================================================== sheets */}
      {day && (
        <>
          <ActivitySheet
            day={day}
            activity={selected}
            canManage={day.canManage}
            canLock={day.canManage && !sample}
            planner={planner}
            onClose={() => setSelected(null)}
            onAllocate={(a) => allocate(a)}
            onOpen={(a) => { setSelected(null); openCentre(a) }}
            onLocked={(message) => { setSelected(null); setNotice(message); void loadDay() }}
          />
          <AllocationSheet
            day={day}
            planner={planner}
            activity={allocating?.activity ?? null}
            preferPitchId={allocating?.pitchId ?? null}
            onClose={() => setAllocating(null)}
            onStaged={(message) => { setAllocating(null); setNotice(message) }}
          />
          <AutoPlanSheet
            preview={planner.auto.state === "proposed" ? planner.auto.preview : null}
            planner={planner}
            visible={review}
            onClose={() => setReview(false)}
            onAllocate={(id, kind) => { const a = day.activities.find((x) => x.id === id && x.kind === kind) as Allocatable | undefined; if (a) allocate(a) }}
            onApply={() => { setReview(false); void save() }}
            onRerun={() => { setReview(false); startAuto(true) }}
          />
          <AttentionSheet day={day} visible={attention} canManage={day.canManage} onClose={() => setAttention(false)}
            onAllocate={(a) => allocate(a)}
            onOpen={(a) => { setAttention(false); setSelected(a) }} />
          <Sheet visible={venuePicker} onClose={() => setVenuePicker(false)} title="Choose a Venue">
            <View style={{ gap: space.xs }}>
              {[{ id: null as string | null, name: "All Venues" }, ...day.venues.map((v) => ({ id: v.id as string | null, name: v.name }))].map((v) => (
                <Pressable key={v.id ?? "all"} accessibilityRole="radio" accessibilityState={{ selected: venueId === v.id }} accessibilityLabel={v.name}
                  onPress={() => { setVenueId(v.id); setVenuePicker(false) }}
                  style={({ pressed }) => ({ minHeight: TOUCH_TARGET, paddingHorizontal: space.md, justifyContent: "center", borderRadius: radius.md, borderWidth: venueId === v.id ? 2 : 1, borderColor: venueId === v.id ? colour.pitch600 : colour.line, opacity: pressed ? 0.8 : 1 })}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>{v.name}</Text>
                </Pressable>
              ))}
              <Text style={[type.caption, { color: colour.inkMuted, marginTop: space.xs }]}>The venue applies to every view of the day: the pitches, the changing rooms, the list and what is waiting.</Text>
            </View>
          </Sheet>
        </>
      )}
      <Sheet visible={modePicker} onClose={() => setModePicker(false)} title="View">
        <View style={{ gap: space.xs }}>
          {PLANNING_MODES.map((m) => (
            <Pressable key={m.key} accessibilityRole="radio" accessibilityState={{ selected: mode === m.key }} accessibilityLabel={m.label}
              onPress={() => { setModePicker(false); if (m.key !== mode) guarded(() => setMode(m.key)) }}
              style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 4, paddingHorizontal: space.md, justifyContent: "center", borderRadius: radius.md, borderWidth: mode === m.key ? 2 : 1, borderColor: mode === m.key ? colour.pitch600 : colour.line, backgroundColor: mode === m.key ? "rgba(220,247,229,0.5)" : colour.surface, opacity: pressed ? 0.85 : 1 })}>
              <Text style={[type.bodyMedium, { color: colour.ink }]}>{m.label}</Text>
              <Text style={[type.caption, { color: colour.inkMuted }]}>{m.key === "day" ? "Plan pitches and changing rooms" : m.key === "week" ? "The week at a glance" : "What is on, and what needs attention, each day"}</Text>
            </Pressable>
          ))}
          {mode === "day" && dayView === "pitches" && (
            <Button variant="secondary" label="Full Screen Board" icon={<Maximize2 size={16} color={colour.ink} />} accessibilityHint="Hides the date, venue and tabs so the board fills the screen"
              onPress={() => { setModePicker(false); setFullScreen(true) }} />
          )}
        </View>
      </Sheet>
      <Sheet visible={datePicker} onClose={() => setDatePicker(false)} title="Choose a Date">
        <View style={{ gap: space.sm }}>
          {Platform.OS !== "web" && (
            <DateTimePicker value={new Date(`${date}T12:00:00`)} mode="date" display="inline" accentColor={colour.pitch600}
              onChange={(_e, next) => { setDatePicker(false); if (next) { const iso = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`; guarded(() => setDate(iso)) } }} />
          )}
          {date !== todayIso() && <Button variant="secondary" label="Go to Today" onPress={() => { setDatePicker(false); guarded(() => setDate(todayIso())) }} />}
        </View>
      </Sheet>
      <Sheet visible={autoAsk !== null} onClose={() => setAutoAsk(null)} title="Save Your Changes First?">
        <View style={{ gap: space.sm }}>
          <Text style={[type.small, { color: colour.inkMuted }]}>{`Auto Allocate works from what is saved, so it cannot plan around the ${planner.counts.manual} ${planner.counts.manual === 1 ? "change" : "changes"} you have not saved yet.`}</Text>
          <Button label="Save and Auto Allocate" icon={<Sparkles size={16} color={colour.onForest} />} busy={planner.saving}
            onPress={async () => { const rerun = autoAsk?.rerun ?? false; if (await planner.save()) { setAutoAsk(null); setDayView("pitches"); void planner.runAuto(venueId, rerun) } }} />
          <Button label="Keep Editing" variant="quiet" onPress={() => setAutoAsk(null)} />
        </View>
      </Sheet>
      <UnsavedSheet
        visible={guard !== null}
        total={planner.counts.total}
        auto={planner.counts.auto}
        saving={planner.saving}
        onSave={async () => { const go = guard; if (await planner.save()) { setGuard(null); go?.() } }}
        onDiscard={() => { const go = guard; setGuard(null); planner.discard(); go?.() }}
        onStay={() => setGuard(null)}
      />
    </View>
  )
}
