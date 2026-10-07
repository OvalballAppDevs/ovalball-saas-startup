import type { ClubEventItem } from "@ovalball/contracts/agenda/events"
import type { MyEventAnswer } from "@ovalball/contracts/events/centre"
import { EventListRow } from "../../../src/events/event-card"
import { loadEventsForContext } from "../../../src/events/load"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { isFamilyFacingContext, memberFor, type AgendaItem, type FamilyMember } from "@ovalball/contracts"
import { collapseFamilyEvents, narrowEventsToChild } from "@ovalball/contracts/family/events"
import { needsAttendanceResponse } from "@ovalball/contracts"
import { readClubFixtureRequests, type ClubFixtureRequest } from "@ovalball/contracts/club/requests"
import { readTeamFixtureRequests, type TeamFixtureRequest } from "@ovalball/contracts/team/requests"
import { buildFixtureRequestGroupSummaries, countFixtureRequestGroupsRequiringAction } from "@ovalball/contracts/team/request-groups"

import { supabase } from "../../../src/auth/supabase"
import { useAppContexts } from "../../../src/context/contexts"
import { readAgenda, todayIso } from "../../../src/agenda/load"
import { loadFixtureAuthority, type FixtureAuthority } from "../../../src/agenda/authority"
import { readClubTeams } from "@ovalball/contracts/club/teams"
import { pageFixtures } from "../../../src/agenda/fixture-list"
import { friendly, logDetail } from "../../../src/errors/translate"
import { AppHeader } from "../../../src/components/app-header"
import { ChildFilter } from "../../../src/components/child-filter"
import { useFamily } from "../../../src/family/family"
import { ContextSheet } from "../../../src/components/context-sheet"
import { FixtureListRow, FixtureRowSkeleton } from "../../../src/components/fixture-list-row"
import { routeForAgendaItem, routeForIntent } from "../../../src/links/destinations"
import {
  AgendaFilterSheet,
  NO_FILTER,
  applyFilter,
  countActive,
  type AgendaFilter,
} from "../../../src/components/agenda-filter"
import { CalendarDays, ChevronRight, Megaphone, OvalIcon, Plus, SlidersHorizontal } from "../../../src/components/icons"
import { usePlannerAccess } from "../../../src/season-planner/data"
import { Button, EmptyState, ErrorState } from "../../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../src/design/tokens"

/**
 * FIXTURES — what matches have we got, and what can I do about them.
 *
 * OWNER PHYSICAL REVIEW CORRECTION PASS. The previous screen carried a giant dark-green hero, full-width
 * date section headers, an exposed match-day "meet" time and cancelled fixtures visible by default --
 * all rejected against the approved mockup. This pass replaces `AgendaRow`'s day-grouped layout with
 * `FixtureListRow`'s date-block-per-card anatomy (Sections 2-8), pages Upcoming/Past five at a time with
 * a "View all" expansion (Sections 9-10), shows a real Win/Loss/Draw result and an Add Result shortcut
 * where legitimate (Sections 10-11, 21), and hides cancelled fixtures by default for staff while a
 * participant keeps seeing them (Section 12) -- `AgendaRow` itself is untouched, since Calendar and Home
 * still want its day-grouped, meet-time-carrying shape.
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
 * WHAT YOU MAY DO IS ASKED OF THE SERVER. `my_capabilities` decides whether Add, Request and Add Result
 * appear, at the scope of the context somebody is standing in. There is no role name in this file.
 */
export default function Fixtures() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { sessionContext, active } = useAppContexts()
  const plannerAccess = usePlannerAccess(active?.kind === "club" ? (active.clubId ?? active.id) : null)
  const [direction, setDirection] = useState<"upcoming" | "past">("upcoming")
  const [items, setItems] = useState<AgendaItem[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [problem, setProblem] = useState<{ message: string; offline: boolean } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [authority, setAuthority] = useState<FixtureAuthority | null>(null)
  const [filter, setFilter] = useState<AgendaFilter>(NO_FILTER)
  const [filterOpen, setFilterOpen] = useState(false)
  const [expandedUpcoming, setExpandedUpcoming] = useState(false)
  const [expandedPast, setExpandedPast] = useState(false)
  const today = todayIso()

  // A STAFF AGENDA DEFAULTS CANCELLED HIDDEN, A PARTICIPANT'S DOES NOT (Section 12). Applied ONCE, the
  // first moment `active` resolves, never stomping a choice the person makes afterwards -- switching
  // team/club context later does not silently reset their filter.
  const appliedDefault = useRef(false)
  const baseline = useMemo<AgendaFilter>(
    () => ({ ...NO_FILTER, includeCancelled: !(active?.kind === "team" || active?.kind === "club") }),
    [active?.kind]
  )
  useEffect(() => {
    if (!active || appliedDefault.current) return
    appliedDefault.current = true
    setFilter((f) => ({ ...f, includeCancelled: baseline.includeCancelled }))
  }, [active, baseline])

  // TEAM PROFILE'S "VIEW FULL FIXTURE LIST" (Section 17): a `teamId` in the route seeds the filter's
  // OWN existing `teamId` field once, on arrival -- the same narrowing `applyFilter` always performed,
  // never a second query and never anything that could widen what this screen's own scope already
  // authorised. Team Profile only ever sends this param where that scope is already known to cover the
  // team, so this never surfaces as a confusing empty list; it just saves the person the extra tap the
  // Filter sheet's own Team picker would otherwise ask for.
  // EVENTS SIT IN THE SAME CHRONOLOGY (20270729): never dressed as fixtures, always their own EVENT card.
  const [agendaEvents, setAgendaEvents] = useState<{ events: ClubEventItem[]; answers: MyEventAnswer[] }>({ events: [], answers: [] })
  const params = useLocalSearchParams<{ teamId?: string }>()
  const appliedTeamParam = useRef(false)
  useEffect(() => {
    if (appliedTeamParam.current || !params.teamId) return
    appliedTeamParam.current = true
    setFilter((f) => ({ ...f, teamId: params.teamId ?? null }))
  }, [params.teamId])

  const load = useCallback(async () => {
    if (!sessionContext || !active) return
    setProblem(null)
    try {
      const result = await readAgenda(supabase, sessionContext, active, {
        direction,
        // A FIXTURE LIST IS FIXTURES. Training has no opponent and no home or away; it lives on the
        // Calendar, where the question it answers is the one being asked.
        includeTraining: false,
        // A FESTIVAL IS NOT A FIXTURE, BUT ITS GAMES ARE MATCHES (20270726). The list carries each
        // published tournament game -- a real opponent, a kick-off, a pitch, a counted score -- as one
        // row that opens that game; the festival itself stays on the Calendar, which is asked what is
        // happening rather than which matches are coming. A draft plan's games never appear.
        includeTournaments: true,
        tournamentGames: true,
        today,
      })
      setItems(result.items)
      setTruncated(result.truncated)
      {
        const start = direction === "upcoming" ? today : shiftYear(today, -1)
        const end = direction === "upcoming" ? shiftYear(today, 1) : today
        const loaded = await loadEventsForContext(active, { start, end }).catch(() => ({ events: [] as ClubEventItem[], answers: [] as MyEventAnswer[] }))
        setAgendaEvents({
          events: loaded.events.filter((e) => (direction === "upcoming" ? e.endsOn >= today : e.endsOn < today)),
          answers: loaded.answers,
        })
      }
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

  // A fixture created, edited, cancelled or resulted on another screen has to show here on the way back.
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
  /*
    THE CHILD COMES FROM THE FAMILY, NOT FROM THIS SCREEN.

    `selectedPlayerId` is already normalised against the resolved family, so an
    id from a restored selection or a deep link that this guardian does not hold
    has become null before it reaches the filter. Merged here rather than stored
    twice, so the chip row and the list cannot disagree about who is selected.
  */
  const { selectedPlayerId, projection } = useFamily()

  /*
    ONE DESTINATION TABLE, shared with Home, the Calendar, a notification and an
    incoming deep link. A match opens the Match Centre for a parent or a player and
    the fixture console for staff; a session opens the Training Centre.
  */
  const openEvent = useCallback(
    (item: AgendaItem) => {
      if (!active) return
      const route = routeForAgendaItem(item, active.kind)
      if (route) router.push(route as never)
    },
    [router, active]
  )
  const effective = useMemo(() => ({ ...filter, playerId: selectedPlayerId }), [filter, selectedPlayerId])
  const shown = useMemo(() => (items ? applyFilter(items, effective) : null), [items, effective])
  // The chosen child narrows the club's events exactly as it narrows the rugby (`narrowEventsToChild`).
  const eventsShown = useMemo(() => narrowEventsToChild(agendaEvents.events, agendaEvents.answers, selectedPlayerId), [agendaEvents, selectedPlayerId])

  // ONE MATCH, EVERY CHILD IN IT (CA-M9). A family reading all its children collapses the agenda's
  // one-row-per-child onto the event, so two siblings on one side are one row with two answers.
  const familyReading = active !== null && isFamilyFacingContext(active.kind) && selectedPlayerId === null
  const allRows: { row: AgendaItem; siblings?: { member: FamilyMember; attendance: AgendaItem["attendance"]; outstanding: boolean }[] }[] = useMemo(
    () =>
      familyReading
        ? collapseFamilyEvents(shown ?? []).map((e) => ({
            row: { ...e.item, key: e.key },
            siblings: e.children
              .map((c) => ({ member: memberFor(projection, c.playerId)!, attendance: c.attendance, outstanding: needsAttendanceResponse(c.item, today) }))
              .filter((c): c is { member: FamilyMember; attendance: AgendaItem["attendance"]; outstanding: boolean } => c.member != null),
          }))
        : (shown ?? []).map((row) => ({ row, siblings: undefined })),
    [shown, familyReading, projection, today]
  )

  // NEXT FIXTURE (owner clarification): its OWN section, same card anatomy, never a second, duplicate
  // appearance inside Upcoming Fixtures. A cancelled match is not what somebody is preparing for, so it
  // is skipped for this purpose but still stays exactly where it belongs chronologically further down.
  const nextRow = useMemo(() => {
    if (direction !== "upcoming") return null
    // NOR IS A GAME ALREADY PLAYED: on a tournament day the morning's games carry results while the
    // afternoon's are still to come, and the next fixture is the first one without a result.
    return allRows.find((r) => r.row.status !== "Cancelled" && r.row.result === null) ?? null
  }, [allRows, direction])
  const rows = useMemo(() => (nextRow ? allRows.filter((r) => r.row.key !== nextRow.row.key) : allRows), [allRows, nextRow])

  const page = useMemo(() => pageFixtures(rows, direction === "upcoming" ? expandedUpcoming : expandedPast), [rows, direction, expandedUpcoming, expandedPast])

  const canAdd = authority?.create ?? false
  const canRequest = authority?.requestCreate ?? false
  const canRecordResult = authority?.recordResult ?? false
  // THE FIXTURE REQUESTS BADGE (owner correction pass, Sections 3/18): a REAL count of request GROUPS
  // genuinely requiring this viewer's attention -- the same truthful `requiresAction` the My Requests
  // screen itself uses, never a raw historical count of every "sent" row and never a notification's
  // read/unread state. Accepted, declined, withdrawn and expired groups never contribute.
  const [requestsBadge, setRequestsBadge] = useState(0)
  useEffect(() => {
    let live = true
    setRequestsBadge(0)
    if (!authority?.requestRespond && !authority?.requestCreate) return
    async function loadBadge() {
      if (active?.kind === "team" && active.id) {
        const { incoming, outgoing } = await readTeamFixtureRequests(supabase, active.id)
        const groups = buildFixtureRequestGroupSummaries<TeamFixtureRequest>([...incoming, ...outgoing])
        if (live) setRequestsBadge(countFixtureRequestGroupsRequiringAction(groups))
        return
      }
      if (active?.kind === "club" && (active.clubId ?? active.id)) {
        const clubId = (active.clubId ?? active.id) as string
        const d = await readClubTeams(supabase, clubId)
        const ids = d.teams.filter((t) => t.active).map((t) => ({ id: t.id, name: t.displayName }))
        if (!ids.length) return
        const requests = await readClubFixtureRequests(supabase, ids)
        const groups = buildFixtureRequestGroupSummaries<ClubFixtureRequest>([...requests.incoming, ...requests.outgoing])
        if (live) setRequestsBadge(countFixtureRequestGroupsRequiringAction(groups))
      }
    }
    void loadBadge().catch(() => undefined)
    return () => {
      live = false
    }
  }, [active, authority])

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <AppHeader onOpenContexts={() => setSheetOpen(true)} />
      {/* Absent entirely for a parent of one -- a chooser between one child and
          themselves is a control that cannot do anything. */}
      <ChildFilter style={{ paddingHorizontal: space.lg, paddingTop: space.md }} />

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
            label={countActive(filter, baseline) > 0 ? `Filter · ${countActive(filter, baseline)}` : "Filter"}
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

        {/* THE SHAPE OF WHAT IS COMING, so the list never flashes "No fixtures" mid-load (Section 24). */}
        {!problem && shown === null && (
          <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
            <FixtureRowSkeleton />
            <FixtureRowSkeleton />
            <FixtureRowSkeleton />
          </View>
        )}

        {/* FIXTURE REQUESTS IS AN INBOX ENTRY POINT, NOT A FEED (owner correction pass, Sections 1-3/19):
            a negotiation inbox lives behind this one row with a real notification-style count, exactly
            the way Ovalball's other badges work -- never a second projection of pending requests spilled
            into this agenda. */}
        {(active?.kind === "team" || active?.kind === "club") && (authority?.requestRespond || authority?.requestCreate) && direction === "upcoming" && (
          <View style={{ paddingHorizontal: space.lg }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={requestsBadge > 0 ? `Fixture Requests. ${requestsBadge} ${requestsBadge === 1 ? "request needs" : "requests need"} your attention.` : "Fixture Requests. View and manage your fixture requests."}
              onPress={() => router.push({ pathname: (active.kind === "club" ? "/club/requests" : "/team/requests") as never, params: { returnTo: "/fixtures" } })}
              style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 4, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, opacity: pressed ? 0.92 : 1 })}
            >
              <Megaphone size={17} color={colour.forest800} strokeWidth={2} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>Fixture Requests</Text>
                <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>View and manage your fixture requests</Text>
              </View>
              {requestsBadge > 0 && (
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={{ minWidth: 24, height: 24, paddingHorizontal: 6, borderRadius: 12, backgroundColor: colour.warning, alignItems: "center", justifyContent: "center" }}
                >
                  <Text style={[type.caption, { color: colour.onForest, fontSize: 12 }]}>{requestsBadge > 9 ? "9+" : requestsBadge}</Text>
                </View>
              )}
              <ChevronRight size={17} color={colour.inkSubtle} />
            </Pressable>
          </View>
        )}

        {/* SEASON PLANNER, NATIVE: club days with another club over the canonical fixture-request domain.
            Club context and the club-scope planner capability only (fixture.planner.use -- Club Admin,
            Fixture Secretary); team staff never see mass scheduling. Imports, bulk edits and the Competition
            Creator remain web tools and are not linked from here (the owner rejected a hand-off card). */}
        {active?.kind === "club" && plannerAccess.allowed && direction === "upcoming" && (
          <View style={{ paddingHorizontal: space.lg }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Season Planner. Arrange club days with other clubs."
              onPress={() => router.push({ pathname: "/fixtures/planner" as never, params: { returnTo: "/fixtures" } })}
              style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 4, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, opacity: pressed ? 0.92 : 1 })}
            >
              <CalendarDays size={17} color={colour.forest800} strokeWidth={2} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>Season Planner</Text>
                <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>Arrange club days with other clubs</Text>
              </View>
              <ChevronRight size={17} color={colour.inkSubtle} />
            </Pressable>
          </View>
        )}

        {shown?.length === 0 && (
          <View style={{ paddingHorizontal: space.lg }}>
            <EmptyState
              title={
                countActive(filter, baseline) > 0
                  ? "No fixtures match these filters"
                  : direction === "upcoming"
                    ? "No upcoming fixtures"
                    : "No past fixtures yet"
              }
              body={
                countActive(filter, baseline) > 0
                  ? "Try different filters, or clear them to see everything."
                  : direction === "upcoming"
                    ? canAdd || canRequest
                      ? "Add a fixture or use Clubhouse to find opposition."
                      : "Nothing is scheduled for this side yet. Fixtures appear here as soon as they are arranged."
                    : "Results from completed fixtures will appear here."
              }
              icon={<OvalIcon size={24} color={colour.inkSubtle} />}
            />
            {countActive(filter, baseline) > 0 && (
              <View style={{ marginTop: space.md }}>
                <Button label="Clear Filters" variant="secondary" onPress={() => setFilter(baseline)} />
              </View>
            )}
            {countActive(filter, baseline) === 0 && direction === "upcoming" && (canAdd || canRequest) && (
              <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.md }}>
                {canAdd && <Button label="Add Fixture" style={{ flex: 1 }} onPress={() => router.push({ pathname: "/fixtures/new", params: { teamId: active?.id ?? "" } })} />}
                <Button label="Find a Fixture" variant="secondary" style={{ flex: 1 }} onPress={() => router.push("/clubhouse/find-fixture" as never)} />
              </View>
            )}
          </View>
        )}

        {/* NEXT FIXTURE (owner clarification): its own labelled section, the SAME card anatomy as every
            other row -- a subtle mint tint and a small NEXT mark, never a giant hero, never a heavier
            border. Upcoming Fixtures below never repeats it. */}
        {nextRow && (
          <View style={{ paddingHorizontal: space.lg, gap: space.sm, marginBottom: space.sm }}>
            <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
              Next Fixture
            </Text>
            <FixtureListRow
              item={nextRow.row}
              today={today}
              isNext
              onPress={() => openEvent(nextRow.row)}
              child={memberFor(projection, nextRow.row.playerId)}
              siblings={nextRow.siblings}
            />
          </View>
        )}

        {shown && shown.length === 0 && eventsShown.events.length > 0 && (
          <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
            {eventsShown.events.map((e) => (
              <EventListRow key={e.key} event={e} answers={eventsShown.answers.filter((x) => x.eventId === e.eventId)} onPress={() => router.push({ pathname: "/fixtures/event/[eventId]", params: { eventId: e.eventId } } as never)} />
            ))}
          </View>
        )}

        {shown && shown.length > 0 && (
          <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
            {(page.shown.length > 0 || !nextRow) && (
              <Text accessibilityRole="header" style={[type.heading, { color: colour.ink }]}>
                {direction === "upcoming" ? "Upcoming Fixtures" : "Past Fixtures"}
              </Text>
            )}
            {page.shown.map(({ row: item, siblings }, index) => (
              <View key={item.key} style={{ gap: space.sm }}>
              {eventsBefore(eventsShown.events, item.date, page.shown[index - 1]?.row.date ?? null, direction).map((e) => (
                <EventListRow key={e.key} event={e} answers={eventsShown.answers.filter((x) => x.eventId === e.eventId)} onPress={() => router.push({ pathname: "/fixtures/event/[eventId]", params: { eventId: e.eventId } } as never)} />
              ))}
              <FixtureListRow
                key={item.key}
                item={item}
                today={today}
                onPress={() => openEvent(item)}
                child={memberFor(projection, item.playerId)}
                siblings={siblings}
                addResult={direction === "past" && item.kind === "fixture" && !item.result && canRecordResult && (item.homeAway === "Home" || item.homeAway === "Away")}
                canRecordResult={canRecordResult}
                onAddResult={() => router.push(routeForIntent({ kind: "ADD_RESULT", fixtureId: item.eventId }) as never)}
              />
              </View>
            ))}
            {!page.hasMore &&
              eventsAfter(eventsShown.events, page.shown[page.shown.length - 1]?.row.date ?? null, direction).map((e) => (
                <EventListRow key={e.key} event={e} answers={eventsShown.answers.filter((x) => x.eventId === e.eventId)} onPress={() => router.push({ pathname: "/fixtures/event/[eventId]", params: { eventId: e.eventId } } as never)} />
              ))}
            {page.hasMore && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={direction === "upcoming" ? "View all upcoming fixtures" : "View all past fixtures"}
                onPress={() => (direction === "upcoming" ? setExpandedUpcoming(true) : setExpandedPast(true))}
                style={({ pressed }) => ({ minHeight: TOUCH_TARGET, alignItems: "center", justifyContent: "center", paddingVertical: space.sm, opacity: pressed ? 0.7 : 1 })}
              >
                <Text style={[type.smallMedium, { color: colour.forest800 }]}>{direction === "upcoming" ? "View all upcoming" : "View all past"}</Text>
              </Pressable>
            )}
          </View>
        )}

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
        baseline={baseline}
        showTraining={false}
        onChange={setFilter}
        onClose={() => setFilterOpen(false)}
        // NO TEAM CHIPS FOR A FAMILY. The child chips above the list are the
        // canonical way a guardian narrows; a side's name is the same question in
        // the wrong language.
        familyScope={active !== null && isFamilyFacingContext(active.kind)}
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
              backgroundColor: selected ? colour.forest800 : "transparent",
            }}
          >
            <Text style={[type.smallMedium, { color: selected ? colour.onForest : colour.inkMuted }]}>
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

function shiftYear(iso: string, by: number): string {
  return `${Number(iso.slice(0, 4)) + by}${iso.slice(4)}`
}

/** The events that fall between the previous row's date and this row's, in the list's own direction. */
function eventsBefore(events: ClubEventItem[], date: string, previous: string | null, direction: string): ClubEventItem[] {
  const upcoming = direction === "upcoming"
  return events
    .filter((e) => (upcoming ? e.startsOn <= date && (previous === null || e.startsOn > previous) : e.startsOn >= date && (previous === null || e.startsOn < previous)))
    .sort((a, b) => (upcoming ? a.startsOn.localeCompare(b.startsOn) : b.startsOn.localeCompare(a.startsOn)))
}

function eventsAfter(events: ClubEventItem[], last: string | null, direction: string): ClubEventItem[] {
  if (last === null) return []
  const upcoming = direction === "upcoming"
  return events
    .filter((e) => (upcoming ? e.startsOn > last : e.startsOn < last))
    .sort((a, b) => (upcoming ? a.startsOn.localeCompare(b.startsOn) : b.startsOn.localeCompare(a.startsOn)))
}
