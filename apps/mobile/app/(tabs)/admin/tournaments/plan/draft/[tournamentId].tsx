import { useCallback, useEffect, useMemo, useState } from "react"
import { Modal, Pressable, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router"

import { clubLogoUrlFromPath } from "@ovalball/contracts/club-logo"
import {
  draftDayLabel,
  draftDays,
  readRegenerationCost,
  readTournamentPlanDraft,
  regenerationWarning,
  type DraftDayGroup,
  type DraftGame,
  type DraftTableGroup,
  type RegenerationCost,
  type TournamentPlanDraft,
} from "@ovalball/contracts/tournaments/planning"
import { formatHasBracket, formatHasKnockoutStage, generateKnockoutFixtures, readTournamentBracket, type TournamentBracket } from "@ovalball/contracts/tournaments/knockout"
import {
  READINESS_ACTION_LABEL,
  primaryReadinessAction,
  publishTournamentPlan,
  updateDrawMembership,
  type PlanReadiness,
  type ReadinessAction,
} from "@ovalball/contracts/tournaments/readiness"
import {
  byTime,
  conflictsFor,
  fromMinutes,
  gameContext,
  gameTitle,
  moveProblem,
  pitchAreasNote,
  pitchesOnDay,
  placementOf,
  readPlanSchedule,
  savePlanSchedule,
  scheduleConflicts,
  shortDay,
  toMinutes,
  unplaced,
  type PlanSchedule,
  type ScheduleConflict,
  type ScheduleGame,
  type ScheduleMove,
  type ScheduleSide,
} from "@ovalball/contracts/tournaments/schedule"

import { supabase } from "../../../../../../src/auth/supabase"
import { OvalballDetailHeader } from "../../../../../../src/components/app-header"
import { TimeField } from "../../../../../../src/components/form"
import { ClubCrest } from "../../../../../../src/components/identity"
import {
  CalendarDays,
  CalendarSync,
  CircleCheck,
  Clock,
  Lock,
  MapPin,
  Megaphone,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  TriangleAlert,
  Undo2,
  Users,
} from "../../../../../../src/components/icons"
import { Button, Card, CardSkeleton, EmptyState, ErrorState, InfoNote, StatusPill } from "../../../../../../src/components/ui"
import { friendlyRefusal as friendly, logDetail } from "../../../../../../src/errors/translate"
import { useTabBarHeight } from "../../../../../../src/navigation/use-tab-bar-height"
import { Sheet } from "../../../../../../src/pitch-allocation/sheets"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../../../src/design/tokens"
import { TournamentBracketView } from "../../../../../../src/tournaments/bracket"
import { SwissDraftCard } from "../../../../../../src/tournaments/swiss-stage"
import { ReadinessPanel } from "../../../../../../src/tournaments/readiness-panel"

/**
 * THE TOURNAMENT PLAN -- View Plan and Edit Plan for one competition (20270736).
 *
 * ONE SCREEN FOR THE PLAN, WHATEVER STATE IT IS IN. It used to be the "Generated Draft Plan", which
 * called a published plan a draft and told the organiser only their club could see games every parent
 * already had. It now says what the plan is -- Draft, Published, In Progress -- and is where the plan is
 * read and changed. The first-time wizard is for building a plan, never for looking at one.
 *
 * BY TIME FIRST, because that is what an organiser holds at the pitches: "at 10:15, who is on which
 * pitch". Each kick-off is set on a running-order rail, with the games at it beside it, by pitch. BY
 * TABLE is the competition's own shape (table, round, games), and a knockout's is its draw. Two views of
 * the same rows, not two plans.
 *
 * EDIT PLAN CHANGES IT WITHOUT REGENERATING. Tap a game: day, kick-off, pitch and length, checked as you
 * choose them against the same rules the server enforces -- two games on a whole pitch, a team in two
 * places, a pitch too small, a round before the round it follows, a pitch not reserved -- in the
 * server's own sentence. Moves are staged; Save Changes sends them as one arrangement (so two games can
 * swap), and once the plan is published only the teams whose games moved are told, once each.
 *
 * EVERYTHING ON IT IS A REAL ROW: `get_tournament_plan_schedule` and `get_tournament_plan_draft` read the
 * canonical tables, and nothing here invents a time, a pitch or a side.
 */
export default function TournamentPlan() {
  const router = useRouter()
  const navigation = useNavigation()
  const tabBar = useTabBarHeight()
  const { tournamentId, ageGroup, preview, mode } = useLocalSearchParams<{ tournamentId: string; ageGroup?: string; preview?: string; mode?: string }>()
  const id = String(tournamentId ?? "")
  const grade = String(ageGroup ?? "")
  const isPreview = String(preview ?? "") === "1"

  const [draft, setDraft] = useState<TournamentPlanDraft | null>(null)
  const [schedule, setSchedule] = useState<PlanSchedule | null>(null)
  const [bracket, setBracket] = useState<TournamentBracket | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cost, setCost] = useState<RegenerationCost | null>(null)
  const [confirmPublish, setConfirmPublish] = useState(false)

  const [view, setView] = useState<"time" | "table">("time")
  const [pitchFilter, setPitchFilter] = useState<string | null>(null)
  const [editing, setEditing] = useState(String(mode ?? "") === "edit")
  useEffect(() => {
    if (String(mode ?? "") === "edit") setEditing(true)
  }, [mode])
  const [staged, setStaged] = useState<Map<string, ScheduleMove>>(new Map())
  const [sheetGame, setSheetGame] = useState<ScheduleGame | null>(null)
  const [leave, setLeave] = useState<null | (() => void)>(null)

  const load = useCallback(async () => {
    if (!id || !grade) return
    setProblem(null)
    try {
      const next = await readTournamentPlanDraft(supabase, id, grade, isPreview)
      setDraft(next)
      setSchedule(next?.plan && !isPreview ? await readPlanSchedule(supabase, next.plan.id) : null)
      // A KNOCKOUT'S SHAPE IS ITS DRAW, read from the one bracket authority -- for a hybrid, beneath its tables.
      setBracket(formatHasKnockoutStage(next?.format) && !isPreview ? await readTournamentBracket(supabase, id, grade) : null)
    } catch (caught) {
      const failure = friendly(caught, "this plan")
      logDetail("tournament plan", failure)
      setProblem(failure.message)
    }
  }, [id, grade, isPreview])

  // RE-READ ON EVERY ARRIVAL -- unless moves are staged, which a re-read would silently throw away.
  useFocusEffect(
    useCallback(() => {
      if (staged.size === 0) void load()
    }, [load, staged.size])
  )

  // NOTHING STAGED IS LOST BY LEAVING: Back, a swipe or a tab change asks first.
  const dirty = staged.size > 0
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (event) => {
      if (!dirty) return
      event.preventDefault()
      setLeave(() => () => navigation.dispatch(event.data.action))
    })
    return unsubscribe
  }, [navigation, dirty])

  const conflicts = useMemo(() => (schedule ? scheduleConflicts(schedule, staged) : []), [schedule, staged])
  const blockingSave = useMemo(() => conflicts.filter((c) => c.unitIds.some((u) => staged.has(u))), [conflicts, staged])
  const gameById = useMemo(() => new Map((schedule?.games ?? []).map((g) => [g.id, g])), [schedule])

  async function askToRegenerate() {
    if (!draft?.plan) return
    try {
      setCost(await readRegenerationCost(supabase, draft.plan.id))
    } catch (caught) {
      const failure = friendly(caught, "this plan")
      logDetail("tournament regeneration cost", failure)
      setProblem(failure.message)
    }
  }

  async function regenerate() {
    if (!draft?.plan) return
    setCost(null)
    setBusy(true)
    setProblem(null)
    try {
      if (formatHasBracket(draft.format)) {
        await generateKnockoutFixtures(supabase, draft.plan.id)
      } else {
        const { error } = await supabase.rpc("generate_tournament_plan_fixtures", { p_plan_id: draft.plan.id })
        if (error) throw error
      }
      await load()
    } catch (caught) {
      const failure = friendly(caught, "these fixtures")
      logDetail("tournament regenerate", failure)
      setProblem(failure.message)
    } finally {
      setBusy(false)
    }
  }

  async function publish() {
    if (!draft?.plan) return
    setConfirmPublish(false)
    setBusy(true)
    setProblem(null)
    try {
      await publishTournamentPlan(supabase, draft.plan.id)
      setNotice("Published. Every participating team has been told.")
      await load()
    } catch (caught) {
      const failure = friendly(caught, "this plan")
      logDetail("tournament publish", failure)
      setProblem(failure.message)
    } finally {
      setBusy(false)
    }
  }

  async function bringDrawUpToDate() {
    if (!draft?.plan) return
    setBusy(true)
    setProblem(null)
    try {
      await updateDrawMembership(supabase, draft.plan.id)
      await load()
    } catch (caught) {
      const failure = friendly(caught, "the draw")
      logDetail("tournament draw membership", failure)
      setProblem(failure.message)
    } finally {
      setBusy(false)
    }
  }

  /** SAVE CHANGES: every staged move, one write, one arrangement. */
  async function saveChanges(after?: () => void) {
    if (!schedule || staged.size === 0) return
    setBusy(true)
    setProblem(null)
    try {
      const n = staged.size
      await savePlanSchedule(supabase, schedule, staged)
      setStaged(new Map())
      setEditing(false)
      setNotice(
        schedule.publicationState === "PUBLISHED"
          ? `${n} ${n === 1 ? "change" : "changes"} saved. The teams in the moved games have been told.`
          : `${n} ${n === 1 ? "change" : "changes"} saved.`
      )
      await load()
      after?.()
    } catch (caught) {
      const failure = friendly(caught, "this plan")
      logDetail("tournament plan save", failure)
      setProblem(failure.message)
    } finally {
      setBusy(false)
    }
  }

  function discard() {
    setStaged(new Map())
    setEditing(false)
    setNotice(null)
  }

  function stageMove(game: ScheduleGame, move: ScheduleMove) {
    setStaged((prev) => {
      const next = new Map(prev)
      const unchanged =
        move.date === game.date && move.startTime === game.startTime && move.pitchId === game.pitchId && move.durationMinutes === game.durationMinutes
      if (unchanged) next.delete(game.id)
      else next.set(game.id, move)
      return next
    })
    setSheetGame(null)
  }

  function unstage(game: ScheduleGame) {
    setStaged((prev) => {
      const next = new Map(prev)
      next.delete(game.id)
      return next
    })
    setSheetGame(null)
  }

  /** Every route a readiness item can name, taken to the one place that fixes it. */
  function act(action: ReadinessAction | "publish") {
    const plan = { pathname: "/admin/tournaments/plan/[tournamentId]", params: { tournamentId: id, ageGroup: grade } }
    switch (action) {
      case "publish": setConfirmPublish(true); return
      case "edit_schedule": setEditing(true); setView("time"); return
      case "pitches":
      case "schedule":
        router.push({ pathname: "/admin/tournaments/plan/pitches/[tournamentId]", params: { tournamentId: id, ageGroup: grade } } as never)
        return
      case "regenerate":
      case "generate": void askToRegenerate(); return
      case "draw_update": void bringDrawUpToDate(); return
      case "teams":
        router.push({ pathname: "/admin/tournaments/[tournamentId]", params: { tournamentId: id, tab: "teams" } } as never)
        return
      case "days": router.push({ ...plan, params: { ...plan.params, step: "0" } } as never); return
      case "tables":
      case "rounds":
      case "draw": router.push({ ...plan, params: { ...plan.params, step: "1" } } as never); return
      case "qualifiers":
      case "schedule_settings": router.push({ ...plan, params: { ...plan.params, step: "2" } } as never); return
      case "venue":
        router.push({ pathname: "/admin/tournaments/[tournamentId]", params: { tournamentId: id } } as never)
        return
      default: return
    }
  }

  /** THE CALENDAR ON THE COMPETITION'S FIRST DAY, with the festival on it -- not today, empty. */
  function viewCalendar() {
    const day = schedule?.days[0] ?? draft?.plan?.days[0] ?? null
    router.push({ pathname: "/calendar", params: day ? { date: day, at: String(Date.now()) } : {} } as never)
  }

  const header = (
    <OvalballDetailHeader
      title={isPreview ? "Example Fixtures" : "Tournament Plan"}
      onBack={() => (router.canGoBack() ? router.back() : router.replace("/admin/tournaments" as never))}
    />
  )

  if (!draft) {
    return (
      <View style={{ flex: 1, backgroundColor: colour.chalk }}>
        {header}
        <View style={{ padding: space.lg }}>
          {problem ? <ErrorState message={problem} onRetry={() => void load()} /> : <CardSkeleton />}
        </View>
      </View>
    )
  }

  const plan = draft.plan
  const readiness = plan?.readiness ?? null
  const knockout = formatHasBracket(draft.format)
  const total = (plan?.gameCount ?? 0) + (schedule?.games.filter((g) => g.kind === "place").length ?? 0)
  const timeline = schedule ? byTime(schedule, staged, pitchFilter) : []
  const waiting = schedule ? unplaced(schedule, staged) : []
  const multiDay = (schedule?.days.length ?? plan?.days.length ?? 0) > 1
  const canEdit = !!schedule && !isPreview && total > 0

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      {header}
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: (editing ? 120 : tabBar) + space.xl, gap: space.md }}>
        <Summary draft={draft} schedule={schedule} isPreview={isPreview} total={total} editing={editing} />

        {!isPreview && !!readiness && total > 0 && !editing && (
          <ReadinessPanel readiness={readiness} stage="publish" onAction={(a) => act(a)} />
        )}

        {editing && (
          <View accessibilityRole="summary" style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start", padding: space.md, borderRadius: radius.md, backgroundColor: colour.mint100 }}>
            <Pencil size={16} color={colour.forest800} strokeWidth={2} />
            <Text style={[type.small, { flex: 1, color: colour.forest800, lineHeight: 20 }]}>
              Tap a game to change its day, kick-off, pitch or length. Nothing is saved until you press Save Changes.
            </Text>
          </View>
        )}

        {!!notice && !editing && <InfoNote>{notice}</InfoNote>}

        {total === 0 ? (
          <EmptyState
            title="No games yet"
            body={
              knockout
                ? "Make the draw and press Generate Fixtures. Nothing is created until you do."
                : "Set up the tables and press Generate Fixtures. Nothing is created until you do."
            }
            icon={<CalendarDays size={28} color={colour.inkSubtle} strokeWidth={1.8} />}
          />
        ) : (
          <>
            {!isPreview && !!schedule && (
              <ViewSwitch view={view} onChange={setView} tableLabel={knockout ? "Draw" : "By Table"} />
            )}

            {view === "time" && !!schedule ? (
              <>
                {schedule.pitches.length > 1 && (
                  <PitchFilter schedule={schedule} value={pitchFilter} onChange={setPitchFilter} />
                )}

                {conflicts.length > 0 && (
                  <ClashCard
                    conflicts={conflicts}
                    onOpen={editing ? (c) => {
                      const target = c.unitIds.map((u) => gameById.get(u)).find((g): g is ScheduleGame => !!g && !g.isHistory)
                      if (target) setSheetGame(target)
                    } : undefined}
                  />
                )}

                {timeline.length === 0 && waiting.length === 0 && (
                  <InfoNote>{pitchFilter ? "No game is on this pitch." : "No game has a kick-off time yet."}</InfoNote>
                )}

                {timeline.map((day) => (
                  <View key={day.date ?? "undated"} style={{ gap: space.md }}>
                    {multiDay && (
                      <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.forest800, paddingTop: space.xs }]}>
                        {draftDayLabel(day.date)}
                      </Text>
                    )}
                    {day.kickoffs.map((k) => (
                      <KickoffRail
                        key={`${day.date}-${k.at}`}
                        at={k.at}
                        games={k.games}
                        schedule={schedule}
                        staged={staged}
                        conflicts={conflicts}
                        editing={editing}
                        onEdit={(g) => setSheetGame(g)}
                      />
                    ))}
                  </View>
                ))}

                {waiting.length > 0 && (
                  <Card style={{ gap: space.sm }}>
                    <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>
                      Not Yet Placed ({waiting.length})
                    </Text>
                    <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>
                      {editing
                        ? "These have no kick-off time or pitch. Tap one to place it."
                        : "These have no kick-off time or pitch yet. Use Edit Plan to place them, or reserve more pitch time and schedule the games."}
                    </Text>
                    {waiting.map((g) => (
                      <ScheduleRow
                        key={g.id}
                        game={g}
                        schedule={schedule}
                        staged={staged}
                        clashes={conflictsFor(conflicts, g.id)}
                        editing={editing}
                        onEdit={() => setSheetGame(g)}
                      />
                    ))}
                  </Card>
                )}
              </>
            ) : knockout ? (
              <View style={{ gap: space.sm }}>
                <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>The Draw</Text>
                {bracket ? <TournamentBracketView bracket={bracket} /> : <InfoNote>The draw could not be loaded.</InfoNote>}
              </View>
            ) : (
              <>
                {draftDays(draft).map((day, i) => (
                  <DaySection
                    key={day.date ?? `undated-${i}`}
                    day={day}
                    separated={draftDays(draft).length > 1}
                    format={draft.format}
                    schedule={schedule}
                    staged={staged}
                    conflicts={conflicts}
                    onEditGame={editing ? (g) => setSheetGame(g) : undefined}
                  />
                ))}
                {draft.format === "swiss" && !isPreview && !!plan && (
                  <SwissDraftCard planId={plan.id} tables={draft.tables} byes={draft.byes ?? []} upcoming={draft.upcomingRounds ?? []} onChanged={() => void load()} />
                )}
                {draft.format === "hybrid" && !isPreview && (
                  <View style={{ gap: space.sm }}>
                    <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Knockout Stage</Text>
                    {bracket ? <TournamentBracketView bracket={bracket} /> : <InfoNote>The knockout stage could not be loaded.</InfoNote>}
                  </View>
                )}
              </>
            )}
          </>
        )}

        {!!problem && (
          <Text accessibilityRole="alert" style={[type.caption, { color: colour.danger, lineHeight: 18 }]}>{problem}</Text>
        )}

        {!editing && (
          <PlanActions
            isPreview={isPreview}
            readiness={readiness}
            canEdit={canEdit}
            busy={busy}
            onAct={act}
            onEdit={() => { setEditing(true); setView("time") }}
            onBackToReview={() => router.push({ pathname: "/admin/tournaments/plan/[tournamentId]", params: { tournamentId: id, ageGroup: grade, step: "3" } } as never)}
            onViewTournament={() => router.push({ pathname: "/admin/tournaments/[tournamentId]", params: { tournamentId: id } } as never)}
            onViewCalendar={viewCalendar}
            onPitches={() => router.push({ pathname: "/admin/tournaments/plan/pitches/[tournamentId]", params: { tournamentId: id, ageGroup: grade } } as never)}
          />
        )}
      </ScrollView>

      {editing && (
        <EditBar
          count={staged.size}
          blocked={blockingSave.length}
          busy={busy}
          onSave={() => void saveChanges()}
          onDiscard={discard}
        />
      )}

      {!!schedule && (
        <EditGameSheet
          game={sheetGame}
          schedule={schedule}
          staged={staged}
          onClose={() => setSheetGame(null)}
          onStage={stageMove}
          onUnstage={unstage}
        />
      )}
      <ConfirmRegeneration cost={cost} onCancel={() => setCost(null)} onConfirm={() => void regenerate()} />
      <ConfirmPublish
        visible={confirmPublish}
        gameCount={plan?.gameCount ?? 0}
        ageGroup={grade}
        onCancel={() => setConfirmPublish(false)}
        onConfirm={() => void publish()}
      />
      <LeavePlanSheet
        visible={!!leave}
        count={staged.size}
        blocked={blockingSave.length > 0}
        onSave={() => { const go = leave; setLeave(null); void saveChanges(() => go?.()) }}
        onDiscard={() => { const go = leave; setLeave(null); setStaged(new Map()); setTimeout(() => go?.(), 0) }}
        onStay={() => setLeave(null)}
      />
    </View>
  )
}

/* ------------------------------------------------------------------ what this plan is */

function Summary({ draft, schedule, isPreview, total, editing }: { draft: TournamentPlanDraft; schedule: PlanSchedule | null; isPreview: boolean; total: number; editing: boolean }) {
  const plan = draft.plan
  const stage = plan?.readiness?.stage
  const published = plan?.publicationState === "PUBLISHED"
  const pill = isPreview
    ? { label: "Not Created", tone: "neutral" as const }
    : stage === "COMPLETED"
      ? { label: "Completed", tone: "neutral" as const }
      : stage === "IN_PROGRESS"
        ? { label: "In Progress", tone: "positive" as const }
        : published
          ? { label: "Published", tone: "positive" as const }
          : { label: "Draft", tone: "caution" as const }
  const body = isPreview
    ? "This is what generating would produce. Nothing has been created, and nothing has a time or a pitch yet."
    : published
      ? stage === "IN_PROGRESS" || stage === "COMPLETED"
        ? "Under way. Games with a result keep their time and pitch. Saving a change tells only the teams whose games move."
        : "Participating teams, players and parents can see this schedule. Saving a change tells only the teams whose games move."
      : "Only your club can see these games. Participating teams, players and parents see nothing until you publish."
  const days = schedule?.days ?? plan?.days ?? []
  const pitches = schedule?.pitches.filter((p) => (p.reservations ?? []).length > 0).length ?? 0

  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]} numberOfLines={2}>
            {draft.ageGroup} · {draft.tournamentName}
          </Text>
          {days.length > 0 && (
            <Text style={[type.caption, { color: colour.inkMuted }]}>
              {days.map((d) => shortDay(d)).join(", ")}
              {schedule ? ` · ${schedule.dayStartTime.slice(0, 5)}–${schedule.dayEndTime.slice(0, 5)}` : ""}
            </Text>
          )}
        </View>
        <StatusPill label={editing ? "Editing" : pill.label} tone={editing ? "caution" : pill.tone} />
      </View>
      <Text style={[type.small, { color: colour.inkMuted, lineHeight: 20 }]}>{body}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md, paddingTop: space.xs }}>
        <Figure icon={<CalendarDays size={15} color={colour.inkMuted} />} value={`${total}`} label={total === 1 ? "game" : "games"} />
        {!formatHasBracket(draft.format) && (
          <Figure icon={<Users size={15} color={colour.inkMuted} />} value={`${draft.tables.length}`} label={draft.tables.length === 1 ? "table" : "tables"} />
        )}
        {!!schedule && <Figure icon={<MapPin size={15} color={colour.inkMuted} />} value={`${pitches}`} label={pitches === 1 ? "pitch" : "pitches"} />}
        {!!schedule && (
          <Figure icon={<Clock size={15} color={colour.inkMuted} />} value={`${schedule.gameDurationMinutes}`} label={`min games, ${schedule.changeoverMinutes} min changeover`} />
        )}
      </View>
    </Card>
  )
}

function Figure({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View accessible={false}>{icon}</View>
      <Text style={[type.smallMedium, { color: colour.ink }]}>{value}</Text>
      <Text style={[type.caption, { color: colour.inkMuted }]}>{label}</Text>
    </View>
  )
}

/* ------------------------------------------------------------------ the two views */

function ViewSwitch({ view, onChange, tableLabel }: { view: "time" | "table"; onChange: (v: "time" | "table") => void; tableLabel: string }) {
  const options: { key: "time" | "table"; label: string }[] = [
    { key: "time", label: "By Time" },
    { key: "table", label: tableLabel },
  ]
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", padding: 3, borderRadius: radius.pill, backgroundColor: colour.surface, borderWidth: 1, borderColor: colour.line }}>
      {options.map((o) => {
        const on = o.key === view
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.key)}
            style={({ pressed }) => ({ flex: 1, minHeight: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: on ? colour.forest800 : "transparent", opacity: pressed ? 0.85 : 1 })}
          >
            <Text style={[type.smallMedium, { color: on ? colour.onForest : colour.ink }]}>{o.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function PitchFilter({ schedule, value, onChange }: { schedule: PlanSchedule; value: string | null; onChange: (v: string | null) => void }) {
  const options = [{ id: null as string | null, label: "All Pitches" }, ...schedule.pitches.map((p) => ({ id: p.pitchId as string | null, label: pitchAreasNote(p) ? `${p.name} · ${pitchAreasNote(p)}` : p.name }))]
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs }}>
      {options.map((o) => (
        <Chip key={o.id ?? "all"} label={o.label} on={o.id === value} onPress={() => onChange(o.id)} />
      ))}
    </ScrollView>
  )
}

/** Every clash, in the server's words -- amber with a sign, never colour alone. */
function ClashCard({ conflicts, onOpen }: { conflicts: ScheduleConflict[]; onOpen?: (c: ScheduleConflict) => void }) {
  return (
    <View accessibilityRole="alert" style={{ gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colour.warningSurface, borderWidth: 1, borderColor: "rgba(138,90,0,0.25)" }}>
      <Text accessibilityRole="header" style={[type.smallMedium, { color: colour.warning }]}>
        {conflicts.length === 1 ? "1 Clash" : `${conflicts.length} Clashes`}
      </Text>
      {conflicts.map((c, i) => (
        <Pressable
          key={`${c.code}-${c.date}-${c.at}-${i}`}
          disabled={!onOpen}
          accessibilityRole={onOpen ? "button" : undefined}
          accessibilityHint={onOpen ? "Opens the game so it can be moved" : undefined}
          onPress={() => onOpen?.(c)}
          style={({ pressed }) => ({ flexDirection: "row", gap: space.sm, alignItems: "flex-start", opacity: pressed ? 0.7 : 1 })}
        >
          <TriangleAlert size={16} color={colour.warning} strokeWidth={2} />
          <Text style={[type.small, { flex: 1, color: colour.warning, lineHeight: 20 }]}>{c.message}</Text>
        </Pressable>
      ))}
    </View>
  )
}

/**
 * ONE KICK-OFF ON THE RUNNING ORDER: the time on the rail, the games at it beside it, by pitch. The time
 * is set in the app's display face because it is the thing an organiser reads first, across a pitch.
 */
function KickoffRail({ at, games, schedule, staged, conflicts, editing, onEdit }: {
  at: string
  games: ScheduleGame[]
  schedule: PlanSchedule
  staged: ReadonlyMap<string, ScheduleMove>
  conflicts: ScheduleConflict[]
  editing: boolean
  onEdit: (g: ScheduleGame) => void
}) {
  return (
    <View style={{ flexDirection: "row", gap: space.md }}>
      <View style={{ width: 58, paddingTop: 2 }}>
        <Text accessibilityRole="header" style={[type.displaySmall, { color: colour.forest800 }]}>{at}</Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>{games.length === 1 ? "1 game" : `${games.length} games`}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: space.sm }}>
        {games.map((g) => (
          <ScheduleRow key={g.id} game={g} schedule={schedule} staged={staged} clashes={conflictsFor(conflicts, g.id)} editing={editing} onEdit={() => onEdit(g)} />
        ))}
      </View>
    </View>
  )
}

/** ONE GAME: where, who, how long, where it sits in the competition -- and anything wrong with it, in words. */
function ScheduleRow({ game, schedule, staged, clashes, editing, onEdit }: {
  game: ScheduleGame
  schedule: PlanSchedule
  staged: ReadonlyMap<string, ScheduleMove>
  clashes: ScheduleConflict[]
  editing: boolean
  onEdit: () => void
}) {
  const at = placementOf(game, staged)
  const pitch = schedule.pitches.find((p) => p.pitchId === at.pitchId)
  const changed = staged.has(game.id)
  const context = gameContext(game, schedule.format)
  const tappable = editing && !game.isHistory
  const ends = at.startTime ? fromMinutes(toMinutes(at.startTime) + (game.kind === "place" ? schedule.gameDurationMinutes : at.durationMinutes)) : null
  const label = [
    gameTitle(game),
    at.startTime && pitch ? `${pitch.name} at ${at.startTime}` : "Not yet placed",
    `${at.durationMinutes} minutes`,
    context,
    changed ? "Changed, not saved" : null,
    game.isHistory ? "Has a result" : null,
    ...clashes.map((c) => c.message),
  ].filter(Boolean).join(". ")

  return (
    <Pressable
      accessible
      accessibilityRole={tappable ? "button" : undefined}
      accessibilityLabel={label}
      accessibilityHint={tappable ? "Change this game's day, kick-off, pitch or length" : undefined}
      disabled={!tappable}
      onPress={onEdit}
      style={({ pressed }) => ({
        gap: 6,
        padding: space.md,
        borderRadius: radius.md,
        backgroundColor: colour.surface,
        borderWidth: changed || clashes.length > 0 ? 1.5 : 1,
        borderColor: clashes.length > 0 ? colour.warning : changed ? colour.rugby700 : colour.line,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.chalk }}>
          <MapPin size={12} color={colour.forest800} strokeWidth={2.2} />
          <Text style={[type.caption, { color: colour.forest800, fontFamily: type.smallMedium.fontFamily }]}>{pitch?.name ?? "No pitch"}</Text>
        </View>
        <Text numberOfLines={1} style={[type.caption, { flex: 1, color: colour.inkMuted }]}>{context}</Text>
        {changed && <StatusPill label="Changed" tone="caution" />}
        {game.isHistory && <Lock size={14} color={colour.inkMuted} strokeWidth={2} />}
        {tappable && !changed && <Pencil size={14} color={colour.rugby700} strokeWidth={2} />}
      </View>

      {game.sideA && game.sideB ? (
        <Sides a={game.sideA} b={game.sideB} />
      ) : (
        <Text style={[type.small, { color: colour.ink }]}>{game.roundLabel ?? "Knockout game"}: sides to be decided</Text>
      )}

      <Text style={[type.caption, { color: colour.inkMuted }]}>
        {at.startTime ? `${at.startTime}–${ends} · ` : ""}{game.kind === "place" ? schedule.gameDurationMinutes : at.durationMinutes} min
        {game.placedByHand && !changed ? " · Placed by hand" : ""}
        {game.isHistory && game.sideAScore !== null && game.sideBScore !== null ? ` · Result ${game.sideAScore}–${game.sideBScore}` : game.isHistory ? " · Has a result" : ""}
      </Text>

      {clashes.map((c, i) => (
        <View key={`${c.code}-${i}`} style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
          <TriangleAlert size={14} color={colour.warning} strokeWidth={2} />
          <Text style={[type.caption, { flex: 1, color: colour.warning, lineHeight: 17 }]}>{c.message}</Text>
        </View>
      ))}
    </Pressable>
  )
}

/**
 * THE TWO SIDES AS EQUALS. A tournament game has no home and no away, so neither side is given the first
 * position's weight; two lines for a club's name, because rugby clubs have long ones.
 */
function Sides({ a, b }: { a: ScheduleSide | DraftGame["sideA"]; b: ScheduleSide | DraftGame["sideB"] }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <ClubCrest clubName={a.clubName} url={clubLogoUrlFromPath(supabase, a.crestPath)} size={22} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={[type.caption, { color: colour.ink, lineHeight: 16 }]}>{a.clubName}</Text>
        <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted, fontSize: 11 }]}>{a.label}</Text>
      </View>
      <Text style={[type.caption, { color: colour.inkSubtle }]}>v</Text>
      <View style={{ flex: 1, minWidth: 0, alignItems: "flex-end" }}>
        <Text numberOfLines={2} style={[type.caption, { color: colour.ink, lineHeight: 16, textAlign: "right" }]}>{b.clubName}</Text>
        <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted, fontSize: 11 }]}>{b.label}</Text>
      </View>
      <ClubCrest clubName={b.clubName} url={clubLogoUrlFromPath(supabase, b.crestPath)} size={22} />
    </View>
  )
}

/* ------------------------------------------------------------------ by table */

function DaySection({ day, separated, format, schedule, staged, conflicts, onEditGame }: {
  day: DraftDayGroup
  separated: boolean
  format?: string | null
  schedule: PlanSchedule | null
  staged: ReadonlyMap<string, ScheduleMove>
  conflicts: ScheduleConflict[]
  onEditGame?: (g: ScheduleGame) => void
}) {
  const games = day.tables.reduce((n, t) => n + t.rounds.reduce((m, r) => m + r.games.length, 0), 0)
  return (
    <View style={{ gap: space.md }}>
      {separated && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingTop: space.xs }}>
          <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colour.forest800 }}>
            <CalendarDays size={17} color={colour.onForest} strokeWidth={2} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>{draftDayLabel(day.date)}</Text>
            <Text style={[type.caption, { color: colour.inkMuted }]}>
              {games} {games === 1 ? "game" : "games"} · {day.tables.length} {day.tables.length === 1 ? "table" : "tables"}
            </Text>
          </View>
        </View>
      )}
      {day.tables.map((table) => (
        <TableSection key={`${day.date ?? "undated"}-${table.id}`} table={table} format={format} schedule={schedule} staged={staged} conflicts={conflicts} onEditGame={onEditGame} />
      ))}
    </View>
  )
}

function TableSection({ table, format, schedule, staged, conflicts, onEditGame }: {
  table: DraftTableGroup
  format?: string | null
  schedule: PlanSchedule | null
  staged: ReadonlyMap<string, ScheduleMove>
  conflicts: ScheduleConflict[]
  onEditGame?: (g: ScheduleGame) => void
}) {
  const byId = new Map((schedule?.games ?? []).map((g) => [g.id, g]))
  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.bodyMedium, { flex: 1, color: colour.ink }]}>{table.name}</Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>{table.sides.length} {table.sides.length === 1 ? "team" : "teams"}</Text>
      </View>

      {/* WHO IS IN THIS TABLE. Without it a round's pairings are two names and no context. */}
      <View style={{ gap: 2, paddingBottom: space.xs }}>
        {table.sides.map((s) => (
          <View key={s.participantId} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 32 }}>
            <ClubCrest clubName={s.clubName} url={clubLogoUrlFromPath(supabase, s.crestPath)} size={22} />
            <Text numberOfLines={1} style={[type.caption, { flex: 1, color: colour.ink }]}>
              {s.clubName} <Text style={{ color: colour.inkMuted }}>{s.label}</Text>
            </Text>
            {s.isHost && <StatusPill label="Host" tone="positive" />}
          </View>
        ))}
      </View>

      {table.rounds.map((round) => (
        <View key={round.round} style={{ gap: space.xs, paddingTop: space.xs, borderTopWidth: 1, borderTopColor: colour.line }}>
          <Text accessibilityRole="header" style={[type.caption, { color: colour.inkSubtle, paddingTop: space.xs }]}>
            {format === "tri_fixture" ? "Game" : "Round"} {round.round}
          </Text>
          {round.games.map((game, i) => {
            const live = game.id ? byId.get(game.id) ?? null : null
            return (
              <TableGameRow
                key={game.id ?? `${round.round}-${i}`}
                game={game}
                live={live}
                staged={staged}
                clashes={live ? conflictsFor(conflicts, live.id) : []}
                pitchName={(pid) => schedule?.pitches.find((p) => p.pitchId === pid)?.name ?? null}
                onEdit={live && onEditGame && !live.isHistory ? () => onEditGame(live) : undefined}
              />
            )
          })}
        </View>
      ))}
    </Card>
  )
}

function TableGameRow({ game, live, staged, clashes, pitchName, onEdit }: {
  game: DraftGame
  live: ScheduleGame | null
  staged: ReadonlyMap<string, ScheduleMove>
  clashes: ScheduleConflict[]
  pitchName: (id: string | null) => string | null
  onEdit?: () => void
}) {
  const at = live ? placementOf(live, staged) : { date: game.date, startTime: game.startTime ? game.startTime.slice(0, 5) : null, pitchId: null, durationMinutes: game.durationMinutes ?? 0 }
  const where = live ? pitchName(at.pitchId) : game.pitchName
  const when = at.startTime ?? "Time not assigned"
  const changed = !!live && staged.has(live.id)
  return (
    <Pressable
      accessible
      accessibilityRole={onEdit ? "button" : undefined}
      accessibilityHint={onEdit ? "Change this game's day, kick-off, pitch or length" : undefined}
      accessibilityLabel={`${game.sideA.clubName} ${game.sideA.label} versus ${game.sideB.clubName} ${game.sideB.label}. ${when}. ${where ?? "Pitch not assigned"}.${clashes.map((c) => ` ${c.message}`).join("")}`}
      disabled={!onEdit}
      onPress={onEdit}
      style={({ pressed }) => ({ gap: 6, borderRadius: radius.md, borderWidth: changed || clashes.length > 0 ? 1.5 : 1, borderColor: clashes.length > 0 ? colour.warning : changed ? colour.rugby700 : colour.line, backgroundColor: colour.chalk, padding: space.md, opacity: pressed ? 0.75 : 1 })}
    >
      <Sides a={game.sideA} b={game.sideB} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, flexWrap: "wrap" }}>
        <Detail icon={<Clock size={13} color={at.startTime ? colour.inkMuted : colour.warning} />} text={when} muted={!at.startTime} />
        <Detail icon={<MapPin size={13} color={where ? colour.inkMuted : colour.warning} />} text={where ?? "Pitch not assigned"} muted={!where} />
        {!!at.durationMinutes && <Detail icon={null} text={`${at.durationMinutes} min`} muted={false} />}
        {changed && <StatusPill label="Changed" tone="caution" />}
      </View>
      {clashes.map((c, i) => (
        <View key={`${c.code}-${i}`} style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
          <TriangleAlert size={14} color={colour.warning} strokeWidth={2} />
          <Text style={[type.caption, { flex: 1, color: colour.warning, lineHeight: 17 }]}>{c.message}</Text>
        </View>
      ))}
    </Pressable>
  )
}

function Detail({ icon, text, muted }: { icon: React.ReactNode; text: string; muted: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      {!!icon && <View accessible={false}>{icon}</View>}
      <Text style={[type.caption, { color: muted ? colour.warning : colour.inkMuted }]}>{text}</Text>
    </View>
  )
}

/* ------------------------------------------------------------------ editing one game */

/**
 * MOVING ONE GAME. Only what the plan can use is offered -- its playing days, and on the chosen day the
 * pitches reserved for the tournament -- and the move is checked as it is chosen, against everything else
 * already staged, in the server's own words. A move that clashes can still be staged: rearranging a
 * morning often means two moves that only work together. Save Changes waits until nothing clashes.
 */
function EditGameSheet({ game, schedule, staged, onClose, onStage, onUnstage }: {
  game: ScheduleGame | null
  schedule: PlanSchedule
  staged: ReadonlyMap<string, ScheduleMove>
  onClose: () => void
  onStage: (game: ScheduleGame, move: ScheduleMove) => void
  onUnstage: (game: ScheduleGame) => void
}) {
  const [day, setDay] = useState<string | null>(null)
  const [time, setTime] = useState<string | null>(null)
  const [pitch, setPitch] = useState<string | null>(null)
  const [minutes, setMinutes] = useState<number>(schedule.gameDurationMinutes)

  useEffect(() => {
    if (!game) return
    const at = placementOf(game, staged)
    const firstDay = at.date ?? schedule.days[0] ?? null
    setDay(firstDay)
    setTime(at.startTime ?? schedule.dayStartTime.slice(0, 5))
    setPitch(at.pitchId ?? (firstDay ? pitchesOnDay(schedule, firstDay)[0]?.pitchId ?? null : null))
    setMinutes(game.kind === "place" ? schedule.gameDurationMinutes : at.durationMinutes)
  }, [game, schedule, staged])

  const move: ScheduleMove | null = day && time && pitch ? { date: day, startTime: time, pitchId: pitch, durationMinutes: minutes } : null
  const problem = game && move ? moveProblem(schedule, game, move) : null
  const clashes = useMemo(() => {
    if (!game || !move || problem) return []
    const next = new Map(staged)
    next.set(game.id, move)
    return conflictsFor(scheduleConflicts(schedule, next), game.id)
  }, [game, move?.date, move?.startTime, move?.pitchId, move?.durationMinutes, problem, schedule, staged])

  const pitchOptions = day ? pitchesOnDay(schedule, day) : []
  const max = schedule.maxDurationMinutes ?? 240
  const isPlace = game?.kind === "place"

  return (
    <Sheet visible={!!game} onClose={onClose} title={game?.kind === "place" ? "Move Knockout Game" : "Edit Game"}>
      {!!game && (
        <View style={{ gap: space.sm }}>
          {game.sideA && game.sideB ? <Sides a={game.sideA} b={game.sideB} /> : <Text style={[type.small, { color: colour.ink }]}>{gameTitle(game)}</Text>}
          <Text style={[type.caption, { color: colour.inkMuted }]}>{gameContext(game, schedule.format)}</Text>

          {schedule.days.length > 1 && (
            <>
              <Text style={[type.caption, { color: colour.inkSubtle, paddingTop: space.xs }]}>Day</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
                {schedule.days.map((d) => (
                  <Chip key={d} label={shortDay(d)} on={d === day} onPress={() => { setDay(d); setPitch(pitchesOnDay(schedule, d).some((p) => p.pitchId === pitch) ? pitch : pitchesOnDay(schedule, d)[0]?.pitchId ?? null) }} />
                ))}
              </View>
            </>
          )}

          <Text style={[type.caption, { color: colour.inkSubtle, paddingTop: space.xs }]}>Kick-off</Text>
          <TimeField label="Kick-off" value={time} clearable={false} onChange={(v) => setTime(v ?? time)} />

          <Text style={[type.caption, { color: colour.inkSubtle, paddingTop: space.xs }]}>Pitch</Text>
          {pitchOptions.length === 0 ? (
            <InfoNote>No pitch is reserved on this day. Reserve one in Venue & Pitches first.</InfoNote>
          ) : (
            <>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
                {pitchOptions.map((p) => (
                  <Chip key={p.pitchId} label={pitchAreasNote(p, day) ? `${p.name} · ${pitchAreasNote(p, day)}` : p.name} on={p.pitchId === pitch} onPress={() => setPitch(p.pitchId)} />
                ))}
              </View>
              {!!pitch && (
                <Text style={[type.caption, { color: colour.inkMuted }]}>
                  Reserved {pitchOptions.find((p) => p.pitchId === pitch)?.windows.map((w) => `${w.startTime}–${w.endTime}${(w.playingAreas ?? 1) > 1 ? `, marked out for ${w.playingAreas} games` : ""}`).join("; ")}
                </Text>
              )}
            </>
          )}

          {!isPlace && (
            <>
              <Text style={[type.caption, { color: colour.inkSubtle, paddingTop: space.xs }]}>Length</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <Stepper icon={<Minus size={18} color={colour.forest800} strokeWidth={2.2} />} label="Five minutes shorter" disabled={minutes <= 5} onPress={() => setMinutes((m) => Math.max(5, m - 5))} />
                <Text style={[type.bodyMedium, { color: colour.ink, minWidth: 64, textAlign: "center" }]}>{minutes} min</Text>
                <Stepper icon={<Plus size={18} color={colour.forest800} strokeWidth={2.2} />} label="Five minutes longer" disabled={minutes + 5 > max} onPress={() => setMinutes((m) => Math.min(max, m + 5))} />
              </View>
              {schedule.maxDurationMinutes !== null && (
                <Text style={[type.caption, { color: colour.inkMuted }]}>Up to {schedule.maxDurationMinutes} minutes for {schedule.ageGroup}.</Text>
              )}
            </>
          )}

          {/* THE LIVE CHECK: what the server would say, before anything is sent. */}
          {move && (
            problem ? (
              <Note tone="danger" text={problem} />
            ) : clashes.length > 0 ? (
              <View style={{ gap: space.xs }}>
                {clashes.map((c, i) => <Note key={`${c.code}-${i}`} tone="warning" text={c.message} />)}
                <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 17 }]}>
                  You can stage this and move the other game too. Save Changes waits until nothing clashes.
                </Text>
              </View>
            ) : (
              <Note tone="ok" text={`No clash: ${schedule.pitches.find((p) => p.pitchId === pitch)?.name ?? "the pitch"} has room at ${time}, and both teams are free.`} />
            )
          )}

          <Button
            label="Stage This Move"
            disabled={!move || !!problem}
            onPress={() => move && onStage(game, move)}
            style={{ marginTop: space.sm }}
          />
          {staged.has(game.id) && (
            <Button label="Undo Change" variant="quiet" icon={<Undo2 size={16} color={colour.forest800} strokeWidth={2} />} onPress={() => onUnstage(game)} />
          )}
        </View>
      )}
    </Sheet>
  )
}

function Stepper({ icon, label, disabled, onPress }: { icon: React.ReactNode; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, borderRadius: TOUCH_TARGET / 2, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: colour.lineStrong, backgroundColor: colour.surface, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 })}
    >
      {icon}
    </Pressable>
  )
}

function Note({ tone, text }: { tone: "ok" | "warning" | "danger"; text: string }) {
  const palette = tone === "ok"
    ? { bg: colour.successSurface, fg: colour.forest800, icon: <CircleCheck size={16} color={colour.forest800} strokeWidth={2} /> }
    : tone === "warning"
      ? { bg: colour.warningSurface, fg: colour.warning, icon: <TriangleAlert size={16} color={colour.warning} strokeWidth={2} /> }
      : { bg: colour.dangerSurface, fg: colour.danger, icon: <TriangleAlert size={16} color={colour.danger} strokeWidth={2} /> }
  return (
    <View accessibilityRole={tone === "ok" ? undefined : "alert"} style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start", padding: space.sm, borderRadius: radius.md, backgroundColor: palette.bg }}>
      {palette.icon}
      <Text style={[type.small, { flex: 1, color: palette.fg, lineHeight: 20 }]}>{text}</Text>
    </View>
  )
}

/* ------------------------------------------------------------------ saving */

/** The one loud control while editing: Save Changes (N), with Discard beside it. */
function EditBar({ count, blocked, busy, onSave, onDiscard }: { count: number; blocked: number; busy: boolean; onSave: () => void; onDiscard: () => void }) {
  // The screen ends above the bottom navigation, so the bar sits on the screen's own edge.
  return (
    <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md, backgroundColor: colour.surface, borderTopWidth: 1, borderTopColor: colour.line, gap: space.xs }}>
      {blocked > 0 && (
        <Text accessibilityRole="alert" style={[type.caption, { color: colour.warning, textAlign: "center" }]}>
          {blocked === 1 ? "1 clash involves" : `${blocked} clashes involve`} a game you moved. Change it to save.
        </Text>
      )}
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button label={count > 0 ? "Discard" : "Done"} variant="secondary" onPress={onDiscard} disabled={busy} style={{ flex: 1 }} />
        <Button label={count > 0 ? `Save Changes (${count})` : "Save Changes"} busy={busy} disabled={count === 0 || blocked > 0} onPress={onSave} style={{ flex: 2 }} />
      </View>
    </View>
  )
}

function LeavePlanSheet({ visible, count, blocked, onSave, onDiscard, onStay }: { visible: boolean; count: number; blocked: boolean; onSave: () => void; onDiscard: () => void; onStay: () => void }) {
  return (
    <Sheet visible={visible} onClose={onStay} title="Unsaved Changes">
      <Text style={[type.small, { color: colour.inkMuted, lineHeight: 20 }]}>
        {count === 1 ? "1 change to this plan has" : `${count} changes to this plan have`} not been saved.
        {blocked ? " A moved game still clashes, so they cannot be saved yet." : ""}
      </Text>
      <View style={{ gap: space.sm, marginTop: space.md }}>
        {!blocked && <Button label={`Save Changes (${count})`} onPress={onSave} />}
        <Button label="Discard Changes" variant="danger" onPress={onDiscard} />
        <Button label="Keep Editing" variant="secondary" onPress={onStay} />
      </View>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ what to do next */

/**
 * THE PLAN'S ACTIONS, CHOSEN BY ITS STATE.
 *
 * Draft: whatever readiness says comes next leads (Complete Scheduling, Edit Plan, Publish Fixtures),
 * with Edit Plan and the rest beneath it. Published: Edit Plan leads, and the routes out are to where
 * people now see it. The Calendar opens on the competition's own day.
 */
function PlanActions({
  isPreview, readiness, canEdit, busy, onAct, onEdit, onBackToReview, onViewTournament, onViewCalendar, onPitches,
}: {
  isPreview: boolean
  readiness: PlanReadiness | null
  canEdit: boolean
  busy: boolean
  onAct: (a: ReadinessAction | "publish") => void
  onEdit: () => void
  onBackToReview: () => void
  onViewTournament: () => void
  onViewCalendar: () => void
  onPitches: () => void
}) {
  if (isPreview || !readiness) {
    return <Button label="Back to Review" variant="primary" onPress={onBackToReview} />
  }
  const published = readiness.publicationState === "PUBLISHED"
  const next = primaryReadinessAction(readiness)
  const calendar = <Button label="View Calendar" variant="secondary" icon={<CalendarDays size={16} color={colour.forest800} strokeWidth={2} />} onPress={onViewCalendar} />

  if (published) {
    return (
      <View style={{ gap: space.sm }}>
        {canEdit && <Button label="Edit Plan" icon={<Pencil size={17} color={colour.onForest} strokeWidth={2} />} style={{ minHeight: 52 }} onPress={onEdit} />}
        {calendar}
        <Button label="View Tournament" variant="secondary" onPress={onViewTournament} />
        <Button label="Venue & Pitches" variant="quiet" icon={<MapPin size={16} color={colour.forest800} strokeWidth={2} />} onPress={onPitches} />
      </View>
    )
  }

  return (
    <View style={{ gap: space.sm }}>
      {next ? (
        <Button
          label={READINESS_ACTION_LABEL[next]}
          busy={busy}
          icon={next === "publish" ? <Megaphone size={18} color={colour.onForest} strokeWidth={2} /> : next === "schedule" || next === "pitches" ? <CalendarSync size={18} color={colour.onForest} strokeWidth={2} /> : undefined}
          style={{ minHeight: 52 }}
          onPress={() => onAct(next)}
        />
      ) : (
        <InfoNote>Nothing more can be done here until the competition changes.</InfoNote>
      )}
      {canEdit && next !== "edit_schedule" && (
        <Button label="Edit Plan" variant="secondary" icon={<Pencil size={16} color={colour.forest800} strokeWidth={2} />} onPress={onEdit} />
      )}
      {next !== "schedule" && next !== "pitches" && (
        <Button label="Venue & Pitches" variant="secondary" icon={<MapPin size={16} color={colour.forest800} strokeWidth={2} />} onPress={onPitches} />
      )}
      {readiness.canRegenerate && next !== "regenerate" && (
        <Button label="Regenerate Fixtures" variant="secondary" busy={busy} icon={<RefreshCw size={16} color={colour.forest800} strokeWidth={2} />} onPress={() => onAct("regenerate")} />
      )}
      {calendar}
      <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center", lineHeight: 18 }]}>
        Only your club can see this draft. Publishing tells every participating team and shows them the schedule.
      </Text>
    </View>
  )
}

/**
 * THE REGENERATION CONFIRMATION, which names what it would cost -- including the games an organiser
 * placed by hand, which regenerating makes new pairings for and so cannot keep.
 */
function ConfirmRegeneration({ cost, onCancel, onConfirm }: { cost: RegenerationCost | null; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal visible={!!cost} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onCancel} style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.45)", justifyContent: "center", padding: space.lg }}>
        <Pressable accessible={false} onPress={() => {}} style={{ backgroundColor: colour.surface, borderRadius: radius.lg, padding: space.lg, gap: space.md }}>
          <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Regenerate Fixtures?</Text>
          <Text style={[type.small, { color: colour.inkMuted, lineHeight: 20 }]}>{cost ? regenerationWarning(cost) : ""}</Text>
          <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>
            To move games without making new pairings, use Edit Plan instead.
          </Text>
          <Button label="Cancel" variant="secondary" onPress={onCancel} />
          <Button label="Regenerate" variant="danger" onPress={onConfirm} />
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function ConfirmPublish({
  visible, gameCount, ageGroup, onCancel, onConfirm,
}: { visible: boolean; gameCount: number; ageGroup: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onCancel} style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.45)", justifyContent: "center", padding: space.lg }}>
        <Pressable accessible={false} onPress={() => {}} style={{ backgroundColor: colour.surface, borderRadius: radius.lg, padding: space.lg, gap: space.md }}>
          <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Publish Fixtures?</Text>
          <Text style={[type.small, { color: colour.inkMuted, lineHeight: 20 }]}>
            {`The ${ageGroup} schedule's ${gameCount} ${gameCount === 1 ? "game" : "games"} will be visible to every participating team, its players and parents, and they will be notified.`}
          </Text>
          <Button label="Cancel" variant="secondary" onPress={onCancel} />
          <Button label="Publish Fixtures" onPress={onConfirm} />
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ paddingHorizontal: space.md, minHeight: 40, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1.5,
        borderColor: on ? colour.rugby700 : colour.lineStrong, backgroundColor: on ? colour.rugby700 : colour.surface, opacity: pressed ? 0.8 : 1 })}
    >
      <Text style={[type.smallMedium, { color: on ? colour.onForest : colour.ink }]}>{label}</Text>
    </Pressable>
  )
}
