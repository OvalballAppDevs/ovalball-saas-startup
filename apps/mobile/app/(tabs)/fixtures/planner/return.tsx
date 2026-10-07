import { useEffect, useMemo, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { mondayOfWeek, newClientMessageId, returnPairings, shortMatchDate, type ClubDayFixtureStatus, type ReturnPairing } from "@ovalball/contracts"

import { OvalballDetailHeader } from "../../../../src/components/app-header"
import { ArrowRight, Check, ChevronRight, Repeat } from "../../../../src/components/icons"
import { Button, ErrorState, Skeleton } from "../../../../src/components/ui"
import { useSeasonPlanner } from "../../../../src/season-planner/state"
import { defaultPlanningSeason, planningWeekday, todayIso, useClubDayDetail, usePlannerSeasons, usePlayingDays, useSeasonBoard } from "../../../../src/season-planner/data"
import { ForestSteps, OpponentCard, PlannerCard, SectionLabel, SeasonMonthCalendar, StateTag } from "../../../../src/season-planner/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

const PREVIOUS: Record<ClubDayFixtureStatus, { label: string; tone: "positive" | "caution" | "negative" | "neutral" }> = {
  accepted: { label: "Previous request: accepted", tone: "positive" },
  declined: { label: "Previous request: declined", tone: "negative" },
  sent: { label: "First request still awaiting", tone: "caution" },
  counter_proposed: { label: "First request: new date suggested", tone: "caution" },
  cancelled: { label: "First request withdrawn", tone: "neutral" },
  expired: { label: "First request expired", tone: "neutral" },
  draft: { label: "Not sent", tone: "neutral" },
}

/**
 * THE RETURN CLUB DAY -- the same pairings as a club day already sent, Home and Away reversed.
 *
 * Read from the server's own record of that club day (it survives a relaunch), every pairing is offered with what
 * happened to it the first time: a fixture the other club declined is still offered -- they may say yes to the
 * return -- but it says so, and the organiser can leave it out. A return is always a new request: nothing is agreed
 * until the other club confirms it, and the date is re-checked team by team before anything is sent.
 */
export default function PlanReturnDay() {
  const router = useRouter()
  const params = useLocalSearchParams<{ groupId?: string }>()
  const planner = useSeasonPlanner()
  const firstGroupId = params.groupId || planner.draft?.reverseOfGroupId || planner.draft?.firstLeg?.groupId || null
  const { detail, problem, reload } = useClubDayDetail(firstGroupId)
  const seasons = usePlannerSeasons(planner.clubId)
  const today = todayIso()
  const season = useMemo(() => (seasons ? (seasons.find((s) => detail && s.startsOn <= detail.date && s.endsOn >= detail.date) ?? defaultPlanningSeason(seasons, today)) : null), [seasons, detail, today])
  const board = useSeasonBoard(planner.clubId, season?.id ?? null)
  const playing = usePlayingDays(planner.clubId, season?.id ?? null)
  const { day: planningDay } = planningWeekday(playing.days)

  const [pairings, setPairings] = useState<ReturnPairing[] | null>(null)
  useEffect(() => {
    if (detail && pairings === null) setPairings(returnPairings(detail))
  }, [detail, pairings])
  const included = (pairings ?? []).filter((p) => p.include)

  const pressure = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of board.rows ?? []) if (row.status !== "declined") map.set(row.date, (map.get(row.date) ?? 0) + 1)
    return map
  }, [board.rows])
  const defaultAnchor = useMemo(() => {
    if (!detail) return today
    const d = new Date(`${detail.date}T12:00:00Z`)
    d.setUTCMonth(d.getUTCMonth() + 3)
    const iso = d.toISOString().slice(0, 10)
    return season && iso > season.endsOn ? season.endsOn : iso
  }, [detail, season, today])
  const [anchor, setAnchor] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  function continueWith(date: string) {
    if (!detail || !planner.draft) return
    planner.update({
      mode: "return",
      seasonId: season?.id ?? planner.draft.seasonId,
      reverseOfGroupId: detail.groupId,
      opponent: { directoryId: "", clubId: detail.opponentClub.id, name: detail.opponentClub.name, town: null, crestUrl: null, onOvalball: true },
      matchDate: date,
      weekStart: mondayOfWeek(date),
      batchId: newClientMessageId(),
      selections: Object.fromEntries(included.map((p) => [p.requestingTeamId, { targetTeamId: p.targetTeamId, venue: p.venue, acknowledge: false }])),
    })
    router.push("/fixtures/planner/review")
  }

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader title="Plan Return Club Day" onBack={() => (router.canGoBack() ? router.back() : router.replace("/fixtures/planner" as never))} />
      <ForestSteps labels={["Reverse", "Return Date", "Review", "Send"]} current={selected ? 1 : 0} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}>
        {problem && <ErrorState message={problem} onRetry={() => void reload()} />}
        {!detail && !problem && <Skeleton height={240} />}

        {detail && (
          <>
            <PlannerCard>
              <OpponentCard opponent={{ directoryId: "", clubId: detail.opponentClub.id, name: detail.opponentClub.name, town: null, crestUrl: null, onOvalball: true }} />
              <Text style={[type.small, { color: colour.inkMuted, marginTop: space.sm }]}>
                First club day: {shortMatchDate(detail.date)} · {detail.fixtures.length} {detail.fixtures.length === 1 ? "fixture" : "fixtures"}
              </Text>
            </PlannerCard>

            <View style={{ gap: space.md }}>
              <SectionLabel title="Reverse Fixture" />
              <View style={{ flexDirection: "row", gap: space.md, padding: space.md, borderRadius: radius.lg, backgroundColor: colour.successSurface, borderWidth: 1, borderColor: colour.line }}>
                <Repeat size={20} color={colour.rugby700} />
                <Text style={[type.small, { color: colour.ink, flex: 1 }]}>
                  Home and Away are reversed for every pairing in the first club day. Each is a new request {detail.opponentClub.name} must confirm.
                </Text>
              </View>
              <PlannerCard padded={false}>
                {(pairings ?? []).map((p, i) => {
                  const prev = PREVIOUS[p.previousStatus]
                  return (
                    <Pressable
                      key={p.requestingTeamId}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: p.include }}
                      accessibilityLabel={`${p.requestingTeam}: ${p.venue === "home" ? "Away" : "Home"} first, ${p.venue === "home" ? "Home" : "Away"} for the return. ${prev.label}`}
                      onPress={() => setPairings((list) => (list ?? []).map((x) => (x.requestingTeamId === p.requestingTeamId ? { ...x, include: !x.include } : x)))}
                      style={({ pressed }) => ({ gap: space.xs, padding: space.md, minHeight: TOUCH_TARGET + 16, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? colour.chalk : p.include ? colour.surface : colour.chalk })}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                        <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: p.include ? colour.forest800 : colour.lineStrong, backgroundColor: p.include ? colour.forest800 : colour.surface, alignItems: "center", justifyContent: "center" }}>
                          {p.include && <Check size={15} color={colour.onForest} strokeWidth={3} />}
                        </View>
                        <Text numberOfLines={2} style={[type.bodyMedium, { flex: 1, minWidth: 0, color: p.include ? colour.ink : colour.inkMuted }]}>
                          {p.requestingTeam}
                        </Text>
                        <Text style={[type.small, { color: colour.inkMuted }]}>{p.venue === "home" ? "Away" : "Home"}</Text>
                        <ArrowRight size={14} color={colour.inkSubtle} />
                        <View style={{ paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: p.include ? colour.mint100 : colour.chalk }}>
                          <Text style={[type.smallMedium, { color: p.include ? colour.rugby700 : colour.inkMuted }]}>{p.venue === "home" ? "Home" : "Away"}</Text>
                        </View>
                      </View>
                      {/* What happened the first time, on its own line so it is read whole -- never a reason to hide the pairing. */}
                      <View style={{ paddingLeft: 24 + space.md }}>
                        <StateTag label={prev.label} tone={prev.tone} />
                      </View>
                    </Pressable>
                  )
                })}
              </PlannerCard>
            </View>

            <View style={{ gap: space.md }}>
              <SectionLabel title="Choose a Date for the Return" />
              {!season || board.rows === null ? (
                <Skeleton height={320} />
              ) : (
                <SeasonMonthCalendar
                  anchor={anchor ?? defaultAnchor}
                  onAnchor={setAnchor}
                  selected={selected}
                  onSelect={setSelected}
                  seasonStart={season.preSeasonStartsOn ?? season.startsOn}
                  seasonEnd={season.endsOn}
                  today={today}
                  playingDay={planningDay}
                  pressure={pressure}
                />
              )}
            </View>
          </>
        )}
      </ScrollView>
      <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md, borderTopWidth: 1, borderTopColor: colour.line, backgroundColor: colour.chalk }}>
        <Button
          variant="brand"
          label={
            !selected
              ? "Choose a Date"
              : `Review ${included.length} Return ${included.length === 1 ? "Request" : "Requests"} · ${new Date(`${selected}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`
          }
          disabled={!selected || included.length === 0}
          accessibilityHint={included.length === 0 ? "Include at least one pairing" : undefined}
          trailing={<ChevronRight size={18} color={colour.onForest} />}
          onPress={() => selected && continueWith(selected)}
        />
      </View>
    </View>
  )
}
