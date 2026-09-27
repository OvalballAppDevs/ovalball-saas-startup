import { useMemo } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { matchedTeamCountLabel, type FindFixtureCriteria, type FindFixtureMatchResult } from "@ovalball/contracts/clubhouse"

import { ClubCrest, ClubhouseEmptyState, NetworkPill } from "../../../../src/clubhouse/components"
import { ChevronRight, Search } from "../../../../src/components/icons"
import { colour, radius, space, type, TOUCH_TARGET } from "../../../../src/design/tokens"

/**
 * FF-3 -- COMPATIBLE CLUBS: A MINIMAL, HONEST HANDOFF STUB, NOT THE FULL RESULTS EXPERIENCE.
 *
 * Per the FF-1.1/FF-2 programme's own explicit instruction: FF-2 must navigate to a dedicated FF-3
 * route on completion (never append results beneath FF-2, never bounce back to FF-1), but the full
 * visual Available Clubs design is deliberately NOT built this pass. This screen exists to prove the
 * real, multi-team-matched payload genuinely arrives here -- club identity, distance-filtered, with the
 * real "N/M teams matched" count per club -- without pretending to be the finished product.
 *
 * `matches` is the exact `FindFixtureMatchResult` FF-2 already produced via `readFindFixtureMatches`
 * (real club identity from `readClubhouseMarkers` already joined onto the batched compatibility rows) --
 * this screen never re-derives it from raw rows, which would have no real club name/crest/location to
 * work with at all.
 *
 * NOT WIRED YET, DELIBERATELY: Map/List, sort, per-matchup availability detail, the "Other Rugby Clubs"
 * directory dump (removed from this flow entirely per the programme's own instruction -- directory
 * discovery remains a Find a Club / Explore Map / Club Profile job, never an automatic result here), and
 * per-candidate team selection into a fixture request. Rows are read-only this pass.
 */
export default function FindFixtureResults() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const params = useLocalSearchParams<{ criteria: string; matches: string; availability?: string }>()

  const criteria: FindFixtureCriteria = useMemo(() => {
    try {
      return JSON.parse(params.criteria) as FindFixtureCriteria
    } catch {
      return { teamIds: [], teamRugbyCode: null, dates: [], venuePreference: "either", distance: "any" }
    }
  }, [params.criteria])

  const matches: FindFixtureMatchResult = useMemo(() => {
    try {
      return params.matches ? (JSON.parse(params.matches) as FindFixtureMatchResult) : { actionable: [], directoryOnly: [] }
    } catch {
      return { actionable: [], directoryOnly: [] }
    }
  }, [params.matches])
  const candidates = matches.actionable

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View style={{ paddingTop: insets.top + space.sm, paddingBottom: space.md, paddingHorizontal: space.md, backgroundColor: colour.forest950, flexDirection: "row", alignItems: "center" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Find a Fixture"
          onPress={() => router.push("/clubhouse/find-fixture" as never)}
          hitSlop={8}
          style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.onForest} />
          </View>
        </Pressable>
        <Text style={[type.heading, { color: colour.onForest, flex: 1, textAlign: "center", marginRight: TOUCH_TARGET }]}>Compatible Clubs</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: insets.bottom + space.xxl }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>
          {candidates.length} compatible {candidates.length === 1 ? "club" : "clubs"}
        </Text>

        {candidates.length === 0 && (
          <ClubhouseEmptyState icon={<Search size={22} color={colour.forest800} strokeWidth={2} />} title="No compatible clubs found" body="Try different teams or dates, or check back once more clubs join Ovalball." />
        )}

        {candidates.map((candidate) => (
          <View key={candidate.directoryId} style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.md, flexDirection: "row", alignItems: "center", gap: space.md }}>
            <ClubCrest url={candidate.logoUrl} size={40} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
                {candidate.name}
              </Text>
              <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
                {candidate.compatibleTeams.length} compatible {candidate.compatibleTeams.length === 1 ? "team" : "teams"} · {matchedTeamCountLabel(candidate, criteria.teamIds.length)}
              </Text>
            </View>
            <NetworkPill marker={candidate} />
          </View>
        ))}

        {candidates.length > 0 && <Text style={[type.caption, { color: colour.inkSubtle, textAlign: "center", marginTop: space.md }]}>Full match details are coming in a future update.</Text>}
      </ScrollView>
    </View>
  )
}
