import { useEffect, useRef, useState } from "react"
import { Animated, Pressable, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Image } from "expo-image"
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg"

import {
  applyFindFixtureDistanceFilter,
  findFixtureDateClause,
  findFixtureMatchingCopy,
  readFindFixtureAvailabilityBatch,
  readFindFixtureGameWeekBatch,
  readFindFixtureMatchesUnfiltered,
  summariseFindFixtureClubWeek,
  type CandidateAvailabilityBatchRow,
  type FindFixtureClubAvailabilitySummary,
  type FindFixtureCriteria,
  type FindFixtureMatchResult,
  type GameWeekCommitmentRow,
} from "@ovalball/contracts/clubhouse"

import { supabase } from "../../../../src/auth/supabase"
import { useAppContexts } from "../../../../src/context/contexts"
import { ErrorState } from "../../../../src/components/ui"
import { editorial } from "../../../../src/components/home/editorial"
import { Check, ChevronRight } from "../../../../src/components/icons"
import { colour, space, type, TOUCH_TARGET } from "../../../../src/design/tokens"

/**
 * FF-2 -- SMART MATCHING ("Finding Compatible Clubs"), visual-lock pass.
 *
 * ONE CONTINUOUS CINEMATIC SURFACE (the owner's own correction against the first pass, which read as
 * header + a separate floating photo card): the whole screen is the same deep-forest background: header,
 * then a compact progress block, then the pitch photograph bleeding edge-to-edge with NO card boundary
 * and NO rounded top corners of its own -- the gradient over the photograph is what makes it read as a
 * continuation of the forest above it, not a new surface.
 *
 * IMAGERY: a calm four-image rotation of the bundled, reviewed editorial photographs identified during
 * this programme's own asset audit -- `heroTraining`, `news.general`, `news.matchday`, `news.training`
 * (`news.community` excluded: it is already Clubhouse Home's own hero, and reusing it here would make
 * two different big moments look like the same photograph). Still bundled, still never downloaded or
 * generated for this pass. `ImageRotation` below crossfades between them independently of the real
 * matching work -- it never delays, skips ahead of, or waits for navigation; when matching genuinely
 * finishes, this screen unmounts immediately wherever the rotation happens to be.
 *
 * FOUR REAL STAGES, NOT A FABRICATED SEQUENCE: each one is genuine work this screen actually does, in
 * this order -- `readFindFixtureMatchesUnfiltered` (the batched compatibility RPC + club identity),
 * `readFindFixtureAvailabilityBatch` + `readFindFixtureGameWeekBatch` together (the exact-date rule and
 * the Monday-Sunday game-week rule are genuinely different questions, Section A5-A9, fetched in
 * parallel under the same "Checking known availability" stage), `applyFindFixtureDistanceFilter` (a real
 * synchronous filter step, deliberately split out of the compatibility read so "applying distance
 * preference" is its own true stage rather than a label over work that already happened), and building
 * the per-club week-aware availability summaries FF-3 needs (`summariseFindFixtureClubWeek`, genuine
 * aggregation, not a pause). `withMinDuration` only paces the reveal of an already-true completed state
 * so four checkmarks don't flash past in one frame.
 */

type StageStatus = "pending" | "active" | "done"

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

  const STAGES: { key: string; label: string; count?: string }[] = [
    { key: "compatibility", label: "Checking team compatibility", count: `${criteria.teamIds.length}/${criteria.teamIds.length}` },
    { key: "availability", label: "Checking known availability" },
    { key: "distance", label: "Applying distance preference" },
    { key: "prepare", label: "Preparing your matches" },
  ]

  useEffect(() => {
    let live = true
    setError(null)
    setCompleted(0)

    async function run() {
      const { result: unfiltered, origin } = await withMinDuration(readFindFixtureMatchesUnfiltered(supabase, criteria, viewerClubId, contextTeamId), 450)
      if (!live) return
      setCompleted(1)

      // Both the exact-date rule and the game-week rule are genuinely independent reads (Section A7:
      // never a second availability engine, but genuinely two different questions) -- fetched together
      // so this one stage's checkmark corresponds to both.
      const [availability, weekRows]: [CandidateAvailabilityBatchRow[], GameWeekCommitmentRow[]] = await withMinDuration(
        Promise.all([readFindFixtureAvailabilityBatch(supabase, criteria.teamIds, criteria.dates), readFindFixtureGameWeekBatch(supabase, criteria.teamIds, criteria.dates)]),
        450
      )
      if (!live) return
      setCompleted(2)

      const filtered: FindFixtureMatchResult = await withMinDuration(Promise.resolve(applyFindFixtureDistanceFilter(unfiltered, criteria.distance, origin)), 350)
      if (!live) return
      setCompleted(3)

      // GENUINE WORK, NOT A PAUSE: the real per-club week-aware availability aggregation FF-3 needs,
      // built here (not in FF-3 itself) so this stage's checkmark corresponds to something this screen
      // actually computed -- one summary per actionable club, joining `filtered` against both
      // `availability` and `weekRows` for the first requested date via the pinned, tested
      // `summariseFindFixtureClubWeek`.
      const primaryDate = criteria.dates[0] ?? ""
      const summaries: Record<string, FindFixtureClubAvailabilitySummary & { weekBusyCount: number }> = {}
      await withMinDuration(
        Promise.resolve().then(() => {
          for (const candidate of filtered.actionable) {
            if (candidate.clubId) summaries[candidate.clubId] = summariseFindFixtureClubWeek(candidate, criteria.teamIds.length, primaryDate, availability, weekRows)
          }
        }),
        300
      )
      if (!live) return
      setCompleted(4)

      router.replace({
        pathname: "/clubhouse/find-fixture/results",
        params: {
          criteria: params.criteria,
          teamLabels: params.teamLabels ?? "[]",
          matches: JSON.stringify(filtered),
          summaries: JSON.stringify(summaries),
          availability: JSON.stringify(availability),
          weekRows: JSON.stringify(weekRows),
          origin: JSON.stringify(origin ? { latitude: origin.latitude, longitude: origin.longitude } : null),
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
      <View style={{ paddingTop: insets.top + space.sm, paddingBottom: space.sm, paddingHorizontal: space.md, flexDirection: "row", alignItems: "center" }}>
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
          <View style={{ paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.sm, gap: 10 }}>
            {STAGES.map((stage, index) => {
              const status: StageStatus = index < completed ? "done" : index === completed ? "active" : "pending"
              return <StageRow key={stage.key} label={stage.label} count={status === "done" ? stage.count : undefined} status={status} isLast={index === STAGES.length - 1} />
            })}
          </View>

          <View style={{ flex: 1, overflow: "hidden", backgroundColor: colour.forest950 }}>
            <ImageRotation />
            <Svg style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%">
              <Defs>
                <LinearGradient id="findFixtureMatchingShade" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={colour.forest950} stopOpacity="0.92" />
                  <Stop offset="0.2" stopColor={colour.forest950} stopOpacity="0.45" />
                  <Stop offset="0.55" stopColor={colour.forest950} stopOpacity="0.4" />
                  <Stop offset="1" stopColor={colour.forest950} stopOpacity="0.95" />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill="url(#findFixtureMatchingShade)" />
            </Svg>
            <View style={{ flex: 1, paddingHorizontal: space.xl, paddingBottom: insets.bottom + space.lg, justifyContent: "flex-end", alignItems: "center", gap: space.xs }}>
              <Text style={[type.display, { color: colour.onForest, fontSize: 22, lineHeight: 27, textAlign: "center", textTransform: "uppercase", letterSpacing: 0.5 }]}>Looking for the best matches</Text>
              <Text style={[type.small, { color: colour.onForestMuted, textAlign: "center", maxWidth: 320 }]}>{copy}</Text>
            </View>
          </View>
        </>
      )}
    </View>
  )
}

const ROTATION_IMAGES = [editorial.heroTraining, editorial.news.general, editorial.news.matchday, editorial.news.training].filter((source) => source !== null)
const ROTATION_INTERVAL_MS = 2000
const ROTATION_FADE_MS = 550

/**
 * A CALM, DECORATIVE CROSSFADE -- entirely independent of the real matching work above it. Every image
 * gets the identical full-bleed cover treatment (no layout shift between them); all four are bundled
 * (`require`d, not fetched), so there is never a network wait or a blank flash. This component has no
 * awareness of matching progress and is never awaited by it -- when the real work finishes, the screen
 * unmounts (and this interval is cleared) wherever the rotation happens to be, never delayed to let a
 * fourth image "have its turn".
 */
function ImageRotation() {
  const opacities = useRef(ROTATION_IMAGES.map((_, i) => new Animated.Value(i === 0 ? 1 : 0))).current
  const indexRef = useRef(0)

  useEffect(() => {
    if (ROTATION_IMAGES.length <= 1) return
    const interval = setInterval(() => {
      const previous = indexRef.current
      const next = (previous + 1) % ROTATION_IMAGES.length
      indexRef.current = next
      Animated.timing(opacities[previous]!, { toValue: 0, duration: ROTATION_FADE_MS, useNativeDriver: true }).start()
      Animated.timing(opacities[next]!, { toValue: 1, duration: ROTATION_FADE_MS, useNativeDriver: true }).start()
    }, ROTATION_INTERVAL_MS)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opacities is a stable ref array, created once
  }, [])

  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      {ROTATION_IMAGES.map((source, i) => (
        <Animated.View key={i} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: opacities[i] }}>
          <Image source={source} accessible={false} contentFit="cover" contentPosition="center" style={{ flex: 1 }} />
        </Animated.View>
      ))}
    </View>
  )
}

function StageRow({ label, count, status, isLast }: { label: string; count?: string; status: StageStatus; isLast: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
      <View style={{ alignItems: "center" }}>
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: status === "pending" ? "rgba(255,255,255,0.08)" : colour.pitch600,
            borderWidth: status === "pending" ? 1 : 0,
            borderColor: "rgba(255,255,255,0.24)",
          }}
        >
          {status === "done" && <Check size={13} color={colour.onForest} strokeWidth={3} />}
          {status === "active" && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colour.onForest }} />}
        </View>
        {!isLast && <View style={{ width: 1, flex: 1, minHeight: 10, backgroundColor: "rgba(255,255,255,0.16)", marginTop: 2 }} />}
      </View>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 1, paddingBottom: 6 }}>
        <Text style={[type.small, { color: status === "pending" ? colour.onForestMuted : colour.onForest }]}>
          {label}
          {status === "active" ? "…" : ""}
        </Text>
        {count && <Text style={[type.caption, { color: colour.onForestMuted }]}>{count}</Text>}
      </View>
    </View>
  )
}
