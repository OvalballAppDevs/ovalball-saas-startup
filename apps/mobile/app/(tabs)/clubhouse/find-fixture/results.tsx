import { useMemo, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import {
  distanceMiles,
  findFixtureClubWeekLabel,
  findFixtureResultCountLabel,
  sortFindFixtureMatches,
  toSortSummary,
  type CandidateAvailabilityBatchRow,
  type FindFixtureCandidateMatch,
  type FindFixtureClubAvailabilitySummary,
  type FindFixtureCriteria,
  type FindFixtureMatchResult,
  type FindFixtureResultSort,
  type GameWeekCommitmentRow,
} from "@ovalball/contracts/clubhouse"

import { ClubCrest, ClubhouseEmptyState, NetworkPill } from "../../../../src/clubhouse/components"
import { StatusPill } from "../../../../src/components/ui"
import { ChevronDown, ChevronRight, Search } from "../../../../src/components/icons"
import { colour, radius, space, type, TOUCH_TARGET } from "../../../../src/design/tokens"

type WeekSummary = FindFixtureClubAvailabilitySummary & { weekBusyCount: number }

/**
 * FF-3 -- AVAILABLE CLUBS (UI/UX + game-week pass).
 *
 * Consumes the EXACT payload FF-2 already produced -- nothing here re-fetches or re-derives
 * compatibility/availability/game-week from scratch. The club-level pill (`findFixtureClubWeekLabel`)
 * was already computed by FF-2's own "Preparing your matches" stage; this screen additionally derives
 * a per-CHIP tone from the raw `availability`/`weekRows` FF-2 also forwards, because Section A10's own
 * instruction is explicit: the card summary is only the quick scan, and individual team state must
 * never be hidden entirely behind one aggregate pill.
 *
 * TEAM CHIPS ARE THE OPPOSITION'S OWN TEAMS (Section A3), never the viewer's own selected-team labels
 * repeated -- `candidate.compatibleTeams`, the real teams THIS club has that could play us.
 *
 * ONE SIMPLIFICATION, STATED PLAINLY: the availability/week summary covers the FIRST selected date
 * (and its one enclosing game week) only. Multi-date coverage is real future work, not built here.
 */
export default function FindFixtureResults() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const params = useLocalSearchParams<{ criteria: string; teamLabels?: string; matches: string; summaries?: string; availability?: string; weekRows?: string; origin?: string }>()

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

  const origin = useMemo(() => {
    try {
      return params.origin ? (JSON.parse(params.origin) as { latitude: number | null; longitude: number | null } | null) : null
    } catch {
      return null
    }
  }, [params.origin])

  const summaries = useMemo(() => {
    try {
      const parsed = params.summaries ? (JSON.parse(params.summaries) as Record<string, WeekSummary>) : {}
      return new Map(Object.entries(parsed))
    } catch {
      return new Map<string, WeekSummary>()
    }
  }, [params.summaries])

  const availabilityRows: CandidateAvailabilityBatchRow[] = useMemo(() => {
    try {
      return params.availability ? (JSON.parse(params.availability) as CandidateAvailabilityBatchRow[]) : []
    } catch {
      return []
    }
  }, [params.availability])

  const weekRows: GameWeekCommitmentRow[] = useMemo(() => {
    try {
      return params.weekRows ? (JSON.parse(params.weekRows) as GameWeekCommitmentRow[]) : []
    } catch {
      return []
    }
  }, [params.weekRows])

  const primaryDate = criteria.dates[0] ?? ""

  const SORTS: { value: FindFixtureResultSort; label: string }[] = [
    { value: "nearest", label: "Nearest" },
    { value: "best_match", label: "Best Match" },
    { value: "most_clear", label: "Most Clear" },
  ]
  const [sort, setSort] = useState<FindFixtureResultSort>("nearest")
  const cycleSort = () => setSort((current) => SORTS[(SORTS.findIndex((s) => s.value === current) + 1) % SORTS.length]!.value)

  const sortSummaries = useMemo(() => new Map([...summaries.entries()].map(([clubId, s]) => [clubId, toSortSummary(s)])), [summaries])
  const candidates = useMemo(() => sortFindFixtureMatches(matches.actionable, sort, origin, sortSummaries), [matches.actionable, sort, origin, sortSummaries])

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

      <ScrollView contentContainerStyle={{ paddingHorizontal: space.md, paddingTop: space.md, paddingBottom: insets.bottom + space.xl, gap: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.xs, paddingBottom: 2 }}>
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
          <View style={{ gap: space.md, marginTop: space.md }}>
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
            summary={candidate.clubId ? summaries.get(candidate.clubId) : undefined}
            date={primaryDate}
            availabilityRows={availabilityRows}
            weekRows={weekRows}
            onPress={() => router.push({ pathname: "/clubhouse/club/[directoryId]", params: { directoryId: candidate.directoryId } } as never)}
          />
        ))}
      </ScrollView>
    </View>
  )
}

const MAX_VISIBLE_CHIPS = 3

/** Per-CHIP tone (Section A10: individual team state is never hidden behind one club pill) -- the same
 * three-way rule the club-level summary already applies, computed for one specific opposition team. */
function chipTone(
  candidate: Pick<FindFixtureCandidateMatch, "partnershipStatus">,
  opponentTeamId: string,
  date: string,
  availabilityRows: readonly CandidateAvailabilityBatchRow[],
  weekRows: readonly GameWeekCommitmentRow[]
): "positive" | "caution" | "neutral" {
  if (candidate.partnershipStatus !== "active") return "neutral"
  const exact = availabilityRows.find((r) => r.opponent_team_id === opponentTeamId && r.the_date === date)
  if (exact?.status === "busy" || exact?.status === "request_pending") return "caution"
  const weekHit = weekRows.some((r) => r.opponent_team_id === opponentTeamId && r.commitment_date !== date)
  if (weekHit) return "caution"
  return "positive"
}

function pillTone(summary: WeekSummary | undefined): "positive" | "caution" | "neutral" {
  if (!summary || summary.unknownCount === summary.matchedCount) return "neutral"
  const effectiveBusy = summary.busyCount + summary.tentativeCount + summary.weekBusyCount
  if (effectiveBusy === 0 && summary.unknownCount === 0) return "positive"
  if (effectiveBusy === summary.matchedCount) return "caution"
  return "caution"
}

function ResultCard({
  candidate,
  origin,
  summary,
  date,
  availabilityRows,
  weekRows,
  onPress,
}: {
  candidate: FindFixtureCandidateMatch
  origin: { latitude: number | null; longitude: number | null } | null
  summary: WeekSummary | undefined
  date: string
  availabilityRows: readonly CandidateAvailabilityBatchRow[]
  weekRows: readonly GameWeekCommitmentRow[]
  onPress: () => void
}) {
  const miles = origin && candidate.hasLocation ? distanceMiles(origin, candidate) : null
  const visibleTeams = candidate.compatibleTeams.slice(0, MAX_VISIBLE_CHIPS)
  const extra = candidate.compatibleTeams.length - visibleTeams.length
  const pillLabel = summary ? findFixtureClubWeekLabel(summary) : "Availability unknown"
  const teamCountLabel = `${candidate.compatibleTeams.length} compatible ${candidate.compatibleTeams.length === 1 ? "team" : "teams"}`

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${candidate.name}. ${teamCountLabel}. ${pillLabel}`}
      onPress={onPress}
      style={({ pressed }) => ({ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.sm, gap: 6, opacity: pressed ? 0.92 : 1 })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <ClubCrest url={candidate.logoUrl} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink, flexShrink: 1 }]}>
              {candidate.name}
            </Text>
            {candidate.partnershipStatus === "active" && <NetworkPill marker={candidate} />}
          </View>
          <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
            {miles !== null ? `${Math.round(miles)} miles away` : "Distance unavailable"} · {teamCountLabel}
          </Text>
        </View>
        <ChevronRight size={16} color={colour.inkSubtle} />
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        {visibleTeams.map((t) => (
          <StatusPill key={t.teamId} label={t.displayName} tone={chipTone(candidate, t.teamId, date, availabilityRows, weekRows)} />
        ))}
        {extra > 0 && <StatusPill label={`+${extra} more`} tone="neutral" />}
        <View style={{ flex: 1 }} />
        <StatusPill label={pillLabel} tone={pillTone(summary)} />
      </View>
    </Pressable>
  )
}
