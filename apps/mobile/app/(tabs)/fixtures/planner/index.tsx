import { useMemo, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import {
  boardState,
  BOARD_STATE_LABEL,
  longMatchDate,
  seasonWeeks,
  shortMatchDate,
  summariseWeek,
  weekCommencingLabel,
  addDays,
  type BoardRow,
  type ClubDayListItem,
  type PlayingDays,
} from "@ovalball/contracts"

import { useAppContexts } from "../../../../src/context/contexts"
import { OvalballDetailHeader } from "../../../../src/components/app-header"
import { ClubCrest } from "../../../../src/components/identity"
import { CalendarDays, ChevronDown, ChevronRight, Plus } from "../../../../src/components/icons"
import { Button, EmptyState, ErrorState, Skeleton } from "../../../../src/components/ui"
import { BottomSheet } from "../../../../src/components/bottom-sheet"
import { ChoiceSheet } from "../../../../src/components/field-sheet"
import { Note, PhotoHero } from "../../../../src/people/ui"
import { useOriginBack } from "../../../../src/links/origin"
import { tabBarHeight } from "../../../../src/navigation/tab-bar-height"
import { useSeasonPlanner } from "../../../../src/season-planner/state"
import { defaultPlanningSeason, planningWeekday, todayIso, useClubDays, useClubPlannerTeams, usePlannerAccess, usePlannerSeasons, usePlayingDays, useSeasonBoard } from "../../../../src/season-planner/data"
import { ClubDayCard, CountDot, DAY_NAMES, PlannerCard, SectionLabel, SheetList, StatTile, StatePill } from "../../../../src/season-planner/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

const hero = require("../../../../assets/editorial/rugby-matchday.jpg")
const PREVIEW_WEEKS = 6

/**
 * SEASON PLANNER -- the club's season as rugby weeks, and the way into arranging a club day.
 *
 * A live board over canonical fixtures, requests and competition matches: nothing on it is the planner's own copy,
 * so a request accepted, declined or countered anywhere else is reflected the next time this screen is looked at.
 */
export default function SeasonPlannerHome() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const back = useOriginBack("/fixtures")
  const { club } = useAppContexts()
  const planner = useSeasonPlanner()
  const access = usePlannerAccess(planner.clubId)
  const seasons = usePlannerSeasons(planner.clubId)
  const { teams, problem: teamsProblem } = useClubPlannerTeams(planner.clubId)
  const today = todayIso()
  const season = useMemo(() => {
    if (!seasons) return null
    return seasons.find((s) => s.id === planner.draft?.seasonId) ?? defaultPlanningSeason(seasons, today)
  }, [seasons, planner.draft?.seasonId, today])
  const board = useSeasonBoard(access.allowed ? planner.clubId : null, season?.id ?? null)
  const playing = usePlayingDays(access.allowed ? planner.clubId : null, season?.id ?? null)
  const clubDays = useClubDays(access.allowed ? planner.clubId : null, season?.id ?? null)
  const { day: planningDay, configured: dayConfigured } = planningWeekday(playing.days)
  const [sheet, setSheet] = useState<"season" | null>(null)
  const [openWeek, setOpenWeek] = useState<string | null>(null)
  const [attentionOpen, setAttentionOpen] = useState(false)
  const [allWeeks, setAllWeeks] = useState(false)

  const teamIds = useMemo(() => (teams ?? []).map((t) => t.id), [teams])
  const weeks = useMemo(
    () => (season ? seasonWeeks(season.preSeasonStartsOn ?? season.startsOn, season.endsOn, planningDay, today) : []),
    [season, planningDay, today]
  )
  const futureRows = useMemo(() => (board.rows ?? []).filter((r) => r.date >= today), [board.rows, today])
  const summaries = useMemo(() => weeks.map((w) => summariseWeek(futureRows, w.weekStart, teamIds)), [weeks, futureRows, teamIds])
  const overview = useMemo(() => {
    let confirmed = 0
    let pending = 0
    let attention = 0
    for (const row of futureRows) {
      const state = boardState(row)
      if (state === "confirmed" || state === "planned") confirmed += 1
      else if (state === "pending" || state === "incoming") pending += 1
      else if (state === "declined" || state === "countered") attention += 1
    }
    // UNFILLED IS THE NEAR TERM: team-weeks with nothing in the weeks shown below, not a season-sized number.
    return { confirmed, pending, attention, unfilled: summaries.slice(0, PREVIEW_WEEKS).reduce((n, s) => n + s.unfilled, 0) }
  }, [futureRows, summaries])
  // Answers waiting for THIS club first, then this club's own days still in play, nearest first.
  const shownClubDays = useMemo(() => {
    const live = (clubDays.days ?? []).filter((d) => d.date >= today)
    const order = (d: ClubDayListItem) => (d.direction === "received" && d.pending + d.countered > 0 ? 0 : 1)
    return [...live].sort((a, b) => order(a) - order(b) || a.date.localeCompare(b.date)).slice(0, 5)
  }, [clubDays.days, today])

  function planWeek(weekStart?: string, matchDate?: string) {
    planner.startClubDay({ seasonId: season?.id ?? null, weekStart: weekStart ?? null, matchDate: matchDate ?? null })
    router.push("/fixtures/planner/day")
  }

  function openRow(row: BoardRow) {
    setOpenWeek(null)
    if (row.kind === "fixture") router.push({ pathname: "/fixtures/[fixtureId]", params: { fixtureId: row.refId, returnTo: "/fixtures/planner" } } as never)
    else if (row.groupId) router.push({ pathname: "/fixtures/request/[groupId]", params: { groupId: row.groupId, ...(row.kind === "request_out" || row.kind === "request_in" ? { requestId: row.refId } : {}), returnTo: "/fixtures/planner" } } as never)
  }

  const header = (
    <OvalballDetailHeader
      title="Season Planner"
      onBack={back}
      identity={{ avatar: <ClubCrest clubName={club?.name ?? null} url={club?.crestUrl ?? null} size={36} />, subtitle: club?.name ?? null }}
    />
  )

  if (!planner.clubId || (!access.loading && !access.allowed)) {
    return (
      <View style={{ flex: 1, backgroundColor: colour.chalk }}>
        {header}
        <View style={{ padding: space.lg }}>
          <EmptyState
            title="Season planning is for the club's fixture administrators"
            body={planner.clubId ? "Planning club days is part of the Club Admin and Fixture Secretary roles. A team can still request a single fixture from Fixtures." : "Switch to your club to plan its season."}
            icon={<CalendarDays size={28} color={colour.forest800} />}
          />
        </View>
      </View>
    )
  }

  const shownWeeks = allWeeks ? weeks : weeks.slice(0, PREVIEW_WEEKS)
  const week = openWeek ? weeks.find((w) => w.weekStart === openWeek) ?? null : null

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      {header}
      <ScrollView contentContainerStyle={{ paddingBottom: tabBarHeight(insets.bottom) + space.xl }}>
        <PhotoHero image={hero} title="Season Planner" body="Arrange club days, send fixture requests and keep the season on track." height={190} />

        <View style={{ padding: space.lg, gap: space.xl }}>
          <PlannerCard padded={false}>
            <SelectRow label="Season" value={season?.name ?? (seasons ? "No season set up" : "Loading…")} onPress={() => setSheet("season")} first />
            <SelectRow
              label="Playing Days"
              value={dayConfigured ? playingDaysSummary(playing.days) : "Not set yet"}
              onPress={() => router.push({ pathname: "/fixtures/planner/playing-days" as never, params: { seasonId: season?.id ?? "" } })}
            />
            <View style={{ padding: space.md }}>
              <Button variant="brand" label="Plan a Club Day" icon={<Plus size={18} color={colour.onForest} strokeWidth={2.4} />} onPress={() => planWeek()} disabled={!season} />
            </View>
          </PlannerCard>

          {/* AN INTERRUPTED PLAN IS NOT LOST: the club day in progress (kept on this device for this person and this
              club) is offered back before anything starts afresh. */}
          {!!planner.draft?.opponent && Object.keys(planner.draft.selections).length > 0 && !!planner.draft.matchDate && (
            <PlannerCard>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <ClubCrest clubName={planner.draft.opponent.name} url={planner.draft.opponent.crestUrl} size={40} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[type.bodyMedium, { color: colour.ink }]}>Continue Planning</Text>
                  <Text numberOfLines={2} style={[type.small, { color: colour.inkMuted }]}>
                    {planner.draft.mode === "return" ? "Return club day" : "Club day"} with {planner.draft.opponent.name} · {shortMatchDate(planner.draft.matchDate)} · {Object.keys(planner.draft.selections).length} {Object.keys(planner.draft.selections).length === 1 ? "team" : "teams"}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.md }}>
                <View style={{ flex: 1 }}>
                  <Button variant="quiet" label="Discard" onPress={() => planner.startClubDay({ seasonId: season?.id ?? null })} />
                </View>
                <View style={{ flex: 2 }}>
                  <Button variant="secondary" label="Continue" onPress={() => router.push(planner.draft?.mode === "return" ? "/fixtures/planner/review" : "/fixtures/planner/day")} />
                </View>
              </View>
            </PlannerCard>
          )}

          {/* A SEASON NOT YET HANDED OVER is planned with today's teams -- said plainly, never invented. */}
          {playing.days?.seasonStructure === "not_finalised" && season && (
            <Note tone="warning">
              <Text style={[type.small, { color: colour.ink }]}>
                Team structure for {season.name} has not been finalised yet. This plan currently uses the club's present team structure.
              </Text>
            </Note>
          )}
          {!dayConfigured && playing.days && (
            <Note>
              <Text style={[type.small, { color: colour.ink }]}>Set your club's playing days so weeks open on the right day. Until then, weeks show Sunday.</Text>
            </Note>
          )}

          {seasons && !season && <ErrorState message="There is no current or upcoming season in Ovalball's season calendar for your club's rugby code yet." />}
          {!!(board.problem || teamsProblem) && <ErrorState message={board.problem ?? teamsProblem ?? ""} onRetry={() => void board.reload()} />}

          {season && (
            <View style={{ gap: space.md }}>
              <SectionLabel title="Season Overview" />
              {board.rows === null || teams === null ? (
                <Skeleton height={84} />
              ) : (
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <StatTile value={overview.confirmed} label="Confirmed" state="confirmed" />
                  <StatTile value={overview.pending} label="Pending" state="pending" />
                  <StatTile value={overview.unfilled} label="Unfilled" state="unfilled" />
                  <StatTile
                    value={overview.attention}
                    label="Need attention"
                    state="declined"
                    hint={overview.attention > 0 ? "Shows the declined requests and suggested dates" : undefined}
                    onPress={overview.attention > 0 ? () => setAttentionOpen(true) : undefined}
                  />
                </View>
              )}
              <Text style={[type.caption, { color: colour.inkMuted }]}>
                From today. Unfilled counts teams with nothing arranged in the next {Math.min(PREVIEW_WEEKS, weeks.length)} playing weeks. Need attention counts declined requests and suggested dates still to answer.
              </Text>
            </View>
          )}

          {shownClubDays.length > 0 && (
            <View style={{ gap: space.md }}>
              <SectionLabel title="Club Days" />
              <View style={{ gap: space.sm }}>
                {shownClubDays.map((d) => (
                  <ClubDayCard key={d.groupId} day={d} onPress={() => router.push({ pathname: "/fixtures/planner/club-day/[groupId]", params: { groupId: d.groupId, returnTo: "/fixtures/planner" } } as never)} />
                ))}
              </View>
            </View>
          )}

          {season && (
            <View style={{ gap: space.md }}>
              <SectionLabel
                title="Upcoming Weeks"
                action={
                  weeks.length > PREVIEW_WEEKS ? (
                    <Pressable accessibilityRole="button" onPress={() => setAllWeeks((v) => !v)} hitSlop={8} style={{ minHeight: TOUCH_TARGET, justifyContent: "center" }}>
                      <Text style={[type.smallMedium, { color: colour.forest800 }]}>{allWeeks ? "Show Fewer" : "View All"}</Text>
                    </Pressable>
                  ) : undefined
                }
              />
              {weeks.length === 0 ? (
                <EmptyState title="No weeks left to plan" body="Every playing week of this season has passed." icon={<CalendarDays size={28} color={colour.forest800} />} />
              ) : (
                <PlannerCard padded={false}>
                  {shownWeeks.map((w, i) => {
                    const s = summaries[weeks.indexOf(w)]
                    return (
                      <Pressable
                        key={w.weekStart}
                        accessibilityRole="button"
                        accessibilityLabel={`${weekCommencingLabel(w.weekStart)}, ${longMatchDate(w.matchDate)}: ${s.confirmed} confirmed, ${s.pending} pending, ${s.unfilled} unfilled${s.needsAttention ? `, ${s.needsAttention} need attention` : ""}`}
                        onPress={() => setOpenWeek(w.weekStart)}
                        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? colour.chalk : colour.surface })}
                      >
                        <CalendarDays size={22} color={colour.forest800} strokeWidth={1.8} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[type.bodyMedium, { color: colour.ink }]}>{weekCommencingLabel(w.weekStart)}</Text>
                          <Text style={[type.caption, { color: colour.inkMuted }]}>{shortMatchDate(w.matchDate)}</Text>
                        </View>
                        <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ flexDirection: "row", gap: space.sm }}>
                          <CountDot state="confirmed" count={s.confirmed} word="confirmed" />
                          <CountDot state="pending" count={s.pending + s.incoming} word="pending" />
                          {s.needsAttention > 0 && <CountDot state="declined" count={s.needsAttention} word="need attention" />}
                          <CountDot state="unfilled" count={s.unfilled} word="unfilled" />
                        </View>
                        <ChevronRight size={18} color={colour.inkSubtle} />
                      </Pressable>
                    )
                  })}
                </PlannerCard>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      <ChoiceSheet
        visible={sheet === "season"}
        title="Season"
        options={(seasons ?? []).map((s) => ({ id: s.id, name: s.name, detail: `${longMatchDate(s.preSeasonStartsOn ?? s.startsOn)} to ${longMatchDate(s.endsOn)}` }))}
        value={season?.id ?? null}
        emptyMessage="No seasons are set up for your club's rugby code."
        onClose={() => setSheet(null)}
        onSave={(id) => {
          planner.update({ seasonId: id })
          setSheet(null)
        }}
        saving={false}
        problem={null}
      />
      <BottomSheet visible={week !== null} onClose={() => setOpenWeek(null)} title={week ? `${weekCommencingLabel(week.weekStart)} · ${shortMatchDate(week.matchDate)}` : ""} cancelLabel="Close">
        {week && (
          <View style={{ gap: space.sm }}>
            <SheetList>
            {(teams ?? []).map((team) => {
              const rows = futureRows.filter((r) => r.teamId === team.id && r.date >= week.weekStart && r.date <= addDays(week.weekStart, 6))
              const row = rows.find((r) => boardState(r) !== "declined") ?? rows[0]
              const state = row ? boardState(row) : null
              return (
                <Pressable
                  key={team.id}
                  accessibilityRole={row ? "button" : "text"}
                  disabled={!row}
                  onPress={row ? () => openRow(row) : undefined}
                  style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: pressed ? colour.mint100 : colour.surface, borderWidth: 1, borderColor: colour.line })}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[type.bodyMedium, { color: colour.ink }]}>{team.displayName}</Text>
                    <Text numberOfLines={2} style={[type.caption, { color: colour.inkMuted }]}>
                      {row ? [row.opponent, row.homeAway, shortMatchDate(row.date)].filter(Boolean).join(" · ") : "Nothing arranged this week"}
                    </Text>
                  </View>
                  {state ? <StatePill state={state} label={BOARD_STATE_LABEL[state]} /> : <StatePill state="unfilled" label="Unfilled" />}
                </Pressable>
              )
            })}
            </SheetList>
            <Button variant="brand" label="Plan This Week" onPress={() => { const w = week; setOpenWeek(null); planWeek(w.weekStart, w.matchDate) }} />
          </View>
        )}
      </BottomSheet>

      <BottomSheet visible={attentionOpen} onClose={() => setAttentionOpen(false)} title="Need Attention" cancelLabel="Close">
        <View style={{ gap: space.sm }}>
          <Text style={[type.small, { color: colour.inkMuted }]}>Requests the other club declined, and dates suggested that still need an answer. Open one to deal with it.</Text>
          <SheetList>
            {futureRows
              .filter((r) => {
                const st = boardState(r)
                return st === "declined" || st === "countered"
              })
              .map((row) => {
                const st = boardState(row)
                const team = (teams ?? []).find((t) => t.id === row.teamId)
                return (
                  <Pressable
                    key={`${row.kind}-${row.refId}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${team?.displayName ?? "Team"} against ${row.opponent ?? "the other club"}, ${shortMatchDate(row.date)}: ${BOARD_STATE_LABEL[st]}. Opens it`}
                    onPress={() => {
                      setAttentionOpen(false)
                      openRow(row)
                    }}
                    style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, minHeight: 56, borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: pressed ? colour.mint100 : colour.surface })}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[type.bodyMedium, { color: colour.ink }]}>{team?.displayName ?? "Team"}</Text>
                      <Text numberOfLines={2} style={[type.caption, { color: colour.inkMuted }]}>
                        {[row.opponent, shortMatchDate(row.date)].filter(Boolean).join(" · ")}
                      </Text>
                    </View>
                    <StatePill state={st} label={BOARD_STATE_LABEL[st]} />
                  </Pressable>
                )
              })}
          </SheetList>
        </View>
      </BottomSheet>
    </View>
  )
}

function playingDaysSummary(days: PlayingDays | null): string {
  if (!days) return "Loading…"
  const club = days.clubDefault ? DAY_NAMES[days.clubDefault - 1] : null
  const other = new Set(days.teams.filter((t) => t.effective && t.effective !== days.clubDefault).map((t) => DAY_NAMES[(t.effective as number) - 1]))
  if (!club) return [...other].join(", ") || "Not set yet"
  return other.size ? `${club}, some teams ${[...other].join(" or ")}` : club
}

function SelectRow({ label, value, onPress, first = false }: { label: string; value: string; onPress: () => void; first?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityHint="Changes it"
      onPress={onPress}
      style={({ pressed }) => ({ paddingHorizontal: space.md, paddingVertical: 10, gap: 4, borderTopWidth: first ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? colour.chalk : colour.surface })}
    >
      <Text style={[type.caption, { color: colour.inkMuted }]}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 28 }}>
        <CalendarDays size={18} color={colour.forest800} />
        <Text style={[type.bodyMedium, { color: colour.ink, flex: 1 }]}>{value}</Text>
        <ChevronDown size={18} color={colour.inkMuted} />
      </View>
    </Pressable>
  )
}
