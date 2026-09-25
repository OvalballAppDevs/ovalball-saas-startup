import { useCallback, useEffect, useMemo, useState } from "react"
import { Pressable, ScrollView, Share, Text, TextInput, View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Constants from "expo-constants"

import {
  applyClubhouseDistanceFilter,
  applyFindFixturePartnerFilter,
  buildFindFixtureCandidates,
  findDistanceOrigin,
  inviteClubToOvalball,
  readClubhouseMarkers,
  sortFindFixtureCandidates,
  type ClubMapMarker,
  type ClubhouseDistanceFilter,
  type FindFixtureCandidate,
  type FindFixturePartnerFilter,
  type FindFixtureSort,
  type FindFixtureVenuePreference,
} from "@ovalball/contracts/clubhouse"
import { readClubTeams, type ClubTeam } from "@ovalball/contracts/club/teams"

import { supabase } from "../../../src/auth/supabase"
import { useAppContexts } from "../../../src/context/contexts"
import { teamRugbyCode } from "../../../src/agenda/opponent-search"
import { ClubCrest, DistanceChips, NetworkPill } from "../../../src/clubhouse/components"
import { Button, CardSkeleton, EmptyState, ErrorState } from "../../../src/components/ui"
import { ChoiceField, DateField } from "../../../src/components/form"
import { ChevronRight, Layers, LayoutGrid, MapPin, Share2 } from "../../../src/components/icons"
import { colour, radius, space, type, TOUCH_TARGET } from "../../../src/design/tokens"
import { webUrl } from "../../../src/config/environment"
import { todayIso } from "../../../src/agenda/load"

/**
 * CLUBHOUSE PROGRAMME SECTION 6 -- FIND A FIXTURE.
 *
 * Answers "who could we play?" through the shared `packages/contracts/src/clubhouse/find-fixture.ts`
 * contract -- the same compatibility rule, marker population and distance/partner logic the main
 * Clubhouse map already uses. Selecting a candidate hands off into the EXISTING `/fixtures/new`
 * composer (prefilled) -- this screen never creates a fixture or a request itself.
 *
 * ONE FETCH, LOCAL FILTERING. Changing distance, sort or the partner toggle never re-hits the network:
 * `readClubhouseMarkers` + `find_fixture_candidate_teams` are fetched once per selected team, and
 * every criterion after that is a pure, instant client-side recombination -- the same shape the main
 * Clubhouse map/list screen already uses for its own filters.
 */

// Expo Go cannot load the native MapLibre module -- see apps/mobile/app/(tabs)/clubhouse/index.tsx's
// own, more detailed comment for why this guard exists and why native-map.tsx must stay outside app/.
// Duplicated here deliberately rather than shared, so this proven, twice-broken-and-fixed pattern is
// never refactored sight-unseen on a screen this session cannot live-test on a physical device.
const DIRECTORY_ONLY_CAP = 20

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
  // TEAM SELECTION -- preselected in team context; a real choice only when the club has more than
  // one eligible side (never an unnecessary selection screen for a club with exactly one).
  // ---------------------------------------------------------------------------------------------
  const [clubTeams, setClubTeams] = useState<ClubTeam[] | null>(null)
  const [chosenTeam, setChosenTeam] = useState<{ id: string; label: string; rugbyCode: string | null } | null>(null)

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

  useEffect(() => {
    if (!clubContext || !clubTeams || chosenTeam) return
    if (clubTeams.length === 1) setChosenTeam({ id: clubTeams[0]!.id, label: clubTeams[0]!.fullLabel, rugbyCode: clubTeams[0]!.rugbyCode })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubContext, clubTeams])

  const [contextTeamRugbyCode, setContextTeamRugbyCode] = useState<string | null>(null)
  useEffect(() => {
    if (!contextTeamId) return
    void teamRugbyCode(supabase, contextTeamId).then(setContextTeamRugbyCode)
  }, [contextTeamId])

  const teamId = clubContext ? chosenTeam?.id ?? null : contextTeamId
  const teamLabel = clubContext ? chosenTeam?.label ?? null : active?.kind === "team" ? active.label : null
  const teamRugbyCodeValue = clubContext ? (chosenTeam?.rugbyCode ?? null) : contextTeamRugbyCode

  // ---------------------------------------------------------------------------------------------
  // CRITERIA -- date/venue preference travel to the /fixtures/new handoff untouched; distance,
  // sort and the partner toggle are applied locally to one fetched population (see file header).
  // ---------------------------------------------------------------------------------------------
  const [date, setDate] = useState(todayIso())
  const [venuePreference, setVenuePreference] = useState<FindFixtureVenuePreference>("either")
  const [distance, setDistance] = useState<ClubhouseDistanceFilter>("any")
  const [sort, setSort] = useState<FindFixtureSort>("nearest")
  const [partnerFilter, setPartnerFilter] = useState<FindFixturePartnerFilter>("all")
  const [mode, setMode] = useState<"map" | "list">(isExpoGo ? "list" : "map")

  const [markers, setMarkers] = useState<ClubMapMarker[] | null>(null)
  const [candidateRows, setCandidateRows] = useState<{ team_id: string; club_id: string; display_name: string; age_group: string | null; gender: string | null }[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!teamId) return
    setError(null)
    setMarkers(null)
    setCandidateRows(null)
    try {
      const [markerRows, rpcResult] = await Promise.all([
        readClubhouseMarkers(supabase, viewerClubId, contextTeamId),
        supabase.rpc("find_fixture_candidate_teams", { p_team_id: teamId }),
      ])
      if (rpcResult.error) throw rpcResult.error
      setMarkers(markerRows)
      setCandidateRows(rpcResult.data ?? [])
    } catch {
      setError("Couldn't search for opposition. Check your connection and try again.")
    }
  }, [teamId, viewerClubId, contextTeamId])

  useEffect(() => {
    void load()
  }, [load])

  const origin = useMemo(() => (markers ? findDistanceOrigin(markers) : null), [markers])

  const { actionable, directoryOnly } = useMemo(() => {
    if (!markers || !candidateRows) return { actionable: [] as FindFixtureCandidate[], directoryOnly: [] as ClubMapMarker[] }
    return buildFindFixtureCandidates(markers, candidateRows, teamRugbyCodeValue)
  }, [markers, candidateRows, teamRugbyCodeValue])

  const filteredActionable = useMemo(() => {
    const byDistance = applyClubhouseDistanceFilter(actionable, distance, origin) as FindFixtureCandidate[]
    const byPartner = applyFindFixturePartnerFilter(byDistance, partnerFilter)
    return sortFindFixtureCandidates(byPartner, sort, origin)
  }, [actionable, distance, origin, partnerFilter, sort])

  // Section 3 found ~1,390 directory-only clubs, all one rugby code -- with no distance narrowed
  // (the "Any" default), showing every one of them would bury the actionable results under a wall
  // of Invite cards. Capped, with an honest count, rather than silently truncated.
  const allDirectoryOnly = useMemo(() => applyClubhouseDistanceFilter(directoryOnly, distance, origin), [directoryOnly, distance, origin])
  const filteredDirectoryOnly = allDirectoryOnly.slice(0, DIRECTORY_ONLY_CAP)

  const [mapSelectedClubId, setMapSelectedClubId] = useState<string | null>(null)
  const preselectedOpponentClubId = params.opponentClubId ?? mapSelectedClubId
  const displayedActionable = preselectedOpponentClubId ? filteredActionable.filter((c) => c.clubId === preselectedOpponentClubId) : filteredActionable

  function selectCandidate(candidate: FindFixtureCandidate, teamId2: string) {
    router.push({
      pathname: "/fixtures/new",
      params: {
        teamId: teamId ?? "",
        opponentDirectoryId: candidate.directoryId,
        opponentClubId: candidate.clubId ?? "",
        targetTeamId: teamId2,
        date,
        venuePreference,
      },
    } as never)
  }

  const withLocation = mode === "map" ? displayedActionable.filter((c) => c.hasLocation) : []

  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <FindFixtureHeader title="Find a Fixture" subtitle={teamLabel} onBack={() => router.back()} insets={insets} />

      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
        {clubContext && !chosenTeam && (
          <View style={{ gap: space.sm }}>
            <Text style={[type.smallMedium, { color: colour.ink }]}>Which team needs a fixture?</Text>
            {clubTeams === null && <CardSkeleton lines={2} />}
            {clubTeams?.length === 0 && <EmptyState title="No active sides" body="Add a side from the Team Directory first." />}
            {!!clubTeams?.length && (
              <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, overflow: "hidden" }}>
                {clubTeams.map((t, index) => (
                  <Pressable
                    key={t.id}
                    accessibilityRole="button"
                    accessibilityLabel={t.fullLabel}
                    onPress={() => setChosenTeam({ id: t.id, label: t.fullLabel, rugbyCode: t.rugbyCode })}
                    style={({ pressed }) => ({ minHeight: TOUCH_TARGET + 4, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: colour.line, backgroundColor: pressed ? colour.chalk : "transparent" })}
                  >
                    <Text style={[type.smallMedium, { color: colour.ink, flex: 1 }]}>{t.fullLabel}</Text>
                    <ChevronRight size={16} color={colour.inkSubtle} />
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}

        {teamId && (
          <>
            <View style={{ gap: space.md }}>
              <DateField label="When" value={date} onChange={setDate} />
              <View style={{ gap: space.xs }}>
                <Text style={[type.caption, { color: colour.inkMuted }]}>Where</Text>
                <ChoiceField
                  label="Home, away or either"
                  value={venuePreference}
                  onChange={setVenuePreference}
                  options={[
                    { value: "home", label: "Home" },
                    { value: "away", label: "Away" },
                    { value: "either", label: "Either" },
                  ]}
                />
              </View>
              <View style={{ gap: space.xs }}>
                <Text style={[type.caption, { color: colour.inkMuted }]}>Distance</Text>
                <DistanceChips distance={distance} onChange={setDistance} />
              </View>
            </View>

            {error && <ErrorState message={error} onRetry={() => void load()} />}

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
                  <EmptyState
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
                  displayedActionable.map((candidate) => <CandidateCard key={candidate.directoryId} candidate={candidate} onSelectTeam={(t) => selectCandidate(candidate, t)} />)}

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
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}

function CandidateCard({ candidate, onSelectTeam }: { candidate: FindFixtureCandidate; onSelectTeam: (teamId: string) => void }) {
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.md, gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <ClubCrest url={candidate.logoUrl} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[type.smallMedium, { color: colour.ink }]}>
            {candidate.name}
          </Text>
          <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
            {[candidate.town, candidate.county].filter(Boolean).join(", ") || (candidate.hasLocation ? "" : "Location unavailable")}
          </Text>
        </View>
        <NetworkPill marker={candidate} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
        {candidate.compatibleTeams.map((t) => (
          <Pressable
            key={t.teamId}
            accessibilityRole="button"
            accessibilityLabel={`Select ${t.displayName}`}
            onPress={() => onSelectTeam(t.teamId)}
            style={({ pressed }) => ({ minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: pressed ? colour.forest800 : colour.mint100, borderWidth: 1, borderColor: colour.pitch600 })}
          >
            {({ pressed }) => <Text style={[type.smallMedium, { color: pressed ? colour.onForest : colour.forest800 }]}>{t.displayName}</Text>}
          </Pressable>
        ))}
      </View>
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

function FindFixtureHeader({ title, subtitle, onBack, insets }: { title: string; subtitle?: string | null; onBack: () => void; insets: { top: number } }) {
  return (
    <View style={{ paddingTop: insets.top + space.sm, paddingBottom: space.sm, paddingHorizontal: space.md, borderBottomWidth: 1, borderBottomColor: colour.line, flexDirection: "row", alignItems: "center", gap: space.xs }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to Clubhouse"
        onPress={onBack}
        hitSlop={8}
        style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
      >
        <View style={{ transform: [{ rotate: "180deg" }] }}>
          <ChevronRight size={22} color={colour.ink} />
        </View>
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={[type.title, { color: colour.ink }]}>{title}</Text>
        {subtitle && (
          <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
            {subtitle}
          </Text>
        )}
      </View>
    </View>
  )
}
