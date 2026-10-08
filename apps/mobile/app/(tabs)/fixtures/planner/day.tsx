import { useEffect, useMemo, useRef, useState } from "react"
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native"
import { useRouter } from "expo-router"
import {
  addDays,
  bulkVenues,
  isoWeekday,
  canSelect,
  longMatchDate,
  otherDaysThisWeek,
  seasonWeeks,
  shortMatchDate,
  summariseWeek,
  teamDayState,
  weekCommencingLabel,
  type PlannerCommitment,
  type PlannerTeam,
  type TeamDayState,
  type VenueBulk,
  type IsoWeekday,
} from "@ovalball/contracts"

import { OvalballDetailHeader } from "../../../../src/components/app-header"
import { BottomSheet } from "../../../../src/components/bottom-sheet"
import { ChoiceSheet } from "../../../../src/components/field-sheet"
import { ChevronDown, ChevronRight, Info, Search } from "../../../../src/components/icons"
import { Button, ErrorState, Skeleton } from "../../../../src/components/ui"
import { ChoiceRow, Note } from "../../../../src/people/ui"
import { useSeasonPlanner, type PlannerSelection } from "../../../../src/season-planner/state"
import { defaultPlanningSeason, planningWeekday, todayIso, useClubDay, useClubPlannerTeams, usePlannerSeasons, usePlayingDays, useSeasonBoard } from "../../../../src/season-planner/data"
import { CountDot, DAY_NAMES, ForestSteps, HomeAwayToggle, OpponentCard, OpponentSearchSheet, PlannerCard, SectionLabel, StateTag, TeamIcon, WeekCard } from "../../../../src/season-planner/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"
import { routeForIntent } from "../../../../src/links/destinations"
import { withReturnTo } from "../../../../src/links/origin"

/**
 * PLAN A CLUB DAY -- one week, one opponent, my teams matched to theirs.
 *
 * Matching is the server's canonical eligibility (never names), and every team's day is shown as it really is: a
 * fixture or competition match already that day blocks it (a team plays once a day); a pending request elsewhere
 * needs a deliberate "Include anyway"; a team with no compatible opponent says so and offers another way.
 */
export default function PlanClubDay() {
  const router = useRouter()
  const planner = useSeasonPlanner()
  const draft = planner.draft
  const seasons = usePlannerSeasons(planner.clubId)
  const { rugbyCode } = useClubPlannerTeams(planner.clubId)
  const today = todayIso()
  const season = useMemo(() => (seasons ? (seasons.find((s) => s.id === draft?.seasonId) ?? defaultPlanningSeason(seasons, today)) : null), [seasons, draft?.seasonId, today])
  const playing = usePlayingDays(planner.clubId, season?.id ?? null)
  const { day: planningDay, configured: dayConfigured } = planningWeekday(playing.days)
  const weeks = useMemo(() => (season ? seasonWeeks(season.preSeasonStartsOn ?? season.startsOn, season.endsOn, planningDay, today) : []), [season, planningDay, today])
  // How many teams usually play on each weekday, for the week card's day row.
  const teamDays = useMemo(() => {
    const m = new Map<IsoWeekday, number>()
    for (const t of playing.days?.teams ?? []) if (t.effective) m.set(t.effective, (m.get(t.effective) ?? 0) + 1)
    return m
  }, [playing.days])
  const board = useSeasonBoard(planner.clubId, season?.id ?? null)
  const [searching, setSearching] = useState(false)
  const [weekSheet, setWeekSheet] = useState(false)
  const [bulkSheet, setBulkSheet] = useState(false)
  const [sidePicker, setSidePicker] = useState<PlannerTeam | null>(null)

  // A new plan starts on the first week still ahead.
  useEffect(() => {
    if (draft && !draft.matchDate && weeks[0]) planner.update({ weekStart: weeks[0].weekStart, matchDate: weeks[0].matchDate, seasonId: season?.id ?? null })
  }, [draft, weeks, season, planner])

  const opponent = draft?.opponent ?? null
  const date = draft?.matchDate ?? null
  const clubDay = useClubDay(planner.clubId, opponent?.onOvalball ? opponent.clubId : null, date)
  const selections = draft?.selections ?? {}

  const rows = useMemo(() => {
    if (!clubDay.day || !opponent?.clubId || !date) return []
    return clubDay.day.teams.map((team) => ({ team, state: teamDayState(team, date, opponent.clubId as string) }))
  }, [clubDay.day, opponent, date])

  // A selection that the server no longer allows (a fixture arrived, their team went) is dropped, not kept silently.
  useEffect(() => {
    if (!draft || rows.length === 0) return
    const stale = Object.keys(selections).filter((teamId) => {
      const row = rows.find((r) => r.team.teamId === teamId)
      const sel = selections[teamId]
      return !row || !canSelect(row.state) || !row.team.compatible.some((c) => c.teamId === sel.targetTeamId) || (row.state.kind === "pending_elsewhere" && !sel.acknowledge)
    })
    if (stale.length) {
      const next = { ...selections }
      for (const id of stale) delete next[id]
      planner.update({ selections: next })
    }
  }, [rows, selections, draft, planner])

  const selectedCount = Object.keys(selections).length
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({})

  function setVenue(team: PlannerTeam, venue: "home" | "away" | null, acknowledge = false) {
    const next = { ...selections }
    if (!venue) delete next[team.teamId]
    else next[team.teamId] = { targetTeamId: selections[team.teamId]?.targetTeamId ?? team.compatible[0].teamId, venue, acknowledge }
    planner.update({ selections: next })
  }

  function applyBulk(mode: VenueBulk | "clear") {
    setBulkSheet(false)
    if (mode === "clear") {
      planner.update({ selections: {} })
      return
    }
    // Auto Match fills the teams that are free AND usually play on this day; a Saturday side on a Sunday is left to
    // a deliberate choice.
    const weekday = date ? isoWeekday(date) : null
    const ready = rows.filter((r) => r.state.kind === "ready" && (!r.team.preferredDay || r.team.preferredDay === weekday)).map((r) => r.team)
    const venues = bulkVenues(ready.map((t) => t.teamId), mode)
    const next: Record<string, PlannerSelection> = {}
    for (const team of ready) next[team.teamId] = { targetTeamId: selections[team.teamId]?.targetTeamId ?? team.compatible[0].teamId, venue: venues[team.teamId], acknowledge: false }
    // Teams already chosen with a deliberate acknowledgement stay as they are.
    for (const [id, sel] of Object.entries(selections)) if (sel.acknowledge) next[id] = sel
    planner.update({ selections: next })
  }

  function openCommitment(c: PlannerCommitment) {
    if (c.kind === "fixture") { const route = routeForIntent({ kind: "FIXTURE", fixtureId: c.refId }); if (route) router.push(withReturnTo(route, "/fixtures/planner/day") as never) }
    else if (c.groupId) router.push({ pathname: "/fixtures/request/[groupId]", params: { groupId: c.groupId, ...(c.kind === "request_out" || c.kind === "request_in" ? { requestId: c.refId } : {}), returnTo: "/fixtures/planner/day" } } as never)
  }

  function findAnother(team: PlannerTeam) {
    if (!date) return
    router.push({
      pathname: "/clubhouse/find-fixture/matching",
      params: {
        criteria: JSON.stringify({ teamIds: [team.teamId], teamRugbyCode: rugbyCode, dates: [date], venuePreference: "either", distance: "any" }),
        teamLabels: JSON.stringify([team.displayName]),
      },
    } as never)
  }

  if (!draft) return <View style={{ flex: 1, backgroundColor: colour.chalk }} />

  const futureRows = (board.rows ?? []).filter((r) => r.date >= today)

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title="Plan Club Day" onBack={() => (router.canGoBack() ? router.back() : router.replace("/fixtures/planner" as never))} />
      <ForestSteps labels={["Opponent", "Teams", "Review", "Send"]} current={opponent ? 1 : 0} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}>
        {!!draft.weekStart && !!date && (
          <WeekCard
            weekStart={draft.weekStart}
            date={date}
            preferredDay={dayConfigured ? planningDay : null}
            teamDays={teamDays}
            onChangeWeek={() => setWeekSheet(true)}
            onChooseDay={(iso) => planner.update({ matchDate: iso, selections: {} })}
          />
        )}
        {playing.days?.seasonStructure === "not_finalised" && season && (
          <Note tone="warning">
            <Text style={[type.small, { color: colour.ink }]}>Team structure for {season.name} has not been finalised yet. This plan currently uses the club's present team structure.</Text>
          </Note>
        )}

        <PlannerCard>
          <Text style={[type.caption, { color: colour.inkMuted, marginBottom: space.sm }]}>Playing against</Text>
          {opponent ? (
            <OpponentCard
              opponent={opponent}
              onClear={() => planner.update({ opponent: null, selections: {} })}
            />
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel="Search clubs" onPress={() => setSearching(true)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: TOUCH_TARGET + 4, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: pressed ? colour.chalk : colour.surface })}>
              <Search size={18} color={colour.inkMuted} />
              <Text style={[type.body, { color: colour.inkSubtle }]}>Search clubs</Text>
            </Pressable>
          )}
        </PlannerCard>

        {opponent && !opponent.onOvalball && (
          <View style={{ gap: space.md }}>
            <Note tone="warning">
              <Text style={[type.small, { color: colour.ink }]}>
                {opponent.name} is not on Ovalball, so there is nobody to send a request to and their teams are not known here. You can invite them, or record a fixture against them for one of your teams.
              </Text>
            </Note>
            <Button variant="secondary" label="Invite to Ovalball" onPress={() => router.push({ pathname: "/clubhouse/club/[directoryId]", params: { directoryId: opponent.directoryId } } as never)} />
            <Button variant="quiet" label="Record a Fixture Instead" onPress={() => router.push({ pathname: "/fixtures/new", params: { opponentDirectoryId: opponent.directoryId, date: date ?? "" } } as never)} />
          </View>
        )}

        {opponent?.onOvalball && (
          <View style={{ gap: space.md }}>
            <SectionLabel
              title={`Your Teams${clubDay.day ? ` (${clubDay.day.teams.length})` : ""}`}
              action={
                <Pressable accessibilityRole="button" accessibilityLabel="Auto match Home and Away" onPress={() => setBulkSheet(true)} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 4, minHeight: TOUCH_TARGET }}>
                  <Text style={[type.smallMedium, { color: colour.rugby700 }]}>Auto Match</Text>
                  <ChevronDown size={16} color={colour.rugby700} />
                </Pressable>
              }
            />
            {clubDay.problem && <ErrorState message={clubDay.problem} onRetry={() => void clubDay.reload()} />}
            {!clubDay.day && !clubDay.problem && <Skeleton height={220} />}
            {clubDay.day && clubDay.day.teams.length === 0 && <Note>Your club has no active teams to plan for yet.</Note>}
            {clubDay.day && clubDay.day.teams.length > 0 && (
              <PlannerCard padded={false}>
                {rows.map(({ team, state }, i) => (
                  <TeamRow
                    key={team.teamId}
                    first={i === 0}
                    team={team}
                    state={state}
                    date={date as string}
                    opponentName={opponent.name}
                    opponentClubId={opponent.clubId as string}
                    selection={selections[team.teamId] ?? null}
                    acknowledged={acknowledged[team.teamId] ?? !!selections[team.teamId]?.acknowledge}
                    onAcknowledge={(on) => {
                      setAcknowledged((a) => ({ ...a, [team.teamId]: on }))
                      if (!on) setVenue(team, null)
                    }}
                    onVenue={(v) => setVenue(team, v, state.kind === "pending_elsewhere")}
                    onPickSide={() => setSidePicker(team)}
                    onOpen={openCommitment}
                    onFindAnother={() => findAnother(team)}
                  />
                ))}
              </PlannerCard>
            )}
          </View>
        )}
      </ScrollView>

      <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md, borderTopWidth: 1, borderTopColor: colour.line, backgroundColor: colour.chalk }}>
        <Button
          variant="brand"
          label={`Continue to Review (${selectedCount} Selected)`}
          disabled={selectedCount === 0 || !opponent?.onOvalball}
          accessibilityHint={selectedCount === 0 ? "Choose Home or Away for at least one team first" : undefined}
          trailing={<ChevronRight size={18} color={colour.onForest} />}
          onPress={() => router.push("/fixtures/planner/review")}
        />
      </View>

      <OpponentSearchSheet
        visible={searching}
        onClose={() => setSearching(false)}
        rugbyCode={rugbyCode}
        excludeClubId={planner.clubId}
        onChoose={(club) => {
          setSearching(false)
          planner.update({ opponent: { directoryId: club.directoryId, clubId: club.clubId, name: club.name, town: club.town, crestUrl: club.crestUrl, onOvalball: club.onOvalball }, selections: {} })
        }}
      />

      <BottomSheet visible={weekSheet} onClose={() => setWeekSheet(false)} title="Choose a Week" cancelLabel="Close">
        <WeekList
          weeks={weeks}
          selected={draft.weekStart}
          summary={(weekStart) => summariseWeek(futureRows, weekStart, (clubDay.day?.teams ?? []).map((t) => t.teamId))}
          onChoose={(weekStart) => {
            // A new week keeps the weekday already chosen (an ad-hoc Wednesday stays a Wednesday).
            const weekday = date ? isoWeekday(date) : planningDay
            planner.update({ weekStart, matchDate: addDays(weekStart, weekday - 1), selections: {} })
            setWeekSheet(false)
          }}
        />
      </BottomSheet>

      <BottomSheet visible={bulkSheet} onClose={() => setBulkSheet(false)} title="Auto Match" cancelLabel="Close">
        <View style={{ gap: space.sm }}>
          <Text style={[type.small, { color: colour.inkMuted }]}>Applies to every team that has a match, nothing else that day, and usually plays on this day. You can still change any team afterwards.</Text>
          <Button variant="secondary" label="Alternate Home and Away" onPress={() => applyBulk("alternate")} />
          <Button variant="secondary" label="All Home" onPress={() => applyBulk("home")} />
          <Button variant="secondary" label="All Away" onPress={() => applyBulk("away")} />
          <Button variant="quiet" label="Clear" onPress={() => applyBulk("clear")} />
        </View>
      </BottomSheet>

      <ChoiceSheet
        visible={sidePicker !== null}
        title={`${opponent?.name ?? "Their"} Team`}
        hint="Which of their teams this team plays."
        options={(sidePicker?.compatible ?? []).map((c) => ({ id: c.teamId, name: c.displayName }))}
        value={sidePicker ? (selections[sidePicker.teamId]?.targetTeamId ?? sidePicker.compatible[0]?.teamId ?? null) : null}
        emptyMessage=""
        onClose={() => setSidePicker(null)}
        onSave={(id) => {
          if (sidePicker && id) {
            const current = selections[sidePicker.teamId]
            planner.update({ selections: { ...selections, [sidePicker.teamId]: { targetTeamId: id, venue: current?.venue ?? "home", acknowledge: current?.acknowledge ?? false } } })
          }
          setSidePicker(null)
        }}
        saving={false}
        problem={null}
      />
    </View>
  )
}

function TeamRow({
  team,
  state,
  date,
  opponentName,
  opponentClubId,
  selection,
  acknowledged,
  onAcknowledge,
  onVenue,
  onPickSide,
  onOpen,
  onFindAnother,
  first,
}: {
  team: PlannerTeam
  state: TeamDayState
  date: string
  opponentName: string
  opponentClubId: string
  selection: PlannerSelection | null
  acknowledged: boolean
  onAcknowledge: (on: boolean) => void
  onVenue: (v: "home" | "away" | null) => void
  onPickSide: () => void
  onOpen: (c: PlannerCommitment) => void
  onFindAnother: () => void
  first: boolean
}) {
  const selectable = canSelect(state)
  const side = team.compatible.find((c) => c.teamId === selection?.targetTeamId) ?? team.compatible[0]
  const otherDays = otherDaysThisWeek(team, date)
  const earlier = team.withOpponent.filter((c) => c.date !== date && c.opponentClubId !== null && !(c.kind === "request_out" && c.status === "declined"))
  const toggleDisabled = !selectable || (state.kind === "pending_elsewhere" && !acknowledged)
  const blockedText = blockedSentence(state, opponentName, team.displayName)
  const tag = teamTag(state, otherDays, team, date, opponentClubId)

  return (
    <View style={{ padding: space.md, gap: space.sm, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line, backgroundColor: selectable ? colour.surface : colour.chalk }}>
      {/* The team's one word for this day, on its own line so it is read whole beside the Home/Away control. */}
      <View style={{ paddingLeft: 36 + space.md }}>
        <StateTag label={tag.label} tone={tag.tone} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <TeamIcon dim={!selectable} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={2} style={[type.bodyMedium, { color: selectable ? colour.ink : colour.inkMuted }]}>
            {team.displayName}
          </Text>
          {side && selectable && (
            team.compatible.length > 1 ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Plays ${opponentName} ${side.displayName}. Choose another of their teams`} onPress={onPickSide} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                <Text numberOfLines={1} style={[type.caption, { color: colour.rugby700 }]}>
                  v {side.displayName} · Change
                </Text>
                <ChevronDown size={14} color={colour.rugby700} />
              </Pressable>
            ) : (
              <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
                v {opponentName}
              </Text>
            )
          )}
        </View>
        {selectable && <HomeAwayToggle teamName={team.displayName} value={selection?.venue ?? null} disabled={toggleDisabled} onChange={onVenue} />}
        {!selectable && state.kind === "no_match" && <Info size={20} color={colour.inkSubtle} />}
      </View>

      {blockedText && (
        <View style={{ gap: 4, paddingLeft: 36 + space.md }}>
          <Text style={[type.small, { color: colour.inkMuted }]}>{blockedText}</Text>
          {"commitment" in state && (
            <Pressable accessibilityRole="link" onPress={() => onOpen(state.commitment)} hitSlop={6} style={{ alignSelf: "flex-start", minHeight: 32, justifyContent: "center" }}>
              <Text style={[type.smallMedium, { color: colour.forest800 }]}>{state.kind === "incoming_from_opponent" ? "Reply to Their Request" : "View"}</Text>
            </Pressable>
          )}
          {state.kind === "no_match" && (
            <Pressable accessibilityRole="link" onPress={onFindAnother} hitSlop={6} style={{ alignSelf: "flex-start", minHeight: 32, justifyContent: "center" }}>
              <Text style={[type.smallMedium, { color: colour.forest800 }]}>Find Another Club</Text>
            </Pressable>
          )}
        </View>
      )}

      {state.kind === "pending_elsewhere" && (
        <View style={{ paddingLeft: 36 + space.md, gap: 2 }}>
          <Text style={[type.small, { color: colour.warning }]}>
            Already has a pending request with {state.commitment.opponent ?? "another club"} that day. A team can only play once a day, so only one of them can be accepted.
          </Text>
          <ChoiceRow kind="checkbox" checked={acknowledged} label="Include Anyway" onPress={() => onAcknowledge(!acknowledged)} />
        </View>
      )}

      {(otherDays.length > 0 || earlier.length > 0) && selectable && (
        <View style={{ paddingLeft: 36 + space.md, gap: 2 }}>
          {otherDays.map((c) => (
            <Text key={c.refId} style={[type.caption, { color: colour.inkMuted }]}>
              Also playing {c.opponent ?? "a fixture"} · {shortMatchDate(c.date)}
            </Text>
          ))}
          {earlier.map((c) => (
            <Text key={`e${c.refId}`} style={[type.caption, { color: colour.inkMuted }]}>
              Already arranged with {opponentName}: {c.homeAway ?? ""} · {shortMatchDate(c.date)}
              {c.kind !== "fixture" ? " (request)" : ""}
            </Text>
          ))}
        </View>
      )}
    </View>
  )
}

/**
 * THE ONE WORD FOR A TEAM'S DAY -- so a club secretary never has to remember the season. Order matters: a fixture
 * that day outranks everything; a pairing already in hand with this club comes next; then the week around it.
 */
function teamTag(state: TeamDayState, otherDays: PlannerCommitment[], team: PlannerTeam, date: string, opponentClubId: string): { label: string; tone: "positive" | "caution" | "negative" | "neutral" | "info" } {
  switch (state.kind) {
    case "playing":
      return state.commitment.opponentClubId === opponentClubId ? { label: "Confirmed with this club", tone: "positive" } : { label: "Clash", tone: "negative" }
    case "competition":
      return { label: "Clash", tone: "negative" }
    case "already_with_opponent":
      return { label: "Request pending", tone: "info" }
    case "incoming_from_opponent":
      return { label: "They've asked you", tone: "info" }
    case "no_match":
      return { label: "No matching team", tone: "neutral" }
    case "pending_elsewhere":
      return { label: "Pending elsewhere", tone: "caution" }
    default: {
      const withThem = otherDays.find((c) => c.opponentClubId === opponentClubId)
      if (withThem) return { label: "Already playing this club this week", tone: "caution" }
      if (otherDays.length) return { label: "Fixture already booked this week", tone: "caution" }
      if (team.preferredDay && team.preferredDay !== isoWeekday(date)) return { label: `Usually plays ${DAY_NAMES[team.preferredDay - 1]}`, tone: "info" }
      if (team.compatible.length > 1) return { label: "Multiple matches", tone: "positive" }
      return { label: "Available", tone: "positive" }
    }
  }
}

function blockedSentence(state: TeamDayState, opponentName: string, teamName: string): string | null {
  switch (state.kind) {
    case "no_match":
      return `${opponentName} don't currently have a compatible ${teamName.replace(/ (Boys|Girls|Mixed|Team)$/i, "")} team registered on Ovalball, so it is left out of this Club Day.`
    case "playing":
      return `Already playing ${state.commitment.opponent ?? "another fixture"} that day${state.commitment.homeAway ? ` · ${state.commitment.homeAway}` : ""}.`
    case "competition":
      return `Has a competition match that day${state.commitment.opponent ? ` against ${state.commitment.opponent}` : ""}.`
    case "already_with_opponent":
      return `A request to ${opponentName} for this day is already open.`
    case "incoming_from_opponent":
      return `${opponentName} have already asked to play this team that day.`
    default:
      return null
  }
}


/**
 * EVERY PLAYING WEEK OF THE SEASON, in a list that scrolls inside the sheet -- the season runs to May, and a week in
 * March must be as reachable as next week. Grouped by month; it opens on the week already chosen.
 */
function WeekList({
  weeks,
  selected,
  summary,
  onChoose,
}: {
  weeks: { weekStart: string; matchDate: string }[]
  selected: string | null
  summary: (weekStart: string) => { confirmed: number; pending: number; incoming: number }
  onChoose: (weekStart: string) => void
}) {
  const { height } = useWindowDimensions()
  const scroller = useRef<ScrollView>(null)
  const scrolled = useRef(false)
  return (
    <ScrollView ref={scroller} style={{ maxHeight: Math.round(height * 0.58) }} contentContainerStyle={{ gap: space.sm, paddingBottom: space.sm }} showsVerticalScrollIndicator>
      {weeks.map((w, i) => {
        const s = summary(w.weekStart)
        const on = w.weekStart === selected
        const month = new Date(`${w.weekStart}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
        const newMonth = i === 0 || month !== new Date(`${weeks[i - 1].weekStart}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
        return (
          <View
            key={w.weekStart}
            style={{ gap: space.sm }}
            onLayout={(e) => {
              if (on && !scrolled.current) {
                scrolled.current = true
                scroller.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - 8), animated: false })
              }
            }}
          >
            {newMonth && (
              <Text accessibilityRole="header" style={[type.overline, { color: colour.inkMuted, marginTop: i === 0 ? 0 : space.sm }]}>
                {month.toUpperCase()}
              </Text>
            )}
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${weekCommencingLabel(w.weekStart)}, ${longMatchDate(w.matchDate)}: ${s.confirmed} confirmed, ${s.pending + s.incoming} pending`}
              onPress={() => onChoose(w.weekStart)}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, minHeight: TOUCH_TARGET + 12, borderRadius: radius.md, borderWidth: on ? 2 : 1, borderColor: on ? colour.pitch600 : colour.line, backgroundColor: pressed ? colour.mint100 : colour.surface })}
            >
              <View style={{ flex: 1 }}>
                <Text style={[type.bodyMedium, { color: colour.ink }]}>{weekCommencingLabel(w.weekStart)}</Text>
                <Text style={[type.caption, { color: colour.inkMuted }]}>{shortMatchDate(w.matchDate)}</Text>
              </View>
              <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ flexDirection: "row", gap: space.sm }}>
                <CountDot state="confirmed" count={s.confirmed} word="confirmed" />
                <CountDot state="pending" count={s.pending + s.incoming} word="pending" />
              </View>
            </Pressable>
          </View>
        )
      })}
    </ScrollView>
  )
}
