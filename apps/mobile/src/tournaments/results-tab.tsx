import { useCallback, useEffect, useState } from "react"
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"

import { clubLogoUrlFromPath } from "@ovalball/contracts/club-logo"
import {
  RESULTS_FILTERS,
  countsTowardsTable,
  readTournamentResultsOverview,
  resultStatusLabel,
  resultStatusTone,
  resultsFilterCount,
  type ResultsFilter,
  type ResultsGame,
  type TournamentResultsOverview,
} from "@ovalball/contracts/tournaments/results"

import { supabase } from "../auth/supabase"
import { useCurrentStack, withinStack } from "../links/stack"
import { ClubCrest } from "../components/identity"
import { ChevronRight, ClipboardList, TriangleAlert } from "../components/icons"
import { CardSkeleton, EmptyState, ErrorState, InfoNote } from "../components/ui"
import { friendly, logDetail } from "../errors/translate"
import { useTabBarHeight } from "../navigation/use-tab-bar-height"
import { colour, radius, space, type } from "../design/tokens"

import { CompetitionChooser, longDate } from "./detail-chrome"

/**
 * THE RESULTS LIST, FOR WHOEVER HAS SOMETHING TO DO ABOUT ONE.
 *
 * It is the ORGANISER'S list of work on their own tab, and it is the same component a participating
 * club reads of its own games -- because the server already narrows the list to what the caller is
 * entitled to, and a second results list for clubs would be a second place for the two to disagree
 * about what state a game is in.
 *
 * IT DECIDES NOTHING. Which games come back, which of them need somebody, and the counts behind each
 * filter are all the server's answers. The filter chips send the filter to the server rather than
 * cutting a list on the device, so a filter can never show a game the caller was not sent and the
 * count on a chip can never disagree with the list behind it.
 *
 * NOTHING IS EDITED HERE. A row goes through to the one shared result screen, where the two sides
 * submit and the organiser settles.
 */
export function TournamentResultsTab({
  tournamentId,
  ageGroups,
  submissionEnabled,
  initialAgeGroup,
  initialTableId,
}: {
  /**
   * DELIBERATELY NOT A `TournamentDetail`. The organiser's screen holds one and a participant's does
   * not, and this is one component for both -- which is the whole reason the entitlement is resolved
   * in the read rather than here. It needs the tournament, its competitions and one setting.
   */
  tournamentId: string
  ageGroups: readonly string[]
  submissionEnabled: boolean
  /** Where the Tables tab sent somebody through to a particular table's games. */
  initialAgeGroup?: string | null
  initialTableId?: string | null
}) {
  const tabBar = useTabBarHeight()
  const [grade, setGrade] = useState<string | null>(initialAgeGroup ?? ageGroups[0] ?? null)
  const [filter, setFilter] = useState<ResultsFilter>("all")
  const [tableId, setTableId] = useState<string | null>(initialTableId ?? null)
  const [overview, setOverview] = useState<TournamentResultsOverview | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (initialAgeGroup) setGrade(initialAgeGroup)
    if (initialTableId !== undefined) setTableId(initialTableId ?? null)
  }, [initialAgeGroup, initialTableId])

  const load = useCallback(async () => {
    if (!grade) {
      setOverview(null)
      setLoading(false)
      return
    }
    try {
      setProblem(null)
      setOverview(await readTournamentResultsOverview(supabase, tournamentId, grade, filter))
    } catch (caught) {
      const failure = friendly(caught, "these results")
      logDetail("tournament results", failure)
      setProblem(failure.message)
    } finally {
      setLoading(false)
    }
  }, [tournamentId, grade, filter])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  // A SUBMITTED RESULT CHANGES THIS LIST, and the screen that submitted it is the one being returned
  // from. Reloading on focus is what makes the list right without the two screens knowing about each
  // other.
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const chooser = (
    <CompetitionChooser
      ageGroups={ageGroups}
      selected={grade}
      onSelect={(g) => {
        setGrade(g)
        // A TABLE BELONGS TO ONE COMPETITION, so changing competition drops a table filter rather
        // than carrying a U12 table's id into the U16 list and showing nothing.
        setTableId(null)
      }}
      labelFor={(g) => `Show ${g} results`}
    />
  )

  const games = tableId ? (overview?.games ?? []).filter((g) => g.tableId === tableId) : (overview?.games ?? [])
  const tableName = tableId ? (overview?.games ?? []).find((g) => g.tableId === tableId)?.tableName ?? null : null

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, paddingBottom: tabBar + space.lg, gap: space.md }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true)
            void load().finally(() => setRefreshing(false))
          }}
          tintColor={colour.forest800}
        />
      }
    >
      {chooser}

      {/*
        HOW RESULTS ARE RUN, said on the surface they govern. The organiser changes it on Overview --
        this states it, because a club wondering why no scores are arriving should be able to see that
        they turned submission off.
      */}
      {!submissionEnabled && (
        <InfoNote>
          The organiser records every score for this tournament, so teams cannot submit their own.
        </InfoNote>
      )}

      {/* WHICH GAMES. The filter goes to the server, and the count on each chip is the server's own
          count over every game this viewer is entitled to -- never over the slice already on screen. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs }}>
        {RESULTS_FILTERS.map((f) => {
          const on = f.key === filter
          const count = overview ? resultsFilterCount(overview.counts, f.key) : null
          return (
            <Pressable
              key={f.key}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={count === null ? f.label : `${f.label}, ${count}`}
              onPress={() => setFilter(f.key)}
              style={({ pressed }) => ({
                minHeight: 34,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: space.md,
                borderRadius: radius.pill,
                backgroundColor: on ? colour.forest800 : colour.surface,
                borderWidth: 1,
                borderColor: on ? colour.forest800 : colour.line,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={[type.smallMedium, { color: on ? colour.onForest : colour.ink }]}>{f.label}</Text>
              {count !== null && (
                <Text style={[type.caption, { color: on ? colour.onForestMuted : colour.inkSubtle }]}>{count}</Text>
              )}
            </Pressable>
          )
        })}
      </ScrollView>

      {/* A TABLE FILTER ARRIVED FROM THE TABLES TAB. Named and removable: a list silently showing a
          third of its games is a list people think is broken. */}
      {!!tableId && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Stop filtering by ${tableName ?? "this table"}`}
          onPress={() => setTableId(null)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            paddingHorizontal: space.md,
            paddingVertical: space.sm,
            borderRadius: radius.md,
            backgroundColor: colour.mint100,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text style={[type.small, { flex: 1, color: colour.forest800 }]}>
            Showing {tableName ?? "one table"} only
          </Text>
          <Text style={[type.smallMedium, { color: colour.forest800 }]}>Show all</Text>
        </Pressable>
      )}

      {loading && <CardSkeleton lines={4} />}

      {!loading && problem && <ErrorState message={problem} onRetry={() => void load()} />}

      {!loading && !problem && !overview && (
        <EmptyState
          title="No results to manage"
          body={
            grade
              ? "You are not the organiser of this competition and have no side in it."
              : "This tournament has no competitions yet."
          }
          icon={<ClipboardList size={24} color={colour.inkSubtle} />}
        />
      )}

      {!loading && !problem && !!overview && games.length === 0 && (
        <EmptyState
          title={filter === "all" ? "No games yet" : "Nothing in this filter"}
          body={
            filter === "all"
              ? "Publish the programme for this competition and its games appear here."
              : "Every game has moved on from this state."
          }
          icon={<ClipboardList size={24} color={colour.inkSubtle} />}
        />
      )}

      {!loading &&
        !problem &&
        dayGroups(games).map((group) => (
          <View key={group.date} style={{ gap: space.xs }}>
            <Text style={[type.overline, { color: colour.inkSubtle, paddingHorizontal: space.xs }]}>
              {longDate(group.date).toUpperCase()}
            </Text>
            <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, overflow: "hidden" }}>
              {group.games.map((game, index) => (
                <ResultRow key={game.id} game={game} first={index === 0} />
              ))}
            </View>
          </View>
        ))}
    </ScrollView>
  )
}

/** One day's games under one heading. A festival across a weekend is not one undifferentiated list. */
function dayGroups(games: ResultsGame[]): { date: string; games: ResultsGame[] }[] {
  const out: { date: string; games: ResultsGame[] }[] = []
  for (const game of games) {
    const last = out[out.length - 1]
    if (last && last.date === game.date) last.games.push(game)
    else out.push({ date: game.date, games: [game] })
  }
  return out
}

function ResultRow({ game, first }: { game: ResultsGame; first: boolean }) {
  const router = useRouter()
  const stack = useCurrentStack()
  const settled = countsTowardsTable(game.resultStatus)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${game.sideA.clubName} against ${game.sideB.clubName}, ${resultStatusLabel(game.resultStatus)}`}
      onPress={() => router.push(withinStack({ pathname: "/tournaments/result/[gameId]", params: { gameId: game.id } }, stack) as never)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colour.line,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 6 }}>
        <SideLine side={game.sideA} score={game.sideAScore} settled={settled} />
        <SideLine side={game.sideB} score={game.sideBScore} settled={settled} />

        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexWrap: "wrap" }}>
          {/* NEEDS ATTENTION IS THE SERVER'S ANSWER, and it is per viewer: the organiser settles
              contests and chases unrecorded scores, a side answers the opposition. */}
          {game.needsAttention && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colour.warningSurface }}>
              <TriangleAlert size={11} color={colour.warning} strokeWidth={2} />
              <Text style={[type.caption, { color: colour.warning, fontSize: 11 }]}>Needs attention</Text>
            </View>
          )}
          {/* THE STATE, AS ITS OWN MARK. "Confirmed" and "Recorded" both count towards the table and
              are deliberately not the same colour: one is two clubs agreeing, the other is one club's
              record of a game the opposition was never on Ovalball to answer. */}
          <ResultStatePill status={game.resultStatus} />
          <Text style={[type.caption, { color: colour.inkSubtle, fontSize: 11 }]}>
            {[
              game.startTime ? game.startTime.slice(0, 5) : null,
              // A KNOCKOUT NAMES ITS GAMES; a round robin names its table and its round. The server
              // writes the knockout's name, so the draw and the result never call the same game
              // two different things.
              ...(game.stageLabel
                ? [game.stageLabel]
                : game.roundName
                ? [game.roundName]
                : [game.tableName, game.round ? `Round ${game.round}` : null]),
              game.pitchName,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
      </View>
      <ChevronRight size={16} color={colour.inkSubtle} strokeWidth={2} />
    </Pressable>
  )
}

function ResultStatePill({ status }: { status: ResultsGame["resultStatus"] }) {
  const tone = resultStatusTone(status)
  const ground =
    tone === "positive"
      ? colour.successSurface
      : tone === "settled"
        ? colour.chalk
        : tone === "caution"
          ? colour.warningSurface
          : colour.chalk
  const ink =
    tone === "positive" ? colour.forest800 : tone === "caution" ? colour.warning : colour.inkMuted
  return (
    <View
      style={{
        paddingHorizontal: space.sm,
        paddingVertical: 2,
        borderRadius: radius.pill,
        backgroundColor: ground,
        borderWidth: tone === "positive" || tone === "caution" ? 0 : 1,
        borderColor: colour.line,
      }}
    >
      <Text style={[type.caption, { color: ink, fontSize: 11 }]}>{resultStatusLabel(status)}</Text>
    </View>
  )
}

function SideLine({
  side,
  score,
  settled,
}: {
  side: ResultsGame["sideA"]
  score: number | null
  settled: boolean
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
      <ClubCrest clubName={side.clubName} url={clubLogoUrlFromPath(supabase, side.crestPath)} size={20} />
      <Text numberOfLines={1} style={[type.smallMedium, { flex: 1, color: colour.ink }]}>
        {side.clubName}
      </Text>
      {/*
        A SCORE THAT IS NOT SETTLED IS DRAWN QUIETLY. It is somebody's claim, not the result, and
        giving it the same weight as an agreed score is how a contested number ends up quoted as fact.
      */}
      <Text
        style={[
          settled ? type.bodyMedium : type.body,
          { color: score === null ? colour.inkSubtle : settled ? colour.forest800 : colour.inkMuted },
        ]}
      >
        {score ?? "—"}
      </Text>
    </View>
  )
}
