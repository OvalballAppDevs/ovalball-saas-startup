import { useEffect, useMemo, useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { shiftDays } from "@ovalball/contracts"
import {
  canSearchFindFixtureCriteria,
  dedupeFindFixtureDates,
  toggleSelection,
  type ClubhouseDistanceFilter,
  type FindFixtureCriteria,
  type FindFixtureVenuePreference,
} from "@ovalball/contracts/clubhouse"
import { readClubTeams, sortTeamsInRugbyAgeOrder, type ClubTeam } from "@ovalball/contracts/club/teams"

import { supabase } from "../../../../src/auth/supabase"
import { useAppContexts } from "../../../../src/context/contexts"
import { teamRugbyCode } from "../../../../src/agenda/opponent-search"
import { ClubCrest, ClubhouseEmptyState, DistanceChips } from "../../../../src/clubhouse/components"
import { CardSkeleton } from "../../../../src/components/ui"
import { DateField } from "../../../../src/components/form"
import { Check, ChevronDown, ChevronRight, Users } from "../../../../src/components/icons"
import { colour, radius, space, type, TOUCH_TARGET } from "../../../../src/design/tokens"
import { todayIso } from "../../../../src/agenda/load"

/**
 * FF-1 -- FIND A FIXTURE HOME (FF-1.1 corrections pass).
 *
 * THE SEARCH SESSION MODEL is `FindFixtureCriteria` (packages/contracts/src/clubhouse/find-fixture.ts).
 * FF-1's own job stops at building a valid criteria object and handing it, whole, to FF-2 -- it is a
 * criteria builder, never a results screen. Pressing "Search for Compatible Clubs" serialises the
 * current criteria into the route params of `/clubhouse/find-fixture/matching` (FF-2's own dedicated
 * screen) and navigates there; nothing is ever rendered beneath the CTA on this screen.
 *
 * THIS PASS'S CORRECTIONS (owner review of the previous pass, physical iPhone):
 *   1. Distance now lives IN "3. Match Preferences", as its own compact pill row -- never hidden behind
 *      a "More Filters" disclosure, which had nothing else left behind it once distance moved and is
 *      therefore removed entirely rather than kept as empty chrome.
 *   2. Team rows are sorted `sortTeamsInRugbyAgeOrder` (packages/contracts/src/club/teams.ts) -- Senior
 *      first, then every age grade oldest-to-youngest, derived from each team's own canonical
 *      category/ageGroup, never a hardcoded name and never the DB's own lexical age_group ordering
 *      (which put "Under 10" before "Under 16").
 *   3. Team rows show the REAL club crest (`useAppContexts().club.crestUrl` -- Section 20's own
 *      resolved club identity, the exact same crest the app header and every other screen shows for
 *      this context) rather than a generic age/gender-letter badge. No per-team crest is invented.
 *   4. The entire legacy results block (compatible-club count, Map/List, sort pills, empty state,
 *      candidate cards, "Other Rugby Clubs" directory dump) is deleted from this screen. It now lives,
 *      properly, behind FF-2's own matching screen and FF-3's own results screen.
 */

const MAX_DATES = 6
const STRIP_LENGTH = 7

/** "Senior Men" / "Senior Women" / "Age Grade" -- only ever a category the team's own canonical data
 * actually states, never invented to fill the mock's own illustrative labels. */
function teamCategoryLabel(team: ClubTeam): string {
  if (team.category === "senior") return team.gender === "womens" ? "Senior Women" : team.gender === "mens" ? "Senior Men" : "Senior"
  if (team.category === "colts") return "Colts"
  return "Age Grade"
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
}

export default function FindFixture() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { active, club } = useAppContexts()
  // Carried through untouched to FF-2/FF-3 (a specific club a viewer already chose from a profile/map
  // pin) -- FF-1 itself has no results to preselect any more, so this is forwarded rather than acted on
  // here; see the FF-1.1 report's own note on this deep link.
  const params = useLocalSearchParams<{ opponentDirectoryId?: string; opponentClubId?: string }>()

  const viewerClubId = active?.clubId ?? (active?.kind === "club" ? active.id : null)
  const contextTeamId = active?.kind === "team" ? active.id : null
  const clubContext = active?.kind === "club"

  // ---------------------------------------------------------------------------------------------
  // 2. SELECT OUR TEAMS
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

  const orderedClubTeams = useMemo(() => (clubTeams ? sortTeamsInRugbyAgeOrder(clubTeams) : null), [clubTeams])

  // A club with exactly one active side has nothing to choose -- pre-selected. A club with several
  // starts with NONE selected: guessing which of several real sides the viewer means would be fabricated.
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
  // 1. SELECT DATE(S)
  // ---------------------------------------------------------------------------------------------
  const [dates, setDates] = useState<string[]>([])
  const [stripAnchor, setStripAnchor] = useState(todayIso())
  const [jumpPickerOpen, setJumpPickerOpen] = useState(false)

  function toggleDate(iso: string) {
    setDates((prev) => (prev.includes(iso) ? prev.filter((d) => d !== iso) : dedupeFindFixtureDates([...prev, iso])))
  }

  // ---------------------------------------------------------------------------------------------
  // 3. MATCH PREFERENCES -- home/away/either, and now distance too (FF-1.1 correction: distance is a
  // primary-workflow control, never hidden behind a "More filters" disclosure).
  // ---------------------------------------------------------------------------------------------
  const [venuePreference, setVenuePreference] = useState<FindFixtureVenuePreference>("either")
  const [distance, setDistance] = useState<ClubhouseDistanceFilter>("any")

  const criteria: FindFixtureCriteria = useMemo(
    () => ({ teamIds: selectedTeamIds, teamRugbyCode: teamRugbyCodeValue, dates, venuePreference, distance }),
    [selectedTeamIds, teamRugbyCodeValue, dates, venuePreference, distance]
  )
  const canSearch = canSearchFindFixtureCriteria(criteria)

  // Presentation-only team names for FF-2's own dynamic copy ("...for Men's 1st Team..."), carried
  // forward from the exact same read this screen already did -- never a second team-name fetch.
  const teamLabels = useMemo(
    () => (clubContext ? selectedClubTeamIds.map((id) => clubTeams?.find((t) => t.id === id)?.fullLabel).filter((l): l is string => !!l) : active?.kind === "team" ? [active.label] : []),
    [clubContext, selectedClubTeamIds, clubTeams, active]
  )

  // THE CTA (FF-1.1 correction): never renders results inline. Freezes the current criteria and
  // navigates to FF-2's own dedicated Smart Matching screen -- this screen's job ends here.
  function search() {
    if (!canSearch) return
    router.push({
      pathname: "/clubhouse/find-fixture/matching",
      params: {
        criteria: JSON.stringify(criteria),
        teamLabels: JSON.stringify(teamLabels),
        ...(params.opponentDirectoryId ? { opponentDirectoryId: params.opponentDirectoryId } : {}),
        ...(params.opponentClubId ? { opponentClubId: params.opponentClubId } : {}),
      },
    } as never)
  }

  const stripDates = useMemo(() => Array.from({ length: STRIP_LENGTH }, (_, i) => shiftDays(stripAnchor, i)), [stripAnchor])
  const crestUrl = clubContext ? club.crestUrl : (active?.kind === "team" ? (club.crestUrl ?? active.logoUrl ?? null) : null)

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <FindFixtureHeader onBack={() => router.back()} insets={insets} />

      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: insets.bottom + space.xxl }} keyboardShouldPersistTaps="handled">
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
              {clubContext && (
                <Pressable accessibilityRole="link" accessibilityLabel="Manage teams" onPress={() => router.push("/club/teams" as never)} hitSlop={8}>
                  <Text style={[type.caption, { color: colour.pitch600, fontFamily: type.smallMedium.fontFamily }]}>Manage</Text>
                </Pressable>
              )}
            </View>

            {clubContext && clubTeams === null && <CardSkeleton lines={2} />}
            {clubContext && clubTeams?.length === 0 && <ClubhouseEmptyState icon={<Users size={22} color={colour.forest800} strokeWidth={2} />} title="No active sides" body="Add a side from the Team Directory first." />}

            {clubContext &&
              !!orderedClubTeams?.length &&
              orderedClubTeams.map((t, index) => (
                <TeamSelectRow key={t.id} team={t} crestUrl={crestUrl} selected={selectedClubTeamIds.includes(t.id)} isFirst={index === 0} onPress={() => toggleTeam(t.id)} />
              ))}

            {!clubContext && active?.kind === "team" && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: TOUCH_TARGET + 8, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: colour.chalk }}>
                <ClubCrest url={crestUrl} size={40} />
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
            <Text style={[type.caption, { color: colour.inkMuted, marginTop: space.xs }]}>Distance</Text>
            <DistanceChips distance={distance} onChange={setDistance} />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search for Compatible Clubs"
            disabled={!canSearch}
            onPress={search}
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
          {!canSearch && (
            <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center" }]}>
              {criteria.teamIds.length === 0 ? "Select at least one team to search for." : "Select at least one date to search for."}
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  )
}

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
 * ONE MULTI-SELECT TEAM ROW: the whole row is the touch target. The REAL club crest (FF-1.1 correction,
 * Section 20's own resolved club identity) stands in for every row -- never a per-team crest, since no
 * individual team has one, and never a generic age/gender-letter badge.
 */
function TeamSelectRow({ team, crestUrl, selected, isFirst, onPress }: { team: ClubTeam; crestUrl: string | null; selected: boolean; isFirst: boolean; onPress: () => void }) {
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
      <ClubCrest url={crestUrl} size={40} />
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
