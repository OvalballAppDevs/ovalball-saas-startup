import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { isFamilyFacingContext, memberFor, pendingScheduleItemsForTeam, type AgendaItem, type PendingScheduleItem } from "@ovalball/contracts"
import { collapseFamilyEvents, groupFamilyEventsByDay } from "@ovalball/contracts/family/events"
import { needsAttendanceResponse } from "@ovalball/contracts"
import { readClubFixtureRequests, type ClubFixtureRequest } from "@ovalball/contracts/club/requests"
import { readTeamFixtureRequests } from "@ovalball/contracts/team/requests"

import { supabase } from "../../../src/auth/supabase"
import { useAppContexts } from "../../../src/context/contexts"
import { readAgenda, todayIso } from "../../../src/agenda/load"
import { anyManagement, loadFixtureAuthority, type FixtureAuthority } from "../../../src/agenda/authority"
import { readClubTeams } from "@ovalball/contracts/club/teams"
import { anyDeskFixtureTool, readClubAuthority, type ClubAuthority } from "@ovalball/contracts/club/overview"
import * as Linking from "expo-linking"
import { webUrl } from "../../../src/config/environment"
import { groupByDay, relativeDate, restOfDate } from "../../../src/agenda/presentation"
import { friendly, logDetail } from "../../../src/errors/translate"
import { AppHeader } from "../../../src/components/app-header"
import { ChildFilter } from "../../../src/components/child-filter"
import { useFamily } from "../../../src/family/family"
import { ContextSheet } from "../../../src/components/context-sheet"
import { AgendaRow, NextFixtureCard } from "../../../src/components/agenda-row"
import { routeForAgendaItem } from "../../../src/links/destinations"
import {
  AgendaFilterSheet,
  NO_FILTER,
  applyFilter,
  countActive,
  type AgendaFilter,
} from "../../../src/components/agenda-filter"
import { ChevronRight, Megaphone, OvalIcon, Plus, SlidersHorizontal } from "../../../src/components/icons"
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

  const [next, rest] = useMemo(() => {
    const items = shown
    if (!items || items.length === 0 || direction === "past") return [null, items ?? []]
    // THE NEXT ONE THAT IS ACTUALLY ON. A cancelled match is not what somebody is preparing for, so it
    // stays in the list and does not take the headline.
    const index = items.findIndex((item) => item.status !== "Cancelled")
    if (index === -1) return [null, items]
    return [items[index], items.filter((_, i) => i !== index)]
  }, [shown, direction])

  // ONE MATCH, EVERY CHILD IN IT (CA-M9). A family reading all its children collapses the agenda's
  // one-row-per-child onto the event, so two siblings on one side are one row with two answers.
  const familyReading = active !== null && isFamilyFacingContext(active.kind) && selectedPlayerId === null
  const days = useMemo(
    () =>
      familyReading
        ? groupFamilyEventsByDay(collapseFamilyEvents(rest)).map((d) => ({
            date: d.date,
            items: d.events.map((e) => ({
              row: { ...e.item, key: e.key },
              siblings: e.children.map((c) => ({ member: memberFor(projection, c.playerId)!, attendance: c.attendance, outstanding: needsAttendanceResponse(c.item, today) })).filter((c) => c.member),
            })),
          }))
        : groupByDay(rest).map((d) => ({ date: d.date, items: d.items.map((row) => ({ row, siblings: undefined })) })),
    [rest, familyReading, projection, today]
  )
  const canAdd = authority?.create ?? false
  const canRequest = authority?.requestCreate ?? false
  // THE REQUESTS WAITING ON THIS TEAM (CA-M7): a row above the list in a team context, for somebody
  // the server says may answer. Counted from the same RLS-scoped rows the requests screen reads.
  const [waitingRequests, setWaitingRequests] = useState<number>(0)
  const [clubAuthority, setClubAuthority] = useState<ClubAuthority | null>(null)
  useEffect(() => {
    let live = true
    setWaitingRequests(0)
    setClubAuthority(null)
    if (!authority?.requestRespond) return
    if (active?.kind === "team" && active.id) {
      void supabase
        .from("fixture_requests")
        .select("id", { count: "exact", head: true })
        .eq("target_team_id", active.id)
        .eq("status", "sent")
        .then(({ count }) => {
          if (live) setWaitingRequests(count ?? 0)
        })
    }
    // A CLUB'S REQUESTS (CA-M10): every side's, counted from the same RLS-scoped rows the requests
    // screen reads; and the desk tools offered as a hand-off only where the club-scope probe says yes.
    if (active?.kind === "club" && (active.clubId ?? active.id)) {
      const clubId = (active.clubId ?? active.id) as string
      void (async () => {
        const d = await readClubTeams(supabase, clubId)
        const ids = d.teams.filter((t) => t.active).map((t) => t.id)
        if (!ids.length) return
        const { count } = await supabase.from("fixture_requests").select("id", { count: "exact", head: true }).in("target_team_id", ids).eq("status", "sent")
        if (live) setWaitingRequests(count ?? 0)
      })().catch(() => undefined)
      void readClubAuthority(supabase, clubId)
        .then((a) => {
          if (live) setClubAuthority(a)
        })
        .catch(() => undefined)
    }
    return () => {
      live = false
    }
  }, [active, authority])

  // PENDING FIXTURE REQUESTS, IN THE SCHEDULE TOO (owner correction pass, Sections 7/9/13): the SAME
  // canonical `readTeamFixtureRequests`/`readClubFixtureRequests` reads the existing Requests screen
  // already uses, projected through the ONE shared `pendingScheduleItemsForTeam` (contracts) rather than
  // a second, screen-local shape. Never shown for "past" -- a pending request is inherently forward-
  // looking scheduling intent, not something that "happened."
  const [pendingItems, setPendingItems] = useState<PendingScheduleItem[]>([])
  useEffect(() => {
    let live = true
    setPendingItems([])
    if (direction !== "upcoming") return
    async function loadPending() {
      if (active?.kind === "team" && active.id) {
        const { incoming, outgoing } = await readTeamFixtureRequests(supabase, active.id)
        const us = { directoryId: null, clubName: "", teamName: active.label, compactName: null, rugbyCode: null, crestUrl: null, kit: null }
        if (live) setPendingItems(pendingScheduleItemsForTeam([...incoming, ...outgoing], active.id, us))
        return
      }
      if (active?.kind === "club" && (active.clubId ?? active.id)) {
        const clubId = (active.clubId ?? active.id) as string
        const d = await readClubTeams(supabase, clubId)
        const teams = d.teams.filter((t) => t.active)
        if (!teams.length) return
        const requests = await readClubFixtureRequests(supabase, teams.map((t) => ({ id: t.id, name: t.displayName })))
        const all: ClubFixtureRequest[] = [...requests.incoming, ...requests.outgoing]
        const byTeam = new Map<string, ClubFixtureRequest[]>()
        for (const r of all) byTeam.set(r.ourTeamId, [...(byTeam.get(r.ourTeamId) ?? []), r])
        const items = teams.flatMap((t) =>
          pendingScheduleItemsForTeam(byTeam.get(t.id) ?? [], t.id, { directoryId: null, clubName: "", teamName: t.displayName, compactName: null, rugbyCode: t.rugbyCode, crestUrl: null, kit: null })
        )
        if (live) setPendingItems(items)
      }
    }
    void loadPending().catch(() => undefined)
    return () => {
      live = false
    }
  }, [active, direction])

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

        {(active?.kind === "team" || active?.kind === "club") && (authority?.requestRespond || authority?.requestCreate) && direction === "upcoming" && (
          <View style={{ paddingHorizontal: space.lg }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={waitingRequests > 0 ? `${waitingRequests} fixture ${waitingRequests === 1 ? "request is" : "requests are"} waiting for your answer. Opens Fixture Requests.` : "Fixture Requests"}
              onPress={() => router.push((active.kind === "club" ? "/club/requests" : "/team/requests") as never)}
              style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 4, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: waitingRequests > 0 ? colour.warning : colour.line, backgroundColor: waitingRequests > 0 ? colour.warningSurface : colour.surface, opacity: pressed ? 0.92 : 1 })}
            >
              <Megaphone size={17} color={waitingRequests > 0 ? colour.warning : colour.forest800} strokeWidth={2} />
              <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>
                {waitingRequests > 0 ? `${waitingRequests} fixture ${waitingRequests === 1 ? "request" : "requests"} waiting for your answer` : "Fixture Requests"}
              </Text>
              <ChevronRight size={17} color={colour.inkSubtle} />
            </Pressable>
          </View>
        )}

        {/* THE DESK TOOLS ARE DESK TOOLS (CA-M10): season planning, imports, bulk edits and the Competition
            Creator stay on the website, offered from the club context only where the club-scope probe
            says this person holds them. Never from a team context; never rebuilt smaller here. */}
        {active?.kind === "club" && clubAuthority && anyDeskFixtureTool(clubAuthority) && direction === "upcoming" && (
          <View style={{ paddingHorizontal: space.lg }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fixture Control Centre. Season planning, imports and bulk changes. Opens the Ovalball website"
              onPress={() => void Linking.openURL(`${webUrl}/fixtures/management`)}
              style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 4, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, opacity: pressed ? 0.92 : 1 })}
            >
              <SlidersHorizontal size={17} color={colour.forest800} strokeWidth={2} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>Fixture Control Centre</Text>
                <Text style={[type.caption, { color: colour.inkMuted }]}>Season planning, imports and bulk changes — on the website</Text>
              </View>
              <ChevronRight size={17} color={colour.inkSubtle} />
            </Pressable>
          </View>
        )}

        {/* PENDING FIXTURE REQUESTS (owner correction pass, Section 9): visually resembles a fixture row
            enough to be understood as "concerns a match," but a restrained amber treatment and its own
            Pending label keep it distinct from a booked fixture -- never a confirmed venue/pitch shown
            for a match nobody has agreed on yet. Tapping opens the real request/negotiation surface,
            never Match Centre for a Fixture that does not exist. */}
        {pendingItems.length > 0 && (
          <View style={{ paddingHorizontal: space.lg, gap: space.xs }}>
            <Text style={[type.overline, { color: colour.warning }]}>PENDING</Text>
            <View style={{ backgroundColor: colour.warningSurface, borderRadius: radius.md, borderWidth: 1, borderColor: "rgba(138,90,0,0.25)" }}>
              {pendingItems.map((p, i) => (
                <Pressable
                  key={p.key}
                  accessibilityRole="button"
                  accessibilityLabel={`Pending fixture request. ${p.them.clubName}${p.them.teamName ? `, ${p.them.teamName}` : ""}. ${p.status}.`}
                  onPress={() => router.push((active?.kind === "club" ? "/club/requests" : "/team/requests") as never)}
                  style={({ pressed }) => ({ padding: space.md, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "rgba(138,90,0,0.2)", opacity: pressed ? 0.85 : 1 })}
                >
                  <Text style={[type.caption, { color: colour.inkSubtle }]}>{p.date ? new Date(`${p.date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "Date TBD"}</Text>
                  <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
                    {p.them.clubName}
                    {p.them.teamName ? ` · ${p.them.teamName}` : ""}
                  </Text>
                  <Text style={[type.caption, { color: colour.warning }]}>{p.status}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {!!next && (
          <View style={{ paddingHorizontal: space.lg }}>
            <NextFixtureCard
              item={next}
              today={today}
              child={memberFor(projection, next.playerId)}
              onPress={() => openEvent(next)}
            />
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
              {day.items.map(({ row: item, siblings }, index) => (
                <View key={item.key} style={index === 0 ? undefined : { borderTopWidth: 1, borderTopColor: colour.line }}>
                  <AgendaRow
                    item={item}
                    today={today}
                    showOwner={active?.kind !== "team"}
                    child={memberFor(projection, item.playerId)}
                    siblings={siblings}
                    onPress={() => openEvent(item)}
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
