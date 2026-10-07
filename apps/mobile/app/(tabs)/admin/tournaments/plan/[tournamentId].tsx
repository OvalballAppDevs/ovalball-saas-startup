import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Animated, Modal, PanResponder, Pressable, ScrollView, Text, TextInput, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { clubLogoUrlFromPath } from "@ovalball/contracts/club-logo"
import {
  defaultTableName,
  distribute,
  maxTables,
  readTournamentPlan,
  roundRobinGameCount,
  shuffled,
  suggestedTableSizes,
  tableGuidance,
  tableProblem,
  TIE_BREAKERS,
  type PlanSide,
  type TieBreaker,
  type TournamentPlanContext,
} from "@ovalball/contracts/tournaments/planning"

import { supabase } from "../../../../../src/auth/supabase"
import { ChoiceSheet } from "../../../../../src/components/field-sheet"
import { TimeField } from "../../../../../src/components/form"
import { ClubCrest } from "../../../../../src/components/identity"
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  GripVertical,
  MapPin,
  Plus,
  Shuffle,
  Trophy,
  Users,
  X,
} from "../../../../../src/components/icons"
import { Button, Card, CardSkeleton, ErrorState, InfoNote, StatusPill } from "../../../../../src/components/ui"
import { categoryName } from "../../../../../src/tournaments/planning-home"
import { friendlyRefusal as friendly, logDetail } from "../../../../../src/errors/translate"
import { useTabBarHeight } from "../../../../../src/navigation/use-tab-bar-height"
import { colour, elevation, radius, space, type } from "../../../../../src/design/tokens"
import { KnockoutDrawStep, KnockoutSettingsStep } from "../../../../../src/tournaments/knockout-planning"
import { KnockoutReviewStep } from "../../../../../src/tournaments/knockout-review"
import { ReadinessPanel } from "../../../../../src/tournaments/readiness-panel"
import { TriFixtureStep } from "../../../../../src/tournaments/tri-fixture-step"
import { HybridKnockoutStage } from "../../../../../src/tournaments/hybrid-stage"
import { SwissRoundsStep } from "../../../../../src/tournaments/swiss-stage"
import { updateDrawMembership, type ReadinessAction } from "@ovalball/contracts/tournaments/readiness"
import {
  formatHasBracket,
  generateKnockoutFixtures,
  setKnockoutSettings,
  setRoundDays,
  type TieResolution,
} from "@ovalball/contracts/tournaments/knockout"

/**
 * PLANNING ONE COMPETITION, IN FOUR STEPS.
 *
 * Teams & Dates, Tables, Settings, Review. One screen holding the whole configuration rather than four
 * routes, for one reason that matters more than tidiness: moving between steps must never disturb what
 * the organiser has arranged. A randomised table allocation that redrew itself on the way back from
 * Settings would be the single most infuriating thing this screen could do, and with the draft held in
 * one place it cannot happen.
 *
 * NOTHING IS WRITTEN UNTIL IT IS CHOSEN. Opening the wizard starts a plan -- which is the organiser
 * saying "I am planning this" -- but the tables, the days and the settings are saved when the step is
 * left, and no GAME exists until Generate is pressed.
 *
 * AND GENERATE IS NOT PUBLISH. Generation fills a draft only the organising club can see, and leads
 * straight to the Generated Draft Plan so the organiser READS what was made. The participants' Agenda
 * keeps saying no plan has been published until somebody publishes one, which is the next phase.
 *
 * THE APPROVED MOCK-UP IS THE SPECIFICATION FOR THIS SCREEN, and the shapes it draws are Ovalball's
 * existing ones: `Card`, `Button`, `InfoNote` and `ChoiceSheet` from the component system, not local
 * copies that look similar today and drift apart tomorrow.
 */

/**
 * THE SAME FOUR STEPS, WHATEVER SHAPE THE COMPETITION TAKES.
 *
 * Confirming who is coming and which days they play is the same job for a league and for a cup, and so
 * is reviewing before you generate. Only the middle differs: a round robin arranges TABLES, a knockout
 * arranges a DRAW. One wizard, one stepper, one set of chrome -- never a second planner.
 */
const STEPS = ["Teams & Dates", "Tables", "Settings", "Review"] as const
const KNOCKOUT_STEPS = ["Teams & Dates", "Draw", "Settings", "Review"] as const
// A TRI-FIXTURE IS THREE SIDES, so it has no tables to arrange: its middle step is the three games
// themselves and whether they make a competition with a table.
const TRI_STEPS = ["Teams & Dates", "Fixtures", "Settings", "Review"] as const
// A HYBRID IS GROUPS, THEN A KNOCKOUT: its middle step arranges the group tables exactly as a round
// robin's, and Settings adds the knockout stage -- who goes through, and how a level game is settled.
const HYBRID_STEPS = ["Teams & Dates", "Groups", "Settings", "Review"] as const
// A SWISS IS ONE TABLE PAIRED A ROUND AT A TIME: its middle step is how many rounds, and how they pair.
const SWISS_STEPS = ["Teams & Dates", "Rounds", "Settings", "Review"] as const
type Step = 0 | 1 | 2 | 3

/** The heading that names the step, shown in the white chrome beneath the progress header. */
const STEP_HEADING: Record<Step, ((grade: string) => string) | null> = {
  0: null, // The mock-up gives step one no heading: "Confirm Teams (U12)" is the first card's own title.
  1: (grade) => `Table Setup (${grade})`,
  2: () => "Tournament Settings",
  3: () => "Review & Generate Fixtures",
}

const KNOCKOUT_STEP_HEADING: Record<Step, ((grade: string) => string) | null> = {
  0: null,
  1: (grade) => `Knockout Draw (${grade})`,
  2: () => "Knockout Settings",
  3: () => "Review & Generate Fixtures",
}

interface DraftTable {
  name: string
  sides: string[]
}

export default function TournamentPlanWizard() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const tabBar = useTabBarHeight()
  const { tournamentId, ageGroup, step: stepParam } = useLocalSearchParams<{ tournamentId: string; ageGroup?: string; step?: string }>()
  const id = String(tournamentId ?? "")

  const [context, setContext] = useState<TournamentPlanContext | null>(null)
  const [grade, setGrade] = useState<string>(String(ageGroup ?? ""))
  const [step, setStep] = useState<Step>(0)
  // A READINESS ROUTE LANDS ON ITS STEP: "Review Playing Hours" opens Settings, "Arrange Tables" opens
  // Tables. The parameter is read on arrival rather than kept, so moving between steps afterwards is
  // the organiser's own.
  useEffect(() => {
    const n = Number(stepParam)
    if (Number.isInteger(n) && n >= 0 && n <= 3) setStep(n as Step)
  }, [stepParam])
  const [notice, setNotice] = useState<string | null>(null)
  // THE PUBLISHED GAMES A TABLE CHANGE WOULD REPLACE, said by the server and confirmed here (20270736).
  const [replaceAsk, setReplaceAsk] = useState<string | null>(null)
  // THIS IS THE WAY TO BUILD A PLAN, NOT TO LOOK AT ONE. Arriving here with no step for a plan that
  // already has games goes to the plan itself -- once, on arrival, so coming Back from the plan to a
  // step the organiser chose is never bounced.
  const arrival = useRef(true)
  const [drawVersion, setDrawVersion] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The page holds still while a team is being dragged between tables.
  const [dragLock, setDragLock] = useState(false)

  // ---- the draft the organiser is arranging, held here so no step can disturb another --------------
  const [days, setDays] = useState<string[]>([])
  const [tables, setTables] = useState<DraftTable[]>([])
  const [duration, setDuration] = useState(20)
  const [changeover, setChangeover] = useState(15)
  const [dayStart, setDayStart] = useState("09:00")
  const [dayEnd, setDayEnd] = useState("13:00")
  const [points, setPoints] = useState({ win: 4, draw: 2, loss: 0, tryBonus: 1, losingBonus: 1 })
  // THE TWO RULES THAT DECIDE A TABLE BEYOND THE POINTS THEMSELVES. The margin was an invisible
  // assumption before -- the bonus VALUE was configurable and the threshold was not -- and Ovalball has
  // no canonical sporting tie-break to impose, so the order is the organiser's to state.
  const [losingBonusMargin, setLosingBonusMargin] = useState(7)
  // ---- the knockout half of the wizard --------------------------------------------------------------
  const [tie, setTie] = useState<TieResolution>("golden_point")
  const [extraTime, setExtraTime] = useState<number | null>(null)
  const [thirdPlace, setThirdPlace] = useState(false)
  const [roundDays, setRoundDays_] = useState<Record<number, string>>({})
  const [tieBreakers, setTieBreakers] = useState<TieBreaker[]>([
    "points_difference", "points_for", "head_to_head", "wins",
  ])

  /**
   * WHICH COMPETITION THE DRAFT IN HAND BELONGS TO.
   *
   * It was a boolean -- "have I loaded?" -- which is the right question only while the answer can
   * never change. Opening a SECOND tournament reuses this screen, and the boolean was already true, so
   * the first tournament's tables stayed on screen against the second tournament's sides: rows that
   * said "Team" with no crest, a count that claimed eight sides were placed in a four-side
   * competition, and a save that the server rightly refused. Keying it to the competition means the
   * draft is rebuilt whenever the competition changes, and never otherwise.
   */
  const competition = `${id}|${grade}`
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const loaded = loadedFor === competition

  // A NEW STEP STARTS AT ITS OWN BEGINNING. One ScrollView holds all four steps -- which is what keeps
  // a randomised table from redrawing itself on the way back -- but it also keeps the scroll offset, so
  // pressing Continue from the bottom of Teams & Dates opened Table Setup half way down, past its own
  // heading and its first card.
  const scroller = useRef<ScrollView>(null)
  useEffect(() => {
    scroller.current?.scrollTo({ y: 0, animated: false })
  }, [step])

  // NOTHING OF THE LAST COMPETITION SURVIVES INTO THE NEXT. Cleared before the read rather than after
  // it, so a slow or failed load shows an empty step rather than another tournament's teams.
  useEffect(() => {
    if (loadedFor !== null && loadedFor !== competition) {
      setLoadedFor(null)
      setContext(null)
      setDays([])
      setTables([])
      setStep(0)
    }
  }, [competition, loadedFor])

  const load = useCallback(async () => {
    if (!id || !grade) return
    setProblem(null)
    try {
      // Starting is idempotent: it returns the plan that exists rather than making a second one, so
      // "Start Planning" and "Continue Planning" reach the same place.
      const { error } = await supabase.rpc("start_tournament_plan", { p_tournament_id: id, p_age_group: grade })
      if (error) throw error
      const ctx = await readTournamentPlan(supabase, id, grade)
      if (arrival.current) {
        arrival.current = false
        if (!stepParam && (ctx?.plan?.gameCount ?? 0) > 0) {
          router.replace({ pathname: "/admin/tournaments/plan/draft/[tournamentId]", params: { tournamentId: id, ageGroup: grade } } as never)
          return
        }
      }
      setContext(ctx)
      // THE SERVER KEEPS THE SEATING IN STEP WITH WHO IS PLAYING (20270720). When the tables in hand
      // hold a different set of teams from the server's -- a team joined or left while the organiser
      // was elsewhere -- the server's arrangement replaces them and the organiser is told, rather than
      // the stale arrangement being saved back on the next Continue.
      if (ctx?.plan && loaded) {
        const server = new Set(ctx.plan.tables.flatMap((t) => t.sides))
        setTables((local) => {
          const mine = new Set(local.flatMap((t) => t.sides))
          const same = server.size === mine.size && [...server].every((p) => mine.has(p))
          if (same) return local
          const joined = [...server].filter((p) => !mine.has(p)).length
          const left = [...mine].filter((p) => !server.has(p)).length
          setNotice(
            [
              joined ? `${joined} new ${joined === 1 ? "team has" : "teams have"} joined this competition and ${joined === 1 ? "has" : "have"} been added to the tables.` : null,
              left ? `${left} ${left === 1 ? "team has" : "teams have"} left this competition.` : null,
            ].filter(Boolean).join(" ")
          )
          return ctx.plan!.tables.map((t) => ({ name: t.name, sides: t.sides }))
        })
      }
      if (ctx?.plan && !loaded) {
        setDays(ctx.plan.days)
        setTables(
          ctx.plan.tables.length > 0
            ? ctx.plan.tables.map((t) => ({ name: t.name, sides: t.sides }))
            : [{ name: defaultTableName(0), sides: ctx.sides.map((s) => s.participantId) }]
        )
        setDuration(ctx.plan.gameDurationMinutes)
        setChangeover(ctx.plan.changeoverMinutes)
        setDayStart(String(ctx.plan.dayStartTime).slice(0, 5))
        setDayEnd(String(ctx.plan.dayEndTime).slice(0, 5))
        setPoints({
          win: ctx.plan.pointsWin, draw: ctx.plan.pointsDraw, loss: ctx.plan.pointsLoss,
          tryBonus: ctx.plan.pointsTryBonus, losingBonus: ctx.plan.pointsLosingBonus,
        })
        // A PROPERTY OF THE COMPETITION, not of a table -- which is where the payload carries it.
        setLosingBonusMargin(ctx.losingBonusMargin ?? 7)
        setTieBreakers(ctx.tieBreakers ?? ["points_difference", "points_for", "head_to_head", "wins"])
        // THE KNOCKOUT SETTINGS AS THE PLAN HOLDS THEM. Generate saves whatever these controls hold, so
        // opening them at their defaults would not merely show the wrong thing -- it would write the
        // defaults back over the organiser's extra time, tie resolution, play-off and round days.
        setTie(ctx.plan.tieResolution ?? "golden_point")
        setExtraTime(ctx.plan.extraTimeMinutes)
        setThirdPlace(ctx.plan.thirdPlacePlayoff ?? false)
        setRoundDays_(Object.fromEntries((ctx.plan.roundDays ?? []).map((r) => [r.round, r.day])))
        setLoadedFor(competition)
      }
    } catch (caught) {
      const failure = friendly(caught, "this tournament plan")
      logDetail("tournament planning", failure)
      setProblem(failure.message)
    }
  }, [id, grade, loaded, competition, stepParam, router])

  // RE-READ ON EVERY ARRIVAL -- coming back from adding a team on the Teams tab, the plan has changed.
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

  const sideById = useMemo(() => new Map((context?.sides ?? []).map((s) => [s.participantId, s])), [context])
  const sideCount = (context?.sides ?? []).filter((x) => x.competes !== false).length
  const problemText = tableProblem(tables, sideCount)
  const expectedGames = roundRobinGameCount(tables.map((t) => t.sides.length))

  /**
   * GENERATING A KNOCKOUT. The settings and the round days are saved first -- they are what the
   * generator schedules against -- and then the organiser is taken straight to the draft. No dialogue
   * saying it worked: the bracket is the proof.
   */
  async function generateKnockout() {
    if (!context?.plan) return
    setBusy(true)
    setProblem(null)
    try {
      await supabase.rpc("set_tournament_plan_days", { p_plan_id: context.plan.id, p_days: days })
      await setKnockoutSettings(supabase, context.plan.id, {
        tieResolution: tie,
        extraTimeMinutes: extraTime,
        thirdPlacePlayoff: thirdPlace,
      })
      const assigned = Object.entries(roundDays).map(([round, day]) => ({ round: Number(round), day }))
      if (assigned.length > 0) await setRoundDays(supabase, context.plan.id, assigned)
      await generateKnockoutFixtures(supabase, context.plan.id)
      router.replace({
        pathname: "/admin/tournaments/plan/draft/[tournamentId]",
        params: { tournamentId: id, ageGroup: grade },
      } as never)
    } catch (caught) {
      const failure = friendly(caught, "this competition")
      logDetail("knockout generate", failure)
      setProblem(failure.message)
    } finally {
      setBusy(false)
    }
  }

  async function save(replaceGames = false): Promise<boolean> {
    if (!context?.plan) return false
    setBusy(true)
    setProblem(null)
    try {
      // A KNOCKOUT HAS A DRAW, NOT TABLES. Saving the round robin arrangement for one wrote a table
      // nobody uses and was refused the moment a team joined.
      const tablesCall = formatHasBracket(context.format) ? [] : [supabase.rpc("set_tournament_plan_tables", {
        p_plan_id: context.plan.id,
        p_tables: tables.map((t) => ({ name: t.name, sides: t.sides })),
        p_replace_games: replaceGames,
      }) as never]
      const calls: Promise<{ error: unknown }>[] = [
        supabase.rpc("set_tournament_plan_days", { p_plan_id: context.plan.id, p_days: days }) as never,
        // Replacing a published plan's games regenerates them from the tables, so the settings they are
        // generated with are saved first.
        ...(replaceGames ? [] : tablesCall),
        supabase.rpc("set_tournament_plan_settings", {
          p_plan_id: context.plan.id,
          p_game_duration_minutes: duration,
          p_changeover_minutes: changeover,
          p_day_start_time: dayStart,
          p_day_end_time: dayEnd,
          p_points_win: points.win,
          p_points_draw: points.draw,
          p_points_loss: points.loss,
          // THE TRY BONUS IS STILL SENT, UNCHANGED. The control is disabled because Ovalball cannot
          // apply the rule, not because the organiser's number should be thrown away -- the day tries
          // are recorded, what they typed is still what they meant.
          p_points_try_bonus: points.tryBonus,
          p_points_losing_bonus: points.losingBonus,
          p_losing_bonus_margin: losingBonusMargin,
          p_tie_breakers: tieBreakers,
        }) as never,
        ...(replaceGames ? tablesCall : []),
      ]
      for (const call of calls) {
        const { error } = await call
        if (error) throw error
      }
      // A HYBRID'S KNOCKOUT STAGE settles a level game, and may have a play-off, like any knockout.
      if (context.format === "hybrid") {
        await setKnockoutSettings(supabase, context.plan.id, { tieResolution: tie, extraTimeMinutes: extraTime, thirdPlacePlayoff: thirdPlace })
      }
      return true
    } catch (caught) {
      // A PUBLISHED PLAN'S TABLES ARE NOT CHANGED UNDERNEATH ITS GAMES: the server says what changing
      // them would replace, and the organiser decides.
      if ((caught as { hint?: string } | null)?.hint === "TOURNAMENT_TABLES_REPLACE_GAMES") {
        setReplaceAsk((caught as { message?: string }).message ?? "Changing the tables replaces the published games.")
        return false
      }
      const failure = friendly(caught, "this tournament plan")
      logDetail("tournament planning save", failure)
      setProblem(failure.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  /** Confirmed: the tables change, the published games are generated again from them, every team is told. */
  async function replacePublishedGames() {
    setReplaceAsk(null)
    if (!(await save(true))) return
    router.replace({ pathname: "/admin/tournaments/plan/draft/[tournamentId]", params: { tournamentId: id, ageGroup: grade } } as never)
  }

  /**
   * GENERATING LEADS TO THE GAMES, not to a dialog saying games exist.
   *
   * The previous shape ended at an alert with an OK button, which told the organiser a number and then
   * put them back where they started -- the one thing they had asked for, the fixtures, stayed
   * invisible. Generation now hands straight over to the Generated Draft Plan, which reads the games
   * back out of the database.
   */
  async function generate() {
    if (!(await save())) return
    if (!context?.plan) return
    setBusy(true)
    try {
      const { error } = await supabase.rpc("generate_tournament_plan_fixtures", { p_plan_id: context.plan.id })
      if (error) throw error
      router.push({
        pathname: "/admin/tournaments/plan/draft/[tournamentId]",
        params: { tournamentId: id, ageGroup: grade },
      } as never)
    } catch (caught) {
      const failure = friendly(caught, "these fixtures")
      logDetail("tournament planning generate", failure)
      setProblem(failure.message)
    } finally {
      setBusy(false)
    }
  }

  /** A readiness item's route, taken from Planning itself. */
  async function routeAction(action: ReadinessAction) {
    switch (action) {
      case "days":
      case "teams": setStep(0); return
      case "tables":
      case "draw": setStep(1); return
      case "rounds": setStep(1); return
      case "qualifiers":
      case "schedule_settings": setStep(2); return
      case "pitches":
      case "schedule":
        router.push({ pathname: "/admin/tournaments/plan/pitches/[tournamentId]", params: { tournamentId: id, ageGroup: grade } } as never)
        return
      case "draw_update":
        if (!context?.plan) return
        setBusy(true)
        try {
          await updateDrawMembership(supabase, context.plan.id)
          await load()
        } catch (caught) {
          const failure = friendly(caught, "the draw")
          logDetail("tournament draw membership", failure)
          setProblem(failure.message)
        } finally {
          setBusy(false)
        }
        return
      default: return
    }
  }

  if (!context) {
    return (
      <View style={{ flex: 1, backgroundColor: colour.chalk, paddingTop: insets.top + space.lg, padding: space.lg }}>
        {problem ? <ErrorState message={problem} onRetry={() => void load()} /> : <CardSkeleton />}
      </View>
    )
  }

  // WHICH SHAPE THIS COMPETITION TAKES. Read from the tournament, never chosen again here: Planning
  // confirms the category, it does not ask for it a second time.
  const knockout = formatHasBracket(context?.format)
  const tri = context?.format === "tri_fixture"
  const hybrid = context?.format === "hybrid"
  const swiss = context?.format === "swiss"
  const stepNames = knockout ? KNOCKOUT_STEPS : tri ? TRI_STEPS : hybrid ? HYBRID_STEPS : swiss ? SWISS_STEPS : STEPS
  const heading = tri && step === 1 ? `Tri-Fixture (${grade})`
    : hybrid && step === 1 ? `Group Stage (${grade})`
    : swiss && step === 1 ? `Swiss Rounds (${grade})`
    : (knockout ? KNOCKOUT_STEP_HEADING : STEP_HEADING)[step]?.(grade) ?? null

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      {/* THE PLANNING CHROME, exactly as the approved mock-up draws it: a white band carrying the way
          back, the four-step progress header, and the name of the step being worked on. */}
      <View style={{ paddingTop: insets.top + space.xs, backgroundColor: colour.surface, borderBottomWidth: 1, borderBottomColor: colour.line }}>
        {step === 0 ? (
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.xs }}>
            <BackChevron onPress={() => (router.canGoBack() ? router.back() : router.replace("/admin/tournaments" as never))} />
            <Text accessibilityRole="header" style={[type.heading, { flex: 1, color: colour.ink }]}>Plan Tournament</Text>
          </View>
        ) : null}

        <View>
          {/* ON A LATER STEP THE WAY BACK IS A STEP BACK, and it sits beside the progress header rather
              than above it -- the mock-up's shape, and the one that keeps the step titles on screen.
              IT OVERLAYS rather than taking a column: giving it one narrows all four steps and
              "Teams & Dates" starts rendering as "Teams & Da...", which is the mock-up's label with a
              piece missing. The first circle's own left-hand connector is empty space, so the chevron
              sits in it without covering anything. */}
          {step > 0 && (
            <View style={{ position: "absolute", left: 0, top: 0, bottom: 18, justifyContent: "center", zIndex: 1 }}>
              <BackChevron onPress={() => setStep((step - 1) as Step)} label={`Back to ${stepNames[step - 1]}`} />
            </View>
          )}
          <StepBar step={step} names={stepNames} onStep={(s) => setStep(s)} />
        </View>

        {!!heading && (
          <Text accessibilityRole="header" style={[type.title, { color: colour.ink, paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.md, fontSize: 21 }]}>
            {heading}
          </Text>
        )}
      </View>

      <ScrollView ref={scroller} scrollEnabled={!dragLock} contentContainerStyle={{ padding: space.lg, paddingBottom: tabBar + space.xl, gap: space.md }}>
        {step === 0 && (
          <TeamsAndDates
            context={context}
            grade={grade}
            onGrade={(g) => { setGrade(g); setLoadedFor(null) }}
            days={days}
            onDays={setDays}
          />
        )}
        {step === 1 && knockout && (() => {
          // A TEAM THAT JOINED AFTER THE DRAW WAS MADE is said here, where the draw is, with the one
          // action that brings the draw up to date -- not discovered when Generate is pressed.
          const b = context.plan?.readiness?.blockers.find((x) => x.code === "DRAW_MEMBERSHIP")
          return b ? (
            <Card style={{ gap: space.sm, backgroundColor: colour.warningSurface }}>
              <Text accessibilityRole="alert" style={[type.smallMedium, { color: colour.ink, lineHeight: 20 }]}>{b.message}</Text>
              <Button label="Update the Draw" busy={busy} onPress={() => void routeAction("draw_update").then(() => setDrawVersion((v) => v + 1))} />
            </Card>
          ) : null
        })()}
        {step === 1 && knockout && (
          <KnockoutDrawStep key={drawVersion} context={context} grade={grade} onBusyChange={setBusy} />
        )}
        {step === 1 && tri && (
          <TriFixtureStep context={context} grade={grade} onChanged={() => void load()} />
        )}
        {step === 1 && swiss && (
          <SwissRoundsStep context={context} onChanged={() => void load()} />
        )}
        {step === 1 && !knockout && !tri && !swiss && (
          <TablesStep
            sides={context.sides}
            sideById={sideById}
            tables={tables}
            onTables={setTables}
            problemText={problemText}
            onDragChange={setDragLock}
          />
        )}
        {step === 2 && knockout && (
          <KnockoutSettingsStep
            context={context}
            grade={grade}
            days={days}
            duration={duration}
            tie={tie} onTie={setTie}
            extraTime={extraTime} onExtraTime={setExtraTime}
            thirdPlace={thirdPlace} onThirdPlace={setThirdPlace}
            roundDays={roundDays} onRoundDays={setRoundDays_}
          />
        )}
        {step === 2 && !knockout && (
          <SettingsStep
            context={context}
            duration={duration} onDuration={setDuration}
            changeover={changeover} onChangeover={setChangeover}
            dayStart={dayStart} onDayStart={setDayStart}
            dayEnd={dayEnd} onDayEnd={setDayEnd}
            points={points} onPoints={setPoints}
            losingBonusMargin={losingBonusMargin} onLosingBonusMargin={setLosingBonusMargin}
            tieBreakers={tieBreakers} onTieBreakers={setTieBreakers}
          />
        )}
        {step === 2 && hybrid && (
          <>
            <HybridKnockoutStage context={context} onChanged={() => void load()} />
            <KnockoutSettingsStep
              context={context}
              grade={grade}
              days={days}
              duration={duration}
              showDuration={false}
              tie={tie} onTie={setTie}
              extraTime={extraTime} onExtraTime={setExtraTime}
              thirdPlace={thirdPlace} onThirdPlace={setThirdPlace}
              roundDays={roundDays} onRoundDays={setRoundDays_}
            />
          </>
        )}
        {step === 3 && !!context.plan?.readiness && (
          <ReadinessPanel readiness={context.plan.readiness} stage="generate" onAction={(a) => void routeAction(a)} />
        )}
        {step === 3 && knockout && (
          <KnockoutReviewStep
            context={context}
            grade={grade}
            days={days}
            duration={duration}
            tie={tie}
            extraTime={extraTime}
            thirdPlace={thirdPlace}
            busy={busy}
            onEdit={(s) => setStep(s as Step)}
            onGenerate={() => void generateKnockout()}
            generateBlocked={context.plan?.readiness?.readyToGenerate === false}
          />
        )}
        {step === 3 && !knockout && (
          <ReviewStep
            context={context}
            grade={grade}
            days={days}
            tables={tables}
            duration={duration}
            changeover={changeover}
            points={points}
            expectedGames={expectedGames}
            problemText={problemText}
            busy={busy}
            generateBlocked={context.plan?.readiness?.readyToGenerate === false}
            onEdit={(s) => setStep(s)}
            onGenerate={() => void generate()}
          />
        )}

        {!!notice && <InfoNote>{notice}</InfoNote>}
        {!!problem && (
          <Text accessibilityRole="alert" style={[type.caption, { color: colour.danger, lineHeight: 18 }]}>{problem}</Text>
        )}

        {/* CONTINUE IS THE END OF THE STEP, not a bar laid over it. The mock-up shows the content
            running straight down to the bottom navigation with nothing floating above it, and a
            pinned bar on a tab screen also double-counts the navigation's own height. */}
        <Modal visible={!!replaceAsk} transparent animationType="fade" onRequestClose={() => setReplaceAsk(null)}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={() => setReplaceAsk(null)} style={{ flex: 1, backgroundColor: "rgba(7,28,20,0.45)", justifyContent: "center", padding: space.lg }}>
            <Pressable accessible={false} onPress={() => {}} style={{ backgroundColor: colour.surface, borderRadius: radius.lg, padding: space.lg, gap: space.md }}>
              <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Replace the Published Games?</Text>
              <Text style={[type.small, { color: colour.inkMuted, lineHeight: 20 }]}>{replaceAsk ?? ""}</Text>
              <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>
                To move games without changing who plays whom, use Edit Plan instead.
              </Text>
              <Button label="Cancel" variant="secondary" onPress={() => setReplaceAsk(null)} />
              <Button label="Replace Games" variant="danger" busy={busy} onPress={() => void replacePublishedGames()} />
            </Pressable>
          </Pressable>
        </Modal>

        {step < 3 && (
          <Button
            label="Continue"
            busy={busy}
            accessibilityHint={`Goes to ${stepNames[step + 1]}`}
            trailing={<ChevronRight size={18} color={colour.onForest} strokeWidth={2.2} />}
            onPress={() => {
              void (async () => {
                if (!(await save())) return
                setNotice(null)
                setStep((step + 1) as Step)
                await load()
              })()
            }}
          />
        )}
      </ScrollView>
    </View>
  )
}

/* ------------------------------------------------------------------ the chrome */

function BackChevron({ onPress, label = "Back" }: { onPress: () => void; label?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => ({ width: 40, height: 40, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
    >
      <ChevronLeft size={22} color={colour.ink} strokeWidth={2.2} />
    </Pressable>
  )
}

/**
 * THE FOUR-STEP PROGRESS HEADER.
 *
 * NUMBERED CIRCLES JOINED BY A LINE, and the number stays at every stage. A completed step that turns
 * into a tick loses which step it was, and somebody going back is looking for "2", not for a tick.
 * Green fills a step that has been reached, grey outlines one still ahead, and the current step's
 * label is the only one in full ink -- which is how the mock-up distinguishes the three states.
 */
function StepBar({ step, names, onStep, style }: { step: Step; names: readonly string[]; onStep: (s: Step) => void; style?: object }) {
  return (
    <View style={[{ flexDirection: "row", alignItems: "flex-start", paddingHorizontal: space.sm, paddingBottom: space.sm }, style]}>
      {names.map((label, i) => {
        const done = i < step
        const on = i === step
        const filled = done || on
        return (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: i > step }}
            disabled={i > step}
            accessibilityLabel={`Step ${i + 1} of ${names.length}, ${label}${on ? ", current step" : done ? ", done" : ""}`}
            onPress={() => onStep(i as Step)}
            style={{ flex: 1, alignItems: "center", gap: 5 }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", width: "100%" }}>
              <View style={{ flex: 1, height: 1.5, backgroundColor: i === 0 ? "transparent" : filled ? colour.forest800 : colour.line }} />
              <View
                style={{
                  width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center",
                  backgroundColor: filled ? colour.rugby700 : colour.surface,
                  borderWidth: 1.5, borderColor: filled ? colour.rugby700 : colour.lineStrong,
                }}
              >
                <Text style={[type.smallMedium, { color: filled ? colour.onForest : colour.inkSubtle, fontSize: 13 }]}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1, height: 1.5, backgroundColor: i === names.length - 1 ? "transparent" : done ? colour.forest800 : colour.line }} />
            </View>
            <Text numberOfLines={1} style={[on ? type.smallMedium : type.caption, { color: on ? colour.ink : colour.inkMuted, fontSize: 12 }]}>
              {label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/* ------------------------------------------------------------------ the steps */

function TeamsAndDates({
  context, grade, onGrade, days, onDays,
}: {
  context: TournamentPlanContext
  grade: string
  onGrade: (g: string) => void
  days: string[]
  onDays: (d: string[]) => void
}) {
  const router = useRouter()
  const allDays = useMemo(() => datesInclusive(context.tournamentStartsOn, context.tournamentEndsOn), [context])
  const [order, setOrder] = useState<string[]>([])
  const [gradeSheet, setGradeSheet] = useState(false)

  // The organiser's own order, over the canonical list. A side that arrives after the order was last
  // touched falls in at the end rather than disappearing.
  // WHO IS PLAYING, as the server decides it (20270720): a declined invitation is not shown at all, and
  // one still awaiting a reply is shown for what it is -- it joins the tables automatically if accepted.
  const sides = useMemo(() => {
    const visible = context.sides.filter((s) => s.status !== "declined")
    const byId = new Map(visible.map((s) => [s.participantId, s]))
    const chosen = order.map((p) => byId.get(p)).filter((s): s is PlanSide => !!s)
    return [...chosen, ...visible.filter((s) => !order.includes(s.participantId))]
  }, [context.sides, order])
  const competing = sides.filter((s) => s.competes !== false).length

  return (
    <>
      <Card style={{ gap: space.xs }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text accessibilityRole="header" style={[type.bodyMedium, { flex: 1, color: colour.ink }]}>Confirm Teams ({grade})</Text>
          {context.ageGroups.length > 1 && (
            <Pressable accessibilityRole="button" accessibilityLabel="Change Age Group" hitSlop={10} onPress={() => setGradeSheet(true)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Text style={[type.smallMedium, { color: colour.rugby700 }]}>Change Age Group</Text>
            </Pressable>
          )}
        </View>
        <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18, paddingBottom: space.xs }]}>
          The teams taking part in this competition. A team added on the Teams tab joins the tables automatically.
        </Text>

        {sides.map((s, i) => (
          <View key={s.participantId} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: colour.line }}>
            {/* THE ORDER THE SIDES ARE IN IS THE ORDER THEY FALL INTO TABLES, so it is the organiser's
                to set. The handle moves a side one place down and wraps at the end -- a real control
                with a real label, not a drag affordance that does nothing when dragged. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Move ${s.clubName} ${s.label} down the list`}
              hitSlop={8}
              onPress={() => {
                const ids = sides.map((x) => x.participantId)
                const to = (i + 1) % ids.length
                const moved = ids.filter((_, j) => j !== i)
                moved.splice(to === 0 ? 0 : to, 0, s.participantId)
                setOrder(moved)
              }}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, paddingHorizontal: 2 })}
            >
              <GripVertical size={17} color={colour.inkSubtle} strokeWidth={2} />
            </Pressable>
            <ClubCrest clubName={s.clubName} url={clubLogoUrlFromPath(supabase, s.crestPath)} size={28} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>{s.clubName}</Text>
              <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>{s.label}</Text>
            </View>
            {s.isHost && <StatusPill label="Host" tone="positive" />}
            {s.status === "pending" && <StatusPill label="Awaiting Reply" tone="caution" />}
          </View>
        ))}

        {/* ADDING A SIDE IS THE TEAMS TAB'S JOB. Planning arranges the sides a tournament has; it does
            not become a second place to enter one, which is how two team lists come to exist. */}
        <Button
          label="Add Another Team"
          variant="secondary"
          icon={<Plus size={17} color={colour.forest800} strokeWidth={2.2} />}
          accessibilityHint="Opens the tournament's Teams tab"
          style={{ marginTop: space.sm }}
          onPress={() => router.push({ pathname: "/admin/tournaments/[tournamentId]", params: { tournamentId: context.tournamentId, tab: "teams" } } as never)}
        />
        <Text style={[type.caption, { color: colour.inkMuted, paddingTop: space.sm }]}>
          {competing} {competing === 1 ? "team" : "teams"} playing · {grade} competition
          {sides.length > competing ? ` · ${sides.length - competing} awaiting a reply` : ""}
        </Text>
      </Card>

      <Card style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Tournament Dates</Text>
        <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18, paddingBottom: space.xs }]}>
          Select the days this competition will be played.
        </Text>
        {allDays.map((d) => {
          const on = days.includes(d)
          return (
            <Pressable
              key={d}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={longDay(d)}
              onPress={() => onDays(on ? days.filter((x) => x !== d) : [...days, d].sort())}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 46, opacity: pressed ? 0.7 : 1 })}
            >
              <View style={{ width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: on ? colour.rugby700 : colour.surface, borderWidth: 1.5, borderColor: on ? colour.rugby700 : colour.lineStrong }}>
                {on && <Check size={14} color={colour.onForest} strokeWidth={2.8} />}
              </View>
              <Text style={[type.small, { color: colour.ink }]}>{longDay(d)}</Text>
            </Pressable>
          )
        })}
        {/* ANOTHER DAY IS A LONGER TOURNAMENT, and how long the tournament runs is the tournament's own
            fact. This leads to where that is set rather than quietly moving `tournaments.ends_on`. */}
        <Button
          label="Add Another Day"
          variant="secondary"
          icon={<CalendarDays size={16} color={colour.forest800} strokeWidth={2} />}
          accessibilityHint="Opens the tournament's details, where its dates are set"
          style={{ marginTop: space.xs }}
          onPress={() => router.push({ pathname: "/admin/tournaments/[tournamentId]", params: { tournamentId: context.tournamentId } } as never)}
        />
        <InfoNote style={{ marginTop: space.sm }}>
          Fixtures will only be generated for the selected days. The tournament will appear in calendars for these days only.
        </InfoNote>
      </Card>

      <ChoiceSheet
        visible={gradeSheet}
        title="Change Age Group"
        hint="Each age group is planned separately."
        options={context.ageGroups.map((g) => ({ id: g, name: g }))}
        value={grade}
        emptyMessage="This tournament has no age groups."
        saving={false}
        problem={null}
        onClose={() => setGradeSheet(false)}
        onSave={(next) => { setGradeSheet(false); if (next) onGrade(next) }}
      />
    </>
  )
}

function TablesStep({
  sides, sideById, tables, onTables, problemText, onDragChange,
}: {
  sides: PlanSide[]
  sideById: Map<string, PlanSide>
  tables: DraftTable[]
  onTables: (t: DraftTable[]) => void
  problemText: string | null
  onDragChange: (dragging: boolean) => void
}) {
  const count = tables.length
  const limit = maxTables(sides.length)
  const [moving, setMoving] = useState<{ table: number; side: string } | null>(null)

  // WHERE EVERY SIDE ROW IS ON THE SCREEN, measured when a drag starts rather than kept in state, so
  // nothing re-renders while a finger is down. The drop target is whichever row the finger is over.
  const rowRefs = useRef(new Map<string, View | null>())
  const rowRects = useRef(new Map<string, { x: number; y: number; width: number; height: number }>())
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)

  function setCount(next: number) {
    const n = Math.max(1, Math.min(limit, next))
    // RESHAPING KEEPS EVERY SIDE. The split is recomputed from the sides already arranged, in the order
    // they are already in, so changing the number of tables never loses one and never reshuffles the
    // ones the organiser has deliberately placed.
    const ordered = tables.flatMap((t) => t.sides)
    const rest = sides.map((s) => s.participantId).filter((p) => !ordered.includes(p))
    const all = [...ordered, ...rest]
    const sizes = suggestedTableSizes(all.length, n)
    onTables(distribute(all, sizes).map((group, i) => ({ name: tables[i]?.name ?? defaultTableName(i), sides: group })))
  }

  /**
   * THE WHOLE DRAW, NOT ONE TABLE'S.
   *
   * Shuffling a table's own teams only reorders a list that has no order -- the same four sides play
   * the same six games whatever sequence they are listed in. A randomise worth having is the one that
   * moves sides BETWEEN tables, which is what actually changes who plays whom. Table sizes are kept,
   * because the organiser set those deliberately.
   */
  function randomiseAll() {
    const all = shuffled(sides.map((s) => s.participantId))
    const sizes = tables.map((t) => t.sides.length)
    onTables(distribute(all, sizes).map((group, i) => ({ name: tables[i]?.name ?? defaultTableName(i), sides: group })))
  }

  /** Two sides change places. A swap keeps every table the size the organiser chose. */
  function swap(a: string, b: string) {
    if (a === b) return
    onTables(tables.map((t) => ({
      ...t,
      sides: t.sides.map((p) => (p === a ? b : p === b ? a : p)),
    })))
  }

  function measureRows() {
    rowRects.current.clear()
    for (const [key, node] of rowRefs.current) {
      node?.measureInWindow((x, y, width, height) => {
        rowRects.current.set(key, { x, y, width, height })
      })
    }
  }

  function rowAt(x: number, y: number): string | null {
    for (const [key, r] of rowRects.current) {
      if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) return key
    }
    return null
  }

  return (
    <>
      <Card style={{ gap: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Number of Tables</Text>
            <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>How many tables do you want to create?</Text>
          </View>
          <Stepper value={count} min={1} max={limit} onChange={setCount} label="tables" />
        </View>
        <InfoNote>{tableGuidance(sides.length, count)}</InfoNote>
        {count >= limit && limit > 1 && (
          <InfoNote>{`${sides.length} teams cannot fill more than ${limit} tables — a table needs at least two teams to play a game.`}</InfoNote>
        )}
      </Card>

      {tables.map((t, i) => {
        const title = t.name || defaultTableName(i)
        return (
          <Card key={i} style={{ gap: space.sm }}>
            <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>{title}</Text>

            <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-end" }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[type.caption, { color: colour.inkSubtle }]}>Table Name</Text>
                <TextInput
                  accessibilityLabel={`Name for table ${i + 1}`}
                  value={t.name}
                  onChangeText={(v) => onTables(tables.map((x, j) => (j === i ? { ...x, name: v } : x)))}
                  style={{ minHeight: 42, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, paddingHorizontal: space.md, color: colour.ink, backgroundColor: colour.surface }}
                />
              </View>
              <View style={{ gap: 4 }}>
                <Text style={[type.caption, { color: colour.inkSubtle }]}>Number of Teams</Text>
                <Stepper
                  value={t.sides.length}
                  min={0}
                  max={sides.length}
                  label={`teams in ${title}`}
                  onChange={(n) => {
                    // Moving a side out of one table puts it into the next, so the total never changes.
                    const all = tables.flatMap((x) => x.sides)
                    const sizes = tables.map((x, j) => (j === i ? n : x.sides.length))
                    const total = sizes.reduce((a, b) => a + b, 0)
                    if (total !== all.length) {
                      const other = tables.findIndex((_, j) => j !== i)
                      if (other >= 0) sizes[other] = Math.max(0, sizes[other]! + (all.length - total))
                    }
                    onTables(distribute(all, sizes).map((group, j) => ({ name: tables[j]!.name, sides: group })))
                  }}
                />
              </View>
            </View>

            {t.sides.map((p) => (
              <SideRow
                key={p}
                participantId={p}
                side={sideById.get(p)}
                tableName={title}
                canMove={tables.length > 1 || t.sides.length > 1}
                dragging={dragging === p}
                over={over === p && dragging !== p}
                registerRef={(node) => rowRefs.current.set(p, node)}
                onDragStart={() => { measureRows(); setDragging(p); onDragChange(true) }}
                onDragMove={(x, y) => setOver(rowAt(x, y))}
                onDragEnd={(x, y) => {
                  const target = rowAt(x, y)
                  setDragging(null)
                  setOver(null)
                  onDragChange(false)
                  if (target) swap(p, target)
                }}
                onPickTable={() => setMoving({ table: i, side: p })}
                onRemove={() => {
                  const to = (i + 1) % tables.length
                  onTables(tables.map((x, j) =>
                    j === i ? { ...x, sides: x.sides.filter((s) => s !== p) }
                    : j === to ? { ...x, sides: [...x.sides, p] } : x))
                }}
              />
            ))}
          </Card>
        )
      })}

      {/* ONE DRAW FOR THE WHOLE COMPETITION, and it runs only when pressed. Returning to this step
          never redraws it: the allocation is explicit draft state from the moment it exists. */}
      <Button
        label="Randomise All Tables"
        variant="secondary"
        icon={<Shuffle size={16} color={colour.forest800} strokeWidth={2} />}
        accessibilityHint="Draws every team again across all tables, keeping each table's size"
        onPress={randomiseAll}
      />
      <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center", lineHeight: 18 }]}>
        Or hold a team's handle and drag it onto another to swap them.
      </Text>

      {!!problemText && <InfoNote>{problemText}</InfoNote>}

      <ChoiceSheet
        visible={!!moving}
        title="Move to Table"
        hint={moving ? `Where should ${[sideById.get(moving.side)?.clubName, sideById.get(moving.side)?.label].filter(Boolean).join(" ")} play?` : undefined}
        options={tables.map((t, j) => ({ id: String(j), name: t.name || defaultTableName(j), detail: `${t.sides.length} ${t.sides.length === 1 ? "team" : "teams"}` }))}
        value={moving ? String(moving.table) : null}
        emptyMessage="There is only one table."
        saving={false}
        problem={null}
        onClose={() => setMoving(null)}
        onSave={(choice) => {
          const target = Number(choice)
          const current = moving
          setMoving(null)
          if (!current || !Number.isInteger(target) || target === current.table || !tables[target]) return
          onTables(tables.map((x, j) =>
            j === current.table ? { ...x, sides: x.sides.filter((s) => s !== current.side) }
            : j === target ? { ...x, sides: [...x.sides, current.side] } : x))
        }}
      />
    </>
  )
}

/**
 * ONE SIDE IN A TABLE, AND THE THREE WAYS TO MOVE IT.
 *
 * DRAG THE HANDLE ONTO ANOTHER TEAM AND THE TWO SWAP -- across tables as readily as within one, which
 * is the arrangement an organiser actually makes: "those two are the wrong way round". The gesture is
 * on the HANDLE rather than the whole row, so dragging a team never fights the page's own scrolling.
 *
 * The chevron opens the same move as a list, and the cross passes the side to the next table. Both stay
 * because a drag is not available to everybody: a person using VoiceOver, or one hand on a bus, needs
 * the same outcome without the gesture.
 */
function SideRow({
  participantId, side, tableName, canMove, dragging, over,
  registerRef, onDragStart, onDragMove, onDragEnd, onPickTable, onRemove,
}: {
  participantId: string
  side: PlanSide | undefined
  tableName: string
  canMove: boolean
  dragging: boolean
  over: boolean
  registerRef: (node: View | null) => void
  onDragStart: () => void
  onDragMove: (x: number, y: number) => void
  onDragEnd: (x: number, y: number) => void
  onPickTable: () => void
  onRemove: () => void
}) {
  const who = [side?.clubName, side?.label].filter(Boolean).join(" ") || "this team"
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pan.setValue({ x: 0, y: 0 })
        onDragStart()
      },
      onPanResponderMove: (event, gesture) => {
        pan.setValue({ x: gesture.dx, y: gesture.dy })
        onDragMove(event.nativeEvent.pageX, event.nativeEvent.pageY)
      },
      onPanResponderRelease: (event, gesture) => {
        // THE FINGER'S LAST POSITION, not the row's: `pageX/pageY` is empty on release, so it is
        // reconstructed from where the drag began plus how far it travelled.
        onDragEnd(event.nativeEvent.pageX || gesture.moveX, event.nativeEvent.pageY || gesture.moveY)
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false, speed: 24 }).start()
      },
      onPanResponderTerminate: () => {
        onDragEnd(-1, -1)
        pan.setValue({ x: 0, y: 0 })
      },
      // THE PAGE MUST NOT TAKE THE GESTURE BACK. A ScrollView's native recogniser outranks a JS
      // responder by default, so a drag that travels vertically -- which every drag between two
      // tables does -- was being stolen a few pixels in, terminating the drag and leaving the team
      // exactly where it started. Refusing termination, and blocking the native responder, is what
      // makes the handle actually hold on to the finger.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
    })
  ).current

  return (
    <Animated.View
      style={{
        flexDirection: "row", alignItems: "center", gap: space.xs,
        transform: pan.getTranslateTransform(),
        zIndex: dragging ? 10 : 0,
      }}
    >
      <View
        ref={registerRef}
        style={{
          flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 48,
          borderRadius: radius.md, borderWidth: over ? 2 : 1,
          borderColor: over ? colour.rugby700 : colour.lineStrong,
          paddingHorizontal: space.xs, paddingVertical: space.xs,
          backgroundColor: over ? colour.mint100 : colour.surface,
          opacity: dragging ? 0.9 : 1,
          ...(dragging ? elevation.card : null),
        }}
      >
        <View
          {...responder.panHandlers}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`Reorder handle for ${who}`}
          accessibilityHint="Drag onto another team to swap them"
          style={{ paddingHorizontal: 4, paddingVertical: 8 }}
        >
          <GripVertical size={17} color={dragging ? colour.rugby700 : colour.inkSubtle} strokeWidth={2} />
        </View>
        <ClubCrest clubName={side?.clubName ?? "Club"} url={clubLogoUrlFromPath(supabase, side?.crestPath ?? null)} size={24} />
        {/* THE CLUB AND THE SIDE. A club bringing three sides produces three rows, and a row showing
            only the club name makes them identical -- the organiser cannot tell which one they are
            about to move, and neither can a screen reader. */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[type.small, { color: colour.ink }]}>{side?.clubName ?? "Team"}</Text>
          {!!side?.label && <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>{side.label}</Text>}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Move ${who} to another table`}
          disabled={!canMove}
          hitSlop={6}
          onPress={onPickTable}
          style={({ pressed }) => ({ padding: 4, opacity: canMove ? (pressed ? 0.6 : 1) : 0.3 })}
        >
          <ChevronDown size={16} color={colour.inkSubtle} strokeWidth={2} />
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Take ${who} out of ${tableName}`}
        hitSlop={8}
        disabled={!canMove}
        onPress={onRemove}
        style={({ pressed }) => ({ width: 32, alignItems: "center", opacity: !canMove ? 0.3 : pressed ? 0.6 : 1 })}
      >
        <X size={16} color={colour.inkSubtle} strokeWidth={2} />
      </Pressable>
    </Animated.View>
  )
}

function SettingsStep({
  context, duration, onDuration, changeover, onChangeover, dayStart, onDayStart, dayEnd, onDayEnd, points, onPoints,
  losingBonusMargin, onLosingBonusMargin, tieBreakers, onTieBreakers,
}: {
  context: TournamentPlanContext
  duration: number; onDuration: (n: number) => void
  changeover: number; onChangeover: (n: number) => void
  dayStart: string; onDayStart: (v: string) => void
  dayEnd: string; onDayEnd: (v: string) => void
  points: { win: number; draw: number; loss: number; tryBonus: number; losingBonus: number }
  onPoints: (p: { win: number; draw: number; loss: number; tryBonus: number; losingBonus: number }) => void
  losingBonusMargin: number
  onLosingBonusMargin: (n: number) => void
  tieBreakers: TieBreaker[]
  onTieBreakers: (t: TieBreaker[]) => void
}) {
  const router = useRouter()
  // WHETHER A RULE CAN BE APPLIED IS THE SERVER'S ANSWER, never a constant typed here -- so when tries
  // are recorded the control comes alive without this file being edited.
  const tryBonusRule = context.scoringRules?.tryBonus
  return (
    <>
      <Card style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Match Timing</Text>
        <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>
          How long each game runs, and the gap between games on one pitch.
        </Text>
        <Field label="Game duration">
          <Stepper value={duration} min={4} max={180} step={5} label="minutes per game" onChange={onDuration} suffix="min" />
        </Field>
        {/* WHERE THE NUMBER CAME FROM, said out loud. An organiser should never meet a default they
            cannot account for, and the age-grade regulations are the reason this one is what it is. */}
        <InfoNote>{`Default from ${context.defaults.durationSource}. A festival game may be shorter, never longer.`}</InfoNote>
        <Field label="Changeover">
          <Stepper value={changeover} min={0} max={60} step={5} label="minutes between games" onChange={onChangeover} suffix="min" />
        </Field>
        <InfoNote>Ovalball's canonical turnaround for your club. Used to space games on the same pitch.</InfoNote>
      </Card>

      <Card style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Playing Hours</Text>
        <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>
          The window each selected day is scheduled inside.
        </Text>
        {/* THE SYSTEM TIME PICKER, which is what every other time on this phone uses. A text box
            accepting "9am" and rejecting it silently is not a kinder control. */}
        <Field label="First kick-off">
          <TimeField label="First kick-off" value={dayStart} clearable={false} onChange={(v) => onDayStart(v ?? dayStart)} />
        </Field>
        <Field label="Last finish">
          <TimeField label="Last finish" value={dayEnd} clearable={false} onChange={(v) => onDayEnd(v ?? dayEnd)} />
        </Field>
        <InfoNote>
          {context.pitchesReserved === 0
            ? "No pitches are reserved for this tournament yet, so games will be generated without times. Reserve pitches to schedule them."
            : `${context.pitchesReserved} pitch ${context.pitchesReserved === 1 ? "reservation" : "reservations"} will be used to place the games.`}
        </InfoNote>
        {/* WHERE THE GAMES GO, configured before generation rather than discovered after it. */}
        <Button
          label="Manage Pitches"
          variant="secondary"
          icon={<MapPin size={16} color={colour.forest800} strokeWidth={2} />}
          accessibilityHint="Opens the pitches reserved for this tournament's playing days"
          onPress={() => router.push({ pathname: "/admin/tournaments/plan/pitches/[tournamentId]", params: { tournamentId: context.tournamentId, ageGroup: context.ageGroup } } as never)}
        />
      </Card>

      {/* A COMPETITION WITHOUT A TABLE HAS NO POINTS TO SET (a Tri-Fixture by default): the cards follow
          the server's own answer, not the format. */}
      {context.plan?.standingsEnabled !== false && (
        <>
      {/* TABLE POINTS ARE NOT MATCH SCORES. A result of 24-17 is the score; these are what that result
          is worth in the table, and the two are never the same number. */}
      <Card style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Table Points</Text>
        <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>
          What a result is worth in the table. Not the match score.
        </Text>
        <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
          <PointBox label="Win" value={points.win} onChange={(n) => onPoints({ ...points, win: n })} />
          <PointBox label="Draw" value={points.draw} onChange={(n) => onPoints({ ...points, draw: n })} />
          <PointBox label="Loss" value={points.loss} onChange={(n) => onPoints({ ...points, loss: n })} />
        </View>
        <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
          <PointBox
            label="Try bonus"
            value={points.tryBonus}
            onChange={(n) => onPoints({ ...points, tryBonus: n })}
            disabled={tryBonusRule ? !tryBonusRule.available : false}
          />
          <PointBox label="Losing bonus" value={points.losingBonus} onChange={(n) => onPoints({ ...points, losingBonus: n })} />
        </View>
        {/* A RULE THE APP CANNOT APPLY IS SAID SO, not left looking active. Awarding a try bonus needs
            TRIES SCORED, and nothing in Ovalball records them -- 24 points might be four tries and two
            conversions or three tries, two conversions and three penalties. Silently ignoring a number
            a club typed is the worst of the three outcomes. */}
        {tryBonusRule && !tryBonusRule.available && (
          <InfoNote>{`Try bonus: ${tryBonusRule.unavailableReason ?? "not currently available"}. It is kept but not counted.`}</InfoNote>
        )}
        <Field label="Losing bonus margin">
          <Stepper
            value={losingBonusMargin}
            min={0}
            max={30}
            step={1}
            label="points"
            onChange={onLosingBonusMargin}
            suffix="pts"
          />
        </Field>
        <InfoNote>
          A losing bonus is earned by losing by this many points or fewer. 7 is the RFU figure.
        </InfoNote>
        <InfoNote>Standard rugby union competition points. Change them if your competition uses different ones.</InfoNote>
      </Card>

      {/* HOW SIDES LEVEL ON POINTS ARE SEPARATED. Ovalball has no canonical sporting tie-break, so this
          is stated rather than assumed -- a competition whose app disagrees with its own rules is an
          argument in a car park. Sides level on every chosen criterion are shown level. */}
      <Card style={{ gap: space.sm }}>
        <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Tie-Breakers</Text>
        <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>
          Applied in this order when sides are level on points.
        </Text>
        <TieBreakerOrder value={tieBreakers} onChange={onTieBreakers} />
        <InfoNote>
          {tieBreakers.length === 0
            ? "Sides level on points will be shown level, in name order."
            : "Turn one off to leave it out. Sides level on everything you choose are shown level."}
        </InfoNote>
      </Card>
        </>
      )}
    </>
  )
}

function ReviewStep({
  context, grade, days, tables, duration, changeover, points, expectedGames, problemText, busy, generateBlocked, onEdit, onGenerate,
}: {
  context: TournamentPlanContext
  grade: string
  days: string[]
  tables: DraftTable[]
  duration: number
  changeover: number
  points: { win: number; draw: number; loss: number; tryBonus: number; losingBonus: number }
  expectedGames: number
  problemText: string | null
  busy: boolean
  /** True when the server's readiness says Generate would be refused -- the panel above says why. */
  generateBlocked: boolean
  onEdit: (s: Step) => void
  onGenerate: () => void
}) {
  const router = useRouter()
  const blocked = busy || !!problemText || days.length === 0 || generateBlocked

  return (
    <>
      <Card style={{ gap: space.xs }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text accessibilityRole="header" style={[type.bodyMedium, { flex: 1, color: colour.ink }]}>Plan Summary</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Edit the plan" hitSlop={10} onPress={() => onEdit(0)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Text style={[type.smallMedium, { color: colour.rugby700 }]}>Edit</Text>
          </Pressable>
        </View>
        <Fact icon={<Trophy size={15} color={colour.inkMuted} />} label="Category" value={categoryName(context.format)} />
        <Fact icon={<Users size={15} color={colour.inkMuted} />} label="Age Group" value={grade} />
        {context.format === "tri_fixture" ? (
          <Fact icon={<Users size={15} color={colour.inkMuted} />} label="Teams"
            value={`${context.sides.filter((x) => x.competes !== false).length} teams · ${context.plan?.standingsEnabled ? "with a table" : "no table"}`} />
        ) : (
          <>
            <Fact icon={<Users size={15} color={colour.inkMuted} />} label="Teams" value={`${context.sides.filter((x) => x.competes !== false).length} teams (${tables.length} ${tables.length === 1 ? "table" : "tables"})`} />
            <Fact icon={<CalendarDays size={15} color={colour.inkMuted} />} label="Tables"
              value={tables.map((t, i) => `${t.name || defaultTableName(i)} (${t.sides.length} ${t.sides.length === 1 ? "team" : "teams"})`).join(", ")} />
            {context.format === "swiss" && (
              <Fact icon={<Trophy size={15} color={colour.inkMuted} />} label="Rounds"
                value={context.swissRounds ? `${context.swissRounds} rounds, paired as you go` : "Not chosen yet"} />
            )}
            {context.format === "hybrid" && (
              <Fact icon={<Trophy size={15} color={colour.inkMuted} />} label="Knockout Stage"
                value={context.plan?.qualifiersPerTable
                  ? `${context.plan.qualifiersPerTable} from each table (${context.plan.qualifiersPerTable * tables.length} teams)`
                  : "Not chosen yet"} />
            )}
          </>
        )}
        <Fact icon={<CalendarDays size={15} color={colour.inkMuted} />} label="Dates"
          value={days.length === 0 ? "No days selected" : days.map(longDay).join(", ")} />
        {!!context.venueName && <Fact icon={<MapPin size={15} color={colour.inkMuted} />} label="Venue" value={context.venueName} />}
        {/* THE INPUTS THAT MATERIALLY CHANGE WHAT IS GENERATED are on the summary, not hidden a step away. */}
        <Fact icon={<Clock size={15} color={colour.inkMuted} />} label="Game duration" value={`${duration} min`} />
        <Fact icon={<Clock size={15} color={colour.inkMuted} />} label="Changeover" value={`${changeover} min`} />
        {context.plan?.standingsEnabled !== false && (
          <Fact icon={<Trophy size={15} color={colour.inkMuted} />} label="Points"
            value={`${points.win} win · ${points.draw} draw · ${points.loss} loss · +${points.tryBonus} try · +${points.losingBonus} losing`} />
        )}
      </Card>

      <Card style={{ gap: space.xs }}>
        <Text accessibilityRole="header" style={[type.bodyMedium, { color: colour.ink }]}>Next Steps</Text>
        <NextStep n={1} title="Generate Fixtures" body={context.format === "swiss"
          ? "We'll draw Round 1 at random and reserve kick-off times for every round. Each later round is paired when the one before it has confirmed results."
          : context.format === "hybrid"
          ? `We'll create ${expectedGames} group ${expectedGames === 1 ? "game" : "games"} and the knockout stage after them. Each knockout place fills itself when its table is decided.`
          : `We'll create ${expectedGames} ${expectedGames === 1 ? "game" : "games"} based on your settings${context.format === "tri_fixture" ? "" : " and table configuration"}.`} />
        <NextStep n={2} title="Complete Scheduling" body="Games are given kick-off times and pitches from the pitches reserved for the playing days. Anything still missing is listed on the draft, with the way to fix it." />
        <NextStep n={3} title="Publish Fixtures" body="When the draft is ready, publish it for participating teams, players and parents to see in their Tournament Centre." />
      </Card>

      {!!problemText && <InfoNote>{problemText}</InfoNote>}

      <Button
        label="Generate Fixtures"
        busy={busy}
        disabled={blocked}
        icon={<CalendarDays size={18} color={colour.onForest} strokeWidth={2} />}
        trailing={<ChevronRight size={18} color={colour.onForest} strokeWidth={2.2} />}
        accessibilityHint="Creates the draft games and opens them for review"
        style={{ minHeight: 52 }}
        onPress={onGenerate}
      />
      {/* A SWISS HAS NO EXAMPLE TO SHOW: only Round 1 exists before results, and it is drawn at random. */}
      {context.format !== "swiss" && <Button
        label="Preview Example Fixtures"
        variant="secondary"
        disabled={!!problemText}
        icon={<Eye size={17} color={colour.forest800} strokeWidth={2} />}
        accessibilityHint="Shows the pairings this configuration would produce, without creating anything"
        onPress={() => router.push({ pathname: "/admin/tournaments/plan/draft/[tournamentId]", params: { tournamentId: context.tournamentId, ageGroup: grade, preview: "1" } } as never)}
      />}
      <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center", lineHeight: 18 }]}>
        Generating creates a draft only you can see. Participants see nothing until you publish the plan.
      </Text>
    </>
  )
}

/* ------------------------------------------------------------------ pieces */

function Field({ label, style, children }: { label: string; style?: object; children: React.ReactNode }) {
  return (
    <View style={[{ gap: 4, paddingTop: space.xs }, style]}>
      <Text style={[type.caption, { color: colour.inkSubtle }]}>{label}</Text>
      {children}
    </View>
  )
}

/** One bordered control: minus, the value, plus -- the shape the approved mock-up draws. */
function Stepper({ value, min, max, step = 1, onChange, label, suffix, disabled = false }: { value: number; min: number; max: number; step?: number; onChange: (n: number) => void; label: string; suffix?: string; disabled?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-start", borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: disabled ? colour.chalk : colour.surface, overflow: "hidden", opacity: disabled ? 0.55 : 1 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Fewer ${label}`} disabled={disabled || value <= min} onPress={() => onChange(Math.max(min, value - step))}
        style={({ pressed }) => ({ width: 38, height: 40, alignItems: "center", justifyContent: "center", opacity: disabled || value <= min ? 0.35 : pressed ? 0.5 : 1 })}>
        <Text style={[type.bodyMedium, { color: colour.ink }]}>–</Text>
      </Pressable>
      <Text accessibilityLabel={`${value} ${label}`} style={[type.bodyMedium, { minWidth: suffix ? 62 : 34, textAlign: "center", color: colour.ink }]}>
        {value}{suffix ? ` ${suffix}` : ""}
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`More ${label}`} disabled={value >= max} onPress={() => onChange(Math.min(max, value + step))}
        style={({ pressed }) => ({ width: 38, height: 40, alignItems: "center", justifyContent: "center", opacity: value >= max ? 0.35 : pressed ? 0.5 : 1 })}>
        <Text style={[type.bodyMedium, { color: colour.ink }]}>+</Text>
      </Pressable>
    </View>
  )
}

function PointBox({ label, value, onChange, disabled = false }: { label: string; value: number; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <View style={{ flexGrow: 1, minWidth: 104, gap: 4 }}>
      <Text style={[type.caption, { color: disabled ? colour.inkSubtle : colour.inkSubtle }]}>{label}</Text>
      <Stepper value={value} min={0} max={20} onChange={onChange} label={`${label} points`} disabled={disabled} />
    </View>
  )
}

/**
 * THE TIE-BREAK ORDER, AS A LIST THE ORGANISER ARRANGES.
 *
 * Each criterion can be turned off, and the ones that are on are NUMBERED in the order they apply --
 * because "points difference, then head to head" and "head to head, then points difference" are
 * different competitions, and a set of unordered switches cannot say which one this is.
 *
 * Turning one ON puts it at the END of the order, which is the only placement that needs no second
 * decision. Moving it is the arrows.
 */
function TieBreakerOrder({ value, onChange }: { value: TieBreaker[]; onChange: (t: TieBreaker[]) => void }) {
  const chosen = value
  const rest = TIE_BREAKERS.filter((t) => !chosen.includes(t.key))

  function move(index: number, by: number) {
    const next = [...chosen]
    const to = index + by
    if (to < 0 || to >= next.length) return
    const [item] = next.splice(index, 1)
    next.splice(to, 0, item)
    onChange(next)
  }

  return (
    <View style={{ gap: space.xs }}>
      {chosen.map((key, index) => {
        const meta = TIE_BREAKERS.find((t) => t.key === key)
        return (
          <View
            key={key}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
              paddingHorizontal: space.sm,
              paddingVertical: space.xs,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colour.line,
              backgroundColor: colour.surface,
            }}
          >
            <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colour.mint100 }}>
              <Text style={[type.caption, { color: colour.forest800, fontSize: 12 }]}>{index + 1}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>{meta?.label ?? key}</Text>
              <Text numberOfLines={1} style={[type.caption, { color: colour.inkSubtle, fontSize: 11 }]}>{meta?.hint ?? ""}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Move ${meta?.label ?? key} up`}
              disabled={index === 0}
              onPress={() => move(index, -1)}
              hitSlop={6}
              style={({ pressed }) => ({ width: 30, height: 34, alignItems: "center", justifyContent: "center", opacity: index === 0 ? 0.3 : pressed ? 0.5 : 1 })}
            >
              <Text style={[type.bodyMedium, { color: colour.ink }]}>↑</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Move ${meta?.label ?? key} down`}
              disabled={index === chosen.length - 1}
              onPress={() => move(index, 1)}
              hitSlop={6}
              style={({ pressed }) => ({ width: 30, height: 34, alignItems: "center", justifyContent: "center", opacity: index === chosen.length - 1 ? 0.3 : pressed ? 0.5 : 1 })}
            >
              <Text style={[type.bodyMedium, { color: colour.ink }]}>↓</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${meta?.label ?? key}`}
              onPress={() => onChange(chosen.filter((k) => k !== key))}
              hitSlop={6}
              style={({ pressed }) => ({ width: 30, height: 34, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 })}
            >
              <Text style={[type.bodyMedium, { color: colour.inkSubtle }]}>×</Text>
            </Pressable>
          </View>
        )
      })}

      {rest.length > 0 && (
        <View style={{ flexDirection: "row", gap: space.xs, flexWrap: "wrap", paddingTop: 2 }}>
          {rest.map((t) => (
            <Pressable
              key={t.key}
              accessibilityRole="button"
              accessibilityLabel={`Add ${t.label}`}
              onPress={() => onChange([...chosen, t.key])}
              style={({ pressed }) => ({
                minHeight: 32,
                paddingHorizontal: space.md,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: colour.line,
                backgroundColor: colour.chalk,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={[type.caption, { color: colour.inkMuted }]}>+ {t.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  )
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md, paddingVertical: 6 }}>
      <View accessible={false} style={{ paddingTop: 1 }}>{icon}</View>
      <Text style={[type.caption, { width: 104, color: colour.inkMuted }]}>{label}</Text>
      <Text style={[type.small, { flex: 1, color: colour.ink }]}>{value}</Text>
    </View>
  )
}

function NextStep({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <View style={{ flexDirection: "row", gap: space.md, paddingVertical: space.sm }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colour.mint100 }}>
        <Text style={[type.caption, { color: colour.forest800, fontSize: 12 }]}>{n}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>{title}</Text>
        <Text style={[type.caption, { color: colour.inkMuted, lineHeight: 18 }]}>{body}</Text>
      </View>
    </View>
  )
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "Saturday 7 Nov 2026" -- the same shape the tournament header uses. */
export function longDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  if (!y || !m || !d) return iso
  return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]} ${y}`
}

function datesInclusive(startIso: string, endIso: string): string[] {
  const out: string[] = []
  const end = Date.parse(`${endIso}T00:00:00Z`)
  let cursor = Date.parse(`${startIso}T00:00:00Z`)
  if (Number.isNaN(cursor) || Number.isNaN(end)) return [startIso]
  while (cursor <= end) {
    out.push(new Date(cursor).toISOString().slice(0, 10))
    cursor += 86_400_000
  }
  return out
}
