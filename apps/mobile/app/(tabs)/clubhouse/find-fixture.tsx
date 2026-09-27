import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, ScrollView, Share, Text, TextInput, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Constants from "expo-constants"

import { shiftDays } from "@ovalball/contracts"
import {
  applyClubhouseDistanceFilter,
  applyFindFixturePartnerFilter,
  buildFindFixtureAvailability,
  canSearchFindFixtureCriteria,
  countNoKnownClashDates,
  dedupeFindFixtureDates,
  distanceMiles,
  findDistanceOrigin,
  inviteClubToOvalball,
  readFindFixtureCandidateAvailability,
  readFindFixtureCandidates,
  sortFindFixtureCandidates,
  toggleSelection,
  type ClubMapMarker,
  type ClubhouseDistanceFilter,
  type FindFixtureCandidate,
  type FindFixtureCandidateAvailability,
  type FindFixtureCriteria,
  type FindFixturePartnerFilter,
  type FindFixtureSort,
  type FindFixtureVenuePreference,
} from "@ovalball/contracts/clubhouse"
import { readClubTeams, type ClubTeam } from "@ovalball/contracts/club/teams"

import { supabase } from "../../../src/auth/supabase"
import { useAppContexts } from "../../../src/context/contexts"
import { teamRugbyCode } from "../../../src/agenda/opponent-search"
import { ClubCrest, ClubhouseEmptyState, DistanceChips, NetworkPill } from "../../../src/clubhouse/components"
import { Button, CardSkeleton, ErrorState } from "../../../src/components/ui"
import { DateField } from "../../../src/components/form"
import { Check, ChevronDown, ChevronRight, Layers, LayoutGrid, MapPin, Search, Share2, SlidersHorizontal, Users } from "../../../src/components/icons"
import { colour, radius, space, type, TOUCH_TARGET } from "../../../src/design/tokens"
import { webUrl } from "../../../src/config/environment"
import { todayIso } from "../../../src/agenda/load"

/**
 * FF-1 -- FIND A FIXTURE HOME (mock-up reconciliation: "Find a Fixture" is a flagship product within
 * Clubhouse now, not one utility screen -- built section by section against the owner's own 10-screen
 * storyboard, this pass installing ONLY the first screen).
 *
 * THE SEARCH SESSION MODEL is `FindFixtureCriteria` (packages/contracts/src/clubhouse/find-fixture.ts)
 * -- extended this pass from a single `teamId` to `teamIds: string[]`, FF-1's own major conceptual
 * improvement (multi-team selection), and now genuinely consumed here via `readFindFixtureCandidates`
 * rather than the screen calling `find_fixture_candidate_teams` inline and duplicating
 * `buildFindFixtureCandidates`'s own projection -- converging onto the canonical contract that already
 * existed but had no real caller.
 *
 * WHAT FF-1 DOES NOT DO (deliberately, per the programme's own section-by-section instruction): redesign
 * Compatible Results, build the animated Smart Matching screen, or make true multi-team matching real --
 * `readFindFixtureCandidates` still queries ONE team (`teamIds[0]`) per search; the results below are
 * the SAME single-team-at-a-time results the previous pass already built, now fed from the new criteria
 * object rather than a bare `teamId`. Multi-team compatibility ("3/3 selected teams matched") is FF-2/
 * FF-3's own stated work.
 */

// Expo Go cannot load the native MapLibre module -- see apps/mobile/app/(tabs)/clubhouse/index.tsx's
// own, more detailed comment for why this guard exists and why native-map.tsx must stay outside app/.
// Duplicated here deliberately rather than shared, so this proven, twice-broken-and-fixed pattern is
// never refactored sight-unseen on a screen this session cannot live-test on a physical device.
const DIRECTORY_ONLY_CAP = 20
const MAX_DATES = 6
const STRIP_LENGTH = 7

/** Sorted, deduplicated, capped at 6 -- the exact bound find_fixture_candidate_availability itself enforces. */
/** "Sat 17 Oct" -- rugby-friendly, never a raw ISO string. */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
}

/** "Senior Men" / "Senior Women" / "Age Grade" -- only ever a category the team's own canonical data
 * actually states, never invented to fill the mock's own illustrative labels. */
function teamCategoryLabel(team: ClubTeam): string {
  if (team.category === "senior") return team.gender === "womens" ? "Senior Women" : team.gender === "mens" ? "Senior Men" : "Senior"
  return "Age Grade"
}

const isExpoGo = Constants.appOwnership === "expo"
// eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate: see the comment above.
const NativeMap = isExpoGo ? null : (require("../../../src/clubhouse/native-map") as typeof import("../../../src/clubhouse/native-map")).ClubhouseMap

function ResultsMap({ candidates, onSelect }: { candidates: FindFixtureCandidate[]; onSelect: (c: FindFixtureCandidate) => void }) {
  if (isExpoGo || !NativeMap) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.sm }}>
        <MapPin size={32} color={colour.inkSubtle} />
        <Text style={[type.small, { color: colour.ink, textAlign: "center" }]}>The map needs a development build</Text>
        <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center" }]}>Switch to List below, or open this build from a development client.</Text>
      </View>
    )
  }
  return <NativeMap markers={candidates} onSelect={(m: ClubMapMarker) => onSelect(m as FindFixtureCandidate)} />
}

export default function FindFixture() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { active } = useAppContexts()
  const params = useLocalSearchParams<{ opponentDirectoryId?: string; opponentClubId?: string }>()

  const viewerClubId = active?.clubId ?? (active?.kind === "club" ? active.id : null)
  const contextTeamId = active?.kind === "team" ? active.id : null
  const clubContext = active?.kind === "club"

  // ---------------------------------------------------------------------------------------------
  // 2. SELECT OUR TEAMS -- real multi-select for a club-context viewer, from the exact same
  // `readClubTeams` population (and therefore the exact same authority boundary) the single-select
  // flow always used; a team-context viewer has exactly one legitimate team, so it is shown locked
  // rather than as a pointless one-row "selector".
  // ---------------------------------------------------------------------------------------------
  const [clubTeams, setClubTeams] = useState<ClubTeam[] | null>(null)
  const [selectedClubTeamIds, setSelectedClubTeamIds] = useState<string[]>([])

  useEffect(() => {
    if (!clubContext || !viewerClubId) return
    let live = true
    void readClubTeams(supabase, viewerClubId).then((d) => {
      if (live) setClubTeams(d.teams.filter((t) => t.active))
    })
    return () => {
      live = false
    }
  }, [clubContext, viewerClubId])

  // A club with exactly one active side has nothing to choose -- pre-selected, matching the previous
  // single-select behaviour exactly (zero functionality lost). A club with several starts with NONE
  // selected: guessing which of several real sides the viewer means would be a fabricated default.
  useEffect(() => {
    if (!clubContext || !clubTeams || selectedClubTeamIds.length > 0) return
    if (clubTeams.length === 1) setSelectedClubTeamIds([clubTeams[0]!.id])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubContext, clubTeams])

  const [contextTeamRugbyCode, setContextTeamRugbyCode] = useState<string | null>(null)
  useEffect(() => {
    if (!contextTeamId) return
    void teamRugbyCode(supabase, contextTeamId).then(setContextTeamRugbyCode)
  }, [contextTeamId])

  function toggleTeam(id: string) {
    setSelectedClubTeamIds((prev) => toggleSelection(prev, id))
  }

  const selectedTeamIds = useMemo(() => (clubContext ? selectedClubTeamIds : contextTeamId ? [contextTeamId] : []), [clubContext, selectedClubTeamIds, contextTeamId])
  const primaryTeamId = selectedTeamIds[0] ?? null
  const teamRugbyCodeValue = clubContext ? (clubTeams?.find((t) => t.id === primaryTeamId)?.rugbyCode ?? null) : contextTeamRugbyCode

  // ---------------------------------------------------------------------------------------------
  // 1. SELECT DATE(S) -- a real date STRIP (mock-up reconciliation), not a quick-button list plus a
  // native picker bolted on. `dates` is still the same up-to-6-dates search-session field Section 7
  // always used; `stripAnchor` is purely which 7-day window is currently visible, never itself part
  // of the search criteria.
  // ---------------------------------------------------------------------------------------------
  const [dates, setDates] = useState<string[]>([])
  const [stripAnchor, setStripAnchor] = useState(todayIso())
  const [jumpPickerOpen, setJumpPickerOpen] = useState(false)

  function toggleDate(iso: string) {
    setDates((prev) => (prev.includes(iso) ? prev.filter((d) => d !== iso) : dedupeFindFixtureDates([...prev, iso])))
  }

  // ---------------------------------------------------------------------------------------------
  // 3. MATCH PREFERENCES + secondary filters. Distance stays real but moves behind "More Filters"
  // (Section 11's own instruction) -- the primary workflow is date -> teams -> home/away -> search,
  // never buried under filter chrome.
  // ---------------------------------------------------------------------------------------------
  const [venuePreference, setVenuePreference] = useState<FindFixtureVenuePreference>("either")
  const [distance, setDistance] = useState<ClubhouseDistanceFilter>("any")
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false)
  const [sort, setSort] = useState<FindFixtureSort>("nearest")
  const [partnerFilter, setPartnerFilter] = useState<FindFixturePartnerFilter>("all")
  const [mode, setMode] = useState<"map" | "list">(isExpoGo ? "list" : "map")

  // ---------------------------------------------------------------------------------------------
  // THE SEARCH ITSELF -- only ever runs once the CTA is pressed with valid criteria (Section 13:
  // never a meaningless search state), never auto-loaded the moment a team happens to be chosen.
  // ---------------------------------------------------------------------------------------------
  const [searched, setSearched] = useState(false)
  const [markers, setMarkers] = useState<ClubMapMarker[] | null>(null)
  const [actionable, setActionable] = useState<FindFixtureCandidate[]>([])
  const [directoryOnly, setDirectoryOnly] = useState<ClubMapMarker[]>([])
  const [error, setError] = useState<string | null>(null)
  const [availabilityRows, setAvailabilityRows] = useState<{ opponent_team_id: string; the_date: string; status: string }[] | null>(null)

  const criteria: FindFixtureCriteria = useMemo(
    () => ({ teamIds: selectedTeamIds, teamRugbyCode: teamRugbyCodeValue, dates, venuePreference, distance }),
    [selectedTeamIds, teamRugbyCodeValue, dates, venuePreference, distance]
  )
  const canSearch = canSearchFindFixtureCriteria(criteria)

  const runSearch = useCallback(async () => {
    if (!canSearch) return
    setSearched(true)
    setError(null)
    setMarkers(null)
    try {
      const result = await readFindFixtureCandidates(supabase, criteria, viewerClubId, contextTeamId)
      setActionable(result.actionable)
      setDirectoryOnly(result.directoryOnly)
      // A real marker population for the map preview and directory-only distance filtering, the
      // same one `readFindFixtureCandidates` already fetched internally -- read again here only for
      // `findDistanceOrigin`, never a second directory query's worth of new network cost (this is the
      // same call `readClubhouseMarkers` itself is, cached by nothing but genuinely cheap at today's
      // real scale, exactly as the map screen's own doc comment already establishes).
      setMarkers([...result.actionable, ...result.directoryOnly])
    } catch {
      setError("Couldn't search for opposition. Check your connection and try again.")
    }
  }, [canSearch, criteria, viewerClubId, contextTeamId])

  // AVAILABILITY (Section 7) -- fires only once real dates are chosen and a search has actually run;
  // entirely separate from `runSearch` above so changing dates never re-fetches the marker/
  // compatibility population, and re-running the search never re-fetches availability for dates that
  // may no longer apply.
  useEffect(() => {
    let live = true
    setAvailabilityRows(null)
    if (!searched || !primaryTeamId || dates.length === 0) return
    void readFindFixtureCandidateAvailability(supabase, primaryTeamId, dates)
      .then((rows) => {
        if (live) setAvailabilityRows(rows)
      })
      .catch(() => {
        if (live) setAvailabilityRows([])
      })
    return () => {
      live = false
    }
  }, [searched, primaryTeamId, dates])

  const origin = useMemo(() => (markers ? findDistanceOrigin(markers) : null), [markers])

  const filteredActionable = useMemo(() => {
    const byDistance = applyClubhouseDistanceFilter(actionable, distance, origin) as FindFixtureCandidate[]
    const byPartner = applyFindFixturePartnerFilter(byDistance, partnerFilter)
    return sortFindFixtureCandidates(byPartner, sort, origin)
  }, [actionable, distance, origin, partnerFilter, sort])

  const availabilityByTeamId = useMemo(() => {
    if (dates.length === 0 || availabilityRows === null) return null
    const built = buildFindFixtureAvailability(filteredActionable, dates, availabilityRows)
    return new Map(built.map((a) => [a.teamId, a]))
  }, [filteredActionable, dates, availabilityRows])

  const sortedByClearDates = useMemo(() => {
    if (sort !== "most_clear_dates" || !availabilityByTeamId) return filteredActionable
    return [...filteredActionable].sort((a, b) => {
      const clearA = Math.max(...a.compatibleTeams.map((t) => (availabilityByTeamId.get(t.teamId) ? countNoKnownClashDates(availabilityByTeamId.get(t.teamId)!) : 0)), 0)
      const clearB = Math.max(...b.compatibleTeams.map((t) => (availabilityByTeamId.get(t.teamId) ? countNoKnownClashDates(availabilityByTeamId.get(t.teamId)!) : 0)), 0)
      return clearB - clearA || a.name.localeCompare(b.name)
    })
  }, [filteredActionable, sort, availabilityByTeamId])

  const allDirectoryOnly = useMemo(() => applyClubhouseDistanceFilter(directoryOnly, distance, origin), [directoryOnly, distance, origin])
  const filteredDirectoryOnly = allDirectoryOnly.slice(0, DIRECTORY_ONLY_CAP)

  const [mapSelectedClubId, setMapSelectedClubId] = useState<string | null>(null)
  const preselectedOpponentClubId = params.opponentClubId ?? mapSelectedClubId
  const displayedActionable = preselectedOpponentClubId ? sortedByClearDates.filter((c) => c.clubId === preselectedOpponentClubId) : sortedByClearDates

  function selectCandidate(candidate: FindFixtureCandidate, targetTeamId: string, chosenDate?: string) {
    router.push({
      pathname: "/fixtures/new",
      params: {
        teamId: primaryTeamId ?? "",
        opponentDirectoryId: candidate.directoryId,
        opponentClubId: candidate.clubId ?? "",
        targetTeamId,
        date: chosenDate ?? "",
        venuePreference,
      },
    } as never)
  }

  const withLocation = mode === "map" ? displayedActionable.filter((c) => c.hasLocation) : []
  const stripDates = useMemo(() => Array.from({ length: STRIP_LENGTH }, (_, i) => shiftDays(stripAnchor, i)), [stripAnchor])

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <FindFixtureHeader onBack={() => router.back()} insets={insets} />

      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.xxl }} keyboardShouldPersistTaps="handled">
        {/* ONE COHERENT WORKSPACE (Section 1 of the visual spec): a single warm surface carrying all
            three numbered sections, not three separate floating cards -- the reference's own density. */}
        <View style={{ backgroundColor: colour.surface, borderRadius: radius.lg, padding: space.lg, gap: space.lg }}>
          <View style={{ gap: space.sm }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>1. Select Date(s)</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Jump to a date"
              onPress={() => setJumpPickerOpen((v) => !v)}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, minHeight: 32 }}
            >
              <Text style={[type.smallMedium, { color: colour.ink }]}>{new Date(`${stripAnchor}T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</Text>
              <ChevronDown size={16} color={colour.inkMuted} />
            </Pressable>
            {jumpPickerOpen && <DateField label="Jump to a date" value={stripAnchor} onChange={setStripAnchor} />}
            <View style={{ flexDirection: "row", gap: space.xs }}>
              {stripDates.map((iso) => (
                <DateTile key={iso} iso={iso} selected={dates.includes(iso)} onPress={() => toggleDate(iso)} />
              ))}
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Previous week" onPress={() => setStripAnchor((a) => shiftDays(a, -STRIP_LENGTH))} hitSlop={8} style={{ minHeight: 32, justifyContent: "center" }}>
                <Text style={[type.caption, { color: colour.pitch600, fontFamily: type.smallMedium.fontFamily }]}>‹ Previous week</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Next week" onPress={() => setStripAnchor((a) => shiftDays(a, STRIP_LENGTH))} hitSlop={8} style={{ minHeight: 32, justifyContent: "center" }}>
                <Text style={[type.caption, { color: colour.pitch600, fontFamily: type.smallMedium.fontFamily }]}>Next week ›</Text>
              </Pressable>
            </View>
            {dates.length > 0 && (
              <Text style={[type.caption, { color: colour.inkMuted }]}>
                {dates.length} date{dates.length === 1 ? "" : "s"} selected{dates.length >= MAX_DATES ? " (maximum)" : ""}
              </Text>
            )}
          </View>

          <View style={{ height: 1, backgroundColor: colour.line }} />

          <View style={{ gap: space.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={[type.smallMedium, { color: colour.ink }]}>2. Select Our Teams</Text>
              {/* "Manage" (Section 8 of the spec): a real destination, the same Team Directory a club
                  context already reaches from Home/More -- never a dead button invented to match the
                  mock's own layout. Team-context viewers have no club-wide roster to manage, so it is
                  never shown there. */}
              {clubContext && (
                <Pressable accessibilityRole="link" accessibilityLabel="Manage teams" onPress={() => router.push("/club/teams" as never)} hitSlop={8}>
                  <Text style={[type.caption, { color: colour.pitch600, fontFamily: type.smallMedium.fontFamily }]}>Manage</Text>
                </Pressable>
              )}
            </View>

            {clubContext && clubTeams === null && <CardSkeleton lines={2} />}
            {clubContext && clubTeams?.length === 0 && <ClubhouseEmptyState icon={<Users size={22} color={colour.forest800} strokeWidth={2} />} title="No active sides" body="Add a side from the Team Directory first." />}

            {clubContext &&
              !!clubTeams?.length &&
              clubTeams.map((t, index) => (
                <TeamSelectRow key={t.id} team={t} selected={selectedClubTeamIds.includes(t.id)} isFirst={index === 0} onPress={() => toggleTeam(t.id)} />
              ))}

            {/* A team-context viewer has exactly one legitimate team -- shown, locked, never a
                pointless one-row "selector" pretending a choice exists where none does. */}
            {!clubContext && active?.kind === "team" && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH_TARGET + 8, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.chalk }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
                  <Text style={[type.caption, { color: colour.forest800, fontFamily: type.smallMedium.fontFamily }]}>{contextTeamRugbyCode === "league" ? "RL" : "RU"}</Text>
                </View>
                <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]} numberOfLines={1}>
                  {active.label}
                </Text>
                <View style={{ width: 26, height: 26, borderRadius: radius.sm, backgroundColor: colour.pitch600, alignItems: "center", justifyContent: "center" }}>
                  <Check size={16} color={colour.onForest} strokeWidth={2.8} />
                </View>
              </View>
            )}
          </View>

          <View style={{ height: 1, backgroundColor: colour.line }} />

          <View style={{ gap: space.sm }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>3. Match Preferences</Text>
            <VenueSegmentedControl value={venuePreference} onChange={setVenuePreference} />
          </View>

          <Pressable accessibilityRole="button" accessibilityLabel="More filters" onPress={() => setMoreFiltersOpen((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: 32 }}>
            <SlidersHorizontal size={14} color={colour.inkMuted} />
            <Text style={[type.caption, { color: colour.inkMuted }]}>{moreFiltersOpen ? "Hide filters" : "More filters"}</Text>
          </Pressable>
          {moreFiltersOpen && (
            <View style={{ gap: space.xs }}>
              <Text style={[type.caption, { color: colour.inkMuted }]}>Distance</Text>
              <DistanceChips distance={distance} onChange={setDistance} />
            </View>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search for Compatible Clubs"
            disabled={!canSearch}
            onPress={() => void runSearch()}
            style={({ pressed }) => ({
              minHeight: TOUCH_TARGET + 8,
              borderRadius: radius.lg,
              backgroundColor: colour.pitch600,
              alignItems: "center",
              justifyContent: "center",
              opacity: !canSearch ? 0.4 : pressed ? 0.88 : 1,
            })}
          >
            <Text style={[type.bodyMedium, { color: colour.onForest, fontSize: 16 }]}>Search for Compatible Clubs</Text>
          </Pressable>
          {/* INLINE, NEVER AN ALERT (Section 13): ordinary incomplete state explains itself quietly. */}
          {!canSearch && (
            <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center" }]}>
              {criteria.teamIds.length === 0 ? "Select at least one team to search for." : "Select at least one date to search for."}
            </Text>
          )}
        </View>

        {searched && (
          <>
            {error && <ErrorState message={error} onRetry={() => void runSearch()} />}

            {!error && markers === null && (
              <View style={{ gap: space.md }}>
                <CardSkeleton lines={2} />
                <CardSkeleton lines={2} />
              </View>
            )}

            {!error && markers !== null && (
              <View style={{ gap: space.md }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={[type.smallMedium, { color: colour.ink }]}>
                    {displayedActionable.length} compatible {displayedActionable.length === 1 ? "club" : "clubs"}
                  </Text>
                  <View style={{ flexDirection: "row", gap: space.xs }}>
                    <ModeButton label="Map" icon={<LayoutGrid size={15} color={mode === "map" ? colour.onForest : colour.ink} />} active={mode === "map"} onPress={() => setMode("map")} />
                    <ModeButton label="List" icon={<Layers size={15} color={mode === "list" ? colour.onForest : colour.ink} />} active={mode === "list"} onPress={() => setMode("list")} />
                  </View>
                </View>

                <View accessibilityRole="radiogroup" accessibilityLabel="Sort" style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
                  {(
                    [
                      { value: "nearest", label: "Nearest" },
                      { value: "partners_first", label: "Partners First" },
                      { value: "club_name", label: "Club Name" },
                      ...(dates.length > 0 ? [{ value: "most_clear_dates" as const, label: "Most Clear Dates" }] : []),
                    ] as { value: FindFixtureSort; label: string }[]
                  ).map((opt) => (
                    <Pressable
                      key={opt.value}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: sort === opt.value }}
                      onPress={() => setSort(opt.value)}
                      style={{ minHeight: 34, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: sort === opt.value ? colour.forest800 : colour.lineStrong, backgroundColor: sort === opt.value ? colour.mint100 : colour.surface, justifyContent: "center" }}
                    >
                      <Text style={[type.caption, { color: sort === opt.value ? colour.forest800 : colour.ink }]}>{opt.label}</Text>
                    </Pressable>
                  ))}
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: partnerFilter === "partners" }}
                    onPress={() => setPartnerFilter(partnerFilter === "partners" ? "all" : "partners")}
                    style={{ minHeight: 34, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: partnerFilter === "partners" ? colour.pitch600 : colour.lineStrong, backgroundColor: partnerFilter === "partners" ? colour.mint100 : colour.surface, justifyContent: "center" }}
                  >
                    <Text style={[type.caption, { color: partnerFilter === "partners" ? colour.forest800 : colour.ink }]}>Partners Only</Text>
                  </Pressable>
                </View>

                {displayedActionable.length === 0 && (
                  <ClubhouseEmptyState
                    icon={<Search size={22} color={colour.forest800} strokeWidth={2} />}
                    title={distance === "any" ? "No compatible clubs found" : `No compatible clubs found within ${distance} miles`}
                    body={distance === "any" ? "Try a different team, or check back once more clubs join Ovalball." : "Try a wider distance, or Any distance, to see more results."}
                  />
                )}

                {mode === "map" && displayedActionable.length > 0 && (
                  <View style={{ height: 320, borderRadius: radius.lg, overflow: "hidden" }}>
                    <ResultsMap
                      candidates={withLocation}
                      onSelect={(c) => {
                        setMapSelectedClubId(c.clubId)
                        setMode("list")
                      }}
                    />
                  </View>
                )}

                {mode === "list" &&
                  displayedActionable.map((candidate) => (
                    <CandidateCard
                      key={candidate.directoryId}
                      candidate={candidate}
                      origin={origin}
                      dates={dates}
                      availabilityByTeamId={availabilityByTeamId}
                      onSelectTeam={(t, chosenDate) => selectCandidate(candidate, t, chosenDate)}
                    />
                  ))}

                {mode === "list" && preselectedOpponentClubId && !params.opponentClubId && (
                  <Button variant="quiet" label="Clear Selection" onPress={() => setMapSelectedClubId(null)} />
                )}

                {filteredDirectoryOnly.length > 0 && !preselectedOpponentClubId && (
                  <View style={{ gap: space.sm, marginTop: space.md }}>
                    <Text style={[type.smallMedium, { color: colour.ink }]}>Other Rugby Clubs</Text>
                    <Text style={[type.caption, { color: colour.inkMuted }]}>
                      Not yet on Ovalball -- can&apos;t receive a fixture request yet, but you can invite them.
                      {allDirectoryOnly.length > DIRECTORY_ONLY_CAP ? ` Showing ${DIRECTORY_ONLY_CAP} of ${allDirectoryOnly.length} -- set a distance to narrow this down.` : ""}
                    </Text>
                    {filteredDirectoryOnly.map((club) => (
                      <DirectoryOnlyCard key={club.directoryId} marker={club} viewerClubId={viewerClubId} />
                    ))}
                  </View>
                )}

                {/* SECTIONS 15/16: a QUIET secondary link, not a second prominent card competing with
                    the search above -- "we can't find anyone" and "somebody is looking for us" are the
                    same job as this whole screen, from the other direction. */}
                <View style={{ marginTop: space.md, alignItems: "center", gap: space.xs }}>
                  <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center" }]}>Looking for opposition?</Text>
                  <View style={{ flexDirection: "row", gap: space.md }}>
                    <Pressable accessibilityRole="link" accessibilityLabel="Browse opportunities other clubs have posted" onPress={() => router.push("/clubhouse/opportunities" as never)} hitSlop={8}>
                      <Text style={[type.caption, { color: colour.pitch600, fontFamily: type.smallMedium.fontFamily }]}>Browse Opportunities</Text>
                    </Pressable>
                    <Text style={[type.caption, { color: colour.inkSubtle }]}>·</Text>
                    <Pressable accessibilityRole="link" accessibilityLabel="Post that your own team is looking for opposition" onPress={() => router.push({ pathname: "/clubhouse/opportunities", params: { tab: "mine" } } as never)} hitSlop={8}>
                      <Text style={[type.caption, { color: colour.pitch600, fontFamily: type.smallMedium.fontFamily }]}>Post an Opportunity</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}

/**
 * ONE DATE TILE in the strip (Section 3 of the spec): strong pitch-green fill when selected -- every
 * selected date gets the same treatment, since multi-date selection is real here, never just the
 * single most-recently-tapped one.
 */
function DateTile({ iso, selected, onPress }: { iso: string; selected: boolean; onPress: () => void }) {
  const date = new Date(`${iso}T00:00:00`)
  const weekday = date.toLocaleDateString("en-GB", { weekday: "short" })
  const day = date.getDate()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${shortDate(iso)}${selected ? ", selected" : ""}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: TOUCH_TARGET + 6,
        borderRadius: radius.md,
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        backgroundColor: selected ? colour.pitch600 : colour.chalk,
        borderWidth: 1,
        borderColor: selected ? colour.pitch600 : colour.line,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text style={[type.caption, { color: selected ? colour.onForest : colour.inkMuted }]}>{weekday}</Text>
      <Text style={[type.smallMedium, { color: selected ? colour.onForest : colour.ink }]}>{day}</Text>
    </Pressable>
  )
}

/**
 * ONE MULTI-SELECT TEAM ROW (Section 5/6/9 of the spec): the whole row is the touch target, not a tiny
 * checkbox -- a real age-grade/gender badge (no separate per-team crest exists; the club's own identity
 * is already the hero above), the team's real full label, its real category, and a large check square.
 */
function TeamSelectRow({ team, selected, isFirst, onPress }: { team: ClubTeam; selected: boolean; isFirst: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${team.fullLabel}, ${teamCategoryLabel(team)}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        minHeight: TOUCH_TARGET + 12,
        paddingVertical: space.xs,
        borderTopWidth: isFirst ? 0 : 1,
        borderTopColor: colour.line,
        backgroundColor: pressed ? "rgba(16,21,18,0.03)" : "transparent",
      })}
    >
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
        <Text style={[type.caption, { color: colour.forest800, fontFamily: type.smallMedium.fontFamily }]}>{team.ageGroup ?? (team.gender === "womens" ? "W" : team.gender === "mens" ? "M" : "•")}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
          {team.fullLabel}
        </Text>
        <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
          {teamCategoryLabel(team)}
        </Text>
      </View>
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: radius.sm,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: selected ? colour.pitch600 : colour.surface,
          borderWidth: selected ? 0 : 1.5,
          borderColor: colour.lineStrong,
        }}
      >
        {selected && <Check size={16} color={colour.onForest} strokeWidth={2.8} />}
      </View>
    </Pressable>
  )
}

/** Either | Home | Away -- one connected bar, a solid pitch-green fill for the selected segment, light
 * neutral otherwise (Section 10 of the spec). Never a fabricated fourth option. */
function VenueSegmentedControl({ value, onChange }: { value: FindFixtureVenuePreference; onChange: (v: FindFixtureVenuePreference) => void }) {
  const options: { value: FindFixtureVenuePreference; label: string }[] = [
    { value: "either", label: "Either" },
    { value: "home", label: "Home" },
    { value: "away", label: "Away" },
  ]
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Home, away or either" style={{ flexDirection: "row", backgroundColor: "rgba(16,21,18,0.05)", borderRadius: radius.md, padding: 3, gap: 3 }}>
      {options.map((opt) => {
        const selected = opt.value === value
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={opt.label}
            onPress={() => onChange(opt.value)}
            style={{ flex: 1, minHeight: TOUCH_TARGET - 8, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: selected ? colour.pitch600 : "transparent" }}
          >
            <Text style={[type.smallMedium, { color: selected ? colour.onForest : colour.ink }]}>{opt.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** Truthful words only -- never softened into "Probably free" (Section 7's own instruction). */
function dateStateLabel(state: "no_known_clash" | "busy" | "tentative" | "unknown"): string {
  if (state === "no_known_clash") return "No known clash"
  if (state === "tentative") return "Tentative"
  if (state === "unknown") return "Unknown"
  return "Busy"
}

function dateStateColours(state: "no_known_clash" | "busy" | "tentative" | "unknown"): { bg: string; fg: string; border: string } {
  if (state === "no_known_clash") return { bg: colour.mint100, fg: colour.forest800, border: colour.pitch600 }
  if (state === "tentative") return { bg: colour.chalk, fg: colour.inkMuted, border: colour.lineStrong }
  if (state === "unknown") return { bg: colour.chalk, fg: colour.inkSubtle, border: colour.line }
  return { bg: colour.chalk, fg: colour.warning, border: colour.line }
}

function CandidateCard({
  candidate,
  origin,
  dates,
  availabilityByTeamId,
  onSelectTeam,
}: {
  candidate: FindFixtureCandidate
  origin: ClubMapMarker | null
  dates: string[]
  availabilityByTeamId: Map<string, FindFixtureCandidateAvailability> | null
  onSelectTeam: (teamId: string, date?: string) => void
}) {
  const miles = origin && candidate.hasLocation && !candidate.isOwnClub ? distanceMiles(origin, candidate) : null
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.md, gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <ClubCrest url={candidate.logoUrl} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
            {candidate.name}
          </Text>
          <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
            {miles !== null ? `${Math.round(miles)} miles` : ""}
            {miles !== null && candidate.town ? " · " : ""}
            {candidate.town ?? (miles === null && !candidate.hasLocation ? "Location unavailable" : "")}
          </Text>
          <Text numberOfLines={1} style={[type.caption, { color: colour.inkSubtle }]}>
            {candidate.compatibleTeams.length} compatible {candidate.compatibleTeams.length === 1 ? "team" : "teams"}
          </Text>
        </View>
        <NetworkPill marker={candidate} />
      </View>

      {dates.length === 0 &&
        candidate.compatibleTeams.map((t) => (
          <Pressable
            key={t.teamId}
            accessibilityRole="button"
            accessibilityLabel={`Select ${t.displayName}`}
            onPress={() => onSelectTeam(t.teamId)}
            style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: pressed ? colour.forest800 : colour.mint100, borderWidth: 1, borderColor: colour.pitch600, alignSelf: "flex-start" })}
          >
            {({ pressed }) => <Text style={[type.smallMedium, { color: pressed ? colour.onForest : colour.forest800 }]}>{t.displayName}</Text>}
          </Pressable>
        ))}

      {dates.length > 0 &&
        candidate.compatibleTeams.map((t) => {
          const availability = availabilityByTeamId?.get(t.teamId) ?? null
          const clearCount = availability ? countNoKnownClashDates(availability) : null
          return (
            <View key={t.teamId} style={{ gap: space.xs }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={[type.smallMedium, { color: colour.ink }]}>{t.displayName}</Text>
                {clearCount !== null && (
                  <Text style={[type.caption, { color: colour.inkMuted }]}>
                    {clearCount} of {dates.length} clear
                  </Text>
                )}
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
                {dates.map((d) => {
                  const day = availability?.dates.find((x) => x.date === d)
                  const state = day?.state ?? "unknown"
                  // Section 7 discovery is advisory, not final authority (the eventual request still
                  // revalidates server-side) -- UNKNOWN and TENTATIVE both stay selectable, since a
                  // non-partner club's date is always UNKNOWN and that must never block arranging a
                  // fixture with them. Only a KNOWN clash (busy) is disabled here.
                  const selectable = state !== "busy"
                  const c = dateStateColours(state)
                  return (
                    <Pressable
                      key={d}
                      accessibilityRole="button"
                      accessibilityLabel={`${shortDate(d)}, ${dateStateLabel(state)}${selectable ? "" : ", not selectable"}`}
                      disabled={!selectable}
                      onPress={() => onSelectTeam(t.teamId, d)}
                      style={{ minHeight: TOUCH_TARGET, minWidth: 84, paddingHorizontal: space.sm, borderRadius: radius.md, backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center", opacity: selectable ? 1 : 0.7 }}
                    >
                      <Text style={[type.caption, { color: colour.ink }]}>{shortDate(d)}</Text>
                      <Text style={[type.caption, { color: c.fg }]}>{dateStateLabel(state)}</Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>
          )
        })}
    </View>
  )
}

/**
 * The same `inviteClubToOvalball` action the main Clubhouse map's own Club Sheet uses -- never a
 * second invitation store, never implying invitation = fixture request (the club must still join and
 * be found compatible before it can appear as an actionable candidate).
 */
function DirectoryOnlyCard({ marker, viewerClubId }: { marker: ClubMapMarker; viewerClubId: string | null }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  async function send() {
    if (!viewerClubId) {
      setError("You don't have fixture authority at a club.")
      return
    }
    setBusy(true)
    setError(null)
    const result = await inviteClubToOvalball(supabase, webUrl, viewerClubId, marker.directoryId, name.trim(), email.trim())
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setInviteLink(result.inviteLink)
  }

  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.md, gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <ClubCrest url={marker.logoUrl} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
            {marker.name}
          </Text>
          <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
            {[marker.town, marker.county].filter(Boolean).join(", ") || "Location unavailable"}
          </Text>
        </View>
        <NetworkPill marker={marker} />
      </View>

      {!open && !inviteLink && <Button variant="quiet" label="Invite to Ovalball" onPress={() => setOpen(true)} />}

      {open && !inviteLink && (
        <View style={{ gap: space.sm }}>
          <TextInput
            accessibilityLabel="Contact name"
            value={name}
            onChangeText={setName}
            placeholder="Contact name at this club"
            placeholderTextColor={colour.inkSubtle}
            style={{ minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, color: colour.ink }}
          />
          <TextInput
            accessibilityLabel="Contact email"
            value={email}
            onChangeText={setEmail}
            placeholder="Contact email"
            placeholderTextColor={colour.inkSubtle}
            autoCapitalize="none"
            keyboardType="email-address"
            style={{ minHeight: TOUCH_TARGET, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.surface, color: colour.ink }}
          />
          {error && <Text style={[type.caption, { color: colour.warning }]}>{error}</Text>}
          <Button label="Send Invitation" busy={busy} disabled={!name.trim() || !email.trim()} onPress={() => void send()} />
        </View>
      )}

      {inviteLink && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Share invitation link"
          onPress={() => void Share.share({ message: inviteLink })}
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs, minHeight: TOUCH_TARGET, borderRadius: radius.md, backgroundColor: colour.forest800 }}
        >
          <Share2 size={16} color={colour.onForest} />
          <Text style={[type.smallMedium, { color: colour.onForest }]}>Share Invitation</Text>
        </Pressable>
      )}
    </View>
  )
}

function ModeButton({ label, icon, active, onPress }: { label: string; icon: React.ReactNode; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        minHeight: 34,
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        backgroundColor: active ? colour.forest800 : colour.surface,
        borderWidth: 1,
        borderColor: active ? colour.forest800 : colour.lineStrong,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {icon}
      <Text style={[type.caption, { color: active ? colour.onForest : colour.ink }]}>{label}</Text>
    </Pressable>
  )
}

/** Deep forest header, transitioning naturally into the warm chalk workspace below (Section 1 of the
 * spec) -- task-focused, no giant hero on this screen. */
function FindFixtureHeader({ onBack, insets }: { onBack: () => void; insets: { top: number } }) {
  return (
    <View style={{ paddingTop: insets.top + space.sm, paddingBottom: space.md, paddingHorizontal: space.md, backgroundColor: colour.forest950, flexDirection: "row", alignItems: "center" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to Clubhouse"
        onPress={onBack}
        hitSlop={8}
        style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
      >
        <View style={{ transform: [{ rotate: "180deg" }] }}>
          <ChevronRight size={22} color={colour.onForest} />
        </View>
      </Pressable>
      <Text style={[type.heading, { color: colour.onForest, flex: 1, textAlign: "center", marginRight: TOUCH_TARGET }]}>Find a Fixture</Text>
    </View>
  )
}
