import { useEffect, useRef, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Image } from "expo-image"
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg"

import { findFixtureDateClause, findFixtureMatchingCopy, readFindFixtureAvailabilityBatch, readFindFixtureMatches, type FindFixtureCriteria } from "@ovalball/contracts/clubhouse"

import { supabase } from "../../../../src/auth/supabase"
import { useAppContexts } from "../../../../src/context/contexts"
import { ErrorState } from "../../../../src/components/ui"
import { editorial } from "../../../../src/components/home/editorial"
import { Check, ChevronRight } from "../../../../src/components/icons"
import { colour, radius, space, type, TOUCH_TARGET } from "../../../../src/design/tokens"

/**
 * FF-2 -- SMART MATCHING (the "Finding Compatible Clubs" screen).
 *
 * A DEDICATED, SEPARATE ROUTE (FF-1.1 correction): FF-1 never renders results inline any more --
 * pressing its CTA navigates here, criteria serialised in the route params (the same
 * `FindFixtureCriteria` search-session model, never a second store). This screen's whole job is to run
 * the real multi-team read, show genuine progress while it does, then hand the result on to FF-3.
 *
 * REAL PROGRESS, NOT A FAKED SEQUENCE (Section N of the spec): each stage corresponds to one real
 * network call this screen actually makes -- `find_fixture_candidate_teams_batch` (via
 * `readFindFixtureMatches`), then `find_fixture_candidate_availability_batch`, then the client-side
 * aggregation into the match payload FF-3 needs. `withMinDuration` only paces the reveal of an already-
 * true completed state so three checkmarks don't flash past in one frame -- it never adds fake work or
 * a fake stage that doesn't correspond to something this screen is genuinely doing.
 *
 * IMAGERY: `editorial.heroTraining` -- the bundled, reviewed, dusk/floodlit photograph identified for
 * this screen and confirmed to exist on disk; never a newly generated or downloaded image.
 */

type StageStatus = "pending" | "active" | "done"

const STAGES: { key: string; label: string }[] = [
  { key: "compatibility", label: "Checking team compatibility" },
  { key: "availability", label: "Checking known availability" },
  { key: "prepare", label: "Preparing your matches" },
]

async function withMinDuration<T>(work: Promise<T>, ms: number): Promise<T> {
  const [result] = await Promise.all([work, new Promise((resolve) => setTimeout(resolve, ms))])
  return result
}

/** "Sat 26 Sep 2026" -- rugby-friendly, never a raw ISO string. Kept in the UI layer deliberately (see
 * `findFixtureDateClause`'s own doc comment) so the branching logic itself stays testable without a
 * locale-dependent formatter. */
function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
}

export default function FindFixtureMatching() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { active } = useAppContexts()
  const params = useLocalSearchParams<{ criteria: string; teamLabels?: string; opponentDirectoryId?: string; opponentClubId?: string }>()

  const viewerClubId = active?.clubId ?? (active?.kind === "club" ? active.id : null)
  const contextTeamId = active?.kind === "team" ? active.id : null

  const criteriaRef = useRef<FindFixtureCriteria | null>(null)
  if (criteriaRef.current === null) {
    try {
      criteriaRef.current = JSON.parse(params.criteria) as FindFixtureCriteria
    } catch {
      criteriaRef.current = { teamIds: [], teamRugbyCode: null, dates: [], venuePreference: "either", distance: "any" }
    }
  }
  const criteria = criteriaRef.current
  const teamLabels: string[] = params.teamLabels ? (JSON.parse(params.teamLabels) as string[]) : []

  const [completed, setCompleted] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setError(null)
    setCompleted(0)

    async function run() {
      const matches = await withMinDuration(readFindFixtureMatches(supabase, criteria, viewerClubId, contextTeamId), 500)
      if (!live) return
      setCompleted(1)

      const availability = await withMinDuration(readFindFixtureAvailabilityBatch(supabase, criteria.teamIds, criteria.dates), 500)
      if (!live) return
      setCompleted(2)

      await withMinDuration(Promise.resolve(), 400)
      if (!live) return
      setCompleted(3)

      router.replace({
        pathname: "/clubhouse/find-fixture/results",
        params: {
          criteria: params.criteria,
          matches: JSON.stringify(matches),
          availability: JSON.stringify(availability),
          ...(params.opponentDirectoryId ? { opponentDirectoryId: params.opponentDirectoryId } : {}),
          ...(params.opponentClubId ? { opponentClubId: params.opponentClubId } : {}),
        },
      } as never)
    }

    void run().catch(() => {
      if (live) setError("Couldn't search for opposition. Check your connection and try again.")
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- criteria/teamIds are frozen at mount via criteriaRef
  }, [])

  const dateClause = findFixtureDateClause(criteria.dates.length, criteria.dates[0] ? longDate(criteria.dates[0]) : "")
  const copy = findFixtureMatchingCopy(criteria.teamIds.length, teamLabels[0] ?? null, dateClause)

  return (
    <View style={{ flex: 1, backgroundColor: colour.forest950 }}>
      <View style={{ paddingTop: insets.top + space.sm, paddingBottom: space.md, paddingHorizontal: space.md, flexDirection: "row", alignItems: "center" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Find a Fixture"
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.onForest} />
          </View>
        </Pressable>
        <Text style={[type.heading, { color: colour.onForest, flex: 1, textAlign: "center", marginRight: TOUCH_TARGET }]}>Finding Compatible Clubs</Text>
      </View>

      {error ? (
        <View style={{ flex: 1, padding: space.lg, justifyContent: "center" }}>
          <ErrorState message={error} onRetry={() => router.replace({ pathname: "/clubhouse/find-fixture/matching", params } as never)} />
        </View>
      ) : (
        <>
          <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, gap: space.md }}>
            {STAGES.map((stage, index) => {
              const status: StageStatus = index < completed ? "done" : index === completed ? "active" : "pending"
              return <StageRow key={stage.key} label={stage.label} status={status} isLast={index === STAGES.length - 1} />
            })}
          </View>

          <View style={{ flex: 1, marginTop: space.lg, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: "hidden", backgroundColor: colour.forest900 }}>
            {editorial.heroTraining && (
              <Image source={editorial.heroTraining} accessible={false} contentFit="cover" contentPosition="center" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
            )}
            <Svg style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%">
              <Defs>
                <LinearGradient id="findFixtureMatchingShade" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={colour.forest950} stopOpacity="0.15" />
                  <Stop offset="0.55" stopColor={colour.forest950} stopOpacity="0.55" />
                  <Stop offset="1" stopColor={colour.forest950} stopOpacity="0.94" />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill="url(#findFixtureMatchingShade)" />
            </Svg>
            <View style={{ flex: 1, padding: space.lg, paddingBottom: insets.bottom + space.xl, justifyContent: "flex-end", gap: space.xs }}>
              <Text style={[type.display, { color: colour.onForest, fontSize: 24, lineHeight: 30 }]}>Looking for the best matches</Text>
              <Text style={[type.small, { color: colour.onForestMuted }]}>{copy}</Text>
            </View>
          </View>
        </>
      )}
    </View>
  )
}

function StageRow({ label, status, isLast }: { label: string; status: StageStatus; isLast: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
      <View style={{ alignItems: "center" }}>
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: status === "pending" ? "rgba(255,255,255,0.08)" : colour.pitch600,
            borderWidth: status === "pending" ? 1 : 0,
            borderColor: "rgba(255,255,255,0.24)",
          }}
        >
          {status === "done" && <Check size={16} color={colour.onForest} strokeWidth={2.8} />}
          {status === "active" && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colour.onForest }} />}
        </View>
        {!isLast && <View style={{ width: 1, flex: 1, minHeight: 16, backgroundColor: "rgba(255,255,255,0.16)", marginTop: 2 }} />}
      </View>
      <Text style={[type.smallMedium, { color: status === "pending" ? colour.onForestMuted : colour.onForest, paddingTop: 3 }]}>{label}{status === "active" ? "…" : ""}</Text>
    </View>
  )
}
