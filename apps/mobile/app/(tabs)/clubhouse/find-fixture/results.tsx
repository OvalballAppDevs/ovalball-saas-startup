import { useMemo, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import {
  distanceMiles,
  findFixtureAvailabilitySummaryLabel,
  findFixtureResultCountLabel,
  matchedTeamCountLabel,
  sortFindFixtureMatches,
  type FindFixtureCandidateMatch,
  type FindFixtureClubAvailabilitySummary,
  type FindFixtureCriteria,
  type FindFixtureMatchResult,
  type FindFixtureResultSort,
} from "@ovalball/contracts/clubhouse"

import { ClubCrest, ClubhouseEmptyState, NetworkPill } from "../../../../src/clubhouse/components"
import { StatusPill } from "../../../../src/components/ui"
import { ChevronDown, ChevronRight, Search } from "../../../../src/components/icons"
import { colour, radius, space, type, TOUCH_TARGET } from "../../../../src/design/tokens"

/**
 * FF-3 -- AVAILABLE CLUBS (visual-lock pass: the real results screen, not a handoff stub).
 *
 * Consumes the EXACT payload FF-2 already produced (`matches`, `summaries`, `origin`) -- nothing here
 * re-fetches or re-derives compatibility/availability from scratch, and the per-club availability
 * summary is not even recomputed here: FF-2's own "Preparing your matches" stage already built it
 * (`summariseFindFixtureClubAvailability`, joining the batched availability rows against the batched
 * matches for the first requested date), so this screen only presents it (`findFixtureAvailabilitySummaryLabel`,
 * never upgrading a coarsened `no_known_clash` into a confirmed "Available") and pins "N/M teams matched"
 * (`matchedTeamCountLabel`, already pinned) and the three named sort modes (`sortFindFixtureMatches`).
 *
 * ONE SIMPLIFICATION, STATED PLAINLY: the availability summary covers the FIRST selected date only.
 * Multi-date coverage (a per-date breakdown across several requested dates) is real future work, not
 * built here -- flagged in this pass's own report rather than silently assumed.
 */
export default function FindFixtureResults() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const params = useLocalSearchParams<{ criteria: string; teamLabels?: string; matches: string; summaries?: string; origin?: string }>()

  const criteria: FindFixtureCriteria = useMemo(() => {
    try {
      return JSON.parse(params.criteria) as FindFixtureCriteria
    } catch {
      return { teamIds: [], teamRugbyCode: null, dates: [], venuePreference: "either", distance: "any" }
    }
  }, [params.criteria])

  const teamLabels: string[] = useMemo(() => {
    try {
      return params.teamLabels ? (JSON.parse(params.teamLabels) as string[]) : []
    } catch {
      return []
    }
  }, [params.teamLabels])
  const teamLabelById = useMemo(() => new Map(criteria.teamIds.map((id, i) => [id, teamLabels[i] ?? id])), [criteria.teamIds, teamLabels])

  const matches: FindFixtureMatchResult = useMemo(() => {
    try {
      return params.matches ? (JSON.parse(params.matches) as FindFixtureMatchResult) : { actionable: [], directoryOnly: [] }
    } catch {
      return { actionable: [], directoryOnly: [] }
    }
  }, [params.matches])

  const origin = useMemo(() => {
    try {
      return params.origin ? (JSON.parse(params.origin) as { latitude: number | null; longitude: number | null } | null) : null
    } catch {
      return null
    }
  }, [params.origin])

  const summaries = useMemo(() => {
    try {
      const parsed = params.summaries ? (JSON.parse(params.summaries) as Record<string, FindFixtureClubAvailabilitySummary>) : {}
      return new Map(Object.entries(parsed))
    } catch {
      return new Map<string, FindFixtureClubAvailabilitySummary>()
    }
  }, [params.summaries])

  const SORTS: { value: FindFixtureResultSort; label: string }[] = [
    { value: "nearest", label: "Nearest" },
    { value: "best_match", label: "Best Match" },
    { value: "most_clear", label: "Most Clear" },
  ]
  const [sort, setSort] = useState<FindFixtureResultSort>("nearest")
  const cycleSort = () => setSort((current) => SORTS[(SORTS.findIndex((s) => s.value === current) + 1) % SORTS.length]!.value)

  const candidates = useMemo(() => sortFindFixtureMatches(matches.actionable, sort, origin, summaries), [matches.actionable, sort, origin, summaries])

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View style={{ paddingTop: insets.top + space.sm, paddingBottom: space.md, paddingHorizontal: space.md, backgroundColor: colour.forest950, flexDirection: "row", alignItems: "center" }}>
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
        <Text style={[type.heading, { color: colour.onForest, flex: 1, textAlign: "center", marginRight: TOUCH_TARGET }]}>Available Clubs</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: insets.bottom + space.xxl }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={[type.smallMedium, { color: colour.ink }]}>{findFixtureResultCountLabel(candidates.length)} available</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Sorted by ${SORTS.find((s) => s.value === sort)!.label}. Change sort order`}
            onPress={cycleSort}
            style={{ flexDirection: "row", alignItems: "center", gap: 2, minHeight: 32, paddingHorizontal: space.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colour.lineStrong }}
          >
            <Text style={[type.caption, { color: colour.ink }]}>{SORTS.find((s) => s.value === sort)!.label}</Text>
            <ChevronDown size={14} color={colour.inkMuted} />
          </Pressable>
        </View>

        {candidates.length === 0 && (
          <View style={{ gap: space.md }}>
            <ClubhouseEmptyState
              icon={<Search size={22} color={colour.forest800} strokeWidth={2} />}
              title="No matching clubs yet"
              body="We couldn't find an Ovalball club matching these teams and dates."
              action={{ label: "Edit Search", onPress: () => router.back() }}
            />
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Post that your own team is looking for opposition"
              onPress={() => router.push({ pathname: "/clubhouse/opportunities", params: { tab: "mine" } } as never)}
              hitSlop={8}
              style={{ alignSelf: "center" }}
            >
              <Text style={[type.caption, { color: colour.pitch600, fontFamily: type.smallMedium.fontFamily }]}>Post Looking for Opposition</Text>
            </Pressable>
          </View>
        )}

        {candidates.map((candidate) => (
          <ResultCard
            key={candidate.directoryId}
            candidate={candidate}
            origin={origin}
            totalSelected={criteria.teamIds.length}
            teamLabelById={teamLabelById}
            summary={candidate.clubId ? summaries.get(candidate.clubId) : undefined}
            onPress={() => router.push({ pathname: "/clubhouse/club/[directoryId]", params: { directoryId: candidate.directoryId } } as never)}
          />
        ))}
      </ScrollView>
    </View>
  )
}

const MAX_VISIBLE_CHIPS = 3

function ResultCard({
  candidate,
  origin,
  totalSelected,
  teamLabelById,
  summary,
  onPress,
}: {
  candidate: FindFixtureCandidateMatch
  origin: { latitude: number | null; longitude: number | null } | null
  totalSelected: number
  teamLabelById: Map<string, string>
  summary: FindFixtureClubAvailabilitySummary | undefined
  onPress: () => void
}) {
  const miles = origin && candidate.hasLocation ? distanceMiles(origin, candidate) : null
  const chipLabels = candidate.matchedTeamIds.map((id) => teamLabelById.get(id) ?? id)
  const visibleChips = chipLabels.slice(0, MAX_VISIBLE_CHIPS)
  const extra = chipLabels.length - visibleChips.length
  const availabilityLabel = summary ? findFixtureAvailabilitySummaryLabel(summary) : "Availability unknown"
  const availabilityTone = !summary || summary.unknownCount === summary.matchedCount ? "neutral" : summary.noKnownClashCount === summary.matchedCount ? "positive" : summary.busyCount > 0 ? "caution" : "neutral"

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${candidate.name}. ${matchedTeamCountLabel(candidate, totalSelected)}. ${availabilityLabel}`}
      onPress={onPress}
      style={({ pressed }) => ({ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.md, gap: space.sm, opacity: pressed ? 0.92 : 1 })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <ClubCrest url={candidate.logoUrl} size={48} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text numberOfLines={2} style={[type.smallMedium, { color: colour.ink }]}>
            {candidate.name}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <Text style={[type.caption, { color: colour.inkMuted }]}>{miles !== null ? `${Math.round(miles)} miles away` : "Distance unavailable"}</Text>
            {candidate.partnershipStatus === "active" && <NetworkPill marker={candidate} />}
          </View>
          <Text style={[type.caption, { color: colour.inkSubtle }]}>{matchedTeamCountLabel(candidate, totalSelected)}</Text>
        </View>
        <ChevronRight size={18} color={colour.inkSubtle} />
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.xs }}>
        {visibleChips.map((label) => (
          <StatusPill key={label} label={label} tone="neutral" />
        ))}
        {extra > 0 && <StatusPill label={`+${extra} more`} tone="neutral" />}
        <View style={{ flex: 1 }} />
        <StatusPill label={availabilityLabel} tone={availabilityTone} />
      </View>
    </Pressable>
  )
}
