import { useCallback, useEffect, useState } from "react"
import { RefreshControl, ScrollView, Text, View } from "react-native"
import { useFocusEffect, useRouter } from "expo-router"

import { readTournamentBracket, type TournamentBracket } from "@ovalball/contracts/tournaments/knockout"

import { supabase } from "../auth/supabase"
import { useCurrentStack, withinStack } from "../links/stack"
import { CardSkeleton, EmptyState, ErrorState, InfoNote, StatusPill } from "../components/ui"
import { Trophy } from "../components/icons"
import { friendly, logDetail } from "../errors/translate"
import { useTabBarHeight } from "../navigation/use-tab-bar-height"
import { colour, space, type } from "../design/tokens"

import { CompetitionChooser } from "./detail-chrome"
import { TournamentBracketView } from "./bracket"

/**
 * THE DRAW, FOR EVERYBODY ENTITLED TO SEE IT.
 *
 * ONE IMPLEMENTATION, TWO AUDIENCES, exactly as the table is. A knockout's shape is a fact about the
 * competition rather than a view of it, and the server already decides what each viewer may read: an
 * organiser sees their draft, everybody else sees what was published, and scores follow the
 * tournament's own result visibility.
 *
 * IT IS READ-ONLY HERE, FOR EVERYONE. The organiser arranges a draw in Planning, which is where the
 * authority to change it lives; a participant's Draw tab is a projection and never a control surface.
 * A bracket that could be edited from the place people read it is a bracket that gets edited by
 * accident.
 *
 * NOTHING ADVANCES HERE EITHER. A side moves up the bracket because the SERVER resolved a settled
 * result into the place above, not because this screen noticed a score.
 */
export function TournamentDrawTab({
  tournamentId,
  ageGroup,
  ageGroups,
}: {
  tournamentId: string
  /** Where the screen above already established the competition, as the participant Centre does. */
  ageGroup: string | null
  /** The competitions to choose between, where the screen above has no chooser of its own. */
  ageGroups: readonly string[]
}) {
  const tabBar = useTabBarHeight()
  const router = useRouter()
  const stack = useCurrentStack()
  const [grade, setGrade] = useState<string | null>(ageGroup ?? ageGroups[0] ?? null)
  const competition = ageGroup ?? grade
  const [bracket, setBracket] = useState<TournamentBracket | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!competition) {
      setBracket(null)
      setLoading(false)
      return
    }
    try {
      setProblem(null)
      setBracket(await readTournamentBracket(supabase, tournamentId, competition))
    } catch (caught) {
      const failure = friendly(caught, "this draw")
      logDetail("tournament draw", failure)
      setProblem(failure.message)
    } finally {
      setLoading(false)
    }
  }, [tournamentId, competition])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  // A RESULT SETTLED ELSEWHERE MOVES THE BRACKET, and the screen that settled it is the one being
  // returned from. Reloading on focus is what makes the draw right without the two screens knowing
  // about each other.
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load]),
  )

  const chooser = ageGroup ? null : (
    <CompetitionChooser
      ageGroups={ageGroups}
      selected={competition}
      onSelect={setGrade}
      labelFor={(g) => `Show the ${g} draw`}
    />
  )

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.md, paddingBottom: tabBar + space.lg, gap: space.md }}
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

      {loading && <CardSkeleton lines={5} />}
      {!loading && problem && <ErrorState message={problem} onRetry={() => void load()} />}

      {!loading && !problem && (!bracket || bracket.rounds.length === 0) && (
        <EmptyState
          title="No draw yet"
          body={
            bracket && bracket.canManage
              ? "Make the draw in Planning, and it appears here."
              : "The organiser has not published the draw for this competition yet."
          }
          icon={<Trophy size={24} color={colour.inkSubtle} />}
        />
      )}

      {!loading && !problem && !!bracket && bracket.rounds.length > 0 && (
        <>
          {/* A DRAFT IS THE ORGANISER'S WORKINGS. Only they can be here to see one, and it says so. */}
          {!bracket.published && (
            <View style={{ gap: space.xs }}>
              <View style={{ flexDirection: "row" }}>
                <StatusPill label="Draft" tone="caution" />
              </View>
              <InfoNote>
                Only your club can see this draw. Participating teams, players and parents see nothing
                until the plan is published.
              </InfoNote>
            </View>
          )}

          <TournamentBracketView
            bracket={bracket}
            onOpenGame={(gameId) =>
              router.push(withinStack({ pathname: "/tournaments/result/[gameId]", params: { gameId } }, stack) as never)
            }
          />

          {!bracket.showsScores && (
            <Text style={[type.caption, { color: colour.inkSubtle }]}>
              The organiser has kept this competition&#39;s scores to the clubs taking part.
            </Text>
          )}
        </>
      )}
    </ScrollView>
  )
}
